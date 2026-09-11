import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ChromeMissingError } from '../src/chrome.js'
import {
  SESSION_COOKIE_NAMES,
  loginWithQrCode,
  probeSession,
  readAccountProfile,
  refreshSessionState,
  removeLocalAccount,
  waitForSessionCookie,
} from '../src/session.js'
import { getAccount, hasStorageState, paths } from '../src/state.js'

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'douyin-session-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function fakeCookieContext(cookies, { onState } = {}) {
  return {
    cookies: async () => cookies,
    storageState: async ({ path }) => {
      if (onState) await onState(path)
      else {
        const { writeFile } = await import('node:fs/promises')
        await writeFile(path, JSON.stringify({ cookies, origins: [] }))
      }
    },
  }
}

test('只识别 sessionid / sessionid_ss 作为登录态 Cookie', () => {
  assert.deepEqual(SESSION_COOKIE_NAMES, ['sessionid', 'sessionid_ss'])
})

test('轮询等待登录态 Cookie，超时返回未登录', async () => {
  let calls = 0
  const context = {
    cookies: async () => {
      calls += 1
      return calls < 3 ? [{ name: 'ttwid', value: 'x' }] : [{ name: 'sessionid', value: 'secret-value' }]
    },
  }
  const hit = await waitForSessionCookie(context, { timeoutMs: 10_000, intervalMs: 1 })
  assert.equal(hit.loggedIn, true)
  assert.equal(hit.cookieName, 'sessionid')

  let clock = 0
  const timeout = await waitForSessionCookie(
    { cookies: async () => [] },
    { timeoutMs: 5, intervalMs: 1, now: () => (clock += 10) },
  )
  assert.equal(timeout.loggedIn, false)
  assert.equal(timeout.cookieName, null)
})

test('从页面同源 fetch 读取账号资料（昵称/粉丝数/账号标识）', async () => {
  const page = {
    evaluate: async () => ({
      status: 200,
      json: { user: { sec_uid: 'MS4wLjABAAAA-demo', nickname: '示例账号', follower_count: 290, avatar_uri: 'https://example.invalid/a.jpeg' } },
    }),
  }
  const profile = await readAccountProfile(page)
  assert.deepEqual(profile, {
    accountId: 'MS4wLjABAAAA-demo',
    nickname: '示例账号',
    avatar: 'https://example.invalid/a.jpeg',
    fanCount: 290,
  })
})

test('页面取不到资料时返回 null（记缺口，不猜测）', async () => {
  assert.equal(await readAccountProfile({ evaluate: async () => ({ status: 500, json: null }) }), null)
  assert.equal(await readAccountProfile({ evaluate: async () => { throw new Error('boom') } }), null)
  assert.equal(await readAccountProfile({ evaluate: async () => ({ status: 200, json: { user: {} } }) }), null)
})

test('扫码登录：等待 Cookie → 保存 storage_state → 迁移 Profile 到正式账号 ID', async () => {
  await withRoot(async root => {
    const created = []
    const chromeFactory = async ({ headless, profileDir }) => {
      created.push({ headless, profileDir })
      const context = fakeCookieContext([{ name: 'sessionid_ss', value: 'secret-value' }])
      const page = {
        goto: async () => {},
        evaluate: async () => ({ status: 200, json: { user: { sec_uid: 'real-account', nickname: '真实账号', follower_count: 12 } } }),
      }
      return { context: { ...context, pages: () => [page], newPage: async () => page, close: async () => {} } }
    }
    const result = await loginWithQrCode({ root, chromeFactory, timeoutMs: 1000 })
    assert.equal(result.status, 'ok')
    assert.equal(result.accountId, 'real-account')
    assert.equal(created[0].headless, false, '登录必须有头（扫码需桌面会话）')
    assert.equal(await hasStorageState('real-account', root), true)
    const record = await getAccount('real-account', root)
    assert.equal(record.sessionStatus, 'ok')
    assert.equal(record.nickname, '真实账号')
    assert.equal(record.vaultRef, paths(root).vaultRef('real-account'))
  })
})

