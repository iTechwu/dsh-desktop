/** Local GEO article review and multi-channel publishing workspace. */
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { safeYootunAuditTargetId, type YootunAuditEffect, type YootunAuditRecordInput, type YootunAuditRecorder } from './yootun-audit-contract.ts'

export const YOOTUN_CONTENT_COMMAND_PATH = '/api/desktop/yootun/content-command'
const VERSION = 2
const MAX_BODY = 64 * 1024
const MAX_STATE = 1024 * 1024
const MAX_ARTICLES = 30
const DIR_MODE = 0o700
const FILE_MODE = 0o600
const POSIX = process.platform !== 'win32'

export const CONTENT_PLATFORMS = [
  { id: 'website', name: '优惠豚官网', mode: 'system', loginRequired: false, url: 'https://yootun.ixicai.cn/media/' },
  { id: 'toutiao', name: '今日头条', mode: 'agent_web_ui', loginRequired: true, url: 'https://mp.toutiao.com/', agentSession: 'yootun-content-toutiao' },
  { id: 'baidu', name: '百度百家号', mode: 'agent_web_ui', loginRequired: true, url: 'https://baijiahao.baidu.com/', agentSession: 'yootun-content-baidu' },
  { id: 'xiaohongshu', name: '小红书', mode: 'agent_web_ui', loginRequired: true, url: 'https://creator.xiaohongshu.com/', agentSession: 'yootun-content-xiaohongshu' },
  { id: 'sohu', name: '搜狐号', mode: 'agent_web_ui', loginRequired: true, url: 'https://mp.sohu.com/', agentSession: 'yootun-content-sohu' },
] as const
export type ContentPlatformId = typeof CONTENT_PLATFORMS[number]['id']
type ReviewStatus = 'pending' | 'approved' | 'rejected'
type PlatformStatus = 'adapter_pending' | 'requires_user_login' | 'succeeded' | 'failed'
type RecordValue = Record<string, unknown>

export interface ContentDecision {
  reviewStatus: ReviewStatus
  selectedPlatforms: ContentPlatformId[]
  platformStatus: Partial<Record<ContentPlatformId, PlatformStatus>>
  reviewedAt?: string
  publishRequestedAt?: string
}
export interface ContentState { version: 2; decisions: Record<string, ContentDecision>; updatedAt: string }
export interface ContentArticle {
  id: string
  articleId: number
  title: string
  slug?: string
  status: string
  reviewStatus: ReviewStatus
  summary: string
  content: string
  contentFormat: 'markdown'
  source: 'geoflow'
  generatedAt?: string
  publishedAt?: string
  taskName?: string
  categoryName?: string
  authorName?: string
  humanize?: { status: string | null; score: number | null; classification: string | null; issues: string[]; completedAt: string | null }
  selectedPlatforms: ContentPlatformId[]
  platformStatus: Partial<Record<ContentPlatformId, PlatformStatus>>
  reviewedAt: string | null
}
interface ContentTools {
  schemas: () => Array<{ name?: unknown }>
  execute(input: ToolExecutionInput): Promise<unknown>
}

export interface ContentRouteDependencies {
  statePath: string | undefined
  tools?: ContentTools | undefined
  now?: () => Date
  openPlatformWeb?: ((platform: ContentPlatformId, url: string) => Promise<void>) | undefined
  publishWebsite?: ((article: ContentArticle) => Promise<string>) | undefined
  audit?: YootunAuditRecorder | undefined
}

class InvalidContentRequest extends Error {}
class ContentBodyTooLarge extends Error {}
const record = (value: unknown): RecordValue | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined
const exactKeys = (value: RecordValue, required: readonly string[], optional: readonly string[] = []) => { const allowed = new Set([...required, ...optional]); return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key)) }
const time = (value: unknown) => { if (typeof value !== 'string') return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined }
const positiveInteger = (value: unknown) => { const result = Number(value); if (!Number.isInteger(result) || result < 1) throw new InvalidContentRequest('article_id_invalid'); return result }
const platformId = (value: unknown): ContentPlatformId => { if (typeof value !== 'string' || !CONTENT_PLATFORMS.some(item => item.id === value)) throw new InvalidContentRequest('platform_invalid'); return value as ContentPlatformId }
const platformList = (value: unknown): ContentPlatformId[] => { if (!Array.isArray(value)) throw new InvalidContentRequest('platforms_invalid'); return [...new Set(value.map(platformId))] }
const firstString = (...values: unknown[]) => { for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim(); return undefined }
const emptyState = (now: string): ContentState => ({ version: VERSION, decisions: {}, updatedAt: now })

