// GEO content review endpoint. Articles come from GeoFlow through the public
// MCP client registered in the local harness. Decisions remain local and every
// external publish requires an explicit user review and channel selection.

const PATH = '/api/desktop/yootun/content-command'
const MAX_ARTICLES = 30
const TOOL_CALL_TIMEOUT_MS = 60_000
const PLATFORM_IDS = ['website', 'toutiao', 'baidu', 'xiaohongshu', 'sohu']

export const inject = ['webServer', 'tools']

const decisions = new Map()

export function apply(ctx, config = {}) {
  if (config.registerHostRoute === false) return undefined
  return ctx.effect(() => {
    const disposers = []
    if (ctx.tools?.register) disposers.push(ctx.tools.register({
      name: 'yootun_content_overview',
      description: 'Return generated GEO articles, review decisions, and publishing channel state.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: outputSchema,
      isConcurrencySafe: () => true,
      async execute(_args, execution) { return { ok: true, result: await buildState(ctx, execution?.signal) } },
    }))
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: PATH,
      async handler(req, res) {
        try {
          if (req.method === 'GET') return send(res, 200, await buildState(ctx))
          if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
          const body = await readBody(req)
          const articleId = positiveInteger(body.articleId)
          const action = String(body.action || '')
          if (!articleId) return send(res, 400, { error: 'article_id_invalid' })
          const current = decisions.get(articleId) || { reviewStatus: 'pending', selectedPlatforms: [], platformStatus: {} }
          if (action === 'review_article') {
            const decision = String(body.decision || '')
            if (!['approved', 'rejected'].includes(decision)) return send(res, 400, { error: 'decision_invalid' })
            decisions.set(articleId, { ...current, reviewStatus: decision, reviewedAt: new Date().toISOString(), selectedPlatforms: decision === 'approved' ? current.selectedPlatforms : [] })
          } else if (action === 'select_platforms') {
            if (current.reviewStatus !== 'approved') return send(res, 409, { error: 'article_not_approved' })
            decisions.set(articleId, { ...current, selectedPlatforms: platformList(body.platforms) })
          } else if (action === 'open_platform') {
            const platform = platformId(body.platform)
            decisions.set(articleId, { ...current, platformStatus: { ...current.platformStatus, [platform]: 'requires_user_login' } })
          } else if (action === 'publish_selected') {
            if (current.reviewStatus !== 'approved') return send(res, 409, { error: 'article_not_approved' })
            const selected = platformList(body.platforms?.length ? body.platforms : current.selectedPlatforms)
            if (!selected.length) return send(res, 400, { error: 'platforms_required' })
            const platformStatus = { ...current.platformStatus }
            for (const platform of selected) platformStatus[platform] = platform === 'website' ? 'adapter_pending' : 'requires_user_login'
            decisions.set(articleId, { ...current, selectedPlatforms: selected, platformStatus, publishRequestedAt: new Date().toISOString() })
          } else {
            return send(res, 400, { error: 'unknown_action' })
          }
          return send(res, 200, await buildState(ctx))
        } catch (error) {
          ctx.logger?.warn?.('yootun content command failed: %s', safeError(error))
          return send(res, 200, emptyState('error'))
        }
      },
    }))
    return () => disposers.reverse().forEach(dispose => dispose?.())
  })
}

const outputSchema = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' }, result: { type: 'object', additionalProperties: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

async function buildState(ctx, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const listTool = findTool(ctx, 'geoflow_articles_list')
  const getTool = findTool(ctx, 'geoflow_articles_get')
  const [geoflow, georank] = await Promise.all([loadGeoFlowInsights(ctx, signal), loadGeoRankInsights(ctx, signal)])
  if (!listTool || !getTool) return { ...emptyState('unavailable', 'geoflow_article_tools_unavailable'), sources: { geoflow, georank } }
  let articles = []
  try {
    const listed = asRecord(parseResult(await execute(ctx, listTool.name, { page: 1, per_page: MAX_ARTICLES }, signal)))
    const rows = Array.isArray(listed.items) ? listed.items : []
    articles = (await Promise.all(rows.map(async row => {
      const articleId = positiveInteger(row?.id)
      if (!articleId) return null
      try {
        const detail = asRecord(parseResult(await execute(ctx, getTool.name, { article_id: articleId }, signal)))
        return projectArticle({ ...row, ...detail })
      } catch (error) {
        ctx.logger?.warn?.('yootun content article %s failed: %s', articleId, safeError(error))
        return projectArticle(row)
      }
    }))).filter(Boolean)
  } catch (error) {
    ctx.logger?.warn?.('yootun content articles failed: %s', safeError(error))
    return { ...emptyState('error', 'geoflow_articles_unavailable'), sources: { geoflow, georank } }
  }
  const reviewed = articles.filter(item => item.reviewStatus === 'approved').length
  const publishReady = articles.filter(item => item.reviewStatus === 'approved' && item.status !== 'published').length
  return {
    status: 'ready',
    dashboard: { articles: articles.length, pendingReview: articles.filter(item => item.reviewStatus === 'pending').length, reviewed, publishReady },
    sources: { geoflow, georank },
    platforms: platformCatalog(),
    articles,
  }
}

