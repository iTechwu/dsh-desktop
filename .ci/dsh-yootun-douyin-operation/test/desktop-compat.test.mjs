// dsh-desktop 接入门禁回归：登记清单、cordis bundle、宿主路由、客户端 UX 契约与凭证卫生。
//
// 这些断言与 dsh-desktop 的 `scripts/plugin-ux-audit.mjs`（check:ux）和
// `docs/superpowers/specs/2026-09-09-mcp-api-capability-matrix.md` 一一对应：
// 插件源一旦偏离这些契约，Desktop 端注册、审计或打包就会失败。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = JSON.parse(await read('package.json'))
const hostSource = await read('index.js')
const clientSource = await read('src/client.js')
const clientBundle = await read('lib/client.js')
const chromeSource = await read('src/chrome.js')
const cordisPatch = await read('cordis.patch.yml')

const PLUGIN_DIR = 'dsh-yootun-douyin-operation'
const PUBLIC_PATH = '/api/desktop/yootun/douyin-operation'
const YDO_PREFIX = 'ydo-'

test('manifest 与 exports 满足 Desktop 登记契约', () => {
  assert.equal(manifest.name, '@dofe/dsh-yootun-douyin-operation')
  assert.equal(manifest.main, './index.js')
  assert.equal(manifest.exports['.'], './index.js')
  assert.equal(manifest.exports['./client'], './lib/client.js', 'exports["./client"] 必须指向 lib/client.js')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.equal(typeof manifest.scripts?.check, 'string', '包必须提供 check 脚本')
  assert.ok(manifest.files.includes('lib'), 'npm 包必须包含构建后的 lib/client.js')
})

test('cordis bundle entry 的 id 与插件包名一致', () => {
  assert.match(cordisPatch, /- id: dofe-yootun-douyin-operation\b/u)
  assert.match(cordisPatch, /name: '@dofe\/dsh-yootun-douyin-operation'/u)
})

