// 作品数据 Tab（视觉与交互基准：docs/1109/wx/ui-demo.html，§9.0/§9.2/§9.3）。
// 纯展示组件：数据由 client.js 传入；排序/筛选/分页只作用于已入库数据。

import { createElement as h, useState } from 'react'
import {
  CORE_GAP_FIELDS,
  DEFAULT_SORT_STATE,
  EMPTY,
  fmt,
  fmtCount,
  fmtDateTime,
  fmtPair,
  fmtPct,
  fmtSeconds,
  gapWorkCount,
  normalizeRetentionPoints,
  normalizeTrafficRows,
  progressText,
  safeAvatarSrc,
  safeWorkUrl,
  shanghaiDayOf,
  sortTrafficRowsByValue,
  weightedCompletionRate,
  workTitle,
} from './ui-format.js'

/** 表格列定义（对齐抖音 COLUMNS 单一来源）：sortable 列在表头渲染排序按钮。
 * 2026-11-11 真机反馈：去掉「操作」列（双击整行打开详情），作品列不再显示 ID 副行。 */
const TABLE_COLUMNS = [
  { label: '作品' },
  { label: '发布时间', key: 'publish_time', sortable: true },
  { label: '完播率', key: 'completion_rate_pct', sortable: true },
  { label: '平均播放时长', key: 'avg_play_duration_s', sortable: true },
  { label: '播放', key: 'play_count', sortable: true },
  { label: '喜欢', key: 'like_count', sortable: true },
  { label: '收藏', key: 'favorite_count', sortable: true },
  { label: '评论', key: 'comment_count', sortable: true },
  { label: '分享', key: 'share_count', sortable: true },
  { label: '转发聊天和朋友圈', key: 'forward_count', sortable: true },
  { label: '关注量', key: 'follow_count', sortable: true },
  { label: '企微链接点击' },
  { label: '添加通讯录' },
]

/** 顶部摘要卡（§9.2 固定 5 张，不随筛选/排序/分页变化）。
 *
 * `summaryOverview` 必须是固定 last_7d 窗口的独立快照（不随账号 Tab 窗口切换
 * 变化，review P0-3）；作品总数取账号行 feedCount（官方 feedsCount，review P0-4）。
 */
export function WorkSummaryCards({ works, summaryOverview, account }) {
  const totals = summaryOverview && summaryOverview.metrics && summaryOverview.metrics.totals
    ? summaryOverview.metrics.totals : {}
  const gapCount = gapWorkCount(works)
  const cells = [
    { label: '作品总数', value: fmtCount(account && account.feedCount), hint: '官方账号作品总数' },
    { label: '近7日播放', value: fmtCount(totals.daily_play_count), hint: '账号级官方聚合' },
    { label: '近7日关注量', value: fmtCount(totals.daily_follow_count), hint: '非净关注' },
    { label: '作品完播率', value: fmtPct(weightedCompletionRate(works)), hint: '按播放加权计算' },
    {
      label: '缺口作品',
      value: fmtCount(gapCount),
      // 计数为 0 时不该挂「至少 1 个字段缺失」的提示（会读成有缺口）。
      hint: gapCount > 0 ? '至少 1 个核心字段缺失' : '核心字段完整',
    },
  ]
  return h('div', { className: 'ywc-summary-grid' },
    cells.map(cell => h('div', { className: 'ywc-kpi', key: cell.label },
      h('div', { className: 'ywc-kpi-label' }, cell.label),
      h('div', { className: 'ywc-kpi-value' }, cell.value),
      h('div', { className: 'ywc-kpi-hint' }, cell.hint),
    )),
  )
}

/** 工具栏（采集本账号全部 / 刷新 / 运行中进度行）。筛选与排序在表头完成（对齐抖音工作台）。
 * 进度行布局契约（2026-11-11 真机反馈）：进度行固定在采集按钮**下方**独占一行
 * （工具栏纵向布局：第一行按钮组、第二行进度），绝不放到页面顶部通知条。collect 是
 * 宿主 collect.status 的进度投影（仅当前选中账号的传入）；running 时采集按钮禁用
 * 并显示 spinner + progressText。 */
