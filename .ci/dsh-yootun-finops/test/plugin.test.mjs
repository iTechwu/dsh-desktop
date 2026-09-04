import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

// Host harness: captures every registered route by path so both the legacy
// range endpoint and the series endpoint are reachable in one apply() call.
function hostRoute(overrides) {
  const routes = new Map()
  const promise = import('../index.js').then(({ apply: applyHost }) => {
    applyHost({
      credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
      effect(factory) { return factory() },
      logger: { warn() {} },
      webServer: { register(value) { routes.set(value.path, value); return () => {} } },
      ...overrides.context,
    }, { fetch: overrides.fetch, now: overrides.now, ...overrides.options })
    return routes
  })
  return promise.then(routes => routes.get(overrides.path || '/api/desktop/yootun/finops'))
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function usagePayload(summary, byModel = []) {
  return { object: 'yootun.usage_range', currency: 'CNY', summary, byModel }
}

function dailyPayload({ budgets = [], byRoute = [], requests = 0, cost = 0, totalTokens = 0, dates = [] } = {}) {
  return {
    object: 'yootun.usage_daily',
    timeZone: 'Asia/Shanghai',
    currency: 'CNY',
    attribution: { scope: 'key', principal: { type: 'member', ownerType: 'human', id: 'member-1' } },
    days: dates.map(date => ({
      date, requests, successfulRequests: requests, inputTokens: totalTokens, outputTokens: 0,
      totalTokens, cost, latencyP50Ms: 820, latencyP95Ms: 2400,
    })),
    byRoute,
    budgets,
  }
}

test('publishes a web FinOps plugin with a bundle patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-finops')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('keeps cost data source-bound and free of credentials or direct providers', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['/api/desktop/yootun/finops', 'alerts', 'sourceReady', 'sourceUnavailable', 'sourceError']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  for (const token of ['realtime', 'yesterday', 'week', 'RangeControl', 'TrendChart', 'ModelMix', 'BudgetPanel', 'sourceWarning', 'sourceCompleteness', 'noBudget', 'SeriesView', 'comparison']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /MODELS_API_KEY|api\.deepseek\.com|password|cookie/iu)
})

test('uses only DSH alpha3 exported icons', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'))
  }
})

test('host endpoint serves real model spend and budget health from Models', async () => {
  const requests = []
  const route = await hostRoute({
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      if (String(url).includes('/usage/daily')) {
        return jsonResponse(dailyPayload({
          budgets: [{ name: '月度预算', type: 'team', period: 'monthly', limit: 100, used: 50, currency: 'CNY' }],
          dates: ['2026-09-01'],
        }))
      }
      return jsonResponse(usagePayload(
        { requests: 3, successfulRequests: 2, totalTokens: 120, cost: 0.5 },
        [{ model: 'glm-5.2', requests: 3, totalTokens: 120, cost: 0.5 }],
      ))
    },
    now: () => new Date('2026-09-02T01:30:00.000Z'),
  })

  assert.equal(route.path, '/api/desktop/yootun/finops')
  const response = await invokeRoute(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.source.status, 'ready')
  assert.equal(response.body.summary.spend, 'CNY 0.50')
  assert.equal(response.body.summary.alerts, 0)
  assert.equal(response.body.models[0].name, 'glm-5.2')
  assert.equal(response.body.models[0].costPerRequest, 0.1667)
  assert.equal(response.body.budget.status, 'ready')
  assert.equal(response.body.budget.items[0].usageRatio, 0.5)
  assert.equal(response.body.budget.items[0].status, 'healthy')
  const usageCall = requests.find(item => item.url.includes('/yootun/usage?'))
  assert.match(usageCall.url, /^https:\/\/ixicai\.cn\/api\/v1\/yootun\/usage\?/)
  assert.equal(usageCall.init.headers.Authorization, 'Bearer test-model-key')
  assert.ok(requests.every(item => !item.url.includes('test-model-key')), 'credential must stay out of URLs')
})

test('budget states map from server ratios without client estimation', async () => {
  const route = await hostRoute({
    fetch: async url => {
      if (String(url).includes('/usage/daily')) {
        return jsonResponse(dailyPayload({
          budgets: [
            { name: 'healthy', type: 'team', period: 'monthly', limit: 100, used: 59.9, currency: 'CNY' },
            { name: 'warning', type: 'team', period: 'monthly', limit: 100, used: 60, currency: 'CNY' },
            { name: 'critical', type: 'team', period: 'monthly', limit: 100, used: 90, currency: 'CNY' },
            { name: 'exceeded', type: 'team', period: 'monthly', limit: 100, used: 105, currency: 'CNY' },
          ],
          dates: ['2026-09-01'],
        }))
      }
      return jsonResponse(usagePayload({ requests: 1, cost: 0.1 }))
    },
    now: () => new Date('2026-09-02T01:30:00.000Z'),
  })
  const response = await invokeRoute(route, 'GET')
  assert.deepEqual(response.body.budget.items.map(item => item.status), ['healthy', 'warning', 'critical', 'exceeded'])
})

