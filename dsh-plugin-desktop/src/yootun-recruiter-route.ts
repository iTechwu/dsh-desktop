/** Private, local-only recruitment workspace for Yootun-Agent. */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { safeYootunAuditTargetId, type YootunAuditRecordInput, type YootunAuditRecorder } from './yootun-audit-contract.ts'

export const YOOTUN_RECRUITER_PATH = '/api/desktop/yootun/recruiter'

const STATE_VERSION = 2
const MODELS_API_KEY_REF = credentialRef('MODELS_API_KEY')
const MAX_BODY_BYTES = 64 * 1024
const MAX_STATE_BYTES = 1024 * 1024
const MAX_REQUIREMENTS = 50
const MAX_CANDIDATES = 500
const MAX_ACTIONS = 500
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const CHECK_POSIX_MODE = process.platform !== 'win32'

const REQUIREMENT_STATUSES = ['draft', 'active', 'paused', 'closed'] as const
const CANDIDATE_STAGES = ['sourced', 'screening', 'interview', 'offer', 'hired', 'archived'] as const
const FEEDBACK_STATUSES = ['none', 'draft', 'confirmed'] as const
const ACTION_TYPES = ['publish_jd', 'send_message', 'write_feedback', 'publish_knowledge'] as const
const ACTION_STATUSES = [
  'awaiting_confirmation', 'confirmed_pending_adapter', 'dismissed',
  'succeeded', 'failed', 'requires_user_login',
] as const
// Keep candidate evidence focused on job-relevant signals; reject common protected attributes.
const PROTECTED_SCREENING_SIGNAL = /性别|男性|女性|男生|女生|年龄|出生|婚育|结婚|民族|籍贯|国籍|宗教|残疾|健康状况|户籍|政治面貌|性取向|同性恋|异性恋|身高|体重|颜值|外貌|照片|家庭状况|家庭成员|血型/iu
const CONTACT_SIGNAL = /(?:1[3-9]\d{9}|微信|(?:^|\s)vx(?:$|\s)|邮箱|email)/iu

type RequirementStatus = typeof REQUIREMENT_STATUSES[number]
type CandidateStage = typeof CANDIDATE_STAGES[number]
type FeedbackStatus = typeof FEEDBACK_STATUSES[number]
type RecruiterActionType = typeof ACTION_TYPES[number]
type RecruiterActionStatus = typeof ACTION_STATUSES[number]
type JsonRecord = Record<string, unknown>

export type RecruiterAdapterStatus = 'succeeded' | 'failed' | 'requires_user_login'

export interface RecruiterAdapterRequest {
  actionId: string
  type: RecruiterActionType
  idempotencyKey: string
  targetLabel: string
  summary: string
}

export interface RecruiterAdapterResult {
  status: RecruiterAdapterStatus
  reasonCode: string
  completedAt?: string
  remoteRef?: string
}

export interface RecruiterAdapter {
  execute: (request: RecruiterAdapterRequest) => Promise<RecruiterAdapterResult>
}

export interface RecruiterBossSyncResult {
  status: 'ready' | 'partial' | 'failed' | 'requires_user_login'
  reasonCode: string
  imported: number
  updated: number
  skipped: number
  cursor?: string
  completedAt?: string
  responseRate?: number
  requirements?: RecruiterRequirement[]
  candidates?: RecruiterCandidateAnalysis[]
}

export interface RecruiterBossAdapter extends RecruiterAdapter {
  sync: (request: { cursor?: string; idempotencyKey: string }) => Promise<RecruiterBossSyncResult>
}

export interface RecruiterKnowledgePublisher {
  publish: (request: {
    spaceId?: string
    content: string
    idempotencyKey: string
  }) => Promise<{ status: 'succeeded' | 'failed'; reasonCode: string; memoryId?: string; completedAt?: string }>
}

export interface RecruiterAdapterReceipt {
  status: RecruiterAdapterStatus
  reasonCode: string
  completedAt: string
  remoteRef?: string
}

export interface RecruiterRequirement {
  id: string
  title: string
  department: string
  location: string
  employmentType: string
  headcount: number
  salaryMin?: number
  salaryMax?: number
  responsibilities: string[]
  requiredSkills: string[]
  preferredSkills: string[]
  status: RequirementStatus
  updatedAt: string
}

export interface RecruiterCandidateAnalysis {
  id: string
  displayName: string
  requirementId: string
  stage: CandidateStage
  matchScore?: number
  evidence: string[]
  concerns: string[]
  interviewQuestions: string[]
  feedbackStatus: FeedbackStatus
  updatedAt: string
}

export interface RecruiterAction {
  id: string
  type: RecruiterActionType
  targetLabel: string
  summary: string
  status: RecruiterActionStatus
  idempotencyKey: string
  createdAt: string
  updatedAt: string
  adapterReceipt?: RecruiterAdapterReceipt
}

export interface RecruiterSyncState {
  provider: 'boss_zhipin'
  status: 'not_connected' | 'requires_user_login' | 'ready' | 'partial' | 'error'
  imported: number
  updated: number
  skipped: number
  lastAttemptAt?: string
  lastSuccessAt?: string
  cursor?: string
  responseRate?: number
  reason?: string
  conflictsPreserved?: number
}

export interface RecruiterKnowledgeState {
  status: 'unavailable' | 'ready' | 'error'
  spaceId?: string
  spaces: number
  documents: number
  memories: number
  pending: number
  lastPublishedAt?: string
  recent: Array<{ id: string; title: string; updatedAt: string }>
  reason?: string
}

export interface RecruiterAnalyticsState {
  status: 'empty' | 'ready'
  responseRate?: number
  avgScreeningDays?: number
  offerConversion?: number
  insight: string
  updatedAt: string
}

export interface RecruiterState {
  version: 2
  requirements: RecruiterRequirement[]
  candidates: RecruiterCandidateAnalysis[]
  actions: RecruiterAction[]
  sync: RecruiterSyncState
  knowledge: RecruiterKnowledgeState
  analytics: RecruiterAnalyticsState
  updatedAt: string
}

export interface RecruiterSyncPreview {
  status: 'ready' | 'unavailable'
  adapter: 'not_configured' | 'official'
  increment: 'cursor' | 'full'
  scope: { requirements: number; candidates: number; hasCursor: boolean }
  fields: string[]
  reason?: string
}

export interface RecruiterSnapshot extends RecruiterState {
  dashboard: {
    openRoles: number
    activeCandidates: number
    pendingReplies: number
    pendingFeedback: number
    pendingConfirmation: number
    responseRate?: number
    funnel: Array<{ stage: CandidateStage; count: number }>
  }
  boss: {
    loginUrl: string
    status: 'requires_user_login' | 'connected' | 'error'
    adapter: 'not_configured' | 'official'
    inAppBrowser: boolean
  }
}

class InvalidRecruiterRequest extends Error {}
class RecruiterBodyTooLarge extends Error {}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function exactKeys(value: JsonRecord, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every(key => allowed.has(key))
}

function limitedText(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string') throw new InvalidRecruiterRequest(`${label}_invalid`)
  const text = value.trim()
  if (text.length === 0 || text.length > max || /[\0\r]/u.test(text)) {
    throw new InvalidRecruiterRequest(`${label}_invalid`)
  }
  return text
}

function textList(value: unknown, label: string, maxItems = 30): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new InvalidRecruiterRequest(`${label}_invalid`)
  return value.map((item, index) => limitedText(item, `${label}_${String(index)}`, 320))
}