async function loadGeoFlowInsights(ctx, signal) {
  const overviewTool = findTool(ctx, 'geoflow_analytics_overview')
  const goalsTool = findTool(ctx, 'geoflow_analytics_goals')
  if (!overviewTool && !goalsTool) return sourceState('unavailable', 'geoflow_analytics_tools_unavailable')
  const [overviewResult, goalsResult] = await Promise.allSettled([
    overviewTool ? execute(ctx, overviewTool.name, { preset: '7d' }, signal) : Promise.resolve(null),
    goalsTool ? execute(ctx, goalsTool.name, {}, signal) : Promise.resolve(null),
  ])
  const overview = overviewResult.status === 'fulfilled' ? asRecord(parseResult(overviewResult.value)) : {}
  const goals = goalsResult.status === 'fulfilled' ? asRecord(parseResult(goalsResult.value)) : {}
  if (!Object.keys(overview).length && !Object.keys(goals).length) return sourceState('error', 'geoflow_analytics_unavailable')
  return sourceState('ready', null, {
    filter: asRecord(overview.filter),
    kpis: asRecord(overview.kpis),
    publicationTrend: recordList(overview.publication_trend),
    contentFunnel: asRecord(overview.content_funnel),
    distributionSummary: asRecord(overview.distribution_summary),
    performance: asRecord(overview.performance),
    taskHealth: asRecord(overview.task_health),
    month: firstString(goals.month),
    goals: recordList(goals.goals),
  })
}

async function loadGeoRankInsights(ctx, signal) {
  const historyTool = findTool(ctx, 'georank_diagnostic_history')
  const companyTool = findTool(ctx, 'georank_list_companies')
  if (!historyTool && !companyTool) return sourceState('unavailable', 'georank_read_tools_unavailable')
  const [historyResult, companyResult] = await Promise.allSettled([
    historyTool ? execute(ctx, historyTool.name, { limit: 20 }, signal) : Promise.resolve(null),
    companyTool ? execute(ctx, companyTool.name, { query: '优惠豚', page: 1, size: 10, sort: 'geo_score' }, signal) : Promise.resolve(null),
  ])
  const historyValue = historyResult.status === 'fulfilled' ? parseResult(historyResult.value) : null
  const companyValue = companyResult.status === 'fulfilled' ? asRecord(parseResult(companyResult.value)) : {}
  if (historyResult.status === 'rejected' && companyResult.status === 'rejected') return sourceState('error', 'georank_unavailable')
  const reports = (Array.isArray(historyValue) ? historyValue : recordList(asRecord(historyValue).items))
    .map(projectReport).filter(Boolean).filter(item => isYootunUrl(item.url)).slice(0, 8)
  const companies = recordList(companyValue.items)
  const company = companies.find(item => isYootunUrl(firstString(item.url))) || companies[0] || null
  const latestReport = reports[0] || null
  const companyScore = finiteNumber(company?.geo_score)
  const reportScore = finiteNumber(latestReport?.score)
  const data = {
    score: companyScore ?? reportScore,
    scoreSource: companyScore !== null ? 'company' : reportScore !== null ? 'diagnostic' : null,
    company: company ? { name: firstString(company.name), url: firstString(company.url), certified: company.is_geo_certified === true } : null,
    latestReport,
    reports,
  }
  return sourceState(company || reports.length ? 'ready' : 'empty', null, data)
}

