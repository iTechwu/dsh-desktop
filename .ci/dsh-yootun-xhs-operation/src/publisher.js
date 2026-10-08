// 草稿箱发布状态机（设备端，README §5.3 / dev-implementation §2.3-§2.5）。
//
// 产品定位（README §5.3）：**不做完全无人值守的自动化**——有头浏览器、过程可见、
// 随时可人工介入；不引入 patchright/stealth 等反检测内核（红线），只有拟人化
// 随机延时（操作自然化，非检测规避）。
//
// 流程（dev-implementation §2.3）：
//   prepare（probe=ok 校验 + 素材本地路径/URL 下载 tmp）
//   → open（有头打开发布页 from=menu&target=image|video；登录框 → SESSION_EXPIRED）
//   → upload（图片：标题框 visible ≤120s；视频：完成信号 ≤8min，S-10 待真机校准，
//     候选信号全不命中宁可 UPLOAD_TIMEOUT，绝不提前暂存——提前暂存=坏草稿）
//   → fill（拟人化延时表全部随机区间；标题 20 字截断；正文清空三连后录入；
//     话题 ≤10 联想候选失败跳过；可见性强制「仅自己可见」）
//   → saveDraft（MutationObserver 挂载 → CDP pierce 定位「暂存离开」→ hover+click
//     → 15s 内捕获 toast「保存成功」→ done；未捕获 → SAVE_DRAFT_NO_RESPONSE）
//   → done（回写 storage_state；浏览器保持打开由用户关闭）
// 任何一步验证码/选择器丢失/超时 → failed(受控码)，浏览器保持打开，文案不丢可重试。
//
// 真机校准事实（stage0 §2.2-§2.4，脚本 save-draft-v3/headed-humanized/
// video-headed-keep/save-draft-cdp）：「暂存离开」在 <xhs-publish-btn> closed
// Shadow DOM，Playwright 选择器引擎无法穿透，必须 CDP DOM.getDocument({pierce})
// + DOM.performSearch + DOM.getBoxModel 拿 host 盒模型后按 0.40 比例 mouse.click。

import { createWriteStream } from 'node:fs'
import { mkdir, rm, access, constants, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launchChrome } from './chrome.js'
import { detectCaptcha, probeSession, LOGIN_BOX_SELECTOR } from './session.js'
import { ensureProfileDir, saveStorageState, stateRoot } from './state.js'

export const PUBLISH_URL_BASE = 'https://creator.xiaohongshu.com/publish/publish'
// 发布页 query（stage0 真机脚本统一口径：from=menu&target=image|video）
export function publishUrl(target) {
  return `${PUBLISH_URL_BASE}?from=menu&target=${target === 'video' ? 'video' : 'image'}`
}

// 发布页选择器（stage0 真机校准，勿凭记忆改动）
export const IMAGE_INPUT_SELECTORS = ['input[type="file"][accept*="image"]', 'input.upload-input']
export const VIDEO_INPUT_SELECTORS = ['div[class^=\'upload-content\'] input.upload-input', 'input.upload-input']
export const TITLE_INPUT_SELECTOR = 'input[placeholder*="填写标题"]'
export const BODY_EDITOR_SELECTOR = 'p[data-placeholder*="输入正文描述"]'
export const TOPIC_CONTAINER_SELECTOR = '#creator-editor-topic-container'
export const TOPIC_ITEM_SELECTOR = '#creator-editor-topic-container .item'
// 可见性下拉（save-draft-cdp.mjs 真机校准：点击「公开可见」→ 弹层点「仅自己可见」）
export const VISIBILITY_CURRENT_SELECTOR = 'text=公开可见'
export const VISIBILITY_PRIVATE_SELECTOR = 'text=仅自己可见'

// 视频上传完成信号候选（stage0 §2.7 遗留：真机 DOM 待校准，acceptance S-10 复测项）。
// 语义：重传按钮出现 / 视频预览渲染 = 上传+转码完成。「标题框 visible」实测 2s 即出现，
// 不能作为视频完成信号（140MB 仍在上传），已明确弃用。
export const VIDEO_UPLOAD_DONE_SELECTORS = [
  '[class*="re-upload"]',
  '[class*="reupload"]',
  'video[src], [class*="video-preview"] video, [class*="player"] video',
]

