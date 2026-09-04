import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildYootunAuditEvent } from '../src/yootun-audit-contract.ts'
import { YootunAuditStore } from '../src/yootun-audit-store.ts'

const roots: string[] = []
const EVENT_A = '018f47a2-4f10-4abc-8def-1234567890ab'
const EVENT_B = '2e5fe668-b226-41fe-9e39-95cf162ec24a'

function event(clientEventId: string, targetId: string) {
  return buildYootunAuditEvent({
    clientEventId,
    source: {
      pluginId: '@dofe/dsh-yootun-sales',
      pluginVersion: '0.1.0',
      surface: 'human_ui',
    },
    actionCode: 'sales.lead.created',
    category: 'create',
    target: { type: 'lead', id: targetId },
    outcome: 'succeeded',
    changes: [{ field: 'stage', after: 'new' }],
  }, { now: () => new Date('2026-09-05T08:00:00.000Z') })
}

async function auditRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'yootun-audit-store-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('YootunAuditStore', () => {
  it('recovers concurrent pending events after a new store instance starts', async () => {
    const root = await auditRoot()
    const store = new YootunAuditStore(root)
    await Promise.all([store.append(event(EVENT_A, 'lead-a')), store.append(event(EVENT_B, 'lead-b'))])

    const recovered = await new YootunAuditStore(root).pendingBatch(50)
    expect(recovered.map(item => item.clientEventId).sort()).toEqual([EVENT_A, EVENT_B].sort())
    if (process.platform !== 'win32') {
      expect((await lstat(join(root, 'pending'))).mode & 0o777).toBe(0o700)
      expect((await lstat(join(root, 'pending', `${EVENT_A}.json`))).mode & 0o777).toBe(0o600)
    }
  })

  it('moves malformed files to quarantine without blocking valid files', async () => {
    const root = await auditRoot()
    const store = new YootunAuditStore(root)
    await store.append(event(EVENT_A, 'lead-a'))
    await writeFile(join(root, 'pending', 'broken.json'), '{broken')

    expect(await store.pendingBatch(50)).toEqual([expect.objectContaining({ clientEventId: EVENT_A })])
    expect(await readdir(join(root, 'quarantine'))).toContain('broken.json')
  })

  it('rebuilds a corrupt existing event on an idempotent append', async () => {
    const root = await auditRoot()
    const store = new YootunAuditStore(root)
    const original = event(EVENT_A, 'lead-a')
    await store.append(original)
    await writeFile(join(root, 'pending', `${EVENT_A}.json`), '{broken')

    await store.append(original)

    expect(await store.pendingBatch(50)).toEqual([original])
    expect(await readdir(join(root, 'quarantine'))).toContain(`${EVENT_A}.json`)
  })

  it('acknowledges only named event files and reports queue counts', async () => {
    const root = await auditRoot()
    const store = new YootunAuditStore(root)
    await store.append(event(EVENT_A, 'lead-a'))
    await store.append(event(EVENT_B, 'lead-b'))
    await store.acknowledge([EVENT_A])

    expect((await store.pendingBatch(50)).map(item => item.clientEventId)).toEqual([EVENT_B])
    await expect(store.acknowledge(['../sync-state'])).rejects.toThrow('audit_event_id_invalid')
    expect(await store.counts()).toEqual({ pending: 1, quarantine: 0 })
  })

  it('prunes only cached server events older than 30 days', async () => {
    const root = await auditRoot()
    const store = new YootunAuditStore(root)
    await store.append(event(EVENT_A, 'lead-a'))
    await store.writeCache({
      syncedAt: '2026-09-05T08:00:00.000Z',
      events: [
        { id: 'new', receivedAt: '2026-08-20T00:00:00.000Z' },
        { id: 'old', receivedAt: '2026-07-01T00:00:00.000Z' },
      ],
    })

    await store.pruneCache(new Date('2026-09-05T00:00:00.000Z'))

    expect(await store.readCache()).toEqual({
      syncedAt: '2026-09-05T08:00:00.000Z',
      events: [{ id: 'new', receivedAt: '2026-08-20T00:00:00.000Z' }],
    })
    expect(await store.pendingBatch(50)).toHaveLength(1)
  })

  it('persists bounded sync state across instances', async () => {
    const root = await auditRoot()
    const store = new YootunAuditStore(root)
    await store.writeSyncState({
      consecutiveFailures: 3,
      lastAttemptAt: '2026-09-05T08:00:00.000Z',
      retryAt: '2026-09-05T08:00:08.000Z',
      errorCode: 'remote_unreachable',
    })

    await expect(new YootunAuditStore(root).readSyncState()).resolves.toEqual({
      consecutiveFailures: 3,
      lastAttemptAt: '2026-09-05T08:00:00.000Z',
      retryAt: '2026-09-05T08:00:08.000Z',
      errorCode: 'remote_unreachable',
    })
    expect(JSON.parse(await readFile(join(root, 'sync-state.json'), 'utf8'))).not.toHaveProperty('apiKey')
  })

  it.skipIf(process.platform === 'win32')('rejects linked queue directories and event files', async () => {
    const root = await auditRoot()
    const outside = await auditRoot()
    await symlink(outside, join(root, 'pending'), 'dir')
    await expect(new YootunAuditStore(root).append(event(EVENT_A, 'lead-a')))
      .rejects.toThrow('audit_store_path_unsafe')

    await rm(join(root, 'pending'))
    await mkdir(join(root, 'pending'))
    await chmod(join(root, 'pending'), 0o700)
    const target = join(outside, 'event.json')
    await writeFile(target, '{}')
    await symlink(target, join(root, 'pending', `${EVENT_A}.json`))
    await expect(new YootunAuditStore(root).append(event(EVENT_A, 'lead-a')))
      .rejects.toThrow('audit_store_path_unsafe')
  })
})
