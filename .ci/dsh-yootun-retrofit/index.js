const PATH = '/api/desktop/yootun/retrofit'
const MAX_QUERY = 500
const TOOL_CALL_TIMEOUT_MS = 60_000
const PLATFORM_SITES = {
  'xiaohongshu-v2': 'xiaohongshu.com',
  douyin: 'douyin.com',
  kuaishou: 'kuaishou.com',
  bilibili: 'bilibili.com',
  weibo: 'weibo.com',
  toutiao: 'toutiao.com',
  lemon8: 'lemon8-app.com',
  youtube: 'youtube.com',
}
export const inject = ['webServer', 'tools', 'yootunAudit']
export function apply(ctx) {
  return ctx.effect(() => {
    const disposers = []
    if (ctx.tools?.register) disposers.push(ctx.tools.register({
      name: 'yootun_retrofit_search',
      description: 'Search vehicle retrofit plans using the same projection as the Yootun retrofit plugin.',
      parameters: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', minLength: 1, maxLength: MAX_QUERY }, platform: { type: 'string', enum: Object.keys(PLATFORM_SITES) } }, required: ['query'] },
      output: outputSchema,
      isConcurrencySafe: () => true,
      async execute(args, execution) { return { ok: true, result: await list(ctx, args || {}, execution?.signal) } },
    }))
    disposers.push(ctx.webServer.register({ kind: 'exact', path: PATH, async handler(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
    let body
    try {
      body = await readBody(req)
      const result = body.action === 'refresh' ? await refresh(ctx, body) : await list(ctx, body)
      if (result.error === 'query_required') return send(res, 400, { error: result.error })
      if (body.action === 'refresh') await recordRefreshAudit(ctx, body, result)
      return send(res, 200, result)
    } catch (error) { if (body?.action === 'refresh') await recordRefreshAudit(ctx, body, { status: 'error', reason: 'retrofit_request_failed' }); ctx.logger?.warn?.('yootun retrofit failed: %s', error?.message || 'unknown'); return send(res, 200, { status: 'error', reason: 'retrofit_request_failed' }) }
    } }))
    return () => disposers.reverse().forEach(dispose => dispose?.())
  })
}
async function search(ctx, input, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const query = String(input?.query ?? input ?? '').trim().slice(0, MAX_QUERY)
  const platform = normalizePlatform(input?.platform)
  if (!query) return { status: 'error', reason: 'query_required' }
  const target = findRefreshTarget(ctx)
  if (!target) return { status: 'unavailable', reason: 'retrofit_tool_unavailable', query }
  const publicQuery = platform ? `${query} site:${PLATFORM_SITES[platform]}` : query
  const arguments_ = target.kind === 'agent_reach'
    ? { args: ['exa', 'search', publicQuery, '--limit', '8'], timeoutMs: TOOL_CALL_TIMEOUT_MS }
    : { query }
  const result = await ctx.tools.execute({ callId: `yootun-retrofit-${Date.now()}`, name: target.schema.name, arguments: arguments_, signal })
  const projected = sanitize(result)
  if (toolResultFailed(result, projected)) {
    return { status: 'error', reason: 'retrofit_tool_failed', query, platform, source: target.kind }
  }
  return { status: 'ready', query, platform, source: target.kind, result: projected }
}
async function list(ctx, input, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const target = findStoredSearchTool(ctx)
  if (!target) return { status: 'unavailable', reason: 'retrofit_store_unavailable' }
  const query = String(input?.query || '').trim().slice(0, MAX_QUERY)
  const platform = normalizePlatform(input?.platform)
  const arguments_ = { query, platform: platform || undefined, cursor: input?.cursor || undefined, limit: Math.min(Math.max(Number(input?.limit) || 20, 1), 100) }
  const result = await ctx.tools.execute({ callId: `yootun-retrofit-list-${Date.now()}`, name: target.name, arguments: arguments_, signal })
  const stored = sanitize(result)
  // 案例库的列表、统计和详情始终以数据库为事实源；公开检索只通过显式
  // “刷新公开来源”动作进入临时参考，不得因空库自动产生额外成本或混淆数据。
  return { status: 'ready', query, platform, source: 'custom_car', dataSource: 'database', result: stored }
}
async function refresh(ctx, input, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) { return search(ctx, input, signal) }
const outputSchema = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' }, result: { type: 'object', additionalProperties: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
async function readBody(req) { if (typeof req.body === 'object' && req.body) return req.body; let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw new Error('body_too_large') } return raw ? JSON.parse(raw) : {} }
function findStoredSearchTool(ctx) {
  return (ctx.tools.schemas?.() || []).find(item => String(item?.name || '').endsWith('custom_car_monitoring_search'))
}
function findRefreshTarget(ctx) {
  const schemas = ctx.tools.schemas?.() || []
  const fallback = schemas.find(item => {
    const name = String(item?.name || '')
    return name === 'agent_reach' && item?.parameters?.properties?.args?.type === 'array'
  })
  return fallback ? { kind: 'agent_reach', schema: fallback } : null
}
function normalizePlatform(value) { const platform = String(value || '').trim(); return Object.hasOwn(PLATFORM_SITES, platform) ? platform : null }
function sanitize(value) {
  if (!value || typeof value !== 'object') return value
  if (value.structuredContent && typeof value.structuredContent === 'object') return value.structuredContent
  if (Array.isArray(value.content)) return { content: value.content.filter(item => item?.type === 'text').slice(0, 30).map(item => ({ type: 'text', text: String(item.text || '').slice(0, 20_000) })), isError: Boolean(value.isError) }
  return { ok: Boolean(value.ok), exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null, stdout: String(value.stdout || '').slice(0, 20_000), stderr: String(value.stderr || '').slice(0, 4_000) }
}
function toolResultFailed(raw, projected) {
  return raw?.isError === true || raw?.ok === false
    || (Number.isInteger(raw?.exitCode) && raw.exitCode !== 0)
    || projected?.isError === true || projected?.ok === false
    || (Number.isInteger(projected?.exitCode) && projected.exitCode !== 0)
}
async function recordRefreshAudit(ctx, input, result) {
  if (!ctx.yootunAudit?.record) return
  const payload = result?.result
  const resultCount = Array.isArray(payload?.items) ? payload.items.length : Number.isFinite(payload?.returned) ? payload.returned : 0
  const outcome = result?.status === 'ready' ? 'succeeded' : 'failed'
  const rawCode = typeof result?.reason === 'string' ? result.reason : 'retrofit_refresh_failed'
  const errorCode = /^[a-z0-9_:-]{1,80}$/u.test(rawCode) ? rawCode : 'retrofit_refresh_failed'
  try {
    await ctx.yootunAudit.record({
      actionCode: 'retrofit.public_sources.refreshed', category: 'execute',
      source: { pluginId: '@dofe/dsh-yootun-retrofit', pluginVersion: '0.1.0', surface: 'human_ui' },
      target: { type: 'retrofit_search', id: normalizePlatform(input?.platform) || 'all' }, outcome,
      changes: [{ field: 'resultCount', after: resultCount }, { field: 'source', after: result?.source || 'unavailable' }], effects: [],
      ...(outcome === 'failed' ? { errorCode } : {}),
    })
  } catch { ctx.logger?.warn?.('yootun audit record failed: audit_record_failed') }
}
function send(res, status, body) { res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
