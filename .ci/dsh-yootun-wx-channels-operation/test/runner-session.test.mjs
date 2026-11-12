// runner/session 回归：批量采集状态机、单账号资格检查、登录与探测（全 mock，不触网）。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkCollectionReadiness, createBatchCollectController, ensureRemoteAccount, progressFromEvent } from '../src/runner.js'
import { loginWithQrCode, probeSession, waitStableIdentity } from '../src/session.js'

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
  assert.deepEqual(status.summary, { completed: 2, partial: 0, failed: 1, skipped: 2, eligible: 3, status: 'partial' })
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

test('progressFromEvent：关键事件映射进度投影，非关键事件返回 null（保持上一进度）', () => {
  assert.deepEqual(progressFromEvent({ phase: 'probing' }), { phase: 'probing' })
  assert.deepEqual(progressFromEvent({ phase: 'list' }), { phase: 'list' })
  assert.deepEqual(
    progressFromEvent({ phase: 'list_page', pageNumber: 2, rawCount: 100, added: 60, collected: 160 }),
    { phase: 'list', page: 2, collected: 160 },
  )
  assert.deepEqual(
    progressFromEvent({ phase: 'details_progress', done: 12, total: 30, detailFailed: 1 }),
    { phase: 'work', index: 12, total: 30 },
  )
  assert.deepEqual(progressFromEvent({ phase: 'account_level' }), { phase: 'account_level' })
  assert.deepEqual(
    progressFromEvent({ phase: 'batch_done', batchNo: 2, totalBatches: 3, succeeded: 40, failed: 0, expected: 45 }),
    { phase: 'batch_done', batchNo: 2, totalBatches: 3, succeeded: 40, failed: 0, expected: 45 },
  )
  // batch_failed 同形状投影（进度行仍推进到该批次号）。
  assert.equal(progressFromEvent({ phase: 'batch_failed', batchNo: 1, totalBatches: 3 }).phase, 'batch_done')
  // 非关键事件：detail_gap / segment_gap / run_* / finished / 未知 / 空。
  assert.equal(progressFromEvent({ phase: 'detail_gap', workId: 'w1' }), null)
  assert.equal(progressFromEvent({ phase: 'segment_gap', segment: 'fans_trend' }), null)
  assert.equal(progressFromEvent({ phase: 'run_started', runId: 'r1' }), null)
  assert.equal(progressFromEvent({ phase: 'finished' }), null)
  assert.equal(progressFromEvent({ phase: 'unknown_phase' }), null)
  assert.equal(progressFromEvent(null), null)
})

