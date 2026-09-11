import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'
import { assertAccessibleSurface } from './assert-accessible-surface.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const packageRoot = resolve(here, '../..')
const workspaceRoot = resolve(packageRoot, '..')
const harnessRoot = resolve(here, 'yootun-audit')
// Keep the custom blue palette as a token-mapping regression, and exercise the
// actual application palettes with DSH_VISUAL_THEME=official-light/official-dark.
const visualTheme = process.env.DSH_VISUAL_THEME || 'custom'
assert(['custom', 'official-light', 'official-dark'].includes(visualTheme), `Unknown visual theme: ${visualTheme}`)
const officialThemeCss = visualTheme === 'custom' ? null : await readFile(
  resolve(workspaceRoot, 'deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css'), 'utf8',
)
const evidenceRoot = process.env.DSH_VISUAL_EVIDENCE_ROOT
  ? resolve(process.env.DSH_VISUAL_EVIDENCE_ROOT)
  : resolve(workspaceRoot, 'docs/superpowers/evidence/2026-09-08-search-locks', visualTheme)
const sources = {
  content: resolve(workspaceRoot, '.ci/dsh-yootun-content-command/src/client.js'),
  dashboard: resolve(workspaceRoot, '.ci/dsh-yootun-dashboard/src/client.js'),
  daily: resolve(workspaceRoot, '.ci/dsh-yootun-daily-report/src/client.js'),
  finops: resolve(workspaceRoot, '.ci/dsh-yootun-finops/src/client.js'),
  knowledge: resolve(workspaceRoot, '.ci/dsh-yootun-knowledge/src/client.js'),
  lead: resolve(workspaceRoot, '.ci/dsh-yootun-lead-discovery/src/client.js'),
  recruiter: resolve(workspaceRoot, '.ci/dsh-yootun-recruiter/src/client.js'),
  retrofit: resolve(workspaceRoot, '.ci/dsh-yootun-retrofit/src/client.js'),
  sales: resolve(workspaceRoot, '.ci/dsh-yootun-sales/src/client.js'),
  supply: resolve(workspaceRoot, '.ci/dsh-yootun-supply-watch/src/client.js'),
}
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
assert(existsSync(browserExecutable), `Chrome executable not found: ${browserExecutable}`)

const vite = await createServer({
  root: harnessRoot,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'search-lock-source',
    transformIndexHtml(html) {
      if (!officialThemeCss) return html
      const dark = visualTheme === 'official-dark'
      return {
        html: html.replace('<body>', dark ? '<body data-ds-dark-theme>' : '<body>'),
        tags: [{
          tag: 'style',
          children: `${officialThemeCss}\n:root { color-scheme: ${dark ? 'dark' : 'light'}; }`,
          injectTo: 'head',
        }],
      }
    },
    configureServer(server) {
      server.middlewares.use('/__audit_source__', async (request, response) => {
        const sourceId = new URL(request.url || '/', 'http://127.0.0.1').searchParams.get('source')
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(await readFile(sources[sourceId] || sources.lead, 'utf8'))
      })
    },
  }],
})
await vite.listen()
const address = vite.httpServer.address()
assert(address && typeof address === 'object')
const url = `http://127.0.0.1:${address.port}`
await mkdir(evidenceRoot, { recursive: true })

