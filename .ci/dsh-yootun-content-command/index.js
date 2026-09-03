// Content-command host endpoint: the Web UI reads live GEO content tasks via
// the harness Tools (GeoFlow MCP). "确认发布" stays a local decision ("adapter
// pending") — actually publishing content is executed by the reviewed desktop
// adapter, never directly from this queue.

const PATH = '/api/desktop/yootun/content-command'
const MAX_TASKS = 50

export const inject = ['webServer', 'tools']

const handledActions = new Map()

export function apply(ctx, config = {}) {
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
          const id = String(body.id || '').slice(0, 160)
          if (id) handledActions.set(id, { action, at: new Date().toISOString() })
          return send(res, 200, await buildState(ctx, {}))
        }
        return send(res, 400, { error: 'unknown_action' })
      } catch (error) {
        ctx.logger?.warn?.('yootun content command failed: %s', safeError(error))
        return send(res, 200, { status: 'error', dashboard: {}, briefs: [], actions: [] })
      }
    },
  }))
}

async function buildState(ctx) {
  const schema = findTool(ctx, 'geoflow_tasks_list')
  if (!schema) {
    return { status: 'unavailable', reason: 'geoflow_tool_unavailable', dashboard: {}, briefs: [], actions: [] }
  }
  const result = await ctx.tools.execute({
    callId: `yootun-content-${Date.now()}`,
    name: schema.name,
    arguments: { limit: MAX_TASKS },
  })
  const payload = parseResult(result)
  const rows = firstTaskList(payload)
  const briefs = rows.map(row => projectTask(row)).filter(Boolean)
  const published = briefs.filter(item => item.published).length
  const ready = briefs.filter(item => item.ready && !item.published).length
  const actions = briefs
    .filter(item => item.ready && !item.published)
    .slice(0, 5)
    .map(item => ({
      id: item.id,
      targetLabel: item.title,
      summary: '内容已就绪，等待发布确认',
      status: handledActions.has(item.id) ? 'adapter_pending' : 'awaiting_confirmation',
    }))
    .filter(item => item.id)
  return {
    status: 'ready',
    dashboard: {
      briefs: briefs.length,
      ready,
      published,
      dueToday: actions.filter(item => item.status === 'awaiting_confirmation').length,
    },
    briefs,
    actions,
  }
}

function firstTaskList(payload) {
  for (const key of ['tasks', 'items', 'briefs', 'list']) {
    if (Array.isArray(payload[key])) return payload[key]
  }
  return []
}

function projectTask(row) {
  if (!row || typeof row !== 'object') return null
  const id = firstString(row.id, row.taskId, row.task_id)
  const title = firstString(row.title, row.name, row.topic, row.keyword) || '内容任务'
  const status = String(row.status || row.state || '').toLowerCase()
  if (!id) return null
  return {
    id,
    title,
    status,
    published: status.includes('publish') || status.includes('released') || status === 'done' || status === 'completed',
    ready: status.includes('ready') || status.includes('approved') || status.includes('review'),
    summary: firstString(row.summary, row.description) || status || '—',
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
function firstString(...values) { for (const value of values) if (typeof value === 'string' && value) return value; return null }
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
