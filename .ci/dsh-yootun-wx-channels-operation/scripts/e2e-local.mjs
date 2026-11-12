// 本地真实 E2E：复用插件采集模块 + 本地 tools 服务的 MCP 工具，从采集入库到查询。
//
// 前置：本地 tools 服务已启动（uvicorn tools_dofe.main:app --port 8000）、
// tools_dofe 库已迁移到 20261110_0088、存在可复用的视频号登录态 Chrome Profile。
//
// 用法：
//   node scripts/e2e-local.mjs [--profile-dir <path>] [--detail-limit 3]
//     [--account-days 30] [--fans-days 30] [--repeat-ingest]
//
// 口径：详情只抽样前 detail-limit 个作品（其余作品按当前值入库、dailyMetrics 为空），
// run 结算应为 completed（succeeded == expected）；账号级三类随编排入库；
// 重复入库（--repeat-ingest）验证不产生重复作品（E-09）。

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  LAUNCH_ARGS,
  resolveSystemChrome,
} from '../src/chrome.js'
import {
  ASSISTANT_ORIGIN,
  collectAccountMetrics,
  collectFansPortrait,
  collectFansTrend,
  collectWorkDetail,
  collectWorkList,
  fetchAuthData,
} from '../src/collector.js'
import { createIngestClient, ingestCollectedData } from '../src/ingest.js'
import { latestCompletedDay, shanghaiDayFromTs, shanghaiDayStartTs } from '../src/parse.js'
import { SessionInvalidError } from '../src/session-errors.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const flagOn = flag => process.argv.includes(flag)

const PROFILE_DIR = resolve(argValue('--profile-dir', join(homedir(), '.dofe', 'wx-channels-stage0', 'profile-live')))
const DETAIL_LIMIT = Number(argValue('--detail-limit', '3'))
const ACCOUNT_DAYS = Number(argValue('--account-days', '30'))
const FANS_DAYS = Number(argValue('--fans-days', '30'))
const REPEAT_INGEST = flagOn('--repeat-ingest')
const BASE_URL = argValue('--base-url', 'http://127.0.0.1:8000')
const MCP_URL = `${BASE_URL}/mcp/wx_channels_operation`

if (!existsSync(PROFILE_DIR)) {
  console.error(`[e2e] 登录态 Profile 不存在: ${PROFILE_DIR}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 本地 MCP client（JSON-RPC over HTTP，无 mcp__ 前缀）
// ---------------------------------------------------------------------------

let rpcId = 0
let sessionId = null

async function rpc(method, params) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) }),
  })
  const sid = response.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const text = await response.text()
  // streamable HTTP 可能返回 SSE 帧；取首个 data: 行。
  const jsonText = text.startsWith('data:') ? text.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim() : text
  const payload = JSON.parse(jsonText || text)
  if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`)
  return payload.result
}

async function callTool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args })
  if (result.isError) {
    const text = Array.isArray(result.content) ? result.content.map(item => item.text || '').join('') : ''
    throw new Error(`tool error: ${text.slice(0, 200)}`)
  }
  const structured = result.structuredContent
  if (structured && structured.error) throw new Error(`${structured.error.code}: ${structured.error.message || ''}`)
  return structured
}

// ---------------------------------------------------------------------------
// E2E 主流程
// ---------------------------------------------------------------------------

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const playwright = await import('playwright-core')
const chrome = await resolveSystemChrome()
console.log(`[e2e] 系统 Chrome: ${chrome.path}`)
console.log(`[e2e] 登录态 Profile: ${PROFILE_DIR}`)