test('budget failure degrades alone while spend keeps rendering', async () => {
  const route = await hostRoute({
    fetch: async url => {
      if (String(url).includes('/usage/daily')) return jsonResponse({ code: 500, msg: 'Database Query Error' }, 500)
      return jsonResponse(usagePayload({ requests: 2, successfulRequests: 2, totalTokens: 40, cost: 0.2 }))
    },
    now: () => new Date('2026-09-02T01:30:00.000Z'),
  })
  const response = await invokeRoute(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.source.status, 'ready')
  assert.equal(response.body.summary.cost, 0.2)
  assert.equal(response.body.budget.status, 'unavailable')
  assert.equal(response.body.budget.reason, 'billing_http_500')
  assert.deepEqual(response.body.budgets, [])
})

test('host endpoint isolates usage failures without fake spend numbers', async () => {
  const route = await hostRoute({
    fetch: async () => new Response('upstream failed', { status: 502 }),
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })
  const response = await invokeRoute(route, 'GET')
  assert.equal(response.status, 200)
  assert.equal(response.body.source.status, 'error')
  assert.equal(response.body.source.reason, 'billing_http_502')
  assert.deepEqual(response.body.models, [])
  assert.equal(response.body.summary.spend, undefined)
  assert.equal(response.body.budget.status, 'unavailable')
})

test('supports realtime and week ranges while authenticating every Models request', async () => {
  const requests = []
  const route = await hostRoute({
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      if (String(url).includes('/usage/daily')) {
        return jsonResponse(dailyPayload({
          dates: ['2026-09-02'],
          budgets: [{ name: '月度预算', type: 'team', period: 'monthly', limit: 200, used: 150, currency: 'CNY' }],
        }))
      }
      const query = new URL(String(url)).searchParams
      const start = query.get('start')
      const requestsForDay = start?.includes('2026-08-31') ? 2 : 1
      return jsonResponse(usagePayload(
        { requests: requestsForDay, successfulRequests: requestsForDay, inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.25 },
        [{ model: 'glm-5.2', requests: requestsForDay, totalTokens: 15, cost: 0.25 }],
      ))
    },
    now: () => new Date('2026-09-02T04:30:00.000Z'),
  })

  const realtime = await invokeRoute(route, 'GET', '/api/desktop/yootun/finops?range=realtime')
  assert.equal(realtime.status, 200)
  assert.equal(realtime.body.period.range, 'realtime')
  assert.equal(realtime.body.source.status, 'ready')
  assert.equal(realtime.body.summary.cost, 0.25)
  assert.equal(realtime.body.budget.status, 'ready')
  assert.equal(realtime.body.budget.items[0].status, 'warning')

  const week = await invokeRoute(route, 'GET', '/api/desktop/yootun/finops?range=week')
  assert.equal(week.status, 200)
  assert.equal(week.body.period.range, 'week')
  assert.equal(week.body.period.grain, 'day')
  assert.equal(week.body.summary.requests, 4)
  assert.equal(week.body.summary.cost, 0.75)
  assert.ok(week.body.series.length >= 2)
  assert.ok(requests.length >= 3)
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer test-model-key'))
  assert.ok(requests.every(item => !item.url.includes('test-model-key')))
})

test('rejects unknown ranges before reading Models data', async () => {
  let reads = 0
  const route = await hostRoute({
    fetch: async () => { reads += 1; return new Response('{}') },
    now: () => new Date('2026-09-01T01:30:00.000Z'),
  })
  const response = await invokeRoute(route, 'GET', '/api/desktop/yootun/finops?range=month')
  assert.equal(response.status, 400)
  assert.equal(reads, 0)
})

test('keeps valid week points when one authenticated period fails', async () => {
  const route = await hostRoute({
    fetch: async url => {
      if (String(url).includes('/usage/daily')) return jsonResponse(dailyPayload({ dates: ['2026-09-01'] }))
      const start = new URL(String(url)).searchParams.get('start')
      if (start?.includes('2026-08-31T16:00:00.000Z')) return new Response('failed', { status: 503 })
      return jsonResponse(usagePayload({ requests: 1, cost: 0.1 }, []))
    },
    now: () => new Date('2026-09-02T04:30:00.000Z'),
  })
  const response = await invokeRoute(route, 'GET', '/api/desktop/yootun/finops?range=week')
  assert.equal(response.status, 200)
  assert.equal(response.body.source.status, 'warning')
  assert.equal(response.body.source.sourceCompleteness, 'partial')
  assert.equal(response.body.summary.requests, 2)
  assert.equal(response.body.series.find(row => row.date === '2026-09-01').status, 'error')
  assert.equal(response.body.series.find(row => row.date === '2026-09-01').cost, null)
})

