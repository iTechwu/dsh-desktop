import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply, projectAccounts, projectLogin } from '../index.js'
import { createCollectController } from '../src/runner.js'
import {
  accountRemoveIdempotencyKey,
  accountSaveIdempotencyKey,
  findTool,
  heartbeatIdempotencyKey,
  ingestIdempotencyKey,
  listMetaIdempotencyKey,
  runCancelIdempotencyKey,
  runFinishIdempotencyKey,
  runStartIdempotencyKey,
  sessionIdempotencyKey,
} from '../src/tools-client.js'
import { updateAccount } from '../src/state.js'

function createContext({ tools = [], execute, chrome = { chromeAvailable: true, driverAvailable: true, platform: 'linux' } } = {}) {
  const registered = []
  const ctx = {
    logger: { warn: () => {} },
    tools: {
      schemas: () => tools,
      execute: execute || (async () => ({ structuredContent: {} })),
    },
    webServer: {
      register(route) {
        registered.push(route)
        return () => {}
      },
    },
    effect(fn) { return fn() },
  }
  return { ctx, registered, chrome }
}

async function call(handler, body, method = 'POST') {
  const response = { status: null, headers: null, payload: null }
  const res = {
    writeHead(status, headers) { response.status = status; response.headers = headers },
    end(text) { response.payload = JSON.parse(text) },
  }
  await handler({ method, body }, res)
  return response
}

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'douyin-plugin-'))
  try {
    return await fn(root)
  } finally {
    // 后台登录/探测可能在测试体返回后仍向 state 目录落盘（beginLogin 的
    // .then 是异步写回），与删除竞争会偶发 ENOTEMPTY；交给 Node 的有界重试。
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

test('注册本地同源路由 /api/desktop/yootun/douyin-operation', () => {
  const { ctx, registered } = createContext()
  apply(ctx, { root: '/tmp/unused', browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }) })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].path, '/api/desktop/yootun/douyin-operation')
  assert.equal(registered[0].kind, 'exact')
})

test('非 POST 请求返回 405，未知 action 返回 400', async () => {
  await withRoot(async root => {
    const { ctx, registered } = createContext()
    apply(ctx, { root, browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }) })
    const handler = registered[0].handler
    const notAllowed = await call(handler, {}, 'GET')
    assert.equal(notAllowed.status, 405)
    const unknown = await call(handler, { action: 'nope' })
    assert.equal(unknown.status, 400)
    assert.equal(unknown.payload.reason, 'unknown_action')
  })
})

test('browser.status 在无 Chrome 时给出安装提示、不回传设备路径', async () => {
  const { ctx, registered } = createContext()
  apply(ctx, {
    root: '/tmp/unused',
    browserStatus: async () => ({ chromeAvailable: false, driverAvailable: true, platform: 'win32', chromePath: 'C:/secret/path/chrome.exe' }),
  })
  const result = await call(registered[0].handler, { action: 'browser.status' })
  assert.equal(result.payload.status, 'ready')
  assert.equal(result.payload.chromeAvailable, false)
  assert.equal(result.payload.hint, 'install_google_chrome')
  assert.equal(JSON.stringify(result.payload).includes('secret'), false)
})

test('accounts.list 合并本地与远端，会话状态以本地为准', async () => {
  await withRoot(async root => {
    await updateAccount('acc-1', { nickname: '本地名', sessionStatus: 'expired', sessionSeq: 3 }, root)
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_account_list' }],
      execute: async () => ({
        structuredContent: {
          accounts: [
            { accountId: 'acc-1', nickname: '远端名', sessionStatus: 'ok', sessionCheckedAt: 't1', lastCollectedAt: 't2', deleteState: 'none' },
            { accountId: 'acc-2', nickname: '远端账号', fanCount: 5, sessionStatus: 'ok' },
          ],
        },
      }),
    })
    apply(ctx, { root, browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }) })
    const result = await call(registered[0].handler, { action: 'accounts.list' })
    assert.equal(result.payload.status, 'ready')
    assert.equal(result.payload.accounts.length, 2)
    const first = result.payload.accounts.find(item => item.accountId === 'acc-1')
    assert.equal(first.nickname, '本地名')
    assert.equal(first.sessionStatus, 'expired', '会话状态以设备端为准')
    assert.equal(first.local, true)
    const second = result.payload.accounts.find(item => item.accountId === 'acc-2')
    assert.equal(second.local, false)
    assert.equal(second.fanCount, 5)
  })
})

