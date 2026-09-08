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
const evidenceRoot = resolve(workspaceRoot, 'docs/superpowers/evidence/2026-09-08-search-locks')
const sources = {
  lead: resolve(workspaceRoot, '.ci/dsh-yootun-lead-discovery/src/client.js'),
  recruiter: resolve(workspaceRoot, '.ci/dsh-yootun-recruiter/src/client.js'),
  retrofit: resolve(workspaceRoot, '.ci/dsh-yootun-retrofit/src/client.js'),
}
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
assert(existsSync(browserExecutable), `Chrome executable not found: ${browserExecutable}`)

const vite = await createServer({
  root: harnessRoot,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'search-lock-source',
    configureServer(server) {
      server.middlewares.use('/__audit_source__', async (request, response) => {
        const sourceId = new URL(request.url || '/', 'http://127.0.0.1').searchParams.get('source')
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(await readFile(sources[sourceId] || sources.lead, 'utf8'))
      })
    },
  }],
})
await vite.listen()
const address = vite.httpServer.address()
assert(address && typeof address === 'object')
const url = `http://127.0.0.1:${address.port}`
await mkdir(evidenceRoot, { recursive: true })

let leadSearchRequests = 0
let leadPageRequests = 0
let releaseLeadSearch
const leadSearchReady = new Promise(resolve => { releaseLeadSearch = resolve })
let releaseLeadPage
const leadPageReady = new Promise(resolve => { releaseLeadPage = resolve })
let recruiterActionRequests = 0
let releaseRecruiterAction
const recruiterActionReady = new Promise(resolve => { releaseRecruiterAction = resolve })
const recruiter = {
  status: 'ready',
  dashboard: { openRoles: 1, activeCandidates: 2, pendingReplies: 1, pendingFeedback: 0, pendingConfirmation: 1, responseRate: 75 },
  requirements: [],
  candidates: [],
  actions: [{ id: 'recruiter-action-1', targetLabel: '候选人 A', summary: '发送面试邀请', status: 'awaiting_confirmation' }],
  boss: { status: 'ready', adapter: 'official', inAppBrowser: true },
  sync: { status: 'ready', imported: 2, updated: 1 },
  knowledge: { status: 'ready', spaces: 1, documents: 4, memories: 2, pending: 1 },
  analytics: {},
  updatedAt: '2026-09-08T03:00:00.000Z',
}
let retrofitStoredRequests = 0
let retrofitRefreshRequests = 0
let releaseRetrofitRefresh
const retrofitRefreshReady = new Promise(resolve => { releaseRetrofitRefresh = resolve })
const retrofitStored = {
  status: 'ready',
  source: 'database',
  retrievedAt: '2026-09-08T03:00:00.000Z',
  result: {
    total: 1,
    returned: 1,
    items: [{ platform: 'bilibili', externalId: 'lock-1', title: 'SUV 灯光升级', text: '城市通勤照明方案', commentCount: 18, shareCount: 6 }],
  },
}
const retrofitExternal = {
  status: 'ready',
  source: 'agent_reach',
  platform: 'youtube',
  retrievedAt: '2026-09-08T03:00:00.000Z',
  result: { stdout: JSON.stringify([{ title: 'LED lighting reference', text: 'Public reference only', url: 'https://example.test/retrofit-lock' }]) },
}

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const consoleProblems = []
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => consoleProblems.push(`pageerror: ${error.message}`))
await page.route('**/api/desktop/yootun/lead-discovery', async route => {
  const body = route.request().postDataJSON()
  if (body.action === 'page') {
    leadPageRequests += 1
    await leadPageReady
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ready', items: [], nextCursor: null, hasMore: false }),
    })
    return
  }
  leadSearchRequests += 1
  await leadSearchReady
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'ready',
      resultRef: 'lead-ref',
      nextCursor: 'cursor-1',
      hasMore: true,
      stats: { total: 1, totalAvailable: 2 },
      items: [{
        leadLevel: 'A',
        platform: 'xiaohongshu-v2',
        intentScore: 88,
        aiSummary: '近期计划购买新能源 SUV，正在比较车型。',
        city: '长沙',
        recommendedAction: '优先联系并确认预算。',
        sourceUrl: 'https://example.test/lead',
      }],
      retrievedAt: '2026-09-08T03:00:00.000Z',
    }),
  })
})
await page.route('**/api/desktop/yootun/recruiter', async route => {
  if (route.request().method() === 'POST') {
    recruiterActionRequests += 1
    await recruiterActionReady
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...recruiter, actions: recruiter.actions.map(action => ({ ...action, status: 'confirmed_pending_adapter' })) }),
    })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(recruiter) })
})
await page.route('**/api/desktop/yootun/retrofit', async route => {
  const body = route.request().postDataJSON()
  if (body.action === 'refresh') {
    retrofitRefreshRequests += 1
    await retrofitRefreshReady
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(retrofitExternal) })
    return
  }
  retrofitStoredRequests += 1
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(retrofitStored) })
})

