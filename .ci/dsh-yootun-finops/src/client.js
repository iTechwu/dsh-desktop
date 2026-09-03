const React = require('react')
const { createElement: h, useEffect, useState, useRef, useSyncExternalStore } = React
const {
  IconAlarmClockOutline16,
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconDataOutline16,
  IconDatabaseOutline16,
  IconEnhanceOutline16,
  IconGoalOutline16,
  IconLoadingOutline16,
  IconRefreshOutline16,
  IconSparkle16,
  IconWarningOutline16,
  Tooltip,
} = require('@deepseek-ai/dsh-client-ui-primitives')

const NS = 'dofe.yootun-finops'
const OVERLAY_ID = '@dofe/dsh-yootun-finops'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const PATH = '/api/desktop/yootun/finops'
const SERIES_PATH = '/api/desktop/yootun/finops/series'
const RANGES = [['realtime', 'realtime'], ['yesterday', 'yesterday'], ['week', 'week']]
const SERIES_DAYS = [[7, 'days7'], [30, 'days30']]
const TABS = [['overview', 'overview'], ['trend', 'trend'], ['models', 'modelsTab'], ['budget', 'budgetTab']]
const COMPARISON_KEYS = [['cost', 'cost'], ['requests', 'requestCount'], ['totalTokens', 'tokens'], ['successfulRequests', 'successRequests']]

const copy = {
  zh: {
    open: '模型与预算', title: '模型与预算治理', subtitle: '模型使用、预算健康与异常趋势', close: '关闭模型与预算', refresh: '刷新数据',
    realtime: '实时', yesterday: '昨日', week: '本周', overview: '总览', trend: '使用趋势', modelsTab: '模型明细', budgetTab: '预算治理',
    source: '数据源', sourceReady: '已连接', sourceEmpty: '暂无消费', sourceUnavailable: '不可用', sourceError: '读取失败', sourceWarning: '部分可用', reason: '原因',
    spend: '消费金额', requests: '模型请求', tokens: '总 Token', successRate: '成功率', successRequests: '成功请求', budgetUsage: '预算使用率', alerts: '异常告警',
    noData: '当前范围暂无消费', noBudget: '预算未配置', noAlerts: '当前没有待处理告警', noBaseline: '暂无基线', loading: '正在更新模型数据...', retry: '重新加载',
    modelMix: '模型构成', modelTable: '模型明细表', input: '输入 Token', output: '输出 Token', amount: '费用', avgCost: '单请求费用', share: '费用占比',
    trendTitle: '费用与请求趋势', trendHint: '费用来自 Models accounting；日桶与时区由服务端计算', date: '日期', cost: '费用', requestCount: '请求',
    days7: '近7天', days30: '近30天', comparison: '较上一周期', latency: 'P50 延迟',
    routeMix: '路由构成', budgetTitle: '预算健康', used: '已使用', remaining: '剩余',
    budgetHealthy: '健康', budgetWarning: '注意', budgetCritical: '临界', budgetExceeded: '已超出', budgetSourceDown: '预算数据不可用',
    budgetNote: '预算来自 Models BudgetConfig，阈值由服务端返回；未展示推算额度或预测耗尽日期',
    configureBudget: '当前 Key 没有生效中的预算配置；配置预算后此处展示额度与使用率',
    attention: '需要关注', updated: '更新于', period: '统计范围', attribution: '归属', attributionUnknown: '归属未提供', timeZone: '时区',
    partial: '部分字段', unavailable: '数据不可用', details: '详情', privacy: '仅展示聚合指标，不展示提示词、回答或密钥。', currency: '币种', metricUnavailable: '不可用',
  },
  en: {
    open: 'Model & budget', title: 'Model & budget governance', subtitle: 'Model usage, budget health, and trends', close: 'Close model & budget', refresh: 'Refresh data',
    realtime: 'Realtime', yesterday: 'Yesterday', week: 'This week', overview: 'Overview', trend: 'Usage trends', modelsTab: 'Model detail', budgetTab: 'Budget governance',
    source: 'Source', sourceReady: 'Connected', sourceEmpty: 'No spend', sourceUnavailable: 'Unavailable', sourceError: 'Request failed', sourceWarning: 'Partially available', reason: 'Reason',
    spend: 'Spend', requests: 'Model requests', tokens: 'Total tokens', successRate: 'Success rate', successRequests: 'Successful', budgetUsage: 'Budget used', alerts: 'Alerts',
    noData: 'No spend in this range', noBudget: 'No budget configured', noAlerts: 'No alerts need attention', noBaseline: 'No baseline', loading: 'Refreshing model data...', retry: 'Try again',
    modelMix: 'Model mix', modelTable: 'Model detail table', input: 'Input tokens', output: 'Output tokens', amount: 'Cost', avgCost: 'Cost per request', share: 'Cost share',
    trendTitle: 'Spend and request trend', trendHint: 'Spend comes from Models accounting; day buckets and timezone are server-computed', date: 'Date', cost: 'Cost', requestCount: 'Requests',
    days7: 'Last 7 days', days30: 'Last 30 days', comparison: 'vs previous period', latency: 'P50 latency',
    routeMix: 'Route mix', budgetTitle: 'Budget health', used: 'Used', remaining: 'Remaining',
    budgetHealthy: 'Healthy', budgetWarning: 'Warning', budgetCritical: 'Critical', budgetExceeded: 'Exceeded', budgetSourceDown: 'Budget data unavailable',
    budgetNote: 'Budgets come from Models BudgetConfig with server-side thresholds; no estimates or exhaustion forecasts are shown',
    configureBudget: 'No active budget config for this key; configure one to see limits and usage here',
    attention: 'Needs attention', updated: 'Updated', period: 'Range', attribution: 'Attribution', attributionUnknown: 'Not provided', timeZone: 'Timezone',
    partial: 'Partial fields', unavailable: 'Data unavailable', details: 'Details', privacy: 'Aggregates only; prompts, answers, and credentials are excluded.', currency: 'Currency', metricUnavailable: 'Unavailable',
  },
}