function screeningTextList(value: unknown, label: string): string[] {
  const list = textList(value, label)
  if (list.some(item => PROTECTED_SCREENING_SIGNAL.test(item) || CONTACT_SIGNAL.test(item))) {
    throw new InvalidRecruiterRequest(`${label}_contains_protected_data`)
  }
  return list
}

function enumValue<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) {
    throw new InvalidRecruiterRequest(`${label}_invalid`)
  }
  return value as T
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new InvalidRecruiterRequest(`${label}_invalid`)
  }
  return Number(value)
}

function money(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000) {
    throw new InvalidRecruiterRequest(`${label}_invalid`)
  }
  return Math.round(value * 100) / 100
}

function canonicalTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value ? value : undefined
}

function emptyState(now: string): RecruiterState {
  return {
    version: STATE_VERSION,
    requirements: [],
    candidates: [],
    actions: [],
    sync: {
      provider: 'boss_zhipin', status: 'not_connected', imported: 0, updated: 0, skipped: 0,
      reason: 'official_authorization_required',
    },
    knowledge: {
      status: 'unavailable', spaces: 0, documents: 0, memories: 0, pending: 0, recent: [],
      reason: 'hr_space_not_configured',
    },
    analytics: { status: 'empty', insight: '样本不足时不输出确定性结论。', updatedAt: now },
    updatedAt: now,
  }
}

function nonNegative(value: unknown, label: string): number {
  return integer(value, label, 0, Number.MAX_SAFE_INTEGER)
}

function parsePersistedSync(value: unknown): RecruiterSyncState | undefined {
  const item = record(value)
  if (item === undefined || !exactKeys(item, ['provider', 'status', 'imported', 'updated', 'skipped'], [
    'lastAttemptAt', 'lastSuccessAt', 'cursor', 'responseRate', 'reason', 'conflictsPreserved',
  ])) return undefined
  try {
    if (item.provider !== 'boss_zhipin') return undefined
    const lastAttemptAt = item.lastAttemptAt === undefined ? undefined : canonicalTime(item.lastAttemptAt)
    const lastSuccessAt = item.lastSuccessAt === undefined ? undefined : canonicalTime(item.lastSuccessAt)
    if ((item.lastAttemptAt !== undefined && lastAttemptAt === undefined)
      || (item.lastSuccessAt !== undefined && lastSuccessAt === undefined)) return undefined
    return {
      provider: 'boss_zhipin',
      status: enumValue(item.status, ['not_connected', 'requires_user_login', 'ready', 'partial', 'error'] as const, 'sync_status'),
      imported: nonNegative(item.imported, 'sync_imported'), updated: nonNegative(item.updated, 'sync_updated'),
      skipped: nonNegative(item.skipped, 'sync_skipped'),
      ...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
      ...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
      ...(item.cursor === undefined ? {} : { cursor: limitedText(item.cursor, 'sync_cursor', 240) }),
      ...(item.responseRate === undefined ? {} : { responseRate: integer(item.responseRate, 'response_rate', 0, 100) }),
      ...(item.reason === undefined ? {} : { reason: limitedText(item.reason, 'sync_reason', 160) }),
      ...(item.conflictsPreserved === undefined ? {} : { conflictsPreserved: nonNegative(item.conflictsPreserved, 'sync_conflicts_preserved') }),
    }
  } catch { return undefined }
}

function parsePersistedKnowledge(value: unknown): RecruiterKnowledgeState | undefined {
  const item = record(value)
  if (item === undefined || !exactKeys(item, [
    'status', 'spaces', 'documents', 'memories', 'pending', 'recent',
  ], ['spaceId', 'lastPublishedAt', 'reason']) || !Array.isArray(item.recent) || item.recent.length > 20) return undefined
  try {
    const lastPublishedAt = item.lastPublishedAt === undefined ? undefined : canonicalTime(item.lastPublishedAt)
    if (item.lastPublishedAt !== undefined && lastPublishedAt === undefined) return undefined
    const recent = item.recent.map((raw) => {
      const entry = record(raw)
      if (entry === undefined || !exactKeys(entry, ['id', 'title', 'updatedAt'])) throw new InvalidRecruiterRequest('knowledge_recent_invalid')
      const updatedAt = canonicalTime(entry.updatedAt)
      if (updatedAt === undefined) throw new InvalidRecruiterRequest('knowledge_recent_invalid')
      return { id: limitedText(entry.id, 'knowledge_id', 160), title: limitedText(entry.title, 'knowledge_title', 280), updatedAt }
    })
    return {
      status: enumValue(item.status, ['unavailable', 'ready', 'error'] as const, 'knowledge_status'),
      ...(item.spaceId === undefined ? {} : { spaceId: limitedText(item.spaceId, 'knowledge_space_id', 80) }),
      spaces: nonNegative(item.spaces, 'knowledge_spaces'), documents: nonNegative(item.documents, 'knowledge_documents'),
      memories: nonNegative(item.memories, 'knowledge_memories'), pending: nonNegative(item.pending, 'knowledge_pending'),
      ...(lastPublishedAt === undefined ? {} : { lastPublishedAt }), recent,
      ...(item.reason === undefined ? {} : { reason: limitedText(item.reason, 'knowledge_reason', 160) }),
    }
  } catch { return undefined }
}

function parsePersistedAnalytics(value: unknown): RecruiterAnalyticsState | undefined {
  const item = record(value)
  if (item === undefined || !exactKeys(item, ['status', 'insight', 'updatedAt'], [
    'responseRate', 'avgScreeningDays', 'offerConversion',
  ])) return undefined
  try {
    const updatedAt = canonicalTime(item.updatedAt)
    if (updatedAt === undefined) return undefined
    return {
      status: enumValue(item.status, ['empty', 'ready'] as const, 'analytics_status'),
      ...(item.responseRate === undefined ? {} : { responseRate: integer(item.responseRate, 'response_rate', 0, 100) }),
      ...(item.avgScreeningDays === undefined ? {} : { avgScreeningDays: nonNegative(item.avgScreeningDays, 'avg_screening_days') }),
      ...(item.offerConversion === undefined ? {} : { offerConversion: integer(item.offerConversion, 'offer_conversion', 0, 100) }),
      insight: limitedText(item.insight, 'analytics_insight', 500), updatedAt,
    }
  } catch { return undefined }
}

function parsePersistedRequirement(value: unknown): RecruiterRequirement | undefined {
  const item = record(value)
  if (item === undefined || !exactKeys(item, [
    'id', 'title', 'department', 'location', 'employmentType', 'headcount', 'responsibilities',
    'requiredSkills', 'preferredSkills', 'status', 'updatedAt',
  ], ['salaryMin', 'salaryMax'])) return undefined
  try {
    const updatedAt = canonicalTime(item.updatedAt)
    if (updatedAt === undefined) return undefined
    const salaryMin = money(item.salaryMin, 'salary_min')
    const salaryMax = money(item.salaryMax, 'salary_max')
    if (salaryMin !== undefined && salaryMax !== undefined && salaryMin > salaryMax) return undefined
    return {
      id: limitedText(item.id, 'id', 80), title: limitedText(item.title, 'title'),
      department: limitedText(item.department, 'department'), location: limitedText(item.location, 'location'),
      employmentType: limitedText(item.employmentType, 'employment_type', 80),
      headcount: integer(item.headcount, 'headcount', 1, 1000),
      ...(salaryMin === undefined ? {} : { salaryMin }), ...(salaryMax === undefined ? {} : { salaryMax }),
      responsibilities: textList(item.responsibilities, 'responsibilities'),
      requiredSkills: textList(item.requiredSkills, 'required_skills'),
      preferredSkills: textList(item.preferredSkills, 'preferred_skills'),
      status: enumValue(item.status, REQUIREMENT_STATUSES, 'status'), updatedAt,
    }
  } catch { return undefined }
}

