// 抖音运营 1015 UI 升级 · Playwright 截图验收脚本。
//
// 用法：node scripts/screenshot.mjs [输出目录]（默认 docs/1015/douyin/screenshots）。
// 机制：Node 侧用 react-dom/server 把四个页面区块（账号总览 / 账号分析 / 作品表格 /
// 作品详情弹框）SSR 成静态 HTML（内联插件真实 CSS + DSW 变量兜底 + 真实中文文案），
// Playwright 系统 Chrome 无头截图到 docs/1015/douyin/screenshots/。
//
// 截图数据是**脱敏占位 fixture**（结构真实、数值占位），封面用内嵌 SVG data URI
// （不触网、不携带任何真实业务数据）；与 docs/1015/douyin/fixtures 的脱敏原则一致。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

import { loadPlaywrightDriver, resolveSystemChrome } from '../src/chrome.js'

const React_ = React.default ?? React
const h = (type, props, ...children) => React_.createElement(type, props ?? null, ...children)

const pluginPath = new URL('../lib/client.js', import.meta.url)

// DSW 设计变量兜底（浅色主题近似值）：插件 CSS 全部经 var() 引用宿主主题，
// 截图页不在 DSH 宿主内，必须提供一套完整可读的变量值。
const DSW_FALLBACK_CSS = `:root{
  --dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#f6f7f9;--dsw-alias-bg-layer-2:#eceef1;
  --dsw-alias-border-l1:#e0e3e8;--dsw-alias-border-l2:#d4d8de;
  --dsw-alias-label-primary:#1f2329;--dsw-alias-label-secondary:#646a73;
  --dsw-alias-label-primary-foreground:#ffffff;--dsw-alias-brand-primary:#3370ff;
  --dsw-alias-state-success-primary:#1a7f37;--dsw-alias-state-error-primary:#d03a3a;
  --dsw-alias-state-warn-primary:#d29922;
  --dsw-font-l-20-font-size:20px;--dsw-font-base-16-font-size:16px;
  --dsh-content-font-size:14px;--dsh-content-font-size-secondary:13px;
  --ydo-gender-male:#91C5EB;--ydo-gender-female:#E88989;
}
*{box-sizing:border-box}
body{margin:0;font-family:'Noto Sans CJK SC','Source Han Sans SC','Microsoft YaHei',sans-serif;background:#fff;color:#1f2329}
.screenshot-block{padding:24px;border-bottom:16px solid #d4d8de}
.screenshot-title{margin:0 0 4px;font-size:18px;font-weight:700}
.screenshot-sub{margin:0 0 16px;color:#646a73;font-size:13px}
`

// 内嵌 SVG 封面（data URI）：演示封面观感，不触网、不携带真实数据。
function coverDataUri(text, from, to) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><text x="160" y="108" font-size="36" fill="rgba(255,255,255,.92)" text-anchor="middle" font-family="sans-serif">${text}</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function zhDictionary(plugin) {
  const dict = plugin.copy && plugin.copy.zh ? plugin.copy.zh : {}
  return key => (key in dict ? dict[key] : key)
}

// 近 30 天趋势点（含两处缺口，验证断线渲染；数值占位递增）。
function trendPoints(now = new Date()) {
  const points = []
  const skip = new Set([4, 5, 12])
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 86400000)
    const pad = n => String(n).padStart(2, '0')
    const iso = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    if (skip.has(29 - offset)) continue
    points.push({ day: iso, value: 1520000 + (29 - offset) * 5200, elapsedSeconds: 86400, counterRevised: false })
  }
  return points
}

