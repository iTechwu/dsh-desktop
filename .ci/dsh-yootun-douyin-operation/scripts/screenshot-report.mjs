// 抖音运营 RQ-2026-006 AI 报表 · Playwright 截图验收脚本。
//
// 用法：node scripts/screenshot-report.mjs [输出目录]
//（默认 docs/1023/douyin/screenshots）。
// 机制与 screenshot.mjs（1015）同法：Node 侧用 react-dom/server 把报表 UI 区块
// （列表页 / 日报详情 / 周报详情 / 数据不足空态）SSR 成静态 HTML（内联插件真实
// CSS + DSW 变量兜底），Playwright 系统 Chrome 无头截图。
//
// 截图数据是**脱敏占位 fixture**（结构 = result_json 真实契约、数值占位、昵称
// 脱敏为示例账号），与 docs/1015/douyin/fixtures 的脱敏原则一致；样式验证以
// docs/1023/douyin/RQ-2026-006_AI报表UI-demo.html 定稿样式为目标。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

import { loadPlaywrightDriver, resolveSystemChrome } from '../src/chrome.js'

const React_ = React.default ?? React
const h = (type, props, ...children) => React_.createElement(type, props ?? null, ...children)

const pluginPath = new URL('../lib/client.js', import.meta.url)

const DSW_FALLBACK_CSS = `:root{
  --dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#f6f7f9;--dsw-alias-bg-layer-2:#eceef1;
  --dsw-alias-border-l1:#e0e3e8;--dsw-alias-border-l2:#d4d8de;
  --dsw-alias-label-primary:#1f2329;--dsw-alias-label-secondary:#646a73;
  --dsw-alias-label-primary-foreground:#ffffff;--dsw-alias-brand-primary:#3370ff;
  --dsw-alias-state-success-primary:#1a7f37;--dsw-alias-state-error-primary:#d03a3a;
  --dsw-alias-state-warn-primary:#d29922;
  --dsw-font-l-20-font-size:20px;--dsw-font-base-16-font-size:16px;
  --dsh-content-font-size:14px;--dsh-content-font-size-secondary:13px;
}
*{box-sizing:border-box}
body{margin:0;font-family:'Noto Sans CJK SC','Source Han Sans SC','Microsoft YaHei',sans-serif;background:#fff;color:#1f2329}
.screenshot-block{padding:24px;border-bottom:16px solid #d4d8de}
.screenshot-title{margin:0 0 4px;font-size:18px;font-weight:700}
.screenshot-sub{margin:0 0 16px;color:#646a73;font-size:13px}
`

function zhDictionary(plugin) {
  const dict = plugin.copy && plugin.copy.zh ? plugin.copy.zh : {}
  return key => (key in dict ? dict[key] : key)
}

// ---------------------------------------------------------------------------
// 脱敏 fixture（result_json 契约形态）
// ---------------------------------------------------------------------------

