import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// RQ-2026-003 DEV-06：车衣爆款看板 hub 状态机单测 + 真实 React 渲染冒烟。
// hub 是纯逻辑状态机（依赖注入 post/schedule），渲染冒烟兜住「渲染期崩溃」
// 整类问题（对齐 douyin 插件 render-smoke 的 TDZ 回归教训）。

function loadClient(source, hotboardSource) {
  // 与 scripts/build.mjs 同法：剥 import 行；hotboard-ui 剥 export 与顶部
  // HotReact require / h 解构两行（内联后 h 由 client.js 声明，避免重复声明）。
  source = source.replace(/^import[^\n]*from '\.\/hotboard-ui\.js'\n/m, '')
  const hotboard = hotboardSource
    .replace(/^const HotReact = require\('react'\)\n/m, '')
    .replace(/^const \{ createElement: h \} = HotReact\n/m, '')
    .replace(/^export /gm, '')
  source = `${hotboard}\n${source}`
  const module = { exports: {} }
  const require = name => {
    if (name === 'react') return { createElement: () => ({}), useEffect: () => {}, useState: () => [undefined, () => {}], useSyncExternalStore: () => undefined }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconCloseOutlineRegular: {}, IconEditOutlineRegular: {}, MarkdownText: {}, Tooltip: {} }
    throw new Error(`unexpected require: ${name}`)
  }
  const window = {}
  const document = {}
  new Function('require', 'module', 'exports', 'window', 'document', source)(require, module, module.exports, window, document)
  return module.exports
}

const { createHotboardHub } = loadClient(
  await readFile(new URL('../src/client.js', import.meta.url), 'utf8'),
  await readFile(new URL('../src/hotboard-ui.js', import.meta.url), 'utf8'),
)

// 手动假定时器：schedule 捕获轮询回调，测试里用 fire() 手动推进一轮。
function fakeTimers() {
  let scheduled = null
  return {
    schedule: fn => { scheduled = fn; return 1 },
    clear: () => { scheduled = null },
    fire: async () => { const fn = scheduled; scheduled = null; if (fn) await fn() },
    get pending() { return scheduled !== null },
  }
}

const flush = async (rounds = 6) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)) }

// 受控 post：calls 记录全部请求体；postOverride 先行、返回 undefined 落默认表。
function makeHub({ overview, runGet, post: postOverride } = {}) {
  const timers = fakeTimers()
  const calls = []
  const runGetQueue = Array.isArray(runGet) ? [...runGet] : null
  let boardLoads = 0
  const post = async (body, timeoutMs) => {
    calls.push({ ...body, __timeout: timeoutMs })
    if (postOverride) {
      const custom = await postOverride(body)
      if (custom !== undefined) return custom
    }
    switch (body.action) {
      case 'hotboard.overview': {
        // overview 支持按加载次数变化：模拟 run 落终态后看板 runStatus 清空。
        boardLoads++
        const state = typeof overview === 'function' ? overview(boardLoads) : overview
        return {
          status: 'ready',
          data: {
            kpis: { totalCases: 12 },
            filterOptions: { keywords: [], styles: [], colors: [], noteWords: [], commentWords: [], scoreShortcuts: [], windows: ['7d', '30d', '90d'] },
            runStatus: state?.runStatus ?? null,
            notes: [],
            pagination: { page: 1, pageSize: 20, total: 0 },
          },
          meta: { page: 1, pageSize: 20, total: 0 },
        }
      }
      case 'hotboard.keywords':
        return { status: 'ready', data: { keywords: [] }, meta: { page: 1, pageSize: 20, total: 0 } }
      case 'hotboard.candidates':
        return { status: 'ready', data: { candidates: [] }, meta: { page: 1, pageSize: 20, total: 3 } }
      case 'hotboard.labels':
        return { status: 'ready', data: { labels: [], proposals: [] }, meta: { page: 1, pageSize: 20, total: 2 } }
      case 'hotboard.settings':
        // 2026-10-13 只读化裁决：settings 投影只承载真实生效的展示字段。
        return { status: 'ready', data: { scheduleEnabled: true, fullScheduleCron: '30 1 * * 1', ruleVersion: 'hot-v1-potential' } }
      case 'hotboard.runGet':
        if (runGetQueue && runGetQueue.length) return runGetQueue.shift()
        return { status: 'ready', data: { run: { runId: body.runId, status: 'collecting' } } }
      default:
        return { status: 'ready', data: {} }
    }
  }
  const hub = createHotboardHub({ post, intervalMs: 2000, schedule: timers.schedule, clearSchedule: timers.clear })
  return { hub, calls, timers }
}

