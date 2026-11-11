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

/** 表头排序默认态：发布时间降序（进入页面即最近发布在前）。
 * 与抖音 DEFAULT_SORT_STATE（接口原序）不同：视频号现有默认体验是发布时间倒序，保留。 */
export const DEFAULT_SORT_STATE = { key: 'publish_time', direction: 'desc' }

/** 表头排序三态状态机（对齐抖音 nextSortState）：点击新列 → desc；
 * 同列 desc → asc；asc → 回默认态（发布时间降序）。 */
export function nextSortState(currentState, columnKey) {
  if (!currentState || currentState.key !== columnKey || currentState.direction === 'default') {
    return { key: columnKey, direction: 'desc' }
  }
  if (currentState.direction === 'desc') return { key: columnKey, direction: 'asc' }
  return { ...DEFAULT_SORT_STATE }
}

/** 作品排序（表头排序态 {key, direction}；本地排序只查已入库数据）：
 * 缺失值恒沉底且不参与方向翻转；稳定排序保持接口原序。 */
export function sortWorks(works, sortState) {
  const rows = Array.isArray(works) ? [...works] : []
  if (!sortState || !sortState.key || sortState.direction === 'default') return rows
  const { key, direction } = sortState
  const sign = direction === 'asc' ? 1 : -1
  return rows
    .map((work, index) => ({ work, index }))
    .sort((left, right) => {
      const av = left.work ? left.work[key] : undefined
      const bv = right.work ? right.work[key] : undefined
      const aMissing = av === null || av === undefined
      const bMissing = bv === null || bv === undefined
      if (aMissing && bMissing) return left.index - right.index
      if (aMissing) return 1
      if (bMissing) return -1
      if (av === bv) return left.index - right.index
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * sign
      }
      return (av - bv) * sign
    })
    .map(entry => entry.work)
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

/**
 * 采集进度文案（数据形状由宿主 runner.js progressFromEvent 投影，对齐抖音
 * progressText 语义；wx 中文直出无文案字典）：
 * - work → 「采集进度 N/M」；batch_done → 「入库进度 i/j · s/e」；
 * - probing / list / account_level → 阶段提示；空/未知 → 「采集中…」。
 */
export function progressText(progress) {
  if (!progress || typeof progress !== 'object') return '采集中…'
  switch (progress.phase) {
    case 'probing': return '正在检查会话…'
    case 'list':
      return progress.collected
        ? `正在获取作品列表（已收集 ${progress.collected} 个）…`
        : '正在获取作品列表…'
    case 'work': return `采集进度 ${progress.index || 0}/${progress.total || 0}`
    case 'account_level': return '正在采集账号数据…'
    case 'batch_done':
      return `入库进度 ${progress.batchNo || 0}/${progress.totalBatches || 0} · ${progress.succeeded || 0}/${progress.expected || 0}`
    default: return '采集中…'
  }
}

/**
 * 批量运行中总进度行（对齐抖音 batchProgress 语义）：
 * probing → 「正在检查会话 i/n」；collecting → 「第 i/n 个账号」；终态返回 null。
 */
export function batchProgressText(batch) {
  if (!batch || !batch.phase || batch.phase === 'finished' || batch.phase === 'ready') return null
  const total = Array.isArray(batch.items) ? batch.items.length : 0
  if (!total) return null
  const index = Math.min(total, (batch.currentAccountIndex || 0) + 1)
  if (batch.phase === 'probing') return `正在检查会话 ${index}/${total}`
  if (batch.phase === 'collecting') return `第 ${index}/${total} 个账号`
  return null
}

/**
 * 批量未完成条目稳定原因 → 中文文案（对齐抖音 batchReasonKey 收敛原则：未知
 * 稳定码收敛为通用文案，绝不把原始错误码暴露给业务用户）。
 */
export function batchReasonText(reason) {
  if (!reason) return ''
  if (reason === 'session_required' || reason === 'session_expired') return '会话已过期，请重新扫码'
  // 正则而非字面量：客户端源码/产物不得出现该凭证字段名的连续字面量（凭证卫生契约）。
  if (/^storage.state_missing$/.test(reason)) return '缺少本机登录态，请重新扫码登录'
  if (reason === 'pending_account') return '待升级账号'
  if (reason === 'probe_failed') return '会话检测失败'
  if (reason === 'partial') return '部分作品缺失'
  // 服务端确定性业务错误（2026-11-11 真机链路排查）：给可行动文案而非通用失败。
  if (reason === 'ACCOUNT_NOT_FOUND') return '云端缺少账号记录，请重新扫码登录后重试'
  if (reason === 'WX_TOOL_UNAVAILABLE') return '桌面未接通视频号工具通道，请升级客户端后重试'
  return '采集失败'
}
