const DASHBOARD_PATH = '/api/desktop/yootun/dashboard/yesterday'
const DASHBOARD_SERIES_PATH = '/api/desktop/yootun/dashboard/series'
const MCP_GEOFLOW_URL = 'https://ixicai.cn/mcp/geoflow'
const GEOFLOW_GOALS_URL = 'https://ixicai.cn/api/yootun/v1/geoflow/goals'
const GEORANK_OVERVIEW_URL = 'https://ixicai.cn/api/yootun/v1/georank/overview'
const MCP_GEORANK_URL = 'https://ixicai.cn/mcp/georank'
const MODELS_USAGE_URL = 'https://ixicai.cn/api/v1/yootun/usage'
const MODELS_USAGE_DAILY_URL = 'https://ixicai.cn/api/v1/yootun/usage/daily'
const MONTAGE_OVERVIEW_URL = 'https://ixicai.cn/api/yootun/v1/montage/overview'
const MONTAGE_SERIES_URL = 'https://ixicai.cn/api/yootun/v1/montage/series'
const TIME_ZONE = 'Asia/Shanghai'
const REQUEST_TIMEOUT_MS = 20000
const MAX_ACTIVITY_SESSIONS = 500
const DAY_MS = 24 * 60 * 60 * 1000

export const inject = ['webServer', 'credentials', 'sessionPersistence', 'tools']

export function apply(ctx, overrides = {}) {
  const fetchImpl = overrides.fetch || globalThis.fetch
  const now = overrides.now || (() => new Date())
  return ctx.effect(() => {
    const disposers = []
    if (ctx.tools?.register) disposers.push(ctx.tools.register({
      name: 'yootun_dashboard_overview',
      description: 'Return the GEO, model usage, local Agent activity, Montage, and MCP capability data shown by the Yootun dashboard.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: outputSchema,
      isConcurrencySafe: () => true,
      async execute() { return { ok: true, result: await loadDashboardState(ctx, fetchImpl, now) } },
    }))
    if (ctx.tools?.register) disposers.push(ctx.tools.register({
      name: 'yootun_dashboard_series',
      description: 'Return multi-day GEO, model usage, local activity, Montage, and capability series shown by the Yootun dashboard.',
      parameters: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', enum: [7, 30] }, scope: { type: 'string', enum: ['key', 'team'] } } },
      output: outputSchema,
      isConcurrencySafe: () => true,
      async execute(args) {
        const days = clampSeriesDays(args?.days)
        const usageScope = args?.scope === 'team' ? 'team' : 'key'
        const window = seriesWindow(now(), days); const credential = await resolveModelsKey(ctx); const asOf = now().toISOString()
        const [geo, usage, activity, montage] = await Promise.all([
          loadGeoSeries(fetchImpl, credential, window, now, ctx.logger), loadUsageSeries(fetchImpl, credential, window, usageScope, ctx.logger),
          loadActivitySeries(ctx.sessionPersistence, window, ctx.logger), loadMontageSeries(fetchImpl, credential, window, ctx.logger),
        ])
        const rank = hasCapability(ctx.tools, /georank/i) ? await loadGeorankOverview(fetchImpl, credential, ctx.logger) : unavailable('georank_tool_unavailable')
        return { ok: true, result: { period: { label: `近${days}天`, days, start: window.start, end: window.end, timeZone: TIME_ZONE }, geo: withSourceMeta(geo, 'geoflow', asOf), georank: withSourceMeta(rank, 'georank', asOf), usage: withSourceMeta(usage, 'models', asOf), activity: withSourceMeta(activity, 'local_agent', asOf), montage: withSourceMeta(montage, 'openmontage', asOf), capabilities: capabilitySources(ctx.tools), refreshedAt: asOf } }
      },
    }))
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: DASHBOARD_PATH,
      async handler(req, res) {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' })
          res.end()
          return
        }

        sendJson(res, 200, await loadDashboardState(ctx, fetchImpl, now))
      },
    }))
    // 近 N 天趋势（docs/0903/dashboard §4 P1）。四源独立降级：GeoFlow 用更长的
    // preset 窗口拆出本期/上期，Models/Montage 各打两次窗口请求，本地活动单次扫描。
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: DASHBOARD_SERIES_PATH,
      async handler(req, res) {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' })
          res.end()
          return
        }

        const body = await readJsonBody(req)
        const days = clampSeriesDays(body?.days)
        const usageScope = body?.scope === 'team' ? 'team' : 'key'
        const window = seriesWindow(now(), days)
        const credential = await resolveModelsKey(ctx)
        const asOf = now().toISOString()
        const [geo, usage, activity, montage] = await Promise.all([
          loadGeoSeries(fetchImpl, credential, window, now, ctx.logger),
          loadUsageSeries(fetchImpl, credential, window, usageScope, ctx.logger),
          loadActivitySeries(ctx.sessionPersistence, window, ctx.logger),
          loadMontageSeries(fetchImpl, credential, window, ctx.logger),
        ])
        const georank = hasCapability(ctx.tools, /georank/i) ? await loadGeorankOverview(fetchImpl, credential, ctx.logger) : unavailable('georank_tool_unavailable')
        sendJson(res, 200, {
          period: {
            label: `近${days}天`,
            days,
            start: window.start,
            end: window.end,
            timeZone: TIME_ZONE,
          },
          geo: withSourceMeta(geo, 'geoflow', asOf),
          georank: withSourceMeta(georank, 'georank', asOf),
          usage: withSourceMeta(usage, 'models', asOf),
          activity: withSourceMeta(activity, 'local_agent', asOf),
          montage: withSourceMeta(montage, 'openmontage', asOf),
          capabilities: capabilitySources(ctx.tools),
          refreshedAt: asOf,
        })
      },
    }))
    return () => {
      for (const dispose of disposers.reverse()) dispose?.()
    }
  })
}

