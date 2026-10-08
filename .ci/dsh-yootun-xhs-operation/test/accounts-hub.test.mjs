import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 以受控沙箱加载 src/client.js，取回 createAccountsHub（纯逻辑，无 React/浏览器依赖）。
function loadClient(source) {
  const module = { exports: {} }
  const require = name => {
    if (name === 'react') return { createElement: () => ({}), useEffect: () => {}, useState: () => [undefined, () => {}], useSyncExternalStore: () => undefined, useRef: () => ({ current: null }) }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconCloseOutlineRegular: {}, IconEditOutlineRegular: {}, MarkdownText: {}, Tooltip: {} }
    throw new Error(`unexpected require: ${name}`)
  }
  new Function('require', 'module', 'exports', source)(require, module, module.exports)
  return module.exports
}

const { createAccountsHub } = loadClient(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'))

// createAccountsHub 纯逻辑状态机：依赖注入 listAccounts/beginLogin/loginStatus/
// probe/removeLocal/startCollect/collectStatus + 假时钟，驱动登录/采集轮询与终态收敛。

function makeClock() {
  let now = 0
  const tasks = new Map()
  let seq = 0
  return {
    schedule(fn, ms) {
      const id = ++seq
      tasks.set(id, { fn, at: now + ms })
      return id
    },
    clearSchedule(id) { tasks.delete(id) },
    now: () => now,
    async advance(ms) {
      now += ms
      for (const [id, task] of [...tasks].sort((a, b) => a[1].at - b[1].at)) {
        if (task.at <= now) {
          tasks.delete(id)
          await task.fn()
        }
      }
    },
    pending: () => tasks.size,
  }
}

function makeHub(overrides = {}) {
  const calls = { list: 0, begin: [], loginStatus: [], probe: [], remove: [], collectStart: [], collectStatus: [], browserStatus: 0 }
  const clock = makeClock()
  let version = 0
  const hub = createAccountsHub({
    listAccounts: async () => {
      calls.list++
      return { accounts: overrides.accounts || [{ accountId: 'acc-1', nickname: '账号一', sessionStatus: 'ok', summary: { notesCount: 3, totals: { plays: 10 }, gaps: {} } }] }
    },
    beginLogin: async body => {
      calls.begin.push(body)
      if (overrides.beginError) return { status: 'error', reason: overrides.beginError }
      return { status: 'ready', login: { loginId: body.accountId || 'pending-1', status: 'waiting' } }
    },
    loginStatus: async body => {
      calls.loginStatus.push(body)
      return overrides.loginStatus || { status: 'ready', login: { loginId: body.loginId, status: 'waiting' } }
    },
    probe: async body => {
      calls.probe.push(body)
      return overrides.probe || { status: 'ready', accountId: body.accountId, sessionStatus: 'ok' }
    },
    removeLocal: async body => {
      calls.remove.push(body)
      return { status: 'ready', accountId: body.accountId, removed: { profile: true, storageState: true } }
    },
    startCollect: async body => {
      calls.collectStart.push(body)
      if (overrides.collectBusy) return { status: 'error', reason: 'PROFILE_BUSY' }
      return { status: 'started', collectId: 'col-1', collect: { collectId: 'col-1', accountId: body.accountId, collectStatus: 'running', pagesDone: 0, notesTotal: 0 } }
    },
    collectStatus: async body => {
      calls.collectStatus.push(body)
      return overrides.collectStatus || { status: 'ready', collect: { collectId: body.collectId, collectStatus: 'running', pagesDone: 1, notesTotal: 5 } }
    },
    browserStatus: async () => {
      calls.browserStatus++
      return { chromeAvailable: overrides.chromeAvailable !== false }
    },
    schedule: clock.schedule,
    clearSchedule: clock.clearSchedule,
    intervalMs: 2000,
    onChange: () => { version++ },
  })
  return { hub, clock, calls, version: () => version }
}

test('init loads accounts once and selects the first account', async () => {
  const { hub } = makeHub()
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  const state = hub.get()
  assert.equal(state.loaded, true)
  assert.equal(state.accounts.length, 1)
  assert.equal(state.selectedId, 'acc-1')
  assert.equal(state.loading, false)
  // 重复 init 不重复拉取（loaded 已置位且无进行中动作）。
  hub.init()
  assert.equal(hub.get().accounts.length, 1)
})

test('beginLoginFlow waits, polls loginStatus and refreshes on ok', async () => {
  const { hub, clock, calls } = makeHub({
    loginStatus: { status: 'ready', login: { loginId: 'pending-1', status: 'ok', accountId: 'acc-9', nickname: '新账号' } },
  })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.beginLoginFlow({})
  assert.deepEqual(calls.begin, [{}])
  assert.equal(hub.get().login.status, 'waiting')
  assert.equal(clock.pending(), 1)
  await clock.advance(2000)
  assert.equal(calls.loginStatus.length, 1)
  const state = hub.get()
  assert.equal(state.login, null)
  assert.deepEqual(state.notice, { kind: 'ok', key: 'loginOk' })
  assert.equal(state.selectedId, 'acc-9', '登录成功后选中新账号')
})

test('login terminal states map to controlled Chinese copy', async () => {
  for (const [terminal, expected] of [
    [{ status: 'ready', login: { loginId: 'p', status: 'timeout' } }, 'loginTimeout'],
    [{ status: 'ready', login: { loginId: 'p', status: 'failed', reason: 'CAPTCHA_DETECTED' } }, 'captchaHint'],
    [{ status: 'ready', login: { loginId: 'p', status: 'failed', reason: 'LOGIN_TIMEOUT' } }, 'loginTimeout'],
  ]) {
    const { hub, clock } = makeHub({ loginStatus: terminal })
    hub.init()
    await new Promise(resolve => setImmediate(resolve))
    await hub.beginLoginFlow({})
    await clock.advance(2000)
    assert.equal(hub.get().login, null)
    assert.equal(hub.get().notice.kind, 'error')
    assert.equal(hub.get().notice.key, expected)
  }
})

test('loginStatus idle is treated as an interrupted scan (terminal run already consumed)', async () => {
  const { hub, clock } = makeHub({ loginStatus: { status: 'ready', login: { loginId: 'p', status: 'idle' } } })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.beginLoginFlow({})
  await clock.advance(2000)
  assert.equal(hub.get().login, null)
  assert.equal(hub.get().notice.key, 'loginFailed')
  assert.ok(hub.get().accounts.length > 0, '中断后仍刷新列表')
})

test('beginLoginFlow PROFILE_BUSY surfaces profileBusy and never polls', async () => {
  const { hub, clock, calls } = makeHub({ beginError: 'PROFILE_BUSY' })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.beginLoginFlow({})
  assert.equal(hub.get().notice.key, 'profileBusy')
  assert.deepEqual(calls.loginStatus, [])
  assert.equal(clock.pending(), 0)
})

test('startCollectFlow polls progress and completes with a refresh', async () => {
  const { hub, clock, calls } = makeHub({
    collectStatus: { status: 'ready', collect: { collectId: 'col-1', collectStatus: 'completed', pagesDone: 3, notesTotal: 12, summary: { notesCount: 12, totals: {}, gaps: {} } } },
  })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.startCollectFlow('acc-1')
  assert.equal(hub.get().collect.collectStatus, 'running')
  assert.equal(clock.pending(), 1)
  await clock.advance(2000)
  assert.equal(calls.collectStatus.length, 1)
  assert.equal(hub.get().collect, null)
  assert.equal(hub.get().notice.kind, 'ok')
  assert.equal(hub.get().notice.key, 'collectDone')
  // idempotencyKey 随请求生成，防双击重复采集。
  assert.ok(calls.collectStart[0].idempotencyKey)
})

test('collect failure maps CAPTCHA_DETECTED to captchaHint', async () => {
  const { hub, clock } = makeHub({
    collectStatus: { status: 'ready', collect: { collectId: 'col-1', collectStatus: 'failed', error: 'CAPTCHA_DETECTED' } },
  })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.startCollectFlow('acc-1')
  await clock.advance(2000)
  assert.equal(hub.get().notice.key, 'captchaHint')
})

test('collect.start PROFILE_BUSY surfaces profileBusy without polling', async () => {
  const { hub, clock, calls } = makeHub({ collectBusy: true })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.startCollectFlow('acc-1')
  assert.equal(hub.get().notice.key, 'profileBusy')
  assert.deepEqual(calls.collectStatus, [])
  assert.equal(clock.pending(), 0)
})

test('probeNow refreshes the list and reports controlled failures', async () => {
  const { hub, calls } = makeHub({ probe: { status: 'error', reason: 'PROFILE_BUSY' } })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.probeNow('acc-1')
  assert.deepEqual(calls.probe, [{ accountId: 'acc-1' }])
  assert.equal(hub.get().notice.key, 'profileBusy')
  assert.equal(hub.get().probing.has('acc-1'), false, '探测结束清除 probing 标记')
})

test('removeAccount clears notice channel and refreshes', async () => {
  const { hub, calls } = makeHub()
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.removeAccount('acc-1')
  assert.deepEqual(calls.remove, [{ accountId: 'acc-1' }])
  assert.equal(hub.get().notice.key, 'removedDone')
  assert.equal(hub.get().accounts.length, 1, '本地测试桩固定返回同一列表')
})

test('select switches accounts and clears the current notice', async () => {
  const { hub } = makeHub({
    accounts: [
      { accountId: 'acc-1', nickname: '账号一', sessionStatus: 'ok', summary: { notesCount: 1, totals: {}, gaps: {} } },
      { accountId: 'acc-2', nickname: '账号二', sessionStatus: 'ok', summary: { notesCount: 2, totals: {}, gaps: {} } },
    ],
    probe: { status: 'error', reason: 'PROFILE_BUSY' },
  })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hub.get().selectedId, 'acc-1')
  await hub.probeNow('acc-1')
  assert.equal(hub.get().notice.key, 'profileBusy')
  hub.select('acc-2')
  assert.equal(hub.get().selectedId, 'acc-2')
  assert.equal(hub.get().notice, null, '切换账号即清提示，避免旧提示误导新账号上下文')
})

