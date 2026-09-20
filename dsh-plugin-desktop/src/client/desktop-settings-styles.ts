/** Desktop settings section styles, installed independently of presentation mode. */

const STYLE_ID = 'sensteed-agent-settings-styles'

const CSS = `
.sensteedAgentSettings {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: min(100%, 880px);
  padding: 2px 0 36px;
  color: var(--dsw-alias-label-primary);
}
.sensteedAgentSettingsHeader h2,
.sensteedAgentSettingsGroup h3 {
  margin: 0;
  font-weight: 600;
}
.sensteedAgentSettingsHeader h2 { font-size: 22px; line-height: 1.35; }
.sensteedAgentSettingsGroup h3 { font-size: 16px; line-height: 1.4; }
.sensteedAgentSettingsHeader p,
.sensteedAgentSettingsGroupIntro,
.sensteedAgentSettingsHint {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.sensteedAgentSettingsGroup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.sensteedAgentSettingsList { display: grid; gap: 8px; }
.sensteedAgentSettingsChoice,
.sensteedAgentSettingsToggleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.sensteedAgentSettingsChoice {
  box-sizing: border-box;
  width: 100%;
  color: inherit;
  cursor: default;
  text-align: left;
  font: inherit;
}
.sensteedAgentSettingsChoice[data-actionable="true"] { cursor: pointer; }
.sensteedAgentSettingsChoice[data-actionable="true"]:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentSettingsChoice:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.sensteedAgentSettingsChoice[data-selected="true"] {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary);
}
.sensteedAgentSettingsChoice[aria-disabled="true"]:not([data-selected="true"]) { opacity: .58; }
.sensteedAgentSettingsChoiceCopy { display: block; flex: 1; min-width: 0; }
.sensteedAgentSettingsToggleLabel { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.sensteedAgentSettingsChoiceAside { flex: 0 0 auto; margin-left: 12px; }
.sensteedAgentSettingsDeleteConfirm { display: flex; align-items: flex-end; flex-direction: column; gap: 8px; max-width: 320px; }
.sensteedAgentSettingsDeleteWarning { color: var(--dsw-alias-state-warn-primary); font-size: 12px; line-height: 1.4; text-align: right; }
.sensteedAgentSettingsDeleteActions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.sensteedAgentSettingsChoiceTitle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}
.sensteedAgentSettingsChoiceBody {
  display: block;
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.sensteedAgentSettingsChoiceLink {
  color: var(--dsw-alias-brand-primary);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.sensteedAgentSettingsChoiceLink:hover { text-decoration-thickness: 2px; }
.sensteedAgentSettingsChoiceTitle .sensteedAgentSettingsChoiceLink {
  text-decoration: none;
}
.sensteedAgentSettingsChoiceTitle .sensteedAgentSettingsChoiceLink:hover {
  opacity: .82;
}
.sensteedAgentSettingsBadge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 400;
}
.sensteedAgentSettingsForm {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.sensteedAgentSettingsField {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.sensteedAgentSettingsField > span { width: 100%; }
.sensteedAgentSettingsFieldHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sensteedAgentSettingsCredentialStatus { color: var(--dsw-alias-label-secondary); }
.sensteedAgentSettingsCredentialForm {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.sensteedAgentSettingsSecretInput { position: relative; display: block; }
.sensteedAgentSettingsSecretInput .sensteedAgentSettingsInput { padding-right: 40px; }
.sensteedAgentSettingsSecretReveal {
  position: absolute;
  top: 50%;
  right: 4px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  transform: translateY(-50%);
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.sensteedAgentSettingsSecretReveal:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentSettingsSecretReveal:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.sensteedAgentSettingsSecretReveal:disabled { cursor: default; opacity: .55; }
.sensteedAgentSettingsSecretReveal svg { width: 16px; height: 16px; stroke-width: 1.8; }
.sensteedAgentSettingsCredentialActions { display: flex; gap: 8px; padding-bottom: 18px; }
.sensteedAgentSettingsInput {
  width: 100%;
  min-height: 36px;
  box-sizing: border-box;
  padding: 7px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.sensteedAgentSettingsInput:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.sensteedAgentSettingsButton {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 5px 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.sensteedAgentSettingsButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentSettingsButtonSecondary { color: var(--dsw-alias-label-secondary); }
.sensteedAgentSettingsButtonDanger { color: var(--dsw-alias-state-error-primary); }
.sensteedAgentSettingsButton:disabled { cursor: default; opacity: .55; }
.sensteedAgentNativeActions[data-placement="settings"] {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentNativeActionMenuAnchor { position: relative; }
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenuPositioner { z-index: 2147483001; -webkit-app-region: no-drag; }
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenu {
  position: relative;
  z-index: 2147483001;
  display: grid;
  grid-auto-flow: row;
  grid-template-columns: minmax(0, 1fr);
  min-width: 220px;
  padding: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 32px color-mix(in srgb, #000 28%, transparent);
  -webkit-app-region: no-drag;
}
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenuItem {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
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
  white-space: nowrap;
}
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenuItem:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenuItem[data-highlighted] { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenuItem:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenuItem:disabled { cursor: default; opacity: .45; }
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenuItem svg { width: 14px; height: 14px; stroke-width: 1.8; }
.sensteedAgentNativeActions[data-placement="settings"] .sensteedAgentActionMenuItem span { flex: 1; }
.sensteedAgentSettingsHeaderButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
}
.sensteedAgentSettingsHeaderButton svg { width: 14px; height: 14px; margin-left: 5px; }
.sensteedAgentSettingsHeaderButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.sensteedAgentSettingsHeaderButton:disabled { cursor: not-allowed; opacity: .4; }
.sensteedAgentNativeActionError {
  max-width: 260px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 1.4;
}
.sensteedAgentSettingsMaterialField {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.sensteedAgentSettingsMaterialCopy { min-width: 0; }
.sensteedAgentSettingsSelect {
  flex: 0 0 auto;
  min-width: 150px;
  min-height: 32px;
  padding: 4px 28px 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}
.sensteedAgentSettingsSelect:disabled { opacity: .55; }
.sensteedAgentSettingsNotice,
.sensteedAgentSettingsError,
.sensteedAgentSettingsSuccess {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.55;
}
.sensteedAgentSettingsNotice { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.sensteedAgentSettingsError { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.sensteedAgentSettingsSuccess { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.sensteedAgentSettingsToggle {
  flex: 0 0 auto;
  position: relative;
  width: 40px;
  height: 22px;
  padding: 2px;
  border: none;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  cursor: pointer;
  transition: background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.sensteedAgentSettingsToggle[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary);
}
.sensteedAgentSettingsToggle:disabled { cursor: default; opacity: .5; }
.sensteedAgentSettingsToggle:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.sensteedAgentSettingsToggleKnob {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .24);
  transform: translateX(0);
  transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.sensteedAgentSettingsToggle[aria-checked="true"] .sensteedAgentSettingsToggleKnob {
  transform: translateX(18px);
}
.sensteedAgentSettingsDetails {
  display: grid;
  gap: 8px;
  padding-left: 14px;
  border-left: 2px solid var(--dsw-alias-border-l1);
}
.sensteedAgentSettingsLanStatus {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.sensteedAgentSettingsLanStatus[data-state="ready"] .sensteedAgentSettingsBadge {
  color: var(--dsw-alias-state-success-primary);
}
.sensteedAgentSettingsLanStatus[data-state="failed"] .sensteedAgentSettingsBadge {
  color: var(--dsw-alias-state-error-primary);
}
.sensteedAgentSettingsLanStatus code,
.sensteedAgentSettingsLanFingerprint code {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.sensteedAgentSettingsLanFingerprint {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.sensteedAgentSettingsUrls {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.sensteedAgentSettingsUrls a {
  width: fit-content;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-brand-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.sensteedAgentSettingsUrlRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
}
.sensteedAgentSettingsUrlRow a {
  flex: 1;
  min-width: 0;
  width: auto;
  white-space: nowrap;
  overflow-x: auto;
  overflow-wrap: normal;
  padding-block: 4px;
  text-decoration: none;
}
.sensteedAgentSettingsUrlCopy {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.sensteedAgentSettingsUrlCopy:hover { background: var(--dsw-alias-bg-layer-2); }
.sensteedAgentSettingsUrlCopy:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sensteedAgentSettingsUrlCopy:disabled { opacity: 0.5; cursor: wait; }
.sensteedAgentSettingsDialogBackdrop {
  position: fixed;
  z-index: 2147483002;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, #000 55%, transparent);
}
.sensteedAgentSettingsDialog {
  width: min(440px, 100%);
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 24px 64px color-mix(in srgb, #000 38%, transparent);
}
.sensteedAgentSettingsDialog h3 { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 16px; }
.sensteedAgentSettingsDialog p { margin: 12px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.65; }
.sensteedAgentSettingsDialogActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
@media (max-width: 720px) {
  .sensteedAgentSettingsChoice,
  .sensteedAgentSettingsToggleRow { align-items: flex-start; }
  .sensteedAgentSettingsForm { align-items: stretch; flex-direction: column; }
  .sensteedAgentSettingsCredentialForm { align-items: stretch; flex-direction: column; }
  .sensteedAgentSettingsCredentialActions { padding-bottom: 0; }
}
`

/** Install one scoped stylesheet; tolerate headless Client boot. */
export function installDesktopSettingsStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
