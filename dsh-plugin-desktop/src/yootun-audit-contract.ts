import { randomUUID } from 'node:crypto'

export const YOOTUN_AUDIT_ACTIONS = Object.freeze({
  'recruiter.requirement.created': ['create', 'requirement'],
  'recruiter.requirement.updated': ['update', 'requirement'],
  'recruiter.candidate_analysis.saved': ['update', 'candidate'],
  'recruiter.boss_sync.executed': ['execute', 'candidate_collection'],
  'recruiter.action.created': ['create', 'recruiter_action'],
  'recruiter.action.confirmed': ['update', 'recruiter_action'],
  'recruiter.action.dismissed': ['update', 'recruiter_action'],
  'recruiter.action.executed': ['execute', 'recruiter_action'],
  'sales.lead.created': ['create', 'lead'],
  'sales.lead.updated': ['update', 'lead'],
  'sales.follow_up.created': ['create', 'follow_up'],
  'sales.follow_up.confirmed': ['update', 'follow_up'],
  'sales.follow_up.dismissed': ['update', 'follow_up'],
  'sales.follow_up.executed': ['execute', 'follow_up'],
  'supply.risk.created': ['create', 'supply_risk'],
  'supply.risk.updated': ['update', 'supply_risk'],
  'supply.review.created': ['create', 'supply_review'],
  'supply.review.confirmed': ['update', 'supply_review'],
  'supply.review.dismissed': ['update', 'supply_review'],
  'supply.review.executed': ['execute', 'supply_review'],
  'content.review.updated': ['update', 'article'],
  'content.platforms.updated': ['update', 'article'],
  'content.publish.executed': ['publish', 'article'],
  'knowledge.memory.remembered': ['create', 'memory'],
  'knowledge.memory.confirmed': ['update', 'memory'],
  'knowledge.memory.forgotten': ['delete', 'memory'],
  'knowledge.file.imported': ['create', 'knowledge_document'],
  'lead_discovery.discovery.executed': ['execute', 'lead_discovery'],
  'retrofit.public_sources.refreshed': ['execute', 'retrofit_search'],
  'xhs.rewrite.created': ['create', 'xhs_rewrite_task'],
  'xhs.rewrite.completed': ['execute', 'xhs_rewrite_task'],
  'media.upload.completed': ['create', 'media_asset'],
} as const satisfies Record<string, readonly [AuditCategory, string]>)

export type YootunAuditActionCode = keyof typeof YOOTUN_AUDIT_ACTIONS

export const YOOTUN_AUDIT_CHANGE_FIELDS = Object.freeze({
  'recruiter.requirement.created': ['status'],
  'recruiter.requirement.updated': ['status'],
  'recruiter.candidate_analysis.saved': ['feedbackStatus'],
  'recruiter.boss_sync.executed': ['insertedCount', 'updatedCount'],
  'recruiter.action.created': ['type', 'status'],
  'recruiter.action.confirmed': ['status'],
  'recruiter.action.dismissed': ['status'],
  'recruiter.action.executed': ['status'],
  'sales.lead.created': ['stage'],
  'sales.lead.updated': ['stage'],
  'sales.follow_up.created': ['channel', 'status'],
  'sales.follow_up.confirmed': ['status'],
  'sales.follow_up.dismissed': ['status'],
  'sales.follow_up.executed': ['status'],
  'supply.risk.created': ['severity', 'status', 'dueDate'],
  'supply.risk.updated': ['severity', 'status', 'dueDate'],
  'supply.review.created': ['status'],
  'supply.review.confirmed': ['status'],
  'supply.review.dismissed': ['status'],
  'supply.review.executed': ['status'],
  'content.review.updated': ['reviewStatus'],
  'content.platforms.updated': ['platformCount'],
  'content.publish.executed': ['platformCount'],
  'knowledge.memory.remembered': ['status'],
  'knowledge.memory.confirmed': ['status'],
  'knowledge.memory.forgotten': ['status'],
  'knowledge.file.imported': ['status'],
  'lead_discovery.discovery.executed': ['insertedCount', 'updatedCount'],
  'retrofit.public_sources.refreshed': ['resultCount', 'source'],
  'xhs.rewrite.created': ['status', 'versionCount'],
  'xhs.rewrite.completed': ['status', 'versionCount'],
  'media.upload.completed': ['sizeBucket', 'mimeFamily'],
} as const satisfies Record<YootunAuditActionCode, readonly string[]>)

