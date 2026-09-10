// 抖音运营插件的桌面可视化验收：菜单入口、整页 overlay、焦点恢复、
// 加载/错误/空态、删除确认与失败重试、无 Chrome 阻断。
//
// 页面只访问本地同源路由 /api/desktop/yootun/douyin-operation（这里由 mock 承接），
// 不触网、不接触 Cookie/storage_state，也不产生真实业务数据。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'
import { assertAccessibleSurface } from './assert-accessible-surface.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const packageRoot = resolve(here, '../..')
const workspaceRoot = resolve(packageRoot, '..')
const harnessRoot = resolve(here, 'yootun-douyin')
const clientBundlePath = resolve(workspaceRoot, '.ci/dsh-yootun-douyin-operation/lib/client.js')
const evidenceRoot = process.env.DSH_VISUAL_EVIDENCE_ROOT
  ? resolve(process.env.DSH_VISUAL_EVIDENCE_ROOT)
  : resolve(workspaceRoot, 'docs/superpowers/evidence/2026-09-10-douyin-operation')

// 只使用业务员机器上的系统 Chrome：不下载 Chromium，也不回退到内置浏览器。
const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome')
assert(existsSync(browserExecutable), `Chrome executable not found: ${browserExecutable}`)
assert(existsSync(clientBundlePath), `client bundle missing: ${clientBundlePath}`)

const ROUTE = '/api/desktop/yootun/douyin-operation'
const PATH = '/api/desktop/yootun/douyin-operation'

const works = [
  {
    work_id: 'work-1',
    title: '示例作品一',
    url: 'https://www.douyin.com/video/0000000000000000001',
    play_count: 128000,
    collect_count: 320,
    like_count: 5400,
    comment_count: 210,
    bounce_rate_2s_pct: 32.5,
    completion_rate_5s_pct: 41.2,
    completion_rate_pct: 18.4,
    avg_watch_duration_s: 12.5,
    avg_view_proportion_pct: 22.1,
  },
  {
    // 本次未取到的字段必须显示 `—`，不能用历史值或 0 顶替。
    work_id: 'work-2',
    title: '示例作品二',
    url: 'https://www.douyin.com/video/0000000000000000002',
    play_count: 4300,
    collect_count: null,
    like_count: 88,
    comment_count: null,
    bounce_rate_2s_pct: null,
    completion_rate_5s_pct: null,
    completion_rate_pct: null,
    avg_watch_duration_s: null,
    avg_view_proportion_pct: null,
  },
]

let scenario = 'live'
let accounts = []
let collectPolls = 0

const accountList = () => (scenario === 'empty' ? [] : accounts)

function browserStatus() {
  if (scenario === 'chrome-blocked') return { status: 'ready', chromeAvailable: false, driverAvailable: false, reason: 'chrome_missing' }
  if (scenario === 'driver-blocked') return { status: 'ready', chromeAvailable: true, driverAvailable: false, reason: 'playwright_driver_missing' }
  return { status: 'ready', chromeAvailable: true, driverAvailable: true }
}

function respond(body) {
  switch (body.action) {
    case 'browser.status':
      return browserStatus()
    case 'accounts.list':
      return { status: 'ready', accounts: accountList() }
    case 'works.list':
      if (scenario === 'error') return { status: 'unavailable', reason: 'refresh_failed' }
      return { status: 'ready', works }
    case 'work.get':
      return {
        status: 'ready',
        work: { ...works[0], traffic_source: [{ source_key: 'homepage_hot', source_label: '推荐', share_pct: 62.5 }], progress_analysis: { drag_back_curve: [{ key: 2, value: 12 }], drag_forward_curve: [] }, search_keywords: [], data_gap: { completion_rate_pct: { reason: 'not_exposed' } } },
        audience: { gender: [{ key: '男', pct: 58.2 }, { key: '女', pct: 41.8 }], age: [{ key: '18-23', pct: 30 }], province: [], city_level: [] },
        hotwords: [],
      }
    case 'work.trend':
      return { status: 'ready', total: 3 }
    case 'account.beginLogin':
      return { status: 'ready', login: { loginKey: 'login-1', status: 'waiting' } }
    case 'account.loginStatus':
      return { status: 'ready', login: { loginKey: 'login-1', status: 'waiting' } }
    case 'account.probe':
      return { status: 'ready' }
    case 'account.removeLocal':
      return scenario === 'delete-fail' ? { status: 'blocked', reason: 'cleanup_failed' } : { status: 'ready' }
    case 'account.removeRemote':
      accounts = accounts.filter(item => item.accountId !== body.accountId)
      return { status: 'ready' }
    case 'collect.start':
      collectPolls = 0
      return { status: 'ready', collect: { status: 'running', progress: { phase: 'work', index: 1, total: 3 } } }
    case 'collect.status':
      collectPolls += 1
      return collectPolls < 3
        ? { status: 'ready', collect: { status: 'running', progress: { phase: 'work', index: collectPolls, total: 3 } } }
        : { status: 'ready', collect: { status: 'completed', result: { runStatus: 'completed', expectedWorkCount: works.length } } }
    default:
      throw new Error(`unexpected host action: ${body.action}`)
  }
}

