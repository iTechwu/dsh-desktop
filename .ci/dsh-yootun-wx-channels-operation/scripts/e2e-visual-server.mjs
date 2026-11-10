// 视觉验证 harness：本地 HTTP 服务提供
// 1) 页面同源路由 /api/desktop/yootun/wx-channels-operation（action → 本地 tools MCP 工具，
//    投影与宿主 index.js 一致——截图渲染的是真实采集入库数据）；
// 2) harness 页面（加载构建产物 lib/client.js + 模拟宿主 DSW 主题变量）。
//
// 用法：node scripts/e2e-visual-server.mjs [--port 8791] [--mcp http://127.0.0.1:8000]
// 配套截图：scripts/e2e-screenshots.mjs

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const PORT = Number(argValue('--port', '8791'))
const MCP = argValue('--mcp', 'http://127.0.0.1:8000')
const DOMAIN = 'wx_channels_operation'

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
  const jsonText = text.startsWith('data:')
    ? text.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim()
    : text
  const payload = JSON.parse(jsonText || text)
  if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`)
  return payload.result
}

async function callTool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args })
  if (result.isError) throw new Error('tool isError')
  return result.structuredContent || {}
}

/** 与插件 index.js 一致的投影：服务端 canonical snake_case → 宿主端点形状。 */
const handlers = {
  'browser.status': async () => ({ status: 'ok', chromeAvailable: true, driverAvailable: true }),
  'accounts.list': async args => {
    const result = await callTool('wx_channels_account_list', args.accountId ? { accountId: args.accountId } : {})
    const accounts = (result.accounts || []).map(row => ({
      accountId: row.account_id,
      nickname: row.nickname,
      avatar: row.avatar,
      feedCount: row.feed_count,
      followerTotalCount: row.follower_total_count,
      sessionStatus: row.session_status,
      sessionCheckedAt: row.session_checked_at,
      lastCollectedAt: row.last_collected_at,
      deleteState: row.delete_state,
      isPending: false,
      hasStorageState: true,
    }))
    return { status: 'ok', accounts, remoteOk: true }
  },
  'collect.status': async () => ({ status: 'ok', busy: false }),
  'collectAll.status': async () => ({ status: 'ok', phase: 'ready' }),
  'works.list': async args => {
    const result = await callTool('wx_channels_work_list', {
      accountId: args.accountId,
      ...(args.sort ? { sort: args.sort } : {}),
      ...(args.order ? { order: args.order } : {}),
      ...(args.publishedFrom ? { publishedFrom: args.publishedFrom } : {}),
      ...(args.publishedTo ? { publishedTo: args.publishedTo } : {}),
    })
    return { status: 'ok', ...result }
  },
  'work.get': async args => {
    const result = await callTool('wx_channels_work_get', { accountId: args.accountId, workId: args.workId })
    return { status: 'ok', ...result }
  },
  'work.trend': async args => {
    const result = await callTool('wx_channels_work_trend', { accountId: args.accountId, workId: args.workId })
    return { status: 'ok', ...result }
  },
  'account.overview': async args => {
    const result = await callTool('wx_channels_account_overview', {
      accountId: args.accountId,
      ...(args.window ? { window: args.window } : {}),
    })
    return { status: 'ok', ...result }
  },
  'fans.profile.get': async args => {
    const result = await callTool('wx_channels_fans_profile_get', { accountId: args.accountId })
    return { status: 'ok', ...result }
  },
}

const HARNESS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>视频号工作台 · 视觉验证 harness</title>
<style>
  /* 模拟宿主 DSW 主题别名（浅色默认 + 深色 media，值取自 ui-demo.html 兜底）。 */
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
  }
  @media (prefers-color-scheme: dark) {
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
    }
  }
  body { margin: 0; }
</style>
</head>
<body>
<div id="root"></div>
<script>
  // 宿主最小 stub：__ModuleLoader__ 捕获工厂，require 提供 react。
  window.__ModuleLoader__ = {
    register(name, factory) {
      window.__loadedPlugin = { name, factory }
    },
  }
</script>
<script src="/lib/client.js"></script>
<script>
  (async () => {
    const react = await import('/node_modules/react/index.js').catch(() => null)
    const module_ = { exports: {} }
    window.__loadedPlugin.factory(name => {
      if (name === 'react') return react
      throw new Error('unexpected require: ' + name)
    }, module_, module_.exports)
    const client = await import('/node_modules/react-dom/client.js')
    const root = client.createRoot(document.getElementById('root'))
    root.render(module_.exports.renderWxWorkbench({ host: window.__hostBridge }))
  })()
</script>
</body>
</html>`

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/desktop/yootun/wx-channels-operation') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw || '{}')
      const handler = handlers[body.action]
      if (!handler) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'error', reason: 'unknown_action' }))
        return
      }
      const result = await handler(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }
    if (req.url === '/' || req.url === '/harness') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(HARNESS_HTML)
      return
    }
    if (req.url === '/lib/client.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' })
      res.end(await readFile(join(root, 'lib', 'client.js')))
      return
    }
    if (req.url && req.url.startsWith('/node_modules/')) {
      // ESM 裸链：react/react-dom 的 ESM 入口（开发机 node_modules 由 pnpm 布局）。
      const target = req.url.slice('/node_modules/'.length)
      const map = {
        'react/index.js': 'react/index.js',
        'react-dom/client.js': 'react-dom/client.js',
        'react-dom/cjs/react-dom-client.development.js': 'react-dom/cjs/react-dom-client.development.js',
      }
      const rel = map[target]
      if (!rel) {
        res.writeHead(404)
        res.end()
        return
      }
      const base = join(root, 'node_modules')
      const candidates = [
        join(base, rel.replace('react-dom/client.js', 'react-dom/client.js')),
        join(base, '.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/', rel),
      ]
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          res.writeHead(200, { 'content-type': 'application/javascript' })
          res.end(await readFile(candidate))
          return
        }
      }
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(404)
    res.end()
  } catch (error) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'error', reason: String(error && error.message ? error.message : error).slice(0, 120) }))
  }
})

import { existsSync } from 'node:fs'
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[harness] http://127.0.0.1:${PORT}/ （action → ${MCP}/${DOMAIN}）`)
})