test('accounts.list 在 tools 不可用时仍返回本地账号并标注错误码', async () => {
  await withRoot(async root => {
    await updateAccount('acc-1', { nickname: '本地名' }, root)
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_account_list' }],
      execute: async () => { throw new Error('network down') },
    })
    apply(ctx, { root, browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }) })
    const result = await call(registered[0].handler, { action: 'accounts.list' })
    assert.equal(result.payload.accounts.length, 1)
    assert.equal(result.payload.remoteError, 'douyin_operation_request_failed')
    assert.equal(JSON.stringify(result.payload).includes('network down'), false)
  })
})

test('账号探测上报 tools，且不上报任何 Cookie 内容', async () => {
  await withRoot(async root => {
    const calls = []
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_session_status_report' }],
      execute: async call => { calls.push(call); return { structuredContent: { applied: true } } },
    })
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      refreshSessionState: async ({ accountId }) => ({
        sessionStatus: 'ok', sessionSeq: 4, checkedAt: '2026-09-10T00:00:00.000Z', vaultRef: `vault://douyin/${accountId}`, account: { accountId },
      }),
    })
    const result = await call(registered[0].handler, { action: 'account.probe', accountId: 'acc-1' })
    assert.equal(result.payload.sessionStatus, 'ok')
    assert.equal(result.payload.reported, true)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].arguments, {
      accountId: 'acc-1',
      sessionStatus: 'ok',
      sessionSeq: 4,
      checkedAt: '2026-09-10T00:00:00.000Z',
      sessionRef: 'vault://douyin/acc-1',
      idempotencyKey: sessionIdempotencyKey('acc-1', 4, '2026-09-10T00:00:00.000Z'),
    })
    const serialized = JSON.stringify(calls[0])
    assert.equal(serialized.includes('sessionid'), false)
    assert.equal(serialized.includes('cookie'), false)
    assert.equal(serialized.includes('storage_state'), false)
  })
})

test('工具解析：按分段边界匹配，拒绝同前缀的更长工具名', () => {
  const ctx = {
    tools: {
      schemas: () => [
        { name: 'mcp__tools-douyin-operation__douyin_account_list_extra' },
        { name: 'mcp__tools-douyin-operation__douyin_account_list' },
        { name: 'douyin_account_list' },
      ],
    },
  }
  assert.equal(findTool(ctx, 'douyin_account_list').name, 'mcp__tools-douyin-operation__douyin_account_list')
  assert.equal(findTool({ tools: { schemas: () => [{ name: 'douyin_account_list' }] } }, 'douyin_account_list').name, 'douyin_account_list')
  assert.equal(findTool({ tools: { schemas: () => [{ name: 'mcp__x__douyin_account_list_extra' }] } }, 'douyin_account_list'), null)
  assert.equal(findTool(ctx, 'douyin_work_list'), null)
})

test('删除流程：先清本地再请求远端清理', async () => {
  await withRoot(async root => {
    const order = []
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_account_remove' }],
      execute: async call => {
        order.push(`remote:${call.arguments.accountId}`)
        return { structuredContent: { deleteState: 'remote_deleted' } }
      },
    })
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      removeLocalAccount: async ({ accountId }) => { order.push(`local:${accountId}`); return { accountId, cleared: { profile: true, storageState: true } } },
    })
    const local = await call(registered[0].handler, { action: 'account.removeLocal', accountId: 'acc-1' })
    assert.equal(local.payload.localCleared, true)
    const remote = await call(registered[0].handler, { action: 'account.removeRemote', accountId: 'acc-1' })
    assert.equal(remote.payload.deleteState, 'remote_deleted')
    assert.deepEqual(order, ['local:acc-1', 'remote:acc-1'])
  })
})

