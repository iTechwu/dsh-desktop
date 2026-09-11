import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'
import { assertAccessibleSurface } from './assert-accessible-surface.mjs'
import { assertTextContrast } from './assert-text-contrast.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const packageRoot = resolve(here, '../..')
const workspaceRoot = resolve(packageRoot, '..')
const harnessRoot = resolve(here, 'yootun-audit')
const visualTheme = process.env.DSH_VISUAL_THEME || 'custom'
assert(['custom', 'official-light', 'official-dark'].includes(visualTheme), `Unknown visual theme: ${visualTheme}`)
const officialThemeCss = visualTheme === 'custom' ? null : await readFile(
  resolve(workspaceRoot, 'deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css'), 'utf8',
)
const evidenceRoot = process.env.DSH_VISUAL_EVIDENCE_ROOT
  ? resolve(process.env.DSH_VISUAL_EVIDENCE_ROOT)
  : resolve(workspaceRoot, 'docs/superpowers/evidence/2026-09-08-theme-actions', visualTheme)
const sources = {
  contentCommand: resolve(workspaceRoot, '.ci/dsh-yootun-content-command/src/client.js'),
  dashboard: resolve(workspaceRoot, '.ci/dsh-yootun-dashboard/src/client.js'),
  retrofit: resolve(workspaceRoot, '.ci/dsh-yootun-retrofit/src/client.js'),
  sales: resolve(workspaceRoot, '.ci/dsh-yootun-sales/src/client.js'),
  xhs: resolve(workspaceRoot, '.ci/dsh-yootun-xhs-operation/src/client.js'),
}
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
assert(existsSync(browserExecutable), `Chrome executable not found: ${browserExecutable}`)

const vite = await createServer({
  root: harnessRoot,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'theme-action-source',
    transformIndexHtml(html) {
      if (!officialThemeCss) return html
      const dark = visualTheme === 'official-dark'
      return {
        html: html.replace('<body>', dark ? '<body data-ds-dark-theme>' : '<body>'),
        tags: [{ tag: 'style', children: `${officialThemeCss}\n:root { color-scheme: ${dark ? 'dark' : 'light'}; }`, injectTo: 'head' }],
      }
    },
    configureServer(server) {
      server.middlewares.use('/__audit_source__', async (request, response) => {
        const sourceId = new URL(request.url || '/', 'http://127.0.0.1').searchParams.get('source')
        const sourcePath = sources[sourceId] || sources.dashboard
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(await readFile(sourcePath, 'utf8'))
      })
    },
  }],
})
await vite.listen()
const address = vite.httpServer.address()
assert(address && typeof address === 'object')
const url = `http://127.0.0.1:${address.port}`
await mkdir(evidenceRoot, { recursive: true })

