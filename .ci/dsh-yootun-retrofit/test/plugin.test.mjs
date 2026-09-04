import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { apply } from '../index.js'

test('retrofit package exposes a complete database-first workspace', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.equal(manifest.name, '@dofe/dsh-yootun-retrofit')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.match(client, /即时公开检索/)
  assert.match(client, /定时入库数据/)
  assert.match(client, /列表、统计和详情只读取数据库/)
  assert.match(client, /方案总量/)
  assert.match(client, /平台覆盖/)
  assert.match(client, /今日头条/)
  assert.match(client, /Lemon8/)
})

test('host delegates to a query-capable custom-car tool without exposing credentials', async () => {
  let route
  const calls = []
  apply(context({
    schemas: [{ name: 'mcp__tools-custom-car-monitoring__custom_car_monitoring_search', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
    execute: async value => {
      calls.push(value)
      return { content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'secret' }] }
    },
    onRoute: value => { route = value },
  }))
  const result = await invoke(route, { query: 'SUV 灯光升级' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ready')
  assert.match(calls[0].name, /custom_car_monitoring_search$/)
  assert.ok(calls[0].signal instanceof AbortSignal)
  assert.equal(calls[0].signal.aborted, false)
  assert.deepEqual(result.body.result.content, [{ type: 'text', text: 'ok' }])
})

test('host exposes structured saved-list results without flattening them to text', async () => {
  let route
  apply(context({
    schemas: [{ name: 'mcp__tools-custom-car-monitoring__custom_car_monitoring_search', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
    execute: async () => ({ structuredContent: { total: 1, returned: 1, items: [{ platform: 'bilibili', title: 'SUV 改装', externalId: 'b-1' }] } }),
    onRoute: value => { route = value },
  }))
  const result = await invoke(route, { query: '' })
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.result.items[0].externalId, 'b-1')
})

test('host keeps an empty database result empty until explicit public refresh', async () => {
  let route
  const calls = []
  apply(context({
    schemas: [
      { name: 'mcp__tools-custom-car-monitoring__custom_car_monitoring_search', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
      agentReachSchema(),
    ],
    execute: async value => {
      calls.push(value)
      if (String(value.name).endsWith('custom_car_monitoring_search')) return { structuredContent: { total: 0, returned: 0, items: [] } }
      return { ok: true, exitCode: 0, stdout: 'fresh result', stderr: '' }
    },
    onRoute: value => { route = value },
  }))
  const result = await invoke(route, { query: '稀有车型改装' })
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.dataSource, 'database')
  assert.equal(calls.length, 1)
  assert.match(calls[0].name, /custom_car_monitoring_search$/)
})

test('host never selects its own registered tool or an incompatible custom-car tool', async () => {
  let route
  let executions = 0
  apply(context({
    schemas: [
      { name: 'yootun_retrofit_search', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
      { name: 'mcp__tools-custom-car-monitoring__custom_car_monitoring_plan_get', parameters: { type: 'object', properties: {} } },
    ],
    execute: async () => { executions += 1; return { content: [] } },
    onRoute: value => { route = value },
  }))
  const result = await invoke(route, { query: 'SUV 灯光升级' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'unavailable')
  assert.equal(executions, 0)
})

test('host scopes explicit public research to the selected platform', async () => {
  let route
  const calls = []
  const events = []
  const ctx = context({
    schemas: [
      { name: 'mcp__tools-custom-car-monitoring__custom_car_monitoring_plan_get', parameters: { type: 'object', properties: {} } },
      agentReachSchema(),
    ],
    execute: async value => { calls.push(value); return { ok: true, exitCode: 0, stdout: 'result', stderr: '' } },
    onRoute: value => { route = value },
  })
  ctx.yootunAudit = { async record(event) { events.push(event) } }
  apply(ctx)
  const result = await invoke(route, { action: 'refresh', query: '2024 SUV LED lighting upgrade', platform: 'youtube' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.platform, 'youtube')
  assert.equal(calls[0].name, 'agent_reach')
  assert.deepEqual(calls[0].arguments.args, ['exa', 'search', '2024 SUV LED lighting upgrade site:youtube.com', '--limit', '8'])
  assert.equal(result.body.result.stdout, 'result')
  assert.deepEqual(events, [{
    actionCode: 'retrofit.public_sources.refreshed', category: 'execute',
    source: { pluginId: '@dofe/dsh-yootun-retrofit', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'retrofit_search', id: 'youtube' }, outcome: 'succeeded',
    changes: [{ field: 'resultCount', after: 0 }, { field: 'source', after: 'agent_reach' }], effects: [],
  }])
})

test('marks a resolved agent-reach command failure as a failed refresh', async () => {
  let route
  const events = []
  const ctx = context({
    schemas: [agentReachSchema()],
    execute: async () => ({ ok: false, exitCode: 1, stdout: '', stderr: 'private failure detail' }),
    onRoute: value => { route = value },
  })
  ctx.yootunAudit = { async record(event) { events.push(event) } }
  apply(ctx)

  const result = await invoke(route, { action: 'refresh', query: 'SUV' })

  assert.equal(result.body.status, 'error')
  assert.equal(events[0].outcome, 'failed')
  assert.equal(events[0].errorCode, 'retrofit_tool_failed')
  assert.doesNotMatch(JSON.stringify(events), /private failure detail/u)
})

function agentReachSchema() {
  return { name: 'agent_reach', parameters: { type: 'object', properties: { args: { type: 'array' } } } }
}

function context({ schemas, execute, onRoute }) {
  return {
    tools: { schemas: () => schemas, execute, register() { return () => {} } },
    webServer: { register(value) { onRoute(value); return () => {} } },
    effect(factory) { return factory() },
  }
}

async function invoke(route, body) {
  let status
  let raw = ''
  await route.handler(
    { method: 'POST', body },
    { writeHead(value) { status = value; return this }, end(value) { raw += value } },
  )
  return { status, body: JSON.parse(raw) }
}
