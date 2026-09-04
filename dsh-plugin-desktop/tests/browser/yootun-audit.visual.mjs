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
const auditSourcePath = resolve(workspaceRoot, '../docker-helm.dofe.ai/plugins/dsh-yootun-audit/src/client.js')
const evidenceRoot = resolve(workspaceRoot, 'docs/superpowers/evidence/2026-09-05-yootun-audit')
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
assert(existsSync(browserExecutable), `Chrome executable not found: ${browserExecutable}`)

const event = {
  id: '018f0000-0000-7000-8000-000000000001',
  clientEventId: '018f0000-0000-7000-8000-000000000011',
  traceId: 'sales:follow-up:42',
  occurredAt: '2026-09-05T02:15:00.000Z',
  receivedAt: '2026-09-05T02:15:01.000Z',
  actorDisplayName: '陈晨',
  actionCode: 'sales.follow_up.executed',
  outcome: 'succeeded',
  source: { pluginId: 'dsh-plugin-desktop/yootun-sales', surface: 'human_ui' },
  target: { type: 'follow_up', id: 'follow-up-42', label: '华东渠道跟进' },
  changes: [{ field: 'status', before: 'confirmed', after: 'succeeded' }],
  effects: [{ target: 'crm', outcome: 'succeeded', code: 'delivered' }],
}
const failedEvent = {
  ...event,
  id: '018f0000-0000-7000-8000-000000000002',
  clientEventId: '018f0000-0000-7000-8000-000000000012',
  actorDisplayName: '李琳',
  actionCode: 'content.publish.executed',
  outcome: 'failed',
  errorCode: 'platform_login_required',
  source: { pluginId: 'dsh-plugin-desktop/yootun-content-command', surface: 'agent_tool' },
  target: { type: 'article', id: 'article-7', label: '产品周报' },
  changes: [{ field: 'platformCount', before: 0, after: 2 }],
  effects: [{ target: 'xiaohongshu', outcome: 'requires_user_login', code: 'login_required' }],
}

const workspace = overrides => ({
  status: 'ready',
  summary: { today: 12, failed: 1, pendingSync: 0 },
  events: [event, failedEvent],
  page: { nextCursor: null },
  scopes: { available: ['self'], isSuperAdmin: false },
  sync: { pending: 0, quarantine: 0 },
  freshness: { source: 'live', syncedAt: '2026-09-05T02:16:00.000Z' },
  ...overrides,
})

let scenario = 'live'
const responses = {
  live: () => workspace({}),
  empty: () => workspace({ summary: { today: 0, failed: 0, pendingSync: 0 }, events: [] }),
  cached: () => workspace({ status: 'offline', freshness: { source: 'cache', syncedAt: '2026-09-05T01:50:00.000Z' } }),
  pending: () => workspace({ summary: { today: 12, failed: 1, pendingSync: 3 }, sync: { pending: 3, quarantine: 0, errorCode: 'network_unavailable' } }),
  member: () => workspace({ scopes: { available: ['self'], isSuperAdmin: false } }),
  admin: () => workspace({ scopes: { available: ['self', 'team'], currentTeam: { id: 'team-1', name: '增长团队' }, isSuperAdmin: false } }),
  superadmin: () => workspace({ scopes: { available: ['self', 'team'], isSuperAdmin: true } }),
}

const vite = await createServer({
  root: harnessRoot,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'audit-source',
    configureServer(server) {
      server.middlewares.use('/__audit_source__', async (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(await readFile(auditSourcePath, 'utf8'))
      })
    },
  }],
})
await vite.listen()
const address = vite.httpServer.address()
assert(address && typeof address === 'object')
const url = `http://127.0.0.1:${address.port}`
await mkdir(evidenceRoot, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable,
})
const page = await browser.newPage()
const consoleProblems = []
const auditRequests = []
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => consoleProblems.push(`pageerror: ${error.message}`))
await page.route('**/api/desktop/yootun/audit*', async route => {
  const request = route.request()
  auditRequests.push(`${request.method()} ${new URL(request.url()).pathname}`)
  const query = new URL(request.url()).searchParams
  if (request.method() === 'POST') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'accepted' }) })
    return
  }
  if (query.get('view') === 'teams') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ teams: [{ id: 'team-1', name: '增长团队' }, { id: 'team-2', name: '内容团队' }], nextCursor: null }) })
    return
  }
  if (scenario === 'loading') await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  const value = query.get('query') ? workspace({ events: [], summary: { today: 0, failed: 0, pendingSync: 0 } }) : responses[scenario === 'loading' ? 'live' : scenario]()
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
})

async function open(width, height, nextScenario) {
  scenario = nextScenario
  await page.setViewportSize({ width, height })
  await page.goto(url)
  await page.getByRole('button', { name: '操作审计' }).click()
}

