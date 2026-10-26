// AI 报表 UI 测试（RQ-2026-006 测试验收文档 §4，TF-01~TF-15）。
//
// 渲染方式与 select-ui.test.mjs 同法：剥离 export 后在 vm 上下文求值，
// createElement 返回普通对象树，再递归断言。TF-02/TF-11/TF-12 的宿主接线
// （action 契约/两级导航不重发请求/轮询间隔）以源码断言兜底（与 plugin.test.mjs
// 的既有做法一致），渲染冒烟由 render-smoke.test.mjs 真实 React 渲染兜底。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../src/report-ui.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '')

const context = {
  require: name => {
    assert.equal(name, 'react')
    return { createElement: (type, props, ...children) => ({ type, props, children }) }
  },
}
vm.createContext(context)
vm.runInContext(source, context)
const {
  REPORT_ERROR_REASON_COPY,
  REPORT_CSS_TEXT,
  AccountTable,
  AnomalyList,
  InsightGrid,
  ReportKpiCard,
  QualityBar,
  ReportDetailView,
  ReportListView,
  ReportTrendChart,
  WorkCards,
  changePctText,
  formatPeriodFileStem,
  formatPeriodTitle,
  kpiChangeKind,
  lineRange,
  niceMax,
  reportErrorCopy,
  reportStatusPill,
  serializeReportHtml,
  trendSeriesShape,
} = vm.runInContext(
  '({ REPORT_ERROR_REASON_COPY, REPORT_CSS_TEXT, AccountTable, AnomalyList, InsightGrid, ReportKpiCard, '
  + 'QualityBar, ReportDetailView, ReportListView, ReportTrendChart, WorkCards, changePctText, '
  + 'formatPeriodFileStem, formatPeriodTitle, kpiChangeKind, lineRange, niceMax, reportErrorCopy, '
  + 'reportStatusPill, serializeReportHtml, trendSeriesShape })',
  context,
)

const treeText = node => {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(treeText).join('')
  // fake createElement 不执行函数组件：文本断言按需展开一层（报表组件无 hooks）。
  if (typeof node.type === 'function') return treeText(node.type({ ...(node.props || {}) }))
  if (node.children) return treeText(node.children)
  return ''
}

const findAll = (node, predicate, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) findAll(child, predicate, out)
  return out
}

const SAMPLE_METRIC = {
  key: 'plays', label: '播放增量', value: 128456, prevValue: 114286,
  changePct: 12.4, available: true, goodDirection: 'up', note: null,
}

// ---------------------------------------------------------------------------
// TF-01 工具白名单 / TF-02 action 契约（源码断言，防漂移）
// ---------------------------------------------------------------------------

test('TF-01 TOOL_NAMES 含 3 个报表工具且错误码白名单含 13 个 REPORT 稳定码', async () => {
  const toolsClient = await readFile(new URL('../src/tools-client.js', import.meta.url), 'utf8')
  for (const name of ['douyin_report_list', 'douyin_report_get', 'douyin_report_regenerate']) {
    assert.ok(toolsClient.includes(`'${name}'`), name)
  }
  for (const code of [
    'REPORT_NOT_FOUND', 'REPORT_DISABLED', 'REPORT_INSUFFICIENT_DATA', 'REPORT_MODEL_FAILED',
    'REPORT_SCHEMA_INVALID', 'REPORT_TIMEOUT', 'REPORT_TRUNCATED', 'REPORT_INPUT_TOO_LARGE',
    'REPORT_PAYLOAD_TOO_LARGE', 'REPORT_ENQUEUE_FAILED', 'REPORT_MODEL_CONFIG_MISSING',
    'REPORT_LEASE_EXPIRED',
  ]) {
    assert.ok(toolsClient.includes(`'${code}'`), code)
  }
  // 幂等键模板工厂与服务端模板一致
  assert.ok(toolsClient.includes('douyin:report_regenerate:'))
})

