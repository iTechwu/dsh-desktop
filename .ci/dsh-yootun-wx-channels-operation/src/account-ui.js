// 账号数据 Tab / 账号区 / 登录弹层（视觉基准：docs/1109/wx/ui-demo.html，§9.1/§9.4）。

import { createElement as h } from 'react'
import {
  batchProgressText,
  batchReasonText,
  fmtCount,
  fmtDateTime,
  normalizeProfileRows,
  progressText,
  summarizeAccountMetrics,
  summarizeFansTrend,
} from './ui-format.js'

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
 * 标题行「账号管理 + 采集全部」→ 批量进度面板（仅批量运行/有结果时渲染；布局契约
 * 对齐抖音 BatchPanel：面板挂在标题行下方、账号列表上方，侧栏 grid 流内自然占一行，
 * 不进右侧工具栏）→ 账号卡列表 → 底部「添加账号」宽主按钮（登录进行中显示扫码提示并禁用）。
 * 运行中：spinner + 总进度（检查会话 / 第 i/n 个账号）+ 当前账号名 · 细粒度进度
 * （batch.currentProgress，宿主随 collectAll.status 投影，无需第二路轮询）+ 实时计数；
 * 终态：三态汇总（部分失败绝不伪装成整体成功）+ 失败/跳过账号逐行稳定原因。 */
