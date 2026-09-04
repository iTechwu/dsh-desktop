import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

const SCHEMAS = [
  { name: 'mcp__tools-xhs-operation__xhs_operation_task_create' },
  { name: 'mcp__tools-xhs-operation__xhs_operation_task_get' },
  { name: 'mcp__tools-xhs-operation__xhs_operation_result_get' },
]

function makeCtx(execute, schemas = SCHEMAS, auditEvents = []) {
  let route
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    yootunAudit: { async record(event) { auditEvents.push(event) } },
    tools: {
      schemas: () => schemas,
      execute,
    },
    webServer: { register(value) { route = value; return () => {} } },
  })
  return { get route() { return route } }
}

async function invoke(route, body) {
  let status = 0
  let raw = ''
  await route.handler(
    { method: 'POST', body },
    { writeHead(value) { status = value; return this }, end(value = '') { raw += value } },
  )
  return { status, body: raw ? JSON.parse(raw) : undefined }
}

test('create maps images mode to xhs_operation_task_create with idempotency and mutual exclusion', async () => {
  const calls = []
  const created = JSON.stringify({ taskId: 'xhst-1', status: 'queued', mediaType: 'images' })
  const { route } = makeCtx(async value => { calls.push(value); return { structuredContent: JSON.parse(created) } })
  const result = await invoke(route, { action: 'create', mediaType: 'images', imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'], theme: '新能源SUV', references: [{ source: 'manual', url: 'https://www.xiaohongshu.com/explore/1' }], accounts: [{ name: '某账号' }] })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'created')
  assert.equal(result.body.taskId, 'xhst-1')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'mcp__tools-xhs-operation__xhs_operation_task_create')
  assert.ok(calls[0].signal instanceof AbortSignal)
  const args = calls[0].arguments
  assert.equal(args.mediaType, 'images')
  assert.equal(args.confirm, true)
  assert.equal(typeof args.idempotencyKey, 'string')
  assert.ok(args.idempotencyKey.length > 0)
  assert.deepEqual(args.imageUrls, ['https://example.com/a.jpg', 'https://example.com/b.jpg'])
  assert.equal(args.coverIndex, 0)
  assert.equal(args.videoUrl, undefined)
  assert.equal(args.theme, '新能源SUV')
  assert.equal(args.versionCount, 3)
  assert.deepEqual(args.references, [{ source: 'manual', url: 'https://www.xiaohongshu.com/explore/1' }])
  assert.deepEqual(args.accounts, [{ name: '某账号' }])
})

test('create maps video mode and omits theme/references/accounts when empty', async () => {
  const calls = []
  const { route } = makeCtx(async value => { calls.push(value); return { structuredContent: { taskId: 'xhst-2', status: 'queued', mediaType: 'video' } } })
  const result = await invoke(route, { action: 'create', mediaType: 'video', videoUrl: 'https://example.com/v.mp4' })
  assert.equal(result.status, 200)
  const args = calls[0].arguments
  assert.equal(args.mediaType, 'video')
  assert.equal(args.videoUrl, 'https://example.com/v.mp4')
  assert.equal(args.imageUrls, undefined)
  assert.equal(args.theme, undefined)
  assert.deepEqual(args.references, [])
  assert.deepEqual(args.accounts, [])
})

test('create rejects invalid mediaType and missing material', async () => {
  const calls = []
  const { route } = makeCtx(async value => { calls.push(value); return { structuredContent: {} } })
  const bad = await invoke(route, { action: 'create', mediaType: 'text' })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.reason, 'invalid_media_type')
  const missing = await invoke(route, { action: 'create', mediaType: 'images' })
  assert.equal(missing.status, 400)
  assert.equal(missing.body.reason, 'image_urls_required')
  assert.equal(calls.length, 0)
})

