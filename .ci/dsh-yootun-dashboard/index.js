const DASHBOARD_PATH = '/api/desktop/yootun/dashboard/yesterday'
const MCP_GEOFLOW_URL = 'https://ixicai.cn/mcp/geoflow'
const MODELS_USAGE_URL = 'https://ixicai.cn/api/v1/yootun/usage'
const TIME_ZONE = 'Asia/Shanghai'
const REQUEST_TIMEOUT_MS = 20000
const MAX_ACTIVITY_SESSIONS = 500

export const inject = ['webServer', 'credentials', 'sessionPersistence', 'tools']

export function apply(ctx, overrides = {}) {
  const fetchImpl = overrides.fetch || globalThis.fetch
  const now = overrides.now || (() => new Date())
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DASHBOARD_PATH,
    async handler(req, res) {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' })
        res.end()
        return
      }

      const period = yesterdayPeriod(now())
      const credential = await resolveModelsKey(ctx)
      const [geo, usage, activity] = await Promise.all([
        loadGeo(fetchImpl, credential, ctx.logger),
        loadUsage(fetchImpl, credential, period, ctx.logger),
        loadActivity(ctx.sessionPersistence, period, ctx.logger),
      ])
      sendJson(res, 200, { period, geo, usage, activity, capabilities: capabilitySources(ctx.tools), refreshedAt: now().toISOString() })
    },
  }))
}

function capabilitySources(tools) {
  const schemas = tools?.schemas?.() || []
  const state = (pattern, reason) => schemas.some(item => pattern.test(`${item.name} ${item.description || ''}`))
    ? { status: 'ready' }
    : { status: 'unavailable', reason }
  return {
    tools: schemas.length ? { status: 'ready' } : { status: 'unavailable', reason: 'tools_unavailable' },
    knowledge: state(/knowledge/i, 'knowledge_tool_unavailable'),
    memory: state(/memory/i, 'memory_tool_unavailable'),
    georank: state(/georank/i, 'georank_tool_unavailable'),
    openmontage: state(/montage/i, 'openmontage_tool_unavailable'),
  }
}

async function resolveModelsKey(ctx) {
  try {
    const resolved = await ctx.credentials.resolve('MODELS_API_KEY')
    return resolved?.value || process.env.MODELS_API_KEY || ''
  } catch {
    return process.env.MODELS_API_KEY || ''
  }
}

async function loadGeo(fetchImpl, apiKey, logger) {
  if (!apiKey) return unavailable('model_api_key_unavailable')
  try {
    const response = await timedFetch(fetchImpl, MCP_GEOFLOW_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'yootun-dashboard',
        method: 'tools/call',
        params: { name: 'geoflow.analytics.overview', arguments: { preset: 'yesterday' } },
      }),
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return unavailable('geoflow_auth_unavailable')
      return failed(`geoflow_http_${response.status}`)
    }
    const message = await mcpMessage(response)
    if (message?.error) return failed('geoflow_mcp_error')
    const value = message?.result?.structuredContent
    if (!value || typeof value !== 'object') return failed('geoflow_invalid_response')
    const trafficViews = value.traffic?.kpis?.pv ?? value.traffic?.kpis?.views ?? 0
    return {
      status: 'ready',
      data: {
        ...value,
        kpis: { ...(value.kpis || {}), total_views: value.kpis?.total_views ?? trafficViews },
      },
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: GeoFlow analytics failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'geoflow_timeout' : 'geoflow_request_failed')
  }
}

async function loadUsage(fetchImpl, apiKey, period, logger) {
  if (!apiKey) return unavailable('model_api_key_unavailable')
  try {
    const url = new URL(MODELS_USAGE_URL)
    url.searchParams.set('start', period.start)
    url.searchParams.set('end', period.end)
    const response = await timedFetch(fetchImpl, url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return unavailable('billing_auth_unavailable')
      return failed(`billing_http_${response.status}`)
    }
    const data = await response.json()
    return { status: Number(data?.summary?.requests || 0) > 0 ? 'ready' : 'empty', data }
  } catch (error) {
    logger?.warn?.('yootun dashboard: usage query failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'billing_timeout' : 'billing_request_failed')
  }
}

async function loadActivity(persistence, period, logger) {
  try {
    const headers = await persistence.list()
    const selected = [...headers]
      .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt))
      .slice(0, MAX_ACTIVITY_SESSIONS)
    const start = Date.parse(period.start)
    const end = Date.parse(period.end)
    const sessions = []
    const tools = new Map()
    const totals = { sessions: 0, turns: 0, completedTurns: 0, failedTurns: 0, toolCalls: 0 }

    for (const header of selected) {
      let inspection
      try {
        inspection = await persistence.load(header.id)
      } catch {
        continue
      }
      const events = inspection.events.filter(event => {
        const value = timestamp(event.time)
        return value >= start && value < end
      })
      if (events.length === 0) continue
      const row = {
        title: String(header.title || `Session ${String(header.id).slice(0, 8)}`),
        workspace: workspaceName(header.cwd),
        turns: 0,
        completedTurns: 0,
        failedTurns: 0,
      }
      for (const event of events) {
        if (event.type === 'turn/start') row.turns += 1
        if (event.type === 'turn/end') {
          if (event.data?.reason?.kind === 'completed') row.completedTurns += 1
          else row.failedTurns += 1
        }
        if (event.type === 'tool/call') {
          const name = String(event.data?.name || 'unknown')
          tools.set(name, (tools.get(name) || 0) + 1)
          totals.toolCalls += 1
        }
      }
      totals.sessions += 1
      totals.turns += row.turns
      totals.completedTurns += row.completedTurns
      totals.failedTurns += row.failedTurns
      sessions.push(row)
    }
    return {
      status: totals.sessions > 0 ? 'ready' : 'empty',
      data: {
        totals,
        sessions,
        tools: [...tools.entries()].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls),
      },
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: activity query failed: %s', safeError(error))
    return failed('activity_unavailable')
  }
}

function yesterdayPeriod(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const prior = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1))
  const date = prior.toISOString().slice(0, 10)
  return {
    label: '昨日',
    date,
    start: `${date}T00:00:00+08:00`,
    end: `${today}T00:00:00+08:00`,
    timeZone: TIME_ZONE,
  }
}

async function timedFetch(fetchImpl, url, init) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' })
}

async function mcpMessage(response) {
  const text = await response.text()
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return JSON.parse(text)
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const value = JSON.parse(line.slice(6))
    if (value?.result || value?.error) return value
  }
  throw new Error('MCP response contained no result')
}

function workspaceName(cwd) {
  const parts = String(cwd || '').replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.at(-1) || 'Default workspace'
}

function timestamp(value) {
  if (typeof value === 'number') return value < 100000000000 ? value * 1000 : value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function unavailable(reason) { return { status: 'unavailable', reason } }
function failed(reason) { return { status: 'error', reason } }
function safeError(error) { return error instanceof Error ? error.message.slice(0, 200) : 'unknown error' }

function sendJson(res, status, body) {
  const value = JSON.stringify(body)
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(value),
  })
  res.end(value)
}
