// 采集执行器与控制器回归：会话前置、成功路径、失败原因码、单账号串行。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { checkCollectionReadiness, createCollectController, ensureRemoteAccount, runAccountCollection, saveDiscoveredAvatar } from '../src/runner.js'
import { getAccount, paths, readAccounts, updateAccount } from '../src/state.js'

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'douyin-runner-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// 伪造页面：works 条作品 + 空热词 + 画像，供采集编排跑通全链路。
function fakeSession({ workCount = 3, avatar = null } = {}) {
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
      if (url.includes('user/info')) {
        const user = { sec_uid: 'acc-1', nickname: '示例账号', follower_count: 290 }
        if (avatar !== null) user.avatar_uri = avatar
        return reply({ user })
      }
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

// ── 采集完成后头像回写（二次优化 §5.1.3/§5.1.4）─────────────────────────────

const AVATAR = 'https://p3.example.invalid/av.jpeg'

test('头像回写：当前账号无头像时写入合法新头像，返回 updated', async () => {
  await withRoot(async root => {
    const outcome = await saveDiscoveredAvatar({
      accountId: 'acc-1',
      profile: { accountId: 'acc-1', avatar: AVATAR },
      root,
    })
    assert.deepEqual(outcome, { updated: true, reason: null })
    const record = await getAccount('acc-1', root)
    assert.equal(record.avatar, AVATAR)
  })
})

test('头像回写：已有合法头像时不被空值/异常值/新值覆盖', async () => {
  await withRoot(async root => {
    await updateAccount('acc-1', { avatar: 'https://p3.example.invalid/old.jpeg' }, root)
    for (const avatar of [null, '', 'javascript:alert(1)']) {
      const outcome = await saveDiscoveredAvatar({ accountId: 'acc-1', profile: { accountId: 'acc-1', avatar }, root })
      assert.equal(outcome.updated, false, `头像 ${String(avatar)} 不得覆盖已有有效头像`)
      assert.equal(outcome.reason, 'avatar_invalid', '非法头像先被拒绝，到不了覆盖判断')
    }
    assert.deepEqual(
      await saveDiscoveredAvatar({ accountId: 'acc-1', profile: { accountId: 'acc-1', avatar: AVATAR }, root }),
      { updated: false, reason: 'avatar_exists' },
      '合法新头像同样不覆盖',
    )
    const record = await getAccount('acc-1', root)
    assert.equal(record.avatar, 'https://p3.example.invalid/old.jpeg')
  })
})

test('头像回写：profile 账号 ID 不一致时不写入目标账号（只给稳定 reason）', async () => {
  await withRoot(async root => {
    const outcome = await saveDiscoveredAvatar({
      accountId: 'acc-1',
      profile: { accountId: 'acc-2', avatar: AVATAR },
      root,
    })
    assert.deepEqual(outcome, { updated: false, reason: 'account_mismatch' })
    assert.equal(await getAccount('acc-1', root), null)
    assert.equal(await getAccount('acc-2', root), null, '另一个账号也不得被写入')
  })
})

test('头像回写：profile 缺失/头像非法时不动本地记录', async () => {
  await withRoot(async root => {
    assert.deepEqual(
      await saveDiscoveredAvatar({ accountId: 'acc-1', profile: null, root }),
      { updated: false, reason: 'profile_missing' },
    )
    assert.deepEqual(
      await saveDiscoveredAvatar({ accountId: 'acc-1', profile: { accountId: 'acc-1', avatar: 'data:image/png;base64,AA' }, root }),
      { updated: false, reason: 'avatar_invalid' },
    )
    assert.equal(await getAccount('acc-1', root), null)
  })
})

test('头像回写：本地写入失败收敛为 avatar_save_failed，绝不抛原始文件错误', async () => {
  await withRoot(async root => {
    // accounts.json 写入非法 JSON → readAccounts 抛错 → saveDiscoveredAvatar 内部收敛。
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(root, { recursive: true })
    await writeFile(paths(root).accountsFile, '{not-json', 'utf8')
    const outcome = await saveDiscoveredAvatar({
      accountId: 'acc-1',
      profile: { accountId: 'acc-1', avatar: AVATAR },
      root,
    })
    assert.deepEqual(outcome, { updated: false, reason: 'avatar_save_failed' })
  })
})

test('采集链路：图集对象头像在采集完成后补写本地，且旧数据不被覆盖', async () => {
  await withRoot(async root => {
    // 预置已有有效头像 → 采集到新头像也不覆盖。
    await updateAccount('acc-1', { avatar: 'https://p3.example.invalid/kept.jpeg' }, root)
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async name => {
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-1', last_heartbeat_seq: 0 }, reused: false }
        if (name === 'douyin_collect_run_set_list_meta') return { run: { run_id: 'run-1' } }
        if (name === 'douyin_collect_ingest_batch') {
          return { run: { run_id: 'run-1' }, batch: { batch_no: 1, status: 'completed', succeeded_work_ids: [], failed_work_ids: [] } }
        }
        if (name === 'douyin_collect_run_finish') return { run: { run_id: 'run-1', status: 'completed' }, settlement: {}, replayed: false }
        return {}
      },
      storageStatePath: await withSessionFile(root),
      sessionFactory: () => fakeSession({ avatar: { uri: 'x', url_list: ['bad', 'https://p3.example.invalid/new.jpeg'] } }),
    })
    assert.equal(result.status, 'ready')
    const record = await getAccount('acc-1', root)
    assert.equal(record.avatar, 'https://p3.example.invalid/kept.jpeg', '已有有效头像不被采集结果覆盖')
  })
})

