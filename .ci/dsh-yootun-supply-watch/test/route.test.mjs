import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'

async function invoke(route, method, body) {
  let status = 0
  let raw = ''
  const req = { method, headers: {} }
  if (body) req[Symbol.asyncIterator] = async function* () { yield JSON.stringify(body) }
  const res = { writeHead(v) { status = v; return this }, end(v = '') { raw += v } }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined }
}

test('builds risks and review actions from live supply chain alerts', async () => {
  let route
  const executed = []
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: {
      schemas() { return [{ name: 'mcp__tools-supply-chain__supply_chain_alerts_list' }] },
      async execute(input) {
        executed.push(input)
        return { content: [{ type: 'text', text: JSON.stringify({ alerts: [
          { alertId: 'a-1', supplierId: 'sup-9', priority: 'P0', status: 'open' },
          { alertId: 'a-2', supplierId: 'sup-4', priority: 'P2', status: 'resolved' },
        ] }) } ] }
      },
    },
    webServer: { register(value) { route = value; return () => {} } },
  })
  const state = await invoke(route, 'GET')
  assert.equal(state.body.status, 'ready')
  assert.equal(state.body.dashboard.risks, 2)
  assert.equal(state.body.dashboard.critical, 1)
  assert.equal(state.body.dashboard.openRisks, 1)
  assert.equal(state.body.risks[0].targetLabel, 'sup-9')
  assert.equal(state.body.actions.length, 1)
  assert.equal(state.body.actions[0].id, 'a-1')
  assert.equal(executed[0].arguments.pageSize, 20)
  assert.ok(executed[0].signal instanceof AbortSignal)
  assert.equal(executed[0].signal.aborted, false)
  const confirmed = await invoke(route, 'POST', { action: 'confirm_action', id: 'a-1' })
  assert.equal(confirmed.body.actions[0].status, 'adapter_pending')
})

test('reports unavailable instead of fake data when tools are missing', async () => {
  let route
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: { schemas() { return [] } },
    webServer: { register(value) { route = value; return () => {} } },
  })
  const state = await invoke(route, 'GET')
  assert.equal(state.body.status, 'unavailable')
  assert.deepEqual(state.body.risks, [])
})

test('returns a stable error state when the supply tool fails', async () => {
  let route
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: {
      schemas() { return [{ name: 'supply_chain_alerts_list' }] },
      async execute() { throw new Error('tool_failed') },
    },
    webServer: { register(value) { route = value; return () => {} } },
  })
  const state = await invoke(route, 'GET')
  assert.equal(state.status, 200)
  assert.equal(state.body.status, 'error')
  assert.deepEqual(state.body.risks, [])
})
