/** Private, local-only FinOps summary backed by Models accounting. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { yesterdayPeriod, type DashboardPeriod } from './yootun-dashboard-activity.ts'

export const YOOTUN_FINOPS_PATH = '/api/desktop/yootun/finops'
export const YOOTUN_FINOPS_USAGE_URL = 'https://ixicai.cn/api/v1/yootun/usage'

const MODELS_API_KEY_REF = credentialRef('MODELS_API_KEY')
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

type JsonRecord = Record<string, unknown>
type FinopsStatus = 'ready' | 'empty' | 'unavailable' | 'error'

export interface FinopsSummary {
  period: DashboardPeriod
  source: { status: FinopsStatus; reason?: string }
  currency: string
  summary: {
    spend: number
    budget?: number
    remaining?: number
    requests: number
    tokens: number
    alerts: number
  }
  models: Array<{ id: string; name: string; requests: number; tokens: number; cost: number }>
  alerts: Array<{ id: string; title: string; status: string }>
  budgets: Array<{ id: string; name: string; limit: number; used: number; remaining: number }>
  generatedAt: string
}

export interface YootunFinopsDependencies {
  credentials?: Pick<CredentialProvider, 'resolve'> | undefined
  fetcher?: typeof fetch | undefined
  now?: (() => Date) | undefined
  logger?: { warn?: (...args: unknown[]) => void } | undefined
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function finite(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function optionalFinite(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function text(value: unknown, fallback: string, max: number): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 && normalized.length <= max ? normalized : fallback
}

async function boundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_RESPONSE_BYTES || response.body === null) return undefined
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_RESPONSE_BYTES) return undefined
      chunks.push(Buffer.from(next.value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function emptySnapshot(period: DashboardPeriod, status: Exclude<FinopsStatus, 'ready' | 'empty'> | 'empty', reason?: string, now = new Date()): FinopsSummary {
  return {
    period, source: { status, ...(reason === undefined ? {} : { reason }) }, currency: 'CNY',
    summary: { spend: 0, requests: 0, tokens: 0, alerts: 0 }, models: [], alerts: [], budgets: [], generatedAt: now.toISOString(),
  }
}

function normalizeUsage(value: unknown, period: DashboardPeriod, now: Date): FinopsSummary {
  const root = record(value)
  const summary = record(root?.summary)
  if (root?.object !== 'yootun.usage_range' || typeof root.currency !== 'string' || summary === undefined) {
    return emptySnapshot(period, 'error', 'usage_response_invalid', now)
  }
  const requests = finite(summary.requests)
  const spend = finite(summary.cost)
  const tokens = finite(summary.totalTokens)
  const budget = optionalFinite(summary.budget ?? record(root.budget)?.limit)
  const remaining = budget === undefined ? undefined : Math.max(0, budget - spend)
  const models = Array.isArray(root.byModel) ? root.byModel.slice(0, 100).flatMap((item, index) => {
    const model = record(item)
    if (model === undefined || typeof model.model !== 'string') return []
    const name = text(model.model, `Model ${index + 1}`, 160)
    return [{
      id: name, name, requests: finite(model.requests),
      tokens: finite(model.totalTokens ?? (finite(model.inputTokens) + finite(model.outputTokens))),
      cost: finite(model.cost),
    }]
  }) : []
  const alerts = Array.isArray(root.alerts) ? root.alerts.slice(0, 100).map((item, index) => {
    const alert = record(item)
    return {
      id: text(alert?.id, `alert-${index + 1}`, 120),
      title: text(alert?.title, 'Usage alert', 240),
      status: text(alert?.status, 'open', 40),
    }
  }) : []
  const summaryValue: FinopsSummary['summary'] = {
    spend, requests, tokens, alerts: alerts.length,
    ...(budget === undefined ? {} : { budget, remaining: remaining ?? 0 }),
  }
  return {
    period,
    source: { status: requests > 0 ? 'ready' : 'empty' },
    currency: text(root.currency, 'CNY', 8),
    summary: summaryValue,
    models,
    alerts,
    budgets: budget === undefined ? [] : [{ id: 'monthly-model-budget', name: 'Monthly model budget', limit: budget, used: spend, remaining: remaining ?? 0 }],
    generatedAt: now.toISOString(),
  }
}

async function loadUsage(
  dependencies: YootunFinopsDependencies,
  period: DashboardPeriod,
  now: Date,
): Promise<FinopsSummary> {
  if (dependencies.credentials === undefined) return emptySnapshot(period, 'unavailable', 'credential_service_unavailable', now)
  let resolved
  try {
    resolved = await dependencies.credentials.resolve(MODELS_API_KEY_REF)
  } catch {
    return emptySnapshot(period, 'error', 'credential_read_failed', now)
  }
  if (resolved === undefined || resolved.value.trim().length === 0) {
    return emptySnapshot(period, 'unavailable', 'model_api_key_missing', now)
  }
  const url = new URL(YOOTUN_FINOPS_USAGE_URL)
  url.searchParams.set('start', period.start)
  url.searchParams.set('end', period.end)
  try {
    const response = await (dependencies.fetcher ?? globalThis.fetch)(url, {
      headers: { Authorization: `Bearer ${resolved.value}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 401 || response.status === 403) return emptySnapshot(period, 'unavailable', 'model_api_key_rejected', now)
    if (!response.ok) return emptySnapshot(period, 'error', 'usage_service_failed', now)
    return normalizeUsage(await boundedJson(response), period, now)
  } catch (error) {
    dependencies.logger?.warn?.('yootun finops: Models usage query failed: %s', error instanceof Error ? error.message.slice(0, 200) : 'unknown error')
    return emptySnapshot(period, 'error', error instanceof DOMException && error.name === 'TimeoutError' ? 'usage_service_timeout' : 'usage_service_unreachable', now)
  }
}

function send(res: ServerResponse, status: number, value: object, allow?: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (allow) res.setHeader('Allow', allow)
  res.end(JSON.stringify(value))
}

export async function handleYootunFinopsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rendererOrigin: string,
  dependencies: YootunFinopsDependencies = {},
): Promise<void> {
  if (req.headers.origin && req.headers.origin !== rendererOrigin) {
    send(res, 403, { error: 'origin_forbidden' })
    return
  }
  const now = dependencies.now?.() ?? new Date()
  if (req.method !== 'GET') {
    send(res, 405, { error: 'method_not_allowed' }, 'GET')
    return
  }
  const period = yesterdayPeriod(now)
  const snapshot = await loadUsage(dependencies, period, now)
  send(res, 200, snapshot)
}
