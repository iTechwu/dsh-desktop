const PATH = '/api/desktop/yootun/retrofit'
const MAX_QUERY = 500
export const inject = ['webServer', 'tools']
export function apply(ctx) {
  return ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PATH, async handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
    try {
      const body = await readBody(req)
      const query = String(body.query || '').trim().slice(0, MAX_QUERY)
      if (!query) return send(res, 400, { error: 'query_required' })
      const schema = (ctx.tools.schemas?.() || []).find(item => /custom.?car|retrofit|改装/i.test(String(item.name) + ' ' + String(item.description)))
      if (!schema) return send(res, 200, { status: 'unavailable', reason: 'retrofit_tool_unavailable', query })
      const result = await ctx.tools.execute({ callId: `yootun-retrofit-${Date.now()}`, name: schema.name, arguments: { query } })
      return send(res, 200, { status: 'ready', query, result: sanitize(result) })
    } catch (error) { ctx.logger?.warn?.('yootun retrofit failed: %s', error?.message || 'unknown'); return send(res, 200, { status: 'error', reason: 'retrofit_request_failed' }) }
  } }))
}
async function readBody(req) { if (typeof req.body === 'object' && req.body) return req.body; let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('body_too_large') } return raw ? JSON.parse(raw) : {} }
function sanitize(value) { if (!value || typeof value !== 'object') return value; return { content: Array.isArray(value.content) ? value.content.filter(item => item?.type === 'text').slice(0, 30) : [], isError: Boolean(value.isError) } }
function send(res, status, body) { res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
