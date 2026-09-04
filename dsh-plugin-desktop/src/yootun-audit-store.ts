import { constants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  buildYootunAuditEvent,
  type YootunAuditClientEvent,
  type YootunAuditRecordInput,
} from './yootun-audit-contract.ts'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const MAX_EVENT_BYTES = 40 * 1024
const MAX_STATE_BYTES = 4 * 1024 * 1024
const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const EVENT_FILE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/iu
const ERROR_CODE_PATTERN = /^[a-z0-9_:-]{1,80}$/u

const mutationQueues = new Map<string, Promise<void>>()

export interface YootunAuditCachedEvent {
  readonly id: string
  readonly receivedAt: string
  readonly clientEventId?: unknown
}

export interface YootunAuditCache extends Record<string, unknown> {
  readonly syncedAt: string
  readonly events: readonly YootunAuditCachedEvent[]
  readonly credentialFingerprint?: string
}

export interface YootunAuditSyncState {
  readonly consecutiveFailures: number
  readonly lastAttemptAt?: string
  readonly retryAt?: string
  readonly errorCode?: string
}

export interface YootunAuditStoreCounts {
  readonly pending: number
  readonly quarantine: number
}

function fail(code: string): never {
  throw new Error(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalRoot(root: string): string {
  if (root.length === 0 || /[\0\r\n]/u.test(root) || !isAbsolute(root)) {
    fail('audit_store_root_invalid')
  }
  return resolve(root)
}

async function statIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  const before = await statIfPresent(path)
  if (before?.isSymbolicLink() === true || (before !== undefined && !before.isDirectory())) {
    fail('audit_store_path_unsafe')
  }
  if (before === undefined) await mkdir(path, { recursive: true, mode: DIRECTORY_MODE })
  const after = await lstat(path)
  if (after.isSymbolicLink() || !after.isDirectory()) fail('audit_store_path_unsafe')
  await chmod(path, DIRECTORY_MODE)
}

async function assertOrdinaryFile(path: string): Promise<boolean> {
  const stat = await statIfPresent(path)
  if (stat === undefined) return false
  if (stat.isSymbolicLink() || !stat.isFile()) fail('audit_store_path_unsafe')
  return true
}

async function readBoundedFile(path: string, maxBytes: number): Promise<string> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) {
    fail('audit_store_file_invalid')
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > maxBytes || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      fail('audit_store_file_invalid')
    }
    const content = await handle.readFile({ encoding: 'utf8' })
    await handle.chmod(FILE_MODE)
    return content
  } finally {
    await handle.close()
  }
}

function parsePendingEvent(value: unknown): YootunAuditClientEvent {
  if (!isRecord(value) || value.schemaVersion !== 1) fail('audit_store_event_invalid')
  const { schemaVersion: _schemaVersion, ...input } = value
  const event = buildYootunAuditEvent(input as unknown as YootunAuditRecordInput)
  if (JSON.stringify(event) !== JSON.stringify(value)) fail('audit_store_event_invalid')
  return event
}

interface PendingEnvelope {
  readonly credentialFingerprint: string | null
  readonly event: YootunAuditClientEvent
}

function parsePendingEnvelope(value: unknown): PendingEnvelope {
  if (isRecord(value) && value.storeVersion === 1 && 'event' in value) {
    const fingerprint = value.credentialFingerprint
    if (fingerprint !== null && (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(fingerprint))) {
      fail('audit_store_credential_binding_invalid')
    }
    return { credentialFingerprint: fingerprint as string | null, event: parsePendingEvent(value.event) }
  }
  return { credentialFingerprint: null, event: parsePendingEvent(value) }
}

function parseIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined
  return value
}

function parseCache(value: unknown): YootunAuditCache | undefined {
  if (!isRecord(value) || parseIso(value.syncedAt) === undefined || !Array.isArray(value.events)) return undefined
  const events = value.events.flatMap((event) => {
    if (!isRecord(event) || typeof event.id !== 'string' || parseIso(event.receivedAt) === undefined) return []
    return [{ ...event, id: event.id, receivedAt: event.receivedAt as string }]
  })
  if (events.length !== value.events.length) return undefined
  return { ...value, syncedAt: value.syncedAt as string, events }
}

