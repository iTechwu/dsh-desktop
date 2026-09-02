import { createHash } from 'node:crypto'

const PATH = '/api/desktop/yootun/lead-discovery'
const MAX_QUERY = 500
const MAX_CURSOR = 1024
const MAX_RESULT_REF = 256
const PLATFORMS = ['xiaohongshu-v2', 'douyin']
const SAFE_LEAD_FIELDS = ['leadLevel', 'platform', 'intentScore', 'aiSummary', 'city', 'budgetMin', 'budgetMax', 'purchaseTiming', 'recommendedAction', 'sourceUrl']

export const inject = ['webServer', 'tools']

export function apply(ctx) {
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATH,
    async handler(req, res) {
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
      try {
        const body = await readBody(req)
        const action = String(body.action || 'discover')
        if (action === 'discover') return handleDiscover(ctx, body, res)
        if (action === 'page') return handlePage(ctx, body, res)
        if (action === 'candidates') return handleCandidates(ctx, body, res)
        return send(res, 400, { error: 'unknown_action' })
      } catch (error) {
        ctx.logger?.warn?.('yootun lead discovery failed: %s', error?.message || 'unknown')
        return send(res, 200, { status: 'error', reason: 'lead_discovery_request_failed' })
      }
    },
  }))
}

async function handleDiscover(ctx, body, res) {
  const keyword = String(body.keyword || '').trim().slice(0, MAX_QUERY)
  const platform = normalizePlatform(body.platform)
  if (!keyword) return send(res, 400, { error: 'keyword_required' })
  const schema = findTool(ctx, 'lead_discovery_discover')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'lead_discovery_tool_unavailable', keyword, platform })
  const idempotencyKey = stableKey('discover', keyword, platform)
  const result = await ctx.tools.execute({ callId: `yootun-lead-${Date.now()}`, name: schema.name, arguments: { keyword, platform, persist: true, idempotencyKey } })
  const payload = parseResult(result)
  return send(res, 200, { status: 'ready', keyword, platform, ...pickRefs(payload), items: projectItems(payload.items), summary: pickSummary(payload) })
}

async function handlePage(ctx, body, res) {
  const resultRef = String(body.resultRef || '').trim().slice(0, MAX_RESULT_REF)
  const cursor = body.cursor ? String(body.cursor).slice(0, MAX_CURSOR) : null
  if (!resultRef) return send(res, 400, { error: 'result_ref_required' })
  const schema = findTool(ctx, 'lead_discovery_result_page_get')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'lead_discovery_tool_unavailable' })
  const result = await ctx.tools.execute({ callId: `yootun-lead-page-${Date.now()}`, name: schema.name, arguments: { resultRef, cursor } })
  const payload = parseResult(result)
  return send(res, 200, { status: 'ready', ...pickRefs(payload), items: projectItems(payload.items) })
}

async function handleCandidates(ctx, body, res) {
  const schema = findTool(ctx, 'lead_discovery_candidates_list')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'lead_discovery_tool_unavailable' })
  const levels = Array.isArray(body.levels) ? body.levels.map(value => String(value)).filter(Boolean).slice(0, 10) : null
  const args = { taskId: 'lead-discovery', limit: 100 }
  if (levels) args.levels = levels
  const result = await ctx.tools.execute({ callId: `yootun-lead-candidates-${Date.now()}`, name: schema.name, arguments: args })
  const payload = parseResult(result)
  return send(res, 200, { status: 'ready', count: typeof payload.count === 'number' ? payload.count : null, items: projectItems(payload.candidates) })
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
