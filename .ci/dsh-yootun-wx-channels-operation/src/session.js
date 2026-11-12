// 视频号助手扫码登录与会话管理（设备端，与抖音工作台同构）。
//
// 产品路径只有扫码：有头系统 Chrome → 打开 channels.weixin.qq.com → 业务员用微信
// 扫码并在手机确认 → 轮询页面上下文 auth_data 真正读出 finderUsername 才算登录
// （Cookie 命中≠会话有效，对齐抖音 2026-10-17 死 Cookie 教训）。无 Cookie 粘贴
// 入口，无 Cookie 外发，无 stealth/反检测参数（开发实施文档 §4.1/§8.3/§18）。

import { LAUNCH_ARGS, launchChrome, resolveSystemChrome } from './chrome.js'
import {
  clearLocalCredentials,
  ensureProfileDir,
  getAccount,
  hasStorageState,
  moveProfile,
  moveStorageState,
  nextSessionSeq,
  paths,
  saveStorageState,
  stateRoot,
  updateAccount,
} from './state.js'
import { SessionInvalidError } from './session-errors.js'
import { fetchAuthData } from './collector.js'

export const ASSISTANT_ORIGIN = 'https://channels.weixin.qq.com/'
// 登录会话 Cookie 名（阶段0-真机采集记录 §1.1：只记录名，不记录值，永不外发）。
export const SESSION_COOKIE_NAMES = ['sessionid', 'wxuin']

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const COOKIE_POLL_INTERVAL_MS = 2000
const PROBE_TIMEOUT_MS = 45_000
// 身份稳定等待：同一微信多视频号时，扫码后官方页面才出现身份选择；连续读到同一
// 身份才算用户选完（2026-11-11 真机串号根因）。需要连续 3 次相同（约 6 秒窗口），
// 留足用户在官方页面上点击选择的时间。
const IDENTITY_STABLE_ATTEMPTS = 8
const IDENTITY_STABLE_INTERVAL_MS = 2000
const IDENTITY_STABLE_REQUIRED = 3

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 轮询上下文 Cookie + 页面 auth_data 探活，直到读出账号资料或超时。
 *
 * verify 必传（登录流程）：Cookie 命中只说明「有 Cookie」——旧 Profile 残留的
 * 失效 Cookie 会秒假成功；探活读出 finderUsername 才算登录，资料随结果带出。
 */
export async function waitForSessionCookie(context, {
  timeoutMs = LOGIN_TIMEOUT_MS,
  intervalMs = COOKIE_POLL_INTERVAL_MS,
  verifyIntervalMs = Math.max(2500, COOKIE_POLL_INTERVAL_MS),
  verify = null,
  now = () => Date.now(),
} = {}) {
  const deadline = now() + timeoutMs
  for (;;) {
    const cookies = await context.cookies()
    const hit = cookies.find(item => SESSION_COOKIE_NAMES.includes(item.name) && item.value)
    if (hit) {
      if (!verify) return { loggedIn: true, cookieName: hit.name }
      let profile = null
      try {
        profile = await verify()
      } catch {
        profile = null
      }
      if (profile && profile.accountId) return { loggedIn: true, cookieName: hit.name, profile }
    }
    if (now() >= deadline) return { loggedIn: false, cookieName: null }
    await sleep(hit && verify ? verifyIntervalMs : intervalMs)
  }
}

/**
 * 等待官方页面上的视频号身份选择稳定（2026-11-11 真机串号根因）：
 *
 * 实测结论——同一个微信可绑定多个视频号，扫码后官方页面才出现身份选择；身份**不在
 * cookie 里**（cookie 只有微信级 sessionid/wxuin），由服务端按微信记住，页面切换一次
 * 即生效。auth_data 首次可读时返回的是默认/上次选择的身份，用户手动选择后才会变。
 *
 * 因此登录不能在 auth_data 首次可读时就结束：连续读到同一身份才认为「用户已选完」；
 * 身份发生变化则改用新身份并重新计数（用户还在选）。
 *
 * @param {object} page 官方页面
 * @param {object|null} firstProfile 首次读到的身份
 * @returns {Promise<{profile: object|null, stable: boolean}>} ``stable=false`` 表示
 *   轮询耗尽仍未确认用户选完身份——调用方**不得**据此建号（审查 P1-7）。
 */
