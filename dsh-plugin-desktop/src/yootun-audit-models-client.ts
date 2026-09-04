import {
  buildYootunAuditEvent,
  type YootunAuditClientEvent,
  type YootunAuditRecordInput,
} from './yootun-audit-contract.ts'

export const YOOTUN_AUDIT_MODELS_BASE_URL = 'https://ixicai.cn/api/v1/yootun/audit-events'
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_RETRY_AFTER_MS = 5 * 60 * 1_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type AuditRemoteFailure =
  | { readonly kind: 'auth'; readonly status: 401 | 403 }
  | { readonly kind: 'retryable'; readonly status?: number; readonly retryAfterMs?: number }
  | { readonly kind: 'invalid_response' }

export interface YootunAuditAcceptedEvent {
  readonly clientEventId: string
  readonly id: string
  readonly receivedAt: string
}

export interface YootunAuditBatchResult {
  readonly accepted: readonly YootunAuditAcceptedEvent[]
}

export interface YootunAuditServerEvent extends YootunAuditClientEvent {
  readonly id: string
  readonly receivedAt: string
  readonly tenantId: string
  readonly teamId: string
  readonly apiKeyId: string
  readonly principalType: 'member' | 'team' | 'service' | 'delegation'
  readonly principalId: string
  readonly memberId: string | null
  readonly keyOwnerType: 'human' | 'ai_employee' | 'runtime' | 'runtime_delegation'
  readonly actorDisplayName: string
  readonly clockSkewed: boolean
  readonly expiresAt: string
}

export interface YootunAuditListQuery {
  readonly scope: 'self' | 'team'
  readonly teamId?: string
  readonly start?: string
  readonly end?: string
  readonly pluginId?: string
  readonly actionCode?: string
  readonly memberId?: string
  readonly targetType?: string
  readonly outcome?: 'succeeded' | 'partial' | 'failed' | 'accepted'
  readonly query?: string
  readonly cursor?: string
  readonly limit: number
}

export interface YootunAuditListResult {
  readonly events: readonly YootunAuditServerEvent[]
  readonly nextCursor: string | null
}

export interface YootunAuditSummary {
  readonly today: number
  readonly failed: number
}

export interface YootunAuditTeam {
  readonly id: string
  readonly name: string
}

export interface YootunAuditScopes {
  readonly available: readonly ('self' | 'team')[]
  readonly currentTeam?: YootunAuditTeam
  readonly isSuperAdmin: boolean
}

export interface YootunAuditTeamsQuery {
  readonly query?: string
  readonly cursor?: string
  readonly limit: number
}

export interface YootunAuditTeamsResult {
  readonly teams: readonly YootunAuditTeam[]
  readonly nextCursor: string | null
}

export interface YootunAuditModelsClientHealth {
  readonly lastAttemptAt?: string
  readonly lastSuccessAt?: string
  readonly failureKind?: AuditRemoteFailure['kind']
}

export interface YootunAuditModelsClientOptions {
  readonly fetcher?: typeof globalThis.fetch
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly now?: () => Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
    ? value
    : undefined
}

function uuid(value: unknown): string | undefined {
  const parsed = text(value, 64)
  return parsed !== undefined && UUID_PATTERN.test(parsed) ? parsed : undefined
}

function iso(value: unknown): string | undefined {
  const parsed = text(value, 64)
  return parsed !== undefined && Number.isFinite(Date.parse(parsed)) ? parsed : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function invalidResponse(): never {
  throw { kind: 'invalid_response' } satisfies AuditRemoteFailure
}

function parseAccepted(value: unknown): YootunAuditAcceptedEvent {
  if (!isRecord(value) || !hasExactKeys(value, ['clientEventId', 'id', 'receivedAt'])) invalidResponse()
  const clientEventId = uuid(value.clientEventId)
  const id = uuid(value.id)
  const receivedAt = iso(value.receivedAt)
  if (clientEventId === undefined || id === undefined || receivedAt === undefined) invalidResponse()
  return { clientEventId, id, receivedAt }
}

function parseBatch(value: unknown): YootunAuditBatchResult {
  if (!isRecord(value) || !hasExactKeys(value, ['accepted']) || !Array.isArray(value.accepted)) invalidResponse()
  return { accepted: value.accepted.map(parseAccepted) }
}

function serverBaseInput(value: Record<string, unknown>): YootunAuditRecordInput {
  return {
    clientEventId: value.clientEventId as string,
    traceId: value.traceId as string,
    occurredAt: value.occurredAt as string,
    source: value.source as YootunAuditRecordInput['source'],
    actionCode: value.actionCode as YootunAuditRecordInput['actionCode'],
    category: value.category as YootunAuditRecordInput['category'],
    target: value.target as YootunAuditRecordInput['target'],
    outcome: value.outcome as YootunAuditRecordInput['outcome'],
    changes: value.changes as NonNullable<YootunAuditRecordInput['changes']>,
    effects: value.effects as NonNullable<YootunAuditRecordInput['effects']>,
    ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode as string }),
  }
}

