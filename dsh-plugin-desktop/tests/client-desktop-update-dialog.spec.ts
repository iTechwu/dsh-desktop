// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopUpdateDialogHost,
  DesktopUpdateModal,
  DESKTOP_UPDATE_DIALOG_IDLE_INTERVAL_MS,
} from '../src/client/DesktopUpdateDialog.tsx'
import {
  createDesktopUpdatesBridge,
  parseDesktopUpdateSnapshot,
  toPresentation,
  DESKTOP_UPDATES_BRIDGE_ACTIVE_INTERVAL_MS,
  DESKTOP_UPDATES_BRIDGE_IDLE_INTERVAL_MS,
  type DesktopUpdateSnapshot,
} from '../src/preload-updates-bridge.ts'
import { zh } from '../src/client/desktop-settings-locales.ts'
import type { DesktopUpdateApi } from '../src/client/desktop-update-api.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement: h } = await import('react')
  return {
    Button: (props: Record<string, unknown>) => {
      const { children, ...rest } = props
      return h('button', { ...rest, children: undefined }, children as never)
    },
  }
})

const t = (key: keyof typeof zh): string => zh[key]

let root: Root | undefined
let container: HTMLDivElement | undefined

async function mount(node: React.ReactNode): Promise<void> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(node) })
}

async function unmount(): Promise<void> {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  document.querySelectorAll('.sensteedAgentSettingsDialogBackdrop').forEach(node => node.remove())
}

function dialog(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="alertdialog"]')
  if (element === null) throw new Error('update dialog not rendered')
  return element
}

function buttonByText(text: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  const match = buttons.find(candidate => candidate.textContent === text)
  if (match === undefined) throw new Error(`button not found: ${text}`)
  return match
}

function buttonByLabel(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  const match = buttons.find(candidate => candidate.getAttribute('aria-label') === label)
  if (match === undefined) throw new Error(`button not found: ${label}`)
  return match
}

function apiWith(states: DesktopUpdateSnapshot[]): DesktopUpdateApi {
  let calls = 0
  return {
    readUpdateState: async () => {
      const next = states[Math.min(calls, states.length - 1)]!
      calls += 1
      return next
    },
    startUpdateDownload: async () => {},
    installUpdateNow: async () => {},
  }
}