async function settleStrictMode() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function assertViewport() {
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    dialog: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
  }))
  assert.equal(viewport.scrollWidth, viewport.clientWidth)
  assert.equal(viewport.dialog, true)
}

try {
  await page.goto(`${url}?source=lead`)
  await page.getByRole('button', { name: '购车线索发现' }).click()
  const leadInput = page.getByRole('textbox', { name: '输入城市、车型或购车意向，例如：长沙 想买新能源 SUV' })
  await leadInput.waitFor()
  await settleStrictMode()
  await leadInput.fill('长沙 新能源 SUV')
  await leadInput.press('Enter')
  await page.locator('.yl-content[aria-busy="true"]').waitFor()
  await leadInput.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.equal(leadSearchRequests, 1, 'an active lead search must reject duplicate Enter submissions')
  assert.equal(await leadInput.isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '小红书' }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '正在检索' }).isDisabled(), true)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-lead-search-lock.png'), fullPage: true })
  releaseLeadSearch()
  await page.waitForFunction(() => document.querySelector('.yl-content')?.getAttribute('aria-busy') === 'false')

  const loadMore = page.getByRole('button', { name: '加载更多' })
  await loadMore.click()
  await page.locator('.yl-content[aria-busy="true"]').waitFor()
  await leadInput.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.equal(leadPageRequests, 1, 'lead pagination must execute once')
  assert.equal(leadSearchRequests, 1, 'active pagination must reject a new lead search')
  assert.equal(await leadInput.isDisabled(), true)
  assert.equal(await page.getByRole('tab', { name: '发现线索' }).isDisabled(), true)
  assert.equal(await page.getByRole('tab', { name: '已存候选' }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '正在读取…' }).isDisabled(), true)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-lead-page-lock.png'), fullPage: true })
  releaseLeadPage()
  await page.waitForFunction(() => document.querySelector('.yl-content')?.getAttribute('aria-busy') === 'false')

  await page.goto(`${url}?source=recruiter`)
  await page.getByRole('button', { name: '招聘工作台' }).click()
  await page.getByRole('heading', { name: 'HR 招聘工作台' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yr-content')?.getAttribute('aria-busy') === 'false')
  const recruiterApprove = page.getByRole('button', { name: '确认动作' })
  await recruiterApprove.click()
  await page.locator('.yr-content[aria-busy="true"]').waitFor()
  await recruiterApprove.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(recruiterActionRequests, 1, 'an active recruiter action must reject duplicate submissions')
  assert.equal(await recruiterApprove.isDisabled(), true)
  assert.equal(await page.locator('.yr-tabs button:not(:disabled)').count(), 0)
  assert.equal(await page.locator('.yr-source-button:not(:disabled)').count(), 0)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-recruiter-action-lock.png'), fullPage: true })
  releaseRecruiterAction()
  await page.waitForFunction(() => document.querySelector('.yr-content')?.getAttribute('aria-busy') === 'false')

  await page.goto(`${url}?source=retrofit`)
  await page.getByRole('button', { name: '改装方案库' }).click()
  await page.getByRole('heading', { name: '车辆改装方案库' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yr-content')?.getAttribute('aria-busy') === 'false')
  assert.equal(retrofitStoredRequests, 1, 'initial stored-data load must execute once')
  const retrofitInput = page.getByRole('textbox', { name: '输入车型、改装项目或使用场景' })
  await retrofitInput.fill('SUV LED')
  await page.getByRole('button', { name: '刷新公开来源' }).click()
  await page.locator('.yr-content[aria-busy="true"]').waitFor()
  await retrofitInput.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.equal(retrofitRefreshRequests, 1, 'an active retrofit refresh must reject duplicate Enter submissions')
  assert.equal(await retrofitInput.isDisabled(), true)
  assert.equal(await page.getByRole('combobox', { name: '内容平台' }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '正在检索' }).isDisabled(), true)
  await assertViewport()
  await page.screenshot({ path: resolve(evidenceRoot, '390-retrofit-search-lock.png'), fullPage: true })
  releaseRetrofitRefresh()
  await page.getByRole('heading', { name: '公开来源参考' }).waitFor()
  await page.waitForFunction(() => document.querySelector('.yr-content')?.getAttribute('aria-busy') === 'false')

  assert.deepEqual(consoleProblems, [])
  process.stdout.write('search-locks-browser: 3 plugins, 4 screenshots, duplicate and overlapping requests blocked with stable mobile layout\n')
} finally {
  releaseLeadSearch()
  releaseLeadPage()
  releaseRecruiterAction()
  releaseRetrofitRefresh()
  await page.close()
  await browser.close()
  await vite.close()
}
