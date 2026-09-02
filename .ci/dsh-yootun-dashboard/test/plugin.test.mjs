import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { apply as applyHost } from '../index.js'

const root = new URL('../', import.meta.url)

test('publishes a standalone DSH dashboard client plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-dashboard')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
})

test('renders all requested dashboard domains and explicit source states', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of [
    'YOOTUN_DASHBOARD_PATH', 'sidebar.footer.action', 'shell.overlay',
    "id: 'overview'", "id: 'geo'", "id: 'usage'", "id: 'activity'", 'source?.reason', "tabOverview: 'Overview'", 'capabilities', 'knowledge', 'openmontage',
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(source, /prompt|private answer|providerKey/i)
})

test('loads and registers the sidebar action and global overlay', async () => {
  const bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  let plugin
  const registrations = []
  const document = {
    createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
    head: { appendChild() {} },
  }
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        plugin = factory(specifier => {
          if (specifier === 'react') return {
            createElement() {}, useEffect() {}, useMemo() {}, useState() {}, useSyncExternalStore() {},
          }
          if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {
            IconCloseOutline16() {}, IconDataOutline16() {}, IconRefreshOutline16() {}, Tooltip() {},
          }
          throw new Error(`unexpected module ${specifier}`)
        })
      },
    },
  }
  vm.runInNewContext(bundle, { AbortController, document, fetch() {}, window })
  assert.deepEqual([...plugin.inject], ['slots', 'locale'])
  plugin.apply({
    effect(factory) { factory() },
    locale: { bind: () => key => key, register: () => () => {} },
    slots: {
      inject(_name, factory) { factory() },
      register(options) {
        assert.equal(options.id, 'dofe-yootun-dashboard')
        registrations.push(options.name)
        return () => {}
      },
    },
  })
  assert.deepEqual(registrations, ['sidebar.footer.action', 'shell.overlay'])
})

test('host endpoint reads yesterday GEO analytics through the unified MCP gateway', async () => {
  let route
  const requests = []
  const ctx = {
    credentials: {
      async resolve(ref) {
        assert.equal(ref, 'MODELS_API_KEY')
        return { value: 'test-model-key', source: 'memory' }
      },
    },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: {
      async list() { return [] },
    },
    tools: {
      schemas() { return [{ name: 'mcp__knowledge__search' }, { name: 'mcp__georank__diagnose' }, { name: 'mcp__openmontage__render' }] },
    },
    webServer: {
      register(value) { route = value; return () => {} },
    },
  }
  applyHost(ctx, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      if (String(url) === 'https://ixicai.cn/mcp/geoflow') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'yootun-dashboard',
          result: {
            structuredContent: {
              tenant_id: 'tenant-a',
              kpis: { articles: 3, published: 2, failed_tasks: 1 },
              traffic: { kpis: { pv: 27 } },
              top_content: [],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(url).startsWith('https://ixicai.cn/api/v1/yootun/usage?')) {
        return new Response(JSON.stringify({
          currency: 'CNY',
          summary: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
          byModel: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected URL ${String(url)}`)
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  assert.equal(route.kind, 'exact')
  assert.equal(route.path, '/api/desktop/yootun/dashboard/yesterday')
  const response = await invokeRoute(route, 'POST')
  assert.equal(response.status, 200)
  assert.equal(response.body.period.date, '2026-08-31')
  assert.equal(response.body.geo.status, 'ready')
  assert.equal(response.body.geo.data.tenant_id, 'tenant-a')
  assert.equal(response.body.geo.data.kpis.total_views, 27)
  assert.equal(response.body.usage.status, 'empty')
  assert.equal(response.body.activity.status, 'empty')
  assert.equal(response.body.capabilities.tools.status, 'ready')
  assert.equal(response.body.capabilities.knowledge.status, 'ready')
  assert.equal(response.body.capabilities.georank.status, 'ready')
  assert.equal(requests[0].url, 'https://ixicai.cn/mcp/geoflow')
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-model-key')
  assert.deepEqual(JSON.parse(requests[0].init.body).params, {
    name: 'geoflow.analytics.overview',
    arguments: { preset: 'yesterday' },
  })
  assert.ok(requests.every(request => !/172\.30\.30\.11|127\.0\.0\.1|\.local\.dofe\.ai/u.test(request.url)))
})

test('host endpoint isolates an MCP failure without losing other dashboard sources', async () => {
  let route
  applyHost({
    credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: { async list() { return [] } },
    webServer: { register(value) { route = value; return () => {} } },
  }, {
    fetch: async url => {
      if (String(url).includes('/mcp/geoflow')) return new Response('upstream failed', { status: 502 })
      return new Response(JSON.stringify({
        currency: 'CNY', summary: { requests: 1, totalTokens: 9, cost: 0.01 }, byModel: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  const response = await invokeRoute(route, 'POST')
  assert.equal(response.status, 200)
  assert.equal(response.body.geo.status, 'error')
  assert.equal(response.body.geo.reason, 'geoflow_http_502')
  assert.equal(response.body.usage.status, 'ready')
})

async function invokeRoute(route, method) {
  let status = 0
  let raw = ''
  const req = { method, headers: {} }
  const res = {
    writeHead(value) { status = value; return this },
    end(value = '') { raw += value },
  }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined }
}
