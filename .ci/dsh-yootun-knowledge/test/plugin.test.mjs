import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import { ACTIONS, COMPANY_TEMPLATES, MCP_URL, apply } from '../index.js'

const root = new URL('../', import.meta.url)

async function loadClientTestApi() {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const module = { exports: {} }
  const react = { createElement() {}, useEffect() {}, useMemo(factory) { return factory() }, useState() { return [null, () => {}] }, useSyncExternalStore() {}, Fragment: Symbol('Fragment') }
  vm.runInNewContext(source, { module, exports: module.exports, require(id) { return id === 'react' ? react : { Tooltip() {} } }, Intl, Map, Set, Date, JSON, Number, Array, Object, String, Math })
  return module.exports.__test
}

test('publishes a web management plugin and knowledge MCP bundle', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-knowledge')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /id:\s*yootun-knowledge-tools/u)
  assert.match(patch, /name:\s*'@dofe\/dsh-yootun-knowledge'/u)
  // The wrapper plugin owns the public MCP gateway contract; the direct
  // `@deepseek-ai/dsh-mcp-client` route is intentionally not registered here
  // so the model only sees one tool surface with one parameter protocol.
  assert.doesNotMatch(patch, /serverName:\s*knowledge/u)
  assert.doesNotMatch(patch, /authorizationCredential:\s*MODELS_API_KEY/u)
  assert.doesNotMatch(patch, /@deepseek-ai\/dsh-mcp-client/u)
  assert.doesNotMatch(patch, /process\.env\.MODELS_API_KEY|Authorization:\s*!!js/u)
})

test('exposes governed knowledge, Memory, and graph tools without direct endpoints', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8')
  for (const token of ['knowledge_search', 'knowledge_recall', 'knowledge_remember', 'knowledge_confirm_memory', 'knowledge_forget', 'knowledge_session_checkpoint', 'knowledge_promote', 'knowledge_loadout', 'knowledge_context_pack', 'knowledge_explain_trace', 'knowledge_entity_assertions', 'knowledge_relation_assertions', 'knowledge_entity_merges', 'knowledge_provenance_lineage', 'credential-store', 'tenant.all']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(source, /127\.0\.0\.1|172\.30\.30\.11|knowledge\.local\.dofe\.ai|knowledge\.dofe\.ai/u)
  assert.match(source, /https:\/\/ixicai\.cn\/mcp\/knowledge/u)
  assert.equal(Object.keys(ACTIONS).length, 18)
  assert.deepEqual(new Set(Object.values(ACTIONS)), new Set([
    'knowledge.search', 'knowledge.recall', 'knowledge.remember', 'knowledge.confirm_memory',
    'knowledge.forget', 'knowledge.session_checkpoint', 'knowledge.promote', 'knowledge.capabilities',
    'knowledge.overview', 'knowledge.graph', 'knowledge.ingest_file', 'knowledge.loadout',
    'knowledge.context_pack', 'knowledge.explain_trace', 'knowledge.entity_assertions',
    'knowledge.relation_assertions', 'knowledge.entity_merges', 'knowledge.provenance_lineage',
  ]))
  assert.deepEqual(COMPANY_TEMPLATES, [{
    id: 'tenant.all', spaceKey: 'tenant.all', name: '优惠豚',
    description: '优惠豚默认企业知识空间；公司、项目、会员与服务资料统一归档，所有优惠豚成员可读',
    entities: ['优惠豚', '长沙优惠豚汽车销售服务有限公司', '汽车科技文创园', '会员与5S服务'],
  }])
})