// --login：先弹有头 Chrome 供扫码，读出 finderUsername 后关闭，再以 headless 继续。
if (flagOn('--login')) {
  console.log('[e2e] 弹出浏览器扫码登录（5 分钟内完成扫码并在手机确认）…')
  const loginContext = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    channel: chrome.channel,
    executablePath: chrome.path,
    headless: false,
    args: [...LAUNCH_ARGS],
  })
  const loginPage = loginContext.pages()[0] || (await loginContext.newPage())
  await loginPage.goto(ASSISTANT_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const deadline = Date.now() + 5 * 60 * 1000
  let loggedIn = null
  let lastDiag = 0
  while (Date.now() < deadline) {
    try {
      loggedIn = await fetchAuthData(loginPage, { finderId: '' })
      break
    } catch (error) {
      if (Date.now() - lastDiag > 10_000) {
        lastDiag = Date.now()
        const cookies = await loginContext.cookies().catch(() => [])
        const hits = cookies.filter(item => ['sessionid', 'wxuin'].includes(item.name)).map(item => item.name)
        console.log(`[e2e] 等待登录… url=${loginPage.url().slice(0, 60)} cookies=[${hits.join(',')}] lastError=${String(error.message || error).slice(0, 80)}`)
      }
      await sleep(2500)
    }
  }
  await loginContext.close().catch(() => {})
  if (!loggedIn) {
    console.error('[e2e] 扫码超时/失败，退出。')
    process.exit(2)
  }
  console.log(`[e2e] 扫码登录成功: ${loggedIn.accountId}（${loggedIn.nickname}）`)
}

const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
  channel: chrome.channel,
  executablePath: chrome.path,
  headless: true,
  args: [...LAUNCH_ARGS],
  viewport: { width: 1440, height: 900 },
})

