// 账号总览页 UI 模块（0914 方案 §5 线框，阶段 1；UI 优化方案 2026-09-16）。
//
// 职责边界（方案 §3.3/§11）：**只做展示与本地格式化**——数字千分位/万单位、
// `*Pct → x.x%`、时间本地化；不计算任何口径，爆款依据、覆盖率等全部直接渲染接口
// 字段。构建脚本把本模块内联进 lib/client.js（与 ui-format 同法），因此顶部同样
// 使用 CommonJS require（DSH 运行时提供）；ui-format 的纯函数经 import 引入并由
// 构建脚本剥离（内联后同作用域）。
//
// 状态映射与方案 §14 表一一对应：无账号 → 添加引导；有账号无作品 → "请先采集作品数据"；
// 会话过期 → 过期数量 + 重扫入口；可疑空采集（真实空账号命中属设计内，§3.3 第 8 点）
// → "可疑空采集/请检测会话"，绝不写"采集失败"；字段缺失 → "—"；样本不足 → "样本不足"；
// 全部失败 → 服务不可用，绝不置 0。
//
// UI 优化方案（2026-09-16）差异：账号筛选改单选（默认全部账号）、日期/排序控件带
// 可见说明文字、操作按钮靠右、表格列轨道按表分组固定、爆款依据纵向分行、
// 页面不展示规则版本/数据来源/参与样本数（字段仍由接口返回供导出与诊断）。

import { basisLines, formatDateTime } from './ui-format.js'

const React = require('react')
const { createElement: h } = React

// 万单位格式化（仅展示层换算，非口径）：≥1万 → x.x万，千分位分隔。
export function formatWan(value) {
  // null/undefined/空串是"缺失"（上层显示 —），绝不格式化成 0。
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  if (Math.abs(num) >= 10000) {
    const wan = num / 10000
    const digits = Math.abs(wan) >= 100 ? 0 : 1
    return `${wan.toFixed(digits)}万`
  }
  return num.toLocaleString('en-US')
}

function pctText(value) {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : '—'
}

function countText(value) {
  if (value === null || value === undefined) return '—'
  const formatted = formatWan(value)
  return formatted === null ? '—' : formatted
}

export function sessionFreshness(sessionCheckedAt, t, { now = Date.now() } = {}) {
  // 决策 11：session_checked_at 超过 24 小时显示"状态待检测"，不当作实时验证结果。
  if (!sessionCheckedAt) return { key: 'unknown', label: t('sessionUnknown') }
  const checked = Date.parse(sessionCheckedAt)
  if (!Number.isFinite(checked)) return { key: 'unknown', label: t('sessionUnknown') }
  if (now - checked > 24 * 60 * 60 * 1000) {
    return { key: 'stale', label: t('sessionStale') }
  }
  return { key: 'ok', label: t('sessionCheckValid') }
}

// 运营提醒（阶段 1 范围，决策 9）：由 dataQuality 派生的结构性提醒——
// 会话过期 / 可疑空采集 / 覆盖率缺口 / 最近采集过旧；内容类规则提醒属阶段 3。
export function deriveOverviewAlerts(overview, t, { now = Date.now() } = {}) {
  const alerts = []
  for (const account of overview?.accounts || []) {
    if (account.sessionStatus === 'expired') {
      alerts.push({ accountId: account.accountId, kind: 'session_expired', text: `${account.nickname || account.accountId}：${t('alertSessionExpired')}` })
    }
    if (account.suspiciousEmptyCollect) {
      alerts.push({ accountId: account.accountId, kind: 'suspicious_empty', text: `${account.nickname || account.accountId}：${t('alertSuspiciousEmpty')}` })
    }
    const lastCollected = account.lastCollectedAt ? Date.parse(account.lastCollectedAt) : NaN
    if (Number.isFinite(lastCollected) && now - lastCollected > 7 * 24 * 60 * 60 * 1000) {
      alerts.push({ accountId: account.accountId, kind: 'stale_collect', text: `${account.nickname || account.accountId}：${t('alertStaleCollect')}` })
    }
  }
  return alerts
}

function KpiCard({ label, value, hint, t }) {
  return h('div', { className: 'ydo-ov-kpi' },
    h('span', { className: 'ydo-ov-kpi-label' }, label),
    h('strong', { className: 'ydo-ov-kpi-value' }, value),
    hint ? h('span', { className: 'ydo-ov-kpi-hint' }, hint) : null)
}