const outputSchema = { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' }, result: { type: 'object', additionalProperties: true } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

async function loadDashboardState(ctx, fetchImpl, now) {
  const period = yesterdayPeriod(now()); const credential = await resolveModelsKey(ctx); const asOf = now().toISOString()
  const [geo, usage, activity, montage] = await Promise.all([loadGeo(fetchImpl, credential, ctx.logger), loadUsage(fetchImpl, credential, period, ctx.logger), loadActivity(ctx.sessionPersistence, period, ctx.logger), loadMontage(fetchImpl, credential, ctx.logger)])
  const georank = hasCapability(ctx.tools, /georank/i) ? await loadGeorankOverview(fetchImpl, credential, ctx.logger) : unavailable('georank_tool_unavailable')
  return { period, geo: withSourceMeta(geo, 'geoflow', asOf), georank: withSourceMeta(georank, 'georank', asOf), usage: withSourceMeta(usage, 'models', asOf), activity: withSourceMeta(activity, 'local_agent', asOf), montage: withSourceMeta(montage, 'openmontage', asOf), capabilities: capabilitySources(ctx.tools), refreshedAt: asOf }
}

// 成功读取的数据源默认 complete；失败/不可用源标记 unknown，缺失字段不会在前端被静默渲染为 0。
function withSourceMeta(envelope, source, asOf) {
  const defaulted = envelope.status === 'ready' || envelope.status === 'empty' ? 'complete' : 'unknown'
  return {
    ...envelope,
    source,
    asOf: envelope.asOf || asOf,
    sourceCompleteness: envelope.sourceCompleteness || defaulted,
    missingFields: Array.isArray(envelope.missingFields) ? envelope.missingFields : [],
  }
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

function hasCapability(tools, pattern) {
  return (tools?.schemas?.() || []).some(item => pattern.test(`${item.name} ${item.description || ''}`))
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
    const trafficViews = value.traffic?.kpis?.pv ?? value.traffic?.kpis?.views
    const missingFields = []
    if (!value.kpis || typeof value.kpis !== 'object') missingFields.push('kpis')
    else if (value.kpis.total_views === undefined && trafficViews === undefined) missingFields.push('kpis.total_views')
    if (!Array.isArray(value.top_content)) missingFields.push('top_content')
    const kpis = { ...(value.kpis || {}) }
    if (kpis.total_views === undefined && trafficViews !== undefined) kpis.total_views = trafficViews
    return {
      status: 'ready',
      data: {
        ...value,
        kpis,
      },
      sourceCompleteness: missingFields.length ? 'partial' : 'complete',
      missingFields,
      asOf: value.generatedAt || value.generated_at || value.asOf || value.as_of || '',
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: GeoFlow analytics failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'geoflow_timeout' : 'geoflow_request_failed')
  }
}

async function loadGeorankOverview(fetchImpl, apiKey, logger) {
  if (!apiKey) return unavailable('model_api_key_unavailable')
  const benchmark = await loadGeorankBenchmark(fetchImpl, apiKey, logger)
  try {
    const response = await timedFetch(fetchImpl, GEORANK_OVERVIEW_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      if (benchmark.status === 'ready') return georankBenchmarkOnly(benchmark, `georank_http_${response.status}`)
      if (response.status === 401 || response.status === 403) return unavailable('georank_auth_unavailable')
      return failed(`georank_http_${response.status}`)
    }
    const payload = await response.json()
    const data = payload?.data
    if (!data || typeof data !== 'object') return benchmark.status === 'ready' ? georankBenchmarkOnly(benchmark, 'georank_invalid_response') : failed('georank_invalid_response')
    const missingFields = []
    if (!data.totals || typeof data.totals !== 'object') missingFields.push('totals')
    if (data.averageGeoScore === undefined) missingFields.push('averageGeoScore')
    if (!data.scoreDistribution || typeof data.scoreDistribution !== 'object') missingFields.push('scoreDistribution')
    if (!Array.isArray(data.recentCompanies)) missingFields.push('recentCompanies')
    const scored = Number(data.totals?.scoredCompanies ?? 0)
    return {
      status: benchmark.status === 'ready' || scored > 0 || Number.isFinite(Number(data.averageGeoScore)) ? 'ready' : 'empty',
      data: {
        scope: string(data.scope) || 'public_directory',
        totals: { publishedCompanies: numberOrNull(data.totals?.publishedCompanies), scoredCompanies: numberOrNull(data.totals?.scoredCompanies) },
        averageGeoScore: numberOrNull(data.averageGeoScore),
        aiFriendlinessScore: benchmark.data?.score ?? null,
        benchmarkScore: benchmark.data?.score ?? numberOrNull(data.averageGeoScore),
        benchmarkBasis: benchmark.data?.score != null ? 'youhuitun_ai_friendliness' : 'public_directory_average',
        benchmarkReasons: benchmark.data?.reasons || [],
        benchmarkSuggestions: benchmark.data?.suggestions || [],
        scoreDistribution: object(data.scoreDistribution),
        recentCompanies: list(data.recentCompanies).slice(0, 8).map(item => ({
          id: string(item?.id), name: string(item?.name), url: string(item?.url), category: string(item?.category), geoScore: numberOrNull(item?.geoScore), isGeoCertified: item?.isGeoCertified === true,
        })),
      },
      sourceCompleteness: missingFields.length || benchmark.status !== 'ready' ? 'partial' : 'complete',
      missingFields: benchmark.status === 'ready' ? missingFields : [...missingFields, 'aiFriendlinessScore'],
      asOf: payload?.meta?.generatedAt || payload?.meta?.asOf || '',
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: GEORank overview failed: %s', safeError(error))
    return benchmark.status === 'ready'
      ? georankBenchmarkOnly(benchmark, error?.name === 'TimeoutError' ? 'georank_timeout' : 'georank_request_failed')
      : failed(error?.name === 'TimeoutError' ? 'georank_timeout' : 'georank_request_failed')
  }
}

async function loadGeorankBenchmark(fetchImpl, apiKey, logger) {
  try {
    const initialized = await georankMcpRequest(fetchImpl, apiKey, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'yootun-dashboard', version: '1.0.0' } },
    })
    const sessionId = initialized.response.headers.get('mcp-session-id')
    if (!sessionId) return failed('georank_benchmark_session_unavailable')
    await georankMcpRequest(fetchImpl, apiKey, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionId)
    const called = await georankMcpRequest(fetchImpl, apiKey, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'georank_score_ai_friendliness', arguments: { brief: '优惠豚：https://yootun.ixicai.cn。优惠豚面向中国大陆汽车消费者提供好车会员服务和购车决策信息，通过可核验来源、结构化内容、Schema、FAQ 与 GEO 提升 AI 搜索可见性。' } },
    }, sessionId)
    const result = called.payload?.result
    const text = result?.content?.find(item => item?.type === 'text')?.text
    let parsedText = null
    try { parsedText = text ? JSON.parse(text) : null } catch {}
    const data = result?.structuredContent || parsedText
    const score = numberOrNull(data?.score)
    if (result?.isError || score === null) return failed('georank_benchmark_invalid_response')
    return { status: 'ready', data: { score, reasons: list(data.reasons).map(string).filter(Boolean), suggestions: list(data.suggestions).map(string).filter(Boolean) } }
  } catch (error) {
    logger?.warn?.('yootun dashboard: GEORank benchmark failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'georank_benchmark_timeout' : 'georank_benchmark_request_failed')
  }
}

