// FinOps host endpoint. The browser only calls this same-origin route; every
// Models data request is made here with the credential-store MODELS_API_KEY.

const PATH = '/api/desktop/yootun/finops'
const SERIES_PATH = '/api/desktop/yootun/finops/series'
const MODELS_USAGE_URL = 'https://ixicai.cn/api/v1/yootun/usage'
// Day-bucketed usage series; same Models-key authority and returns the active
// BudgetConfig rows used for budget health. See docs/0904/findops §6.
const MODELS_USAGE_DAILY_URL = 'https://ixicai.cn/api/v1/yootun/usage/daily'
const TIME_ZONE = 'Asia/Shanghai'
const REQUEST_TIMEOUT_MS = 20000
const MAX_SEGMENTS = 8
const RANGE_VALUES = new Set(['realtime', 'yesterday', 'week'])
const SERIES_DAYS = new Set([7, 30])
const MAX_SERIES_RANGE_MS = 31 * 24 * 60 * 60 * 1000
const BUDGET_WARNING_RATIO = 0.6
const BUDGET_CRITICAL_RATIO = 0.85
const COMPARISON_FIELDS = ['cost', 'requests', 'totalTokens', 'successfulRequests']

export const inject = ['webServer', 'credentials', 'tools']

export function apply(ctx, overrides = {}) {
  if (overrides.registerHostRoute === false) return undefined
  const fetchImpl = overrides.fetch || globalThis.fetch
  const now = overrides.now || (() => new Date())
  return ctx.effect(() => {
    const disposers = []
    if (ctx.tools?.register) {
      disposers.push(ctx.tools.register({
        name: 'yootun_finops_usage',
        description: 'Return model usage, cost, model mix, budget health, and source status shown by the Yootun FinOps plugin.',
        parameters: { type: 'object', additionalProperties: false, properties: { range: { type: 'string', enum: ['realtime', 'yesterday', 'week'] } } },
        output: outputSchema,
        isConcurrencySafe: () => true,
        async execute(args) {
          const range = args?.range || 'yesterday'
          if (!RANGE_VALUES.has(range)) return { ok: false, error: 'range must be realtime, yesterday, or week' }
          const observedAt = now(); const period = periodFor(range, observedAt); const apiKey = await resolveModelsKey(ctx)
          const [usage, daily] = await Promise.all([loadRangeUsage(fetchImpl, apiKey, period, ctx.logger), loadDaily(fetchImpl, apiKey, budgetWindow(period), ctx.logger)])
          return { ok: true, result: { period, ...project(usage, period, observedAt, daily), refreshedAt: observedAt.toISOString() } }
        },
      }))
      disposers.push(ctx.tools.register({
        name: 'yootun_finops_series',
        description: 'Return day-bucketed model usage and comparison data shown by the Yootun FinOps trend view.',
        parameters: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', enum: [7, 30] }, start: { type: 'string' }, end: { type: 'string' } } },
        output: outputSchema,
        isConcurrencySafe: () => true,
        async execute(args) {
          const query = args?.days ? `?days=${args.days}` : `?start=${encodeURIComponent(args?.start || '')}&end=${encodeURIComponent(args?.end || '')}`
          const params = readSeriesParams(`${SERIES_PATH}${query}`)
          if (params.error) return { ok: false, error: params.error }
          const observedAt = now(); const apiKey = await resolveModelsKey(ctx)
          return { ok: true, result: await loadSeries(fetchImpl, apiKey, params, observedAt, ctx.logger) }
        },
      }))
    }
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: PATH,
      async handler(req, res) {
        if (req.method !== 'GET') {
          res.writeHead(405, { Allow: 'GET' })
          res.end()
          return
        }
        const range = readRange(req.url)
        if (!RANGE_VALUES.has(range)) {
          sendJson(res, 400, { error: 'range must be realtime, yesterday, or week' })
          return
        }
        const observedAt = now()
        const period = periodFor(range, observedAt)
        const apiKey = await resolveModelsKey(ctx)
        const [usage, daily] = await Promise.all([
          loadRangeUsage(fetchImpl, apiKey, period, ctx.logger),
          // Budget health degrades independently: a daily-window failure never
          // blanks the summary or model mix above.
          loadDaily(fetchImpl, apiKey, budgetWindow(period), ctx.logger),
        ])
        sendJson(res, 200, { period, ...project(usage, period, observedAt, daily), refreshedAt: observedAt.toISOString() })
      },
    }))
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: SERIES_PATH,
      async handler(req, res) {
        if (req.method !== 'GET') {
          res.writeHead(405, { Allow: 'GET' })
          res.end()
          return
        }
        const params = readSeriesParams(req.url)
        if (params.error) {
          sendJson(res, 400, { error: params.error })
          return
        }
        const observedAt = now()
        const apiKey = await resolveModelsKey(ctx)
        sendJson(res, 200, await loadSeries(fetchImpl, apiKey, params, observedAt, ctx.logger))
      },
    }))
    return () => disposers.reverse().forEach(dispose => dispose?.())
  })
}