const dailyData = {
  period: { type: 'daily', start: '2026-10-22', end: '2026-10-23' },
  generatedAt: '2026-10-23T03:00:00+00:00',
  coverage: {
    totalAccounts: 5,
    coveredAccounts: 4,
    lastCollectedAt: '2026-10-23T02:42:00+00:00',
    missingAccounts: [
      { accountId: 'acc-e', nickname: '示例账号戊', reason: 'session_expired', lastCollectedAt: '2026-10-18T02:00:00+00:00' },
    ],
    checkedAt: '2026-10-23T03:00:10+00:00',
    signals: { dailyRows: 4, workSnapshotRows: 273, fansProfileRows: 4, periodWorks: 3 },
  },
  coreMetrics: [
    { key: 'plays', label: '播放增量', value: 128456, prevValue: 114286, changePct: 12.4, available: true, goodDirection: 'up', note: null },
    { key: 'netFans', label: '净增粉丝', value: 318, prevValue: 402, changePct: -5.3, available: true, goodDirection: 'up', note: null },
    { key: 'interactions', label: '互动总量', value: 1728, prevValue: 1598, changePct: 8.1, available: true, goodDirection: 'up', note: null },
    { key: 'interactionRate', label: '互动率', value: 1.3, prevValue: 1.2, changePct: 8.1, available: true, goodDirection: 'up', note: null },
    { key: 'publishes', label: '发布', value: 3, prevValue: 3, changePct: 0, available: true, goodDirection: 'up', note: null },
    { key: 'totalFans', label: '矩阵总粉丝', value: 46209, prevValue: null, changePct: null, available: true, goodDirection: 'up', note: null },
  ],
  accounts: [
    { accountId: 'acc-a', nickname: '示例账号甲', sessionStatus: 'ok', fanCount: 18420, metrics: { plays: 96214, netFans: 182, publishes: 1, likes: 1120, comments: 52, shares: 148 }, eachAvailable: true, marks: [] },
    { accountId: 'acc-b', nickname: '示例账号乙', sessionStatus: 'ok', fanCount: 12655, metrics: { plays: 21038, netFans: 96, publishes: 1, likes: 240, comments: 28, shares: 64 }, eachAvailable: true, marks: [] },
    { accountId: 'acc-c', nickname: '示例账号丙', sessionStatus: 'ok', fanCount: 8940, metrics: { plays: 9842, netFans: -21, publishes: 1, likes: 52, comments: 6, shares: 10 }, eachAvailable: true, marks: ['连续2日掉粉'] },
    { accountId: 'acc-d', nickname: '示例账号丁', sessionStatus: 'ok', fanCount: 6152, metrics: { plays: 1362, netFans: 61, publishes: 0, likes: 8, comments: 0, shares: 0 }, eachAvailable: true, marks: ['7天未发布'] },
    { accountId: 'acc-e', nickname: '示例账号戊', sessionStatus: 'expired', fanCount: 42, metrics: {}, eachAvailable: false, marks: [] },
  ],
  works: [
    { workId: 'w-1', accountId: 'acc-a', nickname: '示例账号甲', title: '示例作品一：公路养护作业全流程演示', publishTime: '2026-10-22T10:26:00+00:00', metrics: { plays: 101000, likes: 1120, comments: 52, collects: 310, shares: 148, fansGain: 158, completion5s: 69.9, bounce2s: 18.2, avgWatchSeconds: 6.3, viewProgress: 41.2 }, isHot: true },
    { workId: 'w-2', accountId: 'acc-b', nickname: '示例账号乙', title: '示例作品二：5W 左右值得买的小钢炮演示', publishTime: '2026-10-22T09:42:00+00:00', metrics: { plays: 8420, likes: 240, comments: 28, collects: 64, shares: 22, fansGain: 36, completion5s: 42.7, bounce2s: 26.1, avgWatchSeconds: 11.0, viewProgress: 33.5 }, isHot: false },
    { workId: 'w-3', accountId: 'acc-c', nickname: '示例账号丙', title: '示例作品三：贴膜三天后起泡怎么救', publishTime: '2026-10-22T12:11:00+00:00', metrics: { plays: 1530, likes: 52, comments: 6, collects: 9, shares: 4, fansGain: 2, completion5s: 31.2, bounce2s: 38.9, avgWatchSeconds: 5.4, viewProgress: 22.8 }, isHot: false },
  ],
  worksOmittedCount: 0,
  anomalies: [
    { type: 'data_gap', severity: 'high', message: '账号「示例账号戊」会话过期，近期数据可能缺失', accountId: 'acc-e', metricKey: null },
    { type: 'business', severity: 'medium', message: '账号「示例账号丙」连续 2 日净掉粉', accountId: 'acc-c', metricKey: 'netFans' },
    { type: 'business', severity: 'low', message: '账号「示例账号丁」已 7 天未发布作品', accountId: 'acc-d', metricKey: 'publishes' },
  ],
  trendSeries: {
    days: ['10-16', '10-17', '10-18', '10-19', '10-20', '10-21', '10-22'],
    bars: [86000, 92400, null, 78800, 102400, 114286, 128456],
    line: [210, null, 180, 96, 240, 402, 318],
  },
}

const dailyAi = {
  summary: '矩阵播放增量 128,456 创近 7 日新高，主要由示例账号甲新发作品贡献；示例账号戊会话过期导致明细缺口。',
  facts: [
    { title: '播放创近 7 日新高', detail: '10-22 播放增量 128,456，环比 +12.4%；主要由示例账号甲新发作品贡献。', evidence: '播放增量 128,456，环比 +12.4%' },
    { title: '互动率健康', detail: '互动总量 1,728（赞+评+转），互动率 1.3%，环比 +8.1%。', evidence: '互动总量 1,728，环比 +8.1%' },
  ],
  inferences: [
    { title: '示例作品一的开头结构有效', detail: '5s 完播 69.9%、带粉 +158，显著高于矩阵均值；推测与提问式标题有关，证据不足需更多样本。', evidence: '5s 完播 69.9%，带粉 +158', confidence: 'medium' },
    { title: '示例账号丙掉粉通道', detail: '连续两日净掉粉但播放不低，推测与选题偏移相关，需结合评论验证。', evidence: '连续 2 日净掉粉', confidence: 'low' },
  ],
  recommendations: [
    { title: '修复示例账号戊采集', detail: '重新扫码登录并执行采集回补，日报缺口回补后可重新生成新版本复核。', priority: 'high' },
    { title: '同结构选题加更', detail: '示例账号甲乘势追加同系列选题，并在评论区置顶引导收藏。', priority: 'high' },
    { title: '恢复示例账号丁发布节奏', detail: '建议本周至少发布 1 条，复用已验证的标题结构。', priority: 'medium' },
  ],
  limitations: [
    '示例账号戊会话过期，10-18 后无数据，明细以 —* 标注',
    '环比基准缺失的指标不估算，显示为 —',
    '账号级收藏口径不可得，收藏仅作品级展示',
  ],
}