test('publishes per-tool input schemas so invalid MCP arguments fail before the gateway', async () => {
  const registered = new Map()
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
  }, { fetch: async () => new Response('{}', { status: 200 }) })

  const recall = registered.get('knowledge_recall')
  assert.deepEqual(recall.parameters.properties.input.required, ['query'])
  assert.deepEqual(Object.keys(recall.parameters.properties.input.properties).sort(), [
    'includeDocuments', 'includeMemories', 'query', 'retrievalMode', 'spaceIds', 'spaceKeys', 'topK',
  ])
  assert.equal(recall.parameters.properties.input.properties.topK.maximum, 50)
  assert.deepEqual(recall.parameters.properties.input.not.required, ['spaceKeys', 'spaceIds'])

  const loadout = registered.get('knowledge_loadout')
  assert.deepEqual(Object.keys(loadout.parameters.properties.input.properties), ['ifNoneMatch'])
  assert.equal(loadout.parameters.properties.input.properties.ifNoneMatch.pattern, '^[a-f0-9]{64}$')
  assert.equal(loadout.parameters.properties.input.additionalProperties, false)

  const confirm = registered.get('knowledge_confirm_memory')
  assert.deepEqual(confirm.parameters.properties.input.required, ['memoryId'])
  assert.equal(confirm.parameters.properties.input.properties.memoryId.format, 'uuid')

  const checkpoint = registered.get('knowledge_session_checkpoint')
  assert.equal(checkpoint.parameters.properties.input.properties.events.items.additionalProperties, false)
  assert.deepEqual(Object.keys(checkpoint.parameters.properties.input.properties.events.items.properties).sort(), ['seq', 'text', 'time', 'type'])
  assert.equal(checkpoint.parameters.properties.input.properties.candidateContents.items.properties.content.maxLength, 20000)
  assert.equal(checkpoint.parameters.properties.input.properties.events.maxItems, 50)

  const relations = registered.get('knowledge_relation_assertions')
  assert.deepEqual(relations.parameters.properties.input.properties.status.enum, [
    'EXTRACTED', 'VALIDATED', 'CANDIDATE', 'CONFIRMED', 'CONFLICTED', 'SUPERSEDED', 'REJECTED',
  ])

  const promote = registered.get('knowledge_promote')
  assert.equal(promote.parameters.properties.input.oneOf.length, 2)
  assert.deepEqual(promote.parameters.properties.input.oneOf.map(rule => rule.required), [['targetSpaceKey'], ['targetSpaceId']])
})

test('rejects invalid tool arguments before contacting the gateway', async () => {
  const registered = new Map()
  let calls = 0
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
  }, { fetch: async () => { calls += 1; return new Response('{}', { status: 200 }) } })

  const recall = registered.get('knowledge_recall')
  const result = await recall.execute({ input: { topK: 51 } }, {})
  assert.equal(result.ok, false)
  assert.equal(result.error, 'invalid_tool_arguments')
  assert.equal(calls, 0)
})

test('rejects invalid management actions before contacting the gateway', async () => {
  let route
  let calls = 0
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async () => { calls += 1; return new Response('{}', { status: 200 }) } })

  const response = await invoke(route, 'POST', { action: 'recall', input: { topK: 51 } })
  assert.equal(response.status, 400)
  assert.equal(response.body.reason, 'invalid_tool_arguments')
  assert.equal(calls, 0)
})

test('exposes explicit memory confirmation through the authenticated knowledge MCP route', async () => {
  const registered = new Map()
  const requests = []
  apply({
    credentials: { async resolve() { return { value: 'test-key', source: 'memory' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
  }, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { id: 'memory-1' } } }), { status: 200 })
    },
  })
  const tool = registered.get('knowledge_confirm_memory')
  assert.ok(tool)
  const result = await tool.execute({ input: { memoryId: '11111111-1111-4111-8111-111111111111', reason: 'user-confirmed', shareWithSpace: true } }, {})
  assert.equal(result.ok, true)
  assert.equal(requests[0].url, MCP_URL)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key')
  assert.equal(JSON.parse(requests[0].init.body).params.name, 'knowledge.confirm_memory')
})

test('localizes knowledge source state and isolates its overlay', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['yk-source', 'credential-store', 'stateCss', 'overviewSource', 'pendingImports', 'yk-graph-canvas', 'yk-memory-row', '"aria-label": t("recallPlaceholder")', '"aria-label": t("graphPlaceholder")', 'style.textContent = css + stateCss', '.yk-overlay{position:fixed', '.yk-shell{display:grid', '.yk-content{min-height:0']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
})

