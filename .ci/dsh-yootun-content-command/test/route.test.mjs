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

test('maps geoflow tasks to briefs, publish-ready actions, and metrics', async () => {
  let route
  const executed = []
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: {
      schemas() { return [{ name: 'mcp__geoflow__geoflow_tasks_list' }] },
      async execute(input) {
        executed.push(input)
        return { content: [{ type: 'text', text: JSON.stringify({ tasks: [
          { id: 't-1', title: '改装避坑指南', status: 'ready' },
          { id: 't-2', title: '新能源评测', status: 'published' },
          { id: 't-3', title: '选题草稿', status: 'draft' },
        ] }) } ] }
      },
    },
    webServer: { register(value) { route = value; return () => {} } },
  })
  const state = await invoke(route, 'GET')
  assert.equal(state.body.status, 'ready')
  assert.equal(state.body.dashboard.briefs, 3)
  assert.equal(state.body.dashboard.ready, 1)
  assert.equal(state.body.dashboard.published, 1)
  assert.equal(state.body.actions.length, 1)
  assert.equal(state.body.actions[0].targetLabel, '改装避坑指南')
  assert.equal(state.body.actions[0].status, 'awaiting_confirmation')
  assert.equal(executed[0].arguments.limit, 50)
  assert.ok(executed[0].signal instanceof AbortSignal)
  assert.equal(executed[0].signal.aborted, false)
  const confirmed = await invoke(route, 'POST', { action: 'confirm_action', id: 't-1' })
  assert.equal(confirmed.body.actions[0].status, 'adapter_pending')
})

test('returns a stable error state when GeoFlow fails', async () => {
  let route
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: {
      schemas() { return [{ name: 'geoflow_tasks_list' }] },
      async execute() { throw new Error('tool_failed') },
    },
    webServer: { register(value) { route = value; return () => {} } },
  })
  const state = await invoke(route, 'GET')
  assert.equal(state.status, 200)
  assert.equal(state.body.status, 'error')
  assert.deepEqual(state.body.briefs, [])
})