const countAction = (calls, action) => calls.filter(call => call.action === action).length

test('init loads board, settings and todo badges; write requests carry confirm and idempotency key', async () => {
  const { hub, calls } = makeHub()
  hub.init()
  await flush()
  assert.equal(hub.get().overview?.data.kpis.totalCases, 12)
  assert.equal(hub.get().settings?.scheduleEnabled, true)
  // 待办徽标来自两个 pageSize=1 请求的 meta.total。
  assert.deepEqual(hub.get().todos, { candidates: 3, proposals: 2 })
  assert.ok(countAction(calls, 'hotboard.candidates') >= 1)
  assert.ok(countAction(calls, 'hotboard.labels') >= 1)
  const badgeCall = calls.find(call => call.action === 'hotboard.candidates' && call.pageSize === 1)
  assert.ok(badgeCall, '待办徽标请求应为 pageSize=1')
  // 确认流：askConfirm → resolveConfirm 执行写操作并清弹窗；写请求必带 confirm + 幂等键。
  hub.askConfirm('确认启动增量采集？', () => { hub.runStart() })
  assert.ok(hub.get().confirm)
  hub.resolveConfirm()
  assert.equal(hub.get().confirm, null)
  await flush()
  const runCall = calls.find(call => call.action === 'hotboard.runStart')
  assert.ok(runCall, '确认后应发出 runStart 请求')
  assert.equal(runCall.confirm, true)
  assert.equal(typeof runCall.idempotencyKey, 'string')
  assert.ok(runCall.idempotencyKey.length >= 8)
})

test('sub-page switches keep filter drafts and page numbers; setFilter resets its own page', async () => {
  const { hub, calls } = makeHub()
  hub.init()
  await flush()
  hub.setFilter('board', 'keyword', '车衣')
  hub.setPage('board', 3)
  await flush()
  hub.setSub('keywords')
  hub.setSub('board')
  // 二级页往返：筛选草稿与页码都保留（UI 状态要求 1/2）。
  assert.equal(hub.get().filters.board.keyword, '车衣')
  assert.equal(hub.get().pages.board, 3)
  assert.equal(hub.get().sub, 'board')
  // setFilter：重置该组页码为 1 并带新筛选重拉。
  hub.setFilter('board', 'sort', 'publishTime')
  await flush()
  assert.equal(hub.get().pages.board, 1)
  const last = calls.filter(call => call.action === 'hotboard.overview').at(-1)
  assert.equal(last.sort, 'publishTime')
  assert.equal(last.page, 1)
  assert.equal(last.keyword, '车衣')
})

test('active run starts polling; stop() halts it and swallows further polls', async () => {
  const { hub, calls, timers } = makeHub({ overview: { runStatus: { runId: 'r-1', status: 'collecting' } } })
  hub.init()
  await flush()
  assert.ok(timers.pending, '活跃 run 应已排入轮询')
  hub.stop()
  assert.equal(timers.pending, false)
  const runGetCalls = countAction(calls, 'hotboard.runGet')
  await timers.fire()
  await flush()
  assert.equal(countAction(calls, 'hotboard.runGet'), runGetCalls, 'stop 后 fire 不应再发 runGet')
})