export const TITLE_MAX_CHARS = 20
export const TAGS_MAX = 10
export const IMAGE_UPLOAD_TIMEOUT_MS = 120_000
export const VIDEO_UPLOAD_TIMEOUT_MS = 8 * 60_000
export const SAVE_TOAST_TIMEOUT_MS = 15_000
export const MAX_MATERIAL_BYTES = 500 * 1024 * 1024

// 拟人化延时表（README §5.3 已定稿；全部随机区间，禁止固定等间隔）。
// 参数集中于此，业务方反馈后整体调节；测试注入固定 randomFn/sleepFn 验证区间。
export const HUMANIZED_DELAYS = {
  openToUpload: [1500, 3000],     // 打开发布页 → 开始上传素材
  uploadToTitle: [2000, 4000],    // 素材上传完成 → 聚焦标题（重点缓冲，模拟查看素材/封面）
  titleChar: [80, 160],           // 标题逐字录入
  titleToBody: [800, 1600],       // 标题完成 → 点击正文区域
  bodyChar: [50, 120],            // 正文逐字录入
  bodySentencePause: [300, 800],  // 句号/换行后额外停顿
  bodyToTopic: [1000, 2000],      // 正文完成 → 输入第一个话题
  topicCandidate: [500, 1200],    // 话题联想候选出现 → 点击候选
  topicGap: [1000, 2000],         // 话题与话题之间
  beforeSaveDraft: [2000, 4000],  // 全部填写完成 → 点击「暂存离开」（模拟人工检查）
}

export class PublishError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'PublishError'
    this.code = code
  }
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 闭区间随机整数（[min, max] 含两端），randomFn 可注入（越界值收敛到上界）。 */
export function randomInRange([min, max], random = Math.random) {
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  const span = high - low + 1
  return low + Math.min(span - 1, Math.floor(random() * span))
}

async function fileExists(path) {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

// 素材 URL 收紧（审查 P2）：仅接受 https 公网地址，拒绝内网/环网/本地信任面
// （防止被污染请求触发内网 URL fetch / SSRF）。
export function isAllowedMaterialUrl(raw) {
  if (!/^https:\/\//i.test(raw)) return false
  try {
    const { hostname } = new URL(raw)
    const host = hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
    if (host === '[::1]' || host === '0.0.0.0') return false
    return true
  } catch {
    return false
  }
}

/**
 * 默认素材下载：公开 CDN URL → 状态根外系统 tmp（不携带任何凭证）。
 * 流式写盘（不整文件进内存）+ 60s 总超时 + 流式累计大小上限（审查 P2）。
 */
async function defaultDownload(url, destPath) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new PublishError('PUBLISH_FAILED', `material download http ${response.status}`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_MATERIAL_BYTES) throw new PublishError('PUBLISH_FAILED', 'material too large')
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath, { mode: 0o600 }))
  const info = await stat(destPath)
  if (info.size > MAX_MATERIAL_BYTES) {
    await rm(destPath, { force: true })
    throw new PublishError('PUBLISH_FAILED', 'material too large')
  }
  return destPath
}