function parseSyncState(value: unknown): YootunAuditSyncState | undefined {
  if (!isRecord(value)
    || !Number.isInteger(value.consecutiveFailures)
    || Number(value.consecutiveFailures) < 0
    || (value.lastAttemptAt !== undefined && parseIso(value.lastAttemptAt) === undefined)
    || (value.retryAt !== undefined && parseIso(value.retryAt) === undefined)
    || (value.errorCode !== undefined
      && (typeof value.errorCode !== 'string' || !ERROR_CODE_PATTERN.test(value.errorCode)))) {
    return undefined
  }
  return {
    consecutiveFailures: Number(value.consecutiveFailures),
    ...(value.lastAttemptAt === undefined ? {} : { lastAttemptAt: value.lastAttemptAt as string }),
    ...(value.retryAt === undefined ? {} : { retryAt: value.retryAt as string }),
    ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode as string }),
  }
}

export class YootunAuditStore {
  readonly root: string
  readonly pendingDirectory: string
  readonly quarantineDirectory: string
  readonly cachePath: string
  readonly syncStatePath: string

  constructor(root: string) {
    this.root = canonicalRoot(root)
    this.pendingDirectory = join(this.root, 'pending')
    this.quarantineDirectory = join(this.root, 'quarantine')
    this.cachePath = join(this.root, 'cache.json')
    this.syncStatePath = join(this.root, 'sync-state.json')
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = mutationQueues.get(this.root) ?? Promise.resolve()
    let release!: () => void
    const turn = new Promise<void>(resolveTurn => { release = resolveTurn })
    mutationQueues.set(this.root, previous.catch(() => undefined).then(() => turn))
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async prepare(): Promise<void> {
    await ensurePrivateDirectory(this.root)
    await ensurePrivateDirectory(this.pendingDirectory)
    await ensurePrivateDirectory(this.quarantineDirectory)
  }

  private eventPath(clientEventId: string): string {
    if (!EVENT_FILE_PATTERN.test(`${clientEventId}.json`)) fail('audit_event_id_invalid')
    return join(this.pendingDirectory, `${clientEventId}.json`)
  }

  async append(event: YootunAuditClientEvent, credentialFingerprint: string | null = null): Promise<void> {
    await this.exclusive(async () => {
      await this.prepare()
      const validated = parsePendingEvent(event)
      const envelope = parsePendingEnvelope({ storeVersion: 1, credentialFingerprint, event: validated })
      const path = this.eventPath(validated.clientEventId)
      if (await assertOrdinaryFile(path)) {
        let existing: PendingEnvelope | undefined
        try {
          existing = parsePendingEnvelope(JSON.parse(await readBoundedFile(path, MAX_EVENT_BYTES)) as unknown)
        } catch (cause) {
          if (cause instanceof Error && cause.message === 'audit_store_path_unsafe') throw cause
          await this.moveToQuarantine(`${validated.clientEventId}.json`, 'event_invalid')
        }
        if (existing !== undefined) {
          if (JSON.stringify(existing) !== JSON.stringify(envelope)) fail('audit_event_id_conflict')
          return
        }
      }
      await writeFileAtomic(path, `${JSON.stringify({ storeVersion: 1, ...envelope })}\n`, {
        mode: FILE_MODE,
        dirMode: DIRECTORY_MODE,
      })
    })
  }

  async pendingBatch(limit: number, credentialFingerprint?: string): Promise<YootunAuditClientEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('audit_batch_limit_invalid')
    if (credentialFingerprint !== undefined && !/^[0-9a-f]{64}$/u.test(credentialFingerprint)) {
      fail('audit_store_credential_binding_invalid')
    }
    return await this.exclusive(async () => {
      await this.prepare()
      const entries = (await readdir(this.pendingDirectory, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name))
      const events: YootunAuditClientEvent[] = []
      for (const entry of entries) {
        if (events.length >= limit) break
        if (entry.isSymbolicLink() || !entry.isFile()) fail('audit_store_path_unsafe')
        const path = join(this.pendingDirectory, entry.name)
        try {
          const match = EVENT_FILE_PATTERN.exec(entry.name)
          if (match?.[1] === undefined) fail('audit_store_event_invalid')
          const parsed = parsePendingEnvelope(JSON.parse(await readBoundedFile(path, MAX_EVENT_BYTES)) as unknown)
          if (parsed.event.clientEventId.toLowerCase() !== match[1].toLowerCase()) fail('audit_store_event_invalid')
          if (credentialFingerprint !== undefined && parsed.credentialFingerprint !== credentialFingerprint) {
            await this.moveToQuarantine(entry.name, 'credential_binding_changed')
            continue
          }
          events.push(parsed.event)
        } catch (cause) {
          if (cause instanceof Error && cause.message === 'audit_store_path_unsafe') throw cause
          await this.moveToQuarantine(entry.name, 'event_invalid')
        }
      }
      return events
    })
  }