function buildOverviewFixture(t) {
  return {
    summary: {
      accountCount: 3, workCount: 216, totalPlayCount: 28643100, hotWorkCount: 18,
      hotRatePct: 8.3, engagementRatePct: 4.6, unknownPublishTimeWorkCount: 0,
      netFansCount: 327, completionRate5sPct: 41.7,
    },
    accountTotal: 3,
    accountOptions: [
      { accountId: 'acc-a', nickname: '示例账号甲', workCount: 78 },
      { accountId: 'acc-b', nickname: '示例账号乙', workCount: 90 },
      { accountId: 'acc-c', nickname: '示例账号丙', workCount: 48 },
    ],
    accounts: [
      {
        accountId: 'acc-a', nickname: '示例账号甲', fanCount: 128400, workCount: 78,
        medianPlayCount: 84200, hotWorkCount: 9, hotRatePct: 11.5, engagementRatePct: 5.2,
        windowNetFansCount: 281, windowPlayCount: 12840000,
        sessionStatus: 'ok', lastCollectedAt: new Date().toISOString(),
        suspiciousEmptyCollect: false,
      },
      {
        accountId: 'acc-b', nickname: '示例账号乙', fanCount: 96300, workCount: 90,
        medianPlayCount: 61300, hotWorkCount: 6, hotRatePct: 6.7, engagementRatePct: 4.1,
        windowNetFansCount: -12, windowPlayCount: 8210000,
        sessionStatus: 'ok', lastCollectedAt: new Date().toISOString(),
        suspiciousEmptyCollect: false,
      },
      {
        accountId: 'acc-c', nickname: '示例账号丙', fanCount: 45600, workCount: 48,
        medianPlayCount: 40200, hotWorkCount: 3, hotRatePct: 6.3, engagementRatePct: 3.8,
        // daily 未采集：新列显示 —（缺口，不估算）。
        windowNetFansCount: null, windowPlayCount: null,
        sessionStatus: 'expired', lastCollectedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
        suspiciousEmptyCollect: false,
      },
    ],
    hotAccountDistribution: [
      { accountId: 'acc-a', nickname: '示例账号甲', hotWorkCount: 9 },
      { accountId: 'acc-b', nickname: '示例账号乙', hotWorkCount: 6 },
      { accountId: 'acc-c', nickname: '示例账号丙', hotWorkCount: 3 },
    ],
    hotWorks: [
      {
        workId: 'w-hot-1', accountId: 'acc-a', accountNickname: '示例账号甲',
        title: '示例爆款视频一：公路养护作业全流程演示', publishTime: new Date(Date.now() - 3 * 86400000).toISOString(),
        playCount: 1284000, likeCount: 42300, commentCount: 1860, collectCount: 9200, shareCount: 3100,
        engagementRatePct: 4.4, labels: ['absolute'], rank: 1, basis: '播放量为账号中位数 15.2 倍 · 互动率超过绝对阈值',
      },
      {
        workId: 'w-hot-2', accountId: 'acc-b', accountNickname: '示例账号乙',
        title: '示例爆款视频二：安全作业标准化情景演示', publishTime: new Date(Date.now() - 6 * 86400000).toISOString(),
        playCount: 863000, likeCount: 25100, commentCount: 1120, collectCount: 6400, shareCount: 1800,
        engagementRatePct: 3.9, labels: ['account_relative'], rank: 2, basis: '播放量为账号中位数 9.8 倍',
      },
    ],
    dataQuality: { accounts: {} },
  }
}