function extensionFromUrl(url) {
  const match = /\.(jpe?g|png|webp|gif|mp4|mov|m4v)(?:[?#]|$)/i.exec(url)
  return match ? `.${match[1].toLowerCase()}` : '.bin'
}

/** 本地路径识别：POSIX 绝对路径或 Windows 盘符路径（chrome.js 支持 win32，发布同机解析）。 */
function looksLikeLocalPath(raw) {
  return raw.startsWith('/') && !raw.includes('://') || /^[a-zA-Z]:[\\/]/.test(raw)
}

/** 素材条目归一化：字符串（url 或本地路径）或 {path,url} 对象（本地优先、url 兜底）。 */
function normalizeMaterial(item) {
  if (typeof item === 'string') return { path: null, url: item.trim() }
  if (item && typeof item === 'object') {
    return {
      path: typeof item.path === 'string' ? item.path.trim() || null : null,
      url: typeof item.url === 'string' ? item.url.trim() || null : null,
    }
  }
  return null
}

/**
 * 素材解析（README §5.3）：本地原文件路径优先（上传管理器持有的 picked.path），
 * path 不可用（未带/已删除）时按 URL 下载到临时目录兜底。返回 { paths, cleanup }——
 * cleanup 在上传后清 tmp；解析中途失败同样清理已下载素材（不残留 tmp）。
 */
export async function resolveMaterials({ imageUrls = [], videoUrl = null, workDir, downloadFn = defaultDownload }) {
  await mkdir(workDir, { recursive: true, mode: 0o700 })
  const inputs = [
    ...imageUrls.map(item => ({ material: normalizeMaterial(item), kind: 'image' })),
    ...(videoUrl ? [{ material: normalizeMaterial(videoUrl), kind: 'video' }] : []),
  ]
  const entries = []
  try {
    for (const [index, input] of inputs.entries()) {
      const material = input.material
      if (!material || (!material.path && !material.url)) throw new PublishError('PUBLISH_FAILED', 'empty material entry')
      // 本地原文件优先：path 存在才可用；不可用回退 URL 下载（TOS 时效签名过期前本地文件仍在）。
      if (material.path && looksLikeLocalPath(material.path) && await fileExists(material.path)) {
        entries.push(material.path)
        continue
      }
      const raw = material.url || ''
      if (!raw) {
        throw new PublishError('PUBLISH_FAILED', `material not found: ${material.path.slice(0, 200)}`)
      }
      if (looksLikeLocalPath(raw)) {
        // 本地路径：不存在与下载失败同等对待（不猜扩展名、不静默跳过）。
        if (!(await fileExists(raw))) throw new PublishError('PUBLISH_FAILED', `material not found: ${raw.slice(0, 200)}`)
        entries.push(raw)
        continue
      }
      if (!/^https?:\/\//i.test(raw)) throw new PublishError('PUBLISH_FAILED', 'material is neither a local path nor an http(s) url')
      // 仅接受 https 公网地址（审查 P2：拒绝 http 明文与内网/环网目标，防 SSRF）。
      if (!isAllowedMaterialUrl(raw)) throw new PublishError('MATERIAL_SOURCE_REJECTED', `material url not allowed: ${raw.slice(0, 120)}`)
      const ext = (material.path && /\.[a-zA-Z0-9]+$/.test(material.path) && extensionFromUrl(material.path)) || extensionFromUrl(raw)
      const dest = join(workDir, `material-${index}${ext}`)
      await downloadFn(raw, dest)
      entries.push(dest)
    }
  } catch (error) {
    // 解析失败自清：不留半批已下载素材在 tmp。
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  let cleaned = false
  return {
    paths: entries,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}


/**
 * 小红书正文纯文本化（审查问题 1/2）：
 * ① 剥离 markdown 标记（双星粗体、双下划线斜体、行首短横列表 → 「· 」、行首井号标题）——
 *    小红书正文不渲染 markdown，`**` 会原样暴露；
 * ② 剥离正文尾部的纯文本话题串（模型按小红书习惯在结尾追加 `#a #b`，与逐个
 *    话题化输入重复，真机出现「标签输入两遍」）——只剥末尾连续 # 话题块。
 */
export function toXhsPlainText(body) {
  let text = String(body || '').replace(/\r\n/g, '\n')
  text = text.replace(/\*\*([^*]*)\*\*/g, '$1').replace(/__([^_]*)__/g, '$1')
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^[-*]\s+/gm, '· ')
  text = text.replace(/^\s*#\S+(?:\s+#\S+)*\s*$/gm, line => line.includes('#') ? '' : line)
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

/** 剥离正文尾部纯文本话题串后的正文（话题化输入前调用，避免标签出现两遍）。 */
export function stripTrailingTopics(body) {
  return String(body || '').replace(/(?:\s*#[^#\s]+)+\s*$/u, '').trim()
}

/** 首个已挂载选择器（隐藏的 file input 也算——真机口径，审查阶段0实测 visible:false 但可 setInputFiles）。 */
async function firstAttached(page, selectors, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      if (await locator.count().then(n => n > 0).catch(() => false)) return locator
    }
    if (Date.now() >= deadline) return null
    await new Promise(resolve => setTimeout(resolve, 300))
  }
}

/** 首个可见选择器（Playwright text= 引擎与 CSS 引擎均可），全不可见返回 null。 */
async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (await locator.isVisible().catch(() => false)) return locator
  }
  return null
}

/** CDP pierce closed Shadow DOM：定位「暂存离开」host 盒模型并换算点击坐标（0.40）。 */
export function computeSaveDraftClick(hostBox) {
  return {
    x: Math.round(hostBox.x + hostBox.w * 0.40),
    y: Math.round(hostBox.y + hostBox.h / 2),
  }
}

async function locateSaveDraftBox(cdp) {
  await cdp.send('DOM.enable')
  await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const { searchId, resultCount } = await cdp.send('DOM.performSearch', { query: '暂存离开' })
  try {
    if (!resultCount) throw new PublishError('SELECTOR_MISSING', 'save-draft button not found in shadow dom')
    const { nodeIds } = await cdp.send('DOM.getSearchResults', { searchId, fromIndex: 0, toIndex: resultCount })
    for (const nodeId of nodeIds) {
      const described = await cdp.send('DOM.describeNode', { nodeId })
      if (described.node.nodeType !== 1) continue
      const box = await cdp.send('DOM.getBoxModel', { nodeId })
      const q = box.model.content
      // content 四角坐标（stage0 真机口径）：x=q[0], y=q[1], w=q[2]-q[0], h=q[5]-q[1]
      return { x: q[0], y: q[1], w: q[2] - q[0], h: q[5] - q[1] }
    }
    throw new PublishError('SELECTOR_MISSING', 'save-draft host box unavailable')
  } finally {
    // 释放搜索结果（审查 P3：长页面/多 run 下的 CDP 资源泄漏）。
    await cdp.send('DOM.discardSearchResults', { searchId }).catch(() => {})
  }
}

/** 挂载 toast 观察器（瞬时 toast，URL 不变化；点击「暂存离开」前必须就位）。 */
const TOAST_OBSERVER_JS = `() => {
  window.__xhsToasts = [];
  new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType === 1) { const t = (n.innerText || '').trim();
      if (t && t.length < 60) window.__xhsToasts.push({ cls: String(n.className || '').slice(0, 50), text: t });
    }
  } }).observe(document.body, { childList: true, subtree: true });
}`

const DRAIN_TOASTS_JS = `() => (window.__xhsToasts || []).splice(0)`

/**
 * 草稿箱发布主流程。
 *
 * 浏览器生命周期（红线口径）：主流程打开的有头 context 在 completed/failed 后都
 * **保持打开**由用户关闭；函数正常返回或抛 PublishError 均不 close。
 *
 * @param {object} options
 * @returns {Promise<{ status: 'completed', toast: string }>}
 * @throws {PublishError} code ∈ SESSION_EXPIRED/UPLOAD_TIMEOUT/SAVE_DRAFT_NO_RESPONSE/
 *   SELECTOR_MISSING/CAPTCHA_DETECTED/PUBLISH_FAILED/GOOGLE_CHROME_MISSING/...
 */
export async function publishDraft({
  accountId,
  title,
  body,
  tags = [],
  imageUrls = [],
  videoUrl = null,
  root = stateRoot(),
  chromium = null,
  platform,
  chromeFactory = launchChrome,
  probeFn = probeSession,
  delays = HUMANIZED_DELAYS,
  randomFn = Math.random,
  sleepFn = defaultSleep,
  now = Date.now,
  downloadFn = defaultDownload,
  workDir = join(tmpdir(), `xhs-publish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  onStep = null,
  onContext = null,
} = {}) {
  if (!accountId) throw new PublishError('PUBLISH_FAILED', 'accountId required')
  if (!String(title || '').trim()) throw new PublishError('PUBLISH_FAILED', 'title required')
  if (!String(body || '').trim()) throw new PublishError('PUBLISH_FAILED', 'body required')
  const isVideo = Boolean(videoUrl)
  if (!isVideo && !(Array.isArray(imageUrls) && imageUrls.length)) throw new PublishError('PUBLISH_FAILED', 'imageUrls required for image publish')

  const pause = async key => { await sleepFn(randomInRange(delays[key], randomFn)) }
  const step = name => { if (onStep) onStep(name) }

  // ---- prepare：会话校验（probe=ok 才继续）+ 素材解析 -----------------------
  step('prepare')
  const probe = await probeFn({ accountId, root, chromium, platform })
  if (probe.status !== 'ok') {
    // expired → 会话过期；unknown（浏览器/驱动异常）→ 透传受控码或统一失败
    if (probe.status === 'expired') throw new PublishError('SESSION_EXPIRED', 'probe reports expired session')
    throw new PublishError('PUBLISH_FAILED', `session probe: ${String(probe.reason || 'unknown').slice(0, 64)}`)
  }
  const materials = await resolveMaterials({ imageUrls, videoUrl, workDir, downloadFn })
  try {
    // ---- open：有头打开该账号发布页 ----------------------------------------
    step('open')
    const profileDir = await ensureProfileDir(accountId, root)
    const { context } = await chromeFactory({ headless: false, profileDir, chromium, platform })
    // 宿主生命周期钩子（审查 P1）：互斥锁随该 context 的 close 事件释放——
    // run 终态后窗口保持打开，锁必须保持到用户真正关闭浏览器。
    if (onContext) onContext(context)
    // 注意：从这一步起 context 在任何结局下都保持打开（README §5.3），由用户关闭。
    const page = context.pages()[0] || (await context.newPage())
    await page.goto(publishUrl(isVideo ? 'video' : 'image'), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const loginBoxVisible = await page.isVisible(LOGIN_BOX_SELECTOR).catch(() => false)
    if (String(page.url() || '').includes('/login') || loginBoxVisible) {
      throw new PublishError('SESSION_EXPIRED', 'login page detected on publish open')
    }
    if (await detectCaptcha(page)) throw new PublishError('CAPTCHA_DETECTED', 'captcha on publish open')

    // ---- upload：素材上传 + 就绪信号 ---------------------------------------
    step('upload')
    await pause('openToUpload')
    const inputSelectors = isVideo ? VIDEO_INPUT_SELECTORS : IMAGE_INPUT_SELECTORS
    // 上传 file input 常为隐藏元素（display:none）：按 attached 语义定位（真机实测）。
    const input = await firstAttached(page, inputSelectors)
    if (!input) throw new PublishError('SELECTOR_MISSING', 'upload input not attached')
    await input.setInputFiles(materials.paths)
    await waitUploadReady({ page, isVideo, sleepFn, now, onCaptcha: async () => {
      if (await detectCaptcha(page)) throw new PublishError('CAPTCHA_DETECTED', 'captcha during upload')
    } })

    // ---- fill：拟人化录入（README §5.3 延时表全随机区间）--------------------
    step('fill')
    await pause('uploadToTitle')
    const titleInput = page.locator(TITLE_INPUT_SELECTOR).first()
    if (!(await titleInput.isVisible().catch(() => false))) throw new PublishError('SELECTOR_MISSING', 'title input not visible')
    await titleInput.click()
    const clippedTitle = String(title).trim().slice(0, TITLE_MAX_CHARS)
    for (const ch of clippedTitle) {
      await page.keyboard.type(ch)
      await sleepFn(randomInRange(delays.titleChar, randomFn))
    }

    await pause('titleToBody')
    const bodyEditor = page.locator(BODY_EDITOR_SELECTOR).first()
    if (!(await bodyEditor.isVisible().catch(() => false))) throw new PublishError('SELECTOR_MISSING', 'body editor not visible')
    await bodyEditor.click()
    // 正文清空三连（dev-implementation §2.4）：Backspace / Ctrl+A / Delete
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    const bodyText = toXhsPlainText(stripTrailingTopics(body))
    for (const ch of bodyText) {
      await page.keyboard.type(ch)
      if ('，。！？\n'.includes(ch)) await sleepFn(randomInRange(delays.bodySentencePause, randomFn))
      else await sleepFn(randomInRange(delays.bodyChar, randomFn))
    }

    await pause('bodyToTopic')
    const topicList = (Array.isArray(tags) ? tags : []).map(tag => String(tag || '').trim()).filter(Boolean).slice(0, TAGS_MAX)
    for (const tag of topicList) {
      await typeTopic(page, tag, { sleepFn, randomFn, delays })
      // 话题与话题之间（最后一个之后也留缓冲，对齐真机脚本节奏）
      await sleepFn(randomInRange(delays.topicGap, randomFn))
    }

    // 验证码检测（审查 P1：fill 阶段同样覆盖，出现即失败绝不绕过）。
    if (await detectCaptcha(page)) throw new PublishError('CAPTCHA_DETECTED', 'captcha during fill')

    // ---- saveDraft：CDP pierce + toast 捕获 + 草稿箱最终裁决 ----------------
    step('saveDraft')
    await pause('beforeSaveDraft')
    if (await detectCaptcha(page)) throw new PublishError('CAPTCHA_DETECTED', 'captcha before save draft')
    await page.evaluate(TOAST_OBSERVER_JS)
    const cdp = await context.newCDPSession(page)
    const hostBox = await locateSaveDraftBox(cdp)
    const clickAt = computeSaveDraftClick(hostBox)
    await page.mouse.move(clickAt.x, clickAt.y)
    await sleepFn(400)
    await page.mouse.down()
    await sleepFn(80)
    await page.mouse.up()
    // 快速信号：toast「保存成功」（可能因文案/结构变化漏捕——真机已发生两例，
    // 草稿实际保存成功）。漏捕时降级为**草稿箱最终裁决**：列表出现同标题草稿
    // 即成功（审查/验收口径：以草稿真实落箱为准，toast 仅作快速信号）。
    const urlBeforeSave = page.url()
    // 草稿箱计数基线（点击前）：「草稿箱(N)」
    const countBefore = await page.evaluate(() => {
      const m = (document.body.innerText || '').match(/草稿箱\((\d+)\)/)
      return m ? Number(m[1]) : null
    }).catch(() => null)
    const toast = await waitForSaveToast(page, { sleepFn }).catch(() => null)
    let confirmedVia = toast ? 'toast' : null
    if (!toast) {
      // toast 漏捕时多信号裁决（真机：点击「暂存离开」后页面可能跳离发布页）：
      // ① 跳离发布页（暂存并离开的字面行为）② 首页出现「草稿箱中有未发布的作品」
      // ③ 草稿箱列表出现同标题草稿。任一命中即成功。
      for (let i = 0; i < 20; i++) {
        await sleepFn(1000)
        if (!String(page.url() || '').includes('/publish')) { confirmedVia = 'navigated'; break }
        const probeText = (await page.evaluate(() => document.body.innerText || '').catch(() => '')) || ''
        const countNow = (probeText.match(/草稿箱\((\d+)\)/) || [])[1]
        if (countBefore !== null && countNow !== undefined && Number(countNow) > countBefore) { confirmedVia = 'draft-count'; break }
        if (/草稿箱中有未发布的作品/.test(probeText)) { confirmedVia = 'home-banner'; break }
      }
      if (!confirmedVia) {
        const found = await confirmDraftInBox(page, { isVideo, title: String(title).trim(), sleepFn })
        if (!found) throw new PublishError('SAVE_DRAFT_NO_RESPONSE', 'no toast and draft not found in draft box')
        confirmedVia = 'draft-box'
      }
    }

    // ---- done：回写 storage_state 备份；浏览器保持打开 ----------------------
    step('done')
    await saveStorageState(accountId, context, root).catch(() => {})
    // context 返回给宿主：锁随浏览器窗口生命周期释放（审查 P1，见 index.js）。
    return { status: 'completed', toast, context }
  } finally {
    // tmp 素材清理；context 有意不 close（浏览器保持打开，README §5.3）。
    await materials.cleanup()
  }
}

/**
 * 草稿箱最终裁决：点「草稿箱(N)」入口 → 切对应 Tab → 列表出现同标题草稿 = 已落箱。
 * （toast 漏捕时的可靠兜底，真机两例误报后引入。）
 */
async function confirmDraftInBox(page, { isVideo, title, sleepFn }) {
  // 入口「草稿箱(N)」可能被 draft-tabs 子树拦截 pointer events（真机实测）：
  // 改 JS click 直接触发元素 click 事件，绕过 hit-testing（参考项目 _js_click_by_text 同款）。
  const jsClickByText = async text => page.evaluate(t => {
    const nodes = [...document.querySelectorAll('*')].filter(e => !e.children.length && (e.textContent || '').trim().startsWith(t))
    if (!nodes.length) return false
    let el = nodes[nodes.length - 1]
    for (let i = 0; i < 4 && el; i++) { try { el.click() } catch {} el = el.parentElement }
    return true
  }, text).catch(() => false)

  // 弹窗数据懒加载 + 标题可能截断（确认逻辑修复）：4 轮 × [3s 等待 + 重开弹窗 +
  // 切 Tab + 1.5s + 包含式匹配标题前 10 字]。仍未命中 → false（最终人工确认兜底）。
  const matchText = String(title).trim().slice(0, 10)
  for (let round = 0; round < 4; round++) {
    await sleepFn(3000)
    if (!(await jsClickByText('草稿箱'))) return false   // 弹窗被关（Escape/点击外部）→ 重开入口
    await sleepFn(1500)
    const tabName = isVideo ? '视频笔记' : '图文笔记'
    if (await jsClickByText(tabName)) await sleepFn(1500)
    const found = await page.evaluate(t => {
      return [...document.querySelectorAll('*')].some(e => (e.textContent || '').includes(t))
    }, matchText).catch(() => false)
    if (found) {
      await page.keyboard.press('Escape').catch(() => {})
      return true
    }
  }
  await page.keyboard.press('Escape').catch(() => {})
  return false
}
/** 上传就绪等待：图片=标题框 visible ≤120s；视频=完成信号候选 ≤8min（S-10）。 */
async function waitUploadReady({ page, isVideo, sleepFn, now = Date.now, onCaptcha }) {
  const deadline = now() + (isVideo ? VIDEO_UPLOAD_TIMEOUT_MS : IMAGE_UPLOAD_TIMEOUT_MS)
  for (;;) {
    // 验证码检测（出现即抛 CAPTCHA_DETECTED，浏览器保持打开，绝不绕过）。
    await onCaptcha()
    if (isVideo) {
      // 视频完成信号（保守）：重传按钮/预览渲染任一可见（选择器待 S-10 真机校准）。
      const done = await firstVisible(page, VIDEO_UPLOAD_DONE_SELECTORS)
      if (done) return
    } else {
      if (await page.isVisible(TITLE_INPUT_SELECTOR).catch(() => false)) return
    }
    if (now() >= deadline) {
      throw new PublishError('UPLOAD_TIMEOUT', isVideo ? 'video upload not confirmed in 8min' : 'title input not visible in 120s')
    }
    await sleepFn(2000)
  }
}

/** 单个话题：键入 #话题 → 等联想候选 → 点击；候选失败退格跳过该话题（绝不硬选）。 */
async function typeTopic(page, tag, { sleepFn, randomFn, delays }) {
  const text = `#${tag}`
  await page.keyboard.type(text, { delay: randomInRange([60, 140], randomFn) })
  try {
    await page.locator(TOPIC_CONTAINER_SELECTOR).first().waitFor({ state: 'visible', timeout: 6000 })
    const item = page.locator(TOPIC_ITEM_SELECTOR).first()
    await item.waitFor({ state: 'visible', timeout: 4000 })
    await sleepFn(randomInRange(delays.topicCandidate, randomFn))
    await item.click()
  } catch {
    // 联想候选未出现（依赖线上接口）：退格清除已键入文本，跳过该话题。
    for (let i = 0; i < text.length; i++) await page.keyboard.press('Backspace')
  }
}

/**
 * 点击后 15s 内轮询 toast，命中「保存/草稿」相关文案即返回（快速信号，最终以
 * 草稿箱裁决兜底；不含泛化「成功」避免「上传成功」误命中）；轮询期间同步检测
 * 验证码。超时返回 null。
 */
async function waitForSaveToast(page, { sleepFn }) {
  for (let waited = 0; waited < SAVE_TOAST_TIMEOUT_MS; waited += 1000) {
    await sleepFn(1000)
    const toasts = await page.evaluate(DRAIN_TOASTS_JS).catch(() => [])
    const hit = (Array.isArray(toasts) ? toasts : []).find(item => item && typeof item.text === 'string' && /保存|草稿/.test(item.text))
    if (hit) return hit.text
    if (await detectCaptcha(page)) throw new PublishError('CAPTCHA_DETECTED', 'captcha while waiting save toast')
  }
  return null
}