function parsePersistedCandidate(value: unknown): RecruiterCandidateAnalysis | undefined {
  const item = record(value)
  if (item === undefined || !exactKeys(item, [
    'id', 'displayName', 'requirementId', 'stage', 'evidence', 'concerns', 'interviewQuestions',
    'feedbackStatus', 'updatedAt',
  ], ['matchScore'])) return undefined
  try {
    const updatedAt = canonicalTime(item.updatedAt)
    if (updatedAt === undefined) return undefined
    return {
      id: limitedText(item.id, 'id', 80), displayName: limitedText(item.displayName, 'display_name'),
      requirementId: limitedText(item.requirementId, 'requirement_id', 80),
      stage: enumValue(item.stage, CANDIDATE_STAGES, 'stage'),
      ...(item.matchScore === undefined ? {} : { matchScore: integer(item.matchScore, 'match_score', 0, 100) }),
      evidence: screeningTextList(item.evidence, 'evidence'), concerns: screeningTextList(item.concerns, 'concerns'),
      interviewQuestions: screeningTextList(item.interviewQuestions, 'interview_questions'),
      feedbackStatus: enumValue(item.feedbackStatus, FEEDBACK_STATUSES, 'feedback_status'), updatedAt,
    }
  } catch { return undefined }
}

function parsePersistedAction(value: unknown): RecruiterAction | undefined {
  const item = record(value)
  if (item === undefined || !exactKeys(item, [
    'id', 'type', 'targetLabel', 'summary', 'status', 'idempotencyKey', 'createdAt', 'updatedAt',
  ], ['adapterReceipt'])) return undefined
  try {
    const createdAt = canonicalTime(item.createdAt)
    const updatedAt = canonicalTime(item.updatedAt)
    if (createdAt === undefined || updatedAt === undefined) return undefined
    const actionStatus = enumValue(item.status, ACTION_STATUSES, 'status')
    const rawReceipt = item.adapterReceipt
    let adapterReceipt: RecruiterAdapterReceipt | undefined
    if (rawReceipt !== undefined) {
      const receipt = record(rawReceipt)
      if (receipt === undefined) return undefined
      const completedAt = canonicalTime(receipt.completedAt)
      const status = typeof receipt.status === 'string' && ['succeeded', 'failed', 'requires_user_login'].includes(receipt.status)
        ? receipt.status as RecruiterAdapterStatus
        : undefined
      const reasonCode = typeof receipt.reasonCode === 'string' && /^[a-z0-9_:-]{1,80}$/u.test(receipt.reasonCode)
        ? receipt.reasonCode
        : undefined
      const remoteRef = receipt.remoteRef === undefined
        ? undefined
        : typeof receipt.remoteRef === 'string' && receipt.remoteRef.length <= 160 && !/[\0\r\n]/u.test(receipt.remoteRef)
          ? receipt.remoteRef
          : undefined
      if (completedAt === undefined || status === undefined || reasonCode === undefined
        || (receipt.remoteRef !== undefined && remoteRef === undefined)) return undefined
      adapterReceipt = { status, reasonCode, completedAt, ...(remoteRef === undefined ? {} : { remoteRef }) }
    }
    const terminal = actionStatus === 'succeeded' || actionStatus === 'failed' || actionStatus === 'requires_user_login'
    if (terminal !== (adapterReceipt !== undefined) || (adapterReceipt !== undefined && adapterReceipt.status !== actionStatus)) {
      return undefined
    }
    return {
      id: limitedText(item.id, 'id', 80), type: enumValue(item.type, ACTION_TYPES, 'type'),
      targetLabel: limitedText(item.targetLabel, 'target_label'), summary: limitedText(item.summary, 'summary', 500),
      status: actionStatus,
      idempotencyKey: limitedText(item.idempotencyKey, 'idempotency_key', 80), createdAt, updatedAt,
      ...(adapterReceipt === undefined ? {} : { adapterReceipt }),
    }
  } catch { return undefined }
}

function parsePersistedState(value: unknown): RecruiterState | undefined {
  const root = record(value)
  if (root === undefined || (root.version !== 1 && root.version !== STATE_VERSION)
    || !exactKeys(root, ['version', 'requirements', 'candidates', 'actions', 'updatedAt'],
      root.version === STATE_VERSION ? ['sync', 'knowledge', 'analytics'] : [])
    || !Array.isArray(root.requirements)
    || !Array.isArray(root.candidates) || !Array.isArray(root.actions)
    || root.requirements.length > MAX_REQUIREMENTS || root.candidates.length > MAX_CANDIDATES
    || root.actions.length > MAX_ACTIONS) return undefined
  const updatedAt = canonicalTime(root.updatedAt)
  const requirements = root.requirements.map(parsePersistedRequirement)
  const candidates = root.candidates.map(parsePersistedCandidate)
  const actions = root.actions.map(parsePersistedAction)
  if (updatedAt === undefined || requirements.some(item => item === undefined)
    || candidates.some(item => item === undefined) || actions.some(item => item === undefined)) return undefined
  const defaults = emptyState(updatedAt)
  const sync = root.version === STATE_VERSION && root.sync !== undefined ? parsePersistedSync(root.sync) : defaults.sync
  const knowledge = root.version === STATE_VERSION && root.knowledge !== undefined
    ? parsePersistedKnowledge(root.knowledge) : defaults.knowledge
  const analytics = root.version === STATE_VERSION && root.analytics !== undefined
    ? parsePersistedAnalytics(root.analytics) : defaults.analytics
  if (sync === undefined || knowledge === undefined || analytics === undefined) return undefined
  return {
    version: STATE_VERSION,
    requirements: requirements as RecruiterRequirement[],
    candidates: candidates as RecruiterCandidateAnalysis[],
    actions: actions as RecruiterAction[],
    sync,
    knowledge,
    analytics,
    updatedAt,
  }
}

export async function readRecruiterState(path: string, now = new Date().toISOString()): Promise<RecruiterState> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES) return emptyState(now)
    return parsePersistedState(JSON.parse(await readFile(path, 'utf8'))) ?? emptyState(now)
  } catch { return emptyState(now) }
}

async function writeRecruiterState(path: string, state: RecruiterState): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('recruiter_state_directory_invalid')
  if (CHECK_POSIX_MODE) await chmod(directory, DIRECTORY_MODE)
  const json = `${JSON.stringify(state, undefined, 2)}\n`
  if (Buffer.byteLength(json) > MAX_STATE_BYTES) throw new InvalidRecruiterRequest('state_too_large')
  await writeFileAtomic(path, json, { mode: FILE_MODE, dirMode: DIRECTORY_MODE })
  if (CHECK_POSIX_MODE) await chmod(path, FILE_MODE)
}

function aggregateAnalytics(state: RecruiterState): RecruiterAnalyticsState {
  const active = state.candidates.filter(item => item.stage !== 'archived')
  if (active.length === 0) {
    return { status: 'empty', insight: '样本不足时不输出确定性结论。', updatedAt: state.updatedAt }
  }
  const offers = active.filter(item => item.stage === 'offer' || item.stage === 'hired').length
  const hires = active.filter(item => item.stage === 'hired').length
  const offerConversion = offers === 0 ? undefined : Math.round(hires / offers * 100)
  const responseRate = state.sync.responseRate
  return {
    status: 'ready',
    ...(responseRate === undefined ? {} : { responseRate }),
    ...(offerConversion === undefined ? {} : { offerConversion }),
    insight: offerConversion === undefined
      ? '已有候选人样本，Offer 转化样本仍不足。'
      : `当前 Offer 到入职转化率为 ${String(offerConversion)}%，仅用于招聘过程复盘。`,
    updatedAt: state.updatedAt,
  }
}

