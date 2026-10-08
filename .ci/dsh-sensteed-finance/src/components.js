// 片段 3/7：基础组件库（对齐前端视觉语言：去阴影卡片、outline 徽章、状态 pill、
// KPI 卡、行 hover 表格、pill 页签、分页器、居中 Dialog、Progress、统计卡）

function Glyph({ name, size = 16, className }) {
  const icons = {
    check: IconCheckOutlineRegular, warning: IconWarningOutlineRegular, close: IconCloseOutlineRegular,
    refresh: IconRefreshOutlineRegular, data: IconDataOutlineRegular, sparkle: IconSparkleRegular,
    goal: IconGoalOutlineRegular, clock: IconAlarmClockOutlineRegular, database: IconDatabaseOutlineRegular,
    loading: IconLoadingOutlineRegular, plan: IconPlanOutlineRegular, up: IconChevronUpOutlineRegular,
    down: IconChevronDownOutlineRegular, left: IconChevronLeftOutlineRegular, right: IconChevronRightOutlineRegular,
    plus: IconPlusOutlineRegular, trendUp: IconRightUpOutlineRegular, search: IconSearchOutlineRegular,
    send: IconSendOutlineRegular, shield: IconShieldOutlineRegular, trash: IconTrashOutlineRegular, user: IconUserOutlineRegular,
  }
  const Icon = icons[name]
  return Icon ? h(Icon, { size, className }) : null
}

/** 卡片：去阴影直角，标题行 border-b，金额卡注明单位 */
function Card({ title, unit, actions, children, className }) {
  return h('section', { className: `sf-card${className ? ` ${className}` : ''}` },
    title || actions ? h('div', { className: 'sf-card-head' },
      h('h2', null, title),
      unit ? h('span', { className: 'sf-card-unit' }, unit) : null,
      actions ? h('div', { className: 'sf-card-actions' }, actions) : null) : null,
    h('div', { className: 'sf-card-body' }, children))
}

/** KPI 卡：小标签 + 大数字 + 右上图标块 + 说明/涨跌行；onClick 时整卡可下钻 */
function KpiCard({ icon, label, value, hint, hintTone, onClick, negative }) {
  const clickable = typeof onClick === 'function'
  return h('article', {
    className: `sf-kpi${clickable ? ' is-clickable' : ''}${negative ? ' is-neg' : ''}`,
    onClick: clickable ? onClick : undefined,
    role: clickable ? 'link' : undefined, tabIndex: clickable ? 0 : undefined,
    onKeyDown: clickable ? event => { if (event.key === 'Enter') onClick() } : undefined,
  },
    h('div', { className: 'sf-kpi-top' }, h('span', { className: 'sf-kpi-label' }, label), h('span', { className: 'sf-kpi-icon' }, h(Glyph, { name: icon, size: 14 }))),
    h('strong', { className: 'sf-kpi-value' }, value ?? '—'),
    hint ? h('small', { className: `sf-kpi-hint${hintTone ? ` sf-hint-${hintTone}` : ''}` }, hint) : null)
}

/** outline 徽章：rose/amber/green/blue/sky/muted 语义色 */
function Badge({ tone = 'muted', children }) {
  return h('span', { className: `sf-badge sf-badge-${tone}` }, children)
}

/** 实心浅底 pill（状态列，对齐前端 bg-*-100/text-*-700 套路） */
function Pill({ tone = 'muted', children }) {
  return h('span', { className: `sf-pill sf-pill-${tone}` }, children)
}

function SeverityBadge({ severity, t }) {
  const key = SEVERITY_KEYS[severity] ?? 'sevInfo'
  return h(Pill, { tone: SEVERITY_TONES[severity] ?? 'sky' }, t(key))
}

/** 进度条（达成率/执行率）；ratio 0-1，tone: green/amber/rose */
function Progress({ value, tone }) {
  const parsed = finite(value)
  const clamped = parsed === null ? 0 : Math.max(0, Math.min(1, parsed))
  return h('div', { className: 'sf-progress' }, h('div', { className: `sf-progress-fill${tone ? ` is-${tone}` : ''}`, style: { width: `${clamped * 100}%` } }))
}

