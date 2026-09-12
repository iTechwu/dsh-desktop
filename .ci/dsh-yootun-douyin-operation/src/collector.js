// 创作者中心采集引擎（设备端，页面上下文同源请求）。
//
// 关键约束（docs/0909/douyin §7/§13）：
// - 所有抖音接口都在**页面上下文**通过同源 fetch 或响应拦截调用，由页面自身生成
//   msToken/a_bogus 签名；CI/tools 侧绝不直连抖音；
// - 19 位 aweme_id 作为裸 JSON 数字会被 JSON.parse 舍入，因此先取文本再对长数字加引号后解析；
// - 列表不完整（has_more 异常 / 游标不前进 / 达 max_pages）一律标记 listComplete=false，
//   绝不按空列表结算；
// - 低播放 item_compare（status_code=10001）不产生整条作品错误，只记完播类缺口。

import { normalizeAvatarUrl } from './avatar.js'
import {
  LOW_PLAY_STATUS_CODE,
  buildWorkPayload,
  decidePagination,
  dedupeWorks,
  parseItemCompare,
  parseItemMget,
  parseJsonPreservingIds,
  parseItemPerformance,
  parsePlaySource,
  parsePortrait,
  parseProgressAnalysis,
  parseSearchKeywords,
  parseWorkListPage,
  parseWordCloud,
} from './parse.js'

export const WORK_LIST_PATH = '/janus/douyin/creator/pc/work_list'
export const ITEM_ANALYSIS_BASE = '/janus/douyin/creator/data/item_analysis'
export const ITEM_COMPARE_PATH = '/janus/douyin/creator/data/diagnose/item_compare'
export const PLAY_SOURCE_PATH = '/janus/douyin/creator/data/item/play/source'
// 进度分析：必须带 `/janus/douyin/creator` 前缀。缺前缀的 `/bff/...` 会被
// creator.douyin.com 的 SPA 兜底路由接住并返回 index.html（200 + text/html），
// 解析器拿到 HTML → 契约上"未暴露"，整账号作品被误记为 not_exposed 缺口。
export const PROGRESS_PATH = '/janus/douyin/creator/bff/data/progress/analysis/v2'
export const SEARCH_KEYWORD_PATH = '/janus/douyin/creator/data/item_analysis/search/keyword'
export const PORTRAIT_PATH = '/janus/douyin/creator/data/fans/item/portrait'
export const WORD_CLOUD_PATH = '/aweme/v1/creator/data/item/wordCloud/'
export const USER_INFO_PATH = '/web/api/media/user/info/'
// 单稿指标：详情页概览接口，补齐列表 `statistics` 未暴露的 `danmaku_count`。
export const ITEM_MGET_PATH = '/web/api/creator/item/mget'
export const ITEM_MGET_FIELDS = 'metrics,review,play_info,dou_plus,integrated_incentive,item_status,recommend_info'

export const WORK_MANAGE_URL = 'https://creator.douyin.com/creator-micro/content/manage'
export const WORK_DETAIL_URL = workId => `https://creator.douyin.com/creator-micro/work-management/work-detail/${workId}`

// 注意：这些是**响应拦截用的 URL 片段**，不是可直接请求的完整路径——
// `collectWorkDetail` 用 `url.includes(fragment)` 匹配，所以 `progress` 只写后缀即可
// 命中真实 URL。抓取兜底用的完整路径（含 `/janus/douyin/creator` 前缀）定义在
// 上面的 `*_PATH` 常量里，两者不要混用：`progress` 用完整 PROGRESS_PATH。
export const DETAIL_TARGETS = {
  compare: '/data/diagnose/item_compare',
  source: '/data/item/play/source',
  progress: '/bff/data/progress/analysis/v2',
  search: '/data/item_analysis/search/keyword',
  portrait: '/data/fans/item/portrait',
  mget: '/web/api/creator/item/mget',
}

export const DEFAULT_PAGE_SIZE = 12
export const MAX_PAGES_LIMIT = 1000
export const PAGE_INTERVAL_MS = 1000
// tools 侧 `douyin_collect_run_set_list_meta.expectedWorkCount` 的 schema 上限就是 10000，
// 超限会在 `run_set_list_meta` 处被确定性拒绝（属 DETERMINISTIC_ERRORS，不重试）。
// 默认分页上限 1000 页 × 12 条 = 12000 条，**理论上可达**，因此这里在列表阶段就拦截：
// 直接以稳定码失败，而不是先跑完所有详情再被服务端拒绝。
export const MAX_EXPECTED_WORK_COUNT = 10_000
export const ITEM_GENRES = [1, 2, 3, 4, 5, 8]


