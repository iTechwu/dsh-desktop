import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { YootunAuditRecordInput } from '../src/yootun-audit-contract.ts'
import type { YootunAuditModelsClient } from '../src/yootun-audit-models-client.ts'
import { YootunAuditService, type YootunAuditScheduler } from '../src/yootun-audit-service.ts'
import { YootunAuditStore } from '../src/yootun-audit-store.ts'

const roots: string[] = []
const input: YootunAuditRecordInput = {
  source: {
    pluginId: '@dofe/dsh-yootun-sales',
    pluginVersion: '0.1.0',
    surface: 'human_ui',
  },
  actionCode: 'sales.lead.created',
  category: 'create',
  target: { type: 'lead', id: 'lead-1' },
  outcome: 'succeeded',
  changes: [{ field: 'stage', after: 'new' }],
}

class ManualScheduler implements YootunAuditScheduler {
  readonly tasks: Array<{ delay: number; task: () => void | Promise<void>; cancelled: boolean }> = []

  schedule(task: () => void | Promise<void>, delay: number): () => void {
    const entry = { delay, task, cancelled: false }
    this.tasks.push(entry)
    return () => { entry.cancelled = true }
  }

  next(delay?: number) {
    return this.tasks.find(task => !task.cancelled && (delay === undefined || task.delay === delay))
  }

  async run(delay?: number): Promise<void> {
    const entry = this.next(delay)
    if (entry === undefined) return
    entry.cancelled = true
    await entry.task()
  }
}

