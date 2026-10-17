// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopUpdateBadge,
  DesktopUpdateBadgeView,
  DesktopUpdateModal,
  DESKTOP_UPDATE_BADGE_ACTIVE_INTERVAL_MS,
  DESKTOP_UPDATE_BADGE_IDLE_INTERVAL_MS,
} from '../src/client/DesktopUpdateBadge.tsx'
import {
  createDesktopUpdateApi,
  parseDesktopUpdateSnapshot,
  type DesktopUpdateApi,
  type DesktopUpdateSnapshot,
} from '../src/client/desktop-update-api.ts'
import { zh } from '../src/client/desktop-settings-locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement: h } = await import('react')
  return {
    Button: (props: Record<string, unknown>) => {
      const { children, ...rest } = props
      return h('button', rest, children as never)
    },
    Tooltip: (props: Record<string, unknown>) => {
      const { children, label, ...rest } = props
      return h('span', { ...rest, 'data-testid': 'tooltip', 'data-label': label }, children as never)
    },
  }
})

const t = (key: keyof typeof zh): string => zh[key]

function snapshot(overrides: Partial<DesktopUpdateSnapshot> & { phase: DesktopUpdateSnapshot['phase'] }): DesktopUpdateSnapshot {
  return { ...overrides }
}

let root: Root | undefined
let container: HTMLDivElement | undefined

async function mount(node: React.ReactNode): Promise<HTMLDivElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = document.createElement('div')
  container = element
  document.body.append(element)
  root = createRoot(container)
  await act(async () => { root!.render(node) })
  return element
}

async function unmount(): Promise<void> {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
}

function buttonByLabel(name: string): HTMLButtonElement {
  const buttons = Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])
  const match = buttons.find(candidate => candidate.getAttribute('aria-label') === name)
  if (match === undefined) throw new Error(`update badge button not found: ${name}`)
  return match
}

function tooltip(): HTMLElement {
  const element = container?.querySelector<HTMLElement>('[data-testid="tooltip"]')
  if (element === null || element === undefined) throw new Error('update badge tooltip not rendered')
  return element
}

function badgeElement(api: DesktopUpdateApi, wide = false, platform: 'darwin' | 'win32' = 'win32'): React.ReactElement {
  return createElement(
    DesktopUpdateBadge,
    { api, t, wide, platform } as unknown as React.ComponentProps<typeof DesktopUpdateBadge>,
  )
}

function modalElement(overrides: Partial<React.ComponentProps<typeof DesktopUpdateModal>> = {}): React.ReactElement {
  return createElement(DesktopUpdateModal, {
    version: '2.1.0',
    platform: 'win32',
    installFailed: false,
    busy: false,
    onInstall: () => {},
    onClose: () => {},
    t,
    ...overrides,
  })
}

async function renderView(props: {
  wide?: boolean
  snapshot: DesktopUpdateSnapshot
  onPrimary?: (snapshot: DesktopUpdateSnapshot) => void
}): Promise<HTMLDivElement> {
  return await mount(createElement(DesktopUpdateBadgeView, { t, ...props }))
}

