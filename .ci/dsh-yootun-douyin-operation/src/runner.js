// 一次完整采集的执行器：本地会话 → 无头系统 Chrome → 采集 → 分批入库。
//
// 设备端职责（docs/0909/douyin §7）：
// 1. 会话可用性由设备端判定（tools 读不到本地 vault）；
// 2. 采集在页面上下文完成（a-bogus 由页面生成），CI/tools 不参与浏览器；
// 3. 入库走 tools MCP：run_start → set_list_meta → ingest_batch → run_finish。
// 任一步失败都产生可展示的稳定原因码，不把原始传输错误抛给页面。

import { access } from 'node:fs/promises'

import { normalizeAvatarUrl } from './avatar.js'
import { LAUNCH_ARGS, loadPlaywrightDriver, resolveSystemChrome } from './chrome.js'
import { collectAccountWorks } from './collector.js'
import { createIngestClient, ingestCollectedWorks } from './ingest.js'
import { SessionInvalidError } from './parse.js'
import { getAccount, hasStorageState, paths, stateRoot, updateAccount } from './state.js'
import { markSessionExpired } from './session.js'
import { accountSaveIdempotencyKey, sessionIdempotencyKey } from './tools-client.js'

export const DEFAULT_MAX_PAGES = 1000

/** 无头系统 Chrome + 本地 storage_state（采集用；登录才有头）。 */
export async function openHeadlessSession({ storageStatePath, chromium = null, platform, viewport = { width: 1440, height: 900 } }) {
  const driver = chromium || (await loadPlaywrightDriver())
  const chromePath = await resolveSystemChrome({ platform })
  const browser = await driver.chromium.launch({
    channel: chromePath.channel,
    executablePath: chromePath.path,
    headless: true,
    args: [...LAUNCH_ARGS],
  })
  const context = await browser.newContext({ storageState: storageStatePath, viewport, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  return { browser, context, chromePath: chromePath.path }
}

/**
 * 远端账号自愈：登录时的 account_save 可能失败（MCP 尚未就绪、路由未生效、
 * 瞬时故障），此时本地登录态照常有效而 tools 缺账号记录，后续 run_start 会被
 * ACCOUNT_NOT_FOUND 确定性拒绝。account_save 是幂等 upsert 且只带 vault://
 * 不透明引用，采集前补一次是安全的；失败**不阻断**采集——账号已在远端时照常
 * 采集，真缺失时由 run_start 给出确定错误（结果经 account_sync 事件可诊断）。
 *
 * @returns {Promise<{ ok: boolean, error: string | null }>}
 */
export async function ensureRemoteAccount(callTool, accountId, { root = stateRoot(), onProgress = null } = {}) {
  const emit = event => { if (onProgress) onProgress(event) }
  emit({ phase: 'account_sync' })
  try {
    const record = await getAccount(accountId, root)
    const fanCount = Number(record && record.fanCount)
    // 与登录侧 reportAccountSave 同一约束：字段缺值就不带，绝不发 undefined
    // 属性（宿主 snapshot 校验会整调用拒绝，而不是忽略该字段）。
    const payload = {
      accountId,
      sessionRef: paths(root).vaultRef(accountId),
      idempotencyKey: accountSaveIdempotencyKey(accountId),
    }
    const nickname = record && record.nickname
    if (typeof nickname === 'string' && nickname) payload.nickname = nickname
    if (Number.isFinite(fanCount)) payload.fanCount = fanCount
    await callTool('douyin_account_save', payload)
    return { ok: true, error: null }
  } catch (error) {
    const reason = safeReason(error)
    emit({ phase: 'account_sync_failed', error: reason })
    return { ok: false, error: reason }
  }
}

/**
 * 采集完成后的本地头像补写（二次优化 §5.1.3）。
 *
 * 只在满足全部条件时写入：profile 存在、profile.accountId 与当前账号一致
 * （不一致绝不把一个账号的头像写到另一个账号名下）、头像已收敛为合法 http(s)
 * 字符串、且当前本地记录的头像为空或无效（已有有效头像不得被一次异常响应覆盖）。
 * 任何失败都收敛为稳定 reason，绝不把原始文件错误抛给 UI，更不阻断作品入库。
 *
 * @returns {Promise<{ updated: boolean, reason: string|null }>}
 */
export async function saveDiscoveredAvatar({ accountId, profile, root = stateRoot() } = {}) {
  try {
    if (!profile || typeof profile !== 'object') return { updated: false, reason: 'profile_missing' }
    if (!accountId || profile.accountId !== accountId) return { updated: false, reason: 'account_mismatch' }
    const avatar = normalizeAvatarUrl(profile.avatar)
    if (!avatar) return { updated: false, reason: 'avatar_invalid' }
    const current = await getAccount(accountId, root)
    if (current && normalizeAvatarUrl(current.avatar)) return { updated: false, reason: 'avatar_exists' }
    await updateAccount(accountId, { avatar }, root)
    return { updated: true, reason: null }
  } catch {
    return { updated: false, reason: 'avatar_save_failed' }
  }
}

/**
 * 执行一次账号采集并入库。
 *
 * @param {{
 *   accountId: string,
 *   callTool: (name: string, args: object) => Promise<object>,
 *   root?: string,
 *   storageStatePath: string,
 *   chromium?: object,
 *   platform?: string,
 *   maxPages?: number,
 *   days?: number,
 *   newAttempt?: boolean,
 *   onProgress?: (event: object) => void,
 *   sessionFactory?: Function,
 *   saveAvatar?: Function,
 * }} options
 */
export async function runAccountCollection({
  accountId,
  callTool,
  root = stateRoot(),
  storageStatePath,
  chromium = null,
  platform,
  maxPages = DEFAULT_MAX_PAGES,
  days = 30,
  newAttempt = true,
  onProgress = null,
  sessionFactory = openHeadlessSession,
  saveAvatar = saveDiscoveredAvatar,
}) {
  const emit = event => { if (onProgress) onProgress(event) }
  // 会话文件必须真实存在：失效（过期）的会话文件仍存在，其有效性由设备端探测判定。
  if (!storageStatePath || !(await fileExists(storageStatePath))) {
    return { status: 'session_required', reason: 'storage_state_missing' }
  }

  // 远端账号自愈（幂等 upsert，失败不阻断）：登录期的 account_save 可能已失败，
  // 这里补一次；账号真缺失时由 run_start 返回确定性 ACCOUNT_NOT_FOUND 收尾。
  await ensureRemoteAccount(callTool, accountId, { root, onProgress: emit })

  const client = createIngestClient({ callTool, accountId, root, onProgress })
  let session = null
  let collected = null
  try {
    emit({ phase: 'session_open' })
    session = await sessionFactory({ storageStatePath, chromium, platform })
    const page = await session.context.newPage()
    collected = await collectAccountWorks(page, {
      maxPages,
      days,
      onProgress: info => emit({ phase: 'work', ...info }),
    })
    emit({
      phase: 'collected',
      listComplete: collected.listComplete,
      expectedWorkCount: collected.expectedWorkCount,
      listReason: collected.listReason,
      failures: collected.failures.length,
    })
  } catch (error) {
    // 会话失效（HTTP 200 + status_code:8，0914 方案 §3.6 前置门禁）：确定性失败——
    // 上报 expired、把已采集作品入库保留成果并以失败收尾 run，UI 明确提示重新扫码。
    if (error instanceof SessionInvalidError) {
      // collector 把中断前已完成的采集成果挂在错误上（partialCollected）：
      // 列表阶段即过期时无成果，collected 为 null（不建 run，见 finishExpiredSession）。
      const partial = error.partialCollected && Array.isArray(error.partialCollected.works)
        && error.partialCollected.works.length > 0
        ? error.partialCollected
        : null
      const partialCollected = partial
        ? {
          works: partial.works,
          listComplete: partial.listComplete,
          expectedWorkCount: partial.expectedWorkCount,
        }
        : null
      const outcome = await finishExpiredSession({
        accountId,
        callTool,
        client,
        collected: partialCollected,
        root,
        emit,
      })
      return { ...outcome, heartbeatSeq: client.heartbeatSeq }
    }
    return { status: 'collect_failed', reason: safeReason(error), heartbeatSeq: client.heartbeatSeq }
  } finally {
    if (session) {
      await session.context.close().catch(() => {})
      await session.browser.close().catch(() => {})
    }
  }

  // 采集完成后头像补写（二次优化 §5.1.3/§5.1.4）：本地只在头像缺失时回写；
  // 本地写入成功且头像从空变为合法新值时，按既有 douyin_account_save 幂等机制
  // 补传标准化后的头像字符串（只发非空字符串，不发对象/Cookie）。本地写入失败、
  // 远端同步失败都只记诊断事件，绝不改变作品采集与入库结果。
  // 兜底 catch：默认实现内部全捕获，注入实现若抛异常同样不得跳过作品入库。
  const avatarOutcome = await saveAvatar({ accountId, profile: collected.profile, root })
    .catch(() => ({ updated: false, reason: 'avatar_save_failed' }))
  if (avatarOutcome.updated) {
    emit({ phase: 'avatar_saved' })
    try {
      const record = await getAccount(accountId, root)
      const avatar = normalizeAvatarUrl(record && record.avatar)
      if (avatar) {
        await callTool('douyin_account_save', {
          accountId,
          sessionRef: paths(root).vaultRef(accountId),
          idempotencyKey: accountSaveIdempotencyKey(accountId),
          avatar,
        })
      }
    } catch (error) {
      emit({ phase: 'avatar_sync_failed', error: safeReason(error) })
    }
  } else if (avatarOutcome.reason === 'account_mismatch' || avatarOutcome.reason === 'avatar_save_failed') {
    emit({ phase: 'avatar_save_failed', reason: avatarOutcome.reason })
  }

  try {
    const ingested = await ingestCollectedWorks({
      client,
      works: collected.works,
      listComplete: collected.listComplete,
      expectedWorkCount: collected.expectedWorkCount,
      newAttempt,
      onProgress,
    })
    if (ingested.error) return { status: 'ingest_failed', reason: ingested.error, runId: ingested.runId }
    return {
      status: 'ready',
      runId: ingested.runId,
      runStatus: ingested.finish && ingested.finish.run ? ingested.finish.run.status : null,
      listComplete: collected.listComplete,
      listReason: collected.listReason,
      expectedWorkCount: collected.expectedWorkCount,
      succeededWorkCount: ingested.ingest.succeededWorkIds.length,
      failedWorkCount: ingested.ingest.failedWorkIds.length,
      workFailures: collected.failures,
      pages: collected.pages.length,
      settlement: ingested.finish ? ingested.finish.settlement : null,
    }
  } catch (error) {
    return { status: 'ingest_failed', reason: safeReason(error), runId: client.runId }
  }
}

/**
 * 会话失效收尾（0914 方案 §3.6）：
 *
 * (a) 上报 `douyin_session_status_report({ status: 'expired' })`：经幂等键，
 *     `sessionSeq` 单调递增语义不变（markSessionExpired 取下一序号）。尽力而为，
 *     上报失败只记诊断事件，不阻断 run 收尾。
 * (b) run 收尾：本轮已采集的作品照常入库（保留成果），再以 `clientStatus: 'failed'`
 *     结束——服务端结算只看批次账本：有成功批次 → partial，无 → failed，两种都不是
 *     健康完成，绝不复现旧的 `completed + expectedWorkCount=0` 假空成功。
 *     收尾时 `listComplete` 一律按 false 发布：即便过期前作品恰好全部入库成功，
 *     服务端也必须结算为 partial，而不是把一次被会话中断的采集记成健康完成
 *     （实施说明 §4"两种都不是健康完成"）。
 *     列表阶段即过期（无任何作品）时不创建 run：expected=0 无法诚实结算为非健康
 *     终态（expected=0 + listComplete=false 只会得 partial 假象），此时只上报
 *     expired，由 UI 提示重新扫码；不产生任何 run 行，也就没有假 completed。
 *
 * @returns {Promise<object>} `status: 'session_expired'` 的采集结果（UI 据此显示
 *   "会话已过期，请重新扫码"，绝不显示"采集完成"）。
 */
export async function finishExpiredSession({ accountId, callTool, client, collected, root, emit }) {
  emit({ phase: 'session_expired' })

  let sessionReported = false
  let sessionReportError = null
  try {
    const state = await markSessionExpired({ accountId, root })
    await callTool('douyin_session_status_report', {
      accountId,
      sessionStatus: state.sessionStatus,
      sessionSeq: state.sessionSeq,
      checkedAt: state.checkedAt,
      // 只上报不透明引用，不上报任何 Cookie 内容。
      sessionRef: paths(root).vaultRef(accountId),
      idempotencyKey: sessionIdempotencyKey(accountId, state.sessionSeq),
    })
    sessionReported = true
  } catch (error) {
    sessionReportError = safeReason(error)
    emit({ phase: 'session_report_failed', error: sessionReportError })
  }

  const works = collected ? collected.works : []
  let runId = null
  let runStatus = null
  let succeededWorkCount = 0
  let failedWorkCount = 0
  if (works.length > 0) {
    try {
      if (!client.runId) await client.startRun({ newAttempt: true })
      runId = client.runId
      await client.publishListMeta({
        expectedWorkCount: collected.expectedWorkCount,
        // 被会话中断的采集绝不声明列表完整：保证服务端结算为非健康终态（partial）。
        listComplete: false,
      })
      const ingested = await client.ingestAll(works)
      const finish = await client.finish({
        clientStatus: 'failed',
        clientCounts: {
          expectedWorkCount: collected.expectedWorkCount,
          succeededWorkCount: ingested.succeededWorkIds.length,
          failedWorkCount: ingested.failedWorkIds.length,
        },
      })
      runStatus = finish && finish.run ? finish.run.status : null
      succeededWorkCount = ingested.succeededWorkIds.length
      failedWorkCount = ingested.failedWorkIds.length
    } catch (error) {
      emit({ phase: 'session_expired_finish_failed', error: safeReason(error) })
    }
  }

  return {
    status: 'session_expired',
    reason: 'session_invalid',
    runId,
    runStatus,
    listComplete: collected ? collected.listComplete : null,
    expectedWorkCount: collected ? collected.expectedWorkCount : null,
    succeededWorkCount,
    failedWorkCount,
    sessionReported,
    sessionReportError,
  }
}

/**
 * 采集控制器：一次只允许一个采集在跑，页面通过轮询读取进度。
 *
 * @param {{ runCollection?: Function, logger?: object }} [options]
 */
export function createCollectController({ runCollection = runAccountCollection, logger = null } = {}) {
  const runs = new Map()

  async function start({ accountId, options = {} }) {
    if (!accountId) return { status: 'error', reason: 'account_id_required' }
    const existing = runs.get(accountId)
    if (existing && existing.status === 'running') return { status: 'ready', collect: project(existing) }

    const record = {
      accountId,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      events: [],
      result: null,
      error: null,
    }
    runs.set(accountId, record)
    record.promise = (async () => {
      try {
        const result = await runCollection({
          accountId,
          ...options,
          onProgress: event => {
            record.events.push({ at: Date.now(), ...event })
            if (record.events.length > 200) record.events.splice(0, record.events.length - 200)
            if (options.onProgress) options.onProgress(event)
          },
        })
        record.result = result
        record.status = result.status === 'ready' ? 'completed' : 'failed'
        record.error = result.reason || null
      } catch (error) {
        record.status = 'failed'
        record.error = safeReason(error)
        logger?.warn?.(`douyin collect failed: ${record.error}`)
      } finally {
        record.finishedAt = new Date().toISOString()
      }
    })()
    return { status: 'ready', collect: project(record) }
  }

  function status(accountId) {
    const record = runs.get(accountId)
    if (!record) return { status: 'ready', collect: null }
    return { status: 'ready', collect: project(record) }
  }

  async function wait(accountId) {
    const record = runs.get(accountId)
    if (!record || !record.promise) return null
    await record.promise
    return project(record)
  }

  // 批量互斥探测：批量入口用它保证「单账号采集运行中禁止启动批量」。
  function hasRunning() {
    for (const record of runs.values()) {
      if (record.status === 'running') return true
    }
    return false
  }

  return { start, status, wait, hasRunning, reset: () => runs.clear() }
}

function project(record) {
  const last = [...record.events].reverse().find(event => event.phase === 'batch_done' || event.phase === 'work' || event.phase === 'collected')
  return {
    accountId: record.accountId,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    error: record.error,
    progress: last
      ? {
        phase: last.phase,
        workId: last.workId || null,
        index: last.index || null,
        total: last.total || null,
        batchNo: last.batchNo || null,
        totalBatches: last.totalBatches || null,
        succeeded: last.succeeded === undefined ? null : last.succeeded,
        failed: last.failed === undefined ? null : last.failed,
      }
      : null,
    result: record.result
      ? {
        runId: record.result.runId || null,
        runStatus: record.result.runStatus || null,
        listComplete: record.result.listComplete,
        expectedWorkCount: record.result.expectedWorkCount,
        succeededWorkCount: record.result.succeededWorkCount,
        failedWorkCount: record.result.failedWorkCount,
      }
      : null,
  }
}

/** 采集前检查：本地会话文件是否就绪（真正的有效性由设备端探测决定）。 */
export async function checkCollectionReadiness({ accountId, root = stateRoot() }) {
  const ready = await hasStorageState(accountId, root)
  return ready ? { ready: true, reason: null } : { ready: false, reason: 'session_required' }
}

let batchSeq = 0

function defaultBatchId() {
  batchSeq += 1
  return `batch-${Date.now().toString(36)}-${batchSeq}`
}

/**
 * 批量采集控制器（一键采集全部）：按稳定顺序逐个采集已登录账号。
 *
 * 契约（docs/0909/douyin README §并发：跨账号顺序执行；本方案 §4）：
 * - 宿主层全局互斥：批量与单账号入口互斥，检查与占位都在第一个 await 之前
 *   同步完成（Node 单线程下无竞态窗口）；重复 start 批量返回现有任务。
 * - 两段式筛选：入口同步筛选（缓存口径）由宿主完成；控制器内先逐账号串行
 *   probe（实测口径），probe 不过的账号 skipped 并给稳定原因，不阻断后续。
 * - 采集复用单账号控制器（collect.start/wait）：collect.status 因此能看到
 *   批量中当前账号的细粒度进度，runAccountCollection 语义零改动。
 * - 单账号失败记录原因后继续下一个；终态 completed / partial / failed。
 *
 * @param {{
 *   collect?: { start: Function, wait: Function, hasRunning?: Function },
 *   probe?: (accountId: string) => Promise<{ sessionStatus: string, reason?: string|null }>,
 *   logger?: object,
 *   generateId?: () => string,
 * }} [options]
 */
export function createBatchCollectController({ collect = null, probe = null, logger = null, generateId = defaultBatchId } = {}) {
  let batch = null

  function hasRunning() {
    return Boolean(batch && batch.status === 'running')
  }

  /**
   * @param {{
   *   accounts: Array<{ accountId: string, skipped?: boolean, reason?: string|null }>,
   *   buildOptions?: (accountId: string) => object,
   * }} payload
   */
  function start({ accounts = [], buildOptions = null } = {}) {
    // 幂等复用：已有批量在跑时直接返回当前状态，不创建第二个任务。
    if (hasRunning()) return { status: 'ready', batch: projectBatch(batch) }
    if (collect && typeof collect.hasRunning === 'function' && collect.hasRunning()) {
      return { status: 'error', reason: 'collect_busy' }
    }
    const items = (Array.isArray(accounts) ? accounts : [])
      .filter(item => item && item.accountId)
      .sort((a, b) => String(a.accountId).localeCompare(String(b.accountId)))
      .map(item => ({
        accountId: item.accountId,
        status: item.skipped ? 'skipped' : 'queued',
        reason: item.skipped ? (item.reason || 'not_eligible') : null,
        collect: null,
      }))
    if (!items.some(item => item.status === 'queued')) {
      // 入口同步筛选后没有任何可采集账号：直接拒绝，不产生零执行的任务记录。
      return { status: 'error', reason: 'no_eligible_account', skipped: projectItems(items) }
    }
    batch = {
      batchId: generateId(),
      status: 'running',
      phase: 'probing',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      currentAccountId: null,
      error: null,
      items,
    }
    batch.promise = runBatch({ buildOptions })
    return { status: 'ready', batch: projectBatch(batch) }
  }

  async function runBatch({ buildOptions }) {
    try {
      // 阶段 1：逐账号串行会话探测（缓存口径的 ok 只是上次探测结果，实测后才诚实）。
      // queued（待探测）→ probing → ready（实测通过，待采集）；不过探测的收敛为
      // skipped + 稳定原因。ready 与 queued 分开，探测进度因此可计算。
      batch.phase = 'probing'
      for (const item of batch.items) {
        if (item.status !== 'queued') continue
        batch.currentAccountId = item.accountId
        item.status = 'probing'
        const outcome = await probeAccount(item.accountId)
        if (outcome === 'ok') {
          item.status = 'ready'
        } else {
          item.status = 'skipped'
          item.reason = outcome
        }
      }
      batch.currentAccountId = null
      const runnable = batch.items.filter(item => item.status === 'ready')
      // 全部账号被探测拦截：没有任何可采集账号，以失败收尾（绝不伪装成完成）。
      if (!runnable.length) {
        batch.status = 'failed'
        batch.finishedAt = new Date().toISOString()
        return
      }
      // 阶段 2：严格顺序采集——上一个账号完全结束后才启动下一个（跨账号顺序契约）。
      batch.phase = 'collecting'
      for (const item of runnable) {
        item.status = 'running'
        batch.currentAccountId = item.accountId
        const options = buildOptions ? buildOptions(item.accountId) : {}
        let outcome = null
        if (collect && typeof collect.start === 'function' && typeof collect.wait === 'function') {
          const started = await collect.start({ accountId: item.accountId, options })
          outcome = started.status === 'ready' ? await collect.wait(item.accountId) : null
          if (!outcome) outcome = { status: 'failed', error: started.reason || 'collect_failed' }
        } else {
          outcome = { status: 'failed', error: 'collect_controller_missing' }
        }
        item.status = outcome.status === 'completed' ? 'completed' : 'failed'
        item.reason = outcome.error || null
        item.collect = {
          status: outcome.status,
          error: outcome.error || null,
          result: outcome.result || null,
        }
        batch.currentAccountId = null
      }
      const completed = batch.items.filter(item => item.status === 'completed').length
      const failed = batch.items.filter(item => item.status === 'failed').length
      batch.status = completed === 0 ? 'failed' : (failed > 0 ? 'partial' : 'completed')
      batch.finishedAt = new Date().toISOString()
    } catch (error) {
      // 防御兜底：单账号失败已在循环内收敛，走到这里说明批量自身异常，收敛为失败终态。
      batch.status = 'failed'
      batch.error = safeReason(error)
      batch.finishedAt = new Date().toISOString()
      logger?.warn?.(`douyin batch collect failed: ${batch.error}`)
    }
  }

  async function probeAccount(accountId) {
    if (!probe) return 'ok'
    let state = null
    try {
      state = await probe(accountId)
    } catch (error) {
      logger?.warn?.(`douyin batch probe failed: ${safeReason(error)}`)
      return 'probe_failed'
    }
    if (state && state.sessionStatus === 'ok') return 'ok'
    if (state && state.sessionStatus === 'expired') return 'session_required'
    return 'probe_failed'
  }

  function status() {
    if (!batch) return { status: 'ready', batch: null }
    return { status: 'ready', batch: projectBatch(batch) }
  }

  async function wait() {
    if (batch && batch.promise) await batch.promise
    return batch ? projectBatch(batch) : null
  }

  return { start, status, wait, hasRunning }
}

function projectItems(items) {
  return items.map(item => ({
    accountId: item.accountId,
    status: item.status,
    reason: item.reason || null,
    ...(item.collect
      ? {
        collect: {
          status: item.collect.status,
          error: item.collect.error || null,
          ...(item.collect.result
            ? {
              result: {
                runId: item.collect.result.runId || null,
                runStatus: item.collect.result.runStatus || null,
                listComplete: item.collect.result.listComplete ?? null,
                expectedWorkCount: item.collect.result.expectedWorkCount ?? null,
                succeededWorkCount: item.collect.result.succeededWorkCount ?? null,
                failedWorkCount: item.collect.result.failedWorkCount ?? null,
              },
            }
            : {}),
        },
      }
      : {}),
  }))
}

function projectBatch(batch) {
  const counts = { completed: 0, failed: 0, skipped: 0, running: 0, queued: 0, probing: 0, ready: 0 }
  for (const item of batch.items) counts[item.status] = (counts[item.status] || 0) + 1
  const runnableTotal = batch.items.length - counts.skipped
  return {
    batchId: batch.batchId,
    status: batch.status,
    phase: batch.phase || null,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt,
    error: batch.error || null,
    currentAccountId: batch.currentAccountId,
    total: batch.items.length,
    runnableTotal,
    runnableDone: counts.completed + counts.failed,
    completedCount: counts.completed,
    failedCount: counts.failed,
    skippedCount: counts.skipped,
    probedCount: counts.ready + counts.running + counts.completed + counts.failed,
    items: projectItems(batch.items),
  }
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function safeReason(error) {
  if (error && typeof error.code === 'string' && error.code) return error.code
  if (error && typeof error.name === 'string') return error.name.slice(0, 64)
  return 'collect_failed'
}