test('run polling stops at terminal status and refreshes the board', async () => {
  const { hub, calls, timers } = makeHub({
    // 第 1 次加载返回活跃 run（触发轮询）；终态后 refresh 拉到 runStatus=null（不再重挂）。
    overview: n => (n >= 2 ? null : { runStatus: { runId: 'r-2', status: 'collecting' } }),
    runGet: [
      { status: 'ready', data: { run: { runId: 'r-2', status: 'tagging' } } },
      { status: 'ready', data: { run: { runId: 'r-2', status: 'succeeded' } } },
    ],
  })
  hub.init()
  await flush()
  await timers.fire()
  assert.ok(timers.pending, '活跃态（tagging）应继续轮询')
  assert.equal(hub.get().runLive?.run.status, 'tagging')
  const overviewCalls = countAction(calls, 'hotboard.overview')
  await timers.fire()
  await flush()
  assert.equal(timers.pending, false, '终态（succeeded）应停止轮询')
  assert.equal(hub.get().runLive?.run.status, 'succeeded')
  assert.ok(countAction(calls, 'hotboard.overview') > overviewCalls, '终态后应重拉看板 KPI')
})

test('in-flight write disables re-entry; success refreshes todos and shows ok notice', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { hub } = makeHub({
    post: async body => {
      if (body.action === 'hotboard.candidateReview') { await gate; return { status: 'ready', data: { updatedCount: 1 } } }
      return undefined
    },
  })
  hub.init()
  await flush()
  const first = hub.candidateReview('accepted', ['c-1'])
  await flush(2)
  assert.equal(hub.get().pending, 1)
  assert.equal(await hub.candidateReview('accepted', ['c-1']), false, '写操作进行中重复提交应被拒绝')
  assert.equal(hub.get().pending, 1)
  release()
  assert.equal(await first, true)
  assert.equal(hub.get().pending, 0)
  assert.equal(hub.get().notice?.kind, 'ok')
})

test('write failure surfaces the controlled reason and clears pending', async () => {
  // 错误码用 tools 真实存在的冲突码；UI 侧经 HB_ERROR_KEYS 映射为受控文案 key，
  // 不透出原始错误码（review MAJOR-4 / MINOR-5）。
  const { hub } = makeHub({
    post: async body => (body.action === 'hotboard.labelSave' ? { status: 'error', reason: 'XHS_HOTBOARD_LABEL_CONFLICT' } : undefined),
  })
  hub.init()
  await flush()
  assert.equal(await hub.labelSave({ labelId: null, tagType: 'style', code: 'dup', name: '重复' }), false)
  assert.equal(hub.get().pending, 0)
  assert.equal(hub.get().notice?.kind, 'error')
  assert.equal(hub.get().notice?.key, 'hbErrLabelConflict')
})

test('candidateReview with row-level failures swaps to the partial notice with stats', async () => {
  // 批量裁决逐条 results：存在失败时换 hbCandidatesPartial 并带 {failed}/{total}
  // 参数（review MAJOR-3）；全部成功仍走默认成功文案。
  const { hub } = makeHub({
    post: async body => (body.action === 'hotboard.candidateReview'
      // 写响应是平铺信封：projectHotboardWrite 把 results 提到顶层（非 data 内）。
      ? { status: 'ready', results: [{ candidateId: 'c-1', ok: true, errorCode: null }, { candidateId: 'c-2', ok: false, errorCode: 'XHS_HOTBOARD_EVIDENCE_INSUFFICIENT' }] }
      : undefined),
  })
  hub.init()
  await flush()
  assert.equal(await hub.candidateReview('accepted', ['c-1', 'c-2']), true, '有行级失败也算提交成功（不落 error 通道）')
  assert.equal(hub.get().notice?.kind, 'ok')
  assert.equal(hub.get().notice?.key, 'hbCandidatesPartial')
  assert.deepEqual(hub.get().notice?.extra, { failed: 1, total: 2 })
})

