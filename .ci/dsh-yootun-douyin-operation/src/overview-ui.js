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
import { FilterSelect } from './select-ui.js'

const React = require('react')
const { createElement: h } = React
const { IconDownloadOutline16 } = require('@deepseek-ai/dsh-client-ui-primitives')

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

/**
 * 账号目录（UI 优化方案 v2 §3.1，二审 P1-4）：唯一来源是服务端 accountOptions
 * 完整未删除目录（与 accountIds 筛选和 top_n 截断无关）。数据边界：宿主本地
 * accounts.list 不能代表当前授权主体的服务端目录（可能含本地残留、漏服务端账号），
 * 字段缺失/为空 → 目录不可用（筛选禁用 + 稳定失败文案），绝不回退本地列表。
 */
export function buildAccountCatalog(overview) {
  const byId = new Map()
  for (const option of (overview && overview.accountOptions) || []) {
    const id = option && option.accountId
    if (id && !byId.has(id)) {
      byId.set(id, { id, label: option.nickname || id, workCount: Number(option.workCount) || 0 })
    }
  }
  return [...byId.values()]
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
  // UI 优化方案 v2 §4.2：删除「会话状态」列；会话异常只以账号名旁的语义标签出现，
  // 且仅限可行动状态（过期/可疑空采集）——「会话状态未知」绝不显示。
  const expired = account.sessionStatus === 'expired'
  return h('div', {
    // ydo-ov-tr-rank 提供与表头一致的 8 列 grid 布局（缺它则整行 span 挤成 inline 流）。
    className: 'ydo-ov-tr ydo-ov-tr-rank ydo-ov-account-row',
    role: 'row',
    'data-account-id': account.accountId,
    // 点击账号行进入账号分析（方案 §5.1）；键盘 Enter 同样进入（UI 优化方案 §4.3）。
    tabIndex: 0,
    onClick: () => onOpenAccount && onOpenAccount(account.accountId),
    onKeyDown: event => { if (event.key === 'Enter') onOpenAccount && onOpenAccount(account.accountId) },
  },
    // data-label 供窄屏（面板容器查询）卡片重排显示字段名（二审 P2），桌面端不渲染。
    h('span', { className: 'ydo-ov-rankcell', role: 'cell', 'data-label': t('rankCol') }, rank ?? '—'),
    h('span', { className: 'ydo-ov-account-name', role: 'cell', 'data-label': t('colAccount'), title: account.nickname || account.accountId },
      account.nickname || account.accountId,
      expired ? h('span', { className: 'ydo-ov-flag ydo-ov-flag-expired' }, t('sessionExpired')) : null,
      account.suspiciousEmptyCollect
        ? h('span', { className: 'ydo-ov-flag ydo-ov-flag-suspicious' }, t('suspiciousEmptyCollect'))
        : null),
    h('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('fanCount') }, countText(account.fanCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('workCount') }, countText(account.workCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('colMedianPlay') }, countText(account.medianPlayCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('kpiHotWorks') }, countText(account.hotWorkCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('hotRateCol') }, pctText(account.hotRatePct)),
    h('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('engagement') }, pctText(account.engagementRatePct)))
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
    h('div', { className: 'ydo-ov-hot-title', role: 'cell', 'data-label': t('colVideo') },
      h('button', {
        type: 'button',
        className: 'ydo-ov-work-link',
        onClick: () => onOpenWork && onOpenWork(work),
        'data-work-id': work.workId,
        title: work.title || work.workId,
      }, work.title || work.workId)),
    h('span', { role: 'cell', 'data-label': t('hotOwnerAccount') }, work.accountNickname || '—'),
    // 发布时间统一走 ui-format 的上海时区格式化，非法/缺失显示 —（不用 String.slice）；
    // 文本列左对齐，与表头及方案 §7 的对齐约定一致（验收建议 6）。
    h('span', { role: 'cell', 'data-label': t('publishTime') }, formatDateTime(work.publishTime)),
    h('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('colPlay') }, countText(work.playCount)),
    h('span', { className: 'ydo-ov-num', role: 'cell', 'data-label': t('engagement') }, pctText(work.engagementRatePct)),
    h('div', { className: 'ydo-ov-basis', role: 'cell', 'data-label': t('hotBasis'), title: work.basis || '' },
      ...(lines.length
        ? lines.map(line => h('div', { key: line }, line))
        : [h('div', { key: 'labels' }, label)])))
}

function HotWorkDrawer({ work, detail, detailLoading, onClose, onOpenFull, t }) {
  if (!work) return null
  // 抽屉纵向结构固定（UI 优化方案 v2 §6.2）：标题 → 爆款依据 → 指标摘要 → 操作按钮；
  // 每个判定类别一行（Top 百分位/中位数倍数/绝对阈值各自独立），不再渲染「命中标签」
  // 辅助行，规则版本与参与样本数从不进入页面（接口字段保留在导出报告中）。
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
        // 关闭按钮 40×40（点击区域 ≥44px，见 .ydo-ov-drawer-close::after）。
        h('button', { type: 'button', className: 'ydo-ov-drawer-close', onClick: onClose, 'aria-label': t('close') }, '×')),
      h('div', { className: 'ydo-ov-basis-head', role: 'list', 'aria-label': t('hotBasis') },
        ...(lines.length
          ? lines.map(line => h('div', { key: line, role: 'listitem' }, line))
          : [h('div', { key: 'na', role: 'listitem' }, '—')])),
      // 指标摘要复用单账号分析页的内容指标卡片（用户反馈 2026-09-18 需求 4）：
      // 标签小字在上、数值大字在下，3 列网格浅灰底圆角卡；窄屏单列规则随 .ydo-an-metrics。
      h('div', { className: 'ydo-an-metrics', role: 'list' },
        ...metrics.map(([key, value]) => h('div', { key, className: 'ydo-an-metric-card', role: 'listitem' },
          h('span', { className: 'ydo-an-metric-label' }, key),
          h('strong', { className: 'ydo-an-metric-value' }, value)))),
      detailLoading ? h('p', { className: 'ydo-hint' }, t('loading')) : null,
      h('button', {
        type: 'button',
        className: 'ydo-secondary ydo-ov-drawer-action',
        onClick: () => onOpenFull && onOpenFull(work),
      }, t('openFullWorkAnalysis'))))
}