const weeklyData = {
  period: { type: 'weekly', start: '2026-10-12', end: '2026-10-19' },
  generatedAt: '2026-10-19T04:00:00+00:00',
  coverage: {
    totalAccounts: 5,
    coveredAccounts: 4,
    lastCollectedAt: '2026-10-19T02:42:00+00:00',
    missingAccounts: [
      { accountId: 'acc-e', nickname: '示例账号戊', reason: 'session_expired', lastCollectedAt: '2026-10-18T02:00:00+00:00' },
    ],
    checkedAt: '2026-10-19T04:00:10+00:00',
    signals: { dailyRows: 28, workSnapshotRows: 1204, fansProfileRows: 28, periodWorks: 12 },
  },
  coreMetrics: [
    { key: 'plays', label: '播放增量', value: 642000, prevValue: 541000, changePct: 18.6, available: true, goodDirection: 'up', note: null },
    { key: 'netFans', label: '净增粉丝', value: 1864, prevValue: 1707, changePct: 9.2, available: true, goodDirection: 'up', note: null },
    { key: 'interactions', label: '互动总量', value: 11206, prevValue: 9760, changePct: 14.8, available: true, goodDirection: 'up', note: null },
    { key: 'interactionRate', label: '互动率', value: 1.7, prevValue: 1.6, changePct: 5.2, available: true, goodDirection: 'up', note: null },
    { key: 'publishes', label: '发布', value: 12, prevValue: 10, changePct: 20, available: true, goodDirection: 'up', note: null },
    { key: 'totalFans', label: '矩阵总粉丝', value: 46209, prevValue: null, changePct: null, available: true, goodDirection: 'up', note: '期初（10-11 快照）44,345' },
  ],
  accounts: [
    { accountId: 'acc-a', nickname: '示例账号甲', sessionStatus: 'ok', fanCount: 18420, metrics: { plays: 386000, netFans: 1102, publishes: 4, likes: 6100, comments: 320, shares: 820 }, eachAvailable: true, marks: [] },
    { accountId: 'acc-b', nickname: '示例账号乙', sessionStatus: 'ok', fanCount: 12655, metrics: { plays: 142000, netFans: 428, publishes: 3, likes: 2100, comments: 180, shares: 230 }, eachAvailable: true, marks: [] },
    { accountId: 'acc-c', nickname: '示例账号丙', sessionStatus: 'ok', fanCount: 8940, metrics: { plays: 79000, netFans: -35, publishes: 3, likes: 980, comments: 62, shares: 78 }, eachAvailable: true, marks: ['连续3日掉粉'] },
    { accountId: 'acc-d', nickname: '示例账号丁', sessionStatus: 'ok', fanCount: 6152, metrics: { plays: 35000, netFans: 369, publishes: 2, likes: 240, comments: 18, shares: 30 }, eachAvailable: true, marks: [] },
    { accountId: 'acc-e', nickname: '示例账号戊', sessionStatus: 'expired', fanCount: 42, metrics: {}, eachAvailable: false, marks: [] },
  ],
  works: [
    { workId: 'w-w1', accountId: 'acc-a', nickname: '示例账号甲', title: '示例周报作品一：跑高速前的安全检查清单', publishTime: '2026-10-14T02:00:00+00:00', metrics: { plays: 128000, likes: 3200, comments: 180, collects: 900, shares: 420, fansGain: 512, completion5s: 66.0, bounce2s: 17.0, avgWatchSeconds: 8.1, viewProgress: 44.0 }, isHot: true },
    { workId: 'w-w2', accountId: 'acc-a', nickname: '示例账号甲', title: '示例周报作品二：雨季用车防滑要点', publishTime: '2026-10-16T06:20:00+00:00', metrics: { plays: 104000, likes: 2800, comments: 150, collects: 720, shares: 360, fansGain: 430, completion5s: 61.4, bounce2s: 19.4, avgWatchSeconds: 7.6, viewProgress: 39.6 }, isHot: true },
    { workId: 'w-w3', accountId: 'acc-b', nickname: '示例账号乙', title: '示例周报作品三：3 万预算二手车的取舍', publishTime: '2026-10-15T08:00:00+00:00', metrics: { plays: 76000, likes: 1600, comments: 96, collects: 410, shares: 180, fansGain: 220, completion5s: 52.8, bounce2s: 22.6, avgWatchSeconds: 10.2, viewProgress: 36.1 }, isHot: false },
  ],
  worksOmittedCount: 2,
  anomalies: [
    { type: 'data_gap', severity: 'high', message: '账号「示例账号戊」会话过期，近期数据可能缺失', accountId: 'acc-e', metricKey: null },
    { type: 'business', severity: 'medium', message: '账号「示例账号丙」连续 3 日净掉粉', accountId: 'acc-c', metricKey: 'netFans' },
  ],
  trendSeries: {
    days: ['09-21', '09-28', '10-05', '10-12'],
    bars: [412000, 468000, 541000, 642000],
    line: [1240, 1380, 1707, 1864],
  },
}