function parseDecision(value: unknown): ContentDecision | undefined {
  const item = record(value)
  if (!item || !exactKeys(item, ['reviewStatus', 'selectedPlatforms', 'platformStatus'], ['reviewedAt', 'publishRequestedAt'])) return undefined
  if (!['pending', 'approved', 'rejected'].includes(String(item.reviewStatus))) return undefined
  try {
    const selectedPlatforms = platformList(item.selectedPlatforms)
    const rawStatuses = record(item.platformStatus)
    if (!rawStatuses) return undefined
    const platformStatus: Partial<Record<ContentPlatformId, PlatformStatus>> = {}
    for (const [key, value] of Object.entries(rawStatuses)) {
      const id = platformId(key)
      if (!['adapter_pending', 'requires_user_login', 'succeeded', 'failed'].includes(String(value))) return undefined
      platformStatus[id] = value as PlatformStatus
    }
    const reviewedAt = item.reviewedAt === undefined ? undefined : time(item.reviewedAt)
    const publishRequestedAt = item.publishRequestedAt === undefined ? undefined : time(item.publishRequestedAt)
    if ((item.reviewedAt !== undefined && !reviewedAt) || (item.publishRequestedAt !== undefined && !publishRequestedAt)) return undefined
    return { reviewStatus: item.reviewStatus as ReviewStatus, selectedPlatforms, platformStatus, ...(reviewedAt ? { reviewedAt } : {}), ...(publishRequestedAt ? { publishRequestedAt } : {}) }
  } catch { return undefined }
}

function parseState(value: unknown): ContentState | undefined {
  const root = record(value)
  if (!root || !exactKeys(root, ['version', 'decisions', 'updatedAt']) || root.version !== VERSION || !time(root.updatedAt)) return undefined
  const source = record(root.decisions)
  if (!source || Object.keys(source).length > 1000) return undefined
  const decisions: Record<string, ContentDecision> = {}
  for (const [key, value] of Object.entries(source)) { const parsed = parseDecision(value); if (!/^\d+$/u.test(key) || !parsed) return undefined; decisions[key] = parsed }
  return { version: VERSION, decisions, updatedAt: root.updatedAt as string }
}

export async function readContentState(path: string, now = new Date().toISOString()): Promise<ContentState> {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_STATE) return emptyState(now); return parseState(JSON.parse(await readFile(path, 'utf8'))) ?? emptyState(now) } catch { return emptyState(now) }
}
async function writeState(path: string, state: ContentState) {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  const info = await lstat(dir)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('content_state_directory_invalid')
  if (POSIX) await chmod(dir, DIR_MODE)
  const json = `${JSON.stringify(state, undefined, 2)}\n`
  if (Buffer.byteLength(json) > MAX_STATE) throw new InvalidContentRequest('state_too_large')
  await writeFileAtomic(path, json, { mode: FILE_MODE, dirMode: DIR_MODE })
  if (POSIX) await chmod(path, FILE_MODE)
}

function findTool(tools: ContentTools, token: string) { return tools.schemas().find(item => String(item.name || '').includes(token))?.name as string | undefined }
function parseToolResult(result: unknown): unknown {
  const item = record(result)
  if (item && Array.isArray(item.content)) {
    const body = item.content.map(value => record(value)).filter(value => value?.type === 'text').map(value => String(value?.text || '')).join('')
    try { return JSON.parse(body) } catch { return undefined }
  }
  return result
}
async function callTool(tools: ContentTools, name: string, args: Record<string, unknown>, signal: AbortSignal) { return parseToolResult(await tools.execute({ callId: ToolCallId(`yootun-content-${Date.now()}-${Math.random().toString(16).slice(2)}`), name, arguments: args, signal })) }