function AccountRow({ account, rank, onOpenAccount, t }) {
  const freshness = sessionFreshness(account.sessionCheckedAt, t)
  const expired = account.sessionStatus === 'expired'
  return h('div', {
    // ydo-ov-tr-rank 提供与表头一致的 9 列 grid 布局（缺它则整行 span 挤成 inline 流）。
    className: 'ydo-ov-tr ydo-ov-tr-rank ydo-ov-account-row',
    role: 'row',
    'data-account-id': account.accountId,
    // 点击账号行进入账号分析（方案 §5.1）；键盘 Enter 同样进入（UI 优化方案 §4.3）。
    tabIndex: 0,
    onClick: () => onOpenAccount && onOpenAccount(account.accountId),
    onKeyDown: event => { if (event.key === 'Enter') onOpenAccount && onOpenAccount(account.accountId) },
  },
    h('span', { className: 'ydo-ov-rankcell', role: 'cell' }, rank ?? '—'),
    h('span', { className: 'ydo-ov-account-name', role: 'cell' },
      account.nickname || account.accountId,
      expired ? h('span', { className: 'ydo-ov-flag ydo-ov-flag-expired' }, t('sessionExpired')) : null,
      account.suspiciousEmptyCollect
        ? h('span', { className: 'ydo-ov-flag ydo-ov-flag-suspicious' }, t('suspiciousEmptyCollect'))
        : null),
    h('span', { className: 'ydo-ov-num', role: 'cell' }, countText(account.fanCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell' }, countText(account.workCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell' }, countText(account.medianPlayCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell' }, countText(account.hotWorkCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell' }, pctText(account.hotRatePct)),
    h('span', { className: 'ydo-ov-num', role: 'cell' }, pctText(account.engagementRatePct)),
    h('span', { className: `ydo-ov-session ydo-ov-session-${freshness.key}`, role: 'cell' }, freshness.label))
}

// 爆款标签中文化（阶段 3 含 potential）：未登记的标签收敛「其他标签」，
// 原始 key 不进页面（验收 P2）；去重避免未知标签连续重复。
function hotLabelText(labels, t) {
  if (!Array.isArray(labels) || !labels.length) return t('insufficientSample')
  const known = {
    absolute: t('labelAbsolute'),
    account_relative: t('labelAccountRelative'),
    potential: t('labelPotential'),
  }
  return [...new Set(labels.map(label => known[label] || t('labelOther')))].join(' + ')
}