function parseServerEvent(value: unknown): YootunAuditServerEvent {
  if (!isRecord(value)) invalidResponse()
  let base: YootunAuditClientEvent
  try {
    base = buildYootunAuditEvent(serverBaseInput(value))
  } catch {
    invalidResponse()
  }
  const id = uuid(value.id)
  const receivedAt = iso(value.receivedAt)
  const tenantId = uuid(value.tenantId)
  const teamId = uuid(value.teamId)
  const apiKeyId = uuid(value.apiKeyId)
  const principalId = text(value.principalId, 160)
  const memberId = value.memberId === null ? null : text(value.memberId, 160)
  const actorDisplayName = text(value.actorDisplayName, 160)
  const expiresAt = iso(value.expiresAt)
  const principalTypes = new Set(['member', 'team', 'service', 'delegation'])
  const ownerTypes = new Set(['human', 'ai_employee', 'runtime', 'runtime_delegation'])
  if (id === undefined || receivedAt === undefined || tenantId === undefined || teamId === undefined
    || apiKeyId === undefined || principalId === undefined || memberId === undefined
    || actorDisplayName === undefined || expiresAt === undefined
    || !principalTypes.has(String(value.principalType)) || !ownerTypes.has(String(value.keyOwnerType))
    || typeof value.clockSkewed !== 'boolean') {
    invalidResponse()
  }
  return {
    ...base,
    id,
    receivedAt,
    tenantId,
    teamId,
    apiKeyId,
    principalType: value.principalType as YootunAuditServerEvent['principalType'],
    principalId,
    memberId,
    keyOwnerType: value.keyOwnerType as YootunAuditServerEvent['keyOwnerType'],
    actorDisplayName,
    clockSkewed: value.clockSkewed,
    expiresAt,
  }
}

function parseList(value: unknown): YootunAuditListResult {
  if (!isRecord(value) || !Array.isArray(value.events)
    || (value.nextCursor !== null && typeof value.nextCursor !== 'string')) invalidResponse()
  return { events: value.events.map(parseServerEvent), nextCursor: value.nextCursor }
}

function parseSummary(value: unknown): YootunAuditSummary {
  if (!isRecord(value)) invalidResponse()
  const today = nonnegativeInteger(value.today)
  const failed = nonnegativeInteger(value.failed)
  if (today === undefined || failed === undefined) invalidResponse()
  return { today, failed }
}

function parseTeam(value: unknown): YootunAuditTeam {
  if (!isRecord(value)) invalidResponse()
  const id = uuid(value.id)
  const name = text(value.name, 160)
  if (id === undefined || name === undefined) invalidResponse()
  return { id, name }
}

function parseScopes(value: unknown): YootunAuditScopes {
  if (!isRecord(value) || !Array.isArray(value.available) || typeof value.isSuperAdmin !== 'boolean'
    || value.available.some(scope => scope !== 'self' && scope !== 'team')) invalidResponse()
  const currentTeam = value.currentTeam === undefined ? undefined : parseTeam(value.currentTeam)
  return {
    available: value.available as ('self' | 'team')[],
    ...(currentTeam === undefined ? {} : { currentTeam }),
    isSuperAdmin: value.isSuperAdmin,
  }
}

function parseTeams(value: unknown): YootunAuditTeamsResult {
  if (!isRecord(value) || !Array.isArray(value.teams)
    || (value.nextCursor !== null && typeof value.nextCursor !== 'string')) invalidResponse()
  return { teams: value.teams.map(parseTeam), nextCursor: value.nextCursor }
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) invalidResponse()
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_RESPONSE_BYTES) invalidResponse()
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as unknown
  } catch {
    invalidResponse()
  }
}

