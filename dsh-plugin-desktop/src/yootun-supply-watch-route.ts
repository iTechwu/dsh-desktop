/** Private, local-only supply and operating risk workspace for Yootun-Agent. */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { YootunAuditRecordInput, YootunAuditRecorder } from './yootun-audit-contract.ts'

export const YOOTUN_SUPPLY_WATCH_PATH = '/api/desktop/yootun/supply-watch'
const STATE_VERSION = 1
const MAX_BODY_BYTES = 64 * 1024
const MAX_STATE_BYTES = 1024 * 1024
const MAX_RISKS = 1000
const MAX_ACTIONS = 1000
const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const CHECK_POSIX_MODE = process.platform !== 'win32'
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const RISK_STATUSES = ['open', 'monitoring', 'resolved'] as const
const ACTION_STATUSES = ['awaiting_confirmation', 'confirmed_pending_adapter', 'dismissed', 'succeeded', 'failed', 'requires_user_login'] as const
type Severity = typeof SEVERITIES[number]
type RiskStatus = typeof RISK_STATUSES[number]
type ActionStatus = typeof ACTION_STATUSES[number]
type JsonRecord = Record<string, unknown>
export type SupplyAdapterStatus = 'succeeded' | 'failed' | 'requires_user_login'
export interface SupplyAdapterRequest { actionId: string; type: 'review_risk'; riskId: string; idempotencyKey: string; targetLabel: string; summary: string }
export interface SupplyAdapterResult { status: SupplyAdapterStatus; reasonCode: string; completedAt?: string; remoteRef?: string }
export interface SupplyAdapter { execute: (request: SupplyAdapterRequest) => Promise<SupplyAdapterResult> }
export interface SupplyAdapterReceipt { status: SupplyAdapterStatus; reasonCode: string; completedAt: string; remoteRef?: string }

export interface SupplyRisk { id: string; title: string; supplierLabel: string; category: string; severity: Severity; status: RiskStatus; signal: string; recommendedAction: string; source: string; dueAt?: string; updatedAt: string }
export interface SupplyAction { id: string; riskId: string; type: 'review_risk'; targetLabel: string; summary: string; status: ActionStatus; idempotencyKey: string; createdAt: string; updatedAt: string; adapterReceipt?: SupplyAdapterReceipt }
export interface SupplyState { version: 1; risks: SupplyRisk[]; actions: SupplyAction[]; updatedAt: string }
export interface SupplySnapshot extends SupplyState { dashboard: { risks: number; critical: number; open: number; dueToday: number; pendingConfirmation: number } }