test('generated client bundle is valid JavaScript and has no unresolved style token', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.doesNotMatch(source, /\$\{css\}/u)
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('lib/client.js', root))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('normalizes real MCP recall envelopes and graph layout states', async () => {
  const client = await loadClientTestApi()
  assert.equal(client.normalizeSourceState('healthy'), 'ready')
  assert.equal(client.normalizeSourceState('HEALTHY'), 'ready')
  assert.equal(client.normalizeSourceState('projected'), 'ready')
  assert.equal(client.normalizeSourceState('queued'), 'queued')
  assert.equal(client.normalizeSourceState('unconfigured'), 'unavailable')
  const memories = client.recallItems({ structuredContent: { list: [
    { kind: 'document', id: 'document-1', content: 'policy' },
    { kind: 'memory', id: 'memory-1', content: 'approved process' },
  ] } })
  assert.equal(memories.length, 1)
  assert.equal(memories[0].id, 'memory-1')
  assert.equal(memories[0].status, 'CONFIRMED')
  assert.equal(Array.isArray(client.toolData({ content: [{ type: 'text', text: '{"list":[]}' }] }).list), true)
  const t = key => ({ authRequired: 'auth', permissionDenied: 'permission', requestTimeout: 'timeout', serviceUnavailable: 'service', actionFailed: 'generic' })[key]
  assert.equal(client.actionErrorLabel({ code: 'knowledge_mcp_http_401' }, t), 'auth')
  assert.equal(client.actionErrorLabel({ code: 'knowledge_mcp_http_403' }, t), 'permission')
  assert.equal(client.actionErrorLabel({ code: 'knowledge_mcp_timeout' }, t), 'timeout')
  assert.equal(client.actionErrorLabel({ code: 'knowledge_mcp_request_failed' }, t), 'service')
  assert.equal(client.actionErrorLabel({ code: 'unexpected_backend_detail' }, t), 'generic')
  const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `memory-${index}`, type: 'MEMORY' }))
  const layout = client.graphLayout(nodes)
  assert.ok(layout.canvasHeight > 700)
  assert.ok(layout.canvasHeight > layout.positions.get('memory-11').y)
  const types = client.graphTypeCounts({ nodes: [{ type: 'MEMORY' }, { type: 'MEMORY' }, { type: 'DOCUMENT' }], edges: [{ type: 'SUPPORTS' }] })
  assert.equal(types.nodes.MEMORY, 2)
  assert.equal(types.nodes.DOCUMENT, 1)
  assert.equal(types.edges.SUPPORTS, 1)
})

test('declares structured tool output required by DSH alpha3', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8')
  assert.match(source, /output:\s*TOOL_OUTPUT/u)
  assert.match(source, /schema:\s*\{/u)
  assert.match(source, /render:\s*\(/u)
})

test('routes host actions through the public MCP gateway and credential store', async () => {
  let route
  const requests = []
  apply({
    credentials: { async resolve(name) { assert.equal(name, 'MODELS_API_KEY'); return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { ok: true } } }), { status: 200 }) } })
  const response = await invoke(route, 'POST', { action: 'search', input: { query: '优惠豚' } })
  assert.equal(response.status, 200)
  assert.equal(requests[0].url, MCP_URL)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key')
  assert.equal(JSON.parse(requests[0].init.body).params.name, 'knowledge.search')
})

test('routes graph exploration through the public MCP gateway', async () => {
  let route
  const requests = []
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { nodes: [], edges: [] } } }), { status: 200 }) } })
  const response = await invoke(route, 'POST', { action: 'graph', input: { query: '优惠豚企业空间', limit: 200 } })
  assert.equal(response.status, 200)
  assert.equal(requests[0].url, MCP_URL)
  assert.equal(JSON.parse(requests[0].init.body).params.name, 'knowledge.graph')
})

test('routes memory forget with the required audit reason', async () => {
  let route
  const requests = []
  apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, { fetch: async (url, init) => { requests.push({ url: String(url), init }); return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { status: 'FORGOTTEN' } } }), { status: 200 }) } })
  const input = { memoryId: '40000000-0000-4000-8000-000000000001', reason: 'user-requested-forget' }
  const response = await invoke(route, 'POST', { action: 'forget', input })
  assert.equal(response.status, 200)
  const rpc = JSON.parse(requests[0].init.body)
  assert.equal(rpc.params.name, 'knowledge.forget')
  assert.deepEqual(rpc.params.arguments, input)
})

test('audits knowledge writes from Agent and UI while excluding reads and input bodies', async () => {
  let route
  const registered = new Map()
  const events = []
  const ctx = {
    credentials: { async resolve() { return { value: 'test-key' } } },
    yootunAudit: { async record(event) { events.push(event); return { status: 'stored', clientEventId: 'event-1' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }
  apply(ctx, { fetch: async (_url, init) => {
    const rpc = JSON.parse(init.body)
    const id = rpc.params.name === 'knowledge.ingest_file' ? 'document-7' : 'memory-7'
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { id, status: 'candidate' } } }), { status: 200 })
  } })

  await registered.get('knowledge_search').execute({ input: { query: '不得进入审计的搜索正文' } }, {})
  await registered.get('knowledge_remember').execute({ input: { content: '不得进入审计的知识正文' } }, {})
  await invoke(route, 'POST', { action: 'forget', input: { memoryId: '40000000-0000-4000-8000-000000000007', reason: '不得进入审计的原因正文' } })

  assert.equal(events.length, 2)
  assert.deepEqual(events[0], {
    actionCode: 'knowledge.memory.remembered', category: 'create',
    source: { pluginId: '@dofe/dsh-yootun-knowledge', pluginVersion: '0.2.0', surface: 'agent_tool' },
    target: { type: 'memory', id: 'memory-7' }, outcome: 'succeeded',
    changes: [{ field: 'status', after: 'candidate' }], effects: [],
  })
  assert.equal(events[1].actionCode, 'knowledge.memory.forgotten')
  assert.equal(events[1].source.surface, 'human_ui')
  assert.equal(events[1].target.id, 'memory-7')
  assert.doesNotMatch(JSON.stringify(events), /不得进入审计/u)
})

