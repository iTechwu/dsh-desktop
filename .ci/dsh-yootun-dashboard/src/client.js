const React = require('react')
const { createElement: h, useEffect, useMemo, useState, useSyncExternalStore } = React
const {
  IconAgentPresetOutline16,
  IconArchiveOutline20,
  IconBrowseOutline16,
  IconCheckOutline16,
  IconChecklistOutline14,
  IconChevronRightOutline14,
  IconClockOutline16,
  IconCloseOutline16,
  IconCodeOutline16,
  IconDatabaseOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconEnhanceOutline16,
  IconLoadingOutline16,
  IconPlayOutline16,
  IconQueueOutline14,
  IconRefreshOutline16,
  IconSendOutline16,
  IconSettingsOutline16,
  IconSparkle16,
  IconWarningOutline16,
  Tooltip,
} = require('@deepseek-ai/dsh-client-ui-primitives')

const NS = 'dofe.yootun-dashboard'
const OVERLAY_ID = '@dofe/dsh-yootun-dashboard'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const YOOTUN_DASHBOARD_PATH = '/api/desktop/yootun/dashboard/yesterday'
const DASHBOARD_SERIES_PATH = '/api/desktop/yootun/dashboard/series'
const TABS = [
  { id: 'overview', label: 'tabOverview' },
  { id: 'geo', label: 'tabGeo' },
  { id: 'usage', label: 'tabUsage' },
  { id: 'activity', label: 'tabActivity' },
  { id: 'montage', label: 'tabMontage' },
]

// 语义图标统一在组件层固定；颜色不作为唯一状态信号，图标始终伴随文字。
const GLYPHS = {
  geo: IconEditOutline16,
  views: IconBrowseOutline16,
  warning: IconWarningOutline16,
  spark: IconSparkle16,
  send: IconSendOutline16,
  layers: IconEnhanceOutline16,
  agent: IconAgentPresetOutline16,
  tools: IconCodeOutline16,
  play: IconPlayOutline16,
  queue: IconQueueOutline14,
  running: IconLoadingOutline16,
  check: IconCheckOutline16,
  checklist: IconChecklistOutline14,
  archive: IconArchiveOutline20,
  server: IconSettingsOutline16,
  clock: IconClockOutline16,
  database: IconDatabaseOutline16,
  data: IconDataOutline16,
  close: IconCloseOutline16,
  chevron: IconChevronRightOutline14,
}
const STATUS_GLYPH = { ready: 'check', empty: 'database', warning: 'warning', unavailable: 'close', error: 'warning' }

const copy = {
  zh: {
    open: '企业看板', title: '企业驾驶舱', subtitle: 'GEO、AI 消费、Agent 工作与视频生产',
    refresh: '刷新数据', close: '关闭看板', loading: '正在汇总经营数据…', retry: '重新加载',
    unavailable: '数据源不可用', empty: '当前范围暂无数据', error: '数据读取失败',
    sourceReady: '已就绪', sourceEmpty: '暂无数据', sourceEmptyContext: '当前范围暂无数据', sourceUnavailable: '不可用', sourceError: '异常', sourceWarning: '降级',
    tabOverview: '总览', tabGeo: 'GEO 内容效果', tabGeorank: 'GEORank 诊断', tabUsage: '模型与消费', tabActivity: 'Agent 工作',
    geo: 'GEO', usage: '模型消费', activity: 'Agent 工作', sources: '数据状态', capabilities: 'MCP 能力', tools: 'Tools', knowledge: 'Knowledge', memory: 'Memory', georank: 'GEORank', openmontage: 'OpenMontage',
    articles: '生成内容', published: '已发布', views: '总浏览', failedTasks: '失败任务',
    requests: '模型请求', cost: '消费金额', models: '使用模型', tokens: '总 Token',
    sessions: '工作会话', turns: '执行轮次', completed: '完成轮次', failed: '异常轮次', toolCalls: '工具调用',
    model: '模型', input: '输入 Token', output: '输出 Token', calls: '请求', amount: '费用',
    session: '工作事项', workspace: '工作区', result: '结果', tool: '服务/工具',
    geoFlow: 'GeoFlow 经营数据', billed: 'Models 计费记录', local: '本机 DSH 会话事件',
    privacy: '仅展示聚合值、工作标题与结果状态，不展示会话正文或密钥。',
    topContent: 'TOP 内容', untitledContent: '未命名内容',
    montage: '视频生产', tabMontage: '视频生产', montageFlow: 'OpenMontage overview 公共契约',
    montageJobs: '作业总数', montageQueued: '排队中', montageRunning: '运行中', montageCompleted: '已完成', montageFailed: '失败',
    pendingApprovals: '待人工审批', recentJobs: '最近作业', stage: '当前阶段', artifacts: '产物',
    recentArtifacts: '最近产物', health: '服务健康', workers: 'Worker', untitledJob: '未命名作业', noStage: '未开始',
    healthSummary: '整体健康度', healthGood: '良好', healthAttention: '需要处理', healthLimited: '数据受限',
    sourcesReady: '数据源可用', attention: '需要关注', attentionEmpty: '当前范围没有需要处理的异常',
    viewDetail: '查看详情', noBaseline: '暂无基线', publishRate: '发布率', completeRate: '完成率', avgCost: '单次请求',
    workerDown: 'Worker 离线', asOfLabel: '更新于', lastUpdated: '最后更新', refreshing: '正在更新…',
    sourcePartial: '部分字段', detail: '详情', periodHint: '统计范围以页面顶部选择为准（Asia/Shanghai）',
    rangeYesterday: '昨日', range7d: '近7天', range30d: '近30天', dailyTrend: '每日趋势', vsBaseline: '距上周期',
    rangeControl: '统计范围', scopeControl: '模型用量视角',
    byRoute: '路由归因', route: '路由', flat: '持平',
    scopeKey: '本人', scopeTeam: '团队', teamForbidden: '团队用量需要管理员/超管账号',
    exportCsv: '导出 CSV', openApprovals: '打开统一审批',
    oldestWaiting: '最早等待', waitP50: '等待 P50', waitP95: '等待 P95', heartbeat: '心跳',
    budget: '预算阈值', budgetOf: '已用', latency: 'P95 延迟', member: '成员',
    funnel: '内容漏斗', channels: '渠道分布', stageStats: '阶段耗时',
    funnelCreated: '生成', funnelDraft: '草稿', funnelReview: '审核', funnelPublished: '发布', funnelViewed: '被浏览',
    georank: 'GEORank', georankScore: '优惠豚 GEO 基准分', georankPublished: '已发布品牌', georankScored: '已评分品牌', scoreDistribution: '分数分布', recentCompanies: '最近收录', geoCertified: 'GEO 认证',
  },
  en: {
    open: 'Enterprise dashboard', title: 'Enterprise dashboard', subtitle: 'GEO, AI spend, Agent work, and video production',
    refresh: 'Refresh data', close: 'Close dashboard', loading: 'Summarizing operating data…', retry: 'Try again',
    unavailable: 'Source unavailable', empty: 'No data in this range', error: 'Could not load data',
    sourceReady: 'Ready', sourceEmpty: 'No data', sourceEmptyContext: 'No data in this range', sourceUnavailable: 'Unavailable', sourceError: 'Error', sourceWarning: 'Degraded',
    tabOverview: 'Overview', tabGeo: 'GEO content', tabGeorank: 'GEORank diagnostics', tabUsage: 'Models and spend', tabActivity: 'Agent work',
    geo: 'GEO', usage: 'Model spend', activity: 'Agent work', sources: 'Source status', capabilities: 'MCP capabilities', tools: 'Tools', knowledge: 'Knowledge', memory: 'Memory', georank: 'GEORank', openmontage: 'OpenMontage',
    articles: 'Content created', published: 'Published', views: 'Total views', failedTasks: 'Failed tasks',
    requests: 'Model requests', cost: 'Spend', models: 'Models used', tokens: 'Total tokens',
    sessions: 'Work sessions', turns: 'Turns', completed: 'Completed', failed: 'Failed', toolCalls: 'Tool calls',
    model: 'Model', input: 'Input tokens', output: 'Output tokens', calls: 'Requests', amount: 'Cost',
    session: 'Work item', workspace: 'Workspace', result: 'Result', tool: 'Service/tool',
    geoFlow: 'GeoFlow operating metrics', billed: 'Models billing records', local: 'Local DSH session events',
    privacy: 'Shows aggregates, work titles, and outcomes only. Conversation content and secrets are excluded.',
    topContent: 'Top content', untitledContent: 'Untitled content',
    montage: 'Montage', tabMontage: 'Montage', montageFlow: 'OpenMontage public overview contract',
    montageJobs: 'Jobs', montageQueued: 'Queued', montageRunning: 'Running', montageCompleted: 'Completed', montageFailed: 'Failed',
    pendingApprovals: 'Awaiting approval', recentJobs: 'Recent jobs', stage: 'Stage', artifacts: 'Artifacts',
    recentArtifacts: 'Recent artifacts', health: 'Service health', workers: 'Workers', untitledJob: 'Untitled job', noStage: 'Not started',
    healthSummary: 'Overall health', healthGood: 'Good', healthAttention: 'Needs attention', healthLimited: 'Limited data',
    sourcesReady: 'Sources up', attention: 'Needs attention', attentionEmpty: 'Nothing needs attention',
    viewDetail: 'Details', noBaseline: 'No baseline', publishRate: 'Publish rate', completeRate: 'Completion', avgCost: 'Per request',
    workerDown: 'Workers down', asOfLabel: 'As of', lastUpdated: 'Updated', refreshing: 'Refreshing…',
    sourcePartial: 'Partial', detail: 'Details', periodHint: 'Range follows the selection above (Asia/Shanghai)',
    rangeYesterday: 'Yesterday', range7d: '7 days', range30d: '30 days', dailyTrend: 'Daily trend', vsBaseline: 'vs previous',
    rangeControl: 'Date range', scopeControl: 'Model usage scope',
    byRoute: 'Route attribution', route: 'Route', flat: 'flat',
    scopeKey: 'Self', scopeTeam: 'Team', teamForbidden: 'Team usage requires an admin account',
    exportCsv: 'Export CSV', openApprovals: 'Open approvals queue',
    oldestWaiting: 'Oldest waiting', waitP50: 'Wait P50', waitP95: 'Wait P95', heartbeat: 'Heartbeat',
    budget: 'Budgets', budgetOf: 'used', latency: 'P95 latency', member: 'Member',
    funnel: 'Content funnel', channels: 'Channel mix', stageStats: 'Stage durations',
    funnelCreated: 'Created', funnelDraft: 'Draft', funnelReview: 'Review', funnelPublished: 'Published', funnelViewed: 'Viewed',
    georank: 'GEORank', georankScore: 'Yootun GEO benchmark', georankPublished: 'Published brands', georankScored: 'Scored brands', scoreDistribution: 'Score distribution', recentCompanies: 'Recently listed', geoCertified: 'GEO certified',
  },
}

