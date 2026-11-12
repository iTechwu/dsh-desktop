// 分批入库与运行恢复（设备端编排，与抖音工作台同构）。
//
// 调用序列（开发实施文档 §8.4/§15）：run_start（runId 设备端 UUID）→ run_set_list_meta
// → ingest_works（§15.1.2 切批：≤20 作品/批、≤3000 日行/批）→ ingest_account_metrics /
// ingest_fans_trend / ingest_fans_profile → run_finish；异常时 run_cancel 兜底。
//
// 幂等与恢复契约：
// - runAttemptId 每次用户点击采集新生成并持久化；网络重试/进程恢复复用同一 UUID；
// - works 批次幂等键 `wx_channels:ingest_works:{runId}:{batchNo}`——重投同一批安全，
//   服务端以 (run_id, batch_no) 账本去重；带失败对象的批次同号重试会真实重做（§16.4）；
// - 账号级三类批次号由服务端分配，幂等键嵌 runId+窗口；数据幂等由 (account_id, day)
//   upsert 承载；
// - 瞬时错误指数退避重试；确定性业务错误不重试；
// - 租约过期 / 运行被回收（RUN_NOT_RUNNING）→ 重新 run_start 并重发列表元信息后续采。

import { randomUUID } from 'node:crypto'

import { splitIngestBatches } from './collector.js'
import { stableErrorCode } from './tools-client.js'
import { getAccount, updateAccount } from './state.js'
import {
  heartbeatIdempotencyKey,
  ingestAccountMetricsIdempotencyKey,
  ingestFansProfileIdempotencyKey,
  ingestFansTrendIdempotencyKey,
  ingestWorksIdempotencyKey,
  listMetaIdempotencyKey,
  runCancelIdempotencyKey,
  runFinishIdempotencyKey,
  runStartIdempotencyKey,
} from './tools-client.js'

export const DEFAULT_RETRIES = 3
// 带失败对象的批次同号重投次数（§16.4；服务端删旧行真实重做）。
export const FAILED_BATCH_RETRIES = 2

// 不退避重试的确定性错误（重试也不会变好，反而放大）。
const DETERMINISTIC_ERRORS = new Set([
  'RUN_ACCOUNT_MISMATCH',
  'RUN_LIST_META_REQUIRED',
  'HEARTBEAT_SEQ_REGRESSED',
  'INVALID_IDEMPOTENCY_KEY',
  'CONFIRMATION_REQUIRED',
  'LOCAL_CLEARED_REQUIRED',
  'VALIDATION_ERROR',
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_NOT_ACCESSIBLE',
  'UNAUTHORIZED',
  'PAYLOAD_TOO_LARGE',
  'INVALID_DAY_RANGE',
  'WX_TOOL_UNAVAILABLE',
])

// 需要重建运行的错误：租约过期/被回收/运行不存在。
const RECOVERABLE_ERRORS = new Set(['RUN_NOT_RUNNING', 'RUN_NOT_FOUND'])

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 设备端入库编排器（wx 版）。
 *
 * @param {{
 *   callTool: (name: string, args: object) => Promise<object>,
 *   accountId: string,
 *   root?: string,
 *   retries?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   onProgress?: (event: object) => void,
 *   logger?: { warn?: Function },
 * }} options
 */