test('宿主注册本地同源路由，且只经 ctx.tools 调用公共 MCP 网关', () => {
  assert.match(hostSource, /export const PATH = '\/api\/desktop\/yootun\/douyin-operation'/u)
  assert.match(hostSource, /export const inject = \['webServer', 'tools'\]/u)
  assert.match(hostSource, /ctx\.webServer\.register\(\{/u)
  assert.match(hostSource, /kind: 'exact'/u)
  assert.match(hostSource, /return send\(res, 405,/u, '宿主只接受 POST')
  for (const action of [
    'browser.status', 'accounts.list', 'account.beginLogin', 'account.loginStatus', 'account.probe',
    'account.removeLocal', 'account.removeRemote', 'collect.start', 'collect.status',
    'works.list', 'work.get', 'work.trend', 'run.get',
  ]) {
    assert.ok(hostSource.includes(`case '${action}':`), `宿主缺少 action ${action}`)
  }
  assert.match(hostSource, /callTool\(ctx, /u, 'tools 调用必须经宿主 ctx')
})

test('客户端只访问本地同源路由，不回显内部地址或原始传输错误', () => {
  assert.match(clientSource, /const PATH = '\/api\/desktop\/yootun\/douyin-operation'/u)
  for (const leaked of ['127.0.0.1', 'localhost:', '172.30.30.11', 'ixicai.cn', '192.168.']) {
    assert.equal(clientSource.includes(leaked), false, `客户端不得出现内部地址 ${leaked}`)
    assert.equal(clientBundle.includes(leaked), false, `客户端产物不得出现内部地址 ${leaked}`)
  }
  assert.match(clientSource, /if \(!response\.ok\) throw new Error\('request_failed'\)/u, '失败收敛为稳定 error code')
})

test('凭证卫生：Cookie / storage_state / MODELS_API_KEY 不进入客户端与产物', () => {
  // 注释里可以出现这些名词（说明凭证边界），但可执行代码里绝不能出现。
  const executable = source => source.replace(/^\s*\/\/.*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '')
  for (const artifact of [executable(clientSource), executable(clientBundle)]) {
    for (const secret of ['storage_state', 'sessionid', 'Cookie', 'MODELS_API_KEY', 'MODELS_KEY', 'Authorization']) {
      assert.equal(artifact.includes(secret), false, `客户端源码/产物不得出现 ${secret}`)
    }
  }
  assert.match(hostSource, /vault:\/\/douyin\//u, 'tools 只接收 vault:// 引用')
  assert.equal(hostSource.includes('sessionid'), false, '宿主流不读取 Cookie 值')
})

test(`客户端 CSS/class 使用独占的 ${YDO_PREFIX} 命名空间`, () => {
  assert.ok(clientSource.includes(`.${YDO_PREFIX}overlay`), '客户端必须暴露自有 ydo- 命名空间')
  assert.ok(clientBundle.includes(`.${YDO_PREFIX}overlay`), '构建产物必须保留 ydo- 命名空间')
  // 其他 Yootun 插件的类前缀（尤其 dashboard 的 yd-）不得被复用。
  for (const foreign of ['yd-', 'yr-', 'yxh-', 'ys-', 'ysw-', 'yk-', 'yl-', 'yf-', 'ya-', 'yu-', 'yro-', 'ycc-', 'ydr-']) {
    assert.equal(new RegExp(`\\.${foreign}`, 'u').test(clientSource), false, `客户端不得复用 ${foreign} 前缀`)
  }
})

test('本地 host 请求统一使用同源凭证、拒绝重定向和 30 秒超时', () => {
  const fetchCount = (clientSource.match(/\bfetch\s*\(/gu) || []).length
  assert.equal(fetchCount, 1, '客户端本地请求收敛为单一 fetch 入口')
  assert.equal((clientSource.match(/credentials:\s*'same-origin'/gu) || []).length, fetchCount)
  assert.equal((clientSource.match(/redirect:\s*'error'/gu) || []).length, fetchCount)
  assert.equal((clientSource.match(/\bsignal:\s*/gu) || []).length, fetchCount)
  assert.ok(clientSource.includes('const REQUEST_TIMEOUT_MS = 30000'))
  assert.match(clientSource, /signal: AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/u)
})

test('overlay 支持 Escape 关闭并恢复触发按钮焦点', () => {
  assert.match(clientSource, /event\.key === 'Escape'/u)
  assert.match(clientSource, /requestAnimationFrame\(\(\)\s*=>\s*lastTrigger\?\.focus/u)
  assert.match(clientSource, /role: 'dialog', 'aria-modal': true/u)
  assert.match(clientSource, /'aria-labelledby': 'ydo-title'/u)
})

test('异步状态暴露 aria-live / aria-busy', () => {
  assert.ok(clientSource.includes("'aria-live': 'polite'"), '加载/进度状态需要 polite 通告')
  assert.ok(clientSource.includes("'aria-live': 'assertive'"), '错误状态需要 assertive 通告')
  assert.match(clientSource, /'aria-busy': busy/u)
  assert.match(clientSource, /role: 'status'/u)
  assert.match(clientSource, /role: 'alert'/u)
})

test('删除账号具备确认、处理中、失败可重试的生命周期', () => {
  assert.match(clientSource, /awaiting_confirmation/u)
  assert.match(clientSource, /confirmed_pending_adapter/u)
  assert.match(clientSource, /cleanup_failed/u)
  // 设备清理失败时不得继续请求远端删除，也不得显示「已删除」。
  const localIndex = clientSource.indexOf("action: 'account.removeLocal'")
  const remoteIndex = clientSource.indexOf("action: 'account.removeRemote'")
  assert.ok(localIndex > 0 && remoteIndex > localIndex, '必须先清本地再清远端')
  assert.match(clientSource, /setDeleteState\(DELETE_LIFECYCLE\.cleanupFailed\)/u)
  assert.match(clientSource, /t\('deleteRetry'\)/u, '失败态提供重试入口')
  assert.ok(clientSource.includes("deletePending: '正在删除…'"))
  assert.ok(clientSource.includes("deleteFailed: '删除失败'"))
})

test('无系统 Chrome / 无驱动时阻断并给出可读提示（不回退 Chromium）', () => {
  assert.ok(clientSource.includes("noChromeTitle: '未检测到 Google Chrome'"))
  assert.ok(clientSource.includes('不回退 Chromium'))
  // 注释里说明「不采用」，可执行代码里必须真的不出现。
  const executableChrome = chromeSource.replace(/^\s*\/\/.*$/gmu, '')
  assert.equal(executableChrome.includes('--disable-blink-features'), false, '不得使用自动化特征规避参数')
  assert.equal(executableChrome.includes('chromium-'), false, '不得内置或下载 Chromium 二进制')
  assert.match(chromeSource, /export const LAUNCH_ARGS = \['--no-sandbox', '--disable-dev-shm-usage'\]/u)
  assert.match(chromeSource, /channel: 'chrome'/u)
  assert.match(chromeSource, /throw new ChromeMissingError\(\)/u, '无系统 Chrome 时必须阻断')
})

test('加载、空态与失败态文案齐备', () => {
  for (const key of ['collecting', 'none', 'selectAccount', 'emptyAccounts', 'collectFailed', 'refreshFailed', 'deleteBlocked']) {
    assert.ok(clientSource.includes(`${key}: `), `缺少状态文案 ${key}`)
  }
  assert.ok(clientSource.includes('点击「采集本账号全部」开始'))
})

test('产物入口 id 与插件包名一致', () => {
  assert.ok(clientBundle.includes('id: "@dofe/dsh-yootun-douyin-operation"'))
  assert.ok(clientBundle.includes('window.__ModuleLoader__.load('))
})

test('公共路由与目录名保持既有约定', () => {
  assert.equal(PLUGIN_DIR, 'dsh-yootun-douyin-operation')
  assert.ok(PUBLIC_PATH.startsWith('/api/desktop/yootun/'))
  assert.equal(manifest.name, `@dofe/${PLUGIN_DIR}`)
})