async function georankMcpRequest(fetchImpl, apiKey, body, sessionId = '') {
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-03-26' }
  if (sessionId) headers['MCP-Session-Id'] = sessionId
  const response = await timedFetch(fetchImpl, MCP_GEORANK_URL, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await response.text()
  const dataLines = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean)
  let payload = null
  try { payload = text.trim() ? JSON.parse(dataLines.length ? dataLines.at(-1) : text) : null } catch {}
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `GEORank MCP returned HTTP ${response.status}`)
  return { response, payload }
}

function georankBenchmarkOnly(benchmark, reason) {
  return {
    status: 'ready',
    data: {
      scope: 'youhuitun_site', totals: { publishedCompanies: null, scoredCompanies: null }, averageGeoScore: null,
      aiFriendlinessScore: benchmark.data.score, benchmarkScore: benchmark.data.score, benchmarkBasis: 'youhuitun_ai_friendliness',
      benchmarkReasons: benchmark.data.reasons, benchmarkSuggestions: benchmark.data.suggestions, scoreDistribution: {}, recentCompanies: [],
    },
    sourceCompleteness: 'partial',
    missingFields: ['publicDirectory'],
    reason,
  }
}

async function loadMontage(fetchImpl, apiKey, logger) {
  if (!apiKey) return unavailable('model_api_key_unavailable')
  try {
    const response = await timedFetch(fetchImpl, MONTAGE_OVERVIEW_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return unavailable('montage_auth_unavailable')
      return failed(`montage_http_${response.status}`)
    }
    const payload = await response.json()
    const data = payload?.data
    if (!data || typeof data !== 'object') return failed('montage_invalid_response')
    const present = [
      ['jobs', data.jobs !== undefined || data.job_stats !== undefined || data.statuses !== undefined],
      ['pendingApprovals', data.pendingApprovals !== undefined || data.pending_approvals !== undefined || data.awaitingApproval !== undefined || data.awaiting_approval !== undefined],
      ['artifacts', data.artifacts !== undefined],
      ['health', data.health !== undefined || data.service_health !== undefined],
    ]
    const missingFields = present.filter(([, ok]) => !ok).map(([key]) => key)
    return {
      status: 'ready',
      data: normalizeMontage(data),
      asOf: payload?.meta?.generatedAt || payload?.meta?.asOf || '',
      sourceCompleteness: missingFields.length === 0 ? 'complete' : missingFields.length === present.length ? 'unknown' : 'partial',
      missingFields,
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: montage overview failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'montage_timeout' : 'montage_request_failed')
  }
}