// 爆款账号分布（UI 优化方案 v2 §4.3）：数据来自服务端 hotAccountDistribution——
// 排行响应受 top_n 截断且排序随请求切换，从截断后的 accounts 推导前五会漏掉真正
// 爆款最多的账号（二审 P1-3），因此字段由服务端在截断前基于全量账号计算。排序
// 单点在服务端（爆款数降序、同数按昵称稳定），客户端只截断渲染、不重排。前三名
// 固定语义色（1 橙 / 2 蓝 / 3 紫），第 4 名起中性品牌色；名次同时用排名数字与
// 数量文字表达，不单靠颜色。
function HotDistribution({ distribution, t }) {
  const rows = (distribution || [])
    .filter(item => (item.hotWorkCount || 0) > 0)
    .map(item => ({ id: item.accountId, name: item.nickname || item.accountId, count: item.hotWorkCount }))
    .slice(0, 5)
  if (!rows.length) return h('p', { className: 'ydo-hint' }, t('none'))
  const max = Math.max(...rows.map(row => row.count)) || 1
  return h('ul', { className: 'ydo-ov-dist', 'aria-label': t('hotDistribution') },
    ...rows.map((row, index) => h('li', {
      // 昵称可重复，使用服务端稳定 accountId 作为 React key。
      key: row.id,
      className: index < 3 ? `ydo-ov-dist-top${index + 1}` : undefined,
    },
    h('span', { className: 'ydo-ov-dist-rank', 'aria-hidden': true }, index + 1),
    h('span', { className: 'ydo-bar-label', title: row.name }, row.name),
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
  // 账号目录（UI 优化方案 v2 §3.1）：完整目录驱动下拉，缺失则禁用筛选并给稳定文案。
  // 完整性校验（二审 P1-2）只比对「目录数 vs 服务端 accountTotal」——排行响应受
  // top_n 截断且排序随请求切换，目录数 ≠ 排行展示行数不属失同步；两者以
  // 「共 {total} · 展示 {shown}」文字明确区分（见排行工具栏）。
  const selected = filters.accountIds || []
  const catalog = buildAccountCatalog(overview)
  const rankRows = overview?.accounts || []
  const accountTotal = overview?.accountTotal
  // accountTotal 是服务端完整目录的契约字段；缺失/null 时不能假定完整，避免旧
  // 响应把不完整目录误当成可用筛选项。
  const catalogComplete = accountTotal !== undefined && accountTotal !== null
    && catalog.length === accountTotal
  if (!catalogComplete) {
    console.warn('[dofe-yootun-douyin-operation] account catalog incomplete', {
      catalog: catalog.length, accountTotal,
    })
  }
  const windowOptions = ['7d', '30d', '90d', 'custom']
  // 自定义范围基础判断（2026-09-21 需求）：清空不提交（受控值保持，不触发查询）；
  // 越界自动纠偏——改开始致开始>截止 → 截止跟随开始，改截止致截止<开始 → 开始跟随截止
  //（YYYY-MM-DD 字典序即日期序；min/max 先在日历层拦截，手输越界走这里），纠偏后仍只触发一次查询。
  const applyCustomRange = (key, value) => {
    if (!value) return
    const next = { ...filters, [key]: value }
    if (next.customFrom && next.customTo && next.customFrom > next.customTo) {
      if (key === 'customFrom') next.customTo = value
      else next.customFrom = value
    }
    onFilterChange(next)
  }
  // KPI 作品数带明确范围文案（UI 优化方案 v2 §3.2/§4.2）：近 N 天 / 自定义日期区间。
  const rangeLabel = overviewRangeLabel(filters, t)

  return h('div', { className: 'ydo-ov-page' },
    // 工具栏（UI 优化方案 v2 §4.1）：grid 两列（minmax(0,1fr) auto），筛选项在左列
    // 内部换行，操作区固定行尾；下拉取消浏览器黑 outline，仅 :focus-visible 显外环。
    h('div', { className: 'ydo-ov-toolbar' },
      h('div', { className: 'ydo-ov-filters' },
        h('div', { className: 'ydo-ov-filter' },
          h('span', null, t('overviewAccountFilter')),
          // 账号选择为单选下拉：默认「全部账号」= 空 accountIds，选择具体账号只传一个 ID；
          // 「全部账号」始终保留（选中单个账号后再次打开仍可切回）。
          h(FilterSelect, {
            label: t('overviewAccountFilter'),
            value: selected[0] || '',
            // 空目录即使服务端返回 accountTotal=0 也不可选择；只有非空且数量闭合时启用。
            disabled: !catalog.length || !catalogComplete,
            onChange: value => onFilterChange({
              ...filters,
              accountIds: value ? [value] : [],
            }),
            options: [
              { value: '', label: t('allAccounts') },
              ...catalog.map(option => ({
                value: option.id,
                label: option.workCount === 0 ? `${option.label}（${t('noWorks')}）` : option.label,
              })),
            ],
          }),
        !catalog.length ? h('span', { className: 'ydo-hint' }, t('accountCatalogUnavailable')) : null),
        h('div', { className: 'ydo-ov-filter' },
          h('span', null, t('overviewWindow')),
          h(FilterSelect, {
            label: t('overviewWindow'),
            value: filters.window || '30d',
            onChange: value => onFilterChange({ ...filters, window: value }),
            options: windowOptions.map(option => ({ value: option, label: t(`window_${option}`) })),
          }),
          // 自定义范围（2026-09-21 需求）：仅 window=custom 时渲染并参与查询条件，
          // 其余预设隐藏；任一日期变化即触发一次查询（onFilterChange → client
          // setOverviewFilters → 查询 effect）。两个日期框精确到天（YYYY-MM-DD）。
          filters.window === 'custom' ? h('span', { className: 'ydo-custom-range' },
            h('span', null, t('customRangeStart')),
            h('input', {
              type: 'date',
              className: 'ydo-date-input',
              'aria-label': t('customRangeStart'),
              value: filters.customFrom || '',
              max: filters.customTo || undefined,
              onChange: event => applyCustomRange('customFrom', event.target.value),
            }),
            h('span', { className: 'ydo-custom-range-dash', 'aria-hidden': true }, '-'),
            h('span', null, t('customRangeEnd')),
            h('input', {
              type: 'date',
              className: 'ydo-date-input',
              'aria-label': t('customRangeEnd'),
              value: filters.customTo || '',
              min: filters.customFrom || undefined,
              onChange: event => applyCustomRange('customTo', event.target.value),
            })) : null),
        h('div', { className: 'ydo-ov-filter' },
          h('span', null, t('overviewSort')),
          h(FilterSelect, {
            label: t('overviewSort'),
            value: filters.sort || 'hot_count',
            onChange: value => onFilterChange({ ...filters, sort: value }),
            options: ['hot_count', 'hot_rate', 'median_play', 'total_play', 'engagement_rate'].map(option =>
              ({ value: option, label: t(`sort_${option}`) })),
          }))),
      h('div', { className: 'ydo-ov-actions' },
        // 「刷新」执行当前条件的只读查询；筛选变更的自动查询走列表区加载态，
        // 不借用刷新按钮的禁用/按下态表达（UI 优化方案 §4.1）。
        h('button', { type: 'button', className: 'ydo-secondary', onClick: onRefresh }, t('refresh')),
        // "导出总览"只属于账号总览 Tab 的局部工具栏（方案 §5.1/§10.2）；
        // 下载图标与视频数据页"导出 Excel"按钮同款（v2 §4.1 同一导出语义）。
        h('button', {
          type: 'button',
          className: 'ydo-secondary ydo-export',
          disabled: exporting,
          'aria-busy': exporting,
          onClick: onExport,
        },
        h(IconDownloadOutline16, { size: 14 }),
        h('span', null, exporting ? t('exporting') : t('exportOverview'))),
        collecting ? h('span', { className: 'ydo-ov-collecting', role: 'status' }, t('collecting')) : null)),

    // 筛选自动查询期间的加载态显示在列表区域，不触发刷新按钮（UI 优化方案 §4.1）。
    loading && summary
      ? h('div', { className: 'ydo-ov-loading', role: 'status' },
        h('span', { className: 'ydo-spinner' }), h('span', null, t('loading')))
      : null,

    summary
      ? h('div', { className: 'ydo-ov-kpis' },
        h(KpiCard, { label: t('kpiAccounts'), value: countText(summary.accountCount) }),
        h(KpiCard, { label: t('kpiWorks'), value: countText(summary.workCount), hint: rangeLabel }),
        h(KpiCard, { label: t('kpiTotalPlay'), value: countText(summary.totalPlayCount), hint: t('kpiCurrentCumulative') }),
        h(KpiCard, {
          label: t('kpiHotWorks'),
          value: countText(summary.hotWorkCount),
          hint: summary.hotRatePct === null || summary.hotRatePct === undefined ? t('insufficientSample') : pctText(summary.hotRatePct),
        }))
      : h('div', { className: 'ydo-progress', role: 'status' }, h('span', { className: 'ydo-spinner' }), h('span', null, t('loading'))),

    summary ? h('section', { className: 'ydo-ov-panel' },
      h('div', { className: 'ydo-ov-toolbar' },
        h('h3', null, t('accountRanking')),
        !catalogComplete
          ? h('span', { className: 'ydo-hint', role: 'status' }, t('accountCatalogSyncing'))
          : null,
        // top_n 截断是正常展示语义（二审 P1-2）：明确区分「完整账号数」与「当前展示排行数」。
        // 只在「全部账号」视图标注——筛选态的行数缩小是筛选语义，标注反而误导。
        !selected.length && accountTotal !== undefined && accountTotal > rankRows.length
          ? h('span', { className: 'ydo-hint' }, t('rankingScopeHint')
            .replace('{total}', String(accountTotal))
            .replace('{shown}', String(rankRows.length)))
          : null),
      h('div', { className: 'ydo-ov-table', role: 'table', 'aria-label': t('accountRanking') },
        // 表头与数据行共用 ydo-ov-tr-rank 8 列轨道；计数/百分比列右对齐（v2 §4.2），
        // 「会话状态」列已删除，会话异常只在账号名旁以语义标签出现。
        h('div', { className: 'ydo-ov-tr ydo-ov-tr-rank ydo-ov-head', role: 'row' },
          h('span', { className: 'ydo-ov-rankcell', role: 'columnheader' }, t('rankCol')),
          h('span', { role: 'columnheader' }, t('colAccount')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('fanCount')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('workCount')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('colMedianPlay')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('kpiHotWorks')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('hotRateCol')),
          h('span', { className: 'ydo-ov-num', role: 'columnheader' }, t('engagement'))),
        ...(overview?.accounts || []).map((account, index) => h(AccountRow, {
          key: account.accountId, account, rank: index + 1, onOpenAccount, t,
        }))))
      : null,

    summary ? h('div', { className: 'ydo-ov-panels' },
      // 分布面板只在服务端提供 hotAccountDistribution 时渲染（二审 P1-3）：
      // 旧服务端缺字段时隐藏，不用截断后的排行近似出可能失真的前五。
      Array.isArray(overview?.hotAccountDistribution)
        ? h('section', { className: 'ydo-ov-panel' },
          h('h3', null, t('hotDistribution')),
          h(HotDistribution, { distribution: overview.hotAccountDistribution, t }))
        : null,
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
            h('span', { className: 'ydo-ov-hot-basis-head', role: 'columnheader' }, t('hotBasis'))),
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

const _pad2 = value => String(value).padStart(2, '0')
const _isoDay = date => `${date.getFullYear()}-${_pad2(date.getMonth() + 1)}-${_pad2(date.getDate())}`

// 自定义窗口默认范围（2026-09-21 需求）：截止 = 今天、开始 = 往前推一个自然月。
// 仅作 UI 初值；用户改动后随筛选状态持久，请求日期仍由 buildOverviewFilters 派生。
export function defaultCustomRange(now = null) {
  const base = now ? new Date(now) : new Date()
  const from = new Date(base.getFullYear(), base.getMonth() - 1, base.getDate())
  return { customFrom: _isoDay(from), customTo: _isoDay(base) }
}

export function buildOverviewFilters({
  window = '30d', sort = 'hot_count', accountIds = [], customFrom = null, customTo = null, now = null,
} = {}) {
  // 展示偏好（决策 15 允许本地保存）：时间 preset → 自然日窗口字符串。
  // 近 N 天 = [今天-(N-1), 明天)——服务端转 UTC 半开区间，排他终点取明天才能包含今天。
  // 自定义窗口 = [customFrom, customTo+1)：用户语义「截止日含当天」，排他终点 = 截止+1；
  // 同一天选择（from=to）因此合法。日期缺失属防御分支（正常交互下 UI 保证成对），回退近 30 天。
  if (window === 'custom' && customFrom && customTo) {
    const [year, month, day] = customTo.split('-').map(Number)
    return {
      sort, accountIds,
      publishFrom: customFrom,
      publishTo: _isoDay(new Date(year, month - 1, day + 1)),
    }
  }
  const days = window === '7d' ? 7 : window === '90d' ? 90 : 30
  const base = now ? new Date(now) : new Date()
  const from = new Date(base.getFullYear(), base.getMonth(), base.getDate() - (days - 1))
  const to = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)
  return { sort, accountIds, publishFrom: _isoDay(from), publishTo: _isoDay(to) }
}

// 范围文案统一出口：KPI 作品数 hint 与单账号分析页共用（§3.2 口径标识同源）。
// 自定义窗口显示具体日期区间，预设窗口沿用近 N 天文案。
export function overviewRangeLabel(filters, t) {
  if (filters?.window === 'custom') return `${filters.customFrom || '?'} ~ ${filters.customTo || '?'}`
  return t(`window_${filters?.window || '30d'}`)
}