test('TF-02 index.js 登记 report.list/get/regenerate action 且键模板校验两段结构', async () => {
  const index = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  for (const action of ['report.list', 'report.get', 'report.regenerate']) {
    assert.ok(index.includes(`'${action}'`), action)
  }
  assert.match(index, /douyin_report_list'/)
  assert.match(index, /douyin_report_get'/)
  assert.match(index, /douyin_report_regenerate'/)
  assert.match(index, /REPORT_REGENERATE_KEY_PATTERN/)
  assert.match(index, /douyin:report_regenerate:/)
})

// ---------------------------------------------------------------------------
// TF-03 / TF-04 KPI 卡
// ---------------------------------------------------------------------------

test('TF-03 KPI available=false 或 value=null → 值 — 且无箭头', () => {
  const missing = ReportKpiCard({ metric: { ...SAMPLE_METRIC, value: null, available: false, changePct: null, prevValue: null } })
  const text = treeText(missing)
  assert.ok(text.includes('—'))
  assert.ok(!text.includes('▲') && !text.includes('▼'))
  assert.ok(!text.includes('128,456'))
})

test('TF-04 环比方向色（2026-10-26 用户定稿）：统一上涨红、下跌绿；delta 注明对比基准', () => {
  // 统一方向色：不再按 goodDirection 反转
  assert.equal(kpiChangeKind({ changePct: 12.4, goodDirection: 'up' }), 'up')
  assert.equal(kpiChangeKind({ changePct: -3, goodDirection: 'up' }), 'down')
  assert.equal(kpiChangeKind({ changePct: -3, goodDirection: 'down' }), 'down')
  assert.equal(kpiChangeKind({ changePct: 5, goodDirection: 'down' }), 'up')
  assert.equal(kpiChangeKind({ changePct: null }), 'flat')
  assert.equal(kpiChangeKind({ changePct: 0 }), 'flat')
  assert.equal(changePctText(12.4), '▲12.4%')
  assert.equal(changePctText(-3), '▼3.0%')
  assert.equal(changePctText(null), null)
  // delta 前缀注明对比基准：日报「较昨日」、周报「较上周」
  const dailyCard = ReportKpiCard({ metric: SAMPLE_METRIC, reportType: 'daily' })
  assert.ok(treeText(dailyCard).includes('较昨日 ▲12.4%'))
  assert.ok(treeText(dailyCard).includes('上期 11.4万'))
  const weeklyCard = ReportKpiCard({ metric: { ...SAMPLE_METRIC, changePct: -5.3 }, reportType: 'weekly' })
  assert.ok(treeText(weeklyCard).includes('较上周 ▼5.3%'))
  // 无环比基准（如矩阵总粉丝）→ 灰色「较昨日 无对比基准」
  const flatCard = ReportKpiCard({ metric: { key: 'totalFans', label: '矩阵总粉丝', value: 46209, available: true, changePct: null, prevValue: null }, reportType: 'daily' })
  assert.ok(treeText(flatCard).includes('无对比基准'))
})

// ---------------------------------------------------------------------------
// TF-05 账号明细（无收藏列；缺采 —*）
// ---------------------------------------------------------------------------

test('TF-05 账号表无收藏列；eachAvailable=false 指标列 —*；marks 角标渲染', () => {
  const table = AccountTable({
    accounts: [
      {
        accountId: 'a1', nickname: '账号一', sessionStatus: 'ok', fanCount: 100,
        metrics: { plays: 500, netFans: 3, publishes: 1, likes: 10, comments: 2, shares: 1 },
        eachAvailable: true, marks: ['连续2日掉粉'],
      },
      {
        accountId: 'a2', nickname: '缺采号', sessionStatus: 'expired', fanCount: null,
        metrics: {}, eachAvailable: false, marks: [],
      },
    ],
  })
  const headers = findAll(table, node => node.type === 'th').map(node => treeText(node))
  // 2026-10-26 用户反馈:明细去掉「会话」列(会话过期以账号名角标呈现)
  assert.deepEqual(headers, ['账号', '现有粉丝', '播放增量', '净增粉丝', '发布', '点赞', '评论', '分享'])
  assert.ok(!headers.includes('收藏') && !headers.includes('会话'))
  const text = treeText(table)
  assert.ok(text.includes('—*'))
  assert.ok(text.includes('连续2日掉粉'))
  assert.ok(text.includes('会话过期'))
  assert.ok(text.includes('500'))
})

// ---------------------------------------------------------------------------
// TF-06 作品卡 / TF-08 AI 三分区
// ---------------------------------------------------------------------------

test('TF-06 作品卡：isHot pill、完播条宽度=completion5s、fansGain、作品级收藏', () => {
  const cards = WorkCards({
    works: [
      {
        workId: 'w1', accountId: 'a1', nickname: '账号一', title: '爆款视频', isHot: true,
        metrics: { plays: 120000, likes: 900, comments: 100, collects: 55, shares: 80, fansGain: 88, completion5s: 51.2 },
      },
      {
        workId: 'w2', accountId: 'a1', nickname: '账号一', title: '普通视频', isHot: false,
        metrics: { plays: 10, likes: 1, comments: null, collects: null, shares: null, fansGain: null, completion5s: null },
      },
    ],
  })
  const text = treeText(cards)
  assert.ok(text.includes('爆款'))
  assert.ok(text.includes('爆款视频'))
  assert.ok(text.includes('带粉'))
  assert.ok(text.includes('88'))
  assert.ok(text.includes('收藏 55'))
  assert.ok(text.includes('5s 完播 51.2%'))
  const bars = findAll(cards, node => node.props?.className === 'ydo-report-work-progress-bar')
  assert.equal(bars.length, 1)
  assert.equal(bars[0].props.style.width, '51.2%')
})

test('TF-08 AI 三分区：列/徽标/evidence 灰字/limitations 追加事实列', () => {
  const grid = InsightGrid({
    ai: {
      summary: '整体平稳。',
      facts: [{ title: '事实', detail: '播放 500', evidence: '播放 500' }],
      inferences: [{ title: '推断', detail: '缺口', evidence: '播放回落', confidence: 'high' }],
      recommendations: [{ title: '建议', detail: '补采', priority: 'high' }],
      limitations: ['2 个账号会话过期'],
    },
  })
  const cols = findAll(grid, node => node.props?.className === 'ydo-report-insight-col')
  assert.equal(cols.length, 3)
  const text = treeText(grid)
  assert.ok(text.includes('事实') && text.includes('推断') && text.includes('建议'))
  assert.ok(text.includes('高置信') && text.includes('高优先'))
  assert.ok(text.includes('依据：播放 500'))
  assert.ok(text.includes('2 个账号会话过期'))
  const evidence = findAll(grid, node => node.props?.className === 'ydo-report-insight-evidence')
  assert.ok(evidence.length >= 3)
  assert.ok(!treeText(grid).includes('confidence'))
})

// ---------------------------------------------------------------------------
// TF-07 TrendChart（含退化规则）
// ---------------------------------------------------------------------------

test('TF-07a 趋势图：7/4 长度、null 柱 0 高、线断开两个 M 段、末位实色类', () => {
  const series = {
    days: ['10-16', '10-17', '10-18', '10-19', '10-20', '10-21', '10-22'],
    bars: [100, null, 300, 200, null, 400, 500],
    line: [5, null, 7, null, 3, 4, 9],
  }
  assert.equal(trendSeriesShape(series).barsAllEmpty, false)
  const chart = ReportTrendChart({ series, title: '近 7 天播放增量与净增粉丝（7 天）' })
  const svg = findAll(chart, node => node.type === 'svg')[0]
  const bars = findAll(svg, node => node.type === 'rect')
  assert.equal(bars.length, 7)
  const nullBar = bars[1]
  assert.equal(nullBar.props.height, 0)
  assert.ok(String(nullBar.props.className).includes('ydo-report-chart-bar-gap'))
  const lastBar = bars[6]
  assert.ok(String(lastBar.props.className).includes('ydo-report-chart-bar-last'))
  const path = findAll(svg, node => node.type === 'path')[0]
  // [5] | [7] | [3,4,9]：两处 null 各断开一次 → 3 个 M 起笔段
  assert.equal([...String(path.props.d)].filter(ch => ch === 'M').length, 3)
  assert.ok(treeText(chart).includes('10-16') && treeText(chart).includes('10-22'))
  // 周报 4 周
  const weekly = ReportTrendChart({ series: { days: ['09-21', '09-28', '10-05', '10-12'], bars: [null, null, 110, null], line: [null, null, 2, null] } })
  assert.equal(findAll(weekly, node => node.type === 'rect').length, 4)
})

test('TF-07b 退化：bars 全 null/全 0 → maxBar=1 + 「无有效播放数据」标注', () => {
  assert.equal(niceMax([null, null]), 1)
  assert.equal(niceMax([0, 0]), 1)
  assert.equal(niceMax([500, 1200, 300]), 2000)
  assert.equal(trendSeriesShape({ bars: [null, null], line: [] }).barsAllEmpty, true)
  const chart = ReportTrendChart({ series: { days: ['10-21', '10-22'], bars: [null, null], line: [null, null] } })
  assert.ok(treeText(chart).includes('无有效播放数据'))
  // line 全 null → 只画柱（无 path）
  assert.equal(findAll(chart, node => node.type === 'path').length, 0)
})

test('TF-07c 退化：line 单点或 min==max → ±1 padding 可渲染', () => {
  const single = lineRange([5])
  assert.equal(single.min, 4)
  assert.equal(single.max, 6)
  const flat = lineRange([3, 3, 3])
  assert.equal(flat.min, 2)
  assert.equal(flat.max, 4)
  const range = lineRange([2, 10])
  assert.ok(range.min < 2 && range.max > 10)
  const shape = trendSeriesShape({ bars: [1], line: [5, 5] })
  assert.equal(shape.lineDrawable, false)
  assert.equal(shape.lineSingle, true)
  const chart = ReportTrendChart({ series: { days: ['a', 'b'], bars: [1, 2], line: [5, 5] } })
  assert.ok(treeText(chart).includes('净增粉丝趋势点不足'))
})

// ---------------------------------------------------------------------------
// TF-09 / TF-10 / TF-15 列表页 / 详情页 / 空态
// ---------------------------------------------------------------------------

const buildReport = () => ({
  reportId: 'r1', reportType: 'daily', status: 'succeeded', version: 2, isCurrent: true,
  outputSchemaVersion: 'report-daily-v1', errorCode: null,
  resultJson: {
    data: {
      period: { type: 'daily', start: '2026-10-22', end: '2026-10-23' },
      generatedAt: '2026-10-23T03:00:00+00:00',
      coverage: { totalAccounts: 5, coveredAccounts: 4, lastCollectedAt: '2026-10-23T02:00:00+00:00', missingAccounts: [] },
      coreMetrics: [SAMPLE_METRIC],
      accounts: [],
      works: [],
      anomalies: [{ type: 'data_gap', severity: 'high', message: '账号「缺采号」会话过期', accountId: 'a2', metricKey: null }],
      trendSeries: { days: ['a', 'b'], bars: [1, 2], line: [1, 2] },
    },
    ai: { summary: '平稳。', facts: [{ title: 't', detail: 'd', evidence: 'e' }], inferences: [{ title: 't', detail: 'd', confidence: 'low' }], recommendations: [{ title: 't', detail: 'd', priority: 'low' }], limitations: [] },
  },
})

test('TF-09 详情页不渲染技术元数据（model/promptVersion/schemaVersion/inputHash）', () => {
  const report = { ...buildReport(), model: 'minimax-m3', promptVersion: 'report-v1', inputSnapshotHash: 'a'.repeat(64), attemptCount: 3 }
  const view = ReportDetailView({ report, loading: false, errorReason: null, regenerating: false, versions: [], actions: {} })
  const text = treeText(view)
  assert.ok(!text.includes('minimax-m3'))
  assert.ok(!text.includes('report-v1'))
  assert.ok(!text.includes('report-daily-v1'))
  assert.ok(!text.includes('a'.repeat(64)))
  assert.ok(!text.includes('attemptCount'))
})

test('TF-10 列表页：状态 pill/版本/覆盖/失败行中文 note（不出现原始英文码）', () => {
  const view = ReportListView({
    items: [
      { reportId: 'r1', reportType: 'daily', periodStart: '2026-10-22', periodEnd: '2026-10-23', status: 'succeeded', version: 1, isCurrent: true, coverageSummary: { totalAccounts: 5, coveredAccounts: 4 }, summary: '结论' },
      { reportId: 'r2', reportType: 'daily', periodStart: '2026-10-21', periodEnd: '2026-10-22', status: 'failed', version: 1, isCurrent: true, coverageSummary: null, errorCode: 'REPORT_TIMEOUT' },
      { reportId: 'r3', reportType: 'daily', periodStart: '2026-10-20', periodEnd: '2026-10-21', status: 'running', version: 1, isCurrent: true, coverageSummary: null },
    ],
    loading: false, errorReason: null, reportType: 'daily', actions: {}, t: key => key,
  })
  assert.equal(reportStatusPill('succeeded').kind, 'ok')
  assert.equal(reportStatusPill('insufficient').kind, 'warn')
  assert.equal(reportStatusPill('failed').kind, 'err')
  assert.equal(reportStatusPill('running').kind, 'busy')
  const text = treeText(view)
  assert.ok(text.includes('日报 · 2026-10-22'))
  assert.ok(text.includes('v1'))
  assert.ok(text.includes('4/5'))
  assert.ok(text.includes('AI 生成超时，请稍后重试'))
  assert.ok(!text.includes('REPORT_TIMEOUT'))
  assert.ok(text.includes('生成中'))
})

test('TF-15 insufficient 空态：图标 + 四信号检查 + 重新生成入口', () => {
  const report = {
    status: 'insufficient', errorCode: 'REPORT_INSUFFICIENT_DATA', resultJson: null,
    coverageSummary: { totalAccounts: 5, coveredAccounts: 0, signals: { dailyRows: 0, workSnapshotRows: 0, fansProfileRows: 0, periodWorks: 0 } },
  }
  const view = ReportDetailView({
    report, loading: false, errorReason: null, regenerating: false, versions: [],
    actions: { onRegenerate: () => {} },
  })
  const text = treeText(view)
  assert.ok(text.includes('周期内所有账号均无数据'))
  assert.ok(text.includes('账号日度行'))
  assert.ok(text.includes('作品快照行'))
  assert.ok(text.includes('粉丝画像行'))
  assert.ok(text.includes('周期内发布作品'))
  assert.ok(text.includes('重新生成'))
})

// ---------------------------------------------------------------------------
// TF-13 导出 HTML / TF-14 错误文案字典
// ---------------------------------------------------------------------------

test('TF-13 导出 HTML：自包含单文件、无外部 http(s) 资源、无 .no-print、文件名规范', () => {
  const report = buildReport()
  const view = ReportDetailView({ report, loading: false, errorReason: null, regenerating: false, versions: [], actions: {} })
  const fakeDom = {
    outerHTML: '<div class="ydo-report-render"><div class="ydo-report-body"><h2 class="ydo-report-title">日报 · 2026-10-22</h2></div></div>',
    querySelector: () => null,
  }
  const html = serializeReportHtml(fakeDom, REPORT_CSS_TEXT)
  assert.ok(html.includes('</html>'))
  assert.ok(html.includes('日报 · 2026-10-22'))
  assert.ok(!/https?:\/\//.test(html))
  assert.ok(!html.includes('no-print" class') && !html.includes('class="no-print'))
  assert.ok(html.includes('@media print'))
  assert.ok(html.includes('ydo-report-kpi'))
  assert.equal(formatPeriodFileStem({ type: 'daily', start: '2026-10-22', end: '2026-10-23' }), '抖音运营日报_2026-10-22')
  assert.equal(formatPeriodFileStem({ type: 'weekly', start: '2026-10-12', end: '2026-10-19' }), '抖音运营周报_2026-10-12~2026-10-18')
  assert.equal(formatPeriodTitle({ type: 'weekly', start: '2026-10-12', end: '2026-10-19' }), '周报 · 2026-10-12 ~ 2026-10-18')
})

test('TF-14 17 个错误码均有中文文案（无 undefined），CSS 常量非空', () => {
  // 13 个 REPORT_* 稳定码（含阶段 B review 补登的 REPORT_PROMPT_INVALID）
  // + 全域通用 IDEMPOTENCY_CONFLICT / INVALID_IDEMPOTENCY_KEY / INVALID_CURSOR /
  // VALIDATION_ERROR。
  const codes = [
    'REPORT_NOT_FOUND', 'REPORT_DISABLED', 'REPORT_INSUFFICIENT_DATA', 'REPORT_MODEL_FAILED',
    'REPORT_SCHEMA_INVALID', 'REPORT_TIMEOUT', 'REPORT_TRUNCATED', 'REPORT_INPUT_TOO_LARGE',
    'REPORT_PAYLOAD_TOO_LARGE', 'REPORT_ENQUEUE_FAILED', 'REPORT_MODEL_CONFIG_MISSING',
    'REPORT_LEASE_EXPIRED', 'REPORT_PROMPT_INVALID',
    'IDEMPOTENCY_CONFLICT', 'INVALID_IDEMPOTENCY_KEY', 'INVALID_CURSOR', 'VALIDATION_ERROR',
  ]
  for (const code of codes) {
    assert.equal(typeof REPORT_ERROR_REASON_COPY[code], 'string', code)
    assert.ok(REPORT_ERROR_REASON_COPY[code].length > 0, code)
    assert.ok(!/[A-Z_]{6,}/.test(REPORT_ERROR_REASON_COPY[code]), `${code} 文案不应含原始码`)
  }
  assert.equal(reportErrorCopy('UNKNOWN_FUTURE_CODE'), '请求失败，请稍后重试')
  assert.ok(REPORT_CSS_TEXT.includes('.ydo-report-kpi'))
  assert.ok(REPORT_CSS_TEXT.includes('@media print'))
  assert.ok(!/https?:\/\//.test(REPORT_CSS_TEXT))
})

// ---------------------------------------------------------------------------
// TF-11 / TF-12 宿主接线（client.js 源码断言：两级导航不重发/轮询节奏）
// ---------------------------------------------------------------------------

test('TF-11/TF-12 client.js：两级导航返回保留列表、详情轮询 5s 且终态/离开停止', async () => {
  const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // 返回列表：backToReportList 只清 detail，不触发 report.list
  assert.match(client, /const backToReportList = useCallback/)
  assert.ok(!/backToReportList[\s\S]{0,400}report\.list/.test(client))
  // 轮询：pending/running 每 5s 经 fetchDetail（report.get）刷新；终态停止；卸载清理
  assert.match(client, /const fetchDetail = async \(\{ silent = false \} = \{\}\) => \{[\s\S]{0,400}action: 'report\.get', reportId \}/)
  assert.match(client, /reportPollRef\.current = setInterval\(/)
  assert.match(client, /, 5000\)/)
  assert.match(client, /stopPolling\(reportPollRef\)/)
  assert.match(client, /latest\.status !== 'pending' && latest\.status !== 'running'/)
  // seg 切换仅作用于列表：类型变化重新请求 list
  assert.match(client, /action: 'report\.list', reportType, limit: 20/)
})
