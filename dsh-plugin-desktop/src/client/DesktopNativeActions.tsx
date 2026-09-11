/** Shared launcher-backed actions rendered in settings and extended title bars. */

import { Bug, ChevronDown, LifeBuoy, RefreshCw, RotateCw, SquareTerminal, Wrench } from 'lucide-react'
import { Menu } from '@base-ui/react/menu'
import { type ReactElement, type ReactNode, useRef, useState } from 'react'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'

export interface DesktopNativeActionsProps {
  readonly api: Pick<
    DesktopSettingsApi,
    'openTerminal' | 'restart' | 'restartToRecovery' | 'reloadRenderer' | 'toggleDeveloperTools'
  >
    & Partial<Pick<DesktopSettingsApi, 'exportDiagnostics'>>
  readonly t: (key: DesktopSettingsLocaleKey) => string
  readonly placement: 'settings' | 'titlebar'
}

interface DesktopRestartMenuItemsProps {
  readonly busy: boolean
  readonly t: DesktopNativeActionsProps['t']
  readonly onReload: () => void
  readonly onRestart: () => void
  readonly onRestartToRecovery: () => void
}

/** Shared keyboard, dismissal, and focus ownership for both menu entry points. */
function DesktopActionMenu({ open, onOpenChange, busy, trigger, children }: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly busy: boolean
  readonly trigger: ReactElement
  readonly children: ReactNode
}) {
  const anchor = useRef<HTMLDivElement>(null)
  return (
    <Menu.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <div className="dshDesktopNativeActionMenuAnchor" ref={anchor}>
        <Menu.Trigger disabled={busy} render={trigger} />
        <Menu.Portal container={anchor}>
          <Menu.Positioner className="dshDesktopActionMenuPositioner" sideOffset={5} align="end">
            <Menu.Popup className="dshDesktopActionMenu">{children}</Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </div>
    </Menu.Root>
  )
}

/** Shared restart-menu order for Settings and the independent Desktop title bar. */
export function DesktopRestartMenuItems({
  busy, t, onReload, onRestart, onRestartToRecovery,
}: DesktopRestartMenuItemsProps) {
  return (
    <>
      <Menu.Item nativeButton render={<button type="button" />} className="dshDesktopActionMenuItem" disabled={busy} onClick={onReload}>
        <RefreshCw aria-hidden="true" /><span>{t('reloadRenderer')}</span>
      </Menu.Item>
      <Menu.Item nativeButton render={<button type="button" />} className="dshDesktopActionMenuItem" disabled={busy} onClick={onRestart}>
        <RotateCw aria-hidden="true" /><span>{t('restartDesktop')}</span>
      </Menu.Item>
      <Menu.Item nativeButton render={<button type="button" />} className="dshDesktopActionMenuItem" disabled={busy} onClick={onRestartToRecovery}>
        <LifeBuoy aria-hidden="true" /><span>{t('restartToRecovery')}</span>
      </Menu.Item>
    </>
  )
}

/** Developer menu intentionally owns only the Developer Tools toggle. */
export function DesktopDeveloperMenuItems({
  busy, t, onToggleDeveloperTools,
}: {
  readonly busy: boolean
  readonly t: DesktopNativeActionsProps['t']
  readonly onToggleDeveloperTools: () => void
}) {
  return (
    <Menu.Item
      nativeButton
      render={<button type="button" />}
      className="dshDesktopActionMenuItem"
      disabled={busy}
      onClick={onToggleDeveloperTools}
    >
      <Bug aria-hidden="true" />
      <span>{t('toggleDeveloperTools')}</span>
    </Menu.Item>
  )
}

