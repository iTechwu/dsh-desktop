// 视频号助手采集引擎（设备端，页面上下文同源请求）。
//
// 关键约束（开发实施文档 §5/§8.4/§15）：
// - 所有接口都在**页面上下文**通过同源 fetch 调用（浏览器自动携带登录态）；CI/tools
//   侧绝不直连视频号；
// - 全量列表固定 startTime=0 + endTime=最新完整日零点（§5.3），pageSize=100；
// - 完整性以 totalCount + objectId 去重判定：唯一作品数等于 totalCount 才
//   listComplete=true；某页无新增 objectId 时停止（超页返回首批数据的防御，§1.3）；
// - 单作品详情串行（get_feed_lost_rate + feed_aggreagate），失败只记该作品缺口；
// - 账号级三接口（new_post_total_data / fans_trend / fans_portrait）失败只记
//   段落缺口，绝不覆盖已有数据为空白；
// - 日序列请求 startTs=发布日零点（不能用原始发布时间，§5.5/补充调研 §7）。

import {
  commonRequestFields,
  latestCompletedDay,
  parseAuthData,
  parseDailySeries,
  parseFansPortrait,
  parseFansTrend,
  parseFeedLostRate,
  parseJsonPreservingIds,
  parsePostListPage,
  shanghaiDayFromTs,
  shanghaiDayStartTs,
} from './parse.js'
import { SessionInvalidError } from './session-errors.js'

export const ASSISTANT_ORIGIN = 'https://channels.weixin.qq.com/'
export const AUTH_DATA_PATH = '/cgi-bin/mmfinderassistant-bin/auth/auth_data'
export const POST_LIST_PATH = '/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/post_list'
export const FEED_AGGREGATE_PATH = '/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/feed_aggreagate_data_by_tab_type'
export const FEED_LOST_RATE_PATH = '/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/get_feed_lost_rate'
export const NEW_POST_TOTAL_PATH = '/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/new_post_total_data'
export const FANS_TREND_PATH = '/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/fans_trend'
export const FANS_PORTRAIT_PATH = '/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/fans_portrait'

export const PAGE_SIZE = 100
export const MAX_PAGES = 50
export const PAGE_INTERVAL_MS = 600
export const DETAIL_INTERVAL_MS = 300
// 单作品按日序列拆分窗口（§15.1.2.4）：老作品序列 >2300 行时按 180 天拆分。
export const DETAIL_BLOCK_DAYS = 180
// 批次上限（§15.1.2）：works ≤20、sum(dailyMetrics) ≤3000、单作品 ≤2300 行。
export const MAX_BATCH_WORKS = 20
export const MAX_BATCH_DAILY_ROWS = 3000
export const MAX_SINGLE_WORK_DAILY_ROWS = 2300

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 页面上下文同源 POST fetch（浏览器自动携带登录态与签名）。 */
export async function postJson(page, url, body) {
  const raw = await page.evaluate(async request => {
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      return { status: response.status, text: await response.text() }
    } catch (error) {
      return { status: 0, text: '', error: String(error && error.message ? error.message : error) }
    }
  }, { url, body })
  if (!raw || typeof raw !== 'object' || raw.status !== 200) {
    return { ok: false, status: raw ? raw.status : 0, json: null }
  }
  const json = parseJsonPreservingIds(raw.text)
  return { ok: json !== null, status: 200, json }
}

/** auth_data 探活并读取账号资料（finderId 空串用于登录后首次读取，§5.1）。 */
export async function fetchAuthData(page, { finderId = '', now = Date.now } = {}) {
  const body = commonRequestFields({ finderId, now })
  const result = await postJson(page, AUTH_DATA_PATH, body)
  if (!result.ok) {
    if (result.status === 200) throw new SessionInvalidError('auth_data_invalid_json')
    throw new Error(`auth_data_http_${result.status}`)
  }
  return parseAuthData(result.json)
}

/**
 * 全量作品列表采集（§5.3 完整性规则）。
 *
 * @returns {Promise<{works: object[], totalCount: number|null, listComplete: boolean,
 *   reason: string|null}>}
 */