const weeklyAi = {
  summary: '矩阵周播放 64.2 万环比 +18.6%，双爆款均来自示例账号甲；示例账号丙进入掉粉通道需关注。',
  facts: [
    { title: '周播放与净粉双升', detail: '周播放增量 64.2 万（环比 +18.6%），周净增粉丝 +1,864（环比 +9.2%）。', evidence: '周播放 642,000 环比 +18.6%' },
    { title: '双爆款集中在头部账号', detail: '本周 2 条播放 ≥ 10 万作品均来自示例账号甲。', evidence: '爆款 2 条，均来自示例账号甲' },
  ],
  inferences: [
    { title: '爆款结构可复制', detail: '两条爆款均采用悬念提问开头，5s 完播 61%~66%，推测该结构对分发效率有正向作用。', evidence: '5s 完播 66.0% / 61.4%', confidence: 'high' },
    { title: '示例账号丙掉粉通道', detail: '本周净 −35 且互动下滑；若下周持续为负，建议回归实测类内容。', evidence: '本周净增 −35，上周 +12', confidence: 'medium' },
  ],
  recommendations: [
    { title: '内容排期模板化', detail: '示例账号甲保持 4 条/周并将爆款结构模板化；示例账号丁至少恢复 2 条/周。', priority: 'high' },
    { title: '数据运维', detail: '周一夜前完成示例账号戊重新登录采集，回补后重新生成周报 v2 复核。', priority: 'high' },
  ],
  limitations: [
    '示例账号戊 10-18 起缺采，周覆盖 28/35 账号·日',
    '周净增以日度求和为主口径；矩阵总粉丝仅展示期末值与期初 note',
    '粉丝画像本期未展示明细（仅作模型输入参考）',
  ],
}

const emptyReport = {
  reportId: 'r-empty-1',
  reportType: 'daily',
  periodStart: '2026-10-20',
  periodEnd: '2026-10-21',
  status: 'insufficient',
  version: 1,
  isCurrent: true,
  outputSchemaVersion: null,
  errorCode: 'REPORT_INSUFFICIENT_DATA',
  resultJson: null,
  coverageSummary: {
    totalAccounts: 5, coveredAccounts: 0,
    signals: { dailyRows: 0, workSnapshotRows: 0, fansProfileRows: 0, periodWorks: 0 },
    checkedAt: '2026-10-21T03:00:10+00:00',
  },
}

