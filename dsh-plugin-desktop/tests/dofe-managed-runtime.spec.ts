import { describe, expect, it, vi } from 'vitest'
import { apply, DOFE_MCP_BASE_URL } from '../src/dofe-managed.ts'
import { DOFE_ACCESS_VALIDATION_VERSION, DEFAULT_DOFE_PLUGIN_IDS, type DofeAccessSettings } from '../src/dofe-plugins.ts'

function createHarness(settings: DofeAccessSettings, failAt = Number.POSITIVE_INFINITY) {
  const clients: Array<{ config: Record<string, unknown>; dispose: ReturnType<typeof vi.fn> }> = []
  const errors: unknown[][] = []
  let pluginCalls = 0
  const access = {
    get: () => settings,
    watch: vi.fn(),
  }
  const ctx = {
    settings: { register: vi.fn(() => access) },
    credentials: { resolve: vi.fn(async () => ({ value: 'test-managed-key' })) },
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
    logger: { error: vi.fn((...args: unknown[]) => errors.push(args)) },
  }
  return { ctx, access, clients, errors }
}

describe('dofe-managed MCP runtime', () => {
  it('creates only enabled routes and keeps wrapper capabilities out of MCP clients', async () => {
    const harness = createHarness({
      setupComplete: true,
      validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
      enabledPlugins: ['georank'],
      modelId: 'deepseek-chat',
    })

    await apply(harness.ctx as never)

    expect(harness.clients).toHaveLength(1)
    expect(harness.clients[0]?.config).toMatchObject({
      serverName: 'georank',
      url: DOFE_MCP_BASE_URL + '/georank',
      toolCallTimeoutMs: 120_000,
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
    }, 4)

    await apply(harness.ctx as never)

    expect(harness.clients).toHaveLength(3)
    expect(harness.clients.map(client => client.config.serverName)).toEqual(['geoflow', 'georank', 'openmontage'])
    expect(harness.errors).toEqual([['dofe-managed: failed to activate one or more MCP clients']])
    for (const client of harness.clients) expect(client.dispose).toHaveBeenCalledOnce()
  })
})