export async function collectWorkList(page, {
  finderId,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
  intervalMs = PAGE_INTERVAL_MS,
  retries = 2,
  onPage = null,
  now = Date.now,
  sleep: sleepImpl = sleep,
} = {}) {
  const endDay = latestCompletedDay(now)
  const endTs = shanghaiDayStartTs(endDay)
  const collected = []
  const seen = new Set()
  let totalCount = null
  let listComplete = false
  let reason = null
  let stalePage = false

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const body = {
      pageSize,
      currentPage: pageNumber,
      sort: 0,
      order: 0,
      startTime: 0,
      endTime: endTs,
      ...commonRequestFields({ finderId, now }),
    }
    let result = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      result = await postJson(page, POST_LIST_PATH, body)
      if (result.ok) break
      if (attempt < retries) await sleepImpl(Math.min(8000, 1000 * 2 ** attempt))
    }
    if (!result || !result.ok) {
      // 某页失败：列表不完整，绝不按空列表结算（§8.4）。
      reason = result && result.status ? `page_http_${result.status}` : 'page_request_failed'
      break
    }
    let parsed
    try {
      parsed = parsePostListPage(result.json)
    } catch (error) {
      if (error instanceof SessionInvalidError && collected.length) error.partialListWorks = collected
      throw error
    }
    if (totalCount === null) totalCount = parsed.totalCount
    // 超页防御（补充调研 §1.3）：某页没有新增 objectId 时停止，不以「非空页」续翻。
    let added = 0
    for (const work of parsed.works) {
      if (seen.has(work.workId)) continue
      seen.add(work.workId)
      collected.push(work)
      added += 1
    }
    if (added === 0) {
      stalePage = true
      break
    }
    if (onPage) onPage({ pageNumber, rawCount: parsed.rawCount, added, collected: collected.length })
    if (totalCount !== null && collected.length >= totalCount) break
    // 官方某页返回数不足 pageSize 不代表列表结束（totalCount 驱动续翻，§5.3 规则 3）；
    // 仅在 totalCount 不可得时以短页作为兜底终止条件。
    if (totalCount === null && parsed.rawCount < pageSize) break
    if (pageNumber < maxPages) await sleepImpl(intervalMs)
  }

  if (!stalePage && reason === null && totalCount !== null && collected.length >= totalCount) {
    listComplete = true
  } else if (stalePage && totalCount !== null && collected.length >= totalCount) {
    // 超页但数量已达标（官方末页重复返回首批）：数量足够即完整。
    listComplete = true
  } else if (reason === null) {
    // 超页停止但数量不足 / 达到 maxPages 上限 / totalCount 不可得：唯一作品数
    // 不足 totalCount，统一 LIST_INCOMPLETE（§5.3 规则 6）。
    reason = 'LIST_INCOMPLETE'
  }
  return { works: collected, totalCount, listComplete, reason, endDay }
}

