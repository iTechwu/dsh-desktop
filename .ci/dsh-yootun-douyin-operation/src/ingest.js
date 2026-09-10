// 分批入库与运行恢复（设备端编排）。
//
// 调用序列（docs/0909/douyin §9）：run_start → run_set_list_meta → ingest_batch(≤50/批)
// → run_finish；异常时 run_cancel 兜底。
//
// 心跳：`heartbeat()` 已按 tools 契约实现，但 **V1 采集流程未启用周期性心跳**，
// 编排循环不会自动调用它。租约续期完全依赖 `ingest_batch`（每批写入都会刷新 run 租约），
// 因此只要批与批之间不超过租约 TTL 就不会被回收；将来若需要短租约或长间隔批次，
// 再把 `heartbeat()` 接进编排循环。
//
// 幂等与恢复契约：
// - `runAttemptId` 每次用户点击采集新生成并持久化；网络重试/进程恢复复用同一 UUID，
//   避免幂等层返回历史终态 run；
// - 批次幂等键固定为 `douyin:ingest:{runId}:{batchNo}`，因此**重投同一批是安全的**
//   （服务端以 (run_id, batch_no) 账本去重）；
// - 瞬时错误指数退避重试；确定性业务错误不重试；
// - 租约过期 / 运行被回收（RUN_NOT_RUNNING）→ 重新 run_start 并重发列表元信息后续采。

import { randomUUID } from 'node:crypto'

import { getAccount, updateAccount } from './state.js'
import {
  heartbeatIdempotencyKey,
  ingestIdempotencyKey,
  listMetaIdempotencyKey,
  runCancelIdempotencyKey,
  runFinishIdempotencyKey,
  runStartIdempotencyKey,
} from './tools-client.js'

export const BATCH_SIZE = 50
export const MAX_BATCH_NO = 100000
export const DEFAULT_RETRIES = 3

// 不退避重试的确定性错误（重试也不会变好，反而放大）。
const DETERMINISTIC_ERRORS = new Set([
  'RUN_ACCOUNT_MISMATCH',
  'RUN_LIST_META_REQUIRED',
  'HEARTBEAT_SEQ_REGRESSED',
  'INVALID_IDEMPOTENCY_KEY',
  'CONFIRMATION_REQUIRED',
  'VALIDATION_ERROR',
  'ACCOUNT_NOT_FOUND',
  'UNAUTHORIZED',
  'PAYLOAD_TOO_LARGE',
  'DOUYIN_TOOL_UNAVAILABLE',
])

