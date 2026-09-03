// Supply-watch host endpoint: the Web UI reads live supplier risk signals via
// the harness Tools (supply_chain MCP). Confirm/dismiss only updates the local
// view (status "adapter pending") — mutating production supplier alert records
// requires the reviewed desktop adapter, never a sidebar click.

const PATH = '/api/desktop/yootun/supply-watch'
const MAX_ALERTS = 20
const TOOL_CALL_TIMEOUT_MS = 60_000

export const inject = ['webServer', 'tools']

const handledActions = new Map()

export function apply(ctx, config = {}) {
  if (config.registerHostRoute === false) return undefined
  return ctx.effect(() => {
    const disposers = []
    if (ctx.tools?.register) disposers.push(ctx.tools.register({
      name: 'yootun_supply_watch_overview',
      description: 'Return supplier risk signals and approval state shown by the Yootun supply-watch plugin.',
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
        if (action === 'confirm_action' || action === 'dismiss_action') {
          const id = String(body.id || '').slice(0, 120)
          if (id) handledActions.set(id, { action, at: new Date().toISOString() })
          return send(res, 200, await buildState(ctx))
        }
        return send(res, 400, { error: 'unknown_action' })
      } catch (error) {
        ctx.logger?.warn?.('yootun supply watch failed: %s', safeError(error))
        return send(res, 200, { status: 'error', dashboard: {}, risks: [], actions: [] })
      }
    },
    }))
    return () => disposers.reverse().forEach(dispose => dispose?.())
  })
}
const outputSchema = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' }, result: { type: 'object', additionalProperties: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

async function buildState(ctx, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const schema = findTool(ctx, 'supply_chain_alerts_list')
  if (!schema) {
    return { status: 'unavailable', reason: 'supply_chain_tool_unavailable', dashboard: {}, risks: [], actions: [] }
  }
  const result = await ctx.tools.execute({
    callId: `yootun-supply-${Date.now()}`,
    name: schema.name,
    arguments: { page: 1, pageSize: MAX_ALERTS },
    signal,
  })
  const payload = parseResult(result)
  const alerts = Array.isArray(payload.alerts) ? payload.alerts : []
  const risks = alerts.map(alert => projectRisk(alert)).filter(Boolean)
  const actions = alerts
    .filter(alert => String(alert.status || '').toLowerCase() === 'open')
    .map(alert => ({
      id: String(alert.alertId || ''),
      targetLabel: String(alert.supplierId || '供应商'),
      summary: `${alert.priority || 'P?'} · ${alert.status || 'open'}`,
      status: handledActions.has(String(alert.alertId)) ? 'adapter_pending' : 'awaiting_confirmation',
    }))
    .filter(item => item.id)
  const critical = risks.filter(item => item.severity === 'p0' || item.severity === 'p1' || item.severity === 'critical' || item.severity === 'high').length
  return {
    status: 'ready',
    dashboard: {
      risks: risks.length,
      critical,
      openRisks: actions.length,
      dueToday: 0,
      pending: actions.length,
    },
    risks,
    actions,
  }
}

function projectRisk(alert) {
  if (!alert || typeof alert !== 'object') return null
  const severity = String(alert.priority || '').toLowerCase()
  return {
    id: String(alert.alertId || ''),
    targetLabel: String(alert.supplierId || '供应商'),
    summary: [alert.priority, alert.status].filter(Boolean).join(' · ') || '风险信号',
    severity,
    status: String(alert.status || 'unknown'),
  }
}

function findTool(ctx, name) { return (ctx.tools.schemas?.() || []).find(item => String(item.name || '').includes(name)) }
function safeError(error) { return error instanceof Error ? error.message.slice(0, 200) : 'unknown error' }
function parseResult(result) {
  if (!result) return {}
  if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray(result.content)) {
    const text = result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
    if (!text) return {}
    try { return JSON.parse(text) } catch { return {} }
  }
  return result
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
