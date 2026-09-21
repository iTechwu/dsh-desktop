// 单账号分析页 UI 模块（0914 方案 §6 线框，阶段 2；UI 优化方案 2026-09-16）。
//
// 职责边界与 overview-ui 相同：只做展示与本地格式化，零口径计算。
// 趋势图（§7.4）：点间连线按真实 elapsedSeconds 横轴定位（gap 天显式断点、不按
// 等距日对齐，断点显示"无采集"）；负 delta 显示 counter_revised 角标；
// metric=fans 即粉丝日收盘曲线；少于 2 点显示"暂无趋势"。
// "观众与流量"区按播放量加权的接口结果直接渲染（阶段 3 已开放）。
//
// UI 优化方案（2026-09-16）差异：标题统一「账号：{名称}」、头部不再显示规则版本、
// 内容指标改为「指标名/主值/状态或覆盖率」三段列表、观众与流量使用「主要 ×」口径标签、
// 本账号爆款视频固定六列表格、页面底部不显示数据质量与样本类辅助信息
// （这些字段仍由接口返回并保留在导出报告中）。

import { basisLines, formatDateTime, formatAgeBucket, genderLabel, trafficSourceLabel, trimNumber } from './ui-format.js'
import { FilterSelect } from './select-ui.js'

// React 由 client.js 内联作用域提供（构建时剥离本模块的 require，与 overview-ui 同法）。
let __react = null
function react() {
  if (!__react) __react = require('react')
  return __react
}

// 下载图标与视频数据页"导出 Excel"按钮同款（v2 §4.1 同一导出语义）。
const { IconDownloadOutline16 } = require('@deepseek-ai/dsh-client-ui-primitives')

function h2(...args) {
  return react().createElement(...args)
}

// 万单位格式化：复用 overview-ui 的同名导出（client.js 内联后同作用域）。
function wanText(value) {
  if (typeof formatWan === 'function') return formatWan(value)
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : null
}

function missing(value) {
  return value === null || value === undefined || value === '' ? '—' : value
}

function pct(value) {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : '—'
}

function count(value) {
  const formatted = wanText(value)
  return formatted === null ? '—' : formatted
}

function labelText(labels, t) {
  if (!Array.isArray(labels) || !labels.length) return t('insufficientSample')
  // 未登记的标签收敛「其他标签」，原始 key 不进页面（验收 P2）；去重避免连续重复。
  const known = { absolute: t('labelAbsolute'), account_relative: t('labelAccountRelative'), potential: t('labelPotential') }
  return [...new Set(labels.map(label => known[label] || t('labelOther')))].join(' + ')
}

export const TREND_METRICS = ['play', 'like', 'comment', 'collect', 'share', 'fans']

// ---------------------------------------------------------------------------
// 趋势图展示几何（2026-09-17 优化：30 天固定窗口 + 自然日横轴 + min/max 纵轴）。
//
// - 时间范围固定最近 30 个自然日（fromDay=今天-29 ~ toDay=今天），与请求窗口一致；
//   没有采集记录的日期不补 0，只作为缺口处理；
// - 数据点横坐标按自然日位置计算 x=(day-fromDay)/(toDay-fromDay)，两次采集之间
//   保留真实日期间隔，不按已有点压缩；elapsedSeconds 只用于 tooltip 与间隔说明；
// - 纵轴取窗口内有效值 min/max 上下各 10% 边距，小幅变化可见；所有点同值时纵轴
//   固定居中；yPct 保留小数不再取整。yPct 语义 = 值在 [yMin,yMax] 归一化位置的
//   百分比（值越大 yPct 越大）；SVG 的 y 轴向下，渲染层用 (100-yPct) 折算成像素
//   y，值大的点在视觉上方（用户反馈 2026-09-18：此前两层各反一次导致曲线整体
//   上下颠倒，递增数据显示成递减）；
// - 相邻采集日间隔 >1 天即为缺口：连线用虚线、缺口两端数据点保留，
//   前后不补零、不伪造数据；单点只显示数据点并提示样本不足。
// ---------------------------------------------------------------------------

const TREND_WINDOW_DAYS = 30
const TREND_AXIS_TICKS = [0, 7, 14, 21, 29]
// 数据点与绘图区左右边缘的安全边距（用户反馈 2026-09-20 需求 2）：起止日的点
// 半径 4px，不加边距会半个点被 viewBox 裁掉（当天收盘点贴右缘最明显）。
const TREND_PAD_X = 6