test('chrome missing blocks all browser actions with a controlled notice (S-08)', async () => {
  const { hub, calls } = makeHub({ chromeAvailable: false })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hub.get().chromeAvailable, false)
  assert.equal(hub.chromeBlocked(), true)
  await hub.beginLoginFlow({})
  await hub.probeNow('acc-1')
  await hub.startCollectFlow('acc-1')
  assert.deepEqual(calls.begin, [], '无系统 Chrome 不发起登录')
  assert.deepEqual(calls.probe, [], '无系统 Chrome 不发起探测')
  assert.deepEqual(calls.collectStart, [], '无系统 Chrome 不发起采集')
  assert.deepEqual(hub.get().notice, { kind: 'error', key: 'chromeMissing' })
})

test('truncated collect completion surfaces a warn notice instead of silent success', async () => {
  const { hub, clock } = makeHub({
    collectStatus: { status: 'ready', collect: { collectId: 'col-1', collectStatus: 'completed', pagesDone: 30, notesTotal: 900, truncated: true, summary: { notesCount: 900, totals: {}, gaps: {} } } },
  })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.startCollectFlow('acc-1')
  await clock.advance(2000)
  assert.deepEqual(hub.get().notice, { kind: 'warn', key: 'collectTruncated' })
})

test('probeNow leaves no stale probing marker when the page is left mid-probe', async () => {
  let resolveProbe
  const hub = createAccountsHub({
    listAccounts: async () => ({ accounts: [{ accountId: 'acc-1', sessionStatus: 'ok' }] }),
    beginLogin: async () => ({ status: 'error', reason: 'PROFILE_BUSY' }),
    loginStatus: async () => ({ status: 'ready', login: { status: 'idle' } }),
    probe: () => new Promise(resolve => { resolveProbe = resolve }),
    removeLocal: async () => ({ status: 'ready' }),
    startCollect: async () => ({ status: 'error', reason: 'PROFILE_BUSY' }),
    collectStatus: async () => ({ status: 'error' }),
    schedule: () => 0,
    clearSchedule: () => {},
  })
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  // 不 await：probe 挂起期间用户切页（stop）。
  const probing = hub.probeNow('acc-1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hub.get().probing.has('acc-1'), true, '挂起期间标记在位')
  hub.stop()
  resolveProbe({ status: 'ready', accountId: 'acc-1', sessionStatus: 'ok' })
  await probing
  hub.init()
  assert.equal(hub.get().probing.has('acc-1'), false, '重新进入无残留（finally 无条件清理 + init 兜底）')
})

test('stop halts polling and re-init resumes for an in-flight run', async () => {
  const { hub, clock } = makeHub()
  hub.init()
  await new Promise(resolve => setImmediate(resolve))
  await hub.beginLoginFlow({})
  assert.equal(clock.pending(), 1)
  hub.stop()
  assert.equal(clock.pending(), 0, '离开账号页停轮询')
  hub.init()
  assert.equal(clock.pending(), 1, '重新进入恢复未完成登录的轮询')
})

test('list failure keeps listError visible instead of zeroing accounts', async () => {
  const { hub } = makeHub()
  // 覆写 listAccounts 抛错：独立的 hub 实例验证失败路径。
  let fail = true
  const failing = createAccountsHub({
    listAccounts: async () => { if (fail) throw new Error('boom'); return { accounts: [] } },
    beginLogin: async () => ({ status: 'error', reason: 'PROFILE_BUSY' }),
    loginStatus: async () => ({ status: 'ready', login: { status: 'idle' } }),
    probe: async () => ({ status: 'ready' }),
    removeLocal: async () => ({ status: 'ready' }),
    startCollect: async () => ({ status: 'error', reason: 'PROFILE_BUSY' }),
    collectStatus: async () => ({ status: 'error' }),
    schedule: () => 0,
    clearSchedule: () => {},
  })
  failing.init()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(failing.get().listError, 'listFailed')
  assert.equal(failing.get().loaded, true)
  assert.ok(hub !== failing)
})
