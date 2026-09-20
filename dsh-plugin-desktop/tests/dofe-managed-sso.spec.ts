import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/dofe-managed.ts'
import { DOFE_ACCESS_VALIDATION_VERSION } from '../src/dofe-plugins.ts'

vi.mock('../src/generated-product-identity.ts', () => ({ BRAND_VARIANT: 'sensteed', BRAND_TENANT: 'sensteed' }))

function harness() {
  let settings = {
    setupComplete: true, validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
    modelId: 'model-a', protocol: 'messages', enabledPlugins: ['media', 'openmontage'],
    authMode: 'feishu', identity: { ssoSub: 'user-1', name: 'User' },
    entitlements: { plugins: ['media', 'openmontage'], allowedProtocols: ['messages'], defaultModel: '' },
  }
  let grant: unknown = { kind: 'grant', payload: { refreshToken: 'refresh-old' } }
  const effects: Array<() => unknown> = []
  const tray = { enabled: () => false }
  const ctx = {
    settings: {
      register: () => ({ get: () => settings, watch: vi.fn() }),
      update: vi.fn(async (_ns, patch) => { settings = { ...settings, ...patch } }),
    },
    credentials: {
      readRecord: async () => grant,
      modifyRecord: async (_key: unknown, mutate: (value: unknown) => Promise<unknown>) => { grant = await mutate(grant) },
      set: vi.fn(), resolve: async () => ({ value: 'model-key' }),
    },
    desktopRuntime: {
      openExternal: vi.fn(), openOpenMontage: vi.fn(),
      registerTrayItem: (item: typeof tray) => { tray.enabled = item.enabled; return { refresh() {}, dispose() {} } },
    },
    systemPrompt: { section: vi.fn() },
    plugin: vi.fn(async () => ({ dispose() {} })),
    on: vi.fn(), provide: vi.fn(), logger: { error: vi.fn() },
    effect: (effect: () => (() => unknown)) => { effects.push(effect()) },
  }
  return { ctx, tray, getSettings: () => settings, dispose: async () => { for (const effect of effects) await effect() } }
}

const discovery = {
  issuer: 'https://sso.ixicai.cn/api',
  authorization_endpoint: 'https://sso.ixicai.cn/api/oauth/authorize',
  token_endpoint: 'https://sso.ixicai.cn/api/oauth/token',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => vi.unstubAllGlobals())

describe('Sensteed startup authorization', () => {
  it('renews identity and removes withdrawn capabilities before starting MCP', async () => {
    const h = harness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(discovery))
      .mockImplementationOnce(async () => {
        expect(h.getSettings().setupComplete).toBe(false)
        expect(h.ctx.plugin).not.toHaveBeenCalled()
        return json({ access_token: 'access-new', refresh_token: 'refresh-new' })
      }).mockResolvedValueOnce(json({
        key: 'model-key', user: { ssoSub: 'user-1', name: 'User' },
        tenant: { tenantId: 'tenant', ssoTeamId: 'team', tenantSlug: 'sensteed' },
        entitlements: { plugins: ['media'], allowedProtocols: ['messages'] },
      })))
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(true)
    expect(h.getSettings().enabledPlugins).toEqual(['media'])
    expect(h.ctx.plugin).toHaveBeenCalledOnce()
    expect(h.tray.enabled()).toBe(false)
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
    await h.dispose()
  })

  it('keeps the gate closed when the refresh grant expires', async () => {
    const h = harness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(discovery))
      .mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400)))
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(false)
    expect(h.ctx.plugin).not.toHaveBeenCalled()
    expect(h.tray.enabled()).toBe(false)
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
    await h.dispose()
  })
})