// 需要重建运行的错误：租约过期/被回收/运行不存在。
const RECOVERABLE_ERRORS = new Set(['RUN_NOT_RUNNING', 'RUN_NOT_FOUND'])

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 设备端入库编排器。
 *
 * @param {{
 *   callTool: (name: string, args: object) => Promise<object>,
 *   accountId: string,
 *   root?: string,
 *   retries?: number,
 *   batchSize?: number,
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
  batchSize = BATCH_SIZE,
  sleep: sleepImpl = sleep,
  onProgress = null,
  logger = null,
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > BATCH_SIZE) {
    throw new Error('batch_size_out_of_range')
  }
  let runId = null
  let runAttemptId = null
  let heartbeatSeq = 0
  let listMeta = null

  let progressHandler = onProgress
  const emit = event => { if (progressHandler) progressHandler(event) }

  /** 读取本地持久化的运行尝试号：同一"用户点击"内重试与恢复必须复用。 */
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
   * 建立（或复用）运行。
   *
   * @param {{ newAttempt?: boolean }} [options] 用户每次新点击采集传 true → 生成新 UUID；
   *   网络重试/进程恢复传 false（默认）→ 复用已持久化的 UUID。
   */
  async function startRun({ newAttempt = false } = {}) {
    let attemptId = newAttempt ? null : await loadAttempt()
    if (!attemptId) attemptId = randomUUID()
    runAttemptId = attemptId
    const result = await callTool('douyin_collect_run_start', {
      accountId,
      idempotencyKey: runStartIdempotencyKey(attemptId),
    })
    const run = result && result.run ? result.run : {}
    runId = run.run_id || null
    heartbeatSeq = Number(run.last_heartbeat_seq || 0)
    await persistAttempt(attemptId, runId, heartbeatSeq)
    listMeta = null
    emit({ phase: 'run_started', runId, reused: Boolean(result && result.reused), reclaimedRunId: (result && result.reclaimedRunId) || null })
    return { run, reused: Boolean(result && result.reused), reclaimedRunId: (result && result.reclaimedRunId) || null }
  }

  /** 分页结束后写入列表元信息（幂等键固定为 runId）。 */
  async function publishListMeta({ expectedWorkCount, listComplete }) {
    if (!runId) throw new Error('run_not_started')
    const result = await callTool('douyin_collect_run_set_list_meta', {
      runId,
      expectedWorkCount,
      listComplete,
      idempotencyKey: listMetaIdempotencyKey(runId),
    })
    listMeta = { expectedWorkCount, listComplete }
    emit({ phase: 'list_meta', expectedWorkCount, listComplete })
    return result
  }

  /**
   * 心跳：序号单调递增并持久化；相同序号重试幂等，序号回退会被服务端拒绝
   * （HEARTBEAT_SEQ_REGRESSED 属确定性错误，不再重试，由上层决定是否重建运行）。
   *
   * 注意：V1 编排**不调用**本方法（见文件头注释），租约续期由 `ingest_batch` 承担。
   * 保留它是为了将来切换短租约时无需改动 tools 侧契约，并已由 ingest 测试覆盖。
   */
  async function heartbeat() {
    if (!runId) throw new Error('run_not_started')
    heartbeatSeq += 1
    await persistAttempt(runAttemptId, runId, heartbeatSeq)
    return callTool('douyin_collect_run_heartbeat', {
      runId,
      heartbeatSeq,
      idempotencyKey: heartbeatIdempotencyKey(runId, heartbeatSeq),
    })
  }

  /**
   * 分批写入全部作品。
   *
   * 单作品失败由服务端记入 failed_work_ids 并继续（不阻塞整批）；批次级失败指数退避重试，
   * 重试使用同一 (runId, batchNo) 幂等键，服务端账本保证不重复写入与重复计数。
   */
  async function ingestAll(works, { observedCount = works.length } = {}) {
    if (!runId) throw new Error('run_not_started')
    const batches = []
    for (let index = 0; index < works.length; index += batchSize) {
      batches.push(works.slice(index, index + batchSize))
    }
    const succeeded = new Set()
    const failed = new Set()
    const batchResults = []

    for (let index = 0; index < batches.length; index += 1) {
      const batchNo = index + 1
      if (batchNo > MAX_BATCH_NO) throw new Error('batch_no_out_of_range')
      const batch = batches[index]
      let result = null
      try {
        result = await withRetry(
          () => callTool('douyin_collect_ingest_batch', {
            runId,
            accountId,
            batchNo,
            works: batch,
            idempotencyKey: ingestIdempotencyKey(runId, batchNo),
          }),
          { onRecover: recoverRun, label: `batch ${batchNo}` },
        )
      } catch (error) {
        // 批次最终失败：记录并把该批作品计入 failed（不中断其余批次）。
        for (const work of batch) failed.add(work.work_id)
        batchResults.push({ batchNo, status: 'failed', error: safeCode(error) })
        emit({ phase: 'batch_failed', batchNo, totalBatches: batches.length, error: safeCode(error) })
        continue
      }
      const payload = result && result.batch ? result.batch : {}
      for (const workId of payload.succeeded_work_ids || []) { succeeded.add(workId); failed.delete(workId) }
      for (const workId of payload.failed_work_ids || []) failed.add(workId)
      batchResults.push({
        batchNo,
        status: payload.status || 'completed',
        replayed: Boolean(result && result.replayed),
        failedWorkIds: payload.failed_work_ids || [],
      })
      emit({
        phase: 'batch_done',
        batchNo,
        totalBatches: batches.length,
        status: payload.status || 'completed',
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

  /** 结束运行；服务端按账本结算终态（客户端状态仅供参考）。 */
  async function finish({ clientStatus = 'completed', clientCounts = null } = {}) {
    if (!runId) throw new Error('run_not_started')
    const result = await withRetry(
      () => callTool('douyin_collect_run_finish', {
        runId,
        clientStatus,
        clientCounts: clientCounts || undefined,
        idempotencyKey: runFinishIdempotencyKey(runId),
      }),
      { label: 'run_finish' },
    )
    emit({ phase: 'finished', status: result && result.run ? result.run.status : null, replayed: Boolean(result && result.replayed) })
    return result
  }

  /** 幂等终止（UI「强制结束并重新采集」）；此后可 startRun({ newAttempt: true })。 */
  async function cancel() {
    if (!runId) throw new Error('run_not_started')
    const result = await callTool('douyin_collect_run_cancel', {
      runId,
      idempotencyKey: runCancelIdempotencyKey(runId),
    })
    emit({ phase: 'cancelled', runId })
    return result
  }

  /** 租约过期/运行被回收后的恢复：新建 run 并重发列表元信息，后续批次沿用新 runId。 */
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
          logger?.warn?.(`douyin ingest ${label}: ${code} → recovering run`)
          await onRecover()
          continue
        }
        attempt += 1
        if (attempt > retries) throw error
        const delay = Math.min(8000, 500 * 2 ** (attempt - 1))
        logger?.warn?.(`douyin ingest ${label}: ${code} → retry ${attempt} in ${delay}ms`)
        await sleepImpl(delay)
      }
    }
  }

  return {
    /** 动态挂载进度回调（编排层在整条采集流程开始时注入）。 */
    setProgress(handler) { progressHandler = handler || null },
    startRun,
    publishListMeta,
    ingestAll,
    heartbeat,
    finish,
    cancel,
    recoverRun,
    get runId() { return runId },
    get heartbeatSeq() { return heartbeatSeq },
  }
}

