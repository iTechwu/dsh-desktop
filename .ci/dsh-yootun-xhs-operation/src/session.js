// 小红书创作者中心扫码登录、会话探测与本地账号管理（设备端）。
//
// 产品路径只有扫码（docs/0928/xhs README §5.2/Q6）：有头系统 Chrome → 打开
// creator.xiaohongshu.com/login → 业务员用小红书 App 扫码 → 轮询创作平台会话
// Cookie → 保存 storage_state 备份到设备端。无 Cookie 粘贴入口，无 Cookie 外发，
// 无 stealth/反检测参数（红线）。
//
// 会话必须绑定持久 Profile（stage0 §2.1）：launchPersistentContext + 注入
// storageState 实测不生效；登录/probe/采集/发布共用同一账号 Profile 目录，
// Cookie 原生存于 Profile 内，storage_state 仅作备份/迁移介质。
//
// 失效判定（stage0 §2.5）：访问创作者中心 → 302 到 /login（redirectReason=401）
// 或登录框 div[class*="login-box"] 可见 → 会话过期。
//
// 验证码策略（红线）：出现验证码/安全验证（含 redcaptcha）→ 该任务置 failed
// （CAPTCHA_DETECTED），浏览器保持打开，提示人工处理，绝不自动绕过。

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

export const CREATOR_ORIGIN = 'https://creator.xiaohongshu.com/'
export const LOGIN_URL = CREATOR_ORIGIN + 'login'
// 创作平台登录成功信号 Cookie（data-collector-skill live 校准 2026-09-20）
export const SESSION_COOKIE_NAMES = [
  'customerClientId',
  'galaxy_creator_session_id',
  'access-token-creator.xiaohongshu.com',
  'customer-sso-sid',
]
export const USER_INFO_PATH = '/api/galaxy/user/info'
// 登录框可见性探测选择器（stage0 §2.5 失效特征）
export const LOGIN_BOX_SELECTOR = 'div[class*="login-box"]'
// 验证码特征选择器（redcaptcha 弹窗；出现即 CAPTCHA_DETECTED，绝不绕过）
export const CAPTCHA_SELECTOR = '[class*="redcaptcha"], iframe[src*="redcaptcha"], iframe[src*="captcha"]'

// 扫码等待上限 10 分钟（dev-implementation §2.3；业务员找手机扫码可能较慢）。
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const COOKIE_POLL_INTERVAL_MS = 2000
const PROBE_TIMEOUT_MS = 45_000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 进程内每账号一把锁：同一账号的 Profile 同时只能被一个浏览器操作占用
// （Chrome 用户数据目录本身也禁止并发实例）。锁是即时占语义，不排队；
// 由 index.js run 层（登录/probe/采集/发布入口）acquire 并在 finally 释放。
const profileLocks = new Set()

/**
 * 尝试占用账号 Profile；已被占用（任一登录/probe/采集/发布运行中）返回 null，
 * 调用方将 PROFILE_BUSY 返回给页面。释放必须走返回的 release 函数（finally）。
 */
export function acquireProfileLock(accountId) {
  const key = String(accountId || '').trim()
  if (!key) return null
  if (profileLocks.has(key)) return null
  profileLocks.add(key)
  let released = false
  return () => {
    if (!released) {
      released = true
      profileLocks.delete(key)
    }
  }
}

/** 判断账号 Profile 是否被进程内任一浏览器操作占用（登录/probe/采集/发布）。 */
export function isProfileBusy(accountId) {
  return profileLocks.has(String(accountId || '').trim())
}

// ---------------------------------------------------------------------------
// 页面内探测 helpers
// ---------------------------------------------------------------------------

