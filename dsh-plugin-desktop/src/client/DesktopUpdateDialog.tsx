/**
 * Ready-state install dialog, portaled beside the document root so the sidebar
 * containment never clips it. The upstream indicator beside Settings owns the
 * badge presentation; this dialog only confirms the platform handoff.
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DesktopUpdateApi, DesktopUpdateSnapshot } from './desktop-update-api.ts'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'

/** Polling cadence for browsers without the Electron updates bridge. */
export const DESKTOP_UPDATE_DIALOG_IDLE_INTERVAL_MS = 3000

function renderTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    template,
  )
}

/** Pure dialog presentation, shared by the live host and tests. */
export function DesktopUpdateModal({
  version,
  platform,
  installFailed,
  busy,
  onInstall,
  onClose,
  t,
}: {
  readonly version: string
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly installFailed: boolean
  readonly busy: boolean
  readonly onInstall: () => void
  readonly onClose: () => void
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => { dialogRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Escape mirrors the backdrop dismissal; a busy handoff stays modal.
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [busy, onClose])
  const dismiss = (): void => {
    if (!busy) onClose()
  }
  return createPortal(
    <div
      className="sensteedAgentSettingsDialogBackdrop"
      role="presentation"
      onClick={dismiss}
    >
      <div
        className="sensteedAgentSettingsDialog dshDesktopUpdateDialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dsh-desktop-update-dialog-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
      >
        <div className="dshDesktopUpdateDialogHeader">
          <h3 id="dsh-desktop-update-dialog-title">
            {renderTemplate(t('updateModalReadyTitle'), { version })}
          </h3>
          <button
            type="button"
            className="dshDesktopUpdateDialogClose"
            disabled={busy}
            aria-label={t('updateModalClose')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p>{t('updateModalCloseNotice')}</p>
        <p>{t('updateModalPatienceNotice')}</p>
        {installFailed && (
          <p className="dshDesktopUpdateDialogError" role="alert">{t('updateModalInstallFailed')}</p>
        )}
        <div className="sensteedAgentSettingsDialogActions">
          <Button variant="primary" disabled={busy} onClick={onInstall}>
            {platform === 'darwin' ? t('updateModalOpenImage') : t('updateModalInstallRestart')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export interface DesktopUpdateDialogInjected {
  readonly api: DesktopUpdateApi
}

type DesktopUpdateDialogProps = DesktopUpdateDialogInjected
  & { readonly platform?: 'darwin' | 'win32' | 'linux' | undefined }
  & { readonly t: (key: DesktopSettingsLocaleKey) => string }

/**
 * Live dialog host: follows the update snapshot (bridge subscription when the
 * Electron carrier is present, same-origin polling otherwise) and opens once
 * per ready transition. The upstream indicator owns every other state.
 */
export function DesktopUpdateDialogHost({ platform = 'win32', api, t }: DesktopUpdateDialogProps) {
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot>({ phase: 'idle' })
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  useEffect(() => {
    const carrier = (globalThis as typeof globalThis & {
      dshDesktop?: { updates?: { subscribe(listener: (state: unknown) => void): () => void } }
    }).dshDesktop
    const apply = (next: DesktopUpdateSnapshot): void => {
      if (mounted.current) setSnapshot(next)
    }
    if (carrier?.updates) return carrier.updates.subscribe((state: unknown) => { apply(parseSnapshot(state)) })
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let last: DesktopUpdateSnapshot = { phase: 'idle' }
    const controller = new AbortController()
    const tick = async (): Promise<void> => {
      try {
        last = await api.readUpdateState(controller.signal)
        if (cancelled) return
        apply(last)
      } catch {
        // Transient polling failures keep the last known snapshot.
        if (controller.signal.aborted) return
      }
      if (cancelled) return
      timer = setTimeout(() => { void tick() }, DESKTOP_UPDATE_DIALOG_IDLE_INTERVAL_MS)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      controller.abort()
    }
  }, [api])
  // Open while the lifecycle reports a ready artifact; closing latches the
  // dismissal until the lifecycle leaves ready (rotation, install, restart).
  useEffect(() => {
    if (snapshot.phase !== 'ready') {
      setDismissed(false)
      if (snapshot.phase === 'restarting') setInstalling(false)
    }
  }, [snapshot.phase])

  const runInstall = (): void => {
    if (installing) return
    setInstalling(true)
    void (async () => {
      try {
        await api.installUpdateNow()
      } catch {
        // The follow-up refresh carries the host-side installFailed marker.
      }
      try {
        const next = await api.readUpdateState()
        if (mounted.current) setSnapshot(next)
      } catch {
        // The regular cadence re-syncs the snapshot shortly afterwards.
      }
      if (mounted.current) setInstalling(false)
    })()
  }

  if (snapshot.phase !== 'ready' || snapshot.version === undefined || dismissed) return null
  return createPortal(
    <DesktopUpdateModal
      version={snapshot.version}
      platform={platform}
      installFailed={snapshot.installFailed === true}
      busy={installing}
      onInstall={runInstall}
      onClose={() => { setDismissed(true) }}
      t={t}
    />,
    document.body,
  )
}

function parseSnapshot(state: unknown): DesktopUpdateSnapshot {
  if (typeof state !== 'object' || state === null) return { phase: 'idle' }
  const phase = (state as { phase?: unknown }).phase
  if (phase === 'ready' || phase === 'restarting' || phase === 'available' || phase === 'downloading' || phase === 'idle') {
    return state as DesktopUpdateSnapshot
  }
  // Bridge error presentations fold into ready-with-failure for the dialog.
  const record = state as { failure?: unknown; version?: unknown }
  if (phase === 'error' && record.failure === 'install') {
    return {
      phase: 'ready',
      ...(typeof record.version === 'string' ? { version: record.version } : {}),
      installFailed: true,
    }
  }
  return { phase: 'idle' }
}
