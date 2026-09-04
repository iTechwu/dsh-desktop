import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { apply as applyHost } from '../index.js'

const root = new URL('../', import.meta.url)

test('publishes a standalone DSH dashboard client plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-dashboard')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
})

test('host plugin unregisters both dashboard routes on disposal', () => {
  const disposed = []
  const dispose = applyHost({
    credentials: {},
    effect(factory) { return factory() },
    sessionPersistence: {},
    tools: {},
    webServer: {
      register({ path }) { return () => disposed.push(path) },
    },
  })

  dispose()
  assert.deepEqual(disposed, [
    '/api/desktop/yootun/dashboard/series',
    '/api/desktop/yootun/dashboard/yesterday',
  ])
})

test('renders all requested dashboard domains and explicit source states', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of [
    'YOOTUN_DASHBOARD_PATH', 'sidebar.footer.action', 'shell.overlay',
    "id: 'overview'", "id: 'geo'", "id: 'usage'", "id: 'activity'", "id: 'montage'", 'source?.reason', "tabOverview: 'Overview'", 'capabilities', 'knowledge', 'openmontage', 'MontageView', 'pendingApprovals',
    // P0 验收：状态语义、健康摘要、异常队列、基线占位与 tab 可达性
    "'aria-current'", 'noBaseline', 'attentionItems', 'HealthStrip', 'DomainCard', 'ShareBar',
    'metricDisplay', 'missingFields', 'asOfLabel', 'refreshing', 'sourcePartial', 'workerDown',
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  // 健康状态必须是固定枚举精确匹配，未知值保守映射为 unavailable，不得用自然语言正则默认 ready
  assert.match(source, /HEALTH_STATES = \{/)
  assert.match(source, /'not ready': 'error'/u)
  assert.doesNotMatch(source, /\/ready\|ok\|healthy/)
  assert.doesNotMatch(source, /prompt|private answer|providerKey/i)
})

test('dashboard UI uses one spacing rhythm across desktop and mobile breakpoints', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /--yd-space-1:4px/)
  assert.match(source, /--yd-space-4:16px/)
  assert.match(source, /--yd-space-6:24px/)
  assert.match(source, /--yd-content-gutter:24px/)
  assert.match(source, /--yd-control-height:34px/)
  assert.match(source, /--yd-row-height:48px/)
  assert.match(source, /\.yd-detail-stack\{display:grid;gap:var\(--yd-space-6\)/)
  assert.match(source, /\.yd-geo-detail \.yd-inline-empty\{display:flex;min-height:var\(--yd-row-height\)/)
  assert.match(source, /\.yd-geo-detail>\.yd-table-section>\.yd-list>\.yd-share\{min-height:var\(--yd-row-height\)/)
  assert.match(source, /yd-usage-detail/)
  assert.match(source, /yd-montage-detail/)
  assert.match(source, /\.yd-montage-detail>\.yd-activity-grid\{margin-top:0\}/)
  assert.match(source, /\.yd-table-row\.yd-table-head\{min-height:var\(--yd-control-height\)\}/)
  assert.match(source, /const emptyCompact = compact && status === 'empty'/)
  assert.match(source, /sourceEmptyContext/)
  assert.match(source, /@media\(max-width:800px\)\{\.yd-overlay\{--yd-content-gutter:16px\}/)
  assert.match(source, /style\.textContent = css \+ spacingCss \+ capabilityCss/)
})

test('loads and registers the sidebar action and global overlay', async () => {
  const bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  let plugin
  const registrations = []
  const document = {
    createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
    head: { appendChild() {} },
  }
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        plugin = factory(specifier => {
          if (specifier === 'react') return {
            createElement() {}, useEffect() {}, useMemo() {}, useState() {}, useSyncExternalStore() {},
          }
          if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return Object.fromEntries([
            'IconAgentPresetOutline16', 'IconArchiveOutline20', 'IconBrowseOutline16', 'IconCheckOutline16',
            'IconChecklistOutline14', 'IconChevronRightOutline14', 'IconClockOutline16', 'IconCloseOutline16',
            'IconCodeOutline16', 'IconDatabaseOutline16', 'IconDataOutline16', 'IconEditOutline16',
            'IconEnhanceOutline16', 'IconLoadingOutline16', 'IconPlayOutline16', 'IconQueueOutline14',
            'IconRefreshOutline16', 'IconSendOutline16', 'IconSettingsOutline16', 'IconSparkle16',
            'IconWarningOutline16', 'Tooltip',
          ].map(name => [name, () => {}]))
          throw new Error(`unexpected module ${specifier}`)
        })
      },
    },
  }
  vm.runInNewContext(bundle, { AbortController, document, fetch() {}, window })
  assert.deepEqual([...plugin.inject], ['slots', 'locale'])
  plugin.apply({
    effect(factory) { factory() },
    locale: { bind: () => key => key, register: () => () => {} },
    slots: {
      inject(_name, factory) { factory() },
      register(options) {
        assert.equal(options.id, 'dofe-yootun-dashboard')
        registrations.push(options.name)
        return () => {}
      },
    },
  })
  assert.deepEqual(registrations, ['sidebar.footer.action', 'shell.overlay'])
})

