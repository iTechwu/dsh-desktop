/**
 * Sidebar update badge styling, aligned with the upstream footer launchers.
 * Only defined DSW aliases are referenced; no fixed colors on adaptive fills.
 */

const STYLE_ID = 'sensteed-agent-update-badge-styles'

const CSS = `
.dshDesktopUpdateBadge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  max-width: 100%;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dshDesktopUpdateBadge:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.dshDesktopUpdateBadgeLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 26px;
  font-variant-numeric: tabular-nums;
}
.dshDesktopUpdateBadgeGlyph,
.dshDesktopUpdateBadgeRing {
  flex: none;
}
.dshDesktopUpdateBadgeSpinner {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  animation: dshDesktopUpdateBadgeSpin 0.8s linear infinite;
}
@keyframes dshDesktopUpdateBadgeSpin {
  to { transform: rotate(360deg); }
}
`

/** Install the badge sheet once; tolerate headless Client boot. */
export function installDesktopUpdateBadgeStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.append(element)
  return () => { element.remove() }
}
