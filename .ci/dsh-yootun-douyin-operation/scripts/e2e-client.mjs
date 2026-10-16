// 抖音运营 1015 · 客户端进程级 E2E。
//
// 范围：真实 collector/parse/runner/ingest/tools-client 全链路——Playwright 无头系统
// Chrome 加载本地路由页模拟创作者中心响应（1015 fixtures，脱敏占位），tools 侧指向
// 本地 tools 服务（真实 MCP streamable-http × PostgreSQL）。
// 前置：本地 tools 已启动（参考 scripts 内注释：`uvicorn tools_dofe.main:app --port 8000`）。
// 不依赖真实抖音登录态；真实抖音接口与公网网关链路属上线阶段真机 E2E。
//
// 用法：node scripts/e2e-client.mjs
// 验证：退出码 0 + 末尾 SQL 核对输出（落库由本地 tools 服务写入开发库 tools_dofe）。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import React from 'react'

import { loadPlaywrightDriver, resolveSystemChrome } from '../src/chrome.js'
import { collectAccountWorks } from '../src/collector.js'
import { ingestCollectedWorks } from '../src/ingest.js'
import { SessionInvalidError } from '../src/parse.js'
import { runAccountCollection } from '../src/runner.js'
import { parseToolResult, safeErrorCode, extractJsonEnvelope } from '../src/tools-client.js'

const React_ = React.default ?? React
const h = (type, props, ...children) => React_.createElement(type, props ?? null, ...children)

const FIXTURE_DIR = new URL('../test/fixtures/', import.meta.url)
const FIXTURE_DIR_1015 = new URL('../test/fixtures/1015/', import.meta.url)
const ACCOUNT = 'e2e-client-acc'
const BASE_URL = 'http://127.0.0.1:8000'
const MCP_URL = `${BASE_URL}/mcp/douyin_operation`

async function fixture(dir, name) {
  return JSON.parse(await readFile(new URL(name, dir), 'utf8'))
}

// ---------------------------------------------------------------------------
// MCP 客户端桥：把本地 tools 的 MCP streamable-http 会话包装成宿主
// ctx.tools 形态（schemas + execute），tools-client.callTool 语义不变。
// ---------------------------------------------------------------------------

// MCP streamable-http 最小子集（本地网关 stateless：纯 JSON 响应、无 session 头）。
// 每次调用独立 POST；结果统一收敛成 { structuredContent, content, isError } 形态，
// 交给 src/tools-client.js 的 parseToolResult（错误信封语义与生产一致）。
let rpcId = 0

async function mcpRpc(method, params) {
  const isNotification = method.startsWith('notifications/')
  const response = await fetch(MCP_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(
      isNotification
        ? { jsonrpc: '2.0', method, params: params ?? {} }
        : { jsonrpc: '2.0', id: ++rpcId, method, params },
    ),
  })
  if (isNotification) return null
  if (!response.ok) throw new Error(`mcp http ${response.status}`)
  const text = await response.text()
  if (text.startsWith('event:')) {
    const dataLine = text.split('\n').find(line => line.startsWith('data:'))
    return JSON.parse(dataLine.slice(5).trim())
  }
  return JSON.parse(text)
}