test('host endpoint reads yesterday GEO analytics through the unified MCP gateway', async () => {
  let route
  const requests = []
  const ctx = {
    credentials: {
      async resolve(ref) {
        assert.equal(ref, 'MODELS_API_KEY')
        return { value: 'test-model-key', source: 'memory' }
      },
    },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: {
      async list() { return [] },
    },
    tools: {
      schemas() { return [{ name: 'mcp__knowledge__search' }, { name: 'mcp__georank__diagnose' }, { name: 'mcp__openmontage__render' }] },
    },
    webServer: {
      register(value) {
        if (value.path === '/api/desktop/yootun/dashboard/yesterday') route = value
        return () => {}
      },
    },
  }
  applyHost(ctx, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      if (String(url) === 'https://ixicai.cn/mcp/geoflow') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'yootun-dashboard',
          result: {
            structuredContent: {
              tenant_id: 'tenant-a',
              kpis: { articles: 3, published: 2, failed_tasks: 1 },
              traffic: { kpis: { pv: 27 } },
              top_content: [],
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(url).startsWith('https://ixicai.cn/api/v1/yootun/usage?')) {
        return new Response(JSON.stringify({
          currency: 'CNY',
          summary: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
          byModel: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(url) === 'https://ixicai.cn/api/yootun/v1/montage/overview') {
        return new Response(JSON.stringify({
          data: {
            jobs: { total: 12, queued: 2, running: 3, completed: 5, failed: 2 },
            pendingApprovals: 1,
            recentJobs: [{ id: 'job-1', title: '参考片克隆', status: 'running', stage: 'vision', updatedAt: '2026-09-01T00:00:00Z' }],
            artifacts: { total: 7, recent: [{ id: 'a-1', jobId: 'job-1', kind: 'mp4', title: '成片', createdAt: '2026-09-01T01:00:00Z' }] },
            health: { service: 'ready', workers: [{ id: 'worker-1', status: 'healthy' }] },
          },
          meta: { source: 'montage', requestId: 'r-montage', generatedAt: '2026-09-01T00:00:00.000Z' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected URL ${String(url)}`)
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  assert.equal(route.kind, 'exact')
  assert.equal(route.path, '/api/desktop/yootun/dashboard/yesterday')
  const response = await invokeRoute(route, 'POST')
  assert.equal(response.status, 200)
  assert.equal(response.body.period.date, '2026-08-31')
  assert.equal(response.body.geo.status, 'ready')
  assert.equal(response.body.geo.data.tenant_id, 'tenant-a')
  assert.equal(response.body.geo.data.kpis.total_views, 27)
  assert.equal(response.body.usage.status, 'empty')
  assert.equal(response.body.activity.status, 'empty')
  // P0 来源元数据：每个 source 带 source/asOf/sourceCompleteness，缺失字段不静默变 0
  assert.equal(response.body.geo.source, 'geoflow')
  assert.equal(response.body.geo.sourceCompleteness, 'complete')
  assert.deepEqual(response.body.geo.missingFields, [])
  assert.equal(response.body.usage.source, 'models')
  assert.equal(response.body.usage.sourceCompleteness, 'complete')
  assert.equal(response.body.montage.source, 'openmontage')
  assert.equal(response.body.montage.asOf, '2026-09-01T00:00:00.000Z')
  assert.equal(response.body.montage.sourceCompleteness, 'complete')
  assert.equal(response.body.activity.source, 'local_agent')
  assert.equal(response.body.activity.sourceCompleteness, 'complete')
  for (const key of ['geo', 'usage', 'activity', 'montage']) assert.ok(response.body[key].asOf)
  assert.equal(response.body.capabilities.tools.status, 'ready')
  assert.equal(response.body.capabilities.knowledge.status, 'ready')
  assert.equal(response.body.capabilities.georank.status, 'ready')
  assert.equal(requests[0].url, 'https://ixicai.cn/mcp/geoflow')
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-model-key')
  assert.deepEqual(JSON.parse(requests[0].init.body).params, {
    name: 'geoflow.analytics.overview',
    arguments: { preset: 'yesterday' },
  })
  const montageRequest = requests.find(request => request.url === 'https://ixicai.cn/api/yootun/v1/montage/overview')
  assert.equal(montageRequest.init.headers.Authorization, 'Bearer test-model-key')
  assert.equal(montageRequest.init.method, undefined)
  assert.ok(requests.every(request => !/172\.30\.30\.11|127\.0\.0\.1|\.local\.dofe\.ai/u.test(request.url)))
})

test('host endpoint reads the montage overview through the public API contract envelope', async () => {
  let route
  applyHost({
    credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: { async list() { return [] } },
    tools: { schemas() { return [] } },
    webServer: {
      register(value) {
        if (value.path === '/api/desktop/yootun/dashboard/yesterday') route = value
        return () => {}
      },
    },
  }, {
    fetch: async url => {
      if (String(url) === 'https://ixicai.cn/api/yootun/v1/montage/overview') {
        return new Response(JSON.stringify({
          data: {
            jobs: { total_count: 9, statuses: { queued: 1, running: 2, completed: 4, failed: 2 } },
            pending_approvals: 3,
            recent_jobs: [{ id: 7, name: '爆款复刻', status: 'running', current_stage: 'asr', updated_at: '2026-09-01T02:00:00Z' }],
            artifacts: { total: 5, recent: [{ artifact_id: 'a-9', job_id: '7', type: 'mp4', name: '剪辑成片', created_at: '2026-09-01T03:00:00Z' }] },
            service_health: { status: 'ready', workers: [{ worker_id: 'w-2', state: 'down' }] },
          },
          meta: { source: 'montage', requestId: 'r-snake', generatedAt: '2026-09-01T00:00:00.000Z' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        currency: 'CNY', summary: { requests: 1, totalTokens: 9, cost: 0.01 }, byModel: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  const response = await invokeRoute(route, 'POST')
  assert.equal(response.status, 200)
  assert.equal(response.body.montage.status, 'ready')
  const montage = response.body.montage.data
  assert.deepEqual(montage.jobs, { total: 9, queued: 1, running: 2, completed: 4, failed: 2 })
  assert.equal(montage.pendingApprovals, 3)
  assert.deepEqual(montage.recentJobs, [{ id: '7', title: '爆款复刻', status: 'running', stage: 'asr', updatedAt: '2026-09-01T02:00:00Z' }])
  assert.deepEqual(montage.artifacts, { total: 5, recent: [{ id: 'a-9', jobId: '7', kind: 'mp4', title: '剪辑成片', createdAt: '2026-09-01T03:00:00Z' }] })
  assert.deepEqual(montage.health, { service: 'ready', workers: [{ id: 'w-2', status: 'down', lastHeartbeatAt: '' }] })
  // approvals 等待元数据：无字段时为空值而不是伪造数字
  assert.deepEqual(montage.approvals, { oldestWaitingAt: '', waitP50Ms: null, waitP95Ms: null })
  assert.ok(!JSON.stringify(response.body).includes('test-model-key'))
})

test('host endpoint isolates an MCP failure without losing other dashboard sources', async () => {
  let route
  applyHost({
    credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: { async list() { return [] } },
    webServer: {
      register(value) {
        if (value.path === '/api/desktop/yootun/dashboard/yesterday') route = value
        return () => {}
      },
    },
  }, {
    fetch: async url => {
      if (String(url).includes('/mcp/geoflow')) return new Response('upstream failed', { status: 502 })
      if (String(url).includes('/api/yootun/v1/montage/')) return new Response('upstream failed', { status: 503 })
      return new Response(JSON.stringify({
        currency: 'CNY', summary: { requests: 1, totalTokens: 9, cost: 0.01 }, byModel: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  const response = await invokeRoute(route, 'POST')
  assert.equal(response.status, 200)
  assert.equal(response.body.geo.status, 'error')
  assert.equal(response.body.geo.reason, 'geoflow_http_502')
  assert.equal(response.body.montage.status, 'error')
  assert.equal(response.body.montage.reason, 'montage_http_503')
  assert.equal(response.body.usage.status, 'ready')
  // 失败源不能伪装成完整数据
  assert.equal(response.body.geo.sourceCompleteness, 'unknown')
  assert.equal(response.body.montage.sourceCompleteness, 'unknown')
})

test('host endpoint reports partial completeness when upstream omits fields', async () => {
  let route
  applyHost({
    credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: { async list() { return [] } },
    tools: { schemas() { return [] } },
    webServer: {
      register(value) {
        if (value.path === '/api/desktop/yootun/dashboard/yesterday') route = value
        return () => {}
      },
    },
  }, {
    fetch: async url => {
      if (String(url) === 'https://ixicai.cn/mcp/geoflow') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'yootun-dashboard',
          result: { structuredContent: { tenant_id: 'tenant-a', kpis: { articles: 2 }, top_content: [] } },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(url) === 'https://ixicai.cn/api/yootun/v1/montage/overview') {
        return new Response(JSON.stringify({
          data: {
            jobs: { total: 4, queued: 1, running: 1, completed: 2, failed: 0 },
            pendingApprovals: 0,
          },
          meta: { source: 'montage', requestId: 'r-partial' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        currency: 'CNY', summary: { requests: 2, totalTokens: 18, cost: 0.02 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  const response = await invokeRoute(route, 'POST')
  assert.equal(response.status, 200)
  // GEO 缺浏览量：仍是 ready，但必须标 partial，且不能伪造 total_views=0
  assert.equal(response.body.geo.status, 'ready')
  assert.equal(response.body.geo.sourceCompleteness, 'partial')
  assert.deepEqual(response.body.geo.missingFields, ['kpis.total_views'])
  assert.equal(Object.hasOwn(response.body.geo.data.kpis, 'total_views'), false)
  // Montage 缺 artifacts/health
  assert.equal(response.body.montage.sourceCompleteness, 'partial')
  assert.deepEqual(response.body.montage.missingFields, ['artifacts', 'health'])
  // Models 缺 byModel
  assert.equal(response.body.usage.sourceCompleteness, 'partial')
  assert.deepEqual(response.body.usage.missingFields, ['byModel'])
})

test('host endpoint exposes the GEORank benchmark as an isolated GEO source', async () => {
  let route
  const requests = []
  applyHost({
    credentials: { async resolve() { return { value: 'test-model-key' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: { async list() { return [] } },
    tools: { schemas() { return [{ name: 'mcp__georank__get_company' }] } },
    webServer: { register(value) { if (value.path === '/api/desktop/yootun/dashboard/yesterday') route = value; return () => {} } },
  }, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      if (String(url) === 'https://ixicai.cn/mcp/geoflow') return new Response(JSON.stringify({ jsonrpc: '2.0', result: { structuredContent: { kpis: { articles: 1, published: 1, total_views: 2, failed_tasks: 0 }, top_content: [] } } }), { status: 200 })
      if (String(url) === 'https://ixicai.cn/mcp/georank') {
        const body = JSON.parse(init.body)
        if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), { status: 200, headers: { 'mcp-session-id': 'session-1' } })
        if (body.method === 'notifications/initialized') return new Response('', { status: 202 })
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { structuredContent: { score: 90, reasons: ['检测到站点 URL'], suggestions: ['发布 llms.txt'] } } }), { status: 200 })
      }
      if (String(url) === 'https://ixicai.cn/api/yootun/v1/georank/overview') return new Response(JSON.stringify({ data: { scope: 'public_directory', totals: { publishedCompanies: 10, scoredCompanies: 8 }, averageGeoScore: 72.5, scoreDistribution: { good: 5, excellent: 3 }, recentCompanies: [{ id: 'c-1', name: '示例品牌', geoScore: 81, isGeoCertified: true }] }, meta: { generatedAt: '2026-09-03T00:00:00Z' } }), { status: 200 })
      if (String(url) === 'https://ixicai.cn/api/yootun/v1/montage/overview') return new Response(JSON.stringify({ data: { jobs: { total: 0 }, pendingApprovals: 0, artifacts: {}, health: {} }, meta: {} }), { status: 200 })
      return new Response(JSON.stringify({ summary: { requests: 0, totalTokens: 0, cost: 0 }, byModel: [] }), { status: 200 })
    },
    now: () => new Date('2026-09-03T01:30:00Z'),
  })
  const response = await invokeRoute(route, 'POST')
  assert.equal(response.status, 200)
  assert.equal(response.body.georank.status, 'ready')
  assert.equal(response.body.georank.data.averageGeoScore, 72.5)
  assert.equal(response.body.georank.data.benchmarkScore, 90)
  assert.equal(response.body.georank.data.benchmarkBasis, 'youhuitun_ai_friendliness')
  assert.equal(response.body.georank.data.totals.scoredCompanies, 8)
  const request = requests.find(item => item.url === 'https://ixicai.cn/api/yootun/v1/georank/overview')
  assert.equal(request.init.headers.Authorization, 'Bearer test-model-key')
  assert.ok(!JSON.stringify(response.body).includes('test-model-key'))
})

test('host endpoint preserves missing montage counts as null instead of zero', async () => {
  let route
  applyHost({
    credentials: { async resolve() { return { value: 'test-model-key' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: { async list() { return [] } },
    webServer: {
      register(value) {
        if (value.path === '/api/desktop/yootun/dashboard/yesterday') route = value
        return () => {}
      },
    },
  }, {
    fetch: async url => {
      if (String(url).includes('/mcp/geoflow')) return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 'yootun-dashboard', result: { structuredContent: {
          kpis: { articles: 1, published: 0, total_views: 0, failed_tasks: 0 }, top_content: [],
        } },
      }), { status: 200 })
      if (String(url).includes('/montage/overview')) return new Response(JSON.stringify({
        data: { pendingApprovals: 0 }, meta: {},
      }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ summary: { requests: 0, totalTokens: 0, cost: 0 }, byModel: [] }), { status: 200 })
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  const response = await invokeRoute(route, 'POST')
  assert.equal(response.status, 200)
  assert.equal(response.body.montage.data.jobs.total, null)
  assert.equal(response.body.montage.data.jobs.running, null)
  assert.equal(response.body.montage.data.pendingApprovals, 0)
  assert.deepEqual(response.body.montage.missingFields, ['jobs', 'artifacts', 'health'])
})

test('host endpoint returns four-source daily series with honest baselines', async () => {
  let route
  const mcpBodies = []
  const goalUrls = []
  const usageUrls = []
  const montageUrls = []
  applyHost({
    credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: {
      async list() { return [] },
    },
    tools: { schemas() { return [] } },
    webServer: {
      register(value) {
        if (value.path === '/api/desktop/yootun/dashboard/series') route = value
        return () => {}
      },
    },
  }, {
    fetch: async (url, init) => {
      const target = String(url)
      if (target === 'https://ixicai.cn/mcp/geoflow') {
        mcpBodies.push(JSON.parse(init.body))
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'yootun-dashboard-series',
          result: {
            structuredContent: {
              tenant_id: 'tenant-a',
              publication_trend: [
                { date: '2026-08-26', created: 2, published: 1 },
                { date: '2026-08-19', created: 4, published: 2 },
              ],
              task_trend: [{ date: '2026-08-26', completed: 1, failed: 1 }],
              traffic: { traffic_trend: [{ date: '2026-08-26', pv: 27, ai_bot_pv: 3 }] },
              content_funnel: { max: 4, stages: [{ key: 'created', count: 4 }, { key: 'published', count: 2 }] },
              distribution_summary: { total: 5, synced: 4, failed: 1, pending: 0, rows: [{ name: '官网', total: 5, synced: 4, failed: 1, pending: 0 }] },
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (target.startsWith('https://ixicai.cn/api/yootun/v1/geoflow/goals?')) {
        goalUrls.push(target)
        return new Response(JSON.stringify({ data: { month: '2026-09', goals: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (target.startsWith('https://ixicai.cn/api/v1/yootun/usage/daily?')) {
        usageUrls.push(target)
        const isBaseline = target.includes('start=2026-08-18')
        return new Response(JSON.stringify({
          object: 'yootun.usage_daily',
          timeZone: 'Asia/Shanghai',
          currency: 'CNY',
          attribution: { scope: 'key', principal: { type: 'member', ownerType: 'human', id: 'sso-1' } },
          days: isBaseline
            ? [{ date: '2026-08-20', requests: 6, successfulRequests: 5, inputTokens: 60, outputTokens: 20, totalTokens: 80, cost: 0.3, latencyP50Ms: 700, latencyP95Ms: 2600 }]
            : [{ date: '2026-08-31', requests: 10, successfulRequests: 9, inputTokens: 100, outputTokens: 40, totalTokens: 140, cost: 0.5, latencyP50Ms: 820, latencyP95Ms: 3100 }],
          byRoute: [{ route: '/v1/chat/completions', requests: 10, cost: 0.5 }],
          byMember: [],
          budgets: [{ name: '日常预算', type: 'cost', period: 'daily', limit: 5, used: 0.5, currency: 'CNY' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (target.startsWith('https://ixicai.cn/api/yootun/v1/montage/series?')) {
        montageUrls.push(target)
        const isBaseline = target.includes('start=2026-08-18')
        return new Response(JSON.stringify({
          data: {
            workspaceId: 'tenant:1',
            grain: 'day',
            timeZone: 'Asia/Shanghai',
            days: isBaseline
              ? [{ date: '2026-08-20', total: 1, queued: 0, running: 0, waiting_approval: 0, succeeded: 1, failed: 0, cancel_requested: 0, cancelled: 0 }]
              : [{ date: '2026-08-31', total: 3, queued: 0, running: 0, waiting_approval: 0, succeeded: 2, failed: 1, cancel_requested: 0, cancelled: 0 }],
            statusCounts: isBaseline
              ? { queued: 0, running: 0, waiting_approval: 0, succeeded: 1, failed: 0, cancel_requested: 0, cancelled: 0 }
              : { queued: 0, running: 0, waiting_approval: 0, succeeded: 2, failed: 1, cancel_requested: 0, cancelled: 0 },
            pendingApprovals: 0,
            stageStats: isBaseline ? [] : [{ stage: 'research', count: 3, succeeded: 2, failed: 0, durationP50Ms: 3600, durationP95Ms: 7200 }],
          },
          meta: { source: 'montage', requestId: 'r-series' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected URL ${target}`)
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  assert.equal(route.path, '/api/desktop/yootun/dashboard/series')
  const rejected = await invokeRoute(route, 'GET')
  assert.equal(rejected.status, 405)

  const response = await invokeRoute(route, 'POST', { days: 7 })
  assert.equal(response.status, 200)
  assert.equal(response.body.period.label, '近7天')
  assert.equal(response.body.period.days, 7)
  assert.equal(response.body.period.start, '2026-08-25T00:00:00+08:00')
  assert.equal(response.body.period.end, '2026-09-01T00:00:00+08:00')

  // GeoFlow：7 天视图请求双倍窗口 preset，按日期拆出本期/上期并零填充
  assert.deepEqual(mcpBodies[0].params.arguments, { preset: '30d' })
  assert.equal(response.body.geo.status, 'ready')
  assert.deepEqual(goalUrls, ['https://ixicai.cn/api/yootun/v1/geoflow/goals?month=2026-09'])
  assert.equal(response.body.geo.data.days.length, 7)
  assert.deepEqual(
    response.body.geo.data.days.find(day => day.date === '2026-08-26'),
    { date: '2026-08-26', articles: 2, published: 1, views: 27, failedTasks: 1 },
  )
  assert.deepEqual(
    response.body.geo.data.days.find(day => day.date === '2026-08-25'),
    { date: '2026-08-25', articles: 0, published: 0, views: 0, failedTasks: 0 },
  )
  assert.deepEqual(response.body.geo.data.totals, { articles: 2, published: 1, views: 27, failedTasks: 1 })
  // 漏斗与渠道分布原样透传
  assert.deepEqual(response.body.geo.data.insight.funnel.stages, [{ key: 'created', count: 4 }, { key: 'published', count: 2 }])
  assert.deepEqual(response.body.geo.data.insight.channels.rows, [{ name: '官网', total: 5, synced: 4, failed: 1, pending: 0 }])
  assert.equal(response.body.geo.comparison.status, 'ready')
  assert.equal(response.body.geo.comparison.baseline.articles, 4)
  assert.equal(response.body.geo.comparison.delta.articles, -2)
  assert.equal(response.body.geo.comparison.deltaPercent.articles, -50)

  // Models：当前 + 基线两次窗口调用，都在 31 天上限内
  assert.equal(usageUrls.length, 2)
  assert.ok(usageUrls[0].includes('start=2026-08-25T00%3A00%3A00%2B08%3A00'))
  assert.ok(usageUrls.every(url => url.includes('timezone=Asia%2FShanghai')))
  assert.equal(response.body.usage.status, 'ready')
  assert.deepEqual(response.body.usage.data.totals, { requests: 10, successfulRequests: 9, totalTokens: 140, cost: 0.5 })
  assert.deepEqual(response.body.usage.data.byRoute, [{ route: '/v1/chat/completions', requests: 10, cost: 0.5 }])
  assert.deepEqual(response.body.usage.data.byMember, [])
  assert.deepEqual(response.body.usage.data.budgets, [{ name: '日常预算', type: 'cost', period: 'daily', limit: 5, used: 0.5, currency: 'CNY' }])
  assert.equal(response.body.usage.data.days[0].latencyP50Ms, 820)
  assert.equal(response.body.usage.data.days[0].latencyP95Ms, 3100)
  assert.deepEqual(response.body.usage.data.principal, { type: 'member', ownerType: 'human', id: 'sso-1' })
  assert.equal(response.body.usage.comparison.delta.requests, 4)
  assert.equal(response.body.usage.comparison.deltaPercent.requests, 67)

  // 本地活动：无事件 → empty，基线为真零而不是不可用
  assert.equal(response.body.activity.status, 'empty')
  assert.equal(response.body.activity.data.days.length, 7)
  assert.equal(response.body.activity.comparison.status, 'ready')
  assert.equal(response.body.activity.comparison.delta.turns, 0)

  // Montage：窗口 totals、阶段统计与环比
  assert.equal(montageUrls.length, 2)
  assert.equal(response.body.montage.status, 'ready')
  assert.equal(response.body.montage.data.totals.total, 3)
  assert.deepEqual(response.body.montage.data.stageStats, [
    { stage: 'research', count: 3, succeeded: 2, failed: 0, durationP50Ms: 3600, durationP95Ms: 7200 },
  ])
  assert.equal(response.body.montage.comparison.delta.total, 2)
  assert.equal(response.body.montage.comparison.deltaPercent.succeeded, 100)

  for (const key of ['geo', 'usage', 'activity', 'montage']) {
    assert.equal(response.body[key].sourceCompleteness, 'complete')
    assert.ok(response.body[key].asOf)
  }
  assert.ok(!JSON.stringify(response.body).includes('test-model-key'))
})

test('host endpoint keeps series sources isolated when one upstream fails', async () => {
  let route
  applyHost({
    credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    sessionPersistence: { async list() { return [] } },
    tools: { schemas() { return [] } },
    webServer: {
      register(value) {
        if (value.path === '/api/desktop/yootun/dashboard/series') route = value
        return () => {}
      },
    },
  }, {
    fetch: async url => {
      const target = String(url)
      if (target.includes('/mcp/geoflow')) return new Response('upstream failed', { status: 502 })
      if (target.includes('/montage/series')) return new Response('upstream failed', { status: 503 })
      if (target.includes('/usage/daily')) {
        if (target.includes('scope=team')) return new Response('', { status: 403 })
        return new Response(JSON.stringify({ days: [], byRoute: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected URL ${target}`)
    },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })

  const response = await invokeRoute(route, 'POST', {})
  assert.equal(response.status, 200)
  assert.equal(response.body.period.days, 7)
  assert.equal(response.body.geo.status, 'error')
  assert.equal(response.body.geo.reason, 'geoflow_http_502')
  assert.equal(response.body.geo.sourceCompleteness, 'unknown')
  assert.equal(response.body.montage.status, 'error')
  assert.equal(response.body.montage.reason, 'montage_http_503')
  assert.equal(response.body.usage.status, 'empty')
  assert.equal(response.body.usage.comparison.status, 'ready')
  assert.equal(response.body.activity.status, 'empty')

  const teamResponse = await invokeRoute(route, 'POST', { days: 7, scope: 'team' })
  assert.equal(teamResponse.body.usage.status, 'unavailable')
  assert.equal(teamResponse.body.usage.reason, 'billing_team_forbidden')
  assert.equal(teamResponse.body.geo.status, 'error')
})

async function invokeRoute(route, method, body) {
  let status = 0
  let raw = ''
  const req = {
    method,
    headers: {},
    ...(body === undefined
      ? {}
      : {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
          },
        }),
  }
  const res = {
    writeHead(value) { status = value; return this },
    end(value = '') { raw += value },
  }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined }
}
