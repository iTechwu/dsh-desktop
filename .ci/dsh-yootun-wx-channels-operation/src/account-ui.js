// 账号数据 Tab / 账号区 / 登录弹层（视觉基准：docs/1109/wx/ui-demo.html，§9.1/§9.4）。

import { createElement as h } from 'react'
import {
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
 * 账号卡列表 → 底部「添加账号」宽主按钮（登录进行中显示扫码提示并禁用）。 */
export function AccountList({
  accounts, selectedId, onSelect, onProbe, onRemove, onBeginLogin,
  batch, onCollectAll, busy, browserBlocked, loginActive,
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
    h(LoginStatusButton, { loginActive, browserBlocked, onBeginLogin }),
  )
}

/** 账号数据 Tab（§9.4 三段：全部视频指标 / 关注者增长 / 关注者画像）。
 * 全宽独占布局：页内自带账号选择器（对齐抖音总览的账号下拉：有账号即显示，
 * 不因单账号隐藏），切换后三段数据随之刷新。 */
export function AccountTab({
  window: windowKey, onWindow, overview, profile, profileKey, onProfileKey,
  accounts, selectedId, onSelectAccount,
}) {
  const availability = (overview && overview.availability) || {}
  const usable = (Array.isArray(accounts) ? accounts : []).filter(item => item.deleteState !== 'remote_deleted')
  return h('div', { className: 'ywc-account-page' },
    usable.length > 0
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
      stroke: 'var(--ywc-brand)', 'strokeWidth': 3, fill: 'none',
    }))
  }
  for (const point of points) {
    paths.push(h('circle', {
      key: `c${point.x}-${point.y}`, cx: point.x, cy: point.y, r: 4,
      fill: 'var(--ywc-surface)', stroke: 'var(--ywc-brand)', 'strokeWidth': 2,
    }, h('title', null, String(point.value))))
  }
  return paths
}

/** 登录交互（对齐抖音）：点击「添加账号」由宿主直接打开系统 Chrome 进入官方
 * 视频号助手扫码，不再渲染二维码占位弹层；进行中状态由左栏按钮文案承载。 */
export function LoginStatusButton({ loginActive, browserBlocked, onBeginLogin }) {
  return h('button', {
    className: 'ywc-primary ywc-wide', type: 'button',
    disabled: browserBlocked || loginActive, onClick: onBeginLogin,
  }, loginActive ? '浏览器已打开，请在窗口中扫码…' : '添加账号')
}
