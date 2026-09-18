/** Independent Desktop frame portalled above the upstream content viewport. */

import { LayoutTemplate, PanelTop, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'
import type { DesktopClientEnvironment, DesktopClientMode } from './environment.ts'
import { DesktopNativeActions } from './DesktopNativeActions.tsx'
import { Button } from '../native-ui/components/ui/button.tsx'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '../native-ui/components/ui/hover-card.tsx'
import { BRAND_DISPLAY_NAME } from '../generated-product-identity.ts'

export interface DesktopFrameTitlebarInjected {
  readonly environment: DesktopClientEnvironment
  readonly api: Pick<
    DesktopSettingsApi,
    'openTerminal' | 'restart' | 'restartToRecovery' | 'reloadRenderer' | 'toggleDeveloperTools' | 'checkForUpdates'
  >
  readonly remoteControl?: { readonly seen: boolean; open(): Promise<void> }
  readonly setMode: (mode: DesktopClientMode) => Promise<void>
}

export function DesktopVersionControl({
  version,
  checkForUpdates,
  t,
}: {
  readonly version: string
  readonly checkForUpdates: () => Promise<void>
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const runCheck = (): void => {
    if (checking) return
    setChecking(true)
    setFailed(false)
    void checkForUpdates()
      .catch(() => { setFailed(true) })
      .finally(() => { setChecking(false) })
  }
  const visibleVersion = `v${version}`
  return (
    <HoverCard>
      <HoverCardTrigger
        closeDelay={200}
        delay={150}
        render={<button type="button" className="sensteedAgentFrameVersion" />}
        aria-label={`${t('currentVersion')} ${visibleVersion}`}
      >
        {visibleVersion}
      </HoverCardTrigger>
      <HoverCardContent className="sensteedAgentVersionPopover">
        <div className="sensteedAgentVersionPopoverHeader">
          <span>{t('currentVersion')}</span>
          <strong>{visibleVersion}</strong>
        </div>
        <Button
          className="sensteedAgentVersionCheckButton"
          disabled={checking}
          size="sm"
          variant="outline"
          onClick={runCheck}
        >
          <RefreshCw aria-hidden="true" />
          <span>{t(checking ? 'checkingForUpdates' : 'checkForUpdates')}</span>
        </Button>
        {failed && <span className="sensteedAgentVersionCheckError" role="alert">{t('checkForUpdatesError')}</span>}
      </HoverCardContent>
    </HoverCard>
  )
}

const MODE_OPTIONS = [
  { mode: 'compatibility', title: 'compatibilityMode', body: 'compatibilityModeBody' },
  { mode: 'extended', title: 'extendedMode', body: 'extendedModeBody' },
  { mode: 'advanced', title: 'advancedMode', body: 'advancedModeBody' },
] as const satisfies readonly {
  readonly mode: DesktopClientMode
  readonly title: DesktopSettingsLocaleKey
  readonly body: DesktopSettingsLocaleKey
}[]

function DesktopModeIcon({ mode }: { readonly mode: DesktopClientMode }) {
  if (mode === 'compatibility') return <LayoutTemplate aria-hidden="true" />
  if (mode === 'extended') return <PanelTop aria-hidden="true" />
  return <Sparkles aria-hidden="true" />
}

/** Persist a presentation choice before opening the standard Desktop restart confirmation. */
export async function selectDesktopFrameMode(
  mode: DesktopClientMode,
  setMode: (mode: DesktopClientMode) => Promise<void>,
  restart: () => Promise<void>,
): Promise<void> {
  await setMode(mode)
  await restart()
}

export function DesktopModeControl({
  mode,
  setMode,
  restart,
  t,
}: {
  readonly mode: DesktopClientMode
  readonly remoteControl?: { readonly seen: boolean; open(): Promise<void> }
  readonly setMode: (mode: DesktopClientMode) => Promise<void>
  readonly restart: () => Promise<void>
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  const [switching, setSwitching] = useState<DesktopClientMode>()
  const [failed, setFailed] = useState(false)
  const current = MODE_OPTIONS.find(option => option.mode === mode)
  if (current === undefined) return null

  const switchTo = (next: DesktopClientMode): void => {
    if (switching !== undefined || next === mode) return
    setSwitching(next)
    setFailed(false)
    void selectDesktopFrameMode(next, setMode, restart)
      .catch(() => { setFailed(true) })
      .finally(() => { setSwitching(undefined) })
  }

  return (
    <HoverCard>
      <HoverCardTrigger
        closeDelay={200}
        delay={150}
        render={<button type="button" className="sensteedAgentFrameMode" />}
        aria-label={`${t('presentationTitle')}: ${t(current.title)}`}
      >
        {t(current.title)}
      </HoverCardTrigger>
      <HoverCardContent className="sensteedAgentVersionPopover sensteedAgentModePopover">
        <div className="sensteedAgentModePopoverHeader">{t('switchPresentationMode')}</div>
        <div className="sensteedAgentModeOptions" role="group" aria-label={t('switchPresentationMode')}>
          {MODE_OPTIONS.filter(option => option.mode !== mode).map(option => (
            <Button
              className="sensteedAgentModeOption"
              disabled={switching !== undefined}
              key={option.mode}
              size="sm"
              variant="ghost"
              onClick={() => { switchTo(option.mode) }}
            >
              <DesktopModeIcon mode={option.mode} />
              <span className="sensteedAgentModeOptionCopy">
                <strong>{t(option.title)}</strong>
                <small>{switching === option.mode ? t('switchingPresentationMode') : t(option.body)}</small>
              </span>
            </Button>
          ))}
        </div>
        {failed && <span className="sensteedAgentVersionCheckError" role="alert">{t('switchPresentationModeError')}</span>}
      </HoverCardContent>
    </HoverCard>
  )
}

/** Horizontal frame surface; the unrelated upstream content starts below it. */
export function DesktopFrameTitlebarView({ api, environment, setMode, t, remoteControl }: DesktopFrameTitlebarInjected & {
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  return (
    <header
      className="sensteedAgentFrameTitlebar"
      data-sensteed-agent-frame="titlebar"
      data-mode={environment.mode}
      data-platform={environment.platform}
      data-material={environment.material}
    >
      <div className="sensteedAgentFrameIdentity">
        <span className="sensteedAgentFrameProduct">{BRAND_DISPLAY_NAME.titlebar}</span>
        <DesktopVersionControl version={environment.version} checkForUpdates={api.checkForUpdates} t={t} />
        <DesktopModeControl
          mode={environment.mode}
          setMode={setMode}
          restart={api.restart}
          t={t}
        />
      </div>
      <div className="sensteedAgentFrameActions">
        {remoteControl && <button type="button" className="sensteedAgentFrameMode sensteedAgentRemoteControl" onClick={() => { void remoteControl.open().catch(() => {}) }}>
          {t('remoteControl')}{!remoteControl.seen && <span className="sensteedAgentRemoteControlDot" aria-label={t('remoteControlNew')} />}
        </button>}
        <DesktopNativeActions api={api} t={t} placement="titlebar" />
      </div>
    </header>
  )
}