function buildAnalysisFixture(t) {
  const points = trendPoints()
  return {
    account: {
      accountId: 'acc-a', nickname: '示例账号甲', fanCount: 128400, sessionStatus: 'ok',
      lastCollectedAt: new Date().toISOString(), suspiciousEmptyCollect: false,
    },
    summary: { workCount: 78 },
    kpi: { totalPlayCount: 12840000, medianPlayCount: 84200, maxPlayCount: 1284000, hotWorkCount: 9, hotRatePct: 11.5, engagementRatePct: 5.2 },
    fansSummary: {
      totalFansCount: 128400, newFansCount: 281, cancelFansCount: 46,
      homeViewFansCount: 3120, homepageViewCount: 8600, collectedDayCount: 30,
    },
    interaction: {
      likeCount: { ratePct: 3.3, coveragePct: 100, observed: 423000 },
      commentCount: { ratePct: 0.9, coveragePct: 98, observed: 118000 },
      collectCount: { ratePct: 0.7, coveragePct: 96, observed: 91000 },
      shareCount: { ratePct: 0.3, coveragePct: 94, observed: 39000 },
    },
    completion: { completion5s: { value: 41.7, coveragePct: 90 } },
    playback: {
      avgViewProportion: { value: 22.4, coveragePct: 88 },
      avgWatchDuration: { value: 12.9, coveragePct: 88 },
    },
    hotWorks: [
      {
        workId: 'w-hot-1', title: '示例爆款视频一：公路养护作业全流程演示',
        publishTime: new Date(Date.now() - 3 * 86400000).toISOString(), playCount: 1284000,
        engagementRatePct: 4.4, fansGainCount: 128, rank: 1,
        labels: ['absolute'], basis: '播放量为账号中位数 15.2 倍',
      },
      {
        workId: 'w-hot-2', title: '示例爆款视频二：安全作业标准化情景演示',
        publishTime: new Date(Date.now() - 6 * 86400000).toISOString(), playCount: 863000,
        engagementRatePct: 3.9, fansGainCount: null, rank: 2,
        labels: ['account_relative'], basis: '播放量为账号中位数 9.8 倍',
      },
    ],
    audience: {
      dimensions: {
        gender: { distributions: [{ key: 'male', pct: 61.2 }, { key: 'female', pct: 38.8 }] },
        age: { distributions: [{ key: '31-40', pct: 38.4 }, { key: '24-30', pct: 30.1 }, { key: '41-50', pct: 21.6 }] },
        province: { distributions: [{ key: '广东', pct: 18.2 }, { key: '江苏', pct: 11.4 }, { key: '浙江', pct: 9.7 }] },
        city_level: { distributions: [{ key: '二线', pct: 36.8 }, { key: '三线', pct: 31.2 }, { key: '一线', pct: 22.4 }] },
      },
    },
    traffic: {
      distributions: [
        { key: 'homepage_hot', sourceLabel: null, pct: 62.4 },
        { key: 'follow', sourceLabel: null, pct: 18.6 },
        { key: 'search', sourceLabel: null, pct: 9.2 },
      ],
    },
    alerts: [],
  }
}

function buildWorksFixture() {
  const row = overrides => ({
    work_id: 'w1', title: '示例作品：公路养护作业全流程演示',
    url: 'https://www.douyin.com/video/w1',
    publish_time: '2026-09-08T01:00:00.000Z',
    play_count: 10847, like_count: 49, comment_count: 6, collect_count: 76, share_count: 12,
    bounce_rate_2s_pct: 31.73, completion_rate_5s_pct: 40.17, completion_rate_pct: 12.09,
    fans_gain_count: 9, avg_watch_duration_s: 13.46, avg_view_proportion_pct: 17.61,
    duration_s: 39.219, visibility: 'active',
    cover_url: 'https://cdn.example/cover-1.webp',
    data_gap: null,
    ...overrides,
  })
  return [
    row({ work_id: 'w1', title: '示例作品：公路养护作业全流程演示' }),
    row({ work_id: 'w2', title: '示例作品：安全作业标准化情景演示（无封面 → 占位）', cover_url: null, fans_gain_count: null, play_count: 6320 }),
    row({ work_id: 'w3', title: '示例作品：夜间施工反光标识科普', fans_gain_count: -3, play_count: 22100, duration_s: 45 }),
    row({ work_id: 'w4', title: '示例作品：机械设备操作要点（已设为私密）', is_private: true, play_count: null, like_count: null, comment_count: null, collect_count: null, share_count: null, bounce_rate_2s_pct: null, completion_rate_5s_pct: null, completion_rate_pct: null, fans_gain_count: null, avg_watch_duration_s: null, avg_view_proportion_pct: null, data_gap: { play_count: { reason: 'not_exposed' } } }),
    row({ work_id: 'w5', title: '示例作品：养护知识问答合集', play_count: 94000, fans_gain_count: 42, duration_s: 512.6 }),
  ]
}

