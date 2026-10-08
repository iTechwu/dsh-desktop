import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

const SCHEMAS = [
  { name: 'mcp__tools-xhs-operation__xhs_operation_task_create' },
  { name: 'mcp__tools-xhs-operation__xhs_operation_task_get' },
  { name: 'mcp__tools-xhs-operation__xhs_operation_result_get' },
  { name: 'mcp__tools-xhs-operation__xhs_operation_task_cancel' },
]

function makeCtx(execute, schemas = SCHEMAS, auditEvents = [], overrides = {}) {
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
  }, overrides)
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
  const result = await invoke(route, { action: 'create', mediaType: 'images', imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'], theme: '新能源SUV', references: [{ source: 'manual', url: 'https://www.xiaohongshu.com/explore/1' }], accounts: [{ name: '某账号' }], idempotencyKey: 'k-test-create' })
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
  // RQ-2026-002：单版可编辑，页面未显式传 versionCount 时 host 默认 1
  assert.equal(args.versionCount, 1)
  assert.deepEqual(args.references, [{ source: 'manual', url: 'https://www.xiaohongshu.com/explore/1' }])
  assert.deepEqual(args.accounts, [{ name: '某账号' }])
})

test('create maps video mode and omits theme/references/accounts when empty', async () => {
  const calls = []
  const { route } = makeCtx(async value => { calls.push(value); return { structuredContent: { taskId: 'xhst-2', status: 'queued', mediaType: 'video' } } })
  const result = await invoke(route, { action: 'create', mediaType: 'video', videoUrl: 'https://example.com/v.mp4' , idempotencyKey: 'k-test-create' })
  assert.equal(result.status, 200)
  const args = calls[0].arguments
  assert.equal(args.mediaType, 'video')
  assert.equal(args.videoUrl, 'https://example.com/v.mp4')
  assert.equal(args.imageUrls, undefined)
  assert.equal(args.theme, undefined)
  assert.equal(args.direction, undefined)
  assert.deepEqual(args.references, [])
  assert.deepEqual(args.accounts, [])
  // 理解视频内容开关（RQ-2026-002）：默认关，video 请求恒显式传递
  assert.equal(args.videoUnderstanding, false)
})

test('create maps direction/videoUnderstanding and passes versionCount through', async () => {
  const calls = []
  const { route } = makeCtx(async value => { calls.push(value); return { structuredContent: { taskId: 'xhst-d', status: 'queued' } } })
  await invoke(route, { action: 'create', mediaType: 'video', videoUrl: 'https://example.com/v.mp4', theme: '  主题  ', direction: '  突出省油  ', videoUnderstanding: true, versionCount: 1 , idempotencyKey: 'k-test-create' })
  let args = calls[0].arguments
  assert.equal(args.theme, '主题')
  assert.equal(args.direction, '突出省油')
  assert.equal(args.videoUnderstanding, true)
  assert.equal(args.versionCount, 1)
  // images 忽略 videoUnderstanding；direction 空白视为未传；versionCount 非法回退 1
  await invoke(route, { action: 'create', mediaType: 'images', imageUrls: ['https://example.com/a.jpg'], direction: '   ', videoUnderstanding: true, versionCount: 9 , idempotencyKey: 'k-test-create' })
  args = calls[1].arguments
  assert.equal(args.direction, undefined)
  assert.equal(args.videoUnderstanding, undefined)
  assert.equal(args.versionCount, 1)
  // 合法 versionCount=2 透传（兼容多版任务）
  await invoke(route, { action: 'create', mediaType: 'images', imageUrls: ['https://example.com/a.jpg'], versionCount: 2 , idempotencyKey: 'k-test-create' })
  assert.equal(calls[2].arguments.versionCount, 2)
})