const listItems = [
  { reportId: 'r-d-1', reportType: 'daily', periodStart: '2026-10-22', periodEnd: '2026-10-23', status: 'succeeded', version: 2, isCurrent: true, createdAt: '2026-10-23T03:00:00+00:00', finishedAt: '2026-10-23T03:01:08+00:00', summary: '播放增量 128,456 创近 7 日新高', errorCode: null, coverageSummary: { totalAccounts: 5, coveredAccounts: 4 } },
  { reportId: 'r-d-2', reportType: 'daily', periodStart: '2026-10-21', periodEnd: '2026-10-22', status: 'succeeded', version: 1, isCurrent: true, createdAt: '2026-10-22T03:00:00+00:00', finishedAt: '2026-10-22T03:00:52+00:00', summary: '播放增量 114,286 · 净粉 +402', errorCode: null, coverageSummary: { totalAccounts: 5, coveredAccounts: 5 } },
  { reportId: 'r-d-3', reportType: 'daily', periodStart: '2026-10-20', periodEnd: '2026-10-21', status: 'insufficient', version: 1, isCurrent: true, createdAt: '2026-10-21T03:00:00+00:00', finishedAt: '2026-10-21T03:00:04+00:00', summary: null, errorCode: 'REPORT_INSUFFICIENT_DATA', coverageSummary: { totalAccounts: 5, coveredAccounts: 0 } },
  { reportId: 'r-d-4', reportType: 'daily', periodStart: '2026-10-19', periodEnd: '2026-10-20', status: 'failed', version: 1, isCurrent: true, createdAt: '2026-10-20T03:00:00+00:00', finishedAt: '2026-10-20T03:03:00+00:00', summary: null, errorCode: 'REPORT_TIMEOUT', coverageSummary: { totalAccounts: 5, coveredAccounts: 4 } },
]

const listWeeklyItems = [
  { reportId: 'r-w-1', reportType: 'weekly', periodStart: '2026-10-12', periodEnd: '2026-10-19', status: 'succeeded', version: 1, isCurrent: true, createdAt: '2026-10-19T04:00:00+00:00', finishedAt: '2026-10-19T04:01:12+00:00', summary: '周播放 64.2 万 · 环比 +18.6%', errorCode: null, coverageSummary: { totalAccounts: 5, coveredAccounts: 4 } },
]

function buildDailyReport() {
  return {
    reportId: 'r-d-1', reportType: 'daily', periodStart: '2026-10-22', periodEnd: '2026-10-23',
    status: 'succeeded', version: 2, isCurrent: true,
    outputSchemaVersion: 'report-daily-v1', errorCode: null,
    resultJson: { data: dailyData, ai: dailyAi },
  }
}

function buildWeeklyReport() {
  return {
    reportId: 'r-w-1', reportType: 'weekly', periodStart: '2026-10-12', periodEnd: '2026-10-19',
    status: 'succeeded', version: 1, isCurrent: true,
    outputSchemaVersion: 'report-weekly-v1', errorCode: null,
    resultJson: { data: weeklyData, ai: weeklyAi },
  }
}

const noop = () => {}

function renderNode(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderNode).join('')
  const type = node.type
  if (typeof type === 'function') {
    const element = type(node.props || {})
    return renderNode(element)
  }
  if (typeof type === 'string') {
    const attrs = Object.entries(node.props || {})
      // 事件处理(on*)是运行时 React 合成事件,SSR 静态化时跳过(输出函数字面量会污染 HTML)。
      .filter(([key, value]) => key !== 'children' && key !== 'style'
        && !(key.startsWith('on') && typeof value === 'function'))
      .map(([key, value]) => {
        const name = key === 'className' ? 'class' : key === 'htmlFor' ? 'for' : key
        return ` ${name}="${String(value).replace(/"/g, '&quot;')}"`
      })
      .join('')
    const style = node.props && node.props.style
      ? ` style="${Object.entries(node.props.style).map(([k, v]) => `${k}:${v}`).join(';')}"`
      : ''
    return `<${type}${attrs}${style}>${renderNode(node.props && node.props.children)}</${type}>`
  }
  return renderNode(node.children)
}

