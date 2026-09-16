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

// React 由 client.js 内联作用域提供（构建时剥离本模块的 require，与 overview-ui 同法）。
let __react = null
function react() {
  if (!__react) __react = require('react')
  return __react
}

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

// 趋势图坐标（本地展示几何，非口径）：按真实 elapsedSeconds 比例定位横轴
//（审查 O3——横轴与 gap 都从 elapsedSeconds 派生；缺失时退回日历日差兜底）。
export function trendLayout(points, { width = 600 } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return { renderable: false, nodes: [] }
  }
  const dayMs = points.map(point => Date.parse(point.day))
  // 相邻点时间跨度：优先 elapsedSeconds（真实采集跨度），缺失退回日历日差。
  const spans = points.map((point, index) => {
    if (index === 0) return 0
    if (Number.isFinite(Number(point.elapsedSeconds))) return Number(point.elapsedSeconds)
    return Math.max(0, dayMs[index] - dayMs[index - 1])
  })
  let cumulative = 0
  const offsets = points.map((_, index) => {
    cumulative += spans[index]
    return cumulative
  })
  const span = offsets[offsets.length - 1]
  const values = points.map(point => Number(point.value)).filter(value => Number.isFinite(value))
  const maxValue = Math.max(...values, 1)
  const nodes = points.map((point, index) => ({
    index,
    day: point.day,
    value: point.value,
    counterRevised: point.counterRevised === true,
    // 前一 gap 天数（首点为 0）：日历差口径，用于渲染显式断点"无采集"标注。
    gapDaysBefore: index === 0
      ? 0
      : Math.max(0, Math.round((dayMs[index] - dayMs[index - 1]) / 86400000) - 1),
    x: Math.round((offsets[index] / (span || 1)) * width),
    yPct: Math.round((Number(point.value) / maxValue) * 100),
    elapsedSeconds: point.elapsedSeconds,
  }))
  return { renderable: true, nodes, maxValue }
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

// 观众画像（UI 优化方案 v2 §5.3）：只保留年龄/地域/城市级别/主要来源四块 2×2 网格；
// 性别如有数据作为卡片头部一行摘要，不单独占块；评论热词不再出现在本页
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
  // 每块：标题 + 前三项横向条形 + 「按播放量加权」说明；无数据的维度显示数据不足，
  // 不渲染空进度条。
  return h2('div', { className: 'ydo-an-audience-block' },
    h2('h4', null, label),
    rows.length ? h2(AudienceBarList, { rows }) : h2('p', { className: 'ydo-hint' }, t('dataInsufficient')),
    h2('p', { className: 'ydo-hint' }, t('weightedNote')))
}

function audienceGrid(analysis, t) {
  const audience = analysis?.audience
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
    h2(AudienceBlock, { key: 'age', label: t('mainAge'), rows: ageRows, t }),
    h2(AudienceBlock, { key: 'province', label: t('mainRegion'), rows: provinceRows, t }),
    h2(AudienceBlock, { key: 'city_level', label: t('cityLevel'), rows: cityRows, t }),
    h2(AudienceBlock, { key: 'traffic', label: t('mainTrafficSource'), rows: trafficRows, t }))
}

