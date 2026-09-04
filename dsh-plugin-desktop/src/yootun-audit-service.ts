import { randomUUID } from 'node:crypto'
import type {} from '@deepseek-ai/cordis'
import {
  buildYootunAuditEvent,
  type AuditRecordResult,
  type YootunAuditBuildRuntime,
  type YootunAuditRecordInput,
  type YootunAuditRecorder,
} from './yootun-audit-contract.ts'
import type {
  AuditRemoteFailure,
  YootunAuditListQuery,
  YootunAuditModelsClient,
  YootunAuditServerEvent,
  YootunAuditScopes,
  YootunAuditTeamsQuery,
  YootunAuditTeamsResult,
} from './yootun-audit-models-client.ts'
import type {
  YootunAuditCache,
  YootunAuditStore,
  YootunAuditSyncState,
} from './yootun-audit-store.ts'

const MAX_BATCH = 50
const PROBE_DELAY_MS = 30_000
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000

export type DesktopAuditStatus =
  | 'ready'
  | 'offline'
  | 'cached'
  | 'auth_required'
  | 'forbidden'
  | 'local_error'

export interface DesktopAuditWorkspace {
  readonly status: DesktopAuditStatus
  readonly summary: { readonly today: number; readonly failed: number; readonly pendingSync: number }
  readonly events: readonly YootunAuditServerEvent[]
  readonly page: { readonly nextCursor: string | null }
  readonly scopes: YootunAuditScopes
  readonly sync: {
    readonly pending: number
    readonly quarantine: number
    readonly lastAttemptAt?: string
    readonly retryAt?: string
    readonly errorCode?: string
  }
  readonly freshness: { readonly source: 'live' | 'cache'; readonly syncedAt?: string }
}

export interface YootunAuditHealth {
  readonly state: Exclude<DesktopAuditStatus, 'cached' | 'forbidden'>
  readonly pending: number
  readonly quarantine: number
  readonly lastAttemptAt?: string
  readonly retryAt?: string
  readonly errorCode?: string
}

export interface YootunAuditReader {
  workspace(query: YootunAuditListQuery): Promise<DesktopAuditWorkspace>
  teams(query: YootunAuditTeamsQuery): Promise<YootunAuditTeamsResult>
  retrySync(): Promise<void>
  health(): Promise<YootunAuditHealth>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    yootunAudit: YootunAuditRecorder & YootunAuditReader
  }
}

export interface YootunAuditScheduler {
  schedule(task: () => void | Promise<void>, delayMs: number): () => void
}

interface AuditRemote {
  batch: YootunAuditModelsClient['batch']
  list: YootunAuditModelsClient['list']
  summary: YootunAuditModelsClient['summary']
  scopes: YootunAuditModelsClient['scopes']
  teams: YootunAuditModelsClient['teams']
}

export interface YootunAuditServiceOptions extends YootunAuditBuildRuntime {
  readonly store: YootunAuditStore
  readonly remote: AuditRemote
  readonly resolveApiKey: () => Promise<string | undefined>
  readonly enabled: boolean
  readonly scheduler?: YootunAuditScheduler
  readonly random?: () => number
  readonly logger?: { warn(message: string): void }
}

function defaultScheduler(): YootunAuditScheduler {
  return {
    schedule(task, delayMs) {
      const timer = setTimeout(() => { void task() }, delayMs)
      return () => { clearTimeout(timer) }
    },
  }
}

function isRemoteFailure(value: unknown): value is AuditRemoteFailure {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'auth' || kind === 'retryable' || kind === 'invalid_response'
}

function queryKey(query: YootunAuditListQuery): string {
  const { cursor: _cursor, ...stable } = query
  return JSON.stringify(stable)
}

function retryDelay(failures: number, random: () => number): number {
  const base = Math.min(MAX_RETRY_DELAY_MS, 2_000 * (2 ** Math.min(20, Math.max(0, failures - 1))))
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4
  return Math.round(base * jitter)
}