function buildDetailFixture() {
  return {
    detail: {
      work: {
        work_id: 'w1', title: '示例作品：公路养护作业全流程演示',
        url: 'https://www.douyin.com/video/w1',
        publish_time: '2026-09-08T01:00:00.000Z',
        latest_collected_at: new Date().toISOString(),
        visibility: 'active',
        cover_url: 'https://cdn.example/cover-1.webp',
        duration_s: 39.219,
        play_count: 10847, like_count: 49, comment_count: 6, share_count: 12, collect_count: 76,
        completion_rate_pct: 12.09, bounce_rate_2s_pct: 31.73, fans_gain_count: 9,
        traffic_source: [
          { source_key: 'homepage_hot', source_label: null, share_pct: 62.4 },
          { source_key: 'follow', source_label: null, share_pct: 18.6 },
          { source_key: 'search', source_label: null, share_pct: 9.2 },
        ],
        progress_analysis: {
          drag_back_curve: [{ key: '3', value: 8.2 }, { key: '10', value: 21.6 }, { key: '20', value: 34.1 }],
          drag_forward_curve: [{ key: '2', value: 12.4 }],
        },
        search_keywords: [{ keyword: '公路养护', percent: 46.2 }, { keyword: '施工流程', percent: 31.8 }],
        data_gap: { completion_rate_pct: { reason: 'not_exposed' } },
      },
      audience: {
        gender: [{ key: 'male', pct: 61.2 }, { key: 'female', pct: 38.8 }],
        age: [{ key: '31-40', pct: 38.4 }, { key: '24-30', pct: 30.1 }],
        province: [{ key: '广东', pct: 18.2 }, { key: '江苏', pct: 11.4 }],
        city_level: [{ key: '二线', pct: 36.8 }, { key: '三线', pct: 31.2 }],
      },
      hotwords: [{ word: '公路养护', rank: 1 }, { word: '施工流程', rank: 2 }, { word: '反光标识', rank: 3 }],
    },
    trend: {
      total: 30,
      snapshots: trendPoints().map((point, index) => ({
        captured_at: `${point.day}T09:00:00+08:00`,
        play_count: 10400 + index * 15,
      })),
    },
  }
}

const renderNode = node => renderToStaticMarkup(node)