function unwrap(value: unknown): unknown {
  if (!isRecord(value) || value.code !== 200 || typeof value.msg !== 'string' || !Object.hasOwn(value, 'data')) {
    invalidResponse()
  }
  return value.data
}

function retryAfter(response: Response, now: Date): number | undefined {
  const raw = response.headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw)
  const delay = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1_000
    : Date.parse(raw) - now.getTime()
  if (!Number.isFinite(delay) || delay < 0) return undefined
  return Math.min(delay, MAX_RETRY_AFTER_MS)
}

export class YootunAuditModelsClient {
  private readonly fetcher: typeof globalThis.fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly now: () => Date
  private state: YootunAuditModelsClientHealth = {}

  constructor(options: YootunAuditModelsClientOptions = {}) {
    this.fetcher = options.fetcher ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? YOOTUN_AUDIT_MODELS_BASE_URL
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.now = options.now ?? (() => new Date())
    const url = new URL(this.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new TypeError('audit_models_base_url_invalid')
    }
  }

  health(): YootunAuditModelsClientHealth {
    return { ...this.state }
  }

  private async request(path: string, apiKey: string, init: Omit<RequestInit, 'headers' | 'signal'> = {}): Promise<unknown> {
    if (apiKey.length === 0 || apiKey.length > 4_096 || /[\0\r\n]/u.test(apiKey)) {
      throw { kind: 'auth', status: 401 } satisfies AuditRemoteFailure
    }
    const attemptedAt = this.now()
    this.state = { ...this.state, lastAttemptAt: attemptedAt.toISOString() }
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          Authorization: `Bearer ${apiKey}`,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      const failure = { kind: 'retryable' } as const satisfies AuditRemoteFailure
      this.state = { ...this.state, failureKind: failure.kind }
      throw failure
    }

    if (!response.ok) {
      await readLimitedJson(response).catch(() => undefined)
      let failure: AuditRemoteFailure
      if (response.status === 401 || response.status === 403) {
        failure = { kind: 'auth', status: response.status }
      } else if (response.status === 408 || response.status === 429 || response.status >= 500) {
        const delay = response.status === 429 ? retryAfter(response, attemptedAt) : undefined
        failure = {
          kind: 'retryable',
          status: response.status,
          ...(delay === undefined ? {} : { retryAfterMs: delay }),
        }
      } else {
        failure = { kind: 'invalid_response' }
      }
      this.state = { ...this.state, failureKind: failure.kind }
      throw failure
    }

    try {
      const data = unwrap(await readLimitedJson(response))
      this.state = {
        lastAttemptAt: attemptedAt.toISOString(),
        lastSuccessAt: this.now().toISOString(),
      }
      return data
    } catch {
      const failure = { kind: 'invalid_response' } as const satisfies AuditRemoteFailure
      this.state = { ...this.state, failureKind: failure.kind }
      throw failure
    }
  }

  private query(path: string, values: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) search.set(key, String(value))
    }
    const encoded = search.toString()
    return encoded.length === 0 ? path : `${path}?${encoded}`
  }

  async batch(events: readonly YootunAuditClientEvent[], apiKey: string): Promise<YootunAuditBatchResult> {
    if (events.length < 1 || events.length > 50) invalidResponse()
    return parseBatch(await this.request('/batch', apiKey, {
      method: 'POST',
      body: JSON.stringify({ events }),
    }))
  }

  async list(query: YootunAuditListQuery, apiKey: string): Promise<YootunAuditListResult> {
    return parseList(await this.request(this.query('', { ...query }), apiKey))
  }

  async summary(query: YootunAuditListQuery, apiKey: string): Promise<YootunAuditSummary> {
    return parseSummary(await this.request(this.query('/summary', { ...query }), apiKey))
  }

  async scopes(apiKey: string): Promise<YootunAuditScopes> {
    return parseScopes(await this.request('/scopes', apiKey))
  }

  async teams(query: YootunAuditTeamsQuery, apiKey: string): Promise<YootunAuditTeamsResult> {
    return parseTeams(await this.request(this.query('/teams', { ...query }), apiKey))
  }
}