test('采集链路：无头像账号采集后补写本地并经 douyin_account_save 幂等补传远端', async () => {
  await withRoot(async root => {
    const saves = []
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async (name, args) => {
        if (name === 'douyin_account_save') { saves.push(args); return { account: { accountId: args.accountId } } }
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-1', last_heartbeat_seq: 0 }, reused: false }
        if (name === 'douyin_collect_run_set_list_meta') return { run: { run_id: 'run-1' } }
        if (name === 'douyin_collect_ingest_batch') {
          return { run: { run_id: 'run-1' }, batch: { batch_no: 1, status: 'completed', succeeded_work_ids: [], failed_work_ids: [] } }
        }
        if (name === 'douyin_collect_run_finish') return { run: { run_id: 'run-1', status: 'completed' }, settlement: {}, replayed: false }
        return {}
      },
      storageStatePath: await withSessionFile(root),
      sessionFactory: () => fakeSession({ avatar: { url_list: ['invalid', AVATAR] } }),
    })
    assert.equal(result.status, 'ready', '头像补写不改变采集结果')
    assert.equal((await getAccount('acc-1', root)).avatar, AVATAR, '本地头像已补写')
    assert.equal(saves.length, 2, '自愈 + 头像补传共两次 account_save')
    const sync = saves[1]
    assert.equal(sync.avatar, AVATAR, '只发送标准化后的非空字符串')
    assert.equal(sync.sessionRef, 'vault://douyin/acc-1', '只带 vault:// 不透明引用')
    assert.match(sync.idempotencyKey, /^douyin:account:acc-1:\d+$/)
    for (const [key, value] of Object.entries(sync)) assert.notEqual(value, undefined, `字段 ${key} 不得为 undefined`)
  })
})

test('采集链路：头像本地写入失败或远端同步失败均不阻断作品入库', async () => {
  await withRoot(async root => {
    const events = []
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async name => {
        if (name === 'douyin_account_save') throw Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' })
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-1', last_heartbeat_seq: 0 }, reused: false }
        if (name === 'douyin_collect_run_set_list_meta') return { run: { run_id: 'run-1' } }
        if (name === 'douyin_collect_ingest_batch') {
          return { run: { run_id: 'run-1' }, batch: { batch_no: 1, status: 'completed', succeeded_work_ids: [], failed_work_ids: [] } }
        }
        if (name === 'douyin_collect_run_finish') return { run: { run_id: 'run-1', status: 'completed' }, settlement: {}, replayed: false }
        return {}
      },
      storageStatePath: await withSessionFile(root),
      sessionFactory: () => fakeSession({ workCount: 1 }),
      // 本地写入失败（profile 损坏之外的一般形态由 saveDiscoveredAvatar 单测覆盖）。
      saveAvatar: async () => ({ updated: false, reason: 'avatar_save_failed' }),
      onProgress: event => events.push(event),
    })
    assert.equal(result.status, 'ready', '头像本地失败不得改变作品采集结果')
    assert.ok(events.some(event => event.phase === 'avatar_save_failed' && event.reason === 'avatar_save_failed'), '本地失败记诊断事件')
    assert.equal(events.filter(event => event.phase === 'avatar_sync_failed').length, 0, '本地未写入成功时不做远端补传')
  })
})

