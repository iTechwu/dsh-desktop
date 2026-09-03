// FinOps host endpoint: serves the Web UI with real model spend from the
// Models usage API. The Web client keeps calling GET /api/desktop/yootun/finops;
// the credential never reaches the browser — it is resolved host-side per
// request and sent upstream as a bearer token.

const PATH = '/api/desktop/yootun/finops'
const MODELS_USAGE_URL = 'https://ixicai.cn/api/v1/yootun/usage'
const TIME_ZONE = 'Asia/Shanghai'
const REQUEST_TIMEOUT_MS = 20000

export const inject = ['webServer', 'credentials']

export function apply(ctx, overrides = {}) {
  if (overrides.registerHostRoute === false) return undefined
  const fetchImpl = overrides.fetch || globalThis.fetch
  const now = overrides.now || (() => new Date())
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' })
        res.end()
        return
      }
      const period = yesterdayPeriod(now())
      const apiKey = await resolveModelsKey(ctx)
      const usage = await loadUsage(fetchImpl, apiKey, period, ctx.logger)
      sendJson(res, 200, { period, ...project(usage), refreshedAt: now().toISOString() })
    },
  }))
}

function project(usage) {
  if (usage.status === 'ready' || usage.status === 'empty') {
    const data = usage.data || {}
    const currency = String(data.currency || 'CNY')
    const models = (data.byModel || []).map(row => ({
      id: String(row.model || 'unknown'),
      name: String(row.model || 'unknown'),
      requests: Number(row.requests || 0),
      tokens: Number(row.totalTokens || 0),
      cost: formatMoney(currency, row.cost),
    }))
    return {
      source: { status: usage.status },
      summary: { spend: formatMoney(currency, data.summary?.cost), alerts: 0 },
      budgets: [],
      alerts: [],
      models,
    }
  }
  return { source: { status: usage.status, reason: usage.reason }, summary: {}, budgets: [], alerts: [], models: [] }
}

function formatMoney(currency, value) {
  const amount = Number(value || 0)
  return `${currency} ${amount.toFixed(2)}`
}

async function resolveModelsKey(ctx) {
  try {
    const resolved = await ctx.credentials.resolve('MODELS_API_KEY')
    return resolved?.value || process.env.MODELS_API_KEY || ''
  } catch {
    return process.env.MODELS_API_KEY || ''
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
    if (!data || typeof data !== 'object' || !data.summary) return failed('billing_invalid_response')
    return { status: Number(data.summary.requests || 0) > 0 ? 'ready' : 'empty', data }
  } catch (error) {
    logger?.warn?.('yootun finops: usage query failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'billing_timeout' : 'billing_request_failed')
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
