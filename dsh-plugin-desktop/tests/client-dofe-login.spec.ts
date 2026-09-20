// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DofeLoginSection } from '../src/client/DofeLoginSection.tsx'

let root: Root | undefined
let container: HTMLDivElement
async function mount(onBound = vi.fn()) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(createElement(DofeLoginSection, { disabled: false, onBound })) })
}
afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('Feishu login', () => {
  it('hands an already bound session to the activation form without exposing keys', async () => {
    const snapshot = { status: 'bound', user: { ssoSub: 'user-a', name: 'Alice' }, entitlements: { plugins: ['knowledge'], allowedProtocols: ['messages'], defaultModel: '' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot))))
    const bound = vi.fn()
    await mount(bound)
    await act(async () => { container.querySelector('button')!.click() })
    expect(bound).toHaveBeenCalledWith(snapshot)
    expect(container.querySelector('input')).toBeNull()
  })
  it('cancels polling and the Host session when unmounted', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async (_path: string) => new Response(JSON.stringify({ status: 'pending' })))
    vi.stubGlobal('fetch', fetcher)
    const bound = vi.fn()
    await mount(bound)
    await act(async () => { container.querySelector('button')!.click() })
    await act(async () => { root?.unmount(); root = undefined })
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/desktop/auth/feishu/session', '/api/desktop/auth/feishu/cancel'])
    expect(bound).not.toHaveBeenCalled()
  })
})
