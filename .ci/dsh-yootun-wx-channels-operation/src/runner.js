// 采集编排（设备端）：单账号全流程 + 一键采集全部（账号间严格串行，§8.4/§8.5）。
//
// 单账号流程（§8.4）：auth_data 探活 → statistic/post_list 全量 → 逐作品串行详情
// （get_feed_lost_rate + feed_aggreagate，发布日零点起）→ new_post_total_data →
// fans_trend → fans_portrait → 分批 ingest → run_finish。
//
// 关键规则（§8.4）：作品列表必须达到 totalCount；单作品详情失败只影响该作品；账号
// 级数据失败记段落缺口；会话失效（SessionInvalidError）标记 expired 并走过期收尾
// （保留已采集数据，绝不覆盖为空白）；频率受限/风控保留已有数据并返回稳定错误。
//
// 批量控制器（§8.5）：账号间严格串行、与单账号采集互斥、单账号失败继续下一个、
// 状态仅存宿主进程内（重启后 collectAll.status 回 ready）；一期无批量取消。

import { browserStatus } from './chrome.js'
import {
  ASSISTANT_ORIGIN,
  collectAccountMetrics,
  collectFansPortrait,
  collectFansTrend,
  collectWorkDetail,
  collectWorkList,
  fetchAuthData,
} from './collector.js'
import { createIngestClient, ingestCollectedData, resolveClientStatus } from './ingest.js'
import { SessionInvalidError } from './session-errors.js'
import { markSessionExpired, markSessionOk, probeSession, refreshSessionState } from './session.js'
import { getAccount, hasStorageState } from './state.js'
import { callTool, sessionIdempotencyKey, safeErrorCode } from './tools-client.js'

export const DEFAULT_MAX_PAGES = 50
const OPEN_TIMEOUT_MS = 60_000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 单账号采集资格检查（§8.5）：本地记录存在、非 pending、storage_state 存在、
 * 当前无其他采集。会话可用性在批量控制器中由探测决定（session_required）。
 */
export async function checkCollectionReadiness({ accountId, root, busy = false } = {}) {
  const record = await getAccount(accountId, root).catch(() => null)
  if (!record) return { ready: false, reason: 'session_required' }
  if (String(accountId).startsWith('pending-')) return { ready: false, reason: 'pending_account' }
  if (!(await hasStorageState(accountId, root))) return { ready: false, reason: 'storage_state_missing' }
  if (busy) return { ready: false, reason: 'collect_busy' }
  return { ready: true, reason: null, record }
}

/**
 * 单账号采集完整流程。
 *
 * @param {{
 *   ctx: object, accountId: string, root?: string, chromium?: object,
 *   maxPages?: number, newAttempt?: boolean, onProgress?: Function,
 *   logger?: object, platform?: string,
 *   launch?: (options: object) => Promise<{ context: object }>,
 * }} options
 * @returns {Promise<{ status: 'completed'|'partial'|'failed', runId: string|null,
 *   reason?: string, finish?: object, works?: number }>}
 */
