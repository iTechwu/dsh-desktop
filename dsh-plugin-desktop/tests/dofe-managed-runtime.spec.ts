import { describe, expect, it, vi } from 'vitest'
import { apply, DOFE_MCP_BASE_URL } from '../src/dofe-managed.ts'
import { DOFE_ACCESS_VALIDATION_VERSION, DEFAULT_DOFE_PLUGIN_IDS, normalizeDofePluginIds, type DofeAccessSettings } from '../src/dofe-plugins.ts'
import { BRAND_VARIANT } from '../src/generated-product-identity.ts'

// The first three created clients before the simulated 4th route failure;
// yootun leads with its exclusive GEO plugins, sensteed with shared routes.
const BRAND_LEADING_SERVER_NAMES = BRAND_VARIANT === 'sensteed'
  ? ['openmontage', 'media', 'tools-platform']
  : ['geoflow', 'georank', 'openmontage']

function createHarness(settings: DofeAccessSettings, failAt = Number.POSITIVE_INFINITY) {
  const clients: Array<{ config: Record<string, unknown>; dispose: ReturnType<typeof vi.fn> }> = []
  const errors: unknown[][] = []
  let pluginCalls = 0
  const access = {
    get: () => settings,
    watch: vi.fn(),
  }
  const ctx = {
    settings: { register: vi.fn(() => access), update: vi.fn(async () => {}) },
    // The sensteed branch builds its SSO service on the credential store; this
    // harness holds no saved grant, so the periodic restore stays idle.
    credentials: { resolve: vi.fn(async () => ({ value: 'test-managed-key' })), readRecord: vi.fn(async () => undefined) },
    systemPrompt: { section: vi.fn() },
    desktopRuntime: {
      registerTrayItem: vi.fn(() => ({ refresh: vi.fn(), dispose: vi.fn() })),
      openOpenMontage: vi.fn(async () => {}),
    },
    plugin: vi.fn(async (_plugin: unknown, config: Record<string, unknown>) => {
      pluginCalls += 1
      if (pluginCalls === failAt) throw new Error('transport failed with test-managed-key')
      const client = { config, dispose: vi.fn() }
      clients.push(client)
      return client
    }),
    on: vi.fn(),
    effect: vi.fn(),
    // The sensteed brand branch provides the SSO auth service; production
    // hands it to the Host plugin through this seam.
    provide: vi.fn(),
    logger: { error: vi.fn((...args: unknown[]) => errors.push(args)) },
  }
  return { ctx, access, clients, errors }
}

describe('dofe-managed MCP runtime', () => {
  it('creates only enabled routes and keeps wrapper capabilities out of MCP clients', async () => {
    const harness = createHarness({
      setupComplete: true,
      validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      // openmontage is the dedicated-route plugin shared by every brand.
      enabledPlugins: ['openmontage'],
      modelId: 'deepseek-chat',
      protocol: 'chat-completions',
      // The sensteed brand additionally requires a bound SSO identity.
      authMode: 'feishu',
      identity: { ssoSub: 'test-user', name: 'Test User' },
      entitlements: { plugins: ['openmontage'], defaultModel: 'deepseek-chat', allowedProtocols: ['chat-completions'] },
    })

    await apply(harness.ctx as never)

    expect(harness.clients).toHaveLength(1)
    expect(harness.clients[0]?.config).toMatchObject({
      serverName: 'openmontage',
      url: DOFE_MCP_BASE_URL + '/montage',
      toolCallTimeoutMs: 600_000,
      transport: 'streamable-http',
      failOnStartupError: false,
    })
    expect(harness.clients[0]?.config).not.toHaveProperty('plugin', 'opencli')
    expect(harness.clients[0]?.config).not.toHaveProperty('serverName', 'knowledge')
  })

  it('disposes partial clients after activation failure without logging the managed key', async () => {
    const harness = createHarness({
      setupComplete: true,
      validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      enabledPlugins: DEFAULT_DOFE_PLUGIN_IDS,
      modelId: 'deepseek-chat',
      protocol: 'chat-completions',
      // The sensteed brand additionally requires a bound SSO identity.
      authMode: 'feishu',
      identity: { ssoSub: 'test-user', name: 'Test User' },
      entitlements: { plugins: normalizeDofePluginIds(DEFAULT_DOFE_PLUGIN_IDS, BRAND_VARIANT), defaultModel: 'deepseek-chat', allowedProtocols: ['chat-completions'] },
    }, 4)

    await apply(harness.ctx as never)

    expect(harness.clients).toHaveLength(3)
    // Route order is brand-specific: yootun leads with the GEO plugins,
    // sensteed with the shared video/media/tooling routes.
    expect(harness.clients.map(client => client.config.serverName)).toEqual(BRAND_LEADING_SERVER_NAMES)
    expect(harness.errors).toEqual([['dofe-managed: failed to activate one or more MCP clients']])
    for (const client of harness.clients) expect(client.dispose).toHaveBeenCalledOnce()
  })
})