export type AuditSurface = 'human_ui' | 'agent_tool' | 'system'
export type AuditCategory = 'create' | 'update' | 'delete' | 'publish' | 'execute'
export type AuditOutcome = 'succeeded' | 'partial' | 'failed' | 'accepted'
export type AuditChangeValue = string | number | boolean | null

export interface YootunAuditChange {
  readonly field: string
  readonly before?: AuditChangeValue
  readonly after?: AuditChangeValue
}

export interface YootunAuditEffect {
  readonly target: string
  readonly outcome: 'succeeded' | 'failed' | 'requires_user_login' | 'accepted'
  readonly code?: string
  readonly remoteRef?: string
}

export interface YootunAuditRecordInput {
  readonly clientEventId?: string
  readonly traceId?: string
  readonly occurredAt?: string
  readonly source: {
    readonly pluginId: string
    readonly pluginVersion: string
    readonly surface: AuditSurface
  }
  readonly actionCode: YootunAuditActionCode
  readonly category: AuditCategory
  readonly target: { readonly type: string; readonly id: string; readonly label?: string }
  readonly outcome: AuditOutcome
  readonly changes?: readonly YootunAuditChange[]
  readonly effects?: readonly YootunAuditEffect[]
  readonly errorCode?: string
}

export interface YootunAuditClientEvent {
  readonly schemaVersion: 1
  readonly clientEventId: string
  readonly traceId: string
  readonly occurredAt: string
  readonly source: YootunAuditRecordInput['source']
  readonly actionCode: YootunAuditActionCode
  readonly category: AuditCategory
  readonly target: YootunAuditRecordInput['target']
  readonly outcome: AuditOutcome
  readonly changes: readonly YootunAuditChange[]
  readonly effects: readonly YootunAuditEffect[]
  readonly errorCode?: string
}

export interface AuditRecordResult {
  readonly status: 'stored' | 'failed'
  readonly clientEventId: string
}

export interface YootunAuditRecorder {
  record(input: YootunAuditRecordInput): Promise<AuditRecordResult>
}

export function safeYootunAuditTargetId(value: unknown): string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 160
    && value.trim() === value
    && !/[\0\r\n]/u.test(value)
    ? value
    : 'unresolved'
}

export interface YootunAuditBuildRuntime {
  readonly now?: () => Date
  readonly randomUUID?: () => string
}

const INPUT_KEYS = new Set([
  'clientEventId', 'traceId', 'occurredAt', 'source', 'actionCode', 'category',
  'target', 'outcome', 'changes', 'effects', 'errorCode',
])
const SOURCE_KEYS = new Set(['pluginId', 'pluginVersion', 'surface'])
const TARGET_KEYS = new Set(['type', 'id', 'label'])
const CHANGE_KEYS = new Set(['field', 'before', 'after'])
const EFFECT_KEYS = new Set(['target', 'outcome', 'code', 'remoteRef'])
const SURFACES = new Set<AuditSurface>(['human_ui', 'agent_tool', 'system'])
const OUTCOMES = new Set<AuditOutcome>(['succeeded', 'partial', 'failed', 'accepted'])
const EFFECT_OUTCOMES = new Set<YootunAuditEffect['outcome']>([
  'succeeded', 'failed', 'requires_user_login', 'accepted',
])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ERROR_CODE_PATTERN = /^[a-z0-9_:-]{1,80}$/u
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
const FORBIDDEN_KEY_PARTS = [
  'password', 'passwd', 'cookie', 'prompt', 'phone', 'email', 'resume',
  'messagebody', 'messagecontent', 'rawparams', 'rawrequest', 'rawresponse',
  'authorization', 'credential', 'secret', 'accesstoken', 'refreshtoken',
  'absolutepath', 'filepath', 'stacktrace', 'stack',
]

function fail(code: string): never {
  throw new Error(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(value).some(key => !allowed.has(key))) fail('audit_value_invalid')
}

function assertNoForbiddenFields(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
    if (FORBIDDEN_KEY_PARTS.some(part => normalized.includes(part))) {
      fail('audit_field_forbidden')
    }
    assertNoForbiddenFields(nested, seen)
  }
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.trim() !== value) {
    fail('audit_value_invalid')
  }
  return value
}

function optionalText(value: unknown, max: number): string | undefined {
  return value === undefined ? undefined : text(value, max)
}

function changeValue(value: unknown): AuditChangeValue {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  return text(value, 160)
}

