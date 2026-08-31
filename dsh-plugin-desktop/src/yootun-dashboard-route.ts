import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import {
  collectLocalActivity,
  yesterdayPeriod,
  type DashboardPeriod,
  type LocalActivitySummary,
} from './yootun-dashboard-activity.ts'

export const YOOTUN_DASHBOARD_YESTERDAY_PATH = '/api/desktop/yootun/dashboard/yesterday'
export const YOOTUN_USAGE_URL = 'https://ixicai.cn/api/v1/yootun/usage'
const MODELS_API_KEY_REF = credentialRef('MODELS_API_KEY')
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

type JsonRecord = Record<string, unknown>
type SourceStatus = 'ready' | 'empty' | 'unavailable' | 'error'

export type DashboardSource<T> =
  | { status: 'ready' | 'empty'; data: T }
  | { status: 'unavailable' | 'error'; reason: string }

export interface YootunDashboardResponse {
  period: DashboardPeriod
  geo: DashboardSource<JsonRecord>
  usage: DashboardSource<JsonRecord>
  activity: DashboardSource<LocalActivitySummary>
  refreshedAt: string
}

export interface YootunDashboardDependencies {
  credentials?: Pick<CredentialProvider, 'resolve'> | undefined
  tools?: Pick<ToolRuntime, 'schemas' | 'execute'> | undefined
  sessionPersistence?: Pick<SessionPersistence, 'inspect' | 'locate'> | undefined
  dshHomePath?: ((...segments: string[]) => string) | undefined
  fetcher?: typeof fetch | undefined
  now?: (() => Date) | undefined
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

async function boundedJson(response: Response): Promise<unknown> {
  if (response.body === null) return undefined
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

function finish(res: ServerResponse, status: number, value: object): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function permitted(req: IncomingMessage, expectedOrigin: string): boolean {
  const address = req.socket.remoteAddress ?? ''
  const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
  const length = Number(req.headers['content-length'] ?? 0)
  return loopback
    && req.headers.origin === expectedOrigin
    && (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin')
    && req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
    && Number.isFinite(length)
    && length <= 2_048
}

function available<T>(status: Extract<SourceStatus, 'ready' | 'empty'>, data: T): DashboardSource<T> {
  return { status, data }
}

function unavailable<T>(
  status: Extract<SourceStatus, 'unavailable' | 'error'>,
  reason: string,
): DashboardSource<T> {
  return { status, reason }
}

function sanitizeUsage(value: unknown): JsonRecord | undefined {
  const root = record(value)
  const summary = record(root?.summary)
  const byModel = Array.isArray(root?.byModel) ? root.byModel : undefined
  if (root?.object !== 'yootun.usage_range' || typeof root.currency !== 'string'
    || summary === undefined || byModel === undefined) return undefined
  const period = record(root.period)
  const models = byModel.slice(0, 100).flatMap((item) => {
    const model = record(item)
    if (model === undefined || typeof model.model !== 'string') return []
    return [{
      model: model.model.slice(0, 160),
      requests: finite(model.requests),
      inputTokens: finite(model.inputTokens),
      outputTokens: finite(model.outputTokens),
      totalTokens: finite(model.totalTokens),
      cost: finite(model.cost),
    }]
  })
  return {
    currency: root.currency.slice(0, 8),
    period: {
      ...(typeof period?.start === 'string' ? { start: period.start.slice(0, 64) } : {}),
      ...(typeof period?.end === 'string' ? { end: period.end.slice(0, 64) } : {}),
    },
    summary: {
      requests: finite(summary.requests),
      successfulRequests: finite(summary.successfulRequests),
      inputTokens: finite(summary.inputTokens),
      outputTokens: finite(summary.outputTokens),
      totalTokens: finite(summary.totalTokens),
      cost: finite(summary.cost),
    },
    byModel: models,
  }
}

async function usageSource(
  dependencies: YootunDashboardDependencies,
  period: DashboardPeriod,
): Promise<DashboardSource<JsonRecord>> {
  if (dependencies.credentials === undefined) return unavailable('unavailable', 'credential_service_unavailable')
  let resolved
  try {
    resolved = await dependencies.credentials.resolve(MODELS_API_KEY_REF)
  } catch {
    return unavailable('error', 'credential_read_failed')
  }
  if (resolved === undefined) return unavailable('unavailable', 'model_api_key_missing')
  const url = new URL(YOOTUN_USAGE_URL)
  url.searchParams.set('start', period.start)
  url.searchParams.set('end', period.end)
  try {
    const response = await (dependencies.fetcher ?? globalThis.fetch)(url, {
      headers: { Authorization: `Bearer ${resolved.value}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 401 || response.status === 403) {
      return unavailable('unavailable', 'model_api_key_rejected')
    }
    if (!response.ok) return unavailable('error', 'usage_service_failed')
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_RESPONSE_BYTES) return unavailable('error', 'usage_response_too_large')
    const data = sanitizeUsage(await boundedJson(response))
    if (data === undefined || JSON.stringify(data).length > MAX_RESPONSE_BYTES) {
      return unavailable('error', 'usage_response_invalid')
    }
    const summary = record(data.summary)
    return available(Number(summary?.requests ?? 0) > 0 ? 'ready' : 'empty', data)
  } catch {
    return unavailable('error', 'usage_service_unreachable')
  }
}

const GEO_KEYS = [
  'tenant_id', 'filter', 'kpis', 'publication_trend', 'task_trend', 'content_funnel',
  'distribution_summary', 'top_content', 'category_distribution', 'performance',
  'latest_articles', 'task_health', 'url_import_health', 'traffic',
] as const

function sanitizeGeo(value: unknown): JsonRecord | undefined {
  const raw = record(value)
  const root = record(raw?.data) ?? raw
  if (root === undefined) return undefined
  const selected: JsonRecord = {}
  for (const key of GEO_KEYS) {
    if (root[key] !== undefined) selected[key] = root[key]
  }
  return Object.keys(selected).length > 0 ? selected : undefined
}

function parseGeoResult(result: Awaited<ReturnType<ToolRuntime['execute']>>): JsonRecord | undefined {
  if (result.isError) return undefined
  const value = record(result.value)
  const structured = sanitizeGeo(value?.structuredContent)
  if (structured !== undefined) return structured
  for (const block of result.content) {
    const item = record(block)
    if (item?.type !== 'text' || typeof item.text !== 'string' || item.text.length > MAX_RESPONSE_BYTES) continue
    try {
      const parsed = sanitizeGeo(JSON.parse(item.text))
      if (parsed !== undefined) return parsed
    } catch {
      // Continue to the next MCP content block.
    }
  }
  return undefined
}

async function geoSource(
  dependencies: YootunDashboardDependencies,
): Promise<DashboardSource<JsonRecord>> {
  if (dependencies.tools === undefined) return unavailable('unavailable', 'tool_runtime_unavailable')
  const schema = dependencies.tools.schemas().find(item =>
    item.name.startsWith('mcp__geoflow__') && item.name.includes('geoflow_analytics_overview'))
  if (schema === undefined) return unavailable('unavailable', 'geoflow_analytics_unavailable')
  try {
    const result = await dependencies.tools.execute({
      callId: ToolCallId(`yootun-dashboard-${randomUUID()}`),
      name: schema.name,
      arguments: { preset: 'yesterday' },
      signal: AbortSignal.timeout(15_000),
    })
    const data = parseGeoResult(result as Awaited<ReturnType<ToolRuntime['execute']>>)
    if (data === undefined || JSON.stringify(data).length > MAX_RESPONSE_BYTES) {
      return unavailable('error', result.isError ? 'geoflow_query_failed' : 'geoflow_response_invalid')
    }
    return available('ready', data)
  } catch {
    return unavailable('error', 'geoflow_unreachable')
  }
}

async function activitySource(
  dependencies: YootunDashboardDependencies,
  period: DashboardPeriod,
): Promise<DashboardSource<LocalActivitySummary>> {
  if (dependencies.dshHomePath === undefined || dependencies.sessionPersistence === undefined) {
    return unavailable('unavailable', 'local_session_service_unavailable')
  }
  try {
    const data = await collectLocalActivity(
      dependencies.dshHomePath('storages', 'session_projcache', 'sessions'),
      dependencies.sessionPersistence,
      period,
      AbortSignal.timeout(15_000),
    )
    return available(data.totals.sessions > 0 ? 'ready' : 'empty', data)
  } catch {
    return unavailable('error', 'local_activity_read_failed')
  }
}

export async function buildYootunDashboard(
  dependencies: YootunDashboardDependencies,
): Promise<YootunDashboardResponse> {
  const now = dependencies.now?.() ?? new Date()
  const period = yesterdayPeriod(now)
  const [geo, usage, activity] = await Promise.all([
    geoSource(dependencies),
    usageSource(dependencies, period),
    activitySource(dependencies, period),
  ])
  return { period, geo, usage, activity, refreshedAt: now.toISOString() }
}

export async function handleYootunDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  dependencies: YootunDashboardDependencies,
): Promise<void> {
  if (req.method !== 'POST') return finish(res, 405, { error: 'method_not_allowed' })
  if (!permitted(req, expectedOrigin)) return finish(res, 403, { error: 'forbidden' })
  finish(res, 200, await buildYootunDashboard(dependencies))
}