function emptyScopes(): YootunAuditScopes {
  return { available: ['self'], isSuperAdmin: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cachedWorkspaceParts(cache: YootunAuditCache): Pick<
  DesktopAuditWorkspace,
  'summary' | 'events' | 'page' | 'scopes'
> | undefined {
  const summary = cache.summary
  const page = cache.page
  const scopes = cache.scopes
  if (!isRecord(summary) || !Number.isInteger(summary.today) || Number(summary.today) < 0
    || !Number.isInteger(summary.failed) || Number(summary.failed) < 0
    || !isRecord(page) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')
    || !isRecord(scopes) || !Array.isArray(scopes.available)
    || scopes.available.some(scope => scope !== 'self' && scope !== 'team')
    || typeof scopes.isSuperAdmin !== 'boolean') return undefined
  return {
    summary: {
      today: Number(summary.today),
      failed: Number(summary.failed),
      pendingSync: Number.isInteger(summary.pendingSync) && Number(summary.pendingSync) >= 0
        ? Number(summary.pendingSync)
        : 0,
    },
    events: cache.events as readonly YootunAuditServerEvent[],
    page: { nextCursor: page.nextCursor as string | null },
    scopes: scopes as unknown as YootunAuditScopes,
  }
}

function mergeCachedEvents(
  existing: readonly { readonly clientEventId?: unknown }[],
  incoming: readonly YootunAuditServerEvent[],
): readonly YootunAuditServerEvent[] {
  const merged: YootunAuditServerEvent[] = []
  const seen = new Set<string>()
  for (const event of [...existing, ...incoming]) {
    if (typeof event.clientEventId !== 'string' || seen.has(event.clientEventId)) continue
    seen.add(event.clientEventId)
    merged.push(event as YootunAuditServerEvent)
  }
  return merged
}

export class YootunAuditService implements YootunAuditRecorder, YootunAuditReader {
  private readonly scheduler: YootunAuditScheduler
  private readonly random: () => number
  private readonly clock: YootunAuditBuildRuntime
  private cancelRetry: (() => void) | undefined
  private cancelProbe: (() => void) | undefined
  private flushing: Promise<void> | undefined
  private disposed = false
  private state: YootunAuditHealth['state'] = 'ready'

  constructor(private readonly options: YootunAuditServiceOptions) {
    this.scheduler = options.scheduler ?? defaultScheduler()
    this.random = options.random ?? Math.random
    this.clock = {
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.randomUUID === undefined ? {} : { randomUUID: options.randomUUID }),
    }
  }

  async start(): Promise<void> {
    if (this.disposed || !this.options.enabled) return
    await this.options.store.pruneCache(this.now()).catch(() => {
      this.noteLocalFailure('cache_prune_failed')
    })
    this.scheduleFlush(0)
  }

  dispose(): void {
    this.disposed = true
    this.cancelTimers()
  }

  async record(input: YootunAuditRecordInput): Promise<AuditRecordResult> {
    let clientEventId: string = randomUUID()
    try {
      const event = buildYootunAuditEvent(input, this.clock)
      clientEventId = event.clientEventId
      await this.options.store.append(event)
      if (this.options.enabled) this.scheduleFlush(0)
      return { status: 'stored', clientEventId }
    } catch {
      this.noteLocalFailure('event_store_failed')
      return { status: 'failed', clientEventId }
    }
  }

  async flushNow(): Promise<void> {
    if (!this.options.enabled || this.disposed) return
    if (this.flushing !== undefined) return await this.flushing
    this.cancelRetry?.()
    this.cancelRetry = undefined
    const operation = this.flush()
    this.flushing = operation
    try {
      await operation
    } finally {
      if (this.flushing === operation) this.flushing = undefined
    }
  }

  private async flush(): Promise<void> {
    let batch
    try {
      batch = await this.options.store.pendingBatch(MAX_BATCH)
      if (batch.length === 0) {
        this.state = 'ready'
        this.cancelProbe?.()
        this.cancelProbe = undefined
        await this.persistState({ consecutiveFailures: 0 })
        return
      }
      const apiKey = await this.options.resolveApiKey()
      if (apiKey === undefined) {
        await this.pauseForAuth('model_api_key_missing')
        return
      }
      const lastAttemptAt = this.now().toISOString()
      const result = await this.options.remote.batch(batch, apiKey)
      const requested = new Set(batch.map(event => event.clientEventId))
      const accepted = [...new Set(result.accepted
        .map(event => event.clientEventId)
        .filter(clientEventId => requested.has(clientEventId)))]
      await this.options.store.acknowledge(accepted)
      this.cancelProbe?.()
      this.cancelProbe = undefined
      if (accepted.length !== batch.length) {
        await this.retry({ kind: 'retryable' }, lastAttemptAt, 'partial_ack')
        return
      }
      this.state = 'ready'
      await this.persistState({ consecutiveFailures: 0, lastAttemptAt })
      if ((await this.options.store.counts()).pending > 0) this.scheduleFlush(0)
    } catch (cause) {
      if (isRemoteFailure(cause) && cause.kind === 'auth') {
        await this.pauseForAuth(cause.status === 403 ? 'model_api_key_forbidden' : 'model_api_key_rejected')
        return
      }
      if (isRemoteFailure(cause)) {
        await this.retry(cause, this.now().toISOString(), cause.kind === 'invalid_response'
          ? 'remote_response_invalid'
          : 'remote_unreachable')
        return
      }
      this.noteLocalFailure('local_store_unavailable')
      await this.persistState({
        consecutiveFailures: 0,
        lastAttemptAt: this.now().toISOString(),
        errorCode: 'local_store_unavailable',
      })
    }
  }

  private async pauseForAuth(errorCode: string): Promise<void> {
    this.cancelTimers()
    this.state = 'auth_required'
    const previous = await this.options.store.readSyncState().catch(() => ({ consecutiveFailures: 0 }))
    await this.persistState({
      consecutiveFailures: previous.consecutiveFailures,
      lastAttemptAt: this.now().toISOString(),
      errorCode,
    })
  }

  private async retry(failure: AuditRemoteFailure, lastAttemptAt: string, errorCode: string): Promise<void> {
    this.state = 'offline'
    const previous = await this.options.store.readSyncState().catch(() => ({ consecutiveFailures: 0 }))
    const consecutiveFailures = previous.consecutiveFailures + 1
    const delay = failure.kind === 'retryable' && failure.retryAfterMs !== undefined
      ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, failure.retryAfterMs))
      : retryDelay(consecutiveFailures, this.random)
    const retryAt = new Date(this.now().getTime() + delay).toISOString()
    await this.persistState({ consecutiveFailures, lastAttemptAt, retryAt, errorCode })
    this.scheduleFlush(delay)
    this.scheduleProbe()
  }

  private scheduleFlush(delayMs: number): void {
    if (!this.options.enabled || this.disposed) return
    this.cancelRetry?.()
    this.cancelRetry = this.scheduler.schedule(async () => {
      this.cancelRetry = undefined
      await this.flushNow()
    }, delayMs)
  }

  private scheduleProbe(): void {
    if (!this.options.enabled || this.disposed || this.cancelProbe !== undefined) return
    this.cancelProbe = this.scheduler.schedule(async () => {
      this.cancelProbe = undefined
      if (this.disposed || this.state !== 'offline') return
      try {
        const apiKey = await this.options.resolveApiKey()
        if (apiKey === undefined) {
          await this.pauseForAuth('model_api_key_missing')
          return
        }
        await this.options.remote.scopes(apiKey)
        await this.persistState({ consecutiveFailures: 0 })
        this.scheduleFlush(0)
      } catch (cause) {
        if (isRemoteFailure(cause) && cause.kind === 'auth') {
          await this.pauseForAuth('model_api_key_rejected')
          return
        }
        this.scheduleProbe()
      }
    }, PROBE_DELAY_MS)
  }

  async credentialUpdated(): Promise<void> {
    if (!this.options.enabled || this.disposed) return
    this.cancelTimers()
    this.state = 'ready'
    await this.persistState({ consecutiveFailures: 0 })
    this.scheduleFlush(0)
  }

  async retrySync(): Promise<void> {
    if (!this.options.enabled || this.disposed) return
    this.cancelTimers()
    this.state = 'ready'
    await this.persistState({ consecutiveFailures: 0 })
    this.scheduleFlush(0)
  }

  async health(): Promise<YootunAuditHealth> {
    try {
      const [counts, sync] = await Promise.all([
        this.options.store.counts(),
        this.options.store.readSyncState(),
      ])
      return {
        state: this.state,
        ...counts,
        ...(sync.lastAttemptAt === undefined ? {} : { lastAttemptAt: sync.lastAttemptAt }),
        ...(sync.retryAt === undefined ? {} : { retryAt: sync.retryAt }),
        ...(sync.errorCode === undefined ? {} : { errorCode: sync.errorCode }),
      }
    } catch {
      return { state: 'local_error', pending: 0, quarantine: 0, errorCode: 'local_store_unavailable' }
    }
  }

  async workspace(query: YootunAuditListQuery): Promise<DesktopAuditWorkspace> {
    const key = queryKey(query)
    try {
      const apiKey = await this.options.resolveApiKey()
      if (apiKey === undefined) return await this.cachedWorkspace(key, 'auth_required', 'model_api_key_missing')
      const [list, summary, scopes, health] = await Promise.all([
        this.options.remote.list(query, apiKey),
        this.options.remote.summary(query, apiKey),
        this.options.remote.scopes(apiKey),
        this.health(),
      ])
      const syncedAt = this.now().toISOString()
      const workspace: DesktopAuditWorkspace = {
        status: 'ready',
        summary: { ...summary, pendingSync: health.pending },
        events: list.events,
        page: { nextCursor: list.nextCursor },
        scopes,
        sync: this.syncView(health),
        freshness: { source: 'live', syncedAt },
      }
      const previous = query.cursor === undefined
        ? undefined
        : await this.options.store.readCache().catch(() => undefined)
      const previousParts = previous?.queryKey === key ? cachedWorkspaceParts(previous) : undefined
      const cachedEvents = previousParts === undefined
        ? workspace.events
        : mergeCachedEvents(previousParts.events, workspace.events)
      const cache: YootunAuditCache = { ...workspace, queryKey: key, syncedAt, events: cachedEvents }
      await this.options.store.writeCache(cache).catch(() => { this.noteLocalFailure('cache_write_failed') })
      return workspace
    } catch (cause) {
      if (isRemoteFailure(cause) && cause.kind === 'auth') {
        return await this.cachedWorkspace(key, cause.status === 403 ? 'forbidden' : 'auth_required', 'model_api_key_rejected')
      }
      return await this.cachedWorkspace(key, 'offline', isRemoteFailure(cause) && cause.kind === 'invalid_response'
        ? 'remote_response_invalid'
        : 'remote_unreachable')
    }
  }

  private async cachedWorkspace(
    key: string,
    failureStatus: 'offline' | 'auth_required' | 'forbidden',
    errorCode: string,
  ): Promise<DesktopAuditWorkspace> {
    const [cache, health] = await Promise.all([
      this.options.store.readCache().catch(() => undefined),
      this.health(),
    ])
    const cached = cache === undefined ? undefined : cachedWorkspaceParts(cache)
    if (cache !== undefined && cache.queryKey === key && cached !== undefined) {
      return {
        status: 'cached',
        summary: { ...cached.summary, pendingSync: health.pending },
        events: cached.events,
        page: cached.page,
        scopes: cached.scopes,
        sync: { ...this.syncView(health), errorCode },
        freshness: { source: 'cache', syncedAt: cache.syncedAt },
      }
    }
    return {
      status: failureStatus,
      summary: { today: 0, failed: 0, pendingSync: health.pending },
      events: [],
      page: { nextCursor: null },
      scopes: emptyScopes(),
      sync: { ...this.syncView(health), errorCode },
      freshness: { source: 'live' },
    }
  }

  async teams(query: YootunAuditTeamsQuery): Promise<YootunAuditTeamsResult> {
    const apiKey = await this.options.resolveApiKey()
    if (apiKey === undefined) throw { kind: 'auth', status: 401 } satisfies AuditRemoteFailure
    return await this.options.remote.teams(query, apiKey)
  }

  private syncView(health: YootunAuditHealth): DesktopAuditWorkspace['sync'] {
    return {
      pending: health.pending,
      quarantine: health.quarantine,
      ...(health.lastAttemptAt === undefined ? {} : { lastAttemptAt: health.lastAttemptAt }),
      ...(health.retryAt === undefined ? {} : { retryAt: health.retryAt }),
      ...(health.errorCode === undefined ? {} : { errorCode: health.errorCode }),
    }
  }

  private async persistState(state: YootunAuditSyncState): Promise<void> {
    await this.options.store.writeSyncState(state).catch(() => {
      this.noteLocalFailure('sync_state_write_failed')
    })
  }

  private noteLocalFailure(code: string): void {
    this.state = 'local_error'
    this.options.logger?.warn(`dsh-plugin-desktop: yootun audit ${code}`)
  }

  private cancelTimers(): void {
    this.cancelRetry?.()
    this.cancelRetry = undefined
    this.cancelProbe?.()
    this.cancelProbe = undefined
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))()
  }
}
