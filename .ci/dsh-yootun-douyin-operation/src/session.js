// 抖音创作者中心扫码登录与会话管理（设备端）。
//
// 产品路径只有扫码：有头系统 Chrome → 打开 creator.douyin.com → 业务员用抖音 App 扫码
// → 轮询 `sessionid`/`sessionid_ss` cookie → 命中即保存 storage_state 到设备端。
// 无 Cookie 粘贴入口，无 Cookie 外发，无 stealth/反检测参数（docs/0909/douyin §6/§13）。

import { launchChrome, resolveSystemChrome } from './chrome.js'
import {
  clearLocalCredentials,
  ensureProfileDir,
  getAccount,
  hasStorageState,
  moveProfile,
  nextSessionSeq,
  paths,
  saveStorageState,
  stateRoot,
  updateAccount,
} from './state.js'

export const CREATOR_ORIGIN = 'https://creator.douyin.com/'
export const USER_INFO_PATH = '/web/api/media/user/info/'
export const SESSION_COOKIE_NAMES = ['sessionid', 'sessionid_ss']

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const COOKIE_POLL_INTERVAL_MS = 2000
const PROBE_TIMEOUT_MS = 45_000

// 页面内同源 fetch：由页面自身生成 msToken/a_bogus 等签名参数（设备端执行，tools 不直连抖音）。
// 必须传真实函数（传函数源码字符串时参数不会被送进页面）。
async function evaluateJson(pageOrContext, url) {
  const page = pageOrContext.page ? pageOrContext.page : pageOrContext
  try {
    const result = await page.evaluate(async target => {
      try {
        const response = await fetch(target, { credentials: 'same-origin' })
        const text = await response.text()
        try {
          return { status: response.status, json: JSON.parse(text) }
        } catch {
          return { status: response.status, json: null }
        }
      } catch (error) {
        return { status: 0, json: null, error: String(error && error.message ? error.message : error) }
      }
    }, url)
    return result && typeof result === 'object' ? result : null
  } catch {
    return null
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 轮询上下文 Cookie，直到出现登录态 Cookie 或超时。 */
export async function waitForSessionCookie(context, { timeoutMs = LOGIN_TIMEOUT_MS, intervalMs = COOKIE_POLL_INTERVAL_MS, now = () => Date.now() } = {}) {
  const deadline = now() + timeoutMs
  for (;;) {
    const cookies = await context.cookies()
    const hit = cookies.find(item => SESSION_COOKIE_NAMES.includes(item.name) && item.value)
    if (hit) return { loggedIn: true, cookieName: hit.name }
    if (now() >= deadline) return { loggedIn: false, cookieName: null }
    await sleep(intervalMs)
  }
}

/**
 * 读取账号基本资料（昵称/粉丝数/账号标识）。
 *
 * 必须由**页面上下文同源 fetch** 发起（浏览器自动签名）；返回 `null` 表示本次没取到，
 * 由调用方决定是否记为缺口，绝不猜测。
 */
export async function readAccountProfile(pageOrContext) {
  const result = await evaluateJson(pageOrContext, USER_INFO_PATH)
  if (!result || !result.json || typeof result.json !== 'object') return null
  const payload = result.json
  const user = payload.user || payload.data || payload
  if (!user || typeof user !== 'object') return null
  const accountId = firstNonEmpty(user.sec_uid, user.secUid, user.uid, user.user_id, user.id)
  if (!accountId) return null
  return {
    accountId: String(accountId),
    nickname: firstNonEmpty(user.nickname, user.name, user.nick_name) || null,
    avatar: firstNonEmpty(user.avatar_uri, user.avatar_url, user.avatarUrl, user.avatar) || null,
    fanCount: numberOrNull(firstPresent(user.follower_count, user.fans_count, user.fan_count, user.mplatform_followers_count)),
  }
}


/**
 * 扫码登录：有头系统 Chrome（独立 Profile）→ 等待扫码 → 保存 storage_state。
 *
 * @returns {Promise<{ status: 'ok'|'timeout'|'failed', accountId?: string, profile?: object }>}
 */
export async function loginWithQrCode({
  accountId,
  root = stateRoot(),
  chromium = null,
  platform,
  timeoutMs = LOGIN_TIMEOUT_MS,
  chromeFactory = launchChrome,
  onPage = null,
} = {}) {
  const tempId = accountId || `pending-${Date.now()}`
  const profileDir = await ensureProfileDir(tempId, root)
  let context = null
  try {
    // 启动失败（含系统无 Chrome）也必须走统一失败路径，绝不回退 Chromium。
    ;({ context } = await chromeFactory({ headless: false, profileDir, chromium, platform }))
    const page = context.pages()[0] || (await context.newPage())
    if (onPage) await onPage(page)
    await page.goto(CREATOR_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const waited = await waitForSessionCookie(context, { timeoutMs })
    if (!waited.loggedIn) {
      // 超时必须关闭有头窗口，否则窗口与进程会滞留（用户看不到任何提示）。
      await context.close().catch(() => {})
      return { status: 'timeout' }
    }

    const profile = await readAccountProfile(page)
    const resolvedId = profile && profile.accountId ? profile.accountId : tempId
    // 先存登录态（此时上下文仍打开），再关窗、再迁移 Profile 目录到正式账号 ID。
    await saveStorageState(resolvedId, context, root)
    await context.close()
    if (resolvedId !== tempId) await moveProfile(tempId, resolvedId, root)
    await updateAccount(resolvedId, {
      nickname: profile ? profile.nickname : null,
      avatar: profile ? profile.avatar : null,
      fanCount: profile ? profile.fanCount : null,
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

/**
 * 设备端会话探测：用本地 storage_state 无头访问创作者中心，返回 ok/expired/reason。
 *
 * tools 无法读取设备本地 vault，因此**校验只在设备端发生**；结果由调用方上报
 * `douyin_session_status_report`（带单调 sessionSeq）。
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
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } })
    try {
      const page = await context.newPage()
      await page.goto(CREATOR_ORIGIN, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      const cookies = await context.cookies()
      const hasSession = cookies.some(item => SESSION_COOKIE_NAMES.includes(item.name) && item.value)
      if (!hasSession) return { status: 'expired', reason: 'no_session_cookie' }
      const profile = await readAccountProfile(page)
      // 只有真正取到账号标识才算会话有效；页面返回空对象（未登录/被风控）判定过期。
      if (profile && profile.accountId) return { status: 'ok', profile }
      return { status: 'expired', reason: 'user_info_unavailable' }
    } finally {
      await context.close().catch(() => {})
    }
  } catch (error) {
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
    ...(result.profile && Number.isFinite(result.profile.fanCount) ? { fanCount: result.profile.fanCount } : {}),
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

/** 删除流程第 1 步：清除设备端 Profile 与 storage_state（成功后才允许请求远端删除）。 */
export async function removeLocalAccount({ accountId, root = stateRoot() } = {}) {
  const record = await getAccount(accountId, root)
  const removed = await clearLocalCredentials(accountId, root)
  return { accountId, cleared: removed, hadRecord: Boolean(record) }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function firstPresent(...values) {
  for (const value of values) if (value !== undefined && value !== null) return value
  return null
}

function numberOrNull(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function safeReason(error) {
  const code = error && typeof error.code === 'string' ? error.code : null
  if (code) return code
  const name = error && typeof error.name === 'string' ? error.name : 'session_error'
  return name.slice(0, 64)
}
