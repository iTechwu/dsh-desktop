/** Minimal context-isolated bridges for drag payloads, Desktop-owned actions, and the upstream Desktop marker. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createDesktopUpdatesBridge } from './preload-updates-bridge.ts'
import { DESKTOP_FILE_PATH_BRIDGE } from './file-path-bridge-contract.ts'
import {
  DESKTOP_RENDERER_ACTION_CHANNEL,
  DESKTOP_RENDERER_ACTIONS_BRIDGE,
  type DesktopRendererAction,
  type DesktopRendererActionsBridge,
} from './renderer-actions-contract.ts'

contextBridge.exposeInMainWorld(DESKTOP_FILE_PATH_BRIDGE, {
  /** Resolve only genuine disk-backed Web File objects selected by the operator. */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
})

const actions: DesktopRendererActionsBridge = {
  /** Reach the main process directly, independent of the Host generation. */
  invoke: (action: DesktopRendererAction) => ipcRenderer.invoke(DESKTOP_RENDERER_ACTION_CHANNEL, action),
}
contextBridge.exposeInMainWorld(DESKTOP_RENDERER_ACTIONS_BRIDGE, actions)

const updates = createDesktopUpdatesBridge({
  fetch: (input, init) => fetch(input, init),
  setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
})

// Upstream client plugins recognize the Desktop renderer by this carrier. Version 1
// without `browser` keeps the embedded browser tab on its Web fallback, and
// turns on the DeepSeek account entry whose Platform sign-in the Host hands to
// the native shell (src/platform-login.ts). The `updates` bridge feeds the
// upstream settings-shell indicator that renders beside the Settings control.
contextBridge.exposeInMainWorld('dshDesktop', Object.freeze({
  protocolVersion: 1,
  updates: Object.freeze({
    status: () => updates.status(),
    open: () => updates.open(),
    subscribe: (listener: (state: unknown) => void) => updates.subscribe(listener),
  }),
}))