let opened = false
const listeners = new Set()
function emit() { for (const listener of listeners) listener() }
function setOpened(value) { opened = value; emit() }
function openOverlay() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } }))
  }
  setOpened(true)
}
function closeOtherOverlay(event) { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }
function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
function getSnapshot() { return opened }

const RANGES = [
  { id: 'yesterday', label: 'rangeYesterday' },
  { id: '7d', label: 'range7d' },
  { id: '30d', label: 'range30d' },
]
const RANGE_DAYS = { '7d': 7, '30d': 30 }

async function loadDashboard(range, usageScope, signal) {
  const days = RANGE_DAYS[range]
  const response = await fetch(days ? DASHBOARD_SERIES_PATH : YOOTUN_DASHBOARD_PATH, {
    method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(days ? { days, scope: usageScope } : {}),
  })
  if (!response.ok) throw new Error('dashboard request failed')
  return response.json()
}

function number(value) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: number(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number(value))
}

function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'CNY', maximumFractionDigits: 4 }).format(number(value))
  } catch {
    return `${formatNumber(value)} ${currency || 'CNY'}`
  }
}

function formatClock(value) {
  const parsed = Date.parse(String(value || ''))
  if (!Number.isFinite(parsed)) return ''
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(parsed)
}

// 字段缺失/无效返回 null（前端渲染“—”），只有真实数值才会被格式化；undefined 不再被静默变成 0。
function metricDisplay(value, format = formatNumber) {
  const parsed = Number(value)
  if (value === undefined || value === null || value === '' || !Number.isFinite(parsed)) return null
  return format(parsed)
}

function statusLabel(status, t) {
  if (status === 'ready') return t('sourceReady')
  if (status === 'empty') return t('sourceEmpty')
  if (status === 'warning') return t('sourceWarning')
  if (status === 'error') return t('sourceError')
  return t('sourceUnavailable')
}

function Glyph({ name, size = 16, className }) {
  const Icon = GLYPHS[name]
  return Icon ? h(Icon, { size, className }) : null
}

function SourceState({ source, t, compact = false }) {
  const status = source?.status || 'unavailable'
  const emptyCompact = compact && status === 'empty'
  return h('span', { className: `yd-source yd-source-${status}${compact ? ' yd-source-compact' : ''}` },
    emptyCompact ? null : h(Glyph, { name: STATUS_GLYPH[status] || 'close', size: 12, className: 'yd-source-icon' }),
    emptyCompact ? t('sourceEmptyContext') : statusLabel(status, t))
}

function EmptyState({ source, t }) {
  const status = source?.status || 'unavailable'
  const label = status === 'empty' ? t('empty') : status === 'error' ? t('error') : t('unavailable')
  const meta = [
    source?.reason ? `reason: ${source.reason}` : null,
    Array.isArray(source?.missingFields) && source.missingFields.length ? `missing: ${source.missingFields.join(', ')}` : null,
  ].filter(Boolean)
  const forbidden = source?.reason === 'billing_team_forbidden'
  return h('div', { className: `yd-empty yd-empty-${status}`, role: status === 'error' ? 'alert' : undefined },
    h(Glyph, { name: STATUS_GLYPH[status] || 'close', size: 18 }),
    h('strong', null, label),
    forbidden ? h('p', { className: 'yd-text-danger' }, t('teamForbidden')) : null,
    h('p', null, t('periodHint')),
    meta.length ? h('details', { className: 'yd-empty-details' }, h('summary', null, t('detail')), h('code', null, meta.join(' · '))) : null)
}

function Metric({ icon, label, value, hint, tone, muted = false }) {
  return h('div', { className: `yd-metric${tone ? ` yd-metric-${tone}` : ''}${muted ? ' yd-metric-missing' : ''}` },
    h('div', { className: 'yd-metric-head' }, h(Glyph, { name: icon, size: 14 }), h('span', null, label)),
    h('strong', null, value),
    hint ? h('span', { className: 'yd-metric-hint' }, hint) : null)
}

function ShareBar({ label, value, total, display, tone }) {
  const share = total > 0 ? Math.round((number(value) / total) * 100) : null
  const text = display ?? metricDisplay(value) ?? '—'
  return h('div', { className: 'yd-share' },
    h('div', { className: 'yd-share-head' }, h('strong', null, label), h('span', null, share === null ? text : `${text} · ${share}%`)),
    h('div', { className: 'yd-share-track', role: 'img', 'aria-label': `${label}: ${text}${share === null ? '' : `, ${share}%`}` },
      h('div', { className: `yd-share-fill${tone ? ` yd-share-${tone}` : ''}`, style: { width: share === null || share <= 0 ? '0%' : `${Math.max(share, 2)}%` } })))
}

// 健康状态采用固定枚举精确匹配；未知值保守映射为 unavailable，绝不默认 ready。
const HEALTH_STATES = {
  ready: 'ready', ok: 'ready', healthy: 'ready', online: 'ready', active: 'ready', up: 'ready', running: 'ready', normal: 'ready',
  degraded: 'warning', paused: 'warning', disabled: 'warning',
  down: 'error', offline: 'error', error: 'error', fail: 'error', failed: 'error', unhealthy: 'error', stopped: 'error', 'not ready': 'error',
}
function healthState(value) {
  return HEALTH_STATES[String(value || '').trim().toLowerCase()] || 'unavailable'
}

// 环比文案：▲/▼ 加百分比或绝对值，文字承载语义，不依赖颜色。
function comparisonText(t, comparison, key, format = formatNumber) {
  if (!comparison || comparison.status !== 'ready') return t('noBaseline')
  const delta = number(comparison.delta?.[key])
  const percent = comparison.deltaPercent?.[key]
  if (delta === 0) return `${t('vsBaseline')} · ${t('flat')}`
  const magnitude = percent === null || percent === undefined
    ? format(Math.abs(delta))
    : `${Math.abs(percent)}%`
  return `${t('vsBaseline')} ${delta > 0 ? '▲' : '▼'} ${magnitude}`
}

function TrendBars({ days, valueOf, format = formatNumber }) {
  const values = days.map(day => ({ date: day.date, value: number(valueOf(day)) }))
  const max = values.reduce((max, row) => Math.max(max, row.value), 0)
  const label = values.map(row => `${row.date} ${format(row.value)}`).join('，')
  return h('div', {
    className: 'yd-trend',
    role: 'img',
    'aria-label': `${values.length}d: ${label}`,
  }, ...values.map(row => h('span', {
    key: row.date,
    className: 'yd-trend-bar',
    title: `${row.date} ${format(row.value)}`,
    style: { height: `${max > 0 ? Math.max(Math.round((row.value / max) * 100), 3) : 3}%` },
  })))
}

function TrendSection({ title, days, valueOf, format }) {
  return h('section', { className: 'yd-table-section' },
    h('div', { className: 'yd-section-heading' }, h('h2', null, title)),
    h(TrendBars, { days, valueOf, format }))
}

function attentionItems(data, t) {
  const geo = data?.geo?.data || {}
  const geoFailed = number(geo.kpis?.failed_tasks ?? geo.totals?.failedTasks)
  const activityTotals = data?.activity?.data?.totals || {}
  const montage = data?.montage?.data || {}
  const montageFailed = number(montage.jobs?.failed ?? montage.totals?.failed)
  const montageApprovals = number(montage.pendingApprovals ?? montage.totals?.waiting_approval)
  const workers = Array.isArray(montage.health?.workers) ? montage.health.workers : []
  const failedWorkers = workers.filter(worker => healthState(worker.status) === 'error').length
  const items = []
  if (geoFailed > 0) items.push({ key: 'geo-failed', tab: 'geo', glyph: 'warning', label: t('failedTasks'), value: formatNumber(geoFailed) })
  if (number(activityTotals.failedTurns) > 0) items.push({ key: 'activity-failed', tab: 'activity', glyph: 'warning', label: t('failed'), value: formatNumber(activityTotals.failedTurns) })
  if (montageFailed > 0) items.push({ key: 'montage-failed', tab: 'montage', glyph: 'warning', label: t('montageFailed'), value: formatNumber(montageFailed) })
  if (montageApprovals > 0) items.push({ key: 'montage-approval', tab: 'montage', glyph: 'checklist', label: t('pendingApprovals'), value: formatNumber(montageApprovals), plugin: 'approvals' })
  if (failedWorkers > 0) items.push({ key: 'montage-worker', tab: 'montage', glyph: 'server', label: t('workerDown'), value: formatNumber(failedWorkers) })
  for (const [key, tab, name, source] of [
    ['geo-source', 'geo', t('geo'), data?.geo],
    ['usage-source', 'usage', t('usage'), data?.usage],
    ['activity-source', 'activity', t('activity'), data?.activity],
    ['montage-source', 'montage', t('montage'), data?.montage],
  ]) {
    const status = source?.status
    if (status === 'error' || status === 'unavailable') items.push({ key, tab, glyph: status === 'error' ? 'warning' : 'close', label: `${name} · ${statusLabel(status, t)}`, value: '' })
  }
  return items
}

