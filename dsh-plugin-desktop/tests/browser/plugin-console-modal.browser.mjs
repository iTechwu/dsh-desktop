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
let consentMode = false
let releaseSourceWrite
let releaseConsentWrite
const sourceWriteGate = new Promise(resolveGate => { releaseSourceWrite = resolveGate })
const consentWriteGate = new Promise(resolveGate => { releaseConsentWrite = resolveGate })
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
await page.route('**/plugin-console/**', async route => {
  const pathname = new URL(route.request().url()).pathname
  if (route.request().method() === 'POST' && pathname.endsWith('/sources')) await sourceWriteGate
  if (route.request().method() === 'POST' && pathname.endsWith('/ai-consent')) await consentWriteGate
  const body = pathname.endsWith('/install-status') && consentMode
    ? { jobId: 'consent-job', status: 'installing', stage: 'ai-consent', packageName: '@example/plugin' }
    : pathname.endsWith('/state')
    ? { entries: [], installJobs: consentMode ? [{ jobId: 'consent-job', status: 'installing', stage: 'ai-consent', packageName: '@example/plugin' }] : [], compat: { supported: true }, framework: null, github: { loggedIn: false }, patch: { inserts: [] }, recentFailures: [], selfVersion: null }
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
  const installWriteCounter = () => page.evaluate(() => {
    const originalFetch = window.fetch.bind(window)
    window.__pluginWriteCounts = { sources: 0, consent: 0 }
    window.fetch = (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
      if (init.method === 'POST' && url.pathname.endsWith('/sources')) window.__pluginWriteCounts.sources += 1
      if (init.method === 'POST' && url.pathname.endsWith('/ai-consent')) window.__pluginWriteCounts.consent += 1
      return originalFetch(input, init)
    }
  })
  await installWriteCounter()
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

  await dialog.getByRole('textbox', { name: '名称', exact: true }).first().fill('内部源')
  await dialog.getByRole('textbox', { name: '地址（https://…）', exact: true }).fill('https://registry.example.com')
  const sourceWrites = await page.evaluate(() => {
    const add = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === '添加')
    add.click()
    add.click()
    return window.__pluginWriteCounts.sources
  })
  assert.equal(sourceWrites, 1)
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') === 'true')
  assert.equal(await dialog.getByRole('button', { name: '添加', exact: true }).isDisabled(), true)
  releaseSourceWrite()
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') === 'false')

  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '软件源')

  consentMode = true
  await page.reload()
  await installWriteCounter()
  const consentDialog = page.getByRole('dialog', { name: /安装中/ })
  await consentDialog.waitFor()
  const consentWrites = await page.evaluate(() => {
    const approve = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent?.startsWith('同意，继续'))
    approve.click()
    approve.click()
    return window.__pluginWriteCounts.consent
  })
  assert.equal(consentWrites, 1)
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') === 'true')
  assert.equal(await consentDialog.getByRole('button', { name: /同意，继续/ }).isDisabled(), true)
  assert.equal(await consentDialog.getByRole('button', { name: '取消' }).isDisabled(), true)
  releaseConsentWrite()
  await consentDialog.waitFor({ state: 'detached' })
  assert.deepEqual(problems, [])
  console.log('plugin-console-modal-browser: dialog focus and synchronous mutation locks verified')
} finally {
  releaseSourceWrite?.()
  releaseConsentWrite?.()
  await page.close()
  await browser.close()
  await vite.close()
}