export async function waitStableIdentity(page, firstProfile, {
  attempts = IDENTITY_STABLE_ATTEMPTS,
  intervalMs = IDENTITY_STABLE_INTERVAL_MS,
  required = IDENTITY_STABLE_REQUIRED,
} = {}) {
  let current = firstProfile && firstProfile.accountId ? firstProfile : null
  if (!current) return { profile: firstProfile, stable: false }
  let stableCount = 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await sleep(intervalMs)
    let next = null
    try {
      next = await fetchAuthData(page, { finderId: '' })
    } catch {
      continue // 读不到不算「身份变了」，继续等
    }
    if (!next || !next.accountId) continue
    if (next.accountId === current.accountId) {
      stableCount += 1
      // 连续多次读到同一身份 → 视为用户已完成选择。
      if (stableCount >= required) return { profile: next, stable: true }
    } else {
      // 身份变了（用户刚在官方页面选了另一个视频号）：以新身份为准，重新计数。
      current = next
      stableCount = 1
    }
  }
  return { profile: current, stable: false }
}

/** 登录瞬间读取账号资料失败时的短间隔重试（对齐抖音 pending 账号教训）。 */export async function readAccountProfileWithRetry(page, { attempts = 4, delayMs = 1200, sleepFn = sleep, finderId = '' } = {}) {
  let last = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await fetchAuthData(page, { finderId })
    } catch {
      last = null
    }
    if (last) return last
    if (attempt < attempts - 1) await sleepFn(delayMs)
  }
  return last
}

/**
 * 扫码登录：有头系统 Chrome（独立 Profile）→ 等待微信扫码 → auth_data 读出
 * finderUsername → 保存 storage_state 并迁移 Profile 到正式账号 ID。
 *
 * @returns {Promise<{ status: 'ok'|'timeout'|'failed', accountId?: string, profile?: object }>}
 */
