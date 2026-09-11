import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'
import { assertAccessibleSurface } from './assert-accessible-surface.mjs'
import { assertTextContrast } from './assert-text-contrast.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const theme = process.env.DSH_VISUAL_THEME || 'custom'
assert(['custom', 'official-light', 'official-dark'].includes(theme))
const evidenceRoot = process.env.DSH_VISUAL_EVIDENCE_ROOT || `/tmp/plugin-console-management-${theme}`
await mkdir(evidenceRoot, { recursive: true })
const css = theme === 'custom' ? '' : await readFile(resolve(here,
  '../../../deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css'), 'utf8')
const vite = await createServer({
  root: resolve(here, 'plugin-console-harness'),
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'plugin-console-management',
    transformIndexHtml(html) {
      return {
        html: html.replace('<body>', theme === 'official-dark' ? '<body data-ds-dark-theme>' : '<body>'),
        tags: css ? [{ tag: 'style', children: css, injectTo: 'head' }] : [],
      }
    },
    configureServer(server) {
      server.middlewares.use('/__plugin_console_source__', async (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(await readFile(resolve(here, '../../../.ci/dsh-plugin-console/lib/client.js'), 'utf8'))
      })
    },
  }],
})
await vite.listen()
const address = vite.httpServer.address()
assert(address && typeof address === 'object')
const url = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const problems = []
let screenshots = 0
const pending = []
const entries = ['plugin-a', 'plugin-b'].map(entryId => ({
  entryId, rowId: entryId, moduleName: `@example/${entryId}`, enabled: true, toggleable: true, extra: true, fiberPhase: 'active',
}))
const skills = [
  { name: 'alpha-skill', disabled: false }, { name: 'beta-skill', disabled: true }, { name: '.system', system: true },
]
const finish = async (request, body) => {
  request.resolve(body)
  await request.done
}
async function openPage(mode, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  page.setDefaultTimeout(10_000)
  const state = { entries: [...entries], skills: skills.map(skill => ({ ...skill })), requests: [], refreshGate: null, refreshError: false }
  page.on('pageerror', error => problems.push(error.message))
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) problems.push(message.text())
  })
  await page.addInitScript(({ mode }) => {
    localStorage.setItem('pc-market-mode', mode)
    const originalFetch = window.fetch.bind(window)
    window.managementWrites = {}
    window.fetch = (input, init = {}) => {
      const pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
      if (init.method === 'POST' && /\/(uninstall|toggle|skill-toggle|skill-remove)$/.test(pathname)) {
        window.managementWrites[pathname] = (window.managementWrites[pathname] || 0) + 1
      }
      return originalFetch(input, init)
    }
  }, { mode })
  await page.route('**/plugin-console/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1)
    if (['uninstall', 'toggle', 'skill-toggle', 'skill-remove'].includes(endpoint)) {
      let resolveResponse
      let markDone
      const response = new Promise(resolve => { resolveResponse = resolve })
      const request = {
        endpoint, body: route.request().postDataJSON(), resolve: resolveResponse,
        done: new Promise(resolve => { markDone = resolve }),
      }
      state.requests.push(request)
      pending.push(request)
      try {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(await response) })
      } finally { markDone() }
      return
    }
    if (endpoint === 'state' && state.refreshGate) await state.refreshGate
    if (endpoint === 'state' && state.refreshError) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: '刷新失败' }) })
    }
    const body = endpoint === 'state'
      ? { entries: state.entries, installJobs: [], compat: { supported: true }, framework: null,
        github: { loggedIn: false }, patch: { inserts: [] }, recentFailures: [], selfVersion: null }
      : endpoint === 'skills-installed' ? { skills: state.skills }
      : endpoint === 'sources' ? { sources: { registries: [], searchSources: [], gitee: {} } }
      : endpoint === 'market-index' ? { items: [], skills: [] }
      : endpoint === 'framework-upgrade-status' ? { status: 'idle' } : {}
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(url)
  assert.equal(page.url(), url)
  assert.equal(await page.title(), 'Plugin Console modal contract')
  await page.locator('.pc_row').nth(1).waitFor()
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  return { page, state }
}
async function waitRequests(state, count) {
  await assert.doesNotReject(async () => {
    const deadline = Date.now() + 5000
    while (state.requests.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(state.requests.length, count)
  })
}
async function shot(page, name) {
  await assertAccessibleSurface(page, { requireModal: false })
  await assertTextContrast(page, '.pc_message,.pc_tag,.pc_row .pc_name')
  await page.screenshot({ path: resolve(evidenceRoot, name + '.png'), fullPage: true })
  screenshots += 1
}
const row = (page, name) => page.locator('.pc_row').filter({ has: page.locator('.pc_name', { hasText: name }) })
const removePlugin = (page, name) => row(page, name).getByRole('button', { name: '删除插件（移除配置并卸载包）', exact: true })
const removeSkill = (page, name) => row(page, name).getByRole('button', { name: '删除技能', exact: true })

try {
  // The flow under test is: installed plugin -> confirm removal -> one pending write,
  // failure keeps the row retryable, success holds edits until fresh state or restart.
  {
    const { page, state } = await openPage('plugins')
    await removePlugin(page, 'plugin-a').click()
    assert.equal(state.requests.length, 0, 'first click must only ask for confirmation')
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.pc_row')]
      const remove = rows[0].querySelector('button[aria-label^="删除插件"]')
      remove.click(); remove.click()
      rows[1].querySelector('button').click()
    })
    await waitRequests(state, 1)
    assert.deepEqual(await page.evaluate(() => window.managementWrites), { '/plugin-console/uninstall': 1 })
    assert.deepEqual(state.requests[0].body, { entryId: 'plugin-a' })
    assert.equal(await removePlugin(page, 'plugin-a').getAttribute('aria-busy'), 'true')
    assert.equal(await removePlugin(page, 'plugin-b').isDisabled(), true)
    assert.equal(await row(page, 'plugin-b').getByRole('button', { name: '停用', exact: true }).isDisabled(), true)
    await shot(page, '390-plugin-removing')
    await finish(state.requests[0], { ok: false, error: '卸载失败，请重试' })
    await page.getByText('操作失败：卸载失败，请重试', { exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('button[aria-label^="删除插件"]').disabled)
    await shot(page, '390-plugin-remove-error')
    await removePlugin(page, 'plugin-a').click()
    // Confirmation can expire while a request is in flight; re-confirm if needed.
    if (state.requests.length === 1) await removePlugin(page, 'plugin-a').click()
    await waitRequests(state, 2)
    let releaseRefresh
    state.refreshGate = new Promise(resolve => { releaseRefresh = resolve })
    await finish(state.requests[1], { ok: true, packageName: '@example/plugin-a', restart: false })
    await page.getByText(/已删除插件并卸载包/).waitFor()
    assert.equal(await removePlugin(page, 'plugin-b').isDisabled(), true, 'accepted removal waits for fresh state')
    state.entries = entries.filter(entry => entry.entryId !== 'plugin-a')
    releaseRefresh()
    await row(page, 'plugin-a').waitFor({ state: 'detached' })
    await page.waitForFunction(() => !document.querySelector('button[aria-label^="删除插件"]').disabled)
    await page.setViewportSize({ width: 1280, height: 900 })
    await shot(page, '1280-plugin-removed')
    await row(page, 'plugin-b').evaluate(element => {
      element.querySelector('button').click()
      const remove = element.querySelector('button[aria-label^="删除插件"]')
      remove.click(); remove.click()
    })
    await waitRequests(state, 3)
    assert.equal(state.requests[2].endpoint, 'toggle')
    assert.deepEqual(await page.evaluate(() => window.managementWrites), {
      '/plugin-console/uninstall': 2, '/plugin-console/toggle': 1,
    }, 'an in-flight toggle must also prevent removal')
    await finish(state.requests[2], { ok: false, error: '切换失败，请重试' })
    await page.getByText('操作失败：切换失败，请重试', { exact: true }).waitFor()
    await removePlugin(page, 'plugin-b').click()
    await removePlugin(page, 'plugin-b').click()
    await waitRequests(state, 4)
    await finish(state.requests[3], { ok: true, packageName: '@example/bundle', restart: true })
    await page.getByText(/已移除插件所属 bundle/).waitFor()
    assert.equal(await removePlugin(page, 'plugin-b').isDisabled(), true)
    assert.equal(await removePlugin(page, 'plugin-b').getAttribute('aria-busy'), 'false')
    assert.equal(await removePlugin(page, 'plugin-b').innerText(), '等待重启')
    await shot(page, '1280-bundle-awaiting-restart')
    await page.close()
  }
  {
    const { page, state } = await openPage('plugins')
    await removePlugin(page, 'plugin-a').click()
    await removePlugin(page, 'plugin-a').click()
    await waitRequests(state, 1)
    state.refreshError = true
    await finish(state.requests[0], { ok: true, packageName: '@example/plugin-a', restart: false })
    await page.getByText('暂时无法读取插件。', { exact: true }).waitFor()
    assert.equal(await removePlugin(page, 'plugin-a').count(), 0, 'failed refresh must not expose stale destructive actions')
    await shot(page, '390-plugin-refresh-error')
    state.entries = entries.filter(entry => entry.entryId !== 'plugin-a')
    state.refreshError = false
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await row(page, 'plugin-b').waitFor()
    assert.equal(await removePlugin(page, 'plugin-b').isEnabled(), true)
    assert.equal(state.requests.length, 1, 'retrying the read must not repeat the accepted removal')
    await page.close()
  }
  // The flow under test is: installed skill -> delete or toggle -> one write across
  // both actions and all rows, explicit busy state, then retry or updated contents.
  {
    const { page, state } = await openPage('skills')
    assert.equal(await row(page, '.system').getByRole('button', { name: '删除技能' }).count(), 0)
    await removeSkill(page, 'alpha-skill').click()
    assert.equal(state.requests.length, 0)
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.pc_row')]
      const confirm = [...rows[0].querySelectorAll('button')].find(button => button.textContent.includes('确认删除技能'))
      confirm.click(); confirm.click()
      rows[0].querySelector('button').click()
      rows[1].querySelector('button').click()
    })
    await waitRequests(state, 1)
    assert.deepEqual(await page.evaluate(() => window.managementWrites), { '/plugin-console/skill-remove': 1 })
    assert.deepEqual(state.requests[0].body, { name: 'alpha-skill' })
    assert.equal(await row(page, 'alpha-skill').getAttribute('aria-busy'), 'true')
    assert.equal(await row(page, 'alpha-skill').getByRole('button', { name: '删除中…', exact: true }).isDisabled(), true)
    assert.equal(await row(page, 'beta-skill').getByRole('button', { name: '启用', exact: true }).isDisabled(), true)
    await shot(page, '390-skill-removing')
    await finish(state.requests[0], { ok: false, error: '删除失败，请重试' })
    await page.getByText('操作失败：删除失败，请重试', { exact: true }).waitFor()
    await shot(page, '390-skill-remove-error')
    await row(page, 'alpha-skill').getByRole('button', { name: /确认删除技能/ }).click()
    await waitRequests(state, 2)
    await finish(state.requests[1], { ok: true, name: 'alpha-skill' })
    await row(page, 'alpha-skill').waitFor({ state: 'detached' })
    await row(page, 'beta-skill').getByRole('button', { name: '启用', exact: true }).evaluate(button => { button.click(); button.click() })
    await waitRequests(state, 3)
    assert.deepEqual(state.requests[2].body, { name: 'beta-skill', enabled: true })
    assert.deepEqual(await page.evaluate(() => window.managementWrites), {
      '/plugin-console/skill-remove': 2, '/plugin-console/skill-toggle': 1,
    })
    assert.equal(await removeSkill(page, 'beta-skill').isDisabled(), true)
    await finish(state.requests[2], { ok: false, error: '保存失败，请重试' })
    await page.getByText('操作失败：保存失败，请重试', { exact: true }).waitFor()
    assert.equal(await row(page, 'beta-skill').getByText('已停用', { exact: true }).count(), 1)
    await row(page, 'beta-skill').getByRole('button', { name: '启用', exact: true }).click()
    await waitRequests(state, 4)
    await finish(state.requests[3], { ok: true, name: 'beta-skill', enabled: true })
    await row(page, 'beta-skill').getByRole('button', { name: '停用', exact: true }).waitFor()
    assert.equal(await row(page, 'beta-skill').getByText('已停用', { exact: true }).count(), 0)
    await page.setViewportSize({ width: 1280, height: 900 })
    await shot(page, '1280-skill-enabled')
    await row(page, 'beta-skill').getByRole('button', { name: '停用', exact: true }).click()
    await waitRequests(state, 5)
    assert.deepEqual(state.requests[4].body, { name: 'beta-skill', enabled: false })
    assert.equal(await row(page, 'beta-skill').getByRole('button', { name: '保存中…', exact: true }).getAttribute('aria-busy'), 'true')
    await page.setViewportSize({ width: 390, height: 900 })
    await shot(page, '390-skill-saving')
    await finish(state.requests[4], { ok: true, name: 'beta-skill', enabled: false })
    await row(page, 'beta-skill').getByRole('button', { name: '启用', exact: true }).waitFor()
    assert.equal(await row(page, 'beta-skill').getByText('已停用', { exact: true }).count(), 1)
    await page.close()
  }
  assert.deepEqual(problems, [])
  console.log(`plugin-console-management: ${theme}; ${screenshots} screenshots; plugin and skill mutation locks, retries, refresh and restart states verified`)
} finally {
  for (const request of pending) request.resolve({ ok: false, error: 'Test cleanup' })
  await browser.close()
  await vite.close()
}