  async acknowledge(clientEventIds: readonly string[]): Promise<void> {
    await this.exclusive(async () => {
      await this.prepare()
      for (const clientEventId of new Set(clientEventIds)) {
        const path = this.eventPath(clientEventId)
        if (!await assertOrdinaryFile(path)) continue
        await unlink(path)
      }
    })
  }

  private async moveToQuarantine(fileName: string, reasonCode: string): Promise<void> {
    if (basename(fileName) !== fileName || !ERROR_CODE_PATTERN.test(reasonCode)) {
      fail('audit_quarantine_request_invalid')
    }
    const source = join(this.pendingDirectory, fileName)
    if (!await assertOrdinaryFile(source)) return
    let destination = join(this.quarantineDirectory, fileName)
    if (await statIfPresent(destination) !== undefined) {
      destination = join(this.quarantineDirectory, `${fileName}.${Date.now()}.quarantine`)
    }
    await rename(source, destination)
    await chmod(destination, FILE_MODE)
  }

  async quarantine(fileName: string, reasonCode: string): Promise<void> {
    await this.exclusive(async () => {
      await this.prepare()
      await this.moveToQuarantine(fileName, reasonCode)
    })
  }

  async readCache(): Promise<YootunAuditCache | undefined> {
    return await this.exclusive(async () => {
      await this.prepare()
      if (!await assertOrdinaryFile(this.cachePath)) return undefined
      try {
        return parseCache(JSON.parse(await readBoundedFile(this.cachePath, MAX_STATE_BYTES)) as unknown)
      } catch {
        return undefined
      }
    })
  }

  async writeCache(cache: YootunAuditCache): Promise<void> {
    await this.exclusive(async () => {
      await this.prepare()
      const parsed = parseCache(cache)
      if (parsed === undefined) fail('audit_cache_invalid')
      const content = `${JSON.stringify(parsed)}\n`
      if (Buffer.byteLength(content, 'utf8') > MAX_STATE_BYTES) fail('audit_cache_too_large')
      if (await statIfPresent(this.cachePath) !== undefined) await assertOrdinaryFile(this.cachePath)
      await writeFileAtomic(this.cachePath, content, { mode: FILE_MODE, dirMode: DIRECTORY_MODE })
    })
  }

  async readSyncState(): Promise<YootunAuditSyncState> {
    return await this.exclusive(async () => {
      await this.prepare()
      if (!await assertOrdinaryFile(this.syncStatePath)) return { consecutiveFailures: 0 }
      try {
        return parseSyncState(JSON.parse(await readBoundedFile(this.syncStatePath, MAX_EVENT_BYTES)) as unknown)
          ?? { consecutiveFailures: 0, errorCode: 'sync_state_invalid' }
      } catch {
        return { consecutiveFailures: 0, errorCode: 'sync_state_invalid' }
      }
    })
  }

  async writeSyncState(state: YootunAuditSyncState): Promise<void> {
    await this.exclusive(async () => {
      await this.prepare()
      const parsed = parseSyncState(state)
      if (parsed === undefined) fail('audit_sync_state_invalid')
      if (await statIfPresent(this.syncStatePath) !== undefined) await assertOrdinaryFile(this.syncStatePath)
      await writeFileAtomic(this.syncStatePath, `${JSON.stringify(parsed)}\n`, {
        mode: FILE_MODE,
        dirMode: DIRECTORY_MODE,
      })
    })
  }

  async pruneCache(now: Date): Promise<void> {
    await this.exclusive(async () => {
      await this.prepare()
      if (!Number.isFinite(now.getTime()) || !await assertOrdinaryFile(this.cachePath)) return
      let cache: YootunAuditCache | undefined
      try {
        cache = parseCache(JSON.parse(await readBoundedFile(this.cachePath, MAX_STATE_BYTES)) as unknown)
      } catch {
        return
      }
      if (cache === undefined) return
      const cutoff = now.getTime() - CACHE_RETENTION_MS
      const events = cache.events.filter(event => Date.parse(event.receivedAt) >= cutoff)
      if (events.length === cache.events.length) return
      await writeFileAtomic(this.cachePath, `${JSON.stringify({ ...cache, events })}\n`, {
        mode: FILE_MODE,
        dirMode: DIRECTORY_MODE,
      })
    })
  }

  async counts(): Promise<YootunAuditStoreCounts> {
    return await this.exclusive(async () => {
      await this.prepare()
      const countFiles = async (directory: string): Promise<number> => {
        const entries = await readdir(directory, { withFileTypes: true })
        return entries.filter(entry => entry.isFile() && !entry.isSymbolicLink()).length
      }
      return {
        pending: await countFiles(this.pendingDirectory),
        quarantine: await countFiles(this.quarantineDirectory),
      }
    })
  }
}
