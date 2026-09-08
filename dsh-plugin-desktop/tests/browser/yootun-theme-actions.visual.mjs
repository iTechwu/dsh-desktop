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
  dashboard: resolve(workspaceRoot, '.ci/dsh-yootun-dashboard/src/client.js'),
  xhs: resolve(workspaceRoot, '.ci/dsh-yootun-xhs-operation/src/client.js'),
}
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
assert(existsSync(browserExecutable), `Chrome executable not found: ${browserExecutable}`)

let activeSource = sources.dashboard
const vite = await createServer({
  root: harnessRoot,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'theme-action-source',
    configureServer(server) {
      server.middlewares.use('/__audit_source__', async (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(await readFile(activeSource, 'utf8'))
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

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const page = await browser.newPage()
const consoleProblems = []
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => consoleProblems.push(`pageerror: ${error.message}`))
await page.route('**/api/desktop/yootun/dashboard/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboard) }))
await page.route('**/_dsh/uploader/pick-file', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ picked: true, path: '/tmp/theme-action.png', name: 'theme-action.png', size: 1024, mime: 'image/png' }) }))
await page.route('**/_dsh/uploader/uploadStart', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uploadId: 'upload-1', name: 'theme-action.png', size: 1024 }) }))
await page.route('**/_dsh/uploader/uploadStatus', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'done', url: 'https://cdn.example.test/theme-action.png' }) }))
await page.route('**/_dsh/uploader/media*', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }))
await page.route('**/api/desktop/yootun/xhs-operation', async route => {
  const body = route.request().postDataJSON()
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
  activeSource = sources.dashboard
  await page.goto(url)
  await page.getByRole('button', { name: '企业看板' }).click()
  const activeRange = page.getByRole('button', { name: '昨日' })
  await activeRange.waitFor()
  await assertActionContrast(activeRange)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-dashboard-range.png'), fullPage: true })

  activeSource = sources.xhs
  await page.goto(url)
  await page.getByRole('button', { name: '小红书仿写' }).click()
  await page.getByRole('button', { name: '添加图片' }).click()
  const submit = page.getByRole('button', { name: '开始仿写' })
  await submit.waitFor()
  await page.waitForFunction(() => !document.querySelector('.yxh-submit')?.disabled)
  await assertActionContrast(submit)
  await submit.click()
  await page.getByRole('button', { name: '取消任务' }).click()
  const confirm = page.getByRole('button', { name: '是' })
  await confirm.waitFor()
  await assertActionContrast(confirm)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-xhs-confirm.png'), fullPage: true })

  assert.deepEqual(consoleProblems, [])
  process.stdout.write('theme-actions-browser: 2 plugins, 2 screenshots, adaptive action contrast and mobile layout passed\n')
} finally {
  await page.close()
  await browser.close()
  await vite.close()
}