export function WorkToolbar({
  onCollect, onRefresh, collectDisabled = false, refreshDisabled = false,
  refreshing = false, refreshMessage = null, collect = null, latestCollectedAt = null,
}) {
  const running = Boolean(collect && collect.status === 'running')
  // 状态行统一在采集按钮下方：采集进度优先，其次是刷新结果提示
  // （2026-11-11 真机反馈：提示就地显示，不要顶部通知条）。
  const statusText = running
    ? progressText(collect && collect.progress)
    : (refreshMessage || null)
  return h('div', { className: 'ywc-toolbar' },
    h('div', { className: 'ywc-toolbar-left' },
      h('button', {
        className: 'ywc-button primary', type: 'button', onClick: onCollect,
        disabled: collectDisabled || running, 'aria-busy': running || undefined,
      }, running ? '采集中…' : '采集本账号全部'),
      // 刷新按钮：执行期间显示「刷新中…」并禁用，避免用户以为点击没生效
      // （2026-11-11 真机反馈）。
      h('button', {
        className: 'ywc-button', type: 'button', onClick: onRefresh,
        disabled: refreshDisabled || refreshing, 'aria-busy': refreshing || undefined,
      }, refreshing ? '刷新中…' : '刷新'),
      // 最近采集时间（2026-11-12 真机反馈）：原为表格最后一列，改为刷新按钮后的
      // 单值展示；无数据时显示「—」，不隐藏以免布局跳动。
      h('span', { className: 'ywc-toolbar-note' }, `最近采集时间：${fmtDateTime(latestCollectedAt)}`),
    ),
    statusText
      ? h('div', {
        className: 'ywc-progress', role: 'status', 'aria-live': 'polite',
        'aria-busy': running || undefined,
      },
      running ? h('span', { className: 'ywc-spinner', 'aria-hidden': true }) : null,
      h('span', null, statusText),
      )
      : null,
  )
}

/** 作品表格（对齐抖音 WorkTable 交互）：
 * - 无数据不渲染表格框架，只显示居中空态提示（ydo-state 同款）；
 * - 可排序列表头为按钮：点击 desc → asc → 默认循环，箭头 ↕/↓/↑ + aria-sort；
 * - 全量渲染已入库作品，固定高度区域内部滚动（无「加载更多」分页）；
 * - 2026-11-11 真机反馈：无「操作」列——双击整行（或行内回车）打开详情；
 *   作品列 = 封面缩略图 + 标题（官方发布文案口径），不再显示 ID 副行。 */
