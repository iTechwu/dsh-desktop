// Approvals host endpoint: a single human-confirmation queue for high-risk
// actions surfaced by the other Yootun plugins. Live candidates come from the
// harness Tools (supply-chain alerts + talent candidates). Approve/dismiss
// only records the local decision ("adapter pending") — production mutations
// stay with the reviewed desktop adapter.

const PATH = '/api/desktop/yootun/approvals'
const MAX_ALERTS = 20
const MAX_CANDIDATES = 50
const TOOL_CALL_TIMEOUT_MS = 60_000

export const inject = ['webServer', 'tools']

const decisions = new Map()

export function apply(ctx, config = {}) {
  if (config.registerHostRoute === false) return undefined
  return ctx.effect(() => {
    const disposers = []
    if (ctx.tools?.register) disposers.push(ctx.tools.register({
      name: 'yootun_approvals_overview',
      description: 'Return the pending human-confirmation queue shown by the Yootun approvals plugin.',
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
        const action = String(body.action || '')
        if (action === 'confirm' || action === 'dismiss') {
          const id = String(body.id || '').slice(0, 160)
          if (id) decisions.set(id, { action, at: new Date().toISOString() })
          return send(res, 200, await buildState(ctx))
        }
        return send(res, 400, { error: 'unknown_action' })
      } catch (error) {
        ctx.logger?.warn?.('yootun approvals failed: %s', safeError(error))
        return send(res, 200, { status: 'error', dashboard: {}, actions: [] })
      }
    },
    }))
    return () => disposers.reverse().forEach(dispose => dispose?.())
  })
}
const outputSchema = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' }, result: { type: 'object', additionalProperties: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

async function buildState(ctx, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const [supply, talent] = await Promise.all([
    loadSupplyActions(ctx, signal),
    loadTalentActions(ctx, signal),
  ])
  const actions = [...supply.actions, ...talent.actions].map(item => decorate(item))
  const confirmed = [...decisions.values()].filter(entry => entry.action === 'confirm').length
  const dismissed = [...decisions.values()].filter(entry => entry.action === 'dismiss').length
  const status = supply.status === 'ready' || talent.status === 'ready'
    ? 'ready'
    : supply.unavailable && talent.unavailable
      ? 'unavailable'
      : 'error'
  return {
    status,
    dashboard: { pending: actions.filter(item => item.status === 'awaiting_confirmation').length, confirmed, dismissed },
    actions,
  }
}

async function loadSupplyActions(ctx, signal) {
  const schema = findTool(ctx, 'supply_chain_alerts_list')
  if (!schema) return { status: 'unavailable', unavailable: true, actions: [] }
  try {
    const result = await ctx.tools.execute({
      callId: `yootun-approvals-supply-${Date.now()}`,
      name: schema.name,
      arguments: { page: 1, pageSize: MAX_ALERTS },
      signal,
    })
    const payload = parseResult(result)
    const alerts = Array.isArray(payload.alerts) ? payload.alerts : []
    const actions = alerts
      .filter(alert => String(alert.status || '').toLowerCase() === 'open')
      .map(alert => ({
        id: `supply-watch:${alert.alertId}`,
        targetLabel: String(alert.supplierId || '供应商'),
        summary: `${alert.priority || 'P?'} 告警待复核`,
        source: 'supply-watch',
        risk: String(alert.priority || 'P?'),
        upstreamId: String(alert.alertId || ''),
      }))
    return { status: 'ready', actions }
  } catch (error) {
    ctx.logger?.warn?.('yootun approvals: supply alerts failed: %s', safeError(error))
    return { status: 'error', actions: [] }
  }
}

async function loadTalentActions(ctx, signal) {
  const schema = findTool(ctx, 'talent_candidates_list')
  if (!schema) return { status: 'unavailable', unavailable: true, actions: [] }
  try {
    const result = await ctx.tools.execute({
      callId: `yootun-approvals-talent-${Date.now()}`,
      name: schema.name,
      arguments: { limit: MAX_CANDIDATES },
      signal,
    })
    const payload = parseResult(result)
    const rows = Array.isArray(payload.candidates) ? payload.candidates : []
    const actions = rows
      .map(row => projectCandidate(row))
      .filter(candidate => candidate && (candidate.stage === 'A' || candidate.stage === 'B'))
      .slice(0, 5)
      .map(candidate => ({
        id: `recruiter:${candidate.id}`,
        targetLabel: candidate.displayName,
        summary: `${candidate.stage} 级候选 · 触达需确认`,
        source: 'recruiter',
        risk: candidate.stage,
        upstreamId: candidate.id,
      }))
    return { status: 'ready', actions }
  } catch (error) {
    ctx.logger?.warn?.('yootun approvals: talent candidates failed: %s', safeError(error))
    return { status: 'error', actions: [] }
  }
}

function decorate(item) {
  const decision = decisions.get(item.id)
  return {
    id: item.id,
    targetLabel: item.targetLabel,
    summary: item.summary,
    source: item.source,
    risk: item.risk,
    status: decision ? (decision.action === 'confirm' ? 'adapter_pending' : 'dismissed') : 'awaiting_confirmation',
  }
}

function projectCandidate(row) {
  if (!row || typeof row !== 'object') return null
  const id = firstString(row.candidateId, row.id)
  if (!id) return null
  return { id, displayName: firstString(row.displayName, row.nickname, row.name) || id, stage: firstString(row.level, row.stage) || 'new' }
}

function findTool(ctx, name) { return (ctx.tools.schemas?.() || []).find(item => String(item.name || '').includes(name)) }
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
function safeError(error) { return error instanceof Error ? error.message.slice(0, 200) : 'unknown error' }
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
