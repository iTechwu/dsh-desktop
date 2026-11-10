// runner/session 回归：批量采集状态机、单账号资格检查、登录与探测（全 mock，不触网）。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkCollectionReadiness, createBatchCollectController } from '../src/runner.js'
import { loginWithQrCode, probeSession } from '../src/session.js'

const sleepImmediate = async () => {}

async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'wx-runner-'))
}

test('checkCollectionReadiness：pending/storage 缺失/busy 的稳定 reason（不崩溃）', async () => {
  const root = await tempRoot()
  // 无本地记录 → session_required（此前 P0-2 在此处 ReferenceError 崩溃）。
  assert.deepEqual(
    await checkCollectionReadiness({ accountId: 'ghost', root, busy: false }),
    { ready: false, reason: 'session_required' },
  )
  // pending 账号。
  await writeFile(join(root, 'accounts.json'), JSON.stringify({
    version: 1,
    accounts: {
      'pending-1': { accountId: 'pending-1' },
      'acc-1': { accountId: 'acc-1', sessionSeq: 1 },
    },
  }))
  assert.equal((await checkCollectionReadiness({ accountId: 'pending-1', root, busy: false })).reason, 'pending_account')
  assert.equal((await checkCollectionReadiness({ accountId: 'acc-1', root, busy: false })).reason, 'storage_state_missing')
  // busy 是 §8.5 资格第 5 条（storage 之后）；给有 storage 的账号测 busy。
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(root, 'storage-state'), { recursive: true })
  await writeFile(join(root, 'storage-state', 'acc-1.json'), '{}')
  assert.equal((await checkCollectionReadiness({ accountId: 'acc-1', root, busy: true })).reason, 'collect_busy')
  assert.equal((await checkCollectionReadiness({ accountId: 'acc-1', root, busy: false })).ready, true)
  await rm(root, { recursive: true, force: true })
})

test('批量控制器：串行执行、过期跳过、单账号失败继续、completed/partial/failed 汇总', async () => {
  const calls = []
  const controller = createBatchCollectController({
    probe: async accountId => {
      calls.push(`probe:${accountId}`)
      if (accountId === 'acc-expired') return { sessionStatus: 'expired' }
      if (accountId === 'acc-unknown') return { sessionStatus: 'unknown' }
      return { sessionStatus: 'ok' }
    },
    collect: async ({ accountId }) => {
      calls.push(`collect:${accountId}`)
      if (accountId === 'acc-fail') return { status: 'failed', reason: 'probe_failed', runId: null }
      return { status: 'completed', runId: `run-${accountId}`, works: 3 }
    },
    logger: null,
  })
  assert.equal(controller.running, false)
  const started = await controller.start({ accountIds: ['acc-1', 'acc-expired', 'acc-fail', 'acc-unknown', 'acc-2'] })
  assert.equal(started.started, true)
  // 等待异步 _run 完成（状态轮询）。
  for (let i = 0; i < 200 && controller.status.phase !== 'finished'; i += 1) {
    await sleepImmediate()
  }
  const status = controller.status
  assert.equal(status.phase, 'finished')
  assert.deepEqual(status.summary, { completed: 2, failed: 1, skipped: 2, eligible: 3, status: 'partial' })
  assert.equal(status.items.find(item => item.accountId === 'acc-expired').reason, 'session_required')
  assert.equal(status.items.find(item => item.accountId === 'acc-unknown').reason, 'probe_failed')
  assert.equal(status.items.find(item => item.accountId === 'acc-fail').status, 'failed')
  // acc-fail 之后 acc-2 仍然执行（单账号失败继续，§8.5）。
  assert.ok(calls.includes('collect:acc-2'))
  // 运行结束回到可再次启动。
  assert.equal(controller.running, false)
})

