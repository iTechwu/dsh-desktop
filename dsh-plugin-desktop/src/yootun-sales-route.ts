/** Private, local-only sales workspace for Yootun-Agent. */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { YootunAuditRecordInput, YootunAuditRecorder } from './yootun-audit-contract.ts'

export const YOOTUN_SALES_PATH = '/api/desktop/yootun/sales'

const STATE_VERSION = 1
const MAX_BODY_BYTES = 64 * 1024
const MAX_STATE_BYTES = 1024 * 1024
const MAX_LEADS = 1000
const MAX_ACTIONS = 1000
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const CHECK_POSIX_MODE = process.platform !== 'win32'
const LEAD_STAGES = ['new', 'qualified', 'proposal', 'won', 'lost'] as const
const ACTION_STATUSES = ['awaiting_confirmation', 'confirmed_pending_adapter', 'dismissed', 'succeeded', 'failed', 'requires_user_login'] as const
const ACTION_CHANNELS = ['email', 'phone', 'meeting'] as const

type LeadStage = typeof LEAD_STAGES[number]
type ActionStatus = typeof ACTION_STATUSES[number]
type ActionChannel = typeof ACTION_CHANNELS[number]
type JsonRecord = Record<string, unknown>

export type SalesAdapterStatus = 'succeeded' | 'failed' | 'requires_user_login'

export interface SalesAdapterRequest {
  actionId: string
  type: 'follow_up'
  leadId: string
  channel: ActionChannel
  idempotencyKey: string
  targetLabel: string
  summary: string
}

export interface SalesAdapterResult {
  status: SalesAdapterStatus
  reasonCode: string
  completedAt?: string
  remoteRef?: string
}

export interface SalesAdapter {
  execute: (request: SalesAdapterRequest) => Promise<SalesAdapterResult>
}

export interface SalesAdapterReceipt {
  status: SalesAdapterStatus
  reasonCode: string
  completedAt: string
  remoteRef?: string
}

export interface SalesLead {
  id: string
  company: string
  contactLabel: string
  stage: LeadStage
  source: string
  nextActionAt?: string
  note?: string
  updatedAt: string
}

export interface SalesAction {
  id: string
  leadId: string
  type: 'follow_up'
  channel: ActionChannel
  summary: string
  status: ActionStatus
  idempotencyKey: string
  createdAt: string
  updatedAt: string
  adapterReceipt?: SalesAdapterReceipt
}

export interface SalesState {
  version: 1
  leads: SalesLead[]
  actions: SalesAction[]
  updatedAt: string
}

export interface SalesSnapshot extends SalesState {
  dashboard: {
    leads: number
    qualified: number
    dueToday: number
    pendingConfirmation: number
  }
}

class InvalidSalesRequest extends Error {}
class SalesBodyTooLarge extends Error {}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function exactKeys(value: JsonRecord, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every(key => allowed.has(key))
}

function text(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string') throw new InvalidSalesRequest(`${label}_invalid`)
  const result = value.trim()
  if (result.length === 0 || result.length > max || /[\0\r]/u.test(result)) throw new InvalidSalesRequest(`${label}_invalid`)
  return result
}

function enumValue<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new InvalidSalesRequest(`${label}_invalid`)
  return value as T
}

function canonicalTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined
}

function emptyState(now: string): SalesState {
  return { version: STATE_VERSION, leads: [], actions: [], updatedAt: now }
}

