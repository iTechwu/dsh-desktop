import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { ACTIONS, COMPANY_TEMPLATES, MCP_URL, apply } from '../index.js'

const root = new URL('../', import.meta.url)

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
  for (const token of ['knowledge_search', 'knowledge_recall', 'knowledge_remember', 'knowledge_forget', 'knowledge_graph', 'credential-store', 'youhuitun-company']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(source, /127\.0\.0\.1|172\.30\.30\.11|knowledge\.local\.dofe\.ai/u)
  assert.deepEqual(Object.keys(ACTIONS), ['search', 'recall', 'remember', 'forget', 'graph'])
  assert.equal(COMPANY_TEMPLATES.length, 3)
})

test('localizes knowledge source state and isolates its overlay', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['source', 'routeStatus', 'credential-store', 'stateCss', 'reason', 'style.textContent = css + stateCss', '.yk-overlay{position:fixed', '.yk-shell{display:grid', '.yk-content{min-height:0']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
})

test('generated client bundle is valid JavaScript and has no unresolved style token', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.doesNotMatch(source, /\$\{css\}/u)
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('lib/client.js', root))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
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

async function invoke(route, method, body) {
  let status = 0
  const headers = {}
  let output = ''
  const req = { method, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) } }
  const res = { writeHead(code, values) { status = code; Object.assign(headers, values) }, end(value) { output = value || '' } }
  await route.handler(req, res)
  return { status, headers, body: output ? JSON.parse(output) : null }
}
