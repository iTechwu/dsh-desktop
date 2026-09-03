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

function makeCtx(results) {
  let route
  const ctx = {
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: {
      schemas() { return [
        { name: 'mcp__tools-supply-chain__supply_chain_alerts_list' },
        { name: 'mcp__tools-talent-discovery__talent_candidates_list' },
      ] },
      async execute(input) {
        assert.ok(input.signal instanceof AbortSignal)
        assert.equal(input.signal.aborted, false)
        if (results.error) throw results.error
        const name = String(input.name)
        if (name.includes('supply_chain_alerts_list')) {
          return { content: [{ type: 'text', text: JSON.stringify({ alerts: results.supplyAlerts }) }] }
        }
        if (name.includes('talent_candidates_list')) {
          return { content: [{ type: 'text', text: JSON.stringify({ candidates: results.talentCandidates }) }] }
        }
        throw new Error(`unexpected tool ${name}`)
      },
    },
    webServer: { register(value) { route = value; return () => {} } },
  }
  apply(ctx)
  return route
}

test('aggregates pending approvals from supply chain and recruiter sources', async () => {
  const route = makeCtx({
    supplyAlerts: [{ alertId: 'a-1', supplierId: 'sup-9', priority: 'P0', status: 'open' }],
    talentCandidates: [
      { candidateId: 'c-1', displayName: '候选甲', level: 'A' },
      { candidateId: 'c-3', displayName: '候选丙', level: 'C' },
    ],
  })
  const state = await invoke(route, 'GET')
  assert.equal(state.body.status, 'ready')
  assert.equal(state.body.dashboard.pending, 2)
  const sources = state.body.actions.map(item => item.source).sort()
  assert.deepEqual(sources, ['recruiter', 'supply-watch'])
  const supply = state.body.actions.find(item => item.source === 'supply-watch')
  assert.equal(supply.risk, 'P0')
  assert.equal(supply.status, 'awaiting_confirmation')

  const dismissed = await invoke(route, 'POST', { action: 'dismiss', id: 'recruiter:c-1' })
  assert.equal(dismissed.body.dashboard.dismissed, 1)
  assert.equal(dismissed.body.dashboard.pending, 1)
  assert.equal(dismissed.body.actions.find(item => item.id === 'recruiter:c-1').status, 'dismissed')
})

test('reports empty queue when every source is unavailable', async () => {
  let route
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: { schemas() { return [] } },
    webServer: { register(value) { route = value; return () => {} } },
  })
  const state = await invoke(route, 'GET')
  assert.equal(state.body.status, 'unavailable')
  assert.deepEqual(state.body.actions, [])
  assert.equal(state.body.dashboard.pending, 0)
})

test('reports an error queue when every configured source fails', async () => {
  const route = makeCtx({ error: new Error('tool_failed') })
  const state = await invoke(route, 'GET')
  assert.equal(state.status, 200)
  assert.equal(state.body.status, 'error')
  assert.deepEqual(state.body.actions, [])
})