// 页面内同源 fetch（浏览器自动补签名）；返回文本以便精度安全解析。
// 注意：必须传**真实函数**（而不是函数源码字符串）——Playwright 仅在传入函数时把参数送进页面。
async function evaluateJsonFetch(page, { url, method = 'GET', body = null }) {
  return page.evaluate(async request => {
    try {
      const init = { method: request.method || 'GET', credentials: 'same-origin' }
      if (request.body !== undefined && request.body !== null) {
        init.method = request.method || 'POST'
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(request.body)
      }
      const response = await fetch(request.url, init)
      return { status: response.status, text: await response.text() }
    } catch (error) {
      return { status: 0, text: '', error: String(error && error.message ? error.message : error) }
    }
  }, { url, method, body })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 页面上下文请求并解析（长数字安全）。 */
export async function fetchJson(page, url, { method = 'GET', body = null } = {}) {
  const raw = await evaluateJsonFetch(page, { url, method, body })
  if (!raw || typeof raw !== 'object' || raw.status !== 200) {
    return { ok: false, status: raw ? raw.status : 0, json: null, error: raw && raw.error ? raw.error : null }
  }
  const json = parseJsonPreservingIds(raw.text)
  return { ok: json !== null, status: 200, json, error: json === null ? 'invalid_json' : null }
}

/**
 * 作品列表分页采集。
 *
 * @returns {Promise<{works: object[], listComplete: boolean, pages: object[], reason: string|null, error: string|null}>}
 */
export async function collectWorkList(page, {
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = MAX_PAGES_LIMIT,
  intervalMs = PAGE_INTERVAL_MS,
  retries = 2,
  onPage = null,
  now = () => Date.now(),
} = {}) {
  if (!(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= MAX_PAGES_LIMIT)) {
    throw new Error('max_pages_out_of_range')
  }
  const collected = []
  const pages = []
  let cursor = 0
  let listComplete = false
  let reason = null
  let error = null

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const url = `${WORK_LIST_PATH}?scene=star_atlas&device_platform=android&aid=1128&status=0&count=${pageSize}&max_cursor=${cursor}`
    let result = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      result = await fetchJson(page, url)
      if (result.ok) break
      if (attempt < retries) await sleep(Math.min(8000, 1000 * 2 ** attempt))
    }
    if (!result || !result.ok) {
      // 某页失败：指数退避后仍失败 → 列表不完整，绝不按空列表结算。
      reason = 'page_request_failed'
      error = result && result.status ? `page_http_${result.status}` : 'page_request_failed'
      break
    }
    const parsed = parseWorkListPage(result.json)
    collected.push(...parsed.works)
    pages.push({ pageNumber, cursor, count: parsed.rawCount, hasMore: parsed.hasMore })
    if (onPage) onPage({ pageNumber, count: parsed.rawCount, hasMore: parsed.hasMore, collected: collected.length })

    const decision = decidePagination({ page: parsed, cursor, pageNumber, maxPages })
    if (decision.stop) {
      listComplete = decision.listComplete
      reason = decision.reason
      break
    }
    cursor = parsed.nextCursor
    await sleep(intervalMs)
  }

  const works = dedupeWorks(collected)
  return { works, listComplete, pages, reason, error, cursor }
}

/** 批量作品分析：involved_vertical → overview / item_performance（metric_type=1）。 */
export async function collectItemAnalysis(page, { days = 30, now = () => new Date(), genres = ITEM_GENRES } = {}) {
  const end = now()
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  const startDate = yyyymmdd(start)
  const endDate = yyyymmdd(end)
  const vertical = await fetchJson(page, `${ITEM_ANALYSIS_BASE}/involved_vertical?start_date=${startDate}&end_date=${endDate}`)
  const primaryVerticals = vertical.ok && Array.isArray(vertical.json.primary_verticals) ? vertical.json.primary_verticals : []
  const performance = await fetchJson(page, `${ITEM_ANALYSIS_BASE}/item_performance`, {
    method: 'POST',
    body: { start_date: startDate, end_date: endDate, genres, primary_verticals: primaryVerticals, metric_type: 1 },
  })
  const overview = await fetchJson(page, `${ITEM_ANALYSIS_BASE}/overview`, {
    method: 'POST',
    body: { start_date: startDate, end_date: endDate, genres, primary_verticals: primaryVerticals },
  })
  return {
    window: { startDate, endDate },
    primaryVerticals,
    performance: performance.ok ? parseItemPerformance(performance.json) : new Map(),
    performanceError: performance.ok ? null : 'item_performance_failed',
    overview: overview.ok ? overview.json : null,
    overviewError: overview.ok ? null : 'overview_failed',
  }
}