function parseLead(value: unknown): SalesLead | undefined {
  const item = record(value)
  if (item === undefined || !exactKeys(item, ['id', 'company', 'contactLabel', 'stage', 'source', 'updatedAt'], ['nextActionAt', 'note'])) return undefined
  const updatedAt = canonicalTime(item.updatedAt)
  if (updatedAt === undefined) return undefined
  const nextActionAt = item.nextActionAt === undefined ? undefined : canonicalTime(item.nextActionAt)
  if (item.nextActionAt !== undefined && nextActionAt === undefined) return undefined
  try {
    return {
      id: text(item.id, 'id', 80), company: text(item.company, 'company'),
      contactLabel: text(item.contactLabel, 'contact_label', 80), stage: enumValue(item.stage, LEAD_STAGES, 'stage'),
      source: text(item.source, 'source', 80), ...(nextActionAt === undefined ? {} : { nextActionAt }),
      ...(item.note === undefined ? {} : { note: text(item.note, 'note', 500) }), updatedAt,
    }
  } catch { return undefined }
}

function parseAction(value: unknown): SalesAction | undefined {
  const item = record(value)
  if (item === undefined || !exactKeys(item, ['id', 'leadId', 'type', 'channel', 'summary', 'status', 'idempotencyKey', 'createdAt', 'updatedAt'], ['adapterReceipt'])) return undefined
  const createdAt = canonicalTime(item.createdAt)
  const updatedAt = canonicalTime(item.updatedAt)
  if (createdAt === undefined || updatedAt === undefined || item.type !== 'follow_up') return undefined
  try {
    const status = enumValue(item.status, ACTION_STATUSES, 'status')
    const rawReceipt = item.adapterReceipt
    let adapterReceipt: SalesAdapterReceipt | undefined
    if (rawReceipt !== undefined) {
      const receipt = record(rawReceipt)
      if (receipt === undefined) return undefined
      const completedAt = canonicalTime(receipt.completedAt)
      const receiptStatus = typeof receipt.status === 'string' && ['succeeded', 'failed', 'requires_user_login'].includes(receipt.status)
        ? receipt.status as SalesAdapterStatus : undefined
      const reasonCode = typeof receipt.reasonCode === 'string' && /^[a-z0-9_:-]{1,80}$/u.test(receipt.reasonCode)
        ? receipt.reasonCode : undefined
      const remoteRef = receipt.remoteRef === undefined ? undefined
        : typeof receipt.remoteRef === 'string' && receipt.remoteRef.length <= 160 && !/[\0\r\n]/u.test(receipt.remoteRef)
          ? receipt.remoteRef : undefined
      if (completedAt === undefined || receiptStatus === undefined || reasonCode === undefined
        || (receipt.remoteRef !== undefined && remoteRef === undefined)) return undefined
      adapterReceipt = { status: receiptStatus, reasonCode, completedAt, ...(remoteRef === undefined ? {} : { remoteRef }) }
    }
    const terminal = status === 'succeeded' || status === 'failed' || status === 'requires_user_login'
    if (terminal !== (adapterReceipt !== undefined) || (adapterReceipt !== undefined && adapterReceipt.status !== status)) return undefined
    return {
      id: text(item.id, 'id', 80), leadId: text(item.leadId, 'lead_id', 80), type: 'follow_up',
      channel: enumValue(item.channel, ACTION_CHANNELS, 'channel'), summary: text(item.summary, 'summary', 500),
      status, idempotencyKey: text(item.idempotencyKey, 'idempotency_key', 80),
      createdAt, updatedAt,
      ...(adapterReceipt === undefined ? {} : { adapterReceipt }),
    }
  } catch { return undefined }
}

function parseState(value: unknown): SalesState | undefined {
  const root = record(value)
  if (root === undefined || !exactKeys(root, ['version', 'leads', 'actions', 'updatedAt']) || root.version !== STATE_VERSION
    || !Array.isArray(root.leads) || !Array.isArray(root.actions) || root.leads.length > MAX_LEADS || root.actions.length > MAX_ACTIONS) return undefined
  const updatedAt = canonicalTime(root.updatedAt)
  const leads = root.leads.map(parseLead)
  const actions = root.actions.map(parseAction)
  if (updatedAt === undefined || leads.some(item => item === undefined) || actions.some(item => item === undefined)) return undefined
  return { version: STATE_VERSION, leads: leads as SalesLead[], actions: actions as SalesAction[], updatedAt }
}