afterEach(async () => {
  await unmount()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('desktop update badge view', () => {
  it('renders nothing while the host reports an idle lifecycle', async () => {
    const node = await renderView({ snapshot: snapshot({ phase: 'idle' }) })
    expect(node.querySelector('button')).toBeNull()
  })

  it('shows the available pill with the release tooltip and reports the primary action', async () => {
    const onPrimary = vi.fn()
    await renderView({
      wide: true,
      snapshot: snapshot({ phase: 'available', version: '2.1.0' }),
      onPrimary,
    })
    const button = buttonByLabel('新版本：2.1.0')
    expect(button.getAttribute('data-phase')).toBe('available')
    expect(button.textContent).toContain('新版本')
    expect(tooltip().getAttribute('data-label')).toBe('新版本：2.1.0')

    await act(async () => { button.click() })
    expect(onPrimary).toHaveBeenCalledOnce()
    expect(onPrimary.mock.calls[0]?.[0]).toEqual({ phase: 'available', version: '2.1.0' })
  })

  it('marks a failed download with the retry affordance', async () => {
    await renderView({
      snapshot: snapshot({ phase: 'available', version: '2.1.0', downloadFailed: true }),
    })
    expect(buttonByLabel(zh.updateBadgeDownloadFailed)).toBeTruthy()
    expect(tooltip().getAttribute('data-label')).toBe(zh.updateBadgeDownloadFailed)
  })

  it('marks a failed install with the retry affordance', async () => {
    await renderView({
      snapshot: snapshot({ phase: 'ready', version: '2.1.0', installFailed: true }),
    })
    expect(buttonByLabel(zh.updateBadgeInstallFailed)).toBeTruthy()
  })

  it('renders the ring progress and percentage while downloading', async () => {
    await renderView({
      snapshot: snapshot({ phase: 'downloading', version: '2.1.0', received: 512, total: 1024 }),
    })
    const button = buttonByLabel('50%')
    expect(button.getAttribute('data-phase')).toBe('downloading')
    expect(button.textContent).toContain('50%')
    expect(button.querySelector('circle')).not.toBeNull()
    expect(container?.querySelector('[data-testid="tooltip"]')).toBeNull()
  })

  it('renders an indeterminate spinner while the download size is unknown', async () => {
    await renderView({
      snapshot: snapshot({ phase: 'downloading', version: '2.1.0', received: 512 }),
    })
    expect(buttonByLabel('新版本').querySelector('.dshDesktopUpdateBadgeSpinner')).not.toBeNull()
  })

  it('presents the ready state and keeps it clickable for the install dialog', async () => {
    const onPrimary = vi.fn()
    await renderView({
      wide: true,
      snapshot: snapshot({ phase: 'ready', version: '2.1.0' }),
      onPrimary,
    })
    const button = buttonByLabel('新版本 2.1.0 已就绪')
    expect(tooltip().getAttribute('data-label')).toBe('新版本 2.1.0 已就绪')

    await act(async () => { button.click() })
    expect(onPrimary.mock.calls[0]?.[0]).toEqual({ phase: 'ready', version: '2.1.0' })
  })

  it('shows the restarting spinner with its version tooltip', async () => {
    await renderView({ snapshot: snapshot({ phase: 'restarting', version: '2.1.0' }) })
    const button = buttonByLabel('新版本：2.1.0')
    expect(button.textContent).toContain(zh.updateBadgeRestarting)
    expect(button.querySelector('.dshDesktopUpdateBadgeSpinner')).not.toBeNull()
    expect(button.getAttribute('data-phase')).toBe('restarting')
  })
})

describe('desktop update badge lifecycle', () => {
  it('polls the host snapshot and adapts the cadence to the phase', async () => {
    vi.useFakeTimers()
    const states: DesktopUpdateSnapshot[] = [
      { phase: 'available', version: '2.1.0' },
      { phase: 'downloading', version: '2.1.0', received: 256, total: 1024 },
    ]
    let calls = 0
    const readUpdateState = vi.fn(async (): Promise<DesktopUpdateSnapshot> => {
      const next = states[Math.min(calls, states.length - 1)]!
      calls += 1
      return next
    })
    const api: DesktopUpdateApi = {
      readUpdateState,
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(badgeElement(api, true))
    await vi.advanceTimersByTimeAsync(0)
    expect(buttonByLabel('新版本：2.1.0')).toBeTruthy()

    const callsAfterAvailable = calls
    await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_BADGE_IDLE_INTERVAL_MS - 1)
    expect(calls).toBe(callsAfterAvailable)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBeGreaterThan(callsAfterAvailable)

    const callsAfterRotation = calls
    await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_BADGE_ACTIVE_INTERVAL_MS - 1)
    expect(calls).toBe(callsAfterRotation)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBeGreaterThan(callsAfterRotation)
    expect(buttonByLabel('25%')).toBeTruthy()
  })

  it('stops polling after unmount', async () => {
    vi.useFakeTimers()
    const readUpdateState = vi.fn(async (): Promise<DesktopUpdateSnapshot> => ({ phase: 'idle' }))
    const api: DesktopUpdateApi = {
      readUpdateState,
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(badgeElement(api))
    await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_BADGE_IDLE_INTERVAL_MS)
    const callsBeforeUnmount = readUpdateState.mock.calls.length
    await unmount()
    await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_BADGE_IDLE_INTERVAL_MS * 3)
    expect(readUpdateState.mock.calls.length).toBe(callsBeforeUnmount)
    // Re-mount so the shared afterEach cleanup has a live root.
    await mount(createElement('div'))
  })

  it('keeps the ready state on the relaxed cadence', async () => {
    vi.useFakeTimers()
    const readUpdateState = vi.fn(async (): Promise<DesktopUpdateSnapshot> => ({
      phase: 'ready', version: '2.1.0',
    }))
    const api: DesktopUpdateApi = {
      readUpdateState,
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(badgeElement(api))
    await vi.advanceTimersByTimeAsync(0)
    const callsAfterFirst = readUpdateState.mock.calls.length
    await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_BADGE_ACTIVE_INTERVAL_MS * 3)
    expect(readUpdateState.mock.calls.length).toBe(callsAfterFirst)
    await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_BADGE_IDLE_INTERVAL_MS - DESKTOP_UPDATE_BADGE_ACTIVE_INTERVAL_MS * 3 - 1)
    expect(readUpdateState.mock.calls.length).toBe(callsAfterFirst)
    await vi.advanceTimersByTimeAsync(1)
    expect(readUpdateState.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('falls back to the plain badge copy when no version is known', async () => {
    await renderView({ snapshot: snapshot({ phase: 'available' }) })
    expect(buttonByLabel(zh.updateBadgeAvailable)).toBeTruthy()
  })
})

describe('desktop update install dialog', () => {
  it('opens from a ready badge, starts the install, and closes from the backdrop', async () => {
    const installUpdateNow = vi.fn(async () => {})
    const api: DesktopUpdateApi = {
      readUpdateState: async () => ({ phase: 'ready', version: '2.1.0' }),
      startUpdateDownload: async () => {},
      installUpdateNow,
    }
    await mount(badgeElement(api))
    await act(async () => { buttonByLabel('新版本 2.1.0 已就绪').click() })

    const dialog = container?.querySelector<HTMLElement>('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.textContent).toContain('新版本 2.1.0 已准备就绪')
    expect(dialog!.textContent).toContain(zh.updateModalCloseNotice)
    expect(dialog!.textContent).toContain(zh.updateModalPatienceNotice)

    const installButton = Array.from(dialog!.querySelectorAll<HTMLButtonElement>('button'))
      .find(candidate => candidate.textContent === zh.updateModalInstallRestart)!
    await act(async () => { installButton.click() })
    expect(installUpdateNow).toHaveBeenCalledOnce()

    await act(async () => {
      container!.querySelector<HTMLElement>('.sensteedAgentSettingsDialogBackdrop')!.click()
    })
    expect(container?.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('reopens the dialog from the badge after closing it once', async () => {
    const api: DesktopUpdateApi = {
      readUpdateState: async () => ({ phase: 'ready', version: '2.1.0' }),
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(badgeElement(api))
    await act(async () => { buttonByLabel('新版本 2.1.0 已就绪').click() })
    const closeButton = container!.querySelector<HTMLButtonElement>('.dshDesktopUpdateModalClose')!
    await act(async () => { closeButton.click() })
    expect(container?.querySelector('[role="alertdialog"]')).toBeNull()

    await act(async () => { buttonByLabel('新版本 2.1.0 已就绪').click() })
    expect(container?.querySelector('[role="alertdialog"]')).not.toBeNull()
  })

  it('closes the dialog automatically when the host starts restarting', async () => {
    const states: DesktopUpdateSnapshot[] = [
      { phase: 'ready', version: '2.1.0' },
      { phase: 'restarting', version: '2.1.0' },
    ]
    let calls = 0
    const api: DesktopUpdateApi = {
      readUpdateState: async () => states[Math.min(calls++, states.length - 1)]!,
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(badgeElement(api))
    await act(async () => { buttonByLabel('新版本 2.1.0 已就绪').click() })
    expect(container?.querySelector('[role="alertdialog"]')).not.toBeNull()

    await act(async () => {
      // Ready keeps the relaxed cadence, so the restarting rotation lands one
      // idle interval after the dialog opens.
      await new Promise(resolve => { setTimeout(resolve, DESKTOP_UPDATE_BADGE_IDLE_INTERVAL_MS) })
    })
    expect(container?.querySelector('[role="alertdialog"]')).toBeNull()
    expect(buttonByLabel('新版本：2.1.0').textContent).toContain(zh.updateBadgeRestarting)
  })

  it('renders the darwin handoff label and the install failure notice', async () => {
    await mount(modalElement({ platform: 'darwin', installFailed: true }))
    const dialog = container!.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain(zh.updateModalOpenImage)
    expect(dialog.textContent).toContain(zh.updateModalInstallFailed)
    expect(dialog.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('closes on escape and keeps the modal during a busy handoff', async () => {
    const pressEscape = (): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }
    try {
      const onClose = vi.fn()
      await mount(modalElement({ onClose }))
      await act(async () => { pressEscape() })
      expect(onClose).toHaveBeenCalledOnce()

      const busyClose = vi.fn()
      await mount(modalElement({ busy: true, onClose: busyClose }))
      await act(async () => { pressEscape() })
      expect(busyClose).not.toHaveBeenCalled()
    } finally {
    }
  })

  it('keeps the install button retryable after a failed handoff and refreshes at once', async () => {
    const states: DesktopUpdateSnapshot[] = [
      { phase: 'ready', version: '2.1.0' },
      { phase: 'ready', version: '2.1.0', installFailed: true },
    ]
    let calls = 0
    const readUpdateState = vi.fn(async (): Promise<DesktopUpdateSnapshot> => {
      const next = states[Math.min(calls, states.length - 1)]!
      calls += 1
      return next
    })
    const api: DesktopUpdateApi = {
      readUpdateState,
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(badgeElement(api))
    await act(async () => { buttonByLabel('新版本 2.1.0 已就绪').click() })
    const installButton = () => Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ).find(candidate => candidate.textContent === zh.updateModalInstallRestart)!
    expect(installButton().disabled).toBe(false)

    await act(async () => { installButton().click() })
    // The follow-up refresh lands immediately: the failure notice shows and
    // the button returns to a retryable state.
    expect(container!.querySelector('[role="alert"]')).not.toBeNull()
    expect(installButton().disabled).toBe(false)
    expect(calls).toBe(2)
  })

  it('keeps the install button recoverable when macOS returns to ready', async () => {
    const installUpdateNow = vi.fn(async () => {})
    const api: DesktopUpdateApi = {
      readUpdateState: async () => ({ phase: 'ready', version: '2.1.0' }),
      startUpdateDownload: async () => {},
      installUpdateNow,
    }
    await mount(badgeElement(api, true, 'darwin'))
    await act(async () => { buttonByLabel('新版本 2.1.0 已就绪').click() })
    const openButton = Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ).find(candidate => candidate.textContent === zh.updateModalOpenImage)!
    await act(async () => { openButton.click() })
    await act(async () => { await Promise.resolve() })

    expect(installUpdateNow).toHaveBeenCalledOnce()
    expect(openButton.disabled).toBe(false)
  })

  it('disables the install action while the handoff is in flight', async () => {
    const onInstall = vi.fn(() => {})
    await mount(modalElement({ onInstall, busy: true }))
    const installButton = Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ).find(candidate => candidate.textContent === zh.updateModalInstallRestart)!
    expect(installButton.disabled).toBe(true)
    await act(async () => { installButton.click() })
    expect(onInstall).not.toHaveBeenCalled()
  })

  it('starts the silent download from the live badge action', async () => {
    const startUpdateDownload = vi.fn(async () => {})
    const installUpdateNow = vi.fn(async () => {})
    const api: DesktopUpdateApi = {
      readUpdateState: async () => ({ phase: 'available', version: '2.1.0' }),
      startUpdateDownload,
      installUpdateNow,
    }
    await mount(badgeElement(api))
    await act(async () => { await vi.waitFor(async () => { buttonByLabel('新版本：2.1.0') }) })

    const button = buttonByLabel('新版本：2.1.0')
    await act(async () => { button.click() })
    expect(startUpdateDownload).toHaveBeenCalledOnce()
    expect(installUpdateNow).not.toHaveBeenCalled()
  })

  it('keeps the last rendered phase while a poll fails', async () => {
    vi.useFakeTimers()
    let failing = false
    const api: DesktopUpdateApi = {
      readUpdateState: async () => {
        if (failing) throw new Error('offline')
        return { phase: 'downloading', version: '2.1.0', received: 256, total: 1024 }
      },
      startUpdateDownload: async () => {},
      installUpdateNow: async () => {},
    }
    await mount(badgeElement(api))
    await vi.advanceTimersByTimeAsync(0)
    expect(buttonByLabel('25%')).toBeTruthy()

    failing = true
    await vi.advanceTimersByTimeAsync(DESKTOP_UPDATE_BADGE_ACTIVE_INTERVAL_MS * 3)
    expect(buttonByLabel('25%')).toBeTruthy()
  })
})

describe('desktop update client api', () => {
  it('parses the host snapshot strictly and degrades unknown shapes to idle', () => {
    expect(parseDesktopUpdateSnapshot({
      phase: 'available', version: '2.1.0', received: 1, total: 2, downloadFailed: true,
    })).toEqual({ phase: 'available', version: '2.1.0', received: 1, total: 2, downloadFailed: true })
    expect(parseDesktopUpdateSnapshot({ phase: 'unknown' })).toEqual({ phase: 'idle' })
    expect(parseDesktopUpdateSnapshot(null)).toEqual({ phase: 'idle' })
    expect(parseDesktopUpdateSnapshot({ phase: 'ready', version: 42 })).toEqual({ phase: 'ready' })
  })

  it('posts the badge commands with the exact empty body', async () => {
    const calls: { input: RequestInfo | URL; init?: RequestInit | undefined }[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return Response.json(input === '/api/desktop/updates/state' ? { phase: 'idle' } : { accepted: true })
    })
    const api = createDesktopUpdateApi(fetcher as unknown as typeof globalThis.fetch)
    expect(await api.readUpdateState()).toEqual({ phase: 'idle' })
    await api.startUpdateDownload()
    await api.installUpdateNow()

    expect(calls.map(call => call.input)).toEqual([
      '/api/desktop/updates/state',
      '/api/desktop/updates/download',
      '/api/desktop/updates/install',
    ])
    expect(calls[1]?.init?.method).toBe('POST')
    expect(calls[1]?.init?.body).toBe('{}')
    expect(calls[2]?.init?.signal).toBeUndefined()
  })
})