function HotWorkRow({ work, onOpenWork, t }) {
  const label = hotLabelText(work.labels, t)
  // 爆款依据按判定类别分行展示（UI 优化方案 §4.4），接口缺失时回退命中标签。
  const lines = basisLines(work.basis)
  return h('div', { className: 'ydo-ov-tr ydo-ov-tr-hot ydo-ov-hot-row', role: 'row' },
    h('div', { className: 'ydo-ov-hot-title', role: 'cell' },
      h('button', {
        type: 'button',
        className: 'ydo-ov-work-link',
        onClick: () => onOpenWork && onOpenWork(work),
        'data-work-id': work.workId,
        title: work.title || work.workId,
      }, work.title || work.workId)),
    h('span', { role: 'cell' }, work.accountNickname || '—'),
    // 发布时间统一走 ui-format 的上海时区格式化，非法/缺失显示 —（不用 String.slice）；
    // 文本列左对齐，与表头及方案 §7 的对齐约定一致（验收建议 6）。
    h('span', { role: 'cell' }, formatDateTime(work.publishTime)),
    h('span', { className: 'ydo-ov-num', role: 'cell' }, countText(work.playCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell' }, pctText(work.engagementRatePct)),
    h('div', { className: 'ydo-ov-basis', role: 'cell', title: work.basis || '' },
      ...(lines.length
        ? lines.map(line => h('div', { key: line }, line))
        : [h('div', { key: 'labels' }, label)])))
}

function HotWorkDrawer({ work, detail, detailLoading, onClose, onOpenFull, t }) {
  if (!work) return null
  const labels = hotLabelText(work.labels, t)
  // 爆款判定区纵向分组：每个判定类别一行（UI 优化方案 §6.1），行数由接口依据决定，
  // 缺失项不渲染空行；浅色警示边框与普通指标区分（.ydo-ov-basis-head）。
  const lines = basisLines(work.basis)
  const metrics = [
    [t('colPlay'), countText(work.playCount)],
    [t('engagement'), pctText(work.engagementRatePct)],
    [t('colLike'), countText(work.likeCount)],
    [t('colComment'), countText(work.commentCount)],
    [t('colCollect'), countText(work.collectCount)],
    [t('colShare'), countText(work.shareCount)],
  ]
  return h('div', {
    className: 'ydo-ov-drawer-overlay',
    role: 'dialog', 'aria-modal': true, 'aria-label': t('hotDrawerTitle'),
    onClick: onClose,
  },
    h('aside', { className: 'ydo-ov-drawer', onClick: event => event.stopPropagation() },
      h('header', null,
        h('h3', null, work.title || work.workId),
        h('button', { type: 'button', className: 'ydo-link', onClick: onClose, 'aria-label': t('close') }, '×')),
      h('div', { className: 'ydo-ov-basis-head', role: 'list', 'aria-label': t('hotBasis') },
        ...(lines.length
          ? lines.map(line => h('div', { key: line, role: 'listitem' }, line))
          : [h('div', { key: 'na', role: 'listitem' }, '—')])),
      h('dl', { className: 'ydo-ov-drawer-meta' },
        h('div', null, h('dt', null, t('hotLabels')), h('dd', null, labels))),
      h('ul', { className: 'ydo-ov-drawer-metrics' },
        ...metrics.map(([key, value]) => h('li', { key }, `${key} ${value}`))),
      detailLoading ? h('p', { className: 'ydo-hint' }, t('loading')) : null,
      h('button', {
        type: 'button',
        className: 'ydo-secondary',
        onClick: () => onOpenFull && onOpenFull(work),
      }, t('openFullWorkAnalysis'))))
}

function HotDistribution({ accounts, t }) {
  const rows = (accounts || [])
    .filter(account => (account.hotWorkCount || 0) > 0)
    .map(account => ({ name: account.nickname || account.accountId, count: account.hotWorkCount }))
  if (!rows.length) return h('p', { className: 'ydo-hint' }, t('none'))
  const max = Math.max(...rows.map(row => row.count)) || 1
  return h('ul', { className: 'ydo-ov-dist', 'aria-label': t('hotDistribution') },
    ...rows.map(row => h('li', { key: row.name },
      h('span', { className: 'ydo-bar-label' }, row.name),
      h('span', { className: 'ydo-bar-track' },
        h('span', { className: 'ydo-bar-fill', style: { width: `${(row.count / max) * 100}%` } })),
      h('span', { className: 'ydo-bar-value' }, String(row.count)))))
}

/**
 * 账号总览页（账号总览 Tab 的整页内容）。
 *
 * @param {{ overview: object|null, loading: bool, errorReason: string|null,
 *   filters: object, accounts: array, collecting: bool, exporting: bool,
 *   onFilterChange: Function, onRefresh: Function, onExport: Function,
 *   onOpenWork: Function, onOpenAccount: Function, t: Function }} props
 */
export function OverviewPage({
  overview, loading, errorReason, filters, accounts, collecting, exporting,
  onFilterChange, onRefresh, onExport, onOpenWork, onOpenAccount, onAddAccount, t,
}) {
  // 全部失败：服务不可用，绝不把指标置 0（方案 §14）。
  if (errorReason) {
    return h('div', { className: 'ydo-state ydo-state-error', role: 'alert' },
      h('p', null, t(ERROR_REASON_COPY[errorReason] || 'operationUnavailable')),
      h('button', { type: 'button', className: 'ydo-secondary', onClick: onRefresh }, t('retry')))
  }
  const summary = overview?.summary || null
  // 无账号（§14 首行）：添加引导 + 添加入口；绝不渲染 0 值 KPI 页。
  if (!loading && summary && summary.accountCount === 0) {
    return h('div', { className: 'ydo-state', role: 'status' },
      h('p', null, t('addAccountHint')),
      h('button', { type: 'button', className: 'ydo-primary', onClick: onAddAccount }, t('addAccount')))
  }
  if (!loading && !summary) {
    return h('div', { className: 'ydo-state', role: 'status' }, h('p', null, t('emptyAccounts')))
  }
  const totalWorks = summary ? summary.workCount : 0
  if (!loading && summary && summary.accountCount > 0 && totalWorks === 0) {
    // 有账号但没有作品 → "请先采集作品数据"（方案 §14）。
    return h('div', { className: 'ydo-state', role: 'status' }, h('p', null, t('collectFirstHint')))
  }

  const alerts = deriveOverviewAlerts(overview, t)
  const accountOptions = (accounts || [])
    .map(account => ({ id: account.accountId, label: account.nickname || account.accountId }))
  const selected = filters.accountIds || []
  const windowOptions = ['7d', '30d', '90d', 'all']

  return h('div', { className: 'ydo-ov-page' },
    // 工具栏：筛选项靠左（带可见文字说明），操作按钮固定靠右（UI 优化方案 §4.1）。
    h('div', { className: 'ydo-ov-toolbar' },
      h('label', { className: 'ydo-ov-filter' },
        t('overviewAccountFilter'),
        // 账号选择为单选下拉：默认「全部账号」= 空 accountIds，选择具体账号只传一个 ID。
        h('select', {
          value: selected[0] || '',
          onChange: event => onFilterChange({
            ...filters,
            accountIds: event.target.value ? [event.target.value] : [],
          }),
        },
        h('option', { key: 'all', value: '' }, t('allAccounts')),
        ...accountOptions.map(option => h('option', { key: option.id, value: option.id }, option.label)))),
      h('label', { className: 'ydo-ov-filter' },
        t('overviewWindow'),
        h('select', {
          value: filters.window || '30d',
          onChange: event => onFilterChange({ ...filters, window: event.target.value }),
        },
        ...windowOptions.map(option => h('option', { key: option, value: option }, t(`window_${option}`))))),
      h('label', { className: 'ydo-ov-filter' },
        t('overviewSort'),
        h('select', {
          value: filters.sort || 'hot_count',
          onChange: event => onFilterChange({ ...filters, sort: event.target.value }),
        },
        ...['hot_count', 'hot_rate', 'median_play', 'total_play', 'engagement_rate'].map(option =>
          h('option', { key: option, value: option }, t(`sort_${option}`))))),
      h('div', { className: 'ydo-ov-actions' },
        // 「刷新」执行当前条件的只读查询；筛选变更的自动查询走列表区加载态，
        // 不借用刷新按钮的禁用/按下态表达（UI 优化方案 §4.1）。
        h('button', { type: 'button', className: 'ydo-secondary', onClick: onRefresh }, t('refresh')),
        // "导出总览"只属于账号总览 Tab 的局部工具栏（方案 §5.1/§10.2）。
        h('button', {
          type: 'button',
          className: 'ydo-secondary ydo-export',
          disabled: exporting,
          'aria-busy': exporting,
          onClick: onExport,
        }, exporting ? t('exporting') : t('exportOverview')),
        collecting ? h('span', { className: 'ydo-ov-collecting', role: 'status' }, t('collecting')) : null)),

    // 筛选自动查询期间的加载态显示在列表区域，不触发刷新按钮（UI 优化方案 §4.1）。
    loading && summary
      ? h('div', { className: 'ydo-ov-loading', role: 'status' },
        h('span', { className: 'ydo-spinner' }), h('span', null, t('loading')))
      : null,

    summary
      ? h('div', { className: 'ydo-ov-kpis' },
        h(KpiCard, { label: t('kpiAccounts'), value: countText(summary.accountCount) }),
        h(KpiCard, { label: t('kpiWorks'), value: countText(summary.workCount) }),
        h(KpiCard, { label: t('kpiTotalPlay'), value: countText(summary.totalPlayCount), hint: t('kpiCurrentCumulative') }),
        h(KpiCard, {
          label: t('kpiHotWorks'),
          value: countText(summary.hotWorkCount),
          hint: summary.hotRatePct === null || summary.hotRatePct === undefined ? t('insufficientSample') : pctText(summary.hotRatePct),
        }))
      : h('div', { className: 'ydo-progress', role: 'status' }, h('span', { className: 'ydo-spinner' }), h('span', null, t('loading'))),

    summary ? h('section', { className: 'ydo-ov-panel' },
      h('h3', null, t('accountRanking')),
      h('div', { className: 'ydo-ov-table', role: 'table', 'aria-label': t('accountRanking') },
        // 表头与数据行共用 ydo-ov-tr-rank 列轨道；计数/百分比列右对齐（UI 优化方案 §4.3）。
        h('div', { className: 'ydo-ov-tr ydo-ov-tr-rank ydo-ov-head', role: 'row' },
          h('span', { className: 'ydo-ov-rankcell', role: 'columnheader' }, t('rankCol')),
          h('span', { role: 'columnheader' }, t('colAccount')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('fanCount')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('workCount')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('colMedianPlay')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('kpiHotWorks')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('hotRateCol')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('engagement')),
          h('span', { role: 'columnheader' }, t('sessionFreshnessCol'))),
        ...(overview?.accounts || []).map((account, index) => h(AccountRow, {
          key: account.accountId, account, rank: index + 1, onOpenAccount, t,
        }))))
      : null,

    summary ? h('div', { className: 'ydo-ov-panels' },
      h('section', { className: 'ydo-ov-panel' },
        h('h3', null, t('hotDistribution')),
        h(HotDistribution, { accounts: overview?.accounts, t })),
      h('section', { className: 'ydo-ov-panel' },
        h('h3', null, t('overviewAlerts')),
        alerts.length
          ? h('ul', { className: 'ydo-ov-alerts' },
            ...alerts.map(alert => h('li', { key: `${alert.accountId}:${alert.kind}` }, alert.text)))
          : h('p', { className: 'ydo-hint' }, t('noAlerts'))))
      : null,

    summary ? h('section', { className: 'ydo-ov-panel' },
      h('h3', null, t('hotWorksTitle')),
      (overview?.hotWorks || []).length
        ? h('div', { className: 'ydo-ov-table', role: 'table', 'aria-label': t('hotWorksTitle') },
          // 固定列：视频/所属账号/发布时间/播放量/互动率/爆款依据（UI 优化方案 §4.4）；
          // 表头与数据行共用 ydo-ov-tr-hot 列轨道，爆款依据列多行显示。
          h('div', { className: 'ydo-ov-tr ydo-ov-tr-hot ydo-ov-head', role: 'row' },
            h('span', { role: 'columnheader' }, t('colVideo')),
            h('span', { role: 'columnheader' }, t('hotOwnerAccount')),
            h('span', { role: 'columnheader' }, t('publishTime')),
            h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('colPlay')),
            h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('engagement')),
            h('span', { role: 'columnheader' }, t('hotBasis'))),
          ...(overview?.hotWorks || []).map(work => h(HotWorkRow, { key: work.workId, work, onOpenWork, t })))
        : h('p', { className: 'ydo-hint' }, t('noHotWorks')))
      : null)
}