export async function readSalesState(path: string, now = new Date().toISOString()): Promise<SalesState> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES) return emptyState(now)
    return parseState(JSON.parse(await readFile(path, 'utf8'))) ?? emptyState(now)
  } catch { return emptyState(now) }
}

async function writeSalesState(path: string, state: SalesState): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('sales_state_directory_invalid')
  if (CHECK_POSIX_MODE) await chmod(directory, DIRECTORY_MODE)
  const json = `${JSON.stringify(state, undefined, 2)}\n`
  if (Buffer.byteLength(json) > MAX_STATE_BYTES) throw new InvalidSalesRequest('state_too_large')
  await writeFileAtomic(path, json, { mode: FILE_MODE, dirMode: DIRECTORY_MODE })
  if (CHECK_POSIX_MODE) await chmod(path, FILE_MODE)
}

export function salesSnapshot(state: SalesState, now = new Date()): SalesSnapshot {
  const today = now.toISOString().slice(0, 10)
  return {
    ...state,
    dashboard: {
      leads: state.leads.length,
      qualified: state.leads.filter(lead => lead.stage === 'qualified' || lead.stage === 'proposal').length,
      dueToday: state.leads.filter(lead => lead.nextActionAt?.slice(0, 10) === today && lead.stage !== 'lost' && lead.stage !== 'won').length,
      pendingConfirmation: state.actions.filter(action => action.status === 'awaiting_confirmation').length,
    },
  }
}

function mutate(state: SalesState, value: unknown, now: string): SalesState {
  const body = record(value)
  if (body === undefined || typeof body.action !== 'string') throw new InvalidSalesRequest('request_invalid')
  if (body.action === 'save_lead') {
    if (!exactKeys(body, ['action', 'company', 'contactLabel', 'stage', 'source'], ['id', 'nextActionAt', 'note', 'phone'])) throw new InvalidSalesRequest('request_fields_invalid')
    const id = body.id === undefined ? randomUUID() : text(body.id, 'id', 80)
    const nextActionAt = body.nextActionAt === undefined ? undefined : canonicalTime(body.nextActionAt)
    if (body.nextActionAt !== undefined && nextActionAt === undefined) throw new InvalidSalesRequest('next_action_at_invalid')
    const lead: SalesLead = {
      id, company: text(body.company, 'company'), contactLabel: text(body.contactLabel, 'contact_label', 80),
      stage: enumValue(body.stage, LEAD_STAGES, 'stage'), source: text(body.source, 'source', 80),
      ...(nextActionAt === undefined ? {} : { nextActionAt }), ...(body.note === undefined ? {} : { note: text(body.note, 'note', 500) }), updatedAt: now,
    }
    if (!state.leads.some(item => item.id === id) && state.leads.length >= MAX_LEADS) throw new InvalidSalesRequest('lead_limit_reached')
    return { ...state, leads: [lead, ...state.leads.filter(item => item.id !== id)], updatedAt: now }
  }
  if (body.action === 'queue_follow_up') {
    if (!exactKeys(body, ['action', 'leadId', 'channel', 'summary'], ['idempotencyKey'])) throw new InvalidSalesRequest('request_fields_invalid')
    const leadId = text(body.leadId, 'lead_id', 80)
    if (!state.leads.some(item => item.id === leadId)) throw new InvalidSalesRequest('lead_not_found')
    const channel = enumValue(body.channel, ACTION_CHANNELS, 'channel')
    const summary = text(body.summary, 'summary', 500)
    const idempotencyKey = body.idempotencyKey === undefined ? randomUUID() : text(body.idempotencyKey, 'idempotency_key', 80)
    const existing = state.actions.find(item => item.idempotencyKey === idempotencyKey)
    if (existing !== undefined) {
      if (existing.leadId !== leadId || existing.channel !== channel || existing.summary !== summary) throw new InvalidSalesRequest('idempotency_key_conflict')
      return state
    }
    if (state.actions.length >= MAX_ACTIONS) throw new InvalidSalesRequest('action_limit_reached')
    const action: SalesAction = {
      id: randomUUID(), leadId, type: 'follow_up', channel, summary, status: 'awaiting_confirmation', idempotencyKey, createdAt: now, updatedAt: now,
    }
    return { ...state, actions: [action, ...state.actions], updatedAt: now }
  }
  if (body.action === 'confirm_action' || body.action === 'dismiss_action') {
    if (!exactKeys(body, ['action', 'id'])) throw new InvalidSalesRequest('request_fields_invalid')
    const id = text(body.id, 'id', 80)
    const action = state.actions.find(item => item.id === id)
    if (action === undefined) throw new InvalidSalesRequest('action_not_found')
    if (action.status !== 'awaiting_confirmation') throw new InvalidSalesRequest('action_not_pending')
    const status: ActionStatus = body.action === 'confirm_action' ? 'confirmed_pending_adapter' : 'dismissed'
    return { ...state, actions: state.actions.map(item => item.id === id ? { ...item, status, updatedAt: now } : item), updatedAt: now }
  }
  throw new InvalidSalesRequest('action_invalid')
}