test('create rejects invalid mediaType and missing material', async () => {
  const calls = []
  const { route } = makeCtx(async value => { calls.push(value); return { structuredContent: {} } })
  const bad = await invoke(route, { action: 'create', mediaType: 'text' , idempotencyKey: 'k-test-create' })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.reason, 'invalid_media_type')
  const missing = await invoke(route, { action: 'create', mediaType: 'images' , idempotencyKey: 'k-test-create' })
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

test('status projects failure errorCode/errorMessage from the failed step row', async () => {
  const projection = JSON.stringify({
    taskId: 'xhst-f', status: 'failed', currentStep: 'copywriting', nextStep: 'copywriting',
    errorCode: 'copywriting_failed', errorMessage: 'no fact or reference basis for copywriting',
    steps: [
      { step: 'ingest', status: 'succeeded' },
      { step: 'copywriting', status: 'failed', errorCode: 'copywriting_failed', errorMessage: 'no fact or reference basis for copywriting' },
      { step: 'quality', status: 'failed' },
    ],
  })
  const { route } = makeCtx(async () => ({ content: [{ type: 'text', text: projection }] }))
  const result = await invoke(route, { action: 'status', taskId: 'xhst-f' })
  assert.equal(result.status, 200)
  assert.equal(result.body.taskStatus, 'failed')
  assert.equal(result.body.errorCode, 'copywriting_failed')
  assert.equal(result.body.errorMessage, 'no fact or reference basis for copywriting')
  assert.deepEqual(result.body.steps, [
    { step: 'ingest', status: 'succeeded' },
    { step: 'copywriting', status: 'failed', errorCode: 'copywriting_failed', errorMessage: 'no fact or reference basis for copywriting' },
    { step: 'quality', status: 'failed' },
  ])
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

test('result projects a single editable version with quality issues', async () => {
  const payload = JSON.stringify({ taskId: 'xhst-single', status: 'succeeded', versions: [
    { version: 'A', title: '单版标题', body: '单版正文', tags: ['a'], coverCopy: '', leadGuide: '', issues: ['similarity_high', 'field_missing:coverCopy', 'unknown_issue_code'] },
  ] })
  const { route } = makeCtx(async () => ({ structuredContent: JSON.parse(payload) }))
  const result = await invoke(route, { action: 'result', taskId: 'xhst-single' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.versions.length, 1)
  // issues 投影：软性问题码随版本返回（未知码原样保留，由页面映射过滤）
  assert.deepEqual(result.body.versions[0].issues, ['similarity_high', 'field_missing:coverCopy', 'unknown_issue_code'])
})

test('records task creation and the first terminal observation exactly once', async () => {
  const events = []
  const versions = Array.from({ length: 3 }, (_, index) => ({ version: String(index + 1), title: `不得进入审计 ${index}`, body: '不得进入审计的正文' }))
  const { route } = makeCtx(async value => {
    if (value.name.endsWith('task_create')) return { structuredContent: { taskId: 'xhst-audit', status: 'queued' } }
    if (value.name.endsWith('task_get')) return { structuredContent: { taskId: 'xhst-audit', status: 'succeeded' } }
    return { structuredContent: { taskId: 'xhst-audit', status: 'succeeded', versions } }
  }, SCHEMAS, events)
  await invoke(route, { action: 'create', mediaType: 'images', imageUrls: ['https://example.com/secret.jpg'], theme: '不得进入审计的主题' , idempotencyKey: 'k-test-create' })
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

test('result accepts two-version tasks and rejects an empty version set', async () => {
  // RQ-2026-002：1-3 版均合法（单版可编辑 + 多版兼容）
  const two = JSON.stringify({ taskId: 'xhst-1', status: 'succeeded', versions: [
    { version: 'A', title: '标题A', body: '正文A', tags: [] },
    { version: 'B', title: '标题B', body: '正文B', tags: [] },
  ] })
  const okRoute = makeCtx(async () => ({ structuredContent: JSON.parse(two) }))
  const ok = await invoke(okRoute.route, { action: 'result', taskId: 'xhst-1' })
  assert.equal(ok.body.status, 'ready')
  assert.equal(ok.body.versions.length, 2)

  const empty = JSON.stringify({ taskId: 'xhst-2', status: 'succeeded', versions: [] })
  const badRoute = makeCtx(async () => ({ structuredContent: JSON.parse(empty) }))
  const bad = await invoke(badRoute.route, { action: 'result', taskId: 'xhst-2' })
  assert.equal(bad.status, 200)
  assert.equal(bad.body.status, 'error')
  assert.equal(bad.body.reason, 'versions_unavailable')
  assert.equal(bad.body.versions, undefined)
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

test('cancel delegates to task_cancel with confirm and idempotency', async () => {
  const calls = []
  const events = []
  const projection = JSON.stringify({ taskId: 'xhst-cancel-1', status: 'cancel_requested' })
  const { route } = makeCtx(async value => { calls.push(value); return { structuredContent: JSON.parse(projection) } }, SCHEMAS, events)
  const result = await invoke(route, { action: 'cancel', taskId: 'xhst-cancel-1' })
  assert.equal(result.status, 200)
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.taskStatus, 'cancel_requested')
  assert.equal(calls[0].name, 'mcp__tools-xhs-operation__xhs_operation_task_cancel')
  assert.equal(calls[0].arguments.taskId, 'xhst-cancel-1')
  assert.equal(calls[0].arguments.confirm, true)
  assert.equal(typeof calls[0].arguments.idempotencyKey, 'string')
  assert.ok(calls[0].arguments.idempotencyKey.length > 0)
  assert.equal(events.length, 1)
  assert.equal(events[0].actionCode, 'xhs.rewrite.cancelled')
  assert.equal(events[0].outcome, 'cancelled')
})

test('cancel returns unavailable when the tool is missing', async () => {
  const { route } = makeCtx(async () => ({}), [])
  const result = await invoke(route, { action: 'cancel', taskId: 'xhst-1' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })
})

test('cancel rejects missing taskId', async () => {
  const { route } = makeCtx(async () => ({}))
  const result = await invoke(route, { action: 'cancel' })
  assert.equal(result.status, 400)
  assert.equal(result.body.reason, 'task_id_required')
})

// ---------------------------------------------------------------------------
// 阶段 2（RQ-2026-002）：浏览器能力 / 账号管理 / 基本数据采集
// ---------------------------------------------------------------------------

test('browser.status projects capability booleans without device paths', async () => {
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { browserStatus: async () => ({ chromeAvailable: false, driverAvailable: true, platform: 'win32', chromePath: 'C:\\secret\\chrome.exe' }) })
  const result = await invoke(route, { action: 'browser.status' })
  assert.equal(result.body.status, 'ready')
  assert.equal(result.body.chromeAvailable, false)
  assert.equal(result.body.driverAvailable, true)
  assert.equal(result.body.platform, 'win32')
  assert.equal(result.body.hint, 'install_google_chrome')
  assert.equal(result.body.chromePath, undefined, '不回传设备路径细节')
})

test('accounts.list projects local accounts with snapshot summary and avatar allowlist', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = join(tmpdir(), `xhs-route-accounts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const { paths: statePaths, writeAccounts, saveSnapshot } = await import('../src/state.js')
  await mkdir(statePaths(root).root, { recursive: true })
  await writeAccounts({ version: 1, accounts: { 'acc-1': { accountId: 'acc-1', nickname: '账号一', avatar: 'javascript:alert(1)', sessionStatus: 'ok', sessionCheckedAt: '2026-09-29T01:00:00.000Z', lastCollectedAt: '2026-09-29T02:00:00.000Z' } } }, root)
  await saveSnapshot('acc-1', { schemaVersion: 1, accountId: 'acc-1', capturedAt: '2026-09-29T02:00:00.000Z', source: 'creator-web', notes: [{ contentId: 'a', metrics: { plays: 10, likes: 2 } }, { contentId: 'b' }] }, root)
  const { rm } = await import('node:fs/promises')
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { root })
  try {
    const result = await invoke(route, { action: 'accounts.list' })
    assert.equal(result.body.status, 'ready')
    assert.equal(result.body.accounts.length, 1)
    const account = result.body.accounts[0]
    assert.equal(account.nickname, '账号一')
    assert.equal(account.avatar, null, '危险协议头像一律置 null')
    assert.equal(account.sessionStatus, 'ok')
    assert.deepEqual(account.summary.totals, { plays: 10, likes: 2, collects: 0, comments: 0, shares: 0 })
    assert.equal(account.summary.gaps.likes, 1, '字段缺失记 dataGap 不补 0')
    assert.equal(account.summary.notesCount, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('account.beginLogin returns waiting, replays the same run and surfaces completion', async () => {
  const events = []
  let resolveLogin
  const login = () => new Promise(resolve => { resolveLogin = resolve })
  const { route } = makeCtx(async () => ({}), SCHEMAS, events, { login })
  const started = await invoke(route, { action: 'account.beginLogin' })
  assert.equal(started.body.status, 'ready')
  assert.equal(started.body.login.status, 'waiting')
  const replay = await invoke(route, { action: 'account.beginLogin' })
  assert.equal(replay.body.login.loginId, started.body.login.loginId, '重复调用返回既有 waiting run')
  resolveLogin({ status: 'ok', accountId: 'acc-9', profile: { accountId: 'acc-9', nickname: '九号', avatar: 'https://img.example/9.jpg' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  const done = await invoke(route, { action: 'account.loginStatus', loginId: started.body.login.loginId })
  assert.equal(done.body.login.status, 'ok')
  assert.equal(done.body.login.accountId, 'acc-9')
  assert.equal(done.body.login.nickname, '九号')
  assert.ok(events.some(event => event.actionCode === 'xhs.account.login' && event.outcome === 'succeeded'))
})

test('account.probe projects session status and fails with PROFILE_BUSY while busy', async () => {
  let resolveProbe
  const probe = ({ accountId }) => new Promise(resolve => { resolveProbe = { accountId, resolve } })
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { probe })
  const pending = invoke(route, { action: 'account.probe', accountId: 'acc-1' })
  await new Promise(resolve => setTimeout(resolve, 0))
  // probe 运行中：同账号 probe 与 collect 均即 PROFILE_BUSY
  const busyProbe = await invoke(route, { action: 'account.probe', accountId: 'acc-1' })
  assert.equal(busyProbe.body.reason, 'PROFILE_BUSY')
  const busyCollect = await invoke(route, { action: 'collect.start', accountId: 'acc-1', idempotencyKey: 'k-busy-1' })
  assert.equal(busyCollect.body.reason, 'PROFILE_BUSY', 'probe 运行中 collect.start → PROFILE_BUSY（互斥矩阵）')
  resolveProbe.resolve({ status: 'ok', profile: { accountId: 'acc-1' } })
  const done = await pending.then(result => result)
  assert.equal(done.body.sessionStatus, 'ok')
})

test('collect.start runs in background, honors the idempotency key and reports completion', async () => {
  const events = []
  let resolveCollect
  let collectCalls = 0
  const collect = ({ accountId }) => new Promise(resolve => { collectCalls += 1; resolveCollect = { accountId, resolve } })
  const { route } = makeCtx(async () => ({}), SCHEMAS, events, { collect })
  const started = await invoke(route, { action: 'collect.start', accountId: 'acc-2', idempotencyKey: 'k-collect-1' })
  assert.equal(started.body.status, 'started')
  assert.ok(started.body.collectId)
  const replay = await invoke(route, { action: 'collect.start', accountId: 'acc-2', idempotencyKey: 'k-collect-1' })
  assert.equal(replay.body.collectId, started.body.collectId, '幂等重放返回既有 collectId')
  // 采集运行中：同账号 probe 即 PROFILE_BUSY（互斥矩阵）
  const busyProbe = await invoke(route, { action: 'account.probe', accountId: 'acc-2' })
  assert.equal(busyProbe.body.reason, 'PROFILE_BUSY')
  const running = await invoke(route, { action: 'collect.status', collectId: started.body.collectId })
  assert.equal(running.body.collect.collectStatus, 'running')
  resolveCollect.resolve({ pagesDone: 3, notesTotal: 42, snapshotPath: '/tmp/x', summary: { notesCount: 42, totals: { plays: 1, likes: 2, collects: 3, comments: 4, shares: 5 }, gaps: {}, capturedAt: '2026-09-29T00:00:00.000Z' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  const done = await invoke(route, { action: 'collect.status', collectId: started.body.collectId })
  assert.equal(done.body.collect.collectStatus, 'completed')
  assert.equal(done.body.collect.notesTotal, 42)
  assert.equal(done.body.collect.summary.notesCount, 42)
  assert.equal(collectCalls, 1, '重放不重复启动采集')
  assert.ok(events.some(event => event.actionCode === 'xhs.collect.run' && event.outcome === 'succeeded'))
})

test('collect failure surfaces controlled error codes and keeps the account usable', async () => {
  const collect = async () => {
    const error = new Error('login page detected')
    error.code = 'SESSION_EXPIRED'
    throw error
  }
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { collect })
  const started = await invoke(route, { action: 'collect.start', accountId: 'acc-3', idempotencyKey: 'k-collect-fail' })
  assert.equal(started.body.status, 'started')
  await new Promise(resolve => setTimeout(resolve, 0))
  const done = await invoke(route, { action: 'collect.status', collectId: started.body.collectId })
  assert.equal(done.body.collect.collectStatus, 'failed')
  assert.equal(done.body.collect.error, 'SESSION_EXPIRED', '只透出受控错误码')
})

test('account.removeLocal projects what was cleared and is idempotent', async () => {
  const removeLocal = async () => ({ accountId: 'acc-4', cleared: { profile: true, storageState: true, data: true }, hadRecord: true })
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { removeLocal })
  const result = await invoke(route, { action: 'account.removeLocal', accountId: 'acc-4' })
  assert.equal(result.body.status, 'ready')
  assert.deepEqual(result.body.removed, { profile: true, storageState: true })
  const missing = await invoke(route, { action: 'account.removeLocal' })
  assert.equal(missing.body.reason, 'account_id_required')
})

test('account.removeLocal returns PROFILE_BUSY while a browser task holds the profile', async () => {
  const events = []
  let resolveCollect
  const collect = () => new Promise(resolve => { resolveCollect = resolve })
  const { route } = makeCtx(async () => ({}), SCHEMAS, events, { collect })
  const started = await invoke(route, { action: 'collect.start', accountId: 'acc-6', idempotencyKey: 'k-remove-1' })
  assert.equal(started.body.status, 'started')
  // 采集运行中移除该账号：必须拒绝（否则运行中浏览器写回已删目录，完成回调复活僵尸账号）
  const busyRemove = await invoke(route, { action: 'account.removeLocal', accountId: 'acc-6' })
  assert.equal(busyRemove.body.reason, 'PROFILE_BUSY', '采集运行中 removeLocal → PROFILE_BUSY（互斥矩阵）')
  resolveCollect({ pagesDone: 1, notesTotal: 2, truncated: false, snapshotPath: '/tmp/x', summary: { notesCount: 2, totals: {}, gaps: {}, capturedAt: 'x' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  const removeLocal = async () => ({ accountId: 'acc-6', cleared: { profile: true, storageState: true, data: true }, hadRecord: true })
  const { route: route2 } = makeCtx(async () => ({}), SCHEMAS, [], { removeLocal })
  const okRemove = await invoke(route2, { action: 'account.removeLocal', accountId: 'acc-6' })
  assert.equal(okRemove.body.status, 'ready', '采集结束后移除成功')
})

test('collect completion surfaces the truncated flag when the page limit is hit', async () => {
  let resolveCollect
  const collect = () => new Promise(resolve => { resolveCollect = resolve })
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { collect })
  const started = await invoke(route, { action: 'collect.start', accountId: 'acc-7', idempotencyKey: 'k-trunc-1' })
  resolveCollect({ pagesDone: 30, notesTotal: 300, truncated: true, snapshotPath: '/tmp/x', summary: { notesCount: 300, totals: {}, gaps: {}, capturedAt: 'x' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  const done = await invoke(route, { action: 'collect.status', collectId: started.body.collectId })
  assert.equal(done.body.collect.collectStatus, 'completed')
  assert.equal(done.body.collect.truncated, true, '达上限截断必须透出，不允许静默不完整')
})

test('beginLogin reports captcha detection as a controlled failure reason', async () => {
  const events = []
  let resolveLogin
  const { route } = makeCtx(async () => ({}), SCHEMAS, events, { login: () => new Promise(resolve => { resolveLogin = resolve }) })
  const started = await invoke(route, { action: 'account.beginLogin' })
  resolveLogin({ status: 'failed', reason: 'CAPTCHA_DETECTED' })
  await new Promise(resolve => setTimeout(resolve, 0))
  const done = await invoke(route, { action: 'account.loginStatus', loginId: started.body.login.loginId })
  assert.equal(done.body.login.status, 'failed')
  assert.equal(done.body.login.reason, 'CAPTCHA_DETECTED', '验证码 → 任务失败 CAPTCHA_DETECTED，绝不绕过')
})

test('collect.start returns PROFILE_BUSY while a login for the same account is waiting', async () => {
  let resolveLogin
  const login = ({ accountId }) => new Promise(resolve => { resolveLogin = resolve })
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { login })
  // 显式 accountId 的重新登录：占用该账号 Profile
  const loginStarted = await invoke(route, { action: 'account.beginLogin', accountId: 'acc-5' })
  assert.equal(loginStarted.body.login.status, 'waiting')
  const busyCollect = await invoke(route, { action: 'collect.start', accountId: 'acc-5', idempotencyKey: 'k-busy-2' })
  assert.equal(busyCollect.body.reason, 'PROFILE_BUSY', '登录运行中 collect.start → PROFILE_BUSY（互斥矩阵）')
  resolveLogin({ status: 'ok', accountId: 'acc-5', profile: null })
  await new Promise(resolve => setTimeout(resolve, 0))
  const afterLogin = await invoke(route, { action: 'collect.start', accountId: 'acc-5', idempotencyKey: 'k-busy-3' })
  assert.equal(afterLogin.body.status, 'started', '登录结束后释放 Profile，采集可启动')
})

// ---------------------------------------------------------------------------
// publish.start / publish.status（阶段 3）：后台 run + 幂等 + Profile 互斥矩阵
// ---------------------------------------------------------------------------

test('publish.start runs in background, honors idempotency and reports completion', async () => {
  const events = []
  let resolvePublish
  const publish = () => new Promise(resolve => { resolvePublish = resolve })
  const { route } = makeCtx(async () => ({}), SCHEMAS, events, { publish })
  const started = await invoke(route, {
    action: 'publish.start', accountId: 'acc-8', title: '标题', body: '正文', tags: ['标签一'],
    imageUrls: ['https://example.com/a.jpg'], visibility: 'private', idempotencyKey: 'k-pub-1',
  })
  assert.equal(started.body.status, 'started')
  assert.ok(started.body.publishId)
  assert.equal(started.body.publish.publishStatus, 'running')
  assert.equal(started.body.publish.step, 'prepare')
  const replay = await invoke(route, {
    action: 'publish.start', accountId: 'acc-8', title: '标题', body: '正文', tags: [],
    imageUrls: ['https://example.com/a.jpg'], idempotencyKey: 'k-pub-1',
  })
  assert.equal(replay.body.publishId, started.body.publishId, '幂等重放返回既有 publishId')
  // 发布运行中：同账号 probe 与 collect 均 PROFILE_BUSY（互斥矩阵）
  const busyProbe = await invoke(route, { action: 'account.probe', accountId: 'acc-8' })
  assert.equal(busyProbe.body.reason, 'PROFILE_BUSY', 'publish 运行中 account.probe → PROFILE_BUSY')
  const busyCollect = await invoke(route, { action: 'collect.start', accountId: 'acc-8', idempotencyKey: 'k-pub-collect' })
  assert.equal(busyCollect.body.reason, 'PROFILE_BUSY', 'publish 运行中 collect.start → PROFILE_BUSY')
  const running = await invoke(route, { action: 'publish.status', publishId: started.body.publishId })
  assert.equal(running.body.publish.publishStatus, 'running')
  resolvePublish({ status: 'completed', toast: '保存成功' })
  await new Promise(resolve => setTimeout(resolve, 0))
  const done = await invoke(route, { action: 'publish.status', publishId: started.body.publishId })
  assert.equal(done.body.publish.publishStatus, 'completed')
  assert.equal(done.body.publish.step, 'done')
  assert.equal(done.body.publish.toast, '保存成功')
  assert.ok(events.some(event => event.actionCode === 'xhs.publish.run' && event.outcome === 'succeeded'))
  // 释放后同账号可再次发起浏览器操作
  const after = await invoke(route, { action: 'account.probe', accountId: 'acc-8' })
  assert.notEqual(after.body.reason, 'PROFILE_BUSY', 'run 结束释放 Profile')
})

test('publish.start maps the video material and rejects conflicting inputs', async () => {
  const publish = async () => ({ status: 'completed', toast: '保存成功' })
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { publish })
  const video = await invoke(route, {
    action: 'publish.start', accountId: 'acc-v', title: '标题', body: '正文',
    videoUrl: 'https://example.com/v.mp4', idempotencyKey: 'k-pub-video',
  })
  assert.equal(video.body.status, 'started')
  const conflict = await invoke(route, {
    action: 'publish.start', accountId: 'acc-v', title: '标题', body: '正文',
    videoUrl: 'https://example.com/v.mp4', imageUrls: ['https://example.com/a.jpg'], idempotencyKey: 'k-pub-x1',
  })
  assert.equal(conflict.body.reason, 'material_conflict', '图文素材与视频互斥')
  const missing = await invoke(route, {
    action: 'publish.start', accountId: 'acc-v', title: '标题', body: '正文', idempotencyKey: 'k-pub-x2',
  })
  assert.equal(missing.body.reason, 'material_required', '缺素材即拒绝')
  const publicDenied = await invoke(route, {
    action: 'publish.start', accountId: 'acc-v', title: '标题', body: '正文',
    imageUrls: ['https://example.com/a.jpg'], visibility: 'public', idempotencyKey: 'k-pub-x3',
  })
  assert.equal(publicDenied.body.reason, 'invalid_visibility', 'visibility 固定 private，非 private 显式拒绝')
  const noTitle = await invoke(route, { action: 'publish.start', accountId: 'acc-v', body: '正文', imageUrls: ['https://example.com/a.jpg'] })
  assert.equal(noTitle.body.reason, 'title_required')
})

test('publish.start passes {path,url} material entries through for local-first resolution', async () => {
  const captured = []
  const publish = async options => { captured.push(options); return { status: 'completed', toast: '保存成功' } }
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { publish })
  // 对象形态（review M1）：本地原文件路径优先、URL 下载兜底；宿主原样透传给 publisher。
  const started = await invoke(route, {
    action: 'publish.start', accountId: 'acc-m', title: '标题', body: '正文',
    imageUrls: [{ path: '/tmp/local/a.png', url: 'https://example.com/a.jpg' }], idempotencyKey: 'k-pub-obj',
  })
  assert.equal(started.body.status, 'started')
  assert.equal(captured[0].imageUrls[0].path, '/tmp/local/a.png', '图片对象素材 path 透传（本地优先）')
  assert.equal(captured[0].imageUrls[0].url, 'https://example.com/a.jpg', '图片对象素材 url 兜底透传')
  // 等 run 终态微任务释放 Profile 锁（同账号互斥）。
  await new Promise(resolve => setTimeout(resolve, 0))
  // 视频对象形态：Windows 盘符路径同样透传（win32 兼容）。
  const videoStarted = await invoke(route, {
    action: 'publish.start', accountId: 'acc-m', title: '标题', body: '正文',
    videoUrl: { path: 'C:\\media\\v.mp4', url: 'https://example.com/v.mp4' }, idempotencyKey: 'k-pub-obj2',
  })
  assert.equal(videoStarted.body.status, 'started')
  assert.equal(captured[1].videoUrl.path, 'C:\\media\\v.mp4', '视频对象素材盘符路径透传')
})

test('publish failure surfaces controlled error codes and releases the profile', async () => {
  const publish = async () => {
    const error = new Error('save toast not captured')
    error.code = 'SAVE_DRAFT_NO_RESPONSE'
    throw error
  }
  const events = []
  const { route } = makeCtx(async () => ({}), SCHEMAS, events, { publish })
  const started = await invoke(route, {
    action: 'publish.start', accountId: 'acc-9', title: '标题', body: '正文',
    imageUrls: ['https://example.com/a.jpg'], idempotencyKey: 'k-pub-fail',
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  const done = await invoke(route, { action: 'publish.status', publishId: started.body.publishId })
  assert.equal(done.body.publish.publishStatus, 'failed')
  assert.equal(done.body.publish.error, 'SAVE_DRAFT_NO_RESPONSE', '只透出受控错误码')
  assert.ok(events.some(event => event.actionCode === 'xhs.publish.run' && event.outcome === 'failed'))
  const after = await invoke(route, { action: 'account.probe', accountId: 'acc-9' })
  assert.notEqual(after.body.reason, 'PROFILE_BUSY', '失败同样释放 Profile（浏览器保持打开，但 run 已结束）')
})

test('publish.start returns PROFILE_BUSY while a collect is running for the same account', async () => {
  let resolveCollect
  const collect = () => new Promise(resolve => { resolveCollect = resolve })
  const publishCalls = []
  const publish = options => { publishCalls.push(options); return Promise.resolve({ status: 'completed', toast: 'x' }) }
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { collect, publish })
  const started = await invoke(route, { action: 'collect.start', accountId: 'acc-c', idempotencyKey: 'k-col' })
  assert.equal(started.body.status, 'started')
  const busyPublish = await invoke(route, {
    action: 'publish.start', accountId: 'acc-c', title: '标题', body: '正文',
    imageUrls: ['https://example.com/a.jpg'], idempotencyKey: 'k-pub-busy',
  })
  assert.equal(busyPublish.body.reason, 'PROFILE_BUSY', 'collect 运行中 publish.start → PROFILE_BUSY（互斥矩阵）')
  resolveCollect({ pagesDone: 1, notesTotal: 1, truncated: false, snapshotPath: '/tmp/x', summary: { notesCount: 1, totals: {}, gaps: {}, capturedAt: 'x' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  const okPublish = await invoke(route, {
    action: 'publish.start', accountId: 'acc-c', title: '标题', body: '正文',
    imageUrls: ['https://example.com/a.jpg'], idempotencyKey: 'k-pub-busy',
  })
  assert.equal(okPublish.body.status, 'started', '采集结束后发布可启动')
  // 幂等键重放同一 publish.start：被拒过的键未登记，正常启动
  assert.deepEqual(publishCalls.length, 1)
})

// ---------------------------------------------------------------------------
// 审查修复回归：幂等键必填 / Profile 锁生命周期 / 跨操作互斥矩阵 / 素材来源
// ---------------------------------------------------------------------------

test('create rejects missing idempotencyKey (contract: required for side effects)', async () => {
  const { route } = makeCtx(async () => ({}))
  const result = await invoke(route, { action: 'create', mediaType: 'images', imageUrls: ['https://example.com/a.jpg'] })
  assert.equal(result.status, 400)
  assert.equal(result.body.reason, 'idempotency_key_required')
})

test('collect.start rejects missing idempotencyKey', async () => {
  const collect = async () => ({ pagesDone: 1, notesTotal: 1, truncated: false, summary: {} })
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { collect })
  const result = await invoke(route, { action: 'collect.start', accountId: 'acc-k1' })
  assert.equal(result.body.status, 'error')
  assert.equal(result.body.reason, 'idempotency_key_required')
})

test('publish.start rejects missing idempotencyKey', async () => {
  const publish = async () => ({ status: 'completed', toast: '保存成功' })
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { publish })
  const result = await invoke(route, { action: 'publish.start', accountId: 'acc-k2', title: '标题', body: '正文', imageUrls: ['https://example.com/a.jpg'] })
  assert.equal(result.body.status, 'error')
  assert.equal(result.body.reason, 'idempotency_key_required')
})

test('publish keeps the profile lock while the browser stays open and releases it on context close', async () => {
  // 审查 P1：run 终态后浏览器保持打开并占用 Profile——互斥锁必须随之保持，
  // 直到用户关闭窗口（context close 事件）。
  const closeListeners = []
  const browserContext = {
    pages: () => [{ isVisible: async () => false }],
    once: (event, fn) => { if (event === 'close') closeListeners.push(fn) },
    newCDPSession: async () => makeFakeCdpLike(),
  }
  function makeFakeCdpLike() {
    return {
      async send(method) {
        if (method === 'DOM.performSearch') return { searchId: 's', resultCount: 1 }
        if (method === 'DOM.getSearchResults') return { nodeIds: [11] }
        if (method === 'DOM.describeNode') return { node: { nodeType: 1 } }
        if (method === 'DOM.getBoxModel') return { model: { content: [935, 100, 1799, 100, 1799, 150, 935, 150] } }
        return {}
      },
    }
  }
  const events = []
  let capturedOptions = null
  let resolvePublish
  const publish = options => {
    capturedOptions = options
    return new Promise(resolve => { resolvePublish = resolve })
  }
  const { route } = makeCtx(async () => ({}), SCHEMAS, events, { publish })
  const started = await invoke(route, {
    action: 'publish.start', accountId: 'acc-lock', title: '标题', body: '正文',
    imageUrls: [{ url: 'https://example.com/a.jpg', path: '' }], idempotencyKey: 'k-lock-1',
  })
  assert.equal(started.body.status, 'started')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(typeof capturedOptions.onContext === 'function', '宿主注册浏览器生命周期钩子')
  capturedOptions.onContext(browserContext)
  resolvePublish({ status: 'completed', toast: '保存成功' })
  await new Promise(resolve => setTimeout(resolve, 0))
  const done = await invoke(route, { action: 'publish.status', publishId: started.body.publishId })
  assert.equal(done.body.publish.publishStatus, 'completed')
  // 终态 + 窗口未关：同账号 probe → PROFILE_BUSY（锁保持）
  const busy = await invoke(route, { action: 'account.probe', accountId: 'acc-lock' })
  assert.equal(busy.body.reason, 'PROFILE_BUSY', '浏览器保持打开期间锁保持')
  // 用户关窗（context close）→ 锁释放
  closeListeners.forEach(fn => fn())
  const freed = await invoke(route, { action: 'account.probe', accountId: 'acc-lock' })
  assert.notEqual(freed.body.reason, 'PROFILE_BUSY', '窗口关闭后锁释放')
})

test('publish.start returns PROFILE_BUSY while a login is running (mutex matrix)', async () => {
  let resolveLogin
  const login = () => new Promise(resolve => { resolveLogin = resolve })
  const publishCalls = []
  const publish = options => { publishCalls.push(options); return Promise.resolve({ status: 'completed', toast: 'x' }) }
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { login, publish })
  const begin = await invoke(route, { action: 'account.beginLogin', accountId: 'acc-l1' })
  assert.equal(begin.body.status, 'ready')
  const started = await invoke(route, {
    action: 'publish.start', accountId: 'acc-l1', title: '标题', body: '正文',
    imageUrls: ['https://example.com/a.jpg'], idempotencyKey: 'k-mx-1',
  })
  assert.equal(started.body.reason, 'PROFILE_BUSY', '登录运行中 publish.start → PROFILE_BUSY')
  resolveLogin({ status: 'ok', accountId: 'acc-l1' })
  await new Promise(resolve => setTimeout(resolve, 0))
})

test('publish.start rejects intranet/plain-http material urls (SSRF guard)', async () => {
  const publishCalls = []
  const publish = options => { publishCalls.push(options); return Promise.resolve({ status: 'completed', toast: 'x' }) }
  const { route } = makeCtx(async () => ({}), SCHEMAS, [], { publish })
  const bad = await invoke(route, {
    action: 'publish.start', accountId: 'acc-ssrf', title: '标题', body: '正文',
    imageUrls: [{ url: 'http://192.168.1.10/secret.jpg' }], idempotencyKey: 'k-ssrf-1',
  })
  assert.equal(bad.body.status, 'error')
  assert.equal(bad.body.reason, 'MATERIAL_SOURCE_REJECTED', '内网地址拒绝（SSRF 防护）')
  assert.equal(publishCalls.length, 0, '拒绝发生在打开浏览器之前')
})