/**
 * 一次完整采集的入库编排：run_start → set_list_meta → 分批 → run_finish。
 *
 * @param {{ works: object[], listComplete: boolean, expectedWorkCount?: number }} collected
 * @returns {Promise<{ runId: string, ingest: object, finish: object|null, error: string|null }>}
 */
export async function ingestCollectedWorks({
  client,
  works,
  listComplete,
  expectedWorkCount = works.length,
  newAttempt = true,
  onProgress = null,
}) {
  // 事件统一由 client 发出：把编排层的回调挂到 client 上，避免两套事件源。
  if (onProgress && typeof client.setProgress === 'function') client.setProgress(onProgress)
  const emit = event => { if (onProgress) onProgress(event) }
  const started = await client.startRun({ newAttempt })
  const runId = started.run.run_id
  try {
    await client.publishListMeta({ expectedWorkCount, listComplete })
  } catch (error) {
    // 列表元信息写入失败：不得进入结算（服务端也会以 RUN_LIST_META_REQUIRED 拒绝）。
    emit({ phase: 'list_meta_failed', error: safeCode(error) })
    return { runId, ingest: null, finish: null, error: safeCode(error) }
  }
  const ingest = works.length
    ? await client.ingestAll(works, { observedCount: expectedWorkCount })
    : { runId, batches: [], succeededWorkIds: [], failedWorkIds: [] }
  const clientStatus = resolveClientStatus({ listComplete, expected: expectedWorkCount, ingest })
  const finish = await client.finish({
    clientStatus,
    clientCounts: {
      expectedWorkCount,
      succeededWorkCount: ingest.succeededWorkIds.length,
      failedWorkCount: ingest.failedWorkIds.length,
    },
  })
  return { runId, ingest, finish, error: null }
}

/** 客户端上报状态仅作参考：服务端以账本重算，冲突时以服务端为准。 */
export function resolveClientStatus({ listComplete, expected, ingest }) {
  const succeeded = new Set(ingest.succeededWorkIds).size
  if (!listComplete) return 'partial'
  if (succeeded === expected) return 'completed'
  if (expected > 0 && succeeded === 0) return 'failed'
  return 'partial'
}

function safeCode(error) {
  if (error && typeof error.code === 'string' && error.code) return error.code
  if (error && typeof error.name === 'string') return error.name.slice(0, 64)
  return 'douyin_operation_request_failed'
}