// 稳定 reason → 已登记文案键（与 client.js ERROR_COPY 同一策略：未登记不透传原文）。
export const ERROR_REASON_COPY = Object.freeze({
  ACCOUNT_NOT_ACCESSIBLE: 'accountNotAccessible',
  TOO_MANY_ACCOUNTS: 'overviewTooManyAccounts',
  overview_too_many_accounts: 'overviewTooManyAccounts',
  RULE_VERSION_MISMATCH: 'ruleVersionMismatch',
  INVALID_TIME_WINDOW: 'refreshFailed',
  export_too_large: 'exportTooLarge',
  export_failed: 'exportFailed',
  douyin_operation_request_failed: 'operationUnavailable',
})

export function WorkDrawerContainer(props) {
  return h(HotWorkDrawer, props)
}

export function buildOverviewFilters({ window = '30d', sort = 'hot_count', accountIds = [], now = null } = {}) {
  // 展示偏好（决策 15 允许本地保存）：时间 preset → 自然日窗口字符串。
  // 近 N 天 = [今天-(N-1), 明天)——服务端转 UTC 半开区间，排他终点取明天才能包含今天。
  // "全部"不带窗口字段。
  if (window === 'all') return { sort, accountIds }
  const days = window === '7d' ? 7 : window === '90d' ? 90 : 30
  const base = now ? new Date(now) : new Date()
  const from = new Date(base.getFullYear(), base.getMonth(), base.getDate() - (days - 1))
  const to = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)
  const pad = value => String(value).padStart(2, '0')
  const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return { sort, accountIds, publishFrom: iso(from), publishTo: iso(to) }
}
