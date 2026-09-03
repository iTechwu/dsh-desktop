// Recruiter host endpoint: the Web UI reads ranked candidates via the harness
// Tools (talent_discovery MCP). Approve/dismiss decisions stay local ("adapter
// pending") — executing outreach against candidates needs the reviewed
// desktop adapter, never a sidebar click.

const PATH = '/api/desktop/yootun/recruiter'
const MAX_CANDIDATES = 50

export const inject = ['webServer', 'tools']

const handledActions = new Map()

export function apply(ctx, config = {}) {
  // Desktop owns the shared recruiter route so its local, approval-gated
  // state and Agent tool cannot be shadowed by the live-candidate adapter.
  if (config.registerHostRoute === false) return undefined
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATH,
    async handler(req, res) {
      try {
        if (req.method === 'GET') return send(res, 200, await buildState(ctx, {}))
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
        const body = await readBody(req)
        const action = String(body.action || '')
        if (action === 'confirm_action' || action === 'dismiss_action') {
          const id = String(body.id || '').slice(0, 120)
          if (id) handledActions.set(id, { action, at: new Date().toISOString() })
          return send(res, 200, await buildState(ctx, {}))
        }
        return send(res, 400, { error: 'unknown_action' })
      } catch (error) {
        ctx.logger?.warn?.('yootun recruiter failed: %s', safeError(error))
        return send(res, 200, { status: 'error', dashboard: {}, requirements: [], candidates: [], actions: [] })
      }
    },
  }))
}

async function buildState(ctx) {
  const schema = findTool(ctx, 'talent_candidates_list')
  if (!schema) {
    return { status: 'unavailable', reason: 'talent_tool_unavailable', dashboard: {}, requirements: [], candidates: [], actions: [] }
  }
  const result = await ctx.tools.execute({
    callId: `yootun-recruiter-${Date.now()}`,
    name: schema.name,
    arguments: { limit: MAX_CANDIDATES },
  })
  const payload = parseResult(result)
  const rows = Array.isArray(payload.candidates) ? payload.candidates : []
  const candidates = rows.map(row => projectCandidate(row)).filter(Boolean)
  const actions = candidates
    .filter(candidate => candidate.stage === 'A' || candidate.stage === 'B')
    .slice(0, 5)
    .map(candidate => ({
      id: candidate.id,
      targetLabel: candidate.displayName,
      summary: `${candidate.stage} 级 · ${candidate.matchScore ?? '—'}`,
      status: handledActions.has(candidate.id) ? 'adapter_pending' : 'awaiting_confirmation',
    }))
  return {
    status: 'ready',
    dashboard: { candidates: candidates.length, pending: actions.filter(item => item.status === 'awaiting_confirmation').length },
    requirements: [],
    candidates,
    actions,
  }
}

function projectCandidate(row) {
  if (!row || typeof row !== 'object') return null
  const id = firstString(row.candidateId, row.id)
  if (!id) return null
  return {
    id,
    displayName: firstString(row.displayName, row.nickname, row.name) || id,
    stage: firstString(row.level, row.stage) || 'new',
    matchScore: numberOrNull(row.score ?? row.matchScore ?? row.intentScore),
    evidence: asStringList(row.highlights ?? row.evidence ?? row.signals),
    concerns: asStringList(row.concerns ?? row.risks),
  }
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
function asStringList(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => (typeof item === 'string' ? item : '')).filter(Boolean).slice(0, 6)
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