const vite = await createServer({
  root: harnessRoot,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'douyin-source',
    configureServer(server) {
      server.middlewares.use('/__douyin_source__', async (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(await readFile(clientBundlePath, 'utf8'))
      })
    },
  }],
})
await vite.listen()
const address = vite.httpServer.address()
assert(address && typeof address === 'object')
const url = `http://127.0.0.1:${address.port}`
await mkdir(evidenceRoot, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const page = await browser.newPage()
const consoleProblems = []
const requests = []
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', error => consoleProblems.push(`pageerror: ${error.message}`))
await page.route('**/api/desktop/yootun/**', async route => {
  const request = route.request()
  requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
  assert.equal(new URL(request.url()).pathname, PATH, '插件只能访问本地同源路由')
  const body = JSON.parse(request.postData() || '{}')
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond(body)) })
})

const trigger = () => page.getByRole('button', { name: '抖音运营' })
const overlay = () => page.locator('.ydo-overlay')

async function open(width, height, nextScenario, options = {}) {
  scenario = nextScenario
  accounts = options.accounts ?? [
    { accountId: 'acc-1', nickname: '示例账号', fanCount: 12345, sessionStatus: 'ok', lastCollectedAt: '2026-09-09T10:00:00.000Z' },
    { accountId: 'acc-2', nickname: '待重扫账号', fanCount: null, sessionStatus: 'expired' },
  ]
  await page.setViewportSize({ width, height })
  await page.goto(url)
  await trigger().click()
  await overlay().waitFor()
}

async function assertSurface() {
  await assertAccessibleSurface(page)
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  assert.equal(layout.scrollWidth, layout.clientWidth, '页面不得出现横向滚动')
}

const screenshot = name => page.screenshot({ path: resolve(evidenceRoot, name), fullPage: true })