test('扫码超时返回 timeout 且不写登录态', async () => {
  await withRoot(async root => {
    const chromeFactory = async () => {
      const context = fakeCookieContext([])
      const page = { goto: async () => {}, evaluate: async () => ({ status: 0, json: null }) }
      return { context: { ...context, pages: () => [page], newPage: async () => page, close: async () => {} } }
    }
    const result = await loginWithQrCode({ root, chromeFactory, timeoutMs: 1 })
    assert.equal(result.status, 'timeout')
    assert.equal(await hasStorageState('pending-1', root), false)
  })
})

test('无系统 Chrome 时登录失败但不回退 Chromium', async () => {
  await withRoot(async root => {
    const chromeFactory = async () => { throw new ChromeMissingError() }
    const result = await loginWithQrCode({ root, chromeFactory, timeoutMs: 10 })
    assert.equal(result.status, 'failed')
    assert.equal(result.reason, 'GOOGLE_CHROME_MISSING')
  })
})

test('会话探测：无 storage_state 直接判定 expired', async () => {
  await withRoot(async root => {
    const result = await probeSession({ accountId: 'acc-1', root })
    assert.equal(result.status, 'expired')
    assert.equal(result.reason, 'storage_state_missing')
  })
})

test('会话探测：页面取到用户信息判定 ok，取不到判定 expired', async () => {
  await withRoot(async root => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const target = paths(root).storageStatePath('acc-1')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await writeFile(target, JSON.stringify({ cookies: [{ name: 'sessionid', value: 'secret-value' }], origins: [] }))

    const makeDriver = payload => ({
      chromium: {
        launch: async () => ({
          newContext: async () => ({
            newPage: async () => ({ goto: async () => {}, evaluate: async () => payload }),
            cookies: async () => [{ name: 'sessionid', value: 'secret-value' }],
            close: async () => {},
          }),
          close: async () => {},
        }),
      },
    })

    const ok = await probeSession({
      accountId: 'acc-1', root, driver: makeDriver({ status: 200, json: { user: { sec_uid: 'acc-1', nickname: 'n', follower_count: 1 } } }),
    })
    assert.equal(ok.status, 'ok')
    assert.equal(ok.profile.accountId, 'acc-1')

    const expired = await probeSession({ accountId: 'acc-1', root, driver: makeDriver({ status: 200, json: { user: {} } }) })
    assert.equal(expired.status, 'expired')
    assert.equal(expired.reason, 'user_info_unavailable')
  })
})

test('refreshSessionState 追加单调序号并写回本地状态', async () => {
  await withRoot(async root => {
    const first = await refreshSessionState({ accountId: 'acc-1', root, probe: async () => ({ status: 'ok', profile: { nickname: 'n', fanCount: 3 } }) })
    const second = await refreshSessionState({ accountId: 'acc-1', root, probe: async () => ({ status: 'expired', reason: 'no_session_cookie' }) })
    assert.equal(first.sessionStatus, 'ok')
    assert.equal(first.sessionSeq, 1)
    assert.equal(second.sessionStatus, 'expired')
    assert.equal(second.sessionSeq, 2)
    assert.equal(second.reason, 'no_session_cookie')
    const record = await getAccount('acc-1', root)
    assert.equal(record.sessionSeq, 2)
    assert.equal(record.sessionStatus, 'expired')
  })
})

test('removeLocalAccount 清除本地凭证', async () => {
  await withRoot(async root => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await writeFile(paths(root).storageStatePath('acc-1'), '{"cookies":[]}')
    const result = await removeLocalAccount({ accountId: 'acc-1', root })
    assert.equal(result.cleared.storageState, true)
    assert.equal(await hasStorageState('acc-1', root), false)
  })
})
