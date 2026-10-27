/** Alpha.2 boot and directory-picker contracts; no generic IPC bridge. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc.ts'
import { markDocumentPlatform } from './preload-platform.ts'
import { syncNativeTheme } from './preload-theme.ts'
import { syncWindowsAppearance } from './preload-windows.ts'
import { syncWindowMaterial } from './preload-material.ts'
import { syncNativeLocale } from './preload-locale.ts'
import { permissionBridge } from './preload-permissions.ts'
import { onOpenSettings } from './preload-settings.ts'
import { createDesktopBrowserBridge } from './preload-browser.ts'

if (location.protocol === 'dsh-app:' && location.hostname === 'app') {
  markDocumentPlatform()
  syncNativeTheme()
  syncNativeLocale()
  syncWindowsAppearance()
  syncWindowMaterial()
  contextBridge.exposeInMainWorld('desktopNext', {
    permissions: permissionBridge(),
    onOpenSettings,
    state: () => ipcRenderer.invoke(IPC.state),
    browserLinks: () => ipcRenderer.invoke(IPC.browserLinks),
    command: (command: unknown) => ipcRenderer.invoke(IPC.command, command),
    // In-app report PDF export; the main process renders the self-contained HTML
    // off-screen and writes the file (no Chromium print preview).
    exportReportPdf: (payload: { html: string; filename: string }) =>
      ipcRenderer.invoke(IPC.reportExportPdf, payload),
  })
  // dsh 0.1.7 implements the native Sidebar browser itself and reads its transport from this
  // carrier; without `browser` the official plugin silently falls back to the sandboxed iframe.
  contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1, browser: createDesktopBrowserBridge() })
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke(IPC.boot),
    failed: (message: string) => ipcRenderer.invoke(IPC.failed, message),
  })
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', { pick: () => ipcRenderer.invoke(IPC.directory) })
}
