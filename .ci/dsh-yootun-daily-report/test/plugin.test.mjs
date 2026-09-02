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
  for (const token of ['sourceReady', 'sourceUnavailable', 'sourceError', 'toolsSource', 'request_failed', '不可用', '.ydr-overlay{position:fixed', '.ydr-shell{display:grid', '.ydr-content{min-height:0']) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
})
test('daily report aggregates yesterday session events', async () => {
  let route
  apply({
    effect(factory) { return factory() },
    webServer: { register(value) { route = value; return () => {} } },
    tools: { schemas() { return [{ name: 'mcp__tools-lead-discovery__search', description: 'lead discovery' }] } },
    sessionPersistence: {
      async list() { return [{ id: '1', title: '日报', cwd: '/tmp/acme' }] },
      async load() { return { events: [
        { type: 'turn/start', time: '2026-08-31T01:00:00+08:00' },
        { type: 'turn/end', time: '2026-08-31T01:01:00+08:00', data: { reason: { kind: 'completed' } } },
        { type: 'tool/call', time: '2026-08-31T01:01:00+08:00', data: { name: 'search' } },
      ] } },
    },
  }, { now: () => new Date('2026-09-01T00:00:00+08:00') })
  const result = await invoke(route)
  assert.equal(result.status, 200)
  assert.equal(result.body.activity.totals.sessions, 1)
  assert.equal(result.body.activity.totals.toolCalls, 1)
  assert.equal(result.body.sources.salesIntent.status, 'ready')
  assert.equal(result.body.sources.retrofit.status, 'unavailable')
})
async function invoke(route) { let status; let raw = ''; await route.handler({ method: 'GET' }, { writeHead(value) { status = value; return this }, end(value) { raw += value } }); return { status, body: JSON.parse(raw) } }
