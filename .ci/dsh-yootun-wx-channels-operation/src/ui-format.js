// 视频号工作台 UI 纯格式化函数（client.js 构建时内联；无 React/DOM 依赖）。
// 视觉与交互基准：docs/1109/wx/ui-demo.html（§9.0 Demo 是一期 UI 冻结基准）。

export const EMPTY = '—'

/** 缺失一律「—」，不显示 0 伪装（§9.2）。 */
export function fmt(value) {
  return value === null || value === undefined || value === '' ? EMPTY : String(value)
}

/** 数值列：可空数字 → 千分位或「—」；0 是真实值照常显示。 */
export function fmtCount(value) {
  if (value === null || value === undefined || value === '') return EMPTY
  const num = Number(value)
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : EMPTY
}

/** 比率列：0..100 数字 → 两位小数百分比或「—」。 */
export function fmtPct(value) {
  if (value === null || value === undefined || value === '') return EMPTY
  const num = Number(value)
  return Number.isFinite(num) ? `${num.toFixed(2)}%` : EMPTY
}

/** 时长：秒 → 「7.40 秒」或「—」。 */
export function fmtSeconds(value) {
  if (value === null || value === undefined || value === '') return EMPTY
  const num = Number(value)
  return Number.isFinite(num) ? `${num.toFixed(2)} 秒` : EMPTY
}

/** ISO 时间 → 本地展示（YYYY-MM-DD HH:mm）。 */
export function fmtDateTime(iso) {
  if (!iso) return EMPTY
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return String(iso)
  const pad = value => String(value).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/** 次数/人数 组合列：uv 缺失只显示次数，双缺失「—」（Demo pair 语义）。 */
export function fmtPair(count, uv) {
  if (count === null || count === undefined) return EMPTY
  if (uv === null || uv === undefined) return String(count)
  return `${count} / ${uv}`
}

/**
 * 作品摘要卡：播放量加权完播率（§9.2 口径，规范性）。
 * 仅对 completion 与 play 均非空的作品参与；分母 0 显示「—」。
 */
export function weightedCompletionRate(works) {
  let numerator = 0
  let denominator = 0
  for (const work of Array.isArray(works) ? works : []) {
    // Number(null) === 0 会把缺失伪装成真实零——先显式排除 null/undefined（§9.2）。
    const rate = work && work.completion_rate_pct !== null && work.completion_rate_pct !== undefined
      ? Number(work.completion_rate_pct) : null
    const play = work && work.play_count !== null && work.play_count !== undefined
      ? Number(work.play_count) : null
    if (rate !== null && Number.isFinite(rate) && play !== null && Number.isFinite(play)) {
      numerator += rate * play
      denominator += play
    }
  }
  return denominator > 0 ? Number(((numerator / denominator)).toFixed(2)) : null
}

/** 缺口作品数：当前值存在至少一个字段缺口的作品数（§9.2）。 */
export function gapWorkCount(works) {
  return (Array.isArray(works) ? works : []).filter(work => work && work.data_gap && Object.keys(work.data_gap).length > 0).length
}

/** 作品发布时间范围过滤（本地、只基于已入库数据）。range: 'all'|'7d'|'30d'。 */
export function filterWorksByRange(works, range, now = new Date()) {
  const cutoffDays = range === '7d' ? 7 : range === '30d' ? 30 : null
  if (!cutoffDays) return Array.isArray(works) ? [...works] : []
  const cutoff = now.getTime() - cutoffDays * 86400_000
  return (Array.isArray(works) ? works : []).filter(work => {
    const publish = work && work.publish_time ? new Date(work.publish_time).getTime() : Number.NaN
    return Number.isFinite(publish) && publish >= cutoff
  })
}

/** 作品排序（服务端字段名，本地排序同样只查已入库数据）。 */
export function sortWorks(works, sort, order) {
  const key = sort || 'publish_time'
  const direction = order === 'asc' ? 1 : -1
  return [...(Array.isArray(works) ? works : [])].sort((a, b) => {
    const av = a ? a[key] : undefined
    const bv = b ? b[key] : undefined
    if (av === bv) return 0
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv)) * direction
    }
    return (av - bv) * direction
  })
}