let leadSearchRequests = 0
let leadPageRequests = 0
let releaseLeadSearch
const leadSearchReady = new Promise(resolve => { releaseLeadSearch = resolve })
let releaseLeadPage
const leadPageReady = new Promise(resolve => { releaseLeadPage = resolve })
let dailyRefreshFails = false
let dailyRefreshRequests = 0
let releaseDailyRefresh
const dailyRefreshReady = new Promise(resolve => { releaseDailyRefresh = resolve })
const dailyReport = {
  activity: {
    status: 'ready',
    totals: { sessions: 1, turns: 6, completed: 5, failed: 1, toolCalls: 9 },
    sessions: [{ workspace: '华东项目', title: '渠道复盘', turns: 6 }],
  },
  sources: {
    local: { status: 'ready' },
    tools: { status: 'ready' },
    salesIntent: { status: 'ready' },
    retrofit: { status: 'ready' },
    knowledge: { status: 'ready' },
  },
}
let finopsRefreshFails = false
let finopsRefreshRequests = 0
let releaseFinopsRefresh
const finopsRefreshReady = new Promise(resolve => { releaseFinopsRefresh = resolve })
const salesRequestMethods = []
let salesUnavailable = false
const finops = {
  period: { label: '昨日', timeZone: 'Asia/Shanghai' },
  summary: { currency: 'CNY', cost: 12.5, requests: 24, successfulRequests: 23, totalTokens: 188000, inputTokens: 120000, outputTokens: 68000 },
  source: { status: 'ready', sourceCompleteness: 'complete', asOf: '2026-09-08T03:00:00.000Z' },
  attribution: 'member',
  series: [],
  budget: { status: 'empty', items: [] },
  models: [],
  alerts: [],
  refreshedAt: '2026-09-08T03:00:00.000Z',
}
let knowledgeNodeLabel = '重点客户偏好'
const knowledge = {
  status: 'ready',
  mcp: { auth: 'credential-store' },
  overview: {
    status: 'ready',
    data: {
      spaces: 3,
      documents: 12,
      memories: 5,
      pendingImports: 1,
      health: { neo4j: 'healthy' },
      ingestion: { queued: 1, processing: 2, failed: 0 },
      recentDocuments: [{ id: 'doc-1', title: '渠道政策', source: '企业空间', status: 'ready', updatedAt: '2026-09-08T03:00:00.000Z' }],
      recentMemories: [{ id: 'memory-1', title: '重点客户偏好', content: '关注新能源 SUV 与交付周期', status: 'CANDIDATE', sourceType: 'session', confidence: 0.88, updatedAt: '2026-09-08T03:00:00.000Z' }],
    },
  },
  templates: [{ id: 'space-1', name: '销售知识空间', description: '客户与渠道资料', entities: ['customer', 'channel'] }],
}
const dashboard = {
  period: { label: '昨日', date: '2026-09-07', timeZone: 'Asia/Shanghai' },
  geo: { status: 'empty', source: 'geoflow', sourceCompleteness: 'complete', missingFields: [], data: {} },
  usage: { status: 'empty', source: 'models', sourceCompleteness: 'complete', missingFields: [], data: {} },
  activity: { status: 'empty', source: 'local_agent', sourceCompleteness: 'complete', missingFields: [], data: {} },
  montage: {
    status: 'ready', source: 'openmontage', sourceCompleteness: 'complete', missingFields: [],
    data: {
      jobs: { total: 2, queued: 0, running: 1, completed: 0, failed: 1 },
      pendingApprovals: 1,
      approvals: { oldestWaitingAt: '2026-09-08T02:00:00.000Z' },
      recentJobs: [
        { id: 'job-1', title: '产品讲解片', status: 'waiting_approval', stage: 'asr' },
        { id: 'job-2', title: '品牌短片', status: 'failed', stage: 'vision' },
      ],
      artifacts: { total: 0, recent: [] },
      health: { service: 'ready', workers: [{ id: 'worker-1', status: 'healthy' }] },
    },
  },
  capabilities: {},
  refreshedAt: '2026-09-08T03:00:00.000Z',
}
const supplyWatch = {
  status: 'ready',
  dashboard: { risks: 1, critical: 1, openRisks: 1, dueToday: 0, pending: 1 },
  risks: [{ id: 'risk-1', targetLabel: '华南供应商 01', severity: 'p0', status: 'open' }],
  actions: [{ id: 'risk-1', targetLabel: '华南供应商 01', severity: 'p0', status: 'awaiting_confirmation' }],
}
const sales = {
  status: 'ready',
  dashboard: { leads: 1, qualified: 1, dueToday: 1, pending: 1 },
  leads: [],
  actions: [{ id: 'intent-0', summary: '跟进长沙新能源意向', channel: '小红书', status: 'awaiting_confirmation' }],
  intent: null,
}
const contentCommand = {
  status: 'ready',
  dashboard: { articles: 1, pendingReview: 1, reviewed: 0, publishReady: 0 },
  sources: {
    geoflow: { status: 'ready', data: {} },
    georank: { status: 'empty', data: {} },
  },
  platforms: [],
  articles: [{
    id: 'article:41', articleId: 41, title: '新能源用车指南', summary: '面向城市通勤场景的选车建议',
    content: '# 新能源用车指南\n\n根据通勤里程与补能条件选择车型。', status: 'draft', reviewStatus: 'pending',
    taskName: '内容生产', categoryName: '用车知识', authorName: '内容团队', generatedAt: '2026-09-08T03:00:00.000Z',
    humanize: { status: 'processed', score: 18, issues: [] }, selectedPlatforms: [], platformStatus: {},
  }],
}
let contentUnavailable = false
let recruiterActionRequests = 0
let releaseRecruiterAction
const recruiterActionReady = new Promise(resolve => { releaseRecruiterAction = resolve })
const recruiter = {
  status: 'ready',
  dashboard: { openRoles: 1, activeCandidates: 2, pendingReplies: 1, pendingFeedback: 0, pendingConfirmation: 1, responseRate: 75 },
  requirements: [],
  candidates: [],
  actions: [{ id: 'recruiter-action-1', targetLabel: '候选人 A', summary: '发送面试邀请', status: 'awaiting_confirmation' }],
  boss: { status: 'ready', adapter: 'official', inAppBrowser: true },
  sync: { status: 'ready', imported: 2, updated: 1 },
  knowledge: { status: 'ready', spaces: 1, documents: 4, memories: 2, pending: 1 },
  analytics: {},
  updatedAt: '2026-09-08T03:00:00.000Z',
}
let retrofitStoredRequests = 0
let retrofitRefreshRequests = 0
let releaseRetrofitRefresh
const retrofitRefreshReady = new Promise(resolve => { releaseRetrofitRefresh = resolve })
const retrofitStored = {
  status: 'ready',
  source: 'database',
  retrievedAt: '2026-09-08T03:00:00.000Z',
  result: {
    total: 1,
    returned: 1,
    items: [{ platform: 'bilibili', externalId: 'lock-1', title: 'SUV 灯光升级', text: '城市通勤照明方案', commentCount: 18, shareCount: 6 }],
  },
}
const retrofitExternal = {
  status: 'ready',
  source: 'agent_reach',
  platform: 'youtube',
  retrievedAt: '2026-09-08T03:00:00.000Z',
  result: { stdout: JSON.stringify([{ title: 'LED lighting reference', text: 'Public reference only', url: 'https://example.test/retrofit-lock' }]) },
}

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const consoleProblems = []
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => consoleProblems.push(`pageerror: ${error.message}`))
await page.route('**/api/desktop/yootun/daily-report', async route => {
  if (dailyRefreshFails) {
    dailyRefreshRequests += 1
    await dailyRefreshReady
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{' })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dailyReport) })
})
await page.route('**/api/desktop/yootun/dashboard/yesterday', async route => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboard) })
})
await page.route('**/api/desktop/yootun/dashboard/series', async route => {
  const days = route.request().postDataJSON().days
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    ...dashboard,
    period: { ...dashboard.period, label: `近${days}天`, days },
    activity: { ...dashboard.activity, comparison: { status: 'unavailable', reason: 'activity_incomplete' }, data: {
      totals: dashboard.activity.data.totals,
      days: Array.from({ length: days }, (_, index) => ({ date: `2026-08-${String(index + 1).padStart(2, '0')}`, turns: index === 0 ? 6 : 0 })),
    } },
  }) })
})
await page.route('**/api/desktop/yootun/supply-watch', async route => {
  const confirmed = route.request().method() === 'POST'
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(confirmed ? { ...supplyWatch, actions: supplyWatch.actions.map(action => ({ ...action, status: 'adapter_pending' })) } : supplyWatch),
  })
})
await page.route('**/api/desktop/yootun/sales', async route => {
  const method = route.request().method()
  salesRequestMethods.push(method)
  const confirmed = method === 'POST'
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(salesUnavailable ? { status: 'error', dashboard: {}, leads: [], actions: [], intent: { status: 'error' } } : confirmed ? { ...sales, dashboard: { ...sales.dashboard, pending: 0 }, actions: sales.actions.map(action => ({ ...action, status: 'adapter_pending' })) } : sales),
  })
})
await page.route('**/api/desktop/yootun/content-command', async route => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contentUnavailable ? { status: 'error', dashboard: { articles: 0, pendingReview: 0, reviewed: 0, publishReady: 0 }, sources: {}, platforms: [], articles: [] } : contentCommand) })
})
await page.route('**/api/desktop/yootun/finops?*', async route => {
  if (finopsRefreshFails) {
    finopsRefreshRequests += 1
    await finopsRefreshReady
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{' })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(finops) })
})
await page.route('**/api/desktop/yootun/knowledge', async route => {
  if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'graph') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: {
        nodes: [{ id: 'memory-1', entityId: 'memory-1', type: 'MEMORY', label: knowledgeNodeLabel, status: 'CONFIRMED' }],
        edges: [],
        generatedAt: '2026-09-08T03:00:00.000Z',
        projection: { status: 'projected' },
      } }),
    })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(knowledge) })
})
await page.route('**/api/desktop/yootun/lead-discovery', async route => {
  const body = route.request().postDataJSON()
  if (body.action === 'candidates') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ready', items: [], stats: { total: 0 } }),
    })
    return
  }
  if (body.action === 'page') {
    leadPageRequests += 1
    await leadPageReady
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ready', items: [], nextCursor: null, hasMore: false }),
    })
    return
  }
  assert.equal(body.action, 'discover', 'only discovery requests should wait on the manual search fixture')
  leadSearchRequests += 1
  await leadSearchReady
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'ready',
      resultRef: 'lead-ref',
      nextCursor: 'cursor-1',
      hasMore: true,
      stats: { total: 1, totalAvailable: 2 },
      items: [{
        leadLevel: 'A',
        platform: 'xiaohongshu-v2',
        intentScore: 88,
        aiSummary: '近期计划购买新能源 SUV，正在比较车型。',
        city: '长沙',
        recommendedAction: '优先联系并确认预算。',
        sourceUrl: 'https://example.test/lead',
      }],
      retrievedAt: '2026-09-08T03:00:00.000Z',
    }),
  })
})
await page.route('**/api/desktop/yootun/recruiter', async route => {
  if (route.request().method() === 'POST') {
    recruiterActionRequests += 1
    await recruiterActionReady
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...recruiter, actions: recruiter.actions.map(action => ({ ...action, status: 'adapter_pending' })) }),
    })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recruiter) })
})
await page.route('**/api/desktop/yootun/retrofit', async route => {
  const body = route.request().postDataJSON()
  if (body.action === 'refresh') {
    retrofitRefreshRequests += 1
    await retrofitRefreshReady
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(retrofitExternal) })
    return
  }
  retrofitStoredRequests += 1
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(retrofitStored) })
})