const outputSchema = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' }, result: { type: 'object', additionalProperties: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

function readRange(url) {
  try { return new URL(url || PATH, 'https://dsh.local').searchParams.get('range') || 'yesterday' } catch { return 'yesterday' }
}

function readSeriesParams(url) {
  let query
  try { query = new URL(url || SERIES_PATH, 'https://dsh.local').searchParams } catch { return { error: 'invalid query string' } }
  const grain = query.get('grain') || 'day'
  if (grain !== 'day') return { error: 'grain must be day; hourly granularity is served by range=realtime' }
  const days = query.get('days')
  if (days !== null) {
    const parsed = Number(days)
    if (!SERIES_DAYS.has(parsed)) return { error: 'days must be 7 or 30' }
    return { days: parsed }
  }
  const startValue = query.get('start'), endValue = query.get('end')
  if (!startValue || !endValue) return { error: 'provide days=7|30 or start and end ISO instants' }
  const start = Date.parse(startValue), end = Date.parse(endValue)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: 'start and end must be ISO 8601 instants' }
  if (end - start <= 0 || end - start > MAX_SERIES_RANGE_MS) return { error: 'series range must be greater than zero and at most 31 days' }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), label: '自定义' }
}

function project(usage, period, observedAt, daily) {
  const source = {
    status: usage.status,
    source: 'models',
    asOf: observedAt.toISOString(),
    sourceCompleteness: usage.sourceCompleteness || (usage.status === 'ready' || usage.status === 'empty' ? 'complete' : 'unknown'),
    missingFields: usage.missingFields || [],
  }
  if (usage.reason) source.reason = usage.reason
  if (usage.status === 'error' || usage.status === 'unavailable') {
    return { source, summary: {}, series: [], period, attribution: null, budget: budgetOf(daily), budgets: [], alerts: [], models: [] }
  }
  const data = usage.data || {}
  const summary = data.summary || {}
  const currency = String(data.currency || 'CNY')
  const models = Array.isArray(data.byModel) ? data.byModel.map(row => {
    const rowCost = finiteOrNull(row.cost), rowRequests = finiteOrNull(row.requests)
    return {
      id: String(row.model || 'unknown'), name: String(row.model || 'unknown'),
      requests: rowRequests, inputTokens: finiteOrNull(row.inputTokens),
      outputTokens: finiteOrNull(row.outputTokens), tokens: finiteOrNull(row.totalTokens),
      cost: formatMoney(currency, rowCost), costValue: rowCost,
      costPerRequest: rowCost !== null && rowRequests !== null && rowRequests > 0 ? Number((rowCost / rowRequests).toFixed(4)) : null,
    }
  }) : []
  return {
    source,
    attribution: data.attribution || null,
    summary: {
      spend: formatMoney(currency, finiteOrNull(summary.cost)), cost: finiteOrNull(summary.cost), currency,
      requests: finiteOrNull(summary.requests), successfulRequests: finiteOrNull(summary.successfulRequests),
      failedRequests: finiteOrNull(summary.failedRequests), inputTokens: finiteOrNull(summary.inputTokens),
      outputTokens: finiteOrNull(summary.outputTokens), totalTokens: finiteOrNull(summary.totalTokens), alerts: 0,
    },
    series: usage.series || [], period,
    budget: budgetOf(daily), budgets: daily?.status === 'ready' ? daily.budgets : [],
    alerts: [], models,
  }
}

