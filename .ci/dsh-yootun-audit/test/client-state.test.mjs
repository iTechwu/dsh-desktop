import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const module = { exports: {} }
const noop = () => {}
vm.runInNewContext(source, {
  module, exports: module.exports,
  require(name) {
    if (name === 'react') return { createElement: noop, useEffect: noop, useMemo: value => value(), useReducer: noop, useRef: noop, useSyncExternalStore: noop }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({ Tooltip: noop }, { get: () => noop })
    throw new Error(`unexpected module ${name}`)
  },
  window: {}, document: {}, URLSearchParams, AbortController, CustomEvent: class {}, requestAnimationFrame: noop,
})

const {
  normalizeWorkspace, buildQuery, mergePage, reducer, actionLabel, surfaceLabel, effectOutcomeLabel,
} = module.exports.__test

test('normalizes invalid workspace fields to honest defaults', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeWorkspace({ status: 'cached', summary: { today: 4, failed: 1, pendingSync: 2 }, events: 'invalid' }))), {
    status: 'cached', summary: { today: 4, failed: 1, pendingSync: 2 }, events: [], page: { nextCursor: null },
    scopes: { available: ['self'], isSuperAdmin: false }, sync: { pending: 0, quarantine: 0 }, freshness: { source: 'live' },
  })
})

test('builds a bounded workspace query and omits empty filters', () => {
  const query = buildQuery({ scope: 'team', teamId: 'team-1', query: ' 失败 ', pluginId: '', actionCode: 'sales.follow_up.executed', outcome: 'failed', start: '', end: '' })
  assert.equal(query, 'view=workspace&scope=team&limit=50&teamId=team-1&actionCode=sales.follow_up.executed&outcome=failed&query=%E5%A4%B1%E8%B4%A5')
})

test('merges cursor pages without duplicating events', () => {
  const first = [{ id: 'a', occurredAt: '2026-09-05T02:00:00Z' }, { id: 'b', occurredAt: '2026-09-05T01:00:00Z' }]
  const second = [{ id: 'b', occurredAt: '2026-09-05T01:00:00Z' }, { id: 'c', occurredAt: '2026-09-05T00:00:00Z' }]
  assert.deepEqual([...mergePage(first, second).map(item => item.id)], ['a', 'b', 'c'])
})

test('keeps the event list visible until a user explicitly selects a detail', () => {
  const state = {
    visible: true, loading: true, appending: false, error: '', workspace: null,
    selectedId: null, scope: 'self', teamId: '', teamQuery: '', teams: [], filters: {}, revision: 0,
  }
  const loaded = reducer(state, {
    type: 'loaded',
    value: { events: [{ id: 'event-1' }], summary: {}, page: {}, scopes: {}, sync: {}, freshness: {} },
  })
  assert.equal(loaded.selectedId, null)
})

test('resolves stable time-range tokens only when building the request', () => {
  const query = buildQuery({ scope: 'self', timeRange: '7d' }, undefined, Date.parse('2026-09-05T00:00:00.000Z'))
  assert.equal(new URLSearchParams(query).get('start'), '2026-08-29T00:00:00.000Z')
  assert.equal(new URLSearchParams(query).has('timeRange'), false)
})

test('renders catalog actions and technical enums as readable audit language', () => {
  assert.equal(actionLabel('xhs.rewrite.completed'), '完成小红书仿写')
  assert.equal(actionLabel('knowledge.memory.forgotten'), '删除知识记忆')
  assert.equal(surfaceLabel('human_ui'), '人工界面')
  assert.equal(effectOutcomeLabel('requires_user_login'), '需要用户登录')
})
