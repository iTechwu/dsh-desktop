import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'
import { assertAccessibleSurface } from './assert-accessible-surface.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const workspaceRoot = resolve(here, '../../..')
const harnessRoot = resolve(here, 'yootun-access-harness')
const sourcePath = resolve(workspaceRoot, '.ci/dsh-yootun-ui/src/client.js')
const evidenceRoot = resolve(process.env.DSH_VISUAL_EVIDENCE_ROOT || '/tmp/dsh-yootun-accessibility/access')
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
assert(existsSync(browserExecutable), `Chrome executable not found: ${browserExecutable}`)
await mkdir(evidenceRoot, { recursive: true })

const vite = await createServer({
  root: harnessRoot,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'yootun-access-source',
    configureServer(server) {
      server.middlewares.use('/__yootun_access_source__', async (_request, response) => {
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

let releaseModels
let releaseValidation
const modelsGate = new Promise(resolveGate => { releaseModels = resolveGate })
const validationGate = new Promise(resolveGate => { releaseValidation = resolveGate })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
await page.route('**/api/desktop/dofe/models', async route => {
  await modelsGate
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }) })
})
await page.route('**/api/desktop/dofe/validate', async route => {
  await validationGate
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true }) })
})

try {
  await page.goto(`http://127.0.0.1:${address.port}`)
  let dialog = page.getByRole('dialog', { name: '激活 Yootun-Agent' })
  await dialog.waitFor()
  await assertAccessibleSurface(page)
  const desktopCard = await dialog.boundingBox()
  assert(desktopCard && desktopCard.width <= 680, 'desktop access gate must retain its readable max width')
  await page.screenshot({ path: resolve(evidenceRoot, '1440-access-gate.png'), fullPage: true })

  await page.setViewportSize({ width: 320, height: 720 })
  await page.reload()
  dialog = page.getByRole('dialog', { name: '激活 Yootun-Agent' })
  await dialog.waitFor()
  await page.waitForFunction(() => document.activeElement?.id === 'yu-model-key')
  await assertAccessibleSurface(page)
  await page.evaluate(() => {
    const card = document.querySelector('[role="dialog"]')
    const items = [...card.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')]
    items.at(-1).focus()
  })
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement)), true)
  assert.equal(await page.evaluate(() => document.activeElement?.id === 'background-action'), false)

  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window)
    window.__accessWrites = { models: 0, validation: 0 }
    window.fetch = (input, init = {}) => {
      const pathname = new URL(typeof input === 'string' ? input : input.url, window.location.href).pathname
      if (pathname.endsWith('/models')) window.__accessWrites.models += 1
      if (pathname.endsWith('/validate')) window.__accessWrites.validation += 1
      return originalFetch(input, init)
    }
  })
  const key = page.getByLabel('Model API Key')
  await key.fill('test-model-key')
  const modelWrites = await key.evaluate(input => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return window.__accessWrites.models
  })
  assert.equal(modelWrites, 1)
  await page.locator('.yu-form[aria-busy="true"]').waitFor()
  assert.equal(await key.isDisabled(), true)
  releaseModels()
  await page.getByText('已获取 1 个可用模型').waitFor()

  const submit = page.getByRole('button', { name: '验证并进入' })
  const validationWrites = await submit.evaluate(button => {
    button.click()
    button.click()
    return window.__accessWrites.validation
  })
  assert.equal(validationWrites, 1)
  await page.locator('.yu-form[aria-busy="true"]').waitFor()
  assert.equal(await dialog.locator('button[data-primary="true"]').isDisabled(), true)
  await page.screenshot({ path: resolve(evidenceRoot, '320-access-validating.png'), fullPage: true })
  releaseValidation()
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(problems, [])
  console.log('yootun-access-browser: responsive gate, accessible controls, focus trap, and request locks verified')
} finally {
  releaseModels?.()
  releaseValidation?.()
  await page.close()
  await browser.close()
  await vite.close()
}
