// 趋势折线共享模块（1015 UI 规格 §5.4：从 analysis-ui 抽取，账号分析页与作品
// 详情弹框复用同一绘制；行为不变——抽取非新造，render-smoke 回归兜底）。
//
// 职责：trendLayout（30 天固定窗口 + 自然日横轴 + min/max ±10% 纵轴 + gap 断线）
// 与 TrendChart SVG 组件。React 由内联作用域提供（构建脚本剥离 require，与
// analysis-ui 同法）。

function react() {
  // 运行时（构建内联后）require 可用（Node 模块缓存使重复 require 廉价）；
  // 测试直接 import 本模块（ESM）时经 globalThis.__YDO_REACT 取当前桩。
  // 不做模块级缓存：缓存的 stub 会跨测试泄漏（ui.test 每例传自己的 reactStub）。
  if (typeof require === 'function') return require('react')
  return globalThis.__YDO_REACT
}

// 元素创建走独立标识符：内联进 client.js 工厂作用域时，`h` 已被 client.js 的
// React 解构占用，重名会 SyntaxError（构建产物字面量被 render-smoke 锁定）。
function eh(...args) {
  return react().createElement(...args)
}

const TREND_WINDOW_DAYS = 30
// 数据点与绘图区左右边缘的安全边距：起止日点半径 4px，不加边距会半个点被裁掉。
export const TREND_PAD_X = 6
// 注意联动：SVG viewBox 高与 `.ydo-an-trend-svg{height:168px}` 必须一致（字面值锁定）。
export const TREND_VIEW_HEIGHT = 168
export const TREND_PAD_TOP = 16
export const TREND_PAD_BOTTOM = 30