test('删除流程：本地清理失败必须阻断远端删除（cleanup_failed）', async () => {
  await withRoot(async root => {
    const order = []
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_account_remove' }],
      execute: async call => {
        order.push(`remote:${call.arguments.accountId}`)
        return { structuredContent: { deleteState: 'remote_deleted' } }
      },
    })
    // 只清掉了 storage_state，Profile 目录仍留在设备上：此时设备可能仍持有有效登录态。
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      removeLocalAccount: async ({ accountId }) => {
        order.push(`local:${accountId}`)
        return { accountId, cleared: { profile: false, storageState: true } }
      },
    })
    const local = await call(registered[0].handler, { action: 'account.removeLocal', accountId: 'acc-1' })
    assert.equal(local.payload.status, 'error')
    assert.equal(local.payload.reason, 'cleanup_failed')
    assert.equal(local.payload.localCleared, false)
    assert.deepEqual(local.payload.cleared, { profile: false, storageState: true })
    // UI 只认 status：非 ready 时不得调用 removeRemote，远端数据与重试入口都必须保留。
    assert.deepEqual(order, ['local:acc-1'])
  })
})

test('删除流程：清理结果字段缺失同样按失败处理', async () => {
  await withRoot(async root => {
    const { ctx, registered } = createContext()
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      removeLocalAccount: async ({ accountId }) => ({ accountId }),
    })
    const local = await call(registered[0].handler, { action: 'account.removeLocal', accountId: 'acc-1' })
    assert.equal(local.payload.status, 'error')
    assert.equal(local.payload.reason, 'cleanup_failed')
    assert.deepEqual(local.payload.cleared, { profile: false, storageState: false })
  })
})

test('登录状态机：beginLogin 立即返回等待扫码', async () => {
  await withRoot(async root => {
    let resolveLogin = null
    const pending = new Promise(resolve => { resolveLogin = resolve })
    const { ctx, registered } = createContext()
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      login: async () => pending,
    })
    const started = await call(registered[0].handler, { action: 'account.beginLogin', accountId: 'acc-9' })
    assert.equal(started.payload.status, 'ready')
    assert.equal(started.payload.login.status, 'waiting')
    assert.equal(started.payload.login.accountId, 'acc-9')

    const status = await call(registered[0].handler, { action: 'account.loginStatus', accountId: 'acc-9' })
    assert.equal(status.payload.login.status, 'waiting')

    resolveLogin({ status: 'ok', accountId: 'acc-9', profile: { nickname: 'n' } })
    // 有界轮询：登录完成是异步写回，避免依赖固定 sleep 的时序脆弱断言。
    let finished = null
    for (let attempt = 0; attempt < 50; attempt += 1) {
      finished = await call(registered[0].handler, { action: 'account.loginStatus', accountId: 'acc-9' })
      if (finished.payload.login.status !== 'waiting') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(finished.payload.login.status, 'ok')
  })
})

test('projectAccounts 合并策略：设备端会话状态优先', () => {
  const merged = projectAccounts(
    { a: { accountId: 'a', nickname: 'local', sessionStatus: 'expired' } },
    [{ accountId: 'a', nickname: 'remote', sessionStatus: 'ok' }],
  )
  assert.equal(merged[0].sessionStatus, 'expired')
  assert.equal(merged[0].nickname, 'local')
  assert.equal(merged[0].local, true)
  assert.deepEqual(projectLogin({ key: 'k', status: 'waiting', accountId: 'a', error: null }), {
    loginKey: 'k', status: 'waiting', accountId: 'a', error: null, saveError: null,
  })
  assert.deepEqual(projectLogin({ key: 'k', status: 'ok', accountId: 'a', error: null, saveError: 'UNAUTHORIZED' }), {
    loginKey: 'k', status: 'ok', accountId: 'a', error: null, saveError: 'UNAUTHORIZED',
  })
})

test('projectAccounts 头像投影：仅 http(s) 绝对地址放行，本地优先，缺失置 null', () => {
  const merged = projectAccounts(
    {
      a: { accountId: 'a', nickname: '本地', avatar: 'https://p3.douyinpic.com/local.jpeg' },
      b: { accountId: 'b', nickname: '仅远端有头像' },
      c: { accountId: 'c', nickname: '危险头像', avatar: 'javascript:alert(1)' },
      d: { accountId: 'd', nickname: '本地坏头像', avatar: 'file:///etc/passwd' },
    },
    [
      { accountId: 'a', avatar: 'https://p3.douyinpic.com/remote.jpeg' },
      { accountId: 'b', avatar: 'http://p3.douyinpic.com/remote.jpeg' },
      { accountId: 'c', avatar: 'https://p3.douyinpic.com/remote-safe.jpeg' },
    ],
  )
  const byId = Object.fromEntries(merged.map(item => [item.accountId, item]))
  assert.equal(byId.a.avatar, 'https://p3.douyinpic.com/local.jpeg', '本地头像优先于远端')
  assert.equal(byId.b.avatar, 'http://p3.douyinpic.com/remote.jpeg', '远端 http 头像可回填')
  assert.equal(byId.c.avatar, 'https://p3.douyinpic.com/remote-safe.jpeg', '本地危险协议被丢弃后回退远端')
  assert.equal(byId.d.avatar, null, '本地 file:// 头像置 null 且远端无值')
  assert.deepEqual(
    projectAccounts({ e: { accountId: 'e' } }, []).map(item => item.avatar),
    [null],
    '无头像字段时补 null，UI 可回退占位',
  )
})

