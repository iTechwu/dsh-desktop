// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DofeAccessGate, DofeAccessSection } from '../src/client/DofeAccessSection.tsx'

vi.mock('../src/generated-product-identity.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/generated-product-identity.ts')>(),
  BRAND_VARIANT: 'sensteed', BRAND_TENANT: 'sensteed',
}))
afterEach(() => vi.unstubAllGlobals())

it('requires login before showing model setup and commits authorization only after setup', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let snapshot = { value: { setupComplete: false, validationVersion: 0, enabledPlugins: [], modelId: '', protocol: 'chat-completions' } as Record<string, unknown> }
  let configured = false
  const listeners = new Set<() => void>()
  const writes: string[] = []
  let rejectModelConfig = false
  const settingsScope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const settingsApi = {
    describe: async () => ({ ok: true, value: { namespaces: ['dofe-access', 'llm-pi-ai', 'agent-default-model'].map(ns => ({ ns, revision: 1 })) } }),
    mutate: vi.fn(async (ns: string, operations: Array<{ path: string[]; value?: unknown }>) => {
      writes.push(ns)
      if (ns === 'llm-pi-ai' && rejectModelConfig) return { ok: false, error: { message: '保存模型失败' } }
      if (ns === 'dofe-access') {
        snapshot = { value: { ...snapshot.value, ...Object.fromEntries(operations.map(op => [op.path[0], op.value])) } }
        for (const listener of listeners) listener()
      }
      return { ok: true }
    }),
  }
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path.endsWith('/session')) {
      configured = true
      return Response.json({ status: 'bound', user: { ssoSub: 'user', name: 'User', avatar: 'https://example.com/avatar.png' }, entitlements: { plugins: ['knowledge'], defaultModel: 'preferred-model', allowedProtocols: ['messages'] } })
    }
    return Response.json({ models: [{ id: 'first-model' }, { id: 'preferred-model' }] })
  }))
  const credentials = {
    describe: async () => ({ ok: true, value: { MODELS_API_KEY: { configured } } }),
    unset: vi.fn(async () => { configured = false; return { ok: true } }),
  }
  const props = { settingsApi, settingsScope, credentials, t: (key: string) => key }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(DofeAccessGate, props as never)))
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    await act(async () => {
      const login = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('飞书登录'))!
      login.click()
    })
    expect(snapshot.value.setupComplete).toBe(false)
    expect(snapshot.value.modelId).toBe('')
    expect(snapshot.value.protocol).toBe('messages')
    expect(container.querySelector('select')).not.toBeNull()
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('preferred-model')
    expect(writes).toEqual(['dofe-access'])
    expect(container.textContent).not.toContain('飞书登录')
    expect(container.querySelector('.dshDofeAccessIdentityName')?.textContent).toBe('User')
    expect(container.querySelector('.dshDofeAccessAvatar img')?.getAttribute('src')).toBe('https://example.com/avatar.png')
    const setup = [...container.querySelectorAll('.dshDofeAccessPrimary')].at(-1) as HTMLButtonElement
    rejectModelConfig = true
    await act(async () => setup.click())
    expect(snapshot.value.setupComplete).toBe(false)
    expect(document.body.textContent).not.toContain('loginSuccess')
    expect(container.textContent).toContain('保存模型失败')
    rejectModelConfig = false
    await act(async () => setup.click())
    expect(snapshot.value.setupComplete).toBe(true)
    expect(writes.slice(-3)).toEqual(['llm-pi-ai', 'agent-default-model', 'dofe-access'])
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('loginSuccess')
    await act(async () => root.render(createElement(Fragment, null,
      createElement(DofeAccessGate, props as never),
      createElement(DofeAccessSection, props as never),
    )))
    await act(async () => { (container.querySelector('.dshDofeAccessLogout') as HTMLButtonElement).click() })
    expect(credentials.unset).toHaveBeenCalledWith('MODELS_API_KEY')
    expect(snapshot.value.identity).toBeUndefined()
    expect(snapshot.value.setupComplete).toBe(false)
    const gate = container.querySelector('[role="dialog"]')!
    expect(gate).not.toBeNull()
    expect(gate.textContent).toContain('飞书登录')
    expect(gate.querySelector('select')).toBeNull()
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/logout'))).toBe(true)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