test('marks an MCP result envelope error as a failed knowledge write', async () => {
  const registered = new Map()
  const events = []
  const ctx = {
    credentials: { async resolve() { return { value: 'test-key' } } },
    yootunAudit: { async record(event) { events.push(event); return { status: 'stored', clientEventId: 'event-1' } } },
    tools: { register(tool) { registered.set(tool.name, tool); return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register() { return () => {} } },
  }
  apply(ctx, { fetch: async () => new Response(JSON.stringify({
    jsonrpc: '2.0', result: { isError: true, content: [{ type: 'text', text: 'private failure detail' }] },
  }), { status: 200 }) })

  await registered.get('knowledge_remember').execute({ input: { content: '不得进入审计' } }, {})

  assert.equal(events.length, 1)
  assert.equal(events[0].outcome, 'failed')
  assert.equal(events[0].errorCode, 'knowledge_mcp_tool_failed')
  assert.doesNotMatch(JSON.stringify(events), /private failure detail|不得进入审计/u)
})

test('GET overview reads overview and capabilities through the public MCP contract', async () => {
  let route
  const requests = []
  apply({
    credentials: { async resolve() { return { value: 'test-key', source: 'memory' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      assert.equal(String(url), MCP_URL)
      const rpc = JSON.parse(init.body)
      const data = rpc.params.name === 'knowledge.overview' ? {
        spaces: { total: 4 }, document_count: 58, memories: 121, pending_imports: 2,
        recent_documents: [{ id: 'd-1', title: '会员政策', updated_at: '2026-09-01T00:00:00Z' }],
      } : { contractVersion: '2026-09-05', tools: Object.values(ACTIONS) }
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: data } }), { status: 200 })
    },
  })

  const response = await invoke(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ready')
  assert.equal(response.body.mcp.auth, 'credential-store')
  assert.equal(response.body.templates.length, 1)
  assert.equal(response.body.contract.status, 'ready')
  assert.deepEqual(response.body.overview.data, {
    spaces: 4, documents: 58, memories: 121, pendingImports: 2,
    recentDocuments: [{ id: 'd-1', title: '会员政策', content: '', status: '', type: '', scope: '', sourceType: '', updatedAt: '2026-09-01T00:00:00Z' }],
    recentMemories: [], ingestion: { queued: null, processing: null, failed: null }, health: {},
  })
  assert.equal(requests.length, 2)
  assert.ok(requests.every(request => request.url === MCP_URL))
  assert.ok(requests.every(request => request.init.headers.Authorization === 'Bearer test-key'))
})

test('GET overview failure stays isolated from route facts and templates', async () => {
  let route
  apply({
    credentials: { async resolve() { return { value: 'test-key', source: 'memory' } } },
    tools: { register() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register(value) { route = value; return () => {} } },
  }, {
    fetch: async url => {
      if (String(url) === MCP_URL) return new Response('upstream failed', { status: 503 })
      throw new Error(`unexpected URL ${String(url)}`)
    },
  })

  const response = await invoke(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ready')
  assert.equal(response.body.mcp.route, MCP_URL)
  assert.equal(response.body.templates.length, 1)
  assert.equal(response.body.contract.status, 'error')
  assert.equal(response.body.contract.reason, 'knowledge_mcp_http_503')
  assert.equal(response.body.overview.status, 'error')
  assert.equal(response.body.overview.reason, 'knowledge_mcp_http_503')
})

async function invoke(route, method, body) {
  let status = 0
  const headers = {}
  let output = ''
  const req = { method, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) } }
  const res = { writeHead(code, values) { status = code; Object.assign(headers, values) }, end(value) { output = value || '' } }
  await route.handler(req, res)
  return { status, headers, body: output ? JSON.parse(output) : null }
}