async function main() {
  const outDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    process.argv[2] || '../../../docs/1015/douyin/screenshots',
  )
  const built = await readFile(pluginPath, 'utf8')
  // 从构建产物工厂取插件导出（与运行时同一份内联产物）。
  const loaded = []
  const sandbox = {
    console,
    URL,
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    window: { __ModuleLoader__: { load: d => loaded.push(d) }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  }
  const vm = await import('node:vm')
  vm.createContext(sandbox)
  vm.runInContext(built, sandbox)
  // 图标 stub：宿主图标库的真实 SVG 不可用，这里给近似线性图标（16×16 stroke）
  // 保证关闭/下载按钮的截图观感接近真实宿主。
  const icon = paths => h('svg', {
    width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
    'aria-hidden': true, style: { display: 'block' },
  }, paths.map((d, i) => h('path', { key: i, d })))
  const iconClose = () => icon(['M4 4 L12 12', 'M12 4 L4 12'])
  const iconDownload = () => icon(['M8 2 L8 10', 'M4.5 7 L8 10.5 L11.5 7', 'M3 13 L13 13'])
  const iconPlay = () => icon(['M5 3 L12 8 L5 13 Z'])
  const stubs = {
    react: React_,
    '@deepseek-ai/dsh-client-ui-primitives': {
      IconCloseOutlineRegular: iconClose,
      IconCloseOutline16: iconClose,
      IconDownloadOutlineRegular: iconDownload,
      IconDownloadOutline16: iconDownload,
      IconPlayOutlineRegular: iconPlay,
      IconPlayOutline16: iconPlay,
      Tooltip: props => h('span', props, props && props.children),
    },
  }
  const plugin = loaded[0].factory(name => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`)
    return stubs[name]
  })
  const t = zhDictionary(plugin)
  const filters = { window: '30d', sort: 'hot_count', accountIds: [] }

  const blocks = []
  const overviewFixture = buildOverviewFixture(t)
  blocks.push(h('div', { className: 'screenshot-block', id: 'overview' },
    h('h2', { className: 'screenshot-title' }, 'Tab1 账号总览（KPI 6 卡 + 排行 10 列）'),
    h('p', { className: 'screenshot-sub' }, '1015 新增：净增粉丝 / 5秒完播率 KPI；排行新增近窗口净增（负值红色）/ 近窗口播放两列；「—」为未采集缺口'),
    h(plugin.OverviewPage, {
      overview: overviewFixture, loading: false, errorReason: null,
      filters, accounts: [], collecting: false, exporting: false,
      onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
      onOpenWork: () => {}, onOpenAccount: () => {}, onAddAccount: () => {}, t,
    })))
  blocks.push(h('div', { className: 'screenshot-block', id: 'analysis' },
    h('h2', { className: 'screenshot-title' }, 'Tab1 下钻 账号分析（粉丝数据卡 + 净增粉丝趋势 + 吸粉量行/列）'),
    h('p', { className: 'screenshot-sub' }, '1015 新增：趋势图上方「粉丝数据」5 卡；趋势指标下拉含「净增粉丝」；内容指标含吸粉量行；爆款表含吸粉量列'),
    h(plugin.AnalysisPage, {
      analysis: buildAnalysisFixture(t),
      trend: { points: trendPoints() }, trendMetric: 'play', trendErrorReason: null,
      loading: false, errorReason: null, exporting: false,
      rangeLabel: t('window_30d'), trendNow: new Date(),
      onBack: () => {}, onMetricChange: () => {}, onExport: () => {}, onOpenWork: () => {}, t,
      aiAnalysis: null, aiStatus: 'not_analyzed', aiBusy: false, aiError: null, aiConfirming: false,
      onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
      aiModalOpen: false, onAiModalOpen: () => {}, onAiModalClose: () => {},
    })))
  blocks.push(h('div', { className: 'screenshot-block', id: 'work-table' },
    h('h2', { className: 'screenshot-title' }, 'Tab2 视频数据（封面列 + 吸粉量列）'),
    h('p', { className: 'screenshot-sub' }, '1015 新增：作品列封面缩略图（含时长角标，无封面显示占位）；新增吸粉量列（正绿/负红/缺失 —）；私密作品指标「—」'),
    h(plugin.WorkTable, { works: buildWorksFixture(), onOpen: () => {}, t })))
  const { detail, trend } = buildDetailFixture()
  blocks.push(h('div', { className: 'screenshot-block', id: 'detail-modal', style: { position: 'relative', height: '720px' } },
    h('h2', { className: 'screenshot-title' }, 'Tab2 作品详情弹框（分组重构 + 核心指标 8 卡 + 播放趋势折线）'),
    h('p', { className: 'screenshot-sub' }, '1015 新增：头部封面 + 核心指标 8 卡；播放量趋势折线（30 天窗口、缺口虚线）替代文字计数；面板归组'),
    h('div', { style: { position: 'absolute', inset: '48px 0 0 0' } },
      h(plugin.WorkDetailModal, { accountId: 'acc-a', workId: 'w1', detail, trend, loading: false, onClose: () => {}, t }))))

  // 弹框 overlay 是 position:fixed（z-index 540），与主页面同文档会盖住其他区块——
  // 独立文档渲染。封面 URL（cdn.example）由 Playwright route 本地返回 SVG，不触网。
  const pageHtml = blocks => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${DSW_FALLBACK_CSS}${plugin.css}</style></head><body>${blocks.map(renderNode).join('')}</body></html>`
  const mainBlocks = blocks.filter(block => block.props.id !== 'detail-modal')
  const modalBlocks = blocks.filter(block => block.props.id === 'detail-modal')
  const mainHtml = pageHtml(mainBlocks)
  const modalHtml = pageHtml(modalBlocks)

  await mkdir(outDir, { recursive: true })
  const htmlPath = path.join(outDir, 'ui-preview.html')
  await writeFile(htmlPath, mainHtml + modalHtml)
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
    // 封面图本地路由：返回内嵌 SVG（渐变 + 文字），演示真实封面观感、零网络依赖。
    await page.route('**/cdn.example/**', route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a7fd4"/><stop offset="1" stop-color="#7ba7e8"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><text x="160" y="112" font-size="34" fill="rgba(255,255,255,.92)" text-anchor="middle" font-family="sans-serif">示例封面</text></svg>',
    }))

    await page.setContent(mainHtml, { waitUntil: 'networkidle' })
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null))
    for (const [name, selector] of [['overview', '#overview'], ['analysis', '#analysis'], ['work-table', '#work-table']]) {
      const file = path.join(outDir, `ui-${name}.png`)
      await page.locator(selector).screenshot({ path: file })
      console.log(`saved: ${file}`)
    }

    // 弹框独立文档（fixed overlay 不受其他区块干扰），视口抬高到弹框完整高度。
    await page.setViewportSize({ width: 1440, height: 1180 })
    await page.setContent(modalHtml, { waitUntil: 'networkidle' })
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null))
    await page.locator('#detail-modal').screenshot({ path: path.join(outDir, 'ui-detail-modal.png') })
    console.log(`saved: ${path.join(outDir, 'ui-detail-modal.png')}`)
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
