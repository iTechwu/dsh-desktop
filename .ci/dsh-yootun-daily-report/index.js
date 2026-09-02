const PATH = '/api/desktop/yootun/daily-report'
const TIME_ZONE = 'Asia/Shanghai'
export const inject = ['webServer', 'sessionPersistence', 'tools']
export function apply(ctx, overrides = {}) { const now = overrides.now || (() => new Date()); return ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PATH, async handler(req, res) { if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' }); const period = yesterdayPeriod(now()); const activity = await summarize(ctx.sessionPersistence, period); send(res, 200, { period, activity, sources: capabilitySources(ctx.tools, activity), generatedAt: now().toISOString() }) } })) }
async function summarize(persistence, period) { try { const headers = await persistence.list(); const start = Date.parse(period.start); const end = Date.parse(period.end); const sessions = []; const tools = new Map(); let turns = 0; let completed = 0; let failed = 0; for (const header of headers.slice(0, 500)) { let loaded; try { loaded = await persistence.load(header.id) } catch { continue } const events = (loaded.events || []).filter(event => { const stamp = Date.parse(String(event.time || '')); return stamp >= start && stamp < end }); if (!events.length) continue; let itemTurns = 0; for (const event of events) { if (event.type === 'turn/start') { turns++; itemTurns++ }; if (event.type === 'turn/end') event.data?.reason?.kind === 'completed' ? completed++ : failed++; if (event.type === 'tool/call') { const name = String(event.data?.name || 'unknown'); tools.set(name, (tools.get(name) || 0) + 1) } } sessions.push({ title: String(header.title || '未命名会话'), workspace: workspaceName(header.cwd), turns: itemTurns }) } return { status: sessions.length ? 'ready' : 'empty', totals: { sessions: sessions.length, turns, completed, failed, toolCalls: [...tools.values()].reduce((sum, value) => sum + value, 0) }, sessions: sessions.slice(0, 50), tools: [...tools.entries()].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls) } } catch { return { status: 'unavailable', reason: 'activity_unavailable' } } }
function yesterdayPeriod(now) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value])); const today = `${parts.year}-${parts.month}-${parts.day}`; const prior = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1)); const date = prior.toISOString().slice(0, 10); return { label: '昨日', date, start: `${date}T00:00:00+08:00`, end: `${today}T00:00:00+08:00`, timeZone: TIME_ZONE } }
function workspaceName(cwd) { const parts = String(cwd || '').replaceAll('\\', '/').split('/').filter(Boolean); return parts.at(-1) || 'Default workspace' }
function capabilitySources(tools, activity) {
  const schemas = tools?.schemas?.() || []
  const status = (pattern, reason) => schemas.some(item => pattern.test(`${item.name} ${item.description || ''}`)) ? { status: 'ready' } : { status: 'unavailable', reason }
  return {
    local: { status: activity.status },
    salesIntent: status(/lead.?discovery|lead.?monitor|hotspot.?discovery|browser.?intelligence/i, 'lead_discovery_tool_unavailable'),
    retrofit: status(/custom.?car|retrofit/i, 'retrofit_tool_unavailable'),
    knowledge: status(/knowledge|memory/i, 'knowledge_tool_unavailable'),
    tools: schemas.length ? { status: 'ready' } : { status: 'unavailable', reason: 'tools_unavailable' },
  }
}
function send(res, status, body) { res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