class InvalidSupplyRequest extends Error {}
class SupplyBodyTooLarge extends Error {}
function record(value: unknown): JsonRecord | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined }
function exactKeys(value: JsonRecord, required: readonly string[], optional: readonly string[] = []): boolean { const allowed = new Set([...required, ...optional]); return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => allowed.has(key)) }
function text(value: unknown, label: string, max = 180): string { if (typeof value !== 'string') throw new InvalidSupplyRequest(`${label}_invalid`); const result = value.trim(); if (!result || result.length > max || /[\0\r]/u.test(result)) throw new InvalidSupplyRequest(`${label}_invalid`); return result }
function enumValue<T extends string>(value: unknown, options: readonly T[], label: string): T { if (typeof value !== 'string' || !options.includes(value as T)) throw new InvalidSupplyRequest(`${label}_invalid`); return value as T }
function canonicalTime(value: unknown): string | undefined { if (typeof value !== 'string') return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined }
function emptyState(now: string): SupplyState { return { version: STATE_VERSION, risks: [], actions: [], updatedAt: now } }
function parseRisk(value: unknown): SupplyRisk | undefined { const item = record(value); if (!item || !exactKeys(item, ['id', 'title', 'supplierLabel', 'category', 'severity', 'status', 'signal', 'recommendedAction', 'source', 'updatedAt'], ['dueAt'])) return undefined; const updatedAt = canonicalTime(item.updatedAt); const dueAt = item.dueAt === undefined ? undefined : canonicalTime(item.dueAt); if (!updatedAt || (item.dueAt !== undefined && !dueAt)) return undefined; try { return { id: text(item.id, 'id', 80), title: text(item.title, 'title'), supplierLabel: text(item.supplierLabel, 'supplier_label', 80), category: text(item.category, 'category', 80), severity: enumValue(item.severity, SEVERITIES, 'severity'), status: enumValue(item.status, RISK_STATUSES, 'status'), signal: text(item.signal, 'signal', 500), recommendedAction: text(item.recommendedAction, 'recommended_action', 500), source: text(item.source, 'source', 80), ...(dueAt === undefined ? {} : { dueAt }), updatedAt } } catch { return undefined } }
function parseAction(value: unknown): SupplyAction | undefined { const item = record(value); if (!item || !exactKeys(item, ['id', 'riskId', 'type', 'targetLabel', 'summary', 'status', 'idempotencyKey', 'createdAt', 'updatedAt'], ['adapterReceipt'])) return undefined; const createdAt = canonicalTime(item.createdAt); const updatedAt = canonicalTime(item.updatedAt); if (!createdAt || !updatedAt || item.type !== 'review_risk') return undefined; try { const status = enumValue(item.status, ACTION_STATUSES, 'status'); const rawReceipt = item.adapterReceipt; let adapterReceipt: SupplyAdapterReceipt | undefined; if (rawReceipt !== undefined) { const receipt = record(rawReceipt); if (!receipt) return undefined; const completedAt = canonicalTime(receipt.completedAt); const receiptStatus = typeof receipt.status === 'string' && ['succeeded', 'failed', 'requires_user_login'].includes(receipt.status) ? receipt.status as SupplyAdapterStatus : undefined; const reasonCode = typeof receipt.reasonCode === 'string' && /^[a-z0-9_:-]{1,80}$/u.test(receipt.reasonCode) ? receipt.reasonCode : undefined; const remoteRef = receipt.remoteRef === undefined ? undefined : typeof receipt.remoteRef === 'string' && receipt.remoteRef.length <= 160 && !/[\0\r\n]/u.test(receipt.remoteRef) ? receipt.remoteRef : undefined; if (!completedAt || !receiptStatus || !reasonCode || (receipt.remoteRef !== undefined && remoteRef === undefined)) return undefined; adapterReceipt = { status: receiptStatus, reasonCode, completedAt, ...(remoteRef === undefined ? {} : { remoteRef }) } } const terminal = status === 'succeeded' || status === 'failed' || status === 'requires_user_login'; if (terminal !== (adapterReceipt !== undefined) || (adapterReceipt !== undefined && adapterReceipt.status !== status)) return undefined; return { id: text(item.id, 'id', 80), riskId: text(item.riskId, 'risk_id', 80), type: 'review_risk', targetLabel: text(item.targetLabel, 'target_label'), summary: text(item.summary, 'summary', 500), status, idempotencyKey: text(item.idempotencyKey, 'idempotency_key', 80), createdAt, updatedAt, ...(adapterReceipt === undefined ? {} : { adapterReceipt }) } } catch { return undefined } }
function parseState(value: unknown): SupplyState | undefined { const root = record(value); if (!root || !exactKeys(root, ['version', 'risks', 'actions', 'updatedAt']) || root.version !== STATE_VERSION || !Array.isArray(root.risks) || !Array.isArray(root.actions) || root.risks.length > MAX_RISKS || root.actions.length > MAX_ACTIONS) return undefined; const updatedAt = canonicalTime(root.updatedAt); const risks = root.risks.map(parseRisk); const actions = root.actions.map(parseAction); if (!updatedAt || risks.some(item => !item) || actions.some(item => !item)) return undefined; return { version: 1, risks: risks as SupplyRisk[], actions: actions as SupplyAction[], updatedAt } }
export async function readSupplyState(path: string, now = new Date().toISOString()): Promise<SupplyState> { try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE_BYTES) return emptyState(now); return parseState(JSON.parse(await readFile(path, 'utf8'))) ?? emptyState(now) } catch { return emptyState(now) } }
async function writeState(path: string, state: SupplyState): Promise<void> { const directory = dirname(path); await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE }); const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('supply_state_directory_invalid'); if (CHECK_POSIX_MODE) await chmod(directory, DIRECTORY_MODE); const json = `${JSON.stringify(state, undefined, 2)}\n`; if (Buffer.byteLength(json) > MAX_STATE_BYTES) throw new InvalidSupplyRequest('state_too_large'); await writeFileAtomic(path, json, { mode: FILE_MODE, dirMode: DIRECTORY_MODE }); if (CHECK_POSIX_MODE) await chmod(path, FILE_MODE) }
export function supplySnapshot(state: SupplyState, now = new Date()): SupplySnapshot { const today = now.toISOString().slice(0, 10); return { ...state, dashboard: { risks: state.risks.length, critical: state.risks.filter(item => item.severity === 'critical').length, open: state.risks.filter(item => item.status !== 'resolved').length, dueToday: state.risks.filter(item => item.dueAt?.slice(0, 10) === today && item.status !== 'resolved').length, pendingConfirmation: state.actions.filter(item => item.status === 'awaiting_confirmation').length } } }
function mutate(state: SupplyState, value: unknown, now: string): SupplyState { const body = record(value); if (!body || typeof body.action !== 'string') throw new InvalidSupplyRequest('request_invalid'); if (body.action === 'save_risk') { if (!exactKeys(body, ['action', 'title', 'supplierLabel', 'category', 'severity', 'status', 'signal', 'recommendedAction', 'source'], ['id', 'dueAt'])) throw new InvalidSupplyRequest('request_fields_invalid'); const id = body.id === undefined ? randomUUID() : text(body.id, 'id', 80); const dueAt = body.dueAt === undefined ? undefined : canonicalTime(body.dueAt); if (body.dueAt !== undefined && !dueAt) throw new InvalidSupplyRequest('due_at_invalid'); const risk: SupplyRisk = { id, title: text(body.title, 'title'), supplierLabel: text(body.supplierLabel, 'supplier_label', 80), category: text(body.category, 'category', 80), severity: enumValue(body.severity, SEVERITIES, 'severity'), status: enumValue(body.status, RISK_STATUSES, 'status'), signal: text(body.signal, 'signal', 500), recommendedAction: text(body.recommendedAction, 'recommended_action', 500), source: text(body.source, 'source', 80), ...(dueAt === undefined ? {} : { dueAt }), updatedAt: now }; if (!state.risks.some(item => item.id === id) && state.risks.length >= MAX_RISKS) throw new InvalidSupplyRequest('risk_limit_reached'); return { ...state, risks: [risk, ...state.risks.filter(item => item.id !== id)], updatedAt: now } }
  if (body.action === 'queue_review') { if (!exactKeys(body, ['action', 'riskId', 'summary'], ['idempotencyKey'])) throw new InvalidSupplyRequest('request_fields_invalid'); const riskId = text(body.riskId, 'risk_id', 80); const risk = state.risks.find(item => item.id === riskId); if (!risk) throw new InvalidSupplyRequest('risk_not_found'); const summary = text(body.summary, 'summary', 500); const idempotencyKey = body.idempotencyKey === undefined ? randomUUID() : text(body.idempotencyKey, 'idempotency_key', 80); const existing = state.actions.find(item => item.idempotencyKey === idempotencyKey); if (existing) { if (existing.riskId !== riskId || existing.summary !== summary) throw new InvalidSupplyRequest('idempotency_key_conflict'); return state } if (state.actions.length >= MAX_ACTIONS) throw new InvalidSupplyRequest('action_limit_reached'); const action: SupplyAction = { id: randomUUID(), riskId, type: 'review_risk', targetLabel: risk.supplierLabel, summary, status: 'awaiting_confirmation', idempotencyKey, createdAt: now, updatedAt: now }; return { ...state, actions: [action, ...state.actions], updatedAt: now } }
  if (body.action === 'confirm_action' || body.action === 'dismiss_action') { if (!exactKeys(body, ['action', 'id'])) throw new InvalidSupplyRequest('request_fields_invalid'); const id = text(body.id, 'id', 80); const action = state.actions.find(item => item.id === id); if (!action) throw new InvalidSupplyRequest('action_not_found'); if (action.status !== 'awaiting_confirmation') throw new InvalidSupplyRequest('action_not_pending'); const status: ActionStatus = body.action === 'confirm_action' ? 'confirmed_pending_adapter' : 'dismissed'; return { ...state, actions: state.actions.map(item => item.id === id ? { ...item, status, updatedAt: now } : item), updatedAt: now } }
  throw new InvalidSupplyRequest('action_invalid') }