function HealthStrip({ data, t }) {
  const sources = [data?.geo, data?.usage, data?.activity, data?.montage]
  const available = sources.filter(source => source?.status === 'ready' || source?.status === 'empty').length
  const attention = attentionItems(data, t).length
  const limited = available < sources.length
  const overallTone = limited || attention > 0 ? 'warning' : 'good'
  const overallLabel = limited ? t('healthLimited') : attention > 0 ? t('healthAttention') : t('healthGood')
  return h('div', { className: 'yd-health' },
    h('span', { className: 'yd-chip', 'data-tone': overallTone }, h(Glyph, { name: overallTone === 'good' ? 'check' : 'warning', size: 14 }), t('healthSummary'), h('strong', null, overallLabel)),
    h('span', { className: 'yd-chip', 'data-tone': attention > 0 ? 'warning' : 'good' }, h(Glyph, { name: attention > 0 ? 'warning' : 'check', size: 14 }), t('healthAttention'), h('strong', null, formatNumber(attention))),
    h('span', { className: 'yd-chip', 'data-tone': limited ? 'warning' : 'good' }, h(Glyph, { name: limited ? 'warning' : 'check', size: 14 }), t('sourcesReady'), h('strong', null, `${available}/${sources.length}`)))
}

// 异常行：点击进对应页签；高风险动作（待审批）提供直达待确认队列的入口——
// 驾驶舱本身不执行任何审批动作，只跳转到 approvals 插件。
function AttentionSection({ data, t, onOpenTab }) {
  const items = attentionItems(data, t)
  return h('section', { className: 'yd-domain', 'aria-labelledby': 'yd-attention-title' },
    h('div', { className: 'yd-section-heading' }, h('h2', { id: 'yd-attention-title' }, t('attention'))),
    items.length
      ? h('div', { className: 'yd-attention-list' }, ...items.map(item =>
        h('div', { className: 'yd-attention-row', key: item.key },
          h('button', { type: 'button', className: 'yd-attention-main', onClick: () => onOpenTab?.(item.tab) },
            h(Glyph, { name: item.glyph, size: 14, className: 'yd-attention-icon' }),
            h('strong', null, item.label),
            item.value ? h('span', null, item.value) : null,
            h(Glyph, { name: 'chevron', size: 12, className: 'yd-attention-go' })),
          item.plugin ? h('button', {
            type: 'button',
            className: 'yd-attention-action',
            onClick: () => window.dispatchEvent(new CustomEvent(`dofe:yootun-${item.plugin}:open`)),
          }, t(item.plugin === 'approvals' ? 'openApprovals' : `open${item.plugin}`)) : null)))
      : h('p', { className: 'yd-inline-empty' }, t('attentionEmpty')))
}

function SourceBand({ data, t }) {
  const sources = [
    [t('geo'), t('geoFlow'), data?.geo],
    [t('usage'), t('billed'), data?.usage],
    [t('activity'), t('local'), data?.activity],
    [t('montage'), t('montageFlow'), data?.montage],
  ]
  const capabilities = Object.entries(data?.capabilities || {})
  return h('section', { className: 'yd-source-band', 'aria-labelledby': 'yd-source-title' },
    h('div', { className: 'yd-section-heading' }, h('h2', { id: 'yd-source-title' }, t('sources')), h('p', null, t('privacy'))),
    h('div', { className: 'yd-source-list' }, ...sources.map(([name, description, source]) =>
      h('div', { className: 'yd-source-row', key: name },
        h('div', null, h('strong', null, name), h('span', null, description)),
        h('div', { className: 'yd-source-meta' },
          source?.sourceCompleteness === 'partial' ? h('span', { className: 'yd-badge yd-badge-warning' }, t('sourcePartial')) : null,
          source?.asOf ? h('time', null, `${t('asOfLabel')} ${formatClock(source.asOf)}`) : null,
          h(SourceState, { source, t }))))),
    capabilities.length ? h('div', { className: 'yd-capability-group' },
      h('h3', null, t('capabilities')),
      ...capabilities.map(([name, source]) => h('div', { className: 'yd-source-row', key: name },
        h('div', null, h('strong', null, t(name) || name)), h(SourceState, { source, t })))) : null)
}

// 域卡片底部提示：趋势形态显示环比，昨日形态显示派生比率/暂无基线。
function domainHint(source, t, key, fallback) {
  return Array.isArray(source?.data?.days) ? comparisonText(t, source.comparison, key) : fallback
}

function geoRateHint(source, t) {
  const kpis = source?.data?.kpis || {}
  const articles = number(kpis.articles)
  return articles > 0 ? `${t('publishRate')} ${Math.round((number(kpis.published) / articles) * 100)}%` : t('noBaseline')
}

function usageRateHint(source, t) {
  const summary = source?.data?.summary || {}
  const requests = number(summary.requests)
  const cost = number(summary.cost)
  return requests > 0 && cost > 0 ? `${t('avgCost')} ${formatMoney(cost / requests, source?.data?.currency)}` : t('noBaseline')
}

function activityRateHint(source, t) {
  const totals = source?.data?.totals || {}
  const turns = number(totals.turns)
  const rate = turns > 0 ? `${t('completeRate')} ${Math.round((number(totals.completedTurns) / turns) * 100)}%` : t('noBaseline')
  return `${rate} · ${t('toolCalls')} ${formatNumber(totals.toolCalls)}`
}

function montageRateHint(source, t) {
  const data = source?.data || {}
  const workers = Array.isArray(data.health?.workers) ? data.health.workers : []
  const readyWorkers = workers.filter(worker => healthState(worker.status) === 'ready').length
  const failed = `${t('montageFailed')} ${formatNumber(data.jobs?.failed)}`
  return workers.length ? `${failed} · ${t('workers')} ${readyWorkers}/${workers.length}` : failed
}

// 漏斗与渠道分布：昨日形态字段在 data 顶层，趋势形态在 data.insight 里。
function geoInsight(data) {
  return {
    funnel: (data.content_funnel && typeof data.content_funnel === 'object' ? data.content_funnel : null)
      || (data.insight && typeof data.insight.funnel === 'object' ? data.insight.funnel : null),
    channels: (data.distribution_summary && typeof data.distribution_summary === 'object' ? data.distribution_summary : null)
      || (data.insight && typeof data.insight.channels === 'object' ? data.insight.channels : null),
  }
}

function funnelLabel(key, t) {
  const known = {
    created: 'funnelCreated', draft: 'funnelDraft', review: 'funnelReview',
    published: 'funnelPublished', viewed: 'funnelViewed',
  }
  return t(known[key] || key) || key
}

function GeoInsightSections({ data, t, detailed }) {
  if (!detailed) return null
  const { funnel, channels } = geoInsight(data)
  const funnelStages = Array.isArray(funnel?.stages) ? funnel.stages : []
  const channelRows = Array.isArray(channels?.rows) ? channels.rows : []
  return h(React.Fragment, null,
    funnelStages.length ? h('section', { className: 'yd-table-section' },
      h('div', { className: 'yd-section-heading' }, h('h2', null, t('funnel'))),
      h('div', { className: 'yd-list' }, ...funnelStages.map(stage =>
        h(ShareBar, {
          key: stage.key, label: funnelLabel(stage.key, t), value: number(stage.count),
          total: number(funnel.max) || number(stage.count),
        })))) : null,
    channelRows.length ? h('section', { className: 'yd-table-section' },
      h('div', { className: 'yd-section-heading' }, h('h2', null, t('channels'))),
      h('div', { className: 'yd-list' }, ...channelRows.map(row =>
        h(ShareBar, {
          key: row.name, label: String(row.name), value: number(row.synced), total: number(row.total),
          display: `${formatNumber(row.synced)}/${formatNumber(row.total)}`,
          tone: number(row.failed) > 0 ? 'danger' : undefined,
        })))) : null,
    // 目标达成（docs/0903/dashboard/06 提案）：仅当 Host 透传 goals 且列表非空时
    // 渲染；无目标月份按 docs/03 口径不显示，不伪造百分比
    Array.isArray(data?.insight?.goals) && data.insight.goals.length ? h('section', { className: 'yd-table-section' },
      h('div', { className: 'yd-section-heading' }, h('h2', null, t('goalTitle'))),
      h('div', { className: 'yd-list' }, ...data.insight.goals.map(goal =>
        h('div', { className: 'yd-list-row', key: goal.goalId },
          h('span', { className: 'yd-rank' }, '·'),
          h('div', null,
            h('strong', null, goal.categoryName || t('goalGlobal')),
            h('span', null, `${t('goalTarget')} ${formatNumber(goal.target)} · ${t('goalActual')} ${formatNumber(goal.actual)} · ${t('goalPace')} ${goal.pacePct ?? 0}%`)),
          h(ShareBar, {
            label: t('goalAttained'),
            value: Math.min(goal.attainmentPct ?? 0, 100),
            total: 100,
            display: `${goal.attainmentPct ?? 0}%`,
            tone: (goal.attainmentPct ?? 0) >= 100 ? undefined
              : (goal.pacePct ?? 0) > (goal.attainmentPct ?? 0) ? 'danger' : undefined,
          }))))) : null
  )
}