export function recruiterSnapshot(
  state: RecruiterState,
  capabilities: { bossAdapter?: boolean; knowledgeReady?: boolean; bossWeb?: boolean } = {},
): RecruiterSnapshot {
  const funnel = CANDIDATE_STAGES.map(stage => ({
    stage,
    count: state.candidates.filter(candidate => candidate.stage === stage).length,
  }))
  const analytics = aggregateAnalytics(state)
  const sync = capabilities.bossAdapter === true && state.sync.status === 'not_connected'
    ? { ...state.sync, status: 'requires_user_login' as const, reason: 'official_login_required' }
    : state.sync
  const knowledge = capabilities.knowledgeReady === true && state.knowledge.status === 'unavailable'
    ? (() => {
        const { reason: _reason, ...rest } = state.knowledge
        return { ...rest, status: 'ready' as const, spaces: Math.max(1, rest.spaces) }
      })()
    : state.knowledge
  const pendingKnowledge = state.actions.filter(item => item.type === 'publish_knowledge'
    && ['awaiting_confirmation', 'confirmed_pending_adapter'].includes(item.status)).length
  return {
    ...state,
    sync,
    knowledge: { ...knowledge, pending: pendingKnowledge },
    analytics,
    dashboard: {
      openRoles: state.requirements.filter(item => item.status === 'active').length,
      activeCandidates: state.candidates.filter(item => item.stage !== 'hired' && item.stage !== 'archived').length,
      pendingReplies: state.actions.filter(item => item.type === 'send_message' && item.status === 'awaiting_confirmation').length,
      pendingFeedback: state.candidates.filter(item => item.feedbackStatus === 'draft').length,
      pendingConfirmation: state.actions.filter(item => item.status === 'awaiting_confirmation').length,
      ...(analytics.responseRate === undefined ? {} : { responseRate: analytics.responseRate }),
      funnel,
    },
    boss: {
      loginUrl: 'https://www.zhipin.com/web/user/?ka=header-login',
      status: sync.status === 'ready' || sync.status === 'partial'
        ? 'connected' : sync.status === 'error' ? 'error' : 'requires_user_login',
      adapter: capabilities.bossAdapter === true ? 'official' : 'not_configured',
      inAppBrowser: capabilities.bossWeb === true,
    },
  }
}

const SYNC_PREVIEW_FIELDS = Object.freeze([
  'remoteRoleId', 'roleTitle', 'roleLocation', 'roleStatus', 'roleUpdatedAt',
  'candidateRef', 'displayName', 'requirementId', 'stage', 'updatedAt',
  'matchScore', 'evidence', 'concerns', 'interviewQuestions', 'actionState', 'idempotencyKey',
])

/** Read-only first-sync preview (plan §7.2): scope, increment mode, and allowed fields. */
function syncPreview(state: RecruiterState, adapterConfigured: boolean): RecruiterSyncPreview {
  return {
    status: adapterConfigured ? 'ready' : 'unavailable',
    adapter: adapterConfigured ? 'official' : 'not_configured',
    increment: state.sync.cursor === undefined ? 'full' : 'cursor',
    scope: {
      requirements: state.requirements.length,
      candidates: state.candidates.length,
      hasCursor: state.sync.cursor !== undefined,
    },
    fields: [...SYNC_PREVIEW_FIELDS],
    ...(adapterConfigured ? {} : { reason: 'boss_official_adapter_unavailable' }),
  }
}

function saveRequirement(state: RecruiterState, body: JsonRecord, now: string): RecruiterState {
  if (!exactKeys(body, [
    'action', 'title', 'department', 'location', 'employmentType', 'headcount', 'responsibilities',
    'requiredSkills', 'preferredSkills', 'status',
  ], ['id', 'salaryMin', 'salaryMax'])) throw new InvalidRecruiterRequest('request_fields_invalid')
  const id = body.id === undefined ? randomUUID() : limitedText(body.id, 'id', 80)
  const salaryMin = money(body.salaryMin, 'salary_min')
  const salaryMax = money(body.salaryMax, 'salary_max')
  if (salaryMin !== undefined && salaryMax !== undefined && salaryMin > salaryMax) {
    throw new InvalidRecruiterRequest('salary_range_invalid')
  }
  const item: RecruiterRequirement = {
    id, title: limitedText(body.title, 'title'), department: limitedText(body.department, 'department'),
    location: limitedText(body.location, 'location'), employmentType: limitedText(body.employmentType, 'employment_type', 80),
    headcount: integer(body.headcount, 'headcount', 1, 1000),
    ...(salaryMin === undefined ? {} : { salaryMin }), ...(salaryMax === undefined ? {} : { salaryMax }),
    responsibilities: textList(body.responsibilities, 'responsibilities'),
    requiredSkills: textList(body.requiredSkills, 'required_skills'),
    preferredSkills: textList(body.preferredSkills, 'preferred_skills'),
    status: enumValue(body.status, REQUIREMENT_STATUSES, 'status'), updatedAt: now,
  }
  const exists = state.requirements.some(entry => entry.id === id)
  if (!exists && state.requirements.length >= MAX_REQUIREMENTS) throw new InvalidRecruiterRequest('requirement_limit_reached')
  return { ...state, requirements: [item, ...state.requirements.filter(entry => entry.id !== id)], updatedAt: now }
}

function saveCandidate(state: RecruiterState, body: JsonRecord, now: string): RecruiterState {
  if (!exactKeys(body, [
    'action', 'displayName', 'requirementId', 'stage', 'evidence', 'concerns', 'interviewQuestions', 'feedbackStatus',
  ], ['id', 'matchScore'])) throw new InvalidRecruiterRequest('request_fields_invalid')
  const id = body.id === undefined ? randomUUID() : limitedText(body.id, 'id', 80)
  const requirementId = limitedText(body.requirementId, 'requirement_id', 80)
  if (!state.requirements.some(entry => entry.id === requirementId)) {
    throw new InvalidRecruiterRequest('requirement_not_found')
  }
  const item: RecruiterCandidateAnalysis = {
    id, displayName: limitedText(body.displayName, 'display_name'), requirementId,
    stage: enumValue(body.stage, CANDIDATE_STAGES, 'stage'),
    ...(body.matchScore === undefined ? {} : { matchScore: integer(body.matchScore, 'match_score', 0, 100) }),
    evidence: screeningTextList(body.evidence, 'evidence'), concerns: screeningTextList(body.concerns, 'concerns'),
    interviewQuestions: screeningTextList(body.interviewQuestions, 'interview_questions'),
    feedbackStatus: enumValue(body.feedbackStatus, FEEDBACK_STATUSES, 'feedback_status'), updatedAt: now,
  }
  const exists = state.candidates.some(entry => entry.id === id)
  if (!exists && state.candidates.length >= MAX_CANDIDATES) throw new InvalidRecruiterRequest('candidate_limit_reached')
  return { ...state, candidates: [item, ...state.candidates.filter(entry => entry.id !== id)], updatedAt: now }
}