async function assertViewport() {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    dialog: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
    unnamed: [...document.querySelectorAll('button,input,select')].filter(element => {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      return !(element.getAttribute('aria-label') || element.textContent?.trim() || element.getAttribute('placeholder'))
    }).length,
    contrastFailures: ['.ya-header h1', '.ya-header p', '.ya-table-head', '.ya-row', '.ya-outcome.is-failed', '.ya-status']
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .filter(element => {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden' || !element.textContent?.trim()) return false
        const channels = value => value.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [0, 0, 0]
        const luminance = value => channels(value).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
        let background = element
        while (background.parentElement && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement
        const foregroundLuminance = luminance(style.color)
        const backgroundLuminance = luminance(getComputedStyle(background).backgroundColor)
        const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        return ratio < 4.5
      }).map(element => element.className || element.tagName),
  }))
  assert.equal(metrics.scrollWidth, metrics.clientWidth, 'page must not scroll horizontally')
  assert.equal(metrics.dialog, true, 'overlay must expose modal dialog semantics')
  assert.equal(metrics.unnamed, 0, 'all visible controls must have accessible names')
  assert.deepEqual(metrics.contrastFailures, [], 'representative text must meet WCAG AA contrast')
  const content = page.locator('.ya-workspace, .ya-empty, .ya-skeletons').last()
  if (await content.count()) {
    const box = await content.boundingBox()
    const style = await content.evaluate(element => ({
      flex: getComputedStyle(element).flex,
      display: getComputedStyle(element).display,
      parentDisplay: getComputedStyle(element.parentElement).display,
      parentHeight: element.parentElement.getBoundingClientRect().height,
      injectedStyles: [...document.querySelectorAll('style[data-plugin="@dofe/dsh-yootun-audit"]')].map(node => ({ length: node.textContent.length, hasFlexShell: node.textContent.includes('.ya-shell{display:flex') })),
    }))
    assert(box && box.y + box.height >= page.viewportSize().height - 1, `content must fill the remaining viewport: ${JSON.stringify({ box, style, viewport: page.viewportSize() })}`)
  }
}

try {
  await open(320, 720, 'live')
  await page.getByRole('grid', { name: '操作审计' }).waitFor()
  assert.equal(await page.locator('.ya-detail').isVisible(), false, 'mobile must show the list before detail')
  const mobileOutcome = await page.locator('.ya-row .ya-outcome').first().boundingBox()
  assert(mobileOutcome && mobileOutcome.x + mobileOutcome.width <= 320, 'mobile outcome must stay in the viewport')
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '320-member-list.png'), fullPage: true })
  await page.locator('.ya-row').first().click()
  assert.equal(await page.locator('.ya-detail').isVisible(), true)
  assert((await page.locator('.ya-detail').boundingBox())?.height > 400, 'mobile detail must use the remaining height')
  await page.screenshot({ path: resolve(evidenceRoot, '320-event-detail.png'), fullPage: true })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.ya-detail').isVisible(), false)

  await open(768, 800, 'cached')
  await page.getByText('远端暂不可用，已保留最近记录').waitFor()
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '768-offline-cache.png'), fullPage: true })

  await open(1024, 800, 'pending')
  await page.getByText(/3 条记录尚未同步/u).waitFor()
  await page.getByRole('button', { name: '立即重试' }).click()
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '1024-pending-sync.png'), fullPage: true })

  await open(1440, 900, 'superadmin')
  await page.getByRole('tab', { name: '团队' }).click()
  await page.getByRole('combobox', { name: '搜索团队' }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: '搜索团队' }).inputValue(), '')
  await page.getByRole('combobox', { name: '搜索团队' }).selectOption('team-1')
  await page.locator('.ya-row').first().click()
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '1440-superadmin-detail.png'), fullPage: true })

  await open(1024, 800, 'admin')
  await page.getByRole('tab', { name: '团队' }).click()
  await page.getByText('增长团队').waitFor()
  await open(1024, 800, 'member')
  assert.equal(await page.getByRole('tab', { name: '团队' }).count(), 0)

  await open(1024, 800, 'empty')
  await page.getByText('尚无可审计操作').waitFor()
  await page.screenshot({ path: resolve(evidenceRoot, '1024-empty.png'), fullPage: true })

  await open(1024, 800, 'live')
  await page.getByRole('searchbox').fill('不会命中的筛选')
  await page.getByText('没有符合筛选条件的记录').waitFor()
  await page.screenshot({ path: resolve(evidenceRoot, '1024-filtered-empty.png'), fullPage: true })

  await open(1024, 800, 'loading')
  await page.locator('[aria-busy="true"]').waitFor()
  await page.screenshot({ path: resolve(evidenceRoot, '1024-loading.png'), fullPage: true })
  await page.getByRole('grid', { name: '操作审计' }).waitFor()

  await page.getByRole('grid', { name: '操作审计' }).focus()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator('.ya-detail').isVisible(), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.ya-detail.is-empty').isVisible(), false)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '操作审计')
  assert.equal(await page.getByRole('button', { name: '操作审计' }).evaluate(element => element === document.activeElement), true)

  assert.equal(consoleProblems.length, 0, consoleProblems.join('\n'))
  assert(auditRequests.length > 0)
  assert(auditRequests.every(entry => entry.endsWith('/api/desktop/yootun/audit')))
  process.stdout.write(`audit-browser: ${auditRequests.length} scoped requests, 8 screenshots, no console or layout failures\n`)
} finally {
  await page.close()
  await browser.close()
  await vite.close()
}
