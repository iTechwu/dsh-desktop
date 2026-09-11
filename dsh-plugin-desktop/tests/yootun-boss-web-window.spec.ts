import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const windows: Array<InstanceType<typeof BrowserWindow>> = []
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
  const permissionHandler = vi.fn()
  return {
    BrowserWindow,
    windows,
    session: {
      defaultSession: {},
      fromPartition: vi.fn(() => ({ setPermissionRequestHandler: permissionHandler })),
    },
    permissionHandler,
  }
})

vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow, session: electron.session }))
vi.mock('../src/electron-reveal.ts', () => ({ revealApplication: vi.fn() }))

import { BOSS_LOGIN_URL, BossWebWindow, isBossNavigationAllowed } from '../src/yootun-boss-web-window.ts'

describe('in-app BOSS web window', () => {
  beforeEach(() => {
    electron.windows.length = 0
    vi.clearAllMocks()
  })

  it('keeps navigation on official zhipin.com origins only', () => {
    expect(isBossNavigationAllowed('https://www.zhipin.com/web/user/?ka=header-login')).toBe(true)
    expect(isBossNavigationAllowed('https://zhipin.com/')).toBe(true)
    expect(isBossNavigationAllowed('https://edu.zhipin.com/course')).toBe(true)
    expect(isBossNavigationAllowed('http://www.zhipin.com/')).toBe(false)
    expect(isBossNavigationAllowed('https://evil.example/zhipin.com')).toBe(false)
    expect(isBossNavigationAllowed('https://zhipin.com.evil.example/')).toBe(false)
    expect(isBossNavigationAllowed('not-a-url')).toBe(false)
  })

  it('points the login handoff at the official login page', () => {
    expect(BOSS_LOGIN_URL).toMatch(/^https:\/\/www\.zhipin\.com\//u)
  })

  it('uses the shared dark loading surface and accessible window title', async () => {
    const owner = new BossWebWindow()

    await owner.open()

    const window = electron.windows[0]
    expect(window?.options).toEqual(expect.objectContaining({
      title: 'BOSS 直聘',
      backgroundColor: '#202124',
      show: false,
      minWidth: 960,
      minHeight: 640,
    }))
    expect(window?.accessibleTitle).toBe('BOSS 直聘')
    expect(window?.loadURL).toHaveBeenCalledWith(BOSS_LOGIN_URL)
    expect(electron.permissionHandler).toHaveBeenCalledOnce()
    const deny = electron.permissionHandler.mock.calls[0]?.[0] as
      ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | undefined
    const callback = vi.fn()
    deny?.({}, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
  })
})