export function createIngestClient({
  callTool,
  accountId,
  root,
  retries = DEFAULT_RETRIES,
  sleep: sleepImpl = sleep,
  onProgress = null,
  logger = null,
}) {
  let runId = null
  let runAttemptId = null
  let heartbeatSeq = 0
  let listMeta = null
  // attempt → runId 同进程内映射：同一「用户点击」内重试复用同一 runId；进程重启后
  // 由服务端 reused 裁决（新 runId 请求会拿到未过期旧 run）。
  const runIdByAttempt = new Map()

  let progressHandler = onProgress
  const emit = event => { if (progressHandler) progressHandler(event) }

  async function loadAttempt() {
    const record = await getAccount(accountId, root)
    return record && record.runAttemptId ? record.runAttemptId : null
  }

  async function persistAttempt(attemptId, newRunId, seq) {
    const patch = { runAttemptId: attemptId, runId: newRunId }
    if (seq !== undefined && seq !== null) patch.heartbeatSeq = Number(seq)
    await updateAccount(accountId, patch, root)
  }

  /**
   * 建立（或复用）运行。runId 由设备端 UUID 生成（§16.3）；同账号已有未过期
   * running run（不同 runId）时服务端返回现有 run（reused）。
   */
  async function startRun({ newAttempt = false } = {}) {
    let attemptId = newAttempt ? null : await loadAttempt()
    if (!attemptId) attemptId = randomUUID()
    runAttemptId = attemptId
    // runId 是服务端 run 表主键：同一 attempt 复用同一 runId（重试/恢复安全）。
    let nextRunId = runIdByAttempt.get(attemptId)
    if (!nextRunId || newAttempt) {
      nextRunId = randomUUID()
      runIdByAttempt.set(attemptId, nextRunId)
    }
    const result = await callTool('wx_channels_collect_run_start', {
      accountId,
      runId: nextRunId,
      // 幂等键与服务端 suffix 模板一致：键段 == runId（tools server.py
      // require_idempotency_key_suffix(prefix, suffix=run_id)）。同 attempt 复用同
      // runId 即同键，重试安全；账号绑定由载荷 accountId 进 stable_request_hash。
      idempotencyKey: runStartIdempotencyKey(nextRunId),
    })
    const run = result && result.run ? result.run : {}
    runId = run.run_id || nextRunId
    heartbeatSeq = Number(run.heartbeat_seq || 0)
    await persistAttempt(attemptId, runId, heartbeatSeq)
    listMeta = null
    emit({
      phase: 'run_started',
      runId,
      reused: Boolean(result && result.reused),
      reclaimedRunId: (result && result.reclaimedRunId) || null,
    })
    return { run, reused: Boolean(result && result.reused), reclaimedRunId: (result && result.reclaimedRunId) || null }
  }

  /** 分页结束后写入列表元信息（幂等键固定为 runId）。 */
  async function publishListMeta({ expectedWorkCount, listComplete }) {
    if (!runId) throw new Error('run_not_started')
    const result = await callTool('wx_channels_collect_run_set_list_meta', {
      runId,
      expectedWorkCount,
      listComplete,
      idempotencyKey: listMetaIdempotencyKey(runId),
    })
    listMeta = { expectedWorkCount, listComplete }
    emit({ phase: 'list_meta', expectedWorkCount, listComplete })
    return result
  }

  /** 心跳：序号单调递增并持久化（V1 编排默认不调用，租约由 ingest 批次续期）。 */
  async function heartbeat() {
    if (!runId) throw new Error('run_not_started')
    heartbeatSeq += 1
    await persistAttempt(runAttemptId, runId, heartbeatSeq)
    return callTool('wx_channels_collect_run_heartbeat', {
      runId,
      heartbeatSeq,
      idempotencyKey: heartbeatIdempotencyKey(runId, heartbeatSeq),
    })
  }

  /**
   * 分批写入全部作品（§15.1.2 切分：发布日从旧到新、贪心装填、批次号连续递增）。
   *
   * 单作品失败由服务端记入 failedObjects 并继续；批次级失败指数退避重试（同一
   * 幂等键）；带失败对象的批次可同号重试（服务端删旧行真实重做，§16.4）。
   */
  async function ingestAll(works, { observedCount = works.length } = {}) {
    if (!runId) throw new Error('run_not_started')
    const batches = splitIngestBatches(works)
    const succeeded = new Set()
    const failed = new Set()
    const batchResults = []

    for (const batch of batches) {
      const { batchNo } = batch
      let result = null
      try {
        result = await withRetry(
          () => callTool('wx_channels_collect_ingest_works', {
            runId,
            batchNo,
            works: batch.works,
            totalDailyMetricRows: batch.totalDailyMetricRows,
            idempotencyKey: ingestWorksIdempotencyKey(runId, batchNo),
          }),
          { onRecover: recoverRun, label: `batch ${batchNo}` },
        )
      } catch (error) {
        // 批次级传输失败：该批在服务端**没有账本行**，不能计入客户端 failed——
        // finish 会按账本重算并与声明比对，多报会变成 RUN_COUNT_MISMATCH 把 run
        // 永远卡在 running（2026-11-12 审查 P1-4）。服务端会因 succeeded < expected
        // 自然结算 partial，语义正确。
        batchResults.push({ batchNo, status: 'failed', error: safeCode(error) })
        emit({ phase: 'batch_failed', batchNo, totalBatches: batches.length, error: safeCode(error) })
        continue
      }
      let payload = result && result.batch ? result.batch : {}
      // 带失败对象的批次：同 batchNo 重投，幂等键加 ``:retry{n}`` 后缀开启新收据，
      // 服务端删除旧失败账本行后真实重做（§15.1.2.6 / §16.4；审查 P1-3）。
      for (let attempt = 1; attempt <= FAILED_BATCH_RETRIES; attempt += 1) {
        const failedNow = Array.isArray(payload.failed_objects) ? payload.failed_objects.length : 0
        if (!failedNow) break
        emit({ phase: 'batch_retry', batchNo, attempt, failedObjects: failedNow })
        try {
          result = await withRetry(
            () => callTool('wx_channels_collect_ingest_works', {
              runId,
              batchNo,
              works: batch.works,
              totalDailyMetricRows: batch.totalDailyMetricRows,
              idempotencyKey: `${ingestWorksIdempotencyKey(runId, batchNo)}:retry${attempt}`,
            }),
            { onRecover: recoverRun, label: `batch ${batchNo} retry ${attempt}` },
          )
          payload = result && result.batch ? result.batch : {}
        } catch (retryError) {
          emit({ phase: 'batch_retry_failed', batchNo, attempt, error: safeCode(retryError) })
          break
        }
      }
      for (const workId of payload.succeeded_objects || []) { succeeded.add(workId); failed.delete(workId) }
      for (const workId of payload.failed_objects || []) failed.add(workId)
      batchResults.push({
        batchNo,
        status: payload.batch_status || 'succeeded',
        replayed: Boolean(result && result.replayed),
        failedObjects: payload.failed_objects || [],
      })
      emit({
        phase: 'batch_done',
        batchNo,
        totalBatches: batches.length,
        status: payload.batch_status || 'succeeded',
        succeeded: succeeded.size,
        failed: failed.size,
        expected: observedCount,
      })
    }

    return {
      runId,
      batches: batchResults,
      succeededWorkIds: [...succeeded],
      failedWorkIds: [...failed],
    }
  }

  /** 账号级全部视频聚合入库（批次号服务端分配；幂等键嵌窗口）。
   *
   * ``trafficSource`` 是窗口聚合（官方只给整窗分布）：挂到窗口末日行，其余行为 NULL
   *（此前只发 rows，导致 ``wx_channels_account_metric_daily.traffic_source`` 恒为空，
   * 2026-11-12 审查 P2-28）。
   */
  async function ingestAccountMetrics({ startDay, endDay, rows, trafficSource = null }) {
    if (!runId) throw new Error('run_not_started')
    if (!Array.isArray(rows) || rows.length === 0) {
      return { replayed: false, skipped: 'no_rows' }
    }
    let metrics = rows
    if (trafficSource && trafficSource.rows) {
      metrics = rows.map((row, index) => (
        index === rows.length - 1 ? { ...row, trafficSource } : row
      ))
    }
    return withRetry(
      () => callTool('wx_channels_collect_ingest_account_metrics', {
        runId,
        startDay,
        endDay,
        metrics,
        idempotencyKey: ingestAccountMetricsIdempotencyKey(runId, startDay, endDay),
      }),
      { onRecover: recoverRun, label: 'ingest_account_metrics' },
    )
  }

  /** 账号级关注者增长入库；``sourceTrend`` 按日挂载到 ``daily[].source_trend``。
   *
   * 此前只发 daily、从不发来源趋势，``wx_channels_fans_daily.source_trend`` 永远为
   * NULL（2026-11-12 审查 P2-2）。
   */
  async function ingestFansTrend({ startDay, endDay, rows, sourceTrend = null }) {
    if (!runId) throw new Error('run_not_started')
    if (!Array.isArray(rows) || rows.length === 0) {
      return { replayed: false, skipped: 'no_rows' }
    }
    const daily = attachFansSourceTrend(rows, sourceTrend)
    return withRetry(
      () => callTool('wx_channels_collect_ingest_fans_trend', {
        runId,
        startDay,
        endDay,
        daily,
        idempotencyKey: ingestFansTrendIdempotencyKey(runId, startDay, endDay),
      }),
      { onRecover: recoverRun, label: 'ingest_fans_trend' },
    )
  }

  /** 账号级关注者画像入库（day=latestCompletedDay）。 */
  async function ingestFansProfile(payload) {
    if (!runId) throw new Error('run_not_started')
    if (!payload || !payload.day) return { replayed: false, skipped: 'no_payload' }
    return withRetry(
      () => callTool('wx_channels_collect_ingest_fans_profile', {
        runId,
        day: payload.day,
        age: payload.age || undefined,
        gender: payload.gender || undefined,
        province: payload.province || undefined,
        city: payload.city || undefined,
        device: payload.device || undefined,
        dataGap: payload.dataGap && Object.keys(payload.dataGap).length ? payload.dataGap : undefined,
        idempotencyKey: ingestFansProfileIdempotencyKey(runId, payload.day),
      }),
      { onRecover: recoverRun, label: 'ingest_fans_profile' },
    )
  }

  /**
   * 结束运行：clientCounts 为嵌套对象（§16.3）；服务端按账本复核，不一致
   * RUN_COUNT_MISMATCH（确定性拒绝，不重试——修正计数后换新结算语义由 run 恢复承担）。
   */
  async function finish({ clientStatus = 'completed', clientCounts = null,
    accountMetricStatus = 'not_collected', fansTrendStatus = 'not_collected', fansProfileStatus = 'not_collected' } = {}) {
    if (!runId) throw new Error('run_not_started')
    const payload = {
      runId,
      clientStatus,
      idempotencyKey: runFinishIdempotencyKey(runId),
    }
    if (clientCounts !== null && clientCounts !== undefined) payload.clientCounts = clientCounts
    payload.accountMetricStatus = accountMetricStatus
    payload.fansTrendStatus = fansTrendStatus
    payload.fansProfileStatus = fansProfileStatus
    const result = await withRetry(
      () => callTool('wx_channels_collect_run_finish', payload),
      { label: 'run_finish' },
    )
    emit({ phase: 'finished', status: result && result.run ? result.run.status : null, replayed: Boolean(result && result.replayed) })
    return result
  }

  /** 幂等终止（异常兜底）；此后可 startRun({ newAttempt: true })。 */
  async function cancel() {
    if (!runId) throw new Error('run_not_started')
    const result = await callTool('wx_channels_collect_run_cancel', {
      runId,
      idempotencyKey: runCancelIdempotencyKey(runId),
    })
    emit({ phase: 'cancelled', runId })
    return result
  }

  /** 租约过期/运行被回收后的恢复：新建 run 并重发列表元信息。 */
  async function recoverRun() {
    const previousRunId = runId
    const previousMeta = listMeta
    await startRun({ newAttempt: true })
    if (previousMeta) await publishListMeta(previousMeta)
    emit({ phase: 'run_recovered', previousRunId, runId })
  }

  async function withRetry(operation, { onRecover = null, label = 'operation' } = {}) {
    let attempt = 0
    for (;;) {
      try {
        return await operation()
      } catch (error) {
        const code = safeCode(error)
        if (DETERMINISTIC_ERRORS.has(code)) throw error
        if (RECOVERABLE_ERRORS.has(code) && onRecover) {
          attempt += 1
          if (attempt > retries) throw error
          logger?.warn?.(`wx ingest ${label}: ${code} → recovering run`)
          await onRecover()
          continue
        }
        attempt += 1
        if (attempt > retries) throw error
        const delay = Math.min(8000, 500 * 2 ** (attempt - 1))
        logger?.warn?.(`wx ingest ${label}: ${code} → retry ${attempt} in ${delay}ms`)
        await sleepImpl(delay)
      }
    }
  }

  return {
    setProgress(handler) { progressHandler = handler || null },
    startRun,
    publishListMeta,
    ingestAll,
    ingestAccountMetrics,
    ingestFansTrend,
    ingestFansProfile,
    heartbeat,
    finish,
    cancel,
    recoverRun,
    get runId() { return runId },
    get heartbeatSeq() { return heartbeatSeq },
  }
}

