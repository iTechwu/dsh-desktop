// 作品数据 Tab（视觉与交互基准：docs/1109/wx/ui-demo.html，§9.0/§9.2/§9.3）。
// 纯展示组件：数据由 client.js 传入；排序/筛选/分页只作用于已入库数据。

import { createElement as h } from 'react'
import {
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
  weightedCompletionRate,
} from './ui-format.js'

const TABLE_COLUMNS = [
  '作品',
  '发布时间',
  '完播率',
  '平均播放时长',
  '播放',
  '喜欢',
  '收藏',
  '评论',
  '分享',
  '转发聊天和朋友圈',
  '关注量',
  '企微链接点击',
  '添加通讯录',
  '最近采集',
  '操作',
]

/** 顶部摘要卡（§9.2 固定 5 张，不随筛选/排序/分页变化）。
 *
 * `summaryOverview` 必须是固定 last_7d 窗口的独立快照（不随账号 Tab 窗口切换
 * 变化，review P0-3）；作品总数取账号行 feedCount（官方 feedsCount，review P0-4）。
 */
export function WorkSummaryCards({ works, summaryOverview, account }) {
  const totals = summaryOverview && summaryOverview.metrics && summaryOverview.metrics.totals
    ? summaryOverview.metrics.totals : {}
  const cells = [
    { label: '作品总数', value: fmtCount(account && account.feedCount), hint: '官方 totalCount' },
    { label: '近7日播放', value: fmtCount(totals.daily_play_count), hint: '账号级官方聚合' },
    { label: '近7日关注量', value: fmtCount(totals.daily_follow_count), hint: '非净关注' },
    { label: '作品完播率', value: fmtPct(weightedCompletionRate(works)), hint: '按播放加权计算' },
    { label: '缺口作品', value: fmtCount(gapWorkCount(works)), hint: '至少 1 个字段缺失' },
  ]
  return h('div', { className: 'ywc-summary-grid' },
    cells.map(cell => h('div', { className: 'ywc-kpi', key: cell.label },
      h('div', { className: 'ywc-kpi-label' }, cell.label),
      h('div', { className: 'ywc-kpi-value' }, cell.value),
      h('div', { className: 'ywc-kpi-hint' }, cell.hint),
    )),
  )
}

/** 工具栏（采集本账号全部 / 刷新 / 发布时间范围 / 排序）。 */
export function WorkToolbar({ onCollect, onRefresh, range, onRange, customFrom, customTo, onCustomRange, sort, onSort, disabled }) {
  return h('div', { className: 'ywc-toolbar' },
    h('div', { className: 'ywc-toolbar-left' },
      h('button', { className: 'ywc-button primary', type: 'button', onClick: onCollect, disabled }, '采集本账号全部'),
      h('button', { className: 'ywc-button', type: 'button', onClick: onRefresh, disabled }, '刷新'),
    ),
    h('div', { className: 'ywc-toolbar-right' },
      h('label', { className: 'ywc-field' }, '发布时间',
        h('select', {
          className: 'ywc-select', value: range, disabled,
          onChange: event => onRange(event.target.value), 'aria-label': '发布时间范围',
        },
          h('option', { value: 'all' }, '全部'),
          h('option', { value: '7d' }, '近7天'),
          h('option', { value: '30d' }, '近30天'),
          h('option', { value: 'custom' }, '自定义'),
        ),
      ),
      range === 'custom'
        ? h('label', { className: 'ywc-field' }, '范围',
          h('input', { className: 'ywc-input', type: 'date', value: customFrom || '', 'aria-label': '发布起始日', onChange: event => onCustomRange(event.target.value, customTo || '') }),
          '–',
          h('input', { className: 'ywc-input', type: 'date', value: customTo || '', 'aria-label': '发布结束日', onChange: event => onCustomRange(customFrom || '', event.target.value) }),
        )
        : null,
      h('label', { className: 'ywc-field' }, '排序',
        h('select', {
          className: 'ywc-select', value: sort, disabled,
          onChange: event => onSort(event.target.value), 'aria-label': '作品排序',
        },
          h('option', { value: 'publish_time' }, '发布时间'),
          h('option', { value: 'play_count' }, '播放'),
          h('option', { value: 'like_count' }, '喜欢'),
          h('option', { value: 'favorite_count' }, '收藏'),
          h('option', { value: 'comment_count' }, '评论'),
          h('option', { value: 'share_count' }, '分享'),
          h('option', { value: 'follow_count' }, '关注量'),
        ),
      ),
    ),
  )
}

/** 作品表格 + 本地分页（每页 20 条 / 加载更多 / 筛选排序后重置，§9.2）。 */
export function WorkTable({ rows, displayedCount, total, onLoadMore, onOpenDetail }) {
  const visible = rows.slice(0, displayedCount)
  const body = visible.length
    ? visible.map(work => h('tr', { key: work.work_id }, workRowCells(work, onOpenDetail)))
    : [h('tr', { key: 'empty' }, h('td', { colSpan: TABLE_COLUMNS.length, className: 'ywc-empty' }, '当前账号暂无已入库作品，先执行采集'))]
  return h('div', { key: 'work-table' },
    h('div', { className: 'ywc-table-wrap' },
      h('table', { className: 'ywc-table', 'aria-label': '视频号作品列表' },
        h('thead', null, h('tr', null, TABLE_COLUMNS.map(column => h('th', { key: column }, column)))),
        h('tbody', null, body),
      ),
    ),
    h('div', { className: 'ywc-table-footer' },
      // total 缺失（未加载账号时 feedCount 未知）回退 rows.length，不显示 NaN。
      h('span', null, `已展示 ${Math.min(displayedCount ?? rows.length, rows.length)} / ${total ?? rows.length} 条已入库作品`),
      h('button', {
        className: 'ywc-button', type: 'button',
        disabled: displayedCount >= rows.length, onClick: onLoadMore,
      }, '加载更多'),
    ),
    )
}

