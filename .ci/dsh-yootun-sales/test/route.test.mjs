import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'

function makeCtx(toolResult) {
  const refs = { route: null, executed: [] }
  const ctx = {
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: {
      schemas() { return [{ name: 'mcp__tools-lead-discovery__lead_discovery_discover' }] },
      async execute(input) {
        refs.executed.push(input)
        return { content: [{ type: 'text', text: JSON.stringify(toolResult()) }] }
      },
    },
    webServer: { register(value) { refs.route = value; return () => {} } },
  }
  return { ctx, refs }
}

async function invoke(route, method, body) {
  let status = 0
  let raw = ''
  const req = { method, headers: {}, ...(body ? { bodyObject: body } : {}) }
  req[Symbol.asyncIterator] = body ? async function* () { yield JSON.stringify(body) } : undefined
  const res = { writeHead(v) { status = v; return this }, end(v = '') { raw += v } }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined }
}

test('intent_search runs the real lead discovery tool and projects safe fields', async () => {
  const { ctx, refs } = makeCtx(() => ({
    items: [{ aiSummary: '长沙新能源车友讨论', platform: 'xiaohongshu-v2', sourceUrl: 'https://xhs.link/a', intentScore: 88, recommendedAction: '私信评测意向', leadLevel: 'A' }],
  }))
  apply(ctx)
  const state = await invoke(refs.route, 'GET')
  assert.equal(state.body.intent, null)
  const result = await invoke(refs.route, 'POST', { action: 'intent_search', query: '长沙新能源汽车改装讨论' })
  assert.equal(result.status, 200)
  assert.equal(result.body.intent.status, 'ready')
  assert.equal(result.body.intent.items.length, 1)
  const item = result.body.intent.items[0]
  assert.equal(item.topic, '长沙新能源车友讨论')
  assert.equal(item.sourceUrl, 'https://xhs.link/a')
  assert.ok(item.confidence > 0 && item.confidence <= 1)
  assert.match(refs.executed[0].arguments.idempotencyKey, /^[0-9a-f]{40}$/)
  assert.equal(refs.executed[0].arguments.keyword, '长沙新能源汽车改装讨论')
  assert.ok(refs.executed[0].signal instanceof AbortSignal)
  assert.equal(refs.executed[0].signal.aborted, false)
  const after = await invoke(refs.route, 'GET')
  assert.equal(after.body.leads.length, 1)
  assert.equal(after.body.actions[0].status, 'awaiting_confirmation')
  const confirmed = await invoke(refs.route, 'POST', { action: 'confirm_action', id: 'intent-0' })
  assert.equal(confirmed.body.actions[0].status, 'adapter_pending')
})

test('returns a stable error state when lead discovery fails', async () => {
  const { ctx, refs } = makeCtx(() => { throw new Error('tool_failed') })
  apply(ctx)
  const result = await invoke(refs.route, 'POST', { action: 'intent_search', query: '长沙新能源' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'error')
  assert.deepEqual(result.body.leads, [])
})