const emptySource = source => ({
  status: 'empty', source, sourceCompleteness: 'complete', missingFields: [], data: {},
  comparison: { status: 'ready', baseline: {}, delta: {}, deltaPercent: {} },
})
const dashboard = {
  period: { kind: 'day', date: '2026-09-07', label: '2026-09-07', timeZone: 'Asia/Shanghai' },
  refreshedAt: '2026-09-08T02:00:00.000Z',
  geo: emptySource('geoflow'),
  georank: emptySource('georank'),
  usage: emptySource('models'),
  activity: emptySource('local_agent'),
  montage: emptySource('openmontage'),
  capabilities: {
    tools: { status: 'ready' }, knowledge: { status: 'ready' },
    georank: { status: 'ready' }, openmontage: { status: 'ready' },
  },
}
let releaseDashboard
const dashboardReady = new Promise(resolve => { releaseDashboard = resolve })
const contentCommand = {
  dashboard: { articles: 4, pendingReview: 2, reviewed: 2 },
  sources: {
    georank: {
      status: 'ready',
      data: { score: 78, scoreSource: 'company', company: { name: '优惠豚', certified: true }, reports: [] },
    },
    geoflow: {
      status: 'ready',
      data: {
        kpis: { articles: 4, published: 2, total_views: 12800 },
        taskHealth: { active_tasks: 4, running_jobs: 1, pending_jobs: 2, failed_jobs: 1 },
        performance: { success_rate: 82, avg_generation_time: 46 },
        distributionSummary: { synced: 2, pending: 1, failed: 1 },
        goals: [{ scope: 'global', metric: 'published', actual: 8, target: 12, attainment_pct: 67, pace_pct: 54 }],
      },
    },
  },
  platforms: [],
  articles: [],
}
let releaseContentCommand
const contentCommandReady = new Promise(resolve => { releaseContentCommand = resolve })
const sales = {
  dashboard: { leads: 0, qualified: 0, dueToday: 0, pendingConfirmation: 0 },
  leads: [],
  actions: [{ id: 'follow-up-1', summary: '联系高意向客户', channel: '电话', status: 'awaiting_confirmation' }],
}
let salesSearchRequests = 0
let releaseSalesSearch
const salesSearchReady = new Promise(resolve => { releaseSalesSearch = resolve })
let salesActionRequests = 0
let releaseSalesAction
const salesActionReady = new Promise(resolve => { releaseSalesAction = resolve })
const retrofitStored = {
  status: 'ready',
  source: 'database',
  retrievedAt: '2026-09-08T02:00:00.000Z',
  result: {
    total: 1,
    returned: 1,
    items: [{ platform: 'bilibili', externalId: 'case-1', title: 'SUV 灯光升级', text: '城市通勤照明方案', commentCount: 18, shareCount: 6 }],
  },
}
const retrofitExternal = {
  status: 'ready',
  source: 'agent_reach',
  platform: 'youtube',
  retrievedAt: '2026-09-08T02:00:00.000Z',
  result: { stdout: JSON.stringify([{ title: 'LED lighting reference', text: 'Public reference only', url: 'https://example.test/retrofit' }]) },
}
let releaseRetrofitStored
let releaseRetrofitExternal
const retrofitStoredReady = new Promise(resolve => { releaseRetrofitStored = resolve })
const retrofitExternalReady = new Promise(resolve => { releaseRetrofitExternal = resolve })
let releaseUpload
let releaseXhsCreate
const uploadReady = new Promise(resolve => { releaseUpload = resolve })
const xhsCreateReady = new Promise(resolve => { releaseXhsCreate = resolve })

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const page = await browser.newPage()
const consoleProblems = []
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => consoleProblems.push(`pageerror: ${error.message}`))
await page.route('**/api/desktop/yootun/dashboard/**', async route => {
  await dashboardReady
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboard) })
})
await page.route('**/api/desktop/yootun/content-command', async route => {
  await contentCommandReady
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contentCommand) })
})
await page.route('**/api/desktop/yootun/sales', async route => {
  if (route.request().method() === 'POST') {
    const body = route.request().postDataJSON()
    if (body.action === 'intent_search') {
      salesSearchRequests += 1
      await salesSearchReady
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...sales, intent: { status: 'ready', items: [] } }) })
      return
    }
    salesActionRequests += 1
    await salesActionReady
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...sales, actions: sales.actions.map(action => ({ ...action, status: 'confirmed_pending_adapter' })) }),
    })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sales) })
})
await page.route('**/api/desktop/yootun/retrofit', async route => {
  const body = route.request().postDataJSON()
  await (body.action === 'refresh' ? retrofitExternalReady : retrofitStoredReady)
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.action === 'refresh' ? retrofitExternal : retrofitStored) })
})
await page.route('**/_dsh/uploader/pick-file', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ picked: true, path: '/tmp/theme-action.png', name: 'theme-action.png', size: 1024, mime: 'image/png' }) }))
await page.route('**/_dsh/uploader/uploadStart', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uploadId: 'upload-1', name: 'theme-action.png', size: 1024 }) }))
await page.route('**/_dsh/uploader/uploadStatus', async route => {
  await uploadReady
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', url: 'https://cdn.example.test/theme-action.png' }) })
})
await page.route('**/_dsh/uploader/media*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }))
await page.route('**/api/desktop/yootun/xhs-operation', async route => {
  const body = route.request().postDataJSON()
  if (body.action === 'create') await xhsCreateReady
  const response = body.action === 'create'
    ? { status: 'created', taskId: 'task-1', taskStatus: 'queued' }
    : body.action === 'status'
      ? { status: 'ready', taskStatus: 'queued', currentStep: 'queued' }
      : { status: 'ready', taskStatus: 'cancelled' }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
})

const channels = value => value.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [0, 0, 0]
const luminance = value => channels(value)
  .map(channel => channel / 255)
  .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)