/** 页面上下文同源 fetch：由页面自身携带会话与签名；返回 {status, json} 或 null。 */
async function evaluateJson(page, url) {
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

/** 验证码/安全验证特征可见性检测（登录/采集/发布流程共用；出现即失败，绝不绕过）。 */
export async function detectCaptcha(page) {
  try {
    return await page.isVisible(CAPTCHA_SELECTOR)
  } catch {
    return false
  }
}

/** 轮询上下文 Cookie，直到出现创作平台会话 Cookie 或超时；期间检测验证码。 */
export async function waitForSessionCookie(context, page, { timeoutMs = LOGIN_TIMEOUT_MS, intervalMs = COOKIE_POLL_INTERVAL_MS, now = () => Date.now(), sleepFn = sleep } = {}) {
  const deadline = now() + timeoutMs
  for (;;) {
    const cookies = await context.cookies()
    const hit = cookies.find(item => SESSION_COOKIE_NAMES.includes(item.name) && item.value)
    if (hit) return { loggedIn: true, cookieName: hit.name }
    if (page && !page.isClosed() && await detectCaptcha(page)) {
      return { loggedIn: false, captcha: true }
    }
    if (now() >= deadline) return { loggedIn: false, cookieName: null }
    await sleepFn(intervalMs)
  }
}

/**
 * 读取账号基本资料（账号 ID/昵称/头像）。
 *
 * 必须由页面上下文同源 fetch 发起（/api/galaxy/user/info，免签名）；实测该接口
 * **无粉丝数/笔记数字段**（README §3.6），界面诚实留空，不猜值。返回 null 表示
 * 本次没取到，由调用方决定是否记为缺口，绝不编造。
 */
export async function readAccountProfile(pageOrContext) {
  const page = pageOrContext.page ? pageOrContext.page : pageOrContext
  const result = await evaluateJson(page, USER_INFO_PATH)
  const payload = result && result.json && typeof result.json === 'object' ? result.json : null
  if (!payload) return null
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload
  if (!data || typeof data !== 'object') return null
  const accountId = firstNonEmpty(data.userId, data.user_id, data.id)
  if (!accountId) return null
  return {
    accountId: String(accountId),
    nickname: firstNonEmpty(data.userName, data.nickname, data.name, data.nick_name),
    avatar: httpUrlOrNull(firstPresent(data.userImage, data.image, data.images, data.avatar, data.userAvatar, data.headPhoto)),
  }
}

/** 登录瞬间读取账号资料，读不到时短间隔重试（SPA 未就绪/接口 302 的常见失败形态）。 */
export async function readAccountProfileWithRetry(page, { attempts = 4, delayMs = 1200, sleepFn = sleep } = {}) {
  let last = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      last = await readAccountProfile(page)
    } catch {
      last = null
    }
    if (last) return last
    if (attempt < attempts - 1) await sleepFn(delayMs)
  }
  return last
}

/**
 * 扫码登录：有头系统 Chrome（该账号/占位持久 Profile）→ 等待扫码 → 保存备份。
 *
 * @returns {Promise<{ status: 'ok'|'timeout'|'failed', accountId?: string, profile?: object, reason?: string }>}
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
  const tempId = accountId || `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  // Profile 互斥由调用方（index.js run 层）统一持有：同一账号的登录/probe/采集/发布
  // 任一运行中，其他操作入口即返回 PROFILE_BUSY（dev-implementation §2.1）。
  const profileDir = await ensureProfileDir(tempId, root)
  let context = null
  try {
    // 启动失败（含系统无 Chrome）也必须走统一失败路径，绝不回退 Chromium。
    ;({ context } = await chromeFactory({ headless: false, profileDir, chromium, platform }))
    const page = context.pages()[0] || (await context.newPage())
    if (onPage) await onPage(page)
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const waited = await waitForSessionCookie(context, page, { timeoutMs })
    if (!waited.loggedIn) {
      // 超时/验证码必须关闭有头窗口，否则窗口与进程会滞留（验证码场景保持窗口打开
      // 供人工处理的口径属发布流程；登录窗口超时关闭后可重新发起登录）。
      await context.close().catch(() => {})
      if (waited.captcha) return { status: 'failed', reason: 'CAPTCHA_DETECTED' }
      return { status: 'timeout' }
    }

    const profile = await readAccountProfileWithRetry(page)
    const resolvedId = profile && profile.accountId ? profile.accountId : tempId
    if (resolvedId !== tempId && isProfileBusy(resolvedId)) {
      // 竞态防御（dev-implementation §2.1）：扫码期间另一操作（如对同账号的显式
      // 重登/采集）已持锁。moveProfile 会先删目标 Profile 目录——绝不能覆盖正在
      // 使用的会话。丢弃本次 pending 成果（受控冲突，扫码极少与同账号操作并发）。
      await context.close()
      context = null
      await clearLocalCredentials(tempId, root)
      return { status: 'failed', reason: 'PROFILE_BUSY' }
    }
    // 先存登录态备份（此时上下文仍打开），再关窗、再迁移 Profile 目录到正式账号 ID。
    await saveStorageState(resolvedId, context, root)
    await context.close()
    context = null
    if (resolvedId !== tempId) {
      await moveProfile(tempId, resolvedId, root)
      await moveStorageState(tempId, resolvedId, root)
    }
    const now = new Date().toISOString()
    await updateAccount(resolvedId, {
      nickname: profile ? profile.nickname : null,
      avatar: profile ? profile.avatar : null,
      // 审查 P1：Cookie 命中但账号资料不可读（stale Cookie/风控空响应）时
      // sessionStatus 不得落 ok（false-positive 会把过期 Cookie 当有效账号）。
      // 落 unknown：UI 显示「待确认」，随后 account.probe 会给出 ok/expired。
      sessionStatus: profile ? 'ok' : 'unknown',
      sessionCheckedAt: now,
      lastLoginAt: now,
    }, root)
    return { status: 'ok', accountId: resolvedId, profile, profilePending: !profile }
  } catch (error) {
    if (context) await context.close().catch(() => {})
    return { status: 'failed', reason: safeReason(error) }
  }
}

/** 登录期没能解析出账号 ID 时使用的占位账号 ID 前缀（`pending-<时间戳>`）。 */
export const PENDING_ACCOUNT_PREFIX = 'pending-'