const mutationQueues = new Map<string, Promise<void>>()
async function mutateSupplyState(path: string, value: unknown, now: string): Promise<{ before: SupplyState; next: SupplyState }> { const previous = mutationQueues.get(path) ?? Promise.resolve(); let release: (() => void) | undefined; const current = new Promise<void>(resolve => { release = resolve }); const chain = previous.then(() => current); mutationQueues.set(path, chain); await previous; try { const before = await readSupplyState(path, now); const next = mutate(before, value, now); await writeState(path, next); return { before, next } } finally { release?.(); if (mutationQueues.get(path) === chain) mutationQueues.delete(path) } }
function supplyAdapterReceipt(value: unknown, fallbackTime: string): SupplyAdapterReceipt { const item = record(value); const status = item?.status; const reasonCode = item?.reasonCode; const completedAt = item?.completedAt; const remoteRef = item?.remoteRef; if ((status !== 'succeeded' && status !== 'failed' && status !== 'requires_user_login') || typeof reasonCode !== 'string' || !/^[a-z0-9_:-]{1,80}$/u.test(reasonCode) || (completedAt !== undefined && canonicalTime(completedAt) === undefined) || (remoteRef !== undefined && (typeof remoteRef !== 'string' || remoteRef.length > 160 || /[\0\r\n]/u.test(remoteRef)))) return { status: 'failed', reasonCode: 'adapter_invalid_result', completedAt: fallbackTime }; return { status, reasonCode, completedAt: typeof completedAt === 'string' ? completedAt : fallbackTime, ...(typeof remoteRef === 'string' ? { remoteRef } : {}) } }
export async function executeSupplyAction(path: string, actionId: string, adapter: SupplyAdapter | undefined, now = new Date().toISOString(), execution?: { performed: boolean }): Promise<SupplySnapshot> { const previous = mutationQueues.get(path) ?? Promise.resolve(); let release: (() => void) | undefined; const current = new Promise<void>(resolve => { release = resolve }); const chain = previous.then(() => current); mutationQueues.set(path, chain); await previous; try { const state = await readSupplyState(path, now); const action = state.actions.find(item => item.id === actionId); if (!action) throw new InvalidSupplyRequest('action_not_found'); if (action.status === 'awaiting_confirmation') throw new InvalidSupplyRequest('action_not_confirmed'); if (action.status === 'dismissed' || action.status === 'succeeded') return supplySnapshot(state); if (execution !== undefined) execution.performed = true; if (!adapter) throw new InvalidSupplyRequest('supply_adapter_unavailable'); let result: SupplyAdapterResult; try { result = await adapter.execute({ actionId: action.id, type: action.type, riskId: action.riskId, idempotencyKey: action.idempotencyKey, targetLabel: action.targetLabel, summary: action.summary }) } catch { result = { status: 'failed', reasonCode: 'adapter_failed' } } const receipt = supplyAdapterReceipt(result, now); const next: SupplyState = { ...state, actions: state.actions.map(item => item.id === action.id ? { ...item, status: receipt.status, adapterReceipt: receipt, updatedAt: receipt.completedAt } : item), updatedAt: receipt.completedAt }; await writeState(path, next); return supplySnapshot(next) } finally { release?.(); if (mutationQueues.get(path) === chain) mutationQueues.delete(path) } }
function finish(res: ServerResponse, status: number, value: object, allow?: string): void { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); if (allow) res.setHeader('Allow', allow); res.end(JSON.stringify(value)) }
async function body(req: IncomingMessage): Promise<unknown> { let size = 0; const chunks: Buffer[] = []; for await (const chunk of req) { const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); size += data.byteLength; if (size > MAX_BODY_BYTES) throw new SupplyBodyTooLarge(); chunks.push(data) } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new InvalidSupplyRequest('json_invalid') } }

