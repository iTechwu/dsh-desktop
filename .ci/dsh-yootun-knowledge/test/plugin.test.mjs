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
  assert.match(patch, /serverName: knowledge/u)
  assert.match(patch, new RegExp(MCP_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
})

test('exposes governed knowledge, Memory, and graph tools without direct endpoints', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8')
  for (const token of ['knowledge_search', 'knowledge_recall', 'knowledge_remember', 'knowledge_confirm_memory', 'knowledge_forget', 'knowledge_graph', 'credential-store', 'youhuitun-company']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(source, /127\.0\.0\.1|172\.30\.30\.11|knowledge\.local\.dofe\.ai/u)
  assert.deepEqual(Object.keys(ACTIONS), ['search', 'recall', 'remember', 'confirm_memory', 'forget', 'graph', 'ingest_file'])
  assert.equal(COMPANY_TEMPLATES.length, 3)
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
  const result = await tool.execute({ input: { memoryId: 'memory-1', reason: 'user-confirmed', shareWithSpace: true } }, {})
  assert.equal(result.ok, true)
  assert.equal(requests[0].url, MCP_URL)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key')
  assert.equal(JSON.parse(requests[0].init.body).params.name, 'knowledge.confirm_memory')
})

test('localizes knowledge source state and isolates its overlay', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['yk-source', 'credential-store', 'stateCss', 'overviewSource', 'pendingImports', 'yk-graph-canvas', 'yk-memory-row', 'style.textContent = css + stateCss', '.yk-overlay{position:fixed', '.yk-shell{display:grid', '.yk-content{min-height:0']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
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

test('GET overview reads the public knowledge API envelope next to local route facts', async () => {
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
      if (String(url) === 'https://ixicai.cn/api/yootun/v1/knowledge/overview') {
        return new Response(JSON.stringify({
          data: {
            spaces: { total: 4 },
            document_count: 58,
            memories: 121,
            pending_imports: 2,
            recent_documents: [{ id: 'd-1', title: '会员政策', updated_at: '2026-09-01T00:00:00Z' }],
          },
          meta: { source: 'knowledge', requestId: 'r-k', generatedAt: '2026-09-01T00:00:00.000Z' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected URL ${String(url)}`)
    },
  })

  const response = await invoke(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ready')
  assert.equal(response.body.mcp.auth, 'credential-store')
  assert.equal(response.body.templates.length, 3)
  assert.equal(response.body.overview.status, 'ready')
  assert.deepEqual(response.body.overview.data, {
    spaces: 4, documents: 58, memories: 121, pendingImports: 2,
    recentDocuments: [{ id: 'd-1', title: '会员政策', content: '', status: '', type: '', scope: '', sourceType: '', updatedAt: '2026-09-01T00:00:00Z' }],
    recentMemories: [], ingestion: { queued: null, processing: null, failed: null }, health: {},
  })
  const overviewRequest = requests[0]
  assert.equal(overviewRequest.url, 'https://ixicai.cn/api/yootun/v1/knowledge/overview')
  assert.equal(overviewRequest.init.headers.Authorization, 'Bearer test-key')
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
      if (String(url).includes('/api/yootun/v1/knowledge/')) return new Response('upstream failed', { status: 503 })
      throw new Error(`unexpected URL ${String(url)}`)
    },
  })

  const response = await invoke(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ready')
  assert.equal(response.body.mcp.route, MCP_URL)
  assert.equal(response.body.templates.length, 3)
  assert.equal(response.body.overview.status, 'error')
  assert.equal(response.body.overview.reason, 'knowledge_http_503')
  assert.equal(response.body.overview.data, undefined)
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