test('采集链路：远端账号保存失败只记 avatar_sync_failed，结果仍为原有采集结果', async () => {
  await withRoot(async root => {
    const events = []
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async name => {
        if (name === 'douyin_account_save') throw Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' })
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-1', last_heartbeat_seq: 0 }, reused: false }
        if (name === 'douyin_collect_run_set_list_meta') return { run: { run_id: 'run-1' } }
        if (name === 'douyin_collect_ingest_batch') {
          return { run: { run_id: 'run-1' }, batch: { batch_no: 1, status: 'completed', succeeded_work_ids: [], failed_work_ids: [] } }
        }
        if (name === 'douyin_collect_run_finish') return { run: { run_id: 'run-1', status: 'completed' }, settlement: {}, replayed: false }
        return {}
      },
      storageStatePath: await withSessionFile(root),
      sessionFactory: () => fakeSession({ workCount: 1, avatar: AVATAR }),
      saveAvatar: async () => {
        // 模拟真实语义：updated=true 时本地已写入（read-back 读取的就是这份值）。
        await updateAccount('acc-1', { avatar: AVATAR }, root)
        return { updated: true, reason: null }
      },
      onProgress: event => events.push(event),
    })
    assert.equal(result.status, 'ready', '远端同步失败不得判定整个作品采集失败')
    const syncFailed = events.filter(event => event.phase === 'avatar_sync_failed')
    assert.equal(syncFailed.length, 1)
    assert.equal(syncFailed[0].error, 'UNAUTHORIZED', '只记可读的稳定原因码，不透传原始响应')
  })
})

test('采集链路：注入的 saveAvatar 抛异常同样不阻断作品入库', async () => {
  await withRoot(async root => {
    const events = []
    const result = await runAccountCollection({
      accountId: 'acc-1',
      root,
      callTool: async name => {
        if (name === 'douyin_account_save') return {}
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-1', last_heartbeat_seq: 0 }, reused: false }
        if (name === 'douyin_collect_run_set_list_meta') return { run: { run_id: 'run-1' } }
        if (name === 'douyin_collect_ingest_batch') {
          return { run: { run_id: 'run-1' }, batch: { batch_no: 1, status: 'completed', succeeded_work_ids: ['w1'], failed_work_ids: [] } }
        }
        if (name === 'douyin_collect_run_finish') return { run: { run_id: 'run-1', status: 'completed' }, settlement: {}, replayed: false }
        return {}
      },
      storageStatePath: await withSessionFile(root),
      sessionFactory: () => fakeSession({ workCount: 1, avatar: AVATAR }),
      saveAvatar: async () => {
        throw new Error('boom')
      },
      onProgress: event => events.push(event),
    })
    assert.equal(result.status, 'ready', '头像保存通道的异常不得影响作品采集结果')
    assert.equal(result.succeededWorkCount, 1, '作品照常入库')
    assert.ok(events.some(event => event.phase === 'avatar_save_failed' && event.reason === 'avatar_save_failed'), '异常收敛为稳定诊断事件')
    assert.ok(!events.some(event => event.phase === 'avatar_saved'), '不得发出成功事件')
  })
})

test('采集链路：profile 账号 ID 不一致时只记诊断事件，不写入、不误传远端', async () => {
  await withRoot(async root => {
    // fakeSession 的 user/info 固定返回 acc-1，这里以 acc-2 发起采集制造不一致。
    const events = []
    const saves = []
    const result = await runAccountCollection({
      accountId: 'acc-2',
      root,
      callTool: async (name, args) => {
        if (name === 'douyin_account_save') { saves.push(args); return { account: { accountId: args.accountId } } }
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-1', last_heartbeat_seq: 0 }, reused: false }
        if (name === 'douyin_collect_run_set_list_meta') return { run: { run_id: 'run-1' } }
        if (name === 'douyin_collect_ingest_batch') {
          return { run: { run_id: 'run-1' }, batch: { batch_no: 1, status: 'completed', succeeded_work_ids: [], failed_work_ids: [] } }
        }
        if (name === 'douyin_collect_run_finish') return { run: { run_id: 'run-1', status: 'completed' }, settlement: {}, replayed: false }
        return {}
      },
      storageStatePath: await withSessionFile(root, 'acc-2'),
      sessionFactory: () => fakeSession({ avatar: AVATAR }),
      onProgress: event => events.push(event),
    })
    assert.equal(result.status, 'ready')
    assert.ok(events.some(event => event.phase === 'avatar_save_failed' && event.reason === 'account_mismatch'), '不一致记安全诊断事件')
    // 入库链路会为 acc-2 建立运行状态记录，这里只断言头像字段从未被写入。
    assert.ok(!(await getAccount('acc-2', root))?.avatar, '目标账号头像不得被写入')
    assert.equal(await getAccount('acc-1', root), null, 'profile 账号也不得被写入')
    assert.ok(saves.every(args => args.avatar === undefined), '不一致时远端不得补传头像')
  })
})