try {
  // 1) 菜单入口 → 整页 overlay：列序固定，缺口字段显示 `—`。
  await open(1440, 900, 'live')
  assert.equal(await page.evaluate(() => document.body.dataset.bundleId), '@dofe/dsh-yootun-douyin-operation')
  assert.equal(await page.getByRole('dialog', { name: '抖音运营' }).count(), 1, 'overlay 必须以命名 dialog 暴露')
  const headers = await page.locator('.ydo-table-head .ydo-cell').allTextContents()
  assert.deepEqual(headers, [
    '作品名称', '作品链接', '粉丝数量', '播放量', '收藏量', '点赞量', '评论量',
    '2s跳出率', '5s完播率', '完播率', '平均播放时长', '平均播放占比',
  ], '列序与指标文案固定')
  const secondRow = await page.locator('.ydo-table-row').nth(1).locator('.ydo-cell').allTextContents()
  assert.equal(secondRow[4], '—', '未取到的收藏量必须显示缺口')
  assert.equal(secondRow[6], '—', '未取到的评论量必须显示缺口')
  assert.equal(secondRow[7], '—', '未取到的 2s 跳出率必须显示缺口')
  assert.equal(await page.locator('.ydo-table-row').first().locator('.ydo-cell').nth(4).textContent(), '320')
  await assertSurface()
  await screenshot('1440-account-works.png')

  // 2) Escape 关闭 overlay 并恢复触发按钮焦点。
  await page.keyboard.press('Escape')
  await overlay().waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '抖音运营')
  assert.equal(await trigger().evaluate(element => element === document.activeElement), true, '关闭后焦点必须回到触发按钮')

  // 3) 空态：没有账号时给出可读引导，采集按钮不可用。
  await open(1024, 800, 'empty')
  await page.locator('.ydo-accounts .ydo-hint').getByText('添加账号后开始采集').waitFor()
  assert.equal(await page.getByRole('button', { name: '采集本账号全部' }).isDisabled(), true)
  await assertSurface()
  await screenshot('1024-empty-accounts.png')

  // 4) 错误态：来源失败在工具栏上方以 alert 呈现，且不暴露原始 code。
  await open(1024, 800, 'error')
  const errorText = await page.locator('.ydo-error[role="alert"]').first().textContent()
  assert.equal(errorText, '刷新失败')
  assert.doesNotMatch(errorText, /refresh_failed/u)
  await assertSurface()
  await screenshot('1024-source-error.png')

  // 5) 无 Chrome 阻断：给出安装指引与重新检测入口，不静默回退 Chromium。
  await open(1024, 800, 'chrome-blocked')
  await page.getByText('未检测到 Google Chrome').waitFor()
  await page.getByText(/不回退 Chromium/u).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新检测' }).count(), 1)
  assert.equal(await page.getByRole('button', { name: '添加账号' }).isDisabled(), true)
  await assertSurface()
  await screenshot('1024-chrome-blocked.png')

  // 6) 驱动缺失与小屏布局。
  await open(1024, 800, 'driver-blocked')
  await page.getByText('缺少浏览器驱动').waitFor()
  await screenshot('1024-driver-missing.png')

  await open(320, 720, 'live')
  await page.locator('.ydo-table-wrap').waitFor()
  assert.equal(await page.locator('.ydo-table-wrap').count(), 1, '小屏下表格在容器内滚动')
  await assertSurface()
  await screenshot('320-works.png')

  // 7) 删除：确认 → 失败可重试（绝不提前显示已删除）→ 重试成功。
  await open(1024, 800, 'delete-fail')
  await page.locator('.ydo-card').first().waitFor()
  assert.equal(await page.locator('.ydo-card').count(), 2)
  await page.getByRole('button', { name: '删除账号' }).first().click()
  const confirm = page.getByRole('dialog', { name: /确认删除该账号/u })
  await confirm.waitFor()
  await assertAccessibleSurface(page)
  await confirm.getByRole('button', { name: '确认删除' }).click()
  await page.locator('.ydo-delete-retry[role="alert"]').waitFor()
  assert.equal(await page.locator('.ydo-delete-retry').getByText('删除失败').count(), 1)
  assert.equal(await page.locator('.ydo-card').count(), 2, '清理失败时必须保留账号记录与重试入口')
  await screenshot('1024-delete-failed-retry.png')

  scenario = 'live'
  await page.getByRole('button', { name: '重试删除' }).click()
  await page.locator('.ydo-delete-retry').waitFor({ state: 'detached' })
  await page.getByText('示例账号').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.ydo-card').count(), 1, '重试成功后账号被移除')
  assert.equal(await page.getByText('删除失败').count(), 0)

  // 8) 取消删除不产生任何写请求。
  const beforeCancel = requests.length
  await page.getByRole('button', { name: '删除账号' }).first().click()
  await page.getByRole('dialog', { name: /确认删除该账号/u }).getByRole('button', { name: '取消' }).click()
  await page.getByRole('dialog', { name: /确认删除该账号/u }).waitFor({ state: 'detached' })
  assert.equal(requests.length, beforeCancel, '取消删除不得发起写请求')
  assert.equal(await page.locator('.ydo-card').count(), 1)

  // 9) 采集进度与终态横幅（aria-live / aria-busy）。
  await open(1024, 800, 'live')
  await page.getByRole('button', { name: '采集本账号全部' }).click()
  const progress = page.locator('.ydo-progress[role="status"][aria-busy="true"]')
  await progress.waitFor()
  await page.getByText('采集进度 1/3').waitFor()
  await assertSurface()
  await screenshot('1024-collecting.png')
  await page.getByText('采集完成').first().waitFor()

  // 10) 子页面：先关详情再关 overlay，焦点最终回到触发按钮。
  // 本步沿用第 9 步的 1024×800 视口（不再重新 open），因此证据文件名必须与真实视口一致，
  // 否则审阅者会按文件名误判布局宽度（DS-2，2026-09-10 修订）。
  await page.locator('.ydo-table-row').first().dblclick()
  const detail = page.locator('.ydo-modal-overlay[role="dialog"]')
  await detail.waitFor()
  await page.getByText('数据缺口').waitFor()
  await page.getByText('推荐').first().waitFor()
  await assertSurface()
  await screenshot('1024-work-detail.png')
  await page.keyboard.press('Escape')
  await detail.waitFor({ state: 'detached' })
  assert.equal(await overlay().count(), 1, 'Escape 必须先关子页面')
  await page.keyboard.press('Escape')
  await overlay().waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '抖音运营')

  assert.equal(consoleProblems.length, 0, consoleProblems.join('\n'))
  assert(requests.length > 0)
  assert(requests.every(entry => entry === `POST ${ROUTE}`), `插件只能走本地同源路由：${requests.join(', ')}`)
  process.stdout.write(`douyin-browser: ${requests.length} 次同源请求，9 张截图，无控制台错误与布局溢出\n`)
} finally {
  await page.close()
  await browser.close()
  await vite.close()
}