export function WorkTable({ rows, sort = DEFAULT_SORT_STATE, onSortChange, onOpenDetail, loading = false }) {
  // 首屏加载中与「确实没有作品」必须区分：两者外观一致时，2-3 秒等待看起来像卡死
  // （2026-11-12 真机反馈）。
  if (!rows.length && loading) {
    return h('div', { className: 'ywc-table-state', role: 'status', 'aria-busy': 'true' },
      h('span', { className: 'ywc-spinner', 'aria-hidden': true }),
      h('p', null, '正在加载作品…'),
    )
  }
  if (!rows.length) {
    return h('div', { className: 'ywc-table-state', role: 'status' },
      h('p', null, '当前账号暂无已入库作品，先执行「采集本账号全部」'),
    )
  }
  const headCells = TABLE_COLUMNS.map(column => {
    if (!column.sortable) return h('th', { key: column.label, scope: 'col' }, column.label)
    const direction = sort && sort.key === column.key && sort.direction !== 'default' ? sort.direction : 'default'
    const arrow = direction === 'desc' ? '↓' : direction === 'asc' ? '↑' : '↕'
    return h('th', {
      key: column.label, scope: 'col',
      'aria-sort': direction === 'desc' ? 'descending' : direction === 'asc' ? 'ascending' : 'none',
    },
      h('button', {
        type: 'button',
        className: `ywc-sort${direction !== 'default' ? ' ywc-sort-active' : ''}`,
        onClick: () => onSortChange && onSortChange(column.key),
        'aria-label': `${column.label}：${direction === 'desc' ? '降序' : direction === 'asc' ? '升序' : '默认排序'}`,
      },
        h('span', { className: 'ywc-sort-text' }, column.label),
        h('span', { className: 'ywc-sort-arrow', 'aria-hidden': true }, arrow),
      ),
    )
  })
  return h('div', { className: 'ywc-table-wrap' },
    h('table', { className: 'ywc-table', 'aria-label': '视频号作品列表' },
      h('thead', null, h('tr', null, headCells)),
      h('tbody', null, rows.map(work => h('tr', {
        key: work.work_id,
        tabIndex: 0,
        title: '双击查看作品详情',
        // 读屏用户无法感知 title 提示：显式 aria-label 说明行内可执行的动作。
        'aria-label': `${workTitle(work) || '未命名作品'}，回车或双击查看详情`,
        // React 的合法事件名是 onDoubleClick；onDblClick 会被忽略、导致双击无响应。
        onDoubleClick: () => onOpenDetail && onOpenDetail(work),
        onKeyDown: event => { if (event.key === 'Enter') onOpenDetail && onOpenDetail(work) },
      }, workRowCells(work)))),
    ),
  )
}

/** 作品封面（对齐抖音 WorkCover）：缩略图 + 右下角时长角标；加载失败/缺失 →
 * 占位块（浅灰底 + 居中「封面」小字），不隐藏作品行。coverUrl 为 null 不发请求。
 * size='large'（详情头部 110×146）复用同一结构。URL 只接受 http(s)（safeAvatarSrc 防御）。 */
export function WorkCover({ coverUrl, durationText, size = 'small' }) {
  const [failed, setFailed] = useState(false)
  const safeSrc = safeAvatarSrc(coverUrl)
  const boxClass = `ywc-cover${size === 'large' ? ' ywc-cover-large' : ''}${!safeSrc || failed ? ' ywc-cover-fallback' : ''}`
  return h('span', { className: boxClass },
    safeSrc && !failed
      ? h('img', {
        className: 'ywc-cover-img',
        src: safeSrc,
        alt: '',
        loading: 'lazy',
        referrerPolicy: 'no-referrer',
        onError: () => setFailed(true),
      })
      : h('span', { className: 'ywc-cover-fallback-text', 'aria-hidden': true }, '封面'),
    durationText && !(!safeSrc || failed) ? h('span', { className: 'ywc-cover-duration' }, durationText) : null)
}

function workRowCells(work) {
  // 原始链接机制（2026-11-11）：标题带链接需数据源提供 url（官方列表接口不提供，
  // 见 ui-format.safeWorkUrl 注释）——当前 works.list 无该字段，标题按纯文本渲染。
  const linkHref = safeWorkUrl(work.url)
  const title = workTitle(work) || EMPTY
  const cells = [
    h('td', { key: 'work' }, h('div', { className: 'ywc-work-cell' },
      // key 绑定封面地址：同一行/同一弹层的数据刷新后若 URL 变化，强制重挂载，
      // 避免沿用上一次加载失败留下的 failed 态而不再尝试新地址。
      h(WorkCover, {
        key: `cover:${work.work_id}:${work.cover_url || ''}`,
        coverUrl: work.cover_url,
        durationText: work.duration_s ? `${work.duration_s}s` : null,
      }),
      linkHref
        // `noreferrer` 已隐含 noopener；点击/双击不得冒泡到行（否则同时开浏览器+详情）。
        ? h('a', {
          className: 'ywc-work-title',
          href: linkHref, target: '_blank', rel: 'noreferrer',
          title,
          onClick: event => event.stopPropagation(),
          onDoubleClick: event => event.stopPropagation(),
          onKeyDown: event => event.stopPropagation(),
        }, title)
        : h('div', { className: 'ywc-work-title', title }, title),
    )),
    h('td', { key: 'publish' }, fmtDateTime(work.publish_time)),
    h('td', { key: 'completion' }, fmtPct(work.completion_rate_pct)),
    h('td', { key: 'avg' }, fmtSeconds(work.avg_play_duration_s)),
    h('td', { key: 'play' }, fmtCount(work.play_count)),
    h('td', { key: 'like' }, fmtCount(work.like_count)),
    h('td', { key: 'favorite' }, fmtCount(work.favorite_count)),
    h('td', { key: 'comment' }, fmtCount(work.comment_count)),
    h('td', { key: 'share' }, fmtCount(work.share_count)),
    h('td', { key: 'forward' }, fmtCount(work.forward_count)),
    h('td', { key: 'follow' }, fmtCount(work.follow_count)),
    h('td', { key: 'wecom' }, fmtPair(work.wecom_link_click_count, work.wecom_link_click_uv)),
    h('td', { key: 'contact' }, fmtPair(work.wecom_contact_add_count, work.wecom_contact_add_uv)),
  ]
  return cells
}