async function main() {
  const outDirArg = process.argv[2]
  const outDir = outArgDir(outDirArg)
  const built = await readFile(pluginPath, 'utf8')
  const loaded = []
  const sandbox = {
    console,
    URL,
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
    window: { __ModuleLoader__: { load: definition => loaded.push(definition) }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  }
  const vm = await import('node:vm')
  vm.createContext(sandbox)
  vm.runInContext(built, sandbox)
  const stubs = {
    react: {
      createElement: h,
      useCallback: fn => fn,
      useEffect: () => {},
      useMemo: fn => fn(),
      useRef: value => ({ current: value }),
      useState: value => [value, () => {}],
      useSyncExternalStore: () => false,
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      IconCloseOutline16: props => h('span', props),
      IconDownloadOutline16: props => h('span', props),
      IconPlayOutline16: props => h('span', props),
      Tooltip: props => h('span', props, props && props.children),
    },
  }
  const plugin = loaded[0].factory(name => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`)
    return stubs[name]
  })
  const t = zhDictionary(plugin)

  const blocks = []
  blocks.push(h('div', { className: 'screenshot-block', id: 'report-list' },
    h('h2', { className: 'screenshot-title' }, 'Tab4 AI 报表 · 列表页（类型 seg + 状态 pill + 版本 + 覆盖账号 + 失败中文文案）'),
    h('p', { className: 'screenshot-sub' }, 'RQ-2026-006：日报/周报类型筛选；失败行展示稳定码中文文案（不出现原始英文码）；pending/running 覆盖账号显示 —'),
    h(plugin.ReportListView, {
      items: listItems, loading: false, errorReason: null, reportType: 'daily',
      actions: { onTypeChange: noop, onRefresh: noop, onLoadMore: null, onOpen: noop }, t,
    })))
  blocks.push(h('div', { className: 'screenshot-block', id: 'report-daily' },
    h('h2', { className: 'screenshot-title' }, 'Tab4 AI 报表 · 日报详情（质量条 + KPI 环比 + 趋势 + 明细 + 作品卡 + 异常 + AI 三分区）'),
    h('p', { className: 'screenshot-sub' }, 'NULL≠0：缺采账号指标 —*；趋势缺采日断开、末位深蓝实色；互动总量=赞+评+转；作品级收藏；evidence 灰字'),
    h(plugin.ReportDetailView, {
      report: buildDailyReport(), loading: false, errorReason: null, regenerating: false,
      versions: listItems, actions: {
        onBack: noop, onVersionChange: noop, onRegenerate: noop,
        onExportHtml: noop, onExportPdf: noop,
      },
    })))
  blocks.push(h('div', { className: 'screenshot-block', id: 'report-weekly' },
    h('h2', { className: 'screenshot-title' }, 'Tab4 AI 报表 · 周报详情（近 4 周趋势 + 期初 note + 其余 N 条说明）'),
    h('p', { className: 'screenshot-sub' }, '周报展示层 end = period_end − 1（闭区间）；矩阵总粉丝只展示期末值 + note 期初；worksOmittedCount 渲染「其余 N 条」'),
    h(plugin.ReportDetailView, {
      report: buildWeeklyReport(), loading: false, errorReason: null, regenerating: false,
      versions: listWeeklyItems, actions: {
        onBack: noop, onVersionChange: noop, onRegenerate: noop,
        onExportHtml: noop, onExportPdf: noop,
      },
    })))
  blocks.push(h('div', { className: 'screenshot-block', id: 'report-empty' },
    h('h2', { className: 'screenshot-title' }, 'Tab4 AI 报表 · 数据不足空态（四信号检查 + 重新生成入口）'),
    h('p', { className: 'screenshot-sub' }, '四信号全空 → insufficient 终态（不调模型）：日度/作品快照/粉丝画像 0 行 + 周期内发布作品 0 条'),
    h(plugin.ReportDetailView, {
      report: emptyReport, loading: false, errorReason: null, regenerating: false,
      versions: [emptyReport], actions: {
        onBack: noop, onVersionChange: noop, onRegenerate: noop,
        onExportHtml: noop, onExportPdf: noop,
      },
    })))

  const pageHtml = blocks => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${DSW_FALLBACK_CSS}${plugin.css}</style></head><body>${blocks.map(renderNode).join('')}</body></html>`
  const html = pageHtml(blocks)

  await mkdir(outDir, { recursive: true })
  const htmlPath = path.join(outDir, 'ui-report-preview.html')
  await writeFile(htmlPath, html)
  console.log(`preview html: ${htmlPath}`)

  const driver = await loadPlaywrightDriver()
  const chromePath = await resolveSystemChrome({ platform: process.platform })
  const browser = await driver.chromium.launch({
    channel: chromePath.channel,
    executablePath: chromePath.path,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=2', '--font-render-hinting=none'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, locale: 'zh-CN' })
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null))
    for (const [name, selector] of [
      ['report-list', '#report-list'],
      ['report-daily', '#report-daily'],
      ['report-weekly', '#report-weekly'],
      ['report-empty', '#report-empty'],
    ]) {
      const file = path.join(outDir, `ui-${name}.png`)
      await page.locator(selector).screenshot({ path: file })
      console.log(`saved: ${file}`)
    }
  } finally {
    await browser.close()
  }
}

function outArgDir(arg) {
  if (arg) return path.resolve(arg)
  // 默认输出 docker-helm 仓库 docs/1023/douyin/screenshots（脚本位于 plugins/<name>/scripts）
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/1023/douyin/screenshots')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
