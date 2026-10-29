// AI 报表页 UI 模块（RQ-2026-006 §5：列表/详情/日报/周报模板 + 共享组件）。
//
// 职责边界（D8）：只做展示与本地格式化——`result_json.data` 是服务端确定性产物、
// `ai` 是校验后的模型结论，本模块不计算任何口径；NULL/未采集一律渲染「—」，
// 绝不冒充 0。技术元数据（model/promptVersion/schemaVersion/inputHash/attemptCount）
// 不渲染（§5.4）。构建脚本把本模块内联进 lib/client.js（与 overview-ui 同法）：
// 顶部 CommonJS require（DSH 运行时提供），ui-format 纯函数经 import 引入并由
// 构建脚本剥离（内联后同作用域）。
//
// 周期展示口径（§5.4）：存储为开区间 period_end，标题/文件名统一 `end − 1` 天
// 闭区间显示；爆款为报表独立口径（播放 ≥ 服务端阈值），脚注声明与总览 Tab
// hot-v1-potential 相对口径的差异。

const React = require('react')
const { createElement: h } = React

// ---------------------------------------------------------------------------
// 错误码 → 中文文案（§5.8：15 个码与 tools 白名单一一对应，无 undefined 文案）
// ---------------------------------------------------------------------------

export const REPORT_ERROR_REASON_COPY = {
  REPORT_NOT_FOUND: '报表不存在或已被清理',
  REPORT_DISABLED: 'AI 报表功能当前未启用',
  REPORT_INSUFFICIENT_DATA: '数据不足：该周期核心指标缺失或无数据，请先完成采集后重新生成',
  REPORT_MODEL_FAILED: 'AI 生成失败，请稍后重试；已保留当前版本',
  REPORT_SCHEMA_INVALID: 'AI 输出校验失败，已自动重试仍失败，请稍后再试',
  REPORT_TIMEOUT: 'AI 生成超时，请稍后重试',
  REPORT_TRUNCATED: 'AI 输出被截断，已停止重试避免重复计费',
  REPORT_INPUT_TOO_LARGE: '报表输入数据量过大，请联系管理员调整范围',
  REPORT_PAYLOAD_TOO_LARGE: '报表数据超出传输上限',
  REPORT_ENQUEUE_FAILED: '任务投递失败，将由系统自动重投',
  REPORT_MODEL_CONFIG_MISSING: '服务端模型配置缺失',
  REPORT_LEASE_EXPIRED: '生成任务超时回收，请重试',
  REPORT_PROMPT_INVALID: '服务端报表提示词缺失，请联系管理员',
  IDEMPOTENCY_CONFLICT: '重复提交参数不一致，请刷新后重试',
  INVALID_IDEMPOTENCY_KEY: '请求标识格式不正确，请刷新后重试',
  INVALID_CURSOR: '列表参数已过期，请刷新',
  VALIDATION_ERROR: '请求参数非法，请刷新重试',
}

export function reportErrorCopy(reason) {
  return REPORT_ERROR_REASON_COPY[reason] || '请求失败，请稍后重试'
}

// 状态 pill（TF-10：ok/warn/err/运行中）；失败行 note 用中文文案，不出现原始英文码。
export function reportStatusPill(status, coreAvailable) {
  if (status === 'succeeded')
    return coreAvailable === false
      ? { kind: 'warn', label: '数据不全' }
      : { kind: 'ok', label: '已生成' }
  if (status === 'failed') return { kind: 'err', label: '生成失败' }
  if (status === 'insufficient') return { kind: 'warn', label: '数据不足' }
  if (status === 'pending' || status === 'running') return { kind: 'busy', label: '生成中' }
  return { kind: 'muted', label: status || '—' }
}

// 缺采原因映射（§5.4 QualityBar）。
const MISSING_REASON_COPY = {
  session_expired: '会话过期',
  not_collected: '未采集',
  no_data: '无数据',
}

// ---------------------------------------------------------------------------
// 展示层格式化（NULL → —；绝不格式化成 0）
// ---------------------------------------------------------------------------

export function reportCountText(value) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  if (Math.abs(num) >= 10000) {
    const wan = num / 10000
    const digits = Math.abs(wan) >= 100 ? 0 : 1
    return `${wan.toFixed(digits)}万`
  }
  return num.toLocaleString('en-US')
}

function reportPctText(value) {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : '—'
}

function secondsText(value) {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  return Number.isFinite(num) ? `${num.toFixed(1)}s` : '—'
}

