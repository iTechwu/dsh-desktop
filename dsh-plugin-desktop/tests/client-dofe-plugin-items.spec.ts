// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DofePluginCard, dofePluginCardState, registerDofePluginItems } from '../src/client/DofePluginItems.tsx'
import { dofePluginsForBrand, DOFE_ACCESS_VALIDATION_VERSION, type DofeAccessSettings } from '../src/dofe-plugins.ts'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'

vi.mock('../src/generated-product-identity.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/generated-product-identity.ts')>(),
  BRAND_VARIANT: 'sensteed', BRAND_TENANT: 'sensteed',
}))

const t = (key: keyof typeof DOFE_ACCESS_COPY.zh) => DOFE_ACCESS_COPY.zh[key]

function settingsFixture(overrides: Partial<DofeAccessSettings> = {}): DofeAccessSettings {
  return {
    setupComplete: true,
    validationVersion: DOFE_ACCESS_VALIDATION_VERSION,
    enabledPlugins: ['tools', 'openmontage', 'media', 'opencli', 'knowledge'],
    modelId: 'model-a',
    protocol: 'messages',
    authMode: 'feishu',
    identity: { ssoSub: 'sub-1', name: '吴敏' },
    entitlements: { plugins: ['tools', 'openmontage', 'media', 'opencli', 'knowledge'], defaultModel: '', allowedProtocols: ['messages'] },
    ...overrides,
  }
}

function scopeFixture(settings: DofeAccessSettings | undefined) {
  const snapshot = { value: settings }
  return {
    getSnapshot: () => snapshot,
    subscribe: (_listener: () => void) => () => {},
  }
}

it('reports built-in, enabled, unentitled, and disabled card states from the access gate', () => {
  const finance = dofePluginsForBrand('sensteed').find(plugin => plugin.id === 'finance')!
  const tools = dofePluginsForBrand('sensteed').find(plugin => plugin.id === 'tools')!
  expect(dofePluginCardState(finance, settingsFixture())).toBe('built-in')
  expect(dofePluginCardState(tools, settingsFixture())).toBe('enabled')
  expect(dofePluginCardState(tools, settingsFixture({ entitlements: { plugins: ['media'], defaultModel: '', allowedProtocols: ['messages'] } }))).toBe('unentitled')
  expect(dofePluginCardState(tools, settingsFixture({ enabledPlugins: ['media'] }))).toBe('disabled')
  expect(dofePluginCardState(tools, settingsFixture({ setupComplete: false }))).toBe('disabled')
  expect(dofePluginCardState(tools, undefined)).toBe('disabled')
})

it('renders the summary one-liner and the detail page with its MCP servers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const plugin = dofePluginsForBrand('sensteed').find(entry => entry.id === 'tools')!
  const props = { view: 'summary', plugin, settingsScope: scopeFixture(settingsFixture()), t }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(DofePluginCard, props as never)))
    expect(container.querySelector('.dshDofePluginStateOn')?.textContent).toBe('已启用')
    expect(container.textContent).toContain('商业调研与热点工具集')
    await act(async () => root.render(createElement(DofePluginCard, { ...props, view: 'page' } as never)))
    expect(container.textContent).toContain('MCP 数据源')
    expect(container.querySelectorAll('.dshDofePluginServer')).toHaveLength(plugin.servers.length)
    expect(container.textContent).toContain('在 设置 → 用户设置 中调整这些能力的开关。')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('registers one read-only card per brand capability after the upstream official plugins', () => {
  const registered: Array<{ options: { name: string; id: string; order: number; label: () => string }; component: unknown }> = []
  const ctx = {
    slots: {
      inject: (_name: string, callback: () => () => void) => { callback() },
      register: (options: { name: string; id: string; order: number; label: () => string }, component: unknown) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  registerDofePluginItems(ctx as never, scopeFixture(settingsFixture()) as never, t)
  const sensteed = dofePluginsForBrand('sensteed')
  expect(registered).toHaveLength(sensteed.length)
  expect(registered.map(entry => entry.options.id)).toEqual(sensteed.map(plugin => `dofe-${plugin.id}`))
  for (const entry of registered) {
    expect(entry.options.order).toBeGreaterThanOrEqual(100)
    expect(entry.options.label()).toBeTypeOf('string')
    expect(entry.component).toBeTypeOf('function')
  }
})