function projectArticle(row) {
  if (!row || typeof row !== 'object') return null
  const articleId = positiveInteger(row.id)
  if (!articleId) return null
  const local = decisions.get(articleId) || {}
  const upstreamReview = String(row.review_status || '').toLowerCase()
  const reviewStatus = local.reviewStatus || (['approved', 'auto_approved'].includes(upstreamReview) ? 'approved' : upstreamReview === 'rejected' ? 'rejected' : 'pending')
  return {
    id: `article:${articleId}`,
    articleId,
    title: firstString(row.title) || `GEO 文章 #${articleId}`,
    slug: firstString(row.slug),
    status: firstString(row.status) || 'draft',
    reviewStatus,
    summary: firstString(row.excerpt, row.meta_description) || '',
    content: typeof row.content === 'string' ? row.content : '',
    contentFormat: 'markdown',
    source: 'geoflow',
    generatedAt: firstString(row.created_at, row.updated_at),
    publishedAt: firstString(row.published_at),
    taskName: firstString(row.task_name),
    categoryName: firstString(row.category_name),
    authorName: firstString(row.author_name),
    humanize: {
      status: firstString(row.humanize_status),
      score: finiteNumber(row.humanize_score),
      classification: firstString(row.humanize_classification),
      issues: humanizeIssues(row.humanize_issues, 8),
      completedAt: firstString(row.humanized_at),
    },
    selectedPlatforms: Array.isArray(local.selectedPlatforms) ? local.selectedPlatforms : [],
    platformStatus: local.platformStatus || {},
    reviewedAt: local.reviewedAt || null,
  }
}

function platformCatalog() {
  return [
    { id: 'website', name: '优惠豚官网', mode: 'system', loginRequired: false, url: 'https://yootun.ixicai.cn/media/' },
    { id: 'toutiao', name: '今日头条', mode: 'agent_web_ui', loginRequired: true, url: 'https://mp.toutiao.com/', agentSession: 'yootun-content-toutiao' },
    { id: 'baidu', name: '百度百家号', mode: 'agent_web_ui', loginRequired: true, url: 'https://baijiahao.baidu.com/', agentSession: 'yootun-content-baidu' },
    { id: 'xiaohongshu', name: '小红书', mode: 'agent_web_ui', loginRequired: true, url: 'https://creator.xiaohongshu.com/', agentSession: 'yootun-content-xiaohongshu' },
    { id: 'sohu', name: '搜狐号', mode: 'agent_web_ui', loginRequired: true, url: 'https://mp.sohu.com/', agentSession: 'yootun-content-sohu' },
  ]
}

function emptyState(status, reason) { return { status, ...(reason ? { reason } : {}), dashboard: { articles: 0, pendingReview: 0, reviewed: 0, publishReady: 0 }, sources: { geoflow: sourceState('unavailable'), georank: sourceState('unavailable') }, platforms: platformCatalog(), articles: [] } }
function findTool(ctx, name) { return (ctx.tools.schemas?.() || []).find(item => String(item.name || '').includes(name)) }
async function execute(ctx, name, arguments_, signal) { return ctx.tools.execute({ callId: `yootun-content-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, arguments: arguments_, signal }) }
function parseResult(result) {
  if (!result) return {}
  if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray(result.content)) {
    const text = result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
    if (!text) return {}
    try { return JSON.parse(text) } catch { return null }
  }
  return result
}
function sourceState(status, reason, data) { return { status, ...(reason ? { reason } : {}), ...(data ? { data } : {}) } }
function asRecord(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function recordList(value) { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [] }
function humanizeIssues(value, max = 8) { return (Array.isArray(value) ? value : []).map(item => { if (typeof item === 'string') return item.trim(); const row = asRecord(item); const text = firstString(row.text, row.type); const suggestion = firstString(row.suggestion); return [text, suggestion].filter(Boolean).join(' - ') }).filter(Boolean).slice(0, max) }
function finiteNumber(value) { if (value === null || value === undefined || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
function projectReport(value) { const row = asRecord(value); const reportId = firstString(row.report_id); const url = firstString(row.url); if (!reportId || !url) return null; return { reportId, url, status: firstString(row.status) || 'unknown', score: finiteNumber(row.overall_score), createdAt: firstString(row.created_at) } }
function isYootunUrl(value) { try { return new URL(String(value || '')).hostname === 'yootun.ixicai.cn' } catch { return false } }
function positiveInteger(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null }
function platformId(value) { const id = String(value || ''); if (!PLATFORM_IDS.includes(id)) throw new Error('platform_invalid'); return id }
function platformList(value) { return [...new Set((Array.isArray(value) ? value : []).map(platformId))] }
function firstString(...values) { for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim(); return null }
function safeError(error) { return error instanceof Error ? error.message.slice(0, 200) : 'unknown error' }
async function readBody(req) {
  if (typeof req.body === 'object' && req.body) return req.body
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 65536) throw new Error('body_too_large') }
  return raw ? JSON.parse(raw) : {}
}
function send(res, status, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