test('登录成功但 account_save 失败：记录日志并在 loginStatus 透出 saveError', async () => {
  await withRoot(async root => {
    const toolError = {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'gateway rejected' } }) }],
      structuredContent: { error: { code: 'UNAUTHORIZED', message: 'gateway rejected' } },
    }
    const calls = []
    const warns = []
    const { ctx, registered } = createContext({
      tools: [
        { name: 'mcp__tools-douyin-operation__douyin_account_save' },
        { name: 'mcp__tools-douyin-operation__douyin_session_status_report' },
      ],
      execute: async request => {
        calls.push(request)
        if (request.name.endsWith('douyin_account_save')) return toolError
        return { structuredContent: { applied: true } }
      },
    })
    ctx.logger.warn = (...args) => warns.push(args.join(' '))
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      login: async () => ({ status: 'ok', accountId: 'acc-9', profile: { nickname: '示例', fanCount: 10 } }),
    })

    const started = await call(registered[0].handler, { action: 'account.beginLogin', accountId: 'acc-9' })
    assert.equal(started.payload.login.status, 'waiting')

    // 登录完成是异步写回：有界轮询直至离开 waiting。
    let finished = null
    for (let attempt = 0; attempt < 50; attempt += 1) {
      finished = await call(registered[0].handler, { action: 'account.loginStatus', accountId: 'acc-9' })
      if (finished.payload.login.status !== 'waiting') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    // 本地登录态有效，status 仍是 ok；saveError 必须透出供 UI 提醒，不能静默吞掉。
    assert.equal(finished.payload.login.status, 'ok')
    assert.equal(finished.payload.login.saveError, 'UNAUTHORIZED')
    assert.equal(JSON.stringify(finished.payload).includes('gateway rejected'), false, '不透传原始报文')
    assert.ok(warns.some(text => text.includes('account save failed') && text.includes('UNAUTHORIZED')), '失败必须写日志')
    // 会话状态上报不因 save 失败被跳过（它在 status 翻转后异步执行，有界等待）。
    let reported = false
    for (let attempt = 0; attempt < 50 && !reported; attempt += 1) {
      reported = calls.some(item => item.name.endsWith('douyin_session_status_report'))
      if (!reported) await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.ok(reported)
  })
})

test('登录成功：account_save 载荷绝不含 undefined 属性，对象头像直接不发（宿主 snapshot 硬约束）', async () => {
  await withRoot(async root => {
    const calls = []
    const { ctx, registered } = createContext({
      tools: [
        { name: 'mcp__tools-douyin-operation__douyin_account_save' },
        { name: 'mcp__tools-douyin-operation__douyin_session_status_report' },
      ],
      execute: async request => {
        calls.push(request)
        return { structuredContent: { applied: true } }
      },
    })
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      // 抖音 user/info 的 avatar_uri 真实形态是对象（{uri,url_list}）；
      // fanCount 可能是字符串。宿主 snapshotJsonValue 对 undefined 值属性是
      // 整调用拒绝（进程内失败、网络零痕迹）——2026-09-11 Windows 实测根因。
      login: async () => ({
        status: 'ok',
        accountId: 'acc-9',
        profile: { nickname: '示例', avatar: { url_list: ['https://p3.example.invalid/av.jpeg'] }, fanCount: '10' },
      }),
    })

    await call(registered[0].handler, { action: 'account.beginLogin', accountId: 'acc-9' })
    let finished = null
    for (let attempt = 0; attempt < 50; attempt += 1) {
      finished = await call(registered[0].handler, { action: 'account.loginStatus', accountId: 'acc-9' })
      if (finished.payload.login.status !== 'waiting') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(finished.payload.login.status, 'ok')
    assert.equal(finished.payload.login.saveError, null)

    const save = calls.find(item => item.name.endsWith('douyin_account_save'))
    assert.ok(save, 'account_save 必须发出')
    for (const [key, value] of Object.entries(save.arguments)) {
      assert.notEqual(value, undefined, `save 载荷字段 ${key} 不得为 undefined`)
    }
    assert.equal('avatar' in save.arguments, false, '对象头像不得进入载荷')
    assert.equal(save.arguments.nickname, '示例')
    assert.equal(save.arguments.fanCount, 10)
    assert.equal(save.arguments.sessionRef, 'vault://douyin/acc-9')
    assert.match(save.arguments.idempotencyKey, /^douyin:account:acc-9:\d+$/)
  })
})