function GeoMetrics({ source, t, detailed = false }) {
  if (source?.status !== 'ready') return h(EmptyState, { source, t })
  const data = source.data || {}
  // 趋势形态（近 N 天）：窗口汇总 + 每日浏览条 + 环比
  if (Array.isArray(data.days)) {
    const totals = data.totals || {}
    const comparison = source.comparison
    const metrics = [
      ['geo', t('articles'), metricDisplay(totals.articles), comparisonText(t, comparison, 'articles')],
      ['check', t('published'), metricDisplay(totals.published), comparisonText(t, comparison, 'published')],
      ['views', t('views'), metricDisplay(totals.views), comparisonText(t, comparison, 'views')],
      ['warning', t('failedTasks'), metricDisplay(totals.failedTasks), comparisonText(t, comparison, 'failedTasks'), number(totals.failedTasks) > 0 ? 'danger' : undefined],
    ]
    if (detailed) {
      return h('div', { className: 'yd-detail-stack yd-geo-detail' },
        h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint, tone]) =>
          h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null, tone }))),
        h(TrendSection, { title: t('dailyTrend'), days: data.days, valueOf: day => day.views }),
        h(GeoInsightSections, { data, t, detailed: true }))
    }
    return h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint, tone]) =>
      h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null, tone })))
  }
  const kpis = data.kpis || {}
  const metrics = [
    ['geo', t('articles'), metricDisplay(kpis.articles)],
    ['check', t('published'), metricDisplay(kpis.published)],
    ['views', t('views'), metricDisplay(kpis.total_views)],
    ['warning', t('failedTasks'), metricDisplay(kpis.failed_tasks), undefined, number(kpis.failed_tasks) > 0 ? 'danger' : undefined],
  ]
  const content = Array.isArray(data.top_content) ? data.top_content.slice(0, 8) : []
  const viewsOf = row => number(row?.views ?? row?.total_views ?? row?.pv)
  const maxViews = content.reduce((max, row) => Math.max(max, viewsOf(row)), 0)
  if (detailed) {
    return h('div', { className: 'yd-detail-stack yd-geo-detail' },
      h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, , tone]) =>
        h(Metric, { key: label, icon, label, value: value ?? '—', muted: value === null, tone }))),
      h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, t('topContent')), h(SourceState, { source, t, compact: true })),
        content.length ? h('div', { className: 'yd-list' }, ...content.map((item, index) => {
          const row = item && typeof item === 'object' ? item : {}
          const title = String(row.title || row.name || row.path || t('untitledContent'))
          return h(ShareBar, { key: `${index}-${row.id || ''}`, label: title, value: viewsOf(row), total: maxViews })
        })) : h('p', { className: 'yd-inline-empty' }, t('empty'))),
      h(GeoInsightSections, { data, t, detailed: true }))
  }
  return h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, , tone]) =>
    h(Metric, { key: label, icon, label, value: value ?? '—', muted: value === null, tone })))
}

function UsageView({ source, t, detailed = false }) {
  if (source?.status !== 'ready' && source?.status !== 'empty') return h(EmptyState, { source, t })
  const data = source.data || {}
  // 趋势形态（近 N 天）：窗口汇总 + 每日消费条 + 路由归因
  if (Array.isArray(data.days)) {
    const currency = data.currency
    const totals = data.totals || {}
    const comparison = source.comparison
    const cost = metricDisplay(totals.cost, value => formatMoney(value, currency))
    const moneyText = value => formatMoney(value, currency)
    const p95 = data.days.reduce((max, day) => Math.max(max, day.latencyP95Ms === null ? 0 : number(day.latencyP95Ms)), 0)
    const metrics = [
      ['send', t('requests'), metricDisplay(totals.requests), comparisonText(t, comparison, 'requests')],
      ['spark', t('cost'), cost, comparisonText(t, comparison, 'cost', moneyText)],
      ['layers', t('tokens'), metricDisplay(totals.totalTokens), comparisonText(t, comparison, 'totalTokens')],
      ['clock', t('latency'), p95 > 0 ? `${formatNumber(p95)}ms` : null],
    ]
    const routes = Array.isArray(data.byRoute) ? data.byRoute : []
    const members = Array.isArray(data.byMember) ? data.byMember : []
    const budgets = Array.isArray(data.budgets) ? data.budgets : []
    const memberSection = members.length ? h('section', { className: 'yd-table-section' },
      h('div', { className: 'yd-section-heading' }, h('h2', null, t('member'))),
      h('div', { className: 'yd-table', role: 'table' },
        h('div', { className: 'yd-table-row yd-table-head', role: 'row' },
          h('span', null, t('member')), h('span', null, t('calls')), h('span', null, t('amount'))),
        ...members.map(member => h('div', { className: 'yd-table-row', role: 'row', key: member.memberId },
          h('strong', null, member.displayName || member.memberId), h('span', null, formatNumber(member.requests)),
          h('span', null, formatMoney(member.cost, currency)))))) : null
    if (detailed) {
      return h('div', { className: 'yd-detail-stack yd-usage-detail' },
        h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint]) =>
          h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null }))),
        h(TrendSection, { title: t('cost'), days: data.days, valueOf: day => day.cost, format: moneyText }),
        budgets.length ? h('section', { className: 'yd-table-section' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, t('budget'))),
          h('div', { className: 'yd-list' }, ...budgets.map(budget => {
            const share = number(budget.limit) > 0 ? number(budget.used) / number(budget.limit) : 0
            return h(ShareBar, {
              key: budget.name,
              label: budget.name,
              value: budget.used,
              total: budget.limit,
              display: `${moneyText(budget.used)} / ${moneyText(budget.limit)}`,
              tone: share >= 0.85 ? 'danger' : share >= 0.6 ? 'warning' : undefined,
            })
          }))) : null,
        h('section', { className: 'yd-table-section' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, t('byRoute')), h(SourceState, { source, t, compact: true })),
          routes.length ? h('div', { className: 'yd-table', role: 'table' },
            h('div', { className: 'yd-table-row yd-table-head', role: 'row' },
              h('span', null, t('route')), h('span', null, t('calls')), h('span', null, t('amount'))),
            ...routes.map(route => h('div', { className: 'yd-table-row', role: 'row', key: route.route },
              h('strong', null, route.route), h('span', null, formatNumber(route.requests)),
              h('span', null, formatMoney(route.cost, currency))))) : h('p', { className: 'yd-inline-empty' }, t('empty'))),
        memberSection)
    }
    return h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint]) =>
      h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null }))
    )
  }
  const summary = data.summary || {}
  const currency = data.currency
  const models = Array.isArray(data.byModel) ? data.byModel : []
  const cost = metricDisplay(summary.cost, value => formatMoney(value, currency))
  const metrics = [
    ['send', t('requests'), metricDisplay(summary.requests)],
    ['spark', t('cost'), cost],
    ['database', t('models'), metricDisplay(models.length)],
    ['layers', t('tokens'), metricDisplay(summary.totalTokens)],
  ]
  const costTotal = models.reduce((sum, model) => sum + number(model.cost), 0)
  const composition = costTotal > 0
    ? [...models].sort((left, right) => number(right.cost) - number(left.cost)).map(model =>
      h(ShareBar, { key: model.model, label: model.model, value: model.cost, total: costTotal, display: formatMoney(model.cost, currency) }))
    : []
  if (detailed) {
    return h('div', { className: 'yd-detail-stack yd-usage-detail' },
      h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value]) =>
        h(Metric, { key: label, icon, label, value: value ?? '—', muted: value === null }))),
      composition.length ? h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, t('amount'))),
        h('div', { className: 'yd-list' }, ...composition)) : null,
      h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, t('models')), h(SourceState, { source, t, compact: true })),
        models.length ? h('div', { className: 'yd-table', role: 'table' },
          h('div', { className: 'yd-table-row yd-table-head', role: 'row' },
            h('span', null, t('model')), h('span', null, t('calls')), h('span', null, t('input')), h('span', null, t('output')), h('span', null, t('amount'))),
          ...models.map(model => h('div', { className: 'yd-table-row', role: 'row', key: model.model },
            h('strong', null, model.model), h('span', null, formatNumber(model.requests)),
            h('span', null, formatNumber(model.inputTokens)), h('span', null, formatNumber(model.outputTokens)),
            h('span', null, formatMoney(model.cost, data.currency))))) : h('p', { className: 'yd-inline-empty' }, t('empty'))))
  }
  return h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value]) =>
    h(Metric, { key: label, icon, label, value: value ?? '—', muted: value === null })))
}

