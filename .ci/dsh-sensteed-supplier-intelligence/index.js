import { readFileSync } from 'node:fs'

const SKILL_URL = new URL('./skills/supplier-intelligence/SKILL.md', import.meta.url)
const REQUIRED_TOOLS = [
  'supply_chain_capabilities_get',
  'supply_chain_suppliers_list',
  'supply_chain_qcc_capabilities_get',
  'supply_chain_qcc_company_data_get',
  'supply_chain_qcc_company_data_list',
  'supply_chain_relationships_list',
  'supply_chain_intelligence_report_get',
  'supply_chain_social_monitoring_collect',
  'supply_chain_run_get',
]

export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  const disposers = []
  if (ctx.systemPrompt?.section) {
    disposers.push(ctx.systemPrompt.section({
      name: 'sensteed:supplier-intelligence-skill',
      order: 9,
      text: readFileSync(SKILL_URL, 'utf8'),
    }))
  }
  if (ctx.tools?.register) {
    disposers.push(ctx.tools.register({
      name: 'sensteed_supplier_intelligence_bootstrap',
      description: 'Inspect the local supply-chain tool catalog before supplier collection or public-opinion analysis. This tool is read-only.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: () => true,
      async execute() {
        const schemas = ctx.tools.schemas?.() || []
        const names = schemas.map(item => String(item.name || ''))
        const tools = Object.fromEntries(REQUIRED_TOOLS.map(name => [name, names.some(candidate => candidate.includes(name))]))
        const missing = Object.entries(tools).filter(([, available]) => !available).map(([name]) => name)
        return {
          ok: missing.length === 0,
          result: {
            dataSource: 'local_tool_catalog',
            externalCallMade: false,
            tools,
            missing,
            usage: 'Read database coverage first. Use QCC capability discovery before a cache-aware get. Submit social collection only for verified suppliers with a stable idempotencyKey and poll the original runId.',
          },
        }
      },
    }))
  }
  return () => disposers.reverse().forEach(dispose => dispose?.())
}
