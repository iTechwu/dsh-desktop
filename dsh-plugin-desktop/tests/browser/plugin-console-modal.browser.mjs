import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'
import { assertAccessibleSurface } from './assert-accessible-surface.mjs'
import { assertTextContrast } from './assert-text-contrast.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const harnessRoot = resolve(here, 'plugin-console-harness')
const clientPath = resolve(here, '../../../.ci/dsh-plugin-console/lib/client.js')
const visualTheme = process.env.DSH_VISUAL_THEME || 'custom'
assert(['custom', 'official-light', 'official-dark'].includes(visualTheme), `Unknown visual theme: ${visualTheme}`)
const officialThemeCss = visualTheme === 'custom' ? null : await readFile(
  resolve(here, '../../../deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css'), 'utf8',
)
const evidenceRoot = process.env.DSH_VISUAL_EVIDENCE_ROOT || `/tmp/plugin-console-modal-${visualTheme}`
await mkdir(evidenceRoot, { recursive: true })
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const cacheDir = await mkdtemp(resolve(tmpdir(), 'plugin-console-modal-vite-'))
const vite = await createServer({
  root: harnessRoot,
  cacheDir,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'plugin-console-source',
    transformIndexHtml(html) {
      if (!officialThemeCss) return html
      const dark = visualTheme === 'official-dark'
      return {
        html: html.replace('<body>', dark ? '<body data-ds-dark-theme>' : '<body>'),
        tags: [{ tag: 'style', children: `${officialThemeCss}\n:root { color-scheme: ${dark ? 'dark' : 'light'}; }`, injectTo: 'head' }],
      }
    },
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
const entries = [
  { entryId: 'example/active', rowId: 'active', moduleName: '@example/active-plugin', enabled: true, toggleable: true, extra: true, fiberPhase: 'active' },
  { entryId: 'example/failed', rowId: 'failed', moduleName: '@example/failed-plugin', enabled: false, toggleable: true, extra: true, fiberPhase: 'failed' },
]
let consentMode = false
let releaseSourceWrite
let releaseConsentWrite
let releaseToggleFailure
let releaseToggleSuccess
let toggleRequests = 0
const sourceWriteGate = new Promise(resolveGate => { releaseSourceWrite = resolveGate })
const consentWriteGate = new Promise(resolveGate => { releaseConsentWrite = resolveGate })
const toggleFailureGate = new Promise(resolveGate => { releaseToggleFailure = resolveGate })
const toggleSuccessGate = new Promise(resolveGate => { releaseToggleSuccess = resolveGate })
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
await page.route('**/plugin-console/**', async route => {
  const pathname = new URL(route.request().url()).pathname
  if (route.request().method() === 'POST' && pathname.endsWith('/toggle')) {
    assert.deepEqual(route.request().postDataJSON(), { entryId: 'example/active', enabled: false })
    const attempt = ++toggleRequests
    await (attempt === 1 ? toggleFailureGate : toggleSuccessGate)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      attempt === 1 ? { ok: false, error: '切换未完成，请重试' } : { ok: true },
    ) })
  }
  if (route.request().method() === 'POST' && pathname.endsWith('/sources')) await sourceWriteGate
  if (route.request().method() === 'POST' && pathname.endsWith('/ai-consent')) await consentWriteGate
  const body = pathname.endsWith('/install-status') && consentMode
    ? { jobId: 'consent-job', status: 'installing', stage: 'ai-consent', packageName: '@example/plugin' }
    : pathname.endsWith('/state')
    ? { entries, installJobs: consentMode ? [{ jobId: 'consent-job', status: 'installing', stage: 'ai-consent', packageName: '@example/plugin' }] : [], compat: { supported: true }, framework: null, github: { loggedIn: false }, patch: { inserts: [] }, recentFailures: [], selfVersion: null }
    : pathname.endsWith('/sources')
      ? { sources: { registries: [{ id: 'npm', name: '默认源', url: 'https://registry.example.com/organization/desktop/plugin-packages/', primary: true }], searchSources: [], gitee: { clientConfigured: false, hasToken: false } } }
      : pathname.endsWith('/market-index')
        ? { items: [], skills: [] }
        : pathname.endsWith('/framework-upgrade-status')
          ? { status: 'idle' }
          : {}
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})