test('status delegates to task_get and projects the safe task view', async () => {
  const calls = []
  const projection = JSON.stringify({ taskId: 'xhst-1', status: 'running', currentStep: 'copywriting', nextStep: 'quality', steps: [{ step: 'probe', status: 'succeeded' }, { step: 'copywriting', status: 'running' }] })
  const { route } = makeCtx(async value => { calls.push(value); return { content: [{ type: 'text', text: projection }] } })
  const result = await invoke(route, { action: 'status', taskId: 'xhst-1' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.taskStatus, 'running')
  assert.equal(result.body.currentStep, 'copywriting')
  assert.deepEqual(result.body.steps, [{ step: 'probe', status: 'succeeded' }, { step: 'copywriting', status: 'running' }])
  assert.equal(calls[0].name, 'mcp__tools-xhs-operation__xhs_operation_task_get')
  assert.equal(calls[0].arguments.taskId, 'xhst-1')
})

test('result delegates to result_get and projects only display fields', async () => {
  const calls = []
  const payload = JSON.stringify({ taskId: 'xhst-1', status: 'succeeded', versions: [
    { version: 'A', title: '标题A', body: '**正文**A', tags: ['a'], coverCopy: '封面A', leadGuide: '引导A', internalId: 'leak', pages: [{ pageIndex: 0, copy: '页1' }] },
    { version: 'B', title: '标题B', body: '正文B', tags: [], coverCopy: '', leadGuide: '' },
    { version: 'C', title: '标题C', body: '正文C', tags: ['c'], coverCopy: '', leadGuide: '' },
  ] })
  const { route } = makeCtx(async value => { calls.push(value); return { structuredContent: JSON.parse(payload) } })
  const result = await invoke(route, { action: 'result', taskId: 'xhst-1' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.taskStatus, 'succeeded')
  assert.equal(calls[0].name, 'mcp__tools-xhs-operation__xhs_operation_result_get')
  assert.equal(result.body.versions.length, 3)
  assert.equal(result.body.versions[0].version, 'A')
  assert.equal(result.body.versions[0].body, '**正文**A')
  assert.equal(result.body.versions[0].internalId, undefined)
  assert.deepEqual(result.body.versions[0].pages, [{ pageIndex: 0, copy: '页1' }])
  assert.deepEqual(result.body.versions[1].tags, [])
})

test('records task creation and the first terminal observation exactly once', async () => {
  const events = []
  const versions = Array.from({ length: 3 }, (_, index) => ({ version: String(index + 1), title: `不得进入审计 ${index}`, body: '不得进入审计的正文' }))
  const { route } = makeCtx(async value => {
    if (value.name.endsWith('task_create')) return { structuredContent: { taskId: 'xhst-audit', status: 'queued' } }
    if (value.name.endsWith('task_get')) return { structuredContent: { taskId: 'xhst-audit', status: 'succeeded' } }
    return { structuredContent: { taskId: 'xhst-audit', status: 'succeeded', versions } }
  }, SCHEMAS, events)
  await invoke(route, { action: 'create', mediaType: 'images', imageUrls: ['https://example.com/secret.jpg'], theme: '不得进入审计的主题' })
  await invoke(route, { action: 'status', taskId: 'xhst-audit' })
  await invoke(route, { action: 'status', taskId: 'xhst-audit' })
  await invoke(route, { action: 'result', taskId: 'xhst-audit' })
  assert.equal(events.length, 2)
  assert.equal(events[0].actionCode, 'xhs.rewrite.created')
  assert.equal(events[0].outcome, 'accepted')
  assert.equal(events[1].actionCode, 'xhs.rewrite.completed')
  assert.equal(events[1].outcome, 'succeeded')
  assert.equal(events[0].traceId, events[1].traceId)
  assert.equal(events[1].changes.find(change => change.field === 'versionCount').after, 3)
  assert.doesNotMatch(JSON.stringify(events), /不得进入审计|secret\.jpg/u)
})

test('result rejects a succeeded task without exactly three versions', async () => {
  const payload = JSON.stringify({ taskId: 'xhst-1', status: 'succeeded', versions: [
    { version: 'A', title: '标题A', body: '正文A', tags: [] },
    { version: 'B', title: '标题B', body: '正文B', tags: [] },
  ] })
  const { route } = makeCtx(async () => ({ structuredContent: JSON.parse(payload) }))
  const result = await invoke(route, { action: 'result', taskId: 'xhst-1' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'error')
  assert.equal(result.body.reason, 'versions_unavailable')
  assert.equal(result.body.versions, undefined)
})

test('preserves a safe MCP error category for diagnosis', async () => {
  const { route } = makeCtx(async () => { throw new Error(JSON.stringify({ error: { code: 'TASK_NOT_FOUND', message: 'redacted' } })) })
  const result = await invoke(route, { action: 'status', taskId: 'missing' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { status: 'error', reason: 'TASK_NOT_FOUND' })
})

test('returns a stable unavailable state when the tool is missing', async () => {
  const { route } = makeCtx(async () => ({}), [])
  const result = await invoke(route, { action: 'status', taskId: 'xhst-1' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })
})
