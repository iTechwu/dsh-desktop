// 宿主投影回归：collect.status 的 collect 进度投影生命周期（对齐抖音 collect 投影）。
// apply() 用 overrides 注入全部外部依赖（runCollection/会话/存储/tools），webServer
// handler 通过 register 捕获直调，不起真实 HTTP 服务。
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply } from '../index.js'
import { updateAccount } from '../src/state.js'

function makeCtx() {
  const registered = []
  return {
    registered,
    logger: null,
    effect: fn => fn(),
    webServer: {
      register: entry => {
        registered.push(entry)
        return () => {}
      },
    },
  }
}

function makeReq(body) {
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    payload: null,
    setHeader(key, value) { this.headers[key] = value },
    end(text) { this.payload = JSON.parse(text) },
  }
}

async function callAction(ctx, body) {
  const handler = ctx.registered[0].handler
  const res = makeRes()
  await handler(makeReq(body), res)
  return res.payload
}

/** 采集资格检查走 state.js 真实文件（runner.js 内部 import，不走 overrides）：
 * 临时 root 里落账号记录与 storage_state 文件，资格检查才能通过。 */
async function makeRoot(accountId) {
  const root = await mkdtemp(join(tmpdir(), 'wx-host-'))
  await updateAccount(accountId, {}, root)
  const { paths } = await import('../src/state.js')
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(paths(root).storageStateDir, { recursive: true })
  await writeFile(paths(root).storageStatePath(accountId), JSON.stringify({ cookies: [] }))
  return root
}

function baseOverrides(root) {
  return {
    root,
    readAccounts: async () => ({ accounts: {} }),
    hasStorageState: async () => true,
    refreshSessionState: async () => ({ sessionStatus: 'ok', sessionSeq: 1, checkedAt: '2026-11-11T00:00:00Z', vaultRef: 'vault://x' }),
    tools: null,
  }
}

test('collect.status 投影：running 带进度，结束后回终态与 result（busy 复位晚于终态回填）', async () => {
  const ctx = makeCtx()
  let runResolve = null
  const runGate = new Promise(resolve => { runResolve = resolve })
  let capturedOnProgress = null
  const overrides = {
    ...baseOverrides(await makeRoot('acc-1')),
    runCollection: async ({ accountId, onProgress }) => {
      capturedOnProgress = onProgress
      onProgress({ phase: 'details_progress', done: 4, total: 12, detailFailed: 0 })
      await runGate
      return { status: 'completed', runId: 'run-1', works: 12 }
    },
  }
  apply(ctx, overrides)
  const handler = ctx.registered[0]

  const started = await callAction(ctx, { action: 'collect.start', accountId: 'acc-1' })
  assert.equal(started.started, true)

  // 运行中：busy=true，collect 投影为白名单形状（进度随关键事件推进）。
  const during = await callAction(ctx, { action: 'collect.status' })
  assert.equal(during.busy, true)
  assert.equal(during.collect.status, 'running')
  assert.equal(during.collect.accountId, 'acc-1')
  assert.deepEqual(during.collect.progress, { phase: 'work', index: 4, total: 12 })
  // 非关键事件不覆盖进度；投影不含任何敏感字段。
  capturedOnProgress({ phase: 'detail_gap', workId: 'w1' })
  const during2 = await callAction(ctx, { action: 'collect.status' })
  assert.deepEqual(during2.collect.progress, { phase: 'work', index: 4, total: 12 })
  assert.deepEqual(Object.keys(during2.collect).sort(), [
    'accountId', 'error', 'finishedAt', 'progress', 'result', 'startedAt', 'status',
  ])

  // 结束：busy=false 时终态与 result 已回填（then 先于 finally）。
  runResolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  const final = await callAction(ctx, { action: 'collect.status' })
  assert.equal(final.busy, false)
  assert.equal(final.collect.status, 'completed')
  assert.deepEqual(final.collect.result, { runId: 'run-1', works: 12 })
  assert.equal(final.collect.error, null)
})

