import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ChromeMissingError } from '../src/chrome.js'
import {
  PENDING_ACCOUNT_PREFIX,
  SESSION_COOKIE_NAMES,
  isPendingAccountId,
  loginWithQrCode,
  probeSession,
  promotePendingAccount,
  readAccountProfile,
  readAccountProfileWithRetry,
  refreshSessionState,
  removeLocalAccount,
  waitForSessionCookie,
} from '../src/session.js'
import { getAccount, hasStorageState, paths, updateAccount } from '../src/state.js'

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

test('登录期资料读取重试：user/info 未就绪时多试几次再放弃', async () => {
  let calls = 0
  const page = {
    evaluate: async () => {
      calls += 1
      // 前两次模拟 SPA 未就绪：接口 200 但 user 为空 / 直接失败。
      if (calls <= 2) return calls === 1 ? { status: 200, json: { user: {} } } : null
      return { status: 200, json: { user: { sec_uid: 'real-id', nickname: '迟到但到了' } } }
    },
  }
  const profile = await readAccountProfileWithRetry(page, { attempts: 4, delayMs: 0, sleepFn: async () => {} })
  assert.equal(calls, 3)
  assert.equal(profile.accountId, 'real-id')
})

test('扫码登录在资料迟到时仍解析出真实 sec_uid（不再落 pending-）', async () => {
  await withRoot(async root => {
    let calls = 0
    const chromeFactory = async () => {
      const context = fakeCookieContext([{ name: 'sessionid', value: 'secret-value' }])
      const page = {
        goto: async () => {},
        evaluate: async () => {
          calls += 1
          if (calls === 1) return { status: 200, json: { user: {} } }
          return { status: 200, json: { user: { sec_uid: 'late-real-id', nickname: '迟到账号' } } }
        },
      }
      return { context: { ...context, pages: () => [page], newPage: async () => page, close: async () => {} } }
    }
    const result = await loginWithQrCode({ root, chromeFactory, timeoutMs: 1000 })
    assert.equal(result.status, 'ok')
    assert.equal(result.accountId, 'late-real-id')
    assert.equal(await hasStorageState('late-real-id', root), true)
  })
})

test('isPendingAccountId 只认 pending- 前缀', () => {
  assert.equal(PENDING_ACCOUNT_PREFIX, 'pending-')
  assert.equal(isPendingAccountId('pending-1789106616321'), true)
  assert.equal(isPendingAccountId('MS4wLjABAAAA-demo'), false)
  assert.equal(isPendingAccountId(''), false)
  assert.equal(isPendingAccountId(null), false)
  assert.equal(isPendingAccountId(undefined), false)
})

test('占位账号升级：文件与记录整体迁移到真实 sec_uid 名下', async () => {
  await withRoot(async root => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await mkdir(paths(root).profileDir('pending-1'), { recursive: true })
    await writeFile(paths(root).storageStatePath('pending-1'), '{"cookies":[{"name":"sessionid"}]}')
    await updateAccount('pending-1', { nickname: '旧名', sessionSeq: 7, lastLoginAt: 't0' }, root)

    const outcome = await promotePendingAccount({
      accountId: 'pending-1',
      root,
      probe: async () => ({ status: 'ok', profile: { accountId: 'MS4wLjABAAAA-real', nickname: '新名', fanCount: 9 } }),
    })
    assert.equal(outcome.promoted, true)
    assert.equal(outcome.accountId, 'MS4wLjABAAAA-real')
    assert.equal(outcome.fromAccountId, 'pending-1')

    // 本地记录：真实 ID 名下带升级来源与迁移后的资料；占位记录被清除。
    const record = await getAccount('MS4wLjABAAAA-real', root)
    assert.equal(record.promotedFrom, 'pending-1')
    assert.equal(record.nickname, '新名')
    assert.equal(record.fanCount, 9)
    assert.equal(record.sessionSeq, 7, '序号沿用占位记录，保持单调')
    assert.equal(record.lastLoginAt, 't0')
    assert.equal(await getAccount('pending-1', root), null)

    // 文件：storage_state 与 Profile 目录都已在真实 ID 名下，占位残留清空。
    assert.equal(await hasStorageState('MS4wLjABAAAA-real', root), true)
    assert.equal(await hasStorageState('pending-1', root), false)
  })
})

test('占位账号升级：真实记录已存在时保留其更大序号，不用空值覆盖资料', async () => {
  await withRoot(async root => {
    await updateAccount('pending-1', { nickname: '占位名', sessionSeq: 3 }, root)
    await updateAccount('MS4wLjABAAAA-real', { nickname: '已有名', fanCount: 50, sessionSeq: 12 }, root)

    const outcome = await promotePendingAccount({
      accountId: 'pending-1',
      root,
      // 探测资料缺昵称/粉丝数：不能把已有真实记录的资料冲掉。
      probe: async () => ({ status: 'ok', profile: { accountId: 'MS4wLjABAAAA-real' } }),
    })
    assert.equal(outcome.promoted, true)
    const record = await getAccount('MS4wLjABAAAA-real', root)
    assert.equal(record.nickname, '已有名')
    assert.equal(record.fanCount, 50)
    assert.equal(record.sessionSeq, 12, '两份记录取较大序号')
    assert.equal(record.promotedFrom, 'pending-1')
  })
})

test('占位账号升级：探测失败时不做任何变更', async () => {
  await withRoot(async root => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await writeFile(paths(root).storageStatePath('pending-1'), '{"cookies":[]}')
    await updateAccount('pending-1', { nickname: '旧名' }, root)

    const expired = await promotePendingAccount({
      accountId: 'pending-1',
      root,
      probe: async () => ({ status: 'expired', reason: 'no_session_cookie' }),
    })
    assert.equal(expired.promoted, false)
    assert.equal(expired.reason, 'no_session_cookie')
    assert.equal((await getAccount('pending-1', root))?.nickname, '旧名')
    assert.equal(await hasStorageState('pending-1', root), true)

    const noId = await promotePendingAccount({
      accountId: 'pending-1',
      root,
      probe: async () => ({ status: 'ok', profile: { nickname: '没有标识' } }),
    })
    assert.equal(noId.promoted, false)
    assert.equal(noId.reason, 'profile_unavailable')

    const notPending = await promotePendingAccount({ accountId: 'MS4wLjABAAAA-real', root, probe: async () => { throw new Error('不应被调用') } })
    assert.equal(notPending.promoted, false)
    assert.equal(notPending.reason, 'not_pending')
  })
})