// Budget health follows docs/0904/findops §6.4: ratios and states are computed
// here from the Models-returned used/limit; the client never estimates them.
function budgetOf(daily) {
  if (!daily || daily.status !== 'ready') return { status: 'unavailable', reason: daily?.reason || 'budget_source_not_configured' }
  const items = (daily.budgets || []).map(row => {
    const limit = finiteOrNull(row.limit), used = finiteOrNull(row.used)
    const ratio = limit !== null && limit > 0 && used !== null ? used / limit : null
    return {
      name: String(row.name || 'budget'), type: String(row.type || 'unknown'), period: String(row.period || 'unknown'),
      currency: String(row.currency || 'CNY'), limit, used, usageRatio: ratio,
      status: budgetStatus(ratio),
      thresholds: { warning: BUDGET_WARNING_RATIO, critical: BUDGET_CRITICAL_RATIO },
    }
  })
  if (!items.length) return null
  return { status: 'ready', items }
}

function budgetStatus(ratio) {
  if (ratio === null) return 'unavailable'
  if (ratio >= 1) return 'exceeded'
  if (ratio >= BUDGET_CRITICAL_RATIO) return 'critical'
  if (ratio >= BUDGET_WARNING_RATIO) return 'warning'
  return 'healthy'
}

// The daily window only carries BudgetConfig rows (window-independent), but the
// window itself must stay inside the 31-day contract of usage/daily.
function budgetWindow(period) {
  if (period.range === 'realtime') return { start: `${localDate(new Date(period.end))}T00:00:00+08:00`, end: period.end }
  return { start: period.start, end: period.end }
}

// Single usage/daily call returning the raw payload plus the echo of the window
// used, so budget and series projections share one upstream shape.
async function loadDaily(fetchImpl, apiKey, window, logger) {
  if (!apiKey) return { status: 'unavailable', reason: 'model_api_key_unavailable', window }
  try {
    const response = await timedFetch(fetchImpl, buildDailyUrl(window), { headers: modelsHeaders(apiKey) })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { status: 'unavailable', reason: 'billing_auth_unavailable', window }
      return { status: 'error', reason: `billing_http_${response.status}`, window }
    }
    const payload = await response.json()
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.days)) {
      return { status: 'error', reason: 'billing_invalid_response', window }
    }
    return { status: 'ready', window, payload, budgets: Array.isArray(payload.budgets) ? payload.budgets : [], attribution: payload.attribution || null }
  } catch (error) {
    logger?.warn?.('yootun finops: daily usage query failed: %s', safeError(error))
    return { status: 'error', reason: error?.name === 'TimeoutError' ? 'billing_timeout' : 'billing_request_failed', window }
  }
}

function seriesOf(daily) {
  return (Array.isArray(daily?.payload?.days) ? daily.payload.days : []).map(row => ({
    date: String(row.date || ''),
    requests: finiteOrNull(row.requests), successfulRequests: finiteOrNull(row.successfulRequests),
    inputTokens: finiteOrNull(row.inputTokens), outputTokens: finiteOrNull(row.outputTokens),
    totalTokens: finiteOrNull(row.totalTokens), cost: finiteOrNull(row.cost),
    latencyP50Ms: finiteOrNull(row.latencyP50Ms), latencyP95Ms: finiteOrNull(row.latencyP95Ms),
  }))
}

async function loadSeries(fetchImpl, apiKey, params, observedAt, logger) {
  if (!apiKey) return seriesEnvelope({ status: 'unavailable', reason: 'model_api_key_unavailable' }, params, observedAt, null, null)
  const start = params.days ? dayStartOffset(params.days, observedAt) : params.start
  const end = params.days ? observedAt.toISOString() : params.end
  const window = { start, end }
  const baselineLength = Date.parse(end) - Date.parse(start)
  const baselineWindow = { start: new Date(Date.parse(start) - baselineLength).toISOString(), end: start }
  const [currentResult, baselineResult] = await Promise.allSettled([
    loadDaily(fetchImpl, apiKey, window, logger),
    loadDaily(fetchImpl, apiKey, baselineWindow, logger),
  ])
  if (currentResult.status === 'rejected') {
    logger?.warn?.('yootun finops: series query failed: %s', safeError(currentResult.reason))
    return seriesEnvelope(failed('billing_request_failed'), params, observedAt, window, null)
  }
  const baseline = baselineResult.status === 'fulfilled' ? baselineResult.value : null
  return seriesEnvelope(currentResult.value, params, observedAt, window, baseline)
}

