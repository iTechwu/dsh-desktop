/** Native OpenMontage window that exchanges the managed key for an HttpOnly session. */

import { BrowserWindow, session } from 'electron'
import { revealApplication } from './electron-reveal.ts'

export const OPENMONTAGE_URL = 'https://ixicai.cn/montage/'
const AUTH_URL = 'https://ixicai.cn/montage/auth/session'
const COOKIE_NAME = 'openmontage_backlot_session'

export function parseOpenMontageSessionCookie(value: string | null): string | undefined {
  if (value === null) return undefined
  const match = value.match(new RegExp(`(?:^|,\\s*)${COOKIE_NAME}=([^;]+)`, 'u'))
  return match?.[1]
}

export function isOpenMontageNavigationAllowed(href: string): boolean {
  try {
    const target = new URL(href)
    const allowed = new URL(OPENMONTAGE_URL)
    return target.origin === allowed.origin && target.pathname.startsWith(allowed.pathname)
  } catch {
    return false
  }
}

async function establishSession(apiKey: string): Promise<void> {
  const response = await session.defaultSession.fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  if (!response.ok) throw new Error(`OpenMontage authentication failed (${response.status})`)
  const value = parseOpenMontageSessionCookie(response.headers.get('set-cookie'))
  if (value === undefined) throw new Error('OpenMontage authentication did not return a session cookie')
  await session.defaultSession.cookies.set({
    url: OPENMONTAGE_URL,
    name: COOKIE_NAME,
    value,
    path: '/montage',
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction',
  })
}

export class OpenMontageWindow {
  private window: BrowserWindow | undefined
  private busy = false
  private disposed = false

  async open(apiKey: string): Promise<void> {
    if (this.busy || this.disposed) return
    const existing = this.window
    if (existing !== undefined && !existing.isDestroyed()) {
      revealApplication(existing)
      return
    }
    this.busy = true
    try {
      await establishSession(apiKey)
      const window = new BrowserWindow({
        title: 'OpenMontage',
        width: 1440,
        height: 960,
        minWidth: 960,
        minHeight: 640,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        },
      })
      this.window = window
      window.removeMenu()
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const allow = (event: Electron.Event, href: string): void => {
        if (!isOpenMontageNavigationAllowed(href)) event.preventDefault()
      }
      window.webContents.on('will-navigate', allow)
      window.webContents.on('will-redirect', allow)
      window.once('ready-to-show', () => {
        if (!this.disposed && this.window === window && !window.isDestroyed()) revealApplication(window)
      })
      window.on('closed', () => {
        if (this.window === window) this.window = undefined
      })
      try {
        await window.loadURL(OPENMONTAGE_URL)
      } catch (cause) {
        if (this.window === window) this.window = undefined
        if (!window.isDestroyed()) window.close()
        throw cause
      }
    } finally {
      this.busy = false
    }
  }

  close(): void {
    this.disposed = true
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.close()
  }
}