test('collect.start 需要本地会话就绪，未登录时提示重新扫码', async () => {
  await withRoot(async root => {
    const { ctx, registered } = createContext()
    apply(ctx, { root, browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }) })
    const result = await call(registered[0].handler, { action: 'collect.start', accountId: 'acc-1' })
    assert.equal(result.payload.status, 'error')
    assert.equal(result.payload.reason, 'session_required')
  })
})

test('collect.start/status：采集在后台运行，页面轮询读进度', async () => {
  await withRoot(async root => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { paths } = await import('../src/state.js')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await writeFile(paths(root).storageStatePath('acc-1'), '{"cookies":[],"origins":[]}')

    let release = null
    const pending = new Promise(resolve => { release = resolve })
    const controller = createCollectController({
      runCollection: async ({ onProgress }) => {
        onProgress({ phase: 'work', index: 1, total: 2, workId: 'w1' })
        await pending
        return { status: 'ready', runId: 'run-1', runStatus: 'completed', listComplete: true, expectedWorkCount: 2, succeededWorkCount: 2, failedWorkCount: 0 }
      },
    })
    const { ctx, registered } = createContext()
    apply(ctx, { root, collectController: controller, browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }) })

    const started = await call(registered[0].handler, { action: 'collect.start', accountId: 'acc-1' })
    assert.equal(started.payload.collect.status, 'running')
    const progress = await call(registered[0].handler, { action: 'collect.status', accountId: 'acc-1' })
    assert.equal(progress.payload.collect.progress.workId, 'w1')
    release()
    await controller.wait('acc-1')
    const done = await call(registered[0].handler, { action: 'collect.status', accountId: 'acc-1' })
    assert.equal(done.payload.collect.status, 'completed')
    assert.equal(done.payload.collect.result.succeededWorkCount, 2)
  })
})

test('works.list / work.get / work.trend / run.get 走 tools 并做参数校验', async () => {
  await withRoot(async root => {
    const seen = []
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_work_list' }],
      execute: async request => { seen.push(request); return { structuredContent: { works: [{ work_id: 'w1' }], total: 1 } } },
    })
    apply(ctx, { root, browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }) })
    const handler = registered[0].handler

    const list = await call(handler, { action: 'works.list', accountId: 'acc-1' })
    assert.equal(list.payload.total, 1)
    assert.deepEqual(seen.at(-1).arguments, { accountId: 'acc-1', includeNotInList: false })

    const missing = await call(handler, { action: 'work.get', accountId: 'acc-1' })
    assert.equal(missing.payload.reason, 'work_id_required')
    const runMissing = await call(handler, { action: 'run.get', runId: '' })
    assert.equal(runMissing.payload.reason, 'run_id_required')
  })
})

test('幂等键模板在边界取值下均不超过 128 字符（仓库全域不变量）', () => {
  // 真实抖音 sec_uid 就是 76 字符（MS4wLjABAAAA + 64 位 base64）；这里按服务端
  // schema 上限 80 取最坏值，序号按 64 位整数取 20 位。
  const accountId = 'a'.repeat(80)
  const runId = 'r'.repeat(80)
  const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
  const maxSeq = String(2 ** 63 - 1)
  const keys = [
    runStartIdempotencyKey(uuid),
    sessionIdempotencyKey(accountId, maxSeq, '2026-09-11T05:00:00.000Z'),
    accountSaveIdempotencyKey(accountId, 1757000000000),
    accountRemoveIdempotencyKey(accountId, 1757000000000),
    listMetaIdempotencyKey(runId),
    heartbeatIdempotencyKey(runId, maxSeq),
    ingestIdempotencyKey(runId, 100000),
    runFinishIdempotencyKey(runId),
    runCancelIdempotencyKey(runId),
  ]
  for (const key of keys) {
    assert.ok(key.length >= 1 && key.length <= 128, `幂等键超限(${key.length}): ${key.slice(0, 24)}…`)
  }
  // run_start 键只由本次尝试的 UUID 决定：不含账号，因此真实 76 字符 sec_uid 也不会超限。
  assert.equal(runStartIdempotencyKey(uuid), `douyin:run_start:${uuid}`)
})

