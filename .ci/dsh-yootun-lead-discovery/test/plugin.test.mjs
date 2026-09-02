import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply } from '../index.js'

test('lead discovery package exposes a DSH client and guarded host route', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(manifest.name, '@dofe/dsh-yootun-lead-discovery')
  assert.equal(manifest.exports['./client'], './lib/client.js')
})

test('host delegates discover to lead_discovery_discover and forwards only safe fields', async () => {
  let route
  const calls = []
  const discoverText = JSON.stringify({
    status: { code: 'completed' },
    references: { resultRef: 'ref-abc', nextCursor: null, hasMore: false, totalAvailable: 1, retrievedAt: '2026-09-02T00:00:00Z' },
    items: [{ leadLevel: 'A', platform: 'xiaohongshu-v2', intentScore: 80, aiSummary: '想买新能源SUV', city: '长沙', budgetMin: 150000, sourceUrl: 'https://www.xiaohongshu.com/explore/1', originalText: '手机号 13800000000', leadId: 'internal-1', rawId: 'raw-1' }],
    summary: { keyword: '新能源SUV', platform: 'xiaohongshu-v2', persisted: { inserted: 1, updated: 0 } },
  })
  apply({
    tools: {
      schemas: () => [{ name: 'lead_discovery_discover' }, { name: 'lead_discovery_result_page_get' }, { name: 'lead_discovery_candidates_list' }],
      execute: async value => { calls.push(value); return { content: [{ type: 'text', text: discoverText }, { type: 'image', data: 'secret' }] } },
    },
    webServer: { register(value) { route = value; return () => {} } },
    effect(factory) { return factory() },
  })
  const result = await invoke(route, { action: 'discover', keyword: '新能源SUV', platform: 'xiaohongshu-v2' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ready')
  assert.equal(calls[0].name, 'lead_discovery_discover')
  assert.equal(calls[0].arguments.keyword, '新能源SUV')
  assert.equal(calls[0].arguments.persist, true)
  assert.equal(typeof calls[0].arguments.idempotencyKey, 'string')
  assert.ok(calls[0].arguments.idempotencyKey.length > 0)
  assert.equal(result.body.resultRef, 'ref-abc')
  assert.equal(result.body.items.length, 1)
  assert.equal(result.body.items[0].leadLevel, 'A')
  assert.equal(result.body.items[0].sourceUrl, 'https://www.xiaohongshu.com/explore/1')
  assert.equal(result.body.items[0].originalText, undefined)
  assert.equal(result.body.items[0].leadId, undefined)
  assert.equal(result.body.items[0].rawId, undefined)
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
  assert.equal(calls[0].arguments.resultRef, 'ref-abc')
  assert.equal(calls[0].arguments.cursor, 'cur-1')
  assert.equal(pageResult.body.status, 'ready')
  assert.equal(pageResult.body.items[0].leadLevel, 'B')

  const candidatesResult = await invoke(route, { action: 'candidates' })
  assert.equal(calls[1].name, 'lead_discovery_candidates_list')
  assert.equal(candidatesResult.body.status, 'ready')
  assert.equal(candidatesResult.body.count, 1)
  assert.equal(candidatesResult.body.items[0].sourceUrl, 'https://www.douyin.com/video/1')
  assert.equal(candidatesResult.body.items[0].originalText, undefined)
  assert.equal(candidatesResult.body.items[0].leadId, undefined)
})

async function invoke(route, body) { let status; let raw = ''; await route.handler({ method: 'POST', body }, { writeHead(value) { status = value; return this }, end(value) { raw += value } }); return { status, body: JSON.parse(raw) } }