try {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wx-e2e', version: '0' },
  })
  await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).catch(() => {})

  const page = context.pages()[0] || (await context.newPage())
  await page.goto(ASSISTANT_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  const TIMING = {}
  const t0 = Date.now()

  // 1) auth_data 探活（复用登录态）。
  let profile = null
  try {
    profile = await fetchAuthData(page, { finderId: '' })
  } catch (error) {
    if (error instanceof SessionInvalidError) {
      console.error('[e2e] 登录态已失效（SessionInvalidError）。请弹出浏览器重新扫码后重跑。')
      process.exit(2)
    }
    throw error
  }
  const accountId = profile.accountId
  console.log(`[e2e] 登录态有效: ${accountId}（${profile.nickname}，fans=${profile.fansCount}，feeds=${profile.feedsCount}）`)
  check('探活：auth_data 读出 finderUsername', Boolean(accountId))

  // 2) 账号登记 + 会话上报。
  await callTool('wx_channels_account_save', {
    accountId,
    ...(profile.nickname ? { nickname: profile.nickname } : {}),
    ...(profile.avatar ? { avatar: profile.avatar } : {}),
    ...(Number.isFinite(profile.fansCount) ? { followerTotalCount: profile.fansCount } : {}),
    ...(Number.isFinite(profile.feedsCount) ? { feedCount: profile.feedsCount } : {}),
    ...(profile.isMasterFinder !== null ? { isMasterFinder: profile.isMasterFinder } : {}),
    sessionRef: `vault://wx-channels/${accountId}`,
    idempotencyKey: `wx_channels:account_save:${accountId}:${Date.now()}`,
  })
  // seq 取远端最大值 +1（重跑不撞历史幂等收据；对齐 runner.floorSessionSeq 逻辑）。
  let nextSeq = 1
  try {
    const remote = await callTool('wx_channels_account_list', { accountId })
    const row = Array.isArray(remote.accounts) ? remote.accounts.find(item => item.account_id === accountId) : null
    if (row && Number(row.session_seq) > 0) nextSeq = Number(row.session_seq) + 1
  } catch { /* 远端读不到从 1 起 */ }
  await callTool('wx_channels_session_status_report', {
    accountId,
    sessionStatus: 'ok',
    sessionSeq: nextSeq,
    checkedAt: new Date().toISOString(),
    sessionRef: `vault://wx-channels/${accountId}`,
    idempotencyKey: `wx_channels:session:${accountId}:${nextSeq}`,
  })
  check('账号登记与会话上报', true)

  // 3) 全量作品列表。
  const listStart = Date.now()
  const list = await collectWorkList(page, { finderId: accountId, onPage: null })
  TIMING.listMs = Date.now() - listStart
  check(
    '窗口内列表：唯一作品数 == totalCount',
    list.listComplete && list.totalCount !== null && list.works.length === list.totalCount,
    `works=${list.works.length} totalCount=${list.totalCount} reason=${list.reason}`,
  )

  // 4) 详情抽样（前 DETAIL_LIMIT 个作品；其余当前值入库、dailyMetrics 为空）。
  const enriched = []
  let detailFailed = 0
  const detailStart = Date.now()
  for (let index = 0; index < list.works.length; index += 1) {
    const work = { ...list.works[index], dailyMetrics: [] }
    if (index < DETAIL_LIMIT) {
      try {
        const detail = await collectWorkDetail(page, { finderId: accountId, work, intervalMs: 200 })
        work.dailyMetrics = detail.dailyMetrics || []
        if (detail.retentionTrend) work.retentionTrend = detail.retentionTrend
        if (detail.trafficSource) work.trafficSource = detail.trafficSource
        enriched.push(work)
      } catch (error) {
        detailFailed += 1
        console.log(`[e2e] 详情失败（不入库）: ${work.workId} ${error.message}`)
      }
    } else {
      enriched.push(work)
    }
    if ((index + 1) % 10 === 0) console.log(`[e2e] 详情进度 ${index + 1}/${list.works.length}`)
  }
  check(
    '详情抽样：带按日序列的作品数 == 抽样上限',
    enriched.filter(work => work.dailyMetrics.length > 0).length === Math.min(DETAIL_LIMIT, list.works.length) - detailFailed,
    `detailFailed=${detailFailed}`,
  )
  TIMING.detailMs = Date.now() - detailStart

  // 5) 账号级三类。
  const endDay = latestCompletedDay()
  // 上海语义日算术（UTC toISOString 会提前一天，§15.1）。
  const startDay = shanghaiDayFromTs(shanghaiDayStartTs(endDay) - (ACCOUNT_DAYS - 1) * 86400)
  const fansStartDay = shanghaiDayFromTs(shanghaiDayStartTs(endDay) - (FANS_DAYS - 1) * 86400)
  const segStart = Date.now()
  const accountMetrics = await collectAccountMetrics(page, { finderId: accountId, startDay, endDay })
  TIMING.accountMetricsMs = Date.now() - segStart
  const fansTrendStart = Date.now()
  const fansTrend = await collectFansTrend(page, { finderId: accountId, startDay: fansStartDay, endDay })
  TIMING.fansTrendMs = Date.now() - fansTrendStart
  const portraitStart = Date.now()
  const fansPortrait = await collectFansPortrait(page, { finderId: accountId })
  TIMING.fansPortraitMs = Date.now() - portraitStart
  check('账号级聚合：日行数 == 窗口天数', accountMetrics.rows.length === ACCOUNT_DAYS, `rows=${accountMetrics.rows.length}`)
  check('关注者增长：日行数 == 窗口天数', fansTrend.daily.length === FANS_DAYS, `rows=${fansTrend.daily.length}`)
  check('关注者画像：快照日落最新完整日', fansPortrait.day === endDay, `day=${fansPortrait.day}`)

  // 6) 入库编排（本地 MCP 工具）。
  const client = createIngestClient({
    callTool: (name, args) => callTool(name, args),
    accountId,
  })
  const ingestStart = Date.now()
  const runId = `e2e-${randomUUID()}`
  // 直接指定 runId：createIngestClient 内部生成，这里通过 startRun 复用返回值。
  const started = await ingestCollectedData({
    client,
    works: enriched,
    listComplete: list.listComplete,
    expectedWorkCount: list.totalCount ?? enriched.length,
    newAttempt: true,
    onProgress: event => {
      if (event.phase === 'batch_done') console.log(`[e2e] 批次 ${event.batchNo}/${event.totalBatches}: succeeded=${event.succeeded}`)
      if (event.phase === 'segment_gap') console.log(`[e2e] 段落缺口: ${event.segment} ${event.reason}`)
    },
    accountLevel: { accountMetrics, fansTrend, fansProfile: fansPortrait },
  })
  TIMING.ingestMs = Date.now() - ingestStart
  TIMING.totalMs = Date.now() - t0
  check('入库编排：无错误', started.error === null, started.error || '')
  const finishStatus = started.finish && started.finish.run ? started.finish.run.status : null
  check('run 结算：completed', finishStatus === 'completed', `status=${finishStatus}`)

  // 7) 查询验证。
  const workList = await callTool('wx_channels_work_list', { accountId })
  check(
    'work_list：数量 == totalCount',
    workList.works.length === list.totalCount,
    `works=${workList.works.length} total=${workList.total}`,
  )
  // 从服务端 work_list 返回取对象（round-trip 形状，贴近真实 UI 消费路径）。
  const serverSample = (workList.works || []).find(work => work.work_id)
  if (serverSample) {
    const detail = await callTool('wx_channels_work_get', { accountId, workId: serverSample.work_id })
    check(
      'work_get：按日快照入库',
      Array.isArray(detail.daily_metrics),
      `snapshots=${(detail.daily_metrics || []).length}`,
    )
    check(
      'work_get：留存/来源/缺口',
      Boolean(detail.work) && 'retention_trend' in detail.work && 'traffic_source' in detail.work && 'data_gap' in detail.work,
      `gaps=${detail.work.data_gap ? Object.keys(detail.work.data_gap).length : 0}`,
    )
  }
  const overview = await callTool('wx_channels_account_overview', { accountId, window: 'last_7d' })
  check(
    'account_overview：近7日聚合与增长序列',
    overview.metrics.daysObserved === 7
      && Number(overview.metrics.totals.daily_play_count) > 0
      && overview.fans_trend.daily.length === 7
      && overview.fans_trend.followerTotalCount !== null,
    `days=${overview.metrics.daysObserved} play=${overview.metrics.totals.daily_play_count} fansTotal=${overview.fans_trend.followerTotalCount}`,
  )
  check(
    'account_overview：三源独立可用',
    overview.availability.account_metrics === 'ok' && overview.availability.fans_trend === 'ok',
    JSON.stringify(overview.availability),
  )
  const profileGet = await callTool('wx_channels_fans_profile_get', { accountId })
  check(
    'fans_profile_get：最新画像可用',
    profileGet.availability === 'ok' && Boolean(profileGet.fans_profile),
    `day=${profileGet.fans_profile && profileGet.fans_profile.day}`,
  )
  const runGet = await callTool('wx_channels_collect_run_get', { runId: started.runId })
  check(
    'run_get：账本批次记录',
    Array.isArray(runGet.batches) && runGet.batches.length > 0,
    `batches=${runGet.batches.length}`,
  )

  // 8) 重复入库不产生重复作品（E-09）。
  if (REPEAT_INGEST) {
    const repeat = await ingestCollectedData({
      client,
      works: enriched,
      listComplete: list.listComplete,
      expectedWorkCount: list.totalCount ?? enriched.length,
      newAttempt: true,
      accountLevel: null,
    })
    const afterRepeat = await callTool('wx_channels_work_list', { accountId })
    check(
      '重复入库：作品数不变（不重复）',
      afterRepeat.works.length === list.totalCount && repeat.error === null,
      `works=${afterRepeat.works.length}`,
    )
  }

  console.log(`[e2e][timing] listMs=${TIMING.listMs} detailMs=${TIMING.detailMs} accountMetricsMs=${TIMING.accountMetricsMs} fansTrendMs=${TIMING.fansTrendMs} fansPortraitMs=${TIMING.fansPortraitMs} ingestMs=${TIMING.ingestMs} totalMs=${TIMING.totalMs}`)

  // 汇总。
  const failed = results.filter(item => !item.ok)
  console.log(`\n[e2e] 结果: ${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) {
    console.log('[e2e] 失败项:')
    for (const item of failed) console.log(`  - ${item.name} ${item.detail}`)
    process.exit(1)
  }
} finally {
  await context.close().catch(() => {})
}