function localIsoDay(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDaysIso(iso, days) {
  const base = new Date(`${iso}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return localIsoDay(new Date(base.getTime() + base.getTimezoneOffset() * 60000))
}

export function trendLayout(points, { width = 600, now = null, windowDays = TREND_WINDOW_DAYS, dropOutsideDays = false } = {}) {
  const empty = { renderable: false, single: false, nodes: [], segments: [], axisLabels: [] }
  const days = (Array.isArray(points) ? points : [])
    .filter(point => point && typeof point.day === 'string' && Number.isFinite(Number(point.value)))
    .map(point => ({ ...point, value: Number(point.value) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  if (!days.length) return empty

  // 固定窗口（本地自然日；服务端对越界日期已 clamp，这里再做防御收敛）。
  // 默认 30 天（账号/分析页）；详情弹框传 windowDays=7 与创作者中心后台一致（1026 方案）。
  const windowDaysInt = Number.isInteger(windowDays) && windowDays >= 1 ? windowDays : TREND_WINDOW_DAYS
  const todayIso = localIsoDay(now ? new Date(now) : new Date())
  const fromDay = addDaysIso(todayIso, -(windowDaysInt - 1))
  const fromMs = Date.parse(`${fromDay}T00:00:00Z`)
  const spanMs = (windowDaysInt - 1) * 86400000
  // dropOutsideDays：窗口外的历史日直接丢弃，不 clamp 到窗口边缘——快照可能
  // 早于窗口（作品此前已被采过多天），clamp 会让它们全叠在起点成一列点
  // （真机 2026-10-16 截图）；弹框 7 天与账号分析页 30 天两处调用均已传 true，
  // 默认 false 仅供测试直调与未来新调用方保持 clamp 原语义。
  const clampDayMs = day => {
    const ms = Date.parse(`${day}T00:00:00Z`)
    if (Number.isNaN(ms)) return null
    if (dropOutsideDays && (ms < fromMs || ms > fromMs + spanMs)) return null
    return Math.min(fromMs + spanMs, Math.max(fromMs, ms))
  }

  const nodes = []
  for (const point of days) {
    const clamped = clampDayMs(point.day)
    if (clamped === null) continue
    const prev = nodes[nodes.length - 1]
    const gapDaysBefore = prev
      ? Math.max(0, Math.round((clamped - prev._ms) / 86400000) - 1)
      : 0
    nodes.push({
      day: point.day,
      value: point.value,
      elapsedSeconds: point.elapsedSeconds,
      counterRevised: point.counterRevised === true,
      gapDaysBefore,
      // 缺口起点（前一点）x：gapDaysBefore>0 时必有 prev，标签定位直接用它，
      // 不再按窗口宽估算每格像素（gap 标签 7 天弹框偏位修复 2026-10-17）。
      gapStartX: prev ? prev.x : null,
      x: Math.round((TREND_PAD_X + ((clamped - fromMs) / spanMs) * (width - TREND_PAD_X * 2)) * 100) / 100,
      yPct: 0,
      _ms: clamped,
    })
  }
  if (!nodes.length) return empty

  // 纵轴：窗口内有效值 min/max 上下各 10% 边距；同值固定居中；yPct 保留小数。
  // yPct = 值的归一化位置百分比（值越大 yPct 越大）；SVG y 轴向下的翻转只在渲染层做。
  const values = nodes.map(node => node.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const sameValue = rawMin === rawMax
  let yMin = rawMin
  let yMax = rawMax
  if (!sameValue) {
    const pad = (rawMax - rawMin) * 0.1
    yMin = rawMin - pad
    yMax = rawMax + pad
  }
  for (const node of nodes) {
    node.yPct = sameValue
      ? 50
      : Math.round(((node.value - yMin) / (yMax - yMin)) * 10000) / 100
  }

  // 分段：相邻采集日间隔 >1 天为缺口（虚线），否则实线；缺口两端数据点保留。
  const segments = []
  for (let index = 1; index < nodes.length; index += 1) {
    const prev = nodes[index - 1]
    const node = nodes[index]
    segments.push({
      x1: prev.x, y1: prev.yPct,
      x2: node.x, y2: node.yPct,
      dashed: node.gapDaysBefore > 0,
      gapDaysBefore: node.gapDaysBefore,
      prevX: prev.x, prevDay: prev.day,
    })
  }

  // 横轴刻度位随窗口推导（5 等分取整，offset = floor(i*(n-1)/4)）：n=30 时恰为
  // 0/7/14/21/29（与旧固定常量逐位一致，30 天页无行为变化），n=7 时为 0/1/3/4/6。
  // 分母同用窗口跨度——写死 30 天常量会让 7 天弹框的刻度日溢出窗口、x 错位。
  const axisSpan = Math.max(1, windowDaysInt - 1)
  const axisLabels = [0, 1, 2, 3, 4].map((quarter, index) => {
    const offset = Math.floor((quarter * axisSpan) / 4)
    return {
      day: addDaysIso(fromDay, offset),
      x: Math.round((TREND_PAD_X + (offset / axisSpan) * (width - TREND_PAD_X * 2)) * 100) / 100,
      pos: index === 0 ? 'start' : index === 4 ? 'end' : 'middle',
      minor: index % 2 === 1,
    }
  })

  return {
    renderable: true,
    single: nodes.length === 1,
    width,
    nodes,
    segments,
    axisLabels,
    yMax: rawMax,
    yMin: rawMin,
    sameValue,
    fromDay,
    toDay: todayIso,
  }
}

/**
 * y 轴标签专用格式化：≥1万固定保留 1 位小数万单位（165.3万），<1万千分位；
 * 不走 formatWan 的「≥100万取整」口径（±10% 边距下 min/max 会同显「165万」）。
 * 由宿主模块注入 axisValueText（analysis-ui 与弹框各自持有同一实现）。
 */
// 容器实测宽度（需求 5b，2026-09-18）：趋势 SVG 的 viewBox 用真实面板宽度，
// 消除「固定宽被 width:100% 拉伸导致轴文字/点线过大或左右留白」的根因；
// ResizeObserver 跟随面板尺寸变化，忽略塌缩态（隐藏/折叠 0 宽）。沙箱/无
// ResizeObserver 环境降级为默认宽。hook 必须在组件任何早退 return 之前调用。
export function useMeasuredWidth(fallbackWidth = 600) {
  const { useState, useEffect } = react()
  const [node, setNode] = useState(null)
  const [width, setWidth] = useState(fallbackWidth)
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(entries => {
      const entry = entries && entries[0]
      const nextWidth = entry && entry.contentRect ? Math.round(entry.contentRect.width) : 0
      // 忽略塌缩态（隐藏/折叠时的 0 宽）与同值，避免无效重渲。
      if (nextWidth >= 200 && nextWidth !== width) setWidth(nextWidth)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, width])
  return [setNode, width]
}

export function TrendChart({ layout, t, axisValueText, fallbackText }) {
  const { width, nodes, segments, axisLabels, yMax, yMin } = layout
  const plotHeight = TREND_VIEW_HEIGHT - TREND_PAD_TOP - TREND_PAD_BOTTOM
  const yOf = node => TREND_PAD_TOP + ((100 - node.yPct) / 100) * plotHeight
  const areaPoints = nodes.map(node => `${node.x},${yOf(node)}`).join(' ') +
    ` ${nodes[nodes.length - 1].x},${TREND_PAD_TOP + plotHeight} ${nodes[0].x},${TREND_PAD_TOP + plotHeight}`
  const gridYs = [TREND_PAD_TOP, TREND_PAD_TOP + plotHeight / 2, TREND_PAD_TOP + plotHeight]
  const axisFallback = value => {
    const formatted = fallbackText(value)
    return formatted === null || formatted === undefined ? '—' : (formatted.length > 12 ? `${formatted.slice(0, 12)}…` : formatted)
  }
  let yMaxText = axisValueText(yMax) || axisFallback(yMax)
  let yMinText = axisValueText(yMin) || axisFallback(yMin)
  if (yMaxText === yMinText) {
    yMaxText = Math.round(Number(yMax)).toLocaleString('en-US')
    yMinText = Math.round(Number(yMin)).toLocaleString('en-US')
  }

  return eh('svg', {
    className: 'ydo-an-trend-svg',
    viewBox: `0 0 ${width} ${TREND_VIEW_HEIGHT}`,
    role: 'img',
    'aria-label': t('trendTitle'),
  },
  ...gridYs.map((gy, index) => eh('line', {
    key: `grid-${index}`,
    x1: 0, y1: gy, x2: width, y2: gy,
    className: 'ydo-an-grid-line',
  })),
  eh('text', { x: 2, y: TREND_PAD_TOP + 8, className: 'ydo-an-axis-text' }, yMaxText),
  eh('text', { x: 2, y: TREND_PAD_TOP + plotHeight - 2, className: 'ydo-an-axis-text' }, yMinText),

  nodes.length > 1 ? eh('polygon', {
    points: areaPoints,
    className: 'ydo-an-trend-area',
  }) : null,

  ...segments.map((segment, index) => eh('line', {
    key: `seg-${index}`,
    x1: segment.x1, y1: TREND_PAD_TOP + ((100 - segment.y1) / 100) * plotHeight,
    x2: segment.x2, y2: TREND_PAD_TOP + ((100 - segment.y2) / 100) * plotHeight,
    className: segment.dashed ? 'ydo-an-seg ydo-an-seg-dashed' : 'ydo-an-seg',
  })),

  ...nodes.map((node, index) => eh('circle', {
    key: `dot-${node.day}-${index}`,
    cx: node.x, cy: yOf(node), r: 4,
    className: 'ydo-an-dot-circle',
  }, eh('title', null,
    `${node.day} ${axisValueText(node.value) || '—'}` +
    (node.gapDaysBefore > 0 ? ` · ${t('noCollectGap')} ${node.gapDaysBefore}d` : '')))),

  ...nodes.filter(node => node.gapDaysBefore > 0).map((node, index) => eh('text', {
    key: `gap-${index}`,
    // x = 缺口起点（前一点）真实坐标 + 12px：旧公式按 width/29 估算每格宽，
    // 只对 30 天窗口成立，7 天弹框下标签偏位；真实前一点坐标适配任意窗口。
    x: Math.max(24, Math.min(width - 24, node.gapStartX + 12)),
    y: TREND_PAD_TOP + plotHeight + 12,
    className: 'ydo-an-gap-text',
  }, `${t('noCollectGap')} ${node.gapDaysBefore}d`)),

  ...nodes.filter(node => node.counterRevised).map((node, index) => eh('text', {
    key: `revised-${index}`,
    x: Math.min(width - 30, node.x + 6),
    y: Math.max(10, yOf(node) - 9),
    className: 'ydo-an-revised-text',
  }, t('counterRevised'))),

  ...axisLabels.map(label => eh('text', {
    key: `axis-${label.day}`,
    x: label.x, y: TREND_VIEW_HEIGHT - 8,
    className: `ydo-an-axis-label ydo-an-axis-${label.pos}${label.minor ? ' ydo-an-axis-minor' : ''}`,
  }, label.day.slice(5).replace('-', '/'))))
}
