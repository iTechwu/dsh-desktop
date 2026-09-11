// 采集执行器与控制器回归：会话前置、成功路径、失败原因码、单账号串行。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkCollectionReadiness, createCollectController, ensureRemoteAccount, runAccountCollection } from '../src/runner.js'
import { paths, readAccounts, updateAccount } from '../src/state.js'

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'douyin-runner-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// 伪造页面：works 条作品 + 空热词 + 画像，供采集编排跑通全链路。
function fakeSession({ workCount = 3 } = {}) {
  const list = Array.from({ length: workCount }, (_, index) => ({
    aweme_id: `70000000000000000${index}`,
    desc: `作品 ${index}`,
    create_time: 1787000000,
    statistics: { play_count: 100 + index, digg_count: 1, comment_count: 1, collect_count: 1, share_count: 1 },
    video: { duration: 30000, cover: { url_list: ['https://example.invalid/c.jpeg'] } },
    status: { is_private: false },
  }))
  const page = {
    async goto() { return { status: 200 } },
    on() {}, off() {},
    async waitForTimeout() {},
    async evaluate(_fn, arg) {
      const url = typeof arg === 'string' ? arg : arg && arg.url
      const reply = value => ({ status: 200, text: JSON.stringify(value) })
      if (url.includes('work_list')) return reply({ status_code: 0, aweme_list: list, has_more: false, max_cursor: 1 })
      if (url.includes('wordCloud')) return reply({ status_code: 0, word_cloud_list: [] })
      if (url.includes('user/info')) return reply({ user: { sec_uid: 'acc-1', nickname: '示例账号', follower_count: 290 } })
      if (url.includes('play/source')) return reply({ status_code: 0, play_source: [{ key: 'homepage_hot', value: 0.99 }] })
      if (url.includes('item_compare')) return reply({ status_code: 10001, item: {}, compare_item_ids: [] })
      if (url.includes('portrait')) return reply({ status_code: 0, gender: { ratio_list: [{ key: 'male', value: 0.9 }] } })
      if (url.includes('involved_vertical')) return reply({ primary_verticals: [] })
      return reply({ status_code: 0 })
    },
  }
  return {
    browser: { close: async () => {} },
    context: { newPage: async () => page, close: async () => {} },
  }
}

async function withSessionFile(root, accountId = 'acc-1') {
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(paths(root).storageStateDir, { recursive: true })
  await writeFile(paths(root).storageStatePath(accountId), '{"cookies":[],"origins":[]}')
  return paths(root).storageStatePath(accountId)
}

test('缺少本地会话文件：直接返回 session_required，不启动浏览器', async () => {
  await withRoot(async root => {
    let launched = false
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async () => ({}),
      storageStatePath: paths(root).storageStatePath('acc-1'),
      sessionFactory: async () => { launched = true; return fakeSession() },
    })
    assert.equal(result.status, 'session_required')
    assert.equal(launched, false)
  })
})

test('采集成功：列表完整 + 分批入库 + 服务端结算', async () => {
  await withRoot(async root => {
    const calls = []
    const events = []
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async (name, args) => {
        calls.push({ name, args })
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-1', last_heartbeat_seq: 0 }, reused: false }
        if (name === 'douyin_collect_run_set_list_meta') return { run: { run_id: 'run-1' } }
        if (name === 'douyin_collect_ingest_batch') {
          return { run: { run_id: 'run-1' }, batch: { batch_no: args.batchNo, status: 'completed', succeeded_work_ids: args.works.map(w => w.work_id), failed_work_ids: [] }, replayed: false }
        }
        if (name === 'douyin_collect_run_finish') return { run: { run_id: 'run-1', status: 'completed' }, settlement: { succeeded_work_count: 3 }, replayed: false }
        return {}
      },
      storageStatePath: await withSessionFile(root),
      sessionFactory: async () => fakeSession({ workCount: 3 }),
      onProgress: event => events.push(event.phase),
    })
    assert.equal(result.status, 'ready')
    assert.equal(result.runStatus, 'completed')
    assert.equal(result.succeededWorkCount, 3)
    assert.ok(calls.some(call => call.name === 'douyin_collect_run_finish'))
    assert.ok(events.includes('session_open'))
  })
})

test('采集阶段抛错：返回稳定原因码，不抛出原始错误', async () => {
  await withRoot(async root => {
    const error = new Error('boom')
    error.name = 'TimeoutError'
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async () => ({}),
      storageStatePath: await withSessionFile(root),
      sessionFactory: async () => { throw error },
    })
    assert.equal(result.status, 'collect_failed')
    assert.equal(result.reason, 'TimeoutError')
  })
})

test('入库失败：返回 ingest_failed 与稳定原因', async () => {
  await withRoot(async root => {
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async name => {
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-1', last_heartbeat_seq: 0 } }
        if (name === 'douyin_collect_run_set_list_meta') {
          const error = new Error('RUN_LIST_META_REQUIRED')
          error.code = 'RUN_LIST_META_REQUIRED'
          throw error
        }
        return {}
      },
      storageStatePath: await withSessionFile(root),
      sessionFactory: async () => fakeSession({ workCount: 1 }),
    })
    assert.equal(result.status, 'ingest_failed')
    assert.equal(result.reason, 'RUN_LIST_META_REQUIRED')
  })
})

