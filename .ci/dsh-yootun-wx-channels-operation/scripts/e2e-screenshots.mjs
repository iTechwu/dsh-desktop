// 视觉验证截图：Node 侧 renderToString 用真实采集数据渲染四种状态（浅色作品/浅色
// 账号+详情/深色两版），Playwright 打开静态页截图，保存到 docs/1109/wx/screenshots/。
//
// 数据源：本地 tools 服务 MCP（真实采集入库数据）。
// 前置：本地 tools 服务已启动（默认 127.0.0.1:8000）。
// 用法：node scripts/e2e-screenshots.mjs [--mcp http://127.0.0.1:8000] [--out <目录>]

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const MCP = argValue('--mcp', 'http://127.0.0.1:8000/mcp')
const DOMAIN = 'wx_channels_operation'
// 截图落档目录：docker-helm 仓库 docs/1109/wx/screenshots/。
const OUT = resolve(argValue('--out', resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/1109/wx/screenshots')))
const ACCOUNT_INDEX = Number(argValue('--account-index', '0'))

await mkdir(OUT, { recursive: true })

// ---------------------------------------------------------------------------
// 本地 MCP 客户端
// ---------------------------------------------------------------------------

let rpcId = 0
let sessionId = null

async function rpc(method, params) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const response = await fetch(`${MCP}/${DOMAIN}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) }),
  })
  const sid = response.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const text = await response.text()
  const jsonText = text.startsWith('data:') ? text.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim() : text
  const payload = JSON.parse(jsonText || text)
  if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`)
  console.log(`[rpc] ${method} -> ${payload.result ? 'result' : payload.error ? 'error' : JSON.stringify(payload).slice(0, 120)}`)
  return payload.result
}

async function callTool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args })
  if (result.isError) throw new Error('tool isError')
  return result.structuredContent || {}
}