function seriesEnvelope(daily, params, observedAt, window, baseline) {
  const ready = daily.status === 'ready'
  const source = {
    status: ready ? 'ready' : daily.status,
    source: 'models',
    asOf: observedAt.toISOString(),
    sourceCompleteness: ready ? 'complete' : 'unknown',
    missingFields: [],
  }
  if (daily.reason) source.reason = daily.reason
  const series = seriesOf(daily)
  const currency = String(daily?.payload?.currency || 'CNY')
  const totals = Object.fromEntries(COMPARISON_FIELDS.map(key => [key, sumOf(series, key)]))
  const comparison = baseline && baseline.status === 'ready'
    ? {
      status: 'ready',
      baseline: { start: baseline.window.start, end: baseline.window.end },
      fields: Object.fromEntries(COMPARISON_FIELDS.map(key => {
        const value = totals[key], base = sumOf(seriesOf(baseline), key)
        const delta = value !== null && base !== null ? Number((value - base).toFixed(4)) : null
        return [key, {
          value, baseline: base, delta,
          deltaPercent: delta !== null && base > 0 ? Number(((delta / base) * 100).toFixed(1)) : null,
        }]
      })),
    }
    : { status: 'unavailable', reason: 'baseline_unavailable' }
  return {
    period: {
      label: params.days ? `近${params.days}天` : params.label,
      start: window ? window.start : '', end: window ? window.end : '', timeZone: TIME_ZONE, grain: 'day',
    },
    source,
    summary: { currency, ...totals },
    series,
    byRoute: (Array.isArray(daily?.payload?.byRoute) ? daily.payload.byRoute : []).slice(0, 20).map(row => ({
      route: String(row.route || 'unknown'), requests: finiteOrNull(row.requests),
      successfulRequests: finiteOrNull(row.successfulRequests), tokens: finiteOrNull(row.totalTokens), cost: finiteOrNull(row.cost),
    })),
    budget: budgetOf(daily),
    budgets: ready ? daily.budgets : [],
    comparison,
    attribution: daily.attribution || null,
    refreshedAt: observedAt.toISOString(),
  }
}

function buildDailyUrl(window) {
  const url = new URL(MODELS_USAGE_DAILY_URL)
  url.searchParams.set('start', window.start)
  url.searchParams.set('end', window.end)
  url.searchParams.set('timezone', TIME_ZONE)
  return url
}

function modelsHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
}

function dayStartOffset(days, from) {
  return `${addDays(localDate(from), -(days - 1))}T00:00:00+08:00`
}

function sumOf(series, key) {
  const values = series.map(row => finiteOrNull(row[key])).filter(value => value !== null)
  return values.length ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(4)) : null
}

async function resolveModelsKey(ctx) {
  try {
    const resolved = await ctx.credentials.resolve('MODELS_API_KEY')
    return resolved?.value || process.env.MODELS_API_KEY || ''
  } catch { return process.env.MODELS_API_KEY || '' }
}

async function loadRangeUsage(fetchImpl, apiKey, period, logger) {
  if (!apiKey) return unavailable('model_api_key_unavailable')
  const segments = usageSegments(period)
  const results = await Promise.all(segments.map(segment => loadUsage(fetchImpl, apiKey, segment, logger)))
  const successful = results.filter(item => item.status === 'ready' || item.status === 'empty')
  if (!successful.length) return failed(results.find(item => item.reason)?.reason || 'billing_unavailable')
  const data = aggregateUsage(successful.map(item => item.data))
  const failedSegments = results.filter(item => item.status !== 'ready' && item.status !== 'empty')
  const missingFields = [...new Set(successful.flatMap(item => item.missingFields || []))]
  const series = segments.map((segment, index) => {
    const result = results[index]
    if (result.status !== 'ready' && result.status !== 'empty') return { date: segment.date, status: result.status, reason: result.reason, cost: null, requests: null, totalTokens: null }
    const summary = result.data?.summary || {}
    return { date: segment.date, status: result.status, cost: finiteOrNull(summary.cost), requests: finiteOrNull(summary.requests), totalTokens: finiteOrNull(summary.totalTokens), inputTokens: finiteOrNull(summary.inputTokens), outputTokens: finiteOrNull(summary.outputTokens) }
  })
  const status = failedSegments.length ? 'warning' : data.summary.requests > 0 ? 'ready' : 'empty'
  return { status, data, series, sourceCompleteness: failedSegments.length || missingFields.length ? 'partial' : 'complete', missingFields, ...(failedSegments.length ? { reason: 'some_periods_unavailable' } : {}) }
}

