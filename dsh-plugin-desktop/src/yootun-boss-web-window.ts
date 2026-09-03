/** In-app BOSS Zhipin browser window for the recruiter workspace ("web use").

The user logs in and operates the official pages inside this window; the
desktop never reads its cookies, storage, QR codes, or page payload. Only
zhipin.com origins may load here — every other navigation is refused. */

import { BrowserWindow, session } from 'electron'
import { revealApplication } from './electron-reveal.ts'

export const BOSS_LOGIN_URL = 'https://www.zhipin.com/web/user/?ka=header-login'
const BOSS_PARTITION = 'persist:yootun-boss-web'

export function isBossNavigationAllowed(href: string): boolean {
  try {
    const target = new URL(href)
    return target.protocol === 'https:' && target.hostname === 'zhipin.com'
      || (target.protocol === 'https:' && target.hostname.endsWith('.zhipin.com'))
  } catch {
    return false
  }
}

/** Owns the single in-app BOSS browser window (web-use login and manual operation). */
export class BossWebWindow {
  private window: BrowserWindow | undefined
  private busy = false
  private disposed = false

  async open(url: string = BOSS_LOGIN_URL): Promise<void> {
    if (this.busy || this.disposed) return
    if (!isBossNavigationAllowed(url)) throw new Error('boss_web_url_not_allowed')
    const existing = this.window
    if (existing !== undefined && !existing.isDestroyed()) {
      revealApplication(existing)
      return
    }
    this.busy = true
    try {
      const window = new BrowserWindow({
        title: 'BOSS 直聘',
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
          partition: BOSS_PARTITION,
        },
      })
      this.window = window
      window.removeMenu()
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const allow = (event: Electron.Event, href: string): void => {
        if (!isBossNavigationAllowed(href)) event.preventDefault()
      }
      window.webContents.on('will-navigate', allow)
      window.webContents.on('will-redirect', allow)
      window.once('ready-to-show', () => {
        if (!this.disposed && this.window === window && !window.isDestroyed()) revealApplication(window)
      })
      window.on('closed', () => {
        if (this.window === window) this.window = undefined
      })
      void session.fromPartition(BOSS_PARTITION).setPermissionRequestHandler((_contents, _permission, callback) => {
        // Display and manual operation only: deny anything the page asks for.
        callback(false)
      })
      try {
        await window.loadURL(url)
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