/** 作品详情弹层内容（2026-11-11 真机反馈重排）：
 * 头部一行 = 封面 + 元信息（标题/ID/发布时间/最近采集）→ KPI 卡片横向铺满 →
 * 来源分布与观众留存左右双卡片（对齐抖音单作品详情）→ 按日数据近 7 天多指标
 * 趋势线（播放用主题色，其余参考官方后台配色）→ 数据缺口。 */
export function WorkDetailDialog({ work, detail, dailyMetrics, onClose }) {
  if (!work) return null
  const trafficRows = sortTrafficRowsByValue(
    normalizeTrafficRows(detail && detail.traffic_source || work.traffic_source),
  )
  const retention = normalizeRetentionPoints(detail && detail.retention_trend || work.retention_trend)
  const daily = Array.isArray(dailyMetrics) ? dailyMetrics : []
  const gaps = dataGapEntries(work.data_gap)
  return h('div', { className: 'ywc-modal open', role: 'dialog', 'aria-modal': 'true', onClick: backdropClose(onClose) },
    h('div', { className: 'ywc-dialog', onClick: stopPropagation },
      h('header', { className: 'ywc-dialog-header' },
        h('div', null,
          h('h2', null, workTitle(work) || EMPTY),
          h('p', { className: 'ywc-card-meta' }, '基础信息 · 核心指标 · 来源分布 · 观众留存'),
        ),
        h('button', { className: 'ywc-close', type: 'button', 'aria-label': '关闭作品详情', onClick: onClose }, '×'),
      ),
      h('div', { className: 'ywc-dialog-body' },
        // 头部信息行：封面 + 元信息（2026-11-11：KPI 移出头部、铺满下方整行）。
        h('div', { className: 'ywc-dialog-grid' },
          h(WorkCover, {
            key: `detail-cover:${work.work_id}:${work.cover_url || ''}`,
            coverUrl: work.cover_url, size: 'large',
            durationText: work.duration_s ? `${work.duration_s}s` : null,
          }),
          h('div', { className: 'ywc-dialog-meta' },
            h('p', { className: 'ywc-card-meta' }, `ID：${work.work_id}`),
            h('p', { className: 'ywc-card-meta' }, `发布时间：${fmtDateTime(work.publish_time)}`),
            h('p', { className: 'ywc-card-meta' }, `最近采集：${fmtDateTime(work.latest_collected_at)}`),
          ),
        ),
        h('div', { className: 'ywc-metric-grid' },
          metricCells(work).map(([label, value]) => h('div', { className: 'ywc-kpi', key: label },
            h('div', { className: 'ywc-kpi-label' }, label),
            h('div', { className: 'ywc-kpi-value' }, fmt(value)),
          )),
        ),
        h('div', { className: 'ywc-two-column' },
          section('来源分布（不限）', trafficRows.length
            ? h('div', { className: 'ywc-bars' }, barRows(
              trafficRows.map(row => [row.name, row.value === null ? EMPTY : row.value]),
            ))
            : h('p', { className: 'ywc-empty' }, '本次接口未提供来源数据')),
          section('观众留存趋势', retention.length
            ? h('div', { className: 'ywc-bars' }, barRows(
              retention.map(point => [`${point.s}s`, point.v === null ? EMPTY : `${point.v}%`]),
              row => Number(String(row[1]).replace('%', '')),
            ))
            : h('p', { className: 'ywc-empty' }, '本次接口未提供观众留存数据')),
        ),
        section('按日数据（近 7 天）', daily.length
          ? dailyTrendChart(daily, work.publish_time)
          : h('p', { className: 'ywc-empty' }, '该作品暂无按日数据')),
        section('数据缺口', gaps.length
          ? h('div', { className: 'ywc-bars' }, gaps.map(([name, gap]) => h('span', { className: 'ywc-badge', key: name }, `${name} · ${gapReasonText(gap)}`)))
          : h('span', { className: 'ywc-badge' }, '本次采集无核心字段缺口')),
      ),
    ),
  )
}

