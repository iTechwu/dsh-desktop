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

  return { start, status, wait, reset: () => runs.clear() }
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
