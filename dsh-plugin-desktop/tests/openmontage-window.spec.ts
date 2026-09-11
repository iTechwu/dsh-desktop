import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const windows: Array<InstanceType<typeof BrowserWindow>> = []
  const sessionFetch = vi.fn(async () => ({
    ok: true,
    headers: { get: vi.fn(() => 'openmontage_backlot_session=opaque-value; Path=/montage; Secure; HttpOnly') },
  }))
  const cookiesSet = vi.fn(async () => {})
  class BrowserWindow {
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    }
    readonly isDestroyed = vi.fn(() => false)
    readonly isMinimized = vi.fn(() => false)
    readonly show = vi.fn()
    readonly focus = vi.fn()
    readonly restore = vi.fn()
    readonly close = vi.fn()
    readonly loadURL = vi.fn(async () => {})
    readonly once = vi.fn()
    readonly on = vi.fn()
    readonly removeMenu = vi.fn()
    accessibleTitle = ''
    constructor(readonly options: unknown) { windows.push(this) }
  }
  return {
    BrowserWindow,
    windows,
    session: { defaultSession: { fetch: sessionFetch, cookies: { set: cookiesSet } } },
    sessionFetch,
    cookiesSet,
  }
})

vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow, session: electron.session }))
vi.mock('../src/electron-reveal.ts', () => ({ revealApplication: vi.fn() }))

import {
  OpenMontageWindow,
  isOpenMontageNavigationAllowed,
  parseOpenMontageSessionCookie,
} from '../src/openmontage-window.ts'

describe('OpenMontage managed session', () => {
  beforeEach(() => {
    electron.windows.length = 0
    vi.clearAllMocks()
  })

  it('extracts only the fixed HttpOnly session cookie', () => {
    expect(parseOpenMontageSessionCookie(
      'openmontage_backlot_session=opaque-value; Path=/montage; Secure; HttpOnly; SameSite=None',
    )).toBe('opaque-value')
    expect(parseOpenMontageSessionCookie('another_cookie=value; Path=/')).toBeUndefined()
    expect(parseOpenMontageSessionCookie(null)).toBeUndefined()
  })

  it('keeps main-frame navigation inside the fixed montage path', () => {
    expect(isOpenMontageNavigationAllowed('https://ixicai.cn/montage')).toBe(true)
    expect(isOpenMontageNavigationAllowed('https://ixicai.cn/montage/')).toBe(true)
    expect(isOpenMontageNavigationAllowed('https://ixicai.cn/montage/projects/example')).toBe(true)
    expect(isOpenMontageNavigationAllowed('https://ixicai.cn/ai/v1/models')).toBe(false)
    expect(isOpenMontageNavigationAllowed('https://example.com/montage/')).toBe(false)
    expect(isOpenMontageNavigationAllowed('not-a-url')).toBe(false)
  })

  it('uses the shared dark loading surface and accessible window title', async () => {
    const owner = new OpenMontageWindow()

    await owner.open('managed-key')

    const window = electron.windows[0]
    expect(window?.options).toEqual(expect.objectContaining({
      title: 'OpenMontage',
      backgroundColor: '#202124',
      show: false,
      minWidth: 960,
      minHeight: 640,
    }))
    expect(window?.accessibleTitle).toBe('OpenMontage')
    expect(electron.sessionFetch).toHaveBeenCalledWith(
      'https://ixicai.cn/montage/auth/session',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(electron.cookiesSet).toHaveBeenCalledWith(expect.objectContaining({
      name: 'openmontage_backlot_session',
      path: '/montage',
      httpOnly: true,
    }))
  })
})