/**
 * 一次完整采集的入库编排：run_start → set_list_meta → works 分批 → 账号级三类
 * → run_finish。账号级失败只记段落缺口（segment gap），不改变作品链路结算
 * （§6.7 规则 3：作品链路成功、账号级数据失败 → run partial，由 finish 段落状态表达）。
 */
export async function ingestCollectedData({
  client,
  works,
  listComplete,
  expectedWorkCount = works.length,
  newAttempt = true,
  onProgress = null,
  accountLevel = null,
}) {
  if (onProgress && typeof client.setProgress === 'function') client.setProgress(onProgress)
  const emit = event => { if (onProgress) onProgress(event) }
  const started = await client.startRun({ newAttempt })
  const runId = started.run.run_id
  try {
  try {
    await client.publishListMeta({ expectedWorkCount, listComplete })
  } catch (error) {
    emit({ phase: 'list_meta_failed', error: safeCode(error) })
    return { runId, ingest: null, finish: null, error: safeCode(error) }
  }
  const ingest = works.length
    ? await client.ingestAll(works, { observedCount: expectedWorkCount })
    : { runId, batches: [], succeededWorkIds: [], failedWorkIds: [] }

  // 账号级三类（尽力而为；失败 emit segment_gap，绝不覆盖已有数据为空白，§8.4）。
  const segmentStatus = { accountMetricStatus: 'not_collected', fansTrendStatus: 'not_collected', fansProfileStatus: 'not_collected' }
  if (accountLevel && typeof client.ingestAccountMetrics === 'function') {
    const { accountMetrics, fansTrend, fansProfile } = accountLevel
    if (accountMetrics && Array.isArray(accountMetrics.rows) && accountMetrics.rows.length) {
      try {
        await client.ingestAccountMetrics({
          startDay: accountMetrics.startDay,
          endDay: accountMetrics.endDay,
          rows: accountMetrics.rows,
          trafficSource: accountMetrics.trafficSource || null,
        })
        segmentStatus.accountMetricStatus = 'completed'
      } catch (error) {
        segmentStatus.accountMetricStatus = 'failed'
        emit({ phase: 'segment_gap', segment: 'account_metrics', reason: safeCode(error) })
      }
    }
    if (fansTrend && Array.isArray(fansTrend.daily) && fansTrend.daily.length) {
      // 按 30 行/块分块上报（MCP daily 上限 31），每块幂等键含块窗口，
      // 失败只标该块并继续后续块（局部重跑不重传已成功块）。采集起点为 2026-01-01
      // 后单账号约 315 行，分块逻辑保留为窗口变长时的防御。
      const rowsByDay = [...fansTrend.daily].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      const chunkSize = 30
      let failedChunks = 0
      for (let offset = 0; offset < rowsByDay.length; offset += chunkSize) {
        const chunk = rowsByDay.slice(offset, offset + chunkSize)
        try {
          await client.ingestFansTrend({
            startDay: chunk[0].day,
            endDay: chunk[chunk.length - 1].day,
            rows: chunk,
            sourceTrend: fansTrend.sourceTrend || null,
          })
        } catch (error) {
          failedChunks += 1
          emit({ phase: 'segment_gap', segment: 'fans_trend', reason: safeCode(error) })
        }
      }
      segmentStatus.fansTrendStatus = failedChunks ? 'failed' : 'completed'
    }
    if (fansProfile && fansProfile.day) {
      try {
        await client.ingestFansProfile(fansProfile)
        segmentStatus.fansProfileStatus = 'completed'
      } catch (error) {
        segmentStatus.fansProfileStatus = 'failed'
        emit({ phase: 'segment_gap', segment: 'fans_profile', reason: safeCode(error) })
      }
    }
  }

  const clientStatus = resolveClientStatus({ listComplete, expected: expectedWorkCount, ingest })
  const finish = await client.finish({
    clientStatus,
    clientCounts: {
      expectedWorkCount,
      succeededWorkCount: ingest.succeededWorkIds.length,
      failedWorkCount: ingest.failedWorkIds.length,
    },
    ...segmentStatus,
  })
  return { runId, ingest, finish, error: null }
  } catch (error) {
    // 异常兜底：把 run 显式取消，避免停在 running 等 120s 租约过期（审查 P2-14）。
    emit({ phase: 'run_cancel_on_error', error: safeCode(error) })
    try { await client.cancel() } catch { /* best-effort：取消失败仍上抛原始异常 */ }
    throw error
  }
}