/**
 * 表格：数字列右对齐 + tabular-nums；行 border-b + hover；可选 sticky 首列、行点击。
 * columns: { label, key?, render?(row), num?, stickyLeft?, width? }
 */
function Table({ columns, rows, empty, onRowClick, rowKey, minColumns }) {
  if (!rows?.length) return h('div', { className: 'sf-empty' }, empty)
  return h('div', { className: 'sf-table-scroll' }, h('table', { className: 'sf-table', style: minColumns ? { minWidth: minColumns } : undefined },
    h('thead', null, h('tr', null, ...columns.map((col, index) => h('th', {
      key: index, className: `${col.num ? 'sf-num' : ''}${col.stickyLeft ? ' sf-sticky-col' : ''}`,
      style: col.width ? { width: col.width } : undefined,
    }, col.label)))),
    h('tbody', null, ...rows.map((row, rowIndex) => h('tr', {
      key: rowKey ? row[rowKey] ?? rowIndex : rowIndex,
      className: onRowClick ? 'is-clickable' : '',
      onClick: onRowClick ? () => onRowClick(row) : undefined,
    }, ...columns.map((col, colIndex) => h('td', {
      key: colIndex,
      className: `${col.num ? 'sf-num' : ''}${col.stickyLeft ? ' sf-sticky-col' : ''}`,
    }, col.render ? col.render(row, rowIndex) : row[col.key] ?? '—')))))))
}

/** 分页器：上一页/下一页 + 第 x 页（对齐前端 finance-pager） */
function Pager({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil((total ?? 0) / (limit ?? PAGE_SIZE)))
  if (pages <= 1) return null
  return h('div', { className: 'sf-pager' },
    h('button', { type: 'button', disabled: page <= 1, onClick: () => onPage(page - 1) }, h(Glyph, { name: 'left', size: 12 })),
    h('span', null, `${page} / ${pages}`),
    h('button', { type: 'button', disabled: page >= pages, onClick: () => onPage(page + 1) }, h(Glyph, { name: 'right', size: 12 })))
}

/** pill 页签条（预算子视图/审批状态筛选；role=tablist 语义） */
function PillTabs({ tabs, value, onChange, t }) {
  return h('div', { className: 'sf-pilltabs', role: 'tablist' }, ...tabs.map(([id, labelKey]) =>
    h('button', { type: 'button', key: id, role: 'tab', 'aria-selected': value === id, className: value === id ? 'is-active' : '', onClick: () => onChange(id) }, t(labelKey))))
}

function FormRow({ label, children, wide }) {
  return h('label', { className: `sf-form-row${wide ? ' is-wide' : ''}` }, h('span', null, label), children)
}

function Field(props) {
  const { value, onChange, ...rest } = props
  return h('input', { ...rest, value: value ?? '', onChange: event => onChange(event.target.value) })
}

function Textarea(props) {
  const { value, onChange, ...rest } = props
  return h('textarea', { ...rest, value: value ?? '', onChange: event => onChange(event.target.value) })
}

function Select({ value, onChange, options, placeholder, disabled }) {
  return h('select', { value: value ?? '', onChange: event => onChange(event.target.value), disabled },
    placeholder ? h('option', { value: '' }, placeholder) : null,
    ...options.map(([id, label]) => h('option', { key: id, value: id }, label)))
}

function Switch({ checked, onChange, label }) {
  return h('button', { type: 'button', className: `sf-switch${checked ? ' is-on' : ''}`, role: 'switch', 'aria-checked': checked, 'aria-label': label, onClick: () => onChange(!checked) },
    h('span', { className: 'sf-switch-knob' }))
}