function queueAction(state: RecruiterState, body: JsonRecord, now: string): RecruiterState {
  if (!exactKeys(body, ['action', 'type', 'targetLabel', 'summary'], ['idempotencyKey'])) {
    throw new InvalidRecruiterRequest('request_fields_invalid')
  }
  const idempotencyKey = body.idempotencyKey === undefined
    ? randomUUID()
    : limitedText(body.idempotencyKey, 'idempotency_key', 80)
  const existing = state.actions.find(item => item.idempotencyKey === idempotencyKey)
  if (existing !== undefined) {
    const type = enumValue(body.type, ACTION_TYPES, 'type')
    const targetLabel = limitedText(body.targetLabel, 'target_label')
    const summary = limitedText(body.summary, 'summary', 500)
    if (existing.type !== type || existing.targetLabel !== targetLabel || existing.summary !== summary) {
      throw new InvalidRecruiterRequest('idempotency_conflict')
    }
    return state
  }
  if (state.actions.length >= MAX_ACTIONS) throw new InvalidRecruiterRequest('action_limit_reached')
  const item: RecruiterAction = {
    id: randomUUID(), type: enumValue(body.type, ACTION_TYPES, 'type'),
    targetLabel: limitedText(body.targetLabel, 'target_label'), summary: limitedText(body.summary, 'summary', 500),
    status: 'awaiting_confirmation', idempotencyKey, createdAt: now, updatedAt: now,
  }
  return { ...state, actions: [item, ...state.actions], updatedAt: now }
}

function queueKnowledgePublication(state: RecruiterState, body: JsonRecord, now: string): RecruiterState {
  if (!exactKeys(body, ['action', 'scope']) || body.scope !== 'hr-recruiting') {
    throw new InvalidRecruiterRequest('request_fields_invalid')
  }
  const pending = state.actions.some(item => item.type === 'publish_knowledge'
    && (item.status === 'awaiting_confirmation' || item.status === 'confirmed_pending_adapter'))
  if (pending) return state
  return queueAction(state, {
    action: 'queue_action', type: 'publish_knowledge', targetLabel: 'HR 招聘知识库',
    summary: '将已确认的岗位与面试复盘沉淀为知识候选，等待人工确认',
    idempotencyKey: `hr-knowledge-${state.updatedAt}`,
  }, now)
}

function updateAction(state: RecruiterState, body: JsonRecord, now: string): RecruiterState {
  if (!exactKeys(body, ['action', 'id'])) throw new InvalidRecruiterRequest('request_fields_invalid')
  const id = limitedText(body.id, 'id', 80)
  const existing = state.actions.find(item => item.id === id)
  if (existing === undefined) throw new InvalidRecruiterRequest('action_not_found')
  if (existing.status !== 'awaiting_confirmation') throw new InvalidRecruiterRequest('action_not_pending')
  const status: RecruiterActionStatus = body.action === 'confirm_action'
    ? 'confirmed_pending_adapter'
    : 'dismissed'
  return {
    ...state,
    actions: state.actions.map(item => item.id === id ? { ...item, status, updatedAt: now } : item),
    updatedAt: now,
  }
}

function mutate(state: RecruiterState, value: unknown, now: string): RecruiterState {
  const body = record(value)
  if (body === undefined || typeof body.action !== 'string') throw new InvalidRecruiterRequest('request_invalid')
  if (body.action === 'save_requirement') return saveRequirement(state, body, now)
  if (body.action === 'save_candidate_analysis') return saveCandidate(state, body, now)
  if (body.action === 'queue_action') return queueAction(state, body, now)
  if (body.action === 'publish_knowledge') return queueKnowledgePublication(state, body, now)
  if (body.action === 'confirm_action' || body.action === 'dismiss_action') return updateAction(state, body, now)
  throw new InvalidRecruiterRequest('action_invalid')
}

const stateMutationQueues = new Map<string, Promise<void>>()

async function mutateRecruiterStateTransition(
  path: string,
  value: unknown,
  now: string,
): Promise<{ before: RecruiterState; next: RecruiterSnapshot }> {
  const previous = stateMutationQueues.get(path) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>(resolve => { release = resolve })
  const chain = previous.then(() => current)
  stateMutationQueues.set(path, chain)
  await previous
  try {
    const before = await readRecruiterState(path, now)
    const state = mutate(before, value, now)
    await writeRecruiterState(path, state)
    return { before, next: recruiterSnapshot(state) }
  } finally {
    release?.()
    if (stateMutationQueues.get(path) === chain) stateMutationQueues.delete(path)
  }
}

/** Serialize one read-modify-write cycle so renderer and Agent updates cannot overwrite each other. */
export async function mutateRecruiterState(
  path: string,
  value: unknown,
  now = new Date().toISOString(),
): Promise<RecruiterSnapshot> {
  return (await mutateRecruiterStateTransition(path, value, now)).next
}

function adapterReceipt(value: unknown, fallbackTime: string): RecruiterAdapterReceipt {
  const item = record(value)
  const status = item?.status
  const reasonCode = item?.reasonCode
  const completedAt = item?.completedAt
  const remoteRef = item?.remoteRef
  if ((status !== 'succeeded' && status !== 'failed' && status !== 'requires_user_login')
    || typeof reasonCode !== 'string' || !/^[a-z0-9_:-]{1,80}$/u.test(reasonCode)
    || (completedAt !== undefined && canonicalTime(completedAt) === undefined)
    || (remoteRef !== undefined && (typeof remoteRef !== 'string' || remoteRef.length > 160 || /[\0\r\n]/u.test(remoteRef)))) {
    return { status: 'failed', reasonCode: 'adapter_invalid_result', completedAt: fallbackTime }
  }
  return {
    status,
    reasonCode,
    completedAt: typeof completedAt === 'string' ? completedAt : fallbackTime,
    ...(typeof remoteRef === 'string' ? { remoteRef } : {}),
  }
}

function knowledgeContent(state: RecruiterState): string {
  const compact = (items: string[]) => items.slice(0, 2).map(item => item.slice(0, 120))
  return JSON.stringify({
    kind: 'hr_recruiting_review',
    generatedAt: state.updatedAt,
    roles: state.requirements.filter(item => item.status !== 'closed').slice(0, 10).map(item => ({
      title: item.title, department: item.department, location: item.location,
      employmentType: item.employmentType, responsibilities: compact(item.responsibilities),
      requiredSkills: compact(item.requiredSkills), preferredSkills: compact(item.preferredSkills),
    })),
    confirmedReviews: state.candidates.filter(item => item.feedbackStatus === 'confirmed').slice(0, 8).map(item => ({
      requirementId: item.requirementId, stage: item.stage, evidence: compact(item.evidence),
      concerns: compact(item.concerns), interviewQuestions: compact(item.interviewQuestions),
    })),
    policy: '仅包含岗位事实和已确认的脱敏招聘复盘，不包含联系方式、原始简历或受保护属性。',
  })
}