test('writes are rejected while the hub is stopped; settings page is read-only', async () => {
  const { hub, calls } = makeHub()
  // 未 init（Overlay 未打开）即拒绝写。
  assert.equal(await hub.keywordSave({ action: 'create', keyword: 'x' }), false)
  hub.init()
  await flush()
  // 2026-10-13 只读化裁决：配置页只读展示生效口径，settings 的编辑状态机
  // （settingsUpdate / setSettingsField / settingsDirty）已整体移除，不再有写入口。
  assert.equal('settingsUpdate' in hub, false)
  assert.equal('setSettingsField' in hub, false)
  assert.equal(hub.get().settingsDirty, undefined)
  assert.equal(hub.get().settings?.scheduleEnabled, true)
  assert.equal(hub.get().settings?.fullScheduleCron, '30 1 * * 1')
  assert.equal(countAction(calls, 'hotboard.settingsUpdate'), 0, '任何路径都不应再发 settingsUpdate')
  // stop 后写操作同样拒绝。
  hub.stop()
  assert.equal(await hub.runStart(), false)
})

test('every hotboard copy key used by the UI is registered in copy.zh and copy.en', async () => {
  // 回归（review 复验 MAJOR-A）：hub 单测只断言 notice.key、渲染冒烟的 t 是
  // 直通，文案漏注册只会在真机提示条上显示裸键名。这里静态提取 hotboard-ui.js
  // 全部 hb* 字符串字面量（t()/tf()/successKey/HB_ERROR_KEYS value 全覆盖），
  // 断言 client.js 里每个 key 至少以 `key:` 形式出现 2 次（zh 与 en 各一次）。
  const ui = await readFile(new URL('../src/hotboard-ui.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const keys = [...new Set([...ui.matchAll(/['"`](hb[A-Z]\w*)['"`]/g)].map(match => match[1]))]
  assert.ok(keys.length >= 40, `提取到 ${keys.length} 个 key，低于预期说明提取器失效`)
  const missing = keys.filter(key => (client.match(new RegExp(`${key}:`, 'g')) || []).length < 2)
  assert.deepEqual(missing, [], `copy.zh / copy.en 缺少注册的 key: ${missing.join(', ')}`)
})

test('write with a non-ready envelope (tool unavailable) fails closed instead of reporting success', async () => {
  // 回归（review 复验 MINOR-B）：宿主在 MCP 工具未部署时返回
  // { status:'unavailable' }；写 executor 此前只判 'error'，会误弹成功提示。
  const { hub } = makeHub({
    post: async body => (body.action === 'hotboard.runStart'
      ? { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' }
      : undefined),
  })
  hub.init()
  await flush()
  assert.equal(await hub.runStart(), false, '非 ready 信封必须按失败处理')
  assert.equal(hub.get().pending, 0)
  assert.equal(hub.get().notice?.kind, 'error')
  assert.equal(hub.get().notice?.key, 'hbWriteFailed', '非白名单 reason 回退通用失败文案')
})

// ---------------------------------------------------------------------------
// 真实 React 渲染冒烟：Overlay 关闭态（构建产物工厂）+ HotboardPage 各页与抽屉。
// ---------------------------------------------------------------------------

test('built client factory renders the overlay and hotboard pages with real React', async () => {
  const react = await import('react')
  const React = react.default ?? react
  const { renderToString } = await import('react-dom/server')

  const listeners = new Map()
  globalThis.window = {
    __ModuleLoader__: { load(mod) { globalThis.__hbSmokeModule = mod } },
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
    // 1) 构建产物工厂 → apply → Overlay 关闭态真实渲染（rewrite 初始分支）。
    const built = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    new Function(built)()
    const mod = globalThis.__hbSmokeModule
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
    renderToString(React.createElement(overlay, { t: key => key }))

    // 2) HotboardPage 沙箱加载（真 React，剥 export 同作用域）+ 各二级页真实渲染。
    let source = await readFile(new URL('../src/hotboard-ui.js', import.meta.url), 'utf8')
    source = source.replace(/^export /gm, '')
    const sandboxModule = { exports: {} }
    const sandboxRequire = name => (name === 'react' ? React : {})
    new Function('require', 'module', 'exports', 'window', 'document',
      `${source}\nmodule.exports.HotboardPage = HotboardPage\nmodule.exports.hotboardCss = hotboardCss`,
    )(sandboxRequire, sandboxModule, sandboxModule.exports, {}, {})
    const { HotboardPage } = sandboxModule.exports
    assert.equal(typeof HotboardPage, 'function')

    const notes = [
      // 对齐 tools hotboard.overview 的 note brief 投影（authorName/publishTime/
      // matchedKeywords/互动计数/retrievedAt/duplicateGroupId）。
      { noteId: 'n-1', title: '案例一', authorName: '作者甲', publishTime: '2026-10-01T00:00:00Z', score: 88.5, coverUrl: 'https://example.com/1.jpg', noteType: 'normal', matchedKeywords: ['车衣'], collectCount: 900, likeCount: 3000, commentCount: 200, shareCount: 100, interactionTotal: 4200, retrievedAt: '2026-10-09T02:00:00Z', duplicateGroupId: null, styleTag: null, colorTag: null },
      { noteId: 'n-2', title: null, authorName: null, publishTime: null, score: null, coverUrl: null, noteType: 'video', matchedKeywords: [], collectCount: 0, likeCount: 0, commentCount: 0, shareCount: 0, interactionTotal: 0, retrievedAt: null, duplicateGroupId: 'dup-abc12345', styleTag: null, colorTag: null },
    ]
    const smokePost = async body => {
      switch (body.action) {
        case 'hotboard.overview':
          return {
            status: 'ready',
            data: {
              kpis: { totalCases: 12, coverageRate: 0.5, duplicateGroupCount: 1, lowQualityCount: 2, aiTaggedRate: 0.3, lastCollectedAt: '2026-10-09T00:00:00Z', nextRun: { scheduleEnabled: true, cron: '0 7 * * *' }, failedKeywordCount: 0 },
              filterOptions: { keywords: [{ keyword: '车衣' }], styles: [{ code: 's-1', name: '简约' }], colors: [{ code: 'c-1', name: '黑' }], noteWords: [], commentWords: [], scoreShortcuts: [], windows: ['7d', '30d', '90d'] },
              runStatus: { runId: 'r-smoke', status: 'collecting' },
              notes,
              pagination: { page: 1, pageSize: 20, total: 2 },
            },
            meta: { page: 1, pageSize: 20, total: 2 },
          }
        case 'hotboard.keywords':
          return { status: 'ready', data: { keywords: [{ keywordId: 'k-1', keyword: '车衣', category: 'product', status: 'active', source: 'built_in', qualifiedCount: 5, updatedAt: '2026-10-01T00:00:00Z' }] }, meta: { page: 1, pageSize: 20, total: 1 } }
        case 'hotboard.candidates':
          return { status: 'ready', data: { candidates: [{ candidateId: 'c-1', keyword: '隐形车衣', category: 'product', status: 'pending', confidence: 0.9, evidenceNoteCount: 3 }] }, meta: { page: 1, pageSize: 20, total: 1 } }
        case 'hotboard.labels':
          return {
            status: 'ready',
            data: {
              labels: [{ labelId: 'l-1', code: 's-1', name: '简约', tagType: 'style', status: 'active', definition: '' }],
              proposals: [{ proposalId: 'p-1', proposedLabel: '运动风', tagType: 'style', confidence: 0.8, evidenceNoteCount: 4, status: 'pending' }],
            },
            meta: { page: 1, pageSize: 20, total: 1 },
          }
        case 'hotboard.settings':
          // 只读化后的生效字段投影。
          return { status: 'ready', data: { scheduleEnabled: true, fullScheduleCron: '30 1 * * 1', ruleVersion: 'hot-v1-potential' } }
        case 'hotboard.noteDetail':
          return {
            status: 'ready',
            data: {
              note: { noteId: 'n-1', title: '案例一', authorName: '作者甲', noteType: 'normal', publishTime: '2026-10-01T00:00:00Z', link: 'https://www.xiaohongshu.com/explore/n-1', body: '正文第一行\n\n#车衣# 改色效果' },
              metrics: { interactionTotal: 5200, collectCount: 800, likeCount: 3000, commentCount: 200, shareCount: 100, score7d: 80, score30d: 75, score90d: 70 },
              currentTags: [{ tagType: 'style', labelCode: 's-1', labelName: '简约' }],
              images: { coverUrl: 'https://example.com/1.jpg', imageUrls: [] },
              similarNotes: [{ noteId: 'n-2', title: '相似案例', coverUrl: 'https://example.com/2.jpg' }],
              wordStats: [{ wordType: 'note', word: '车衣', frequency: 5 }, { wordType: 'comment', word: '好看', frequency: 3 }],
            },
          }
        case 'hotboard.runGet':
          return {
            status: 'ready',
            data: {
              run: { runId: 'r-smoke', runType: 'incremental', triggerType: 'manual', status: 'collecting', startedAt: '2026-10-09T01:00:00Z', finishedAt: null, errorCode: null, activeKeywordCount: 1, successKeywordCount: 1, failedKeywordCount: 0, noResultKeywordCount: 0, collectedNoteCount: 5, qualifiedNoteCount: 3, duplicateNoteCount: 1, lowQualityNoteCount: 1, aiTaggedCount: 2, aiPendingCount: 1, commentCollectedNoteCount: 2, detailCompletedCount: 2, detailFailedCount: 0 },
              deadlineAt: '2026-10-09T01:25:00Z',
              remainingSearchBudget: 50,
              keywordRuns: [{ keyword: '车衣', status: 'success', errorCode: null, collectedCount: 5, qualifiedCount: 3, startedAt: '2026-10-09T01:00:00Z', finishedAt: '2026-10-09T01:01:00Z' }],
              failedKeywords: [],
            },
          }
        default:
          return { status: 'ready', data: {} }
      }
    }
    // 渲染冒烟不真轮询：schedule 只登记不触发（活跃 run 的 setTimeout 自续会
    // 让 node --test 等不到句柄清空而永不退出）。
    const hub = createHotboardHub({ post: smokePost, schedule: () => 0, clearSchedule: () => {} })
    hub.init()
    await flush()
    const render = () => renderToString(React.createElement(HotboardPage, { hub, t: key => key }))

    // 看板页（KPI + Run 状态条 + 11 列案例表），数据直渲可断言（t 为 key 直通，
    // 断言 key 出现即证明对应列/按钮进了渲染树）。
    let output = render()
    assert.ok(output.includes('案例一'), '看板页应渲染案例标题')
    assert.ok(output.includes('hbColCase'), '第一列应为案例列（缩略图列）')
    assert.ok(output.includes('hbColComposite'), '第二列应为综合分列')
    assert.ok(output.includes('hbColViewDetail'), '操作列应渲染「查看详情」按钮')
    assert.ok(output.includes('hbMainRecord'), '重复组列应区分主记录')
    assert.ok(output.includes('hbRunStatusCollecting'), 'Run 状态条应渲染中文状态枚举')
    // 窄容器重排（对齐抖音账号总览表）：主表带 yxh-hb-table-board 限定类，
    // 数据单元格带 role=cell 与 data-label（值=表头 i18n 键），CSS 据此显示字段名。
    assert.ok(output.includes('yxh-hb-table-board'), '案例主表应带窄容器重排限定类')
    assert.ok(output.includes('data-label="hbColCollects"'), '采集列单元格应带 data-label')
    assert.ok(output.includes('data-label="hbColInteraction"'), '互动总量单元格应带 data-label')
    assert.ok(output.includes('data-label="hbColDupGroup"'), '重复组单元格应带 data-label')
    assert.ok((output.match(/data-label="hb/g) || []).length >= 11, '一行 11 个数据单元格都应带 data-label')

    // 案例详情抽屉 + Run 详情抽屉 + 确认弹窗。
    hub.openNote('n-1')
    await flush()
    output = render()
    assert.ok(output.includes('hbOpenNote'), '详情抽屉应渲染醒目外链按钮')
    assert.ok(output.includes('hbNoteImages'), '详情抽屉应渲染笔记图片分区')
    assert.ok(output.includes('hbNoteBody'), '详情抽屉应渲染正文分区')
    hub.closeNote()
    hub.openRun(null)
    await flush()
    output = render()
    assert.ok(output.includes('hbRunTypeIncremental'), 'Run 概要应渲染类型枚举（中文）')
    assert.ok(output.includes('hbRunCounters'), 'Run 详情应渲染执行计数分区')
    hub.closeRun()
    hub.askConfirm('确认启动增量采集？', () => {})
    output = render()
    assert.ok(output.includes('确认启动增量采集？'), '确认弹窗应渲染确认文案')

    // 关键词 / 标签 / 规则三个二级页。
    hub.dismissConfirm()
    hub.setSub('keywords')
    await flush()
    render()
    hub.setSub('tags')
    await flush()
    render()
    hub.setSub('rules')
    await flush()
    render()
  } finally {
    delete globalThis.__hbSmokeModule
    delete globalThis.window
    delete globalThis.CustomEvent
    delete globalThis.document
    delete globalThis.fetch
  }
})

// --- hotboardScheduleText：调度 cron 转业务可读描述 ---

// 纯函数专用 loader：hotboard-ui 的 export 被 loadClient 剥成局部声明，
// 不进 module.exports；这里剥掉顶部 React 依赖后把目标函数显式挂到 exports。
async function loadHotboardFn(name) {
  const src = (await readFile(new URL('../src/hotboard-ui.js', import.meta.url), 'utf8'))
    .replace(/^const HotReact = require\('react'\)\n/m, '')
    .replace(/^const \{ createElement: h \} = HotReact\n/m, '')
    .replace(/^export /gm, '')
  const module = { exports: {} }
  const require = n => {
    if (n === 'react') return { createElement: () => {}, useEffect: () => {}, useState: () => [undefined, () => {}], useSyncExternalStore: () => undefined }
    throw new Error(`unexpected require: ${n}`)
  }
  new Function('require', 'module', 'exports', `${src}\nmodule.exports.${name} = ${name}`)(require, module, module.exports)
  return module.exports[name]
}

test('hotboardScheduleText 把周调度 cron 转成中文描述', async () => {
  const hotboardScheduleText = await loadHotboardFn('hotboardScheduleText')
  const t = key => ({
    hbSchedDaily: '每天',
    hbSchedWeekly: '每周',
    hbDowNames: ['日', '一', '二', '三', '四', '五', '六'],
    hbSchedPeriods: ['凌晨', '上午', '中午', '下午', '晚上'],
  })[key]
  assert.equal(hotboardScheduleText('30 1 * * 1', t), '每周一 凌晨 1:30')
  assert.equal(hotboardScheduleText('0 6 * * *', t), '每天 上午 6:00')
  assert.equal(hotboardScheduleText('15 19 * * 0', t), '每周日 晚上 19:15')
  assert.equal(hotboardScheduleText('5 13 * 5 1', t), '5 13 * 5 1') // 日/月非 * 兜底原表达式
  assert.equal(hotboardScheduleText('*/5 * * * *', t), '*/5 * * * *') // 分钟非具体值兜底
})