function workRowCells(work, onOpenDetail) {
  const cells = [
    h('td', { key: 'work' }, h('div', { className: 'ywc-work-cell' },
      h('div', { className: 'ywc-cover' }, work.cover_url ? '封面' : EMPTY, work.duration_s ? h('span', null, `${work.duration_s}s`) : null),
      h('div', null,
        h('div', { className: 'ywc-work-title', title: work.title || EMPTY }, work.title || EMPTY),
        h('div', { className: 'ywc-work-sub' }, `ID：${work.work_id}`),
      ),
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
    h('td', { key: 'collected' }, fmtDateTime(work.latest_collected_at)),
    h('td', { key: 'action' },
      h('button', { className: 'ywc-link', type: 'button', onClick: () => onOpenDetail(work) }, '详情'),
    ),
  ]
  return cells
}

/** 作品详情弹层内容（§9.3 六组：基础/核心指标/留存/来源/按日/缺口）。 */
export function WorkDetailDialog({ work, detail, dailyMetrics, onClose }) {
  if (!work) return null
  const trafficRows = normalizeTrafficRows(detail && detail.traffic_source || work.traffic_source)
  const retention = normalizeRetentionPoints(detail && detail.retention_trend || work.retention_trend)
  const daily = Array.isArray(dailyMetrics) ? dailyMetrics : []
  const gaps = dataGapEntries(work.data_gap)
  return h('div', { className: 'ywc-modal open', role: 'dialog', 'aria-modal': 'true', onClick: backdropClose(onClose) },
    h('div', { className: 'ywc-dialog', onClick: stopPropagation },
      h('header', { className: 'ywc-dialog-header' },
        h('div', null,
          h('h2', null, work.title || EMPTY),
          h('p', { className: 'ywc-card-meta' }, '基础信息 · 核心指标 · 来源分布 · 观众留存'),
        ),
        h('button', { className: 'ywc-close', type: 'button', 'aria-label': '关闭作品详情', onClick: onClose }, '×'),
      ),
      h('div', { className: 'ywc-dialog-body' },
        h('div', { className: 'ywc-dialog-grid' },
          h('div', { className: 'ywc-detail-cover' }, work.cover_url ? '封面' : EMPTY),
          h('div', null,
            h('p', { className: 'ywc-card-meta' }, `ID：${work.work_id}`),
            h('p', { className: 'ywc-card-meta' }, `发布时间：${fmtDateTime(work.publish_time)}`),
            h('p', { className: 'ywc-card-meta' }, `最近采集：${fmtDateTime(work.latest_collected_at)}`),
            h('div', { className: 'ywc-metric-grid' },
              metricCells(work).map(([label, value]) => h('div', { className: 'ywc-kpi', key: label },
                h('div', { className: 'ywc-kpi-label' }, label),
                h('div', { className: 'ywc-kpi-value' }, fmt(value)),
              )),
            ),
          ),
        ),
        section('来源分布（不限）', trafficRows.length
          ? h('div', { className: 'ywc-bars' }, barRows(trafficRows.map(row => [row.name, row.value])))
          : h('p', { className: 'ywc-empty' }, '本次接口未提供来源数据')),
        section('观众留存趋势', retention.length
          ? h('div', { className: 'ywc-bars' }, barRows(retention.map(point => [`${point.s}s`, `${point.v}%`], row => Number(String(row[1]).replace('%', '')))))
          : h('p', { className: 'ywc-empty' }, '本次接口未提供观众留存数据')),
        section('按日数据', daily.length
          ? h('div', { className: 'ywc-bars' }, dailyRowLines(daily))
          : h('p', { className: 'ywc-empty' }, '该作品暂无按日数据')),
        section('数据缺口', gaps.length
          ? h('div', { className: 'ywc-bars' }, gaps.map(([name, gap]) => h('span', { className: 'ywc-badge', key: name }, `${name} · ${gapReasonText(gap)}`)))
          : h('span', { className: 'ywc-badge' }, '本次采集无字段缺口')),
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

function dailyRowLines(daily) {
  const header = ['日期', '播放', '喜欢', '收藏', '评论', '分享', '转发', '关注量']
  const lines = [h('div', { className: 'ywc-bar-row', key: 'header', style: { gridTemplateColumns: DAILY_GRID } },
    header.map(name => h('span', { className: 'ywc-bar-value', key: name }, name)),
  )]
  return lines.concat(daily.map(row => h('div', { className: 'ywc-bar-row', key: row.day, style: { gridTemplateColumns: DAILY_GRID } },
    h('span', null, row.day),
    ['daily_play_count', 'daily_like_count', 'daily_favorite_count', 'daily_comment_count', 'daily_share_count', 'daily_forward_count', 'daily_follow_count']
      .map(field => h('span', { className: 'ywc-bar-value', key: field }, fmtCount(row[field]))),
  )))
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

function dataGapEntries(dataGap) {
  if (!dataGap || typeof dataGap !== 'object') return []
  return Object.entries(dataGap).map(([field, gap]) => [FIELD_NAMES[field] || field, gap])
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

const DAILY_GRID = '90px repeat(7, minmax(48px, 1fr))'

function backdropClose(onClose) {
  return event => { if (event.target === event.currentTarget) onClose() }
}

function stopPropagation(event) { event.stopPropagation() }
