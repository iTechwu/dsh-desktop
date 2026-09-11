// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopNativeActions } from '../src/client/DesktopNativeActions.tsx'
import { en } from '../src/client/desktop-settings-locales.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

async function mount(placement: 'settings' | 'titlebar') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  const api = {
    openTerminal: vi.fn(async () => {}), restart: vi.fn(async () => {}),
    restartToRecovery: vi.fn(async () => {}), reloadRenderer: vi.fn(async () => {}),
    toggleDeveloperTools: vi.fn(async () => {}),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(DesktopNativeActions, { placement, api, t: key => en[key] }))
  })
  const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
  return { api, trigger }
}

async function press(element: HTMLElement, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

async function expectFocus(element: HTMLElement) {
  await act(async () => { await vi.waitFor(() => { expect(document.activeElement).toBe(element) }) })
}

describe.each(['settings', 'titlebar'] as const)('%s native action keyboard menu', placement => {
  it('opens by keyboard, navigates items, and restores the trigger on Escape', async () => {
    const { trigger } = await mount(placement)
    trigger.focus()
    await press(trigger, 'ArrowDown')
    const items = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    expect(items).toHaveLength(3)
    await expectFocus(items[0]!)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await press(items[0]!, 'ArrowDown')
    await expectFocus(items[1]!)
    await press(items[1]!, 'End')
    await expectFocus(items[2]!)
    await press(items[2]!, 'Home')
    await expectFocus(items[0]!)
    await press(items[0]!, 'Escape')
    await expectFocus(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(container!.querySelector('[role="menu"]')).toBeNull()
  })

  it('announces an action failure and allows retrying through the same menu', async () => {
    const { api, trigger } = await mount(placement)
    api.reloadRenderer.mockRejectedValueOnce(new Error('local action failed'))
    trigger.focus()
    await press(trigger, 'ArrowDown')
    await act(async () => { container!.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
    expect(api.reloadRenderer).toHaveBeenCalledTimes(1)
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(en.reloadRendererError)
    expect(trigger.disabled).toBe(false)
    await press(trigger, 'ArrowDown')
    await act(async () => { container!.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click() })
    expect(api.reloadRenderer).toHaveBeenCalledTimes(2)
    expect(container!.querySelector('[role="alert"]')).toBeNull()
  })
})