async function makeToolsCtx() {
  await mcpRpc('initialize', {
    protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'e2e-client', version: '1.0' },
  })
  // MCP 协议要求：initialize 之后必须发 initialized 通知，否则服务端会话
  // 状态机不就绪，后续 tools/list / tools/call 会挂起等待。
  await mcpRpc('notifications/initialized')
  const listed = await mcpRpc('tools/list', {})
  const names = listed.result.tools.map(tool => tool.name)
  const call = async (name, args) => {
    const envelope = await mcpRpc('tools/call', { name, arguments: args })
    const result = envelope.result
    if (result.isError === true) {
      const text = Array.isArray(result.content)
        ? result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
        : ''
      const payload = extractJsonEnvelope(text) || (result.structuredContent || null)
      const code = payload?.error?.code
      throw Object.assign(new Error(code ? safeErrorCode(code) : 'douyin_operation_request_failed'), {
        code: code ? safeErrorCode(code) : 'douyin_operation_request_failed',
      })
    }
    return result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? '{}')
  }
  const ctx = {
    tools: {
      schemas: () => names.map(name => ({ name })),
      execute: async ({ name, arguments: args }) => {
        // schema.name 即真实工具名（本地网关无 mcp__ 前缀包装）。
        const payload = await call(name, args)
        return { structuredContent: payload, content: [], isError: false }
      },
    },
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Playwright：本地路由页模拟创作者中心（fixtures 驱动，零网络）。
// ---------------------------------------------------------------------------

async function makeSession() {
  const driver = await loadPlaywrightDriver()
  const chromePath = await resolveSystemChrome({ platform: process.platform })
  const browser = await driver.chromium.launch({
    channel: chromePath.channel,
    executablePath: chromePath.path,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  // 路由注册在 context 级：runner 通过 context.newPage() 自建页面，
  // page 级 route 不会覆盖 runner 新建的页面。

  const page1 = await fixture(FIXTURE_DIR, 'work_list.page1.sample.json')
  const lastpage = await fixture(FIXTURE_DIR, 'work_list.lastpage.sample.json')
  const dash = await fixture(FIXTURE_DIR_1015, 'dashboard.sample.json')
  const dashFans = await fixture(FIXTURE_DIR_1015, 'dashboard_fans.sample.json')
  const fansSummary = await fixture(FIXTURE_DIR_1015, 'fans_summary.sample.json')
  const itemAnalysis = await fixture(FIXTURE_DIR, 'item_analysis.sample.json')
  const compare = await fixture(FIXTURE_DIR, 'item_compare.high.sample.json')
  const source = await fixture(FIXTURE_DIR, 'play_source.sample.json')
  const portrait = await fixture(FIXTURE_DIR, 'portrait.sample.json')
  const search = await fixture(FIXTURE_DIR, 'search_keywords.sample.json')
  const progress = await fixture(FIXTURE_DIR, 'progress_analysis.sample.json')
  const wordCloud = await fixture(FIXTURE_DIR, 'wordCloud.sample.json')

  let listCalls = 0
  let manageVisits = 0
  await context.route('**/*', async route => {
    const url = route.request().url()
    const replyJson = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
    const replyHtml = () => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>e2e</body></html>' })
    try {
      if (url.includes('creator-micro/content/manage')) {
        manageVisits += 1
        return replyHtml()
      }
      if (url.includes('work-detail/')) return replyHtml()
      if (url.includes('/janus/douyin/creator/pc/work_list')) {
        // 第一页 has_more=true（cursor 前进），第二页 has_more=false 收敛。
        const payload = listCalls === 0 ? page1 : lastpage
        listCalls += 1
        return replyJson(payload)
      }
      if (url.includes('/web/api/media/user/info/')) {
        return replyJson({ user: { sec_uid: 'e2e-client-acc', nickname: 'E2E 客户端账号', follower_count: 6600 } })
      }
      if (url.includes('item_analysis/involved_vertical')) return replyJson({ primary_verticals: [] })
      if (url.includes('item_analysis/item_performance')) return replyJson(itemAnalysis)
      if (url.includes('item_analysis/overview')) return replyJson({})
      if (url.includes('/data/diagnose/item_compare')) return replyJson(compare)
      if (url.includes('/data/item/play/source')) return replyJson(source)
      if (url.includes('/data/fans/item/portrait')) return replyJson(portrait)
      if (url.includes('/data/item_analysis/search/keyword')) return replyJson(search)
      if (url.includes('/bff/data/progress/analysis/v2')) return replyJson(progress)
      if (url.includes('/web/api/creator/item/mget')) {
        const ids = new URL(url).searchParams.get('ids')
        return replyJson({ items: [{ id: ids, metrics: { danmaku_count: '3' } }] })
      }
      if (url.includes('/aweme/v1/creator/data/item/wordCloud/')) return replyJson(wordCloud)
      // 1015 账号大盘三连。
      if (url.includes('data/overview/dashboard?')) return replyJson(dash)
      if (url.includes('data/overview/dashboard/fans')) return replyJson(dashFans)
      if (url.includes('bff/data/fans/summary/v2')) return replyJson(fansSummary)
      return replyJson({})
    } catch (error) {
      return route.fulfill({ status: 500, body: String(error) })
    }
  })

  return {
    browser,
    context,
    chromePath: chromePath.path,
    stats: { get listCalls() { return listCalls }, get manageVisits() { return manageVisits } },
  }
}

// ---------------------------------------------------------------------------
// SQL 核对（本地 tools 的 PostgreSQL 开发库）。
// ---------------------------------------------------------------------------

async function main() {
  const log = label => console.log(`[${new Date().toISOString().slice(11, 19)}] ${label}`)
  const health = await fetch(`${BASE_URL}/health`).then(r => r.ok).catch(() => false)
  if (!health) {
    console.error('本地 tools 服务未启动。请在 tools.dofe.ai 仓库执行：')
    console.error('  .venv/bin/uvicorn tools_dofe.main:app --host 127.0.0.1 --port 8000')
    process.exitCode = 1
    return
  }

  log('tools ctx ready')
  const toolsCtx = await makeToolsCtx()
  const root = join(tmpdir(), `douyin-e2e-client-${Date.now()}`)
  await mkdir(join(root, 'storage-state'), { recursive: true })
  const storageStatePath = join(root, 'storage-state', `${ACCOUNT}.json`)
  await writeFile(storageStatePath, JSON.stringify({ cookies: [], origins: [] }))

  const events = []
  log('playwright session ready')
  const session = await makeSession()
  try {
    log('runAccountCollection start')
    const result = await runAccountCollection({
      accountId: ACCOUNT,
      callTool: async (name, args) => {
        const schema = toolsCtx.tools.schemas().find(item => item.name === name)
        const res = await toolsCtx.tools.execute({ callId: `e2e-${Date.now()}`, name: schema.name, arguments: args })
        return parseToolResult(res)
      },
      root,
      storageStatePath,
      sessionFactory: async () => session,
      newAttempt: true,
      onProgress: event => events.push(event),
    })

    console.log('[result] status:', result.status, '| runStatus:', result.runStatus,
      '| succeeded:', result.succeededWorkCount, '| failed:', result.failedWorkCount)
    console.log('[result] dashboard.dailyAccepted:', result.dashboard?.dailyAccepted,
      '| gaps:', JSON.stringify(result.dashboard?.gaps))
    console.log('[result] listComplete:', result.listComplete, '| pages:', result.pages)

    const assert = (cond, label) => {
      if (!cond) {
        console.error('ASSERT FAIL:', label)
        process.exitCode = 1
      } else {
        console.log('ASSERT OK:', label)
      }
    }
    assert(result.status === 'ready', '采集结果 ready')
    assert(result.runStatus === 'completed', 'run 结算 completed')
    assert(result.succeededWorkCount === 2, 'fixtures 两页共 2 作品入库（page1+lastpage）')
    assert((result.dashboard?.dailyAccepted || 0) >= 1, '日度指标入库')
    assert(events.some(event => event.phase === 'daily_ingested'), 'daily_ingested 事件')
    assert(!events.some(event => event.phase === 'dashboard_gap'), '无 dashboard 缺口')
    assert(session.stats.manageVisits >= 1 && session.stats.listCalls >= 2, '真实 page 路由被采集消费')

    console.log('\n落库核对请执行 tools 仓库 verify（账号 ' + ACCOUNT + '）：')
    console.log(`  SELECT work_id, cover_url, fans_gain_count FROM douyin_work WHERE account_id='${ACCOUNT}';`)
    console.log(`  SELECT count(*) FROM douyin_account_daily WHERE account_id='${ACCOUNT}';`)
  } catch (error) {
    if (error instanceof SessionInvalidError) {
      console.error('E2E 会话失效（fixture 不应触发）：', error.message)
    } else {
      throw error
    }
  } finally {
    await session.browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
