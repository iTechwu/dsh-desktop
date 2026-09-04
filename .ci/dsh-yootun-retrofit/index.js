const PATH = '/api/desktop/yootun/retrofit'
const MAX_QUERY = 500
const TOOL_CALL_TIMEOUT_MS = 60_000
export const inject = ['webServer', 'tools']
export function apply(ctx) {
  return ctx.effect(() => {
    const disposers = []
    if (ctx.tools?.register) disposers.push(ctx.tools.register({
      name: 'yootun_retrofit_search',
      description: 'Search vehicle retrofit plans using the same projection as the Yootun retrofit plugin.',
      parameters: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', minLength: 1, maxLength: MAX_QUERY } }, required: ['query'] },
      output: outputSchema,
      isConcurrencySafe: () => true,
      async execute(args, execution) { return { ok: true, result: await search(ctx, args?.query, execution?.signal) } },
    }))
    disposers.push(ctx.webServer.register({ kind: 'exact', path: PATH, async handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
    try {
      const body = await readBody(req)
      const result = await search(ctx, body.query)
      if (result.error === 'query_required') return send(res, 400, { error: result.error })
      return send(res, 200, result)
    } catch (error) { ctx.logger?.warn?.('yootun retrofit failed: %s', error?.message || 'unknown'); return send(res, 200, { status: 'error', reason: 'retrofit_request_failed' }) }
    } }))
    return () => disposers.reverse().forEach(dispose => dispose?.())
  })
}
async function search(ctx, input, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const query = String(input || '').trim().slice(0, MAX_QUERY)
  if (!query) return { status: 'error', reason: 'query_required' }
  const schema = findSearchTool(ctx)
  if (!schema) return { status: 'unavailable', reason: 'retrofit_tool_unavailable', query }
  const result = await ctx.tools.execute({ callId: `yootun-retrofit-${Date.now()}`, name: schema.name, arguments: { query }, signal })
  return { status: 'ready', query, result: sanitize(result) }
}
const outputSchema = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' }, result: { type: 'object', additionalProperties: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
async function readBody(req) { if (typeof req.body === 'object' && req.body) return req.body; let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('body_too_large') } return raw ? JSON.parse(raw) : {} }
function findSearchTool(ctx) {
  return (ctx.tools.schemas?.() || []).find(item => {
    const name = String(item?.name || '')
    if (name === 'yootun_retrofit_search' || !name.includes('custom_car_monitoring')) return false
    const query = item?.parameters?.properties?.query
    return query?.type === 'string' || query?.anyOf?.some?.(entry => entry?.type === 'string')
  })
}
function sanitize(value) { if (!value || typeof value !== 'object') return value; return { content: Array.isArray(value.content) ? value.content.filter(item => item?.type === 'text').slice(0, 30).map(item => ({ type: 'text', text: String(item.text || '').slice(0, 20_000) })) : [], isError: Boolean(value.isError) } }
function send(res, status, body) { res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