function metricCells(work) {
  return [
    ['完播率', fmtPct(work.completion_rate_pct)],
    ['平均播放时长', fmtSeconds(work.avg_play_duration_s)],
    ['播放', fmtCount(work.play_count)],
    ['喜欢', fmtCount(work.like_count)],
    ['收藏', fmtCount(work.favorite_count)],
    ['评论', fmtCount(work.comment_count)],
    ['分享', fmtCount(work.share_count)],
    ['转发聊天和朋友圈', fmtCount(work.forward_count)],
    ['关注量', fmtCount(work.follow_count)],
    ['企微链接点击次数', fmtCount(work.wecom_link_click_count)],
    ['企微链接点击人数', fmtCount(work.wecom_link_click_uv)],
    ['添加通讯录次数', fmtCount(work.wecom_contact_add_count)],
    ['添加通讯录人数', fmtCount(work.wecom_contact_add_uv)],
  ]
}

/** 按日趋势线指标与配色（2026-11-11 真机反馈）：播放用主题色（用户指定），
 * 其余参考官方后台趋势线配色（喜欢浅蓝/评论红/分享黄/关注绿，紫/橙借官方色系
 * 给收藏/转发，保证 7 条线可分）。 */
const DAILY_SERIES = [
  { key: 'daily_play_count', label: '播放', color: 'var(--ywc-brand)' },
  { key: 'daily_like_count', label: '喜欢', color: '#4ea6ff' },
  { key: 'daily_favorite_count', label: '收藏', color: '#8b5cf6' },
  { key: 'daily_comment_count', label: '评论', color: '#e0524a' },
  { key: 'daily_share_count', label: '分享', color: '#d9a400' },
  { key: 'daily_forward_count', label: '转发', color: '#f08a3c' },
  { key: 'daily_follow_count', label: '关注量', color: '#2f9e44' },
]

/**
 * 最近 N 个上海语义日（含 endDay，默认「昨天」——当天数据未收盘不入日表）。
 * 2026-11-11 真机反馈：趋势图 x 轴要固定 7 天并从当天往前推，缺数据的日期留空。
 */
