/**
 * `dshDesktop.updates` carrier implementation: exposes the Host update
 * lifecycle to the upstream settings shell through the same-origin API, so the
 * native-looking indicator renders beside Settings with live progress.
 */

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type TimeoutLike = (handler: () => void, timeoutMs: number) => unknown
type ClearLike = (handle: unknown) => void

/** Same semantic shape as the upstream settings-shell presentation type. */
export type DesktopUpdatePresentation = {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly percent?: number
  readonly failure?: 'download' | 'install'
}

/** Minimal Host snapshot shape consumed from the state endpoint. */
export type DesktopUpdateSnapshot = {
  readonly phase: 'idle' | 'available' | 'downloading' | 'ready' | 'restarting'
  readonly version?: string
  readonly received?: number
  readonly total?: number
  readonly downloadFailed?: boolean
  readonly installFailed?: boolean
}

/** Polling cadence while the indicator tracks a live download or handoff. */
export const DESKTOP_UPDATES_BRIDGE_ACTIVE_INTERVAL_MS = 500
/** Polling cadence while no update operation is in flight (including ready). */
export const DESKTOP_UPDATES_BRIDGE_IDLE_INTERVAL_MS = 3000

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse the Host snapshot; unknown shapes degrade to idle. */
export function parseDesktopUpdateSnapshot(value: unknown): DesktopUpdateSnapshot {
  if (!isObject(value)) return { phase: 'idle' }
  const phase = value.phase
  if (phase !== 'available' && phase !== 'downloading' && phase !== 'ready' && phase !== 'restarting') {
    return { phase: 'idle' }
  }
  const version = typeof value.version === 'string' && value.version.length > 0
    ? value.version
    : undefined
  const received = typeof value.received === 'number' && Number.isFinite(value.received) && value.received >= 0
    ? value.received
    : undefined
  const total = typeof value.total === 'number' && Number.isFinite(value.total) && value.total > 0
    ? value.total
    : undefined
  return {
    phase,
    ...(version === undefined ? {} : { version }),
    ...(received === undefined ? {} : { received }),
    ...(total === undefined ? {} : { total }),
    ...(value.downloadFailed === true ? { downloadFailed: true } : {}),
    ...(value.installFailed === true ? { installFailed: true } : {}),
  }
}

/** Project the Host snapshot onto the upstream indicator presentation. */
export function toPresentation(snapshot: DesktopUpdateSnapshot): DesktopUpdatePresentation {
  const version = snapshot.version
  if (snapshot.downloadFailed === true) {
    return { phase: 'error', failure: 'download', ...(version === undefined ? {} : { version }) }
  }
  if (snapshot.installFailed === true) {
    return { phase: 'error', failure: 'install', ...(version === undefined ? {} : { version }) }
  }
  switch (snapshot.phase) {
    case 'available':
      return { phase: 'available', ...(version === undefined ? {} : { version }) }
    case 'downloading': {
      const percent = snapshot.received !== undefined && snapshot.total !== undefined
        ? Math.min(100, Math.floor((snapshot.received / snapshot.total) * 100))
        : undefined
      return {
        phase: 'downloading',
        ...(version === undefined ? {} : { version }),
        ...(percent === undefined ? {} : { percent }),
      }
    }
    case 'ready':
      return { phase: 'ready', ...(version === undefined ? {} : { version }) }
    case 'restarting':
      return { phase: 'installing' }
    default:
      return { phase: 'idle' }
  }
}

function isActiveSnapshotPhase(phase: DesktopUpdateSnapshot['phase']): boolean {
  return phase === 'downloading' || phase === 'restarting'
}

/** Factory seam for tests; `preload.ts` binds the real fetch and timers. */
export function createDesktopUpdatesBridge(options: {
  readonly fetch: FetchLike
  readonly setTimeout: TimeoutLike
  readonly clearTimeout: ClearLike
}) {
  let current: DesktopUpdatePresentation = { phase: 'idle' }
  let lastSnapshot: DesktopUpdateSnapshot = { phase: 'idle' }
  let timer: unknown
  let polling = false
  const listeners = new Set<(state: DesktopUpdatePresentation) => void>()

  async function readSnapshot(): Promise<DesktopUpdateSnapshot> {
    const response = await options.fetch('/api/desktop/updates/state', {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`dsh-plugin-desktop: update state failed (${String(response.status)})`)
    return parseDesktopUpdateSnapshot(await response.json() as unknown)
  }

  async function postCommand(path: string): Promise<void> {
    const response = await options.fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })
    if (!response.ok) throw new Error(`dsh-plugin-desktop: update command failed (${String(response.status)})`)
  }

  async function tick(): Promise<void> {
    try {
      lastSnapshot = await readSnapshot()
      const next = toPresentation(lastSnapshot)
      const changed = JSON.stringify(next) !== JSON.stringify(current)
      current = next
      if (changed) for (const listener of listeners) listener(next)
    } catch {
      // Transient failures keep the last presented state and cadence.
    }
    if (!polling) return
    if (timer !== undefined) options.clearTimeout(timer)
    timer = options.setTimeout(() => { void tick() },
      isActiveSnapshotPhase(lastSnapshot.phase)
        ? DESKTOP_UPDATES_BRIDGE_ACTIVE_INTERVAL_MS
        : DESKTOP_UPDATES_BRIDGE_IDLE_INTERVAL_MS,
    )
  }

  return {
    status(): Promise<DesktopUpdatePresentation> {
      return (async () => {
        try {
          current = toPresentation(await readSnapshot())
          for (const listener of listeners) listener(current)
        } catch {
          // Serve the last known presentation when the endpoint is unreachable.
        }
        return current
      })()
    },
    subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void {
      listeners.add(listener)
      if (!polling) {
        polling = true
        void tick()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          polling = false
          options.clearTimeout(timer)
        }
      }
    },
    async open(): Promise<void> {
      // available (or a failed download retry) starts the silent download;
      // ready hands the recorded artifact to the platform installer. The
      // renderer-side dialog owns the confirm step on the ready transition.
      if (current.phase === 'available'
        || (current.phase === 'error' && current.failure === 'download')) {
        await postCommand('/api/desktop/updates/download')
        return
      }
      if (current.phase === 'ready') await postCommand('/api/desktop/updates/install')
    },
  }
}