/** 单作品详情：留存 + 按日聚合（串行调用；失败抛错由调用方记该作品缺口）。 */
export async function collectWorkDetail(page, {
  finderId,
  work,
  retries = 1,
  intervalMs = DETAIL_INTERVAL_MS,
  now = Date.now,
  sleep: sleepImpl = sleep,
} = {}) {
  const endDay = latestCompletedDay(now)
  const endTs = shanghaiDayStartTs(endDay)
  // startTs 必须用发布日零点（原始发布时间会业务失败，补充调研 §7）；发布日取
  // **上海语义日**（publishTime 是 UTC ISO 字符串，直接 slice(0,10) 会早一天）。
  const publishDayIso = work.publishTime
    ? shanghaiDayFromTs(Math.floor(new Date(work.publishTime).getTime() / 1000))
    : null
  const fallbackStart = shanghaiDayStartTs(endDay) - (DETAIL_BLOCK_DAYS - 1) * 86400
  const startTs = publishDayIso ? shanghaiDayStartTs(publishDayIso) : fallbackStart

  // 老作品序列超长：按 180 天块拆分（§15.1.2.4），每块独立校验与入库。
  const totalDays = Math.floor((endTs - startTs) / 86400) + 1
  const blocks = []
  if (totalDays <= DETAIL_BLOCK_DAYS) {
    blocks.push({ startTs, endTs })
  } else {
    let cursor = startTs
    while (cursor <= endTs) {
      const blockEnd = Math.min(cursor + (DETAIL_BLOCK_DAYS - 1) * 86400, endTs)
      blocks.push({ startTs: cursor, endTs: blockEnd })
      cursor = blockEnd + 86400
    }
  }

  const lostRate = await withRetry(
    () => postJson(page, FEED_LOST_RATE_PATH, {
      feedId: work.workId,
      ...commonRequestFields({ finderId, now }),
    }),
    { retries, sleepImpl },
  )
  const retention = lostRate.ok ? parseFeedLostRate(lostRate.json) : null

  const dailyMetrics = []
  const blockSources = []
  for (const block of blocks) {
    const result = await withRetry(
      () => postJson(page, FEED_AGGREGATE_PATH, {
        startTs: String(block.startTs),
        endTs: String(block.endTs),
        interval: 3,
        feedId: work.workId,
        ...commonRequestFields({ finderId, now }),
      }),
      { retries, sleepImpl },
    )
    if (!result.ok) {
      throw new Error(result.status ? `aggregate_http_${result.status}` : 'aggregate_request_failed')
    }
    const parsed = parseDailySeries(result.json, { startTs: block.startTs, endTs: block.endTs })
    dailyMetrics.push(...parsed.rows)
    blockSources.push(parsed.trafficSource)
    await sleepImpl(intervalMs)
  }
  // 作品级来源分布（§17.3 语义：窗口=发布日至今的完整聚合）：
  // 单块直接用；多块按 sourceKey 合并 playCount 求和、window 取发布日至末日。
  let trafficSource = null
  if (blockSources.length === 1) {
    trafficSource = blockSources[0]
  } else if (blockSources.length > 1) {
    const merged = new Map()
    for (const source of blockSources) {
      for (const row of source && source.rows ? source.rows : []) {
        const existing = merged.get(row.sourceKey)
        if (existing) existing.playCount += row.playCount
        else merged.set(row.sourceKey, { ...row })
      }
    }
    if (merged.size) {
      trafficSource = {
        window: { startDay: publishDayIso || shanghaiDayFromTs(startTs), endDay },
        rows: [...merged.values()],
      }
    }
  }
  // 日行级来源只挂最后一块的最后一行（snapshot 末日行携带最新块窗口，避免
  // 2274 行重复大 JSON；§16.4 dailyMetrics.trafficSource 契约保留）。
  if (dailyMetrics.length && blockSources.length) {
    dailyMetrics[dailyMetrics.length - 1].trafficSource = blockSources[blockSources.length - 1]
  }
  return { retentionTrend: retention, dailyMetrics, trafficSource }
}

/** 账号级全部视频聚合（§5.6：初始回填按 180 天分块；日常至少覆盖近 30 天+昨日环比）。 */
export async function collectAccountMetrics(page, {
  finderId,
  startDay = null,
  endDay = null,
  retries = 1,
  now = Date.now,
  sleep: sleepImpl = sleep,
} = {}) {
  const resolvedEnd = endDay || latestCompletedDay(now)
  const resolvedStart = startDay || dayOffset(resolvedEnd, -29)
  const startTs = shanghaiDayStartTs(resolvedStart)
  const endTs = shanghaiDayStartTs(resolvedEnd)
  const result = await withRetry(
    () => postJson(page, NEW_POST_TOTAL_PATH, {
      startTs: String(startTs),
      endTs: String(endTs),
      interval: 3,
      ...commonRequestFields({ finderId, now }),
    }),
    { retries, sleepImpl },
  )
  if (!result.ok) {
    throw new Error(result.status ? `account_metrics_http_${result.status}` : 'account_metrics_request_failed')
  }
  const parsed = parseDailySeries(result.json, { startTs, endTs })
  return { startDay: resolvedStart, endDay: resolvedEnd, ...parsed }
}