async function loadUsage(fetchImpl, apiKey, period, logger) {
  try {
    const url = new URL(MODELS_USAGE_URL)
    url.searchParams.set('start', period.start); url.searchParams.set('end', period.end)
    const response = await timedFetch(fetchImpl, url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return unavailable('billing_auth_unavailable')
      return failed(`billing_http_${response.status}`)
    }
    const data = await response.json()
    if (!data || typeof data !== 'object' || !data.summary || typeof data.summary !== 'object') return failed('billing_invalid_response')
    return { status: finiteOrNull(data.summary.requests) > 0 ? 'ready' : 'empty', data, missingFields: Array.isArray(data.byModel) ? [] : ['byModel'] }
  } catch (error) {
    logger?.warn?.('yootun finops: usage query failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'billing_timeout' : 'billing_request_failed')
  }
}

function aggregateUsage(rows) {
  const currency = String(rows.find(row => row?.currency)?.currency || 'CNY')
  const summaryKeys = ['requests', 'successfulRequests', 'failedRequests', 'inputTokens', 'outputTokens', 'totalTokens', 'cost']
  const summary = Object.fromEntries(summaryKeys.map(key => [key, null]))
  const models = new Map()
  for (const row of rows) {
    const source = row?.summary || {}
    for (const key of summaryKeys) {
      const value = finiteOrNull(source[key])
      if (value !== null) summary[key] = (summary[key] || 0) + value
    }
    for (const model of Array.isArray(row?.byModel) ? row.byModel : []) {
      const id = String(model.model || 'unknown')
      const current = models.get(id) || { model: id, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
      current.requests += finiteOrNull(model.requests) || 0; current.inputTokens += finiteOrNull(model.inputTokens) || 0
      current.outputTokens += finiteOrNull(model.outputTokens) || 0; current.totalTokens += finiteOrNull(model.totalTokens) || 0
      current.cost += finiteOrNull(model.cost) || 0; models.set(id, current)
    }
  }
  return { currency, summary, byModel: [...models.values()].sort((a, b) => b.cost - a.cost || b.requests - a.requests) }
}

function periodFor(range, now) {
  if (range === 'realtime') {
    const start = new Date(now.getTime() - 60 * 60 * 1000)
    return { label: '实时', range, start: start.toISOString(), end: now.toISOString(), timeZone: TIME_ZONE, grain: 'hour' }
  }
  if (range === 'week') return weekPeriod(now)
  return yesterdayPeriod(now)
}

function usageSegments(period) {
  if (period.range !== 'week') return [{ date: period.range === 'realtime' ? period.label : period.date, start: period.start, end: period.end }]
  const startMs = Date.parse(period.start), endMs = Date.parse(period.end), segments = []
  for (let index = 0; index < MAX_SEGMENTS; index += 1) {
    const day = new Date(startMs + index * 24 * 60 * 60 * 1000), next = new Date(startMs + (index + 1) * 24 * 60 * 60 * 1000)
    const segmentEndMs = Math.min(next.getTime(), endMs)
    if (segmentEndMs <= day.getTime()) break
    segments.push({ date: localDate(day), start: day.toISOString(), end: new Date(segmentEndMs).toISOString() })
    if (segmentEndMs >= endMs) break
  }
  return segments
}

function yesterdayPeriod(now) {
  const today = localDate(now), prior = addDays(today, -1)
  return { label: '昨日', range: 'yesterday', date: prior, start: `${prior}T00:00:00+08:00`, end: `${today}T00:00:00+08:00`, timeZone: TIME_ZONE, grain: 'day' }
}

function weekPeriod(now) {
  const today = localDate(now), weekday = new Date(`${today}T00:00:00Z`).getUTCDay(), monday = addDays(today, -(weekday + 6) % 7)
  return { label: '本周', range: 'week', start: `${monday}T00:00:00+08:00`, end: now.toISOString(), timeZone: TIME_ZONE, grain: 'day' }
}

function localDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function addDays(date, amount) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10) }
function finiteOrNull(value) { if (value === undefined || value === null || value === '') return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
function formatMoney(currency, value) { return value === null ? null : `${currency} ${value.toFixed(2)}` }
async function timedFetch(fetchImpl, url, init) { return fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' }) }
function unavailable(reason) { return { status: 'unavailable', reason, sourceCompleteness: 'unknown', missingFields: [] } }
function failed(reason) { return { status: 'error', reason, sourceCompleteness: 'unknown', missingFields: [] } }
function safeError(error) { return error instanceof Error ? error.message.slice(0, 200) : 'unknown error' }
function sendJson(res, status, body) { const value = JSON.stringify(body); res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(value) }); res.end(value) }