/** 客户端上报状态仅作参考：服务端以账本重算并复核计数，冲突时以服务端为准。 */
export function resolveClientStatus({ listComplete, expected, ingest }) {
  const succeeded = new Set(ingest.succeededWorkIds).size
  if (!listComplete) return 'partial'
  if (succeeded === expected) return 'completed'
  if (expected > 0 && succeeded === 0) return 'failed'
  return 'partial'
}

/** 把聚合来源趋势（rows[].daily[]）按日挂到 ``daily[].source_trend``（P2-2）。 */
function attachFansSourceTrend(rows, sourceTrend) {
  const trendRows = sourceTrend && Array.isArray(sourceTrend.rows) ? sourceTrend.rows : []
  if (!trendRows.length) return rows
  const byDay = new Map()
  for (const row of trendRows) {
    for (const point of Array.isArray(row.daily) ? row.daily : []) {
      if (!point || !point.day) continue
      const list = byDay.get(point.day) || []
      list.push({
        sourceType: row.sourceType,
        sourceKey: row.sourceKey,
        name: row.name,
        add: point.add,
      })
      byDay.set(point.day, list)
    }
  }
  return rows.map(row => {
    const items = byDay.get(row.day)
    return items && items.length ? { ...row, sourceTrend: { rows: items } } : row
  })
}

function safeCode(error) {
  const stable = stableErrorCode(error)
  if (stable) return stable
  if (error && typeof error.name === 'string') return error.name.slice(0, 64)
  return 'wx_channels_operation_request_failed'
}
