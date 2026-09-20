// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DofeAccessGate } from '../src/client/DofeAccessSection.tsx'

vi.mock('../src/generated-product-identity.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/generated-product-identity.ts')>(),
  BRAND_VARIANT: 'sensteed', BRAND_TENANT: 'sensteed',
}))
afterEach(() => vi.unstubAllGlobals())

it('completes first login with the catalog default and commits authorization last', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let snapshot = { value: { setupComplete: false, validationVersion: 0, enabledPlugins: [], modelId: '', protocol: 'chat-completions' } as Record<string, unknown> }
  let configured = false
  const listeners = new Set<() => void>()
  const writes: string[] = []
  const settingsScope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const settingsApi = {
    describe: async () => ({ ok: true, value: { namespaces: ['dofe-access', 'llm-pi-ai', 'agent-default-model'].map(ns => ({ ns, revision: 1 })) } }),
    mutate: vi.fn(async (ns: string, operations: Array<{ path: string[]; value?: unknown }>) => {
      writes.push(ns)
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
      return Response.json({ status: 'bound', user: { ssoSub: 'user', name: 'User' }, entitlements: { plugins: ['knowledge'], defaultModel: 'preferred-model', allowedProtocols: ['messages'] } })
    }
    return Response.json({ models: [{ id: 'first-model' }, { id: 'preferred-model' }] })
  }))
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(DofeAccessGate, {
      settingsApi, settingsScope,
      credentials: { describe: async () => ({ ok: true, value: { MODELS_API_KEY: { configured } } }) },
      t: (key: string) => key,
    } as never)))
    expect(container.querySelector('input[type="password"]')).toBeNull()
    await act(async () => {
      const login = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('飞书登录'))!
      login.click()
    })
    expect(snapshot.value.setupComplete).toBe(true)
    expect(snapshot.value.modelId).toBe('preferred-model')
    expect(snapshot.value.protocol).toBe('messages')
    expect(writes.slice(-3)).toEqual(['llm-pi-ai', 'agent-default-model', 'dofe-access'])
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
