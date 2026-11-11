// 视频号助手接口解析器（设备端，页面上下文同源响应）。
//
// 契约来源：docs/1109/wx 开发实施文档 §5（接口契约）、§15（时间序列与日期映射，
// 规范性）、阶段 0 脱敏 fixtures（test/fixtures/）。
// 关键口径：
// - 长数字 ID 全链路字符串（objectId 官方已是字符串，仍防御性解析）；
// - dataByFanstype 只取 fansType=1「不限」，不保存粉丝/非粉丝拆分（§1.3）；
// - 未知 tabType 不并入 0：sourceKey = unknown_{tabType}，并记按日缺口（§5.5）；
// - 时间序列数组长度必须等于 (endTs-startTs)/86400+1；基础互动指标（browse/like/
//   comment/forward/fav）长度异常 → 整窗 TIME_SERIES_LENGTH_MISMATCH 拒绝；扩展
//   指标（ringset/snscover/statusref/forwardAggregation/follow/wecomLinkClick/
//   wecomContactAdd）按字段级缺口降级，不拒绝窗口（§15.1.1）；
// - daily_* 全部为当日增量；缺失不补 0。

import { SessionInvalidError } from './session-errors.js'

// ---------------------------------------------------------------------------
// 时间与语义日（§15.1）：全部 Asia/Shanghai 自然日
// ---------------------------------------------------------------------------

const SHANGHAI_OFFSET_SECONDS = 8 * 3600

/** 上海自然日（YYYY-MM-DD）→ 当日零点的秒级时间戳（数字）。 */
export function shanghaiDayStartTs(dayIso) {
  const ms = Date.parse(`${dayIso}T00:00:00+08:00`)
  if (Number.isNaN(ms)) throw new Error(`invalid_day:${dayIso}`)
  return Math.floor(ms / 1000)
}

/** 秒级时间戳 → 上海自然日（YYYY-MM-DD）。 */
export function shanghaiDayFromTs(tsSeconds) {
  const shifted = new Date((Number(tsSeconds) + SHANGHAI_OFFSET_SECONDS) * 1000)
  return shifted.toISOString().slice(0, 10)
}

/** 当前上海时间的最新完整日（昨天；当天未收盘不入日表，§15.1.4）。 */
export function latestCompletedDay(now = new Date()) {
  // 兼容函数/数字时间戳/Date 三种时钟注入形态。
  const moment = typeof now === 'function' ? now() : now
  const ms = moment instanceof Date ? moment.getTime() : Number(moment)
  const shifted = new Date(ms + SHANGHAI_OFFSET_SECONDS * 1000)
  shifted.setUTCDate(shifted.getUTCDate() - 1)
  return shifted.toISOString().slice(0, 10)
}

/** 闭区间窗口期望点数（§15.1.6）。 */
export function expectedSeriesLength(startTs, endTs) {
  return Math.floor((Number(endTs) - Number(startTs)) / 86400) + 1
}

/** 公共请求包装（§5.1）：timestamp 毫秒字符串 + scene=7。 */
export function commonRequestFields({ finderId = '', now = () => Date.now() } = {}) {
  return {
    timestamp: String(now()),
    _log_finder_uin: '',
    _log_finder_id: finderId,
    rawKeyBuff: '',
    pluginSessionId: null,
    scene: 7,
    reqScene: 7,
  }
}

/** 毫秒时间戳字符串（官方公共包装 timestamp 用，§5.1）。 */
export function toMillisTimestamp(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return null
  return String(Math.floor(value * 1000))
}

// ---------------------------------------------------------------------------
// 长数字安全 JSON 解析（objectId 官方已是字符串；防御历史形态的裸数字 ID）
// ---------------------------------------------------------------------------

const LONG_ID_KEYS_SOURCE = '(objectId|exportId|objectNonce|finderUsername)'

