import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const harnessRoot = resolve(here, 'plugin-console-harness')
const clientPath = resolve(here, '../../../.ci/dsh-plugin-console/lib/client.js')
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const vite = await createServer({
  root: harnessRoot,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'plugin-console-source',
    configureServer(server) {
      server.middlewares.use('/__plugin_console_source__', async (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(await readFile(clientPath, 'utf8'))
      })
    },
  }],
})
await vite.listen()
const address = vite.httpServer.address()
assert(address && typeof address === 'object')

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const problems = []
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
await page.route('**/plugin-console/**', route => {
  const pathname = new URL(route.request().url()).pathname
  const body = pathname.endsWith('/state')
    ? { entries: [], installJobs: [], compat: { supported: true }, framework: null, github: { loggedIn: false }, patch: { inserts: [] }, recentFailures: [], selfVersion: null }
    : pathname.endsWith('/sources')
      ? { sources: { registries: [], searchSources: [], gitee: { clientConfigured: false, hasToken: false } } }
      : pathname.endsWith('/market-index')
        ? { items: [], skills: [] }
        : pathname.endsWith('/framework-upgrade-status')
          ? { status: 'idle' }
          : {}
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})

try {
  await page.goto(`http://127.0.0.1:${address.port}`)
  const trigger = page.getByRole('button', { name: '软件源' })
  await trigger.waitFor()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '软件源' })
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭')

  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '关闭')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭')
  await page.screenshot({ path: '/tmp/plugin-console-modal-focus-390.png', fullPage: true })

  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '软件源')
  assert.deepEqual(problems, [])
  console.log('plugin-console-modal-browser: dialog naming, focus trap, Escape close, and focus return verified')
} finally {
  await page.close()
  await browser.close()
  await vite.close()
}
