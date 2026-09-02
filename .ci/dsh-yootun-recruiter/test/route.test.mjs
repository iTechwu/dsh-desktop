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

test('serves live ranked candidates through the talent discovery tool', async () => {
  let route
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: {
      schemas() { return [{ name: 'mcp__tools-talent-discovery__talent_candidates_list' }] },
      async execute(input) {
        assert.equal(input.arguments.limit, 50)
        return { content: [{ type: 'text', text: JSON.stringify({ candidates: [
          { candidateId: 'c-1', displayName: '候选甲', level: 'A', score: 0.92, highlights: ['改装内容连续产出'], concerns: [] },
          { candidateId: 'c-2', displayName: '候选乙', level: 'C' },
        ] }) } ] }
      },
    },
    webServer: { register(value) { route = value; return () => {} } },
  })
  const state = await invoke(route, 'GET')
  assert.equal(state.body.status, 'ready')
  assert.equal(state.body.candidates.length, 2)
  assert.equal(state.body.candidates[0].displayName, '候选甲')
  assert.equal(state.body.candidates[0].stage, 'A')
  assert.equal(state.body.candidates[0].matchScore, 0.92)
  assert.equal(state.body.candidates[0].evidence[0], '改装内容连续产出')
  assert.equal(state.body.actions.length, 1)
  assert.equal(state.body.actions[0].status, 'awaiting_confirmation')
  const dismissed = await invoke(route, 'POST', { action: 'dismiss_action', id: 'c-1' })
  assert.equal(dismissed.body.actions[0].status, 'adapter_pending')
})