export function AccountList({
  accounts, selectedId, onSelect, onProbe, onRemove, onBeginLogin,
  batch, onCollectAll, busy, browserBlocked, loginActive,
}) {
  const collectable = accounts.some(item => item.deleteState !== 'remote_deleted' && item.sessionStatus === 'ok')
  const running = Boolean(batch && batch.phase && batch.phase !== 'finished')
  const nameOf = accountId => {
    const account = (accounts || []).find(item => item.accountId === accountId)
    return (account && account.nickname) || accountId || ''
  }
  const unfinished = running || !batch
    ? []
    : (batch.items || []).filter(item => item.status === 'failed' || item.status === 'skipped')
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
    batch && (running || batch.summary)
      ? h('div', {
        className: 'ywc-batch-panel',
        role: running ? 'status' : undefined,
        'aria-live': running ? 'polite' : undefined,
        'aria-busy': running || undefined,
      },
        running
          ? [
            h('div', { className: 'ywc-progress', key: 'prog' },
              h('span', { className: 'ywc-spinner', 'aria-hidden': true }),
              h('span', null, batchProgressText(batch) || '正在采集…'),
            ),
            batch.currentAccountId
              ? h('p', { className: 'ywc-hint', key: 'cur' },
                `当前账号 ${nameOf(batch.currentAccountId)}`,
                batch.currentProgress ? ` · ${progressText(batch.currentProgress)}` : '',
              )
              : null,
            h('p', { className: 'ywc-hint', key: 'cnt' },
              `成功 ${batch.completedCount || 0} · 失败 ${batch.failedCount || 0} · 跳过 ${batch.skippedCount || 0}`),
          ]
          : [
            h('p', {
              className: batch.summary.status === 'completed' ? 'ywc-ok' : batch.summary.status === 'failed' ? 'ywc-error' : 'ywc-warn',
              key: 'sum',
            },
              `批量结束：成功 ${batch.summary.completed}、失败 ${batch.summary.failed}、跳过 ${batch.summary.skipped}`),
            unfinished.length
              ? h('div', { className: 'ywc-batch-detail', key: 'detail' },
                ...unfinished.map(item => h('p', { key: item.accountId, className: 'ywc-batch-item' },
                  h('span', { className: 'ywc-batch-item-name' }, nameOf(item.accountId)),
                  h('span', { className: 'ywc-batch-item-reason' }, batchReasonText(item.reason)),
                )),
              )
              : null,
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
 * 不因单账号隐藏），切换后三段数据随之刷新。
 * 关注者画像（2026-11-11 真机反馈）：去掉维度 Tab 切换，改为 KPI 卡片组同屏展示——
 * 性别/访问设备=环形图（中心总人数）+图例，年龄分布=柱状图带百分比标签，
 * 省份/城市=横向条形两列卡片（对齐官方后台截图布局）。 */
export function AccountTab({
  window: windowKey, onWindow, overview, profile,
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
      h('div', { className: 'ywc-profile-grid' },
        profileDonutCard('性别分布', profile, 'gender'),
        profileDonutCard('访问设备分布', profile, 'device'),
        profileAgeCard(profile),
      ),
      h('div', { className: 'ywc-profile-grid ywc-profile-grid-2' },
        profileBarsCard('省份分布', profile, 'province'),
        profileBarsCard('城市分布', profile, 'city'),
      ),
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

/** 画像卡片组（2026-11-11 真机反馈，对齐官方后台）：
 * 环形图调色板参考官方风格（男蓝/女粉）；「未知」统一灰色；设备编码语义官方
 * 未暴露（不臆造），显示「设备 1/2」。占比一律 count/sum 计算，总数 0 显示「—」。 */
const DONUT_PALETTE = ['#4ea6ff', '#f47fb0', '#8b5cf6', '#f08a3c', '#2f9e44', '#d9a400', '#e0524a']
const DONUT_UNKNOWN_COLOR = '#c0c6cf'

function donutColor(name, index) {
  return name === '未知' ? DONUT_UNKNOWN_COLOR : DONUT_PALETTE[index % DONUT_PALETTE.length]
}

function profileDonutCard(title, profile, dimension) {
  const rows = normalizeProfileRows(profile ? profile[dimension] : null, dimension)
  const total = rows.reduce((sum, [, value]) => sum + value, 0)
  let acc = 0
  const stops = rows.map(([name, value], index) => {
    const start = total > 0 ? (acc / total) * 100 : 0
    acc += value
    const end = total > 0 ? (acc / total) * 100 : 0
    return `${donutColor(name, index)} ${start.toFixed(2)}% ${end.toFixed(2)}%`
  })
  const background = total > 0 && stops.length
    ? `conic-gradient(${stops.join(',')})`
    : `conic-gradient(${DONUT_UNKNOWN_COLOR} 0% 100%)`
  return h('div', { className: 'ywc-profile-card' },
    h('div', { className: 'ywc-profile-card-title' }, title),
    rows.length
      ? h('div', { className: 'ywc-donut-row' },
        h('div', {
          className: 'ywc-donut', style: { background },
          role: 'img', 'aria-label': `${title}：共 ${fmtCount(total)} 人`,
        },
          h('span', { className: 'ywc-donut-hole' },
            h('b', null, fmtCount(total)),
            h('i', null, '总人数'),
          )),
        h('ul', { className: 'ywc-donut-legend' },
          rows.map(([name, value], index) => h('li', { key: name },
            h('span', { className: 'ywc-donut-dot', style: { background: donutColor(name, index) }, 'aria-hidden': true }),
            `${name} ${fmtCount(value)}人${total > 0 ? ` · ${Math.round(value / total * 100)}%` : ''}`,
          ))))
      : h('p', { className: 'ywc-empty', style: { padding: '0 4px 4px' } }, '该画像维度本次未提供'),
  )
}

function profileAgeCard(profile) {
  const rows = normalizeProfileRows(profile ? profile.age : null, 'age')
  const total = rows.reduce((sum, [, value]) => sum + value, 0)
  const max = Math.max(1, ...rows.map(([, value]) => value))
  return h('div', { className: 'ywc-profile-card' },
    h('div', { className: 'ywc-profile-card-title' }, '年龄分布'),
    rows.length
      ? h('div', { className: 'ywc-col-chart', role: 'img', 'aria-label': `年龄分布：共 ${fmtCount(total)} 人` },
        rows.map(([name, value]) => h('div', { className: 'ywc-col', key: name },
          h('span', { className: 'ywc-col-value' }, total > 0 ? `${Math.round(value / total * 100)}%` : '—'),
          h('div', {
            className: 'ywc-col-bar',
            style: { height: `${Math.max(4, Math.round(value / max * 100))}%` },
            title: `${name} ${fmtCount(value)}人`,
          }),
          h('span', { className: 'ywc-col-label' }, name),
        )))
      : h('p', { className: 'ywc-empty', style: { padding: '0 4px 4px' } }, '该画像维度本次未提供'),
  )
}

function profileBarsCard(title, profile, dimension) {
  const rows = normalizeProfileRows(profile ? profile[dimension] : null, dimension)
  const max = Math.max(1, ...rows.map(([, value]) => value))
  return h('div', { className: 'ywc-profile-card' },
    h('div', { className: 'ywc-profile-card-title' }, title),
    rows.length
      ? h('div', { className: 'ywc-bars', style: { padding: '0 4px 4px' } }, rows.map(([name, value]) =>
        h('div', { className: 'ywc-bar-row', key: name },
          h('span', null, name),
          h('div', { className: 'ywc-bar-track' }, h('div', { className: 'ywc-bar-fill', style: { width: `${Math.round(value / max * 100)}%` } })),
          h('span', { className: 'ywc-bar-value' }, fmtCount(value)),
        )))
      : h('p', { className: 'ywc-empty', style: { padding: '0 4px 4px' } }, '该画像维度本次未提供'),
  )
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
