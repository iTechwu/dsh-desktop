/** Knowledge managed route and Runtime Memory integration contract. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOFE_MCP_BASE_URL, MODELS_API_KEY } from '../src/dofe-managed.ts'

const managedSource = readFileSync(new URL('../src/dofe-managed.ts', import.meta.url), 'utf8')
const desktopPatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const captureSource = readFileSync(
  new URL('../../scripts/ci-snapshots/dsh-knowledge-capture/index.js', import.meta.url),
  'utf8',
)
const knowledgeSource = readFileSync(
  new URL('../../.ci/dsh-yootun-knowledge/index.js', import.meta.url),
  'utf8',
)

describe('dofe-managed Knowledge route', () => {
  it('keeps Knowledge on its wrapper-plugin surface', () => {
    expect(DOFE_MCP_BASE_URL).toBe('https://ixicai.cn/mcp')
    expect(MODELS_API_KEY).toBe('MODELS_API_KEY')
    expect(managedSource).not.toMatch(/serverName: 'knowledge'/)
    expect(managedSource).toContain('knowledge_*')
    expect(managedSource).not.toContain('mcp__knowledge__')
    expect(managedSource).not.toMatch(/KNOWLEDGE_API_KEY|knowledge\.dofe\.ai|172\.30\.30\.11|127\.0\.0\.1|localhost/)
  })

  it('keeps the Knowledge workspace and Runtime bridge in the Desktop bundle', () => {
    expect(desktopPatch).toContain("name: '@dofe/dsh-yootun-knowledge'")
    expect(desktopPatch).toContain("name: '@dofe/dsh-knowledge-capture'")
    expect(captureSource).toContain("'knowledge.session_checkpoint'")
    expect(captureSource).toContain("'knowledge.context_pack'")
    expect(captureSource).toContain("'knowledge.loadout'")
  })

  it('exposes the complete current Knowledge MCP surface and role-key addressing', () => {
    for (const tool of [
      'knowledge.session_checkpoint', 'knowledge.promote', 'knowledge.capabilities',
      'knowledge.overview', 'knowledge.loadout', 'knowledge.context_pack',
      'knowledge.explain_trace', 'knowledge.entity_assertions', 'knowledge.relation_assertions',
      'knowledge.entity_merges', 'knowledge.provenance_lineage',
    ]) expect(knowledgeSource).toContain(tool)
    expect(knowledgeSource).toContain("spaceKey: 'tenant.all'")
    expect(captureSource).toContain("const RUNTIME_SPACE_KEY = 'user.agent_runtime'")
  })
})
