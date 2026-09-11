import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

const stamp = date => Date.parse(`${date}T01:00:00+08:00`)
const turn = date => ({ type: 'turn/start', time: stamp(date) })

function harness(records, { listFails = false } = {}) {
  const routes = new Map()
  const tools = new Map()
  const opened = []
  const closed = []
  apply({
    effect: setup => setup(),
    credentials: { resolve: async () => null },
    tools: { schemas: () => [], register(tool) { tools.set(tool.name, tool); return () => {} } },
    webServer: { register(route) { routes.set(route.path.split('/').at(-1), route); return () => {} } },
    sessionPersistence: {
      async list() {
        if (listFails) throw new Error('/private/unreadable-sessions')
        return records.map(({ id, createdAt = stamp('2026-08-01') }) => ({ header: { id, createdAt, cwd: '/private/workspace' }, revision: '1' }))
      },
      async open(id, access) {
        assert.equal(access, 'read')
        opened.push(id)
        const record = records.find(record => record.id === id)
        if (record.openFails) throw new Error('/private/session-open-failed')
        return {
          inheritedEventCount: record.inherited || 0,
          async read() {
            if (record.readFails) throw new Error('/private/session-read-failed')
            return { events: record.events || [] }
          },
          async close() { closed.push(id) },
        }
      },
    },
  }, { now: () => new Date('2026-09-01T00:00:00+08:00'), fetch: async () => { throw new Error('unexpected remote request') } })
  return {
    opened, closed,
    async read(endpoint = 'yesterday', days = 7) {
      let raw
      await routes.get(endpoint).handler({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ days })) } }, {
        writeHead(status) { assert.equal(status, 200) }, end(value) { raw = value },
      })
      const body = JSON.parse(raw)
      const tool = tools.get(endpoint === 'yesterday' ? 'yootun_dashboard_overview' : 'yootun_dashboard_series')
      assert.deepEqual((await tool.execute({ days })).result, body, 'HTTP and Agent projections must agree')
      assert.doesNotMatch(raw, /\/private\//)
      return body.activity
    },
  }
}

test('yesterday activity uses title events and millisecond boundaries, then closes read handles', async () => {
  const fixture = harness([{ id: 'one', events: [
    { type: 'session/title', time: stamp('2026-08-30'), data: { title: '最初标题' } },
    { type: 'session/title', time: stamp('2026-08-30'), data: { title: '渠道复盘' } },
    turn('2026-08-30'), turn('2026-08-31'),
    { type: 'turn/end', time: stamp('2026-08-31'), data: { reason: { kind: 'completed' } } },
    { type: 'tool/call', time: stamp('2026-08-31'), data: { name: 'search' } },
    { type: 'turn/start', time: Date.parse('2026-09-01T00:00:00+08:00') },
  ] }])
  const activity = await fixture.read()
  assert.equal(activity.status, 'ready')
  assert.deepEqual(activity.data.totals, { sessions: 1, turns: 1, completedTurns: 1, failedTurns: 0, toolCalls: 1 })
  assert.equal(activity.data.sessions[0].title, '渠道复盘')
  assert.deepEqual(fixture.closed, fixture.opened)
  assert.equal(activity.sourceCompleteness, 'complete')
})

for (const days of [7, 30]) {
  test(`${days}-day activity counts local events once and keeps current and baseline windows distinct`, async () => {
    const fixture = harness([
      { id: 'parent', events: [turn('2026-08-01'), turn('2026-08-24'), turn('2026-08-31')] },
      { id: 'child', inherited: 3, events: [turn('2026-08-01'), turn('2026-08-24'), turn('2026-08-31'), turn('2026-08-31')] },
    ])
    const activity = await fixture.read('series', days)
    assert.equal(activity.status, 'ready')
    assert.equal(activity.data.days.length, days)
    assert.equal(activity.data.days.at(-1).turns, 2)
    assert.equal(activity.data.totals.turns, days === 7 ? 2 : 3)
    assert.equal(activity.data.totals.sessions, 2, 'sessions active on multiple days are counted once per range')
    assert.equal(activity.comparison.status, 'ready')
    assert.equal(activity.comparison.delta.sessions, 1, 'current and baseline session totals use the same unique-session definition')
    assert.equal(activity.comparison.delta.turns, days === 7 ? 1 : 2)
    assert.deepEqual(fixture.closed, fixture.opened)
  })
}

for (const endpoint of ['yesterday', 'series']) {
  test(`${endpoint} preserves readable counts and marks incomplete coverage without a misleading comparison`, async () => {
    const fixture = harness([{ id: 'ok', events: [turn('2026-08-31')] }, { id: 'broken', readFails: true }])
    const activity = await fixture.read(endpoint)
    assert.equal(activity.status, 'partial')
    assert.equal(activity.sourceCompleteness, 'partial')
    assert.equal(activity.reason, 'activity_partial')
    assert.deepEqual(activity.coverage, { total: 2, loaded: 1, failed: 1, unscanned: 0 })
    assert.equal(activity.data.totals.turns, 1)
    if (endpoint === 'series') assert.deepEqual(activity.comparison, { status: 'unavailable', reason: 'activity_incomplete' })
    assert.deepEqual(fixture.closed, fixture.opened, 'failed reads must also close their handles')
  })

  test(`${endpoint} distinguishes genuinely empty, partially empty and unavailable histories`, async () => {
    const empty = await harness([]).read(endpoint)
    assert.equal(empty.status, 'empty')
    assert.equal(empty.data.totals.turns, 0)
    const partial = await harness([{ id: 'ok' }, { id: 'broken', openFails: true }]).read(endpoint)
    assert.equal(partial.status, 'partial')
    assert.equal(partial.data.totals.turns, 0)
    for (const fixture of [harness([{ id: 'broken', readFails: true }]), harness([], { listFails: true })]) {
      const activity = await fixture.read(endpoint)
      assert.equal(activity.status, 'unavailable')
      assert.equal(activity.data, undefined)
      assert.equal(activity.comparison, undefined)
      assert.equal(activity.sourceCompleteness, 'unknown')
    }
  })

  test(`${endpoint} discloses the scan limit and selects the most recently created snapshots`, async () => {
    const fixture = harness(Array.from({ length: 501 }, (_, index) => ({ id: String(index), createdAt: index, events: [turn('2026-08-31')] })))
    const activity = await fixture.read(endpoint)
    assert.equal(activity.status, 'partial')
    assert.equal(activity.reason, 'activity_scan_limited')
    assert.deepEqual(activity.coverage, { total: 501, loaded: 500, failed: 0, unscanned: 1 })
    assert.equal(activity.data.totals.turns, 500)
    assert.equal(fixture.opened.includes('0'), false)
    assert.equal(fixture.opened.length, 1000, 'each HTTP and tool call reads at most 500 snapshots')
  })
}