function normalizeMontage(data) {
  const jobs = object(data.jobs ?? data.job_stats ?? data.statuses)
  const statusOf = key => numberOrNull(jobs[key] ?? jobs.statuses?.[key])
  const artifacts = object(data.artifacts)
  const health = object(data.health ?? data.service_health)
  const approvals = object(data.approvals)
  return {
    jobs: {
      total: numberOrNull(jobs.total ?? jobs.total_count ?? data.total_jobs),
      queued: statusOf('queued'),
      running: statusOf('running'),
      completed: statusOf('completed'),
      failed: statusOf('failed'),
    },
    pendingApprovals: numberOrNull(data.pendingApprovals ?? data.pending_approvals ?? approvals.pending ?? data.awaitingApproval ?? data.awaiting_approval),
    approvals: {
      oldestWaitingAt: string(approvals.oldestWaitingAt ?? approvals.oldest_waiting_at),
      waitP50Ms: numberOrNull(approvals.waitP50Ms ?? approvals.wait_p50_ms),
      waitP95Ms: numberOrNull(approvals.waitP95Ms ?? approvals.wait_p95_ms),
    },
    recentJobs: list(data.recentJobs ?? data.recent_jobs ?? jobs.recent).slice(0, 8).map(item => {
      const row = object(item)
      return {
        id: string(row.id ?? row.jobId ?? row.job_id),
        title: string(row.title ?? row.name),
        status: string(row.status),
        stage: string(row.stage ?? row.currentStage ?? row.current_stage),
        updatedAt: string(row.updatedAt ?? row.updated_at),
      }
    }),
    artifacts: {
      total: numberOrNull(artifacts.total ?? artifacts.total_count ?? data.artifactCount ?? data.artifact_count),
      recent: list(artifacts.recent ?? data.recentArtifacts ?? data.recent_artifacts).slice(0, 8).map(item => {
        const row = object(item)
        return {
          id: string(row.id ?? row.artifactId ?? row.artifact_id),
          jobId: string(row.jobId ?? row.job_id),
          kind: string(row.kind ?? row.type),
          title: string(row.title ?? row.name),
          createdAt: string(row.createdAt ?? row.created_at),
        }
      }),
    },
    health: {
      service: string(health.service ?? health.status ?? data.serviceStatus ?? data.service_status),
      workers: list(health.workers).slice(0, 8).map(item => {
        const row = object(item)
        return {
          id: string(row.id ?? row.workerId ?? row.worker_id),
          status: string(row.status ?? row.state),
          lastHeartbeatAt: string(row.lastHeartbeatAt ?? row.last_heartbeat_at),
        }
      }),
    },
  }
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function list(value) { return Array.isArray(value) ? value : [] }
function number(value) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 }
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
function string(value) { return typeof value === 'string' || typeof value === 'number' ? String(value) : '' }

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
      if (response.status === 401) return unavailable('billing_auth_unavailable')
      if (response.status === 403) return unavailable('billing_forbidden')
      return failed(`billing_http_${response.status}`)
    }
    const data = await response.json()
    const missingFields = []
    if (!data?.summary || typeof data.summary !== 'object') missingFields.push('summary')
    if (!Array.isArray(data?.byModel)) missingFields.push('byModel')
    return {
      status: Number(data?.summary?.requests || 0) > 0 ? 'ready' : 'empty',
      data,
      asOf: data?.generatedAt || data?.asOf || '',
      sourceCompleteness: missingFields.length ? 'partial' : 'complete',
      missingFields,
    }
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
  const parts = tzDateParts(now)
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