/** 账号级关注者增长（§5.7：按平台保留历史全量回填，超长窗口由调用方分块）。 */
export async function collectFansTrend(page, {
  finderId,
  startDay,
  endDay,
  retries = 1,
  now = Date.now,
  sleep: sleepImpl = sleep,
} = {}) {
  const startTs = shanghaiDayStartTs(startDay)
  const endTs = shanghaiDayStartTs(endDay)
  const result = await withRetry(
    () => postJson(page, FANS_TREND_PATH, {
      startTs: String(startTs),
      endTs: String(endTs),
      interval: 3,
      ...commonRequestFields({ finderId, now }),
    }),
    { retries, sleepImpl },
  )
  if (!result.ok) {
    throw new Error(result.status ? `fans_trend_http_${result.status}` : 'fans_trend_request_failed')
  }
  const parsed = parseFansTrend(result.json, { startTs, endTs })
  return { startDay, endDay, ...parsed }
}

/** 账号级关注者画像（§5.8：当前时点快照，day=latestCompletedDay）。 */
export async function collectFansPortrait(page, { finderId, retries = 1, now = Date.now, sleep: sleepImpl = sleep } = {}) {
  const result = await withRetry(
    () => postJson(page, FANS_PORTRAIT_PATH, commonRequestFields({ finderId, now })),
    { retries, sleepImpl },
  )
  if (!result.ok) {
    throw new Error(result.status ? `fans_portrait_http_${result.status}` : 'fans_portrait_request_failed')
  }
  const parsed = parseFansPortrait(result.json)
  return { day: latestCompletedDay(now), ...parsed }
}

// ---------------------------------------------------------------------------
// 批次切分（§15.1.2，规范性）：设备端先行切分，服务端复核 PAYLOAD_TOO_LARGE 兜底
// ---------------------------------------------------------------------------

/**
 * 按上限切分作品批次：发布日从旧到新排序、贪心装填（单批 works ≤20、
 * sum(dailyMetrics) ≤3000、单作品 ≤2300——超过的老作品已在 detail 阶段按
 * 180 天块拆分，理论不可达，此为防御性再拆）。
 *
 * @returns {Array<{batchNo: number, works: object[], totalDailyMetricRows: number}>}
 */
export function splitIngestBatches(works, {
  maxWorks = MAX_BATCH_WORKS,
  maxRows = MAX_BATCH_DAILY_ROWS,
  maxSingle = MAX_SINGLE_WORK_DAILY_ROWS,
} = {}) {
  const sorted = [...works].sort((a, b) => (a.publishTime || '') < (b.publishTime || '') ? -1 : 1)
  const batches = []
  let current = []
  let currentRows = 0
  let batchNo = 0
  const flush = () => {
    if (!current.length) return
    batchNo += 1
    batches.push({ batchNo, works: current, totalDailyMetricRows: currentRows })
    current = []
    currentRows = 0
  }
  for (const work of sorted) {
    let daily = Array.isArray(work.dailyMetrics) ? work.dailyMetrics : []
    // 防御性再拆：超过单作品上限的时间序列按 180 天块对半递拆（正常已在 detail 拆好）。
    while (daily.length > maxSingle) {
      const head = daily.slice(0, maxSingle)
      daily = daily.slice(maxSingle)
      flush()
      batchNo += 1
      batches.push({
        batchNo,
        works: [{ ...work, dailyMetrics: head }],
        totalDailyMetricRows: head.length,
      })
    }
    const workPayload = { ...work, dailyMetrics: daily }
    const rows = daily.length
    if (current.length >= maxWorks || (currentRows + rows > maxRows && current.length)) {
      flush()
    }
    current.push(workPayload)
    currentRows += rows
  }
  flush()
  return batches
}

async function withRetry(operation, { retries = 1, sleepImpl = sleep } = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await operation()
    if (result && result.ok) return result
    lastError = result
    if (attempt < retries) await sleepImpl(Math.min(4000, 800 * 2 ** attempt))
  }
  return lastError
}

function dayOffset(dayIso, offset) {
  const ms = Date.parse(`${dayIso}T00:00:00+08:00`) + offset * 86400_000
  return new Date(ms).toISOString().slice(0, 10)
}