function uuid(value: unknown): string {
  const parsed = text(value, 64)
  if (!UUID_PATTERN.test(parsed)) fail('audit_value_invalid')
  return parsed
}

function occurredAt(value: unknown): string {
  const parsed = text(value, 64)
  if (!ISO_DATETIME_PATTERN.test(parsed) || !Number.isFinite(Date.parse(parsed))) fail('audit_value_invalid')
  return parsed
}

function cloneChange(value: unknown, allowed: ReadonlySet<string>): YootunAuditChange {
  if (!isRecord(value)) fail('audit_value_invalid')
  assertAllowedKeys(value, CHANGE_KEYS)
  const field = text(value.field, 80)
  if (!allowed.has(field)) fail('audit_field_forbidden')
  if (!Object.hasOwn(value, 'before') && !Object.hasOwn(value, 'after')) fail('audit_value_invalid')
  return {
    field,
    ...(Object.hasOwn(value, 'before') ? { before: changeValue(value.before) } : {}),
    ...(Object.hasOwn(value, 'after') ? { after: changeValue(value.after) } : {}),
  }
}

function cloneEffect(value: unknown): YootunAuditEffect {
  if (!isRecord(value)) fail('audit_value_invalid')
  assertAllowedKeys(value, EFFECT_KEYS)
  const outcome = value.outcome
  if (!EFFECT_OUTCOMES.has(outcome as YootunAuditEffect['outcome'])) fail('audit_value_invalid')
  return {
    target: text(value.target, 80),
    outcome: outcome as YootunAuditEffect['outcome'],
    ...(value.code === undefined ? {} : { code: text(value.code, 80) }),
    ...(value.remoteRef === undefined ? {} : { remoteRef: text(value.remoteRef, 160) }),
  }
}

export function buildYootunAuditEvent(
  input: YootunAuditRecordInput,
  runtime: YootunAuditBuildRuntime = {},
): YootunAuditClientEvent {
  assertNoForbiddenFields(input)
  if (!isRecord(input)) fail('audit_value_invalid')
  assertAllowedKeys(input, INPUT_KEYS)

  const action = YOOTUN_AUDIT_ACTIONS[input.actionCode]
  if (action === undefined) fail('audit_action_unregistered')
  if (input.category !== action[0] || input.target?.type !== action[1]) {
    fail('audit_action_mismatch')
  }
  if (!isRecord(input.source) || !isRecord(input.target)) fail('audit_value_invalid')
  assertAllowedKeys(input.source, SOURCE_KEYS)
  assertAllowedKeys(input.target, TARGET_KEYS)
  if (!SURFACES.has(input.source.surface)) fail('audit_value_invalid')
  if (!OUTCOMES.has(input.outcome)) fail('audit_value_invalid')

  const changes = input.changes ?? []
  const effects = input.effects ?? []
  if (!Array.isArray(changes) || changes.length > 20) fail('audit_changes_too_many')
  if (!Array.isArray(effects) || effects.length > 10) fail('audit_effects_too_many')

  const clientEventId = uuid(input.clientEventId ?? (runtime.randomUUID ?? randomUUID)())
  const traceId = text(input.traceId ?? clientEventId, 128)
  const targetLabel = optionalText(input.target.label, 160)
  if (targetLabel !== undefined) fail('audit_target_label_forbidden')
  const event: YootunAuditClientEvent = {
    schemaVersion: 1,
    clientEventId,
    traceId,
    occurredAt: occurredAt(input.occurredAt ?? (runtime.now ?? (() => new Date()))().toISOString()),
    source: {
      pluginId: text(input.source.pluginId, 160),
      pluginVersion: text(input.source.pluginVersion, 40),
      surface: input.source.surface,
    },
    actionCode: input.actionCode,
    category: input.category,
    target: {
      type: text(input.target.type, 80),
      id: text(input.target.id, 160),
    },
    outcome: input.outcome,
    changes: changes.map(change => cloneChange(
      change,
      new Set<string>(YOOTUN_AUDIT_CHANGE_FIELDS[input.actionCode]),
    )),
    effects: effects.map(cloneEffect),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
  }
  if (event.errorCode !== undefined && !ERROR_CODE_PATTERN.test(event.errorCode)) {
    fail('audit_value_invalid')
  }
  if (new TextEncoder().encode(JSON.stringify(event)).byteLength > 32 * 1024) {
    fail('audit_event_too_large')
  }
  return event
}
