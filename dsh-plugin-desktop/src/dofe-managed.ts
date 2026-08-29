/** Built-in DoFe bundle: one managed key controls the CI model router and MCP tools. */
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyMcpClient, name as mcpClientName, inject as mcpClientInject } from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'dofe-managed'
export const inject = ['credentials', 'tools', 'systemPrompt']

export const MODELS_API_KEY = 'MODELS_API_KEY'
const MODELS_API_KEY_REF = credentialRef(MODELS_API_KEY)
const McpClient = { name: mcpClientName, inject: mcpClientInject, apply: applyMcpClient }
export const DOFE_MCP_BASE_URL = 'https://ixicai.cn/mcp'

const ROUTES: readonly { serverName: string; path: string; timeoutMs: number }[] = [
  { serverName: 'geoflow', path: 'geoflow', timeoutMs: 60_000 },
  { serverName: 'georank', path: 'georank', timeoutMs: 120_000 },
  { serverName: 'openmontage', path: 'montage', timeoutMs: 600_000 },
  ...[
    'platform', 'supply-chain', 'talent-discovery', 'lead-discovery', 'lead-monitor',
    'hotspot-discovery', 'custom-car-monitoring', 'viral-video', 'browser-intelligence',
  ].map(path => ({ serverName: `tools-${path}`, path: `tools/${path}`, timeoutMs: 60_000 })),
]

/**
 * Resolve the managed credential for each generation and rebuild MCP clients.
 * The MCP package accepts static headers, so rebuilding on the credential event
 * is the narrowest way to keep its transport aligned with the credential seam.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.systemPrompt.section({
    name: 'dofe:managed-access',
    order: 4,
    text: 'DoFe 托管能力：模型请求统一使用 CI Model Router；涉及 GEO、商业工具或视频生成时，优先使用已加载的 mcp__geoflow__、mcp__georank__、mcp__tools-* 与 mcp__openmontage__ 工具。不要要求用户再次提供模型或插件 API key。',
  })
  let clients: { dispose(): void | Promise<void> }[] = []
  let reload: Promise<void> = Promise.resolve()

  const reconcile = async (): Promise<void> => {
    const resolved = await ctx.credentials.resolve(MODELS_API_KEY_REF)
    const next = resolved?.value
    const old = clients
    clients = []
    await Promise.all(old.map(client => client.dispose()))
    if (!next) return

    const created: { dispose(): void | Promise<void> }[] = []
    try {
      for (const route of ROUTES) {
        const config: McpConfig = {
          transport: 'streamable-http',
          serverName: route.serverName,
          url: `${DOFE_MCP_BASE_URL}/${route.path}`,
          headers: { Authorization: `Bearer ${next}` },
          toolCallTimeoutMs: route.timeoutMs,
          failOnStartupError: false,
          reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
        }
        created.push(await ctx.plugin(McpClient, config))
      }
      clients = created
    } catch (error) {
      await Promise.all(created.map(client => client.dispose()))
      ctx.logger.error('dofe-managed: failed to activate one or more MCP clients')
      // Do not serialize the transport error: some HTTP clients include
      // request metadata, and the Authorization header must never reach logs.
      void error
    }
  }

  const schedule = (): void => {
    reload = reload.then(reconcile, reconcile)
  }

  schedule()
  ctx.on('credentials/reference-updated', ref => {
    if (ref === MODELS_API_KEY) schedule()
  })
  ctx.effect(() => () => {
    const current = clients
    clients = []
    void Promise.all(current.map(client => client.dispose()))
  }, 'dofe-managed: dispose MCP clients')
  await reload
}
