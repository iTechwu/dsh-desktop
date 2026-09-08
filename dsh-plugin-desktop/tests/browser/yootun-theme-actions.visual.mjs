import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const packageRoot = resolve(here, '../..')
const workspaceRoot = resolve(packageRoot, '..')
const harnessRoot = resolve(here, 'yootun-audit')
const evidenceRoot = resolve(workspaceRoot, 'docs/superpowers/evidence/2026-09-08-theme-actions')
const sources = {
  contentCommand: resolve(workspaceRoot, '.ci/dsh-yootun-content-command/src/client.js'),
  dashboard: resolve(workspaceRoot, '.ci/dsh-yootun-dashboard/src/client.js'),
  retrofit: resolve(workspaceRoot, '.ci/dsh-yootun-retrofit/src/client.js'),
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
  assert.equal(styles.color, 'rgb(255, 255, 255)')
}

async function assertThemePaint(locator, alias, paintProperty) {
  const colors = await locator.evaluate((element, { property, paint }) => {
    const probe = document.createElement('span')
    probe.style[paint] = `var(${property})`
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
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    dialog: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
  }))
  assert.equal(viewport.scrollWidth, viewport.clientWidth, 'page must not scroll horizontally')
  assert.equal(viewport.dialog, true, 'overlay must expose modal dialog semantics')
}

try {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}?source=dashboard`)
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
  releaseContentCommand()
  await page.getByRole('heading', { name: 'GEO 内容运营' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.ycc-shell')?.getAttribute('aria-busy') === 'false')
  assert.equal(await page.locator('style[data-plugin="@dofe/dsh-yootun-content-command"]').count(), 1)
  await assertThemeColor(page.locator('.ycc-certified'), '--dsw-alias-state-success-primary')
  await assertThemeColor(page.locator('.ycc-kpi[data-tone="warning"] > strong').first(), '--dsw-alias-state-warn-primary')
  await assertThemeColor(page.locator('.ycc-kpi[data-tone="danger"] > strong').first(), '--dsw-alias-state-error-primary')
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-content-status.png'), fullPage: true })

  await page.goto(`${url}?source=retrofit`)
  await page.getByRole('button', { name: '改装方案库' }).click()
  await page.locator('.yr-content[aria-busy="true"]').waitFor()
  releaseRetrofitStored()
  await page.getByRole('heading', { name: '车辆改装方案库' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yr-content')?.getAttribute('aria-busy') === 'false')
  await assertThemeBackground(page.locator('.yr-source-dot'), '--dsw-alias-state-success-primary')
  await page.getByRole('textbox', { name: '输入车型、改装项目或使用场景' }).fill('SUV LED')
  await page.getByRole('button', { name: '刷新公开来源' }).click()
  await page.locator('.yr-content[aria-busy="true"]').waitFor()
  releaseRetrofitExternal()
  await page.getByRole('heading', { name: '公开来源参考' }).waitFor()
  await assertThemeBackground(page.locator('.yr-source-dot'), '--dsw-alias-state-warn-primary')
  await assertThemeColor(page.locator('.yr-external-note'), '--dsw-alias-state-warn-primary')
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-retrofit-external.png'), fullPage: true })

  assert.deepEqual(consoleProblems, [])
  process.stdout.write('theme-actions-browser: 4 plugins, 4 screenshots, adaptive action/status contrast and mobile layout passed\n')
} finally {
  await page.close()
  await browser.close()
  await vite.close()
}