/**
 * 打开作品详情页（带退避重试）。
 *
 * 在真网络 + 单页应用下 `page.goto` 会因两类**瞬时**故障失败：
 *   1. 网络抖动：`net::ERR_NETWORK_CHANGED` 等，页面落到 `chrome-error://chromewebdata/`；
 *   2. 客户端路由抢占：`interrupted by another navigation to <上一部作品的 URL>`。
 * 二者都会让页面停在未结束的导航上。**不重试的后果是雪崩**：上一部作品的导航一直
 * 没结束，后续每部作品的 `goto` 都被它打断，一次抖动会把整轮采集打成大面积失败
 * （实测 1 次网络抖动 → 20/25 作品失败）。这里退避重试，并尽量等页面稳定下来。
 */
async function gotoWorkDetail(page, workId, timeoutMs, attempts = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(WORK_DETAIL_URL(workId), { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      return
    } catch (error) {
      lastError = error
      if (attempt >= attempts) break
      // 尽力等待上一次导航收尾；已经停在错误页时这里会立刻返回，不会阻塞。
      if (typeof page.waitForLoadState === 'function') {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
      }
      await sleep(500 * 2 ** (attempt - 1))
    }
  }
  throw lastError
}

/** 单稿通道采集：优先响应拦截，缺失项用页面内 fetch 兜底。 */
export async function collectWorkDetail(page, workId, { timeoutMs = 25_000, onTarget = null } = {}) {
  const captured = {}
  const listener = response => {
    const url = response.url()
    for (const [key, fragment] of Object.entries(DETAIL_TARGETS)) {
      if (!url.includes(fragment) || captured[key]) continue
      response.text().then(text => {
        const json = parseJsonPreservingIds(text)
        if (json !== null) {
          captured[key] = json
          if (onTarget) onTarget(key)
        }
      }).catch(() => {})
    }
  }
  page.on('response', listener)
  try {
    await gotoWorkDetail(page, workId, timeoutMs)
    await page.waitForTimeout(3000)
    for (const label of ['流量分析', '观众分析']) {
      const clicked = await clickByText(page, label)
      if (clicked) await page.waitForTimeout(1500)
    }
    await page.waitForTimeout(1500)
  } finally {
    page.off('response', listener)
  }

  // 页面内 fetch 兜底：拦截漏取（低播放/未点开 tab）时补齐。
  const fallback = {
    compare: `${ITEM_COMPARE_PATH}?item_id=${workId}&selected_metric_count=2`,
    source: `${PLAY_SOURCE_PATH}?item_id=${workId}`,
    progress: `${PROGRESS_PATH}?item_id=${workId}`,
    search: `${SEARCH_KEYWORD_PATH}?item_id=${workId}`,
    portrait: `${PORTRAIT_PATH}?item_id=${workId}`,
    mget: `${ITEM_MGET_PATH}?ids=${workId}&fields=${ITEM_MGET_FIELDS}`,
  }
  const endpoints = { source: 'source', search: 'search', portrait: 'portrait', progress: 'progress', mget: 'mget' }
  for (const [key, path] of Object.entries(fallback)) {
    if (captured[key]) continue
    const result = await fetchJson(page, path)
    if (result.ok) {
      captured[key] = result.json
      if (onTarget) onTarget(`${key}:fallback`)
    }
  }
  const compare = captured.compare
  const compareParsed = parseItemCompare(compare)
  if (compareParsed.lowPlay && compareParsed.statusCode === LOW_PLAY_STATUS_CODE) {
    // 低播放：记录原因，不抛错，不阻塞该作品其余字段。
    compareParsed.lowPlayReason = 'below_min_view'
  }
  return {
    endpointsSeen: Object.keys(endpoints).filter(key => captured[key]).concat(compare ? ['compare'] : []),
    compare: compareParsed,
    source: captured.source ? parsePlaySource(captured.source) : null,
    portrait: captured.portrait ? parsePortrait(captured.portrait) : null,
    search: captured.search ? parseSearchKeywords(captured.search) : null,
    progress: captured.progress ? parseProgressAnalysis(captured.progress) : null,
    mget: captured.mget ? parseItemMget(captured.mget) : null,
  }
}