function ActivityView({ source, t, detailed = false }) {
  if (source?.status !== 'ready' && source?.status !== 'empty') return h(EmptyState, { source, t })
  const data = source.data || {}
  // 趋势形态（近 N 天）：窗口汇总 + 每日轮次条 + 环比
  if (Array.isArray(data.days)) {
    const totals = data.totals || {}
    const comparison = source.comparison
    const failed = number(totals.failedTurns)
    const metrics = [
      ['agent', t('sessions'), metricDisplay(totals.sessions), comparisonText(t, comparison, 'sessions')],
      ['send', t('turns'), metricDisplay(totals.turns), comparisonText(t, comparison, 'turns')],
      ['check', t('completed'), metricDisplay(totals.completedTurns), comparisonText(t, comparison, 'completedTurns')],
      ['warning', t('failed'), metricDisplay(failed), comparisonText(t, comparison, 'failedTurns'), failed > 0 ? 'danger' : undefined],
    ]
    return h(React.Fragment, null,
      h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint, tone]) =>
        h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null, tone }))),
      detailed ? h(TrendSection, { title: t('turns'), days: data.days, valueOf: day => day.turns }) : null)
  }
  const totals = data.totals || {}
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  const tools = Array.isArray(data.tools) ? data.tools : []
  const failed = number(totals.failedTurns)
  const metrics = [
    ['agent', t('sessions'), metricDisplay(totals.sessions)],
    ['send', t('turns'), metricDisplay(totals.turns)],
    ['check', t('completed'), metricDisplay(totals.completedTurns)],
    ['warning', t('failed'), metricDisplay(failed), undefined, failed > 0 ? 'danger' : undefined],
  ]
  const callsTotal = number(totals.toolCalls)
  const toolBars = tools.slice(0, 12).map(tool =>
    h(ShareBar, { key: tool.name, label: tool.name, value: tool.calls, total: callsTotal }))
  return h(React.Fragment, null,
    h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, , tone]) =>
      h(Metric, { key: label, icon, label, value: value ?? '—', muted: value === null, tone }))),
    detailed ? h('div', { className: 'yd-activity-grid' },
      h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, t('session')), h(SourceState, { source, t, compact: true })),
        sessions.length ? h('div', { className: 'yd-list' }, ...sessions.map((session, index) =>
          h('div', { className: 'yd-list-row yd-session-row', key: `${session.title}-${index}` },
            h('div', null, h('strong', null, session.title), h('span', null, session.workspace)),
            h('span', { className: session.failedTurns > 0 ? 'yd-text-danger' : '' }, `${session.completedTurns || 0}/${session.turns || 0}`))))
          : h('p', { className: 'yd-inline-empty' }, t('empty'))),
      h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, t('tool'))),
        toolBars.length ? h('div', { className: 'yd-list' }, ...toolBars)
          : h('p', { className: 'yd-inline-empty' }, t('empty')))) : null)
}

function GeorankView({ source, t, detailed = false }) {
  if (source?.status !== 'ready' && source?.status !== 'empty') return h(EmptyState, { source, t })
  const data = source.data || {}
  const totals = data.totals || {}
  const score = metricDisplay(data.benchmarkScore ?? data.averageGeoScore)
  const metrics = [
    ['spark', t('georankScore'), score],
    ['geo', t('georankPublished'), metricDisplay(totals.publishedCompanies)],
    ['check', t('georankScored'), metricDisplay(totals.scoredCompanies)],
  ]
  const distribution = Object.entries(data.scoreDistribution || {}).map(([key, value]) => ({ key, value: number(value) }))
  const total = distribution.reduce((sum, item) => sum + item.value, 0)
  const recent = Array.isArray(data.recentCompanies) ? data.recentCompanies : []
  const label = key => ({ excellent: '80+', good: '60-79', average: '40-59', poor: '<40' }[key] || key)
  const body = h(React.Fragment, null,
    h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, itemLabel, value]) => h(Metric, { key: itemLabel, icon, label: itemLabel, value: value ?? '—', muted: value === null }))),
    detailed ? h(React.Fragment, null,
      h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, t('scoreDistribution')), h(SourceState, { source, t, compact: true })),
        distribution.length ? h('div', { className: 'yd-list' }, ...distribution.map(item => h(ShareBar, { key: item.key, label: label(item.key), value: item.value, total, display: `${formatNumber(item.value)} / ${formatNumber(total)}` }))) : h('p', { className: 'yd-inline-empty' }, t('empty'))),
      h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, t('recentCompanies'))),
        recent.length ? h('div', { className: 'yd-list' }, ...recent.map((item, index) => h('div', { className: 'yd-list-row yd-session-row', key: item.id || index },
          h('div', null, h('strong', null, item.name || '—'), h('span', null, item.category || '—')),
          h('span', null, item.geoScore === null || item.geoScore === undefined ? '—' : `${formatNumber(item.geoScore)}${item.isGeoCertified ? ` · ${t('geoCertified')}` : ''}`)))) : h('p', { className: 'yd-inline-empty' }, t('empty')))) : null)
  return detailed ? h('div', { className: 'yd-detail-stack yd-georank-detail' }, body) : body
}

function MontageView({ source, t, detailed = false }) {
  if (source?.status !== 'ready' && source?.status !== 'empty') return h(EmptyState, { source, t })
  const data = source.data || {}
  // 趋势形态（近 N 天）：窗口汇总 + 每日作业条 + 状态分布
  if (Array.isArray(data.days)) {
    const totals = data.totals || {}
    const comparison = source.comparison
    const approvals = number(totals.waiting_approval)
    const failed = number(totals.failed)
    const metrics = [
      ['play', t('montageJobs'), metricDisplay(totals.total), comparisonText(t, comparison, 'total')],
      ['running', t('montageRunning'), metricDisplay(totals.running), comparisonText(t, comparison, 'running')],
      ['checklist', t('pendingApprovals'), metricDisplay(approvals), comparisonText(t, comparison, 'waiting_approval'), approvals > 0 ? 'danger' : undefined],
      ['warning', t('montageFailed'), metricDisplay(failed), comparisonText(t, comparison, 'failed'), failed > 0 ? 'danger' : undefined],
    ]
    const statusBars = [
      [t('montageQueued'), totals.queued],
      [t('montageRunning'), totals.running],
      [t('montageCompleted'), totals.succeeded],
      [t('montageFailed'), totals.failed, failed > 0 ? 'danger' : undefined],
    ].map(([label, value, tone]) => h(ShareBar, { key: label, label, value, total: number(totals.total), tone }))
    if (detailed) {
      return h('div', { className: 'yd-detail-stack yd-montage-detail' },
        h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint, tone]) =>
          h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null, tone }))),
        h(TrendSection, { title: t('montageJobs'), days: data.days, valueOf: day => day.total }),
        h('section', { className: 'yd-table-section' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, `${t('montage')} · ${t('stage')}`)),
          h('div', { className: 'yd-list' }, ...statusBars)),
        Array.isArray(data.stageStats) && data.stageStats.length ? h('section', { className: 'yd-table-section' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, t('stageStats'))),
          h('div', { className: 'yd-table', role: 'table' },
            h('div', { className: 'yd-table-row yd-table-head', role: 'row' },
              h('span', null, t('stage')), h('span', null, t('calls')), h('span', null, t('failed')),
              h('span', null, 'P50'), h('span', null, 'P95')),
            ...data.stageStats.map(stage => h('div', { className: 'yd-table-row', role: 'row', key: stage.stage },
              h('strong', null, stage.stage), h('span', null, formatNumber(stage.count)),
              h('span', { className: number(stage.failed) > 0 ? 'yd-text-danger' : '' }, formatNumber(stage.failed)),
              h('span', null, stage.durationP50Ms === null ? '—' : `${formatNumber(stage.durationP50Ms)}ms`),
              h('span', null, stage.durationP95Ms === null ? '—' : `${formatNumber(stage.durationP95Ms)}ms`))))) : null)
    }
    return h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint, tone]) =>
      h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null, tone })))
  }
  const jobs = data.jobs || {}
  const artifacts = data.artifacts || {}
  const recentJobs = Array.isArray(data.recentJobs) ? data.recentJobs : []
  const recentArtifacts = Array.isArray(artifacts.recent) ? artifacts.recent : []
  const workers = Array.isArray(data.health?.workers) ? data.health.workers : []
  const approvals = number(data.pendingApprovals)
  const approvalsMeta = data.approvals || {}
  const oldestClock = approvalsMeta.oldestWaitingAt ? formatClock(approvalsMeta.oldestWaitingAt) : ''
  const metrics = [
    ['play', t('montageJobs'), metricDisplay(jobs.total)],
    ['running', t('montageRunning'), metricDisplay(jobs.running)],
    ['checklist', t('pendingApprovals'), metricDisplay(data.pendingApprovals), approvals > 0 && oldestClock ? `${t('oldestWaiting')} ${oldestClock}` : undefined, approvals > 0 ? 'danger' : undefined],
    ['archive', t('artifacts'), metricDisplay(artifacts.total)],
  ]
  const total = number(jobs.total)
  const distribution = jobs.total === null || jobs.total === undefined ? [] : [
    [t('montageQueued'), jobs.queued],
    [t('montageRunning'), jobs.running],
    [t('montageCompleted'), jobs.completed, undefined],
    [t('montageFailed'), jobs.failed, total > 0 && number(jobs.failed) > 0 ? 'danger' : undefined],
  ]
  const serviceRow = data.health?.service
    ? h('div', { className: 'yd-source-row', key: 'service' },
      h('div', null, h('strong', null, t('montage'))),
      h(SourceState, { source: { status: healthState(data.health.service) }, t }))
    : null
  const workerRows = workers.map(worker =>
    h('div', { className: 'yd-source-row', key: worker.id || worker.status },
      h('div', null, h('strong', null, String(worker.id || t('workers'))), worker.lastHeartbeatAt ? h('span', null, `${t('heartbeat')} ${formatClock(worker.lastHeartbeatAt)}`) : null),
      h(SourceState, { source: { status: healthState(worker.status) }, t })))
  const waitRows = [
    [t('oldestWaiting'), approvalsMeta.oldestWaitingAt ? formatClock(approvalsMeta.oldestWaitingAt) : null],
    [t('waitP50'), approvalsMeta.waitP50Ms === null || approvalsMeta.waitP50Ms === undefined ? null : `${formatNumber(approvalsMeta.waitP50Ms)}ms`],
    [t('waitP95'), approvalsMeta.waitP95Ms === null || approvalsMeta.waitP95Ms === undefined ? null : `${formatNumber(approvalsMeta.waitP95Ms)}ms`],
  ]
  const approvalsSection = approvals > 0 ? h('section', { className: 'yd-table-section' },
    h('div', { className: 'yd-section-heading' }, h('h2', null, t('pendingApprovals')), h('button', {
      type: 'button', className: 'yd-domain-link', onClick: () => window.dispatchEvent(new CustomEvent('dofe:yootun-approvals:open')),
    }, t('openApprovals'), h(Glyph, { name: 'chevron', size: 12 }))),
    h('div', { className: 'yd-list' }, ...waitRows.map(([label, value]) =>
      h('div', { className: 'yd-list-row', key: label },
        h('span', { className: 'yd-rank' }, '·'),
        h('strong', null, label),
        h('span', null, value ?? '—'))))) : null
  const detail = detailed ? h(React.Fragment, null,
    approvalsSection,
    h('section', { className: 'yd-table-section' },
      h('div', { className: 'yd-section-heading' }, h('h2', null, t('recentJobs')), h(SourceState, { source, t, compact: true })),
      recentJobs.length ? h('div', { className: 'yd-list' }, ...recentJobs.map((job, index) =>
        h('div', { className: 'yd-list-row yd-session-row', key: `${job.id || index}` },
          h('div', null, h('strong', null, String(job.title || t('untitledJob'))), h('span', null, String(job.stage || t('noStage')))),
          h('span', { className: job.status === 'failed' ? 'yd-text-danger' : '' }, String(job.status || '—')))))
        : h('p', { className: 'yd-inline-empty' }, t('empty'))),
    h('div', { className: 'yd-activity-grid' },
      h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, t('recentArtifacts'))),
        recentArtifacts.length ? h('div', { className: 'yd-list' }, ...recentArtifacts.map((artifact, index) =>
          h('div', { className: 'yd-list-row yd-session-row', key: `${artifact.id || index}` },
            h('div', null, h('strong', null, String(artifact.title || t('untitledJob'))), h('span', null, String(artifact.jobId || ''))),
            h('span', null, String(artifact.kind || '—')))))
          : h('p', { className: 'yd-inline-empty' }, t('empty'))),
      h('section', { className: 'yd-table-section' },
        h('div', { className: 'yd-section-heading' }, h('h2', null, `${t('montage')} · ${t('stage')}`)),
        distribution.length ? h('div', { className: 'yd-list' }, ...distribution.map(([label, value, tone]) =>
          h(ShareBar, { key: label, label, value, total, tone }))) : h('p', { className: 'yd-inline-empty' }, t('empty')),
        h('div', { className: 'yd-section-heading yd-subsection-heading' }, h('h2', null, t('health'))),
        h('div', { className: 'yd-list' }, serviceRow, ...workerRows)))) : null
  if (detailed) {
    return h('div', { className: 'yd-detail-stack yd-montage-detail' },
      h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint, tone]) =>
        h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null, tone }))),
      detail)
  }
  return h('div', { className: 'yd-metrics' }, ...metrics.map(([icon, label, value, hint, tone]) =>
    h(Metric, { key: label, icon, label, value: value ?? '—', hint, muted: value === null, tone })))
}