async function loadArticles(state: ContentState, tools: ContentTools | undefined): Promise<ContentArticle[]> {
  if (!tools) return []
  const listTool = findTool(tools, 'geoflow_articles_list')
  const getTool = findTool(tools, 'geoflow_articles_get')
  if (!listTool || !getTool) return []
  const signal = AbortSignal.timeout(60_000)
  const listed = record(await callTool(tools, listTool, { page: 1, per_page: MAX_ARTICLES }, signal)) ?? {}
  const rows = Array.isArray(listed.items) ? listed.items : []
  return (await Promise.all(rows.map(async value => {
    const row = record(value)
    if (!row) return undefined
    let articleId: number
    try { articleId = positiveInteger(row.id) } catch { return undefined }
    let detail: RecordValue = {}
    try { detail = record(await callTool(tools, getTool, { article_id: articleId }, signal)) ?? {} } catch {}
    const merged = { ...row, ...detail }
    const local = state.decisions[String(articleId)]
    const upstreamReview = String(merged.review_status || '').toLowerCase()
    const reviewStatus: ReviewStatus = local?.reviewStatus ?? (['approved', 'auto_approved'].includes(upstreamReview) ? 'approved' : upstreamReview === 'rejected' ? 'rejected' : 'pending')
    return { id: `article:${articleId}`, articleId, title: firstString(merged.title) ?? `GEO 文章 #${articleId}`, ...(firstString(merged.slug) ? { slug: firstString(merged.slug) } : {}), status: firstString(merged.status) ?? 'draft', reviewStatus, summary: firstString(merged.excerpt, merged.meta_description) ?? '', content: typeof merged.content === 'string' ? merged.content : '', contentFormat: 'markdown' as const, source: 'geoflow' as const, ...(firstString(merged.created_at, merged.updated_at) ? { generatedAt: firstString(merged.created_at, merged.updated_at) } : {}), ...(firstString(merged.published_at) ? { publishedAt: firstString(merged.published_at) } : {}), ...(firstString(merged.task_name) ? { taskName: firstString(merged.task_name) } : {}), ...(firstString(merged.category_name) ? { categoryName: firstString(merged.category_name) } : {}), ...(firstString(merged.author_name) ? { authorName: firstString(merged.author_name) } : {}), humanize: { status: firstString(merged.humanize_status) ?? null, score: finiteNumber(merged.humanize_score), classification: firstString(merged.humanize_classification) ?? null, issues: humanizeIssues(merged.humanize_issues, 8), completedAt: firstString(merged.humanized_at) ?? null }, selectedPlatforms: local?.selectedPlatforms ?? [], platformStatus: local?.platformStatus ?? {}, reviewedAt: local?.reviewedAt ?? null } as ContentArticle
  }))).filter((item): item is NonNullable<typeof item> => item !== undefined)
}

async function snapshot(state: ContentState, tools: ContentTools | undefined) {
  if (!tools) return { status: 'unavailable', dashboard: emptyDashboard(), sources: emptySources(), platforms: CONTENT_PLATFORMS, articles: [] }
  const signal = AbortSignal.timeout(60_000)
  const [articlesResult, geoflow, georank] = await Promise.all([
    loadArticles(state, tools).then(articles => ({ status: 'ready' as const, articles })).catch(() => ({ status: 'error' as const, articles: [] as ContentArticle[] })),
    loadGeoFlowInsights(tools, signal),
    loadGeoRankInsights(tools, signal),
  ])
  const articles = articlesResult.articles
  return { status: articlesResult.status, dashboard: { articles: articles.length, pendingReview: articles.filter(item => item.reviewStatus === 'pending').length, reviewed: articles.filter(item => item.reviewStatus === 'approved').length, publishReady: articles.filter(item => item.reviewStatus === 'approved' && item.status !== 'published').length }, sources: { geoflow, georank }, platforms: CONTENT_PLATFORMS, articles }
}