test('series endpoint returns day buckets, comparison, and budgets', async () => {
  const requests = []
  const route = await hostRoute({
    path: '/api/desktop/yootun/finops/series',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init })
      const start = new URL(String(url)).searchParams.get('start') || ''
      if (start.includes('2026-08-27')) {
        return jsonResponse(dailyPayload({
          requests: 4, cost: 2, totalTokens: 500,
          dates: ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'],
          budgets: [{ name: '月度预算', type: 'team', period: 'monthly', limit: 100, used: 50, currency: 'CNY' }],
          byRoute: [{ route: '/v1/chat/completions', requests: 20, successfulRequests: 19, totalTokens: 500, cost: 2 }],
        }))
      }
      return jsonResponse(dailyPayload({ requests: 2, cost: 1, totalTokens: 300, dates: ['2026-08-20', '2026-08-21'] }))
    },
    now: () => new Date('2026-09-02T04:30:00.000Z'),
  })

  const response = await invokeRoute(route, 'GET', '/api/desktop/yootun/finops/series?days=7')
  assert.equal(response.status, 200)
  assert.equal(response.body.period.label, '近7天')
  assert.equal(response.body.period.grain, 'day')
  assert.equal(response.body.source.status, 'ready')
  assert.equal(response.body.series.length, 7)
  assert.equal(response.body.summary.cost, 14)
  assert.equal(response.body.summary.requests, 28)
  assert.equal(response.body.comparison.status, 'ready')
  assert.equal(response.body.comparison.fields.cost.value, 14)
  assert.equal(response.body.comparison.fields.cost.baseline, 2)
  assert.equal(response.body.comparison.fields.cost.deltaPercent, 600)
  assert.equal(response.body.budget.items[0].status, 'healthy')
  assert.equal(response.body.byRoute[0].route, '/v1/chat/completions')
  assert.equal(response.body.attribution.scope, 'key')
  assert.equal(requests.length, 2)
  assert.ok(requests.every(item => item.init.headers.Authorization === 'Bearer test-model-key'))
  assert.ok(requests.every(item => !item.url.includes('test-model-key')))
})

test('series endpoint validates parameters before contacting Models', async () => {
  let reads = 0
  const route = await hostRoute({
    path: '/api/desktop/yootun/finops/series',
    fetch: async () => { reads += 1; return jsonResponse({}) },
    now: () => new Date('2026-09-02T04:30:00.000Z'),
  })
  for (const query of ['?days=8', '?days=abc', '?grain=hour', '?start=2026-09-01T00:00:00%2B08:00', '?days=7&grain=hour']) {
    const response = await invokeRoute(route, 'GET', `/api/desktop/yootun/finops/series${query}`)
    assert.equal(response.status, 400, query)
  }
  const overflow = await invokeRoute(route, 'GET', '/api/desktop/yootun/finops/series?start=2026-01-01T00:00:00%2B08:00&end=2026-03-01T00:00:00%2B08:00')
  assert.equal(overflow.status, 400)
  assert.equal(reads, 0)
})

test('series endpoint degrades the baseline alone when the previous window fails', async () => {
  const route = await hostRoute({
    path: '/api/desktop/yootun/finops/series',
    fetch: async url => {
      const start = new URL(String(url)).searchParams.get('start') || ''
      if (start.includes('2026-08-27')) return jsonResponse(dailyPayload({ requests: 4, cost: 2, dates: ['2026-08-28', '2026-08-29'] }))
      return new Response('baseline failed', { status: 503 })
    },
    now: () => new Date('2026-09-02T04:30:00.000Z'),
  })
  const response = await invokeRoute(route, 'GET', '/api/desktop/yootun/finops/series?days=7')
  assert.equal(response.status, 200)
  assert.equal(response.body.source.status, 'ready')
  assert.equal(response.body.comparison.status, 'unavailable')
  assert.equal(response.body.comparison.reason, 'baseline_unavailable')
  assert.equal(response.body.series.length, 2)
})

test('series endpoint isolates auth failures without fake series values', async () => {
  const route = await hostRoute({
    path: '/api/desktop/yootun/finops/series',
    fetch: async () => new Response('denied', { status: 403 }),
    now: () => new Date('2026-09-02T04:30:00.000Z'),
  })
  const response = await invokeRoute(route, 'GET', '/api/desktop/yootun/finops/series?days=30')
  assert.equal(response.status, 200)
  assert.equal(response.body.source.status, 'unavailable')
  assert.equal(response.body.source.reason, 'billing_auth_unavailable')
  assert.deepEqual(response.body.series, [])
  assert.equal(response.body.comparison.status, 'unavailable')
  assert.equal(response.body.budget.status, 'unavailable')
})

async function invokeRoute(route, method, url) {
  let status = 0
  let raw = ''
  const req = { method, url: url || route.path, headers: {} }
  const res = {
    writeHead(value, headers) {
      status = value
      if (headers && headers.Allow) req.allowed = headers.Allow
      return this
    },
    end(value = '') { raw += value },
  }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined }
}