// 导出当前范围数据为 CSV（BOM 兼容 Excel）：趋势形态逐日一行，昨日形态逐指标一行。
function buildCsvRows(data, t) {
  const sources = ['geo', 'georank', 'usage', 'activity', 'montage']
  const dateMaps = Object.fromEntries(sources.map(name => [name, new Map(
    (Array.isArray(data?.[name]?.data?.days) ? data[name].data.days : [])
      .filter(day => typeof day?.date === 'string')
      .map(day => [day.date, day]),
  )]))
  const dates = [...new Set(sources.flatMap(name => [...dateMaps[name].keys()]))].sort()
  if (dates.length) {
    const value = (source, date, key) => dateMaps[source].get(date)?.[key] ?? ''
    const geoValue = date => {
      const metrics = ['views', 'articles', 'published'].map(key => value('geo', date, key))
      return metrics.every(metric => metric === '') ? '' : metrics.join('/')
    }
    return [
      ['date', `${t('views')}/${t('articles')}/${t('published')}`, t('requests'), t('cost'), t('tokens'), t('turns'), t('completed'), t('montageJobs'), t('montageFailed')],
      ...dates.map(date => [
        date,
        geoValue(date),
        value('usage', date, 'requests'), value('usage', date, 'cost'), value('usage', date, 'totalTokens'),
        value('activity', date, 'turns'), value('activity', date, 'completedTurns'),
        value('montage', date, 'total'), value('montage', date, 'failed'),
      ]),
    ]
  }
  const geo = data?.geo?.data?.kpis || {}
  const usage = data?.usage?.data?.summary || {}
  const activity = data?.activity?.data?.totals || {}
  const montage = data?.montage?.data || {}
  const georank = data?.georank?.data || {}
  return [
    ['domain', 'metric', 'value'],
    [t('geo'), t('views'), geo.total_views ?? ''],
    [t('geo'), t('articles'), geo.articles ?? ''],
    [t('geo'), t('published'), geo.published ?? ''],
    [t('geo'), t('failedTasks'), geo.failed_tasks ?? ''],
    [t('georank'), t('georankScore'), georank.benchmarkScore ?? georank.averageGeoScore ?? ''],
    [t('georank'), t('georankPublished'), georank.totals?.publishedCompanies ?? ''],
    [t('georank'), t('georankScored'), georank.totals?.scoredCompanies ?? ''],
    [t('usage'), t('requests'), usage.requests ?? ''],
    [t('usage'), t('tokens'), usage.totalTokens ?? ''],
    [t('usage'), t('cost'), usage.cost ?? ''],
    [t('activity'), t('sessions'), activity.sessions ?? ''],
    [t('activity'), t('turns'), activity.turns ?? ''],
    [t('activity'), t('completed'), activity.completedTurns ?? ''],
    [t('activity'), t('toolCalls'), activity.toolCalls ?? ''],
    [t('montage'), t('montageJobs'), montage.jobs?.total ?? ''],
    [t('montage'), t('montageRunning'), montage.jobs?.running ?? ''],
    [t('montage'), t('montageFailed'), montage.jobs?.failed ?? ''],
    [t('montage'), t('pendingApprovals'), montage.pendingApprovals ?? ''],
  ]
}

function hasExportableData(data) {
  return ['geo', 'usage', 'activity', 'montage'].some(name => {
    const value = data?.[name]?.data
    return value && typeof value === 'object' && Object.keys(value).length > 0
  })
}

function exportCsv(data, t) {
  const csv = `﻿${buildCsvRows(data, t).map(row => row.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const dayTag = data?.period?.days ? `${data.period.days}d` : 'yesterday'
  link.download = `yootun-dashboard-${dayTag}-${data?.period?.date || String(data?.period?.start || '').slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// 管理者偏好（P2）：默认范围与视角持久化在本地（桌面单机语义），只记住用户
// 明确选过的值；阈值类自定义按 docs/01 的门槛留待真实用户验证后再做。
const PREFS_KEY = 'dofe.yootun-dashboard:prefs'

function loadPrefs() {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(PREFS_KEY)
    const prefs = raw ? JSON.parse(raw) : {}
    const range = RANGES.some(item => item.id === prefs.range) ? prefs.range : undefined
    const usageScope = prefs.usageScope === 'team' ? 'team' : prefs.usageScope === 'key' ? 'key' : undefined
    return { ...(range ? { range } : {}), ...(usageScope ? { usageScope } : {}) }
  } catch {
    return {}
  }
}

function savePrefs(prefs) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // 隐私模式等存储不可用时静默降级为会话内默认值
  }
}

function DomainCard({ glyph, title, source, t, hint, onOpen, children }) {
  return h('article', { className: 'yd-domain-card' },
    h('div', { className: 'yd-section-heading' },
      h('h2', { className: 'yd-domain-title' }, h(Glyph, { name: glyph, size: 16 }), title),
      h(SourceState, { source, t, compact: true })),
    children,
    h('p', { className: 'yd-domain-hint' }, hint),
    h('button', { type: 'button', className: 'yd-domain-link', onClick: onOpen }, t('viewDetail'), h(Glyph, { name: 'chevron', size: 12 })))
}

function Overview({ data, t, onOpenTab }) {
  const open = tab => () => onOpenTab?.(tab)
  return h('div', { className: 'yd-overview' },
    h(HealthStrip, { data, t }),
    h(AttentionSection, { data, t, onOpenTab }),
    h('div', { className: 'yd-domain-grid' },
      h(DomainCard, {
        glyph: 'geo', title: t('geo'), source: data.geo, t,
        hint: domainHint(data.geo, t, 'views', geoRateHint(data.geo, t)), onOpen: open('geo'),
      }, h(React.Fragment, null, h(GeoMetrics, { source: data.geo, t }), data.georank?.status === 'ready' || data.georank?.status === 'empty' ? h(GeorankView, { source: data.georank, t }) : null)),
      h(DomainCard, {
        glyph: 'spark', title: t('usage'), source: data.usage, t,
        hint: domainHint(data.usage, t, 'cost', usageRateHint(data.usage, t)), onOpen: open('usage'),
      }, h(UsageView, { source: data.usage, t })),
      h(DomainCard, {
        glyph: 'agent', title: t('activity'), source: data.activity, t,
        hint: domainHint(data.activity, t, 'turns', activityRateHint(data.activity, t)), onOpen: open('activity'),
      }, h(ActivityView, { source: data.activity, t })),
      h(DomainCard, {
        glyph: 'play', title: t('montage'), source: data.montage, t,
        hint: domainHint(data.montage, t, 'total', montageRateHint(data.montage, t)), onOpen: open('montage'),
      }, h(MontageView, { source: data.montage, t }))),
    h(SourceBand, { data, t }))
}