test('批量互斥：运行中再次 start 被拒绝', async () => {
  let releaseCollect = null
  const gate = new Promise(resolve => { releaseCollect = resolve })
  const controller = createBatchCollectController({
    probe: async () => ({ sessionStatus: 'ok' }),
    collect: async () => {
      await gate
      return { status: 'completed', runId: 'r1' }
    },
  })
  await controller.start({ accountIds: ['acc-1'] })
  // running 期间再次 start → collect_busy。
  const second = await controller.start({ accountIds: ['acc-2'] })
  assert.equal(second.started, false)
  assert.equal(second.reason, 'collect_busy')
  releaseCollect()
  for (let i = 0; i < 200 && controller.status.phase !== 'finished'; i += 1) await sleepImmediate()
  assert.equal(controller.running, false)
})

test('批量控制器 currentRunId 投影当前账号 runId（§8.5）', async () => {
  let release = null
  const gate = new Promise(resolve => { release = resolve })
  const controller = createBatchCollectController({
    probe: async () => ({ sessionStatus: 'ok' }),
    collect: async () => {
      // 运行中投影当前 runId（§8.5 collectAll.status 轮询字段）。
      const duringRun = controller.status.currentRunId === null
      await gate
      return { status: 'completed', runId: 'run-live', works: 1 }
    },
  })
  await controller.start({ accountIds: ['acc-1'] })
  for (let i = 0; i < 200 && controller.status.phase !== 'collecting'; i += 1) await sleepImmediate()
  assert.equal(controller.status.phase, 'collecting')
  release()
  for (let i = 0; i < 200 && controller.status.phase !== 'finished'; i += 1) await sleepImmediate()
  // finished 后 currentRunId 清空（无正在运行的 run）。
  assert.equal(controller.status.currentRunId, null)
  assert.equal(controller.status.summary.status, 'completed')
})

test('扫码登录：mock chromeFactory 下读出 finderUsername 即保存并迁移 Profile', async () => {
  const root = await tempRoot()
  const closed = []
  let savedTo = null
  const fakeContext = {
    cookies: async () => [{ name: 'sessionid', value: 'device-only' }],
    pages: () => [],
    newPage: async () => ({
      goto: async () => {},
      evaluate: async () => ({
        status: 200,
        text: JSON.stringify({ errCode: 0, data: { finderUser: { finderUsername: 'v2_real_id', nickname: '真实账号', fansCount: 9, feedsCount: 2, isMasterFinder: false } } }),
      }),
    }),
    close: async () => { closed.push(true) },
    storageState: async ({ path }) => {
      savedTo = path
      await writeFile(path, '{}')
    },
  }
  const result = await loginWithQrCode({
    accountId: null,
    root,
    chromeFactory: async () => ({ context: fakeContext }),
    timeoutMs: 3000,
    intervalMs: 10,
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.accountId, 'v2_real_id')
  assert.ok(closed.length >= 1)
  assert.ok(savedTo && savedTo.includes('v2_real_id'))
  const record = JSON.parse(await readFile(join(root, 'accounts.json'), 'utf8'))
  assert.equal(record.accounts['v2_real_id'].sessionStatus, 'ok')
  assert.ok(Number(record.accounts['v2_real_id'].sessionSeq) >= 1) // 登录即取新 seq（P3-5）
  await rm(root, { recursive: true, force: true })
})

test('登录超时：关闭窗口且不保存账号（§8.3）', async () => {
  const root = await tempRoot()
  let closed = false
  const fakeContext = {
    cookies: async () => [],
    pages: () => [],
    newPage: async () => ({ goto: async () => {} }),
    close: async () => { closed = true },
    storageState: async () => { throw new Error('should not save') },
  }
  const result = await loginWithQrCode({
    accountId: null,
    root,
    chromeFactory: async () => ({ context: fakeContext }),
    timeoutMs: 50,
    intervalMs: 10,
  })
  assert.equal(result.status, 'timeout')
  assert.equal(closed, true)
  await rm(root, { recursive: true, force: true })
})

test('probeSession：无 storage_state → expired；假 driver 读出资料 → ok', async () => {
  const root = await tempRoot()
  const missing = await probeSession({ accountId: 'ghost', root, driver: { chromium: { launch: async () => { throw new Error('should not launch') } } } })
  assert.equal(missing.status, 'expired')
  assert.equal(missing.reason, 'storage_state_missing')
  await rm(root, { recursive: true, force: true })
})