afterEach(async () => {
  await unmount()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('desktop update dialog host', () => {
  it('opens once per ready transition and portals beside the document root', async () => {
    await mount(createElement(DesktopUpdateDialogHost, {
      api: apiWith([{ phase: 'ready', version: '2.1.0' }]),
      platform: 'win32',
      t,
    }))
    const dialogNode = dialog()
    // Portaled beside the document root, never inside the mounting container.
    expect(container!.contains(dialogNode)).toBe(false)
    expect(document.body.contains(dialogNode)).toBe(true)
    expect(dialogNode.textContent).toContain('新版本 2.1.0 已准备就绪')
    expect(dialogNode.textContent).toContain(zh.updateModalCloseNotice)
    expect(dialogNode.textContent).toContain(zh.updateModalPatienceNotice)
  })

  it('renders nothing for idle and non-ready snapshots', async () => {
    await mount(createElement(DesktopUpdateDialogHost, {
      api: apiWith([{ phase: 'downloading', version: '2.1.0', received: 1, total: 2 }]),
      t,
    }))
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('closes from the close button and the backdrop, then reopens on the next ready cycle', async () => {
    vi.useFakeTimers()
    const states: DesktopUpdateSnapshot[] = [
      { phase: 'ready', version: '2.1.0' },
      { phase: 'idle' },
      { phase: 'ready', version: '2.2.0' },
    ]
    let calls = 0
    const api: DesktopUpdateApi = {
      readUpdateState: async () => {
        const next = states[Math.min(calls, states.length - 1)]!
        calls += 1
        return next
      },
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(createElement(DesktopUpdateDialogHost, { api, platform: 'win32', t }))
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.dshDesktopUpdateDialogClose')!.click()
    })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    // Idle rotation first resets the dismissal, then the next release reopens.
    await act(async () => { await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_DIALOG_IDLE_INTERVAL_MS + 50) })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_DIALOG_IDLE_INTERVAL_MS + 50) })
    expect(dialog().textContent).toContain('新版本 2.2.0 已准备就绪')
  })

  it('confirms the handoff and closes while the host reports restarting', async () => {
    const states: DesktopUpdateSnapshot[] = [
      { phase: 'ready', version: '2.1.0' },
      { phase: 'restarting', version: '2.1.0' },
    ]
    let calls = 0
    const installUpdateNow = vi.fn(async () => {})
    const api: DesktopUpdateApi = {
      readUpdateState: async () => {
        const next = states[Math.min(calls, states.length - 1)]!
        calls += 1
        return next
      },
      startUpdateDownload: async () => {},
      installUpdateNow,
    }
    await mount(createElement(DesktopUpdateDialogHost, { api, platform: 'win32', t }))
    const installButton = buttonByText(zh.updateModalInstallRestart)
    await act(async () => { installButton.click() })

    expect(installUpdateNow).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('shows the darwin label and the install failure notice after an immediate refresh', async () => {
    const states: DesktopUpdateSnapshot[] = [
      { phase: 'ready', version: '2.1.0' },
      { phase: 'ready', version: '2.1.0', installFailed: true },
    ]
    let calls = 0
    const api: DesktopUpdateApi = {
      readUpdateState: async () => {
        const next = states[Math.min(calls, states.length - 1)]!
        calls += 1
        return next
      },
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(createElement(DesktopUpdateDialogHost, { api, platform: 'darwin', t }))
    const installButton = buttonByText(zh.updateModalOpenImage)
    await act(async () => { installButton.click() })

    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(zh.updateModalInstallFailed)
    expect(installButton.disabled).toBe(false)
  })
})

describe('desktop update modal presentation', () => {
  it('renders the modal portaled beside the document root with platform copy', async () => {
    const onClose = vi.fn()
    await mount(createElement(DesktopUpdateModal, {
      version: '2.1.0', platform: 'darwin', installFailed: false, busy: false,
      onInstall: () => {}, onClose, t,
    }))
    const dialogElement = dialog()
    expect(container!.contains(dialogElement)).toBe(false)
    expect(dialogElement.textContent).toContain(zh.updateModalOpenImage)

    await act(async () => { buttonByLabel(zh.updateModalClose).click() })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('dismisses on escape, ignores it while busy, and keeps backdrop clicks inside the modal flow', async () => {
    const pressEscape = (): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }
    const onClose = vi.fn()
    await mount(createElement(DesktopUpdateModal, {
      version: '2.1.0', platform: 'win32', installFailed: false, busy: false,
      onInstall: () => {}, onClose, t,
    }))
    await act(async () => { pressEscape() })
    expect(onClose).toHaveBeenCalledOnce()

    const busyClose = vi.fn()
    await mount(createElement(DesktopUpdateModal, {
      version: '2.1.0', platform: 'win32', installFailed: false, busy: true,
      onInstall: () => {}, onClose: busyClose, t,
    }))
    await act(async () => {
      document.querySelector<HTMLElement>('.sensteedAgentSettingsDialogBackdrop')!.click()
      pressEscape()
    })
    expect(busyClose).not.toHaveBeenCalled()
  })
})

describe('desktop updates carrier bridge', () => {
  it('maps host snapshots onto the upstream presentation shape', () => {
    expect(toPresentation({ phase: 'idle' })).toEqual({ phase: 'idle' })
    expect(toPresentation({ phase: 'available', version: '2.1.0' }))
      .toEqual({ phase: 'available', version: '2.1.0' })
    expect(toPresentation({ phase: 'downloading', version: '2.1.0', received: 512, total: 1024 }))
      .toEqual({ phase: 'downloading', version: '2.1.0', percent: 50 })
    expect(toPresentation({ phase: 'ready', version: '2.1.0' }))
      .toEqual({ phase: 'ready', version: '2.1.0' })
    expect(toPresentation({ phase: 'restarting' })).toEqual({ phase: 'installing' })
    expect(toPresentation({ phase: 'available', version: '2.1.0', downloadFailed: true }))
      .toEqual({ phase: 'error', failure: 'download', version: '2.1.0' })
    expect(toPresentation({ phase: 'ready', version: '2.1.0', installFailed: true }))
      .toEqual({ phase: 'error', failure: 'install', version: '2.1.0' })
  })

  it('parses the host snapshot strictly and degrades unknown shapes to idle', () => {
    expect(parseDesktopUpdateSnapshot({
      phase: 'downloading', version: '2.1.0', received: 1, total: 2, downloadFailed: true,
    })).toEqual({
      phase: 'downloading', version: '2.1.0', received: 1, total: 2, downloadFailed: true,
    })
    expect(parseDesktopUpdateSnapshot({ phase: 'unknown' })).toEqual({ phase: 'idle' })
    expect(parseDesktopUpdateSnapshot(null)).toEqual({ phase: 'idle' })
  })

  it('routes the user action by the current phase', async () => {
    const posts: string[] = []
    let snapshot: DesktopUpdateSnapshot = { phase: 'available', version: '2.1.0' }
    const harness = {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(String(input))
          return Response.json({ accepted: true })
        }
        return Response.json(snapshot)
      }),
    }
    const bridge = createDesktopUpdatesBridge({
      fetch: harness.fetch as unknown as typeof globalThis.fetch,
      setTimeout: () => 0,
      clearTimeout: () => {},
    })
    await bridge.status()
    await bridge.open()
    snapshot = { phase: 'ready', version: '2.1.0' }
    await bridge.status()
    await bridge.open()

    expect(posts).toEqual(['/api/desktop/updates/download', '/api/desktop/updates/install'])
  })

  it('pushes presentation changes to subscribers and stops on unsubscribe', async () => {
    const states: DesktopUpdateSnapshot[] = [
      { phase: 'available', version: '2.1.0' },
      { phase: 'downloading', version: '2.1.0', received: 512, total: 1024 },
    ]
    let calls = 0
    const fetch = vi.fn(async (): Promise<Response> => {
      const next = states[Math.min(calls, states.length - 1)]!
      calls += 1
      return Response.json(next)
    })
    const timers: Array<[() => void, number]> = []
    const bridge = createDesktopUpdatesBridge({
      fetch: fetch as unknown as typeof globalThis.fetch,
      setTimeout: (handler, timeoutMs) => { timers.push([handler, timeoutMs]); return timers.length },
      clearTimeout: handle => { void timers.splice(Number(handle) - 1, 1) },
    })
    const seen: string[] = []
    const unsubscribe = bridge.subscribe(state => { seen.push(state.phase) })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(seen).toEqual(['available'])
    expect(timers[0]?.[1]).toBe(DESKTOP_UPDATES_BRIDGE_IDLE_INTERVAL_MS)

    timers[0]?.[0]()
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(seen).toEqual(['available', 'downloading'])
    expect(timers.at(-1)?.[1]).toBe(DESKTOP_UPDATES_BRIDGE_ACTIVE_INTERVAL_MS)

    unsubscribe()
    expect(timers).toHaveLength(0)
  })
})
