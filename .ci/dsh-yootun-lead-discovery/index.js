import { createHash } from 'node:crypto'

const PATH = '/api/desktop/yootun/lead-discovery'
const MAX_QUERY = 500
const MAX_CURSOR = 1024
const MAX_RESULT_REF = 256
const TOOL_CALL_TIMEOUT_MS = 60_000
const PLATFORMS = ['xiaohongshu-v2', 'douyin']
const SAFE_LEAD_FIELDS = ['leadLevel', 'platform', 'intentScore', 'aiSummary', 'city', 'budgetMin', 'budgetMax', 'purchaseTiming', 'recommendedAction', 'sourceUrl']

export const inject = ['webServer', 'tools']

export function apply(ctx) {
  return ctx.effect(() => {
    const disposers = []
    if (ctx.tools?.register) {
      disposers.push(ctx.tools.register({
        name: 'yootun_lead_discovery',
        description: 'Discover public lead signals and return the safe projected output used by the Yootun plugin.',
        parameters: { type: 'object', additionalProperties: false, properties: { keyword: { type: 'string', minLength: 1, maxLength: MAX_QUERY }, platform: { type: 'string', maxLength: 80 } }, required: ['keyword'] },
        output: outputSchema,
        isConcurrencySafe: () => true,
        async execute(args, execution) { return { ok: true, result: await discover(ctx, args || {}, execution?.signal) } },
      }))
      disposers.push(ctx.tools.register({
        name: 'yootun_lead_discovery_candidates',
        description: 'List persisted lead-discovery candidates using the Yootun plugin projection.',
        parameters: { type: 'object', additionalProperties: false, properties: { levels: { type: 'array', items: { type: 'string' }, maxItems: 10 } } },
        output: outputSchema,
        isConcurrencySafe: () => true,
        async execute(args, execution) { return { ok: true, result: await candidates(ctx, args || {}, execution?.signal) } },
      }))
    }
    disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: PATH,
    async handler(req, res) {
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
      try {
        const body = await readBody(req)
        const action = String(body.action || 'discover')
        // 文本标注：必须等待异步 action，让外层 catch 能把工具异常转换为完整 JSON 响应。
        if (action === 'discover') return await handleDiscover(ctx, body, res)
        if (action === 'page') return await handlePage(ctx, body, res)
        if (action === 'candidates') return await handleCandidates(ctx, body, res)
        return send(res, 400, { error: 'unknown_action' })
      } catch (error) {
        const reason = safeToolErrorReason(error)
        ctx.logger?.warn?.('yootun lead discovery failed: %s', reason)
        return send(res, 200, { status: 'error', reason })
      }
    },
    }))
    return () => disposers.reverse().forEach(dispose => dispose?.())
  })
}
const outputSchema = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' }, result: { type: 'object', additionalProperties: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

async function handleDiscover(ctx, body, res) {
  const result = await discover(ctx, body)
  return send(res, result.error === 'keyword_required' ? 400 : 200, result)
}

async function discover(ctx, body, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const keyword = String(body.keyword || '').trim().slice(0, MAX_QUERY)
  const platform = normalizePlatform(body.platform)
  if (!keyword) return { error: 'keyword_required' }
  const schema = findTool(ctx, 'lead_discovery_discover')
  if (!schema) return { status: 'unavailable', reason: 'lead_discovery_tool_unavailable', keyword, platform }
  const idempotencyKey = stableKey('discover', keyword, platform)
  const result = await ctx.tools.execute({ callId: `yootun-lead-${Date.now()}`, name: schema.name, arguments: { keyword, platform, persist: true, idempotencyKey }, signal })
  const payload = parseResult(result)
  const items = projectItems(payload.items)
  const refs = pickRefs(payload)
  return { status: 'ready', keyword, platform, ...refs, items, stats: summarizeItems(items, refs.totalAvailable), summary: pickSummary(payload) }
}

async function handlePage(ctx, body, res, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const resultRef = String(body.resultRef || '').trim().slice(0, MAX_RESULT_REF)
  const cursor = body.cursor ? String(body.cursor).slice(0, MAX_CURSOR) : null
  if (!resultRef) return send(res, 400, { error: 'result_ref_required' })
  const schema = findTool(ctx, 'lead_discovery_result_page_get')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'lead_discovery_tool_unavailable' })
  const result = await ctx.tools.execute({ callId: `yootun-lead-page-${Date.now()}`, name: schema.name, arguments: { resultRef, cursor }, signal })
  const payload = parseResult(result)
  const items = projectItems(payload.items)
  const refs = pickRefs(payload)
  return send(res, 200, { status: 'ready', ...refs, items, stats: summarizeItems(items, refs.totalAvailable) })
}

async function handleCandidates(ctx, body, res) {
  const result = await candidates(ctx, body)
  return send(res, 200, result)
}

