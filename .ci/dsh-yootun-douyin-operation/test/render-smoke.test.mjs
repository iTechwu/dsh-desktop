// 渲染冒烟回归：构建产物工厂在真 React 下执行 apply，并用 react-dom/server
// 真实渲染 shell.overlay 组件（Overlay 主视图）。
//
// 背景：2026-09-23 真机故障——「爆款拆解 Tab 进入」useEffect 的依赖数组在
// 渲染期求值，前向引用了其后才声明的 loadBdRules/loadBdHistory（const 无
// 提升，TDZ ReferenceError），整个 Overlay 渲染即崩、插件页打不开。既有的
// 源码正则断言与 vm 求值测试都不真正渲染 React 树，抓不到这类错误；本测试
// 用真实 renderToString 兜住「渲染期崩溃」整类问题。
//
// TDZ 特性保证了关闭态渲染同样覆盖崩点：useEffect 依赖数组无条件求值，
// 与 overlay 是否可见、当前处于哪个 Tab 无关。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('built client factory renders the overlay with real React without throwing', async () => {
  const react = await import('react')
  const React = react.default ?? react
  const { renderToString } = await import('react-dom/server')

  // 宿主全局最小 stub：模块顶层与 apply 的 effect 回调只触及其中的事件与存储面。
  const listeners = new Map()
  globalThis.window = {
    __ModuleLoader__: { load(mod) { globalThis.__renderSmokeModule = mod } },
    addEventListener: (type, fn) => { listeners.set(type, fn) },
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type) },
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1' },
    navigator: { language: 'zh-CN' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  }
  globalThis.CustomEvent = class CustomEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts) } }
  globalThis.document = {
    createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, textContent: '' }),
    body: { appendChild() {}, removeChild() {} },
    head: { appendChild() {} },
  }
  globalThis.fetch = async () => ({ ok: false, status: 0, json: async () => ({}) })

  try {
    const built = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    new Function(built)()
    const mod = globalThis.__renderSmokeModule
    assert.ok(mod, '构建产物应注册 __ModuleLoader__ 模块')

    const anyComp = () => null
    const lazyStub = () => new Proxy(function () {}, {
      get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : anyComp),
      apply: () => null,
    })
    const fakeRequire = id => (id === 'react' ? React : lazyStub())
    const plugin = mod.factory(fakeRequire)

    let overlay = null
    const ctx = {
      locale: Object.assign(key => 'zh-CN', { bind: () => key => key, register: () => {} }),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      effect: fn => { const dispose = fn(); return typeof dispose === 'function' ? dispose : undefined },
      webServer: { register: () => {} },
      slots: {
        inject: (_slot, register) => { register() },
        register: (entry, component) => { if (entry.name === 'shell.overlay') overlay = component },
      },
    }
    plugin.apply(ctx)
    assert.equal(typeof overlay, 'function', 'apply 应向 shell.overlay 槽位注册 Overlay 组件')

    // 不抛错即通过：渲染输出长度不作为断言（overlay 初始为关闭态，输出可为空）。
    renderToString(React.createElement(overlay, { t: key => key }))

    // BatchPanel 三态真实渲染（批量 collecting / probing / 终态 partial）：关闭态
    // Overlay 中 batch 为 null，该组件分支不被上面那条覆盖，这里直接渲染补盲区。
    const accounts = [{ accountId: 'acc-1', nickname: '账号一' }]
    const collecting = {
      batchId: 'batch-1', status: 'running', phase: 'collecting', currentAccountId: 'acc-1',
      total: 2, runnableTotal: 2, runnableDone: 1, probedCount: 2,
      completedCount: 1, failedCount: 0, skippedCount: 0,
      items: [
        { accountId: 'acc-1', status: 'running', reason: null },
        { accountId: 'acc-2', status: 'queued', reason: null },
      ],
    }
    renderToString(React.createElement(plugin.BatchPanel, {
      batch: collecting,
      batchCollect: { status: 'running', progress: { phase: 'work', index: 3, total: 12 } },
      accounts, t: key => key,
    }))
    renderToString(React.createElement(plugin.BatchPanel, {
      batch: { ...collecting, phase: 'probing', runnableDone: 0, completedCount: 0 },
      batchCollect: null, accounts, t: key => key,
    }))
    renderToString(React.createElement(plugin.BatchPanel, {
      batch: {
        batchId: 'batch-1', status: 'partial', total: 3, runnableTotal: 2, runnableDone: 2,
        probedCount: 2, completedCount: 1, failedCount: 1, skippedCount: 1,
        items: [
          { accountId: 'acc-1', status: 'completed', reason: null },
          { accountId: 'acc-2', status: 'failed', reason: 'NETWORK_ERROR' },
          { accountId: 'acc-0', status: 'skipped', reason: 'session_required' },
        ],
      },
      batchCollect: null, accounts, t: key => key,
    }))

    // MaterialPage 看板区 DOM 顺序断言（2026-10-29 布局拍板：筛选置顶、KPI 在下，
    // 终审 P3-①）。真实 renderToString 后按标记文本首次出现位置比较。
    const pageHtml = renderToString(React.createElement(plugin.MaterialPage, {
      board: { rows: [], total: 0, offset: 0, limit: 20, loading: false, errorReason: null, loaded: true },
      kpi: null, facets: null, filters: {}, seedAccounts: [],
      seeds: {
        data: {
          keywords: [{ seedId: 'ks-1', keyword: '增程车', status: 'active' }, { seedId: 'ks-2', keyword: '露营', status: 'active' }],
          accounts: [{ accountSeedId: 'as-1', displayName: '账号A', status: 'active' }],
        },
        loading: false, errorReason: null,
      },
      runs: null, activeRun: null, collecting: false,
      reason: null, seedModal: null, collectOpen: false, collectError: null, failure: null,
      savingSeed: false, seedError: null, runFilter: 'batch-x', actions: {},
    }))
    const filterIdx = pageHtml.indexOf('搜索标题 / 作者 / 关键词')
    const runFilterIdx = pageHtml.indexOf('按批次过滤')
    const kpiIdx = pageHtml.indexOf('候选素材')
    assert.ok(filterIdx > -1 && runFilterIdx > -1 && kpiIdx > -1, '看板区三类区块均应渲染')
    assert.ok(filterIdx < runFilterIdx, '批次过滤横幅应紧随筛选条')
    assert.ok(runFilterIdx < kpiIdx, '筛选区必须位于 KPI 区上方（拍板布局，文档 §6.4 结构图同口径）')
    // 子页签定稿（2026-10-29 真机验收）：四子页下划线式、置于页头下方；
    // 关键词管理与对标账号是两个独立子页（对齐 UI 模板/静态测试页），
    // 计数徽标在种子数据加载后展示。
    for (const marker of ['>素材看板</button>', '>关键词管理<span', '>对标账号<span', '>采集记录</button>']) {
      assert.ok(pageHtml.includes(marker), `缺少子页签 ${marker}`)
    }
    const tabsIdx = pageHtml.indexOf('ydo-mat-tabs')
    assert.ok(tabsIdx > -1 && tabsIdx < filterIdx, '子页签导航应在内容区（筛选条）之前')
    assert.ok(!pageHtml.includes('ydo-mat-seg'), '旧分段控件应已移除')
    assert.ok(pageHtml.includes('>关键词管理<span class="ydo-mat-tab-count">2</span>'), '关键词页签计数应为 2')
    assert.ok(pageHtml.includes('>对标账号<span class="ydo-mat-tab-count">1</span>'), '对标账号页签计数应为 1')
    // 成功态下默认 board 页不应渲染任何错误条（keywords/accounts 的 seeds 错误条
    // 由条件渲染隔离在各自子页，接线断言见 material-ui.test.mjs）。
    assert.ok(!pageHtml.includes('ydo-mat-error'), '成功态看板页不应出现错误条')
  } finally {
    delete globalThis.__renderSmokeModule
    delete globalThis.window
    delete globalThis.CustomEvent
    delete globalThis.document
    delete globalThis.fetch
  }
})