// ===== 占位账号升级（2026-09-11 Windows 实测：user/info 未就绪 → 账号永久挂 pending-） =====

test('probe 时把占位账号升级到真实 sec_uid：远端保存真实身份并清理占位行', async () => {
  await withRoot(async root => {
    const calls = []
    const { ctx, registered } = createContext({
      tools: [
        { name: 'mcp__tools-douyin-operation__douyin_account_save' },
        { name: 'mcp__tools-douyin-operation__douyin_account_remove' },
        { name: 'mcp__tools-douyin-operation__douyin_session_status_report' },
      ],
      execute: async request => { calls.push(request); return { structuredContent: { applied: true } } },
    })
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      refreshSessionState: async ({ accountId }) => ({
        sessionStatus: 'ok', sessionSeq: 1, checkedAt: '2026-09-11T06:00:00.000Z', vaultRef: `vault://douyin/${accountId}`, account: { accountId },
      }),
      promotePendingAccount: async ({ accountId }) => ({
        promoted: true, accountId: 'MS4wLjABAAAA-real', fromAccountId: accountId, profile: { nickname: '真名', fanCount: 9 },
      }),
    })
    const result = await call(registered[0].handler, { action: 'account.probe', accountId: 'pending-123' })
    assert.equal(result.payload.status, 'ready')
    assert.equal(result.payload.promoted, true)
    assert.equal(result.payload.accountId, 'MS4wLjABAAAA-real', '响应带真实 ID，页面据此刷新')
    assert.equal(result.payload.remoteCleanup, 'removed')
    const save = calls.find(item => item.name.endsWith('douyin_account_save'))
    assert.equal(save.arguments.accountId, 'MS4wLjABAAAA-real')
    assert.equal(save.arguments.nickname, '真名')
    const remove = calls.find(item => item.name.endsWith('douyin_account_remove'))
    assert.equal(remove.arguments.accountId, 'pending-123')
    assert.equal(remove.arguments.confirm, true)
    const report = calls.find(item => item.name.endsWith('douyin_session_status_report'))
    assert.equal(report.arguments.accountId, 'MS4wLjABAAAA-real', '会话上报落在真实 ID 名下')
  })
})

test('占位账号升级失败时 probe 照常工作，不虚构真实 ID', async () => {
  await withRoot(async root => {
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_session_status_report' }],
      execute: async () => ({ structuredContent: { applied: true } }),
    })
    apply(ctx, {
      root,
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      refreshSessionState: async ({ accountId }) => ({
        sessionStatus: 'expired', sessionSeq: 1, checkedAt: '2026-09-11T06:00:00.000Z', vaultRef: `vault://douyin/${accountId}`, account: { accountId },
      }),
      promotePendingAccount: async () => ({ promoted: false, reason: 'no_session_cookie' }),
    })
    const result = await call(registered[0].handler, { action: 'account.probe', accountId: 'pending-123' })
    assert.equal(result.payload.promoted, false)
    assert.equal(result.payload.accountId, 'pending-123')
    assert.equal(result.payload.sessionStatus, 'expired')
  })
})

test('占位账号有在途采集时不升级（避免迁移文件与在途 run 错序）', async () => {
  await withRoot(async root => {
    let promoteCalled = 0
    const { ctx, registered } = createContext()
    apply(ctx, {
      root,
      // fake 控制器：该占位 ID 名下有一个在途 run（旧版本代码启动的采集）。
      collectController: {
        start: async () => ({ status: 'ready', collect: { accountId: 'pending-123', status: 'running' } }),
        status: accountId => (
          accountId === 'pending-123'
            ? { status: 'ready', collect: { accountId, status: 'running' } }
            : { status: 'ready', collect: null }
        ),
      },
      browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }),
      promotePendingAccount: async () => { promoteCalled += 1; return { promoted: true, accountId: 'MS4wLjABAAAA-real' } },
    })
    const result = await call(registered[0].handler, { action: 'account.probe', accountId: 'pending-123' })
    assert.equal(promoteCalled, 0, '在途采集期间绝不迁移')
    assert.equal(result.payload.accountId, 'pending-123')
    assert.equal(result.payload.promoted, false)
  })
})