const emptyDashboard = () => ({ articles: 0, pendingReview: 0, reviewed: 0, publishReady: 0 })
const sourceState = (status: 'ready' | 'empty' | 'unavailable' | 'error', reason?: string, data?: RecordValue) => ({ status, ...(reason ? { reason } : {}), ...(data ? { data } : {}) })
const emptySources = () => ({ geoflow: sourceState('unavailable'), georank: sourceState('unavailable') })
const recordList = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record).filter((item): item is RecordValue => item !== undefined) : []
const humanizeIssues = (value: unknown, max = 8): string[] => (Array.isArray(value) ? value : []).map(item => { if (typeof item === 'string') return item.trim(); const row = record(item); const text = firstString(row?.text, row?.type); const suggestion = firstString(row?.suggestion); return [text, suggestion].filter((part): part is string => Boolean(part)).join(' - ') }).filter(Boolean).slice(0, max)
const finiteNumber = (value: unknown): number | null => { if (value === null || value === undefined || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
const isYootunUrl = (value: unknown) => { try { return new URL(String(value ?? '')).hostname === 'yootun.ixicai.cn' } catch { return false } }

async function loadGeoFlowInsights(tools: ContentTools, signal: AbortSignal) {
  const overviewTool = findTool(tools, 'geoflow_analytics_overview')
  const goalsTool = findTool(tools, 'geoflow_analytics_goals')
  if (!overviewTool && !goalsTool) return sourceState('unavailable', 'geoflow_analytics_tools_unavailable')
  const [overviewResult, goalsResult] = await Promise.allSettled([
    overviewTool ? callTool(tools, overviewTool, { preset: '7d' }, signal) : Promise.resolve(undefined),
    goalsTool ? callTool(tools, goalsTool, {}, signal) : Promise.resolve(undefined),
  ])
  const overview = overviewResult.status === 'fulfilled' ? record(overviewResult.value) ?? {} : {}
  const goals = goalsResult.status === 'fulfilled' ? record(goalsResult.value) ?? {} : {}
  if (!Object.keys(overview).length && !Object.keys(goals).length) return sourceState('error', 'geoflow_analytics_unavailable')
  return sourceState('ready', undefined, {
    filter: record(overview.filter) ?? {}, kpis: record(overview.kpis) ?? {},
    publicationTrend: recordList(overview.publication_trend), contentFunnel: record(overview.content_funnel) ?? {},
    distributionSummary: record(overview.distribution_summary) ?? {}, performance: record(overview.performance) ?? {},
    taskHealth: record(overview.task_health) ?? {}, month: firstString(goals.month) ?? null, goals: recordList(goals.goals),
  })
}

async function loadGeoRankInsights(tools: ContentTools, signal: AbortSignal) {
  const historyTool = findTool(tools, 'georank_diagnostic_history')
  const companyTool = findTool(tools, 'georank_list_companies')
  if (!historyTool && !companyTool) return sourceState('unavailable', 'georank_read_tools_unavailable')
  const [historyResult, companyResult] = await Promise.allSettled([
    historyTool ? callTool(tools, historyTool, { limit: 20 }, signal) : Promise.resolve(undefined),
    companyTool ? callTool(tools, companyTool, { query: '优惠豚', page: 1, size: 10, sort: 'geo_score' }, signal) : Promise.resolve(undefined),
  ])
  if (historyResult.status === 'rejected' && companyResult.status === 'rejected') return sourceState('error', 'georank_unavailable')
  const historyValue = historyResult.status === 'fulfilled' ? historyResult.value : undefined
  const historyRoot = record(historyValue)
  const reports = (Array.isArray(historyValue) ? recordList(historyValue) : recordList(historyRoot?.items)).map(row => ({ reportId: firstString(row.report_id), url: firstString(row.url), status: firstString(row.status) ?? 'unknown', score: finiteNumber(row.overall_score), createdAt: firstString(row.created_at) ?? null })).filter(row => row.reportId && row.url && isYootunUrl(row.url)).slice(0, 8)
  const companies = recordList(record(companyResult.status === 'fulfilled' ? companyResult.value : undefined)?.items)
  const company = companies.find(row => isYootunUrl(row.url)) ?? companies[0] ?? null
  const latestReport = reports[0] ?? null
  const companyScore = finiteNumber(company?.geo_score)
  const reportScore = finiteNumber(latestReport?.score)
  return sourceState(company || reports.length ? 'ready' : 'empty', undefined, {
    score: companyScore ?? reportScore, scoreSource: companyScore !== null ? 'company' : reportScore !== null ? 'diagnostic' : null,
    company: company ? { name: firstString(company.name) ?? null, url: firstString(company.url) ?? null, certified: company.is_geo_certified === true } : null,
    latestReport, reports,
  })
}

const queues = new Map<string, Promise<void>>()
async function mutateState(path: string, update: (state: ContentState) => Promise<ContentState> | ContentState) {
  const previous = queues.get(path) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>(resolve => { release = resolve })
  const chain = previous.then(() => current)
  queues.set(path, chain)
  await previous
  try { const next = await update(await readContentState(path)); await writeState(path, next); return next } finally { release?.(); if (queues.get(path) === chain) queues.delete(path) }
}

const finish = (res: ServerResponse, status: number, value: object, allow?: string) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); if (allow) res.setHeader('Allow', allow); res.end(JSON.stringify(value)) }
async function requestBody(req: IncomingMessage) { let size = 0; const chunks: Buffer[] = []; for await (const chunk of req) { const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); size += data.byteLength; if (size > MAX_BODY) throw new ContentBodyTooLarge(); chunks.push(data) } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new InvalidContentRequest('json_invalid') } }