/** Execute one confirmed action through an explicitly injected external adapter. */
export async function executeRecruiterAction(
  path: string,
  actionId: string,
  adapter: RecruiterAdapter | undefined,
  knowledge: { publisher?: RecruiterKnowledgePublisher; spaceId?: string } = {},
  now = new Date().toISOString(),
  execution?: { performed: boolean },
): Promise<RecruiterSnapshot> {
  const previous = stateMutationQueues.get(path) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>(resolve => { release = resolve })
  const chain = previous.then(() => current)
  stateMutationQueues.set(path, chain)
  await previous
  try {
    const state = await readRecruiterState(path, now)
    const action = state.actions.find(item => item.id === actionId)
    if (action === undefined) throw new InvalidRecruiterRequest('action_not_found')
    if (action.status === 'awaiting_confirmation') throw new InvalidRecruiterRequest('action_not_confirmed')
    if (action.status === 'dismissed' || action.status === 'succeeded') return recruiterSnapshot(state)
    if (execution !== undefined) execution.performed = true
    let result: RecruiterAdapterResult
    if (action.type === 'publish_knowledge') {
      if (knowledge.publisher === undefined) {
        throw new InvalidRecruiterRequest('knowledge_publisher_unavailable')
      }
      try {
        const published = await knowledge.publisher.publish({
          ...(knowledge.spaceId === undefined ? {} : { spaceId: knowledge.spaceId }),
          content: knowledgeContent(state),
          idempotencyKey: action.idempotencyKey,
        })
        result = {
          status: published.status,
          reasonCode: published.reasonCode,
          ...(published.completedAt === undefined ? {} : { completedAt: published.completedAt }),
          ...(published.memoryId === undefined ? {} : { remoteRef: published.memoryId }),
        }
      } catch {
        result = { status: 'failed', reasonCode: 'knowledge_publish_failed' }
      }
    } else {
      if (adapter === undefined) throw new InvalidRecruiterRequest('recruiter_adapter_unavailable')
      try {
        result = await adapter.execute({
          actionId: action.id,
          type: action.type,
          idempotencyKey: action.idempotencyKey,
          targetLabel: action.targetLabel,
          summary: action.summary,
        })
      } catch {
        result = { status: 'failed', reasonCode: 'adapter_failed' }
      }
    }
    const receipt = adapterReceipt(result, now)
    const next: RecruiterState = {
      ...state,
      actions: state.actions.map(item => item.id === action.id
        ? { ...item, status: receipt.status, adapterReceipt: receipt, updatedAt: receipt.completedAt }
        : item),
      knowledge: action.type === 'publish_knowledge' && receipt.status === 'succeeded'
        ? {
            status: 'ready',
            ...(knowledge.spaceId === undefined ? {} : { spaceId: knowledge.spaceId }),
            spaces: Math.max(1, state.knowledge.spaces),
            documents: state.knowledge.documents,
            memories: state.knowledge.memories + 1,
            pending: Math.max(0, state.knowledge.pending - 1),
            lastPublishedAt: receipt.completedAt,
            recent: receipt.remoteRef === undefined ? state.knowledge.recent : [{
              id: receipt.remoteRef, title: action.targetLabel, updatedAt: receipt.completedAt,
            }, ...state.knowledge.recent.filter(item => item.id !== receipt.remoteRef)].slice(0, 20),
          }
        : state.knowledge,
      updatedAt: receipt.completedAt,
    }
    await writeRecruiterState(path, next)
    return recruiterSnapshot(next)
  } finally {
    release?.()
    if (stateMutationQueues.get(path) === chain) stateMutationQueues.delete(path)
  }
}

function syncReceipt(value: unknown, now: string): RecruiterBossSyncResult {
  const item = record(value)
  const status = item?.status
  const reasonCode = item?.reasonCode
  const completedAt = item?.completedAt === undefined ? now : canonicalTime(item.completedAt)
  if (!['ready', 'partial', 'failed', 'requires_user_login'].includes(String(status))
    || typeof reasonCode !== 'string' || !/^[a-z0-9_:-]{1,80}$/u.test(reasonCode)
    || completedAt === undefined) {
    return { status: 'failed', reasonCode: 'boss_sync_invalid_result', imported: 0, updated: 0, skipped: 0, completedAt: now }
  }
  try {
    const rawRequirements = item?.requirements === undefined ? [] : item.requirements
    const rawCandidates = item?.candidates === undefined ? [] : item.candidates
    if (!Array.isArray(rawRequirements) || rawRequirements.length > MAX_REQUIREMENTS
      || !Array.isArray(rawCandidates) || rawCandidates.length > MAX_CANDIDATES) {
      throw new InvalidRecruiterRequest('boss_sync_records_invalid')
    }
    const requirements = rawRequirements.map(parsePersistedRequirement)
    const candidates = rawCandidates.map(parsePersistedCandidate)
    if (requirements.some(entry => entry === undefined) || candidates.some(entry => entry === undefined)) {
      throw new InvalidRecruiterRequest('boss_sync_records_invalid')
    }
    return {
      status: status as RecruiterBossSyncResult['status'], reasonCode,
      imported: nonNegative(item?.imported, 'sync_imported'), updated: nonNegative(item?.updated, 'sync_updated'),
      skipped: nonNegative(item?.skipped, 'sync_skipped'), completedAt,
      ...(item?.cursor === undefined ? {} : { cursor: limitedText(item.cursor, 'sync_cursor', 240) }),
      ...(item?.responseRate === undefined ? {} : { responseRate: integer(item.responseRate, 'response_rate', 0, 100) }),
      ...(requirements.length === 0 ? {} : { requirements: requirements as RecruiterRequirement[] }),
      ...(candidates.length === 0 ? {} : { candidates: candidates as RecruiterCandidateAnalysis[] }),
    }
  } catch {
    return { status: 'failed', reasonCode: 'boss_sync_invalid_result', imported: 0, updated: 0, skipped: 0, completedAt: now }
  }
}

export async function syncRecruiterBoss(
  path: string,
  adapter: RecruiterBossAdapter | undefined,
  now = new Date().toISOString(),
): Promise<RecruiterSnapshot> {
  if (adapter === undefined) throw new InvalidRecruiterRequest('boss_official_adapter_unavailable')
  const previous = stateMutationQueues.get(path) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>(resolve => { release = resolve })
  const chain = previous.then(() => current)
  stateMutationQueues.set(path, chain)
  await previous
  try {
    const state = await readRecruiterState(path, now)
    let raw: RecruiterBossSyncResult
    try {
      raw = await adapter.sync({
        ...(state.sync.cursor === undefined ? {} : { cursor: state.sync.cursor }),
        idempotencyKey: randomUUID(),
      })
    } catch {
      raw = { status: 'failed', reasonCode: 'boss_sync_failed', imported: 0, updated: 0, skipped: 0 }
    }
    const receipt = syncReceipt(raw, now)
    const completedAt = receipt.completedAt ?? now
    const successful = receipt.status === 'ready' || receipt.status === 'partial'
    const importedRequirements = successful ? receipt.requirements ?? [] : []
    const requirements = [
      ...importedRequirements,
      ...state.requirements.filter(item => !importedRequirements.some(imported => imported.id === item.id)),
    ].slice(0, MAX_REQUIREMENTS)
    const requirementIds = new Set(requirements.map(item => item.id))
    // Conflict policy (plan §4.2/§7.2): a locally confirmed candidate record is the
    // HR decision of record; the remote copy enters neither the state nor the
    // cursor. Unconfirmed records stay sync-owned and are replaced by the import.
    const locallyConfirmed = new Set(
      state.candidates.filter(item => item.feedbackStatus === 'confirmed').map(item => item.id),
    )
    const importedCandidates = (successful ? receipt.candidates ?? [] : [])
      .filter(item => !locallyConfirmed.has(item.id))
      .filter(item => requirementIds.has(item.requirementId))
    const candidates = [
      ...importedCandidates,
      ...state.candidates.filter(item => !importedCandidates.some(imported => imported.id === item.id)),
    ].slice(0, MAX_CANDIDATES)
    const next: RecruiterState = {
      ...state,
      requirements,
      candidates,
      sync: {
        provider: 'boss_zhipin',
        status: receipt.status === 'failed' ? 'error' : receipt.status,
        imported: receipt.imported, updated: receipt.updated, skipped: receipt.skipped,
        lastAttemptAt: completedAt,
        ...(successful ? { lastSuccessAt: completedAt } : {}),
        ...(receipt.cursor === undefined ? {} : { cursor: receipt.cursor }),
        ...(receipt.responseRate === undefined ? {} : { responseRate: receipt.responseRate }),
        ...(locallyConfirmed.size === 0 ? {} : { conflictsPreserved: locallyConfirmed.size }),
        reason: receipt.reasonCode,
      },
      updatedAt: completedAt,
    }
    await writeRecruiterState(path, next)
    return recruiterSnapshot(next, { bossAdapter: true })
  } finally {
    release?.()
    if (stateMutationQueues.get(path) === chain) stateMutationQueues.delete(path)
  }
}

