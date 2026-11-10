// 账号数据 Tab / 账号区 / 登录弹层（视觉基准：docs/1109/wx/ui-demo.html，§9.1/§9.4）。

import { createElement as h } from 'react'
import {
  EMPTY,
  fmtCount,
  fmtDateTime,
  normalizeProfileRows,
  summarizeAccountMetrics,
  summarizeFansTrend,
} from './ui-format.js'

const PROFILE_TABS = [
  ['gender', '性别'],
  ['device', '访问设备'],
  ['age', '年龄分布'],
  ['province', '省份分布'],
  ['city', '城市分布'],
]

const WINDOWS = [['yesterday', '昨日'], ['last_7d', '近7天'], ['last_30d', '近30天']]

/** 左侧账号卡（§9.2 账号卡片：头像/昵称/登录态/最近同步 + 检测/重扫/删除）。 */
export function AccountList({ accounts, selectedId, onSelect, onProbe, onRemove, busy }) {
  return h('div', { className: 'ywc-account-list' },
    accounts.length === 0
      ? h('p', { className: 'ywc-empty', style: { padding: '0 2px 6px' } }, '还没有账号，点击「添加账号」扫码登录')
      : accounts.map(account => h('article', {
        className: 'ywc-card', key: account.accountId,
        'aria-current': account.accountId === selectedId ? 'true' : 'false',
      },
        h('button', { className: 'ywc-card-main', type: 'button', onClick: () => onSelect(account.accountId) },
          h('span', { className: 'ywc-avatar' }, avatarText(account)),
          h('span', null,
            h('span', { className: 'ywc-card-name' }, account.nickname || account.accountId),
            h('span', { className: 'ywc-card-meta' }, `关注者 ${fmtCount(account.follower_total_count)} · 最近同步 ${fmtDateTime(account.lastCollectedAt || account.sessionCheckedAt)}`),
            stateLine(account),
          ),
        ),
        h('div', { className: 'ywc-card-actions' },
          h('button', {
            className: 'ywc-mini-button', type: 'button', disabled: busy,
            onClick: () => onProbe(account.accountId),
          }, account.sessionStatus === 'ok' ? '检测会话' : '重新扫码'),
          h('button', {
            className: 'ywc-mini-button danger', type: 'button', disabled: busy,
            onClick: () => onRemove(account.accountId),
          }, '删除账号'),
        ),
      )),
  )
}

function avatarText(account) {
  const name = account.nickname || account.accountId || '视'
  return name.slice(0, 2)
}

function stateLine(account) {
  const map = { ok: '登录有效', expired: '登录已过期', unknown: '状态未知' }
  const label = account.deleteState === 'remote_deleted' ? '已删除（墓碑）' : map[account.sessionStatus] || map.unknown
  return h('span', { className: 'ywc-state', 'data-state': account.sessionStatus }, label)
}

/** 账号数据 Tab（§9.4 三段：全部视频指标 / 关注者增长 / 关注者画像）。 */
export function AccountTab({ window: windowKey, onWindow, overview, profile, profileKey, onProfileKey }) {
  const availability = (overview && overview.availability) || {}
  return h('div', { className: 'ywc-account-page' },
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
  const rows = normalizeProfileRows(dimension)
  if (!rows.length) return h('p', { className: 'ywc-empty', style: { padding: '0 12px 12px' } }, '该画像维度本次未提供')
  const max = Math.max(1, ...rows.map(([, value]) => value))
  return rows.map(([name, value]) => h('div', { className: 'ywc-bar-row', key: name },
    h('span', null, name),
    h('div', { className: 'ywc-bar-track' }, h('div', { className: 'ywc-bar-fill', style: { width: `${Math.round(value / max * 100)}%` } })),
    h('span', { className: 'ywc-bar-value' }, `${value} 人`),
  ))
}

/** 关注者总数折线（Demo 同款 SVG 折线）。 */
export function fansChartSeries(overview) {
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
export function LoginDialog({ login, onRefreshQr, onClose }) {
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

/** 批量采集进度（§8.5：当前账号 / 总进度 / 未完成明细）。 */
export function BatchPanel({ batch, onCollectAll, busy }) {
  const status = batch || { phase: 'ready' }
  const items = Array.isArray(status.items) ? status.items : []
  const done = items.filter(item => item.status === 'completed' || item.status === 'failed' || item.status === 'skipped').length
  const total = items.length
  const summary = status.summary
  const stateLabel = status.phase === 'ready' ? 'Idle' : status.phase === 'finished' ? labelOf(summary && summary.status) : 'Running'
  return h('section', { className: 'ywc-panel' },
    h('div', { className: 'ywc-side-head' },
      h('h2', null, '采集状态'),
      h('button', { className: 'ywc-button primary', type: 'button', disabled: busy, onClick: onCollectAll }, '采集全部'),
      h('span', { className: 'ywc-badge' }, stateLabel),
    ),
    h('div', { className: 'ywc-bars' },
      bar('当前账号', total ? `${Math.min(done + 1, total)}/${total}` : '—', total ? Math.round(((done + (status.phase === 'finished' ? 0 : 1)) / total) * 100) : 0),
      bar('总体进度', total ? `${done}/${total}` : '0/0', total ? Math.round((done / total) * 100) : 0),
    ),
    summary && (summary.failed > 0 || summary.skipped > 0)
      ? h('div', { style: { padding: '0 12px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' } },
        items.filter(item => item.status !== 'completed' || item.reason === 'partial').map(item => h('span', { className: 'ywc-badge', key: item.accountId },
          item.reason === 'partial'
            ? `${shortId(item.accountId)} · 部分成功（run partial）`
            : `${shortId(item.accountId)} · ${item.status === 'skipped' ? `跳过（${reasonText(item.reason)}）` : `失败（${reasonText(item.reason)}）`}`,
        )),
      )
      : null,
  )
}

function bar(label, valueText, percent) {
  return h('div', { className: 'ywc-bar-row', key: label },
    h('span', null, label),
    h('div', { className: 'ywc-bar-track' }, h('div', { className: 'ywc-bar-fill', style: { width: `${Math.min(100, Math.max(0, percent))}%` } })),
    h('span', { className: 'ywc-bar-value' }, valueText),
  )
}

function labelOf(status) {
  return status === 'completed' ? 'Completed' : status === 'partial' ? 'Partial' : status === 'failed' ? 'Failed' : 'Idle'
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

function shortId(accountId) {
  const name = String(accountId || '')
  return name.length > 10 ? `${name.slice(0, 8)}…` : name
}

function backdropClose(onClose) {
  return event => { if (event.target === event.currentTarget) onClose() }
}

function stopPropagation(event) { event.stopPropagation() }