async function createService(
  remoteOverrides: Partial<YootunAuditModelsClient> = {},
  options: { enabled?: boolean; credential?: string | undefined; resolveApiKey?: () => Promise<string | undefined> } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'yootun-audit-service-'))
  roots.push(root)
  const store = new YootunAuditStore(root)
  const scheduler = new ManualScheduler()
  const remote = {
    batch: vi.fn().mockResolvedValue({ accepted: [] }),
    list: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
    summary: vi.fn().mockResolvedValue({ today: 0, succeeded: 0, abnormal: 0 }),
    scopes: vi.fn().mockResolvedValue({ available: ['self'], isSuperAdmin: false }),
    teams: vi.fn().mockResolvedValue({ teams: [], nextCursor: null }),
  }
  Object.assign(remote, remoteOverrides)
  const service = new YootunAuditService({
    store,
    remote: remote as unknown as YootunAuditModelsClient,
    resolveApiKey: options.resolveApiKey ?? vi.fn().mockResolvedValue(options.credential === undefined ? 'model-key' : options.credential),
    enabled: options.enabled ?? true,
    scheduler,
    now: () => new Date('2026-09-05T08:00:00.000Z'),
    random: () => 0.5,
  })
  return { service, store, scheduler, remote }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('YootunAuditService', () => {
  it('records without throwing and schedules an immediate flush', async () => {
    const { service, store, scheduler } = await createService()
    await expect(service.record(input)).resolves.toMatchObject({ status: 'stored' })
    expect(await store.pendingBatch(50)).toHaveLength(1)
    expect(scheduler.next(0)).toBeDefined()
  })

  it('shows current-credential pending events in the first self page', async () => {
    const { service } = await createService()
    const stored = await service.record(input)

    await expect(service.workspace({ scope: 'self', limit: 50 })).resolves.toMatchObject({
      summary: { pendingSync: 1 },
      events: [{
        id: `pending:${stored.clientEventId}`,
        clientEventId: stored.clientEventId,
        actorDisplayName: '本机待同步',
        syncStatus: 'pending',
      }],
    })
  })

  it('does not mix local pending events into another explicitly selected team', async () => {
    const { service, remote } = await createService()
    remote.scopes.mockResolvedValue({
      available: ['self', 'team'],
      currentTeam: { id: 'current-team', name: '当前团队' },
      isSuperAdmin: true,
    })
    await service.record(input)

    await expect(service.workspace({ scope: 'team', teamId: 'other-team', limit: 50 })).resolves.toMatchObject({
      events: [],
      summary: { pendingSync: 1 },
    })
  })

  it('never throws for an invalid collector payload', async () => {
    const { service, store } = await createService()

    await expect(service.record(undefined as never)).resolves.toMatchObject({ status: 'failed' })
    expect(await store.pendingBatch(50)).toEqual([])
  })

  it('keeps a business event pending through network and 5xx failures', async () => {
    const { service, store, remote } = await createService({
      batch: vi.fn().mockRejectedValue({ kind: 'retryable', status: 503 }),
    })
    await service.record(input)
    await service.flushNow()

    expect(remote.batch).toHaveBeenCalledOnce()
    expect(await store.pendingBatch(50)).toHaveLength(1)
    await expect(service.health()).resolves.toMatchObject({ pending: 1, state: 'offline' })
  })

  it('acknowledges only ids confirmed by Models and retries the remainder', async () => {
    const { service, store, remote, scheduler } = await createService()
    const first = await service.record(input)
    const second = await service.record({ ...input, target: { type: 'lead', id: 'lead-2' } })
    remote.batch.mockResolvedValueOnce({
      accepted: [{ clientEventId: first.clientEventId, id: first.clientEventId, receivedAt: '2026-09-05T08:00:01.000Z' }],
    })

    await service.flushNow()

    expect((await store.pendingBatch(50)).map(event => event.clientEventId)).toEqual([second.clientEventId])
    expect(scheduler.next(2_000)).toBeDefined()
  })

  it('keeps every outgoing batch within the Models 512 KiB request limit', async () => {
    const { service, remote } = await createService()
    const large = {
      ...input,
      changes: Array.from({ length: 20 }, () => ({ field: 'stage', before: '前'.repeat(160), after: '后'.repeat(160) })),
      effects: Array.from({ length: 10 }, (_, index) => ({ target: `remote-${index}-${'x'.repeat(60)}`, outcome: 'failed' as const, code: 'e'.repeat(80), remoteRef: 'r'.repeat(160) })),
    }
    await Promise.all(Array.from({ length: 50 }, (_, index) => service.record({
      ...large,
      target: { type: 'lead', id: `lead-${index}` },
    })))
    remote.batch.mockImplementationOnce(async events => ({
      accepted: events.map(item => ({ clientEventId: item.clientEventId, id: item.clientEventId, receivedAt: item.occurredAt })),
    }))

    await service.flushNow()

    const sent = remote.batch.mock.calls[0]?.[0]
    expect(new TextEncoder().encode(JSON.stringify({ events: sent })).byteLength).toBeLessThanOrEqual(512 * 1024)
    expect(sent.length).toBeLessThan(50)
  })

  it('quarantines a single permanently rejected event and continues the queue', async () => {
    const { service, remote, scheduler } = await createService({
      batch: vi.fn().mockRejectedValue({ kind: 'permanent', status: 400 }),
    })
    await service.record(input)

    await service.flushNow()

    await expect(service.health()).resolves.toMatchObject({ pending: 0, quarantine: 1 })
    expect(scheduler.next(0)).toBeDefined()
  })

  it('stops automatic retry on 401 but preserves pending data', async () => {
    const { service, store, remote, scheduler } = await createService({
      batch: vi.fn().mockRejectedValue({ kind: 'auth', status: 401 }),
    })
    await service.record(input)
    await service.flushNow()

    expect(remote.batch).toHaveBeenCalledOnce()
    expect(scheduler.next()).toBeUndefined()
    expect(await store.pendingBatch(50)).toHaveLength(1)
    await expect(service.health()).resolves.toMatchObject({ state: 'auth_required' })
  })

  it('probes every 30 seconds after an offline failure and flushes immediately on recovery', async () => {
    const { service, remote, scheduler } = await createService({
      batch: vi.fn()
        .mockRejectedValueOnce({ kind: 'retryable', status: 503 })
        .mockResolvedValue({ accepted: [] }),
      scopes: vi.fn().mockResolvedValue({ available: ['self'], isSuperAdmin: false }),
    })
    await service.record(input)
    await service.flushNow()
    expect(scheduler.next(30_000)).toBeDefined()

    await scheduler.run(30_000)

    expect(remote.scopes).toHaveBeenCalledOnce()
    expect(scheduler.next(0)).toBeDefined()
  })

  it('serves the last trusted cache when a live query fails', async () => {
    const { service, store, remote } = await createService()
    remote.summary.mockResolvedValueOnce({ today: 4, succeeded: 3, abnormal: 1 })
    await service.workspace({ scope: 'self', limit: 50 })
    remote.list.mockRejectedValueOnce({ kind: 'retryable' })

    await expect(service.workspace({ scope: 'self', limit: 50 })).resolves.toMatchObject({
      status: 'cached',
      summary: { today: 4, succeeded: 3, abnormal: 1, pendingSync: 0 },
      freshness: { source: 'cache', syncedAt: '2026-09-05T08:00:00.000Z' },
    })
    expect(await store.readCache()).toBeDefined()
  })

  it('never serves cached audit data after an authorization denial', async () => {
    const { service, remote } = await createService()
    remote.list.mockResolvedValueOnce({
      events: [{ id: 'server-1', clientEventId: 'client-1', receivedAt: '2026-09-05T07:00:00.000Z' }],
      nextCursor: null,
    })
    await service.workspace({ scope: 'team', teamId: 'team-1', limit: 50 })
    remote.list.mockRejectedValueOnce({ kind: 'auth', status: 403 })

    await expect(service.workspace({ scope: 'team', teamId: 'team-1', limit: 50 })).resolves.toMatchObject({
      status: 'forbidden',
      events: [],
      freshness: { source: 'live' },
    })
  })

  it('does not reuse a cache created under another credential', async () => {
    let credential = 'model-key-a'
    const { service, remote } = await createService({}, { resolveApiKey: async () => credential })
    await service.workspace({ scope: 'self', limit: 50 })
    credential = 'model-key-b'
    remote.list.mockRejectedValueOnce({ kind: 'retryable' })

    await expect(service.workspace({ scope: 'self', limit: 50 })).resolves.toMatchObject({
      status: 'offline',
      events: [],
      freshness: { source: 'live' },
    })
  })

  it('quarantines pending events instead of submitting them with a different credential', async () => {
    let credential = 'model-key-a'
    const { service, remote } = await createService({}, { resolveApiKey: async () => credential })
    await service.record(input)
    credential = 'model-key-b'

    await service.credentialUpdated()
    await service.flushNow()

    expect(remote.batch).not.toHaveBeenCalled()
    await expect(service.health()).resolves.toMatchObject({ pending: 0, quarantine: 1 })
  })

  it('merges successful pages into cache by clientEventId', async () => {
    const { service, store, remote } = await createService()
    const first = { id: 'server-1', clientEventId: 'client-1', receivedAt: '2026-09-05T07:00:00.000Z' }
    const second = { id: 'server-2', clientEventId: 'client-2', receivedAt: '2026-09-05T06:00:00.000Z' }
    remote.list
      .mockResolvedValueOnce({ events: [first], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ events: [second, first], nextCursor: null })

    await service.workspace({ scope: 'self', limit: 50 })
    await service.workspace({ scope: 'self', limit: 50, cursor: 'page-2' })

    expect((await store.readCache())?.events.map(event => event.clientEventId)).toEqual(['client-1', 'client-2'])
  })

  it('ignores a structurally incomplete cache when live reads fail', async () => {
    const { service, store, remote } = await createService()
    await store.writeCache({
      syncedAt: '2026-09-05T08:00:00.000Z',
      queryKey: JSON.stringify({ scope: 'self', limit: 50 }),
      events: [],
    })
    remote.list.mockRejectedValueOnce({ kind: 'retryable' })

    await expect(service.workspace({ scope: 'self', limit: 50 })).resolves.toMatchObject({
      status: 'offline',
      events: [],
    })
  })

  it('preserves the outbox but schedules nothing when sync is disabled', async () => {
    const { service, store, scheduler } = await createService({}, { enabled: false })
    await service.start()
    await service.record(input)

    expect(await store.pendingBatch(50)).toHaveLength(1)
    expect(scheduler.next()).toBeUndefined()
  })
})