export async function runCollection({
  ctx,
  accountId,
  root,
  chromium = null,
  maxPages = DEFAULT_MAX_PAGES,
  newAttempt = true,
  onProgress = null,
  logger = null,
  platform,
  launch = null,
}) {
  const emit = event => { if (onProgress) onProgress(event) }
  const call = (name, args) => callTool(ctx, name, args)

  // 1) 会话探测（本地实测优先，§6.1 多设备假设）：失败即跳过，不启动浏览器。
  emit({ phase: 'probing', accountId })
  let floorSessionSeq = 0
  try {
    const remote = await call('wx_channels_account_list', { accountId })
    const row = remote && Array.isArray(remote.accounts)
      ? remote.accounts.find(item => item.account_id === accountId)
      : null
    if (row) floorSessionSeq = Number(row.session_seq || 0)
  } catch {
    // 远端状态只是展示参考（§6.1.3），读不到不阻断本地实测。
  }
  const session = await refreshSessionState({ accountId, root, deps: { chromium, platform } })
  await reportSessionStatus(ctx, accountId, session)
  if (session.sessionStatus !== 'ok') {
    return { status: 'failed', runId: null, reason: session.sessionStatus === 'expired' ? 'session_expired' : 'probe_failed' }
  }

  // 2) 打开无头系统 Chrome（独立 Profile + storage_state）。
  const profileDir = (await import('./state.js')).paths(root || (await import('./state.js')).stateRoot()).profileDir(accountId)
  let context = null
  try {
    const launchChrome = launch || (await import('./chrome.js')).launchChrome
    ;({ context } = await launchChrome({ headless: true, profileDir, chromium, platform }))
    const page = context.pages()[0] || (await context.newPage())
    await page.goto(ASSISTANT_ORIGIN, { waitUntil: 'domcontentloaded', timeout: OPEN_TIMEOUT_MS })
    // 页面上下文 auth_data 复核会话（浏览器内登录态可能与 storage_state 文件不同步）。
    const finderId = await (async () => {
      try {
        const profile = await fetchAuthData(page, { finderId: '' })
        return profile.accountId
      } catch (error) {
        if (error instanceof SessionInvalidError) throw error
        return accountId
      }
    })()
    if (finderId !== accountId) {
      // 登录态与账号不匹配（storage_state 串号）：按会话失效处理，绝不写错账号。
      throw new SessionInvalidError('account_mismatch')
    }

    // 3) 全量作品列表（startTime=0）。
    emit({ phase: 'list', accountId })
    const list = await collectWorkList(page, { finderId: accountId, maxPages, onPage: event => emit({ phase: 'list_page', ...event }) })

    // 4) 逐作品串行详情。详情**完全失败**的作品本次不入库（§阶段0 采集策略 5：
    // 列表成功但详情失败 → run 允许 partial；服务端账本 succeeded < expected
    // 自然结算 partial，满足 §8.4.3「单作品大量失败时 run 不得 completed」）。
    // 详情成功但字段缺失 → 按字段缺口入库（NULL ≠ 0）。
    const enriched = []
    let detailFailed = 0
    for (let index = 0; index < list.works.length; index += 1) {
      const work = { ...list.works[index], dailyMetrics: [] }
      try {
        const detail = await collectWorkDetail(page, { finderId: accountId, work })
        work.dailyMetrics = detail.dailyMetrics || []
        if (detail.retentionTrend) work.retentionTrend = detail.retentionTrend
        if (detail.trafficSource) work.trafficSource = detail.trafficSource
        enriched.push(work)
      } catch (error) {
        detailFailed += 1
        emit({ phase: 'detail_gap', workId: work.workId, reason: safeReason(error) })
      }
      // 逐作品进度事件（对齐抖音「采集进度 N/M」逐个推进；纯内存回调零成本）。
      emit({
        phase: 'details_progress',
        done: index + 1,
        total: list.works.length,
        detailFailed,
      })
    }
    if (detailFailed) {
      emit({ phase: 'details_failed_summary', detailFailed, ingested: enriched.length })
    }

    // 5) 账号级三接口（失败记段落缺口，不阻断）。
    emit({ phase: 'account_level', accountId })
    const accountLevel = { accountMetrics: null, fansTrend: null, fansProfile: null }
    try {
      accountLevel.accountMetrics = await collectAccountMetrics(page, { finderId: accountId })
    } catch (error) {
      emit({ phase: 'segment_gap', segment: 'account_metrics_collect', reason: safeReason(error) })
    }
    try {
      // 增长序列按平台保留历史全量回填；超长窗口按 180 天分块（§15.5）。
      accountLevel.fansTrend = await collectFansTrendWindowed(page, { finderId: accountId })
    } catch (error) {
      emit({ phase: 'segment_gap', segment: 'fans_trend_collect', reason: safeReason(error) })
    }
    try {
      accountLevel.fansProfile = await collectFansPortrait(page, { finderId: accountId })
    } catch (error) {
      emit({ phase: 'segment_gap', segment: 'fans_profile_collect', reason: safeReason(error) })
    }

    // 6) 入库编排（切批 + 四类批次 + finish）。
    const client = createIngestClient({ callTool: call, accountId, root, logger })
    const result = await ingestCollectedData({
      client,
      works: enriched,
      listComplete: list.listComplete,
      expectedWorkCount: list.totalCount ?? enriched.length,
      newAttempt,
      onProgress,
      accountLevel,
    })
    if (result.error) {
      return { status: 'failed', runId: result.runId, reason: result.error, works: enriched.length }
    }
    // 采集成功：会话拉回 ok（floorSessionSeq 对齐远端下限，§多设备假设）。
    const okState = await markSessionOk({ accountId, root, floorSessionSeq })
    await reportSessionStatus(ctx, accountId, okState)
    const status = result.finish && result.finish.run ? result.finish.run.status : resolveClientStatus({
      listComplete: list.listComplete,
      expected: list.totalCount ?? enriched.length,
      ingest: result.ingest || { succeededWorkIds: [], failedWorkIds: [] },
    })
    return { status, runId: result.runId, finish: result.finish, works: enriched.length }
  } catch (error) {
    // 会话失效：标记 expired 并走过期收尾（已采集数据由 partial 列表带出保留）。
    if (error instanceof SessionInvalidError) {
      const expired = await markSessionExpired({ accountId, root, reason: error.reason })
      await reportSessionStatus(ctx, accountId, expired)
      return { status: 'failed', runId: null, reason: 'session_expired' }
    }
    logger?.warn?.(`wx collect ${accountId}: ${safeReason(error)}`)
    return { status: 'failed', runId: null, reason: safeReason(error) }
  } finally {
    if (context) await context.close().catch(() => {})
  }
}