/** 居中 Dialog：遮罩 + Escape 关闭 + 焦点移入；宽档 sm/md/lg */
function Dialog({ title, width = 'md', onClose, children, footer }) {
  useEffect(() => {
    const key = event => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const panelRef = useRef(null)
  useEffect(() => { requestAnimationFrame(() => panelRef.current?.focus?.()) }, [])
  return h('div', { className: 'sf-dialog-mask', onMouseDown: event => { if (event.target === event.currentTarget) onClose?.() } },
    h('div', { className: `sf-dialog sf-dialog-${width}`, role: 'dialog', 'aria-modal': true, 'aria-label': title, ref: panelRef, tabIndex: -1 },
      h('header', { className: 'sf-dialog-head' }, h('h3', null, title),
        h('button', { type: 'button', className: 'sf-icon-btn', 'aria-label': 'close', onClick: onClose }, h(Glyph, { name: 'close', size: 14 }))),
      h('div', { className: 'sf-dialog-body' }, children),
      footer ? h('footer', { className: 'sf-dialog-foot' }, footer) : null))
}

/** 通知行 */
function Notice({ children, tone }) {
  return children ? h('p', { className: `sf-notice${tone ? ` sf-notice-${tone}` : ''}` }, children) : null
}

/** 主按钮 */
function PrimaryButton({ children, busy, ...rest }) {
  return h('button', { type: 'button', className: 'sf-btn sf-btn-primary', disabled: busy, ...rest }, children)
}
function GhostButton({ children, ...rest }) {
  return h('button', { type: 'button', className: 'sf-btn sf-btn-ghost', ...rest }, children)
}
function LinkButton({ children, ...rest }) {
  return h('button', { type: 'button', className: 'sf-link', ...rest }, children)
}

function LimitNote({ rows, limit, t }) {
  return rows?.length >= limit ? h('p', { className: 'sf-note' }, t('showFirst').replace('{n}', String(limit))) : null
}

function EmptyState({ children }) {
  return h('div', { className: 'sf-empty' }, children)
}

/**
 * 多系列分组柱图（纯 SVG）。
 * series: [{ key, label, tone('a'|'b'|'c') }]; data: [{ label, [seriesKey]: number|null }]
 * onBarClick(point) 可选：点柱下钻。
 */
function GroupedBars({ data, series, onBarClick }) {
  const points = (data || []).filter(Boolean)
  const hasAny = points.some(point => series.some(s => finite(point[s.key]) !== null))
  if (!points.length || !hasAny) return h('div', { className: 'sf-empty' }, '—')
  const width = 760, height = 210, left = 52, right = 12, top = 14, bottom = 28
  const max = Math.max(...points.flatMap(point => series.map(s => Math.abs(finite(point[s.key]) ?? 0))), 1)
  const plotBottom = height - bottom
  const band = (width - left - right) / points.length
  const barWidth = Math.max(4, Math.min(16, band / (series.length + 1)))
  const y = value => top + (plotBottom - top) * (1 - value / max)
  const labelEvery = Math.max(1, Math.ceil(points.length / 12))
  return h('div', { className: 'sf-chart-wrap' },
    h('div', { className: 'sf-chart-legend' }, ...series.map(s => h('span', { key: s.key }, h('i', { className: `sf-legend sf-legend-${s.tone}` }), s.label))),
    h('svg', { className: 'sf-chart', viewBox: `0 0 ${width} ${height}`, role: 'img' },
      ...[0, 0.5, 1].map((step, index) => h('line', { key: index, x1: left, x2: width - right, y1: y(max * step), y2: y(max * step), className: 'sf-grid-line' })),
      ...points.map((point, index) => {
        const center = left + band * index + band / 2
        const groupWidth = barWidth * series.length + 2 * (series.length - 1)
        const clickable = typeof onBarClick === 'function'
        return h('g', {
          key: point.label, className: clickable ? 'sf-bar-group is-clickable' : 'sf-bar-group',
          onClick: clickable ? () => onBarClick(point) : undefined,
        },
          ...series.map((s, sIndex) => {
            const value = finite(point[s.key])
            if (value === null) return null
            const x = center - groupWidth / 2 + sIndex * (barWidth + 2)
            return h('rect', { key: s.key, x, y: y(value), width: barWidth, height: Math.max(0, plotBottom - y(value)), className: `sf-bar sf-bar-${s.tone}` })
          }),
          index % labelEvery === 0 || index === points.length - 1 ? h('text', { x: center, y: height - 8, className: 'sf-chart-label', textAnchor: 'middle' }, point.label) : null)
      })))
}

/** 差异瀑布（预算 → 已打PR → 未打PR → 实际付款 → 差额），纯 CSS 柱 */
function Waterfall({ steps }) {
  const valid = steps.filter(step => finite(step.value) !== null)
  if (!valid.length) return h('div', { className: 'sf-empty' }, '—')
  const max = Math.max(...valid.map(step => Math.abs(finite(step.value))), 1)
  return h('div', { className: 'sf-waterfall' }, ...valid.map((step, index) => {
    const value = finite(step.value)
    const heightPct = Math.max(4, (Math.abs(value) / max) * 100)
    return h('div', { key: index, className: 'sf-waterfall-item' },
      h('div', { className: 'sf-waterfall-bar-area' },
        h('div', { className: `sf-waterfall-bar${step.tone ? ` is-${step.tone}` : ''}`, style: { height: `${heightPct}%` } })),
      h('span', { className: 'sf-waterfall-label' }, step.label),
      h('span', { className: 'sf-waterfall-value' }, wan(value)))
  }))
}

/** 占比条堆叠（费用构成）：segments [{label, value, tone}] */
function StackedShare({ segments }) {
  const total = segments.reduce((acc, s) => acc + (finite(s.value) ?? 0), 0)
  if (!total) return h('div', { className: 'sf-empty' }, '—')
  return h('div', { className: 'sf-share' },
    h('div', { className: 'sf-share-track' }, ...segments.map((s, index) => {
      const value = finite(s.value) ?? 0
      if (value <= 0) return null
      return h('div', { key: index, className: `sf-share-seg is-${s.tone || 'a'}`, style: { width: `${(value / total) * 100}%` } })
    })),
    h('div', { className: 'sf-share-legend' }, ...segments.map((s, index) =>
      h('span', { key: index }, h('i', { className: `sf-legend sf-legend-${s.tone || 'a'}` }), `${s.label} ${Math.round(((finite(s.value) ?? 0) / total) * 100)}%`))))
}

/** 正负对称条形（收支净额）：data [{label, value}]，零轴居中 */
function NetBars({ data }) {
  const points = (data || []).filter(point => finite(point.value) !== null)
  if (!points.length) return h('div', { className: 'sf-empty' }, '—')
  const max = Math.max(...points.map(point => Math.abs(finite(point.value))), 1)
  return h('div', { className: 'sf-netbars' }, ...points.map((point, index) => {
    const value = finite(point.value)
    const pct = (Math.abs(value) / max) * 50
    return h('div', { key: index, className: 'sf-netbar-row' },
      h('span', { className: 'sf-netbar-label' }, point.label),
      h('div', { className: 'sf-netbar-track' },
        h('div', { className: 'sf-netbar-half is-left' }, value < 0 ? h('div', { className: 'sf-netbar-bar is-rose', style: { width: `${pct}%` } }) : null),
        h('div', { className: 'sf-netbar-zero' }),
        h('div', { className: 'sf-netbar-half is-right' }, value >= 0 ? h('div', { className: 'sf-netbar-bar is-green', style: { width: `${pct}%` } }) : null)),
      h('span', { className: `sf-netbar-value${value < 0 ? ' sf-neg' : ' sf-pos'}` }, wan(value)))
  }))
}

/** 可点击统计卡（预警中心 4 卡）：激活时 ring 高亮 */
function StatCard({ label, value, tone, active, onClick }) {
  const clickable = typeof onClick === 'function'
  return h('button', {
    type: 'button', className: `sf-stat sf-stat-${tone}${active ? ' is-active' : ''}${clickable ? ' is-clickable' : ''}`,
    onClick: clickable ? onClick : undefined,
  }, h('strong', null, value ?? 0), h('span', null, label))
}
