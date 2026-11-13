// 账号总览 Tab（Tab 显示名 2026-11-13 由「账号数据」更名）/ 账号区 / 登录弹层
// （视觉基准：docs/1109/wx/ui-demo.html，§9.1/§9.4）。

import { createElement as h } from 'react'
import { TrendChart, recentDays } from './work-ui.js'
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

// 窗口常量导出供 client.js 清理总览缓存键使用（键 `${accountId}:${window}`）。
export const WINDOWS = [['yesterday', '昨日'], ['last_7d', '近7天'], ['last_30d', '近30天']]

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
  // 未完成明细必须包含 partial（部分作品缺失）——否则汇总显示「成功 N、失败 0」，
  // 部分失败账号却不出现在明细里（审查 P2-15）。
  const unfinished = running || !batch
    ? []
    : (batch.items || []).filter(
      item => item.status === 'failed' || item.status === 'skipped' || item.status === 'partial',
    )
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
              `成功 ${batch.completedCount || 0} · 部分完成 ${batch.partialCount || 0} · `
              + `失败 ${batch.failedCount || 0} · 跳过 ${batch.skippedCount || 0}`),
          ]
          : [
            h('p', {
              className: batch.summary.status === 'completed' ? 'ywc-ok' : batch.summary.status === 'failed' ? 'ywc-error' : 'ywc-warn',
              key: 'sum',
            },
              `批量结束：成功 ${batch.summary.completed}、部分完成 ${batch.summary.partial || 0}、`
              + `失败 ${batch.summary.failed}、跳过 ${batch.summary.skipped}`),
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
              // 登录进行中禁用（否则会在已有浏览器窗口上再开一个，并抢走轮询）；
              // 墓碑账号（云端已删）不允许重新登录，避免把已删除账号又拉回来。
              className: 'ywc-mini-button', type: 'button',
              disabled: busy || running || loginActive || browserBlocked
                || account.deleteState === 'remote_deleted',
              // 会话有效 → 只探活；会话已过期 → 直接打开浏览器重新扫码（2026-11-11
              // 真机反馈：原先两种状态都绑 onProbe，点「重新扫码」没有任何反应）。
              // 重新扫码不传账号 ID：登录用全新临时 Profile，避免扫码得到另一个视频号
              // 身份时把本账号的 Profile 目录迁移走（同一微信多视频号场景）。
              onClick: () => (sessionActionFor(account) === 'probe'
                ? onProbe(account.accountId)
                : onBeginLogin()),
            }, sessionActionFor(account) === 'probe' ? '检测会话' : '重新扫码'),
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

/** 账号总览 Tab（§9.4 三段：全部视频指标 / 关注者增长 / 关注者画像）。
 * 全宽独占布局：页内自带账号选择器（对齐抖音总览的账号下拉：有账号即显示，
 * 不因单账号隐藏），切换后三段数据随之刷新。
 * 关注者画像（2026-11-11 真机反馈）：去掉维度 Tab 切换，改为 KPI 卡片组同屏展示——
 * 性别/访问设备=环形图（中心总人数）+图例，年龄分布=柱状图带百分比标签，
 * 省份/城市=横向条形两列卡片（对齐官方后台截图布局）。 */
export function AccountTab({
  window: windowKey, onWindow, overview, profile,
  trendOverview = null,
  accounts, selectedId, onSelectAccount,
  loading = false,
}) {
  const availability = (overview && overview.availability) || {}
  const usable = (Array.isArray(accounts) ? accounts : []).filter(item => item.deleteState !== 'remote_deleted')
  // 加载蒙板（2026-11-13 真机反馈）：切账号 / 切窗口期间账号选择器保留（不打断操作），
  // 三段数据区整体替换为「正在加载数据…」，样式与作品数据页加载态一致（ywc-table-state）。
  const sections = loading
    ? h('div', { className: 'ywc-table-state', role: 'status', 'aria-busy': 'true' },
      h('span', { className: 'ywc-spinner', 'aria-hidden': true }),
      h('p', null, '正在加载数据…'),
    )
    : [
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
          h(TrendChart, {
            // 固定 7 天口径：优先用 last_7d 概览（「昨日」窗口只有 2 天数据）。
            rows: fansTrendRows(trendOverview || overview),
            series: FANS_SERIES,
            ariaLabel: '关注者总数趋势（近 7 天）',
          }),
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
    ]
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
    sections,
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
 * 环形图调色板参考官方风格（男蓝/女粉）；「未知」统一灰色；设备编码按官方后台
 * 口径映射（1=iOS、2=安卓，见 ui-format 的 device 映射）。占比一律 count/sum
 * 计算，总数 0 显示「—」。 */
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
  // 省份/城市为长尾分布（2026-11-11 真机反馈）：按人数从大到小排序后只取前 5，
  // 避免几十条列表把页面撑成滚动地狱；性别/年龄/设备是定长维度，不走这里。
  const rows = normalizeProfileRows(profile ? profile[dimension] : null, dimension)
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, 5)
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

/**
 * 关注者总数趋势（2026-11-11 真机反馈，对齐官方后台）：x 轴固定最近 7 个自然日，
 * 带 y 轴刻度，鼠标移动显示浮层。
 */
export function fansTrendRows(overview) {
  const daily = overview && overview.fans_trend && Array.isArray(overview.fans_trend.daily)
    ? overview.fans_trend.daily
    : []
  const byDay = new Map()
  for (const row of daily) {
    if (row && row.day) byDay.set(String(row.day), row)
  }
  return recentDays(7).map(day => ({ day, follower_total_count: (byDay.get(day) || {}).follower_total_count ?? null }))
}

const FANS_SERIES = [{ key: 'follower_total_count', label: '关注者总数', color: 'var(--ywc-brand)' }]

/**
 * 账号卡片主按钮的行为判定（2026-11-11 真机反馈「会话过期点重新扫码没反应」）：
 * 会话有效 → `probe`（只探活）；过期/未知 → `relogin`（打开浏览器重新扫码登录）。
 * 抽成纯函数便于回归测试，避免再次退化成两种状态都只探活。
 */
export function sessionActionFor(account) {
  return account && account.sessionStatus === 'ok' ? 'probe' : 'relogin'
}

/** 登录交互（对齐抖音）：点击「添加账号」由宿主直接打开系统 Chrome 进入官方
 * 视频号助手扫码，不再渲染二维码占位弹层；进行中状态由左栏按钮文案承载。 */
export function LoginStatusButton({ loginActive, browserBlocked, onBeginLogin }) {
  return h('button', {
    className: 'ywc-primary ywc-wide', type: 'button',
    // 不能直接绑 onBeginLogin：React 会把事件对象当第一个实参传进去，
    // 而 beginLogin(accountId) 会把事件当账号 ID 发给宿主。
    disabled: browserBlocked || loginActive, onClick: () => onBeginLogin(),
  }, loginActive ? '浏览器已打开，请在窗口中扫码…' : '添加账号')
}