const mutationQueues = new Map<string, Promise<void>>()

async function mutateSalesState(path: string, value: unknown, now: string): Promise<{ before: SalesState, next: SalesState }> {
  const previous = mutationQueues.get(path) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>(resolve => { release = resolve })
  const chain = previous.then(() => current)
  mutationQueues.set(path, chain)
  await previous
  try {
    const before = await readSalesState(path, now)
    const next = mutate(before, value, now)
    await writeSalesState(path, next)
    return { before, next }
  }
  finally { release?.(); if (mutationQueues.get(path) === chain) mutationQueues.delete(path) }
}

function salesAdapterReceipt(value: unknown, fallbackTime: string): SalesAdapterReceipt {
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
  return { status, reasonCode, completedAt: typeof completedAt === 'string' ? completedAt : fallbackTime,
    ...(typeof remoteRef === 'string' ? { remoteRef } : {}) }
}

export async function executeSalesAction(
  path: string,
  actionId: string,
  adapter: SalesAdapter | undefined,
  now = new Date().toISOString(),
  execution?: { performed: boolean },
): Promise<SalesSnapshot> {
  const previous = mutationQueues.get(path) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>(resolve => { release = resolve })
  const chain = previous.then(() => current)
  mutationQueues.set(path, chain)
  await previous
  try {
    const state = await readSalesState(path, now)
    const action = state.actions.find(item => item.id === actionId)
    if (action === undefined) throw new InvalidSalesRequest('action_not_found')
    if (action.status === 'awaiting_confirmation') throw new InvalidSalesRequest('action_not_confirmed')
    if (action.status === 'dismissed' || action.status === 'succeeded') return salesSnapshot(state)
    if (execution !== undefined) execution.performed = true
    if (adapter === undefined) throw new InvalidSalesRequest('sales_adapter_unavailable')
    let result: SalesAdapterResult
    try {
      const lead = state.leads.find(item => item.id === action.leadId)
      result = await adapter.execute({ actionId: action.id, type: action.type, leadId: action.leadId,
        channel: action.channel, idempotencyKey: action.idempotencyKey, targetLabel: lead?.contactLabel ?? 'sales lead', summary: action.summary })
    } catch { result = { status: 'failed', reasonCode: 'adapter_failed' } }
    const receipt = salesAdapterReceipt(result, now)
    const next: SalesState = { ...state, actions: state.actions.map(item => item.id === action.id
      ? { ...item, status: receipt.status, adapterReceipt: receipt, updatedAt: receipt.completedAt } : item), updatedAt: receipt.completedAt }
    await writeSalesState(path, next)
    return salesSnapshot(next)
  } finally {
    release?.()
    if (mutationQueues.get(path) === chain) mutationQueues.delete(path)
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

function sameOrigin(req: IncomingMessage, expectedOrigin: string, mutating: boolean): boolean {
  let expected: URL
  try { expected = new URL(expectedOrigin) } catch { return false }
  if (expected.origin !== expectedOrigin || expected.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(expected.hostname)) return false
  const remote = req.socket.remoteAddress
  if (!(remote === '::1' || remote?.startsWith('127.') === true || remote?.startsWith('::ffff:127.') === true)) return false
  if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
  if (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin') return false
  if (req.headers.origin === expected.origin) return true
  if (mutating || req.headers['sec-fetch-site'] !== 'same-origin' || req.headers.referer === undefined) return false
  try { return new URL(req.headers.referer).origin === expected.origin } catch { return false }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers['content-length']
  if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new SalesBodyTooLarge()
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new SalesBodyTooLarge()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export interface SalesRouteDependencies {
  statePath?: string | undefined
  now?: () => Date
  tools?: SalesToolsRuntime | undefined
  adapter?: SalesAdapter | undefined
  audit?: YootunAuditRecorder | undefined
}

const SALES_AUDIT_SOURCE = Object.freeze({
  pluginId: 'dsh-plugin-desktop/yootun-sales',
  pluginVersion: '2.0.5',
  surface: 'human_ui' as const,
})

async function recordSalesAudit(audit: YootunAuditRecorder | undefined, input: YootunAuditRecordInput | undefined): Promise<void> {
  if (audit === undefined || input === undefined) return
  try { await audit.record(input) } catch { /* Audit transport must never change business behavior. */ }
}

function salesMutationAudit(request: JsonRecord, before: SalesState, next: SalesState): YootunAuditRecordInput | undefined {
  if (request.action === 'save_lead') {
    const id = typeof request.id === 'string' ? request.id : next.leads.find(item => !before.leads.some(previous => previous.id === item.id))?.id
    const after = next.leads.find(item => item.id === id)
    if (id === undefined || after === undefined) return undefined
    const previous = before.leads.find(item => item.id === id)
    return {
      source: SALES_AUDIT_SOURCE,
      actionCode: previous === undefined ? 'sales.lead.created' : 'sales.lead.updated',
      category: previous === undefined ? 'create' : 'update',
      target: { type: 'lead', id }, outcome: 'succeeded',
      changes: [{ field: 'stage', ...(previous === undefined ? {} : { before: previous.stage }), after: after.stage }],
    }
  }
  if (request.action === 'queue_follow_up') {
    const action = next.actions.find(item => !before.actions.some(previous => previous.id === item.id))
    if (action === undefined) return undefined
    return { source: SALES_AUDIT_SOURCE, actionCode: 'sales.follow_up.created', category: 'create', target: { type: 'follow_up', id: action.id }, outcome: 'succeeded', changes: [{ field: 'channel', after: action.channel }, { field: 'status', after: action.status }] }
  }
  if (request.action === 'confirm_action' || request.action === 'dismiss_action') {
    const id = typeof request.id === 'string' ? request.id : undefined
    const previous = before.actions.find(item => item.id === id)
    const after = next.actions.find(item => item.id === id)
    if (id === undefined || previous === undefined || after === undefined) return undefined
    const confirmed = request.action === 'confirm_action'
    return { source: SALES_AUDIT_SOURCE, actionCode: confirmed ? 'sales.follow_up.confirmed' : 'sales.follow_up.dismissed', category: 'update', target: { type: 'follow_up', id }, outcome: 'succeeded', changes: [{ field: 'status', before: previous.status, after: after.status }] }
  }
  return undefined
}

function salesExecutionAudit(actionId: string, next: SalesSnapshot): YootunAuditRecordInput {
  const action = next.actions.find(item => item.id === actionId)
  const status = action?.status
  const outcome = status === 'succeeded' ? 'succeeded' : status === 'requires_user_login' ? 'accepted' : 'failed'
  return {
    source: SALES_AUDIT_SOURCE, actionCode: 'sales.follow_up.executed', category: 'execute',
    target: { type: 'follow_up', id: actionId }, outcome,
    changes: status === undefined ? [] : [{ field: 'status', after: status }],
    ...(action?.adapterReceipt === undefined ? {} : { effects: [{ target: 'sales_adapter', outcome: action.adapterReceipt.status, code: action.adapterReceipt.reasonCode, ...(action.adapterReceipt.remoteRef === undefined ? {} : { remoteRef: action.adapterReceipt.remoteRef }) }] }),
    ...(outcome === 'failed' ? { errorCode: action?.adapterReceipt?.reasonCode ?? 'action_failed' } : {}),
  }
}

export interface SalesToolsRuntime {
  schemas(): readonly { name: string, description?: string }[]
  execute: ToolRuntime['execute']
}

function sanitizeIntentResult(value: unknown): JsonRecord {
  const root = record(value)
  const envelope = record(root?.value) ?? root
  let structured = record(envelope?.structuredContent) ?? record(envelope?.data) ?? envelope
  let items = Array.isArray(structured?.items) ? structured.items : Array.isArray(structured?.results) ? structured.results : []
  if (items.length === 0 && Array.isArray(root?.content)) {
    for (const block of root.content) {
      const textBlock = record(block)
      if (textBlock?.type !== 'text' || typeof textBlock.text !== 'string') continue
      try {
        structured = record(JSON.parse(textBlock.text)) ?? structured
        items = Array.isArray(structured?.items) ? structured.items : Array.isArray(structured?.results) ? structured.results : []
        if (items.length > 0) break
      } catch { /* keep looking for a structured text block */ }
    }
  }
  return {
    status: root?.isError === true ? 'error' : 'ready',
    items: items.slice(0, 50).map(item => sanitizeIntentItem(item)).filter(item => item !== undefined),
  }
}

function sanitizeIntentItem(value: unknown): JsonRecord | undefined {
  const item = record(value)
  if (item === undefined) return undefined
  const result: JsonRecord = {}
  for (const key of ['platform', 'sourceUrl', 'observedAt', 'topic', 'intentLevel', 'confidence', 'suggestedNextStep']) {
    if (item[key] !== undefined && (typeof item[key] === 'string' || typeof item[key] === 'number')) {
      if (key === 'sourceUrl' && typeof item[key] === 'string') {
        const sourceUrl = safeSourceUrl(item[key])
        if (sourceUrl !== undefined) result[key] = sourceUrl
      } else result[key] = typeof item[key] === 'string' ? redact(item[key]) : item[key]
    }
  }
  if (Array.isArray(item.intentSignals)) result.intentSignals = item.intentSignals.filter(signal => typeof signal === 'string').slice(0, 12)
  if (Array.isArray(item.evidence)) result.evidence = item.evidence.slice(0, 5).map(entry => {
    const evidence = record(entry)
    return evidence === undefined ? undefined : {
      ...(typeof evidence.publishedAt === 'string' ? { publishedAt: evidence.publishedAt } : {}),
      ...(typeof evidence.quote === 'string' ? { quote: redact(evidence.quote).slice(0, 240) } : {}),
    }
  }).filter(entry => entry !== undefined)
  return result
}

function safeSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().slice(0, 500)
  } catch { return undefined }
}

function redact(value: string): string {
  return value
    .replace(/1[3-9]\d{9}/gu, '[手机号]')
    .replace(/(?:微信|vx|v信)\s*[:：]?\s*[a-z0-9_-]{3,32}/giu, '[联系方式]')
}

async function intentSearch(query: string, tools: SalesToolsRuntime | undefined): Promise<JsonRecord> {
  if (tools === undefined) return { status: 'unavailable', reason: 'tools_unavailable', items: [] }
  const schema = tools.schemas().find(item => /lead.?discovery|lead.?monitor|hotspot.?discovery|browser.?intelligence/i.test(`${item.name} ${item.description || ''}`))
  if (schema === undefined) return { status: 'unavailable', reason: 'lead_discovery_tool_unavailable', items: [] }
  try {
    const result = await tools.execute({ callId: ToolCallId(`yootun-sales-intent-${randomUUID()}`), name: schema.name, arguments: { query }, signal: AbortSignal.timeout(15_000) })
    return sanitizeIntentResult(result)
  } catch { return { status: 'error', reason: 'lead_discovery_request_failed', items: [] } }
}

export async function handleYootunSalesRequest(req: IncomingMessage, res: ServerResponse, expectedOrigin: string, dependencies: SalesRouteDependencies): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') return finish(res, 405, { error: 'method_not_allowed' }, 'GET, POST')
  if (!sameOrigin(req, expectedOrigin, req.method === 'POST')) return finish(res, 403, { error: 'forbidden' })
  if (dependencies.statePath === undefined) return finish(res, 503, { error: 'sales_storage_unavailable' })
  const now = (dependencies.now?.() ?? new Date()).toISOString()
  if (req.method === 'GET') return finish(res, 200, salesSnapshot(await readSalesState(dependencies.statePath, now), dependencies.now?.() ?? new Date()))
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return finish(res, 415, { error: 'content_type_invalid' })
  let auditRequest: JsonRecord | undefined
  try {
    const body = await readJson(req)
    const request = record(body)
    auditRequest = request
    if (request?.action === 'intent_search') {
      if (Object.keys(request).some(key => key !== 'action' && key !== 'query') || typeof request.query !== 'string') throw new InvalidSalesRequest('request_fields_invalid')
      const query = request.query.trim()
      if (query.length === 0 || query.length > 500 || /[\0\r]/u.test(query)) throw new InvalidSalesRequest('query_invalid')
      const snapshot = salesSnapshot(await readSalesState(dependencies.statePath, now), dependencies.now?.() ?? new Date())
      const intent = await intentSearch(query, dependencies.tools)
      finish(res, 200, { ...snapshot, intent: { query, ...intent } })
      return
    }
    if (request?.action === 'execute_action') {
      if (!exactKeys(request, ['action', 'id'])) throw new InvalidSalesRequest('request_fields_invalid')
      const actionId = text(request.id, 'id', 80)
      const execution = { performed: false }
      const next = await executeSalesAction(dependencies.statePath, actionId, dependencies.adapter, now, execution)
      if (execution.performed) await recordSalesAudit(dependencies.audit, salesExecutionAudit(actionId, next))
      finish(res, 200, next)
      return
    }
    const transition = await mutateSalesState(dependencies.statePath, body, now)
    await recordSalesAudit(dependencies.audit, request === undefined ? undefined : salesMutationAudit(request, transition.before, transition.next))
    finish(res, 200, salesSnapshot(transition.next, dependencies.now?.() ?? new Date()))
  } catch (cause) {
    if (auditRequest?.action === 'execute_action' && typeof auditRequest.id === 'string') {
      const errorCode = cause instanceof InvalidSalesRequest ? cause.message : 'sales_storage_failed'
      await recordSalesAudit(dependencies.audit, {
        source: SALES_AUDIT_SOURCE, actionCode: 'sales.follow_up.executed', category: 'execute',
        target: { type: 'follow_up', id: auditRequest.id }, outcome: 'failed', errorCode,
      })
    }
    if (cause instanceof SalesBodyTooLarge) return finish(res, 413, { error: 'request_too_large' })
    if (cause instanceof InvalidSalesRequest) return finish(res, cause.message === 'sales_adapter_unavailable' ? 503 : 400, { error: cause.message })
    if (cause instanceof SyntaxError) return finish(res, 400, { error: 'request_invalid' })
    finish(res, 500, { error: 'sales_storage_failed' })
  }
}
