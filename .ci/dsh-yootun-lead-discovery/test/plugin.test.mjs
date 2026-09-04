import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply } from '../index.js'

test('lead discovery package exposes a DSH client and guarded host route', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.equal(manifest.name, '@dofe/dsh-yootun-lead-discovery')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.match(client, /cityDistribution/)
  assert.match(client, /totalAvailable/)
  assert.match(client, /sortRecent: '来源顺序'/)
  assert.match(client, /example1: 'Changsha electric SUV'/)
  assert.match(client, /role: 'dialog'/)
  assert.match(client, /event\.key === 'Escape'/)
  assert.match(client, /setLoadMoreError\(true\)/)
  assert.match(client, /response\.status !== 'ready'/)
  assert.match(client, /prev\.totalAvailable \?\? prev\.stats\?\.totalAvailable/)
  assert.match(client, /动态统计必须以当前已展示样本为准/)
  assert.match(client, /storeUnavailable/)
  assert.match(client, /searchHeading/)
  assert.match(client, /databaseSource: '定时数据'/)
  assert.match(client, /liveSource: '即时检索'/)
  assert.match(client, /yl-start-steps/)
  assert.match(client, /yl-platform-options/)
  assert.match(client, /hasResult: Boolean\(data\)/)
})

test('host delegates discover to lead_discovery_discover and forwards only safe fields', async () => {
  let route
  const calls = []
  const discoverText = JSON.stringify({
    status: { code: 'completed' },
    references: { resultRef: 'ref-abc', nextCursor: null, hasMore: false, totalAvailable: 12, retrievedAt: '2026-09-02T00:00:00Z' },
    items: [{ leadLevel: 'A', platform: 'xiaohongshu-v2', intentScore: 80, aiSummary: '想买新能源SUV', city: '长沙', budgetMin: 150000, sourceUrl: 'https://www.xiaohongshu.com/explore/1', originalText: '手机号 13800000000', leadId: 'internal-1', rawId: 'raw-1' }],
    summary: { keyword: '新能源SUV', platform: 'xiaohongshu-v2', persisted: { inserted: 1, updated: 0 } },
  })
  apply({
    tools: {
      schemas: () => [{ name: 'lead_discovery_database_search' }, { name: 'lead_discovery_discover' }, { name: 'lead_discovery_result_page_get' }, { name: 'lead_discovery_candidates_list' }],
      execute: async value => { calls.push(value); if (value.name === 'lead_discovery_database_search') return { structuredContent: { count: 0, candidates: [], dataSource: 'database' } }; return { content: [{ type: 'text', text: discoverText }, { type: 'image', data: 'secret' }] } },
    },
    webServer: { register(value) { route = value; return () => {} } },
    effect(factory) { return factory() },
  })
  const result = await invoke(route, { action: 'discover', keyword: '新能源SUV', platform: 'xiaohongshu-v2' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ready')
  assert.equal(calls[0].name, 'lead_discovery_database_search')
  assert.equal(calls[1].name, 'lead_discovery_discover')
  assert.ok(calls[1].signal instanceof AbortSignal)
  assert.equal(calls[1].signal.aborted, false)
  assert.equal(calls[1].arguments.keyword, '新能源SUV')
  assert.equal(calls[1].arguments.persist, true)
  assert.equal(typeof calls[1].arguments.idempotencyKey, 'string')
  assert.ok(calls[1].arguments.idempotencyKey.length > 0)
  assert.equal(result.body.resultRef, 'ref-abc')
  assert.equal(result.body.items.length, 1)
  assert.equal(result.body.items[0].leadLevel, 'A')
  assert.equal(result.body.items[0].sourceUrl, 'https://www.xiaohongshu.com/explore/1')
  assert.deepEqual(result.body.stats.levels, { A: 1, B: 0, C: 0, D: 0 })
  assert.equal(result.body.stats.highIntent, 1)
  assert.equal(result.body.stats.avgIntent, 80)
  assert.equal(result.body.stats.totalAvailable, 12)
  assert.equal(result.body.dataSource, 'getoneapi')
  assert.equal(result.body.retrievedAt, '2026-09-02T00:00:00Z')
  assert.deepEqual(result.body.stats.cities, [{ key: '长沙', count: 1 }])
  assert.equal(result.body.items[0].originalText, undefined)
  assert.equal(result.body.items[0].leadId, undefined)
  assert.equal(result.body.items[0].rawId, undefined)
})

test('host returns fresh database leads without calling discover', async () => {
  let route
  const calls = []
  apply({
    tools: {
      schemas: () => [{ name: 'lead_discovery_database_search' }, { name: 'lead_discovery_discover' }],
      execute: async value => { calls.push(value); return { structuredContent: { count: 1, retrievedAt: '2026-09-04T03:00:00Z', candidates: [{ leadLevel: 'A', platform: 'douyin', intentScore: 91, aiSummary: '近期计划购车' }] } } },
    },
    webServer: { register(value) { route = value; return () => {} } },
    effect(factory) { return factory() },
  })
  const result = await invoke(route, { action: 'discover', keyword: '近期购车', platform: 'douyin' })
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.dataSource, 'database')
  assert.equal(result.body.retrievedAt, '2026-09-04T03:00:00Z')
  assert.equal(result.body.items[0].intentScore, 91)
  assert.deepEqual(calls.map(call => call.name), ['lead_discovery_database_search'])
})

test('host delegates pagination and stored candidates to their read-only tools', async () => {
  let route
  const calls = []
  const pageText = JSON.stringify({ items: [{ leadLevel: 'B', platform: 'douyin', aiSummary: '对比车型' }], nextCursor: null, hasMore: false, totalAvailable: 1 })
  const candidatesText = JSON.stringify({ taskId: 'lead-discovery', count: 1, candidates: [{ leadLevel: 'A', platform: 'douyin', sourceUrl: 'https://www.douyin.com/video/1', originalText: '私信 13800000000', leadId: 'x' }] })
  apply({
    tools: {
      schemas: () => [{ name: 'lead_discovery_discover' }, { name: 'lead_discovery_result_page_get' }, { name: 'lead_discovery_candidates_list' }],
      execute: async value => { calls.push(value); const text = value.name === 'lead_discovery_result_page_get' ? pageText : candidatesText; return { content: [{ type: 'text', text }] } },
    },
    webServer: { register(value) { route = value; return () => {} } },
    effect(factory) { return factory() },
  })
  const pageResult = await invoke(route, { action: 'page', resultRef: 'ref-abc', cursor: 'cur-1' })
  assert.equal(calls[0].name, 'lead_discovery_result_page_get')
  assert.ok(calls[0].signal instanceof AbortSignal)
  assert.equal(calls[0].arguments.resultRef, 'ref-abc')
  assert.equal(calls[0].arguments.cursor, 'cur-1')
  assert.equal(pageResult.body.status, 'ready')
  assert.equal(pageResult.body.items[0].leadLevel, 'B')

  const candidatesResult = await invoke(route, { action: 'candidates' })
  assert.equal(calls[1].name, 'lead_discovery_candidates_list')
  assert.ok(calls[1].signal instanceof AbortSignal)
  assert.equal(candidatesResult.body.status, 'ready')
  assert.equal(candidatesResult.body.count, 1)
  assert.equal(candidatesResult.body.stats.highIntent, 1)
  assert.equal(candidatesResult.body.stats.platforms[0].key, 'douyin')
  assert.equal(candidatesResult.body.items[0].sourceUrl, 'https://www.douyin.com/video/1')
  assert.equal(candidatesResult.body.items[0].originalText, undefined)
  assert.equal(candidatesResult.body.items[0].leadId, undefined)
})

test('host preserves a safe MCP error category for diagnosis', async () => {
  let route
  apply({
    tools: {
      schemas: () => [{ name: 'lead_discovery_candidates_list' }],
      execute: async () => { throw new Error(JSON.stringify({ error: { code: 'RESULT_STORE_UNAVAILABLE', message: 'redacted' } })) },
    },
    webServer: { register(value) { route = value; return () => {} } },
    effect(factory) { return factory() },
  })
  const result = await invoke(route, { action: 'candidates' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { status: 'error', reason: 'RESULT_STORE_UNAVAILABLE' })
})

test('audits persisted discovery once and keeps pages and stored candidates read-only', async () => {
  let route
  const events = []
  const ctx = {
    yootunAudit: { async record(event) { events.push(event) } },
    tools: {
      schemas: () => [{ name: 'lead_discovery_discover' }, { name: 'lead_discovery_result_page_get' }, { name: 'lead_discovery_candidates_list' }],
      register() { return () => {} },
      async execute(value) {
        if (value.name === 'lead_discovery_discover') return { structuredContent: { references: { resultRef: 'result-7' }, items: [], summary: { persisted: { inserted: 3, updated: 2 }, dataSource: 'getoneapi' } } }
        if (value.name === 'lead_discovery_result_page_get') return { structuredContent: { items: [] } }
        return { structuredContent: { candidates: [] } }
      },
    },
    webServer: { register(value) { route = value; return () => {} } }, effect(factory) { return factory() },
  }
  apply(ctx)
  await invoke(route, { action: 'discover', keyword: '不得进入审计的检索正文', platform: 'douyin' })
  await invoke(route, { action: 'page', resultRef: 'result-7' })
  await invoke(route, { action: 'candidates' })
  assert.equal(events.length, 1)
  assert.deepEqual(events[0], {
    actionCode: 'lead_discovery.discovery.executed', category: 'execute',
    source: { pluginId: '@dofe/dsh-yootun-lead-discovery', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'lead_discovery', id: 'result-7' }, outcome: 'succeeded',
    changes: [{ field: 'insertedCount', after: 3 }, { field: 'updatedCount', after: 2 }], effects: [],
  })
  assert.doesNotMatch(JSON.stringify(events), /不得进入审计/u)
})

test('audits a resolved tool error as failed instead of succeeded', async () => {
  let route
  const events = []
  apply({
    yootunAudit: { async record(event) { events.push(event) } },
    tools: {
      schemas: () => [{ name: 'lead_discovery_discover' }], register() { return () => {} },
      async execute() { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'UPSTREAM_FAILED' } }) }] } },
    },
    webServer: { register(value) { route = value; return () => {} } }, effect(factory) { return factory() },
  })

  const result = await invoke(route, { action: 'discover', keyword: '失败样例' })

  assert.equal(result.body.status, 'error')
  assert.equal(events.length, 1)
  assert.equal(events[0].outcome, 'failed')
  assert.equal(events[0].errorCode, 'upstream_failed')
})

async function invoke(route, body) { let status; let raw = ''; await route.handler({ method: 'POST', body }, { writeHead(value) { status = value; return this }, end(value) { raw += value } }); return { status, body: JSON.parse(raw) } }