function finish(res: ServerResponse, status: number, value: object, allow?: string): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(value))
}

function loopback(address: string | undefined): boolean {
  return address === '::1' || address?.startsWith('127.') === true || address?.startsWith('::ffff:127.') === true
}

function sameOrigin(req: IncomingMessage, expectedOrigin: string, mutating: boolean): boolean {
  let expected: URL
  try { expected = new URL(expectedOrigin) } catch { return false }
  if (expected.origin !== expectedOrigin || expected.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(expected.hostname)) return false
  if (!loopback(req.socket.remoteAddress) || req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
  if (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin') return false
  if (req.headers.origin === expected.origin) return true
  if (mutating || req.headers['sec-fetch-site'] !== 'same-origin' || req.headers.referer === undefined) return false
  try { return new URL(req.headers.referer).origin === expected.origin } catch { return false }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers['content-length']
  if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new RecruiterBodyTooLarge()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new RecruiterBodyTooLarge()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export interface RecruiterRouteDependencies {
  statePath?: string | undefined
  now?: (() => Date) | undefined
  adapter?: RecruiterAdapter | undefined
  bossAdapter?: RecruiterBossAdapter | undefined
  credentials?: Pick<CredentialProvider, 'resolve'> | undefined
  knowledgePublisher?: RecruiterKnowledgePublisher | undefined
  /** @deprecated Default HR space is resolved by Knowledge from tenant context. */
  hrKnowledgeSpaceId?: string | undefined
  openBossWeb?: ((url?: string) => Promise<void>) | undefined
  audit?: YootunAuditRecorder | undefined
}

const RECRUITER_AUDIT_SOURCE = Object.freeze({
  pluginId: 'dsh-plugin-desktop/yootun-recruiter', pluginVersion: '2.0.5', surface: 'human_ui' as const,
})

async function recordRecruiterAudit(audit: YootunAuditRecorder | undefined, input: YootunAuditRecordInput | undefined): Promise<void> {
  if (audit === undefined || input === undefined) return
  try { await audit.record(input) } catch { /* Audit transport must never change business behavior. */ }
}

function recruiterMutationAudit(body: JsonRecord, before: RecruiterState, next: RecruiterSnapshot): YootunAuditRecordInput | undefined {
  if (body.action === 'save_requirement') {
    const id = typeof body.id === 'string' ? body.id : next.requirements.find(item => !before.requirements.some(previous => previous.id === item.id))?.id
    const after = next.requirements.find(item => item.id === id)
    if (id === undefined || after === undefined) return undefined
    const previous = before.requirements.find(item => item.id === id)
    return { source: RECRUITER_AUDIT_SOURCE, actionCode: previous === undefined ? 'recruiter.requirement.created' : 'recruiter.requirement.updated', category: previous === undefined ? 'create' : 'update', target: { type: 'requirement', id }, outcome: 'succeeded', changes: [{ field: 'status', ...(previous === undefined ? {} : { before: previous.status }), after: after.status }] }
  }
  if (body.action === 'save_candidate_analysis') {
    const id = typeof body.id === 'string' ? body.id : next.candidates.find(item => !before.candidates.some(previous => previous.id === item.id))?.id
    const after = next.candidates.find(item => item.id === id)
    if (id === undefined || after === undefined) return undefined
    const previous = before.candidates.find(item => item.id === id)
    return { source: RECRUITER_AUDIT_SOURCE, actionCode: 'recruiter.candidate_analysis.saved', category: 'update', target: { type: 'candidate', id }, outcome: 'succeeded', changes: [{ field: 'feedbackStatus', ...(previous === undefined ? {} : { before: previous.feedbackStatus }), after: after.feedbackStatus }] }
  }
  if (body.action === 'queue_action' || body.action === 'publish_knowledge') {
    const action = next.actions.find(item => !before.actions.some(previous => previous.id === item.id))
    if (action === undefined) return undefined
    return { source: RECRUITER_AUDIT_SOURCE, actionCode: 'recruiter.action.created', category: 'create', target: { type: 'recruiter_action', id: action.id }, outcome: 'succeeded', changes: [{ field: 'type', after: action.type }, { field: 'status', after: action.status }] }
  }
  if (body.action === 'confirm_action' || body.action === 'dismiss_action') {
    const id = typeof body.id === 'string' ? body.id : undefined
    const previous = before.actions.find(item => item.id === id)
    const after = next.actions.find(item => item.id === id)
    if (id === undefined || previous === undefined || after === undefined) return undefined
    const confirmed = body.action === 'confirm_action'
    return { source: RECRUITER_AUDIT_SOURCE, actionCode: confirmed ? 'recruiter.action.confirmed' : 'recruiter.action.dismissed', category: 'update', target: { type: 'recruiter_action', id }, outcome: 'succeeded', changes: [{ field: 'status', before: previous.status, after: after.status }] }
  }
  return undefined
}

function recruiterExecutionAudit(actionId: string, next: RecruiterSnapshot): YootunAuditRecordInput {
  const action = next.actions.find(item => item.id === actionId)
  const status = action?.status
  const outcome = status === 'succeeded' ? 'succeeded' : status === 'requires_user_login' ? 'accepted' : 'failed'
  return { source: RECRUITER_AUDIT_SOURCE, actionCode: 'recruiter.action.executed', category: 'execute', target: { type: 'recruiter_action', id: actionId }, outcome, changes: status === undefined ? [] : [{ field: 'status', after: status }], ...(action?.adapterReceipt === undefined ? {} : { effects: [{ target: action.type === 'publish_knowledge' ? 'knowledge' : 'recruiter_adapter', outcome: action.adapterReceipt.status, code: action.adapterReceipt.reasonCode, ...(action.adapterReceipt.remoteRef === undefined ? {} : { remoteRef: action.adapterReceipt.remoteRef }) }] }), ...(outcome === 'failed' ? { errorCode: action?.adapterReceipt?.reasonCode ?? 'action_failed' } : {}) }
}

function recruiterSyncAudit(next: RecruiterSnapshot): YootunAuditRecordInput {
  const outcome = next.sync.status === 'ready' ? 'succeeded' : next.sync.status === 'partial' ? 'partial' : next.sync.status === 'requires_user_login' ? 'accepted' : 'failed'
  return { source: RECRUITER_AUDIT_SOURCE, actionCode: 'recruiter.boss_sync.executed', category: 'execute', target: { type: 'candidate_collection', id: 'boss_zhipin' }, outcome, changes: [{ field: 'insertedCount', after: next.sync.imported }, { field: 'updatedCount', after: next.sync.updated }], ...(outcome === 'failed' ? { errorCode: next.sync.reason ?? 'boss_sync_failed' } : {}) }
}

function failedRecruiterMutationAudit(body: JsonRecord, errorCode: string): YootunAuditRecordInput | undefined {
  if (body.action === 'save_requirement') {
    const updating = body.id !== undefined
    return { source: RECRUITER_AUDIT_SOURCE, actionCode: updating ? 'recruiter.requirement.updated' : 'recruiter.requirement.created', category: updating ? 'update' : 'create', target: { type: 'requirement', id: safeYootunAuditTargetId(body.id) }, outcome: 'failed', errorCode }
  }
  if (body.action === 'save_candidate_analysis') {
    return { source: RECRUITER_AUDIT_SOURCE, actionCode: 'recruiter.candidate_analysis.saved', category: 'update', target: { type: 'candidate', id: safeYootunAuditTargetId(body.id) }, outcome: 'failed', errorCode }
  }
  if (body.action === 'queue_action' || body.action === 'publish_knowledge') {
    return { source: RECRUITER_AUDIT_SOURCE, actionCode: 'recruiter.action.created', category: 'create', target: { type: 'recruiter_action', id: 'unresolved' }, outcome: 'failed', errorCode }
  }
  if (body.action === 'confirm_action' || body.action === 'dismiss_action') {
    const confirmed = body.action === 'confirm_action'
    return { source: RECRUITER_AUDIT_SOURCE, actionCode: confirmed ? 'recruiter.action.confirmed' : 'recruiter.action.dismissed', category: 'update', target: { type: 'recruiter_action', id: safeYootunAuditTargetId(body.id) }, outcome: 'failed', errorCode }
  }
  return undefined
}

async function modelsAccessReady(credentials: Pick<CredentialProvider, 'resolve'> | undefined): Promise<boolean> {
  if (credentials === undefined) return false
  try {
    const resolved = await credentials.resolve(MODELS_API_KEY_REF)
    return typeof resolved?.value === 'string' && resolved.value.length > 0
  } catch {
    return false
  }
}

function validUuid(value: string | undefined): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

export async function handleYootunRecruiterRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  dependencies: RecruiterRouteDependencies,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') return finish(res, 405, { error: 'method_not_allowed' }, 'GET, POST')
  if (!sameOrigin(req, expectedOrigin, req.method === 'POST')) return finish(res, 403, { error: 'forbidden' })
  if (dependencies.statePath === undefined) return finish(res, 503, { error: 'recruiter_storage_unavailable' })
  if (!await modelsAccessReady(dependencies.credentials)) {
    return finish(res, 503, { error: 'model_api_key_unavailable' })
  }
  const now = (dependencies.now?.() ?? new Date()).toISOString()
  const state = await readRecruiterState(dependencies.statePath, now)
  const knowledgeReady = dependencies.knowledgePublisher !== undefined
  const capabilities = {
    bossAdapter: dependencies.bossAdapter !== undefined,
    knowledgeReady,
    bossWeb: dependencies.openBossWeb !== undefined,
  }
  if (req.method === 'GET') return finish(res, 200, recruiterSnapshot(state, capabilities))
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finish(res, 415, { error: 'content_type_invalid' })
  }
  let auditRequest: JsonRecord | undefined
  try {
    const body = readJson(req)
    const parsed = await body
    const recordBody = record(parsed)
    auditRequest = recordBody
    let next: RecruiterSnapshot
    if (recordBody?.action === 'execute_action') {
      if (!exactKeys(recordBody, ['action', 'id'])) throw new InvalidRecruiterRequest('request_fields_invalid')
      const execution = { performed: false }
      next = await executeRecruiterAction(
        dependencies.statePath,
        limitedText(recordBody.id, 'id', 80),
        dependencies.adapter ?? dependencies.bossAdapter,
        {
          ...(dependencies.knowledgePublisher === undefined ? {} : { publisher: dependencies.knowledgePublisher }),
          ...(validUuid(dependencies.hrKnowledgeSpaceId) ? { spaceId: dependencies.hrKnowledgeSpaceId } : {}),
        },
        now,
        execution,
      )
      if (execution.performed) await recordRecruiterAudit(dependencies.audit, recruiterExecutionAudit(limitedText(recordBody.id, 'id', 80), next))
    } else if (recordBody?.action === 'sync_boss') {
      if (!exactKeys(recordBody, ['action'])) throw new InvalidRecruiterRequest('request_fields_invalid')
      next = await syncRecruiterBoss(dependencies.statePath, dependencies.bossAdapter, now)
      await recordRecruiterAudit(dependencies.audit, recruiterSyncAudit(next))
    } else if (recordBody?.action === 'sync_preview') {
      if (!exactKeys(recordBody, ['action'])) throw new InvalidRecruiterRequest('request_fields_invalid')
      return finish(res, 200, { ...recruiterSnapshot(state, capabilities), syncPreview: syncPreview(state, capabilities.bossAdapter) })
    } else if (recordBody?.action === 'open_boss_login') {
      if (!exactKeys(recordBody, ['action'])) throw new InvalidRecruiterRequest('request_fields_invalid')
      if (dependencies.openBossWeb === undefined) throw new InvalidRecruiterRequest('boss_web_unavailable')
      await dependencies.openBossWeb()
      return finish(res, 200, recruiterSnapshot(state, capabilities))
    } else {
      const transition = await mutateRecruiterStateTransition(dependencies.statePath, parsed, now)
      next = transition.next
      await recordRecruiterAudit(dependencies.audit, recordBody === undefined ? undefined : recruiterMutationAudit(recordBody, transition.before, next))
    }
    finish(res, 200, recruiterSnapshot(next, capabilities))
  } catch (cause) {
    const errorCode = cause instanceof InvalidRecruiterRequest ? cause.message : 'recruiter_storage_failed'
    if (auditRequest?.action === 'execute_action') {
      await recordRecruiterAudit(dependencies.audit, { source: RECRUITER_AUDIT_SOURCE, actionCode: 'recruiter.action.executed', category: 'execute', target: { type: 'recruiter_action', id: safeYootunAuditTargetId(auditRequest.id) }, outcome: 'failed', errorCode })
    } else if (auditRequest?.action === 'sync_boss') {
      await recordRecruiterAudit(dependencies.audit, { source: RECRUITER_AUDIT_SOURCE, actionCode: 'recruiter.boss_sync.executed', category: 'execute', target: { type: 'candidate_collection', id: 'boss_zhipin' }, outcome: 'failed', errorCode })
    } else if (auditRequest !== undefined) {
      await recordRecruiterAudit(dependencies.audit, failedRecruiterMutationAudit(auditRequest, errorCode))
    }
    if (cause instanceof RecruiterBodyTooLarge) return finish(res, 413, { error: 'request_too_large' })
    if (cause instanceof InvalidRecruiterRequest || cause instanceof SyntaxError) {
      const error = cause instanceof InvalidRecruiterRequest ? cause.message : 'request_invalid'
      const unavailable = [
        'recruiter_adapter_unavailable', 'boss_official_adapter_unavailable',
        'knowledge_publisher_unavailable', 'model_api_key_unavailable', 'boss_web_unavailable',
      ].includes(error)
      return finish(res, unavailable ? 503 : 400, { error })
    }
    finish(res, 500, { error: 'recruiter_storage_failed' })
  }
}

export const yootunRecruiterLimits = Object.freeze({
  bodyBytes: MAX_BODY_BYTES,
  stateBytes: MAX_STATE_BYTES,
  requirements: MAX_REQUIREMENTS,
  candidates: MAX_CANDIDATES,
  actions: MAX_ACTIONS,
})
