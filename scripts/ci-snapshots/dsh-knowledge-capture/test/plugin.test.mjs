import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { KNOWLEDGE_MCP_URL, apply, captureSessionEvent, renderContextPack, runtimeCandidate } from '../index.js'

const root = new URL('../', import.meta.url)

function context(fetch) {
  const listeners = new Map()
  const effects = []
  const provided = new Map()
  const ctx = {
    credentials: { async resolve(name) { assert.equal(name, 'MODELS_API_KEY'); return { value: 'test-key' } } },
    systemPrompt: {},
    logger: { warn() {} },
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    effect(factory) { effects.push(factory()); return () => {} },
    provide(name, value) { provided.set(name, value); return () => provided.delete(name) },
  }
  return { ctx, listeners, effects, provided, start: () => apply(ctx, { fetch }) }
}

function event(type, seq, data = {}) {
  return { type, seq, time: Date.UTC(2026, 8, 7, 1, 2, seq), data }
}

function mcpResponse(data) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: data } }), { status: 200 })
}

test('publishes a host-only MCP runtime bridge without the legacy SDK dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-knowledge-capture')
  assert.equal(manifest.version, '0.2.0')
  assert.equal(manifest.private, true)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client, undefined)
  assert.equal(manifest.dependencies, undefined)
})

test('uses only the public Knowledge MCP and MODELS_API_KEY trusted identity', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8')
  assert.match(source, /https:\/\/ixicai\.cn\/mcp\/knowledge/u)
  assert.match(source, /resolve\('MODELS_API_KEY'\)/u)
  assert.doesNotMatch(source, /KNOWLEDGE_API_KEY|KNOWLEDGE_API_BASE_URL|knowledge\.dofe\.ai|tenantId|userId|172\.30\.30\.11|127\.0\.0\.1/u)
})

test('captures bounded safe session facts and targets runtime candidates by role key', () => {
  const prompt = captureSessionEvent(event('user/message', 1, {
    role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'token=secret-value 请记住车型偏好' }],
  }), new Set())
  assert.equal(prompt.type, 'user-prompt')
  assert.match(prompt.text, /token=\[REDACTED\]/u)
  assert.doesNotMatch(prompt.text, /secret-value/u)
  assert.equal(captureSessionEvent(event('user/message', 2, {
    role: 'user', source: { kind: 'plugin', plugin: 'context' }, content: [{ type: 'text', text: 'injected' }],
  }), new Set()), null)
  const candidate = runtimeCandidate([prompt], 'dsh-turn-end')
  assert.equal(candidate.spaceKey, 'user.agent_runtime')
  assert.equal(candidate.scope, 'SESSION')
  assert.equal(candidate.type, 'EPISODIC')
})

test('submits DSH session checkpoints through MCP with server-resolved space keys', async () => {
  const requests = []
  const harness = context(async (url, init) => {
    requests.push({ url: String(url), init })
    const rpc = JSON.parse(init.body)
    if (rpc.params.name === 'knowledge.loadout') return mcpResponse({ policies: { allowCandidateCapture: true }, digest: 'a'.repeat(64) })
    return mcpResponse({ accepted: true })
  })
  await harness.start()
  assert.equal(harness.provided.get('yootunAgentCapture'), harness.provided.get('yootunAgentKnowledge'))
  const session = { id: 'session-1' }
  harness.listeners.get('session/created')(session)
  harness.listeners.get('session/event')(session, event('user/message', 1, {
    role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '记住我的服务偏好' }],
  }))
  harness.listeners.get('session/event')(session, event('assistant/message', 2, {
    message: { role: 'assistant', content: [{ type: 'text', text: '已记录为候选记忆' }] },
  }))
  await harness.listeners.get('session/flush')(session)

  assert.ok(requests.every(request => request.url === KNOWLEDGE_MCP_URL))
  assert.ok(requests.every(request => request.init.headers.Authorization === 'Bearer test-key'))
  const checkpoint = requests.map(request => JSON.parse(request.init.body)).find(rpc => rpc.params.name === 'knowledge.session_checkpoint')
  assert.ok(checkpoint)
  assert.equal(checkpoint.params.arguments.externalSessionId, 'session-1')
  assert.equal(checkpoint.params.arguments.startSeq, 1)
  assert.equal(checkpoint.params.arguments.endSeq, 2)
  assert.equal(checkpoint.params.arguments.candidateContents[0].spaceKey, 'user.agent_runtime')
  assert.equal(checkpoint.params.arguments.tenantId, undefined)
  assert.equal(checkpoint.params.arguments.userId, undefined)
})

test('injects ContextPack evidence and blocks recall-to-capture pollution', async () => {
  const harness = context(async (_url, init) => {
    const rpc = JSON.parse(init.body)
    assert.equal(rpc.params.name, 'knowledge.context_pack')
    return mcpResponse({
      stableContext: { rules: [{ key: 'tenant-policy', body: '只使用已授权空间' }], envFacts: [], activeSkills: [] },
      dynamicContext: { memories: [{ id: '22222222-2222-4222-8222-222222222222', content: '已确认偏好' }], citations: [], handoff: null },
      forbiddenCaptureIds: ['22222222-2222-4222-8222-222222222222'],
    })
  })
  await harness.start()
  const session = { id: 'session-2', snapshotEvents: () => [] }
  const assembly = await harness.listeners.get('system-prompt/assemble')(
    { sections: [], contexts: [], tools: [], variables: {} },
    { agent: { session } },
    async () => ({ sections: [], contexts: [], tools: [], variables: {} }),
  )
  assert.equal(assembly.contexts.length, 1)
  assert.match(assembly.contexts[0].text, /只使用已授权空间|已确认偏好/u)
  const blocked = captureSessionEvent(event('assistant/message', 3, {
    message: { role: 'assistant', content: [{ type: 'text', text: 'recalled 22222222-2222-4222-8222-222222222222' }] },
  }), new Set(['22222222-2222-4222-8222-222222222222']))
  assert.equal(blocked, null)
})

test('renders an empty ContextPack as no prompt contribution', () => {
  assert.equal(renderContextPack({ stableContext: {}, dynamicContext: {} }), '')
})