/** fans_trend 全量回填：平台历史起点（实测 2020-08-19）至今按 180 天块串行拉取。
 *
 * 全程用上海语义日字符串推算（shanghaiDayStartTs/shanghaiDayFromTs），禁止
 * `new Date(ms).toISOString()` 直取日——上海零点的 UTC 时刻 toISOString 会提前
 * 一天（review P0-3 死循环教训）。
 */
async function collectFansTrendWindowed(page, { finderId, blockDays = 180, now = Date.now }) {
  const { latestCompletedDay, shanghaiDayFromTs, shanghaiDayStartTs } = await import('./parse.js')
  const endDay = latestCompletedDay(now)
  const startDay = '2020-08-19' // 平台历史起点（开发实施文档 §15.5.1 实测）
  // 合并日行用 daily 键（与单块 collectFansTrend、ingest 消费端、E2E fixture 同一形状）。
  const daily = []
  const sourceTrendRows = []
  const sourceTrendByType = new Map()
  let cursorDay = startDay
  let guard = 0
  while (cursorDay <= endDay) {
    guard += 1
    if (guard > 200) throw new Error('fans_trend_window_loop_guard')
    const blockEndTs = Math.min(
      shanghaiDayStartTs(cursorDay) + (blockDays - 1) * 86400,
      shanghaiDayStartTs(endDay),
    )
    const blockEnd = shanghaiDayFromTs(blockEndTs)
    const chunk = await collectFansTrend(page, { finderId, startDay: cursorDay, endDay: blockEnd, now })
    daily.push(...chunk.daily)
    // 跨块来源趋势按 sourceType 合并（P3-6：同 sourceType 不重复 push）。
    if (chunk.sourceTrend && Array.isArray(chunk.sourceTrend.rows)) {
      for (const row of chunk.sourceTrend.rows) {
        const existing = sourceTrendByType.get(row.sourceType)
        if (existing) {
          existing.daily.push(...row.daily)
        } else {
          sourceTrendByType.set(row.sourceType, { ...row, daily: [...row.daily] })
        }
      }
    }
    if (blockEnd >= endDay) break
    cursorDay = shanghaiDayFromTs(blockEndTs + 86400)
  }
  const mergedSourceTrend = sourceTrendByType.size
    ? { rows: [...sourceTrendByType.values()] }
    : null
  return {
    startDay,
    endDay,
    daily,
    sourceTrend: mergedSourceTrend,
  }
}