// 性别头部摘要（v2 §5.3）：有数据时在观众卡顶部占一行，不单独占块。
function genderSummaryLine(analysis, t) {
  const top = ((analysis?.audience?.dimensions?.gender?.distributions) || [])[0]
  if (!top) return null
  return h2('p', { className: 'ydo-hint' }, `${t('mainGender')}：${genderLabel(top.key, t)} ${pct(top.pct)}`)
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
  // 第三段「状态/覆盖率」（UI 优化方案 v2 §5.2）：覆盖率缺失或为 0 → 数据不足；
  // 0<x<100 → 部分数据 + 覆盖率；覆盖完整 → 不显示状态（「覆盖率 100.0%」是噪音）。
  // 真实数值 0 永远照常渲染，不因隐藏覆盖率变成空值。
  const coverage = Number(item && item.coveragePct)
  if (!Number.isFinite(coverage) || coverage <= 0) return t('dataInsufficient')
  if (coverage < 100) return `${t('dataPartial')} · ${t('coverage')} ${pct(item.coveragePct)}`
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
      h2('span', { role: 'columnheader' }, t('hotBasis'))),
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
}) {
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
  const layout = trendLayout(trend?.points || [])

  return h2('div', { className: 'ydo-an-page' },
    h2('div', { className: 'ydo-an-toolbar' },
      h2('button', { type: 'button', className: 'ydo-secondary', onClick: onBack }, t('backToOverview')),
      // "导出账号分析报告"只在单账号分析页局部工具栏（方案 §10.3）。
      h2('button', {
        type: 'button', className: 'ydo-secondary ydo-export',
        disabled: exporting, 'aria-busy': exporting, onClick: onExport,
      }, exporting ? t('exporting') : t('exportAnalysis'))),

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
        h2('label', { className: 'ydo-ov-filter' },
          t('trendMetric'),
          h2('select', {
            value: trendMetric,
            onChange: event => onMetricChange && onMetricChange(event.target.value),
          },
          ...TREND_METRICS.map(metric => h2('option', { key: metric, value: metric }, t(`metric_${metric}`)))))),
      h2('p', { className: 'ydo-hint' }, t('trendCaption')),
      trendErrorReason
        ? h2('p', { className: 'ydo-error', role: 'alert' },
          t(ANALYSIS_ERROR_REASON_COPY[trendErrorReason] || 'operationUnavailable'))
        : null,
      layout.renderable
        ? h2('div', { className: 'ydo-an-trend', role: 'img', 'aria-label': t('trendTitle') },
          ...layout.nodes.map(node => h2('div', {
            key: node.day,
            className: 'ydo-an-point',
            style: { left: `${Math.min(96, Math.max(2, (node.x / 600) * 100))}%` },
            title: `${node.day} ${count(node.value)}`,
            'data-day': node.day,
          },
          node.gapDaysBefore > 0 ? h2('span', { className: 'ydo-an-gap' }, `${t('noCollectGap')} ${node.gapDaysBefore}d`) : null,
          node.counterRevised ? h2('span', { className: 'ydo-an-revised' }, t('counterRevised')) : null,
          h2('span', { className: 'ydo-an-dot' }))))
        : h2('p', { className: 'ydo-hint' }, t('noTrend')))
      : null,

    account ? h2('div', { className: 'ydo-ov-panels' },
      h2('section', { className: 'ydo-ov-panel' },
        h2('h3', null, t('contentMetrics')),
        // 固定指标清单：「指标名 / 主值 / 状态或覆盖率」三段（UI 优化方案 §5.3）；
        // 缺失值显示 —，真实的 0 保持为 0，服务端未返回的段显式「数据不足」。
        h2('ul', { className: 'ydo-an-metrics' },
          ...contentMetricRows(analysis, t).map(row => h2('li', { key: row.key },
            h2('span', { className: 'ydo-an-metric-label' }, row.label),
            h2('span', { className: 'ydo-an-metric-value' }, row.value),
            row.note ? h2('span', { className: 'ydo-an-metric-note' }, row.note) : null)))),
      h2('section', { className: 'ydo-ov-panel' },
        h2('h3', null, t('audienceTraffic')),
        // 观众与流量（UI 优化方案 v2 §5.3）：性别头部摘要 + 年龄/地域/城市级别/主要来源
        // 四块 2×2 网格；评论热词不再展示；参与作品数集中在卡片底部一行。
        genderSummaryLine(analysis, t),
        audienceGrid(analysis, t),
        analysis?.audience?.sampleWorkCount
          ? h2('p', { className: 'ydo-hint' },
            t('weightedSample').replace('{count}', String(analysis.audience.sampleWorkCount)))
          : null)) : null,

    account ? h2('section', { className: 'ydo-ov-panel' },
      h2('h3', null, t('accountHotWorks')),
      hotWorksTable(analysis, onOpenWork, t))
      : null)
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