async function assertActionContrast(locator) {
  const styles = await locator.evaluate(element => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }))
  const foreground = luminance(styles.color)
  const background = luminance(styles.background)
  const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  assert(ratio >= 4.5, `action contrast must meet WCAG AA: ${JSON.stringify({ ...styles, ratio })}`)
  await assertThemeColor(locator, '--dsw-alias-label-primary-foreground')
}

async function assertThemePaint(locator, alias, paintProperty) {
  const colors = await locator.evaluate((element, { property, paint }) => {
    const probe = document.createElement('span')
    probe.style[paint] = paint === 'color' && /--dsw-alias-state-(success|warn|error)-primary/u.test(property)
      ? `color-mix(in srgb,var(${property}) 50%,var(--dsw-alias-label-primary))`
      : `var(${property})`
    element.appendChild(probe)
    const expected = getComputedStyle(probe)[paint]
    probe.remove()
    return {
      actual: getComputedStyle(element)[paint],
      expected,
      themeValue: getComputedStyle(element).getPropertyValue(property).trim(),
    }
  }, { property: alias, paint: paintProperty })
  assert.equal(colors.actual, colors.expected, `${alias} must control the rendered ${paintProperty}: ${JSON.stringify(colors)}`)
}

const assertThemeColor = (locator, alias) => assertThemePaint(locator, alias, 'color')
const assertThemeBackground = (locator, alias) => assertThemePaint(locator, alias, 'backgroundColor')

async function assertViewport() {
  await assertAccessibleSurface(page)
  await assertTextContrast(page, '.ycc-kpi > strong,.ycc-distribution-row > span,.yro-external-note,.yxh-error')
}