test('collect.start 失败终态：runCollection 抛错回 failed + 稳定码（不透传原文）', async () => {
  const ctx = makeCtx()
  const overrides = {
    ...baseOverrides(await makeRoot('acc-2')),
    runCollection: async () => {
      throw new Error('raw internal failure')
    },
  }
  apply(ctx, overrides)
  const started = await callAction(ctx, { action: 'collect.start', accountId: 'acc-2' })
  assert.equal(started.started, true)
  await new Promise(resolve => setTimeout(resolve, 0))
  const final = await callAction(ctx, { action: 'collect.status' })
  assert.equal(final.busy, false)
  assert.equal(final.collect.status, 'failed')
  assert.equal(final.collect.error, 'wx_channels_operation_request_failed')
})

test('collectAll.start 回执携带批量投影：页面即时渲染「正在检查会话」', async () => {
  const ctx = makeCtx()
  const overrides = {
    ...baseOverrides(await makeRoot('acc-3')),
    batchController: {
      running: false,
      start: async () => ({ started: true, batchId: 'batch-1' }),
      get status() { return { ready: false, phase: 'probing', items: [{ accountId: 'a' }], total: 1, currentAccountIndex: 0, currentAccountId: 'a', currentProgress: null } },
    },
  }
  apply(ctx, overrides)
  const result = await callAction(ctx, { action: 'collectAll.start' })
  assert.equal(result.started, true)
  assert.equal(result.batch.phase, 'probing')
  assert.equal(result.batch.currentAccountId, 'a')
})

test('登录成功后 account_save 走 deps.tools || ctx 兜底（2026-11-11 前接线缺陷：静默跳过致云端永无账号行）', async () => {
  const calls = []
  const ctx = makeCtx()
  // 生产形态：deps.tools 为 null（仅测试注入才有值），工具必须兜底到宿主 ctx 解析。
  ctx.tools = {
    schemas: () => [{ name: 'wx_channels_account_save' }, { name: 'wx_channels_session_status_report' }],
    execute: async ({ name, arguments: args }) => {
      calls.push({ name, args })
      return { structuredContent: { status: 'ok' } }
    },
  }
  const overrides = {
    ...baseOverrides('wx-host-login-root'),
    tools: null,
    login: async () => ({ status: 'ok', accountId: 'acc-login', profile: { nickname: '测试号', fansCount: 10 } }),
    getAccount: async () => ({ sessionSeq: 0 }),
  }
  apply(ctx, overrides)
  const started = await callAction(ctx, { action: 'account.beginLogin', accountId: 'acc-login' })
  assert.equal(started.state, 'waiting_qr')
  // 等 login promise 链（then 内先 await save 再翻 ok）落定。
  for (let i = 0; i < 50 && calls.length === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(calls.map(item => item.name), ['wx_channels_account_save'])
  const save = calls[0].args
  assert.equal(save.accountId, 'acc-login')
  assert.equal(save.nickname, '测试号')
  assert.equal(save.followerTotalCount, 10)
  assert.ok(String(save.sessionRef).startsWith('vault://wx-channels/'))
  assert.ok(save.idempotencyKey)
  const status = await callAction(ctx, { action: 'account.loginStatus', accountId: 'acc-login' })
  assert.equal(status.state, 'ok')
  assert.equal(status.reason, null)
})

test('登录 save 失败：本地登录态保留（state ok）且原因透出到 loginStatus（不再静默）', async () => {
  const ctx = makeCtx()
  ctx.tools = {
    schemas: () => [{ name: 'wx_channels_account_save' }],
    execute: async () => {
      const error = new Error('{"error":{"code":"ACCOUNT_NOT_FOUND"}}')
      error.code = 'ACCOUNT_NOT_FOUND'
      throw error
    },
  }
  const overrides = {
    ...baseOverrides('wx-host-login-root'),
    tools: null,
    login: async () => ({ status: 'ok', accountId: 'acc-save-fail', profile: {} }),
    getAccount: async () => ({ sessionSeq: 0 }),
  }
  apply(ctx, overrides)
  await callAction(ctx, { action: 'account.beginLogin', accountId: 'acc-save-fail' })
  let status = null
  for (let i = 0; i < 50; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
    status = await callAction(ctx, { action: 'account.loginStatus', accountId: 'acc-save-fail' })
    if (status.state === 'ok') break
  }
  assert.equal(status.state, 'ok', 'save 失败不回滚本地登录成功')
  assert.equal(status.reason, 'ACCOUNT_NOT_FOUND')
})