export function DesktopNativeActions({ api, t, placement }: DesktopNativeActionsProps) {
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false)
  const [opening, setOpening] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [rendererAction, setRendererAction] = useState<'reload' | 'devtools'>()
  const [restartMenuOpen, setRestartMenuOpen] = useState(false)
  const [developerMenuOpen, setDeveloperMenuOpen] = useState(false)
  const [failed, setFailed] = useState<'diagnostics' | 'terminal' | 'restart' | 'reload' | 'devtools'>()

  const busy = exportingDiagnostics || opening || restarting || rendererAction !== undefined

  const exportDiagnostics = (): void => {
    if (busy || api.exportDiagnostics === undefined) return
    setExportingDiagnostics(true)
    setFailed(undefined)
    void api.exportDiagnostics()
      .catch(() => { setFailed('diagnostics') })
      .finally(() => { setExportingDiagnostics(false) })
  }

  const open = (): void => {
    if (busy) return
    setOpening(true)
    setFailed(undefined)
    void api.openTerminal()
      .catch(() => { setFailed('terminal') })
      .finally(() => { setOpening(false) })
  }

  const restart = (recovery = false): void => {
    if (busy) return
    setRestarting(true)
    setRestartMenuOpen(false)
    setFailed(undefined)
    const operation = recovery ? api.restartToRecovery : api.restart
    void operation()
      .catch(() => { setFailed('restart') })
      .finally(() => { setRestarting(false) })
  }

  const runRendererAction = (action: 'reload' | 'devtools'): void => {
    if (busy) return
    const operation = action === 'reload' ? api.reloadRenderer : api.toggleDeveloperTools
    setRendererAction(action)
    setDeveloperMenuOpen(false)
    setRestartMenuOpen(false)
    setFailed(undefined)
    void operation().catch(() => {
      setFailed(action)
    }).finally(() => {
      setRendererAction(undefined)
    })
  }

  const failureKey = failed === 'diagnostics'
    ? 'exportDiagnosticsError'
    : failed === 'terminal'
    ? 'openTerminalError'
    : failed === 'restart'
      ? 'restartDesktopError'
      : failed === 'reload'
        ? 'reloadRendererError'
        : 'toggleDeveloperToolsError'

  if (placement === 'settings') {
    return (
      <div className="dshDesktopNativeActions" data-placement={placement}>
        {failed !== undefined && (
          <span className="dshDesktopNativeActionError" role="alert">{t(failureKey)}</span>
        )}
        {api.exportDiagnostics !== undefined && (
          <button
            type="button"
            className="dshDesktopSettingsHeaderButton"
            disabled={busy}
            onClick={exportDiagnostics}
          >
            {t(exportingDiagnostics ? 'exportingDiagnostics' : 'exportDiagnostics')}
          </button>
        )}
        <button
          type="button"
          className="dshDesktopSettingsHeaderButton"
          disabled={busy}
          onClick={open}
        >
          {t(opening ? 'openingTerminal' : 'openTerminal')}
        </button>
        <DesktopActionMenu open={restartMenuOpen} onOpenChange={setRestartMenuOpen} busy={busy} trigger={
          <button
            type="button"
            className="dshDesktopSettingsHeaderButton"
          >
            {t(restarting ? 'restartingDesktop' : 'restartDesktop')}
            <ChevronDown aria-hidden="true" />
          </button>
        }>
          <DesktopRestartMenuItems
            busy={busy}
            t={t}
            onReload={() => { runRendererAction('reload') }}
            onRestart={() => { restart() }}
            onRestartToRecovery={() => { restart(true) }}
          />
        </DesktopActionMenu>
      </div>
    )
  }

  return (
    <div className="dshDesktopNativeActions" data-placement={placement}>
      {failed !== undefined && (
        <span className="dshDesktopNativeActionError" role="alert">{t(failureKey)}</span>
      )}
      <button
        type="button"
        className="dshDesktopTitlebarIconButton"
        aria-label={t('openTerminal')}
        title={t('openTerminal')}
        disabled={busy}
        onClick={open}
      >
        <SquareTerminal aria-hidden="true" />
      </button>
      <DesktopActionMenu open={restartMenuOpen} onOpenChange={open => {
        setRestartMenuOpen(open)
        if (open) setDeveloperMenuOpen(false)
      }} busy={busy} trigger={
        <button
          type="button"
          className="dshDesktopTitlebarIconButton"
          aria-label={t('restartOptions')}
          title={t('restartOptions')}
        >
          <RotateCw aria-hidden="true" />
        </button>
      }>
        <DesktopRestartMenuItems
          busy={busy}
          t={t}
          onReload={() => { runRendererAction('reload') }}
          onRestart={() => { restart() }}
          onRestartToRecovery={() => { restart(true) }}
        />
      </DesktopActionMenu>
      <DesktopActionMenu open={developerMenuOpen} onOpenChange={open => {
        setDeveloperMenuOpen(open)
        if (open) setRestartMenuOpen(false)
      }} busy={busy} trigger={
        <button
          type="button"
          className="dshDesktopTitlebarIconButton"
          aria-label={t('developerOptions')}
          title={t('developerOptions')}
        >
          <Wrench aria-hidden="true" />
        </button>
      }>
        <DesktopDeveloperMenuItems
          busy={busy}
          t={t}
          onToggleDeveloperTools={() => { runRendererAction('devtools') }}
        />
      </DesktopActionMenu>
    </div>
  )
}