function DashboardButton({ wide, t }) {
  return h(Tooltip, { label: t('open'), delayMs: 500, disabled: wide },
    h('button', { type: 'button', className: `yd-sidebar-action${wide ? ' yd-sidebar-wide' : ''}`, onClick: openOverlay, 'aria-label': t('open') },
      h(IconDataOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null))
}

function DashboardOverlay({ t }) {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [tab, setTab] = useState('overview')
  const [range, setRange] = useState(() => loadPrefs().range || 'yesterday')
  const [usageScope, setUsageScope] = useState(() => loadPrefs().usageScope || 'key')
  const [dataByRange, setDataByRange] = useState({})
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const dataKey = range === 'yesterday' ? range : `${range}:${usageScope}`
  const data = dataByRange[dataKey]

  useEffect(() => {
    if (!visible) return undefined
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void loadDashboard(range, usageScope, controller.signal)
      .then(value => { setDataByRange(previous => ({ ...previous, [dataKey]: value })); setFailed(false) })
      .catch(error => { if (error?.name !== 'AbortError') setFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [visible, revision, range, usageScope, dataKey])

  useEffect(() => {
    if (!visible) return undefined
    const onKeyDown = event => { if (event.key === 'Escape') setOpened(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visible])

  const periodLabel = useMemo(() => data?.period?.date || data?.period?.label || '', [data?.period?.date, data?.period?.label])
  if (!visible) return null
  let body
  if (loading && !data) body = h('div', { className: 'yd-loading', role: 'status' }, h('span', { className: 'yd-spinner' }), t('loading'))
  else if (failed && !data) body = h('div', { className: 'yd-fatal', role: 'alert' }, h('strong', null, t('error')), h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, t('retry')))
  else if (data) {
    body = tab === 'overview' ? h(Overview, { data, t, onOpenTab: setTab })
      : tab === 'geo' ? h(React.Fragment, null, h(GeoMetrics, { source: data.geo, t, detailed: true }), data.georank?.status === 'ready' || data.georank?.status === 'empty' ? h(GeorankView, { source: data.georank, t, detailed: true }) : null)
        : tab === 'usage' ? h(UsageView, { source: data.usage, t, detailed: true })
          : tab === 'activity' ? h(ActivityView, { source: data.activity, t, detailed: true })
            : h(MontageView, { source: data.montage, t, detailed: true })
  }

  return h('div', { className: 'yd-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'yd-title' },
    h('main', { className: 'yd-shell', 'aria-labelledby': 'yd-title' },
      h('header', { className: 'yd-header' },
        h('div', null,
          h('div', { className: 'yd-title-line' },
            h('h1', { id: 'yd-title' }, t('title')),
            periodLabel ? h('time', null, `${periodLabel}${data?.period?.timeZone ? ` · ${data.period.timeZone}` : ''}`) : null,
            data?.refreshedAt ? h('span', { className: 'yd-updated' }, `${t('lastUpdated')} ${formatClock(data.refreshedAt)}`) : null,
            loading && data ? h('span', { className: 'yd-refreshing-flag', role: 'status' }, t('refreshing')) : null),
          h('p', null, t('subtitle'))),
        h('div', { className: 'yd-header-actions' },
          h(Tooltip, { label: t('exportCsv'), side: 'bottom' }, h('button', { type: 'button', className: 'yd-icon-button', disabled: !hasExportableData(data), onClick: () => exportCsv(data, t), 'aria-label': t('exportCsv') }, h(IconDownloadOutline16, { size: 16 }))),
          h('div', { className: 'yd-ranges', role: 'group', 'aria-label': t('rangeControl') }, ...RANGES.map(item =>
            h('button', {
              type: 'button', key: item.id, 'data-active': range === item.id, 'aria-pressed': range === item.id,
              onClick: () => { setRange(item.id); savePrefs({ range: item.id, usageScope }) },
            }, t(item.label)))),
          range === 'yesterday' ? null : h('div', { className: 'yd-ranges', role: 'group', 'aria-label': t('scopeControl') }, ...['key', 'team'].map(id =>
            h('button', {
              type: 'button', key: id, 'data-active': usageScope === id, 'aria-pressed': usageScope === id,
              onClick: () => { setUsageScope(id); savePrefs({ range, usageScope: id }) },
            }, t(id === 'team' ? 'scopeTeam' : 'scopeKey')))),
          h(Tooltip, { label: t('refresh'), side: 'bottom' }, h('button', { type: 'button', className: 'yd-icon-button', disabled: loading, onClick: () => setRevision(value => value + 1), 'aria-label': t('refresh') }, h(IconRefreshOutline16, { size: 16 }))),
          h(Tooltip, { label: t('close'), side: 'bottom' }, h('button', { type: 'button', className: 'yd-icon-button', onClick: () => setOpened(false), 'aria-label': t('close') }, h(IconCloseOutline16, { size: 16 }))))),
      h('nav', { className: 'yd-tabs', 'aria-label': t('title') }, ...TABS.map(item =>
        h('button', { type: 'button', key: item.id, 'aria-current': tab === item.id ? 'page' : undefined, onClick: () => setTab(item.id) }, t(item.label)))),
      failed && data ? h('div', { className: 'yd-stale', role: 'status' }, t('error')) : null,
      h('div', { className: `yd-content${loading && data ? ' yd-refreshing' : ''}` }, body)))
}

const css = `
.yd-sidebar-action{box-sizing:border-box;display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.yd-sidebar-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yd-sidebar-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yd-sidebar-wide span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.yd-overlay{pointer-events:auto;position:fixed;inset:0;z-index:500;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yd-shell{display:grid;grid-template-rows:auto auto auto 1fr;width:100%;height:100%;overflow:hidden}.yd-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;gap:20px;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-title-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px}.yd-header h1{margin:0;font-size:20px;line-height:1.3;letter-spacing:0}.yd-header time{color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}.yd-updated,.yd-refreshing-flag{color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}.yd-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yd-header-actions{display:flex;align-items:center;gap:6px}.yd-icon-button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.yd-icon-button:hover{background:var(--dsw-alias-bg-layer-2)}.yd-icon-button:disabled{opacity:.45;cursor:default}.yd-ranges{display:flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}.yd-ranges button{min-height:28px;padding:0 10px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}.yd-ranges button[data-active=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}.yd-trend{display:flex;align-items:flex-end;gap:2px;height:56px;padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-trend-bar{flex:1;min-width:3px;min-height:3px;background:var(--dsw-alias-brand-primary);border-radius:1px 1px 0 0}.yd-tabs{display:flex;gap:2px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto}.yd-tabs button{height:42px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}.yd-tabs button[aria-current]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yd-content{overflow:auto;padding:22px 24px 40px}.yd-content.yd-refreshing{opacity:.55;transition:opacity .2s}.yd-overview{display:grid;gap:28px;max-width:1440px;margin:0 auto}.yd-domain,.yd-domain-card,.yd-table-section,.yd-source-band{min-width:0}.yd-health{display:flex;flex-wrap:wrap;gap:10px}.yd-chip{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px}.yd-chip strong{color:var(--dsw-alias-label-primary);font-size:12px;font-variant-numeric:tabular-nums}.yd-chip[data-tone=good]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,var(--dsw-alias-border-l1))}.yd-chip[data-tone=warning]{border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 45%,var(--dsw-alias-border-l1))}.yd-chip[data-tone=warning] svg{color:var(--dsw-alias-state-warning-primary)}.yd-attention-list{border-top:1px solid var(--dsw-alias-border-l1)}.yd-attention-row{display:flex;align-items:stretch;border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-attention-main{flex:1;min-width:0;display:flex;align-items:center;gap:12px;min-height:46px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer;padding:0}.yd-attention-main:hover{background:var(--dsw-alias-bg-layer-2)}.yd-attention-action{flex:none;border:0;border-left:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;padding:0 12px;cursor:pointer}.yd-attention-action:hover{background:var(--dsw-alias-bg-layer-2)}.yd-attention-icon{flex:none;color:var(--dsw-alias-state-warning-primary)}.yd-attention-main strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:inherit}.yd-attention-main span{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.yd-attention-go{flex:none;color:var(--dsw-alias-label-tertiary)}.yd-domain-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.yd-domain-card{display:grid;gap:14px;align-content:start;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yd-domain-title{display:inline-flex;align-items:center;gap:8px;margin:0;font-size:14px;line-height:1.4}.yd-domain-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}.yd-domain-link{display:inline-flex;align-self:start;align-items:center;gap:4px;min-height:30px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}.yd-domain-link:hover{background:var(--dsw-alias-bg-layer-2)}.yd-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:11px}.yd-section-heading h2{margin:0;font-size:14px;line-height:1.4;letter-spacing:0}.yd-section-heading p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.yd-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-domain-card .yd-metrics{grid-template-columns:repeat(2,minmax(0,1fr));border-top:0;border-bottom:0}.yd-metric{display:grid;min-height:82px;align-content:center;gap:6px;padding:12px 16px;border-right:1px solid var(--dsw-alias-border-l1)}.yd-domain-card .yd-metric{min-height:70px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-domain-card .yd-metric:nth-child(2n){border-right:0}.yd-domain-card .yd-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-domain-card .yd-metric:nth-last-child(-n+2){border-bottom:0}.yd-metric:last-child{border-right:0}.yd-metric-head{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.yd-metric-head svg{flex:none;color:var(--dsw-alias-label-tertiary)}.yd-metric span{color:var(--dsw-alias-label-secondary);font-size:12px}.yd-metric strong{font-size:24px;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:0;overflow-wrap:anywhere}.yd-domain-card .yd-metric strong{font-size:20px}.yd-metric-hint{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}.yd-metric-missing strong{color:var(--dsw-alias-label-tertiary)}.yd-metric-danger strong,.yd-text-danger{color:var(--dsw-alias-state-error-primary)}.yd-metric-danger .yd-metric-head svg{color:var(--dsw-alias-state-error-primary)}.yd-source{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.yd-source-icon{color:var(--dsw-alias-label-tertiary)}.yd-source-ready .yd-source-icon{color:var(--dsw-alias-state-success-primary)}.yd-source-warning .yd-source-icon,.yd-source-empty .yd-source-icon{color:var(--dsw-alias-state-warning-primary)}.yd-source-error .yd-source-icon{color:var(--dsw-alias-state-error-primary)}.yd-source-list{border-top:1px solid var(--dsw-alias-border-l1)}.yd-source-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:54px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-source-row>div{display:grid;gap:3px}.yd-source-row strong{font-size:13px}.yd-source-row span{color:var(--dsw-alias-label-secondary);font-size:12px}.yd-source-meta{display:flex;flex:none;align-items:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}.yd-badge{display:inline-flex;align-items:center;min-height:20px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}.yd-badge-warning{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}.yd-share{display:grid;gap:5px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-share-head{display:flex;justify-content:space-between;gap:12px;font-size:12px}.yd-share-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.yd-share-head span{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.yd-share-track{height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}.yd-share-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary)}.yd-share-danger{background:var(--dsw-alias-state-error-primary)}.yd-share-warning{background:var(--dsw-alias-state-warning-primary)}.yd-list,.yd-table{border-top:1px solid var(--dsw-alias-border-l1)}.yd-list-row{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:46px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}.yd-list-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.yd-list-row>span:last-child{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.yd-rank{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}.yd-session-row{grid-template-columns:minmax(0,1fr) auto}.yd-session-row>div{display:grid;gap:3px;min-width:0}.yd-session-row>div span{color:var(--dsw-alias-label-secondary)}.yd-table-row{display:grid;grid-template-columns:minmax(180px,2fr) repeat(4,minmax(90px,1fr));gap:12px;align-items:center;min-height:46px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;font-variant-numeric:tabular-nums}.yd-table-row strong{overflow-wrap:anywhere}.yd-table-head{min-height:34px;color:var(--dsw-alias-label-secondary);font-size:11px}.yd-activity-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:28px;margin-top:28px}.yd-empty,.yd-loading,.yd-fatal{display:grid;min-height:160px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:13px}.yd-empty p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px}.yd-empty-details{color:var(--dsw-alias-label-secondary);font-size:11px}.yd-empty-details summary{cursor:pointer}.yd-empty-details code{font-size:11px}.yd-empty-error svg{color:var(--dsw-alias-state-error-primary)}.yd-empty-unavailable svg{color:var(--dsw-alias-state-warning-primary)}.yd-fatal button{min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.yd-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:yd-spin .8s linear infinite}.yd-stale{padding:7px 24px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px}.yd-inline-empty{margin:20px 0;color:var(--dsw-alias-label-secondary);font-size:12px}@keyframes yd-spin{to{transform:rotate(360deg)}}@media(max-width:800px){.yd-header,.yd-tabs{padding-left:16px;padding-right:16px}.yd-content{padding:18px 16px 32px}.yd-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yd-metric:nth-child(2){border-right:0}.yd-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-domain-grid{grid-template-columns:1fr}.yd-activity-grid{grid-template-columns:1fr}.yd-table{overflow-x:auto}.yd-table-row{min-width:720px}}@media(max-width:480px){.yd-header{min-height:68px}.yd-header p{display:none}.yd-header-actions{flex-wrap:wrap;justify-content:flex-end}.yd-title-line{display:grid;gap:1px}.yd-header h1{font-size:17px}.yd-metric{min-height:72px;padding:10px}.yd-metric strong{font-size:20px}.yd-source-row{align-items:flex-start;padding:10px 0}.yd-source-meta{flex-wrap:wrap;justify-content:flex-end}.yd-section-heading{align-items:flex-start}.yd-section-heading p{max-width:60%}}
`

const inject = ['slots', 'locale']
const spacingCss = `
.yd-overlay,.yd-overlay *{box-sizing:border-box}
.yd-overlay{--yd-space-1:4px;--yd-space-2:8px;--yd-space-3:12px;--yd-space-4:16px;--yd-space-5:20px;--yd-space-6:24px;--yd-space-7:28px;--yd-content-gutter:24px;--yd-control-height:34px;--yd-row-height:48px;--yd-card-radius:6px}
.yd-header{gap:var(--yd-space-5);padding:var(--yd-space-4) var(--yd-content-gutter)}
.yd-title-line{gap:var(--yd-space-3)}
.yd-header-actions{gap:var(--yd-space-2)}
.yd-icon-button{width:var(--yd-control-height);height:var(--yd-control-height);border-radius:var(--yd-card-radius)}
.yd-ranges{gap:var(--yd-space-1);padding:var(--yd-space-1);border-radius:var(--yd-card-radius)}
.yd-ranges button{min-height:var(--yd-control-height);padding:0 var(--yd-space-3)}
.yd-tabs{gap:var(--yd-space-1);padding:0 var(--yd-content-gutter)}
.yd-tabs button{height:44px;padding:0 var(--yd-space-4)}
.yd-content{padding:var(--yd-space-6) var(--yd-content-gutter) var(--yd-space-7)}
.yd-overview{gap:var(--yd-space-6)}
.yd-health{gap:var(--yd-space-2)}
.yd-chip{gap:var(--yd-space-2);padding:0 var(--yd-space-3)}
.yd-attention-main{gap:var(--yd-space-3);min-height:var(--yd-row-height)}
.yd-attention-action{padding:0 var(--yd-space-3)}
.yd-domain-grid{gap:var(--yd-space-5)}
.yd-domain-card{gap:var(--yd-space-3);padding:var(--yd-space-4);border-radius:var(--yd-card-radius)}
.yd-domain-title{gap:var(--yd-space-2)}
.yd-domain-link{min-height:var(--yd-control-height);padding:0 var(--yd-space-2)}
.yd-section-heading{gap:var(--yd-space-4);margin-bottom:var(--yd-space-3)}
.yd-metric{gap:var(--yd-space-2);padding:var(--yd-space-3) var(--yd-space-4)}
.yd-domain-card .yd-metric{min-height:72px;padding:var(--yd-space-3)}
.yd-metric-head{gap:var(--yd-space-1)}
.yd-source{gap:var(--yd-space-2)}
.yd-source-row{gap:var(--yd-space-4);min-height:var(--yd-row-height)}
.yd-source-row>div{gap:var(--yd-space-1)}
.yd-source-meta{gap:var(--yd-space-3)}
.yd-share{gap:var(--yd-space-1);padding:var(--yd-space-2) 0}
.yd-share-head{gap:var(--yd-space-3)}
.yd-list-row{gap:var(--yd-space-2);min-height:var(--yd-row-height)}
.yd-session-row>div{gap:var(--yd-space-1)}
.yd-table-row{gap:var(--yd-space-3);min-height:var(--yd-row-height)}
.yd-activity-grid{gap:var(--yd-space-6);margin-top:var(--yd-space-6)}
.yd-empty,.yd-loading,.yd-fatal{gap:var(--yd-space-2)}
.yd-stale{padding:var(--yd-space-2) var(--yd-content-gutter)}
.yd-inline-empty{margin:var(--yd-space-4) 0}
.yd-detail-stack{display:grid;gap:var(--yd-space-6);align-content:start}
.yd-detail-stack>.yd-metrics,.yd-detail-stack>.yd-table-section{min-width:0}
.yd-table-row.yd-table-head{min-height:var(--yd-control-height)}
.yd-geo-detail .yd-inline-empty{display:flex;min-height:var(--yd-row-height);align-items:center;margin:0}
.yd-geo-detail>.yd-table-section>.yd-list>.yd-share{min-height:var(--yd-row-height);align-content:center}
.yd-usage-detail .yd-inline-empty{display:flex;min-height:var(--yd-row-height);align-items:center;margin:0}
.yd-usage-detail>.yd-table-section>.yd-list>.yd-share{min-height:var(--yd-row-height);align-content:center}
.yd-montage-detail .yd-inline-empty{display:flex;min-height:var(--yd-row-height);align-items:center;margin:0}
.yd-montage-detail>.yd-table-section>.yd-list>.yd-share{min-height:var(--yd-row-height);align-content:center}
.yd-montage-detail>.yd-activity-grid{margin-top:0}
.yd-montage-detail .yd-subsection-heading{margin-top:var(--yd-space-6)}
.yd-source-empty.yd-source-compact{gap:0;color:var(--dsw-alias-label-tertiary)}
.yd-capability-group{margin-top:var(--yd-space-6)}
@media(max-width:800px){.yd-overlay{--yd-content-gutter:16px}.yd-content{padding-top:var(--yd-space-5)}.yd-domain-grid{gap:var(--yd-space-4)}}
@media(max-width:480px){.yd-header{padding-top:var(--yd-space-3);padding-bottom:var(--yd-space-3)}.yd-content{padding-top:var(--yd-space-4)}}
`
const capabilityCss = '.yd-capability-group h3{margin:0 0 var(--yd-space-2);font-size:13px}'

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-dashboard: dictionaries')
  ctx.effect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    window.addEventListener(OVERLAY_EVENT, closeOtherOverlay)
    return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay)
  }, 'dofe-yootun-dashboard: exclusive-overlay')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@dofe/dsh-yootun-dashboard'
    style.textContent = css + spacingCss + capabilityCss
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dofe-yootun-dashboard: styles')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'dofe-yootun-dashboard', order: 10, inject: () => ({ t }),
  }, DashboardButton))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dofe-yootun-dashboard', order: 10, inject: () => ({ t }),
  }, DashboardOverlay))
}

exports.apply = apply
exports.inject = inject