test('升级后的旧占位 ID 在 works/collect.status 中自动翻译为真实 ID', async () => {
  await withRoot(async root => {
    await updateAccount('MS4wLjABAAAA-real', { promotedFrom: 'pending-123', nickname: '真名' }, root)
    const seen = []
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_work_list' }],
      execute: async request => { seen.push(request); return { structuredContent: { works: [], total: 0 } } },
    })
    apply(ctx, { root, browserStatus: async () => ({ chromeAvailable: true, driverAvailable: true, platform: 'linux' }) })
    const result = await call(registered[0].handler, { action: 'works.list', accountId: 'pending-123' })
    assert.equal(result.payload.accountId, 'MS4wLjABAAAA-real', '响应带真实 ID')
    assert.deepEqual(seen.at(-1).arguments, { accountId: 'MS4wLjABAAAA-real', includeNotInList: false })
  })
})

test('session 幂等键包含 checkedAt：重装后 seq 归 1 不再撞历史收据', async () => {
  const keyAt = '2026-09-11T05:56:43.740Z'
  assert.notEqual(
    sessionIdempotencyKey('MS4wLjABAAAA-real', 1, keyAt),
    sessionIdempotencyKey('MS4wLjABAAAA-real', 1, '2026-09-11T08:00:00.000Z'),
  )
  assert.ok(sessionIdempotencyKey('MS4wLjABAAAA-real', 1, keyAt).length <= 128)
})

test('export 动作：固定 format=xlsx 调 douyin_export，只透出文件名/MIME/内容/行数', async () => {
  const seen = []
  const base64 = Buffer.from('hello').toString('base64') // 5 字节 → 8 字符
  const { ctx, registered } = createContext({
    tools: [{ name: 'mcp__tools-douyin-operation__douyin_export' }],
    execute: async request => {
      seen.push(request)
      return {
        structuredContent: {
          account_id: 'acc-1',
          format: 'xlsx',
          file_name: 'douyin-示例账号-20260911-103000.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: base64,
          content_bytes: 5,
          row_counts: { 作品总览: 2 },
        },
      }
    },
  })
  apply(ctx)
  const result = await call(registered[0].handler, { action: 'export', accountId: 'acc-1' })
  assert.equal(result.status, 200)
  assert.equal(result.payload.status, 'ready')
  assert.deepEqual(seen.at(-1).arguments, { accountId: 'acc-1', format: 'xlsx' }, '格式由宿主固定')
  assert.deepEqual(Object.keys(result.payload), [
    'status', 'file_name', 'mime_type', 'content_base64', 'content_bytes', 'row_counts',
  ], '只透出下载所需字段，不带内部地址/凭证/account_id')
  assert.equal(result.payload.file_name, 'douyin-示例账号-20260911-103000.xlsx')
  assert.equal(result.payload.content_bytes, 5)
})

test('export 动作：缺少 accountId 直接拒绝且不调用 tools', async () => {
  const seen = []
  const { ctx, registered } = createContext({
    tools: [{ name: 'mcp__tools-douyin-operation__douyin_export' }],
    execute: async request => { seen.push(request); return { structuredContent: {} } },
  })
  apply(ctx)
  const result = await call(registered[0].handler, { action: 'export', accountId: '' })
  assert.equal(result.payload.status, 'error')
  assert.equal(result.payload.reason, 'account_id_required')
  assert.equal(seen.length, 0)
})

test('export 动作：DOUYIN_EXPORT_TOO_LARGE 映射为 export_too_large，不透传内部码', async () => {
  const { ctx, registered } = createContext({
    tools: [{ name: 'mcp__tools-douyin-operation__douyin_export' }],
    execute: async () => ({
      isError: true,
      content: [{ type: 'text', text: 'Error: ' + JSON.stringify({ error: { code: 'DOUYIN_EXPORT_TOO_LARGE' } }) }],
    }),
  })
  apply(ctx)
  const result = await call(registered[0].handler, { action: 'export', accountId: 'acc-1' })
  assert.equal(result.payload.status, 'error')
  assert.equal(result.payload.reason, 'export_too_large')
})