async function settleStrictMode() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function assertViewport() {
  await assertAccessibleSurface(page)
}

async function assertDesktopViewport(header = '.yd-header', content = '.yd-overview') {
  await assertAccessibleSurface(page)
  const viewport = await page.evaluate(({ header, content }) => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerHeight: document.querySelector(header)?.getBoundingClientRect().height ?? 0,
    contentWidth: document.querySelector(content)?.getBoundingClientRect().width ?? 0,
  }), { header, content })
  assert.equal(viewport.clientWidth, 1440)
  assert.equal(viewport.scrollWidth, viewport.clientWidth, 'desktop page must not scroll horizontally')
  assert(viewport.headerHeight >= 72, `desktop header must preserve the 72px baseline: ${JSON.stringify(viewport)}`)
  assert(viewport.contentWidth > 0 && viewport.contentWidth <= 1440, `desktop content must render within a constrained width: ${JSON.stringify(viewport)}`)
}

try {
  await page.goto(`${url}?source=dashboard`)
  if (officialThemeCss) {
    const themeState = await page.evaluate(() => ({
      dark: document.body.hasAttribute('data-ds-dark-theme'),
      scheme: getComputedStyle(document.documentElement).colorScheme,
      brand: getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim(),
    }))
    const dark = visualTheme === 'official-dark'
    assert.equal(themeState.dark, dark)
    assert.equal(themeState.scheme, dark ? 'dark' : 'light')
    assert.equal(themeState.brand, dark ? 'rgb(249, 250, 251)' : 'rgb(15, 17, 21)')
  }
  await page.getByRole('button', { name: '企业看板' }).click()
  await page.getByRole('heading', { name: '企业驾驶舱' }).waitFor()
  await page.locator('.yd-overview').waitFor()
  await page.waitForFunction(() => document.querySelector('.yd-content')?.getAttribute('aria-busy') === 'false')
  await page.getByRole('button', { name: '视频生产', exact: true }).click()
  await page.getByRole('heading', { name: '最近作业' }).waitFor()
  assert.equal(await page.getByText('待审批', { exact: true }).count(), 1)
  assert.equal(await page.getByText('语音识别', { exact: true }).count(), 1)
  assert.equal(await page.getByText('画面分析', { exact: true }).count(), 1)
  assert.equal(await page.getByText('waiting_approval', { exact: true }).count(), 0)
  assert.equal(await page.getByText('asr', { exact: true }).count(), 0)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-dashboard-statuses.png'), fullPage: true })

  const completeDashboardActivity = dashboard.activity
  dashboard.activity = {
    status: 'partial', reason: 'activity_partial', source: 'local_agent', sourceCompleteness: 'partial',
    coverage: { total: 2, loaded: 1, failed: 1, unscanned: 0 },
    data: { totals: { sessions: 1, turns: 6, completedTurns: 5, failedTurns: 1, toolCalls: 9 }, sessions: [{ title: '渠道复盘', workspace: '华东项目', turns: 6, completedTurns: 5, failedTurns: 1 }], tools: [] },
  }
  await page.getByRole('button', { name: '刷新数据' }).click()
  await page.waitForFunction(() => document.querySelector('.yd-content')?.getAttribute('aria-busy') === 'false')
  await page.getByRole('button', { name: 'Agent 工作', exact: true }).click()
  await page.getByText('工作统计不完整，以下仅统计已成功读取的会话。', { exact: true }).waitFor()
  assert.equal(await page.getByText('渠道复盘', { exact: true }).isVisible(), true)
  assert.equal(await page.locator('.yd-metric strong').nth(1).textContent(), '6')
  assert.equal(await page.getByText('已读取会话: 1 / 2', { exact: true }).isVisible(), true)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-dashboard-activity-partial.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '总览', exact: true }).click()
  await page.locator('.yd-attention-main').filter({ hasText: 'Agent 工作 · 部分可用' }).waitFor()
  assert.equal(await page.getByText('3/4', { exact: true }).isVisible(), true)
  await assertDesktopViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '1440-dashboard-activity-partial.png'), fullPage: true })
  await page.getByRole('button', { name: 'Agent 工作', exact: true }).click()
  await page.getByRole('button', { name: '近7天', exact: true }).click()
  await page.locator('.yd-trend').waitFor()
  assert.equal(await page.locator('.yd-metric-hint').filter({ hasText: '数据不完整，暂不比较' }).count(), 4)
  assert.equal(await page.locator('.yd-activity-notice').isVisible(), true)
  assert.equal(await page.locator('.yd-metric strong').nth(1).textContent(), '6')
  const activitySpacing = await page.evaluate(() => {
    const metrics = document.querySelector('.yd-activity-detail>.yd-metrics').getBoundingClientRect()
    const trend = document.querySelector('.yd-activity-detail>.yd-table-section').getBoundingClientRect()
    return trend.top - metrics.bottom
  })
  assert.equal(activitySpacing, 24, 'activity trends use the same 24px section spacing as other dashboard details')
  await assertDesktopViewport('.yd-header', '.yd-content')
  await page.screenshot({ path: resolve(evidenceRoot, '1440-dashboard-activity-series-partial.png'), fullPage: true })
  dashboard.activity = { status: 'unavailable', reason: 'activity_unavailable', source: 'local_agent', sourceCompleteness: 'unknown' }
  await page.getByRole('button', { name: '昨日', exact: true }).click()
  await page.getByRole('button', { name: '刷新数据' }).click()
  await page.locator('.yd-empty-unavailable').waitFor()
  assert.equal(await page.locator('.yd-metric').count(), 0)
  assert.equal(await page.locator('.yd-activity-notice').count(), 0)
  dashboard.activity = completeDashboardActivity
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto(`${url}?source=supply`)
  await page.getByRole('button', { name: '供应链预警' }).click()
  await page.getByRole('heading', { name: '供应链预警' }).waitFor()
  await page.getByText('风险等级: P0 · 紧急', { exact: true }).first().waitFor()
  assert.equal(await page.getByText('风险状态: 未关闭', { exact: true }).count(), 1)
  assert.equal(await page.getByText('未关闭', { exact: true }).count() > 0, true)
  await page.getByRole('button', { name: '确认复核' }).click()
  await page.getByText('已确认，等待适配器', { exact: true }).waitFor()
  const supplyText = await page.locator('.ysw-content').innerText()
  assert.doesNotMatch(supplyText, /undefined|adapter_pending/iu)
  assert.equal(await page.getByText('open', { exact: true }).count(), 0)
  assert.equal(await page.getByText('p0', { exact: true }).count(), 0)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-supply-statuses.png'), fullPage: true })

  await page.goto(`${url}?source=sales`)
  await page.getByRole('button', { name: '销售协同' }).click()
  await page.getByRole('heading', { name: '销售协同' }).waitFor()
  const pendingMetric = page.locator('.ys-metric').filter({ hasText: '待确认' })
  await pendingMetric.getByText('1', { exact: true }).waitFor()
  assert.equal((await pendingMetric.innerText()).trim(), '待确认\n1')
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await page.getByText('已确认，等待适配器', { exact: true }).waitFor()
  assert.equal(await page.getByText('adapter_pending', { exact: true }).count(), 0)
  assert.deepEqual(salesRequestMethods, ['GET', 'POST'])
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-sales-status.png'), fullPage: true })
  salesUnavailable = true
  await page.getByRole('button', { name: '刷新' }).click()
  await page.getByRole('alert').getByText('刷新失败，当前仍显示上次数据', { exact: true }).waitFor()
  assert.equal(await page.locator('.ys-metrics').count(), 1)
  await page.mouse.move(195, 420)
  await settleStrictMode()
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-sales-unavailable.png'), fullPage: true })

  await page.goto(`${url}?source=content`)
  await page.getByRole('button', { name: 'GEO工作台' }).click()
  await page.getByRole('heading', { name: 'GEO 内容运营' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.ycc-shell')?.getAttribute('aria-busy') === 'false')
  await page.getByRole('button', { name: /内容审核与发布/u }).click()
  await page.getByRole('heading', { name: '新能源用车指南' }).waitFor()
  assert.equal(await page.locator('.ycc-meta dd').first().innerText(), '草稿')
  assert.equal(await page.getByText('draft', { exact: true }).count(), 0)
  const contentGeometry = await page.evaluate(() => {
    const toolbar = document.querySelector('.ycc-queue-toolbar')?.getBoundingClientRect()
    const detail = document.querySelector('.ycc-detail')?.getBoundingClientRect()
    return toolbar && detail ? { toolbarBottom: toolbar.bottom, detailTop: detail.top } : null
  })
  assert(contentGeometry, 'content review geometry must be measurable')
  assert(contentGeometry.detailTop >= contentGeometry.toolbarBottom, 'article detail must not overlap the mobile review toolbar')
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-content-workflow.png'), fullPage: true })
  contentUnavailable = true
  await page.getByRole('button', { name: '刷新数据' }).click()
  await page.getByRole('alert').getByText('刷新失败，当前仍显示上次数据', { exact: true }).waitFor()
  assert.equal(await page.locator('.ycc-overview,.ycc-review-workspace').count(), 1)
  await page.mouse.move(195, 420)
  await settleStrictMode()
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-content-unavailable.png'), fullPage: true })

  await page.goto(`${url}?source=daily`)
  await page.getByRole('button', { name: '昨日工作' }).click()
  await page.getByText('渠道复盘').waitFor()
  dailyRefreshFails = true
  const dailyRefresh = page.getByRole('button', { name: '刷新' })
  await dailyRefresh.click()
  await page.locator('.ydr-content[aria-busy="true"]').waitFor()
  await dailyRefresh.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(dailyRefreshRequests, 1, 'an active daily report refresh must reject duplicate submissions')
  assert.equal(await dailyRefresh.isDisabled(), true)
  releaseDailyRefresh()
  await page.getByRole('alert').getByText('刷新失败，当前保留上次结果。').waitFor()
  assert.equal(await page.getByText('渠道复盘').isVisible(), true, 'failed refresh must keep the previous report')
  assert.equal(await page.getByRole('button', { name: '重新加载' }).isEnabled(), true)
  await assertViewport()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: resolve(evidenceRoot, '390-daily-refresh-error.png'), fullPage: true })
  dailyRefreshFails = false
  const completeActivity = dailyReport.activity
  dailyReport.activity = { ...completeActivity, status: 'partial', reason: 'activity_partial', coverage: { total: 2, loaded: 1, failed: 1, unscanned: 0 } }
  dailyReport.sources.local = { status: 'partial', reason: 'activity_partial' }
  await page.getByRole('button', { name: '重新加载' }).click()
  await page.getByText('日报不完整，以下仅统计已成功读取的会话。', { exact: false }).waitFor()
  assert.equal(await page.getByText('渠道复盘', { exact: true }).count(), 1)
  assert.equal(await page.getByText('部分可用', { exact: true }).count(), 1)
  assert.equal(await page.locator('.ydr-metric strong').nth(1).textContent(), '6')
  assert.equal((await page.locator('body').innerText()).includes('activity_partial'), false)
  const partialColors = await page.evaluate(() => ({
    banner: getComputedStyle(document.querySelector('.ydr-inline-warning')).color,
    source: getComputedStyle(document.querySelector('.ydr-source-partial')).color,
    body: getComputedStyle(document.querySelector('.ydr-overlay')).color,
  }))
  assert.equal(partialColors.banner, partialColors.source, 'partial coverage uses the same warning color in banner and source status')
  assert.notEqual(partialColors.banner, partialColors.body)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-daily-partial.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await assertDesktopViewport('.ydr-header', '.ydr-metrics')
  await page.screenshot({ path: resolve(evidenceRoot, '1440-daily-partial.png'), fullPage: true })
  dailyReport.activity = completeActivity
  dailyReport.sources.local = { status: 'ready' }
  await page.getByRole('button', { name: '重新加载' }).click()
  await page.locator('.ydr-inline-warning').waitFor({ state: 'hidden' })
  assert.equal(await page.getByText('渠道复盘', { exact: true }).count(), 1)
  dailyReport.activity = { status: 'unavailable', reason: 'activity_unavailable' }
  dailyReport.sources.local = { status: 'unavailable', reason: 'activity_unavailable' }
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '本机事件暂不可用' }).waitFor()
  assert.deepEqual(await page.locator('.ydr-metric strong').allTextContents(), Array(5).fill('不可用'))
  assert.equal(await page.getByText('昨日没有可汇总的工作记录', { exact: true }).count(), 0)
  await assertDesktopViewport('.ydr-header', '.ydr-metrics')
  await page.screenshot({ path: resolve(evidenceRoot, '1440-daily-unavailable.png'), fullPage: true })
  const longSessionTitle = '华东汽车渠道季度复盘与长周期客户跟进记录'
  dailyReport.activity = { ...completeActivity, sessions: [{
    ...completeActivity.sessions[0], title: longSessionTitle,
    workspace: 'LongWorkspaceNameWithoutSpacesForRegionalCustomerOperations',
  }] }
  dailyReport.sources.local = { status: 'ready' }
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText(longSessionTitle, { exact: true }).waitFor()
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 })
    await page.locator('.ydr-row').scrollIntoViewIfNeeded()
    await assertViewport()
    const rowFits = await page.locator('.ydr-row').evaluate(row => [...row.children]
      .every(element => element.scrollWidth <= element.clientWidth + 1))
    assert(rowFits, 'long session and workspace names must remain readable inside the report row')
    await page.screenshot({ path: resolve(evidenceRoot, `${width}-daily-long-title.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto(`${url}?source=finops`)
  await page.getByRole('button', { name: '模型与预算' }).click()
  await page.getByRole('heading', { name: '模型与预算治理' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yf-content')?.getAttribute('aria-busy') === 'false')
  assert.match(await page.locator('.yf-metric').first().innerText(), /12\.50/u)
  finopsRefreshFails = true
  const finopsRefresh = page.getByRole('button', { name: '刷新数据' })
  await finopsRefresh.click()
  await page.locator('.yf-content[aria-busy="true"]').waitFor()
  await finopsRefresh.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(finopsRefreshRequests, 1, 'an active FinOps refresh must reject duplicate submissions')
  assert.equal(await finopsRefresh.isDisabled(), true)
  releaseFinopsRefresh()
  await page.getByRole('alert').getByText('刷新失败，当前仍显示上次数据。').waitFor()
  assert.match(await page.locator('.yf-metric').first().innerText(), /12\.50/u, 'failed refresh must keep the previous spend')
  assert.equal(await page.getByRole('button', { name: '重新加载' }).isEnabled(), true)
  await assertViewport()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: resolve(evidenceRoot, '390-finops-refresh-error.png'), fullPage: true })

  await page.goto(`${url}?source=knowledge`)
  await page.getByRole('button', { name: '企业知识' }).click()
  await page.getByRole('heading', { name: '企业知识与记忆' }).waitFor()
  await page.getByText('渠道政策').waitFor()
  assert.equal(await page.getByText('已就绪', { exact: true }).count() > 0, true)
  assert.equal(await page.getByText('ready', { exact: true }).count(), 0)
  const knowledgeTheme = await page.evaluate(() => {
    const token = name => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      document.body.appendChild(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return value
    }
    const style = selector => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`missing knowledge fixture element: ${selector}`)
      return getComputedStyle(element)
    }
    return {
      border: token('--dsw-alias-border-l1'),
      layer1: token('--dsw-alias-bg-layer-1'),
      layer2: token('--dsw-alias-bg-layer-2'),
      secondary: token('--dsw-alias-label-secondary'),
      metricBorder: style('.yk-metric').borderRightColor,
      recordIcon: style('.yk-record-icon').backgroundColor,
      templateIcon: style('.yk-template b').backgroundColor,
      quietBackground: style('.yk-quiet').backgroundColor,
      quietColor: style('.yk-quiet').color,
    }
  })
  assert.equal(knowledgeTheme.metricBorder, knowledgeTheme.border)
  assert.equal(knowledgeTheme.recordIcon, knowledgeTheme.layer2)
  assert.equal(knowledgeTheme.templateIcon, knowledgeTheme.layer2)
  assert.equal(knowledgeTheme.quietBackground, knowledgeTheme.layer1)
  assert.equal(knowledgeTheme.quietColor, knowledgeTheme.secondary)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-knowledge-theme.png'), fullPage: true })
  await page.getByRole('button', { name: '知识图谱' }).click()
  await page.getByRole('button', { name: '重点客户偏好' }).waitFor()
  await page.getByRole('button', { name: '重点客户偏好' }).click()
  await page.locator('.yk-node-detail').getByText('已确认', { exact: true }).waitFor()
  assert.equal(await page.locator('.yk-node-detail').getByText('CONFIRMED', { exact: true }).count(), 0)
  await page.locator('.yk-node-detail').scrollIntoViewIfNeeded()
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-knowledge-node-status.png'), fullPage: true })
  knowledgeNodeLabel = 'CustomerPreferencesAndLongTermChannelFollowUpWithoutSpaces'
  await page.reload()
  await page.getByRole('button', { name: '企业知识' }).click()
  await page.getByText('渠道政策').waitFor()
  await page.getByRole('button', { name: '知识图谱' }).click()
  const longNode = page.getByRole('button', { name: knowledgeNodeLabel, exact: true })
  await longNode.waitFor()
  await longNode.focus()
  await longNode.press('Enter')
  await page.locator('.yk-node-detail').getByText(knowledgeNodeLabel, { exact: true }).waitFor()
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 })
    await page.locator('.yk-node-detail').scrollIntoViewIfNeeded()
    await assertViewport()
    const detailFits = await page.locator('.yk-node-detail strong').evaluate(element => element.scrollWidth <= element.clientWidth + 1)
    assert(detailFits, 'a selected node name must wrap inside its detail card')
    await page.screenshot({ path: resolve(evidenceRoot, `${width}-knowledge-long-node.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto(`${url}?source=lead`)
  await page.getByRole('button', { name: '购车线索发现' }).click()
  const leadInput = page.getByRole('textbox', { name: '输入城市、车型或购车意向，例如：长沙 想买新能源 SUV' })
  await leadInput.waitFor()
  await settleStrictMode()
  await leadInput.fill('长沙 新能源 SUV')
  await leadInput.press('Enter')
  await page.locator('.yl-content[aria-busy="true"]').waitFor()
  await leadInput.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.equal(leadSearchRequests, 1, 'an active lead search must reject duplicate Enter submissions')
  assert.equal(await leadInput.isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '小红书' }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '正在检索' }).isDisabled(), true)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-lead-search-lock.png'), fullPage: true })
  releaseLeadSearch()
  await page.waitForFunction(() => document.querySelector('.yl-content')?.getAttribute('aria-busy') === 'false')

  const loadMore = page.getByRole('button', { name: '加载更多' })
  await loadMore.click()
  await page.locator('.yl-content[aria-busy="true"]').waitFor()
  await leadInput.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.equal(leadPageRequests, 1, 'lead pagination must execute once')
  assert.equal(leadSearchRequests, 1, 'active pagination must reject a new lead search')
  assert.equal(await leadInput.isDisabled(), true)
  assert.equal(await page.getByRole('tab', { name: '发现线索' }).isDisabled(), true)
  assert.equal(await page.getByRole('tab', { name: '已存候选' }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '正在读取…' }).isDisabled(), true)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-lead-page-lock.png'), fullPage: true })
  releaseLeadPage()
  await page.waitForFunction(() => document.querySelector('.yl-content')?.getAttribute('aria-busy') === 'false')

  await page.goto(`${url}?source=recruiter`)
  await page.getByRole('button', { name: '招聘工作台' }).click()
  await page.getByRole('heading', { name: 'HR 招聘工作台' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yr-content')?.getAttribute('aria-busy') === 'false')
  const recruiterApprove = page.getByRole('button', { name: '确认动作' })
  await recruiterApprove.click()
  await page.locator('.yr-content[aria-busy="true"]').waitFor()
  await recruiterApprove.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(recruiterActionRequests, 1, 'an active recruiter action must reject duplicate submissions')
  assert.equal(await recruiterApprove.isDisabled(), true)
  assert.equal(await page.locator('.yr-tabs button:not(:disabled)').count(), 0)
  assert.equal(await page.locator('.yr-source-button:not(:disabled)').count(), 0)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-recruiter-action-lock.png'), fullPage: true })
  releaseRecruiterAction()
  await page.waitForFunction(() => document.querySelector('.yr-content')?.getAttribute('aria-busy') === 'false')
  await page.getByRole('button', { name: '待办审批' }).click()
  await page.getByText('已确认，等待适配器', { exact: true }).waitFor()
  assert.equal(await page.getByText('adapter_pending', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '执行动作' }).count(), 0)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-recruiter-status.png'), fullPage: true })

  await page.goto(`${url}?source=retrofit`)
  await page.getByRole('button', { name: '改装方案库' }).click()
  await page.getByRole('heading', { name: '车辆改装方案库' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yro-content')?.getAttribute('aria-busy') === 'false')
  assert.equal(retrofitStoredRequests, 1, 'initial stored-data load must execute once')
  const retrofitInput = page.getByRole('textbox', { name: '输入车型、改装项目或使用场景' })
  await retrofitInput.fill('SUV LED')
  await page.getByRole('button', { name: '刷新公开来源' }).click()
  await page.locator('.yro-content[aria-busy="true"]').waitFor()
  await retrofitInput.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.equal(retrofitRefreshRequests, 1, 'an active retrofit refresh must reject duplicate Enter submissions')
  assert.equal(await retrofitInput.isDisabled(), true)
  assert.equal(await page.getByRole('combobox', { name: '内容平台' }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '正在检索' }).isDisabled(), true)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-retrofit-search-lock.png'), fullPage: true })
  releaseRetrofitRefresh()
  await page.getByRole('heading', { name: '公开来源参考' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yro-content')?.getAttribute('aria-busy') === 'false')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${url}?source=dashboard`)
  await page.getByRole('button', { name: '企业看板' }).click()
  await page.getByRole('heading', { name: '企业驾驶舱' }).waitFor()
  await page.locator('.yd-overview').waitFor()
  await page.waitForFunction(() => document.querySelector('.yd-content')?.getAttribute('aria-busy') === 'false')
  await assertDesktopViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '1440-dashboard-overview.png'), fullPage: true })

  assert.deepEqual(consoleProblems, [])
  process.stdout.write(`search-locks-browser: ${visualTheme}, 10 plugins, 26 screenshots, request locks, report coverage, long text, keyboard selection, and responsive theme mappings verified\n`)
} finally {
  releaseDailyRefresh()
  releaseFinopsRefresh()
  releaseLeadSearch()
  releaseLeadPage()
  releaseRecruiterAction()
  releaseRetrofitRefresh()
  await page.close()
  await browser.close()
  await vite.close()
}
