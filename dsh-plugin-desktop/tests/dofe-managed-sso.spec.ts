import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/dofe-managed.ts'
import { DOFE_ACCESS_VALIDATION_VERSION } from '../src/dofe-plugins.ts'

vi.mock('../src/generated-product-identity.ts', () => ({ BRAND_VARIANT: 'sensteed', BRAND_TENANT: 'sensteed' }))

function harness(overrides = {}) {
  let settings = {
    setupComplete: true, validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
    modelId: 'model-a', protocol: 'messages', enabledPlugins: ['media', 'openmontage'],
    authMode: 'feishu', identity: { ssoSub: 'user-1', name: 'User' },
    entitlements: { plugins: ['media', 'openmontage'], allowedProtocols: ['messages'], defaultModel: '' },
    ...overrides,
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
  return {
    ctx,
    tray,
    getSettings: () => settings,
    forgetGrant: () => { grant = undefined },
    dispose: async () => { for (const effect of effects) await effect() },
  }
}

const discovery = {
  issuer: 'https://sso.ixicai.cn/api',
  authorization_endpoint: 'https://sso.ixicai.cn/api/oauth/authorize',
  token_endpoint: 'https://sso.ixicai.cn/api/oauth/token',
  userinfo_endpoint: 'https://sso.ixicai.cn/api/oauth/userinfo',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Sensteed startup authorization', () => {
  it('renews identity and removes withdrawn capabilities before starting MCP', async () => {
    const h = harness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(discovery))
      .mockImplementationOnce(async () => {
        // The refresh runs before any gate reset: the last good state stays up
        // until the renewal finishes.
        expect(h.ctx.plugin).not.toHaveBeenCalled()
        return json({ access_token: 'access-new', refresh_token: 'refresh-new' })
      }).mockResolvedValueOnce(json({
        key: 'model-key', user: { ssoSub: 'user-1', name: 'User' },
        tenant: { tenantId: 'tenant', ssoTeamId: 'team', tenantSlug: 'sensteed' },
        entitlements: { plugins: ['media'], allowedProtocols: ['messages'] },
      })).mockResolvedValueOnce(json({ sub: 'user-1', name: 'User', picture: 'https://sso.ixicai.cn/avatar/user-1.png' })))
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

  it('keeps the last good gate state across a transient provisioning failure', async () => {
    const h = harness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(discovery))
      .mockResolvedValueOnce(json({ access_token: 'access-new' }))
      .mockResolvedValueOnce(json({ error: 'unavailable' }, 503)))
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(true)
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
    await h.dispose()
  })

  it('closes the gate when the home has no saved session', async () => {
    const h = harness()
    h.forgetGrant()
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(false)
    expect(h.ctx.plugin).not.toHaveBeenCalled()
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
    await h.dispose()
  })
})

it.each([true, false])('preserves setup completion (%s) while refreshing profile and departments every 15 minutes', async complete => {
  vi.useFakeTimers()
  const h = harness({ setupComplete: complete, validationVersion: 1 })
  let revision = 0
  let profileUnavailable = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('openid-configuration')) return json(discovery)
    if (url.endsWith('/token')) return json({ access_token: 'new-access', refresh_token: 'new-refresh' })
    if (url.endsWith('/userinfo')) return profileUnavailable ? json({}, 503) : json({ sub: 'user-1', name: `Name ${revision}`, picture: revision ? null : 'https://example.com/avatar.png' })
    return json({
      key: 'model-key', user: { ssoSub: 'user-1', name: 'Stale name' },
      tenant: { tenantId: 'tenant', ssoTeamId: 'team', tenantSlug: 'sensteed' },
      groups: [`department-${revision}`], groupNames: { [`department-${revision}`]: `Department ${revision}` },
      entitlements: { plugins: ['media', 'openmontage'], allowedProtocols: ['messages'] },
    })
  }))
  try {
    await apply(h.ctx as never)
    expect(h.getSettings().setupComplete).toBe(complete)
    expect(h.getSettings().validationVersion).toBe(complete ? DOFE_ACCESS_VALIDATION_VERSION : 1)
    expect(h.getSettings().identity).toMatchObject({ name: 'Name 0', avatar: 'https://example.com/avatar.png' })
    profileUnavailable = true
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(h.getSettings().setupComplete).toBe(complete)
    expect(h.getSettings().identity).toMatchObject({ name: 'Name 0', avatar: 'https://example.com/avatar.png' })
    profileUnavailable = false
    revision = 1
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(h.getSettings().setupComplete).toBe(complete)
    expect(h.getSettings().modelId).toBe('model-a')
    expect(h.getSettings().enabledPlugins).toEqual(['media', 'openmontage'])
    expect(h.getSettings().identity).toMatchObject({ name: 'Name 1', avatar: null, groups: ['department-1'], groupNames: { 'department-1': 'Department 1' } })
    expect(h.ctx.desktopRuntime.openExternal).not.toHaveBeenCalled()
  } finally { await h.dispose() }
})
