// Sales host endpoint: the Web UI fetches live public-intent discovery through
// the harness Tools (lead_discovery MCP). The user's MODELS_API_KEY travels
// inside the harness tool execution; this route never sees or returns it.

import { createHash } from 'node:crypto'

const PATH = '/api/desktop/yootun/sales'
const MAX_QUERY = 500
const MAX_ITEMS = 30

export const inject = ['webServer', 'tools']

// Confirmed/dismissed decisions live for the process lifetime; the desktop
// adapter is the component that eventually executes or persists them.
const handledActions = new Map()

export function apply(ctx) {
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATH,
    async handler(req, res) {
      try {
        if (req.method === 'GET') return send(res, 200, await buildState(ctx, {}))
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
        const body = await readBody(req)
        const action = String(body.action || '')
        if (action === 'intent_search') {
          const intent = await runIntentSearch(ctx, body)
          return send(res, 200, await buildState(ctx, { intent }))
        }
        if (action === 'confirm_action' || action === 'dismiss_action') {
          const id = String(body.id || '').slice(0, 120)
          if (id) handledActions.set(id, { action, at: new Date().toISOString() })
          return send(res, 200, await buildState(ctx, {}))
        }
        return send(res, 400, { error: 'unknown_action' })
      } catch (error) {
        ctx.logger?.warn?.('yootun sales failed: %s', safeError(error))
        return send(res, 200, { status: 'error', dashboard: {}, leads: [], actions: [], intent: { status: 'error' } })
      }
    },
  }))
}

async function buildState(ctx, { intent }) {
  const leads = intent?.items || lastIntent?.items || []
  const actions = (intent?.items || lastIntent?.items || []).slice(0, 5).map((item, index) => {
    const id = `intent-${index}`
    const handled = handledActions.get(id)
    return {
      id,
      summary: firstString(item.topic, item.sourceUrl, '公开意向线索'),
      channel: firstString(item.platform, 'xiaohongshu-v2'),
      status: handled ? (handled.action === 'confirm_action' ? 'adapter_pending' : 'dismissed') : 'awaiting_confirmation',
    }
  }).filter(item => item.status !== 'dismissed')
  const pending = actions.filter(item => item.status === 'awaiting_confirmation').length
  return {
    status: 'ready',
    dashboard: { leads: leads.length, qualified: leads.length, dueToday: pending, pending },
    leads,
    actions,
    intent: intent || lastIntent || null,
  }
}

async function runIntentSearch(ctx, body) {
  const query = String(body.query || '').trim().slice(0, MAX_QUERY)
  if (!query) return { status: 'error', reason: 'query_required', items: [] }
  const schema = findTool(ctx, 'lead_discovery_discover')
  if (!schema) return { status: 'unavailable', reason: 'lead_discovery_tool_unavailable', items: [] }
  const platform = firstString(body.platform, 'xiaohongshu-v2')
  const result = await ctx.tools.execute({
    callId: `yootun-sales-${Date.now()}`,
    name: schema.name,
    arguments: { keyword: query, platform, persist: true, idempotencyKey: stableKey('sales-intent', query, platform) },
  })
  const payload = parseResult(result)
  const items = projectItems(payload.items)
  lastIntent = { status: 'ready', query, items }
  return lastIntent
}

let lastIntent = null

function projectItems(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const confidence = numberOrNull(item.intentScore)
    out.push({
      topic: firstString(item.aiSummary, item.city, item.recommendedAction) || '公开讨论',
      platform: firstString(item.platform) || 'xiaohongshu-v2',
      sourceUrl: firstString(item.sourceUrl) || '',
      intentSignals: [item.recommendedAction, item.purchaseTiming, item.city, item.leadLevel ? `意向等级 ${item.leadLevel}` : null]
        .filter(value => typeof value === 'string' && value).slice(0, 4),
      confidence: confidence === null ? undefined : (confidence > 1 ? Math.min(confidence / 100, 1) : confidence),
    })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

function findTool(ctx, name) { return (ctx.tools.schemas?.() || []).find(item => String(item.name || '').includes(name)) }
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