async function candidates(ctx, body, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const schema = findTool(ctx, 'lead_discovery_candidates_list')
  if (!schema) return { status: 'unavailable', reason: 'lead_discovery_tool_unavailable' }
  const levels = Array.isArray(body.levels) ? body.levels.map(value => String(value)).filter(Boolean).slice(0, 10) : null
  const args = { taskId: 'lead-discovery', limit: 100 }
  if (levels) args.levels = levels
  const result = await ctx.tools.execute({ callId: `yootun-lead-candidates-${Date.now()}`, name: schema.name, arguments: args, signal })
  const payload = parseResult(result)
  const items = projectItems(payload.candidates)
  return { status: 'ready', count: typeof payload.count === 'number' ? payload.count : null, items, stats: summarizeItems(items, payload?.count) }
}

function findTool(ctx, name) { return (ctx.tools.schemas?.() || []).find(item => String(item.name || '').includes(name)) }
function normalizePlatform(value) { const platform = String(value || '').trim(); return PLATFORMS.includes(platform) ? platform : PLATFORMS[0] }
function stableKey(scope, keyword, platform) { return createHash('sha256').update(`${scope}:${keyword}:${platform}`).digest('hex').slice(0, 40) }
function parseResult(result) {
  if (!result) return {}
  if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray(result.content)) {
    const text = result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
    if (!text) return {}
    try { return JSON.parse(text) } catch { return {} }
  }
  return result
}
function pickRefs(payload) {
  const refs = (payload && typeof payload.references === 'object' && payload.references) || {}
  return {
    resultRef: firstString(refs.resultRef, payload?.resultRef),
    nextCursor: firstString(refs.nextCursor, payload?.nextCursor),
    hasMore: refs.hasMore ?? payload?.hasMore ?? false,
    totalAvailable: numberOrNull(refs.totalAvailable ?? payload?.totalAvailable),
    retrievedAt: firstString(refs.retrievedAt, payload?.retrievedAt),
  }
}
function pickSummary(payload) {
  const summary = (payload && typeof payload.summary === 'object' && payload.summary) || {}
  const persisted = (summary.persisted && typeof summary.persisted === 'object') ? { inserted: numberOrNull(summary.persisted.inserted), updated: numberOrNull(summary.persisted.updated) } : null
  return { code: payload?.status?.code ?? null, keyword: firstString(summary.keyword), platform: firstString(summary.platform), persisted }
}
// 文本标注：统计只使用已投影的安全字段，避免把原文、内部 ID 或联系方式带到客户端。
function summarizeItems(items, totalAvailable = null) {
  const levels = { A: 0, B: 0, C: 0, D: 0 }
  const platforms = new Map()
  const cities = new Map()
  let intentTotal = 0
  let intentCount = 0
  let withAction = 0
  for (const item of Array.isArray(items) ? items : []) {
    const level = String(item?.leadLevel || '').toUpperCase()
    if (Object.prototype.hasOwnProperty.call(levels, level)) levels[level] += 1
    if (item?.platform) platforms.set(String(item.platform), (platforms.get(String(item.platform)) || 0) + 1)
    if (item?.city) cities.set(String(item.city), (cities.get(String(item.city)) || 0) + 1)
    const score = Number(item?.intentScore)
    if (Number.isFinite(score)) { intentTotal += score; intentCount += 1 }
    if (item?.recommendedAction) withAction += 1
  }
  const rank = entries => entries.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 6)
  return {
    total: Array.isArray(items) ? items.length : 0,
    totalAvailable: numberOrNull(totalAvailable),
    highIntent: levels.A,
    avgIntent: intentCount ? Math.round(intentTotal / intentCount) : null,
    withAction,
    platformCount: platforms.size,
    cityCount: cities.size,
    levels,
    platforms: rank([...platforms].map(([key, count]) => ({ key, count }))),
    cities: rank([...cities].map(([key, count]) => ({ key, count }))),
  }
}
function projectItems(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) { const projected = projectLead(item); if (projected) out.push(projected); if (out.length >= 100) break }
  return out
}
function projectLead(item) {
  if (!item || typeof item !== 'object') return null
  const out = {}
  for (const field of SAFE_LEAD_FIELDS) if (item[field] !== null && item[field] !== undefined) out[field] = item[field]
  return out.leadLevel ? out : null
}
function firstString(...values) { for (const value of values) if (typeof value === 'string' && value) return value; return null }
function numberOrNull(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function safeToolErrorReason(error) {
  const allowed = new Set(['CONFLICT', 'INTERNAL_ERROR', 'NOT_FOUND', 'PROVIDER_ERROR', 'RESULT_REF_UNAVAILABLE', 'RESULT_STORE_UNAVAILABLE', 'VALIDATION_ERROR'])
  const message = error && typeof error.message === 'string' ? error.message : ''
  try {
    const payload = JSON.parse(message)
    const code = payload?.error?.code
    if (allowed.has(code)) return code
  } catch {}
  return allowed.has(message) ? message : 'lead_discovery_request_failed'
}
async function readBody(req) {
  if (typeof req.body === 'object' && req.body) return req.body
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('body_too_large') }
  return raw ? JSON.parse(raw) : {}
}
function send(res, status, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
