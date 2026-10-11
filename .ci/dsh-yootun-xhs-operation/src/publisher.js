// 创作者中心发布页打开（设备端；发布降级版，替代原「自动填写+存草稿」状态机）。
//
// 产品定位：**不做自动录入与自动存草稿**——本模块只负责有头打开该账号 Chrome 的
// 创作者中心发布页：会话校验（user/info 接口 + 登录页兜底，与 probe 同口径）→
// 验证码检测 → 导航到发布页，到此为止。内容由用户在发布页手动粘贴文案、上传素材、
// 手动发布；宿主不再触碰发布页 DOM，也不使用 CDP。
//
// 浏览器生命周期：context 创建后任何结局（completed/failed）都**保持打开**由用户
// 关闭；互斥锁随该 context 的 close 事件释放（见 index.js onContext 钩子）。

import { launchChrome } from './chrome.js'
import { CREATOR_ORIGIN, confirmSessionOnPage, detectCaptcha } from './session.js'
import { ensureProfileDir, stateRoot } from './state.js'

// 发布页 query（stage0 真机脚本统一口径：from=menu&target=image|video）
export const PUBLISH_URL_BASE = 'https://creator.xiaohongshu.com/publish/publish'
export function publishUrl(target) {
  return `${PUBLISH_URL_BASE}?from=menu&target=${target === 'video' ? 'video' : 'image'}`
}

// 打开发布页的导航超时（单次 goto；不含用户在页面上停留的时间）。
export const OPEN_TIMEOUT_MS = 60_000

export class PublishError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'PublishError'
    this.code = code
  }
}

/**
 * 有头打开该账号的创作者中心发布页（发布降级主流程）。
 *
 * 浏览器生命周期（红线口径）：主流程打开的有头 context 在 completed/failed 后都
 * **保持打开**由用户关闭；函数正常返回或抛 PublishError 均不 close。
 *
 * @param {object} options
 * @param {'image'|'video'} [options.target] 发布页目标 Tab（默认 image）
 * @param {Function} [options.confirmSessionFn] 会话判定注入（测试用，默认 confirmSessionOnPage）
 * @returns {Promise<{ status: 'completed', context: object }>}
 * @throws {PublishError} code ∈ SESSION_EXPIRED/CAPTCHA_DETECTED/PUBLISH_FAILED/
 *   GOOGLE_CHROME_MISSING/PLAYWRIGHT_DRIVER_MISSING/...
 */
export async function publishDraft({
  accountId,
  target = 'image',
  root = stateRoot(),
  chromium = null,
  platform,
  chromeFactory = launchChrome,
  confirmSessionFn = confirmSessionOnPage,
  onStep = null,
  onContext = null,
} = {}) {
  if (!accountId) throw new PublishError('PUBLISH_FAILED', 'accountId required')
  if (target !== 'image' && target !== 'video') throw new PublishError('PUBLISH_FAILED', 'target must be image or video')
  const step = name => { if (onStep) onStep(name) }

  // ---- prepare：参数校验 + 账号 Profile 目录就绪 ---------------------------
  step('prepare')
  const profileDir = await ensureProfileDir(accountId, root)
  const { context } = await chromeFactory({ headless: false, profileDir, chromium, platform })
  // 宿主生命周期钩子（审查 P1）：互斥锁随该 context 的 close 事件释放——
  // run 终态后窗口保持打开，锁必须保持到用户真正关闭浏览器。
  if (onContext) onContext(context)
  // 注意：从这一步起 context 在任何结局下都保持打开（README §5.3），由用户关闭。

  // ---- open：直接导航发布页（未登录会 302 到 /login，进入会话判定）---------
  step('open')
  const page = context.pages()[0] || (await context.newPage())
  await page.goto(publishUrl(target), { waitUntil: 'domcontentloaded', timeout: OPEN_TIMEOUT_MS })
  // 会话校验与 probe 同口径（confirmSessionOnPage）：ok 时顺带回写账号状态与
  // storage_state 备份（本次打开也是一次会话新鲜度刷新）。
  const session = await confirmSessionFn(page, { accountId, root })
  if (session.status === 'expired') {
    throw new PublishError('SESSION_EXPIRED', 'login page detected on publish open')
  }
  if (session.status !== 'ok') {
    throw new PublishError('PUBLISH_FAILED', `session check: ${String(session.reason || 'unknown').slice(0, 64)}`)
  }
  // 验证码检测（红线）：出现即失败提示人工处理，绝不绕过；浏览器保持打开。
  if (await detectCaptcha(page)) throw new PublishError('CAPTCHA_DETECTED', 'captcha on publish page')

  // ---- done：浏览器保持打开，内容由用户手动粘贴/上传/发布 ------------------
  step('done')
  return { status: 'completed', context }
}
