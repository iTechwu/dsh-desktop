import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import test from 'node:test'

import {
  acquireProfileLock,
  detectCaptcha,
  isPendingAccountId,
  isProfileBusy,
  loginWithQrCode,
  probeSession,
  readAccountProfile,
  readAccountProfileWithRetry,
  removeLocalAccount,
  waitForSessionCookie,
} from '../src/session.js'
import { getAccount, paths, saveSnapshot, stateRoot, updateAccount } from '../src/state.js'

function makeRoot(t) {
  const root = join(tmpdir(), `xhs-session-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })) })
  return root
}

const sleepFn = () => Promise.resolve()

// ---------------------------------------------------------------------------
// Profile 互斥（dev-implementation §2.1）：锁是即时占语义，跨操作维度
// ---------------------------------------------------------------------------

test('profile lock is exclusive per account and releases cleanly', () => {
  const release = acquireProfileLock('acc-1')
  assert.ok(release, '首个占用成功')
  assert.equal(isProfileBusy('acc-1'), true)
  assert.equal(acquireProfileLock('acc-1'), null, '同账号第二操作即 PROFILE_BUSY')
  assert.ok(acquireProfileLock('acc-2'), '不同账号互不影响')
  release()
  assert.equal(isProfileBusy('acc-1'), false)
  assert.ok(acquireProfileLock('acc-1'), '释放后可再次占用')
})

test('isPendingAccountId detects placeholder ids', () => {
  assert.equal(isPendingAccountId('pending-123'), true)
  assert.equal(isPendingAccountId('real-id'), false)
})

// ---------------------------------------------------------------------------
// cookie 轮询状态机（fake clock，dev-implementation §5 session 用例）
// ---------------------------------------------------------------------------

function fakeContext(cookiesQueue) {
  return { cookies: async () => cookiesQueue.shift() || [] }
}

function fakeClock() {
  let now = 0
  return { now: () => now, tick: ms => { now += ms } }
}

test('waitForSessionCookie hits the creator session cookie', async () => {
  const context = fakeContext([
    [{ name: 'web_session', value: 'guest' }],
    [{ name: 'galaxy_creator_session_id', value: 's1' }],
  ])
  const page = { isClosed: () => true }
  const result = await waitForSessionCookie(context, page, { timeoutMs: 60_000, sleepFn })
  assert.equal(result.loggedIn, true)
  assert.equal(result.cookieName, 'galaxy_creator_session_id')
})

test('waitForSessionCookie times out and reports captcha separately', async () => {
  const clock = fakeClock()
  const context = fakeContext([])
  const page = { isClosed: () => false, isVisible: async () => false }
  const timeout = await waitForSessionCookie(context, page, { timeoutMs: 4000, intervalMs: 2000, now: clock.now, sleepFn: async () => clock.tick(2000) })
  assert.deepEqual({ loggedIn: timeout.loggedIn, captcha: Boolean(timeout.captcha) }, { loggedIn: false, captcha: false })
  const captcha = await waitForSessionCookie(fakeContext([]), { isClosed: () => false, isVisible: async () => true }, { timeoutMs: 4000, intervalMs: 2000, now: clock.now, sleepFn: async () => clock.tick(2000) })
  assert.equal(captcha.captcha, true, '验证码可见 → 单独标记，绝不当作普通超时')
})

// ---------------------------------------------------------------------------
// readAccountProfile：user/info 免签名 fetch，无粉丝数不猜值
// ---------------------------------------------------------------------------

test('readAccountProfile parses userId/userName/userImage without inventing fields', async () => {
  const page = {
    evaluate: async (_js, url) => {
      assert.equal(url, '/api/galaxy/user/info')
      return { status: 200, json: { code: 0, data: { userId: 12345, userName: '昵称A', userImage: 'https://img.example/a.jpg', fansCount: 999 } } }
    },
  }
  const profile = await readAccountProfile(page)
  assert.equal(profile.accountId, '12345')
  assert.equal(profile.nickname, '昵称A')
  assert.equal(profile.avatar, 'https://img.example/a.jpg')
  assert.equal('fanCount' in profile, false, 'user/info 实测无粉丝数，不猜值（README §3.6）')
})

test('readAccountProfileWithRetry eventually gives up with null', async () => {
  const page = { evaluate: async () => 'not-json' }
  const profile = await readAccountProfileWithRetry(page, { attempts: 2, delayMs: 1, sleepFn })
  assert.equal(profile, null)
})

// ---------------------------------------------------------------------------
// loginWithQrCode：命中 → 迁移 + 落库；验证码 → CAPTCHA_DETECTED；超时关窗
// ---------------------------------------------------------------------------

function makeLoginFixtures(t, { cookiesQueue, profile, captchaVisible = false }) {
  const root = makeRoot(t)
  const closed = []
  const page = {
    isClosed: () => false,
    goto: async () => {},
    isVisible: async selector => (selector.includes('redcaptcha') ? captchaVisible : false),
    evaluate: async (_js, url) => {
      if (url === '/api/galaxy/user/info') return profile ? { status: 200, json: { code: 0, data: profile } } : { status: 200, json: null }
      throw new Error(`unexpected evaluate: ${url}`)
    },
  }
  const context = {
    pages: () => [page],
    cookies: async () => cookiesQueue.shift() || [],
    // 写真实文件：回归审查 P1（storage_state 备份曾被 moveStorageState 先删后迁丢失）。
    storageState: async ({ path }) => {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, JSON.stringify({ cookies: [], origins: [] }), 'utf8')
    },
    close: async () => { closed.push(1) },
  }
  const chromeFactory = async ({ headless, profileDir }) => {
    assert.equal(headless, false, '登录为有头')
    assert.match(profileDir, /profiles\//u)
    return { context }
  }
  return { root, page, context, closed, chromeFactory }
}

test('loginWithQrCode saves state, migrates the pending profile and updates the account', async t => {
  const { root, closed, chromeFactory } = makeLoginFixtures(t, {
    cookiesQueue: [[], [{ name: 'customerClientId', value: 'c1' }]],
    profile: { userId: 888, userName: '小李', userImage: 'https://img.example/li.jpg' },
  })
  const result = await loginWithQrCode({ root, chromeFactory, timeoutMs: 5000, sleepFn })
  assert.equal(result.status, 'ok')
  assert.equal(result.accountId, '888')
  assert.equal(result.profile.nickname, '小李')
  assert.equal(closed.length, 1, '登录成功后关闭有头窗口')
  const record = await getAccount('888', root)
  assert.equal(record.sessionStatus, 'ok')
  assert.equal(record.nickname, '小李')
  assert.ok(record.lastLoginAt)
  // 回归审查 P1：正式账号 storage_state 备份必须存在且 0600（曾被迁移逻辑删除）。
  const stateInfo = await stat(paths(root).storageStatePath('888'))
  assert.ok(stateInfo.isFile())
  assert.equal(stateInfo.mode & 0o777, 0o600)
})

test('loginWithQrCode without a readable profile never marks the account ok', async t => {
  const { root, chromeFactory } = makeLoginFixtures(t, {
    cookiesQueue: [[], [{ name: 'customerClientId', value: 'c1' }]],
    profile: null,
  })
  const result = await loginWithQrCode({ root, chromeFactory, timeoutMs: 5000, sleepFn })
  assert.equal(result.status, 'ok', '登录动作完成（会话 Cookie 已命中）')
  assert.equal(result.profilePending, true, '但资料未获取，显式标记 pending')
  const record = await getAccount(result.accountId, root)
  // 审查 P1：不得把资料不可读的登录落成 sessionStatus:'ok'（false-positive）。
  assert.equal(record.sessionStatus, 'unknown')
  assert.equal(record.nickname, null)
})

test('loginWithQrCode keeps an explicit accountId and reports captcha as failed', async t => {
  const { root, chromeFactory } = makeLoginFixtures(t, {
    cookiesQueue: [],
    profile: null,
    captchaVisible: true,
  })
  const result = await loginWithQrCode({ accountId: 'acc-cap', root, chromeFactory, timeoutMs: 5000, sleepFn })
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'CAPTCHA_DETECTED', '验证码出现即失败（CAPTCHA_DETECTED），绝不绕过')
  assert.equal((await getAccount('acc-cap', root))?.sessionStatus || 'unknown', 'unknown')
})

test('loginWithQrCode times out and closes the window', async t => {
  const { root, chromeFactory, closed } = makeLoginFixtures(t, { cookiesQueue: [], profile: null })
  const result = await loginWithQrCode({ accountId: 'acc-slow', root, chromeFactory, timeoutMs: 0, sleepFn })
  assert.equal(result.status, 'timeout')
  assert.equal(closed.length, 1, '超时必须关闭有头窗口，避免窗口滞留')
})

test('loginWithQrCode aborts with PROFILE_BUSY when the resolved account is busy', async t => {
  const { root, chromeFactory, closed } = makeLoginFixtures(t, {
    cookiesQueue: [[], [{ name: 'customerClientId', value: 'c1' }]],
    profile: { userId: 888, userName: '小李', userImage: 'https://img.example/li.jpg' },
  })
  // 扫码期间同账号已有另一浏览器操作持锁（如采集/重登）：迁移前二次检查必须拦截，
  // 因为 moveProfile 会先删除目标 Profile 目录——绝不能覆盖使用中的会话。
  const release = acquireProfileLock('888')
  try {
    const result = await loginWithQrCode({ root, chromeFactory, timeoutMs: 5000, sleepFn })
    assert.equal(result.status, 'failed')
    assert.equal(result.reason, 'PROFILE_BUSY')
    assert.equal(closed.length, 1, '冲突时也必须关闭有头窗口')
    assert.equal(await getAccount('888', root), null, '冲突时不落账号记录')
  } finally {
    release()
  }
  // pending 成果必须清理：Profile 目录与 storage_state 备份均不残留。
  const { readdir } = await import('node:fs/promises')
  assert.deepEqual(await readdir(join(root, 'profiles')), [], 'pending Profile 已清理')
  const storageFiles = await readdir(join(root, 'storage-state')).catch(error => (error.code === 'ENOENT' ? [] : null))
  assert.deepEqual(storageFiles, [], 'pending storage_state 已清理（目录不存在或为空）')
})

// ---------------------------------------------------------------------------
// probeSession：失效判定（stage0 §2.5）与无头复用 Profile
// ---------------------------------------------------------------------------

function makeProbeFixtures(t, { loginUrl, loginBoxVisible, profile }) {
  const root = makeRoot(t)
  const page = {
    url: () => loginUrl,
    goto: async () => {},
    reload: async () => {},
    isVisible: async selector => (selector.includes('login-box') ? loginBoxVisible : false),
    evaluate: async (_js, url) => (profile ? { status: 200, json: { code: 0, data: profile } } : { status: 200, json: null }),
  }
  const context = { pages: () => [page], storageState: async () => {}, close: async () => {} }
  const chromeFactory = async ({ headless, profileDir }) => {
    assert.equal(headless, false, 'probe 为有头（真机：无头实例触发风控吊销会话）')
    assert.match(profileDir, /profiles\/acc-p$/u)
    return { context }
  }
  return { root, chromeFactory }
}

test('probeSession reports expired without storage state', async t => {
  const { root } = makeProbeFixtures(t, { loginUrl: null, loginBoxVisible: false, profile: null })
  const result = await probeSession({ accountId: 'acc-p', root, chromeFactory: undefined })
  assert.equal(result.status, 'expired')
  assert.equal(result.reason, 'storage_state_missing')
})

test('probeSession detects the login redirect and the login box as expiry', async t => {
  { // 302 → /login（redirectReason=401）
    const { root, chromeFactory } = makeProbeFixtures(t, { loginUrl: 'https://creator.xiaohongshu.com/login?redirectReason=401', loginBoxVisible: false, profile: null })
    const { writeFile } = await import('node:fs/promises')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await writeFile(paths(root).storageStatePath('acc-p'), '{}', { mode: 0o600 })
    await updateAccount('acc-p', { sessionStatus: 'ok' }, root)
    const result = await probeSession({ accountId: 'acc-p', root, chromeFactory })
    assert.equal(result.status, 'expired')
    assert.equal(result.reason, 'login_page_detected')
    assert.equal((await getAccount('acc-p', root)).sessionStatus, 'expired')
  }
  { // 登录框可见
    const { root, chromeFactory } = makeProbeFixtures(t, { loginUrl: 'https://creator.xiaohongshu.com/', loginBoxVisible: true, profile: null })
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await writeFile(paths(root).storageStatePath('acc-p'), '{}', { mode: 0o600 })
    const result = await probeSession({ accountId: 'acc-p', root, chromeFactory })
    assert.equal(result.status, 'expired')
  }
})

test('probeSession marks the session ok and refreshes the backup storage state', async t => {
  const { root, chromeFactory } = makeProbeFixtures(t, {
    loginUrl: 'https://creator.xiaohongshu.com/new/home',
    loginBoxVisible: false,
    profile: { userId: 77, userName: '七号', userImage: 'https://img.example/7.jpg' },
  })
  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir(paths(root).storageStateDir, { recursive: true })
  await writeFile(paths(root).storageStatePath('acc-p'), '{}', { mode: 0o600 })
  await saveSnapshot('acc-p', { schemaVersion: 1, accountId: 'acc-p', capturedAt: 'x', notes: [] }, root)
  const result = await probeSession({ accountId: 'acc-p', root, chromeFactory })
  assert.equal(result.status, 'ok')
  assert.equal(result.profile.accountId, '77')
  const record = await getAccount('acc-p', root)
  assert.equal(record.sessionStatus, 'ok')
  assert.equal(record.nickname, '七号')
  assert.ok(record.sessionSeq >= 1)
})

// ---------------------------------------------------------------------------
// removeLocalAccount
// ---------------------------------------------------------------------------

test('removeLocalAccount clears local records and reports what was removed', async t => {
  const root = makeRoot(t)
  await updateAccount('acc-rm', { sessionStatus: 'ok' }, root)
  const result = await removeLocalAccount({ accountId: 'acc-rm', root })
  assert.equal(result.hadRecord, true)
  assert.equal(result.cleared.profile, true)
  assert.equal((await getAccount('acc-rm', root)), null)
  const again = await removeLocalAccount({ accountId: 'acc-rm', root })
  assert.equal(again.hadRecord, false, '幂等删除：再次移除不报错')
})

test('detectCaptcha tolerates page without isVisible', async () => {
  assert.equal(await detectCaptcha({}), false)
})