try {
  await page.goto(`http://127.0.0.1:${address.port}`)
  if (officialThemeCss) {
    const brand = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim())
    assert.equal(brand, visualTheme === 'official-dark' ? 'rgb(249, 250, 251)' : 'rgb(15, 17, 21)')
  }
  await page.locator('.pc_row').nth(1).waitFor()
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await assertAccessibleSurface(page, { requireModal: false })
    await assertTextContrast(page, '.pc_tag,.pc_phase,.pc_meta,.pc_note,.pc_status,.pc_ghpill,.pc_aiToggle')
    // Restart becomes available after the state read; let its opacity transition settle.
    await page.waitForFunction(() => [...document.querySelectorAll('.pc_section button:not(:disabled)')]
      .every(button => !button.getClientRects().length || Number(getComputedStyle(button).opacity) === 1))
    const fadedButtons = await page.locator('.pc_section button:not(:disabled)').evaluateAll(buttons => buttons
      .filter(button => button.getClientRects().length && Number(getComputedStyle(button).opacity) < 1)
      .map(button => button.textContent))
    assert.deepEqual(fadedButtons, [], 'available controls must not look disabled')
    const coveredContent = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.pc_section button')]
        .filter(button => button.getClientRects().length)
        .map(button => ({ label: button.textContent, rect: button.getBoundingClientRect() }))
      return [...document.querySelectorAll('.pc_section h3,.pc_section p,.pc_row .pc_name,.pc_row .pc_meta')]
        .flatMap(element => {
          const rect = element.getBoundingClientRect()
          return buttons.filter(button => Math.min(rect.right, button.rect.right) - Math.max(rect.left, button.rect.left) > 1
            && Math.min(rect.bottom, button.rect.bottom) - Math.max(rect.top, button.rect.top) > 1)
            .map(button => ({ text: element.textContent, button: button.label }))
        })
    })
    assert.deepEqual(coveredContent, [], `plugin controls must not obscure content at ${width}px`)
    await page.screenshot({ path: resolve(evidenceRoot, `${width}-plugin-states.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
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
  await trigger.focus()
  await page.keyboard.press('Tab')
  const aiToggle = page.getByRole('button', { name: 'AI 兜底', exact: true })
  assert.equal(await aiToggle.evaluate(button => button === document.activeElement), true)
  assert.equal(await aiToggle.getAttribute('aria-pressed'), 'true')
  await page.keyboard.press('Space')
  assert.equal(await aiToggle.getAttribute('aria-pressed'), 'false')
  await page.keyboard.press('Space')
  assert.equal(await aiToggle.getAttribute('aria-pressed'), 'true')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('pc_modeFloat')), true)
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '重启服务')
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '软件源' })
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  // Source rows arrive asynchronously; start navigation only after the first row is ready.
  await dialog.getByRole('button', { name: '编辑', exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭')

  await page.keyboard.press('Shift+Tab')
  assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).last()
    .evaluate(button => button === document.activeElement), true, 'Shift+Tab from the first control must reach the footer close button')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭')
  await page.keyboard.press('Tab')
  assert.equal(await dialog.getByRole('button', { name: '编辑', exact: true })
    .evaluate(button => button === document.activeElement), true, 'Tab must move into the dialog contents')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭')
  const focus = await page.evaluate(() => ({
    width: getComputedStyle(document.activeElement).outlineWidth,
    style: getComputedStyle(document.activeElement).outlineStyle,
  }))
  assert.deepEqual(focus, { width: '2px', style: 'solid' }, 'keyboard focus must use the shared visible outline')
  await assertAccessibleSurface(page)
  await assertTextContrast(page, '.pc_modalCard .pc_message,.pc_modalCard .pc_tag,.pc_modalCard .pc_trashBtn')
  assert.deepEqual(await dialog.locator('.pc_name').evaluateAll(names => names
    .filter(name => name.scrollWidth > name.clientWidth + 1).map(name => name.textContent)), [], 'source names and primary state must remain readable')
  await page.screenshot({ path: resolve(evidenceRoot, '390-source-dialog-focus.png'), fullPage: true })

  await dialog.getByRole('button', { name: '编辑', exact: true }).click()
  await assertAccessibleSurface(page)
  await dialog.getByRole('textbox', { name: '名称', exact: true }).first().focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '地址（https://…）')
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth), '2px')
  const clippedHints = await dialog.locator('.pc_tag').evaluateAll(tags => tags
    .filter(tag => tag.scrollWidth > tag.clientWidth + 1).map(tag => tag.textContent))
  assert.deepEqual(clippedHints, [], 'software source hints must wrap inside the dialog')
  await page.screenshot({ path: resolve(evidenceRoot, '390-source-edit-focus.png'), fullPage: true })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()

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

  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window)
    window.__toggleWrites = 0
    window.fetch = (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
      if (init.method === 'POST' && url.pathname.endsWith('/toggle')) window.__toggleWrites += 1
      return originalFetch(input, init)
    }
  })
  const doubleToggle = () => page.evaluate(() => {
    const button = [...document.querySelectorAll('.pc_row button')].find(button => button.textContent === '停用')
    if (!button) throw new Error('disable control missing')
    button.click()
    button.click()
    const other = [...document.querySelectorAll('.pc_row button')].find(button => button.textContent === '启用')
    if (!other) throw new Error('enable control missing')
    other.click()
    return window.__toggleWrites
  })
  assert.equal(await doubleToggle(), 1, 'synchronous repeated clicks must send one toggle request')
  await page.waitForFunction(() => {
    const toggles = [...document.querySelectorAll('.pc_row button.pc_toggle[aria-busy]')]
    return toggles.length === 2 && toggles.every(button => button.disabled)
  })
  releaseToggleFailure()
  await page.getByText('操作失败：切换未完成，请重试', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '停用', exact: true }).isEnabled(), true)
  await page.screenshot({ path: resolve(evidenceRoot, '390-toggle-error.png'), fullPage: true })
  assert.equal(await doubleToggle(), 2, 'a failed toggle must allow one retry')
  releaseToggleSuccess()
  await page.getByText('已请求停用：example/active。页面即将自动刷新…', { exact: true }).waitFor()
  assert.equal(await page.locator('.pc_row button[aria-busy]:not(:disabled)').count(), 0, 'successful toggles remain locked until reload')
  await page.waitForEvent('load')
  assert.equal(toggleRequests, 2)

  consentMode = true
  await page.reload()
  await installWriteCounter()
  const consentDialog = page.getByRole('dialog', { name: /安装中/ })
  await consentDialog.waitFor()
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))
  const consentCancel = consentDialog.getByRole('button', { name: '取消', exact: true })
  await consentCancel.focus()
  await page.keyboard.press('Tab')
  assert.equal(await consentDialog.getByRole('checkbox').evaluate(control => control === document.activeElement), true)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await consentCancel.evaluate(control => control === document.activeElement), true)
  assert.equal(await page.locator('.pc_actions').evaluate(actions => actions.closest('[inert]') !== null), true)
  await assertAccessibleSurface(page)
  await assertTextContrast(page, '.pc_modalCard .pc_message,.pc_modalCard .pc_consentRemember')
  await page.screenshot({ path: resolve(evidenceRoot, '390-install-consent.png'), fullPage: true })
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
  await page.waitForFunction(() => document.querySelector('.pc_actions')?.closest('[inert]') === null)
  assert.deepEqual(problems, [])
  console.log(`plugin-console-modal-browser: ${visualTheme}, 9 screenshots, unobscured plugin states, source editing, dialog focus, and source/consent/toggle mutation locks verified`)
} finally {
  releaseSourceWrite?.()
  releaseConsentWrite?.()
  releaseToggleFailure?.()
  releaseToggleSuccess?.()
  await page.close()
  await browser.close()
  await vite.close()
  await rm(cacheDir, { recursive: true, force: true })
}