try {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}?source=dashboard`)
  if (officialThemeCss) {
    const brand = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim())
    assert.equal(brand, visualTheme === 'official-dark' ? 'rgb(249, 250, 251)' : 'rgb(15, 17, 21)')
  }
  await page.getByRole('button', { name: '企业看板' }).click()
  await page.locator('.yd-content[aria-busy="true"]').waitFor()
  releaseDashboard()
  const activeRange = page.getByRole('button', { name: '昨日' })
  await activeRange.waitFor()
  assert.equal(await page.locator('.yd-content').getAttribute('aria-busy'), 'false')
  await assertActionContrast(activeRange)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-dashboard-range.png'), fullPage: true })

  await page.goto(`${url}?source=xhs`)
  await page.getByRole('button', { name: '小红书仿写' }).click()
  await page.getByRole('button', { name: '添加图片' }).click()
  await page.locator('.yxh-shell[aria-busy="true"]').waitFor()
  releaseUpload()
  const submit = page.getByRole('button', { name: '开始仿写' })
  await submit.waitFor()
  await page.waitForFunction(() => !document.querySelector('.yxh-submit')?.disabled)
  await page.waitForFunction(() => document.querySelector('.yxh-shell')?.getAttribute('aria-busy') === 'false')
  await assertActionContrast(submit)
  await submit.click()
  await page.locator('.yxh-shell[aria-busy="true"]').waitFor()
  releaseXhsCreate()
  await page.getByRole('button', { name: '取消任务' }).click()
  const confirm = page.getByRole('button', { name: '是' })
  await confirm.waitFor()
  await assertActionContrast(confirm)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-xhs-confirm.png'), fullPage: true })

  await page.goto(`${url}?source=contentCommand`)
  await page.getByRole('button', { name: 'GEO工作台' }).click()
  await page.locator('.ycc-shell[aria-busy="true"]').waitFor()
  const contentRefresh = page.getByRole('button', { name: '刷新数据' })
  assert.equal(await contentRefresh.isDisabled(), true)
  releaseContentCommand()
  await page.getByRole('heading', { name: 'GEO 内容运营' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.ycc-shell')?.getAttribute('aria-busy') === 'false')
  assert.equal(await contentRefresh.isEnabled(), true)
  assert.equal(await page.locator('style[data-plugin="@dofe/dsh-yootun-content-command"]').count(), 1)
  await assertThemeColor(page.locator('.ycc-certified'), '--dsw-alias-state-success-primary')
  await assertThemeColor(page.locator('.ycc-kpi[data-tone="warning"] > strong').first(), '--dsw-alias-state-warn-primary')
  await assertThemeColor(page.locator('.ycc-kpi[data-tone="danger"] > strong').first(), '--dsw-alias-state-error-primary')
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 390, height: 600 },
    { width: 820, height: 900 },
    { width: 1440, height: 600 },
  ]) {
    await page.setViewportSize(viewport)
    await assertViewport()
    const clipped = await page.locator('.ycc-panel').evaluateAll(panels => panels
      .filter(panel => panel.scrollHeight > panel.clientHeight + 1)
      .map(panel => ({ className: panel.className, height: panel.clientHeight, content: panel.scrollHeight })))
    assert.deepEqual(clipped, [], `overview cards must expose all metrics at ${JSON.stringify(viewport)}`)
    const overlaps = await page.locator('.ycc-panel').evaluateAll(panels => {
      const bounds = panels.map(panel => panel.getBoundingClientRect())
      return bounds.flatMap((a, index) => bounds.slice(index + 1).flatMap(b =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
          ? [{ first: index, top: a.top, bottom: a.bottom, nextTop: b.top }]
          : []))
    })
    assert.deepEqual(overlaps, [], 'overview cards must not overlap when scrolling')
    await page.locator('.ycc-overview').hover()
    await page.mouse.wheel(0, 2400)
    await page.waitForFunction(() => {
      const overview = document.querySelector('.ycc-overview').getBoundingClientRect()
      const lastMetric = document.querySelector('.ycc-distribution-row').getBoundingClientRect()
      return lastMetric.top >= overview.top && lastMetric.bottom <= window.innerHeight
    })
    await page.screenshot({ path: resolve(evidenceRoot, `${viewport.width}x${viewport.height}-content-status.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto(`${url}?source=sales`)
  await page.getByRole('button', { name: '销售协同' }).click()
  const intentInput = page.getByRole('textbox', { name: '一句话描述要找的公开意向，例如：长沙新能源汽车改装讨论' })
  await intentInput.waitFor()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await intentInput.fill('长沙新能源汽车改装讨论')
  await intentInput.press('Enter')
  await page.locator('.ys-intent[aria-busy="true"]').waitFor()
  await intentInput.press('Enter')
  const searching = page.getByRole('button', { name: '正在检索…' })
  assert.equal(await searching.isDisabled(), true)
  assert.equal(salesSearchRequests, 1, 'an active intent search must reject duplicate Enter submissions')
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-sales-searching.png'), fullPage: true })
  releaseSalesSearch()
  await page.waitForFunction(() => document.querySelector('.ys-intent')?.getAttribute('aria-busy') === 'false')
  assert.equal(await page.getByRole('button', { name: '开始检索' }).isEnabled(), true)
  const approveSalesAction = page.getByRole('button', { name: '确认', exact: true })
  await approveSalesAction.click()
  await page.locator('.ys-content[aria-busy="true"]').waitFor()
  assert.equal(await approveSalesAction.isDisabled(), true)
  await approveSalesAction.evaluate(button => button.click())
  assert.equal(salesActionRequests, 1, 'an active follow-up action must reject duplicate submissions')
  releaseSalesAction()
  await page.getByText('已确认，等待适配器').waitFor()
  await page.waitForFunction(() => document.querySelector('.ys-content')?.getAttribute('aria-busy') === 'false')

  await page.goto(`${url}?source=retrofit`)
  await page.getByRole('button', { name: '改装方案库' }).click()
  await page.locator('.yro-content[aria-busy="true"]').waitFor()
  releaseRetrofitStored()
  await page.getByRole('heading', { name: '车辆改装方案库' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yro-content')?.getAttribute('aria-busy') === 'false')
  await assertThemeBackground(page.locator('.yro-source-dot'), '--dsw-alias-state-success-primary')
  await page.getByRole('textbox', { name: '输入车型、改装项目或使用场景' }).fill('SUV LED')
  await page.getByRole('button', { name: '刷新公开来源' }).click()
  await page.locator('.yro-content[aria-busy="true"]').waitFor()
  releaseRetrofitExternal()
  await page.getByRole('heading', { name: '公开来源参考' }).waitFor()
  await assertThemeBackground(page.locator('.yro-source-dot'), '--dsw-alias-state-warn-primary')
  await assertThemeColor(page.locator('.yro-external-note'), '--dsw-alias-state-warn-primary')
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-retrofit-external.png'), fullPage: true })

  assert.deepEqual(consoleProblems, [])
  process.stdout.write(`theme-actions-browser: ${visualTheme}, 5 plugins, 8 screenshots, adaptive action/status contrast and scrollable overview passed\n`)
} finally {
  await page.close()
  await browser.close()
  await vite.close()
}