export interface SupplyRouteDependencies {
  statePath: string | undefined
  now?: () => Date
  adapter?: SupplyAdapter | undefined
  audit?: YootunAuditRecorder | undefined
}

const SUPPLY_AUDIT_SOURCE = Object.freeze({ pluginId: 'dsh-plugin-desktop/yootun-supply-watch', pluginVersion: '2.0.5', surface: 'human_ui' as const })

async function recordSupplyAudit(audit: YootunAuditRecorder | undefined, input: YootunAuditRecordInput | undefined): Promise<void> {
  if (audit === undefined || input === undefined) return
  try { await audit.record(input) } catch { /* Audit transport must never change business behavior. */ }
}

function supplyMutationAudit(request: JsonRecord, before: SupplyState, next: SupplyState): YootunAuditRecordInput | undefined {
  if (request.action === 'save_risk') {
    const id = typeof request.id === 'string' ? request.id : next.risks.find(item => !before.risks.some(previous => previous.id === item.id))?.id
    const after = next.risks.find(item => item.id === id)
    if (id === undefined || after === undefined) return undefined
    const previous = before.risks.find(item => item.id === id)
    return {
      source: SUPPLY_AUDIT_SOURCE,
      actionCode: previous === undefined ? 'supply.risk.created' : 'supply.risk.updated',
      category: previous === undefined ? 'create' : 'update', target: { type: 'supply_risk', id }, outcome: 'succeeded',
      changes: [
        { field: 'severity', ...(previous === undefined ? {} : { before: previous.severity }), after: after.severity },
        { field: 'status', ...(previous === undefined ? {} : { before: previous.status }), after: after.status },
        { field: 'dueDate', ...(previous?.dueAt === undefined ? {} : { before: previous.dueAt }), ...(after.dueAt === undefined ? { after: null } : { after: after.dueAt }) },
      ],
    }
  }
  if (request.action === 'queue_review') {
    const action = next.actions.find(item => !before.actions.some(previous => previous.id === item.id))
    return action === undefined ? undefined : { source: SUPPLY_AUDIT_SOURCE, actionCode: 'supply.review.created', category: 'create', target: { type: 'supply_review', id: action.id }, outcome: 'succeeded', changes: [{ field: 'status', after: action.status }] }
  }
  if (request.action === 'confirm_action' || request.action === 'dismiss_action') {
    const id = typeof request.id === 'string' ? request.id : undefined
    const previous = before.actions.find(item => item.id === id)
    const after = next.actions.find(item => item.id === id)
    if (id === undefined || previous === undefined || after === undefined) return undefined
    const confirmed = request.action === 'confirm_action'
    return { source: SUPPLY_AUDIT_SOURCE, actionCode: confirmed ? 'supply.review.confirmed' : 'supply.review.dismissed', category: 'update', target: { type: 'supply_review', id }, outcome: 'succeeded', changes: [{ field: 'status', before: previous.status, after: after.status }] }
  }
  return undefined
}

