// 一次完整采集的执行器：本地会话 → 无头系统 Chrome → 采集 → 分批入库。
//
// 设备端职责（docs/0909/douyin §7）：
// 1. 会话可用性由设备端判定（tools 读不到本地 vault）；
// 2. 采集在页面上下文完成（a-bogus 由页面生成），CI/tools 不参与浏览器；
// 3. 入库走 tools MCP：run_start → set_list_meta → ingest_batch → run_finish。
// 任一步失败都产生可展示的稳定原因码，不把原始传输错误抛给页面。

import { access } from 'node:fs/promises'

import { LAUNCH_ARGS, loadPlaywrightDriver, resolveSystemChrome } from './chrome.js'
import { collectAccountWorks } from './collector.js'
import { createIngestClient, ingestCollectedWorks } from './ingest.js'
import { hasStorageState, stateRoot } from './state.js'

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
}) {
  const emit = event => { if (onProgress) onProgress(event) }
  // 会话文件必须真实存在：失效（过期）的会话文件仍存在，其有效性由设备端探测判定。
  if (!storageStatePath || !(await fileExists(storageStatePath))) {
    return { status: 'session_required', reason: 'storage_state_missing' }
  }

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
    return { status: 'collect_failed', reason: safeReason(error), heartbeatSeq: client.heartbeatSeq }
  } finally {
    if (session) {
      await session.context.close().catch(() => {})
      await session.browser.close().catch(() => {})
    }
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