/** 会话状态尽力上报（失败不阻断本地状态已更新，§8.4）。 */
async function reportSessionStatus(ctx, accountId, state) {
  try {
    await callTool(ctx, 'wx_channels_session_status_report', {
      accountId,
      sessionStatus: state.sessionStatus,
      sessionSeq: state.sessionSeq,
      checkedAt: state.checkedAt,
      sessionRef: state.vaultRef,
      idempotencyKey: sessionIdempotencyKey(accountId, state.sessionSeq),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: safeErrorCode(error) }
  }
}

/**
 * 采集事件 → 进度投影（形状对齐抖音 progressText 数据源）：
 * - probing / list / list_page / account_level → 阶段提示；
 * - details_progress → work（「采集进度 N/M」）；
 * - batch_done / batch_failed → batch_done（「入库进度 i/j · s/e」）。
 * 其余事件（detail_gap / segment_gap / run_* / finished 等）返回 null：
 * 调用方保持上一个进度，不覆盖。
 */
export function progressFromEvent(event) {
  if (!event || typeof event.phase !== 'string') return null
  switch (event.phase) {
    case 'probing':
      return { phase: 'probing' }
    case 'list':
      return { phase: 'list' }
    case 'list_page':
      return { phase: 'list', page: event.pageNumber || null, collected: event.collected || 0 }
    case 'details_progress':
      return { phase: 'work', index: event.done || 0, total: event.total || 0 }
    case 'account_level':
      return { phase: 'account_level' }
    case 'batch_done':
    case 'batch_failed':
      return {
        phase: 'batch_done',
        batchNo: event.batchNo || 0,
        totalBatches: event.totalBatches || 0,
        succeeded: event.succeeded || 0,
        failed: event.failed || 0,
        expected: event.expected || 0,
      }
    default:
      return null
  }
}

/**
 * 一键采集全部（§8.5）：资格过滤 → 账号间严格串行 → 单账号失败继续 → 汇总。
 * 状态仅存宿主进程内；与单账号采集互斥。
 */
export function createBatchCollectController({ collect, probe, logger = null } = {}) {
  let state = null
  const emit = handler => { if (state && typeof handler === 'function') state.onProgress = handler }

  function phase(next) {
    if (state) state.phase = next
  }

  return {
    get status() {
      if (!state) return { ready: true, phase: 'ready' }
      // 实时计数（对齐抖音 projectBatch：批量面板计数行数据源；summary 是终态汇总）。
      const counts = { completed: 0, failed: 0, skipped: 0, running: 0, probing: 0, ready: 0 }
      for (const item of state.items) counts[item.status] = (counts[item.status] || 0) + 1
      return {
        ready: false,
        phase: state.phase,
        batchId: state.batchId,
        items: state.items,
        total: state.items.length,
        currentAccountIndex: state.currentAccountIndex,
        currentAccountId: state.currentAccountId,
        // 当前账号细粒度进度（作品级）：页面 collectAll.status 单轮询即可渲染
        // 「当前账号名 · 采集进度 N/M」，无需第二个轮询循环。
        currentProgress: state.currentProgress,
        currentRunId: state.currentRunId,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        completedCount: counts.completed,
        failedCount: counts.failed,
        skippedCount: counts.skipped,
        summary: state.summary,
      }
    },
    get running() { return Boolean(state && state.phase !== 'finished') },
    setProgress(handler) { emit(handler) },
    async start({ accountIds }) {
      if (state && state.phase !== 'finished') {
        return { started: false, reason: 'collect_busy' }
      }
      state = {
        batchId: `batch-${Date.now()}`,
        phase: 'probing',
        items: accountIds.map(accountId => ({
          accountId, status: 'ready', reason: null, runId: null, startedAt: null, finishedAt: null,
        })),
        currentAccountIndex: -1,
        currentAccountId: null,
        currentProgress: null,
        currentRunId: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        summary: null,
        onProgress: null,
      }
      // 异步执行（页面轮询 collectAll.status）；并发 start 被 running 守卫拒绝。
      void this._run()
      return { started: true, batchId: state.batchId }
    },
    async _run() {
      const counts = { completed: 0, failed: 0, skipped: 0 }
      for (let index = 0; index < state.items.length; index += 1) {
        const item = state.items[index]
        state.currentAccountIndex = index
        state.currentAccountId = item.accountId
        phase('probing')
        item.status = 'probing'
        item.startedAt = new Date().toISOString()
        let probeResult = null
        try {
          probeResult = await probe(item.accountId)
        } catch (error) {
          probeResult = { sessionStatus: 'unknown', reason: safeReason(error), reported: false }
        }
        if (probeResult.sessionStatus === 'expired') {
          item.status = 'skipped'
          item.reason = 'session_required'
          counts.skipped += 1
          state.currentAccountId = null
          state.onProgress?.({ phase: 'item_skipped', item: { ...item } })
          continue
        }
        if (probeResult.sessionStatus === 'unknown') {
          item.status = 'skipped'
          item.reason = 'probe_failed'
          counts.skipped += 1
          state.currentAccountId = null
          state.onProgress?.({ phase: 'item_skipped', item: { ...item } })
          continue
        }
        phase('collecting')
        item.status = 'running'
        state.currentRunId = null
        state.currentProgress = null
        const result = await collect({
          accountId: item.accountId,
          onProgress: event => {
            // 细粒度进度（作品级）随 collectAll.status 一起投影；非关键事件保持上一进度。
            const progress = progressFromEvent(event)
            if (progress) state.currentProgress = progress
            state.onProgress?.({ phase: 'item_progress', accountId: item.accountId, ...event })
          },
        })
        item.finishedAt = new Date().toISOString()
        item.runId = result.runId || null
        state.currentRunId = item.runId
        if (result.status === 'completed') {
          item.status = 'completed'
          counts.completed += 1
        } else if (result.status === 'partial') {
          item.status = 'completed'
          item.reason = 'partial'
          counts.completed += 1
        } else {
          item.status = 'failed'
          item.reason = result.reason || 'collect_failed'
          counts.failed += 1
        }
        state.currentProgress = null
        state.currentAccountId = null
        state.onProgress?.({ phase: 'item_done', item: { ...item } })
      }
      state.finishedAt = new Date().toISOString()
      state.currentRunId = null
      state.currentAccountId = null
      state.currentProgress = null
      phase('finished')
      const eligible = counts.completed + counts.failed
      state.summary = {
        ...counts,
        eligible,
        status: eligible === 0 ? 'failed' : counts.failed === 0 ? 'completed' : 'partial',
      }
      state.onProgress?.({ phase: 'batch_finished', summary: state.summary })
      logger?.warn?.(`wx batch ${state.batchId}: ${JSON.stringify(state.summary)}`)
    },
  }
}

function safeReason(error) {
  const code = error && typeof error.code === 'string' ? error.code : null
  if (code) return code
  const name = error && typeof error.name === 'string' ? error.name : 'collect_error'
  return name.slice(0, 64)
}

export { browserStatus, sleep }