test('export 动作：ACCOUNT_NOT_FOUND 原样透出（页面已有可读文案）', async () => {
  const { ctx, registered } = createContext({
    tools: [{ name: 'mcp__tools-douyin-operation__douyin_export' }],
    execute: async () => ({
      isError: true,
      content: [{ type: 'text', text: 'Error: ' + JSON.stringify({ error: { code: 'ACCOUNT_NOT_FOUND' } }) }],
    }),
  })
  apply(ctx)
  const result = await call(registered[0].handler, { action: 'export', accountId: 'ghost' })
  assert.equal(result.payload.reason, 'ACCOUNT_NOT_FOUND')
})

test('export 动作：content_bytes 超过 1MB 宿主复核拒绝', async () => {
  const bytes = 1_000_001
  const base64 = 'A'.repeat(Math.ceil(bytes / 3) * 4)
  const { ctx, registered } = createContext({
    tools: [{ name: 'mcp__tools-douyin-operation__douyin_export' }],
    execute: async () => ({ structuredContent: { content_base64: base64, content_bytes: bytes } }),
  })
  apply(ctx)
  const result = await call(registered[0].handler, { action: 'export', accountId: 'acc-1' })
  assert.equal(result.payload.reason, 'export_too_large')
})

test('export 动作：base64 长度与声明字节数不一致按失败处理（截断文件不落盘）', async () => {
  // 8 字符 base64 对应 5–6 字节；声明 7 字节即跨桶，长度校验必须拒绝。
  const base64 = Buffer.from('hello').toString('base64')
  const { ctx, registered } = createContext({
    tools: [{ name: 'mcp__tools-douyin-operation__douyin_export' }],
    execute: async () => ({ structuredContent: { content_base64: base64, content_bytes: 7 } }),
  })
  apply(ctx)
  const result = await call(registered[0].handler, { action: 'export', accountId: 'acc-1' })
  assert.equal(result.payload.reason, 'export_failed')
})

test('export 动作：序列化完整响应超过 1.8MB 拒绝（超限 row_counts 也算）', async () => {
  const base64 = Buffer.from('hello').toString('base64')
  const { ctx, registered } = createContext({
    tools: [{ name: 'mcp__tools-douyin-operation__douyin_export' }],
    execute: async () => ({
      structuredContent: {
        content_base64: base64,
        content_bytes: 5,
        row_counts: { bloated: 'x'.repeat(2_000_000) },
      },
    }),
  })
  apply(ctx)
  const result = await call(registered[0].handler, { action: 'export', accountId: 'acc-1' })
  assert.equal(result.payload.reason, 'export_too_large')
})

test('export 动作：文件名二次净化——路径分隔符/控制字符替换、非 .xlsx 回退默认名', async () => {
  const base64 = Buffer.from('hello').toString('base64')
  const respondWith = fileName => {
    const { ctx, registered } = createContext({
      tools: [{ name: 'mcp__tools-douyin-operation__douyin_export' }],
      execute: async () => ({ structuredContent: { content_base64: base64, content_bytes: 5, file_name: fileName } }),
    })
    apply(ctx)
    return call(registered[0].handler, { action: 'export', accountId: 'acc-1' })
  }
  const traversal = await respondWith('../../etc/hoost.xlsx')
  assert.ok(!traversal.payload.file_name.includes('/'), '不包含路径分隔符')
  assert.ok(traversal.payload.file_name.endsWith('.xlsx'))
  const wrongSuffix = await respondWith('report.pdf')
  assert.equal(wrongSuffix.payload.file_name, 'douyin-export.xlsx', '非 .xlsx 回退默认名')
  const empty = await respondWith('')
  assert.equal(empty.payload.file_name, 'douyin-export.xlsx')
  const control = await respondWith('bad' + String.fromCharCode(0) + 'na' + String.fromCharCode(31) + 'me.xlsx')
  assert.ok(!control.payload.file_name.includes(String.fromCharCode(0)) && !control.payload.file_name.includes(String.fromCharCode(31)), '控制字符被替换')
  assert.ok(control.payload.file_name.endsWith('.xlsx'))
  const del = await respondWith('del' + String.fromCharCode(127) + 'ete.xlsx')
  assert.equal(del.payload.file_name, 'del_ete.xlsx', 'DEL 字符同样替换为下划线')
})