test('采集控制器：同一账号同时只有一个采集在跑；完成后可再次启动', async () => {
  await withRoot(async root => {
    let release = null
    const pending = new Promise(resolve => { release = resolve })
    let invocations = 0
    const controller = createCollectController({
      runCollection: async ({ onProgress }) => {
        invocations += 1
        onProgress({ phase: 'work', index: 1, total: 2, workId: 'w1' })
        await pending
        return { status: 'ready', runId: 'run-1', runStatus: 'completed', expectedWorkCount: 2, succeededWorkCount: 2, failedWorkCount: 0 }
      },
    })

    const first = await controller.start({ accountId: 'acc-1', options: {} })
    assert.equal(first.collect.status, 'running')
    const second = await controller.start({ accountId: 'acc-1', options: {} })
    assert.equal(second.collect.status, 'running')
    assert.equal(invocations, 1, '重复点击不产生并发采集')

    const progress = controller.status('acc-1')
    assert.equal(progress.collect.progress.phase, 'work')
    assert.equal(progress.collect.progress.index, 1)

    release()
    const done = await controller.wait('acc-1')
    assert.equal(done.status, 'completed')
    assert.equal(done.result.succeededWorkCount, 2)

    const again = await controller.start({ accountId: 'acc-1', options: {} })
    assert.equal(again.collect.status, 'running')
    assert.equal(invocations, 2)
  })
})

test('采集控制器：runCollection 抛错时记录失败原因', async () => {
  const error = new Error('driver missing')
  error.code = 'PLAYWRIGHT_DRIVER_MISSING'
  const controller = createCollectController({ runCollection: async () => { throw error } })
  await controller.start({ accountId: 'acc-1', options: {} })
  const done = await controller.wait('acc-1')
  assert.equal(done.status, 'failed')
  assert.equal(done.error, 'PLAYWRIGHT_DRIVER_MISSING')
})

test('采集前就绪检查：无 storage_state 时要求重新登录', async () => {
  await withRoot(async root => {
    assert.deepEqual(await checkCollectionReadiness({ accountId: 'acc-1', root }), { ready: false, reason: 'session_required' })
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await writeFile(paths(root).storageStatePath('acc-1'), '{"cookies":[]}')
    assert.deepEqual(await checkCollectionReadiness({ accountId: 'acc-1', root }), { ready: true, reason: null })
  })
})

test('远端账号自愈：采集前补发 account_save（幂等 upsert，只带 vault:// 引用）', async () => {
  await withRoot(async root => {
    await updateAccount('acc-1', { nickname: '示例账号', fanCount: 291 }, root)
    const calls = []
    const events = []
    const result = await ensureRemoteAccount(async (name, args) => {
      calls.push({ name, args })
      return { account: { accountId: args.accountId }, created: true }
    }, 'acc-1', { root, onProgress: event => events.push(event.phase) })
    assert.deepEqual(result, { ok: true, error: null })
    assert.equal(calls.length, 1)
    const { name, args } = calls[0]
    assert.equal(name, 'douyin_account_save')
    assert.equal(args.accountId, 'acc-1')
    assert.equal(args.nickname, '示例账号')
    assert.equal(args.fanCount, 291)
    assert.equal(args.sessionRef, 'vault://douyin/acc-1', 'Cookie/storage_state 永不离开设备，只报不透明引用')
    assert.match(args.idempotencyKey, /^douyin:account:acc-1:\d+$/)
    assert.deepEqual(events, ['account_sync'])
  })
})

test('远端账号自愈：本地资料缺项时载荷缺字段而不是 undefined（宿主 snapshot 硬约束）', async () => {
  await withRoot(async root => {
    await updateAccount('acc-1', {}, root)
    const calls = []
    const result = await ensureRemoteAccount(async (name, args) => {
      calls.push({ name, args })
      return { account: { accountId: args.accountId }, created: true }
    }, 'acc-1', { root })
    assert.deepEqual(result, { ok: true, error: null })
    const { args } = calls[0]
    // 宿主 snapshotJsonValue 对 undefined 值属性是整调用拒绝；缺项字段必须缺席。
    for (const [key, value] of Object.entries(args)) {
      assert.notEqual(value, undefined, `自愈 save 载荷字段 ${key} 不得为 undefined`)
    }
    assert.deepEqual(Object.keys(args).sort(), ['accountId', 'idempotencyKey', 'sessionRef'])
  })
})

test('远端账号自愈失败不抛出：透出稳定原因码，交由 run_start 给最终裁决', async () => {
  await withRoot(async root => {
    const events = []
    const result = await ensureRemoteAccount(async () => {
      throw Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' })
    }, 'acc-1', { root, onProgress: event => events.push(event) })
    assert.deepEqual(result, { ok: false, error: 'UNAUTHORIZED' })
    assert.deepEqual(events, [
      { phase: 'account_sync' },
      { phase: 'account_sync_failed', error: 'UNAUTHORIZED' },
    ])
  })
})

test('自愈兜底链路：save 失败可容忍，账号真缺失时由 run_start 返回 ACCOUNT_NOT_FOUND', async () => {
  await withRoot(async root => {
    const events = []
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async name => {
        if (name === 'douyin_account_save') throw Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' })
        throw Object.assign(new Error('ACCOUNT_NOT_FOUND'), { code: 'ACCOUNT_NOT_FOUND' })
      },
      storageStatePath: await withSessionFile(root),
      sessionFactory: async () => fakeSession({ workCount: 1 }),
      onProgress: event => events.push(event.phase),
    })
    assert.equal(result.status, 'ingest_failed')
    assert.equal(result.reason, 'ACCOUNT_NOT_FOUND')
    // 自愈先于采集执行；其失败只作为事件透出，不阻断链路。
    const syncIndex = events.indexOf('account_sync')
    const openIndex = events.indexOf('session_open')
    assert.ok(syncIndex !== -1 && openIndex > syncIndex, 'account_sync 必须发生在 session_open 之前')
    assert.ok(events.includes('account_sync_failed'))
    // 失败的 run_start 不得落盘任何账号运行状态（历史上这曾是 runId: null 的脏状态来源）。
    const state = await readAccounts(root)
    assert.equal(state.accounts['acc-1'], undefined)
  })
})
