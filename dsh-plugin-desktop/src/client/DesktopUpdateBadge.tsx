/** Sidebar footer update badge aligned with the Desktop release flow. */

import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef, useState } from 'react'
import type { DesktopUpdateApi, DesktopUpdateSnapshot } from './desktop-update-api.ts'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import type { DesktopClientPlatform } from './environment.ts'

/** Polling cadence while the badge tracks a live download or handoff. */
export const DESKTOP_UPDATE_BADGE_ACTIVE_INTERVAL_MS = 500
/** Polling cadence while no update operation is in flight (including ready). */
export const DESKTOP_UPDATE_BADGE_IDLE_INTERVAL_MS = 3000

const PROGRESS_RING_RADIUS = 7
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS

function isActivePhase(phase: DesktopUpdateSnapshot['phase']): boolean {
  // A ready artifact waits for the user, so it keeps the relaxed cadence; the
  // sidebar still notices a rotated release within one idle interval.
  return phase === 'downloading' || phase === 'restarting'
}

export function updateBadgePercent(snapshot: DesktopUpdateSnapshot): number | undefined {
  if (snapshot.phase !== 'downloading') return undefined
  if (snapshot.received === undefined) return undefined
  if (snapshot.total === undefined) return undefined
  return Math.min(100, Math.floor((snapshot.received / snapshot.total) * 100))
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    template,
  )
}