function localIsoDay(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDaysIso(iso, days) {
  const base = new Date(`${iso}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return localIsoDay(new Date(base.getTime() + base.getTimezoneOffset() * 60000))
}

export function trendLayout(points, { width = 600, now = null } = {}) {
  const empty = { renderable: false, single: false, nodes: [], segments: [], axisLabels: [] }
  const days = (Array.isArray(points) ? points : [])
    .filter(point => point && typeof point.day === 'string' && Number.isFinite(Number(point.value)))
    .map(point => ({ ...point, value: Number(point.value) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  if (!days.length) return empty

  // 30 天固定窗口（本地自然日；服务端对越界日期已 clamp，这里再做防御收敛）。
  const todayIso = localIsoDay(now ? new Date(now) : new Date())
  const fromDay = addDaysIso(todayIso, -(TREND_WINDOW_DAYS - 1))
  const fromMs = Date.parse(`${fromDay}T00:00:00Z`)
  const spanMs = (TREND_WINDOW_DAYS - 1) * 86400000
  const clampDayMs = day => {
    const ms = Date.parse(`${day}T00:00:00Z`)
    if (Number.isNaN(ms)) return null
    return Math.min(fromMs + spanMs, Math.max(fromMs, ms))
  }

  const nodes = []
  for (const point of days) {
    const clamped = clampDayMs(point.day)
    if (clamped === null) continue
    const prev = nodes[nodes.length - 1]
    const gapDaysBefore = prev
      ? Math.max(0, Math.round((clamped - prev._ms) / 86400000) - 1)
      : 0
    nodes.push({
      day: point.day,
      value: point.value,
      elapsedSeconds: point.elapsedSeconds,
      counterRevised: point.counterRevised === true,
      gapDaysBefore,
      x: Math.round((TREND_PAD_X + ((clamped - fromMs) / spanMs) * (width - TREND_PAD_X * 2)) * 100) / 100,
      yPct: 0,
      _ms: clamped,
    })
  }
  if (!nodes.length) return empty

  // 纵轴：窗口内有效值 min/max 上下各 10% 边距；同值固定居中；yPct 保留小数。
  // yPct = 值的归一化位置百分比（值越大 yPct 越大）；SVG y 轴向下的翻转只在
  // 渲染层 (100-yPct) 做一次，布局层不再预反——两层各反一次会把曲线画颠倒。
  const values = nodes.map(node => node.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const sameValue = rawMin === rawMax
  let yMin = rawMin
  let yMax = rawMax
  if (!sameValue) {
    const pad = (rawMax - rawMin) * 0.1
    yMin = rawMin - pad
    yMax = rawMax + pad
  }
  for (const node of nodes) {
    node.yPct = sameValue
      ? 50
      : Math.round(((node.value - yMin) / (yMax - yMin)) * 10000) / 100
  }

  // 分段：相邻采集日间隔 >1 天为缺口（虚线），否则实线；缺口两端数据点保留。
  const segments = []
  for (let index = 1; index < nodes.length; index += 1) {
    const prev = nodes[index - 1]
    const node = nodes[index]
    segments.push({
      x1: prev.x, y1: prev.yPct,
      x2: node.x, y2: node.yPct,
      dashed: node.gapDaysBefore > 0,
      gapDaysBefore: node.gapDaysBefore,
      prevX: prev.x, prevDay: prev.day,
    })
  }

  // 横轴日期标签：固定 5 个刻度位（0/7/14/21/29 天处），窄屏由 CSS 隐藏偶数位。
  const axisLabels = TREND_AXIS_TICKS.map((offset, index) => ({
    day: addDaysIso(fromDay, offset),
    x: Math.round((TREND_PAD_X + (offset / (TREND_WINDOW_DAYS - 1)) * (width - TREND_PAD_X * 2)) * 100) / 100,
    pos: index === 0 ? 'start' : index === TREND_AXIS_TICKS.length - 1 ? 'end' : 'middle',
    minor: index % 2 === 1,
  }))

  return {
    renderable: true,
    single: nodes.length === 1,
    width,
    nodes,
    segments,
    axisLabels,
    yMax: rawMax,
    yMin: rawMin,
    sameValue,
    fromDay,
    toDay: todayIso,
  }
}

// 注意联动：SVG viewBox 高与 client.js 中 `.ydo-an-trend-svg{height:168px}` 必须一致，
// 单改一处会因 viewBox/CSS 比例失配导致图形变形（测试有字面值锁定）。
const TREND_VIEW_HEIGHT = 168
const TREND_PAD_TOP = 16
const TREND_PAD_BOTTOM = 30

// y 轴标签专用格式化（需求 5a，2026-09-18）：≥1万固定保留 1 位小数万单位
//（如 165.3万），<1万千分位。不走 formatWan 的「≥100万取整」口径——那会让
// ±10% 边距下的 yMin/yMax（如 165.1万/165.9万）同显「165万」。
export function axisValueText(value) {
  // null/undefined/空串是「缺失」（上层显示 —），绝不格式化成 0（与 formatWan 同防御）。
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  if (Math.abs(num) >= 10000) return `${(num / 10000).toFixed(1)}万`
  return num.toLocaleString('en-US')
}

// 容器实测宽度（需求 5b，2026-09-18）：趋势 SVG 的 viewBox 用真实面板宽度，
// 消除「固定 600 宽被 width:100% 拉伸 ~3 倍导致轴文字/点线过大」的根因；
// ResizeObserver 跟随面板尺寸变化。沙箱/无 ResizeObserver 环境降级为默认宽。
// callback ref 模式：hook 必须在 AnalysisPage 任何早退 return 之前调用（Rules of
// Hooks），effect 依赖 [node, width]——node 入依赖才能感知「早退→完整渲染」后
// 容器才真正挂载的时机，否则 observer 永远 attach 不上、宽停在校正值。
function useMeasuredWidth(fallbackWidth = 600) {
  const { useState, useEffect } = react()
  const [node, setNode] = useState(null)
  const [width, setWidth] = useState(fallbackWidth)
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(entries => {
      const entry = entries && entries[0]
      const nextWidth = entry && entry.contentRect ? Math.round(entry.contentRect.width) : 0
      // 忽略塌缩态（隐藏/折叠时的 0 宽）与同值，避免无效重渲。
      if (nextWidth >= 200 && nextWidth !== width) setWidth(nextWidth)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, width])
  return [setNode, width]
}

// SVG 趋势图（2026-09-17 优化）：黑色折线 2px、缺口虚线、数据点 6px、
// 低透明度面积填充、浅灰网格与坐标文字、日期标签固定 5 刻度位（窄屏隐藏偶数位）。
function TrendChart({ layout, t }) {
  const { width, nodes, segments, axisLabels, yMax, yMin } = layout
  const plotHeight = TREND_VIEW_HEIGHT - TREND_PAD_TOP - TREND_PAD_BOTTOM
  const yOf = node => TREND_PAD_TOP + ((100 - node.yPct) / 100) * plotHeight
  const areaPoints = nodes.map(node => `${node.x},${yOf(node)}`).join(' ') +
    ` ${nodes[nodes.length - 1].x},${TREND_PAD_TOP + plotHeight} ${nodes[0].x},${TREND_PAD_TOP + plotHeight}`
  const gridYs = [TREND_PAD_TOP, TREND_PAD_TOP + plotHeight / 2, TREND_PAD_TOP + plotHeight]
  // y 轴标签（需求 5a）：专用格式化保留 1 位小数万单位；min/max 格式化同文时
  // 退千分位完整数字（不走 formatWan——其 ≥100万取整口径正是同文根因），
  // 保证两端可区分。非有限数回退 —，超长截断兜底。
  const axisFallback = value => {
    const formatted = count(value)
    return formatted === null ? '—' : (formatted.length > 12 ? `${formatted.slice(0, 12)}…` : formatted)
  }
  let yMaxText = axisValueText(yMax) || axisFallback(yMax)
  let yMinText = axisValueText(yMin) || axisFallback(yMin)
  if (yMaxText === yMinText) {
    yMaxText = Math.round(Number(yMax)).toLocaleString('en-US')
    yMinText = Math.round(Number(yMin)).toLocaleString('en-US')
  }

  return h2('svg', {
    className: 'ydo-an-trend-svg',
    viewBox: `0 0 ${width} ${TREND_VIEW_HEIGHT}`,
    role: 'img',
    'aria-label': t('trendTitle'),
  },
  ...gridYs.map((gy, index) => h2('line', {
    key: `grid-${index}`,
    x1: 0, y1: gy, x2: width, y2: gy,
    className: 'ydo-an-grid-line',
  })),
  h2('text', { x: 2, y: TREND_PAD_TOP + 8, className: 'ydo-an-axis-text' }, yMaxText),
  h2('text', { x: 2, y: TREND_PAD_TOP + plotHeight - 2, className: 'ydo-an-axis-text' }, yMinText),

  nodes.length > 1 ? h2('polygon', {
    points: areaPoints,
    className: 'ydo-an-trend-area',
  }) : null,

  ...segments.map((segment, index) => h2('line', {
    key: `seg-${index}`,
    x1: segment.x1, y1: TREND_PAD_TOP + ((100 - segment.y1) / 100) * plotHeight,
    x2: segment.x2, y2: TREND_PAD_TOP + ((100 - segment.y2) / 100) * plotHeight,
    className: segment.dashed ? 'ydo-an-seg ydo-an-seg-dashed' : 'ydo-an-seg',
  })),

  ...nodes.map((node, index) => h2('circle', {
    key: `dot-${node.day}-${index}`,
    cx: node.x, cy: yOf(node), r: 4,
    className: 'ydo-an-dot-circle',
  }, h2('title', null,
    // 悬浮提示与 y 轴同口径（axisValueText，≥1万保留 1 位小数），
    // 不走 count/formatWan 的「≥100万取整」口径，避免同图两种万单位文本。
    `${node.day} ${axisValueText(node.value) || '—'}` +
    (node.gapDaysBefore > 0 ? ` · ${t('noCollectGap')} ${node.gapDaysBefore}d` : '')))),

  ...nodes.filter(node => node.gapDaysBefore > 0).map((node, index) => h2('text', {
    key: `gap-${index}`,
    x: Math.max(24, Math.min(width - 24, node.x - node.gapDaysBefore * (width / 29) / 2 + 12)),
    y: TREND_PAD_TOP + plotHeight + 12,
    className: 'ydo-an-gap-text',
  }, `${t('noCollectGap')} ${node.gapDaysBefore}d`)),

  ...nodes.filter(node => node.counterRevised).map((node, index) => h2('text', {
    key: `revised-${index}`,
    x: Math.min(width - 30, node.x + 6),
    y: Math.max(10, yOf(node) - 9),
    className: 'ydo-an-revised-text',
  }, t('counterRevised'))),

  ...axisLabels.map(label => h2('text', {
    key: `axis-${label.day}`,
    x: label.x, y: TREND_VIEW_HEIGHT - 8,
    className: `ydo-an-axis-label ydo-an-axis-${label.pos}${label.minor ? ' ydo-an-axis-minor' : ''}`,
  }, label.day.slice(5).replace('-', '/'))))
}

export function deriveAnalysisAlerts(analysis, t) {
  const alerts = []
  const account = analysis?.account
  if (!account) return alerts
  if (account.sessionStatus === 'expired') {
    alerts.push(t('alertSessionExpired'))
  }
  if (account.suspiciousEmptyCollect) {
    alerts.push(t('alertSuspiciousEmpty'))
  }
  return alerts
}

// 观众画像（UI 优化方案 v2 §5.3）：性别/年龄/地域/城市级别/主要来源统一为卡片；
// 评论热词不再出现在本页
//（接口 hotwords 字段保留在导出报告中）。gender/age 的接口枚举（male/41-50 等）
// 经 ui-format 中文化，内部枚举不进页面（验收 P1）。
function dimensionRows(dimension, formatKey) {
  const top = ((dimension && dimension.distributions) || []).slice(0, 3)
  return top.map(item => ({ key: formatKey(item.key), pct: item.pct }))
}

function AudienceBarList({ rows }) {
  if (!rows.length) return null
  const max = rows.reduce((acc, row) => Math.max(acc, Number(row.pct) || 0), 0) || 1
  return h2('ul', { className: 'ydo-bars ydo-bars-distribution' },
    ...rows.map(row => h2('li', { key: row.key },
      h2('span', { className: 'ydo-bar-label', title: row.key }, row.key),
      h2('span', { className: 'ydo-bar-track' },
        h2('span', { className: 'ydo-bar-fill', style: { width: `${Math.min(100, (Number(row.pct) || 0) / max * 100)}%` } })),
      h2('span', { className: 'ydo-bar-value' }, pct(row.pct)))))
}

function AudienceBlock({ label, rows, t }) {
  // 每块：标题 + 前三项横向条形；无数据的维度显示数据不足，不渲染空进度条。
  return h2('div', { className: 'ydo-an-audience-block' },
    h2('h4', null, label),
    rows.length ? h2(AudienceBarList, { rows }) : h2('p', { className: 'ydo-hint' }, t('dataInsufficient')))
}

function audienceGrid(analysis, t) {
  const audience = analysis?.audience
  const genderRows = dimensionRows(audience?.dimensions?.gender, key => genderLabel(key, t), t)
  const ageRows = dimensionRows(audience?.dimensions?.age, key => formatAgeBucket(key, t), t)
  const provinceRows = dimensionRows(audience?.dimensions?.province, key => key, t)
  const cityRows = dimensionRows(audience?.dimensions?.city_level, key => key, t)
  // 流量来源展示名单一来源 ui-format 的 trafficSourceLabel：历史脏 label（与 key 相同或
  // 裸枚举形态）不直接展示，未知 key 兜底「其他来源」（验收 P1——不复刻第二套映射）。
  const trafficRows = ((analysis?.traffic?.distributions) || []).slice(0, 3)
    .map(item => ({
      key: trafficSourceLabel({ source_key: item.key, source_label: item.sourceLabel }, t),
      pct: item.pct,
    }))
  return h2('div', { className: 'ydo-an-audience' },
    h2(AudienceBlock, { key: 'gender', label: t('mainGender'), rows: genderRows, t }),
    h2(AudienceBlock, { key: 'age', label: t('mainAge'), rows: ageRows, t }),
    h2(AudienceBlock, { key: 'province', label: t('mainRegion'), rows: provinceRows, t }),
    h2(AudienceBlock, { key: 'city_level', label: t('cityLevel'), rows: cityRows, t }),
    h2(AudienceBlock, { key: 'traffic', label: t('mainTrafficSource'), rows: trafficRows, t }))
}

function alertRuleText(alert, t) {
  // 服务端 ruleId → 可读文案；未登记的 ruleId 收敛「其他规则提醒」，原始值不进页面（验收 P2）。
  const ruleCopy = {
    high_play_low_engagement: '高播放低互动',
    high_engagement_low_play: '高互动低播放',
    retention_anomaly: '留存异常',
  }
  const name = ruleCopy[alert.ruleId] || t('alertRuleOther')
  return `${name}（${alert.workCount} 条作品）`
}

function renderHeadAlerts(analysis, t) {
  // 会话/采集结构性提醒（dataQuality 派生）+ 内容类规则提醒（服务端 alerts[] 单点产出）。
  // 页面不显示样本量等规则辅助信息（UI 优化方案 §5.5），完整口径保留在导出报告中。
  const items = [
    ...deriveAnalysisAlerts(analysis, t).map(text => ({ key: text, text })),
    ...(analysis?.alerts || []).map(alert => ({
      key: alert.ruleId,
      text: alertRuleText(alert, t),
    })),
  ]
  if (!items.length) return null
  return h2('ul', { className: 'ydo-ov-alerts' },
    ...items.map(item => h2('li', { key: item.key }, item.text)))
}

function Kpi({ label, value, note }) {
  // 指标卡统一「指标名、主值、状态/覆盖率」结构（UI 优化方案 §5.2）；note 缺省时不渲染空槽。
  return h2('div', { className: 'ydo-an-kpi' },
    h2('span', { className: 'ydo-ov-kpi-label' }, label),
    h2('strong', { className: 'ydo-ov-kpi-value' }, value),
    note ? h2('span', { className: 'ydo-ov-kpi-hint' }, note) : null)
}

// 内容指标固定清单（UI 优化方案 §5.3）：顺序与文案固定，数值/覆盖率全部来自服务端。
// interaction 段的键是服务端 overview `_account_metrics` 的 camelCase 键；
// completion/playback 段由服务端 `_playback_metrics` 单点产出均值（value 字段），
// kind 驱动单位渲染（avgWatchDuration 是秒），未返回时显式「数据不足」，绝不本地推算。
const CONTENT_METRICS = [
  { key: 'engagement', label: 'cmEngagement' },
  { key: 'likeCount', label: 'cmLikeRate' },
  { key: 'commentCount', label: 'cmCommentRate' },
  { key: 'collectCount', label: 'cmCollectRate' },
  { key: 'shareCount', label: 'cmShareRate' },
  { key: 'completion5s', label: 'cmCompletion5s', section: 'completion' },
  { key: 'avgViewProportion', label: 'cmAvgViewShare', section: 'playback' },
  { key: 'avgWatchDuration', label: 'cmAvgWatchDuration', section: 'playback', kind: 'seconds' },
]

function contentMetricNote(item, t) {
  // 第三段只保留数据状态：覆盖率缺失或为 0 → 数据不足；其余（部分覆盖或完整）
  // 一律不显示状态（用户反馈 2026-09-18：「部分数据」徽标去除）。覆盖率数值属于
  // 内部质量信息，不在内容指标中展示。真实数值 0 永远照常渲染，不因隐藏覆盖率变成空值。
  const coverage = Number(item && item.coveragePct)
  if (!Number.isFinite(coverage) || coverage <= 0) return t('dataInsufficient')
  return null
}

export function contentMetricRows(analysis, t) {
  const interaction = analysis?.interaction || {}
  const kpi = analysis?.kpi || {}
  return CONTENT_METRICS.map(metric => {
    // 综合互动率来自 kpi（服务端聚合值，无覆盖率段）；缺失显式「数据不足」，
    // 保持「指标名/主值/状态」三段完整（验收建议 4），绝不本地推算。
    if (metric.key === 'engagement') {
      const hasEngagement = kpi.engagementRatePct !== null && kpi.engagementRatePct !== undefined
      return {
        key: metric.key,
        label: t(metric.label),
        value: hasEngagement ? pct(kpi.engagementRatePct) : '—',
        note: hasEngagement ? null : t('dataInsufficient'),
      }
    }
    if (metric.section) {
      // 完播/播放段：item.value 是服务端均值（百分比或秒），缺失显式「数据不足」。
      const item = analysis?.[metric.section]?.[metric.key]
      const numeric = Number(item && item.value)
      const has = Boolean(item) && Number.isFinite(numeric)
      return {
        key: metric.key,
        label: t(metric.label),
        value: has ? (metric.kind === 'seconds' ? `${trimNumber(numeric)}${t('seconds')}` : pct(numeric)) : '—',
        note: has ? contentMetricNote(item, t) : t('dataInsufficient'),
      }
    }
    const item = interaction[metric.key]
    return {
      key: metric.key,
      label: t(metric.label),
      value: item ? pct(item.ratePct) : '—',
      note: item ? contentMetricNote(item, t) : t('dataInsufficient'),
    }
  })
}

// 本账号爆款视频：固定六列「排名/视频/发布时间/播放量/互动率/爆款依据」（方案 §5.5）。
// 列序与总览爆款表（视频在最前）不同，使用专属轨道 ydo-ov-tr-hot-rank：
// 排名固定窄列居首，视频标题占宽轨（验收建议 1——复用总览轨道会把排名挤进宽轨）。
function hotWorksTable(analysis, onOpenWork, t) {
  const works = analysis?.hotWorks || []
  if (!works.length) return h2('p', { className: 'ydo-hint' }, t('noHotWorks'))
  return h2('div', { className: 'ydo-ov-table', role: 'table', 'aria-label': t('accountHotWorks') },
    h2('div', { className: 'ydo-ov-tr ydo-ov-tr-hot-rank ydo-ov-head', role: 'row' },
      h2('span', { className: 'ydo-ov-rankcell', role: 'columnheader' }, t('rankCol')),
      h2('span', { role: 'columnheader' }, t('colVideo')),
      h2('span', { role: 'columnheader' }, t('publishTime')),
      h2('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('colPlay')),
      h2('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('engagement')),
      h2('span', { className: 'ydo-ov-hot-basis-head', role: 'columnheader' }, t('hotBasis'))),
    ...works.map((work, index) => {
      const lines = basisLines(work.basis)
      return h2('div', { key: work.workId, className: 'ydo-ov-tr ydo-ov-tr-hot-rank', role: 'row' },
        // data-label 供窄屏（面板容器查询）卡片重排显示字段名（二审 P2），桌面端不渲染。
        h2('span', { className: 'ydo-ov-rankcell', role: 'cell', 'data-label': t('rankCol') }, work.rank ?? index + 1),
        h2('div', { className: 'ydo-ov-hot-title', role: 'cell', 'data-label': t('colVideo') },
          h2('button', {
            type: 'button', className: 'ydo-ov-work-link',
            onClick: () => onOpenWork && onOpenWork(work),
            title: work.title || work.workId,
          }, work.title || work.workId)),
        h2('span', { role: 'cell', 'data-label': t('publishTime') }, formatDateTime(work.publishTime)),
        h2('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('colPlay') }, count(work.playCount)),
        h2('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('engagement') }, pct(work.engagementRatePct)),
        h2('div', { className: 'ydo-ov-basis', role: 'cell', 'data-label': t('hotBasis'), title: work.basis || '' },
          ...(lines.length
            ? lines.map(line => h2('div', { key: line }, line))
            : [h2('div', { key: 'labels' }, labelText(work.labels, t))])))
    }))
}


// ---------------------------------------------------------------------------
// AI 账号表现分析（0916 方案 §9；v1 §2.1；卡片折叠式布局 2026-09-17 验收稿）。
//
// 六张折叠卡：结论摘要（蓝，默认展开）/ 表现诊断（灰，收起态=五维等级徽章行）/
// 风险与机会（红）/ 执行建议（绿）/ 爆款规律（紫）/ 数据限制与免责（灰，最弱化）。
// 左边框 3px 语义色区分类别；条目内按优先级/等级徽章区分重要程度。
// 收起时头部仍暴露一行关键信息（digest），点击头部展开/收起明细。
// ---------------------------------------------------------------------------

const AI_LEVEL_LABELS = { strong: 'aiLevelStrong', medium: 'aiLevelMedium', weak: 'aiLevelWeak', insufficient: 'aiLevelInsufficient' }
const AI_ASSESSMENT_LABELS = { stable: 'aiAssessmentStable', growing: 'aiAssessmentGrowing', volatile: 'aiAssessmentVolatile' }
const AI_GRADE_LABELS = { high: 'aiGradeHigh', medium: 'aiGradeMedium', low: 'aiGradeLow' }
const AI_DIM_SHORT_KEYS = { content: 'aiDimShortContent', interaction: 'aiDimShortInteraction', retention: 'aiDimShortRetention', audience: 'aiDimShortAudience', stability: 'aiDimShortStability' }
const AI_DIM_FALLBACK = { content: '内容吸引力', interaction: '互动质量', retention: '留存与观看深度', audience: '流量与受众匹配', stability: '稳定性与可复制性' }

const AI_STATUS_COPY = Object.freeze({
  not_analyzed: 'aiStatusNotAnalyzed',
  running: 'aiStatusRunning',
  succeeded: 'aiStatusSucceeded',
  insufficient: 'aiStatusInsufficient',
  failed: 'aiStatusFailed',
})

// AI 稳定错误码 → 文案键（§9.3.5：失败显示中文提示与重试入口，不透传原始报文）。
const AI_ERROR_REASON_COPY = Object.freeze({
  AI_ANALYSIS_RUNNING: 'aiErrorRunning',
  AI_ANALYSIS_GLOBAL_CONCURRENCY_LIMIT: 'aiErrorBusy',
  AI_ANALYSIS_INSUFFICIENT_DATA: 'aiErrorInsufficient',
  AI_ANALYSIS_MODEL_FAILED: 'aiErrorRetryable',
  AI_ANALYSIS_SCHEMA_INVALID: 'aiErrorRetryable',
  AI_ANALYSIS_TIMEOUT: 'aiErrorTimeout',
  AI_ANALYSIS_ENQUEUE_FAILED: 'aiErrorEnqueue',
  AI_ANALYSIS_MODEL_CONFIG_MISSING: 'aiErrorUnavailable',
  AI_ANALYSIS_PROMPT_INVALID: 'aiErrorUnavailable',
  AI_ANALYSIS_NOT_FOUND: 'aiErrorNotFound',
  IDEMPOTENCY_CONFLICT: 'aiErrorConflict',
})

function aiText(value) {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function aiLevelBadge(level, t) {
  const key = level || 'insufficient'
  return h2('span', { className: `ydo-ai-level ydo-ai-level-${key}` },
    t(AI_LEVEL_LABELS[key] || 'aiLevelInsufficient'))
}

function aiGradeText(value, t) {
  if (!value) return null
  const key = AI_GRADE_LABELS[value]
  return key ? t(key) : null
}

function aiPriorityBadge(priority, t) {
  const key = AI_GRADE_LABELS[priority]
  return h2('span', { className: `ydo-ai-pri ydo-ai-pri-${priority || 'low'}` },
    key ? t(key) : t('aiGradeLow'))
}

// 用户反馈 2026-09-18（需求 2）：风险/建议/规律卡收起徽章统一改「高N 中N 低N」
// 三色计数，与展开后条目徽章同一配色体系（.ydo-ai-pri-*）。pick 取条目级别
// （风险/建议 = priority，爆款规律 = confidence）；为 0 的级别不显示，全部为 0
// 时不渲染（数据异常退化为无徽章，不伪造计数）。
function aiPriorityDigestCounts(items, pick, t) {
  const counts = { high: 0, medium: 0, low: 0 }
  for (const item of Array.isArray(items) ? items : []) {
    const key = pick(item)
    if (key === 'high' || key === 'medium' || key === 'low') counts[key] += 1
  }
  const parts = ['high', 'medium', 'low'].filter(key => counts[key] > 0)
  if (!parts.length) return null
  return h2('span', { className: 'ydo-ai-digest-counts' },
    ...parts.map(key => h2('span', { key, className: `ydo-ai-pri ydo-ai-pri-${key}` },
      `${t(AI_GRADE_LABELS[key])}${counts[key]}`)))
}

function aiEvidenceChips(ids, evidenceMap, onOpenWork, t) {
  if (!Array.isArray(ids) || !ids.length) return null
  const unique = [...new Set(ids)]
  // 标签 + chip 列表拆两列网格（用户反馈 2026-09-18）：标签固定左列，chips 在右列
  // 内流式换行且左缘对齐，不再与标签混排在同一行流里导致换行后参差错乱。
  return h2('div', { className: 'ydo-ai-evidence' },
    h2('span', { className: 'ydo-ai-evidence-label' }, t('aiEvidenceWorks')),
    h2('div', { className: 'ydo-ai-evidence-list' },
      ...unique.map(workId => {
        // 服务端 get 投影反查的作品名；缺失回退 ID 截断，不伪造
        const title = (evidenceMap && evidenceMap[workId]) || null
        return h2('button', {
          key: workId,
          type: 'button',
          className: 'ydo-ai-chip',
          title: title || workId,
          onClick: () => onOpenWork && onOpenWork({ workId }),
        }, title ? (title.length > 18 ? `${title.slice(0, 18)}…` : title) : `${workId.slice(0, 8)}…`)
      })))
}

function aiDigestCount(text) {
  return h2('span', { className: 'ydo-ai-count' }, text)
}

function AiCard({ tone, title, open, onToggle, digest, count, children }) {
  return h2('section', { className: `ydo-ai-card ydo-ai-card-${tone}${open ? ' ydo-ai-card-open' : ''}` },
    h2('button', { type: 'button', className: 'ydo-ai-card-toggle', 'aria-expanded': !!open, onClick: onToggle },
      h2('h4', null, title),
      digest || null,
      typeof count === 'string' ? aiDigestCount(count) : (count || null),
      h2('span', { className: 'ydo-ai-arrow', 'aria-hidden': 'true' }, '▶')),
    h2('div', { className: 'ydo-ai-card-body', hidden: !open }, children))
}

function AiAnalysisSection({
  ai, aiStatus = 'not_analyzed', busy, error, confirming,
  onStart, onRequestRerun, onConfirmRerun, onCancelConfirm, onOpenWork, t,
}) {
  const { useState } = react()
  // 折叠态：仅结论摘要默认展开；点击卡片头部切换（§验收稿 2026-09-17）
  const [openCards, setOpenCards] = useState({ summary: true })
  const toggle = key => setOpenCards(prev => ({ ...prev, [key]: !prev[key] }))

  const result = (ai && ai.result) || null
  const hasResult = Boolean(ai && ai.status === 'succeeded' && result)
  // 运行态以外层 aiStatus 为准（重跑时正文仍是旧 current，投影 status 不反映重跑）
  const running = aiStatus === 'running' || Boolean(ai && ai.status === 'running')
  const isRunning = busy || running
  const statusKey = AI_STATUS_COPY[aiStatus || (ai && ai.status)] || 'aiStatusNotAnalyzed'

  // 服务端 get 投影反查的证据作品标题（workId → title）
  const evidenceMap = {}
  for (const work of ((ai && ai.evidenceWorks) || [])) {
    if (work && work.workId) evidenceMap[work.workId] = work.title || null
  }

  const dims = hasResult ? (result.dimensions || []) : []
  const risks = hasResult ? (result.risks || []) : []
  const recs = hasResult ? (result.recommendations || []) : []
  const patterns = hasResult ? (result.viralPatterns || []) : []
  const limits = hasResult ? (result.dataLimitations || []) : []

  // 从未分析过（外层状态仍为 not_analyzed）时首按钮用短文案「开始分析」（需求 4）；
  // 首次失败（failed）后仍走原「AI 分析账号表现」入口，语义不与重跑混淆。
  const startLabel = aiStatus === 'not_analyzed' ? 'aiStartButtonFirst' : 'aiStartButton'
  const button = isRunning
    ? h2('button', { type: 'button', className: 'ydo-secondary', disabled: true, 'aria-busy': true }, t('aiRunningButton'))
    : hasResult || (ai && ai.status === 'insufficient')
      ? h2('button', { type: 'button', className: 'ydo-secondary', onClick: onRequestRerun }, t('aiRerunButton'))
      : h2('button', {
        type: 'button', className: 'ydo-secondary', disabled: busy,
        onClick: () => { if (onStart) onStart() },
      }, t(startLabel))

  const errorText = error ? t(AI_ERROR_REASON_COPY[error] || 'aiErrorRetryable') : null
  // 「已保留上次分析结果」警示改读服务端显式 retainedError 字段（2026-09-18 语义）：
  // 仅当最新一次运行 failed/insufficient 且存在不同 analysis_id 的保留结果时才非空，
  // 重跑成功/首次失败/脏数据残留都不会再误报（需求 3）。客户端再以 ai.result 兜底：
  // 字段存在但正文为空（脏数据）时不说「已保留结果」，避免与六卡空态矛盾展示。
  const retainedWarn = ai && ai.retainedError && ai.result
    ? t(ai.retainedError.code === 'AI_ANALYSIS_INSUFFICIENT_DATA' ? 'aiErrorInsufficient' : 'aiErrorRetained')
    : null

  // —— 卡片 digest（收起态一行关键信息）——
  const dimsDigest = h2('span', { className: 'ydo-ai-digest-levels' },
    ...dims.map(d => h2('span', { key: d.key, className: `ydo-ai-dl ydo-ai-dl-${d.level || 'insufficient'}` },
      `${t(AI_DIM_SHORT_KEYS[d.key] || d.key)} · ${t(AI_LEVEL_LABELS[d.level] || 'aiLevelInsufficient')}`)))
  const risksDigest = risks.length
    ? h2('span', { className: 'ydo-ai-digest' },
      (risks[0].title || '').length > 24 ? `${risks[0].title.slice(0, 24)}…` : risks[0].title)
    : null
  const recsDigest = recs.length
    ? h2('span', { className: 'ydo-ai-digest' },
      (recs[0].action || '').length > 24 ? `${recs[0].action.slice(0, 24)}…` : recs[0].action)
    : null
  const patternsDigest = patterns.length
    ? h2('span', { className: 'ydo-ai-digest' },
      (patterns[0].pattern || '').length > 24 ? `${patterns[0].pattern.slice(0, 24)}…` : patterns[0].pattern)
    : null

  return h2('section', { className: 'ydo-ov-panel ydo-an-ai' },
    h2('div', { className: 'ydo-ov-toolbar' },
      h2('h3', null, t('aiTitle')),
      h2('div', { className: 'ydo-an-ai-controls' },
        h2('span', { className: `ydo-an-ai-status ydo-an-ai-status-${aiStatus || (ai && ai.status) || 'not_analyzed'}`, role: 'status' }, t(statusKey)),
        button)),
    errorText ? h2('p', { className: 'ydo-error', role: 'alert' }, errorText) : null,
    retainedWarn ? h2('p', { className: 'ydo-warn', role: 'status' }, retainedWarn) : null,

    h2('div', { className: 'ydo-ai-cards' },
      // 卡 1：结论摘要（蓝，默认展开）
      h2(AiCard, {
        key: 'card-summary', tone: 'summary', title: t('aiSummaryTitle'),
        open: !!openCards.summary, onToggle: () => toggle('summary'),
        digest: h2('span', { className: 'ydo-ai-digest' },
          `${t('aiAssessmentLabel')}：${t(AI_ASSESSMENT_LABELS[result?.overallAssessment] || result?.overallAssessment || '—')}`),
      },
      hasResult ? [
        h2('p', { className: 'ydo-ai-summary-text' }, result.summary),
        h2('div', { className: 'ydo-ai-summary-meta' },
          h2('span', null, t('aiMetaRange')),
          payloadTime(ai.generatedAt) ? h2('span', null, `${t('aiMetaGeneratedAt')} ${payloadTime(ai.generatedAt)}`) : null,
          Number.isFinite(Number(ai.sampleCount)) ? h2('span', null, `${t('aiMetaSample')} ${count(ai.sampleCount)}`) : null),
      ] : h2('p', { className: 'ydo-hint' },
        isRunning ? t('aiRunningButton') : t(AI_STATUS_COPY[aiStatus] || 'aiStatusNotAnalyzed'))),

      // 卡 2：表现诊断（灰；收起态=五维等级徽章行）
      h2(AiCard, {
        key: 'card-dims', tone: 'dims', title: t('aiDimensionsTitle'),
        open: !!openCards.dims, onToggle: () => toggle('dims'),
        digest: dimsDigest,
      },
      h2('div', { className: 'ydo-ai-dims' },
        ...dims.map(dimension => h2('div', { key: dimension.key, className: 'ydo-ai-dim' },
          h2('div', { className: 'ydo-ai-dim-head' },
            h2('b', null, dimension.title || AI_DIM_FALLBACK[dimension.key] || dimension.key),
            aiLevelBadge(dimension.level, t)),
          (dimension.facts || []).length ? h2('p', { className: 'ydo-ai-dim-fact' }, dimension.facts[0]) : null,
          aiText(dimension.insight) ? h2('p', { className: 'ydo-ai-dim-insight' }, dimension.insight) : null,
          h2('details', { className: 'ydo-ai-dim-detail' },
            h2('summary', null, t('aiDimDetail')),
            ...(dimension.facts || []).slice(1).map((fact, index) =>
              h2('p', { key: `${index}-${String(fact).slice(0, 6)}`, className: 'ydo-ai-dim-fact' }, fact)),
            (dimension.limitations || []).length
              ? h2('p', { className: 'ydo-ai-dim-limit' },
                `${t('aiDataLimitations')}：${dimension.limitations.join('；')}`)
              : null,
            aiEvidenceChips(dimension.evidenceWorkIds, evidenceMap, onOpenWork, t)))))),

      // 卡 3+4：风险（红）与 建议（绿）双列
      h2('div', { className: 'ydo-ai-grid' },
        h2(AiCard, {
          key: 'card-risks', tone: 'risks', title: t('aiRisksTitle'),
          open: !!openCards.risks, onToggle: () => toggle('risks'),
          digest: risksDigest,
          count: risks.length ? aiPriorityDigestCounts(risks, item => item.priority, t) : null,
        },
        ...risks.map((risk, index) => h2('div', { key: `risk-${index}`, className: 'ydo-ai-item' },
          h2('div', { className: 'ydo-ai-item-head' },
            aiPriorityBadge(risk.priority, t),
            h2('span', { className: 'ydo-ai-item-title' }, risk.title || '—')),
          aiText(risk.reason) ? h2('p', { className: 'ydo-ai-item-reason' }, risk.reason) : null,
          aiEvidenceChips(risk.evidenceWorkIds, evidenceMap, onOpenWork, t)))),

        h2(AiCard, {
          key: 'card-recs', tone: 'recs', title: t('aiRecommendationsTitle'),
          open: !!openCards.recs, onToggle: () => toggle('recs'),
          digest: recsDigest,
          count: recs.length ? aiPriorityDigestCounts(recs, item => item.priority, t) : null,
        },
        ...recs.map((recommendation, index) => h2('div', { key: `rec-${index}`, className: 'ydo-ai-item' },
          h2('div', { className: 'ydo-ai-item-head' },
            aiPriorityBadge(recommendation.priority, t),
            h2('span', { className: 'ydo-ai-item-title' }, recommendation.action || '—')),
          aiText(recommendation.expectedSignal)
            ? h2('p', { className: 'ydo-ai-signal' },
              h2('span', { className: 'ydo-ai-signal-label' }, `${t('aiExpectedSignal')}：`),
              recommendation.expectedSignal)
            : (aiText(recommendation.reason)
              ? h2('p', { className: 'ydo-ai-item-reason' }, recommendation.reason)
              : null),
          aiEvidenceChips(recommendation.evidenceWorkIds, evidenceMap, onOpenWork, t))))),

      // 卡 5+6：规律（紫）与 限制（灰）双列
      h2('div', { className: 'ydo-ai-grid' },
        h2(AiCard, {
          key: 'card-patterns', tone: 'patterns', title: t('aiPatternsTitle'),
          open: !!openCards.patterns, onToggle: () => toggle('patterns'),
          digest: patternsDigest,
          count: patterns.length ? aiPriorityDigestCounts(patterns, item => item.confidence, t) : null,
        },
        ...patterns.map((pattern, index) => h2('div', { key: `pattern-${index}`, className: 'ydo-ai-item' },
          h2('div', { className: 'ydo-ai-item-head' },
            h2('span', { className: 'ydo-ai-item-title' }, pattern.pattern || '—'),
            aiGradeText(pattern.confidence, t)
              // 置信度徽章按高/中/低分级配色（用户反馈 2026-09-18）：与风险/建议的
              // 优先级徽章同一三色体系，收起态「高N 中N 低N」计数与展开色对齐。
              ? h2('span', { className: `ydo-ai-conf ydo-ai-conf-${pattern.confidence || 'low'}` },
                aiGradeText(pattern.confidence, t))
              : null),
          aiEvidenceChips(pattern.evidenceWorkIds, evidenceMap, onOpenWork, t)))),

        h2(AiCard, {
          key: 'card-limits', tone: 'limits', title: t('aiLimitsTitle'),
          open: !!openCards.limits, onToggle: () => toggle('limits'),
          digest: null,
          count: limits.length ? t('aiDigestLimits').replace('{n}', String(limits.length)) : null,
        },
        h2('ul', { className: 'ydo-ai-limits' },
          ...limits.map((item, index) => h2('li', { key: `${index}-${String(item).slice(0, 6)}` }, item))),
        hasResult && aiText(result.disclaimer)
          ? h2('p', { className: 'ydo-ai-disclaimer' }, `${t('aiDisclaimer')}：${result.disclaimer}`)
          : null))),

    confirming
      ? h2('div', { className: 'ydo-confirm-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('aiConfirmTitle') },
        h2('div', { className: 'ydo-confirm' },
          h2('p', { className: 'ydo-confirm-title' }, t('aiConfirmTitle')),
          h2('p', { className: 'ydo-hint' }, t('aiConfirmBody')),
          h2('div', { className: 'ydo-confirm-actions' },
            h2('button', { type: 'button', className: 'ydo-confirm-primary', onClick: onConfirmRerun }, t('aiConfirmYes')),
            h2('button', { type: 'button', className: 'ydo-confirm-secondary', onClick: onCancelConfirm }, t('aiConfirmNo')))))
      : null)
}

/**
 * AI 账号表现分析弹框（需求 2，2026-09-18）：内容与 AiAnalysisSection 完全一致
 * （状态行、开始/重新分析、二次确认、六张折叠卡），仅把展示容器从页面内嵌
 * 面板改为独立弹框层（z-index 530，低于作品详情 540——弹框内点证据作品时
 * 详情叠加在分析页与弹框之上）。开关由 client.js 持有，接入统一 Esc 链。
 */
function AiAnalysisModal({ open, onClose, t, ...sectionProps }) {
  if (!open) return null
  return h2('div', { className: 'ydo-ai-modal-overlay' },
    h2('div', { className: 'ydo-ai-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('aiTitle') },
      h2('button', {
        type: 'button', className: 'ydo-ai-modal-close', onClick: onClose, 'aria-label': t('close'),
      }, '✕'),
      h2('div', { className: 'ydo-ai-modal-body' },
        h2(AiAnalysisSection, { ...sectionProps, t }))))
}

function payloadTime(value) {
  if (!value || value === '—') return null
  try {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    const pad = n => String(n).padStart(2, '0')
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  } catch {
    return String(value)
  }
}

/**
 * 单账号分析页（账号总览 Tab 内的下钻页，方案 §6）。
 *
 * @param {{ analysis: object|null, trend: object|null, trendMetric: string,
 *   loading: bool, errorReason: string|null, exporting: bool,
 *   onBack: Function, onMetricChange: Function, onExport: Function,
 *   onOpenWork: Function, t: Function }} props
 */
export function AnalysisPage({
  analysis, trend, trendMetric, trendErrorReason, loading, errorReason, exporting,
  rangeLabel = null, onBack, onMetricChange, onExport, onOpenWork, t,
  aiAnalysis = null, aiStatus = 'not_analyzed', aiBusy = false, aiError = null, aiConfirming = false,
  onAiStart = null, onAiRequestRerun = null, onAiConfirmRerun = null, onAiCancelConfirm = null,
  aiModalOpen = false, onAiModalOpen = null, onAiModalClose = null,
}) {
  // 需求 5b：容器实测宽驱动 viewBox（初始 600 兜底，挂载后 ResizeObserver 校正）。
  // hook 必须在下方任何早退 return 之前调用（Rules of Hooks）；完整渲染分支把
  // trendWrapRef（callback ref）挂到趋势容器上，早退分支不渲染容器即无观察目标。
  const [trendWrapRef, trendWidth] = useMeasuredWidth()
  if (errorReason) {
    return h2('div', { className: 'ydo-state ydo-state-error', role: 'alert' },
      h2('p', null, t(ANALYSIS_ERROR_REASON_COPY[errorReason] || 'operationUnavailable')),
      h2('button', { type: 'button', className: 'ydo-secondary', onClick: onBack }, t('backToOverview')))
  }
  const account = analysis?.account || null
  if (!loading && !account) {
    return h2('div', { className: 'ydo-state', role: 'status' }, h2('p', null, t('none')))
  }
  const kpi = analysis?.kpi || {}
  const layout = trendLayout(trend?.points || [], { width: trendWidth })

  return h2('div', { className: 'ydo-an-page' },
    h2('div', { className: 'ydo-an-toolbar' },
      h2('button', { type: 'button', className: 'ydo-secondary', onClick: onBack }, t('backToOverview')),
      // 「AI 分析」入口在「导出账号分析报告」前（需求 2）：打开 AI 分析弹框，
      // 内容与原内嵌 AI 卡完全一致。
      h2('button', {
        type: 'button', className: 'ydo-secondary',
        onClick: () => { if (onAiModalOpen) onAiModalOpen() },
      }, t('aiEntryButton')),
      // "导出账号分析报告"只在单账号分析页局部工具栏（方案 §10.3）。
      h2('button', {
        type: 'button', className: 'ydo-secondary ydo-export',
        disabled: exporting, 'aria-busy': exporting, onClick: onExport,
      },
      h2(IconDownloadOutline16, { size: 14 }),
      h2('span', null, exporting ? t('exporting') : t('exportAnalysis')))),

    account ? h2('header', { className: 'ydo-an-head' },
      // 标题统一「账号：{名称}」（UI 优化方案 §5.1），与返回/导出按钮同属工具栏层级。
      // v2 §5.1：删除「会话状态」行与规则版本/样本信息；会话过期、可疑空采集等
      // 可行动状态仍经 renderHeadAlerts 以短标签呈现；作品数带统一时间范围。
      h2('h3', null, t('accountTitle').replace('{name}', account.nickname || account.accountId)),
      h2('p', { className: 'ydo-hint' },
        `${t('fanCount')} ${count(account.fanCount)} · ${t('workCount')} ${count(analysis?.summary?.workCount)}`
        + (rangeLabel ? `（${rangeLabel}）` : '')
        + ` · ${t('latestCollected')} ${formatDateTime(account.lastCollectedAt) === '—' ? t('noRecord') : formatDateTime(account.lastCollectedAt)}`),
      renderHeadAlerts(analysis, t)) : null,

    account ? h2('div', { className: 'ydo-ov-kpis' },
      h2(Kpi, { label: t('kpiTotalPlay'), value: count(kpi.totalPlayCount) }),
      h2(Kpi, { label: t('colMedianPlay'), value: count(kpi.medianPlayCount) }),
      h2(Kpi, { label: t('colHighestPlay'), value: count(kpi.maxPlayCount) }),
      h2(Kpi, { label: t('kpiHotWorks'), value: count(kpi.hotWorkCount) }),
      h2(Kpi, { label: t('hotRateCol'), value: pct(kpi.hotRatePct) })) : null,

    account ? h2('section', { className: 'ydo-ov-panel' },
      h2('div', { className: 'ydo-ov-toolbar' },
        h2('h3', null, t('trendTitle')),
        h2('div', { className: 'ydo-ov-filter' },
          h2('span', null, t('trendMetric')),
          h2(FilterSelect, {
            label: t('trendMetric'),
            value: trendMetric,
            onChange: value => onMetricChange && onMetricChange(value),
            options: TREND_METRICS.map(metric => ({ value: metric, label: t(`metric_${metric}`) })),
          }))),
      h2('p', { className: 'ydo-hint' }, t('trendCaption')),
      trendErrorReason
        ? h2('p', { className: 'ydo-error', role: 'alert' },
          t(ANALYSIS_ERROR_REASON_COPY[trendErrorReason] || 'operationUnavailable'))
        : null,
      // 测宽容器（需求 5b）：包裹趋势图（含单点分支），ref 供 ResizeObserver
      // 读取实际内容宽度驱动 viewBox。
      h2('div', { ref: trendWrapRef },
        !layout.renderable || layout.single
          ? h2('p', { className: 'ydo-hint' },
            layout.single ? t('trendSingleHint') : t('noTrend'),
            layout.single && layout.nodes.length
              ? h2(TrendChart, { layout, t })
              : null)
          : h2(TrendChart, { layout, t })))
      : null,

    account ? h2('div', { className: 'ydo-ov-panels' },
      h2('section', { className: 'ydo-ov-panel' },
        h2('h3', null, t('contentMetrics')),
        // 固定指标清单改浅灰底圆角卡片网格（创作中心风格，需求 1）：标签小字在上、
        // 数据状态小徽标同排右侧、数值大字加粗在下；缺失值显示 —，真实的 0 保持
        // 为 0，服务端未返回的段显式「数据不足」，数值口径不变。
        h2('div', { className: 'ydo-an-metrics', role: 'list' },
          ...contentMetricRows(analysis, t).map(row => h2('div', { key: row.key, className: 'ydo-an-metric-card', role: 'listitem' },
            h2('div', { className: 'ydo-an-metric-head' },
              h2('span', { className: 'ydo-an-metric-label' }, row.label),
              row.note ? h2('span', { className: 'ydo-an-metric-note' }, row.note) : null),
            h2('strong', { className: 'ydo-an-metric-value' }, row.value))))),
      h2('section', { className: 'ydo-ov-panel' },
        h2('h3', null, t('audienceTraffic')),
        // 观众与流量（UI 优化方案 v2 §5.3）：性别/年龄/地域/城市级别/主要来源
        // 统一为同样的卡片；评论热词和加权说明不再展示。
        audienceGrid(analysis, t))) : null,

    account ? h2('section', { className: 'ydo-ov-panel' },
      h2('h3', null, t('accountHotWorks')),
      hotWorksTable(analysis, onOpenWork, t))
      : null,

    // AI 账号表现分析弹框（需求 2）：默认关闭；内容由 AiAnalysisSection 提供，
    // 功能与原内嵌卡完全一致；开关状态由 client.js 持有以接入统一 Esc 链。
    account ? h2(AiAnalysisModal, {
      key: 'ai-modal',
      open: aiModalOpen,
      onClose: () => { if (onAiModalClose) onAiModalClose() },
      ai: aiAnalysis,
      aiStatus,
      busy: aiBusy,
      error: aiError,
      confirming: aiConfirming,
      onStart: onAiStart,
      onRequestRerun: onAiRequestRerun,
      onConfirmRerun: onAiConfirmRerun,
      onCancelConfirm: onAiCancelConfirm,
      onOpenWork,
      t,
    }) : null)
}

// 稳定 reason → 已登记文案键（与 overview-ui 同一策略）。
export const ANALYSIS_ERROR_REASON_COPY = Object.freeze({
  ACCOUNT_NOT_ACCESSIBLE: 'accountNotAccessible',
  RULE_VERSION_MISMATCH: 'ruleVersionMismatch',
  CONTRACT_VERSION_MISMATCH: 'contractVersionMismatch',
  TREND_RANGE_TOO_LARGE: 'trendRangeTooLarge',
  INVALID_TIME_WINDOW: 'refreshFailed',
  INVALID_METRIC: 'refreshFailed',
  export_too_large: 'exportTooLarge',
  export_failed: 'exportFailed',
  douyin_operation_request_failed: 'operationUnavailable',
})