// ---------------------------------------------------------------------------
// 组装真实数据 initial
// ---------------------------------------------------------------------------

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'wx-shots', version: '0' },
})
// JSON-RPC 通知：202 空体，不解析。
{
  const response = await fetch(`${MCP}/${DOMAIN}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
  await response.arrayBuffer().catch(() => {})
}

const list = await callTool('wx_channels_account_list', {})
const accounts = (list.accounts || []).map(row => ({
  accountId: row.account_id,
  nickname: row.nickname,
  avatar: row.avatar,
  feedCount: row.feed_count,
  followerTotalCount: row.follower_total_count,
  sessionStatus: row.session_status,
  sessionCheckedAt: row.session_checked_at,
  lastCollectedAt: row.last_collected_at,
  deleteState: row.delete_state,
}))
if (!accounts.length) throw new Error('无已登记账号，先跑 e2e-local.mjs')
const selected = accounts[ACCOUNT_INDEX] || accounts[0]
const accountId = selected.accountId

const worksResult = await callTool('wx_channels_work_list', { accountId, sort: 'publish_time', order: 'desc' })
const works = worksResult.works || []
if (!works.length) throw new Error('无已入库作品，先跑 e2e-local.mjs')

const overview = await callTool('wx_channels_account_overview', { accountId, window: 'last_7d' })
const profileResult = await callTool('wx_channels_fans_profile_get', { accountId })

// 详情弹层数据：取第一个有按日快照的作品（work_get round-trip）。
let detail = null
let detailDaily = []
for (const work of works) {
  const got = await callTool('wx_channels_work_get', { accountId, workId: work.work_id })
  if ((got.daily_metrics || []).length > 0) {
    detail = got.work
    detail = { ...detail, traffic_source: got.traffic_source, retention_trend: got.retention_trend }
    detailDaily = got.daily_metrics
    break
  }
}
if (!detail) {
  detail = works[0]
  detail = { ...detail, traffic_source: detail.traffic_source, retention_trend: detail.retention_trend }
}

// ---------------------------------------------------------------------------
// 渲染四种状态（构建产物工厂 + 真 React renderToString）
// ---------------------------------------------------------------------------

const react = await import('react')
const React = react.default ?? react
const { renderToString } = await import('react-dom/server')
const { createElement: h } = React

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
let factory = null
const windowStub = { __ModuleLoader__: { load(mod) { factory = mod.factory } } }
new Function('window', source)(windowStub)
const module_ = factory(name => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      IconSparkleRegular: () => null,
      Tooltip: props => props.children,
    }
  }
  throw new Error('unexpected require: ' + name)
})

const host = async () => ({ status: 'ok' }) // renderToString 不执行 effect，host 不会被调用

const initialBase = {
  accounts,
  selectedId: accountId,
  works,
  overview,
  summaryOverview: overview,
  profile: profileResult.fans_profile,
}

const lightShell = `
  :root {
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-1: #f6f7f9;
    --dsw-alias-bg-layer-2: #eceef1;
    --dsw-alias-label-primary: #1f2329;
    --dsw-alias-label-secondary: #646a73;
    --dsw-alias-border-l1: #e0e3e8;
    --dsw-alias-brand-primary: #0f1115;
    --dsw-alias-label-primary-foreground: #ffffff;
    --dsw-alias-state-error-primary: #d03a3a;
    --dsw-alias-state-success-primary: #1a7f37;
  }`
const darkShell = `
  :root {
    --dsw-alias-bg-base: #151517;
    --dsw-alias-bg-layer-1: #232324;
    --dsw-alias-bg-layer-2: #2c2c2e;
    --dsw-alias-label-primary: #fafafa;
    --dsw-alias-label-secondary: #b4b4b4;
    --dsw-alias-border-l1: rgba(255,255,255,.10);
    --dsw-alias-brand-primary: #e9e9e9;
    --dsw-alias-label-primary-foreground: #343434;
    --dsw-alias-state-error-primary: #e0524a;
    --dsw-alias-state-success-primary: #4ade80;
  }`

function pageHtml(shell, rendered) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>视频号工作台 · 视觉验证</title>
<style>${shell}
html, body { margin: 0; background: var(--dsw-alias-bg-base); }
body { font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
</style>
</head>
<body>
<div id="root">${rendered}</div>
</body>
</html>`
}

const variants = [
  { name: 'wx-ui-light-work', shell: lightShell, initial: { ...initialBase, tab: 'work' } },
  { name: 'wx-ui-light-account', shell: lightShell, initial: { ...initialBase, tab: 'account' } },
  { name: 'wx-ui-light-detail', shell: lightShell, initial: { ...initialBase, tab: 'work', detail, detailDaily } },
  { name: 'wx-ui-dark-work', shell: darkShell, initial: { ...initialBase, tab: 'work' } },
  { name: 'wx-ui-dark-account', shell: darkShell, initial: { ...initialBase, tab: 'account' } },
]

// ---------------------------------------------------------------------------
// Playwright 截图
// ---------------------------------------------------------------------------

const playwright = await import('playwright-core')
const { resolveSystemChrome } = await import('../src/chrome.js')
const chrome = await resolveSystemChrome()
const browser = await playwright.chromium.launch({
  channel: chrome.channel,
  executablePath: chrome.path,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

let bad = 0
for (const variant of variants) {
  const html = pageHtml(variant.shell, renderToString(h(module_.renderWxWorkbench, { host, initial: variant.initial })))
  const file = `${OUT}/${variant.name}.html`
  await writeFile(file, html)
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: variant.name.includes('dark') ? 'dark' : 'light' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`file://${file}`, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${variant.name}.png`, fullPage: true })
  console.log(`[shot] ${OUT}/${variant.name}.png${errors.length ? `  pageErrors=${errors.length}: ${errors[0].slice(0, 120)}` : ''}`)
  if (errors.length) bad += 1
  await context.close()
}
await browser.close()
console.log(`[shots] 完成 ${variants.length} 张 → ${OUT}${bad ? `；${bad} 张带页面错误` : '，无页面错误'}`)
process.exit(bad ? 1 : 0)
