// 小红书笔记基本数据采集（设备端，README §5.2/Q10）：
//
// 无头复用该账号持久 Profile（stage0 §2.1）→ 打开笔记管理页（页面加载签名 JS）
// → 页面内调用 window._webmsxyw 生成 x-s/x-t → 签名 fetch
// /api/galaxy/v2/creator/note/user/posted?tab=0&page=N 翻页（page 从 0 开始、
// 响应 data.page 为下一页、notes 为空终止、翻页间隔 ≥1s）→ 采集结果落设备端
// 本地快照文件（0600），**不入库、不经 MCP 上报**（Q10）。
//
// 采集实现契约对齐 data-collector-skill 小红书适配层（2026-09-20 live 校准）：
// - 签名函数未暴露时 fail-loud（绝不静默当空列表）；
// - 字段映射 id→contentId、display_title→title、view_count→plays、likes→likes、
//   collected_count→collects、comments_count→comments、shared_count→shares、
//   visible_time（unix 秒）→publishedAt、type(normal|video)→noteType、sticky→置顶；
// - metrics 字段缺失记 dataGap 不补 0。

import { launchChrome } from './chrome.js'
import { detectCaptcha } from './session.js'
import { ensureProfileDir, saveSnapshot, stateRoot, updateAccount } from './state.js'

export const NOTE_MANAGER_URL = 'https://creator.xiaohongshu.com/new/note-manager'
export const POSTED_PATH = '/api/galaxy/v2/creator/note/user/posted'

const DEFAULT_MAX_PAGES = 30
const PAGE_INTERVAL_MS = 1000
const SIGN_WAIT_TIMEOUT_MS = 20_000
const OPEN_TIMEOUT_MS = 60_000

export class CollectError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'CollectError'
    this.code = code
  }
}

// 页面签名 fetch：调页面自身的 _webmsxyw 生成 x-s/x-t 后 fetch（同源带凭证）。
// live 实测：v2 posted 必须带签名头，裸 fetch 被拒（code=-1）；签名函数缺失返回
// __no_sign__，由宿主 fail-loud（绝不静默当空列表）。
/**
 * 以**函数形式**传给 page.evaluate（真机验收发现：函数源码字符串作为表达式
 * 传入时返回 undefined → 误报「响应非 JSON」；函数形式实测正常拿到笔记数据）。
 * 函数体不得引用 Node 侧变量（url 经参数传入）。
 */
const signedFetchInPage = async url => {
  if (typeof window._webmsxyw !== 'function') {
    return JSON.stringify({ __no_sign__: true });
  }
  const sign = window._webmsxyw(url);
  const xs = sign && (sign['X-s'] || sign['x-s'] || sign.xs);
  const xt = sign && (sign['X-t'] || sign['x-t'] || sign.xt);
  if (!xs) {
    return JSON.stringify({ __no_sign__: true });
  }
  const headers = { 'X-s': String(xs), 'X-t': String(xt ?? Math.floor(Date.now() / 1000)) };
  const r = await fetch(url, { credentials: 'same-origin', headers });
  return await r.text();
}

function businessCode(raw) {
  const code = raw.code !== undefined ? raw.code : raw.errCode !== undefined ? raw.errCode : raw.retCode
  return code
}