const CONTENT_AUDIT_SOURCE = Object.freeze({ pluginId: 'dsh-plugin-desktop/yootun-content-command', pluginVersion: '2.0.5', surface: 'human_ui' as const })

async function recordContentAudit(audit: YootunAuditRecorder | undefined, input: YootunAuditRecordInput | undefined): Promise<void> {
  if (audit === undefined || input === undefined) return
  try { await audit.record(input) } catch { /* Audit transport must never change business behavior. */ }
}

function contentAudit(body: RecordValue, articleId: number, before: ContentDecision, after: ContentDecision): YootunAuditRecordInput | undefined {
  const target = { type: 'article' as const, id: String(articleId) }
  if (body.action === 'review_article') {
    return { source: CONTENT_AUDIT_SOURCE, actionCode: 'content.review.updated', category: 'update', target, outcome: 'succeeded', changes: [{ field: 'reviewStatus', before: before.reviewStatus, after: after.reviewStatus }] }
  }
  if (body.action === 'select_platforms') {
    return { source: CONTENT_AUDIT_SOURCE, actionCode: 'content.platforms.updated', category: 'update', target, outcome: 'succeeded', changes: [{ field: 'platformCount', before: before.selectedPlatforms.length, after: after.selectedPlatforms.length }] }
  }
  if (body.action !== 'publish_selected') return undefined
  const effects: YootunAuditEffect[] = after.selectedPlatforms.map(platform => {
    const status = after.platformStatus[platform] ?? 'adapter_pending'
    return { target: platform, outcome: status === 'adapter_pending' ? 'accepted' : status }
  })
  const outcomes = effects.map(effect => effect.outcome)
  const outcome = outcomes.every(value => value === 'succeeded')
    ? 'succeeded'
    : outcomes.every(value => value === 'failed') ? 'failed'
      : outcomes.some(value => value === 'succeeded' || value === 'failed') ? 'partial' : 'accepted'
  return { source: CONTENT_AUDIT_SOURCE, actionCode: 'content.publish.executed', category: 'publish', target, outcome, changes: [{ field: 'platformCount', after: after.selectedPlatforms.length }], effects, ...(outcome === 'failed' ? { errorCode: 'publish_failed' } : {}) }
}

function failedContentMutationAudit(body: RecordValue, errorCode: string): YootunAuditRecordInput | undefined {
  const articleId = Number(body.articleId)
  const target = { type: 'article', id: safeYootunAuditTargetId(Number.isInteger(articleId) && articleId > 0 ? String(articleId) : undefined) }
  if (body.action === 'review_article') return { source: CONTENT_AUDIT_SOURCE, actionCode: 'content.review.updated', category: 'update', target, outcome: 'failed', errorCode }
  if (body.action === 'select_platforms') return { source: CONTENT_AUDIT_SOURCE, actionCode: 'content.platforms.updated', category: 'update', target, outcome: 'failed', errorCode }
  if (body.action === 'publish_selected') return { source: CONTENT_AUDIT_SOURCE, actionCode: 'content.publish.executed', category: 'publish', target, outcome: 'failed', errorCode }
  return undefined
}