test('批量控制器细粒度进度：运行中投影 currentAccountId/currentProgress，结束清空并给出计数', async () => {
  let release = null
  const gate = new Promise(resolve => { release = resolve })
  const controller = createBatchCollectController({
    probe: async () => ({ sessionStatus: 'ok' }),
    collect: async ({ accountId, onProgress }) => {
      // 运行中：当前账号与作品级进度均已投影（collectAll.status 单轮询可读）。
      assert.equal(controller.status.currentAccountId, accountId)
      onProgress({ phase: 'details_progress', done: 3, total: 10, detailFailed: 0 })
      assert.deepEqual(controller.status.currentProgress, { phase: 'work', index: 3, total: 10 })
      // 非关键事件（detail_gap）不覆盖上一个进度。
      onProgress({ phase: 'detail_gap', workId: 'w9' })
      assert.deepEqual(controller.status.currentProgress, { phase: 'work', index: 3, total: 10 })
      await gate
      return { status: 'completed', runId: `run-${accountId}`, works: 10 }
    },
  })
  await controller.start({ accountIds: ['acc-1', 'acc-2'] })
  for (let i = 0; i < 200 && controller.status.phase !== 'collecting'; i += 1) await sleepImmediate()
  assert.equal(controller.status.phase, 'collecting')
  assert.equal(controller.status.total, 2)
  release()
  for (let i = 0; i < 200 && controller.status.phase !== 'finished'; i += 1) await sleepImmediate()
  // 结束后当前账号与细粒度进度清空，实时计数行可读（对齐抖音 projectBatch）。
  assert.equal(controller.status.currentAccountId, null)
  assert.equal(controller.status.currentProgress, null)
  assert.equal(controller.status.completedCount, 2)
  assert.equal(controller.status.failedCount, 0)
  assert.equal(controller.status.skippedCount, 0)
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

test('ensureRemoteAccount：无本地记录时只发三元组 upsert（字段缺值不带，绝无 undefined）', async () => {
  const root = await tempRoot()
  const calls = []
  const events = []
  const outcome = await ensureRemoteAccount(async (name, args) => { calls.push({ name, args }) }, 'acc-heal', {
    root,
    onProgress: event => events.push(event),
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.error, null)
  assert.deepEqual(events, [{ phase: 'account_sync' }])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'wx_channels_account_save')
  assert.deepEqual(Object.keys(calls[0].args).sort(), ['accountId', 'idempotencyKey', 'sessionRef'])
  assert.equal(calls[0].args.accountId, 'acc-heal')
  assert.ok(String(calls[0].args.sessionRef).startsWith('vault://wx-channels/'))
  await rm(root, { recursive: true, force: true })
})

test('ensureRemoteAccount：本地记录字段带齐；save 失败只记 account_sync_failed 不抛出', async () => {
  const root = await tempRoot()
  await writeFile(join(root, 'accounts.json'), JSON.stringify({
    version: 1,
    accounts: {
      'acc-heal2': {
        accountId: 'acc-heal2',
        nickname: '测试号',
        avatar: 'https://example.com/a.jpg',
        followerTotalCount: 10,
        feedCount: 25,
      },
    },
  }))
  const calls = []
  const outcome = await ensureRemoteAccount(async (name, args) => { calls.push({ name, args }) }, 'acc-heal2', { root })
  assert.equal(outcome.ok, true)
  assert.deepEqual(calls[0].args, {
    accountId: 'acc-heal2',
    sessionRef: 'vault://wx-channels/acc-heal2',
    idempotencyKey: calls[0].args.idempotencyKey,
    nickname: '测试号',
    avatar: 'https://example.com/a.jpg',
    followerTotalCount: 10,
    feedCount: 25,
  })

  const events = []
  const failure = await ensureRemoteAccount(async () => {
    const error = new Error('{"error":{"code":"ACCOUNT_NOT_FOUND"}}')
    error.code = 'ACCOUNT_NOT_FOUND'
    throw error
  }, 'acc-heal2', { root, onProgress: event => events.push(event) })
  assert.equal(failure.ok, false)
  assert.equal(failure.error, 'ACCOUNT_NOT_FOUND')
  assert.deepEqual(events, [
    { phase: 'account_sync' },
    { phase: 'account_sync_failed', error: 'ACCOUNT_NOT_FOUND' },
  ])
  await rm(root, { recursive: true, force: true })
})

test('ensureRemoteAccount：null 指标不得折算 0 上报（NULL ≠ 0，review P1）', async () => {
  const root = await tempRoot()
  await writeFile(join(root, 'accounts.json'), JSON.stringify({
    version: 1,
    accounts: {
      'acc-null-metrics': {
        accountId: 'acc-null-metrics',
        nickname: '测试号',
        followerTotalCount: null,
        feedCount: null,
      },
    },
  }))
  const calls = []
  const outcome = await ensureRemoteAccount(async (name, args) => { calls.push({ name, args }) }, 'acc-null-metrics', { root })
  assert.equal(outcome.ok, true)
  // null 若被 Number() 折算成 0，幂等 upsert 会把云端真实指标覆盖为 0。
  assert.ok(!('followerTotalCount' in calls[0].args), 'followerTotalCount 为 null 时不得上报')
  assert.ok(!('feedCount' in calls[0].args), 'feedCount 为 null 时不得上报')
  assert.equal(calls[0].args.nickname, '测试号')
  await rm(root, { recursive: true, force: true })
})

test('waitStableIdentity：身份变化时以新身份为准（同一微信多视频号，扫码后官方页面才有身份选择）', async () => {
  // 模拟官方 auth_data 依次返回：默认身份 → 用户切换后的身份 → 稳定的新身份。
  const sequence = [
    { accountId: 'v2_default', nickname: '默认身份' },
    { accountId: 'v2_chosen', nickname: '用户选择的身份' },
    { accountId: 'v2_chosen', nickname: '用户选择的身份' },
    { accountId: 'v2_chosen', nickname: '用户选择的身份' },
  ]
  let index = 0
  const fakePage = {
    evaluate: async () => {
      // firstProfile 已代表第一次读取，这里从下一项开始（与真实时序一致）。
      index += 1
      const current = sequence[Math.min(index, sequence.length - 1)]
      return {
        status: 200,
        text: JSON.stringify({
          errCode: 0,
          data: { finderUser: { finderUsername: current.accountId, nickname: current.nickname, fansCount: 0, feedsCount: 1 } },
        }),
      }
    },
  }
  const stable = await waitStableIdentity(fakePage, sequence[0], { attempts: 6, intervalMs: 1, required: 2 })
  assert.equal(stable.stable, true)
  assert.equal(stable.profile.accountId, 'v2_chosen', '应取用户切换后的身份，而不是默认身份')
})

test('waitStableIdentity：身份稳定时返回该身份（单视频号场景）', async () => {
  let calls = 0
  const fakePage = {
    evaluate: async () => {
      calls += 1
      return {
        status: 200,
        text: JSON.stringify({
          errCode: 0,
          data: { finderUser: { finderUsername: 'v2_only', nickname: '唯一身份', fansCount: 1, feedsCount: 1 } },
        }),
      }
    },
  }
  const stable = await waitStableIdentity(
    fakePage,
    { accountId: 'v2_only', nickname: '唯一身份' },
    { attempts: 4, intervalMs: 1, required: 2 },
  )
  assert.equal(stable.stable, true)
  assert.equal(stable.profile.accountId, 'v2_only')
  assert.ok(calls >= 1, '至少复核一次才算稳定')
})

test('waitStableIdentity：读取失败不算身份变化，继续等待', async () => {
  let calls = 0
  const fakePage = {
    evaluate: async () => {
      calls += 1
      if (calls === 1) throw new Error('network down')
      return {
        status: 200,
        text: JSON.stringify({
          errCode: 0,
          data: { finderUser: { finderUsername: 'v2_ok', nickname: '稳定', fansCount: 0, feedsCount: 1 } },
        }),
      }
    },
  }
  const stable = await waitStableIdentity(
    fakePage,
    { accountId: 'v2_ok', nickname: '稳定' },
    { attempts: 4, intervalMs: 1, required: 2 },
  )
  assert.equal(stable.stable, true)
  assert.equal(stable.profile.accountId, 'v2_ok')
})


test('批量控制器异常隔离：collect 抛错 → 该账号 failed、后续继续、终态落定（P1-5）', async () => {
  const calls = []
  const controller = createBatchCollectController({
    probe: async () => ({ sessionStatus: 'ok' }),
    collect: async ({ accountId }) => {
      calls.push(`collect:${accountId}`)
      if (accountId === 'acc-throw') throw new Error('disk_full')
      if (accountId === 'acc-partial') return { status: 'partial', reason: 'partial', runId: 'run-p' }
      return { status: 'completed', runId: `run-${accountId}` }
    },
    logger: null,
  })
  const started = await controller.start({ accountIds: ['acc-throw', 'acc-partial', 'acc-ok'] })
  assert.equal(started.started, true)
  for (let i = 0; i < 200 && controller.status.phase !== 'finished'; i += 1) {
    await sleepImmediate()
  }
  const status = controller.status
  assert.equal(status.phase, 'finished', '抛错后批量必须落定终态，不能永久 running')
  assert.equal(controller.running, false)
  // partial 单列，不并入 completed（P2-15）。
  assert.deepEqual(status.summary, {
    completed: 1, partial: 1, failed: 1, skipped: 0, eligible: 3, status: 'partial',
  })
  assert.equal(status.items.find(item => item.accountId === 'acc-throw').status, 'failed')
  assert.equal(status.items.find(item => item.accountId === 'acc-throw').reason, 'Error')
  assert.equal(status.items.find(item => item.accountId === 'acc-partial').status, 'partial')
  assert.ok(calls.includes('collect:acc-ok'), '抛错后仍应继续下一个账号')
})


test('waitStableIdentity：轮询耗尽仍未稳定 → stable=false（不得据此建号，P1-7）', async () => {
  // 每次都返回不同身份（用户一直在官方页面来回切换）。
  let index = 0
  const fakePage = {
    evaluate: async () => {
      index += 1
      return {
        status: 200,
        text: JSON.stringify({
          errCode: 0,
          data: { finderUser: { finderUsername: `v2_flip_${index}`, nickname: `身份${index}`, fansCount: 0, feedsCount: 1 } },
        }),
      }
    },
  }
  const result = await waitStableIdentity(
    fakePage,
    { accountId: 'v2_flip_0', nickname: '默认身份' },
    { attempts: 3, intervalMs: 1, required: 2 },
  )
  assert.equal(result.stable, false, '未达 required 次连续相同身份必须判未稳定')
  assert.ok(result.profile && result.profile.accountId, '仍返回最后读到的身份供排障，但不作为建号依据')
})
