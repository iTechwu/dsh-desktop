/** Same-origin browser client for the sidebar update badge. */

import {
  DESKTOP_UPDATE_DOWNLOAD_PATH,
  DESKTOP_UPDATE_INSTALL_PATH,
  DESKTOP_UPDATE_STATE_PATH,
} from '../desktop-settings-contract.ts'

const DESKTOP_REQUEST_TIMEOUT_MS = 30_000

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Renderer-side projection of the Host update lifecycle snapshot. */
export type DesktopUpdateSnapshot = {
  readonly phase: 'idle' | 'available' | 'downloading' | 'ready' | 'restarting'
  readonly version?: string
  readonly received?: number
  readonly total?: number
  readonly downloadFailed?: boolean
  readonly installFailed?: boolean
}

/** Same-origin operations consumed by the update badge component. */
export interface DesktopUpdateApi {
  readUpdateState(signal?: AbortSignal | undefined): Promise<DesktopUpdateSnapshot>
  startUpdateDownload(): Promise<void>
  installUpdateNow(): Promise<void>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Strictly parse the Host snapshot; unknown shapes degrade to idle instead of
 * surfacing a broken badge.
 */
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

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`dsh-plugin-desktop: Desktop update request failed (${String(response.status)})`)
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('dsh-plugin-desktop: Desktop update response was not JSON')
  }
}

/** Construct the default same-origin update API with an injectable fetch seam. */
export function createDesktopUpdateApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopUpdateApi {
  const post = (path: string): Promise<Response> => fetcher(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    // The install action hands control to the platform installer before exiting.
    ...(path === DESKTOP_UPDATE_INSTALL_PATH ? {} : { signal: AbortSignal.timeout(DESKTOP_REQUEST_TIMEOUT_MS) }),
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  return Object.freeze({
    async readUpdateState(signal?: AbortSignal | undefined) {
      const timeout = AbortSignal.timeout(DESKTOP_REQUEST_TIMEOUT_MS)
      const response = await fetcher(DESKTOP_UPDATE_STATE_PATH, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      return parseDesktopUpdateSnapshot(await readJson(response))
    },
    async startUpdateDownload() {
      const response = await post(DESKTOP_UPDATE_DOWNLOAD_PATH)
      await readJson(response)
    },
    async installUpdateNow() {
      await post(DESKTOP_UPDATE_INSTALL_PATH)
    },
  })
}
