/** Private, local-only recruitment workspace for Yootun-Agent. */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export const YOOTUN_RECRUITER_PATH = '/api/desktop/yootun/recruiter'

const STATE_VERSION = 1
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
const ACTION_TYPES = ['publish_jd', 'send_message', 'write_feedback'] as const
const ACTION_STATUSES = ['awaiting_confirmation', 'confirmed_pending_adapter', 'dismissed'] as const
// Keep candidate evidence focused on job-relevant signals; reject common protected attributes.
const PROTECTED_SCREENING_SIGNAL = /性别|男性|女性|男生|女生|年龄|出生|婚育|结婚|民族|籍贯|国籍|宗教|残疾|健康状况|户籍|政治面貌|性取向|同性恋|异性恋|身高|体重|颜值|外貌|照片|家庭状况|家庭成员|血型/iu
const CONTACT_SIGNAL = /(?:1[3-9]\d{9}|微信|(?:^|\s)vx(?:$|\s)|邮箱|email)/iu

type RequirementStatus = typeof REQUIREMENT_STATUSES[number]
type CandidateStage = typeof CANDIDATE_STAGES[number]
type FeedbackStatus = typeof FEEDBACK_STATUSES[number]
type RecruiterActionType = typeof ACTION_TYPES[number]
type RecruiterActionStatus = typeof ACTION_STATUSES[number]
type JsonRecord = Record<string, unknown>

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
}

export interface RecruiterState {
  version: 1
  requirements: RecruiterRequirement[]
  candidates: RecruiterCandidateAnalysis[]
  actions: RecruiterAction[]
  updatedAt: string
}

export interface RecruiterSnapshot extends RecruiterState {
  dashboard: {
    openRoles: number
    activeCandidates: number
    pendingReplies: number
    pendingFeedback: number
    pendingConfirmation: number
    funnel: Array<{ stage: CandidateStage; count: number }>
  }
  boss: {
    loginUrl: string
    status: 'requires_user_login'
    adapter: 'not_configured'
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
  return { version: STATE_VERSION, requirements: [], candidates: [], actions: [], updatedAt: now }
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
  ])) return undefined
  try {
    const createdAt = canonicalTime(item.createdAt)
    const updatedAt = canonicalTime(item.updatedAt)
    if (createdAt === undefined || updatedAt === undefined) return undefined
    return {
      id: limitedText(item.id, 'id', 80), type: enumValue(item.type, ACTION_TYPES, 'type'),
      targetLabel: limitedText(item.targetLabel, 'target_label'), summary: limitedText(item.summary, 'summary', 500),
      status: enumValue(item.status, ACTION_STATUSES, 'status'),
      idempotencyKey: limitedText(item.idempotencyKey, 'idempotency_key', 80), createdAt, updatedAt,
    }
  } catch { return undefined }
}

function parsePersistedState(value: unknown): RecruiterState | undefined {
  const root = record(value)
  if (root === undefined || !exactKeys(root, ['version', 'requirements', 'candidates', 'actions', 'updatedAt'])
    || root.version !== STATE_VERSION || !Array.isArray(root.requirements)
    || !Array.isArray(root.candidates) || !Array.isArray(root.actions)
    || root.requirements.length > MAX_REQUIREMENTS || root.candidates.length > MAX_CANDIDATES
    || root.actions.length > MAX_ACTIONS) return undefined
  const updatedAt = canonicalTime(root.updatedAt)
  const requirements = root.requirements.map(parsePersistedRequirement)
  const candidates = root.candidates.map(parsePersistedCandidate)
  const actions = root.actions.map(parsePersistedAction)
  if (updatedAt === undefined || requirements.some(item => item === undefined)
    || candidates.some(item => item === undefined) || actions.some(item => item === undefined)) return undefined
  return {
    version: STATE_VERSION,
    requirements: requirements as RecruiterRequirement[],
    candidates: candidates as RecruiterCandidateAnalysis[],
    actions: actions as RecruiterAction[],
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

export function recruiterSnapshot(state: RecruiterState): RecruiterSnapshot {
  const funnel = CANDIDATE_STAGES.map(stage => ({
    stage,
    count: state.candidates.filter(candidate => candidate.stage === stage).length,
  }))
  return {
    ...state,
    dashboard: {
      openRoles: state.requirements.filter(item => item.status === 'active').length,
      activeCandidates: state.candidates.filter(item => item.stage !== 'hired' && item.stage !== 'archived').length,
      pendingReplies: state.actions.filter(item => item.type === 'send_message' && item.status === 'awaiting_confirmation').length,
      pendingFeedback: state.candidates.filter(item => item.feedbackStatus === 'draft').length,
      pendingConfirmation: state.actions.filter(item => item.status === 'awaiting_confirmation').length,
      funnel,
    },
    boss: {
      loginUrl: 'https://www.zhipin.com/web/user/?ka=header-login',
      status: 'requires_user_login',
      adapter: 'not_configured',
    },
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
  if (existing !== undefined) return state
  if (state.actions.length >= MAX_ACTIONS) throw new InvalidRecruiterRequest('action_limit_reached')
  const item: RecruiterAction = {
    id: randomUUID(), type: enumValue(body.type, ACTION_TYPES, 'type'),
    targetLabel: limitedText(body.targetLabel, 'target_label'), summary: limitedText(body.summary, 'summary', 500),
    status: 'awaiting_confirmation', idempotencyKey, createdAt: now, updatedAt: now,
  }
  return { ...state, actions: [item, ...state.actions], updatedAt: now }
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
  if (body.action === 'confirm_action' || body.action === 'dismiss_action') return updateAction(state, body, now)
  throw new InvalidRecruiterRequest('action_invalid')
}

const stateMutationQueues = new Map<string, Promise<void>>()

/** Serialize one read-modify-write cycle so renderer and Agent updates cannot overwrite each other. */
export async function mutateRecruiterState(
  path: string,
  value: unknown,
  now = new Date().toISOString(),
): Promise<RecruiterSnapshot> {
  const previous = stateMutationQueues.get(path) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>(resolve => { release = resolve })
  const chain = previous.then(() => current)
  stateMutationQueues.set(path, chain)
  await previous
  try {
    const state = await readRecruiterState(path, now)
    const next = mutate(state, value, now)
    await writeRecruiterState(path, next)
    return recruiterSnapshot(next)
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
  const now = (dependencies.now?.() ?? new Date()).toISOString()
  const state = await readRecruiterState(dependencies.statePath, now)
  if (req.method === 'GET') return finish(res, 200, recruiterSnapshot(state))
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finish(res, 415, { error: 'content_type_invalid' })
  }
  try {
    const next = await mutateRecruiterState(dependencies.statePath, await readJson(req), now)
    finish(res, 200, next)
  } catch (cause) {
    if (cause instanceof RecruiterBodyTooLarge) return finish(res, 413, { error: 'request_too_large' })
    if (cause instanceof InvalidRecruiterRequest || cause instanceof SyntaxError) {
      return finish(res, 400, { error: cause instanceof InvalidRecruiterRequest ? cause.message : 'request_invalid' })
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
