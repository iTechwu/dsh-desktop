/**
 * Ready-state install dialog styling, portaled to the document root. Only
 * defined DSW aliases are referenced; no fixed colors on adaptive fills.
 */

const STYLE_ID = 'sensteed-agent-update-dialog-styles'

const CSS = `
.dshDesktopUpdateDialogHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.dshDesktopUpdateDialogHeader h3,
.sensteedAgentSettingsDialog.dshDesktopUpdateDialog h3 {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}
.dshDesktopUpdateDialogHeader h3 { flex: 1; min-width: 0; }
.dshDesktopUpdateDialogClose {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 16px;
  line-height: 24px;
  cursor: pointer;
}
.dshDesktopUpdateDialogClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshDesktopUpdateDialogClose:disabled {
  cursor: default;
  opacity: 0.5;
}
.dshDesktopUpdateDialogClose:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.sensteedAgentSettingsDialog.dshDesktopUpdateDialog .dshDesktopUpdateDialogError {
  color: var(--dsw-alias-state-error-primary);
}
`

/** Install the dialog sheet once; tolerate headless Client boot. */
export function installDesktopUpdateDialogStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.append(element)
  return () => { element.remove() }
}