export function isPendingAccountId(accountId) {
  return typeof accountId === 'string' && accountId.startsWith(PENDING_ACCOUNT_PREFIX)
}

/**
 * 设备端会话探测：无头复用该账号持久 Profile 打开创作者中心（stage0 §2.1，
 * storageState 注入非持久上下文不生效，无捷径），失效特征判定（stage0 §2.5）。
 *
 * @returns {Promise<{ status: 'ok'|'expired'|'unknown', reason?: string, profile?: object }>}
 */
export async function probeSession({
  accountId,
  root = stateRoot(),
  chromium = null,
  platform,
  timeoutMs = PROBE_TIMEOUT_MS,
  chromeFactory = launchChrome,
} = {}) {
  if (!(await hasStorageState(accountId, root))) return { status: 'expired', reason: 'storage_state_missing' }
  // Profile 互斥由调用方（index.js run 层）统一持有（dev-implementation §2.1）。
  const profileDir = await ensureProfileDir(accountId, root)
  let context = null
  try {
    ;({ context } = await chromeFactory({ headless: false, profileDir, chromium, platform }))
    const page = context.pages()[0] || (await context.newPage())
    await page.goto(CREATOR_ORIGIN, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    // 失效判定以 **user/info 接口探测为准**（审查后真机第二轮：页面视觉状态受 SPA
    // 时序影响大——未就绪时瞬时渲染登录组件会误报 expired；接口探测不受视觉时序
    // 影响，且是会话真实有效性的直接证据）。探测失败（接口不可达/无账号标识）时
    // 短重试，仍失败再用「URL 跳 /login + 登录框可见（含 reload 复验）」兜底判定。
    const profile = await readAccountProfileWithRetry(page, { attempts: 3, delayMs: 1200 })
    if (profile && profile.accountId) {
      const now = new Date().toISOString()
      const seq = await nextSessionSeq(accountId, root)
      await updateAccount(accountId, {
        sessionStatus: 'ok',
        sessionCheckedAt: now,
        sessionSeq: seq,
        ...(profile.nickname ? { nickname: profile.nickname } : {}),
        ...(profile.avatar ? { avatar: profile.avatar } : {}),
      }, root)
      await saveStorageState(accountId, context, root).catch(() => {})
      return { status: 'ok', profile }
    }
    // user/info 未取到：以 URL/登录框兜底判定（含 reload 复验），绝不单次误标。
    const loginPageDetected = async () =>
      String(page.url() || '').includes('/login') ||
      (await page.isVisible(LOGIN_BOX_SELECTOR).catch(() => false))
    await sleep(1500)
    let expiredConfirmed = await loginPageDetected()
    if (!expiredConfirmed) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {})
      await sleep(2500)
      expiredConfirmed = await loginPageDetected()
    }
    if (expiredConfirmed) {
      const now = new Date().toISOString()
      const seq = await nextSessionSeq(accountId, root)
      await updateAccount(accountId, { sessionStatus: 'expired', sessionCheckedAt: now, sessionSeq: seq }, root)
      return { status: 'expired', reason: 'login_page_detected' }
    }
    // 既未确认有效也未确认失效（接口抖动且页面无登录特征）→ unknown，不猜测。
    return { status: 'unknown', reason: 'user_info_unavailable' }
    // 只有真正取到账号标识才算会话有效；页面返回空（未登录/被风控）判定过期。
    if (!profile || !profile.accountId) {
      const now = new Date().toISOString()
      const seq = await nextSessionSeq(accountId, root)
      await updateAccount(accountId, { sessionStatus: 'expired', sessionCheckedAt: now, sessionSeq: seq }, root)
      return { status: 'expired', reason: 'user_info_unavailable' }
    }
  } catch (error) {
    return { status: 'unknown', reason: safeReason(error) }
  } finally {
    if (context) await context.close().catch(() => {})
  }
}

/** 移除本地账号：清除设备端 Profile/storage_state/采集快照与本地记录。 */
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
  for (const value of values) if (value !== undefined && value !== null && value !== '') return value
  return null
}

/** 头像 URL 白名单：仅放行 http(s) 绝对地址，危险协议/相对地址一律 null。 */
function httpUrlOrNull(value) {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!/^https?:\/\//i.test(candidate)) return null
  return candidate.slice(0, 2048)
}

function safeReason(error) {
  const code = error && typeof error.code === 'string' ? error.code : null
  if (code) return code
  const name = error && typeof error.name === 'string' ? error.name : 'session_error'
  return name.slice(0, 64)
}
