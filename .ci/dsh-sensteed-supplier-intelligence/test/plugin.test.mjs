import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

function loadHost(names = []) {
  const tools = new Map()
  const sections = []
  return import('../index.js').then(({ apply }) => {
    apply({
      tools: {
        schemas: () => names.map(name => ({ name })),
        register(value) { tools.set(value.name, value); return () => {} },
      },
      systemPrompt: { section(value) { sections.push(value); return () => {} } },
    })
    return { tools, sections }
  })
}

test('package registers the supply-chain MCP patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.equal(manifest.name, '@dofe/dsh-sensteed-supplier-intelligence')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(patch, /serverName: supply-chain/u)
  assert.match(patch, /https:\/\/api\.tools\.dofe\.ai\/mcp\/supply-chain/u)
  assert.doesNotMatch(patch, /authorizationCredential|api[_-]?key|token/u)
})

test('loads the skill as system guidance and registers a read-only bootstrap', async () => {
  const { tools, sections } = await loadHost(['mcp__supply-chain__supply_chain_suppliers_list'])
  assert.equal(sections[0].name, 'sensteed:supplier-intelligence-skill')
  assert.match(sections[0].text, /供应商全量归集与舆情分析/u)
  assert.match(sections[0].text, /QCC_MCP_UNAVAILABLE/u)
  const bootstrap = tools.get('sensteed_supplier_intelligence_bootstrap')
  assert.ok(bootstrap)
  assert.equal(bootstrap.isConcurrencySafe(), true)
  const result = await bootstrap.execute({})
  assert.equal(result.result.dataSource, 'local_tool_catalog')
  assert.equal(result.result.externalCallMade, false)
})

test('skill preserves cache, verification, idempotency, and evidence boundaries', async () => {
  const skill = await readFile(new URL('skills/supplier-intelligence/SKILL.md', root), 'utf8')
  for (const token of [
    '30 分钟数据库优先缓存',
    'confirm=true',
    '稳定 `idempotencyKey`',
    '已核验供应商',
    'entitlement_required',
    'externalCallMade=false',
    '不能写成企业事实',
  ]) assert.match(skill, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(skill, /Bearer\s+[A-Za-z0-9]/u)
})