/** Pure badge presentation, shared by the live component and tests. */
export function DesktopUpdateBadgeView({
  wide,
  snapshot,
  onPrimary,
  t,
}: {
  readonly wide?: boolean | undefined
  readonly snapshot: DesktopUpdateSnapshot
  readonly onPrimary?: ((snapshot: DesktopUpdateSnapshot) => void) | undefined
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  if (snapshot.phase === 'idle') return null
  const percent = updateBadgePercent(snapshot)
  const version = snapshot.version ?? ''
  const badgeTooltip = snapshot.phase === 'downloading'
    ? undefined
    : snapshot.downloadFailed === true
      ? t('updateBadgeDownloadFailed')
      : snapshot.installFailed === true
        ? t('updateBadgeInstallFailed')
        : version === ''
          ? t('updateBadgeAvailable')
          : snapshot.phase === 'ready'
            ? renderTemplate(t('updateBadgeReady'), { version })
            : renderTemplate(t('updateBadgeVersion'), { version })
  const clickable = snapshot.phase === 'available' || snapshot.phase === 'ready'
  const label = snapshot.phase === 'downloading' && percent !== undefined
    ? `${String(percent)}%`
    : snapshot.phase === 'restarting'
      ? t('updateBadgeRestarting')
      : t('updateBadgeAvailable')
  const badge = (
    <Button
      variant="ghost"
      className="dshDesktopUpdateBadge"
      data-phase={snapshot.phase}
      data-wide={wide === true}
      aria-label={badgeTooltip ?? label}
      onClick={clickable ? () => onPrimary?.(snapshot) : undefined}
    >
      {snapshot.phase === 'downloading' ? (
        percent === undefined ? (
          <span className="dshDesktopUpdateBadgeSpinner" aria-hidden="true" />
        ) : (
          <svg
            className="dshDesktopUpdateBadgeRing"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r={PROGRESS_RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="2"
            />
            <circle
              cx="8"
              cy="8"
              r={PROGRESS_RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={PROGRESS_RING_CIRCUMFERENCE}
              strokeDashoffset={PROGRESS_RING_CIRCUMFERENCE * (1 - percent / 100)}
              transform="rotate(-90 8 8)"
            />
          </svg>
        )
      ) : snapshot.phase === 'ready' ? (
        <svg
          className="dshDesktopUpdateBadgeGlyph"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 8.5 6.5 12 13 5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : snapshot.phase === 'restarting' ? (
        <span className="dshDesktopUpdateBadgeSpinner" aria-hidden="true" />
      ) : (
        <svg
          className="dshDesktopUpdateBadgeGlyph"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 2v8m0 0 3.2-3.2M8 10 4.8 6.8M2.5 13.5h11"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {wide || snapshot.phase === 'downloading' || snapshot.phase === 'restarting'
        ? <span className="dshDesktopUpdateBadgeLabel">{label}</span>
        : null}
    </Button>
  )
  if (badgeTooltip === undefined) return badge
  return (
    <Tooltip label={badgeTooltip} delayMs={500}>
      {badge}
    </Tooltip>
  )
}

export interface DesktopUpdateBadgeInjected {
  readonly api: DesktopUpdateApi
  readonly onPrimary?: (snapshot: DesktopUpdateSnapshot) => void
}

/** Ready-state install dialog, presented with the shared client dialog styling. */
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
  readonly platform: DesktopClientPlatform
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
  return (
    <div
      className="sensteedAgentSettingsDialogBackdrop"
      role="presentation"
      onClick={dismiss}
    >
      <div
        className="sensteedAgentSettingsDialog dshDesktopUpdateModal"
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dsh-desktop-update-modal-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="dshDesktopUpdateModalHeader">
          <h3 id="dsh-desktop-update-modal-title">
            {renderTemplate(t('updateModalReadyTitle'), { version })}
          </h3>
          <button
            type="button"
            className="dshDesktopUpdateModalClose"
            aria-label={t('updateModalClose')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p>{t('updateModalCloseNotice')}</p>
        <p>{t('updateModalPatienceNotice')}</p>
        {installFailed && (
          <p className="dshDesktopUpdateModalError" role="alert">{t('updateModalInstallFailed')}</p>
        )}
        <div className="sensteedAgentSettingsDialogActions">
          <Button variant="primary" disabled={busy} onClick={onInstall}>
            {platform === 'darwin' ? t('updateModalOpenImage') : t('updateModalInstallRestart')}
          </Button>
        </div>
      </div>
    </div>
  )
}

type DesktopUpdateBadgeProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'desktop.settings'>
  & DesktopUpdateBadgeInjected
  & { readonly platform?: DesktopClientPlatform | undefined }

/** Live badge: Host-driven polling plus the shared sidebar action entry. */
export function DesktopUpdateBadge({ wide, platform = 'win32', api, t, onPrimary }: DesktopUpdateBadgeProps) {
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot>({ phase: 'idle' })
  const [modalOpen, setModalOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    let last: DesktopUpdateSnapshot = { phase: 'idle' }
    const tick = async (): Promise<void> => {
      try {
        last = await api.readUpdateState(controller.signal)
        if (cancelled) return
        setSnapshot(last)
      } catch {
        // Transient polling failures keep the last rendered phase and cadence;
        // an aborted poll belongs to an unmounted badge and stays silent.
        if (controller.signal.aborted) return
      }
      if (cancelled) return
      timer = setTimeout(() => { void tick() },
        isActivePhase(last.phase)
          ? DESKTOP_UPDATE_BADGE_ACTIVE_INTERVAL_MS
          : DESKTOP_UPDATE_BADGE_IDLE_INTERVAL_MS,
      )
    }
    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      controller.abort()
    }
  }, [api])
  // A handoff closes the dialog: the badge takes over with the restarting view.
  useEffect(() => {
    if (snapshot.phase === 'restarting') setModalOpen(false)
    if (snapshot.phase !== 'ready') setInstalling(false)
  }, [snapshot.phase])
  const handlePrimary = (current: DesktopUpdateSnapshot): void => {
    if (current.phase === 'available') {
      // The Host owns re-entry protection; a failed start just keeps the badge.
      void api.startUpdateDownload().catch(() => {})
      return
    }
    if (current.phase === 'ready') {
      setModalOpen(true)
      onPrimary?.(current)
    }
  }
  const runInstall = (): void => {
    if (installing) return
    setInstalling(true)
    void (async () => {
      try {
        await api.installUpdateNow()
      } catch {
        // A rejected command still resolves through the follow-up refresh; the
        // host-side installFailed marker drives the visible retry affordance.
      }
      // Refresh immediately: restarting closes the dialog, a failed handoff
      // lands back on ready with the marker, and macOS manual returns to ready.
      try {
        const next = await api.readUpdateState()
        if (mounted.current) setSnapshot(next)
      } catch {
        // The regular cadence re-syncs the snapshot shortly afterwards.
      }
      if (mounted.current) setInstalling(false)
    })()
  }
  return (
    <>
      <DesktopUpdateBadgeView wide={wide} snapshot={snapshot} onPrimary={handlePrimary} t={t} />
      {modalOpen && snapshot.phase === 'ready' && snapshot.version !== undefined ? (
        <DesktopUpdateModal
          version={snapshot.version}
          platform={platform}
          installFailed={snapshot.installFailed === true}
          busy={installing}
          onInstall={runInstall}
          onClose={() => { setModalOpen(false) }}
          t={t}
        />
      ) : null}
    </>
  )
}
