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
// 详情页与摘要卡共用的「核心缺口」白名单：只统计影响分析的字段缺失，
// is_original（原创声明）等官方可选字段不计，避免摘要卡说「50 个有缺口」、
// 详情页却说「无缺口」的自相矛盾（2026-11-11 review P2-3）。
export const CORE_GAP_FIELDS = new Set([
  'traffic_source',
  'retention_trend',
  'daily_metrics',
  'play_count',
  'like_count',
  'favorite_count',
  'comment_count',
  'share_count',
  'forward_count',
  'follow_count',
  'completion_rate_pct',
  'avg_play_duration_s',
  'cover_url',
  'publish_time',
  'duration_s',
])

export function hasCoreGap(work) {
  const gap = work && work.data_gap
  if (!gap || typeof gap !== 'object') return false
  return Object.keys(gap).some(field => CORE_GAP_FIELDS.has(field))
}

export function gapWorkCount(works) {
  return (Array.isArray(works) ? works : []).filter(work => hasCoreGap(work)).length
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

/** 来源分布行规范化：trafficSource JSON（§17.3）→ [{name, value}]，排除「全部」。
 * 缺失播放量保留 null（渲染「—」），不折算 0。 */
export function normalizeTrafficRows(trafficSource) {
  const rows = trafficSource && Array.isArray(trafficSource.rows) ? trafficSource.rows : []
  return rows
    .filter(row => row && row.sourceType !== 999)
    .map(row => {
      const value = row.playCount
      return {
        name: String(row.name || row.sourceKey),
        value: value === null || value === undefined || !Number.isFinite(Number(value))
          ? null
          : Number(value),
      }
    })
}

/** 作品列表「最近采集时间」：取所有行 `latest_collected_at` 的最大值，无有效值返回 null。
 *
 * 2026-11-12 真机反馈：该值原为表格最后一列，现改为工具栏刷新按钮后的单值展示，
 * 表格不再为它保留一列。 */
export function latestCollectedAt(works) {
  let latest = null
  for (const work of Array.isArray(works) ? works : []) {
    const raw = work && work.latest_collected_at
    if (!raw) continue
    const time = Date.parse(raw)
    if (Number.isNaN(time)) continue
    if (latest === null || time > latest.time) latest = { time, raw }
  }
  return latest ? latest.raw : null
}

/** 来源分布按播放量从大到小排序（最多的在最上方），缺失值沉底、不折算 0。
 *
 * 2026-11-12 真机反馈：详情页来源分布此前按官方行序展示，需按数值降序。 */
export function sortTrafficRowsByValue(rows) {
  const numeric = row => {
    const raw = row && row.value
    return raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw)
  }
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const av = numeric(a)
    const bv = numeric(b)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return bv - av
  })
}

/** 留存行规范化：retention_trend（§17.3）→ [{s, v}]。
 *
 * 键名兼容：`parse.js` 历史产出 `ratePct`，文档 §5.4 口径为 `rate_pct`；服务端
 * `retention_trend` 是原样 JSON 存取（不做 key 转换），两种形状都可能出现在库里。
 * 2026-11-11 review：只读 `rate_pct` 导致真机留存恒 0%。缺失值保留 null 显示「—」。
 */
export function normalizeRetentionPoints(retentionTrend) {
  const points = retentionTrend && Array.isArray(retentionTrend.points) ? retentionTrend.points : []
  return points
    .filter(point => point && Number.isFinite(Number(point.second)))
    .map(point => {
      const raw = point.rate_pct ?? point.ratePct
      const numeric = raw === null || raw === undefined ? null : Number(raw)
      return {
        s: Number(point.second),
        v: numeric === null || !Number.isFinite(numeric) ? null : Math.round(numeric),
      }
    })
}

// 画像维度标签映射（真机 dim 驱动，2026-11-10；不臆造官方未暴露语义）。
// 未知项官方编码为 `unknow`（少一个 w），历史/兼容口径也见过 `unknown`，两者都
// 显示「未知」，不能让英文编码透出到界面（2026-11-11 真机反馈）。
const UNKNOWN_LABELS = new Set(['unknow', 'unknown'])
function isUnknownKey(key) {
  return UNKNOWN_LABELS.has(String(key || '').trim().toLowerCase())
}

const PROFILE_LABEL_MAPS = {
  gender: { 1: '男', 2: '女', unknow: '未知', unknown: '未知' },
  age: row => {
    const key = String(row.key || '')
    if (isUnknownKey(key)) return '未知'
    const range = key.replace(/^fage_/, '')
    // `fage_50_+` → `50+'；`fage_01_17` → `1-17岁`（去前导零）。
    if (range.endsWith('_+')) return `${range.slice(0, -2).replace(/^0+/, '')}岁+`
    return `${range.split('_').map(part => part.replace(/^0+(?=\d)/, '')).join('-')}岁`
  },
  // 设备编码按官方后台口径映射（2026-11-11 真机交叉验证：官方 iOS 35.82% /
  // 安卓 59.7% 与本地 dim=1 的 36%、dim=2 的 60% 完全吻合）。未知编码仍显示未知。
  device: row => {
    if (isUnknownKey(row.key)) return '未知'
    const device = String(row.key).trim()
    if (device === '1') return 'iOS'
    if (device === '2') return '安卓'
    return `设备 ${device}`
  },
}

/** 画像维度行规范化：[{key,label,count}] → [[label, count]]。
 * `@_all` 是官方"全部"汇总行（count=总数），不属于分布条目，排除；gender 的
 * 1/2 与 age 的 fage_* 按真机编码映射为友好标签；device 仅暴露 1/2 编码，
 * 显示 iOS/安卓（按官方后台比例交叉验证），未知编码统一「未知」；province/city
 * 官方直接给中文名。 */