// 开区间末日 −1 天（统一 UTC 语义：`T00:00:00Z` 强制按零时区解析，
// 规避 ES 对无时区 ISO 串的本地时区解析——上海时区下会偏一天）。
function shiftDayText(dayText, deltaDays) {
  const date = new Date(`${dayText}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dayText
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

export function formatPeriodTitle(period) {
  if (!period || typeof period !== 'object') return '报表'
  const start = String(period.start || '')
  if (period.type === 'weekly') {
    // 周报展示层 end = period_end − 1 天（存储为开区间，标题统一闭区间）。
    return `周报 · ${start} ~ ${shiftDayText(String(period.end || ''), -1)}`
  }
  return `日报 · ${start}`
}

export function formatPeriodFileStem(period) {
  if (!period || typeof period !== 'object') return '报表'
  if (period.type === 'weekly') {
    const endText = shiftDayText(String(period.end || ''), -1)
    return `抖音运营周报_${String(period.start || '')}~${endText}`
  }
  return `抖音运营日报_${String(period.start || '')}`
}

function formatIsoText(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

// ---------------------------------------------------------------------------
// KPI 卡（§5.4：available=false → —）
// 环比方向色（2026-10-26 用户定稿）：统一「上涨红色、下跌绿色」，
// 不再按 goodDirection 反转；changePct=null → 灰色无箭头。
// delta 文案注明对比基准：日报「较昨日」、周报「较上周」。
// ---------------------------------------------------------------------------

export function changePctText(changePct) {
  if (changePct === null || changePct === undefined) return null
  const num = Number(changePct)
  if (!Number.isFinite(num)) return null
  return `${num > 0 ? '▲' : num < 0 ? '▼' : ''}${Math.abs(num).toFixed(1)}%`
}

export function kpiChangeKind(metric) {
  const change = Number(metric && metric.changePct)
  if (!Number.isFinite(change) || change === 0) return 'flat'
  return change > 0 ? 'up' : 'down'
}

/** 对比基准文案：日报=昨日、周报=上周（KPI 卡 delta 前缀）。 */
export function changeBaseLabel(reportType) {
  return reportType === 'weekly' ? '较上周' : '较昨日'
}

export function ReportKpiCard({ metric, reportType }) {
  if (!metric || typeof metric !== 'object') return null
  const value = metric.available === false || metric.value === null || metric.value === undefined
    ? '—'
    : metric.key === 'interactionRate'
      ? reportPctText(metric.value)
      : reportCountText(metric.value)
  const change = changePctText(metric.changePct)
  const changeKind = kpiChangeKind(metric)
  const base = changeBaseLabel(reportType)
  const prev = metric.prevValue === null || metric.prevValue === undefined
    ? null
    : reportCountText(metric.prevValue)
  return h('div', { className: 'ydo-report-kpi' },
    h('div', { className: 'ydo-report-kpi-label' }, metric.label || metric.key),
    h('div', { className: 'ydo-report-kpi-value' }, value),
    // 环比 delta 独立成块放在数值下方（demo UI 口径），不内联跟随数值（真机反馈太挤）。
    change !== null
      ? h('div', { className: `ydo-report-kpi-change ydo-report-kpi-change-${changeKind}` },
        `${base} ${change}${prev !== null ? ` · 上期 ${prev}` : ''}`)
      : h('div', { className: 'ydo-report-kpi-change ydo-report-kpi-change-flat' },
        `${base} 无对比基准`),
    metric.note ? h('div', { className: 'ydo-report-kpi-note' }, metric.note) : null)
}

// ---------------------------------------------------------------------------
// ReportTrendChart（§5.5 SVG 算法：客户端只画不算）
// ---------------------------------------------------------------------------

/* 宽度取详情页 SVG 实际容器宽:1180(页宽) - 48(section 左右 padding) - 24(figure 左右
   padding) - 2(figure 边框) = 1106。与容器 1:1 时 width:100% 不产生等比缩放,
   消除 960 视口下 preserveAspectRatio meet 的两侧留白(2026-10-27 用户要求填满)。 */
const CHART_W = 1106
const CHART_H = 240
const CHART_PAD = { top: 16, right: 16, bottom: 28, left: 56 }

/** 优雅刻度：maxBar 取 1/2/5×10^k 向上取整；全 null/全 0 → 固定 1（退化）。 */
export function niceMax(values) {
  const finite = (values || []).filter(value => value !== null && value !== undefined)
  const max = finite.length ? Math.max(...finite.map(value => Number(value) || 0)) : 0
  if (max <= 0) return 1
  const exponent = Math.floor(Math.log10(max))
  const base = 10 ** exponent
  for (const factor of [1, 2, 5, 10]) {
    if (factor * base >= max) return factor * base
  }
  return 10 * base
}

export function trendSeriesShape(series) {
  const bars = Array.isArray(series?.bars) ? series.bars : []
  const line = Array.isArray(series?.line) ? series.line : []
  const barValues = bars.filter(value => value !== null && value !== undefined)
  const lineValues = line.filter(value => value !== null && value !== undefined)
  return {
    bars,
    line,
    barsAllEmpty: barValues.length === 0 || Math.max(...barValues.map(Number)) <= 0,
    lineDrawable: lineValues.length >= 2 && Math.min(...lineValues) !== Math.max(...lineValues),
    lineSingle: lineValues.length > 0,
  }
}

/** line 纵轴范围：非 null 值 ±10% 余量；单点或 min==max → ±1 padding（退化）。 */
export function lineRange(values) {
  const finite = (values || []).filter(value => value !== null && value !== undefined).map(Number)
  if (!finite.length) return null
  let min = Math.min(...finite)
  let max = Math.max(...finite)
  if (min === max) {
    min -= 1
    max += 1
  } else {
    const pad = (max - min) * 0.1
    min -= pad
    max += pad
  }
  return { min, max }
}

export function ReportTrendChart({ series, title, notes }) {
  const shape = trendSeriesShape(series)
  const days = Array.isArray(series?.days) ? series.days : []
  const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right
  const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom
  const maxBar = niceMax(shape.bars)
  const lineBound = lineRange(shape.line)
  const slot = days.length ? plotW / days.length : plotW
  const barWidth = Math.max(8, Math.min(48, slot * 0.5))
  const gridLines = [0, 0.25, 0.5, 0.75, 1]
  const linePoints = shape.line.map((value, index) => {
    if (value === null || value === undefined || !lineBound) return null
    const x = CHART_PAD.left + slot * index + slot / 2
    const y = CHART_PAD.top + plotH - ((Number(value) - lineBound.min) / (lineBound.max - lineBound.min)) * plotH
    return { x, y }
  })
  // line: null → path 断开（M 重新起笔）；断点日保留灰刻度。
  const lineSegments = []
  let current = []
  for (const point of linePoints) {
    if (point) {
      current.push(point)
    } else if (current.length) {
      lineSegments.push(current)
      current = []
    }
  }
  if (current.length) lineSegments.push(current)
  const linePath = lineSegments
    .map(segment => segment
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(' '))
    .join(' ')
  // 净粉数据点自定义 tooltip:原生 SVG <title> 有约 1 秒的浏览器固定延迟且不可
// 配置,改用即时跟随鼠标的浮层(pointer-events:none,不遮挡命中圆)。
let reportChartTipNode = null

// 真机显示修复（2026-10-27 用户反馈悬停不出浮层）：插件可能运行在宿主 Shadow DOM 内,
// 浮层若挂 document.body 就落在 shadow 之外、拿不到注入样式表,整套样式失效不显示。
// 因此挂载点用 evt.target.getRootNode()（ShadowRoot 或 document）,且关键样式全部内联,
// 不依赖 CSS 类命中。
const REPORT_TIP_STYLE = 'position:fixed;z-index:9999;display:block;padding:6px 10px;border-radius:6px;'
  + 'background:#1f2329;color:#fff;font-size:12px;line-height:1.5;pointer-events:none;'
  + 'white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.18)'

function showChartTip(evt, text) {
  if (typeof document === 'undefined' || !evt || !evt.target) return
  if (!reportChartTipNode || !reportChartTipNode.isConnected) {
    reportChartTipNode = document.createElement('div')
    reportChartTipNode.className = 'ydo-report-chart-tip'
    reportChartTipNode.style.cssText = REPORT_TIP_STYLE
    const root = typeof evt.target.getRootNode === 'function' ? evt.target.getRootNode() : null
    const host = root && root.nodeType === 11 ? root : (document.body || root)
    if (!host || typeof host.appendChild !== 'function') return
    host.appendChild(reportChartTipNode)
  }
  reportChartTipNode.textContent = text
  reportChartTipNode.style.display = 'block'
  moveChartTip(evt)
}

function moveChartTip(evt) {
  if (!reportChartTipNode) return
  const x = Math.min(evt.clientX + 14, (window.innerWidth || 1280) - 160)
  const y = Math.max(evt.clientY - 34, 8)
  reportChartTipNode.style.left = `${x}px`
  reportChartTipNode.style.top = `${y}px`
}

function hideChartTip() {
  if (reportChartTipNode) reportChartTipNode.style.display = 'none'
}

  // 净粉数值只在线点悬停 tooltip 展示（demo UI 口径）。不画常驻右轴刻度：
  // 真机实测常驻「净粉 xx」会被误读成悬停值（2026-10-27 用户反馈）。
  const lineDots = linePoints
    .map((point, index) => {
      if (!point) return null
      const value = Number(shape.line[index])
      const label = `净粉丝: ${value > 0 ? '+' : ''}${reportCountText(Math.abs(value))}`
      const events = {
        onMouseMove: evt => { showChartTip(evt, label); moveChartTip(evt) },
        onMouseLeave: () => hideChartTip(),
      }
      return [
        // 透明大圆扩大悬停命中区（r=10），肉眼只见 r=3.5 实心点。
        h('circle', {
          key: `hit-${index}`, cx: point.x.toFixed(1), cy: point.y.toFixed(1), r: 10, fill: 'transparent',
          ...events,
        }),
        h('circle', {
          key: `dot-${index}`, cx: point.x.toFixed(1), cy: point.y.toFixed(1), r: 3.5,
          className: 'ydo-report-chart-dot',
          ...events,
        }, h('title', null, label)),
      ]
    })
  const lastBarIndex = shape.bars.length - 1
  return h('figure', { className: 'ydo-report-chart' },
    title ? h('figcaption', { className: 'ydo-report-section-title' }, title) : null,
    ...(Array.isArray(notes) && notes.length
      ? [h('div', { className: 'ydo-report-chart-notes' },
        notes.map(([label, text]) => metaLine(label, text)))]
      : []),
    h('svg', { viewBox: `0 0 ${CHART_W} ${CHART_H}`, className: 'ydo-report-chart-svg', role: 'img' },
      // 柱体蓝渐变（与验证页 demo UI 的 gBar 同色标）。
      h('defs', null, h('linearGradient', { id: 'ydo-report-bar-gradient', x1: '0', y1: '0', x2: '0', y2: '1' },
        h('stop', { offset: '0', 'stop-color': '#7aa5ff' }),
        h('stop', { offset: '1', 'stop-color': '#c8d9ff' }))),
      gridLines.map(ratio => {
        const y = CHART_PAD.top + plotH - plotH * ratio
        const label = formatChartAxisLabel(maxBar * ratio)
        return [
          h('line', {
            key: `grid-${ratio}`, x1: CHART_PAD.left, x2: CHART_PAD.left + plotW, y1: y, y2: y,
            className: 'ydo-report-chart-grid',
          }),
          h('text', {
            key: `label-${ratio}`, x: CHART_PAD.left - 8, y: y + 4,
            textAnchor: 'end', className: 'ydo-report-chart-text',
          }, label),
        ]
      }),
      shape.bars.map((value, index) => {
        const height = value === null || value === undefined ? 0 : (Number(value) / maxBar) * plotH
        const x = CHART_PAD.left + slot * index + (slot - barWidth) / 2
        const y = CHART_PAD.top + plotH - height
        return h('rect', {
          key: `bar-${index}`, x, y, width: barWidth, height,
          rx: 3,
          className: `ydo-report-chart-bar${index === lastBarIndex ? ' ydo-report-chart-bar-last' : ''}${value === null || value === undefined ? ' ydo-report-chart-bar-gap' : ''}`,
        }, h('title', null, value === null || value === undefined ? '缺采（不补零）' : `播放: ${reportCountText(Number(value))}`))
      }),
      shape.lineDrawable && lineBound
        ? h('path', { d: linePath, className: 'ydo-report-chart-line', fill: 'none' })
        : null,
      ...(shape.lineSingle && lineBound ? lineDots.filter(Boolean).flat() : []),
      days.map((day, index) => h('text', {
        key: `day-${index}`,
        x: CHART_PAD.left + slot * index + slot / 2,
        y: CHART_H - 8, textAnchor: 'middle', className: 'ydo-report-chart-text',
      }, day))),
    shape.barsAllEmpty
      ? h('div', { className: 'ydo-report-chart-empty', role: 'status' }, '无有效播放数据')
      : null,
    !shape.lineDrawable && shape.lineSingle && lineBound
      ? h('div', { className: 'ydo-report-chart-empty', role: 'status' }, '净增粉丝趋势点不足，暂不绘制连线')
      : null)
}

function formatChartAxisLabel(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  if (num >= 10000) return `${(num / 10000).toFixed(num % 10000 === 0 ? 0 : 1)}万`
  return String(num)
}

// ---------------------------------------------------------------------------
// QualityBar / AnomalyList / InsightGrid / AccountTable / WorkCards / VersionSelect
// ---------------------------------------------------------------------------

export function QualityBar({ coverage }) {
  if (!coverage || typeof coverage !== 'object') return null
  const total = Number(coverage.totalAccounts)
  const covered = Number(coverage.coveredAccounts)
  const missing = Array.isArray(coverage.missingAccounts) ? coverage.missingAccounts : []
  return h('div', { className: 'ydo-report-quality' },
    h('span', { className: 'ydo-report-quality-ratio' },
      `覆盖账号 ${Number.isFinite(covered) && Number.isFinite(total) ? `${covered}/${total}` : '—'}`),
    h('span', { className: 'ydo-report-quality-meta' },
      `上次采集 ${formatIsoText(coverage.lastCollectedAt)}`),
    missing.length
      ? h('span', { className: 'ydo-report-quality-missing' },
        `缺采：${missing.map(item => `${item.nickname || item.accountId}（${MISSING_REASON_COPY[item.reason] || item.reason || '无数据'}）`).join('、')}`)
      : null)
}

export function AnomalyList({ anomalies }) {
  const items = Array.isArray(anomalies) ? anomalies : []
  if (!items.length) return null
  return h('ul', { className: 'ydo-report-anomalies' },
    items.map((item, index) => h('li', {
      key: `${item.accountId || 'matrix'}-${index}`,
      className: `ydo-report-anomaly ydo-report-anomaly-${item.type === 'data_gap' ? 'gap' : 'business'}`,
    },
    h('strong', null, item.type === 'data_gap' ? '⚠ 数据缺口' : '⚠ 业务异常'),
    h('span', null, item.message || ''))))
}

export function InsightGrid({ ai }) {
  if (!ai || typeof ai !== 'object') return null
  const facts = Array.isArray(ai.facts) ? ai.facts : []
  const inferences = Array.isArray(ai.inferences) ? ai.inferences : []
  const recommendations = Array.isArray(ai.recommendations) ? ai.recommendations : []
  const limitations = Array.isArray(ai.limitations) ? ai.limitations : []
  // 紧凑速读形态（2026-10-27 方案 A+B）：行内只展示标题+徽标；detail/evidence
  // 收进 <details> 折叠区（人工复核用，导出 PDF/HTML 由宿主序列化前强制展开）。
  const moreBlock = entries => h('details', { className: 'ydo-report-ai-more' },
    h('summary', null, '展开完整依据'),
    entries.map((item, index) => h('div', { key: `more-${index}`, className: 'ydo-report-ai-more-item' },
      h('b', null, item.title || ''),
      h('p', null, item.detail || ''),
      item.evidence ? h('p', { className: 'ydo-report-insight-evidence' }, `依据：${item.evidence}`) : null)))
  const line = (prefix, item, index) => h('li', { key: `${prefix}-${index}`, className: 'ydo-report-insight-line' },
    h('span', { className: 'ydo-report-insight-title' }, item.title || ''),
    prefix === 'infer'
      ? h('span', { className: `ydo-report-badge ydo-report-badge-${item.confidence || 'low'}` },
        item.confidence === 'high' ? '高置信' : item.confidence === 'medium' ? '中置信' : '低置信')
      : prefix === 'advice'
        ? h('span', { className: `ydo-report-badge ydo-report-badge-${item.priority || 'low'}` },
          item.priority === 'high' ? '高优先' : item.priority === 'medium' ? '中优先' : '低优先')
        : null)
  return h('div', { className: 'ydo-report-insights' },
    h('h3', { className: 'ydo-report-section-title' }, 'AI 洞察'),
    ai.summary ? h('p', { className: 'ydo-report-ai-summary' }, ai.summary) : null,
    h('div', { className: 'ydo-report-insight-grid' },
      h('section', { className: 'ydo-report-insight-col ydo-report-insight-col-fact' },
        h('h4', null, '① 事实 · 来自数据'),
        h('ul', { className: 'ydo-report-insight-list' },
          facts.map((item, index) => line('fact', item, index))),
        moreBlock(facts),
        limitations.length
          ? h('details', { className: 'ydo-report-ai-more' },
            h('summary', null, '数据覆盖说明'),
            limitations.map((text, index) => h('p', {
              key: `limit-${index}`, className: 'ydo-report-insight-evidence',
            }, text)))
          : null),
      h('section', { className: 'ydo-report-insight-col ydo-report-insight-col-infer' },
        h('h4', null, '② 推断 · 谨慎解释'),
        h('ul', { className: 'ydo-report-insight-list' },
          inferences.map((item, index) => line('infer', item, index))),
        moreBlock(inferences)),
      h('section', { className: 'ydo-report-insight-col ydo-report-insight-col-advice' },
        h('h4', null, '③ 建议 · 可执行'),
        h('ul', { className: 'ydo-report-insight-list' },
          recommendations.map((item, index) => line('advice', item, index))),
        moreBlock(recommendations))))
}

const ACCOUNT_COLUMNS = [
  { key: 'nickname', label: '账号' },
  { key: 'fanCount', label: '现有粉丝' },
  { key: 'plays', label: '播放增量' },
  { key: 'netFans', label: '净增粉丝' },
  { key: 'publishes', label: '发布' },
  { key: 'likes', label: '点赞' },
  { key: 'comments', label: '评论' },
  { key: 'shares', label: '分享' },
]

export function AccountTable({ accounts }) {
  const rows = Array.isArray(accounts) ? accounts : []
  if (!rows.length) return null
  return h('div', { className: 'ydo-report-table-wrap' },
    h('table', { className: 'ydo-report-table' },
      h('thead', null, h('tr', null, ACCOUNT_COLUMNS.map(column => h('th', { key: column.key }, column.label)))),
      h('tbody', null, rows.map(row => h('tr', { key: row.accountId },
        h('td', { className: 'ydo-report-cell-main' },
          row.nickname || row.accountId,
          row.sessionStatus === 'expired'
            ? h('span', { className: 'ydo-report-mark' }, '会话过期')
            : null,
          Array.isArray(row.marks) && row.marks.length
            ? row.marks.map(mark => h('span', { key: mark, className: 'ydo-report-mark' }, mark))
            : null),
        h('td', null, reportCountText(row.fanCount)),
        ...['plays', 'netFans', 'publishes', 'likes', 'comments', 'shares'].map(key => {
          const value = row.metrics ? row.metrics[key] : null
          const missing = row.eachAvailable === false || value === null || value === undefined
          // TF-05：缺采账号指标列 —*（— 加星标注缺失口径，区别于真实 0）。
          // 净增粉丝列对齐 2026-10-26 涨红跌绿定稿：正值红、负值绿、0/缺失无色。
          if (key === 'netFans' && !missing && value !== 0) {
            return h('td', { key, className: value > 0 ? 'ydo-report-up' : 'ydo-report-down' },
              `${value > 0 ? '+' : '−'}${reportCountText(Math.abs(Number(value)))}`)
          }
          return h('td', { key }, missing ? '—*' : reportCountText(value))
        }))))))
}

export function WorkCards({ works }) {
  const rows = Array.isArray(works) ? works : []
  if (!rows.length) return h('p', { className: 'ydo-report-empty-line' }, '周期内无新发作品')
  return h('div', { className: 'ydo-report-works' },
    rows.map(work => {
      const metrics = work.metrics || {}
      const completion = metrics.completion5s
      const width = completion === null || completion === undefined
        ? null
        : Math.max(0, Math.min(100, Number(completion)))
      return h('article', { key: work.workId, className: 'ydo-report-work-card' },
        h('header', { className: 'ydo-report-work-head' },
          h('strong', null, work.title || work.workId),
          work.isHot ? h('span', { className: 'ydo-report-pill-hot' }, '爆款') : null,
          h('span', { className: 'ydo-report-work-account' }, work.nickname || work.accountId || '')),
        h('dl', { className: 'ydo-report-work-metrics' },
          h('div', null, h('dt', null, '播放'), h('dd', null, reportCountText(metrics.plays))),
          h('div', null, h('dt', null, '点赞'), h('dd', null, reportCountText(metrics.likes))),
          h('div', null, h('dt', null, '评论'), h('dd', null, reportCountText(metrics.comments))),
          h('div', null, h('dt', null, '带粉'), h('dd', null, reportCountText(metrics.fansGain)))),
        h('div', { className: 'ydo-report-work-secondary' },
          h('span', null, `收藏 ${reportCountText(metrics.collects)}`),
          h('span', null, `分享 ${reportCountText(metrics.shares)}`),
          h('span', null, `5s 完播 ${reportPctText(metrics.completion5s)}`),
          h('span', null, `2s 跳出 ${reportPctText(metrics.bounce2s)}`),
          h('span', null, `均观看 ${secondsText(metrics.avgWatchSeconds)}`)),
        width !== null
          ? h('div', { className: 'ydo-report-work-progress', role: 'img', 'aria-label': `5s 完播率 ${Number(completion).toFixed(1)}%` },
            h('div', { className: 'ydo-report-work-progress-bar', style: { width: `${width}%` } }))
          : null)
    }))
}

export function VersionSelect({ versions, currentId, onChange }) {
  const rows = Array.isArray(versions) ? versions : []
  if (!rows.length) return null
  return h('label', { className: 'ydo-report-version' },
    '版本',
    h('select', {
      value: currentId || '',
      onChange: event => onChange && onChange(event.target.value),
    },
    rows.map(item => h('option', { key: item.reportId, value: item.reportId },
      `v${item.version} · ${item.status === 'succeeded' ? (item.coreAvailable === false ? '数据不全' : '已生成') : item.status === 'failed' ? '失败' : item.status === 'insufficient' ? '数据不足' : '生成中'}${item.isCurrent ? '（当前）' : ''}`))))
}

// ---------------------------------------------------------------------------
// 日报 / 周报模板（§5.4 布局编排；数据来源 result_json.data + ai）
// ---------------------------------------------------------------------------

function ReportHeader({ report }) {
  const data = report?.resultJson?.data || {}
  const coverage = data.coverage || {}
  const generatedAt = formatIsoText(data.generatedAt || report.finishedAt)
  const weekly = data.period?.type === 'weekly'
  const start = String(data.period?.start || '')
  const end = String(data.period?.end || '')
  // 环比基准：日报=前一天（T-2 单日）；周报=上一自然周。
  const baseText = weekly
    ? `环比对比上一自然周（${shiftDayText(start, -7)} ~ ${shiftDayText(start, -1)}）`
    : `环比对比昨日（${shiftDayText(start, -1)}）`
  const metricScope = weekly
    ? `「KPI 与账号周对比」各数值 = ${start} ~ ${shiftDayText(end, -1)} 七天日度增量求和（缺采日不计入，不补零）`
    : `「KPI 与账号明细」各数值 = ${start} 单日增量（播放/互动/涨粉为当日新增；发布 = 当日新发作品数）`
  return h('header', { className: 'ydo-report-header' },
    h('h2', { className: 'ydo-report-title' }, formatPeriodTitle(data.period)),
    h('div', { className: 'ydo-report-meta' },
      h('div', { className: 'ydo-report-meta-line' },
        `生成时间 ${generatedAt} · 账号 ${coverage.totalAccounts ?? '—'} 个`),
      metaLine('对比基准', baseText),
      metaLine('KPI 口径', metricScope),
      metaLine('互动口径', '互动总量 = 点赞 + 评论 + 分享 · 互动率 = 互动总量 ÷ 播放增量'),
      metaLine('作品口径', '作品卡 / Top 作品 = 采集时点累计值（收藏仅作品级展示）'),
      metaLine('标注说明', '「—*」= 该账号无快照（不补零，未发布显示 0） · 爆款 = 报表独立口径（播放 ≥ 阈值）')),
    h(QualityBar, { coverage }))
}

function metaLine(label, text) {
  return h('div', { className: 'ydo-report-meta-line' },
    h('span', { className: 'ydo-report-meta-k' }, label),
    text)
}

function InsufficientState({ report, actions }) {
  const coverage = report?.resultJson?.data?.coverage || report.coverageSummary || {}
  const signals = coverage.signals || {}
  const signalLabels = [
    ['dailyRows', '账号日度行'],
    ['workSnapshotRows', '作品快照行'],
    ['fansProfileRows', '粉丝画像行'],
    ['periodWorks', '周期内发布作品'],
  ]
  const dailyMissing = coverage.insufficientReason === 'daily_missing'
    || (Number(signals.dailyRows) === 0 && (Number(signals.workSnapshotRows) > 0 || Number(signals.periodWorks) > 0))
  const headline = dailyMissing
    ? '该周期核心日度指标缺失（采集未覆盖到当天日度数据），暂无法生成指标正文。'
    : '周期内所有账号均无数据，请先完成采集后再重新生成。'
  return h('div', { className: 'ydo-report-insufficient' },
    h('p', { className: 'ydo-report-insufficient-icon', role: 'img', 'aria-label': '数据不足' }, '⚠'),
    h('p', null, headline),
    h('ul', { className: 'ydo-report-signal-list' },
      signalLabels.map(([key, label]) => h('li', { key },
        `${label}：${Number(signals[key]) === 0 ? '0' : Number(signals[key]) || '—'} 行/条`))),
    actions && actions.onRegenerate
      ? h('button', { type: 'button', className: 'ydo-report-action', onClick: actions.onRegenerate }, '重新生成')
      : null)
}

export function DailyTemplate({ report }) {
  const data = report?.resultJson?.data || {}
  const series = data.trendSeries || {}
  const coreMetrics = Array.isArray(data.coreMetrics) ? data.coreMetrics : []
  return h('div', { className: 'ydo-report-body' },
    h(ReportHeader, { report }),
    h('div', { className: 'ydo-report-kpi-row' }, coreMetrics.map(metric => h(ReportKpiCard, { key: metric.key, metric, reportType: 'daily' }))),
    h(ReportTrendChart, {
      series,
      title: '近 7 天播放增量与净增粉丝趋势',
      notes: [
        ['柱（左轴）', '播放增量 = 当日矩阵内所有有效账号播放增量之和'],
        ['线（右轴）', '净增粉丝 = 当日矩阵净增粉丝之和（悬停数据点查看每日数值）'],
        ['缺口', '缺采日断开不补零 · 末位（最新一期）深蓝实色'],
      ],
    }),
    h('section', null,
      h('h3', { className: 'ydo-report-section-title' }, `账号明细（${data.period?.start || ''} 当日）`),
      h('div', { className: 'ydo-report-chart-notes' },
        metaLine('增量口径', '播放增量 / 净增粉丝 / 点赞 / 评论 / 分享 = 当日增量'),
        metaLine('发布', '当日新发作品数（未发布显示 0）'),
        metaLine('现有粉丝', '采集时点快照'),
        metaLine('标注', '「—*」= 该账号当日无快照（不补零）')),
      h(AccountTable, { accounts: data.accounts })),
    h('section', null,
      h('h3', { className: 'ydo-report-section-title' }, `${data.period?.start || ''} 新发作品（${(data.works || []).length} 条）`),
      Number(data.worksOmittedCount) > 0
        ? h('p', { className: 'ydo-report-empty-line' },
          `其余 ${data.worksOmittedCount} 条作品未展示（按播放量取前 ${data.works.length} 条，上限为服务端配置）`)
        : null,
      h(WorkCards, { works: data.works })),
    h(AnomalyList, { anomalies: data.anomalies }),
    h(InsightGrid, { ai: report?.resultJson?.ai }))
}

export function WeeklyTemplate({ report }) {
  const data = report?.resultJson?.data || {}
  const series = data.trendSeries || {}
  const coreMetrics = Array.isArray(data.coreMetrics) ? data.coreMetrics : []
  return h('div', { className: 'ydo-report-body' },
    h(ReportHeader, { report }),
    h('div', { className: 'ydo-report-kpi-row' }, coreMetrics.map(metric => h(ReportKpiCard, { key: metric.key, metric, reportType: 'weekly' }))),
    h(ReportTrendChart, {
      series,
      title: '近 4 周播放增量与净增粉丝趋势',
      notes: [
        ['柱（左轴）', '播放增量 = 当周矩阵内所有有效账号播放增量之和'],
        ['线（右轴）', '净增粉丝 = 当周矩阵净增粉丝之和（悬停数据点查看每周数值）'],
        ['缺口', '整周无数据则断开不补零 · 末位（本报周期）深蓝实色'],
      ],
    }),
    h('section', null,
      h('h3', { className: 'ydo-report-section-title' }, `账号周对比（${data.period?.start || ''} ~ ${shiftDayText(String(data.period?.end || ''), -1)}）`),
      h('div', { className: 'ydo-report-chart-notes' },
        metaLine('增量口径', '播放增量 / 净增粉丝 / 点赞 / 评论 / 分享 = 周期内日度增量求和（缺采日不计入）'),
        metaLine('发布', '周期内新发作品数（无发布显示 0）'),
        metaLine('现有粉丝', '采集时点快照'),
        metaLine('标注', '「—*」= 该账号周期内无快照（不补零）')),
      h(AccountTable, { accounts: data.accounts })),
    h('section', null,
      h('h3', { className: 'ydo-report-section-title' }, `本周 Top 作品（${(data.works || []).length} 条）`),
      Number(data.worksOmittedCount) > 0
        ? h('p', { className: 'ydo-report-empty-line' },
          `其余 ${data.worksOmittedCount} 条作品未展示（按播放量取前 ${data.works.length} 条，上限为服务端配置）`)
        : null,
      h(WorkCards, { works: data.works })),
    h(AnomalyList, { anomalies: data.anomalies }),
    h(InsightGrid, { ai: report?.resultJson?.ai }))
}

// ---------------------------------------------------------------------------
// 列表页 / 详情页容器（§5.2 两级导航的展示层；状态机在宿主 client.js）
// ---------------------------------------------------------------------------

export function ReportListView({ items, loading, errorReason, reportType, actions, t }) {
  const rows = Array.isArray(items) ? items : []
  return h('div', { className: 'ydo-report-list' },
    h('div', { className: 'ydo-report-list-toolbar' },
      h('div', { className: 'ydo-report-seg', role: 'tablist', 'aria-label': '报表类型' },
        ['daily', 'weekly'].map(type => h('button', {
          key: type, type: 'button',
          className: `ydo-report-seg-item${reportType === type ? ' is-active' : ''}`,
          'aria-selected': reportType === type || undefined,
          onClick: () => actions.onTypeChange(type),
        }, type === 'daily' ? '日报' : '周报'))),
      h('button', { type: 'button', className: 'ydo-report-action', onClick: actions.onRefresh }, '刷新')),
    errorReason
      ? h('p', { className: 'ydo-report-error', role: 'alert' }, reportErrorCopy(errorReason))
      : null,
    loading && !rows.length ? h('p', { className: 'ydo-report-empty-line' }, '加载中…') : null,
    !loading && !errorReason && !rows.length
      ? h('p', { className: 'ydo-report-empty-line' }, '等待首个调度周期（日报每天 11:00 / 周报周一 12:00 自动生成）')
      : null,
    rows.length
      ? h('div', { className: 'ydo-report-table-wrap' },
        h('table', { className: 'ydo-report-table' },
          h('thead', null, h('tr', null,
            ['周期', '状态', '版本', '覆盖账号', '生成时间', '说明', ''].map((label, index) => h('th', { key: `${label}-${index}` }, label)))),
          h('tbody', null, rows.map(item => {
            const pill = reportStatusPill(item.status, item.coreAvailable)
            return h('tr', { key: item.reportId },
              h('td', { className: 'ydo-report-cell-main' }, formatPeriodTitle({ type: item.reportType, start: item.periodStart, end: item.periodEnd })),
              h('td', null, h('span', { className: `ydo-report-pill ydo-report-pill-${pill.kind}` }, pill.label)),
              h('td', null, `v${item.version ?? '—'}`),
              h('td', null, item.coverageSummary
                ? `${item.coverageSummary.coveredAccounts ?? '—'}/${item.coverageSummary.totalAccounts ?? '—'}`
                : '—'),
              h('td', null, formatIsoText(item.finishedAt || item.createdAt)),
              h('td', { className: 'ydo-report-note' },
                item.status === 'failed' && item.errorCode
                  ? h('span', { className: 'ydo-report-error-text' }, reportErrorCopy(item.errorCode))
                  : item.summary || '—'),
              h('td', null,
                h('button', {
                  type: 'button', className: 'ydo-report-action',
                  onClick: () => actions.onOpen(item.reportId),
                }, '查看')))
          }))))
      : null,
    actions.onLoadMore && rows.length
      ? h('button', { type: 'button', className: 'ydo-report-action ydo-report-more', onClick: actions.onLoadMore }, '加载更多')
      : null)
}

export function ReportDetailView({ report, loading, errorReason, regenerating, versions, actions }) {
  if (loading) return h('p', { className: 'ydo-report-empty-line' }, '加载中…')
  if (errorReason) {
    return h('div', { className: 'ydo-report-detail-error' },
      h('p', { className: 'ydo-report-error', role: 'alert' }, reportErrorCopy(errorReason)),
      h('button', { type: 'button', className: 'ydo-report-action', onClick: actions.onBack }, '← 返回列表'))
  }
  if (!report) return null
  const status = report.status
  const busy = status === 'pending' || status === 'running'
  const schemaVersion = String(report.outputSchemaVersion || '')
  return h('div', { className: 'ydo-report-detail' },
    h('div', { className: 'ydo-report-toolbar no-print' },
      h('button', { type: 'button', className: 'ydo-report-action', onClick: actions.onBack }, '← 返回列表'),
      h(VersionSelect, { versions, currentId: report.reportId, onChange: actions.onVersionChange }),
      h('div', { className: 'ydo-report-toolbar-actions' },
        busy ? h('span', { className: 'ydo-report-busy', role: 'status' }, '生成中…') : null,
        regenerating ? h('span', { className: 'ydo-report-busy', role: 'status' }, '提交中…') : null,
        h('button', {
          type: 'button', className: 'ydo-report-action',
          onClick: actions.onRegenerate, disabled: busy || regenerating,
        }, '重新生成'),
        h('button', { type: 'button', className: 'ydo-report-action', onClick: actions.onExportHtml, disabled: busy }, '导出 HTML'),
        h('button', { type: 'button', className: 'ydo-report-action', onClick: actions.onExportPdf, disabled: busy }, '导出 PDF'))),
    status === 'insufficient'
      ? h(InsufficientState, { report, actions })
      : report.resultJson
        ? h('div', { className: 'ydo-report-render' },
          schemaVersion.includes('weekly') ? h(WeeklyTemplate, { report }) : h(DailyTemplate, { report }))
        : busy
        // 生成等待卡(2026-10-27 真机反馈:等待期只有「暂无报表内容」小字像卡死):
        // 复用页面状态区 ydo-state 体系(spinner + 标题 + 预期管理文案),与
        // 工具栏「生成中…」小字互补;完成后由 5s 轮询自动替换为报表内容。
          ? h('div', { className: 'ydo-state ydo-report-waiting', role: 'status' },
            h('span', { className: 'ydo-spinner', 'aria-hidden': 'true' }),
            h('p', { className: 'ydo-state-title' }, 'AI 正在生成本期报表'),
            h('p', { className: 'ydo-hint' }, '通常需要 1~2 分钟,生成完成后本页自动刷新;期间可在版本下拉中查看历史版本。'))
          : h('p', { className: 'ydo-report-empty-line' }, '暂无报表内容'),
    status === 'failed' && report.errorCode
      ? h('p', { className: 'ydo-report-error', role: 'alert' }, reportErrorCopy(report.errorCode))
      : null)
}

// ---------------------------------------------------------------------------
// 导出（§5.6：自包含 HTML / 打印 PDF）
// ---------------------------------------------------------------------------

const EXPORT_TOKEN_FALLBACK = [
  ':root{--dsw-alias-bg-primary:#ffffff;--dsw-alias-bg-secondary:#f5f6f7;',
  '--dsw-alias-label-primary:#1f2329;--dsw-alias-label-secondary:#646a73;',
  '--dsw-alias-border-secondary:#dee0e3;--dsw-alias-brand-primary:#3370ff;',
  '--dsw-alias-status-green:#2ea121;--dsw-alias-status-red:#d83931;',
  '--dsw-alias-status-orange:#de7802;--dsw-alias-status-blue:#3370ff;}',
].join('')

/**
 * 序列化详情渲染容器为自包含单文件 HTML（§5.6）：
 * 模板类名 ydo-report-*，内联 fallback token + 报表作用域 CSS + @media print；
 * 无外部 http(s) 资源引用；不包含 .no-print 操作栏（调用方容器不含交互态）。
 */
export function serializeReportHtml(container, cssText) {
  if (!container) return ''
  // 导出含完整依据：序列化副本强制展开全部 <details>（不影响页面折叠状态）。
  // 测试环境的假 container 无 DOM 方法：按能力降级，仅真实 DOM 走克隆展开。
  const clone = typeof container.cloneNode === 'function' ? container.cloneNode(true) : container
  if (typeof clone.querySelectorAll === 'function') {
    clone.querySelectorAll('details').forEach(node => node.setAttribute('open', ''))
  }
  const body = clone.outerHTML
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
    `<title>${formatPeriodTitleFromContainer(container)}</title>`,
    `<style>${EXPORT_TOKEN_FALLBACK}${cssText || ''}`
    + '@media print{.no-print{display:none!important}.ydo-report-kpi,.ydo-report-work-card{break-inside:avoid}}',
    '</style></head><body>',
    body,
    '</body></html>',
  ].join('')
}

function formatPeriodTitleFromContainer(container) {
  const titleNode = container.querySelector('.ydo-report-title')
  return titleNode ? String(titleNode.textContent || '抖音运营报表') : '抖音运营报表'
}

/** 导出 HTML 触发下载（文件名由调用方按周期拼装）。 */
export function downloadReportHtml(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** 导出 PDF：桌面 webview 走系统打印（@media print 已隐藏操作栏）。 */
export function printReport() {
  if (typeof window !== 'undefined' && typeof window.print === 'function') window.print()
}

// ---------------------------------------------------------------------------
// 报表作用域样式（§5.9：类名前缀 ydo-report-*，全部 var(--dsw-alias-*, fallback)；
// 暗色随宿主。独立打开/导出时由 EXPORT_TOKEN_FALLBACK 提供 token 兜底。
// client.js 的总 css 常量拼接本常量保持单 style 注入；导出 HTML 复用同一段。
// ---------------------------------------------------------------------------

export const REPORT_CSS_TEXT = `
.ydo-report-list-toolbar{display:flex;align-items:center;gap:12px;padding:0 0 12px}
.ydo-report-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:6px;overflow:hidden}
.ydo-report-seg-item{height:32px;padding:0 16px;border:0;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;cursor:pointer}
.ydo-report-seg-item.is-active{background:#3370ff;color:#fff}
.ydo-report-action{height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;cursor:pointer}
.ydo-report-action:disabled{opacity:.5;cursor:not-allowed}
.ydo-report-more{margin:12px auto 0;display:block}
.ydo-report-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;line-height:18px}
.ydo-report-pill-ok{background:#2ea121;color:#fff}
.ydo-report-pill-warn{background:#de7802;color:#fff}
.ydo-report-pill-err{background:#d83931;color:#fff}
.ydo-report-pill-busy,.ydo-report-pill-muted{background:var(--dsw-alias-bg-layer-2,#f5f6f7);color:var(--dsw-alias-label-secondary,#646a73)}
.ydo-report-note{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;max-width:280px}
.ydo-report-error-text{color:#d83931;font-size:12px}
.ydo-report-error{color:#d83931;font-size:13px}
.ydo-report-empty-line{color:var(--dsw-alias-label-secondary,#646a73);font-size:13px}
/* 报表页滚动容器：复用的 .ydo-right 是 overflow:hidden 的 grid（为作品 Tab 的四行结构设计），
   报表详情（头部+KPI+图表+明细+作品卡）远超一屏，必须自带纵向滚动，否则真机下半页不可达
   （2026-10-27 用户反馈）。display:block 覆盖 grid 行模板，内容自然流式排布。
   宽度固定 1180px：插件面板在宿主里随内容收缩，仅 max-width 会让列表页在有数据/
   空态两种内容宽度下面板收缩量不同、整体居中位移（2026-10-27 用户反馈日/周切换
   样式漂移），固定宽后三种状态（列表/空态/详情）宽度与位置恒定；窄窗口 max-width 兜底。 */
.ydo-report-page{display:block;overflow:auto;width:1180px;max-width:100%;margin:0 auto}
.ydo-report-toolbar{display:flex;align-items:center;gap:12px;padding-bottom:12px;flex-wrap:wrap}
.ydo-report-toolbar-actions{margin-left:auto;display:flex;align-items:center;gap:8px}
.ydo-report-busy{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
.ydo-report-version{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--dsw-alias-label-secondary,#646a73)}
.ydo-report-version select{height:30px;border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit}
.ydo-report-body{display:flex;flex-direction:column;gap:20px}
.ydo-report-header{border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:8px;padding:16px;background:var(--dsw-alias-bg-layer-1,#fff)}
.ydo-report-title{margin:0 0 6px;font-size:18px}
.ydo-report-meta{margin:0 0 8px;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;line-height:2.05}
.ydo-report-meta-line{min-width:0}
.ydo-report-meta-k{display:inline-block;margin-right:8px;padding:1px 8px;border-radius:4px;background:#eaf1ff;color:#3370ff;font-size:11px;font-weight:600}
.ydo-report-quality{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329)}
.ydo-report-quality-missing{color:#de7802}
.ydo-report-kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.ydo-report-kpi{border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:8px;padding:12px;background:var(--dsw-alias-bg-layer-1,#fff)}
.ydo-report-kpi-label{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
.ydo-report-kpi-value{margin-top:4px;font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}
/* 环比方向色（2026-10-26 用户定稿：涨红跌绿，不随 goodDirection 反转）。
   固定色值与验证页 demo UI（--ydo-danger/--ydo-up）一致：桌面宿主主题的
   --dsw-alias-* 变量是黑色系品牌色，走变量会把涨跌渲染成黑灰（真机实测）。
   注意：此处是 CSS 文本，注释必须用块注释，// 会让解析器连同下一条规则一起丢弃。 */
.ydo-report-kpi-change{margin-top:6px;font-size:12px;font-weight:650}
.ydo-report-kpi-change-up{color:#d64545}
.ydo-report-kpi-change-down{color:#1a7f37}
.ydo-report-kpi-change-flat{color:var(--dsw-alias-label-secondary,#646a73)}
.ydo-report-kpi-note{margin-top:4px;color:var(--dsw-alias-label-secondary,#646a73);font-size:11px}
/* 区块标题:蓝色竖杆 + 15px,与验证页 demo UI 的 .ydo-section h2 一致。 */
.ydo-report-section-title{margin:0 0 10px;padding-left:10px;border-left:3px solid #3370ff;font-size:15px}
.ydo-report-chart{margin:0;border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:8px;padding:12px;background:var(--dsw-alias-bg-layer-1,#fff)}
/* 趋势图高度锁定 240px(验证页口径):height:auto 会随容器变宽等比放大整图(1180 容器下约 1.2 倍),
   视觉过大不协调;锁定后窄容器仍等比缩小自适应,宽容器保持原生大小不再放大。 */
.ydo-report-chart-svg{width:100%;height:240px;display:block}
.ydo-report-chart-notes{display:grid;gap:2px;margin-bottom:8px;font-size:12px}
.ydo-report-chart-notes .ydo-report-meta-k{background:#eceef1;color:#646a73}
.ydo-report-chart-grid{stroke:var(--dsw-alias-border-l1,#e0e3e8);stroke-width:1}
.ydo-report-chart-text{fill:var(--dsw-alias-label-secondary,#646a73);font-size:11px}
/* 图表色（2026-10-27 用户定稿）：柱 = 蓝渐变（SVG 内 defs #ydo-report-bar-gradient），
   最新一期 = 实色深蓝 #2f6bff，净粉线/点 = 橙黄 #de7802（用户明确不要绿色，保留原橙黄）。
   不用宿主 --dsw-alias-brand-primary：桌面主题品牌色是黑色系，
   真机实测柱体被渲染成黑/灰。 */
.ydo-report-chart-bar{fill:url(#ydo-report-bar-gradient);opacity:.45}
.ydo-report-chart-bar-last{fill:#2f6bff;opacity:1}
.ydo-report-chart-bar-gap{opacity:.15}
.ydo-report-chart-line{stroke:#de7802;stroke-width:2}
.ydo-report-chart-dot{fill:#de7802}
.ydo-report-chart-tip{position:fixed;z-index:999;display:none;padding:6px 10px;border-radius:6px;background:var(--dsw-alias-label-primary,#1f2329);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:12px;line-height:1.5;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.18)}
.ydo-report-chart-empty{margin-top:8px;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
.ydo-report-table-wrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff)}
.ydo-report-table{width:100%;border-collapse:collapse;font-size:13px;min-width:720px}
.ydo-report-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2,#f5f6f7);color:var(--dsw-alias-label-secondary,#646a73);font-weight:650;text-align:left;padding:8px 12px;white-space:nowrap}
.ydo-report-table td{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1,#e0e3e8);font-variant-numeric:tabular-nums;min-width:0}
.ydo-report-cell-main{font-weight:650}
/* 2026-10-26 涨红跌绿定稿（与 KPI 卡 change-up/down 同色，固定色值不随主题） */
.ydo-report-up{color:#d64545;font-weight:650}
.ydo-report-down{color:#1a7f37;font-weight:650}
.ydo-report-mark{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#de7802;color:#fff;font-size:11px;font-weight:400}
/* auto-fit:卡片数不足一行时折叠空轨道、现有卡片拉伸填满整行(demo UI 口径,
   auto-fill 会保留空轨道导致卡片挤在左侧、右侧大片留白,真机反馈 UX 差)。 */
.ydo-report-works{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.ydo-report-work-card{border:1px solid var(--dsw-alias-border-l1,#e0e3e8);border-radius:8px;padding:12px;background:var(--dsw-alias-bg-layer-1,#fff)}
.ydo-report-work-head{display:flex;align-items:center;gap:8px}
.ydo-report-work-head strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.ydo-report-work-account{color:var(--dsw-alias-label-secondary,#646a73);font-size:11px}
.ydo-report-pill-hot{background:#d83931;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px}
.ydo-report-work-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:10px 0 6px}
.ydo-report-work-metrics dt{color:var(--dsw-alias-label-secondary,#646a73);font-size:11px}
.ydo-report-work-metrics dd{margin:0;font-size:14px;font-weight:650;font-variant-numeric:tabular-nums}
.ydo-report-work-secondary{display:flex;flex-wrap:wrap;gap:8px;color:var(--dsw-alias-label-secondary,#646a73);font-size:11px}
.ydo-report-work-progress{margin-top:8px;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f5f6f7);overflow:hidden}
.ydo-report-work-progress-bar{height:100%;border-radius:999px;background:#3370ff}
.ydo-report-anomalies{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.ydo-report-anomaly{border-radius:8px;padding:10px 12px;font-size:13px}
.ydo-report-anomaly strong{margin-right:8px}
.ydo-report-anomaly-gap{background:color-mix(in srgb,#de7802 12%,transparent);color:#de7802}
.ydo-report-anomaly-business{background:color-mix(in srgb,#d83931 10%,transparent);color:#d83931}
.ydo-report-ai-summary{margin:0 0 10px;font-size:13px;font-weight:650}
/* AI 洞察三列(demo UI 口径):列去边框白底,条目按类型着色——
   事实淡绿 #f0f7f1 / 推断淡蓝 #eaf1ff / 建议淡橙 #fff7ed;标题 700 与正文分级突出内容。 */
.ydo-report-insight-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.ydo-report-insight-col{display:grid;gap:10px;align-content:start;min-width:0;padding:12px;border-radius:8px}
.ydo-report-insight-col-fact{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 10%,transparent)}
.ydo-report-insight-col-infer{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3370ff) 10%,transparent)}
.ydo-report-insight-col-advice{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#de7802) 10%,transparent)}
.ydo-report-insight-col h4{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary,#646a73)}
.ydo-report-insight-item{padding:12px;border-radius:8px;font-size:13px;line-height:1.7}
.ydo-report-insight-col-fact .ydo-report-insight-item{background:#f0f7f1}
.ydo-report-insight-col-infer .ydo-report-insight-item{background:#eaf1ff}
.ydo-report-insight-col-advice .ydo-report-insight-item{background:#fff7ed}
.ydo-report-insight-item h5{margin:0 0 4px;font-size:13px;font-weight:700;color:#1f2329;display:flex;align-items:center;gap:6px}
.ydo-report-insight-item p{margin:0;font-size:13px;line-height:1.7;color:#1f2329}
.ydo-report-insight-evidence{display:block;color:var(--dsw-alias-label-secondary,#646a73);font-size:11px;margin:6px 0 0;line-height:1.6}
/* 紧凑速读形态(2026-10-27 方案 A+B):行内标题+徽标,detail/evidence 收进 <details> 折叠区 */
.ydo-report-insight-list{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.ydo-report-insight-line{display:flex;align-items:flex-start;gap:6px;font-size:13px;line-height:1.6}
.ydo-report-insight-title{font-weight:650;color:var(--dsw-alias-label-primary,#1f2329)}
.ydo-report-insight-line .ydo-report-badge{flex:none;margin-left:auto}
.ydo-report-ai-more{margin-top:10px;border-top:1px dashed color-mix(in srgb,var(--dsw-alias-label-secondary,#646a73) 40%,transparent);padding-top:8px;font-size:12px}
.ydo-report-ai-more summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73);user-select:none}
.ydo-report-ai-more-item{margin:10px 0 0;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,#f2f3f5)}
.ydo-report-ai-more-item b{display:block;margin-bottom:2px}
.ydo-report-ai-more-item p{margin:2px 0 0;line-height:1.6;color:var(--dsw-alias-label-primary,#1f2329)}
.ydo-report-badge{border-radius:999px;padding:1px 6px;font-size:10px;font-weight:400}
.ydo-report-badge-high{background:#d83931;color:#fff}
.ydo-report-badge-medium{background:#de7802;color:#fff}
.ydo-report-badge-low{background:var(--dsw-alias-bg-layer-2,#f5f6f7);color:var(--dsw-alias-label-secondary,#646a73)}
.ydo-report-insufficient{border:1px dashed #dee0e3;border-radius:8px;padding:32px;text-align:center;background:#fff}
.ydo-report-insufficient-icon{font-size:28px;margin:0 0 8px}
.ydo-report-signal-list{margin:12px 0;padding:0;list-style:none;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
@media print{.no-print{display:none!important}.ydo-report-kpi,.ydo-report-work-card,.ydo-report-insight-col,.ydo-report-chart{break-inside:avoid}.ydo-report-table-wrap{min-width:0;overflow:visible}.ydo-report-ai-more>summary{display:none!important}}
`