function tzDateParts(now) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
}

// —— 近 N 天趋势（series 路由）——

function clampSeriesDays(value) {
  const parsed = Number(value ?? 7)
  if (!Number.isInteger(parsed) || parsed < 1) return 7
  return Math.min(parsed, 30)
}

// 当前窗口 [start, end) = 截止昨日的 N 个整天；基线窗口为其前 N 天。
function seriesWindow(now, days) {
  const parts = tzDateParts(now)
  const todayMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
  const endMs = todayMs
  const startMs = endMs - days * DAY_MS
  const baselineStartMs = startMs - days * DAY_MS
  const dateOf = ms => new Date(ms).toISOString().slice(0, 10)
  const startDate = dateOf(startMs)
  const endDate = dateOf(endMs)
  return {
    days,
    startDate,
    endDate,
    start: `${startDate}T00:00:00+08:00`,
    end: `${endDate}T00:00:00+08:00`,
    baselineStartDate: dateOf(baselineStartMs),
    baselineStart: `${dateOf(baselineStartMs)}T00:00:00+08:00`,
    baselineEnd: `${startDate}T00:00:00+08:00`,
  }
}

// 窗口内每一天（Asia/Shanghai 日历日），供零填充。
function windowDates(startDate, endDate) {
  const dates = []
  let cursor = Date.parse(`${startDate}T00:00:00Z`)
  const last = Date.parse(`${endDate}T00:00:00Z`)
  while (cursor < last) {
    dates.push(new Date(cursor).toISOString().slice(0, 10))
    cursor += DAY_MS
  }
  return dates
}

function dayKey(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

async function readJsonBody(req) {
  try {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 4096) return {}
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') || {}
  } catch {
    return {}
  }
}

// GeoFlow preset 只到 30d/90d，因此请求双倍窗口再按日期拆出本期/上期。
function geoflowPreset(days) {
  return days > 15 ? '90d' : '30d'
}