export function normalizeProfileRows(rows, dimension) {
  const map = dimension ? PROFILE_LABEL_MAPS[dimension] : null
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row && row.key && row.key !== '@_all')
    // 计数缺失/非数字的行直接跳过，不折算 0（「缺失不补 0」口径，审查 P2-16）。
    .filter(row => row.count !== null && row.count !== undefined && Number.isFinite(Number(row.count)))
    .map(row => {
      // 未知编码在任一维度（含 province/city）都必须显示「未知」，不能透出英文。
      if (isUnknownKey(row.key)) return ['未知', Number(row.count)]
      let label = row.label || row.key
      if (typeof map === 'function') label = map(row)
      else if (map && map[String(row.key)] !== undefined) label = map[String(row.key)]
      return [label, Number(row.count)]
    })
}

/**
 * ISO 时间戳 → 上海语义日（YYYY-MM-DD）。趋势图判定「发布日之前」用：
 * 直接 slice(0,10) 会按 UTC 截断，跨零点的作品会算早一天。
 */
export function shanghaiDayOf(isoValue) {
  if (typeof isoValue !== 'string' || !isoValue) return null
  const time = Date.parse(isoValue)
  if (!Number.isFinite(time)) return null
  return new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * 作品标题口径（2026-11-11 真机反馈）：官方后台列表显示的标题是发布文案
 * （parse 的 description），系统短标题（title，desc.shortTitle）仅部分作品
 * 有值且与后台展示不一致；部分作品两者皆缺 → 「—」。
 */
export function workTitle(work) {
  if (!work || typeof work !== 'object') return null
  const description = typeof work.description === 'string' ? work.description.trim() : ''
  if (description) return description
  const title = typeof work.title === 'string' ? work.title.trim() : ''
  return title || null
}

/** 封面/头像 URL 防御：仅 http(s)，解析失败返回 null（对齐抖音 safeAvatarSrc）。 */
export function safeAvatarSrc(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

/**
 * 作品原始链接域名白名单（对齐抖音 safeWorkUrl）：仅 http(s) + 视频号官方域
 * （channels.weixin.qq.com / weixin.qq.com）。不满足返回 null，标题按纯文本展示。
 * 注意：官方列表接口（statistic/post_list）不提供公开观看 URL，objectId 无法
 * 构造公开页（exportId 是会过期的加密 ID，分享链 weixin.qq.com/sph/* 需官方分享
 * 动作获取）——当前 works.list 无 url 字段，本机制就位，待采集侧补分享链后生效。
 */
export function safeWorkUrl(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let url
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname !== 'channels.weixin.qq.com' && url.hostname !== 'weixin.qq.com') return null
  return trimmed
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
/**
 * 作品/总览异步响应的落屏守卫（2026-11-11 review P1-4）：
 * 1. 请求序号必须最新——同账号并发时后到的旧响应不得覆盖新响应；
 * 2. 响应所属账号必须仍是当前选中账号——采集完成后按「采集账号」刷新，与当前
 *    选中无关，若不比对账号会把旧账号的数据写进新账号视图。
 * 抽成纯函数便于单测（渲染层无法直接覆盖 useEffect 内的时序）。
 */
export function shouldApplyResponse({
  requestId,
  currentRequestId,
  responseAccountId,
  currentAccountId,
}) {
  if (requestId !== currentRequestId) return false
  return responseAccountId === currentAccountId
}

/**
 * 「刷新」结果聚合文案（2026-11-11 review P1-2）：三路查询各自返回成功标志，
 * 全部成功才报「已刷新」，否则明确指出哪几路失败（内部 Promise 吞错，直接
 * await 几乎不会 reject，靠 reject 判断会把失败报成成功）。
 */
export function refreshResultLabel(results = {}) {
  const failed = []
  if (results.works === false) failed.push('作品列表')
  if (results.overview === false) failed.push('账号总览')
  if (results.accounts === false) failed.push('账号列表')
  return failed.length ? `部分刷新失败：${failed.join('、')}` : '已刷新'
}

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
  // 身份不匹配：同一个微信可绑定多个视频号，官方页面扫码后才有身份选择；当前登录
  // 身份与所选账号不是同一个（2026-11-11 真机串号排查）。
  if (reason === 'account_mismatch') return '当前登录的视频号与所选账号不一致，请重新扫码并在官方页面选择该视频号后重试'
  if (/^identity_check_failed/.test(reason)) return '无法确认当前登录的视频号身份，请重新扫码后重试'
  if (reason === 'identity_not_stable') return '未确认视频号身份（可能还在官方页面选择中），请重新扫码并在官方页面选完后确认'
  if (reason === 'pending_account') return '待升级账号'
  if (reason === 'probe_failed') return '会话检测失败'
  // 探测阶段的具体失效原因（批量跳过不再折叠，审查 P3-25⑤）。
  if (reason === 'no_session_cookie') return '官方页面未返回会话 Cookie，请重新扫码登录'
  if (reason === 'auth_data_unavailable') return '官方账号资料不可读，请重新扫码登录'
  if (reason === 'collect_busy') return '有采集任务进行中，请稍后重试'
  if (reason === 'partial') return '部分作品缺失'
  // 服务端确定性业务错误（2026-11-11 真机链路排查）：给可行动文案而非通用失败。
  if (reason === 'ACCOUNT_NOT_FOUND') return '云端缺少账号记录，请重新扫码登录后重试'
  if (reason === 'WX_TOOL_UNAVAILABLE') return '桌面未接通视频号工具通道，请升级客户端后重试'
  return '采集失败'
}