/** 先取文本、给长数字 ID 加引号再解析，避免 JSON.parse 舍入 16 位以上整数。 */
export function parseJsonPreservingIds(text) {
  if (typeof text !== 'string') return null
  let candidate = text
  try {
    candidate = candidate.replace(
      new RegExp(`${LONG_ID_KEYS_SOURCE}"\\s*:\\s*(\\d{16,})`, 'g'),
      '$1":"$2"',
    )
  } catch {
    candidate = text
  }
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// auth_data：账号资料与会话探活（§5.2）
// ---------------------------------------------------------------------------

/** 未登录/会话失效判定：errCode 非 0 且带特定 errMsg，或 data.finderUser 缺失。 */
export function isAuthSessionInvalid(payload) {
  if (!payload || typeof payload !== 'object') return true
  const errCode = payload.errCode
  if (Number(errCode) !== 0) return true
  const user = payload.data && payload.data.finderUser
  return !user || typeof user !== 'object' || !user.finderUsername
}

/**
 * 解析 auth_data 响应：读不出 finderUsername 抛 SessionInvalidError（§8.3 登录
 * 判定与 §8.4 探活共用：只有真正取到账号标识才算会话有效）。
 */
export function parseAuthData(payload) {
  if (isAuthSessionInvalid(payload)) {
    throw new SessionInvalidError(payload && payload.errMsg ? String(payload.errMsg) : 'auth_data_unavailable')
  }
  const user = payload.data.finderUser
  return {
    accountId: String(user.finderUsername),
    nickname: textOrNull(user.nickname),
    avatar: urlOrNull(user.headImgUrl),
    fansCount: intOrNull(user.fansCount),
    feedsCount: intOrNull(user.feedsCount),
    isMasterFinder: typeof user.isMasterFinder === 'boolean' ? user.isMasterFinder : null,
  }
}

// ---------------------------------------------------------------------------
// statistic/post_list：全量作品列表（§5.3）
// ---------------------------------------------------------------------------

/** 单作品字段映射（§5.3）。缺失字段一律 null（NULL ≠ 0）。 */
export function parsePostListItem(item) {
  if (!item || typeof item !== 'object') return null
  const workId = textOrNull(item.objectId)
  if (!workId) return null
  const media = Array.isArray(item.desc && item.desc.media) && item.desc.media[0] ? item.desc.media[0] : {}
  const shortTitle = Array.isArray(item.desc && item.desc.shortTitle) && item.desc.shortTitle[0]
    ? item.desc.shortTitle[0].shortTitle
    : null
  const createTime = Number(item.createTime)
  return {
    workId,
    exportId: textOrNull(item.exportId),
    title: textOrNull(shortTitle),
    description: textOrNull(item.desc && item.desc.description),
    // 封面只收 http(s) URL：官方该字段在部分账号上返回错误文本（真机 2026-11-11
    // 实测 49/50 为 "Operation failed."），非 URL 一律置 null，不把脏文本入库。
    coverUrl: urlOrNull(media.coverUrl),
    publishTime: Number.isFinite(createTime) && createTime > 0 ? new Date(createTime * 1000).toISOString() : null,
    mediaType: intOrNull(media.mediaType),
    durationS: intOrNull(media.videoPlayLen),
    width: intOrNull(media.width),
    height: intOrNull(media.height),
    visibility: visibilityOf(item),
    playCount: intOrNull(item.readCount),
    likeCount: intOrNull(item.likeCount),
    favoriteCount: intOrNull(item.favCount),
    commentCount: intOrNull(item.commentCount),
    forwardCount: intOrNull(item.forwardCount),
    shareCount: intOrNull(item.forwardAggregationCount),
    followCount: intOrNull(item.followCount),
    wecomLinkClickCount: intOrNull(item.wecomLinkClickCount),
    wecomLinkClickUv: intOrNull(item.wecomLinkClickUv),
    wecomContactAddCount: intOrNull(item.wecomContactAddCount),
    wecomContactAddUv: intOrNull(item.wecomContactAddUv),
    ringsetCount: intOrNull(item.ringsetCount),
    statusCoverCount: intOrNull(item.snscoverCount),
    statusRefCount: intOrNull(item.statusrefCount),
    completionRatePct: ratioPct(item.fullPlayRate),
    avgPlayDurationS: numberOrNull(item.avgPlayTimeSec),
    fastFlipRatePct: ratioPct(item.fastFlipRate),
    yesterdayPlayCount: intOrNull(item.yesterdayReadCount),
    isOriginal: boolOrNull(item.originalInfo && item.originalInfo.isDeclared),
  }
}

function visibilityOf(item) {
  const disabled = item.disableInfo && item.disableInfo.isDisabled
  if (disabled === true) return 'disabled'
  const visibleType = intOrNull(item.visibleType)
  if (visibleType === null) return 'active'
  return visibleType === 0 ? 'active' : `visible_${visibleType}`
}

/**
 * 解析 post_list 一页（§5.3 完整性规则）：
 * - totalCount 为期望数；objectId 去重由 collector 层跨页维护；
 * - 会话失效（errCode 非 0 且 errMsg 指向登录）抛 SessionInvalidError；
 * - data.list 缺失/结构异常视为失败（count=null），由调用方标记列表不完整。
 */
export function parsePostListPage(payload) {
  if (!payload || typeof payload !== 'object') return { works: [], totalCount: null, rawCount: 0 }
  const errCode = Number(payload.errCode)
  if (errCode !== 0 && !Number.isNaN(errCode)) {
    const message = String(payload.errMsg || '')
    if (/login|auth|session|登录/i.test(message)) throw new SessionInvalidError(message)
    throw new Error(`post_list_err_${errCode}`)
  }
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {}
  const list = Array.isArray(data.list) ? data.list : []
  const works = list.map(parsePostListItem).filter(Boolean)
  return {
    works,
    totalCount: intOrNull(data.totalCount),
    rawCount: list.length,
  }
}

// ---------------------------------------------------------------------------
// get_feed_lost_rate：单作品观众留存（§5.4）
// ---------------------------------------------------------------------------

export function parseFeedLostRate(payload) {
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : null
  if (!data) return null
  const items = Array.isArray(data.items) ? data.items : []
  const points = items
    .map(point => ({ second: intOrNull(point.sec), ratePct: ratioPct(point.rate) }))
    .filter(point => point.second !== null)
  return {
    videoDurationS: intOrNull(data.videoLen),
    maxLostRateSecond: intOrNull(data.maxLostRateSec),
    points,
  }
}

// ---------------------------------------------------------------------------
// feed_aggreagate / new_post_total_data 共用：dataByFanstype[fansType=1] 解析
// ---------------------------------------------------------------------------

// §15.1.1 指标分级。
export const CORE_METRICS = ['browse', 'like', 'comment', 'forward', 'fav']
export const EXTENDED_METRICS = [
  'ringset',
  'snscover',
  'statusref',
  'forwardAggregation',
  'follow',
  'wecomLinkClick',
  'wecomContactAdd',
]
const METRIC_FIELD_MAP = {
  browse: 'daily_play_count',
  like: 'daily_like_count',
  comment: 'daily_comment_count',
  forward: 'daily_forward_count',
  fav: 'daily_favorite_count',
  forwardAggregation: 'daily_share_count',
  follow: 'daily_follow_count',
  ringset: 'daily_ringset_count',
  snscover: 'daily_status_cover_count',
  statusref: 'daily_status_ref_count',
  wecomLinkClick: 'daily_wecom_link_click_count',
  wecomContactAdd: 'daily_wecom_contact_add_count',
}

// 来源映射（§5.5；15=PC微信 仅账号级实测样本，解析器两级通用支持）。
export const SOURCE_TYPE_NAMES = {
  999: '全部',
  3: '关注',
  8: '朋友♡',
  4: '推荐',
  6: '分享',
  16: '订阅号消息',
  20: '主页',
  25: '看一看',
  15: 'PC微信',
  0: '其他',
}

const SOURCE_KEY_MAP = {
  999: 'all',
  3: 'follow',
  8: 'friends',
  4: 'recommend',
  6: 'share',
  16: 'subscription',
  20: 'profile',
  25: 'kansikan',
  15: 'pc_wechat',
  0: 'other',
}

/** dataByFanstype[fansType=1]（不限）分组；缺失返回 null。 */
export function pickDefaultFanstypeGroup(payload) {
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : null
  const groups = data && Array.isArray(data.dataByFanstype) ? data.dataByFanstype : []
  const group = groups.find(item => Number(item && item.fansType) === 1)
  if (!group || typeof group !== 'object') return null
  const tabs = group.dataByTabtype
  return Array.isArray(tabs) ? tabs : typeof tabs === 'object' && tabs ? Object.values(tabs) : null
}

/** 单个来源 tab 的按日指标数组：{tabType, data:{metric: [字符串数字...]}}。 */
function parseSourceRow(tab) {
  if (!tab || typeof tab !== 'object') return null
  const tabType = intOrNull(tab.tabType)
  if (tabType === null) return null
  const data = tab.data && typeof tab.data === 'object' ? tab.data : {}
  const series = {}
  for (const [metric, field] of Object.entries(METRIC_FIELD_MAP)) {
    series[metric] = Array.isArray(data[metric]) ? data[metric] : null
  }
  return { tabType, series }
}

/**
 * 解析按日窗口（§15.1/§15.1.1 规范性）：
 * - 窗口 = [startTs, endTs] 闭区间，第 i 点对应 day = startTs + i*86400；
 * - 基础指标缺失/长度异常 → 抛 TIME_SERIES_LENGTH_MISMATCH（整窗拒绝）；
 * - 扩展指标缺失/空/长度异常 → 记按日字段缺口（not_exposed / FIELD_LENGTH_MISMATCH），
 *   不拒绝窗口；
 * - 未知 tabType → sourceKey=unknown_{tabType}，name=其他，并记 traffic_source 缺口。
 *
 * @returns {{ rows: object[], gaps: object[] }} rows: {day, daily_*, trafficSource?,
 *   dataGap?}；gaps: [{day, field, reason}] 按日字段缺口（已并入 rows[].dataGap）。
 */
export function parseDailySeries(payload, { startTs, endTs }) {
  const tabs = pickDefaultFanstypeGroup(payload)
  if (!tabs) throw new Error('TIME_SERIES_LENGTH_MISMATCH')
  const length = expectedSeriesLength(startTs, endTs)
  if (length < 1) throw new Error('INVALID_DAY_RANGE')

  const rows = tabs.map(parseSourceRow).filter(Boolean)
  if (!rows.length) throw new Error('TIME_SERIES_LENGTH_MISMATCH')

  // 基础指标分级校验：任一来源行的基础指标缺失/长度异常 → 整窗拒绝（§15.1.1）。
  for (const row of rows) {
    for (const metric of CORE_METRICS) {
      const series = row.series[metric]
      if (!series || series.length !== length) {
        throw new Error('TIME_SERIES_LENGTH_MISMATCH')
      }
    }
  }

  const unknownSources = []
  const allTab = rows.find(row => row.tabType === 999) || rows[0]
  const days = []
  for (let index = 0; index < length; index += 1) {
    const dayTs = Number(startTs) + index * 86400
    const day = shanghaiDayFromTs(dayTs)
    const row = { day }
    const dataGap = {}
    for (const [metric, field] of Object.entries(METRIC_FIELD_MAP)) {
      const isCore = CORE_METRICS.includes(metric)
      const series = allTab.series[metric]
      if (!isCore && (!series || series.length !== length)) {
        // 扩展指标字段级缺口：缺失/空 = not_exposed；长度不匹配 = FIELD_LENGTH_MISMATCH。
        dataGap[field] = {
          reason: series && series.length !== length ? 'FIELD_LENGTH_MISMATCH' : 'not_exposed',
        }
        continue
      }
      const raw = series[index]
      const value = intOrNull(typeof raw === 'string' ? raw.trim() : raw)
      if (value === null) {
        // 空值/非数字统一按缺口处理，不补 0（核心指标数组长度对但点位缺失同口径，
        // 与 fans_trend 一致；「缺失不补 0」口径不被空串短路架空）。
        dataGap[field] = { reason: 'not_exposed' }
        continue
      }
      row[field] = value
    }
    if (Object.keys(dataGap).length) row.dataGap = dataGap
    days.push(row)
  }

  // 来源分布（窗口聚合，取每日 play 的总量做 share 基数；仅保存规范行）。
  const sourceRows = []
  for (const row of rows) {
    const known = SOURCE_TYPE_NAMES[row.tabType]
    if (!known) unknownSources.push(row.tabType)
    let total = 0
    const series = row.series.browse
    for (let index = 0; index < length; index += 1) {
      const value = intOrNull(typeof series[index] === 'string' ? series[index].trim() : series[index])
      total += value === null ? 0 : value
    }
    sourceRows.push({
      sourceType: row.tabType,
      sourceKey: SOURCE_KEY_MAP[row.tabType] || `unknown_${row.tabType}`,
      name: known || '其他',
      playCount: total,
    })
  }

  const trafficSource = {
    window: { startDay: shanghaiDayFromTs(Number(startTs)), endDay: shanghaiDayFromTs(Number(endTs)) },
    rows: sourceRows,
  }
  if (unknownSources.length) {
    trafficSource.dataGap = { unknown_source_type: unknownSources.map(Number) }
  }
  return { rows: days, trafficSource }
}

// ---------------------------------------------------------------------------
// fans_trend：账号级关注者增长（§5.7/§15.4）
// ---------------------------------------------------------------------------

const FANS_METRICS = { add: 'follower_add_count', reduce: 'follower_reduce_count', netAdd: 'follower_net_count', total: 'follower_total_count' }

/**
 * 四指标均按核心校验（§15.1.1）：任一缺失/长度异常 → 整窗 TIME_SERIES_LENGTH_MISMATCH。
 * fansDataByTabtype 映射为 source_trend（结构 §17.3）。
 */
export function parseFansTrend(payload, { startTs, endTs }) {
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : null
  if (!data) throw new Error('TIME_SERIES_LENGTH_MISMATCH')
  const length = expectedSeriesLength(startTs, endTs)
  const series = {}
  for (const [metric] of Object.entries(FANS_METRICS)) {
    const values = Array.isArray(data[metric]) ? data[metric] : null
    if (!values || values.length !== length) throw new Error('TIME_SERIES_LENGTH_MISMATCH')
    series[metric] = values
  }
  const daily = []
  for (let index = 0; index < length; index += 1) {
    const day = shanghaiDayFromTs(Number(startTs) + index * 86400)
    const row = { day }
    const dataGap = {}
    for (const [metric, field] of Object.entries(FANS_METRICS)) {
      const value = intOrNull(String(series[metric][index] ?? '').trim() || null)
      if (value === null) {
        dataGap[field] = { reason: 'not_exposed' }
        continue
      }
      row[field] = value
    }
    if (Object.keys(dataGap).length) row.dataGap = dataGap
    daily.push(row)
  }
  // 关注者来源趋势（fansDataByTabtype，§15.4 按同一公式映射日期）。
  const sourceTrendRows = []
  const tabs = Array.isArray(data.fansDataByTabtype) ? data.fansDataByTabtype : []
  for (const tab of tabs) {
    if (!tab || typeof tab !== 'object') continue
    const tabType = intOrNull(tab.tabType)
    if (tabType === null) continue
    const dailyRows = []
    const tabData = tab.data && typeof tab.data === 'object' ? tab.data : {}
    const add = Array.isArray(tabData.add) ? tabData.add : []
    for (let index = 0; index < Math.min(add.length, length); index += 1) {
      const value = intOrNull(String(add[index] ?? '').trim() || null)
      if (value === null) continue
      dailyRows.push({ day: shanghaiDayFromTs(Number(startTs) + index * 86400), add: value })
    }
    sourceTrendRows.push({
      sourceType: tabType,
      sourceKey: SOURCE_KEY_MAP[tabType] || `unknown_${tabType}`,
      name: SOURCE_TYPE_NAMES[tabType] || '其他',
      daily: dailyRows,
    })
  }
  return {
    daily,
    sourceTrend: sourceTrendRows.length ? { rows: sourceTrendRows } : null,
  }
}

// ---------------------------------------------------------------------------
// fans_portrait：账号级画像（§5.8/§15.6；respJson 是 JSON 字符串需二次解析）
// ---------------------------------------------------------------------------

const PORTRAIT_NAME_MAP = {
  age_list: 'age',
  sex_list: 'gender',
  province_list: 'province',
  city_list: 'city',
  device_list: 'device',
}

/**
 * 解析画像：只入库五类聚合维度；官方新增维度不入库，只记
 * data_gap.fans_profile.unknown_metric（§5.8）。
 */
export function parseFansPortrait(payload) {
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : null
  const raw = data ? data.respJson : null
  let parsed = raw
  if (typeof raw === 'string') {
    parsed = parseJsonPreservingIds(raw)
    if (parsed === null) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
    }
  }
  const list = parsed && Array.isArray(parsed.metric_info_list) ? parsed.metric_info_list : []
  const result = { age: null, gender: null, province: null, city: null, device: null, dataGap: {} }
  const unknown = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const dimension = PORTRAIT_NAME_MAP[item.name]
    const values = Array.isArray(item.value) ? item.value : []
    const rows = values
      .map(entry => ({
        key: textOrNull(entry && entry.dim),
        label: textOrNull(entry && entry.dim),
        count: intOrNull(entry && entry.value),
      }))
      .filter(row => row.key !== null && row.count !== null)
    if (!dimension) {
      if (item.name) unknown.push(String(item.name))
      continue
    }
    if (rows.length) result[dimension] = rows
  }
  if (unknown.length) result.dataGap.fans_profile = { unknown_metric: unknown }
  return result
}

// ---------------------------------------------------------------------------
// 数值与文本工具（空值/非数字一律 null，不补 0）
// ---------------------------------------------------------------------------

export function intOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'boolean') return value ? 1 : 0
  const num = Number(String(value))
  return Number.isFinite(num) ? Math.trunc(num) : null
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/** 小数比率 → 0..100 百分比（§5 字段口径：fullPlayRate*100）；缺失/越界为 null。 */
export function ratioPct(value) {
  const num = numberOrNull(value)
  if (num === null) return null
  const pct = Math.round(num * 100 * 1e6) / 1e6
  return pct >= 0 && pct <= 100 ? pct : null
}

function textOrNull(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text : null
}

/** URL 字段：仅接受 http(s) 绝对地址（官方部分账号把封面字段填错误文本，不入库）。 */
export function urlOrNull(value) {
  const text = textOrNull(value)
  if (!text) return null
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : null
  } catch {
    return null
  }
}

function boolOrNull(value) {
  return typeof value === 'boolean' ? value : null
}