export async function handleYootunContentCommandRequest(req: IncomingMessage, res: ServerResponse, rendererOrigin: string, dependencies: ContentRouteDependencies): Promise<void> {
  if (req.headers.origin && req.headers.origin !== rendererOrigin) return finish(res, 403, { error: 'origin_forbidden' })
  if (!dependencies.statePath) return finish(res, 503, { error: 'state_unavailable' })
  if (req.method === 'GET') { try { return finish(res, 200, await snapshot(await readContentState(dependencies.statePath), dependencies.tools)) } catch { return finish(res, 200, { status: 'error', dashboard: emptyDashboard(), sources: emptySources(), platforms: CONTENT_PLATFORMS, articles: [] }) } }
  if (req.method !== 'POST') return finish(res, 405, { error: 'method_not_allowed' }, 'GET, POST')
  let auditRequest: RecordValue | undefined
  try {
    const body = record(await requestBody(req))
    if (!body || typeof body.action !== 'string') throw new InvalidContentRequest('request_invalid')
    auditRequest = body
    const articleId = positiveInteger(body.articleId)
    const key = String(articleId)
    const now = (dependencies.now?.() ?? new Date()).toISOString()
    let previousDecision: ContentDecision = { reviewStatus: 'pending', selectedPlatforms: [], platformStatus: {} }
    const next = await mutateState(dependencies.statePath, async state => {
      const current = state.decisions[key] ?? { reviewStatus: 'pending', selectedPlatforms: [], platformStatus: {} }
      previousDecision = current
      if (body.action === 'review_article') {
        if (!exactKeys(body, ['action', 'articleId', 'decision'])) throw new InvalidContentRequest('request_fields_invalid')
        if (body.decision !== 'approved' && body.decision !== 'rejected') throw new InvalidContentRequest('decision_invalid')
        return { ...state, decisions: { ...state.decisions, [key]: { ...current, reviewStatus: body.decision, reviewedAt: now, selectedPlatforms: body.decision === 'approved' ? current.selectedPlatforms : [] } }, updatedAt: now }
      }
      if (current.reviewStatus !== 'approved') throw new InvalidContentRequest('article_not_approved')
      if (body.action === 'select_platforms') {
        if (!exactKeys(body, ['action', 'articleId', 'platforms'])) throw new InvalidContentRequest('request_fields_invalid')
        return { ...state, decisions: { ...state.decisions, [key]: { ...current, selectedPlatforms: platformList(body.platforms) } }, updatedAt: now }
      }
      if (body.action === 'open_platform') {
        if (!exactKeys(body, ['action', 'articleId', 'platform'])) throw new InvalidContentRequest('request_fields_invalid')
        const platform = platformId(body.platform)
        const config = CONTENT_PLATFORMS.find(item => item.id === platform)
        if (!config?.loginRequired || !dependencies.openPlatformWeb) throw new InvalidContentRequest('platform_web_unavailable')
        await dependencies.openPlatformWeb(platform, config.url)
        return { ...state, decisions: { ...state.decisions, [key]: { ...current, platformStatus: { ...current.platformStatus, [platform]: 'requires_user_login' } } }, updatedAt: now }
      }
      if (body.action === 'publish_selected') {
        if (!exactKeys(body, ['action', 'articleId', 'platforms'])) throw new InvalidContentRequest('request_fields_invalid')
        const selectedPlatforms = platformList(body.platforms)
        if (!selectedPlatforms.length) throw new InvalidContentRequest('platforms_required')
        const articles = await loadArticles(state, dependencies.tools)
        const article = articles.find(item => item.articleId === articleId)
        if (!article) throw new InvalidContentRequest('article_not_found')
        const platformStatus = { ...current.platformStatus }
        for (const platform of selectedPlatforms) {
          const config = CONTENT_PLATFORMS.find(item => item.id === platform)!
          if (platform === 'website' && dependencies.publishWebsite) {
            try { await dependencies.publishWebsite(article); platformStatus.website = 'succeeded' } catch { platformStatus.website = 'failed' }
          } else if (config.loginRequired && dependencies.openPlatformWeb) {
            await dependencies.openPlatformWeb(platform, config.url)
            platformStatus[platform] = 'requires_user_login'
          } else platformStatus[platform] = 'adapter_pending'
        }
        return { ...state, decisions: { ...state.decisions, [key]: { ...current, selectedPlatforms, platformStatus, publishRequestedAt: now } }, updatedAt: now }
      }
      throw new InvalidContentRequest('action_invalid')
    })
    const nextDecision = next.decisions[key]
    if (nextDecision !== undefined) await recordContentAudit(dependencies.audit, contentAudit(body, articleId, previousDecision, nextDecision))
    return finish(res, 200, await snapshot(next, dependencies.tools))
  } catch (cause) {
    if (auditRequest !== undefined) {
      const errorCode = cause instanceof InvalidContentRequest ? cause.message : 'state_write_failed'
      await recordContentAudit(dependencies.audit, failedContentMutationAudit(auditRequest, errorCode))
    }
    if (cause instanceof ContentBodyTooLarge) return finish(res, 413, { error: 'body_too_large' })
    if (cause instanceof InvalidContentRequest) return finish(res, ['platform_web_unavailable'].includes(cause.message) ? 503 : cause.message === 'article_not_approved' ? 409 : 400, { error: cause.message })
    return finish(res, 500, { error: 'state_write_failed' })
  }
}