function toIntOrNull(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  const text = String(value).trim()
  if (!text) return null
  if (text.endsWith('万')) {
    const scaled = Number.parseFloat(text.slice(0, -1))
    return Number.isFinite(scaled) ? Math.trunc(scaled * 10000) : null
  }
  const parsed = Number(text)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

/** 单条笔记 → 快照行（字段缺失不补值，绝不编造）。 */
export function mapNote(item) {
  if (!item || typeof item !== 'object') return null
  const contentId = item.id !== undefined && item.id !== null ? String(item.id).trim() : ''
  if (!contentId) return null
  const row = { contentId, title: typeof item.display_title === 'string' ? item.display_title : '' }
  // type: normal|video → noteType；未知值原样保留（不猜）
  const noteType = typeof item.type === 'string' && item.type ? item.type : null
  if (noteType) row.noteType = noteType
  // visible_time（unix 秒）优先；缺失不补
  const visibleTime = toIntOrNull(item.visible_time)
  if (visibleTime !== null) row.publishedAt = new Date(visibleTime * 1000).toISOString()
  const metrics = {}
  const pairs = [
    ['plays', 'view_count'],
    ['likes', 'likes'],
    ['collects', 'collected_count'],
    ['comments', 'comments_count'],
    ['shares', 'shared_count'],
  ]
  for (const [key, source] of pairs) {
    const value = toIntOrNull(item[source])
    if (value !== null) metrics[key] = value
  }
  if (Object.keys(metrics).length) row.metrics = metrics
  const cover = Array.isArray(item.images_list)
    ? item.images_list.map(entry => entry && typeof entry === 'object' ? entry.url : null).find(url => typeof url === 'string' && url.startsWith('http'))
    : null
  if (cover) row.coverUrl = cover
  if (item.sticky) row.sticky = true
  return row
}

/** posted 响应 → {notes: 快照行[], nextPage: number|null}。 */
export function parsePostedPage(raw) {
  if (!raw || typeof raw !== 'object') throw new CollectError('COLLECT_FAILED', 'posted response is not an object')
  const data = raw.data && typeof raw.data === 'object' ? raw.data : raw
  // 结构漂移（code=0 但 notes 非数组）显式失败：静默按空页 completed 会伪装成空采。
  if (!Array.isArray(data.notes)) throw new CollectError('COLLECT_FAILED', 'posted data.notes is not an array')
  const notes = data.notes.map(mapNote).filter(Boolean)
  const nextPage = Number.isInteger(data.page) ? data.page : null
  return { notes, nextPage }
}

/**
 * 快照聚合（基本数据卡口径，README §5.2）：
 * 笔记数 = notes.length；观看/点赞/收藏/评论/分享 = 对应 metrics 求和；
 * 字段缺失不补 0（记 dataGap，缺少数 = 缺该指标的笔记条数）。
 */
export function summarizeSnapshot(snapshot) {
  const notes = snapshot && Array.isArray(snapshot.notes) ? snapshot.notes : []
  const totals = { plays: 0, likes: 0, collects: 0, comments: 0, shares: 0 }
  const gaps = { plays: 0, likes: 0, collects: 0, comments: 0, shares: 0 }
  for (const note of notes) {
    const metrics = note && typeof note === 'object' ? note.metrics : null
    for (const key of Object.keys(totals)) {
      const value = metrics && typeof metrics === 'object' ? metrics[key] : undefined
      if (Number.isFinite(value)) totals[key] += value
      else gaps[key] += 1
    }
  }
  return { notesCount: notes.length, totals, gaps, capturedAt: snapshot && snapshot.capturedAt ? snapshot.capturedAt : null }
}

/**
 * 采集主流程：无头复用账号 Profile → 笔记管理页签名 fetch 翻页 → 快照落盘。
 *
 * @returns {Promise<{ pagesDone: number, notesTotal: number, snapshotPath: string, summary: object }>}
 */
export async function collectNotes({
  accountId,
  root = stateRoot(),
  chromium = null,
  platform,
  maxPages = DEFAULT_MAX_PAGES,
  pageIntervalMs = PAGE_INTERVAL_MS,
  chromeFactory = launchChrome,
  sleepFn = sleep,
  onProgress = null,
} = {}) {
  if (!accountId) throw new CollectError('COLLECT_FAILED', 'accountId required')
  // Profile 互斥由调用方（index.js run 层）统一持有（dev-implementation §2.1）。
  const profileDir = await ensureProfileDir(accountId, root)
  let context = null
  try {
    // 采集为无头（既定口径，不弹窗打扰）。真机观察：无头采集后可能触发会话吊销，
    // 若后续 probe/发布报 SESSION_EXPIRED，引导重新扫码登录即可（采集本身可重试）。
    ;({ context } = await chromeFactory({ headless: true, profileDir, chromium, platform }))
    const page = context.pages()[0] || (await context.newPage())
    await page.goto(NOTE_MANAGER_URL, { waitUntil: 'domcontentloaded', timeout: OPEN_TIMEOUT_MS })
    // 会话失效：跳 /login 或登录框可见（stage0 §2.5）
    const loginBoxVisible = await page.isVisible('div[class*="login-box"]').catch(() => false)
    if (String(page.url() || '').includes('/login') || loginBoxVisible) {
      throw new CollectError('SESSION_EXPIRED', 'login page detected')
    }
    // 签名函数依赖页面加载：超时 fail-loud（创作者中心改版即显式失败，不静默空采）
    try {
      await page.waitForFunction(() => typeof window._webmsxyw === 'function', null, { timeout: SIGN_WAIT_TIMEOUT_MS })
    } catch {
      if (await detectCaptcha(page)) throw new CollectError('CAPTCHA_DETECTED', 'captcha detected')
      throw new CollectError('COLLECT_FAILED', 'sign function _webmsxyw unavailable')
    }

    const notes = []
    let pagesDone = 0
    let pageNo = 0
    // 触达单次采集页数上限且还有下一页时置位：绝不静默截断（completed 也要可辨）。
    let truncated = false
    for (;;) {
      if (pagesDone >= maxPages) {
        truncated = true
        break
      }
      const text = await page.evaluate(signedFetchInPage, `${POSTED_PATH}?tab=0&page=${pageNo}`)
      let raw
      try {
        raw = JSON.parse(text)
      } catch {
        throw new CollectError('SESSION_EXPIRED', 'posted response is not JSON')
      }
      if (!raw || typeof raw !== 'object') throw new CollectError('COLLECT_FAILED', 'posted response is not an object')
      if (raw.__no_sign__) {
        throw new CollectError('COLLECT_FAILED', 'sign function _webmsxyw unavailable')
      }
      const code = businessCode(raw)
      if (code !== 0 && code !== '0') throw new CollectError('COLLECT_FAILED', `posted business code ${String(code).slice(0, 32)}`)
      const { notes: batch, nextPage } = parsePostedPage(raw)
      notes.push(...batch)
      pagesDone += 1
      if (onProgress) onProgress({ pagesDone, notesTotal: notes.length })
      // 终止条件：本页为空，或响应未给下一页，或下一页不前进
      if (!batch.length || nextPage === null || nextPage <= pageNo) break
      pageNo = nextPage
      await sleepFn(pageIntervalMs)
      if (await detectCaptcha(page)) throw new CollectError('CAPTCHA_DETECTED', 'captcha detected')
    }

    const snapshot = {
      schemaVersion: 1,
      accountId,
      capturedAt: new Date().toISOString(),
      source: 'creator-web',
      notes,
      ...(truncated ? { truncated: true } : {}),
    }
    const snapshotPath = await saveSnapshot(accountId, snapshot, root)
    await updateAccount(accountId, { lastCollectedAt: snapshot.capturedAt }, root)
    return { pagesDone, notesTotal: notes.length, truncated, snapshotPath, summary: summarizeSnapshot(snapshot) }
  } finally {
    if (context) await context.close().catch(() => {})
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
