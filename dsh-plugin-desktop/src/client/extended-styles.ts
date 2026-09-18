/** Independent frame shared by compatibility and inverted-L extended modes. */

import {
  EXTENDED_INNER_CORNER_RADIUS,
  DESKTOP_FRAME_HEIGHT,
  MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
  WINDOWS_CAPTION_CONTROLS_WIDTH,
} from '../window-chrome.ts'

const STYLE_ID = 'sensteed-agent-framed-styles'

const CSS = `
html:has(body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])),
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"]) {
  width: 100%;
  height: 100%;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"]) {
  --sensteed-agent-frame-height: 0px;
  margin: 0;
  overflow: hidden;
  background: transparent !important;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"]) #root {
  box-sizing: border-box;
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: auto;
  height: auto;
  padding-top: 0;
  overflow: hidden;
  transform: translateZ(0);
}
/* The custom frame owns the top band. A shell overlay is the containing block
   for fixed plugin surfaces, so they cannot escape into Desktop chrome. */
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-shell-overlay] {
  overflow: hidden;
  transform: translateZ(0);
}
/* Full-viewport dialogs portalled directly to body still belong to content. */
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  > [role="presentation"]:has(> [aria-modal="true"]),
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  > [aria-modal="true"] {
  top: var(--sensteed-agent-frame-height) !important;
  transform: translateZ(0);
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.footer.action"],
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.settings"] {
  --dsh-sidebar-footer-control-height: 36px;
  --dsh-sidebar-footer-control-gap: 4px;
  --dsh-sidebar-footer-icon-size: 16px;
  --dsh-sidebar-footer-font-size: 14px;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.footer.action"] {
  display: flex !important;
  flex-direction: column;
  gap: var(--dsh-sidebar-footer-control-gap);
  min-width: 0;
  width: 100%;
  max-height: min(40vh, 240px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.footer.action"] > * {
  flex: none;
  min-width: 0;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.footer.action"] > button {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  height: var(--dsh-sidebar-footer-control-height);
  min-height: var(--dsh-sidebar-footer-control-height);
  margin: 0;
  padding: 0 8px;
  gap: 8px;
  justify-content: flex-start;
  border-radius: 6px;
  font-family: inherit;
  font-size: var(--dsh-sidebar-footer-font-size);
  line-height: 22px;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.footer.action"] > button:has(> svg):not(:has(> span))::after {
  content: attr(aria-label);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.settings"] > div:first-child {
  box-sizing: border-box;
  width: 100%;
  margin: var(--dsh-sidebar-footer-control-gap) 0 0;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.settings"] > div:first-child > button {
  box-sizing: border-box;
  height: var(--dsh-sidebar-footer-control-height);
  min-height: var(--dsh-sidebar-footer-control-height);
  margin: 0;
  padding: 0 8px;
  gap: 8px;
  border-radius: 6px;
  font-family: inherit;
  font-size: var(--dsh-sidebar-footer-font-size);
  line-height: 22px;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.footer.action"] > button > span,
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.settings"] > div:first-child > button > span {
  font-size: inherit;
  line-height: inherit;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.footer.action"] > button svg,
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-slot="sidebar.settings"] > div:first-child > button svg {
  flex: none;
  width: var(--dsh-sidebar-footer-icon-size);
  height: var(--dsh-sidebar-footer-icon-size);
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-sidebar-collapsed] [data-slot="sidebar.footer.action"] > button,
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-sidebar-collapsed] [data-slot="sidebar.settings"] > div:first-child > button {
  width: var(--dsh-sidebar-footer-control-height);
  padding: 0;
  justify-content: center;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-sidebar-collapsed] [data-slot="sidebar.footer.action"] > button:has(> svg):not(:has(> span))::after { content: none; }
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-sidebar-collapsed] [data-slot="sidebar.settings"] > div:first-child {
  width: var(--dsh-sidebar-footer-control-height);
}
/* Desktop has no persistent right details column when it is closed. Let the
   transcript and composer use that reclaimed width; a user drag still wins
   through the inline --dsh-chat-user-width value published by DSH. */
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  #root:has([data-details-collapsed]) [data-dsh-conversation-drop-target] {
  --dsh-chat-content-width: var(--dsh-chat-user-width, min(calc(100% - 32px), 1280px));
}
body[data-sensteed-agent-mode="extended"] .sensteedAgentSidebarSurface {
  --dsw-specific-sidebar-fill: transparent;
  border-right-color: transparent;
  background: transparent !important;
}
body[data-sensteed-agent-mode="extended"] .sensteedAgentFrame {
  background: var(--sensteed-agent-frame-fill);
}
body[data-sensteed-agent-mode="extended"] .sensteedAgentConversationSurface {
  box-sizing: border-box;
  overflow: hidden;
  border-top: 1px solid var(--dsw-alias-border-l1);
  border-left: 1px solid var(--dsw-alias-border-l1);
  border-top-left-radius: ${EXTENDED_INNER_CORNER_RADIUS}px;
  background: var(--dsw-alias-bg-base);
  background-clip: padding-box;
}
body[data-sensteed-agent-mode="extended"] .sensteedAgentDetailsSurface {
  box-sizing: border-box;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-sensteed-agent-content-viewport],
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])
  [data-sensteed-agent-frame="titlebar"] {
  isolation: isolate;
}
body:is([data-sensteed-agent-mode="compatibility"], [data-sensteed-agent-mode="extended"])[data-sensteed-agent-material="off"] {
  --sensteed-agent-frame-fill: var(--dsw-alias-bg-layer-1);
}
body[data-sensteed-agent-mode="compatibility"]:not([data-sensteed-agent-material="off"]) {
  --sensteed-agent-frame-fill: color-mix(in srgb, var(--dsw-alias-bg-base) 54%, transparent);
}
body[data-sensteed-agent-mode="extended"]:not([data-sensteed-agent-material="off"]) {
  --sensteed-agent-frame-fill: color-mix(in srgb, var(--dsw-alias-bg-base) 18%, transparent);
}
.sensteedAgentFrameTitlebar {
  position: fixed;
  z-index: 2147483647;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: ${DESKTOP_FRAME_HEIGHT}px;
  background: var(--sensteed-agent-frame-fill);
  color: var(--dsw-alias-label-primary);
  user-select: none;
  -webkit-app-region: drag;
}
.sensteedAgentFrameTitlebar[data-platform="darwin"] {
  padding: 0 8px 0 ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH + 8}px;
}
.sensteedAgentFrameTitlebar[data-platform="win32"] {
  padding: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH + 8}px 0 8px;
}
.sensteedAgentFrameIdentity {
  position: absolute;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  transform: translateX(-50%);
  pointer-events: none;
}
.sensteedAgentFrameProduct { font-size: 13px; font-weight: 600; white-space: nowrap; }
.sensteedAgentFrameVersion {
  min-height: 22px;
  padding: 2px 5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
  font: inherit;
  font-size: 11px;
  pointer-events: auto;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
.sensteedAgentFrameVersion:hover,
.sensteedAgentFrameVersion[data-popup-open],
.sensteedAgentFrameVersion:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.sensteedAgentFrameVersion:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dshShadcnHoverCardPositioner {
  z-index: 2147483647;
  outline: none;
  -webkit-app-region: no-drag;
}
.dshShadcnHoverCardContent {
  transform-origin: var(--transform-origin);
  transition: opacity 120ms ease, transform 120ms ease;
}
.dshShadcnHoverCardContent[data-starting-style],
.dshShadcnHoverCardContent[data-ending-style] {
  opacity: 0;
  transform: scale(.98);
}
.sensteedAgentVersionPopover {
  display: grid;
  gap: 9px;
  box-sizing: border-box;
  width: 210px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 32px color-mix(in srgb, #000 28%, transparent);
  -webkit-app-region: no-drag;
}
.sensteedAgentVersionPopoverHeader {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.sensteedAgentVersionPopoverHeader strong {
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
}
.sensteedAgentVersionCheckButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 48%, transparent);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  -webkit-app-region: no-drag;
}
.sensteedAgentVersionCheckButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentVersionCheckButton:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.sensteedAgentVersionCheckButton:disabled { cursor: default; opacity: .55; }
.sensteedAgentVersionCheckButton svg { width: 14px; height: 14px; stroke-width: 1.8; }
.sensteedAgentVersionCheckError {
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 1.4;
}
.sensteedAgentFrameMode {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  pointer-events: auto;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
.sensteedAgentFrameMode:hover,
.sensteedAgentFrameMode[data-popup-open],
.sensteedAgentFrameMode:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.sensteedAgentFrameMode:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.sensteedAgentModePopover {
  width: 292px;
  gap: 7px;
}
.sensteedAgentModePopoverHeader {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
}
.sensteedAgentModeOptions {
  display: grid;
  gap: 3px;
}
.sensteedAgentVersionPopover .sensteedAgentModeOption {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  box-sizing: border-box;
  width: 100%;
  height: auto;
  min-height: 50px;
  padding: 7px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
  white-space: normal;
  -webkit-app-region: no-drag;
}
.sensteedAgentVersionPopover .sensteedAgentModeOption:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.sensteedAgentVersionPopover .sensteedAgentModeOption:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}
.sensteedAgentVersionPopover .sensteedAgentModeOption:disabled {
  cursor: default;
  opacity: .55;
}
.sensteedAgentModeOption > svg {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  stroke-width: 1.8;
}
.sensteedAgentModeOptionCopy {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.sensteedAgentModeOptionCopy strong {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
}
.sensteedAgentModeOptionCopy small {
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-weight: 400;
  line-height: 1.35;
}
.sensteedAgentFrameActions {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  -webkit-app-region: no-drag;
}
.sensteedAgentFrameTitlebar[data-platform="darwin"] .sensteedAgentFrameActions { margin-left: auto; }
.sensteedAgentFrameTitlebar[data-platform="win32"] .sensteedAgentFrameActions { margin-right: auto; }
.sensteedAgentNativeActions { display: flex; align-items: center; gap: 6px; -webkit-app-region: no-drag; }
.sensteedAgentNativeActions[data-placement="titlebar"] {
  position: relative;
  gap: 3px;
}
.sensteedAgentTitlebarIconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 34%, transparent);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.sensteedAgentTitlebarIconButton:hover:not(:disabled),
.sensteedAgentTitlebarIconButton[aria-expanded="true"] {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.sensteedAgentTitlebarIconButton:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.sensteedAgentTitlebarIconButton:disabled { cursor: default; opacity: .45; }
.sensteedAgentTitlebarIconButton svg,
.sensteedAgentActionMenuItem svg { width: 14px; height: 14px; stroke-width: 1.8; }
.sensteedAgentNativeActionMenuAnchor { position: relative; }
.sensteedAgentActionMenuPositioner { z-index: 1; -webkit-app-region: no-drag; }
.sensteedAgentActionMenu {
  position: relative;
  z-index: 1;
  display: grid;
  min-width: 190px;
  padding: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 32px color-mix(in srgb, #000 28%, transparent);
  -webkit-app-region: no-drag;
}
.sensteedAgentActionMenuItem {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 32px;
  padding: 5px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: start;
}
.sensteedAgentActionMenuItem:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentActionMenuItem[data-highlighted] { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentActionMenuItem:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.sensteedAgentActionMenuItem:disabled { cursor: default; opacity: .45; }
.sensteedAgentActionMenuItem span { flex: 1; }
.sensteedAgentNativeActions[data-placement="titlebar"] .sensteedAgentNativeActionError {
  position: absolute;
  top: calc(100% + 5px);
  width: max-content;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.sensteedAgentFrameTitlebar[data-platform="darwin"] .sensteedAgentNativeActionError { right: 0; }
.sensteedAgentFrameTitlebar[data-platform="win32"] .sensteedAgentNativeActionError { left: 0; }
.sensteedAgentNativeActionError {
  max-width: 260px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 1.4;
}
`

export function installExtendedStyles(): () => void {
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/framed-shell'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