function localMonth(instant) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit',
  }).formatToParts(instant).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}`
}

async function loadGeoGoals(fetchImpl, apiKey, month, logger) {
  if (!apiKey) return unavailable('model_api_key_unavailable')
  try {
    const url = new URL(GEOFLOW_GOALS_URL)
    url.searchParams.set('month', month)
    const response = await timedFetch(fetchImpl, url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return unavailable('geoflow_auth_unavailable')
      return failed(`geoflow_goals_http_${response.status}`)
    }
    const payload = await response.json()
    const goals = list(payload?.data?.goals)
    return {
      status: 'ready',
      data: {
        month: string(payload?.data?.month) || month,
        goals: goals.map(g => ({
          goalId: numberOrZero(g?.goal_id),
          scope: string(g?.scope) || 'category',
          categoryId: numberOrZero(g?.category_id) || null,
          categoryName: string(g?.category_name),
          metric: string(g?.metric) || 'published',
          target: numberOrZero(g?.target),
          actual: numberOrZero(g?.actual),
          attainmentPct: g?.attainment_pct === null || g?.attainment_pct === undefined ? null : numberOrZero(g.attainment_pct),
          pacePct: g?.pace_pct === null || g?.pace_pct === undefined ? null : numberOrZero(g.pace_pct),
        })),
      },
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: GeoFlow goals query failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'geoflow_goals_timeout' : 'geoflow_goals_request_failed')
  }
}

function numberOrZero(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function loadGeoSeries(fetchImpl, apiKey, window, now, logger) {
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
        id: 'yootun-dashboard-series',
        method: 'tools/call',
        params: { name: 'geoflow.analytics.overview', arguments: { preset: geoflowPreset(window.days) } },
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

    const publication = list(value.publication_trend)
    const tasks = list(value.task_trend)
    const traffic = list(value.traffic?.traffic_trend)
    const missingFields = []
    if (!Array.isArray(value.publication_trend)) missingFields.push('publication_trend')
    if (!Array.isArray(value.task_trend)) missingFields.push('task_trend')
    if (!Array.isArray(value.traffic?.traffic_trend)) missingFields.push('traffic.traffic_trend')
    // 漏斗与渠道分布对任意 preset 都返回，原样透传给客户端渲染
    const insight = {
      funnel: object(value.content_funnel),
      channels: object(value.distribution_summary),
      goals: null,
    }
    // 内容生产目标达成率（docs/0903/dashboard/06 提案）；仅当 overview 取
    // 到 tenant_id 时才有意义，失败/不可用时降级为 null（前端不渲染）
    const tenantId = string(value.tenant_id).trim()
    if (tenantId) {
      const goalsMonth = localMonth(now())
      const goalsEnvelope = await loadGeoGoals(fetchImpl, apiKey, goalsMonth, logger)
      insight.goals = goalsEnvelope.status === 'ready' ? goalsEnvelope.data : null
    }

    const merged = new Map()
    const bucketOf = date => {
      if (typeof date !== 'string') return null
      const bucket = merged.get(date) || { articles: 0, published: 0, views: 0, failedTasks: 0 }
      merged.set(date, bucket)
      return bucket
    }
    for (const row of publication) {
      const bucket = bucketOf(row?.date)
      if (bucket) { bucket.articles = number(row.created); bucket.published = number(row.published) }
    }
    for (const row of tasks) {
      const bucket = bucketOf(row?.date)
      if (bucket) bucket.failedTasks = number(row.failed)
    }
    for (const row of traffic) {
      const bucket = bucketOf(row?.date)
      if (bucket) bucket.views = number(row.pv)
    }

    const days = windowDates(window.startDate, window.endDate).map(date => ({
      date,
      ...(merged.get(date) || { articles: 0, published: 0, views: 0, failedTasks: 0 }),
    }))
    const current = sumBuckets(days)
    const baseline = sumBuckets(baselineBuckets(merged, window))
    const totals = { ...current }
    const status = totals.articles + totals.views + totals.published + totals.failedTasks > 0 ? 'ready' : 'empty'
    return {
      status,
      data: {
        days,
        totals,
        insight,
      },
      comparison: buildComparison(current, baseline, ['articles', 'published', 'views', 'failedTasks']),
      sourceCompleteness: missingFields.length ? 'partial' : 'complete',
      missingFields,
      asOf: value.generatedAt || value.generated_at || value.asOf || value.as_of || '',
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: GeoFlow series failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'geoflow_timeout' : 'geoflow_request_failed')
  }
}

async function loadUsageSeries(fetchImpl, apiKey, window, scope, logger) {
  if (!apiKey) return unavailable('model_api_key_unavailable')
  try {
    const [currentResult, baselineResult] = await Promise.allSettled([
      fetchUsageDaily(fetchImpl, apiKey, window.start, window.end, scope),
      fetchUsageDaily(fetchImpl, apiKey, window.baselineStart, window.baselineEnd, scope),
    ])
    if (currentResult.status === 'rejected') throw currentResult.reason
    const current = currentResult.value
    if (!current.ok) {
      if (current.status === 401) return unavailable('billing_auth_unavailable')
      if (current.status === 403) return unavailable(scope === 'team' ? 'billing_team_forbidden' : 'billing_forbidden')
      return failed(`billing_http_${current.status}`)
    }
    const baseline = baselineResult.status === 'fulfilled' && baselineResult.value.ok ? baselineResult.value : null
    const totals = {
      requests: sumOf(current.days, 'requests'),
      successfulRequests: sumOf(current.days, 'successfulRequests'),
      totalTokens: sumOf(current.days, 'totalTokens'),
      cost: sumOf(current.days, 'cost'),
    }
    return {
      status: totals.requests > 0 ? 'ready' : 'empty',
      data: {
        days: current.days,
        totals,
        currency: current.currency,
        scope: current.scope,
        byRoute: current.byRoute,
        byMember: current.byMember,
        budgets: current.budgets,
        principal: current.principal,
      },
      comparison: baseline
        ? buildComparison(
          totals,
          {
            requests: sumOf(baseline.days, 'requests'),
            successfulRequests: sumOf(baseline.days, 'successfulRequests'),
            totalTokens: sumOf(baseline.days, 'totalTokens'),
            cost: sumOf(baseline.days, 'cost'),
          },
          ['requests', 'successfulRequests', 'totalTokens', 'cost'],
        )
        : { status: 'unavailable', reason: 'baseline_unavailable' },
      asOf: current.asOf,
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: usage series failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'billing_timeout' : 'billing_request_failed')
  }
}

async function fetchUsageDaily(fetchImpl, apiKey, start, end, scope) {
  const url = new URL(MODELS_USAGE_DAILY_URL)
  url.searchParams.set('start', start)
  url.searchParams.set('end', end)
  url.searchParams.set('timezone', TIME_ZONE)
  if (scope === 'team') url.searchParams.set('scope', 'team')
  const response = await timedFetch(fetchImpl, url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  if (!response.ok) return { ok: false, status: response.status }
  const payload = await response.json()
  const days = list(payload?.days).map(day => ({
    date: string(day?.date),
    requests: number(day?.requests),
    successfulRequests: number(day?.successfulRequests),
    inputTokens: number(day?.inputTokens),
    outputTokens: number(day?.outputTokens),
    totalTokens: number(day?.totalTokens),
    cost: number(day?.cost),
    latencyP50Ms: day?.latencyP50Ms === null || day?.latencyP50Ms === undefined ? null : number(day.latencyP50Ms),
    latencyP95Ms: day?.latencyP95Ms === null || day?.latencyP95Ms === undefined ? null : number(day.latencyP95Ms),
  }))
  return {
    ok: true,
    days,
    currency: typeof payload?.currency === 'string' ? payload.currency : 'CNY',
    scope: payload?.attribution?.scope === 'team' ? 'team' : 'key',
    byRoute: list(payload?.byRoute).map(route => ({
      route: string(route?.route) || 'unknown',
      requests: number(route?.requests),
      cost: number(route?.cost),
    })),
    byMember: list(payload?.byMember).map(member => ({
      memberId: string(member?.memberId),
      displayName: string(member?.displayName),
      ownerType: string(member?.ownerType),
      requests: number(member?.requests),
      cost: number(member?.cost),
    })),
    budgets: list(payload?.budgets).map(budget => ({
      name: string(budget?.name),
      type: string(budget?.type),
      period: string(budget?.period),
      limit: number(budget?.limit),
      used: number(budget?.used),
      currency: string(budget?.currency) || 'CNY',
    })),
    principal: payload?.attribution?.principal && typeof payload.attribution.principal === 'object'
      ? payload.attribution.principal
      : null,
    asOf: payload?.generatedAt || payload?.asOf || '',
  }
}

async function loadActivitySeries(persistence, window, logger) {
  try {
    const headers = await persistence.list()
    const selected = [...headers]
      .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt))
      .slice(0, MAX_ACTIVITY_SESSIONS)
    const baselineStart = Date.parse(window.baselineStart)
    const end = Date.parse(window.end)
    const currentDates = [...windowDates(window.startDate, window.endDate)]
    const currentDays = new Map(currentDates.map(date => [date, {
      sessions: 0, turns: 0, completedTurns: 0, failedTurns: 0, toolCalls: 0,
    }]))
    const sessionDays = new Map(currentDates.map(date => [date, new Set()]))
    const baselineSessions = new Set()
    const baselineTotals = { turns: 0, completedTurns: 0, failedTurns: 0, toolCalls: 0 }

    for (const header of selected) {
      let inspection
      try {
        inspection = await persistence.load(header.id)
      } catch {
        continue
      }
      let touchedBaseline = false
      for (const event of inspection.events) {
        const at = timestamp(event.time)
        if (at < baselineStart || at >= end) continue
        const date = dayKey(at)
        const bucket = currentDays.get(date)
        if (bucket) {
          sessionDays.get(date).add(header.id)
          if (event.type === 'turn/start') bucket.turns += 1
          if (event.type === 'turn/end') {
            if (event.data?.reason?.kind === 'completed') bucket.completedTurns += 1
            else bucket.failedTurns += 1
          }
          if (event.type === 'tool/call') bucket.toolCalls += 1
        } else {
          touchedBaseline = true
          if (event.type === 'turn/start') baselineTotals.turns += 1
          if (event.type === 'turn/end') {
            if (event.data?.reason?.kind === 'completed') baselineTotals.completedTurns += 1
            else baselineTotals.failedTurns += 1
          }
          if (event.type === 'tool/call') baselineTotals.toolCalls += 1
        }
      }
      if (touchedBaseline) baselineSessions.add(header.id)
    }
    for (const date of currentDates) {
      currentDays.get(date).sessions = sessionDays.get(date).size
    }
    const days = currentDates.map(date => ({ date, ...currentDays.get(date) }))
    const totals = sumBucketList(days)
    return {
      status: totals.sessions > 0 ? 'ready' : 'empty',
      data: {
        days,
        totals,
      },
      comparison: buildComparison(
        totals,
        {
          sessions: baselineSessions.size,
          ...baselineTotals,
        },
        ['sessions', 'turns', 'completedTurns', 'failedTurns', 'toolCalls'],
      ),
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: activity series failed: %s', safeError(error))
    return failed('activity_unavailable')
  }
}

async function loadMontageSeries(fetchImpl, apiKey, window, logger) {
  if (!apiKey) return unavailable('model_api_key_unavailable')
  try {
    const [currentResult, baselineResult] = await Promise.allSettled([
      fetchMontageSeries(fetchImpl, apiKey, window.start, window.end),
      fetchMontageSeries(fetchImpl, apiKey, window.baselineStart, window.baselineEnd),
    ])
    if (currentResult.status === 'rejected') throw currentResult.reason
    const current = currentResult.value
    if (!current.ok) {
      if (current.status === 401 || current.status === 403) return unavailable('montage_auth_unavailable')
      return failed(`montage_http_${current.status}`)
    }
    const baseline = baselineResult.status === 'fulfilled' && baselineResult.value.ok ? baselineResult.value : null
    const days = current.days
    const totals = { ...current.statusCounts, total: days.reduce((sum, day) => sum + number(day.total), 0) }
    return {
      status: 'ready',
      data: {
        days,
        totals,
        stageStats: current.stageStats,
      },
      comparison: baseline
        ? buildComparison(
          totals,
          { ...baseline.statusCounts, total: baseline.days.reduce((sum, day) => sum + number(day.total), 0) },
          ['total', 'queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled'],
        )
        : { status: 'unavailable', reason: 'baseline_unavailable' },
      asOf: current.asOf,
    }
  } catch (error) {
    logger?.warn?.('yootun dashboard: montage series failed: %s', safeError(error))
    return failed(error?.name === 'TimeoutError' ? 'montage_timeout' : 'montage_request_failed')
  }
}

async function fetchMontageSeries(fetchImpl, apiKey, start, end) {
  const url = new URL(MONTAGE_SERIES_URL)
  url.searchParams.set('start', start)
  url.searchParams.set('end', end)
  url.searchParams.set('timezone', TIME_ZONE)
  const response = await timedFetch(fetchImpl, url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  if (!response.ok) return { ok: false, status: response.status }
  const payload = await response.json()
  const data = payload?.data
  if (!data || typeof data !== 'object') return { ok: false, status: 0, reason: 'montage_invalid_response' }
  const keys = ['queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancel_requested', 'cancelled']
  const days = list(data.days).map(day => {
    const row = { date: string(day?.date), total: number(day?.total) }
    for (const key of keys) row[key] = number(day?.[key])
    return row
  })
  const statusCounts = {}
  for (const key of keys) statusCounts[key] = number(data.statusCounts?.[key])
  const stageStats = list(data.stageStats).map(stage => ({
    stage: string(stage?.stage),
    count: number(stage?.count),
    succeeded: number(stage?.succeeded),
    failed: number(stage?.failed),
    durationP50Ms: stage?.durationP50Ms === null || stage?.durationP50Ms === undefined ? null : number(stage.durationP50Ms),
    durationP95Ms: stage?.durationP95Ms === null || stage?.durationP95Ms === undefined ? null : number(stage.durationP95Ms),
  }))
  return { ok: true, days, statusCounts, stageStats, asOf: payload?.meta?.generatedAt || payload?.meta?.asOf || '' }
}

function baselineBuckets(merged, window) {
  const rows = []
  for (const [date, bucket] of merged.entries()) {
    if (date >= window.baselineStartDate && date < window.startDate) rows.push(bucket)
  }
  return rows
}

function sumBuckets(days) {
  const totals = { articles: 0, published: 0, views: 0, failedTasks: 0 }
  for (const day of days) {
    totals.articles += number(day.articles)
    totals.published += number(day.published)
    totals.views += number(day.views)
    totals.failedTasks += number(day.failedTasks)
  }
  return totals
}

function sumBucketList(days) {
  const totals = { sessions: 0, turns: 0, completedTurns: 0, failedTurns: 0, toolCalls: 0 }
  for (const day of days) {
    for (const key of Object.keys(totals)) totals[key] += number(day[key])
  }
  return totals
}

function sumOf(days, key) {
  return days.reduce((sum, day) => sum + number(day[key]), 0)
}

// 环比：服务端（Host）按同一时区窗口计算，前端不自行猜基线。
function buildComparison(current, baseline, keys) {
  if (!baseline) return { status: 'unavailable', reason: 'baseline_unavailable' }
  const delta = {}
  const deltaPercent = {}
  for (const key of keys) {
    const base = number(baseline[key])
    const value = number(current[key])
    delta[key] = value - base
    deltaPercent[key] = base > 0 ? Math.round(((value - base) / base) * 100) : null
  }
  return { status: 'ready', baseline, delta, deltaPercent }
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