/** 评论热词：成功（含空数组）与请求失败严格区分。 */
export async function collectHotword(page, workId) {
  const result = await fetchJson(page, `${WORD_CLOUD_PATH}?item_id=${workId}&mcn_type=0`)
  if (!result.ok) return { status: 'unavailable', statusCode: null, words: [], error: result.error || 'request_failed' }
  return parseWordCloud(result.json)
}

/** 账号资料（昵称/粉丝数/头像），页面同源 fetch。 */
export async function collectAccountProfile(page) {
  const result = await fetchJson(page, USER_INFO_PATH)
  if (!result.ok || !result.json || typeof result.json !== 'object') return null
  const user = result.json.user || result.json.data || result.json
  if (!user || typeof user !== 'object') return null
  const accountId = String(user.sec_uid || user.uid || user.user_id || '').trim()
  if (!accountId) return null
  return {
    accountId,
    nickname: user.nickname || user.name || null,
    // avatar_uri 可能是 {uri,url_list} 图集对象：经统一标准化后只透出合法 http(s) 字符串。
    // 候选清单与 session.readAccountProfile 保持一致（同输入同输出，见 test/avatar.test.mjs）。
    avatar: normalizeAvatarUrl(firstPresent(user.avatar_uri, user.avatar_url, user.avatarUrl, user.avatar)),
    fanCount: Number(user.follower_count ?? user.fans_count ?? NaN) || null,
  }
}

function firstPresent(...values) {
  for (const value of values) if (value !== undefined && value !== null) return value
  return null
}

/**
 * 采集账号全部作品（列表 + 逐作品分析），产出可直接入库的载荷。
 *
 * @returns {Promise<{works: object[], listComplete: boolean, expectedWorkCount: number,
 *   failures: object[], pages: object[], listReason: string|null}>}
 */
export async function collectAccountWorks(page, {
  maxPages = MAX_PAGES_LIMIT,
  observedAt = new Date().toISOString(),
  days = 30,
  onProgress = null,
  detailOptions = {},
  workListOptions = {},
} = {}) {
  await page.goto(WORK_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const list = await collectWorkList(page, { maxPages, ...workListOptions })
  if (list.works.length > MAX_EXPECTED_WORK_COUNT) {
    // 超出 tools 侧 expectedWorkCount 上限：此时无论怎么采集都不可能诚实结算完成，
    // 因此在展开逐稿详情（耗时最长的一段）之前就中止。
    throw new Error('expected_work_count_out_of_range')
  }
  const profile = await collectAccountProfile(page)

  let performance = new Map()
  try {
    const analysis = await collectItemAnalysis(page, { days })
    performance = analysis.performance
  } catch {
    // 批量分析失败不影响列表与单稿字段；后续按缺口处理。
    performance = new Map()
  }

  const payloads = []
  const failures = []
  let index = 0
  for (const work of list.works) {
    index += 1
    if (onProgress) onProgress({ workId: work.work_id, index, total: list.works.length })
    try {
      const detail = await collectWorkDetail(page, work.work_id, detailOptions)
      const hotword = await collectHotword(page, work.work_id)
      payloads.push(buildWorkPayload({
        work,
        performance: performance.get(work.work_id) || null,
        compare: detail.compare,
        source: detail.source,
        portrait: detail.portrait,
        search: detail.search,
        progress: detail.progress,
        mget: detail.mget,
        hotword,
        observedAt,
      }))
    } catch (error) {
      // 单作品失败只记录该作品，不阻塞其余作品。
      failures.push({ workId: work.work_id, reason: safeReason(error) })
    }
  }

  return {
    works: payloads,
    failures,
    pages: list.pages,
    listComplete: list.listComplete,
    listReason: list.reason,
    expectedWorkCount: list.works.length,
    profile,
  }
}

async function clickByText(page, text) {
  try {
    const handle = await page.evaluate(needle => {
      const nodes = [...document.querySelectorAll('div,span,button,a,li')]
      const target = nodes.find(node => node.children.length === 0 && (node.textContent || '').trim() === needle)
      if (!target) return false
      target.click()
      return true
    }, text)
    return Boolean(handle)
  } catch {
    return false
  }
}

function yyyymmdd(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function safeReason(error) {
  if (error && typeof error.code === 'string') return error.code
  if (error && typeof error.name === 'string') return error.name.slice(0, 64)
  return 'work_collect_failed'
}
