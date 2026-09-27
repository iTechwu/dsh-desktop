// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SensteedUserSettingsTrigger } from '../src/client/SensteedUserSettingsTrigger.tsx'
import { applyDofeAccess } from '../src/client/register-dofe-access.ts'
import { DOFE_ACCESS_COPY } from '../src/client/dofe-access.ts'

vi.mock('../src/generated-product-identity.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/generated-product-identity.ts')>(),
  BRAND_VARIANT: 'sensteed', BRAND_TENANT: 'sensteed',
}))
afterEach(() => vi.unstubAllGlobals())

it('updates the sidebar identity on account changes and keeps an avatar when collapsed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let snapshot = { value: { authMode: 'feishu', identity: { name: '吴敏', avatar: 'https://example.com/avatar.png' } } } as { value: Record<string, unknown> }
  const listeners = new Set<() => void>()
  const settingsScope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(SensteedUserSettingsTrigger, { wide: true, settingsScope } as never)))
    expect(container.textContent).toBe('吴敏')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/avatar.png')
    expect(container.querySelector('svg')).toBeNull()
    await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
    await act(async () => {
      snapshot = { value: { authMode: 'feishu', identity: { name: '新姓名', avatar: 'https://example.com/new-avatar.png' } } }
      listeners.forEach(listener => listener())
    })
    expect(container.textContent).toBe('新姓名')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/new-avatar.png')
    expect(container.querySelector('svg')).toBeNull()
    await act(async () => root.render(createElement(SensteedUserSettingsTrigger, { wide: false, settingsScope } as never)))
    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('.dshSensteedUserSettingsName')).toBeNull()
    await act(async () => {
      snapshot = { value: { authMode: 'manual' } }
      listeners.forEach(listener => listener())
      root.render(createElement(SensteedUserSettingsTrigger, { wide: true, settingsScope } as never))
    })
    expect(container.textContent).toBe('用户')
    expect(container.querySelector('img')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('registers user settings before General so each normal settings open defaults to it', () => {
  const register = vi.fn()
  const bind = vi.fn(() => (key: keyof typeof DOFE_ACCESS_COPY.zh) => DOFE_ACCESS_COPY.zh[key])
  applyDofeAccess({
    effect: vi.fn(), locale: { bind }, configForms: { get: () => ({}) }, remote: {},
    slots: { inject: (_name: string, callback: () => void) => callback(), register },
  } as never)
  const section = register.mock.calls.find(([options]) => options.name === 'settings.section')![0]
  const trigger = register.mock.calls.find(([options]) => options.name === 'settings.trigger')![0]
  expect(section.order).toBeLessThan(0)
  expect(section.label()).toBe('用户设置')
  expect(trigger.priority).toBeLessThan(0)
})
