// 本地真实 E2E 驱动（开发者工具，不随发布产物打包）。
//
// 用途：用**设备端**真实代码（系统 Chrome + Playwright 驱动 + 采集 + 入库编排）跑通
// 「会话 → 分页 → 单稿/热词 → 分批入库 → 查询」，其中 tools 指的是本地运行的服务
// （尚未部署公共网关时不走 https://ixicai.cn/mcp）。
//
// 凭证边界：storage_state 路径由环境变量传入（设备本地文件），脚本**不读取、不打印**
// 其内容；账号标识统一脱敏；输出只有计数、状态与稳定原因码。
//
// 用法：
//   DOUYIN_E2E_STORAGE_STATE=/path/to/state.json \
//   DOUYIN_E2E_TOOLS_URL=http://127.0.0.1:13110/mcp/douyin_operation \
//   node scripts/e2e-local.mjs
//
// 可选：
//   DOUYIN_E2E_STATE_DIR   设备端状态目录（默认 ~/.dofe/dsh-yootun-douyin-operation）
//   DOUYIN_E2E_MAX_PAGES   翻页上限（默认 1000）
//   DOUYIN_E2E_DAYS        批量分析窗口天数（默认 30）

import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { collectAccountProfile } from '../src/collector.js'
import { createIngestClient, ingestCollectedWorks } from '../src/ingest.js'
import { openHeadlessSession, runAccountCollection } from '../src/runner.js'
import { refreshSessionState } from '../src/session.js'
import { runStartIdempotencyKey } from '../src/tools-client.js'
import { paths, stateRoot, updateAccount } from '../src/state.js'
import { WORK_MANAGE_URL } from '../src/collector.js'

const STORAGE_STATE = process.env.DOUYIN_E2E_STORAGE_STATE
const TOOLS_URL = process.env.DOUYIN_E2E_TOOLS_URL || 'http://127.0.0.1:13110/mcp/douyin_operation'
const ROOT = process.env.DOUYIN_E2E_STATE_DIR || stateRoot()
const MAX_PAGES = Number(process.env.DOUYIN_E2E_MAX_PAGES || 1000)
const DAYS = Number(process.env.DOUYIN_E2E_DAYS || 30)

if (!STORAGE_STATE) {
  console.error('DOUYIN_E2E_STORAGE_STATE is required (device-local storage_state path)')
  process.exit(2)
}

const redact = value => (value ? `${String(value).slice(0, 8)}…` : null)

/** 极简 MCP 客户端：POST JSON-RPC，解析 structuredContent（tools 使用 json_response）。 */
function createMcpClient(url) {
  return async function callTool(name, args, { id = 0 } = {}) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    })
    if (!response.ok) throw new Error(`mcp_http_${response.status}`)
    const payload = await response.json()
    const result = payload.result
    if (!result) throw new Error('mcp_no_result')
    if (result.structuredContent && typeof result.structuredContent === 'object') {
      return result.structuredContent
    }
    const text = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('')
    if (!text) return {}
    const parsed = JSON.parse(text)
    if (parsed && parsed.error && parsed.error.code) {
      const error = new Error(parsed.error.code)
      error.code = parsed.error.code
      throw error
    }
    return parsed
  }
}

async function initialize(url) {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'douyin-e2e', version: '1' } },
    }),
  })
}

const report = { steps: [], notes: [] }
const step = (name, detail) => {
  report.steps.push({ name, ...detail })
  console.log(`[step] ${name}:`, JSON.stringify(detail))
}

// 1) 设备端会话：就位 + 探测（会话有效性只在设备端判定）
await mkdir(paths(ROOT).storageStateDir, { recursive: true, mode: 0o700 })
const staging = join(ROOT, 'e2e-staging.storage_state.json')
await copyFile(STORAGE_STATE, staging)
step('storage_state_ready', { deviceLocal: true, bytes: '<redacted>' })