function supplyExecutionAudit(actionId: string, next: SupplySnapshot): YootunAuditRecordInput {
  const action = next.actions.find(item => item.id === actionId)
  const status = action?.status
  const outcome = status === 'succeeded' ? 'succeeded' : status === 'requires_user_login' ? 'accepted' : 'failed'
  return { source: SUPPLY_AUDIT_SOURCE, actionCode: 'supply.review.executed', category: 'execute', target: { type: 'supply_review', id: actionId }, outcome, changes: status === undefined ? [] : [{ field: 'status', after: status }], ...(action?.adapterReceipt === undefined ? {} : { effects: [{ target: 'supply_adapter', outcome: action.adapterReceipt.status, code: action.adapterReceipt.reasonCode, ...(action.adapterReceipt.remoteRef === undefined ? {} : { remoteRef: action.adapterReceipt.remoteRef }) }] }), ...(outcome === 'failed' ? { errorCode: action?.adapterReceipt?.reasonCode ?? 'action_failed' } : {}) }
}

export async function handleYootunSupplyWatchRequest(req: IncomingMessage, res: ServerResponse, rendererOrigin: string, options: SupplyRouteDependencies): Promise<void> {
  if (req.headers.origin && req.headers.origin !== rendererOrigin) return finish(res, 403, { error: 'origin_forbidden' })
  const path = options.statePath
  if (!path) return finish(res, 503, { error: 'state_unavailable' })
  const now = (options.now ?? (() => new Date()))().toISOString()
  let auditRequest: JsonRecord | undefined
  try {
    if (req.method === 'GET') return finish(res, 200, supplySnapshot(await readSupplyState(path, now), new Date(now)))
    if (req.method !== 'POST') return finish(res, 405, { error: 'method_not_allowed' }, 'GET, POST')
    const payload = await body(req)
    const request = record(payload)
    auditRequest = request
    if (request?.action === 'execute_action') {
      if (!exactKeys(request, ['action', 'id'])) throw new InvalidSupplyRequest('request_fields_invalid')
      const actionId = text(request.id, 'id', 80)
      const execution = { performed: false }
      const next = await executeSupplyAction(path, actionId, options.adapter, now, execution)
      if (execution.performed) await recordSupplyAudit(options.audit, supplyExecutionAudit(actionId, next))
      return finish(res, 200, next)
    }
    const transition = await mutateSupplyState(path, payload, now)
    const next = transition.next
    await recordSupplyAudit(options.audit, request === undefined ? undefined : supplyMutationAudit(request, transition.before, next))
    finish(res, 200, supplySnapshot(next, new Date(now)))
  } catch (cause) {
    if (auditRequest?.action === 'execute_action' && typeof auditRequest.id === 'string') {
      await recordSupplyAudit(options.audit, { source: SUPPLY_AUDIT_SOURCE, actionCode: 'supply.review.executed', category: 'execute', target: { type: 'supply_review', id: auditRequest.id }, outcome: 'failed', errorCode: cause instanceof InvalidSupplyRequest ? cause.message : 'state_write_failed' })
    }
    if (cause instanceof SupplyBodyTooLarge) return finish(res, 413, { error: 'body_too_large' })
    if (cause instanceof InvalidSupplyRequest) return finish(res, cause.message === 'supply_adapter_unavailable' ? 503 : 400, { error: cause.message })
    finish(res, 500, { error: 'state_write_failed' })
  }
}
