// 构建产物（scripts/build.mjs 生成）：请勿手改。
__ModuleLoader__.register('@dofe/dsh-yootun-wx-channels-operation/client', function (require, module, exports) {
const React = require('react')
const { createElement: h, useState, useEffect, useMemo, useRef, useCallback } = React
// 视频号工作台 UI 纯格式化函数（client.js 构建时内联；无 React/DOM 依赖）。
// 视觉与交互基准：docs/1109/wx/ui-demo.html（§9.0 Demo 是一期 UI 冻结基准）。

const EMPTY = '—'

/** 缺失一律「—」，不显示 0 伪装（§9.2）。 */
function fmt(value) {
  return value === null || value === undefined || value === '' ? EMPTY : String(value)
}

/** 数值列：可空数字 → 千分位或「—」；0 是真实值照常显示。 */
function fmtCount(value) {
  if (value === null || value === undefined || value === '') return EMPTY
  const num = Number(value)
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : EMPTY
}

/** 比率列：0..100 数字 → 两位小数百分比或「—」。 */
function fmtPct(value) {
  if (value === null || value === undefined || value === '') return EMPTY
  const num = Number(value)
  return Number.isFinite(num) ? `${num.toFixed(2)}%` : EMPTY
}

/** 时长：秒 → 「7.40 秒」或「—」。 */
function fmtSeconds(value) {
  if (value === null || value === undefined || value === '') return EMPTY
  const num = Number(value)
  return Number.isFinite(num) ? `${num.toFixed(2)} 秒` : EMPTY
}

/** ISO 时间 → 本地展示（YYYY-MM-DD HH:mm）。 */
function fmtDateTime(iso) {
  if (!iso) return EMPTY
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return String(iso)
  const pad = value => String(value).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/** 次数/人数 组合列：uv 缺失只显示次数，双缺失「—」（Demo pair 语义）。 */
function fmtPair(count, uv) {
  if (count === null || count === undefined) return EMPTY
  if (uv === null || uv === undefined) return String(count)
  return `${count} / ${uv}`
}

/**
 * 作品摘要卡：播放量加权完播率（§9.2 口径，规范性）。
 * 仅对 completion 与 play 均非空的作品参与；分母 0 显示「—」。
 */
function weightedCompletionRate(works) {
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
function gapWorkCount(works) {
  return (Array.isArray(works) ? works : []).filter(work => work && work.data_gap && Object.keys(work.data_gap).length > 0).length
}

/** 作品发布时间范围过滤（本地、只基于已入库数据）。range: 'all'|'7d'|'30d'。 */
function filterWorksByRange(works, range, now = new Date()) {
  const cutoffDays = range === '7d' ? 7 : range === '30d' ? 30 : null
  if (!cutoffDays) return Array.isArray(works) ? [...works] : []
  const cutoff = now.getTime() - cutoffDays * 86400_000
  return (Array.isArray(works) ? works : []).filter(work => {
    const publish = work && work.publish_time ? new Date(work.publish_time).getTime() : Number.NaN
    return Number.isFinite(publish) && publish >= cutoff
  })
}

/** 作品排序（服务端字段名，本地排序同样只查已入库数据）。 */
function sortWorks(works, sort, order) {
  const key = sort || 'publish_time'
  const direction = order === 'asc' ? 1 : -1
  return [...(Array.isArray(works) ? works : [])].sort((a, b) => {
    const av = a ? a[key] : undefined
    const bv = b ? b[key] : undefined
    if (av === bv) return 0
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv)) * direction
    }
    return (av - bv) * direction
  })
}

/** 来源分布行规范化：trafficSource JSON（§17.3）→ [{name, value}]，排除「全部」。 */
function normalizeTrafficRows(trafficSource) {
  const rows = trafficSource && Array.isArray(trafficSource.rows) ? trafficSource.rows : []
  return rows
    .filter(row => row && row.sourceType !== 999)
    .map(row => ({ name: String(row.name || row.sourceKey), value: Number(row.playCount) || 0 }))
}

/** 留存行规范化：retention_trend（§17.3）→ [{s, v}]。 */
function normalizeRetentionPoints(retentionTrend) {
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
function normalizeProfileRows(rows, dimension) {
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
function summarizeFansTrend(fansTrend) {
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
function summarizeAccountMetrics(metrics) {
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
function fansTotalSeries(dailyRows) {
  return (Array.isArray(dailyRows) ? dailyRows : [])
    .filter(row => row && row.follower_total_count !== null && row.follower_total_count !== undefined)
    .map(row => Number(row.follower_total_count))
}

// 作品数据 Tab（视觉与交互基准：docs/1109/wx/ui-demo.html，§9.0/§9.2/§9.3）。
// 纯展示组件：数据由 client.js 传入；排序/筛选/分页只作用于已入库数据。


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
function WorkSummaryCards({ works, summaryOverview, account }) {
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
function WorkToolbar({ onCollect, onRefresh, range, onRange, customFrom, customTo, onCustomRange, sort, onSort, disabled }) {
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
function WorkTable({ rows, displayedCount, total, onLoadMore, onOpenDetail }) {
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
      h('span', null, `已展示 ${Math.min(displayedCount, rows.length)} / ${total} 条已入库作品`),
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
function WorkDetailDialog({ work, detail, dailyMetrics, onClose }) {
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

// 账号数据 Tab / 账号区 / 登录弹层（视觉基准：docs/1109/wx/ui-demo.html，§9.1/§9.4）。


const PROFILE_TABS = [
  ['gender', '性别'],
  ['device', '访问设备'],
  ['age', '年龄分布'],
  ['province', '省份分布'],
  ['city', '城市分布'],
]

const WINDOWS = [['yesterday', '昨日'], ['last_7d', '近7天'], ['last_30d', '近30天']]

function avatarText(account) {
  const name = account.nickname || account.accountId || '视'
  return name.slice(0, 2)
}

function stateLine(account) {
  const map = { ok: '登录有效', expired: '登录已过期', unknown: '状态未知' }
  const label = account.deleteState === 'remote_deleted' ? '已删除（墓碑）' : map[account.sessionStatus] || map.unknown
  return h('span', { className: 'ywc-state', 'data-state': account.sessionStatus }, label)
}

/** 左侧账号管理栏（仅作品数据 Tab 显示；对齐抖音 ydo-accounts 结构）：
 * 标题行「账号管理 + 采集全部」→ 批量文本面板（仅批量运行/有结果时渲染）→
 * 账号卡列表 → 底部「添加账号」宽主按钮。 */
function AccountList({
  accounts, selectedId, onSelect, onProbe, onRemove, onBeginLogin,
  batch, onCollectAll, busy, browserBlocked,
}) {
  const collectable = accounts.some(item => item.deleteState !== 'remote_deleted' && item.sessionStatus === 'ok')
  const running = batch && batch.phase && batch.phase !== 'finished'
  return h('section', { className: 'ywc-panel' },
    h('div', { className: 'ywc-side-head' },
      h('h2', null, '账号管理'),
      h('button', {
        className: 'ywc-primary', type: 'button',
        disabled: busy || running || browserBlocked || !collectable,
        title: collectable ? undefined : '没有可采集账号（需登录有效）',
        onClick: onCollectAll,
      }, running ? '采集中' : '采集全部'),
    ),
    batch && (running || (batch.summary && (batch.summary.failed > 0 || batch.summary.skipped > 0)))
      ? h('div', { className: 'ywc-batch-panel', role: running ? 'status' : undefined, 'aria-live': running ? 'polite' : undefined },
        running
          ? [
            h('p', { key: 'phase' }, batch.phase === 'probing' ? '正在探测账号会话…' : '正在采集…'),
            h('p', { className: 'ywc-hint', key: 'cur' }, `当前账号 ${Math.min((batch.currentAccountIndex || 0) + 1, (batch.items || []).length)}/${(batch.items || []).length}`),
          ]
          : [
            h('p', { className: batch.summary.status === 'completed' ? 'ywc-ok' : batch.summary.status === 'failed' ? 'ywc-error' : 'ywc-warn', key: 'sum' },
              `批量结束：成功 ${batch.summary.completed}、失败 ${batch.summary.failed}、跳过 ${batch.summary.skipped}`),
          ],
      )
      : null,
    h('div', { className: 'ywc-account-list' },
      accounts.length === 0
        ? h('p', { className: 'ywc-empty', style: { padding: '0 2px 6px' } }, '还没有账号，点击下方「添加账号」扫码登录')
        : accounts.map(account => h('article', {
          className: 'ywc-card', key: account.accountId,
          'aria-current': account.accountId === selectedId ? 'true' : 'false',
        },
          h('button', { className: 'ywc-card-main', type: 'button', onClick: () => onSelect(account.accountId) },
            h('span', { className: 'ywc-avatar' }, avatarText(account)),
            h('span', null,
              h('span', { className: 'ywc-card-name' }, account.nickname || account.accountId),
              h('span', { className: 'ywc-card-meta' }, `关注者 ${fmtCount(account.followerTotalCount)} · 最近同步 ${fmtDateTime(account.lastCollectedAt || account.sessionCheckedAt)}`),
              stateLine(account),
            ),
          ),
          h('div', { className: 'ywc-card-actions' },
            h('button', {
              className: 'ywc-mini-button', type: 'button', disabled: busy || running,
              onClick: () => onProbe(account.accountId),
            }, account.sessionStatus === 'ok' ? '检测会话' : '重新扫码'),
            h('button', {
              className: 'ywc-mini-button danger', type: 'button', disabled: busy || running,
              onClick: () => onRemove(account.accountId),
            }, '删除账号'),
          ),
        )),
    ),
    h('button', {
      className: 'ywc-primary ywc-wide', type: 'button',
      disabled: browserBlocked, onClick: onBeginLogin,
    }, '添加账号'),
  )
}

/** 账号数据 Tab（§9.4 三段：全部视频指标 / 关注者增长 / 关注者画像）。
 * 全宽独占布局：页内自带账号选择器（对齐抖音账号总览的账号下拉），切换后
 * 三段数据随之刷新。 */
function AccountTab({
  window: windowKey, onWindow, overview, profile, profileKey, onProfileKey,
  accounts, selectedId, onSelectAccount,
}) {
  const availability = (overview && overview.availability) || {}
  const usable = (Array.isArray(accounts) ? accounts : []).filter(item => item.deleteState !== 'remote_deleted')
  return h('div', { className: 'ywc-account-page' },
    usable.length > 1
      ? h('div', { className: 'ywc-field', style: { justifyContent: 'flex-start', gap: 8 } },
        '当前账号',
        h('select', {
          className: 'ywc-select', value: selectedId || '',
          onChange: event => onSelectAccount(event.target.value), 'aria-label': '切换账号',
          style: { minWidth: 220 },
        },
          usable.map(item => h('option', { value: item.accountId, key: item.accountId },
            item.nickname || item.accountId,
          )),
        ),
      )
      : null,
    h('section', { className: 'ywc-panel' },
      h('div', { className: 'ywc-section-title' },
        h('h3', null, '全部视频指标'),
        windowGroup(WINDOWS, windowKey, onWindow),
      ),
      h('div', { className: 'ywc-kpi-grid' }, metricCards(overview)),
      availability.account_metrics === 'no_data'
        ? h('p', { className: 'ywc-empty', style: { padding: '0 12px 12px' } }, '该窗口暂无已入库的账号聚合数据，先执行采集')
        : null,
    ),
    h('div', { className: 'ywc-two-column' },
      h('section', { className: 'ywc-panel' },
        h('div', { className: 'ywc-section-title' }, h('h3', null, '关注者增长'), h('span', { className: 'ywc-badge' }, '账号级')),
        h('div', { className: 'ywc-chart-body' },
          h('div', { className: 'ywc-chart-legend' }, h('span', null, h('i', null), '关注者总数'), h('span', null, '净增 / 新增 / 取消关注见指标卡')),
          h('svg', { className: 'ywc-svg', viewBox: '0 0 680 180', role: 'img', 'aria-label': '关注者总数趋势' },
            fansChartSeries(overview)),
        ),
      ),
      h('section', { className: 'ywc-panel' },
        h('div', { className: 'ywc-section-title' }, h('h3', null, '关注者增长指标')),
        h('div', { className: 'ywc-kpi-grid' }, fansCards(overview)),
      ),
    ),
    h('section', { className: 'ywc-panel' },
      h('div', { className: 'ywc-section-title' },
        h('h3', null, '关注者画像'),
        h('span', { className: 'ywc-badge' }, profile && profile.day ? `截止 ${profile.day}` : '当前截止昨日'),
      ),
      h('div', { className: 'ywc-profile-tabs', role: 'tablist', 'aria-label': '画像维度' },
        PROFILE_TABS.map(([key, label]) => h('button', {
          key: key, type: 'button', 'aria-selected': key === profileKey ? 'true' : 'false',
          onClick: () => onProfileKey(key),
        }, label)),
      ),
      h('div', { className: 'ywc-bars' }, profileBars(profile, profileKey)),
    ),
  )
}

function windowGroup(windows, current, onWindow) {
  return h('div', { className: 'ywc-window-group', role: 'tablist', 'aria-label': '时间窗口' },
    windows.map(([key, label]) => h('button', {
      key, type: 'button', 'aria-selected': key === current ? 'true' : 'false',
      onClick: () => onWindow(key),
    }, label)),
  )
}

function metricCards(overview) {
  return summarizeAccountMetrics(overview && overview.metrics).map(([label, value]) => h('div', { className: 'ywc-kpi', key: label },
    h('div', { className: 'ywc-kpi-label' }, label),
    h('div', { className: 'ywc-kpi-value' }, fmtCount(value)),
    label === '关注量' ? h('div', { className: 'ywc-kpi-hint' }, '全部视频关注增量，非账号净关注') : null,
  ))
}

function fansCards(overview) {
  return summarizeFansTrend(overview && overview.fans_trend).map(([label, value]) => h('div', { className: 'ywc-kpi', key: label },
    h('div', { className: 'ywc-kpi-label' }, label),
    h('div', { className: 'ywc-kpi-value' }, fmtCount(value)),
  ))
}

function profileBars(profile, profileKey) {
  const dimension = profile ? profile[profileKey] : null
  const rows = normalizeProfileRows(dimension, profileKey)
  if (!rows.length) return h('p', { className: 'ywc-empty', style: { padding: '0 12px 12px' } }, '该画像维度本次未提供')
  const max = Math.max(1, ...rows.map(([, value]) => value))
  return rows.map(([name, value]) => h('div', { className: 'ywc-bar-row', key: name },
    h('span', null, name),
    h('div', { className: 'ywc-bar-track' }, h('div', { className: 'ywc-bar-fill', style: { width: `${Math.round(value / max * 100)}%` } })),
    h('span', { className: 'ywc-bar-value' }, `${value} 人`),
  ))
}

/** 关注者总数折线（Demo 同款 SVG 折线）。 */
function fansChartSeries(overview) {
  const rows = overview && overview.fans_trend && Array.isArray(overview.fans_trend.daily)
    ? overview.fans_trend.daily.filter(row => row.follower_total_count !== null && row.follower_total_count !== undefined)
    : []
  if (rows.length === 0) return null
  const values = rows.map(row => Number(row.follower_total_count))
  const width = 680
  const height = 180
  const padding = 28
  const min = Math.min(...values)
  const max = Math.max(...values)
  const points = values.map((value, index) => {
    const x = padding + index * ((width - padding * 2) / Math.max(1, values.length - 1))
    const y = height - padding - ((value - min) / Math.max(1, max - min)) * (height - padding * 2)
    return { x, y, value }
  })
  const paths = []
  for (let index = 1; index < points.length; index += 1) {
    paths.push(h('path', {
      key: `p${index}`,
      d: `M${points[index - 1].x},${points[index - 1].y}L${points[index].x},${points[index].y}`,
      stroke: 'var(--ywc-brand)', 'stroke-width': '3', fill: 'none',
    }))
  }
  for (const point of points) {
    paths.push(h('circle', {
      key: `c${point.x}-${point.y}`, cx: point.x, cy: point.y, r: 4,
      fill: 'var(--ywc-surface)', stroke: 'var(--ywc-brand)', 'stroke-width': '2',
    }, h('title', null, String(point.value))))
  }
  return paths
}

/** 登录弹层（§18.2：状态机 + 刷新二维码；不展示/不保存真实二维码）。 */
function LoginDialog({ login, onRefreshQr, onClose }) {
  const stateText = {
    waiting_qr: '等待扫码',
    waiting_confirm: '已扫码，请在手机确认',
    qr_expired: '二维码已过期',
    ok: '登录成功',
    timeout: '登录未完成，可重试',
    failed: '登录失败，可重试',
    idle: '准备中…',
  }
  return h('div', { className: 'ywc-modal open', role: 'dialog', 'aria-modal': 'true', onClick: backdropClose(onClose) },
    h('div', { className: 'ywc-dialog', style: { width: 'min(430px,100%)' }, onClick: stopPropagation },
      h('header', { className: 'ywc-dialog-header' },
        h('h2', null, '添加视频号账号'),
        h('button', { className: 'ywc-close', type: 'button', 'aria-label': '关闭登录弹层', onClick: onClose }, '×'),
      ),
      h('div', { className: 'ywc-dialog-body' },
        h('p', { className: 'ywc-card-meta' }, '系统 Chrome 将打开官方视频号助手，请使用微信扫码并在手机确认。'),
        h('div', { className: 'ywc-qr' }, '官方二维码占位', h('br'), '不截存二维码'),
        h('div', { style: { display: 'flex', justifyContent: 'center' } },
          h('button', { className: 'ywc-button', type: 'button', onClick: onRefreshQr }, '刷新二维码'),
        ),
        h('div', { className: 'ywc-metric-grid', style: { gridTemplateColumns: '1fr 1fr' } },
          h('div', { className: 'ywc-kpi' },
            h('div', { className: 'ywc-kpi-label' }, '状态'),
            h('div', { className: 'ywc-kpi-value' }, login && login.state ? stateText[login.state] || login.state : stateText.idle),
          ),
          h('div', { className: 'ywc-kpi' },
            h('div', { className: 'ywc-kpi-label' }, '登录态'),
            h('div', { className: 'ywc-kpi-value' }, '仅本机'),
          ),
        ),
      ),
      h('p', { className: 'ywc-note' }, '二维码过期后可重新发起扫码；未读出稳定账号 ID 前不保存正式账号。'),
    ),
  )
}

function backdropClose(onClose) {
  return event => { if (event.target === event.currentTarget) onClose() }
}

function stopPropagation(event) { event.stopPropagation() }

// 视频号工作台页面侧（视觉与交互基准：docs/1109/wx/ui-demo.html，§9.0）。
// 页面只访问本地同源路由 /api/desktop/yootun/wx-channels-operation（§4.1）：
// 不读取 MODELS_API_KEY、不直连公网 MCP、不接收 Cookie/内部地址/原始传输错误。
// 采集由宿主设备端执行；这里只做编排（登录/采集/批量）与展示。



const ROUTE = '/api/desktop/yootun/wx-channels-operation'
const WORKS_PAGE_SIZE = 20
const POLL_INTERVAL_MS = 1200
// 页面端全部 action 都是宿主立即返回的快操作（长动作在宿主异步执行、页面轮询）。
const REQUEST_TIMEOUT_MS = 30000

const STYLES = `
:root {
  /* 主视觉继承宿主 DSW 主题变量（§9.0.6；客户端内宿主必提供，独立 Demo 兜底见 ui-demo.html）。 */
  --ywc-bg: var(--dsw-alias-bg-base);
  --ywc-surface: var(--dsw-alias-bg-layer-1);
  --ywc-surface-2: var(--dsw-alias-bg-layer-2);
  --ywc-text: var(--dsw-alias-label-primary);
  --ywc-muted: var(--dsw-alias-label-secondary);
  --ywc-border: var(--dsw-alias-border-l1);
  --ywc-brand: var(--dsw-alias-brand-primary);
  --ywc-brand-soft: color-mix(in srgb, var(--ywc-brand) 10%, transparent);
  --ywc-brand-line: color-mix(in srgb, var(--ywc-brand) 62%, white);
  --ywc-brand-border: color-mix(in srgb, var(--ywc-brand) 28%, transparent);
  --ywc-brand-text: var(--dsw-alias-label-primary-foreground);
  --ywc-danger: var(--dsw-alias-state-error-primary);
  --ywc-success: var(--dsw-alias-state-success-primary);
}
.ywc-root { height:100vh; color:var(--ywc-text); }
.ywc-shell { height:100vh; display:flex; flex-direction:column; overflow:hidden; }
.ywc-header{min-height:72px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:14px 24px; border-bottom:1px solid var(--ywc-border); background: color-mix(in srgb, var(--ywc-surface) 88%, transparent); backdrop-filter: blur(14px); box-shadow: 0 1px 24px color-mix(in srgb, var(--ywc-text) 7%, transparent); }
.ywc-title { display:flex; align-items:center; gap:12px; min-width:0; }
.ywc-mark{width:36px;height:36px; flex:0 0 auto; display:grid; place-items:center; border-radius:8px; background: color-mix(in srgb, var(--ywc-brand) 16%, transparent); color: var(--ywc-brand); font-weight:800; }
.ywc-title h1 { margin:0; font-size:20px; line-height:1.25; }
.ywc-title p { margin:3px 0 0; color:var(--ywc-muted); font-size:12px; }
.ywc-header-actions { display:flex; align-items:center; gap:8px; }
.ywc-tabs { display:flex; gap:4px; padding:0 24px; background: color-mix(in srgb, var(--ywc-surface) 86%, transparent); backdrop-filter: blur(12px); border-bottom:1px solid var(--ywc-border); overflow-x:auto; }
.ywc-tab { height:44px; padding:0 18px; border:0; border-bottom:3px solid transparent; background:transparent; color:var(--ywc-muted); font-weight:650; white-space:nowrap; }
.ywc-tab:hover { color: var(--ywc-text); }
.ywc-tab[aria-selected="true"] { color:var(--ywc-text); border-bottom-color: var(--ywc-brand-line); background: linear-gradient(180deg, transparent 68%, color-mix(in srgb, var(--ywc-brand) 9%, transparent)); }
.ywc-body { flex:1; min-height:0; display:grid; grid-template-columns:280px minmax(0,1fr); gap:16px; padding:16px 24px 24px;  overflow:hidden; }
.ywc-shell[data-tab="account"] .ywc-body { grid-template-columns: minmax(0,1fr); }
.ywc-shell[data-tab="account"] .ywc-accounts { display:none; }
.ywc-accounts { display:flex; flex-direction:column; gap:10px; min-width:0; }
.ywc-panel { border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 92%, transparent); backdrop-filter: blur(12px); box-shadow: 0 10px 34px color-mix(in srgb, var(--ywc-text) 6%, transparent); }
.ywc-side-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 12px 0; }
.ywc-side-head h2 { margin:0; font-size:14px; }
.ywc-account-list { display:flex; flex-direction:column; gap:8px; padding:10px 12px 12px; }
.ywc-card { border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 94%, transparent); text-align:left; padding:0; overflow:hidden; }
.ywc-card[aria-current="true"] { border-color: color-mix(in srgb, var(--ywc-brand) 60%, var(--ywc-border)); }
.ywc-card[aria-current="true"] .ywc-card-main { background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 8%, transparent), transparent 68%); }
.ywc-card-main { width:100%; display:grid; grid-template-columns:36px minmax(0,1fr); gap:10px; align-items:center; border:0; background:transparent; padding:10px; text-align:left; color:inherit; }
.ywc-card-main:hover { background: var(--ywc-surface-2); }
.ywc-avatar { width:36px; height:36px; display:grid; place-items:center; border-radius:50%; background: color-mix(in srgb, var(--ywc-brand) 18%, var(--ywc-surface-2)); color:var(--ywc-brand); font-weight:700; }
.ywc-card-name { display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; }
.ywc-card-meta { display:block; margin-top:2px; color:var(--ywc-muted); font-size:12px; }
.ywc-state { display:inline-flex; align-items:center; gap:5px; margin-top:5px; font-size:12px; color:var(--ywc-muted); }
.ywc-state::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
.ywc-state[data-state="ok"] { color:var(--ywc-success); }
.ywc-state[data-state="expired"] { color:var(--ywc-danger); }
.ywc-card-actions { display:flex; border-top:1px solid var(--ywc-border); background:var(--ywc-surface); }
.ywc-mini-button { flex:1; min-height:30px; border:0; background:transparent; color:var(--ywc-muted); font-size:12px; }
.ywc-mini-button:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
.ywc-mini-button.danger:hover { color:var(--ywc-danger); }
.ywc-button { min-height:34px; display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:0 12px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-text); white-space:nowrap; }
.ywc-button:hover { background:var(--ywc-surface-2); }
.ywc-button.primary { border-color: color-mix(in srgb, var(--ywc-brand) 72%, white); background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 88%, white), var(--ywc-brand)); color: var(--ywc-brand-text); font-weight:650; box-shadow: 0 6px 18px color-mix(in srgb, var(--ywc-brand) 20%, transparent); }
.ywc-button:disabled { opacity:.45; cursor:default; }
.ywc-primary { min-height:40px; padding:0 16px; border:0; border-radius:6px; background:var(--ywc-brand); color:var(--ywc-brand-text); font-weight:600; }
.ywc-primary:disabled { opacity:.45; cursor:default; }
.ywc-wide { width:100%; }
.ywc-batch-panel { display:grid; gap:4px; padding:10px 12px; border:1px solid var(--ywc-border); border-radius:8px; background:var(--ywc-surface-2); min-width:0; }
.ywc-batch-panel p { margin:0; font-size:12px; color:var(--ywc-text); }
.ywc-hint { margin:0; color:var(--ywc-muted); font-size:12px; line-height:1.5; }
.ywc-ok { margin:0; color:var(--ywc-success); font-size:12px; }
.ywc-error { margin:0; color:var(--ywc-danger); font-size:12px; }
.ywc-warn { margin:0; color:var(--ywc-muted); font-size:12px; }
/* 36px 图标按钮基线（契约审计 canonical icon 基线；弹层关闭/头部图标钮复用）。 */
.ywc-icon{width:36px;height:36px; display:grid; place-items:center; padding:0; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-muted); cursor:pointer; }
.ywc-icon:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
.ywc-right { min-width:0; min-height:0; display:flex; flex-direction:column; gap:12px; overflow:hidden; }
.ywc-right .ywc-work-panel { flex:1; min-height:0; display:flex; flex-direction:column; }
.ywc-right .ywc-work-panel .ywc-table-wrap { flex:1; }
.ywc-right .ywc-account-page { flex:1; min-height:0; overflow:auto; }
.ywc-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:12px; }
.ywc-toolbar-left, .ywc-toolbar-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ywc-field { display:inline-flex; align-items:center; gap:6px; color:var(--ywc-muted); font-size:12px; }
.ywc-input, .ywc-select { min-height:32px; padding:0 8px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-text); }
.ywc-summary-grid, .ywc-kpi-grid { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px; padding:12px; }
.ywc-kpi { min-height:78px; padding:10px; border:1px solid var(--ywc-border); border-radius:8px; position:relative; overflow:hidden; background: linear-gradient(160deg, color-mix(in srgb, var(--ywc-brand) 4%, var(--ywc-surface)), var(--ywc-surface) 62%); }
.ywc-kpi::after { content:""; position:absolute; inset:0 0 auto; height:2px; background: linear-gradient(90deg, transparent, var(--ywc-brand-line), transparent); opacity:.55; }
.ywc-kpi-label { color:var(--ywc-muted); font-size:12px; }
.ywc-kpi-value { margin-top:8px; font-size:20px; font-weight:750; font-variant-numeric: tabular-nums; letter-spacing:-.02em; }
.ywc-kpi-hint { margin-top:3px; color:var(--ywc-muted); font-size:11px; }
.ywc-table-wrap { overflow:auto; min-height:0; border-top:1px solid var(--ywc-border); }
.ywc-table-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-top:1px solid var(--ywc-border); color:var(--ywc-muted); font-size:12px; }
.ywc-table { min-width:1720px; width:100%; border-collapse:collapse; }
.ywc-table th, .ywc-table td { padding:10px; border-bottom:1px solid var(--ywc-border); text-align:left; white-space:nowrap; }
.ywc-table th { position:sticky; top:0; z-index:1; background: color-mix(in srgb, var(--ywc-brand) 5%, var(--ywc-surface-2)); color:var(--ywc-muted); font-size:12px; font-weight:650; }
.ywc-table tbody tr:hover { background: color-mix(in srgb, var(--ywc-brand) 6%, transparent); }
.ywc-work-cell { display:grid; grid-template-columns:54px minmax(220px,320px); gap:10px; align-items:center; }
.ywc-cover { position:relative; width:54px; height:72px; display:grid; place-items:center; border-radius:5px; overflow:hidden; background:var(--ywc-surface-2); color:var(--ywc-muted); font-size:11px; text-align:center; }
.ywc-cover span { position:absolute; right:3px; bottom:3px; padding:1px 4px; border-radius:3px; background:rgba(0,0,0,.65); color:#fff; }
.ywc-work-title { min-width:0; max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; }
.ywc-work-sub { margin-top:3px; color:var(--ywc-muted); font-size:11px; }
.ywc-link { border:0; background:transparent; color:var(--ywc-brand); font-weight:650; padding:0; }
.ywc-empty { color:var(--ywc-muted); }
.ywc-account-page { display:flex; flex-direction:column; gap:12px; }
.ywc-section-title { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 12px 0; }
.ywc-section-title h3 { margin:0; font-size:14px; }
.ywc-window-group { display:inline-flex; border:1px solid var(--ywc-border); border-radius:6px; overflow:hidden; }
.ywc-window-group button { min-height:30px; padding:0 10px; border:0; background:var(--ywc-surface); color:var(--ywc-muted); font-size:12px; }
.ywc-window-group button[aria-selected="true"] { background: color-mix(in srgb, var(--ywc-brand) 12%, var(--ywc-surface)); color:var(--ywc-brand); font-weight:700; box-shadow: inset 0 -2px 0 var(--ywc-brand-line); }
.ywc-two-column { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr); gap:12px; }
.ywc-chart-body { padding:12px; }
.ywc-chart-legend { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:8px; color:var(--ywc-muted); font-size:12px; }
.ywc-chart-legend i { display:inline-block; width:10px; height:3px; margin-right:5px; vertical-align:middle; background:var(--ywc-brand); }
.ywc-svg { display:block; width:100%; height:180px; }
.ywc-bars { display:grid; gap:8px; padding:12px; }
.ywc-bar-row { display:grid; grid-template-columns:84px minmax(0,1fr) 62px; gap:8px; align-items:center; font-size:12px; }
.ywc-bar-track { height:8px; border-radius:4px; background:var(--ywc-surface-2); overflow:hidden; }
.ywc-bar-fill { height:100%; border-radius:4px; background: linear-gradient(90deg, color-mix(in srgb, var(--ywc-brand) 62%, transparent), var(--ywc-brand-line)); box-shadow: 0 0 12px color-mix(in srgb, var(--ywc-brand) 18%, transparent); }
.ywc-bar-value { text-align:right; color:var(--ywc-muted); }
.ywc-profile-tabs { display:flex; gap:4px; padding:10px 12px 0; border-bottom:1px solid var(--ywc-border); overflow-x:auto; }
.ywc-profile-tabs button { border:0; border-bottom:2px solid transparent; padding:8px 9px; background:transparent; color:var(--ywc-muted); font-size:12px; white-space:nowrap; }
.ywc-profile-tabs button[aria-selected="true"] { border-bottom-color:var(--ywc-brand-line); color:var(--ywc-brand); font-weight:650; }
.ywc-modal { position:fixed; inset:0; z-index:20; display:none; place-items:center; padding:24px; background:rgba(31,35,41,.42); backdrop-filter:blur(8px); }
.ywc-modal.open { display:grid; }
.ywc-dialog { width:min(1080px,100%); max-height:calc(100vh - 48px); overflow:auto; border:1px solid var(--ywc-border); border-radius:8px; background:var(--ywc-surface); box-shadow:0 24px 72px rgba(0,0,0,.22); }
.ywc-dialog-header { position:sticky; top:0; z-index:2; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--ywc-border); background:var(--ywc-surface); }
.ywc-dialog-header h2, .ywc-dialog-header h3 { margin:0; }
.ywc-dialog-body { display:grid; gap:12px; padding:14px 16px 18px; }
.ywc-dialog-grid { display:grid; grid-template-columns:150px minmax(0,1fr); gap:14px; }
.ywc-detail-cover { width:150px; height:200px; display:grid; place-items:center; border-radius:7px; background:var(--ywc-surface-2); color:var(--ywc-muted); }
.ywc-metric-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
.ywc-detail-section { border-top:1px dashed var(--ywc-border); padding-top:10px; }
.ywc-detail-section h4 { margin:0 0 8px; font-size:13px; }
.ywc-close { width:32px; height:32px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-muted); }
.ywc-qr { width:210px; height:210px; margin:12px auto; display:grid; place-items:center; border:1px dashed var(--ywc-brand); border-radius:8px; color:var(--ywc-muted); text-align:center; }
.ywc-note { padding:0 16px 16px; color:var(--ywc-muted); font-size:12px; line-height:1.7; }
.ywc-badge { display:inline-flex; align-items:center; min-height:22px; padding:0 7px; border-radius:4px; background:var(--ywc-surface-2); color:var(--ywc-muted); font-size:12px; }
@media (max-width:1080px) { .ywc-body { grid-template-columns:1fr; } .ywc-summary-grid, .ywc-kpi-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .ywc-two-column { grid-template-columns:1fr; } .ywc-dialog-grid { grid-template-columns:1fr; } .ywc-detail-cover { width:100%; height:180px; } }
@media (max-width:680px) { .ywc-header, .ywc-body, .ywc-tabs { padding-left:12px; padding-right:12px; } .ywc-summary-grid, .ywc-kpi-grid, .ywc-metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .ywc-title p { display:none; } }
`

function useHost() {
  return useCallback(async (action, payload = {}) => {
    const response = await fetch(ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    if (!response.ok) throw new Error(`http_${response.status}`)
    const payloadJson = await response.json()
    if (payloadJson && payloadJson.status === 'error') {
      throw new Error(String(payloadJson.reason || 'request_failed'))
    }
    return payloadJson
  }, [])
}

/** 渲染工作台。`initial` 供静态渲染/截图/测试注入首屏真实数据
 * （renderToString 不执行 useEffect，宿主运行时不传 initial 走正常加载）。 */
function renderWxWorkbench({ host, initial }) {
  return h(WxWorkbench, { host, initial })
}

function WxWorkbench({ host, initial = null }) {
  const post = host || useHost()
  const [browserReady, setBrowserReady] = useState({ chrome: true, driver: true })
  const [accounts, setAccounts] = useState((initial && initial.accounts) || [])
  const [selectedId, setSelectedId] = useState(
    (initial && initial.selectedId) ||
      ((initial && initial.accounts || []).find(item => item.deleteState !== 'remote_deleted') || {}).accountId ||
      null,
  )
  const [tab, setTab] = useState((initial && initial.tab) || 'work')
  const [works, setWorks] = useState((initial && initial.works) || [])
  const [overview, setOverview] = useState((initial && initial.overview) || null)
  // 摘要卡独立快照：固定 last_7d（§9.2 摘要卡口径不随账号 Tab 窗口切换变化）。
  const [summaryOverview, setSummaryOverview] = useState(
    initial && initial.summaryOverview !== undefined ? initial.summaryOverview : initial ? initial.overview : null,
  )
  const [profile, setProfile] = useState((initial && initial.profile) || null)
  const [profileKey, setProfileKey] = useState((initial && initial.profileKey) || 'gender')
  const [windowKey, setWindowKey] = useState((initial && initial.windowKey) || 'last_7d')
  const [range, setRange] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [sort, setSort] = useState('publish_time')
  const [order] = useState('desc')
  const [displayCount, setDisplayCount] = useState(WORKS_PAGE_SIZE)
  const [detail, setDetail] = useState((initial && initial.detail) || null)
  const [detailDaily, setDetailDaily] = useState((initial && initial.detailDaily) || [])
  const [login, setLogin] = useState(null)
  const [batch, setBatch] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [collectBusy, setCollectBusy] = useState(false)
  const loginRef = useRef(null)

  const selected = useMemo(
    () => accounts.find(account => account.accountId === selectedId) || null,
    [accounts, selectedId],
  )
  const visibleWorks = useMemo(() => sortWorks(works, sort, order), [works, sort, order])

  const noticeTimer = useRef(null)
  const notify = useCallback(message => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  const refreshAccounts = useCallback(async () => {
    const result = await post('accounts.list')
    const rows = Array.isArray(result.accounts) ? result.accounts : []
    setAccounts(rows)
    setSelectedId(current => {
      if (current && rows.some(item => item.accountId === current)) return current
      const firstUsable = rows.find(item => item.deleteState !== 'remote_deleted')
      return firstUsable ? firstUsable.accountId : null
    })
    return rows
  }, [post])

  const refreshWorks = useCallback(async (accountId, rangeOverride = null, from = null, to = null) => {
    if (!accountId) { setWorks([]); return }
    const activeRange = rangeOverride || range
    const extra = activeRange === 'custom' && from && to
      ? { publishedFrom: from, publishedTo: to }
      : {}
    try {
      const result = await post('works.list', { accountId, ...extra })
      setWorks(Array.isArray(result.works) ? result.works : [])
    } catch (error) {
      setWorks([])
      notify(`作品列表加载失败：${error.message}`)
    }
  }, [post, notify, range])

  const refreshOverview = useCallback(async (accountId, window) => {
    if (!accountId) { setOverview(null); setSummaryOverview(null); setProfile(null); return }
    // 摘要卡固定 last_7d 拉取（与账号 Tab 窗口互不影响，review P0-3）。
    try {
      const summary = await post('account.overview', { accountId, window: 'last_7d' })
      setSummaryOverview(summary)
    } catch {
      setSummaryOverview(null)
    }
    if (window === 'last_7d') {
      setOverview(summary)
    } else {
      try {
        const result = await post('account.overview', { accountId, window })
        setOverview(result)
      } catch {
        setOverview(null)
      }
    }
    try {
      const profileResult = await post('fans.profile.get', { accountId })
      setProfile(profileResult.fans_profile)
    } catch {
      setProfile(null)
    }
  }, [post])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await post('browser.status')
        if (!cancelled) setBrowserReady({ chrome: status.chromeAvailable, driver: status.driverAvailable })
      } catch { /* 浏览器自检失败不阻断首屏 */ }
      if (!cancelled) await refreshAccounts()
    })()
    return () => { cancelled = true }
  }, [post, refreshAccounts])

  // 切换账号 / 排序窗口变化 → 刷新作品与账号数据（排序筛选只查库，不触发采集）。
  useEffect(() => {
    if (selectedId) {
      void refreshWorks(selectedId)
      void refreshOverview(selectedId, windowKey)
    } else {
      setWorks([])
      setOverview(null)
      setSummaryOverview(null)
      setProfile(null)
    }
    setDisplayCount(WORKS_PAGE_SIZE)
  }, [selectedId, windowKey, refreshWorks, refreshOverview])

  // 批量进度轮询。
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const status = await post('collectAll.status')
        if (status && status.phase && status.phase !== 'ready') setBatch(status)
      } catch { /* 轮询失败静默保留旧状态 */ }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [post])

  const beginLogin = useCallback(() => {
    void (async () => {
      const result = await post('account.beginLogin', {})
      loginRef.current = result.loginKey
      setLogin({ loginKey: result.loginKey, state: result.state })
      pollLogin(result.loginKey)
    })().catch(error => notify(`登录发起失败：${error.message}`))
  }, [post, notify])

  const loginTimerRef = useRef(null)
  const stopLoginPolling = useCallback(() => {
    if (loginTimerRef.current) clearInterval(loginTimerRef.current)
    loginTimerRef.current = null
  }, [])
  const collectTimerRef = useRef(null)
  const stopCollectPolling = useCallback(() => {
    if (collectTimerRef.current) clearInterval(collectTimerRef.current)
    collectTimerRef.current = null
  }, [])
  // 插件卸载时清空全部轮询（review P1-4）。
  useEffect(() => () => {
    stopLoginPolling()
    stopCollectPolling()
  }, [stopLoginPolling, stopCollectPolling])
  const pollLogin = useCallback(loginKey => {
    stopLoginPolling()
    loginTimerRef.current = setInterval(async () => {
      try {
        const status = await post('account.loginStatus', { accountId: loginKey })
        if (status.state === 'ok') {
          stopLoginPolling()
          setLogin({ loginKey, state: 'ok' })
          await refreshAccounts()
          setTimeout(() => setLogin(null), 1200)
        } else if (status.state === 'idle') {
          stopLoginPolling()
          setLogin(null)
        } else {
          setLogin({ loginKey, state: status.state, reason: status.reason })
        }
      } catch { /* 轮询失败下轮重试 */ }
    }, POLL_INTERVAL_MS)
  }, [post, refreshAccounts, stopLoginPolling])

  const refreshQr = useCallback(() => {
    const loginKey = loginRef.current
    if (!loginKey) return
    void post('account.refreshLoginQr', { accountId: loginKey })
      .then(status => setLogin({ loginKey, state: status.state }))
      .catch(error => notify(`刷新失败：${error.message}`))
  }, [post, notify])

  const probeAccount = useCallback(accountId => {
    void (async () => {
      const result = await post('account.probe', { accountId })
      notify(result.sessionStatus === 'ok' ? '会话有效' : result.sessionStatus === 'expired' ? '会话已过期，请重新扫码' : '会话状态未知')
      await refreshAccounts()
    })().catch(error => notify(`检测失败：${error.message}`))
  }, [post, notify, refreshAccounts])

  const removeAccount = useCallback(accountId => {
    // 删除流程（§16.2）：应用内二次确认 → 先本地清理 → 再远端删除 → 刷新列表。
    setConfirm({
      title: '删除账号',
      message: '删除该账号将清理本机登录态并删除远端业务数据（保留审计账本），确定？',
      onConfirm: () => {
        void (async () => {
          const local = await post('account.removeLocal', { accountId })
          if (!local.cleared || !(local.cleared.profile && local.cleared.storageState)) {
            throw new Error('LOCAL_CLEARED_REQUIRED')
          }
          await post('account.removeRemote', { accountId })
          notify('账号已删除（远端保留审计墓碑）')
          await refreshAccounts()
        })().catch(error => notify(`删除失败：${error.message}`))
      },
    })
  }, [post, notify, refreshAccounts])

  const confirmRemoval = accountId => {
    // 保留原实现体为内部函数（被 confirm 弹层 onConfirm 引用）。
  }



  const collectAccount = useCallback(accountId => {
    void (async () => {
      const result = await post('collect.start', { accountId, newAttempt: true })
      if (!result.started) {
        notify(`采集未启动：${reasonText(result.reason)}`)
        return
      }
      setCollectBusy(true)
      notify('采集已启动，完成后刷新查看数据')
      // 单账号采集无独立进度端点：轮询 collect.status 直到空闲（ref 持表，卸载清理）。
      collectTimerRef.current = setInterval(async () => {
        try {
          const status = await post('collect.status')
          if (!status.busy) {
            stopCollectPolling()
            setCollectBusy(false)
            await refreshWorks(accountId)
            await refreshOverview(accountId, windowKey)
            await refreshAccounts()
            notify('采集结束')
          }
        } catch { /* 轮询失败下轮重试 */ }
      }, POLL_INTERVAL_MS)
    })().catch(error => {
      stopCollectPolling()
      setCollectBusy(false)
      notify(`采集失败：${error.message}`)
    })
  }, [post, notify, refreshWorks, refreshOverview, refreshAccounts, windowKey, stopCollectPolling])

  const collectAll = useCallback(() => {
    void (async () => {
      const result = await post('collectAll.start', {})
      if (!result.started) {
        notify(`批量采集未启动：${reasonText(result.reason)}`)
        return
      }
      notify(`批量采集已启动（${result.accounts} 个账号，串行执行）`)
    })().catch(error => notify(`批量采集失败：${error.message}`))
  }, [post, notify])

  // 弹层可关闭性（契约审计）：任一弹层打开时监听 Escape 关闭；关闭后用
  // requestAnimationFrame 恢复触发元素焦点。
  const lastTriggerRef = useRef(null)
  const overlayOpen = Boolean(detail || confirm || login)
  useEffect(() => {
    if (!overlayOpen) return
    if (typeof document !== 'undefined') lastTriggerRef.current = document.activeElement
    const onKey = event => {
      if (event.key === 'Escape') {
        if (detail) {
          setDetail(null)
          setDetailDaily([])
        } else if (confirm) {
          setConfirm(null)
        } else if (login) {
          stopLoginPolling()
          loginRef.current = null
          setLogin(null)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const lastTrigger = lastTriggerRef.current
      requestAnimationFrame(() => lastTrigger?.focus())
    }
  }, [overlayOpen, detail, confirm, login, stopLoginPolling])

  // 批量结束后刷新当前账号数据。
  useEffect(() => {
    if (batch && batch.phase === 'finished' && selectedId) {
      void refreshWorks(selectedId)
      void refreshOverview(selectedId, windowKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch && batch.phase])

  const openDetail = useCallback(work => {
    setDetail(work)
    setDetailDaily([])
    void (async () => {
      try {
        const result = await post('work.get', { accountId: work.account_id || selectedId, workId: work.work_id })
        setDetail(result.work || work)
        setDetailDaily(Array.isArray(result.daily_metrics) ? result.daily_metrics : [])
      } catch { /* 详情查询失败保留行内数据展示 */ }
    })()
  }, [post, selectedId])

  const browserBlocked = !browserReady.chrome || !browserReady.driver

  return h('div', { className: 'ywc-root' },
    h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
    h('div', { className: 'ywc-shell', 'data-tab': tab },
      h('header', { className: 'ywc-header' },
        h('div', { className: 'ywc-title' },
          h('div', { className: 'ywc-mark', 'aria-hidden': 'true' }, '视'),
          h('div', null,
            h('h1', null, '视频号工作台'),
            h('p', null, '扫码登录视频号助手，采集账号全部作品、账号数据与关注者数据'),
          ),
        ),
        h('div', { className: 'ywc-header-actions' }),
      ),
      notice ? h('div', { className: 'ywc-badge', role: 'status', 'aria-live': 'polite', style: { margin: '10px 24px 0' } }, notice) : null,
      h('nav', { className: 'ywc-tabs', 'aria-label': '工作台模块' },
        h('button', { className: 'ywc-tab', type: 'button', 'aria-selected': tab === 'work' ? 'true' : 'false', onClick: () => setTab('work') }, '作品数据'),
        h('button', { className: 'ywc-tab', type: 'button', 'aria-selected': tab === 'account' ? 'true' : 'false', onClick: () => setTab('account') }, '账号数据'),
      ),
      h('div', { className: 'ywc-body' },
        h('aside', { className: 'ywc-accounts', 'aria-label': '账号管理' },
          h(AccountList, {
            accounts, selectedId, busy: collectBusy,
            browserBlocked,
            batch,
            onSelect: accountId => { setSelectedId(accountId); setDisplayCount(WORKS_PAGE_SIZE) },
            onProbe: probeAccount,
            onRemove: removeAccount,
            onBeginLogin: beginLogin,
            onCollectAll: collectAll,
          }),
          browserBlocked
            ? h('p', { className: 'ywc-empty', style: { padding: '0 2px' } },
              `需要系统 Google Chrome${browserReady.chrome ? ' 与 Playwright 驱动' : ''}（当前缺失），采集功能不可用`)
            : null,
        ),
        h('main', { className: 'ywc-right' },
          tab === 'work'
            ? h('section', { className: 'ywc-panel' },
              h(WorkToolbar, {
                onCollect: () => selectedId && collectAccount(selectedId),
                onRefresh: () => selectedId && (refreshWorks(selectedId), refreshOverview(selectedId, windowKey)),
                range, onRange: value => {
                  setRange(value)
                  setDisplayCount(WORKS_PAGE_SIZE)
                  // 自定义范围由服务端 publishedFrom/To 过滤（§7.3）；切换非 custom 即重查全量。
                  if (value !== 'custom' && selectedId) void refreshWorks(selectedId, value)
                },
                customFrom, customTo,
                onCustomRange: (from, to) => {
                  setCustomFrom(from)
                  setCustomTo(to)
                  setDisplayCount(WORKS_PAGE_SIZE)
                  if (from && to && selectedId) void refreshWorks(selectedId, 'custom', from, to)
                },
                sort, onSort: value => { setSort(value); setDisplayCount(WORKS_PAGE_SIZE) },
                disabled: !selectedId || collectBusy,
              }),
              h(WorkSummaryCards, { works, summaryOverview, account: selected }),
              h(WorkTable, {
                rows: range === "custom" ? visibleWorks : filterWorksByRange(visibleWorks, range),
                displayCount,
                total: (range === "custom" ? visibleWorks : filterWorksByRange(visibleWorks, range)).length,
                onLoadMore: () => setDisplayCount(count => count + WORKS_PAGE_SIZE),
                onOpenDetail: openDetail,
              }),
            )
            : h(AccountTab, {
              window: windowKey, onWindow: setWindowKey,
              overview, profile, profileKey, onProfileKey: setProfileKey,
              accounts, selectedId,
              onSelectAccount: accountId => { setSelectedId(accountId); setDisplayCount(WORKS_PAGE_SIZE) },
            }),
        ),
      ),
    ),
    h(WorkDetailDialog, {
      work: detail, detail: detail ? {
        traffic_source: detail.traffic_source,
        retention_trend: detail.retention_trend,
      } : null,
      dailyMetrics: detailDaily,
      onClose: () => { setDetail(null); setDetailDaily([]) },
    }),
    confirm ? h('div', { className: 'ywc-modal open', role: 'dialog', 'aria-modal': 'true', onClick: event => { if (event.target === event.currentTarget) setConfirm(null) } },
      h('div', { className: 'ywc-dialog', style: { width: 'min(430px,100%)' } },
        h('header', { className: 'ywc-dialog-header' },
          h('h2', null, confirm.title),
          h('button', { className: 'ywc-close', type: 'button', 'aria-label': '关闭确认弹层', onClick: () => setConfirm(null) }, '×'),
        ),
        h('div', { className: 'ywc-dialog-body' },
          h('p', { className: 'ywc-card-meta' }, confirm.message),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h('button', { className: 'ywc-button', type: 'button', onClick: () => setConfirm(null) }, '取消'),
            h('button', {
              className: 'ywc-button primary', type: 'button',
              onClick: () => { setConfirm(null); confirm.onConfirm() },
            }, '确认删除'),
          ),
        ),
      ),
    ) : null,
    login ? h(LoginDialog, { login, onRefreshQr: refreshQr, onClose: () => {
      stopLoginPolling()
      loginRef.current = null
      setLogin(null)
    } }) : null,
  )
}

function reasonText(reason) {
  const map = {
    session_required: '会话失效',
    probe_failed: '探测失败',
    storage_state_missing: '缺登录态',
    pending_account: '待升级账号',
    collect_busy: '采集互斥',
    session_expired: '会话失效',
  }
  return map[reason] || reason || '未知'
}
module.exports = { renderWxWorkbench }
})