/** 来源分布行规范化：trafficSource JSON（§17.3）→ [{name, value}]，排除「全部」。 */
export function normalizeTrafficRows(trafficSource) {
  const rows = trafficSource && Array.isArray(trafficSource.rows) ? trafficSource.rows : []
  return rows
    .filter(row => row && row.sourceType !== 999)
    .map(row => ({ name: String(row.name || row.sourceKey), value: Number(row.playCount) || 0 }))
}

/** 留存行规范化：retention_trend（§17.3）→ [{s, v}]。 */
export function normalizeRetentionPoints(retentionTrend) {
  const points = retentionTrend && Array.isArray(retentionTrend.points) ? retentionTrend.points : []
  return points
    .filter(point => point && Number.isFinite(Number(point.second)))
    .map(point => ({ s: Number(point.second), v: Math.round(Number(point.rate_pct ?? 0)) }))
}

// 画像维度标签映射（真机 dim 驱动，2026-11-10；不臆造官方未暴露语义）。
const PROFILE_LABEL_MAPS = {
  gender: { 1: '男', 2: '女', unknow: '未知' },
  age: row => String(row.key || '').replace(/^fage_/, '').replace(/_/g, '-') + '岁',
  device: row => `设备 ${row.key}`,
}

/** 画像维度行规范化：[{key,label,count}] → [[label, count]]。
 * `@_all` 是官方"全部"汇总行（count=总数），不属于分布条目，排除；gender 的
 * 1/2 与 age 的 fage_* 按真机编码映射为友好标签；device 仅暴露 1/2 编码，
 * 显示"设备 1/2"不臆造语义；province/city 官方直接给中文名。 */
export function normalizeProfileRows(rows, dimension) {
  const map = dimension ? PROFILE_LABEL_MAPS[dimension] : null
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row && row.key && row.key !== '@_all' && row.key !== '@_all')
    .map(row => {
      let label = row.label || row.key
      if (typeof map === 'function') label = map(row)
      else if (map && map[String(row.key)] !== undefined) label = map[String(row.key)]
      return [label, Number(row.count) || 0]
    })
}

/** 关注者增长窗口聚合 → 指标卡四项（净增/新增/取消/总数）。 */
export function summarizeFansTrend(fansTrend) {
  const totals = fansTrend && fansTrend.totals ? fansTrend.totals : {}
  return [
    ['净增关注', totals.follower_net_count],
    ['新增关注', totals.follower_add_count],
    ['取消关注', totals.follower_reduce_count],
    // 时点值来自服务端 camelCase 键（tools queries.py followerTotalCount，review P1-1）。
    ['关注者总数', fansTrend ? fansTrend.followerTotalCount : null],
  ]
}

/** 全部视频指标窗口求和 → 指标卡（官方口径命名，§9.4）。 */
export function summarizeAccountMetrics(metrics) {
  const totals = metrics && metrics.totals ? metrics.totals : {}
  return [
    ['播放', totals.daily_play_count],
    ['喜欢', totals.daily_like_count],
    ['收藏', totals.daily_favorite_count],
    ['评论', totals.daily_comment_count],
    ['分享', totals.daily_share_count],
    ['转发聊天和朋友圈', totals.daily_forward_count],
    ['关注量', totals.daily_follow_count],
    ['设为铃声', totals.daily_ringset_count],
    ['设为状态', totals.daily_status_ref_count],
    ['设为朋友圈封面', totals.daily_status_cover_count],
  ]
}

/** 关注者总数趋势序列（窗口内逐日 total，用于折线图）。 */
export function fansTotalSeries(dailyRows) {
  return (Array.isArray(dailyRows) ? dailyRows : [])
    .filter(row => row && row.follower_total_count !== null && row.follower_total_count !== undefined)
    .map(row => Number(row.follower_total_count))
}
