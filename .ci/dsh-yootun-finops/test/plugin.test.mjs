import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('publishes a web FinOps plugin with a bundle patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-finops')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('keeps cost data source-bound and free of credentials or direct providers', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['/api/desktop/yootun/finops', 'Yesterday spend', 'alerts', 'sourceReady', 'sourceUnavailable', 'sourceError']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /MODELS_API_KEY|api\.deepseek\.com|password|cookie/iu)
})

test('uses only DSH alpha3 exported icons', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'))
  }
})

test('host endpoint serves real model spend from the Models usage API', async () => {
  let route
  const requests = []
  const { apply: applyHost } = await import('../index.js')
  applyHost({
    credentials: { async resolve(ref) { return { value: 'test-model-key', source: 'memory' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    webServer: { register(value) { route = value; return () => {} } },
  }, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify({
        object: 'yootun.usage_range',
        currency: 'CNY',
        summary: { requests: 3, totalTokens: 120, cost: 0.5 },
        byModel: [{ model: 'glm-5.2', requests: 3, totalTokens: 120, cost: 0.5 }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  assert.equal(route.path, '/api/desktop/yootun/finops')
  const response = await invokeRoute(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.source.status, 'ready')
  assert.equal(response.body.summary.spend, 'CNY 0.50')
  assert.equal(response.body.summary.alerts, 0)
  assert.equal(response.body.models.length, 1)
  assert.equal(response.body.models[0].name, 'glm-5.2')
  assert.equal(response.body.models[0].tokens, 120)
  assert.equal(response.body.models[0].cost, 'CNY 0.50')
  assert.match(requests[0].url, /^https:\/\/ixicai\.cn\/api\/v1\/yootun\/usage\?/)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-model-key')
  assert.ok(!requests[0].url.includes('test-model-key'), 'credential must stay out of URLs')
})

test('host endpoint isolates usage failures without fake spend numbers', async () => {
  let route
  const { apply: applyFn } = await import('../index.js')
  applyFn({
    credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    webServer: { register(value) { route = value; return () => {} } },
  }, {
    fetch: async () => new Response('upstream failed', { status: 502 }),
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })
  const response = await invokeRoute(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.source.status, 'error')
  assert.equal(response.body.source.reason, 'billing_http_502')
  assert.deepEqual(response.body.models, [])
  assert.equal(response.body.summary.spend, undefined)
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