let opened = false
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
const setOpened = value => { opened = value; emit() }
const openOverlay = () => { window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } })); setOpened(true) }
const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => opened

async function load(range, signal) {
  const response = await fetch(`${PATH}?range=${encodeURIComponent(range)}`, { credentials: 'same-origin', signal, redirect: 'error', headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('finops request failed')
  return response.json()
}

async function loadSeries(days, signal) {
  const response = await fetch(`${SERIES_PATH}?days=${encodeURIComponent(days)}`, { credentials: 'same-origin', signal, redirect: 'error', headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('finops series request failed')
  return response.json()
}

function finite(value) { const parsed = Number(value); return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null }
function formatNumber(value) { const parsed = finite(value); return parsed === null ? null : new Intl.NumberFormat(undefined, { notation: parsed >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(parsed) }
function formatMoney(value, currency = 'CNY') { const parsed = finite(value); if (parsed === null) return null; try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(parsed) } catch { return `${currency} ${parsed.toFixed(2)}` } }
function percent(value, total) { const numerator = finite(value), denominator = finite(total); return numerator !== null && denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : null }
function shortTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date) : '' }
function sourceLabel(status, t) { return status === 'ready' ? t('sourceReady') : status === 'empty' ? t('sourceEmpty') : status === 'warning' ? t('sourceWarning') : status === 'error' ? t('sourceError') : t('sourceUnavailable') }
function iconFor(status) { return status === 'ready' ? 'check' : status === 'empty' ? 'database' : status === 'warning' ? 'warning' : 'close' }
function budgetStatusLabel(status, t) {
  return status === 'healthy' ? t('budgetHealthy') : status === 'warning' ? t('budgetWarning')
    : status === 'critical' ? t('budgetCritical') : status === 'exceeded' ? t('budgetExceeded') : t('metricUnavailable')
}
function budgetStatusIcon(status) { return status === 'healthy' ? 'check' : status === 'unavailable' ? 'close' : 'warning' }

function Glyph({ name, size = 16, className }) {
  const icons = { check: IconCheckOutline16, database: IconDatabaseOutline16, warning: IconWarningOutline16, close: IconCloseOutline16, refresh: IconRefreshOutline16, data: IconDataOutline16, sparkle: IconSparkle16, goal: IconGoalOutline16, clock: IconAlarmClockOutline16, layers: IconEnhanceOutline16, chevron: IconChevronRightOutline14, loading: IconLoadingOutline16 }
  const Icon = icons[name]
  return Icon ? h(Icon, { size, className }) : null
}

function SourceBadge({ source, t }) {
  const status = source?.status || 'unavailable'
  return h('span', { className: `yf-source-badge yf-source-${status}` }, h(Glyph, { name: iconFor(status), size: 13 }), sourceLabel(status, t), source?.sourceCompleteness === 'partial' ? h('small', null, ` · ${t('partial')}`) : null)
}

function EmptyState({ title, source, t }) {
  const meta = [source?.reason ? `${t('reason')}: ${source.reason}` : null, source?.missingFields?.length ? `${t('partial')}: ${source.missingFields.join(', ')}` : null].filter(Boolean)
  return h('div', { className: `yf-empty yf-empty-${source?.status || 'unavailable'}`, role: source?.status === 'error' ? 'alert' : undefined }, h(Glyph, { name: iconFor(source?.status), size: 20 }), h('strong', null, title), meta.length ? h('details', null, h('summary', null, t('details')), h('code', null, meta.join(' · '))) : null)
}

function StatusBadge({ status, t }) {
  return h('span', { className: `yf-status-badge yf-status-${status}` }, h(Glyph, { name: budgetStatusIcon(status), size: 12 }), budgetStatusLabel(status, t))
}

function Metric({ icon, label, value, hint, muted }) {
  return h('article', { className: `yf-metric${muted ? ' yf-metric-muted' : ''}` }, h('div', { className: 'yf-metric-label' }, h(Glyph, { name: icon, size: 15 }), h('span', null, label)), h('strong', null, value ?? '—'), hint ? h('small', null, hint) : null)
}

function RangeControl({ range, onChange, t }) {
  return h('div', { className: 'yf-range-control', role: 'group', 'aria-label': t('period') }, ...RANGES.map(([id, key]) => h('button', { type: 'button', key: id, className: range === id ? 'is-active' : '', 'aria-pressed': range === id, onClick: () => onChange(id) }, t(key))))
}

function DaysControl({ days, onChange, t }) {
  return h('div', { className: 'yf-range-control yf-range-small', role: 'group', 'aria-label': t('trendTitle') }, ...SERIES_DAYS.map(([value, key]) => h('button', { type: 'button', key: value, className: days === value ? 'is-active' : '', 'aria-pressed': days === value, onClick: () => onChange(value) }, t(key))))
}

function TrendChart({ series, currency, t }) {
  const points = (series || []).map(row => ({ ...row, cost: finite(row.cost) }))
  const values = points.map(row => row.cost).filter(value => value !== null)
  if (!points.length || !values.length) return h(EmptyState, { title: t('noData'), source: { status: 'empty' }, t })
  const width = 720, height = 220, left = 42, right = 12, top = 18, bottom = 32, max = Math.max(...values, 1)
  const x = index => points.length <= 1 ? width / 2 : left + index * ((width - left - right) / (points.length - 1))
  const y = value => top + (height - top - bottom) * (1 - value / max)
  const line = points.map((row, index) => row.cost === null ? null : `${x(index)},${y(row.cost)}`).filter(Boolean).join(' ')
  return h('div', { className: 'yf-chart-wrap' },
    h('svg', { className: 'yf-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('trendTitle') },
      ...[0, .5, 1].map((ratio, index) => h('line', { key: `grid-${index}`, x1: left, x2: width - right, y1: y(max * ratio), y2: y(max * ratio), className: 'yf-grid-line' })),
      h('polyline', { points: line, className: 'yf-chart-line', fill: 'none' }),
      ...points.map((row, index) => row.cost === null ? null : h('circle', { key: row.date, cx: x(index), cy: y(row.cost), r: 4, className: 'yf-chart-dot' })),
      ...points.map((row, index) => h('text', { key: `label-${row.date}`, x: x(index), y: height - 10, className: 'yf-chart-label', textAnchor: 'middle' }, String(row.date || '').slice(5)))),
    h('table', { className: 'yf-chart-table' },
      h('thead', null, h('tr', null, h('th', null, t('date')), h('th', null, t('cost')), h('th', null, t('requestCount')), h('th', null, t('tokens')), points.some(row => finite(row.successfulRequests) !== null) ? h('th', null, t('successRate')) : null, points.some(row => finite(row.latencyP50Ms) !== null) ? h('th', null, t('latency')) : null)),
      h('tbody', null, ...points.map(row => h('tr', { key: `${row.date}-row` },
        h('td', null, row.date || '—'),
        h('td', null, row.cost === null ? '—' : formatMoney(row.cost, currency)),
        h('td', null, formatNumber(row.requests) || '—'),
        h('td', null, formatNumber(row.totalTokens) || '—'),
        points.some(item => finite(item.successfulRequests) !== null) ? h('td', null, percent(row.successfulRequests, row.requests) || '—') : null,
        points.some(item => finite(item.latencyP50Ms) !== null) ? h('td', null, finite(row.latencyP50Ms) === null ? '—' : `${formatNumber(row.latencyP50Ms)}ms`) : null)))))
}

function ComparisonChips({ comparison, currency, t }) {
  if (!comparison || comparison.status !== 'ready') {
    return h('span', { className: 'yf-compare-na' }, `${t('comparison')}: ${t('noBaseline')}`)
  }
  return h('div', { className: 'yf-compare' }, h('span', { className: 'yf-compare-label' }, t('comparison')),
    ...COMPARISON_KEYS.map(([key, label]) => {
      const field = comparison.fields?.[key]
      if (!field || field.delta === null) return h('span', { className: 'yf-compare-chip', key }, `${t(label)} —`)
      const direction = field.delta > 0 ? 'up' : field.delta < 0 ? 'down' : 'flat'
      const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'
      const magnitude = field.deltaPercent !== null ? `${Math.abs(field.deltaPercent)}%` : formatMoney(Math.abs(field.delta), currency) || '—'
      return h('span', { className: `yf-compare-chip yf-compare-${direction}`, key }, `${t(label)} ${arrow} ${magnitude}`)
    }))
}

function ModelMix({ models, summary, currency, t }) {
  const rows = Array.isArray(models) ? models : []
  const totalCost = finite(summary?.cost) || rows.reduce((sum, row) => sum + (finite(row.costValue) || 0), 0)
  return h('section', { className: 'yf-panel' }, h('div', { className: 'yf-panel-heading' }, h('h2', null, t('modelMix')), h('span', null, `${rows.length} ${t('modelsTab')}`)), rows.length ? h('div', { className: 'yf-model-list' }, ...rows.map(row => { const share = percent(row.costValue, totalCost); return h('div', { className: 'yf-model-row', key: row.id }, h('div', { className: 'yf-model-head' }, h('strong', null, row.name), h('span', null, share || '—')), h('div', { className: 'yf-bar-track' }, h('div', { className: 'yf-bar-fill', style: { width: share || '0%' } })), h('div', { className: 'yf-model-meta' }, h('span', null, `${formatMoney(row.costValue, currency) || '—'} · ${formatNumber(row.requests) || '—'} ${t('requests')}`), h('span', null, `${t('avgCost')} ${formatMoney(row.costPerRequest, currency) || '—'}`))) })) : h(EmptyState, { title: t('noData'), source: { status: 'empty' }, t }))
}

function ModelTable({ models, currency, t }) {
  const rows = Array.isArray(models) ? models : []
  if (!rows.length) return h(EmptyState, { title: t('noData'), source: { status: 'empty' }, t })
  return h('table', { className: 'yf-table' },
    h('thead', null, h('tr', null, h('th', null, t('modelsTab')), h('th', null, t('amount')), h('th', null, t('requestCount')), h('th', null, t('input')), h('th', null, t('output')), h('th', null, t('avgCost')), h('th', null, t('successRate')))),
    h('tbody', null, ...rows.map(row => h('tr', { key: row.id },
      h('td', null, row.name),
      h('td', null, formatMoney(row.costValue, currency) || '—'),
      h('td', null, formatNumber(row.requests) || '—'),
      h('td', null, formatNumber(row.inputTokens) || '—'),
      h('td', null, formatNumber(row.outputTokens) || '—'),
      h('td', null, formatMoney(row.costPerRequest, currency) || '—'),
      // Per-model success counts are not exposed by the Models usage API; the
      // summary-level rate stays on the overview card instead of guessing here.
      h('td', null, '—')))))
}

function RouteMix({ byRoute, currency, t }) {
  const rows = Array.isArray(byRoute) ? byRoute : []
  const totalCost = rows.reduce((sum, item) => sum + (finite(item.cost) || 0), 0)
  return h('section', { className: 'yf-panel' }, h('div', { className: 'yf-panel-heading' }, h('h2', null, t('routeMix')), h('span', null, `${rows.length}`)),
    rows.length ? h('div', { className: 'yf-model-list' }, ...rows.map(row => {
      const share = percent(row.cost, totalCost)
      return h('div', { className: 'yf-model-row', key: row.route }, h('div', { className: 'yf-model-head' }, h('strong', null, row.route), h('span', null, share || '—')), h('div', { className: 'yf-bar-track' }, h('div', { className: 'yf-bar-fill', style: { width: share || '0%' } })), h('div', { className: 'yf-model-meta' }, h('span', null, `${formatMoney(row.cost, currency) || '—'} · ${formatNumber(row.requests) || '—'} ${t('requests')}`), h('span', null, `${t('successRate')} ${percent(row.successfulRequests, row.requests) || '—'}`)))
    })) : h(EmptyState, { title: t('noData'), source: { status: 'empty' }, t }))
}

function BudgetItem({ item, t }) {
  const ratio = item.usageRatio
  return h('div', { className: 'yf-budget-item', key: item.name },
    h('div', { className: 'yf-model-head' }, h('strong', null, item.name), h(StatusBadge, { status: item.status, t })),
    h('div', { className: 'yf-bar-track' }, ratio === null ? null : h('div', { className: `yf-bar-fill yf-budget-${item.status}`, style: { width: `${Math.min(ratio, 1) * 100}%` } })),
    h('div', { className: 'yf-budget-meta' },
      h('span', null, `${t('used')} ${formatMoney(item.used, item.currency) || '—'} / ${formatMoney(item.limit, item.currency) || '—'}`),
      h('span', null, ratio === null ? '—' : `${Math.round(ratio * 100)}% · ${item.period}`)))
}

function BudgetPanel({ budget, t }) {
  const heading = h('div', { className: 'yf-panel-heading' }, h('h2', null, t('budgetTitle')), h(Glyph, { name: 'goal' }))
  if (!budget || budget.status !== 'ready') {
    const title = budget && budget.status === 'unavailable' ? t('budgetSourceDown') : t('noBudget')
    return h('section', { className: 'yf-panel yf-budget-panel' }, heading,
      h(EmptyState, { title, source: budget && budget.status === 'unavailable' ? budget : { status: 'empty' }, t }),
      h('p', { className: 'yf-panel-note' }, t('configureBudget')))
  }
  return h('section', { className: 'yf-panel yf-budget-panel' }, heading,
    h('div', { className: 'yf-budget-list' }, ...budget.items.map(item => h(BudgetItem, { item, t }))),
    h('p', { className: 'yf-panel-note' }, t('budgetNote')))
}

// Worst-first budget usage for the overview KPI card; server-computed ratios only.
function budgetKpi(budget, t) {
  if (budget && budget.status === 'ready' && budget.items.length) {
    const worst = budget.items.filter(item => item.usageRatio !== null).sort((left, right) => right.usageRatio - left.usageRatio)[0]
    if (worst) return { value: `${Math.round(worst.usageRatio * 100)}%`, hint: `${worst.name} · ${budgetStatusLabel(worst.status, t)}`, muted: false }
    return { value: t('metricUnavailable'), hint: t('noBaseline'), muted: true }
  }
  if (budget && budget.status === 'unavailable') return { value: t('metricUnavailable'), hint: t('budgetSourceDown'), muted: true }
  return { value: t('noBudget'), hint: t('configureBudget'), muted: true }
}

function AlertPanel({ alerts, source, t }) {
  const rows = Array.isArray(alerts) ? alerts : []
  return h('section', { className: 'yf-panel' }, h('div', { className: 'yf-panel-heading' }, h('h2', null, t('attention')), h(Glyph, { name: 'warning' })), rows.length ? h('div', { className: 'yf-alert-list' }, ...rows.map(row => h('div', { className: 'yf-alert-row', key: row.id || row.title }, h(Glyph, { name: 'warning', size: 15 }), h('div', null, h('strong', null, row.title || t('alerts')), h('span', null, row.status || '—')), h(Glyph, { name: 'chevron', size: 13 })))) : h(EmptyState, { title: source?.status === 'error' ? t('unavailable') : t('noAlerts'), source: source?.status === 'error' ? source : { status: 'empty' }, t }))
}

function Overview({ data, t }) {
  const summary = data?.summary || {}, source = data?.source || { status: 'unavailable' }, currency = summary.currency || 'CNY', success = percent(summary.successfulRequests, summary.requests)
  const budget = budgetKpi(data?.budget, t)
  return h('div', { className: 'yf-overview' },
    h('div', { className: 'yf-status-line' }, h(SourceBadge, { source, t }), h('span', null, `${t('updated')} ${shortTime(source.asOf || data?.refreshedAt)}`), h('span', null, `${t('attribution')}: ${data?.attribution || t('attributionUnknown')}`)),
    h('div', { className: 'yf-metrics' }, h(Metric, { icon: 'sparkle', label: t('spend'), value: formatMoney(summary.cost, currency) || t('metricUnavailable'), hint: `${t('currency')} ${currency}`, muted: source.status === 'error' }), h(Metric, { icon: 'data', label: t('requests'), value: formatNumber(summary.requests) || '—', hint: `${t('successRate')} ${success || t('noBaseline')}` }), h(Metric, { icon: 'layers', label: t('tokens'), value: formatNumber(summary.totalTokens) || '—', hint: `${t('input')} ${formatNumber(summary.inputTokens) || '—'} · ${t('output')} ${formatNumber(summary.outputTokens) || '—'}` }), h(Metric, { icon: 'goal', label: t('budgetUsage'), value: budget.value, hint: budget.hint, muted: budget.muted })),
    h('div', { className: 'yf-main-grid' }, h('section', { className: 'yf-panel' }, h('div', { className: 'yf-panel-heading' }, h('div', null, h('h2', null, t('trendTitle')), h('p', null, t('trendHint'))), h(Glyph, { name: 'clock' })), source.status === 'error' || source.status === 'unavailable' ? h(EmptyState, { title: t('unavailable'), source, t }) : h(TrendChart, { series: data?.series, currency, t })), h(BudgetPanel, { budget: data?.budget, t })),
    h('div', { className: 'yf-secondary-grid' }, h(ModelMix, { models: data?.models, summary, currency, t }), h(AlertPanel, { alerts: data?.alerts, source, t })), h('p', { className: 'yf-privacy' }, t('privacy')))
}

function SeriesView({ seriesState, days, onDays, t }) {
  const data = seriesState.data, currency = data?.summary?.currency || 'CNY'
  return h('div', { className: 'yf-detail-view' },
    h('div', { className: 'yf-trend-toolbar' }, h(DaysControl, { days, onChange: onDays, t }),
      h(ComparisonChips, { comparison: data?.comparison, currency, t }),
      data ? h(SourceBadge, { source: data.source, t }) : null),
    seriesState.error && !data
      ? h('section', { className: 'yf-panel' }, h('div', { className: 'yf-fatal', role: 'alert' }, h(Glyph, { name: 'warning' }), h('strong', null, t('sourceError'))))
      : h('section', { className: 'yf-panel' }, h('div', { className: 'yf-panel-heading' }, h('div', null, h('h2', null, t('trendTitle')), h('p', null, t('trendHint'))), h(Glyph, { name: 'clock' })),
        seriesState.loading && !data ? h('div', { className: 'yf-loading', role: 'status' }, h(Glyph, { name: 'loading' }), t('loading')) : data ? h(TrendChart, { series: data.series, currency, t }) : null))
}

function Detail({ tab, data, seriesState, days, onDays, t }) {
  if (tab === 'trend') return h(SeriesView, { seriesState, days, onDays, t })
  if (tab === 'models') {
    const currency = data?.summary?.currency || 'CNY'
    return h('div', { className: 'yf-detail-view' },
      h('section', { className: 'yf-panel' }, h('div', { className: 'yf-panel-heading' }, h('h2', null, t('modelTable')), h('span', null, data?.period?.label || '')), h(ModelTable, { models: data?.models, currency, t })),
      h(ModelMix, { models: data?.models, summary: data?.summary, currency, t }),
      seriesState.data ? h(RouteMix, { byRoute: seriesState.data.byRoute, currency: seriesState.data.summary?.currency || currency, t }) : null)
  }
  return h('div', { className: 'yf-detail-view' }, h(BudgetPanel, { budget: data?.budget, t }), h(AlertPanel, { alerts: data?.alerts, source: data?.source, t }))
}

function Button({ wide, t }) {
  return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `yf-button${wide ? ' yf-wide' : ''}`, 'aria-label': t('open'), onClick: openOverlay }, h(IconDataOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null))
}

function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [range, setRange] = useState('yesterday'), [tab, setTab] = useState('overview'), [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(false), [revision, setRevision] = useState(0)
  const [days, setDays] = useState(7), [seriesState, setSeriesState] = useState({ days: 7, data: null, loading: false, error: false })
  const seriesCache = useRef(new Map())
  useEffect(() => {
    if (!visible) return undefined
    const controller = new AbortController(); setLoading(true); setError(false)
    void load(range, controller.signal).then(value => { setData(value); setError(false) }).catch(cause => { if (cause?.name !== 'AbortError') setError(true) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [visible, range, revision])
  // Trend/model tabs fetch their own series window once per days+revision; the
  // result is cached so switching tabs does not re-request unseen data.
  useEffect(() => {
    if (!visible || (tab !== 'trend' && tab !== 'models')) return undefined
    const cached = seriesCache.current.get(days)
    if (cached) { setSeriesState({ days, data: cached, loading: false, error: false }); return undefined }
    const controller = new AbortController()
    setSeriesState(state => ({ ...state, days, loading: true, error: false }))
    void loadSeries(days, controller.signal)
      .then(value => { seriesCache.current.set(days, value); setSeriesState({ days, data: value, loading: false, error: false }) })
      .catch(cause => { if (cause?.name !== 'AbortError') setSeriesState({ days, data: null, loading: false, error: true }) })
    return () => controller.abort()
  }, [visible, tab, days, revision])
  useEffect(() => { if (!visible) return undefined; const key = event => { if (event.key === 'Escape') setOpened(false) }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [visible])
  if (!visible) return null
  const refresh = () => { seriesCache.current.clear(); setRevision(value => value + 1) }
  const body = loading && !data ? h('div', { className: 'yf-loading', role: 'status' }, h(Glyph, { name: 'loading' }), t('loading')) : error && !data ? h('div', { className: 'yf-fatal', role: 'alert' }, h(Glyph, { name: 'warning' }), h('strong', null, t('sourceError')), h('button', { type: 'button', onClick: refresh }, t('retry'))) : data ? h(React.Fragment, null, loading ? h('div', { className: 'yf-stale', role: 'status' }, t('loading')) : null, tab === 'overview' ? h(Overview, { data, t }) : h(Detail, { tab, data, seriesState: seriesState.days === days ? seriesState : { ...seriesState, loading: true }, days, onDays: setDays, t })) : null
  return h('div', { className: 'yf-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'yf-title' }, h('main', { className: 'yf-shell', 'aria-labelledby': 'yf-title' }, h('header', { className: 'yf-header' }, h('div', null, h('div', { className: 'yf-title-row' }, h('h1', { id: 'yf-title' }, t('title')), data?.period?.label ? h('span', { className: 'yf-period-label' }, data.period.label) : null), h('p', null, t('subtitle'))), h('div', { className: 'yf-header-buttons' }, h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', className: 'yf-icon-button', disabled: loading, 'aria-label': t('refresh'), onClick: refresh }, h(IconRefreshOutline16, { size: 16 }))), h(Tooltip, { label: t('close') }, h('button', { type: 'button', className: 'yf-icon-button', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))))), h('div', { className: 'yf-toolbar' }, h(RangeControl, { range, onChange: value => { setRange(value); setTab('overview') }, t }), data?.period?.timeZone ? h('span', { className: 'yf-toolbar-meta' }, `${t('timeZone')}: ${data.period.timeZone}`) : null), h('nav', { className: 'yf-tabs', 'aria-label': t('title') }, ...TABS.map(([id, key]) => h('button', { type: 'button', key: id, 'aria-current': tab === id ? 'page' : undefined, onClick: () => setTab(id) }, t(key)))), h('div', { className: `yf-content${loading && data ? ' yf-refreshing' : ''}` }, body)))
}

const css = `
.yf-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.yf-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yf-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yf-wide span{font-size:13px}.yf-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yf-shell{display:grid;grid-template-rows:auto auto auto 1fr;width:100%;height:100%;overflow:hidden}.yf-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;gap:18px;padding:16px 28px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yf-title-row{display:flex;align-items:baseline;gap:10px}.yf-header h1{margin:0;font-size:21px;line-height:1.3}.yf-period-label{padding:2px 7px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yf-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yf-header-buttons{display:flex;gap:6px}.yf-icon-button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yf-icon-button:hover{background:var(--dsw-alias-bg-layer-2)}.yf-icon-button:disabled{opacity:.45;cursor:default}.yf-toolbar{display:flex;align-items:center;gap:16px;padding:12px 28px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yf-range-control{display:inline-flex;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}.yf-range-control button{min-width:72px;height:30px;padding:0 12px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.yf-range-control button.is-active{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand);font-weight:650}.yf-range-small button{min-width:0;height:26px;padding:0 10px;font-size:11px}.yf-toolbar-meta{color:var(--dsw-alias-label-secondary);font-size:12px}.yf-tabs{display:flex;gap:2px;padding:0 28px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto}.yf-tabs button{height:42px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}.yf-tabs button[aria-current]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yf-content{overflow:auto;padding:24px 28px 44px}.yf-content.yf-refreshing{opacity:.58;transition:opacity .2s}.yf-overview,.yf-detail-view{display:grid;gap:22px;max-width:1440px;margin:0 auto}.yf-status-line{display:flex;align-items:center;gap:14px;min-height:30px;color:var(--dsw-alias-label-secondary);font-size:12px}.yf-source-badge{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.yf-source-ready svg{color:var(--dsw-alias-state-success-primary)}.yf-source-warning svg,.yf-source-empty svg{color:var(--dsw-alias-state-warning-primary)}.yf-source-error svg{color:var(--dsw-alias-state-error-primary)}.yf-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-block:1px solid var(--dsw-alias-border-l1)}.yf-metric{display:grid;min-height:112px;align-content:center;gap:8px;padding:16px 18px;border-right:1px solid var(--dsw-alias-border-l1)}.yf-metric:last-child{border-right:0}.yf-metric-label{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px}.yf-metric-label svg{color:var(--dsw-alias-label-tertiary)}.yf-metric strong{font-size:26px;line-height:1.12;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.yf-metric small{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.35}.yf-metric-muted strong{color:var(--dsw-alias-label-tertiary);font-size:20px}.yf-main-grid,.yf-secondary-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(300px,1fr);gap:22px}.yf-secondary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.yf-panel{min-width:0;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yf-panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px}.yf-panel-heading h2,.yf-detail-view>h2{margin:0;font-size:15px;line-height:1.35}.yf-panel-heading p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}.yf-panel-heading>svg{color:var(--dsw-alias-label-tertiary)}.yf-chart-wrap{display:grid;gap:14px}.yf-chart{width:100%;height:auto;min-height:190px;overflow:visible}.yf-grid-line{stroke:var(--dsw-alias-border-l1);stroke-width:1}.yf-chart-line{stroke:var(--dsw-alias-brand-primary);stroke-width:2.5}.yf-chart-dot{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-brand-primary);stroke-width:2}.yf-chart-label{fill:var(--dsw-alias-label-tertiary);font-size:11px}.yf-chart-table{width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums}.yf-chart-table th,.yf-chart-table td{padding:7px 4px;border-top:1px solid var(--dsw-alias-border-l1);text-align:right}.yf-chart-table th:first-child,.yf-chart-table td:first-child{text-align:left}.yf-chart-table th{color:var(--dsw-alias-label-secondary);font-weight:500}.yf-trend-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.yf-compare{display:flex;align-items:center;flex-wrap:wrap;gap:7px}.yf-compare-label{color:var(--dsw-alias-label-secondary);font-size:12px}.yf-compare-chip{padding:3px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11px;font-variant-numeric:tabular-nums}.yf-compare-na{color:var(--dsw-alias-label-tertiary);font-size:12px}.yf-status-badge{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px}.yf-status-healthy{color:var(--dsw-alias-state-success-primary)}.yf-status-warning{color:var(--dsw-alias-state-warning-primary)}.yf-status-critical,.yf-status-exceeded{color:var(--dsw-alias-state-error-primary)}.yf-status-unavailable{color:var(--dsw-alias-label-tertiary)}.yf-budget-list{display:grid;gap:16px}.yf-budget-item{display:grid;gap:6px}.yf-budget-warning{background:var(--dsw-alias-state-warning-primary)}.yf-budget-critical,.yf-budget-exceeded{background:var(--dsw-alias-state-error-primary)}.yf-budget-value{display:flex;align-items:baseline;gap:7px;margin:24px 0 14px}.yf-budget-value strong{font-size:25px;font-variant-numeric:tabular-nums}.yf-budget-value span{color:var(--dsw-alias-label-secondary);font-size:12px}.yf-bar-track{height:7px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}.yf-bar-fill{height:100%;min-width:0;border-radius:4px;background:var(--dsw-alias-brand-primary);transition:width .25s ease}.yf-model-list{display:grid;gap:13px}.yf-model-row{display:grid;gap:6px}.yf-model-head{display:flex;justify-content:space-between;gap:12px;font-size:12px}.yf-model-head strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yf-model-head span{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.yf-model-meta,.yf-budget-meta{display:flex;justify-content:space-between;gap:12px;margin-top:9px;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}.yf-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.yf-table th,.yf-table td{padding:9px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);text-align:right;white-space:nowrap}.yf-table th:first-child,.yf-table td:first-child{text-align:left}.yf-table th{color:var(--dsw-alias-label-secondary);font-weight:500;font-size:11px}.yf-panel-note{margin:14px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.yf-alert-list{border-top:1px solid var(--dsw-alias-border-l1)}.yf-alert-row{display:grid;grid-template-columns:20px minmax(0,1fr) 14px;align-items:center;gap:10px;min-height:48px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yf-alert-row>svg:first-child{color:var(--dsw-alias-state-warning-primary)}.yf-alert-row>svg:last-child{color:var(--dsw-alias-label-tertiary)}.yf-alert-row div{display:grid;gap:3px;min-width:0}.yf-alert-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.yf-alert-row span{color:var(--dsw-alias-label-secondary);font-size:11px}.yf-empty,.yf-loading,.yf-fatal{display:grid;min-height:150px;place-items:center;align-content:center;gap:9px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}.yf-empty strong{font-size:13px}.yf-empty details{font-size:11px}.yf-empty summary{cursor:pointer}.yf-empty code{color:var(--dsw-alias-label-secondary);font-size:11px}.yf-empty-error svg{color:var(--dsw-alias-state-error-primary)}.yf-empty-unavailable svg{color:var(--dsw-alias-state-warning-primary)}.yf-fatal button{min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.yf-stale{padding:8px 28px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px}.yf-privacy{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px}@media(max-width:900px){.yf-header,.yf-toolbar,.yf-tabs{padding-left:18px;padding-right:18px}.yf-content{padding:18px}.yf-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yf-metric:nth-child(2){border-right:0}.yf-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.yf-main-grid,.yf-secondary-grid{grid-template-columns:1fr}.yf-secondary-grid{gap:16px}.yf-table{font-size:11px}}@media(max-width:480px){.yf-header{min-height:68px;padding-top:12px;padding-bottom:12px}.yf-header h1{font-size:18px}.yf-header p{display:none}.yf-title-row{display:grid;gap:2px}.yf-toolbar{align-items:flex-start;flex-direction:column;gap:9px}.yf-range-control{width:100%}.yf-range-control button{flex:1;min-width:0}.yf-content{padding:14px}.yf-metric{min-height:92px;padding:12px}.yf-metric strong{font-size:21px}.yf-metric-muted strong{font-size:17px}.yf-status-line{align-items:flex-start;flex-wrap:wrap;gap:8px}.yf-panel{padding:14px}.yf-chart-table{font-size:10px}.yf-table th:nth-child(n+5),.yf-table td:nth-child(n+5){display:none}}
`

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-finops: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-yootun-finops: exclusive-overlay')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-finops'; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-finops: styles')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-finops', order: 55, inject: () => ({ t }) }, Button))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-finops', order: 55, inject: () => ({ t }) }, Overlay))
}

module.exports = { apply, inject: ['slots', 'locale'] }