export function recentDays(count = 7, endDayIso = null) {
  const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  let base = isDay(endDayIso) ? endDayIso : null
  if (!base) {
    const shanghaiNow = new Date(Date.now() + 8 * 3600 * 1000)
    shanghaiNow.setUTCDate(shanghaiNow.getUTCDate() - 1)
    base = shanghaiNow.toISOString().slice(0, 10)
  }
  const end = Date.parse(`${base}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) =>
    new Date(end - (count - 1 - index) * 86400000).toISOString().slice(0, 10))
}

function trendNumber(value) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/** y 轴标签格式：大数值用万/亿压缩（否则七位数字会超出左侧留白被 SVG 裁掉），
 * 小跨度保留一位小数（否则 63~66 会被四舍五入成重复刻度）。 */
function fmtAxis(value, span) {
  const numeric = Number(value) || 0
  const abs = Math.abs(numeric)
  if (abs >= 100000000) return `${(numeric / 100000000).toFixed(1).replace(/\.0$/, '')}亿`
  if (abs >= 10000) return `${(numeric / 10000).toFixed(1).replace(/\.0$/, '')}万`
  if (span < 10) return numeric.toFixed(1).replace(/\.0$/, '')
  return fmtCount(Math.round(numeric))
}

/** y 轴刻度：把 [min,max] 切成 4 段（5 条网格线），标签取整。 */
function yAxisTicks(min, max) {
  const span = max - min
  const ticks = []
  for (let index = 0; index <= 4; index += 1) {
    const value = min + (span * index) / 4
    ticks.push({ value, ratio: index / 4 })
  }
  return ticks
}

/**
 * 通用趋势图（2026-11-11 真机反馈，对齐官方后台）：
 * - 统一真实 y 轴刻度（所有系列共用），带网格线与数值标签；
 * - x 轴固定 rows 给出的自然日（调用方用 `recentDays(7)` 补齐）；
 * - 缺失值断线（不跨缺口连线、不造 0）；
 * - 鼠标移动时显示浮层，列出该日期下所有系列的值。
 */
export function TrendChart({ rows, series, ariaLabel = '趋势图', height = 210 }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const days = Array.isArray(rows) ? rows : []
  const lines = Array.isArray(series) ? series : []
  const width = 680
  const padLeft = 46
  const padRight = 16
  const padTop = 12
  const padBottom = 26
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom
  const stepX = days.length > 1 ? plotWidth / (days.length - 1) : 0
  const xAt = index => padLeft + index * stepX

  const values = []
  for (const line of lines) {
    for (const row of days) {
      const value = trendNumber(row && row[line.key])
      if (value !== null) values.push(value)
    }
  }
  // 没有任何有效值时不画伪坐标轴（否则会渲染 0/0/1/1/1 这样的空图）。
  if (!values.length) {
    return h('p', { className: 'ywc-empty' }, '暂无可展示的趋势数据')
  }
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const yMin = rawMin === rawMax ? Math.max(0, rawMin - 1) : rawMin
  const yMax = rawMin === rawMax ? rawMax + 1 : rawMax
  const yAt = value => padTop + plotHeight - ((Number(value) - yMin) / (yMax - yMin || 1)) * plotHeight
  const ticks = yAxisTicks(yMin, yMax)

  const handleMove = event => {
    if (!days.length) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect || !rect.width) return
    const ratio = (event.clientX - rect.left) / rect.width
    const svgX = ratio * width
    const raw = stepX > 0 ? Math.round((svgX - padLeft) / stepX) : 0
    const index = Math.min(days.length - 1, Math.max(0, raw))
    if (index !== hoverIndex) setHoverIndex(index)
  }

  const grid = [
    ...ticks.map((tick, index) => h('g', { key: `tick-${index}` },
      h('line', {
        x1: padLeft, y1: yAt(tick.value).toFixed(1), x2: width - padRight, y2: yAt(tick.value).toFixed(1),
        style: { stroke: 'var(--ywc-border)', strokeWidth: 1 },
      }),
      h('text', {
        x: padLeft - 8, y: (yAt(tick.value) + 3).toFixed(1), textAnchor: 'end',
        style: { fill: 'var(--ywc-muted)', fontSize: 10 },
      }, fmtAxis(tick.value, yMax - yMin)),
    )),
  ]

  const paths = []
  // 绘制顺序反转：第一条 series（主指标，如播放量）最后画、压在最上层——多条线
  // 在 0 附近重叠时，主指标不能被后画的线盖住看不见（2026-11-11 真机反馈）。
  for (const line of [...lines].reverse()) {
    let d = ''
    let segmentOpen = false
    days.forEach((row, index) => {
      const value = trendNumber(row && row[line.key])
      if (value === null) {
        segmentOpen = false
        return
      }
      d += `${segmentOpen ? 'L' : 'M'}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`
      segmentOpen = true
    })
    if (d) paths.push(h('path', { key: line.key, d, stroke: line.color, strokeWidth: 2, fill: 'none' }))
  }

  const labels = days.map((row, index) => h('text', {
    key: `x-${index}`, x: xAt(index).toFixed(1), y: height - 8,
    textAnchor: 'middle', style: { fill: 'var(--ywc-muted)', fontSize: 10 },
  }, String(row && row.day || '').slice(5)))

  const hoverRow = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < days.length ? days[hoverIndex] : null
  const hoverLeft = hoverRow ? Math.min(88, Math.max(12, (xAt(hoverIndex) / width) * 100)) : 0
  const tooltip = hoverRow ? h('div', {
    className: 'ywc-chart-tooltip',
    style: { left: `${hoverLeft}%` },
  },
  h('div', { className: 'ywc-chart-tooltip-day' }, String(hoverRow.day || '')),
  lines.map(line => {
    const value = trendNumber(hoverRow[line.key])
    return h('div', { className: 'ywc-chart-tooltip-row', key: line.key },
      h('i', { style: { background: line.color } }),
      h('span', { className: 'ywc-chart-tooltip-name' }, line.label),
      h('span', { className: 'ywc-chart-tooltip-value' }, value === null ? EMPTY : fmtCount(value)),
    )
  })) : null

  return h('div', { className: 'ywc-chart-wrap' },
    h('svg', {
      className: 'ywc-svg', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel,
      onMouseMove: handleMove,
      onMouseLeave: () => setHoverIndex(null),
    },
    grid,
    hoverRow ? h('line', {
      className: 'ywc-chart-cursor',
      x1: xAt(hoverIndex).toFixed(1), y1: padTop, x2: xAt(hoverIndex).toFixed(1), y2: padTop + plotHeight,
      style: { stroke: 'var(--ywc-muted)', strokeWidth: 1, strokeDasharray: '3 3' },
    }) : null,
    paths,
    hoverRow ? lines.map(line => {
      const value = trendNumber(hoverRow[line.key])
      if (value === null) return null
      return h('circle', {
        key: `dot-${line.key}`, cx: xAt(hoverIndex).toFixed(1), cy: yAt(value).toFixed(1), r: 3,
        style: { fill: 'var(--ywc-surface)', stroke: line.color, strokeWidth: 2 },
      })
    }) : null,
    h('line', {
      x1: padLeft, y1: padTop + plotHeight, x2: width - padRight, y2: padTop + plotHeight,
      style: { stroke: 'var(--ywc-border)', strokeWidth: 1 },
    }),
    labels),
    tooltip,
  )
}

/** 按日数据趋势线（2026-11-11：替代原 7 列明细表，对齐官方后台趋势图）：
 * x 轴固定最近 7 个自然日、统一真实 y 轴刻度；**发布日之前按 0 处理**（作品尚不
 * 存在，确定性为 0），发布日之后的缺失才断线（可能采集中断，不能造 0）。 */
function dailyTrendChart(daily, publishTime) {
  const byDay = new Map()
  for (const row of Array.isArray(daily) ? daily : []) {
    if (row && row.day) byDay.set(String(row.day), row)
  }
  const publishDay = shanghaiDayOf(publishTime)
  const rows = recentDays(7).map(day => {
    // 发布前的日期：作品还没发，各项指标确定是 0（2026-11-11 真机反馈）。
    // 必须优先于 byDay 判定——官方聚合可能对这些天返回 null 行，若先取 found
    // 就会保留 null 变成断线（实测 11-04~11-06 仍然空白）。
    if (publishDay && day < publishDay) {
      const zeros = {}
      for (const line of DAILY_SERIES) zeros[line.key] = 0
      return { day, ...zeros }
    }
    const found = byDay.get(day)
    return found ? { day, ...found } : { day }
  })
  const hasAny = rows.some(row => DAILY_SERIES.some(line => trendNumber(row[line.key]) !== null))
  if (!hasAny) return h('p', { className: 'ywc-empty' }, '该作品暂无按日数据')
  return h('div', null,
    h('div', { className: 'ywc-chart-legend' },
      DAILY_SERIES.map(line => h('span', { key: line.key },
        h('i', { style: { background: line.color } }), line.label))),
    h(TrendChart, { rows, series: DAILY_SERIES, ariaLabel: '按日数据近 7 天趋势' }),
  )
}

function section(title, content) {
  return h('section', { className: 'ywc-detail-section' },
    h('h4', null, title),
    content,
  )
}

/** 条形行：rows 统一为 [[label, display]]，valueOf(row) 提取数值用于宽度比例。 */
function barRows(rows, valueOf = row => Number(row[1])) {
  const max = Math.max(1, ...rows.map(row => Number(valueOf(row)) || 0))
  return rows.map(([name, value]) => h('div', { className: 'ywc-bar-row', key: name },
    h('span', null, name),
    h('div', { className: 'ywc-bar-track' }, h('div', {
      className: 'ywc-bar-fill',
      style: { width: `${Math.round((Number(valueOf([name, value])) || 0) / max * 100)}%` },
    })),
    h('span', { className: 'ywc-bar-value' }, String(value)),
  ))
}

// 详情页只展示影响分析的缺口（白名单与摘要卡共用，见 ui-format 的 CORE_GAP_FIELDS）；
// 原创声明等非核心字段缺失时静默过滤，避免被误读为采集失败（2026-11-11 真机反馈）。
function dataGapEntries(dataGap) {
  if (!dataGap || typeof dataGap !== 'object') return []
  return Object.entries(dataGap)
    .filter(([field]) => CORE_GAP_FIELDS.has(field))
    .map(([field, gap]) => [FIELD_NAMES[field] || field, gap])
}

function gapReasonText(gap) {
  const reason = gap && gap.reason ? String(gap.reason) : ''
  if (reason === 'not_exposed') return '本次接口未提供'
  if (reason === 'FIELD_LENGTH_MISMATCH') return '官方序列长度异常'
  if (reason === 'TIME_SERIES_LENGTH_MISMATCH') return '官方窗口长度异常'
  if (reason === 'unknown_source_type') return '官方新增来源待适配'
  return reason || '本次接口未提供'
}

const FIELD_NAMES = {
  cover_url: '作品封面',
  publish_time: '发布时间',
  duration_s: '视频时长',
  play_count: '播放',
  like_count: '喜欢',
  favorite_count: '收藏',
  comment_count: '评论',
  forward_count: '转发聊天和朋友圈',
  share_count: '分享',
  follow_count: '关注量',
  completion_rate_pct: '完播率',
  avg_play_duration_s: '平均播放时长',
  fast_flip_rate_pct: '快速划走率',
  yesterday_play_count: '昨日播放',
  traffic_source: '来源分布',
  retention_trend: '观众留存',
  wecom_link_click_count: '企微链接点击次数',
  wecom_link_click_uv: '企微链接点击人数',
  wecom_contact_add_count: '添加通讯录次数',
  wecom_contact_add_uv: '添加通讯录人数',
  daily_play_count: '按日播放',
  daily_like_count: '按日喜欢',
  daily_favorite_count: '按日收藏',
  daily_comment_count: '按日评论',
  daily_forward_count: '按日转发',
  daily_share_count: '按日分享',
  daily_follow_count: '按日关注量',
  daily_ringset_count: '按日设为铃声',
  daily_status_cover_count: '按日朋友圈封面',
  daily_status_ref_count: '按日设为状态',
  daily_wecom_link_click_count: '按日企微点击',
  daily_wecom_contact_add_count: '按日添加通讯录',
  observed_completion_rate_pct: '按日完播率',
  observed_avg_play_duration_s: '按日平均时长',
  observed_fast_flip_rate_pct: '按日划走率',
}

function backdropClose(onClose) {
  return event => { if (event.target === event.currentTarget) onClose() }
}

function stopPropagation(event) { event.stopPropagation() }