export async function loginWithQrCode({
  accountId,
  root = stateRoot(),
  chromium = null,
  platform,
  timeoutMs = LOGIN_TIMEOUT_MS,
  intervalMs,
  verifyIntervalMs,
  chromeFactory = launchChrome,
  onPage = null,
} = {}) {
  // 登录一律先写**临时** Profile：即使调用方传了真实 accountId（历史 action 仍允许），
  // 也不会把登录态直接写进正式账号目录、更不会在 moveProfile 时 rm 掉其它账号的
  // Profile（2026-11-12 审查 P2-11）。
  const tempId = `pending-${Date.now()}`
  const profileDir = await ensureProfileDir(tempId, root)
  let context = null
  try {
    ;({ context } = await chromeFactory({ headless: false, profileDir, chromium, platform }))
    const page = context.pages()[0] || (await context.newPage())
    if (onPage) await onPage(page)
    await page.goto(ASSISTANT_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const waited = await waitForSessionCookie(context, {
      timeoutMs,
      intervalMs,
      verifyIntervalMs,
      verify: () => fetchAuthData(page, { finderId: '' }),
    })
    if (!waited.loggedIn) {
      // 超时必须关闭有头窗口，否则窗口与进程滞留（§8.3 异常处理）。
      await context.close().catch(() => {})
      return { status: 'timeout' }
    }
    const firstProfile = waited.profile || (await readAccountProfileWithRetry(page))
    // 身份稳定等待（2026-11-11 真机串号根因，实测结论）：
    // 同一个微信可绑定多个视频号，**扫码后官方页面才出现身份选择**；视频号身份不在
    // cookie 里（cookie 只有微信级的 sessionid/wxuin），由服务端按微信记住——官方页面
    // 切换一次即生效。auth_data 首次可读时返回的是**默认/上次选择的身份**，用户手动
    // 选择后才会变。若登录流程在首次可读时就结束，建立的是错误账号；之后采集另一个
    // 账号时官方按当前身份返回数据 → 串号。
    //
    // 因此：连续读到同一身份才认为「用户已选完」，身份发生变化则以新身份为准重新计数。
    const stableIdentity = await waitStableIdentity(page, firstProfile)
    if (!stableIdentity.stable) {
      // 轮询耗尽仍未确认身份：绝不能把「最后一次读到的身份」（很可能是默认身份）
      // 建成账号，否则后续采集会稳定采到别人的数据（审查 P1-7）。
      await context.close().catch(() => {})
      // 清理临时 Profile 与登录态文件，避免遗留（正式账号未被创建）。
      await clearLocalCredentials(tempId, root).catch(() => {})
      return { status: 'failed', reason: 'identity_not_stable' }
    }
    const profile = stableIdentity.profile
    const resolvedId = profile && profile.accountId ? profile.accountId : tempId
    await saveStorageState(resolvedId, context, root)
    await context.close()
    if (resolvedId !== tempId) await moveProfile(tempId, resolvedId, root)
    // 登录成功取新单调 seq：服务端会话状态不因旧 seq 停留在历史值（review P3-5）。
    const loginSeq = await nextSessionSeq(resolvedId, root)
    await updateAccount(resolvedId, {
      sessionSeq: loginSeq,
      nickname: profile ? profile.nickname : null,
      avatar: profile ? profile.avatar : null,
      followerTotalCount: profile ? profile.fansCount : null,
      feedCount: profile ? profile.feedsCount : null,
      isMasterFinder: profile ? profile.isMasterFinder : null,
      sessionStatus: 'ok',
      sessionCheckedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      vaultRef: paths(root).vaultRef(resolvedId),
    }, root)
    return { status: 'ok', accountId: resolvedId, profile }
  } catch (error) {
    if (context) await context.close().catch(() => {})
    return { status: 'failed', reason: safeReason(error) }
  }
}

/** 登录期没能解析出 finderUsername 时使用的占位账号 ID 前缀。 */
export const PENDING_ACCOUNT_PREFIX = 'pending-'

export function isPendingAccountId(accountId) {
  return typeof accountId === 'string' && accountId.startsWith(PENDING_ACCOUNT_PREFIX)
}

/**
 * 占位账号升级：用已保存登录态重新探测，把 `pending-` 身份迁移到真实 finderUsername
 * 名下（对齐抖音同款机制：账号 ID 无法后补，必须登录期/升级期解析）。
 */
export async function promotePendingAccount({ accountId, root = stateRoot(), probe = probeSession } = {}) {
  if (!isPendingAccountId(accountId)) return { promoted: false, accountId, reason: 'not_pending' }
  let result
  try {
    result = await probe({ accountId, root })
  } catch (error) {
    result = { status: 'unknown', reason: safeReason(error) }
  }
  if (!result || result.status !== 'ok' || !result.profile || !result.profile.accountId) {
    return { promoted: false, accountId, reason: (result && result.reason) || 'profile_unavailable' }
  }
  const realId = result.profile.accountId
  if (realId === accountId) return { promoted: false, accountId, reason: 'already_resolved' }

  const previous = await getAccount(accountId, root)
  const existing = await getAccount(realId, root)
  await moveStorageState(accountId, realId, root)
  await moveProfile(accountId, realId, root)

  const patch = {
    sessionStatus: 'ok',
    sessionCheckedAt: new Date().toISOString(),
    promotedFrom: accountId,
    vaultRef: paths(root).vaultRef(realId),
  }
  const profile = result.profile
  patch.nickname = profile.nickname || (existing && existing.nickname) || (previous && previous.nickname) || null
  patch.avatar = profile.avatar || (existing && existing.avatar) || (previous && previous.avatar) || null
  patch.followerTotalCount = firstFinite(profile.fansCount, existing && existing.followerTotalCount, previous && previous.followerTotalCount)
  patch.feedCount = firstFinite(profile.feedsCount, existing && existing.feedCount, previous && previous.feedCount)
  if (previous && previous.lastLoginAt) patch.lastLoginAt = previous.lastLoginAt
  const previousSeq = Number((previous && previous.sessionSeq) || 0)
  const existingSeq = Number((existing && existing.sessionSeq) || 0)
  if (previousSeq > 0 || existingSeq > 0) patch.sessionSeq = Math.max(previousSeq, existingSeq)

  const record = await updateAccount(realId, patch, root)
  await clearLocalCredentials(accountId, root)
  return { promoted: true, accountId: realId, fromAccountId: accountId, profile, record }
}

/**
 * 设备端会话探测：用本地 storage_state 无头访问视频号助手，auth_data 读出
 * finderUsername 才算 ok；返回 ok/expired/unknown（§8.4 状态判定表）。
 */
export async function probeSession({
  accountId,
  root = stateRoot(),
  chromium = null,
  platform,
  timeoutMs = PROBE_TIMEOUT_MS,
  driver = null,
} = {}) {
  if (!(await hasStorageState(accountId, root))) return { status: 'expired', reason: 'storage_state_missing' }
  const storageState = paths(root).storageStatePath(accountId)
  let browser = null
  try {
    const playwright = driver || (await import('playwright-core'))
    const chromePath = await resolveSystemChrome({ platform })
    browser = await playwright.chromium.launch({
      channel: chromePath.channel,
      executablePath: chromePath.path,
      headless: true,
      args: [...LAUNCH_ARGS],
    })
    const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } })
    try {
      const page = await context.newPage()
      await page.goto(ASSISTANT_ORIGIN, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      const cookies = await context.cookies()
      const hasSession = cookies.some(item => SESSION_COOKIE_NAMES.includes(item.name) && item.value)
      if (!hasSession) return { status: 'expired', reason: 'no_session_cookie' }
      const profile = await fetchAuthData(page, { finderId: '' })
      if (profile && profile.accountId) return { status: 'ok', profile }
      return { status: 'expired', reason: 'auth_data_unavailable' }
    } finally {
      await context.close().catch(() => {})
    }
  } catch (error) {
    // 明确的登录失效形态判 expired；环境异常（无 Chrome/超时/网络）判 unknown（§8.4）。
    if (error instanceof SessionInvalidError) return { status: 'expired', reason: error.reason }
    return { status: 'unknown', reason: safeReason(error) }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

/** 会话探测 + 单调序号追加：返回待上报的 { sessionStatus, sessionSeq, checkedAt, vaultRef }。 */
export async function refreshSessionState({ accountId, root = stateRoot(), probe = probeSession, deps = {} } = {}) {
  const result = await probe({ accountId, root, ...deps })
  const checkedAt = new Date().toISOString()
  const status = result.status === 'ok' ? 'ok' : result.status === 'expired' ? 'expired' : 'unknown'
  const seq = await nextSessionSeq(accountId, root)
  const record = await updateAccount(accountId, {
    sessionStatus: status,
    sessionCheckedAt: checkedAt,
    sessionSeq: seq,
    vaultRef: paths(root).vaultRef(accountId),
    ...(result.profile && result.profile.nickname ? { nickname: result.profile.nickname } : {}),
    ...(result.profile && Number.isFinite(result.profile.fansCount) ? { followerTotalCount: result.profile.fansCount } : {}),
    ...(result.profile && Number.isFinite(result.profile.feedsCount) ? { feedCount: result.profile.feedsCount } : {}),
  }, root)
  return {
    sessionStatus: status,
    sessionSeq: seq,
    checkedAt,
    vaultRef: paths(root).vaultRef(accountId),
    reason: result.reason || null,
    account: record,
  }
}

/**
 * 采集链路的会话过期记录：官方明确返回登录失效时调用（确定性证据，无需再探测）。
 */
export async function markSessionExpired({ accountId, root = stateRoot(), reason = 'session_invalid' } = {}) {
  const checkedAt = new Date().toISOString()
  const seq = await nextSessionSeq(accountId, root)
  const record = await updateAccount(accountId, {
    sessionStatus: 'expired',
    sessionCheckedAt: checkedAt,
    sessionSeq: seq,
    vaultRef: paths(root).vaultRef(accountId),
  }, root)
  return {
    sessionStatus: 'expired',
    sessionSeq: seq,
    checkedAt,
    vaultRef: paths(root).vaultRef(accountId),
    reason,
    account: record,
  }
}

/**
 * 采集链路的会话恢复：探测成功且采集未命中 SessionInvalidError 时拉回 `ok`。
 * floorSessionSeq 对齐远端下限（另一台设备可能已推高 seq）。
 */
export async function markSessionOk({
  accountId,
  root = stateRoot(),
  floorSessionSeq = 0,
  reason = 'collect_success',
} = {}) {
  const checkedAt = new Date().toISOString()
  const current = await getAccount(accountId, root)
  const floor = Number(floorSessionSeq)
  if (Number.isFinite(floor) && floor > Number(current?.sessionSeq || 0)) {
    await updateAccount(accountId, { sessionSeq: floor }, root)
  }
  const seq = await nextSessionSeq(accountId, root)
  const record = await updateAccount(accountId, {
    sessionStatus: 'ok',
    sessionCheckedAt: checkedAt,
    sessionSeq: seq,
    vaultRef: paths(root).vaultRef(accountId),
  }, root)
  return {
    sessionStatus: 'ok',
    sessionSeq: seq,
    checkedAt,
    vaultRef: paths(root).vaultRef(accountId),
    reason,
    account: record,
  }
}

/** 删除流程第 1 步：清除设备端 Profile 与 storage_state（成功后才允许远端删除，§16.2）。 */
export async function removeLocalAccount({ accountId, root = stateRoot() } = {}) {
  const record = await getAccount(accountId, root)
  const removed = await clearLocalCredentials(accountId, root)
  return { accountId, cleared: removed, hadRecord: Boolean(record) }
}

function firstFinite(...values) {
  for (const value of values) {
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }
  return undefined
}

function safeReason(error) {
  const code = error && typeof error.code === 'string' ? error.code : null
  if (code) return code
  const name = error && typeof error.name === 'string' ? error.name : 'session_error'
  return name.slice(0, 64)
}
