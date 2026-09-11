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
const theme = process.env.DSH_VISUAL_THEME || 'custom'
assert(['custom', 'official-light', 'official-dark'].includes(theme))
const evidenceRoot = process.env.DSH_VISUAL_EVIDENCE_ROOT || `/tmp/plugin-console-management-${theme}`
await mkdir(evidenceRoot, { recursive: true })
const css = theme === 'custom' ? '' : await readFile(resolve(here,
  '../../../deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css'), 'utf8')
const cacheDir = await mkdtemp(resolve(tmpdir(), 'plugin-console-management-vite-'))
const vite = await createServer({
  root: resolve(here, 'plugin-console-harness'),
  cacheDir,
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
async function openPage(mode, width = 390, framework = false, upgradeStatus = 'idle', nativeRestartConfirmation = false, installation = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.clock.install()
  page.setDefaultTimeout(10_000)
  const state = { entries: [...entries], skills: skills.map(skill => ({ ...skill })), requests: [], refreshGate: null, refreshError: false,
    upgradeStatus, statusReads: 0, frameworkChecks: 0, installJobs: {}, installReads: [], installStatusGate: null }
  if (installation === 'restored') state.installJobs = {
    'restored-a': { jobId: 'restored-a', repo: 'example/old-plugin', status: 'installing', stage: 'preparing' },
    'restored-b': { jobId: 'restored-b', repo: 'example/old-skill', status: 'installing', stage: 'preparing' },
  }
  if (framework && nativeRestartConfirmation) state.entries.push({
    entryId: 'framework-core', rowId: 'framework-core', moduleName: '@deepseek-ai/dsh-client-ui',
    enabled: true, toggleable: false, extra: false, fiberPhase: 'active',
  })
  page.on('pageerror', error => problems.push(error.message))
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) problems.push(message.text())
  })
  await page.addInitScript(({ mode }) => {
    localStorage.setItem('pc-market-mode', mode)
    const originalFetch = window.fetch.bind(window)
    window.managementWrites = {}
    window.managementSignals = {}
    window.fetch = (input, init = {}) => {
      const pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
      if (init.method === 'POST' && /\/(install|uninstall|toggle|skill-toggle|skill-remove|restart|framework-relaunch|framework-upgrade|updates\/check)$/.test(pathname)) {
        window.managementWrites[pathname] = (window.managementWrites[pathname] || 0) + 1
        window.managementSignals[pathname] = init.signal instanceof AbortSignal
      }
      return originalFetch(input, init)
    }
  }, { mode })
  const handleRoute = async route => {
    const pathname = new URL(route.request().url()).pathname
    const endpoint = pathname === '/api/desktop/updates/check' ? 'desktop-update-check' : pathname.split('/').at(-1)
    if (['install', 'uninstall', 'toggle', 'skill-toggle', 'skill-remove', 'restart', 'framework-relaunch', 'framework-upgrade', 'desktop-update-check'].includes(endpoint)) {
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
    if (endpoint === 'framework-upgrade-status') state.statusReads += 1
    if (endpoint === 'install-status') {
      state.installReads.push(route.request().postDataJSON().jobId)
      if (state.installStatusGate) await state.installStatusGate
    }
    if (endpoint === 'check-update' && route.request().postDataJSON()?.packageName === '@deepseek-ai/dsh') state.frameworkChecks += 1
    const frameworkItems = framework ? [{ fullName: 'deepseek-ai/deepseek-harness', description: 'DSH framework', stars: 1 }] : []
    const installItems = installation ? [
      { fullName: 'example/new-plugin', description: 'A plugin to install', stars: 1 },
      { fullName: 'example/new-skill', description: 'A skill to install', stars: 1, hasSkill: true },
    ] : []
    const body = endpoint === 'state'
      ? { entries: state.entries, installJobs: Object.values(state.installJobs).filter(job => job.status === 'installing'), compat: { supported: true, dshVersion: '0.1.5-rc.2' }, framework: null, nativeRestartConfirmation,
        frameworkUpgradeOwner: nativeRestartConfirmation ? 'desktop' : 'standalone',
        github: { loggedIn: false }, patch: { inserts: [] }, recentFailures: [], selfVersion: null }
      : endpoint === 'skills-installed' ? { skills: state.skills }
      : endpoint === 'sources' ? { sources: { registries: [], searchSources: [], gitee: {} } }
      : endpoint === 'market-index' || endpoint === 'search' ? { items: [...frameworkItems, ...installItems], skills: installItems }
      : endpoint === 'install-status' ? state.installJobs[route.request().postDataJSON().jobId] ?? { status: 'installing', stage: 'preparing' }
      : endpoint === 'check-update' ? { latest: '0.1.6', error: null }
      : endpoint === 'details' ? { meta: { description: 'Desktop framework component', version: '0.1.5-rc.2' }, readme: null }
      : endpoint === 'framework-upgrade-status' ? { status: state.upgradeStatus, message: state.upgradeStatus === 'failed' ? '升级失败，请重试' : null } : {}
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  }
  await page.route('**/plugin-console/**', handleRoute)
  await page.route('**/api/desktop/updates/check', handleRoute)
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
  await page.waitForFunction(() => [...document.querySelectorAll('.pc_section button:not(:disabled)')]
    .every(button => !button.getClientRects().length || Number(getComputedStyle(button).opacity) === 1))
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
    // Both restart entry points are clicked in the same JavaScript turn.
    await page.getByRole('button', { name: '重启服务', exact: true }).evaluateAll(buttons => {
      if (buttons.length !== 2) throw new Error('Expected two restart entry points')
      buttons[0].click(); buttons[0].click(); buttons[1].click()
    })
    await waitRequests(state, 5)
    assert.equal(state.requests[4].endpoint, 'restart')
    assert.equal(await page.evaluate(() => window.managementSignals['/plugin-console/restart']), true, 'ordinary restart requests keep a timeout signal')
    assert.equal(await page.locator('.pc_restartBtn').getAttribute('aria-busy'), 'true')
    await page.setViewportSize({ width: 390, height: 900 })
    await shot(page, '390-restart-pending')
    await finish(state.requests[4], { ok: false, error: '重启请求被拒绝' })
    await page.getByText('操作失败：重启请求被拒绝', { exact: true }).waitFor()
    assert.equal(await page.locator('.pc_restartBtn').isEnabled(), true)
    await shot(page, '390-restart-error')
    await page.locator('.pc_restartBtn').click()
    await waitRequests(state, 6)
    await finish(state.requests[5], { ok: true })
    await page.getByText('重启请求已接受。服务恢复后请刷新页面。', { exact: true }).waitFor()
    assert.equal(await page.locator('.pc_restartBtn').isDisabled(), true)
    assert.equal(await page.locator('.pc_restartBtn').getAttribute('aria-busy'), 'false')
    await page.getByRole('button', { name: '刷新页面', exact: true }).waitFor()
    await page.setViewportSize({ width: 1280, height: 900 })
    await shot(page, '1280-restart-accepted')
    // Acceptance must not schedule an unconditional reload or a second restart.
    await page.clock.fastForward(13_000)
    assert.equal(state.requests.length, 6)
    await page.getByText('重启请求已接受。服务恢复后请刷新页面。', { exact: true }).waitFor()
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
  // Upgrade confirmation -> one write -> no-op/error stays retryable; only an
  // accepted upgrade restores progress and blocks conflicting restart requests.
  {
    const { page, state } = await openPage('plugins', 390, true)
    await page.locator('#pc-market-search').getByRole('button', { name: '搜索', exact: true }).click()
    const upgrade = page.getByRole('button', { name: '框架升级 → v0.1.6', exact: true })
    const confirm = page.getByRole('button', { name: '确认升级？（服务将自动重启）', exact: true })
    await upgrade.click()
    assert.equal(state.requests.length, 0)
    await confirm.evaluate(button => {
      button.click(); button.click()
      document.querySelector('.pc_restartBtn').click()
    })
    await waitRequests(state, 1)
    assert.equal(state.requests[0].endpoint, 'framework-upgrade')
    assert.equal(await page.locator('.pc_restartBtn').isDisabled(), true)
    await finish(state.requests[0], { ok: true, upgraded: false, hasUpdate: false })
    await page.getByText('框架升级未启动（已是最新版本）', { exact: true }).waitFor()
    assert.equal(await page.getByText('备份现有配置', { exact: true }).count(), 0)
    assert.equal(await page.locator('.pc_restartBtn').isEnabled(), true)
    const readsAfterNoop = state.statusReads
    await page.clock.fastForward(7000)
    assert.equal(state.statusReads, readsAfterNoop, 'a no-op must not start progress polling')
    await shot(page, '390-framework-no-update')
    for (const [body, message] of [
      [{ ok: true, upgraded: false, hasUpdate: false, registryError: 'offline' }, /框架升级未启动（版本检测失败/],
      [{ ok: true, upgraded: false, hasUpdate: true, steps: ['找不到启动入口，已取消升级'] }, '框架升级未启动：找不到启动入口，已取消升级'],
      [{ ok: false, error: '升级请求被拒绝' }, '操作失败：升级请求被拒绝'],
      [{}, '操作失败：服务未确认接受请求，请刷新状态后重试'],
    ]) {
      const expectedRequests = state.requests.length + 1
      await upgrade.click(); await confirm.click()
      await waitRequests(state, expectedRequests)
      const request = state.requests.at(-1)
      await finish(request, body)
      await page.getByText(message, { exact: typeof message === 'string' }).waitFor()
      assert.equal(await upgrade.isEnabled(), true)
      assert.equal(await page.locator('.pc_restartBtn').isEnabled(), true)
    }
    await shot(page, '390-framework-request-error')
    const nextRequestCount = state.requests.length + 1
    await upgrade.click(); await confirm.click()
    await waitRequests(state, nextRequestCount)
    state.upgradeStatus = 'installing'
    await finish(state.requests.at(-1), { ok: true, upgraded: true, current: '0.1.5-rc.2', target: '0.1.6' })
    await page.getByText('框架升级请求已接受：0.1.5-rc.2 → 0.1.6', { exact: true }).waitFor()
    assert.equal(await upgrade.isDisabled(), true)
    assert.equal(await page.locator('.pc_restartBtn').isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '拉起服务', exact: true }).count(), 0)
    await page.setViewportSize({ width: 1280, height: 900 })
    await shot(page, '1280-framework-accepted')
    state.upgradeStatus = 'failed'
    await page.clock.fastForward(3100)
    await page.getByRole('button', { name: '拉起服务', exact: true }).waitFor()
    assert.equal(await upgrade.isEnabled(), true)
    const relaunch = page.getByRole('button', { name: '拉起服务', exact: true })
    const beforeRelaunch = state.requests.length
    await relaunch.evaluate(button => {
      button.click(); button.click()
      document.querySelector('.pc_restartBtn').click()
    })
    await waitRequests(state, beforeRelaunch + 1)
    assert.equal(state.requests.at(-1).endpoint, 'framework-relaunch')
    assert.equal(await relaunch.getAttribute('aria-busy'), 'true')
    await finish(state.requests.at(-1), { ok: false, error: '启动请求被拒绝' })
    await page.getByText('操作失败：启动请求被拒绝', { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 900 })
    await shot(page, '390-relaunch-error')
    await relaunch.click()
    await waitRequests(state, beforeRelaunch + 2)
    await finish(state.requests.at(-1), { ok: true })
    await page.getByText('启动请求已接受。服务恢复后请刷新页面。', { exact: true }).waitFor()
    assert.equal(await relaunch.isDisabled(), true)
    assert.equal(await relaunch.getAttribute('aria-busy'), 'false')
    await shot(page, '390-relaunch-accepted')
    await page.close()
  }
  {
    const { page, state } = await openPage('plugins', 390, true, 'installing')
    await page.getByText(/⟳ 升级框架本体/).waitFor()
    assert.equal(await page.locator('.pc_restartBtn').isDisabled(), true, 'restored active upgrades block restart')
    assert.equal(await page.getByRole('button', { name: '拉起服务', exact: true }).count(), 0)
    assert.equal(state.requests.length, 0)
    await page.close()
  }
  {
    const { page, state } = await openPage('plugins', 390, false, 'idle', true)
    const restart = page.locator('.pc_restartBtn')
    await restart.click()
    await waitRequests(state, 1)
    await page.getByText('请在桌面对话框中确认重启…', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.managementSignals['/plugin-console/restart']), false, 'native confirmation is the explicit interactive exception')
    await page.clock.fastForward(31_000)
    assert.equal(await restart.isDisabled(), true, 'native confirmation must not expire with the ordinary API timeout')
    assert.equal(await page.getByText(/操作失败/).count(), 0)
    await shot(page, '390-native-restart-confirmation')
    await finish(state.requests[0], { ok: true, cancelled: true, owner: 'desktop' })
    await page.getByText('已取消重启。', { exact: true }).waitFor()
    assert.equal(await restart.isEnabled(), true)
    assert.equal(await page.getByRole('button', { name: '刷新页面', exact: true }).count(), 0)
    await shot(page, '390-native-restart-cancelled')
    await restart.click()
    await waitRequests(state, 2)
    await finish(state.requests[1], { ok: true, accepted: true, owner: 'desktop' })
    await page.getByText('重启请求已接受。服务恢复后请刷新页面。', { exact: true }).waitFor()
    assert.equal(await restart.isDisabled(), true)
    await page.close()
  }
  {
    const { page, state } = await openPage('plugins', 390, true, 'idle', true)
    await page.locator('#pc-market-search').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('button', { name: '检查应用更新', exact: true }).waitFor()
    assert.equal(state.frameworkChecks, 0, 'desktop frameworks must not be checked against standalone npm versions')
    assert.equal(await page.getByRole('button', { name: /框架升级|已是最新框架/ }).count(), 0)
    await page.locator('#pc-installed-search-area').getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('button', { name: '切换：已装（后装/第三方插件）/ 全部', exact: true }).click()
    await page.locator('#pc-installed-search-area').getByRole('button', { name: '搜索', exact: true }).click()
    await page.locator('.pc_row').filter({ has: page.locator('.pc_name[title="@deepseek-ai/dsh-client-ui"]') })
      .getByRole('button', { name: '详情', exact: true }).click()
    const updateButtons = page.getByRole('button', { name: '检查应用更新', exact: true })
    await updateButtons.nth(1).waitFor()
    const statusReads = state.statusReads
    await updateButtons.evaluateAll(buttons => {
      buttons[0].click(); buttons[0].click(); buttons[1].click()
      document.querySelector('.pc_restartBtn').click()
    })
    await waitRequests(state, 1)
    assert.equal(state.requests[0].endpoint, 'desktop-update-check')
    assert.deepEqual(state.requests[0].body, {})
    assert.deepEqual(await page.evaluate(() => window.managementWrites), { '/api/desktop/updates/check': 1 })
    assert.equal(await page.evaluate(() => window.managementSignals['/api/desktop/updates/check']), false)
    await page.getByText('正在检查应用更新，请留意桌面对话框…', { exact: true }).waitFor()
    assert.equal(await page.locator('.pc_restartBtn').isDisabled(), true)
    await shot(page, '390-desktop-update-pending')
    await finish(state.requests[0], { ok: false, error: '更新服务暂不可用' })
    await page.getByText('暂时无法检查更新，请稍后再试。', { exact: true }).waitFor()
    assert.equal(await page.getByText('更新服务暂不可用', { exact: false }).count(), 0)
    assert.equal(await updateButtons.nth(0).isEnabled(), true)
    assert.equal(await updateButtons.nth(1).isEnabled(), true)
    await shot(page, '390-desktop-update-error')
    await updateButtons.nth(1).click()
    await waitRequests(state, 2)
    await finish(state.requests[1], {})
    await page.getByText('暂时无法检查更新，请稍后再试。', { exact: true }).waitFor()
    await updateButtons.nth(0).click()
    await waitRequests(state, 3)
    await finish(state.requests[2], { accepted: true })
    await page.getByText('应用更新流程已结束。版本与下载结果请以桌面对话框为准。', { exact: true }).waitFor()
    assert.equal(await updateButtons.nth(0).isEnabled(), true)
    assert.equal(await page.locator('.pc_restartBtn').isEnabled(), true)
    await page.clock.fastForward(7000)
    assert.equal(state.statusReads, statusReads, 'the app update flow must not poll legacy framework progress')
    assert.equal(state.frameworkChecks, 0)
    assert.equal(state.requests.every(request => request.endpoint === 'desktop-update-check'), true)
    await page.setViewportSize({ width: 1280, height: 900 })
    await shot(page, '1280-desktop-update-finished')
    await page.close()
  }
  {
    const { page, state } = await openPage('plugins', 390, false, 'idle', false, true)
    await page.locator('#pc-market-search').getByRole('button', { name: '搜索', exact: true }).click()
    const pluginCard = page.locator('.pc_item').filter({ hasText: 'example/new-plugin' })
    const skillCard = page.locator('.pc_item').filter({ hasText: 'example/new-skill' })
    await pluginCard.getByRole('button', { name: '添加到本地', exact: true }).waitFor()
    await row(page, 'plugin-a').getByRole('button', { name: '详情', exact: true }).click()
    await row(page, 'plugin-a').getByRole('button', { name: '检测更新', exact: true }).click()
    const detailUpdate = row(page, 'plugin-a').getByRole('button', { name: /^(更新|正在安装…)$/ })
    await detailUpdate.waitFor()
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.pc_item')].find(item => item.textContent.includes('example/new-plugin'))
      const install = [...card.querySelectorAll('button')].find(button => button.textContent === '添加到本地')
      const update = [...document.querySelectorAll('.pc_row button')].find(button => button.textContent === '更新')
      install.click(); install.click(); update.click()
    })
    await waitRequests(state, 1)
    assert.deepEqual(await page.evaluate(() => window.managementWrites), { '/plugin-console/install': 1 })
    assert.equal(await detailUpdate.isDisabled(), true)
    assert.equal(await skillCard.getByRole('button', { name: '添加到本地', exact: true }).isDisabled(), true)
    await shot(page, '390-install-request-pending')
    await finish(state.requests[0], {})
    await page.getByText('操作失败：服务未确认接受请求，请刷新状态后重试', { exact: true }).waitFor()
    assert.equal(await detailUpdate.isEnabled(), true)
    await shot(page, '390-install-invalid-response')
    await detailUpdate.click()
    await waitRequests(state, 2)
    assert.equal(state.requests[1].body.packageName, '@example/plugin-a')
    await finish(state.requests[1], { jobId: 'test-plugin-job' })
    assert.equal(await detailUpdate.isDisabled(), true)
    let releaseStatus
    state.installStatusGate = new Promise(resolve => { releaseStatus = resolve })
    await page.clock.fastForward(2100)
    await waitRequests({ requests: state.installReads }, 1)
    await page.clock.fastForward(6000)
    assert.equal(state.installReads.length, 1, 'slow installation status requests must not overlap')
    state.installJobs['test-plugin-job'] = { jobId: 'test-plugin-job', status: 'unexpected' }
    state.installStatusGate = null
    releaseStatus()
    await page.clock.fastForward(2100)
    assert.equal(await detailUpdate.isDisabled(), true, 'unknown progress must not unlock an active installation')
    state.installJobs['test-plugin-job'] = { jobId: 'test-plugin-job', status: 'failed', error: '安装失败，请重试' }
    await page.clock.fastForward(2100)
    await page.getByText('操作失败：安装失败，请重试', { exact: true }).waitFor()
    assert.equal(await detailUpdate.isEnabled(), true)
    await skillCard.getByRole('button', { name: '添加到本地', exact: true }).click()
    await waitRequests(state, 3)
    assert.equal(state.requests[2].body.kind, 'skill')
    await finish(state.requests[2], { jobId: 'test-skill-job' })
    state.installJobs['test-skill-job'] = { jobId: 'test-skill-job', status: 'done', kind: 'skill', skillName: 'new-skill' }
    await page.clock.fastForward(2100)
    await page.getByText(/技能安装完成：new-skill/).waitFor()
    await pluginCard.getByRole('button', { name: '添加到本地', exact: true }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.pc_item button')].some(button => button.textContent === '添加到本地' && !button.disabled))
    await page.setViewportSize({ width: 1280, height: 900 })
    await shot(page, '1280-install-skill-complete')
    await pluginCard.getByRole('button', { name: '添加到本地', exact: true }).click()
    await waitRequests(state, 4)
    await finish(state.requests[3], { jobId: 'test-bundle-job' })
    state.installJobs['test-bundle-job'] = { jobId: 'test-bundle-job', status: 'done', kind: 'plugin', packageName: '@example/new-plugin', bundle: true }
    await page.clock.fastForward(2100)
    await page.locator('.pc_messageRow').getByRole('button', { name: '重启服务', exact: true }).waitFor()
    assert.equal(await detailUpdate.isDisabled(), true, 'completed plugin installations remain locked until applied')
    await pluginCard.getByRole('button', { name: '等待刷新或重启', exact: true }).waitFor()
    assert.equal(await pluginCard.getByRole('button', { name: '等待刷新或重启', exact: true }).getAttribute('aria-busy'), 'false')
    await shot(page, '1280-install-awaiting-restart')
    await page.close()
  }
  {
    const { page, state } = await openPage('plugins', 390, false, 'idle', false, 'restored')
    await page.locator('#pc-market-search').getByRole('button', { name: '搜索', exact: true }).click()
    const install = page.locator('.pc_item').filter({ hasText: 'example/new-plugin' }).getByRole('button', { name: '添加到本地', exact: true })
    assert.equal(await install.isDisabled(), true)
    state.installJobs['restored-a'] = { jobId: 'restored-a', status: 'failed', error: '第一个任务失败' }
    await page.clock.fastForward(2100)
    await page.getByText('操作失败：第一个任务失败', { exact: true }).waitFor()
    assert.equal(await install.isDisabled(), true, 'one finished restored job must not release another active job')
    state.installJobs['restored-b'] = { jobId: 'restored-b', status: 'failed', error: '第二个任务失败' }
    await page.clock.fastForward(2100)
    await page.getByText('操作失败：第二个任务失败', { exact: true }).waitFor()
    assert.equal(await install.isEnabled(), true)
    await shot(page, '390-install-restored-jobs-retry')
    await page.close()
  }
  assert.deepEqual(problems, [])
  console.log(`plugin-console-management: ${theme}; ${screenshots} screenshots; plugin, skill and service mutation locks, retries, refresh and upgrade states verified`)
} finally {
  for (const request of pending) request.resolve({ ok: false, error: 'Test cleanup' })
  await browser.close()
  await vite.close()
  await rm(cacheDir, { recursive: true, force: true })
}