const session = await openHeadlessSession({ storageStatePath: staging })
let accountId = null
try {
  const page = await session.context.newPage()
  await page.goto(WORK_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(4000)
  const profile = await collectAccountProfile(page)
  accountId = profile && profile.accountId ? profile.accountId : null
  step('device_profile', { accountId: redact(accountId), nickname: profile ? profile.nickname : null, fanCount: profile ? profile.fanCount : null })
} finally {
  await session.context.close().catch(() => {})
  await session.browser.close().catch(() => {})
}
if (!accountId) {
  console.error('device session unusable: account id not resolved')
  process.exit(3)
}

// 会话文件落到正式账号 ID 名下（设备端布局），并做一次设备端探测
await copyFile(STORAGE_STATE, paths(ROOT).storageStatePath(accountId))
await updateAccount(accountId, { nickname: null }, ROOT)
const sessionState = await refreshSessionState({ accountId, root: ROOT })
step('session_probe', { sessionStatus: sessionState.sessionStatus, sessionSeq: sessionState.sessionSeq, reason: sessionState.reason })

await initialize(TOOLS_URL)
const callTool = createMcpClient(TOOLS_URL)

// 2) 账号登记 + 会话状态上报（tools 只收到 vault:// 引用与状态）
await callTool('douyin_account_save', {
  accountId,
  sessionRef: `vault://douyin/${accountId}`,
  idempotencyKey: `douyin:account:${accountId}:${Date.now()}`,
})
const reported = await callTool('douyin_session_status_report', {
  accountId,
  sessionStatus: sessionState.sessionStatus,
  sessionSeq: sessionState.sessionSeq,
  checkedAt: sessionState.checkedAt,
  sessionRef: `vault://douyin/${accountId}`,
  idempotencyKey: `douyin:session:${accountId}:${sessionState.sessionSeq}`,
})
step('session_reported', { applied: reported.applied === true })

// 3) 完整采集 + 分批入库
const progress = []
const result = await runAccountCollection({
  accountId,
  callTool,
  root: ROOT,
  storageStatePath: paths(ROOT).storageStatePath(accountId),
  maxPages: MAX_PAGES,
  days: DAYS,
  newAttempt: true,
  onProgress: event => progress.push(event),
})
step('collection', {
  status: result.status,
  reason: result.reason || null,
  runId: redact(result.runId),
  runStatus: result.runStatus || null,
  listComplete: result.listComplete,
  listReason: result.listReason || null,
  pages: result.pages,
  expectedWorkCount: result.expectedWorkCount,
  succeededWorkCount: result.succeededWorkCount,
  failedWorkCount: result.failedWorkCount,
  workFailures: (result.workFailures || []).length,
})
step('batch_progress', {
  batches: progress
    .filter(event => event.phase === 'batch_done' || event.phase === 'batch_failed')
    .map(event => ({ batchNo: event.batchNo, phase: event.phase, status: event.status || null, succeeded: event.succeeded ?? null, failed: event.failed ?? null, error: event.error || null })),
})

// 4) 查询：作品列表 + 全字段 + 趋势 + 导出
const list = await callTool('douyin_work_list', { accountId })
const works = list.works || []
const withGap = works.filter(work => work.data_gap && Object.keys(work.data_gap).length)
const complete = works.filter(work => !work.data_gap || !Object.keys(work.data_gap).length)
const high = works.slice().sort((a, b) => (b.play_count || 0) - (a.play_count || 0))[0]
const low = works.filter(work => (work.play_count || 0) < 100).sort((a, b) => (a.play_count || 0) - (b.play_count || 0))[0]
step('work_list', { total: works.length, withDataGap: withGap.length, fullyComplete: complete.length })

const detailTargets = [high, low].filter(Boolean)
for (const work of detailTargets) {
  const detail = await callTool('douyin_work_get', { accountId, workId: work.work_id })
  const current = detail.work || {}
  step('work_get', {
    workId: redact(work.work_id),
    playCount: current.play_count,
    completionRatePct: current.completion_rate_pct,
    completionRate5sPct: current.completion_rate_5s_pct,
    bounceRate2sPct: current.bounce_rate_2s_pct,
    avgWatchDurationS: current.avg_watch_duration_s,
    followerPlayRatioPct: current.follower_play_ratio_pct,
    trafficSources: (current.traffic_source || []).length,
    searchKeywords: (current.search_keywords || []).length,
    progressCurvePoints: current.progress_analysis ? (current.progress_analysis.drag_back_curve || []).length + (current.progress_analysis.drag_forward_curve || []).length : 0,
    audienceGender: detail.audience ? (detail.audience.gender || []).length : 0,
    audienceAge: detail.audience ? (detail.audience.age || []).length : 0,
    audienceProvince: detail.audience ? (detail.audience.province || []).length : 0,
    audienceCityLevel: detail.audience ? (detail.audience.city_level || []).length : 0,
    hotwords: (detail.hotwords || []).length,
    gapReasonForCompletion: current.data_gap && current.data_gap.completion_rate_pct ? current.data_gap.completion_rate_pct.reason : null,
  })
}

if (high) {
  const trend = await callTool('douyin_work_trend', { accountId, workId: high.work_id })
  step('work_trend', { snapshots: trend.total })
}
const exported = await callTool('douyin_export', { accountId, format: 'csv' })
step('export', { rowCount: exported.row_count })

// 5) 幂等与恢复：重复投递同一批（账本去重）+ 心跳 + 重复 run_start
const duplicateRun = await callTool('douyin_collect_run_start', {
  accountId,
  idempotencyKey: runStartIdempotencyKey(`e2e-dup-${Date.now()}`),
})
const duplicateRunId = duplicateRun.run.run_id
await callTool('douyin_collect_run_set_list_meta', {
  runId: duplicateRunId,
  expectedWorkCount: 1,
  listComplete: true,
  idempotencyKey: `douyin:list_meta:${duplicateRunId}`,
})
const batchArgs = {
  runId: duplicateRunId,
  accountId,
  batchNo: 1,
  works: works.length ? [{ work_id: works[0].work_id, title: works[0].title || null, play_count: works[0].play_count }] : [{ work_id: 'e2e-placeholder', title: 'e2e' }],
  idempotencyKey: `douyin:ingest:${duplicateRunId}:1`,
}
const firstBatch = await callTool('douyin_collect_ingest_batch', batchArgs)
const secondBatch = await callTool('douyin_collect_ingest_batch', batchArgs)
step('duplicate_batch', { firstReplayed: firstBatch.replayed === true, secondReplayed: secondBatch.replayed === true })
const heartbeat = await callTool('douyin_collect_run_heartbeat', {
  runId: duplicateRunId,
  heartbeatSeq: 1,
  idempotencyKey: `douyin:heartbeat:${duplicateRunId}:1`,
})
step('heartbeat', { applied: heartbeat.applied === true, lastHeartbeatSeq: heartbeat.run ? heartbeat.run.last_heartbeat_seq : null })
await callTool('douyin_collect_run_cancel', { runId: duplicateRunId, idempotencyKey: `douyin:run_cancel:${duplicateRunId}` })
const finishAfterCancel = await callTool('douyin_collect_run_finish', {
  runId: duplicateRunId,
  clientStatus: 'completed',
  idempotencyKey: `douyin:run_finish:${duplicateRunId}`,
})
step('cancel_no_upgrade', { status: finishAfterCancel.run.status, replayed: finishAfterCancel.replayed === true })

const runGet = await callTool('douyin_collect_run_get', { runId: result.runId })
step('run_get', { status: runGet.run.status, ingestedWorkCount: runGet.run.ingested_work_count, batches: (runGet.batches || []).length })

// 6) 清单回归（脱敏 fixture）在单元测试中执行：node --test
step('summary', {
  accountId: redact(accountId),
  listComplete: result.listComplete,
  works: works.length,
  complete,
  partial: withGap.length,
  ingested: result.succeededWorkCount,
  runStatus: runGet.run.status,
})
console.log('[e2e] done')
