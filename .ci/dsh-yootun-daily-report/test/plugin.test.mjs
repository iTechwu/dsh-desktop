import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { apply } from '../index.js'
test('daily report package exposes a standalone client', async () => { const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url))); assert.equal(manifest.name, '@dofe/dsh-yootun-daily-report'); assert.equal(manifest.exports['./client'], './lib/client.js') })
test('generated client bundle is valid JavaScript', () => {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('../lib/client.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
test('localizes source states and keeps unavailable metrics explicit', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  for (const token of ['sourceReady', 'sourceUnavailable', 'sourceError', 'toolsSource', 'request_failed', 'response.ok', "t('sourceUnavailable')", '.ydr-overlay{position:fixed', '.ydr-shell{display:grid', '.ydr-content{min-height:0']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(source, /\? '不可用'/u)
})
test('daily report aggregates yesterday session events', async () => {
  let route
  apply({
    effect(factory) { return factory() },
    webServer: { register(value) { route = value; return () => {} } },
    tools: { schemas() { return [{ name: 'mcp__tools-lead-discovery__search', description: 'lead discovery' }] } },
    sessionPersistence: {
      async list() { return [{ header: { id: '1', cwd: '/tmp/acme' }, revision: '1' }] },
      async open(id, access) {
        assert.equal(id, '1')
        assert.equal(access, 'read')
        return { inheritedEventCount: 0, close: async () => {}, read: async () => ({ events: [
          { type: 'session/title', time: Date.parse('2026-08-31T00:00:00+08:00'), data: { title: '日报' } },
          { type: 'turn/start', time: Date.parse('2026-08-31T01:00:00+08:00') },
          { type: 'turn/end', time: Date.parse('2026-08-31T01:01:00+08:00'), data: { reason: { kind: 'completed' } } },
          { type: 'tool/call', time: Date.parse('2026-08-31T01:01:00+08:00'), data: { name: 'search' } },
        ] }) }
      },
    },
  }, { now: () => new Date('2026-09-01T00:00:00+08:00') })
  const result = await invoke(route)
  assert.equal(result.status, 200)
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(result.headers['Cache-Control'], 'no-store')
  assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(result.body.activity.totals.sessions, 1)
  assert.equal(result.body.activity.totals.toolCalls, 1)
  assert.equal(result.body.activity.sessions[0].title, '日报')
  assert.equal(result.body.sources.salesIntent.status, 'ready')
  assert.equal(result.body.sources.retrofit.status, 'unavailable')
})
test('announces the empty activity state', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(source, /className: 'ydr-empty', role: 'status'/u)
  assert.match(source, /'aria-busy': loading/u)
})
test('prevents duplicate refresh requests', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(source, /const loadingRef = useRef\(false\)/u)
  assert.match(source, /const refresh = \(\) => \{ if \(loadingRef\.current\) return/u)
  assert.match(source, /disabled: loading, onClick: refresh/u)
})
test('keeps the previous report when refresh fails and ignores request cancellation', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(source, /if \(cause\?\.name === 'AbortError'\) return/u)
  assert.match(source, /setData\(current => current \|\| \{ activity:/u)
  assert.match(source, /refreshError: '刷新失败，当前保留上次结果。'/u)
  assert.match(source, /className: 'ydr-inline-status ydr-inline-error', role: 'alert'/u)
})

function reportHarness(persistence) {
  let route
  let tool
  apply({
    effect: factory => factory(),
    webServer: { register(value) { route = value; return () => {} } },
    tools: { schemas: () => [], register(value) { tool = value; return () => {} } },
    sessionPersistence: {
      list: async () => (await persistence.list()).map(header => ({ header, revision: '1' })),
      open: async (id, access) => {
        assert.equal(access, 'read')
        return {
          inheritedEventCount: persistence.inheritedEventCount || 0,
          read: () => persistence.read(id),
          close: async () => { persistence.closed?.push(id) },
        }
      },
    },
  }, { now: () => new Date('2026-09-01T00:00:00+08:00') })
  return { route, tool }
}

test('partial session reads preserve observed counts and share coverage through HTTP and the Agent tool', async () => {
  const closed = []
  const { route, tool } = reportHarness({
    closed,
    list: async () => [{ id: 'ok', title: '已读取会话' }, { id: 'broken', title: '不可见内容' }],
    read: async id => {
      if (id === 'broken') throw new Error('/private/session-secret.json')
      return { events: [{ type: 'turn/start', time: Date.parse('2026-08-31T01:00:00+08:00') }] }
    },
  })
  const { body } = await invoke(route)
  assert.equal(body.activity.status, 'partial')
  assert.equal(body.activity.reason, 'activity_partial')
  assert.equal(body.activity.totals.turns, 1)
  assert.deepEqual(body.activity.coverage, { total: 2, loaded: 1, failed: 1, unscanned: 0 })
  assert.equal(body.sources.local.status, 'partial')
  assert.deepEqual((await tool.execute()).result, body)
  assert.doesNotMatch(JSON.stringify(body), /session-secret|不可见内容/)
  assert.deepEqual(closed, ['ok', 'broken', 'ok', 'broken'])
})

test('all failed session reads are unavailable rather than an empty successful report', async () => {
  const { route } = reportHarness({ list: async () => [{ id: 'broken' }], read: async () => { throw new Error('unreadable') } })
  const { body } = await invoke(route)
  assert.equal(body.activity.status, 'unavailable')
  assert.equal(body.activity.totals, undefined)
})

test('an incomplete scan never reports no work even when the readable sessions have no events', async () => {
  const { route } = reportHarness({
    list: async () => [{ id: 'ok' }, { id: 'broken' }],
    read: async id => { if (id === 'broken') throw new Error('unreadable'); return { events: [] } },
  })
  const { body } = await invoke(route)
  assert.equal(body.activity.status, 'partial')
  assert.equal(body.activity.totals.sessions, 0)
})

test('bounded scans disclose unscanned sessions and keep the read limit', async () => {
  let reads = 0
  const { route } = reportHarness({
    list: async () => Array.from({ length: 501 }, (_, id) => ({ id: String(id) })),
    read: async () => { reads++; return { events: [] } },
  })
  const { body } = await invoke(route)
  assert.equal(reads, 500)
  assert.equal(body.activity.status, 'partial')
  assert.equal(body.activity.reason, 'activity_scan_limited')
  assert.deepEqual(body.activity.coverage, { total: 501, loaded: 500, failed: 0, unscanned: 1 })
})

test('a fully read empty history retains explicit zero totals', async () => {
  const { route } = reportHarness({ list: async () => [], read: async () => { throw new Error('must not read') } })
  const { body } = await invoke(route)
  assert.equal(body.activity.status, 'empty')
  assert.deepEqual(body.activity.totals, { sessions: 0, turns: 0, completed: 0, failed: 0, toolCalls: 0 })
})

test('fork-inherited events do not inflate yesterday activity counts', async () => {
  const { route } = reportHarness({
    list: async () => [{ id: 'child' }],
    inheritedEventCount: 1,
    read: async () => ({ events: [{ type: 'turn/start', time: Date.parse('2026-08-31T01:00:00+08:00') }] }),
  })
  const { body } = await invoke(route)
  assert.equal(body.activity.status, 'empty')
  assert.equal(body.activity.totals.turns, 0)
})

async function invoke(route) { let status; let headers; let raw = ''; await route.handler({ method: 'GET' }, { writeHead(value, valueHeaders) { status = value; headers = valueHeaders; return this }, end(value) { raw += value } }); return { status, headers, body: JSON.parse(raw) } }
