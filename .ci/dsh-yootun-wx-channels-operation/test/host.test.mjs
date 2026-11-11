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
