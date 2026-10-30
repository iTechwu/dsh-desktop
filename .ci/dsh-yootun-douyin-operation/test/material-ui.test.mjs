// 爆款素材看板 UI 测试（RQ-2026-008 开发文档 §6.6）。
//
// 渲染方式与 report-ui.test.mjs 同法：剥离 export 后在 vm 上下文求值，
// createElement 返回普通对象树，再递归断言（展示组件均为无 hooks 纯函数；
// SeedModal 含 React.useState，真实渲染由
// render-smoke.test.mjs 兜底，此处只做宿主接线源码契约断言；
// CollectModal/MaterialConfirmDialog/MaterialPage（section 受控提升后）
// 均为无 hooks 纯函数，可直接求值断言）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const materialSource = (await readFile(new URL('../src/material-ui.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '')
const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')

const context = {
  require: name => {
    assert.equal(name, 'react')
    return { createElement: (type, props, ...children) => ({ type, props, children }) }
  },
}
vm.createContext(context)
vm.runInContext(materialSource, context)
const {
  MATERIAL_ERROR_REASON_COPY,
  MATERIAL_CSS_TEXT,
  materialErrorCopy,
  materialStatusPill,
  MaterialKpiCards,
  MaterialFilterBar,
  MaterialBoardTable,
  MaterialReasonDrawer,
  MaterialKeywordsTable,
  MaterialAccountsTable,
  MaterialRunsTable,
  MaterialFailureModal,
  MaterialSeedModal,
  MaterialCollectModal,
  MaterialConfirmDialog,
} = vm.runInContext(
  '({ MATERIAL_ERROR_REASON_COPY, MATERIAL_CSS_TEXT, materialErrorCopy, materialStatusPill, '
  + 'MaterialKpiCards, MaterialFilterBar, MaterialBoardTable, MaterialReasonDrawer, '
  + 'MaterialKeywordsTable, MaterialAccountsTable, MaterialRunsTable, MaterialFailureModal, MaterialSeedModal, '
  + 'MaterialCollectModal, MaterialConfirmDialog })',
  context,
)

const treeText = node => {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(treeText).join('')
  // fake createElement 不执行函数组件：文本断言按需展开一层（展示组件无 hooks）。
  if (typeof node.type === 'function') return treeText(node.type({ ...(node.props || {}) }))
  if (node.children) return treeText(node.children)
  return ''
}

const findAll = (node, className, hits = []) => {
  if (!node || typeof node !== 'object') return hits
  if (Array.isArray(node)) return node.reduce((acc, item) => findAll(item, className, acc), hits)
  if (node.props && node.props.className === className) hits.push(node)
  if (node.children) findAll(node.children, className, hits)
  return hits
}

// 收集全部元素节点（不分 className）：按 props 特征（type/title/disabled）筛选用。
const allNodes = (node, hits = []) => {
  if (!node || typeof node !== 'object') return hits
  if (Array.isArray(node)) return node.reduce((acc, item) => allNodes(item, acc), hits)
  if (node.props) hits.push(node)
  if (node.children) allNodes(node.children, hits)
  return hits
}

const collectOptionValues = node => {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(collectOptionValues)
  const values = node.type === 'option' ? [node.props.value] : []
  const childValues = node.children ? node.children.flatMap(collectOptionValues) : []
  return [...values, ...childValues]
}

// ===========================================================================
// 错误码文案表：宿主 reason 与 tools 稳定码一一对应（§5.8 同法）
// ===========================================================================

test('错误码文案表覆盖宿主 reason 与素材看板稳定码', () => {
  // 宿主 9 个 material handler 可能返回的校验 reason
  for (const reason of [
    'idempotency_key_required', 'INVALID_IDEMPOTENCY_KEY', 'CONFIRMATION_REQUIRED',
    'INVALID_HOMEPAGE_URL', 'INVALID_SORT', 'VALIDATION_ERROR',
  ]) {
    assert.ok(MATERIAL_ERROR_REASON_COPY[reason], `missing host reason ${reason}`)
  }
  // tools 稳定码（tools-client.js ALLOWED_ERROR_CODES 新增 4 个 + 通用码；
  // run 不存在用白名单既有码 ASYNC_RUN_NOT_FOUND，INTERNAL_ERROR/NOT_FOUND
  // 不在白名单且 tools material 域不产出，为死键已移除）
  for (const code of [
    'VIRAL_VIDEO_NO_ACTIVE_SEEDS', 'VIRAL_VIDEO_ACTIVE_RUN_EXISTS',
    'VIRAL_VIDEO_SEED_LIMIT_INVALID', 'VIRAL_VIDEO_SEARCH_DISPATCH_FAILED',
    'ASYNC_RUN_NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_IN_PROGRESS',
    'IDEMPOTENCY_OUTCOME_UNKNOWN', 'ONEAPI_BUDGET_EXHAUSTED', 'PROVIDER_ERROR',
    'douyin_operation_request_failed',
  ]) {
    assert.ok(MATERIAL_ERROR_REASON_COPY[code], `missing stable code ${code}`)
  }
  // 文案无 undefined 空洞
  for (const [key, copy] of Object.entries(MATERIAL_ERROR_REASON_COPY)) {
    assert.equal(typeof copy, 'string', `copy of ${key} must be a string`)
    assert.ok(copy.length > 0)
  }
})

test('materialErrorCopy：登记码命中文案，未登记码收敛为兜底文案', () => {
  assert.equal(materialErrorCopy('ONEAPI_BUDGET_EXHAUSTED'), MATERIAL_ERROR_REASON_COPY.ONEAPI_BUDGET_EXHAUSTED)
  assert.equal(materialErrorCopy('SOME_UNREGISTERED_CODE'), '操作失败，请稍后重试')
})

// ===========================================================================
// 状态徽标与 KPI 五卡（demo renderKpis 口径）
// ===========================================================================

test('materialStatusPill：终态/在途/未知状态映射', () => {
  const completed = materialStatusPill('completed')
  assert.equal(completed.children[0], '已完成')
  assert.match(completed.props.className, /ydo-mat-status-success/u)
  const queued = materialStatusPill('queued')
  assert.equal(queued.children[0], '排队中')
  assert.match(queued.props.className, /ydo-mat-status-muted/u)
  const unknown = materialStatusPill('weird_status')
  assert.equal(unknown.children[0], 'weird_status')
  assert.match(unknown.props.className, /ydo-mat-status-muted/u)
})

test('MaterialKpiCards：候选素材按当前筛选绑定与最新批次投影，全缺失渲染「—」', () => {
  // 全缺失：total/latest 均缺 → 数值卡「—」、脚注「暂无批次/最新批次」
  const empty = treeText(MaterialKpiCards({ kpi: { total: null, latest: null } }))
  assert.match(empty, /候选素材/)
  assert.match(empty, /—/)
  assert.match(empty, /暂无批次/)
  // total 有值 + latest 投影：S 档缺失 A 档 3 →「0 / 3」（demo 同口径：聚合缺桶即 0）
  const latest = {
    runStatus: 'completed', startedAt: '2026-10-28T10:30:00+08:00',
    hotLevelSummary: { A: 3, B: 5 },
    newVideos: 12, discovered: 30, candidatesInserted: 28,
    promotedCandidates: 6, duplicatesSkipped: 2,
  }
  const filled = treeText(MaterialKpiCards({ kpi: { total: 42, latest } }))
  assert.match(filled, /42/)
  // 第三轮真机验收（2026-10-30）：候选素材 KPI 脚注改「按当前筛选」——数值与
  // 看板筛选绑定，随筛选重新绑定（对齐车衣素材看板），不再是素材域累计。
  assert.match(filled, /按当前筛选/)
  assert.ok(!filled.includes('素材域累计'), '累计口径脚注应已移除')
  assert.match(filled, /0 \/ 3/)
  assert.match(filled, /最新批次分布/)
  assert.match(filled, /发现 30 · 入库 28/)
  assert.match(filled, /去重跳过 2/)
  assert.match(filled, /手动采集 · 已完成/)
  // 同日追加拍板：S/A/B/C 档候选与筛选绑定——服务端 hotLevelSummary（同 where
  // 聚合）存在时优先消费，缺桶补 0（无命中 = 0/0/0/0），脚注「按当前筛选」。
  const filtered = treeText(MaterialKpiCards({
    kpi: { total: 7, hotLevelSummary: { B: 2, C: 5 }, latest },
  }))
  assert.match(filtered, /0 \/ 0 \/ 2 \/ 5/)
  assert.match(filtered, /按当前筛选/)
  assert.ok(!filtered.includes('最新批次分布'), '筛选口径存在时档位卡不得回退批次脚注')
  // 空分布（筛选无命中）→ 0/0/0/0，不显示「—」
  const emptyHit = treeText(MaterialKpiCards({
    kpi: { total: 0, hotLevelSummary: {}, latest },
  }))
  assert.match(emptyHit, /0 \/ 0 \/ 0 \/ 0/)
  // 筛选口径存在 + latest 缺失（run 历史加载失败等）→ 档位卡仍走筛选口径，
  // 不因 latest 缺失回退或显示「—」（第四轮 review P3-4 覆盖盲区）
  const noLatest = treeText(MaterialKpiCards({
    kpi: { total: 7, hotLevelSummary: { B: 2, C: 5 }, latest: null },
  }))
  assert.match(noLatest, /0 \/ 0 \/ 2 \/ 5/)
  assert.match(noLatest, /按当前筛选/)
  assert.ok(!noLatest.includes('暂无批次'), '档位卡不因 latest 缺失走暂无批次')
  // 服务端无 hotLevelSummary（旧版兼容）→ 回退批次投影与脚注
  const fallback = treeText(MaterialKpiCards({ kpi: { total: 42, hotLevelSummary: null, latest } }))
  assert.match(fallback, /0 \/ 3/)
  assert.match(fallback, /最新批次分布/)
})

// ===========================================================================
// 筛选条与候选看板表
// ===========================================================================

test('MaterialFilterBar：档位/来源/时间窗/排序选项齐全，标签 facets 注入，无按钮（变化即查）', () => {
  const filters = { q: '增程', minLevel: '', sourceKind: '', publishedRange: '30d', tag: '', sortBy: 'hot' }
  const bar = MaterialFilterBar({
    filters,
    facets: [{ tag: '自驾', count: 4 }, { tag: '露营', count: 2 }],
    onChange: () => {},
  })
  // 2026-10-29 真机验收定稿：筛选条去掉「刷新」按钮，选择条件即查询。
  assert.equal(allNodes(bar).filter(node => node.type === 'button').length, 0)
  const options = collectOptionValues(bar)
  // 档位（全部 + S/A/B/C）
  for (const value of ['', 'S', 'A', 'B', 'C']) assert.ok(options.includes(value), `missing level ${value}`)
  // 来源类型：全部/keyword/account/both
  for (const value of ['', 'keyword', 'account', 'both']) assert.ok(options.includes(value), `missing sourceKind ${value}`)
  // 时间窗：7d/30d/90d/all
  for (const value of ['7d', '30d', '90d', 'all']) assert.ok(options.includes(value), `missing range ${value}`)
  // 排序：9 个值与 tools 契约一致
  for (const value of [
    'hot', 'latest', 'published_at', 'play_count', 'like_count',
    'comment_count', 'share_count', 'collect_count', 'interaction_rate',
  ]) {
    assert.ok(options.includes(value), `missing sort ${value}`)
  }
  // 标签 facets + 全部标签
  for (const value of ['', '自驾', '露营']) assert.ok(options.includes(value), `missing tag ${value}`)
  // 搜索框回显 filters.q
  const input = allNodes(bar).filter(node => node.props.type === 'text')
  assert.equal(input.length, 1)
  assert.equal(input[0].props.value, '增程')
})

test('MaterialBoardTable：候选行渲染真实投影，缺失指标渲染「—」', () => {
  const board = {
    rows: [{
      candidateId: 'cand-1', awemeId: '7123', title: '增程车横评',
      hotScore: 88.5, hotLevel: 'S', scoreRuleVersion: 'hot-v1-potential',
      scoreReasons: ['播放增速 320%', '完播率高于阈值'],
      playCount: 123456, likeCount: 800, commentCount: 60, shareCount: 7,
      collectCount: null, interactionRate: 0.1234,
      publishedAt: '2026-10-20T19:00:00+08:00', tags: null, coverUrl: null,
      sourceMatches: [
        { sourceType: 'keyword_search', keyword: '增程车' },
        { sourceType: 'account_search', accountSeedId: 'as-1' },
      ],
    }],
    total: 1, offset: 0, limit: 20, loading: false, errorReason: null, loaded: true,
  }
  const tree = MaterialBoardTable({
    board,
    seedAccounts: [{ accountSeedId: 'as-1', displayName: '示例账号甲' }],
    onOpenReason: () => {}, onPage: () => {},
  })
  const text = treeText(tree)
  assert.match(text, /增程车横评/)
  // 评分/档位「分数 / 档位」形式
  assert.match(text, /88\.5 \//)
  assert.match(text, /88/)
  assert.match(text, /标签未返回/)
  // 计数列万化口径：123456 → 「12.3万」
  assert.match(text, /12\.3万/)
  assert.doesNotMatch(text, /123,456/)
  assert.match(text, /12\.34%/)
  assert.match(text, /2026-10-20/)
  assert.match(text, /关键词：增程车/)
  assert.match(text, /对标账号：示例账号甲/)
  assert.match(text, /评分理由/)
  assert.match(text, /共 1 条 · 第 1 \/ 1 页/)
  // NULL 指标：收藏缺失渲染「—」而不是 0
  assert.match(text, /—/)
  // S 档徽标：「分数 / 档位」形式（fake 树下 treeText 丢弃 span 边界空格，故斜杠后空格可选）
  assert.match(text, /88\.5 \/ ?S/)
})

test('MaterialBoardTable：封面 onError 降级为真实 DOM 占位块（终审 P2-1）', () => {
  // 回归锁定：onError 里必须用 ownerDocument.createElement 创建真实 DOM——
  // replaceWith(React element) 会抛 TypeError（元素对象不是 Node）。
  const board = {
    rows: [{
      candidateId: 'cand-1', awemeId: '7123', title: '封面加载失败行',
      hotScore: 66, hotLevel: null, scoreRuleVersion: 'hot-v1-potential', scoreReasons: [],
      playCount: 1000, likeCount: 10, commentCount: 1, shareCount: 0, collectCount: 2,
      interactionRate: 0.013, publishedAt: null, tags: null, coverUrl: 'https://img.example/broken.jpg',
      sourceMatches: [],
    }],
    total: 1, offset: 0, limit: 20, loading: false, errorReason: null, loaded: true,
  }
  const tree = MaterialBoardTable({ board, seedAccounts: [], onOpenReason: () => {}, onPage: () => {} })
  // fake createElement 不展开 BoardRow：先手动展开一层行组件再查找
  const rowNodes = []
  ;(function walk(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node.type === 'function') rowNodes.push(node)
    if (node.children) walk(node.children)
  })(tree)
  const imgs = rowNodes.flatMap(node => findAll(node.type({ ...(node.props || {}) }), 'ydo-mat-cover'))
  assert.equal(imgs.length, 1)
  const img = imgs[0]
  assert.equal(img.props.src, 'https://img.example/broken.jpg')
  assert.equal(typeof img.props.onError, 'function')
  // stub DOM：replaceWith 记录入参，createElement 产可辨识的普通对象
  const calls = []
  const docStub = { createElement: tag => ({ tagName: tag, className: '', textContent: '' }) }
  const replacedWith = []
  const event = {
    currentTarget: {
      ownerDocument: docStub,
      parentElement: {},
      replaceWith: node => { replacedWith.push(node) },
    },
  }
  img.props.onError(event)
  assert.equal(replacedWith.length, 1)
  const placeholder = replacedWith[0]
  // 占位块是真实 DOM 形状的普通对象，不是 React 元素（无 type/props）
  assert.equal(placeholder.className, 'ydo-mat-cover-placeholder')
  assert.equal(placeholder.textContent, '—')
  assert.equal(placeholder.tagName, 'div')
  assert.equal(placeholder.type, undefined)
  assert.equal(placeholder.props, undefined)
  // ownerDocument/parentElement 缺失时静默返回，不抛错、不替换
  assert.doesNotThrow(() => img.props.onError({
    currentTarget: { ownerDocument: null, parentElement: null, replaceWith: node => calls.push(node) },
  }))
  assert.equal(calls.length, 0)
})

// 展开表格内层行组件（fake createElement 不执行函数组件，同封面测试手法）。
const expandRows = tree => {
  const rowTrees = []
  ;(function walk(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node.type === 'function') rowTrees.push(node.type({ ...(node.props || {}) }))
    if (node.children) walk(node.children)
  })(tree)
  return rowTrees
}

test('MaterialBoardTable：视频标题带 shareUrl 渲染为打开链接按钮，来源列用独立占位类（真机验收问题 2/6）', () => {
  const board = {
    rows: [{
      candidateId: 'cand-1', awemeId: '7123', title: '增程车横评',
      hotScore: 88, hotLevel: 'S', scoreRuleVersion: 'hot-v1-potential', scoreReasons: [],
      shareUrl: 'https://v.douyin.com/abc/',
      sourceMatches: [],
    }],
    total: 1, offset: 0, limit: 20, loading: false, errorReason: null, loaded: true,
  }
  const tree = MaterialBoardTable({ board, seedAccounts: [], onOpenReason: () => {}, onPage: () => {} })
  const rowTrees = expandRows(tree)
  assert.ok(rowTrees.length > 0, '行组件应可展开')
  const allRowNodes = rowTrees.flatMap(rowTree => allNodes(rowTree))
  // 标题是 button（点击经宿主 window.open → 系统浏览器），不是纯文本/裸链接
  const titleButtons = allRowNodes.filter(node =>
    node.type === 'button' && node.props.className === 'ydo-mat-video-title')
  assert.equal(titleButtons.length, 1, '带 shareUrl 的标题应渲染为链接按钮')
  assert.equal(titleButtons[0].props.title, '在浏览器中打开作品页')
  assert.equal(typeof titleButtons[0].props.onClick, 'function')
  // 来源列占位/标签用独立 ydo-mat-source-tag，不得复用行按钮基类 ydo-mat-mini
  // （旧实现同名类后置覆盖按钮字色——真机验收问题 2 的启用按钮变灰根因）
  const miniSpans = allRowNodes.filter(node =>
    node.type === 'span' && String(node.props.className || '') === 'ydo-mat-mini')
  assert.equal(miniSpans.length, 0, '来源列不得使用 ydo-mat-mini 类名')
  // 无 shareUrl 回退纯文本标题
  const plainNodes = expandRows(MaterialBoardTable({
    board: { ...board, rows: [{ ...board.rows[0], shareUrl: null }] },
    seedAccounts: [], onOpenReason: () => {}, onPage: () => {},
  })).flatMap(rowTree => allNodes(rowTree))
  assert.equal(
    plainNodes.filter(node => node.type === 'button' && node.props.className === 'ydo-mat-video-title').length,
    0, '无 shareUrl 时标题不应是按钮')
})

test('MaterialReasonDrawer：视频链接行用作品标题按钮打开（真机验收问题 6）', () => {
  const drawer = MaterialReasonDrawer({
    row: {
      title: '测试视频', hotScore: 90, hotLevel: 'S', scoreRuleVersion: 'hot-v1-potential',
      shareUrl: 'https://v.douyin.com/abc/', scoreReasons: ['理由一'],
    },
    onClose: () => {},
  })
  const linkButtons = allNodes(drawer).filter(node =>
    node.type === 'button' && String(node.props.className || '').includes('ydo-mat-link'))
  assert.equal(linkButtons.length, 1, '视频链接行应是单个标题按钮')
  assert.equal(typeof linkButtons[0].props.onClick, 'function')
  // 高度覆盖走修饰类而非内联 style（review P3：保持 MATERIAL_CSS_TEXT 可断言）
  assert.ok(
    String(linkButtons[0].props.className || '').includes('ydo-mat-link-wrap'),
    '抽屉视频链接按钮应带 ydo-mat-link-wrap 修饰类',
  )
  // 按钮文本是作品标题，不是裸 URL
  assert.equal(treeText(linkButtons[0]), '测试视频')
  // 无 shareUrl 渲染「—」
  const plain = treeText(MaterialReasonDrawer({
    row: { title: 'x', scoreReasons: [] }, onClose: () => {},
  }))
  assert.match(plain, /视频链接/)
})

test('MaterialCollectModal：纯确认式（静态页同款），无输入字段，确认无参回调（真机验收问题 4）', () => {
  const opened = MaterialCollectModal({
    open: true, activeKeywords: 3, activeAccounts: 2,
    busy: false, errorReason: null, onConfirm: () => {}, onClose: () => {},
  })
  const text = treeText(opened)
  assert.match(text, /确认手动采集/)
  assert.match(text, /将读取当前启用的关键词和对标账号，并创建异步采集任务。/)
  // 三格只读 meta：启用关键词/启用对标账号/预计任务数（3+2=5）
  assert.match(text, /启用关键词/)
  assert.match(text, /启用对标账号/)
  assert.match(text, /预计任务数/)
  assert.match(text, /5/)
  // 警告文案与静态页一致
  assert.match(text, /手动采集会调用外部数据服务。单个 seed 失败不会中断本轮其他任务；不会自动触发下载、归档或爆款拆解。/)
  // 旧弹框三输入（数量上限×2/最低档位）已删——插件不透出采集参数
  assert.doesNotMatch(text, /数量上限/)
  assert.doesNotMatch(text, /最低档位/)
  assert.doesNotMatch(text, /按优先级 P1→P5/)
  // 确认按钮无参回调
  let confirmArgs
  const confirmTree = MaterialCollectModal({
    open: true, activeKeywords: 1, activeAccounts: 1,
    busy: false, errorReason: null, onConfirm: (...args) => { confirmArgs = args }, onClose: () => {},
  })
  // fake 树外层是 CollectModal 函数节点：先展开一层再找按钮
  const confirmInner = confirmTree.type({ ...confirmTree.props })
  const confirmButton = allNodes(confirmInner).find(node =>
    node.type === 'button' && node.props.className === 'ydo-mat-primary')
  assert.ok(confirmButton, '确认采集按钮应存在')
  confirmButton.props.onClick()
  assert.ok(Array.isArray(confirmArgs) && confirmArgs.length === 0, '确认回调必须无参调用')
  // 种子未加载：三格显示「—」而非 0（不造数）
  const pending = treeText(MaterialCollectModal({
    open: true, activeKeywords: null, activeAccounts: null,
    busy: false, errorReason: null, onConfirm: () => {}, onClose: () => {},
  }))
  assert.match(pending, /—/)
  assert.doesNotMatch(pending, /预计任务数0/)
  // 关闭态短路
  assert.equal(MaterialCollectModal({ open: false }), null)
})

test('MaterialAccountsTable：副标题定稿文案（真机验收问题 7）', () => {
  const text = treeText(MaterialAccountsTable({ rows: [], onAdd: () => {}, onEdit: () => {}, onToggle: () => {} }))
  assert.match(text, /支持抖音号、主页链接或 sec_user_id；解析失败不阻断其他账号。/)
  assert.doesNotMatch(text, /三种输入/)
  assert.doesNotMatch(text, /解析由服务端异步完成/)
})

test('MaterialBoardTable：空态引导与加载中文案互斥', () => {
  const loaded = treeText(MaterialBoardTable({
    board: { rows: [], total: 0, offset: 0, limit: 20, loading: false, errorReason: null, loaded: true },
    seedAccounts: [], onOpenReason: () => {}, onPage: () => {},
  }))
  assert.match(loaded, /暂无素材候选/)
  const loading = treeText(MaterialBoardTable({
    board: { rows: [], total: null, offset: 0, limit: 20, loading: true, errorReason: null, loaded: false },
    seedAccounts: [], onOpenReason: () => {}, onPage: () => {},
  }))
  assert.match(loading, /素材候选加载中/)
  const error = treeText(MaterialBoardTable({
    board: { rows: [], total: null, offset: 0, limit: 20, loading: false, errorReason: 'ONEAPI_BUDGET_EXHAUSTED', loaded: true },
    seedAccounts: [], onOpenReason: () => {}, onPage: () => {},
  }))
  assert.match(error, /搜索额度已用完/)
})

test('MaterialReasonDrawer：评分理由逐条列表，空理由给明确提示', () => {
  const drawer = MaterialReasonDrawer({
    row: {
      title: '测试视频', hotScore: 90, hotLevel: 'S', scoreRuleVersion: 'hot-v1-potential',
      publishedAt: '2026-10-20', shareUrl: 'https://v.douyin.com/abc/',
      scoreReasons: ['理由一', '理由二'],
    },
    onClose: () => {},
  })
  const text = treeText(drawer)
  assert.match(text, /命中理由（2）/)
  assert.match(text, /理由一/)
  assert.match(text, /理由二/)
  // 规则版本中文展示口径
  assert.match(text, /热度评分规则 v1（含潜力作品）/)
  const empty = treeText(MaterialReasonDrawer({
    row: { title: 'x', scoreReasons: [] }, onClose: () => {},
  }))
  assert.match(empty, /没有评分理由明细/)
})

// ===========================================================================
// 种子管理两表
// ===========================================================================

test('MaterialKeywordsTable：行渲染 + 启用/禁用与空态', () => {
  const rows = [{
    seedId: 'ks-1', keyword: '增程车', category: 'other', priority: 'P2',
    status: 'active', dailyLimit: 5, searchCount: 12,
    lastReviewedAt: null, createdAt: '2026-10-28T09:00:00+08:00', updatedAt: '2026-10-28T09:30:00+08:00',
  }]
  const tree = MaterialKeywordsTable({ rows, onAdd: () => {}, onEdit: () => {}, onToggle: () => {} })
  const text = treeText(tree)
  // 区块标题「关键词种子（N）」已删（与子页签重复，真机验收问题 1）；
  // 副标题改为采集口径说明。
  assert.doesNotMatch(text, /关键词种子（/)
  assert.match(text, /禁用后不参与下一轮手动采集；历史 run 仍可追溯。/)
  assert.doesNotMatch(text, /分类由服务端维护/)
  assert.match(text, /增程车/)
  assert.match(text, /启用/)
  assert.match(text, /P2/)
  assert.match(text, /2026-10-28 09:30/)
  const empty = treeText(MaterialKeywordsTable({ rows: [], onAdd: () => {}, onEdit: () => {}, onToggle: () => {} }))
  assert.match(empty, /暂无关键词种子/)
})

test('MaterialAccountsTable：解析状态徽标与解析失败提示', () => {
  const rows = [
    {
      accountSeedId: 'as-1', platform: 'douyin', displayName: '示例账号甲',
      inputForm: 'douyin_id', inputValue: 'example-a', resolved: false,
      verificationStatus: 'pending', status: 'active', maxVideos: null,
      lastContentFetchedAt: null, lastResolutionError: null,
      createdAt: null, updatedAt: null,
    },
    {
      accountSeedId: 'as-2', platform: 'douyin', displayName: '示例账号乙',
      inputForm: 'homepage_url', inputValue: 'https://www.douyin.com/user/x',
      resolved: false, verificationStatus: 'resolution_failed', status: 'disabled',
      maxVideos: 10, lastContentFetchedAt: '2026-10-27T20:00:00+08:00',
      lastResolutionError: { reason: 'profile_not_found' },
      createdAt: null, updatedAt: null,
    },
  ]
  const tree = MaterialAccountsTable({ rows, onAdd: () => {}, onEdit: () => {}, onToggle: () => {} })
  const text = treeText(tree)
  assert.match(text, /未解析/)
  assert.match(text, /解析失败/)
  assert.equal(/已解析/.test(text), false)
  assert.match(text, /抖音号/)
  assert.match(text, /主页链接/)
  assert.match(text, /2026-10-27 20:00/)
  // 显示名/账号输入 td 自带全文 title（两行省略提示）；行级解析失败 title 唯一
  const failedRowTitle = allNodes(tree).map(node => node.props && node.props.title)
    .filter(title => typeof title === 'string' && title.includes('profile_not_found'))
  assert.equal(failedRowTitle.length, 1)
})

// ===========================================================================
// 采集记录与失败明细
// ===========================================================================

test('MaterialRunsTable：run 行真实投影，分布缺失渲染「—」，失败明细按钮条件渲染', () => {
  const rows = [
    {
      runId: 'vv-mat-r1', runStatus: 'completed', startedAt: '2026-10-28T10:00:00+08:00',
      finishedAt: '2026-10-28T10:05:00+08:00', durationSeconds: 300,
      keywordCount: 8, accountCount: 2, plannedJobs: 10, selectedJobs: 10,
      succeededJobs: 9, failedJobs: 1, failedKeywords: ['冷门词'], failedAccounts: [],
      discovered: 40, newVideos: 20, candidatesInserted: 18,
      promotedCandidates: 5, duplicatesSkipped: 3,
      hotLevelSummary: { S: 1, A: 4 },
    },
    {
      runId: 'vv-mat-r2', runStatus: 'running', startedAt: '2026-10-28T11:00:00+08:00',
      finishedAt: null, durationSeconds: null,
      keywordCount: null, accountCount: null, plannedJobs: null, selectedJobs: null,
      succeededJobs: null, failedJobs: null, failedKeywords: [], failedAccounts: [],
      discovered: null, newVideos: null, candidatesInserted: null,
      promotedCandidates: null, duplicatesSkipped: null,
      hotLevelSummary: {},
    },
  ]
  const tree = MaterialRunsTable({
    runs: rows, activeRun: null, collecting: false, errorReason: null,
    onStartCollect: () => {}, onViewBoard: () => {}, onOpenFailure: () => {}, onRefresh: () => {},
  })
  const text = treeText(tree)
  assert.match(text, /已完成/)
  assert.match(text, /进行中/)
  assert.match(text, /5分0秒/)
  assert.match(text, /9 \/ 1/)
  assert.match(text, /20 \/ 5/)
  assert.match(text, /S 1 · A 4 · B — · C —/)
  assert.match(text, /失败明细/)
  assert.match(text, /查看看板/)
  // 采集记录按钮态：无 activeRun 且非提交中 →「立即采集」可点
  assert.match(text, /立即采集/)
})

test('MaterialRunsTable：activeRun 横幅渲染，立即采集禁用', () => {
  const tree = MaterialRunsTable({
    runs: [], activeRun: { runId: 'vv-mat-r9', status: 'running', startedAt: '2026-10-28T11:00:00+08:00' },
    collecting: false, errorReason: null,
    onStartCollect: () => {}, onViewBoard: () => {}, onOpenFailure: () => {}, onRefresh: () => {},
  })
  const text = treeText(tree)
  assert.match(text, /采集任务进行中/)
  // 真机验收问题 4：「查看本批候选」→「查看看板」（批次过滤已移除）
  assert.match(text, /查看看板/)
  assert.doesNotMatch(text, /查看本批候选/)
  // 状态徽标是 React 元素：禁止嵌入模板字符串渲染成 [object Object]（截图验收 2026-10-29 回归）
  assert.doesNotMatch(text, /\[object Object\]/)
  assert.match(text, /进行中/)
  // 立即采集按钮 disabled：activeRun 非空
  const disabled = allNodes(tree).filter(node => node.props.disabled === true)
  assert.ok(disabled.some(node => treeText(node).includes('立即采集')), 'activeRun 非空时立即采集必须禁用')
})

test('MaterialFailureModal：失败关键词/账号两列渲染，空明细给提示', () => {
  const tree = MaterialFailureModal({
    run: { runId: 'vv-mat-r1', failedKeywords: ['词一', '词二'], failedAccounts: ['账号丙'] },
    onClose: () => {},
  })
  const text = treeText(tree)
  assert.match(text, /失败关键词（2）/)
  assert.match(text, /词一、词二/)
  assert.match(text, /失败账号（1）/)
  assert.match(text, /账号丙/)
  const empty = treeText(MaterialFailureModal({ run: { runId: 'r', failedKeywords: [], failedAccounts: [] }, onClose: () => {} }))
  assert.match(empty, /没有失败明细/)
})

test('MaterialRunsTable：失败明细按钮三条件，failed 无候选隐藏查看看板', () => {
  const rows = [
    // run 级失败且零候选：「失败明细」必须可诊断，「查看看板」隐藏（无可看内容）
    {
      runId: 'vv-mat-f1', runStatus: 'failed', startedAt: '2026-10-28T10:00:00+08:00',
      finishedAt: '2026-10-28T10:01:00+08:00', durationSeconds: 60,
      succeededJobs: 0, failedJobs: 2, failedKeywords: [], failedAccounts: [],
      candidatesInserted: 0, hotLevelSummary: {},
    },
    // 部分失败：两按钮齐全
    {
      runId: 'vv-mat-f2', runStatus: 'partial_failed', startedAt: '2026-10-28T11:00:00+08:00',
      finishedAt: '2026-10-28T11:03:00+08:00', durationSeconds: 180,
      succeededJobs: 8, failedJobs: 1, failedKeywords: ['冷门词'], failedAccounts: [],
      candidatesInserted: 6, hotLevelSummary: { A: 2 },
    },
    // 成功且无失败：无「失败明细」，只有「查看看板」
    {
      runId: 'vv-mat-f3', runStatus: 'completed', startedAt: '2026-10-28T12:00:00+08:00',
      finishedAt: '2026-10-28T12:04:00+08:00', durationSeconds: 240,
      succeededJobs: 10, failedJobs: 0, failedKeywords: [], failedAccounts: [],
      candidatesInserted: 12, hotLevelSummary: { S: 1 },
    },
  ]
  const tree = MaterialRunsTable({
    runs: rows, activeRun: null, collecting: false, errorReason: null,
    onStartCollect: () => {}, onViewBoard: () => {}, onOpenFailure: () => {}, onRefresh: () => {},
  })
  const rowsById = new Map()
  for (const node of allNodes(tree)) {
    if (node.type === 'tr' && node.props && typeof node.props.key === 'string') {
      rowsById.set(node.props.key, treeText(node))
    }
  }
  const f1 = rowsById.get('vv-mat-f1')
  const f2 = rowsById.get('vv-mat-f2')
  const f3 = rowsById.get('vv-mat-f3')
  assert.ok(f1 && f2 && f3, '三个 run 行都应渲染')
  assert.match(f1, /失败明细/)
  assert.doesNotMatch(f1, /查看看板/, 'failed 且零候选必须隐藏「查看看板」')
  assert.match(f2, /失败明细/)
  assert.match(f2, /查看看板/)
  assert.doesNotMatch(f3, /失败明细/)
  assert.match(f3, /查看看板/)
})

test('MaterialFailureModal：runError 透出失败原因，failed 无种子级明细给任务层提示', () => {
  const text = treeText(MaterialFailureModal({
    run: {
      runId: 'vv-mat-f1', runStatus: 'failed',
      runError: { code: 'MATERIAL_RUN_FAILED', message: '采集执行失败，请重新提交。' },
      failedKeywords: [], failedAccounts: [],
    },
    onClose: () => {},
  }))
  assert.match(text, /失败原因/)
  assert.match(text, /MATERIAL_RUN_FAILED：采集执行失败，请重新提交。/)
  assert.match(text, /该批次在任务执行层面失败，没有种子级失败明细/)
  // 成功/正常 run 不出现失败原因行
  const plain = treeText(MaterialFailureModal({
    run: { runId: 'r2', failedKeywords: [], failedAccounts: [] }, onClose: () => {},
  }))
  assert.doesNotMatch(plain, /失败原因/)
})

test('MaterialKeywordsTable：日上限列不渲染、单轮搜索列头（审查 P2-7 + 列头拍板）', () => {
  const rows = [{
    seedId: 'ks-1', keyword: '增程车', category: 'other', priority: 'P2',
    status: 'active', dailyLimit: 5, searchCount: 12,
    lastReviewedAt: null, createdAt: null, updatedAt: '2026-10-28T09:30:00+08:00',
  }]
  const text = treeText(MaterialKeywordsTable({ rows, onAdd: () => {}, onEdit: () => {}, onToggle: () => {} }))
  // P2-7 拍板：dailyLimit 不参与调度，前端不展示——即使行数据带该字段也不渲染
  assert.doesNotMatch(text, /日上限/)
  // 拍板⑥：列头「累计搜索」→「单轮搜索」
  assert.match(text, /单轮搜索/)
  assert.doesNotMatch(text, /累计搜索/)
})

test('MaterialRunsTable：区块标题删除、副标题定稿文案（真机验收问题 1/4）', () => {
  const rows = [
    { runId: 'vv-mat-t1', runStatus: 'completed', startedAt: '2026-10-28T10:00:00+08:00', hotLevelSummary: {} },
    { runId: 'vv-mat-t2', runStatus: 'completed', startedAt: '2026-10-28T09:00:00+08:00', hotLevelSummary: {} },
  ]
  const text = treeText(MaterialRunsTable({
    runs: rows, activeRun: null, collecting: false, errorReason: null,
    onStartCollect: () => {}, onViewBoard: () => {}, onOpenFailure: () => {}, onRefresh: () => {},
  }))
  // 标题「采集记录（N）」与子页签重复，删除；旧 P2-9 截断提示随之移除
  assert.doesNotMatch(text, /采集记录（/)
  assert.doesNotMatch(text, /显示最近/)
  assert.doesNotMatch(text, /手动采集按启用种子派发 Worker 搜索/)
  // 用户定稿文案（问题 4）
  assert.match(text, /采集执行状态、进度和失败明细统一在采集记录中维护。/)
})

test('MaterialRunsTable：materialCandidateCount 判定查看看板，缺失回退 candidatesInserted（复审 P1-2 配套）', () => {
  const rows = [
    // 派生 failed 且命中候选为 0：隐藏「查看看板」（candidatesInserted 缺失也不误显示）
    {
      runId: 'vv-mat-c1', runStatus: 'failed', startedAt: '2026-10-28T10:00:00+08:00',
      candidatesInserted: null, materialCandidateCount: 0, hotLevelSummary: {},
    },
    // materialCandidateCount>0：显示
    {
      runId: 'vv-mat-c2', runStatus: 'failed', startedAt: '2026-10-28T10:10:00+08:00',
      candidatesInserted: null, materialCandidateCount: 3, hotLevelSummary: {},
    },
    // 旧服务端无 materialCandidateCount：回退 candidatesInserted=0 → 隐藏
    {
      runId: 'vv-mat-c3', runStatus: 'failed', startedAt: '2026-10-28T10:20:00+08:00',
      candidatesInserted: 0, hotLevelSummary: {},
    },
    // 回退 candidatesInserted>0 → 显示
    {
      runId: 'vv-mat-c4', runStatus: 'failed', startedAt: '2026-10-28T10:30:00+08:00',
      candidatesInserted: 7, hotLevelSummary: {},
    },
  ]
  const tree = MaterialRunsTable({
    runs: rows, activeRun: null, collecting: false, errorReason: null,
    onStartCollect: () => {}, onViewBoard: () => {}, onOpenFailure: () => {}, onRefresh: () => {},
  })
  const rowsById = new Map()
  for (const node of allNodes(tree)) {
    if (node.type === 'tr' && node.props && typeof node.props.key === 'string') {
      rowsById.set(node.props.key, treeText(node))
    }
  }
  const c1 = rowsById.get('vv-mat-c1')
  const c2 = rowsById.get('vv-mat-c2')
  const c3 = rowsById.get('vv-mat-c3')
  const c4 = rowsById.get('vv-mat-c4')
  assert.ok(c1 && c2 && c3 && c4, '四个 run 行都应渲染')
  assert.doesNotMatch(c1, /查看看板/)
  assert.match(c2, /查看看板/)
  assert.doesNotMatch(c3, /查看看板/, '无 materialCandidateCount 时回退 candidatesInserted=0 隐藏')
  assert.match(c4, /查看看板/)
})

test('MaterialReasonDrawer：scoreReasonDetails 结构化对照卡（审查 P2-1 拍板③）', () => {
  const drawer = MaterialReasonDrawer({
    row: {
      title: '测试视频', hotScore: 91, hotLevel: 'S', scoreRuleVersion: 'hot-v1-potential',
      scoreReasons: ['点赞 ≥ 1万'],
      scoreReasonDetails: [
        { name: '点赞', observed: 12000, threshold: 10000, points: 10, hit: true },
        { name: '评论', observed: 120, threshold: 500, points: 0, hit: false },
        { name: '播放', observed: null, threshold: 500000, points: 0, hit: false },
        { name: '互动率', observed: 0.03, threshold: 0.04, points: 0, hit: false },
      ],
    },
    onClose: () => {},
  })
  const text = treeText(drawer)
  assert.match(text, /评分明细（当前规则对照）/)
  assert.match(text, /1\.2万/) // 点赞观测值万化
  assert.match(text, /\+10分/) // 命中加分徽标
  assert.match(text, /还差 380/) // 评论未命中：500-120
  assert.match(text, /未采集/) // 播放观测值缺失
  assert.match(text, /3\.00%/) // 互动率观测值 ×100 两位小数
  // 终审 P2-2：未命中对照最低加分档 4%（服务端投影），不是 8%
  assert.match(text, /4%/)
  assert.match(text, /还差 1\.0%/) // 互动率未命中：4%-3%
  assert.match(text, /互动率=（赞\+评\+转\+藏）\/播放/)
  assert.match(text, /存档评分以入库时规则版本为准/)
  assert.match(text, /命中理由（1）/) // scoreReasons 文字列表保留兜底
  // 旧服务端缺投影：不渲染明细区块
  const plain = treeText(MaterialReasonDrawer({ row: { title: 'x', scoreReasons: [] }, onClose: () => {} }))
  assert.doesNotMatch(plain, /评分明细（当前规则对照）/)
})

test('MaterialReasonDrawer：无规则版本的存量候选标注「历史候选」', () => {
  const text = treeText(MaterialReasonDrawer({
    row: { title: '旧规则候选', scoreRuleVersion: '', scoreReasons: ['播放增速 300%'] },
    onClose: () => {},
  }))
  assert.match(text, /历史候选（旧规则入池）/)
  assert.doesNotMatch(text, /热度评分规则/)
})

// ===========================================================================
// 样式与宿主接线源码契约（渲染冒烟由 render-smoke.test.mjs 兜底）
// ===========================================================================

test('MATERIAL_CSS_TEXT：核心类与按钮规格齐备', () => {
  for (const cls of [
    '.ydo-mat-page', '.ydo-mat-kpis', '.ydo-mat-kpi', '.ydo-mat-filters',
    '.ydo-mat-table', '.ydo-mat-status-success', '.ydo-mat-level-s',
    '.ydo-mat-drawer', '.ydo-mat-modal', '.ydo-mat-spinner',
  ]) {
    assert.ok(MATERIAL_CSS_TEXT.includes(cls), `missing css ${cls}`)
  }
  // §6.5 按钮规格：primary 40px / secondary 36px / link 30px
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-primary\{[^}]*height:40px/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-secondary\{[^}]*height:36px/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-link\{[^}]*height:30px/u)
  // 深色可读性定稿（2026-10-29 用户拍板：只做可读性适配，设计语言不动）——
  // 交互色（页签选中/主按钮/链接）保持宿主品牌变量灰黑不跟报表蓝；
  // 状态徽标实色底白字（淡底深字在深色背景是刺眼亮块）；
  // 横幅/错误条 color-mix 透明混合（浅色观感不变、深色呈暗色块）。
  // 真机验收补订（2026-10-29）：子页签改下划线式（对齐主 Tab ydo-tabs 形态），
  // primary 字色用宿主「品牌色底前景」变量——硬编码 #fff 深色下白底白字。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-tabs button\[aria-current\]\{border-bottom-color:var\(--dsw-alias-brand-primary,#0f1115\);color:var\(--dsw-alias-label-primary,#1f2329\)\}/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-primary\{[^}]*background:var\(--dsw-alias-brand-primary,#0f1115\)/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-primary\{[^}]*color:var\(--dsw-alias-label-primary-foreground,#fff\)/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-link\{[^}]*color:var\(--dsw-alias-brand-primary,#0f1115\)/u)
  assert.doesNotMatch(MATERIAL_CSS_TEXT, /background:#3370ff/u)
  assert.doesNotMatch(MATERIAL_CSS_TEXT, /\.ydo-mat-seg/u)
  // 行操作迷你按钮（2026-10-29 真机验收定稿）：对齐车衣看板标签管理三款
  // 描边款（编辑）/灰底款（禁用）/实底款（启用），深浅主题全变量自适应。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-mini\{[^}]*border:1px solid var\(--dsw-alias-border-l1,#dee0e3\)/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-mini-secondary\{[^}]*background:var\(--dsw-alias-border-l2,#f0f1f3\)/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-mini-primary\{[^}]*color:var\(--dsw-alias-bg-base,#fff\)/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-status-success\{background:#2ea121;color:#fff\}/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-status-error\{background:#d83931;color:#fff\}/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-active\{[^}]*background:color-mix\(in srgb,var\(--dsw-alias-state-warn-primary,#de7802\) 12%,transparent\)/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-error\{[^}]*background:color-mix\(in srgb,var\(--dsw-alias-state-error-primary,#d83931\) 10%,transparent\)/u)
  // 真机验收问题 2 回归锁：来源列占位样式不得复用行按钮基类 ydo-mat-mini
  // （旧实现同名类后置覆盖按钮字色，启用按钮变灰）。占位走独立 ydo-mat-source-tag，
  // 且 .ydo-mat-mini 本体不再有 color-only 覆盖形态。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-source-tag\{display:block;color:var\(--dsw-alias-label-secondary,#646a73\);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/u)
  assert.doesNotMatch(MATERIAL_CSS_TEXT, /\.ydo-mat-mini\{color:var/u)
  // 真机验收问题 5 回归锁：素材页占满 ydo-right 全部 grid 行并自身滚动
  // （grid 模板 4 行 auto/auto/auto/1fr，页面是唯一内容 item，不跨行会被
  // auto 行撑开裁切、页面无法上下滚动）。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-page\{[^}]*grid-row:1\/-1/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-page\{[^}]*overflow:auto/u)
  // 真机验收第三轮（2026-10-30）：页面宽度与滚动控制对齐车衣素材看板
  // （.yxh-hb 同款 max-width:1440px + margin:0 auto）。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-page\{[^}]*max-width:1440px;margin:0 auto;width:100%/u)
  // 第三轮：列表各列单行不换行——nowrap 与封面列 80px 定宽只作用看板候选表
  // （.ydo-mat-board-table；.ydo-mat-table 另被五张表共用，全局 nowrap 会压垮
  // 失败明细长串与账号输入列 line-clamp，review 发现）；视频标题/标签/来源行
  // 各自单行化。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-board-table td\{white-space:nowrap\}/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-board-table th:first-child,\.ydo-mat-board-table td:first-child\{width:80px\}/u)
  // 同日追加（2026-10-30 真机反馈「封面右侧仍有空隙」）：首列去单元格内边距、
  // 图片/占位块 80×80 顶格，列内无留缝。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-board-table td:first-child\{padding:0\}/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-cover\{width:80px;height:80px;object-fit:cover/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-cover-placeholder\{width:80px;height:80px/u)
  assert.ok(!MATERIAL_CSS_TEXT.includes('.ydo-mat-table td{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#f0f1f3);vertical-align:top;white-space:nowrap}'), '共用基类 td 不得再带全局 nowrap（压垮失败明细/账号输入列）')
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-video-title\{margin:0;font-weight:650;max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/u)
  assert.match(MATERIAL_CSS_TEXT, /button\.ydo-mat-video-title\{[^}]*font-weight:650/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-tags\{display:flex;gap:4px;flex-wrap:nowrap;overflow:hidden;margin-top:6px\}/u)
  // 第三轮：标签 chip 对齐车衣素材看板（.yxh-hb-tag：2px 8px / 4px 圆角 / 12px，变量深色适配）
  // chip 底色禁用 bg-layer-2（宿主浅色 layer-1/2/3 恒纯白，白底不可见——
  // 2026-10-30 真机反馈根因）：锁定 color-mix 文字色 12% 混页面底色。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-tag\{padding:2px 8px;border-radius:4px;background:color-mix\(in srgb,var\(--dsw-alias-label-secondary,#646a73\) 12%,var\(--dsw-alias-bg-base,#fff\)\);color:var\(--dsw-alias-label-secondary,#646a73\);font-size:12px\}/u)
  assert.ok(!/\.ydo-mat-tag\{[^}]*bg-layer-2/u.test(MATERIAL_CSS_TEXT), 'chip 底色不得再用 bg-layer-2（浅色恒白）')
  // 第三轮：标题链接保持粗体（button font:inherit 会冲掉基类 650，须显式回设）；
  // 抽屉视频链接同粗体。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-link-wrap\{height:auto;font-weight:650\}/u)
  // 真机验收问题 6：评分抽屉对照表 max-content 标签列 + 值列可断行
  // （auto 列被长 URL 的 min-content 压缩、逐字竖排变形）。
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-failure-grid\{display:grid;grid-template-columns:max-content 1fr/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-failure-grid span\{min-width:0;overflow-wrap:anywhere\}/u)
  // 真机验收问题 6：视频标题按钮化（点击系统浏览器打开）+ 采集确认 meta 格
  assert.match(MATERIAL_CSS_TEXT, /button\.ydo-mat-video-title\{border:0;padding:0;background:transparent/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-meta-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px\}/u)
  assert.match(MATERIAL_CSS_TEXT, /\.ydo-mat-meta-cell\{padding:10px;border:1px solid var\(--dsw-alias-border-l1,#dee0e3\)/u)
})

test('MaterialPage：seeds 错误条在关键词与对标账号两个子页均渲染', () => {
  // seeds 是关键词+对标账号单请求，errorReason 共享；拆分后两个分支都要显式
  // 提示，避免把加载失败伪装成「暂无数据」（review P2-1）。
  const errorBar = "seeds && seeds.errorReason ? h('p', { key: 'seed-error', className: 'ydo-mat-error', role: 'alert' }, materialErrorCopy(seeds.errorReason)) : null"
  assert.equal(materialSource.split(errorBar).length - 1, 2, '错误条应恰好出现两次')
  // 锚定渲染分支（`? [`）而非 nav 里的 aria-current 判断，避免 slice 范围错位。
  const keywordIdx = materialSource.indexOf("section === 'keywords'\n      ? [")
  const accountIdx = materialSource.indexOf("section === 'accounts'\n      ? [")
  assert.ok(keywordIdx > -1 && accountIdx > -1, 'keywords/accounts 两分支应存在')
  assert.ok(materialSource.slice(keywordIdx, accountIdx).includes(errorBar), 'keywords 分支应渲染 seeds 错误条')
  assert.ok(materialSource.slice(accountIdx).includes(errorBar), 'accounts 分支应渲染 seeds 错误条')
})

test('client.js 接线：Tab/i18n/全宽 body/轮询守卫/幂等键模板', () => {
  // i18n：中英 tabMaterial（2026-10-30 拍板：主 Tab 改「爆款素材看板」）
  assert.ok(clientSource.includes("tabMaterial: '爆款素材看板'"))
  assert.ok(clientSource.includes("tabMaterial: 'Hot Materials'"))
  // Tab nav：素材看板页签存在，且顺序在爆款拆解之前（2026-10-29 真机验收定稿）
  assert.match(clientSource, /'aria-current': tab === 'material' \|\| undefined/u)
  assert.ok(
    clientSource.indexOf("'aria-current': tab === 'material'") < clientSource.indexOf("'aria-current': tab === 'breakdown'"),
    '素材看板页签应排在爆款拆解之前')
  // 素材 Tab 使用全宽内容区
  assert.match(clientSource, /tab === 'overview' \|\| tab === 'breakdown' \|\| tab === 'report' \|\| tab === 'material' \? ' ydo-body-full'/u)
  // 采集轮询：隐藏页签暂停（§6.4）
  assert.match(clientSource, /if \(typeof document !== 'undefined' && document\.hidden\) return/u)
  // 轮询恢复：Tab 进入与手动刷新共用 resumeMaterialPollingFromRows
  assert.match(clientSource, /loadMaterialRuns\(\)\.then\(resumeMaterialPollingFromRows\)/u)
  // 受理/种子幂等键模板与 index.js 校验、tools-client.js 模板一致
  assert.match(clientSource, /douyin:vv_seed_search:\$\{newAiAnalysisRequestUuid\(\)\}/u)
  assert.match(clientSource, /douyin:vv_keyword_upsert:\$\{newAiAnalysisRequestUuid\(\)\}/u)
  assert.match(clientSource, /douyin:vv_account_upsert:\$\{newAiAnalysisRequestUuid\(\)\}/u)
  // 看板请求固定素材域语义
  assert.match(clientSource, /action: 'material\.videos\.list',\s*\n\s*scope: 'material'/u)
  // 来源筛选下沉服务端（审查 P1-1）：请求透传 sourceKind，无本地过滤段
  assert.match(clientSource, /\.\.\.\(query\.sourceKind \? \{ sourceKind: query\.sourceKind \} : \{\}\)/u)
  assert.doesNotMatch(clientSource, /row\.sourceKind === filter\.sourceKind/u)
  // overlay 关闭守卫（审查 P2-4）：material 加载 effect 不在关闭态预取/续轮询
  // （真机验收问题 4 后 section 受控提升，离开 Tab 复位子页，早退分支带块）
  assert.match(clientSource, /if \(!visible \|\| tab !== 'material'\) \{/u)
  assert.match(clientSource, /setMaterialSection\('board'\)/u)
  // 终审 P2-4 竞态防护：overlay 关闭后晚到响应不得恢复轮询/受理落位
  assert.match(clientSource, /if \(!materialVisibleRef\.current\) return/u, 'resume guard')
  assert.doesNotMatch(clientSource, /resumeMaterialPollingFromRows = useCallback\(rows => \{\n    const latest/u, 'resume 必须先过 visibleRef 守卫')
  // 轮询终态同步刷新 seeds/facets（审查 P2-2）
  assert.match(clientSource, /loadMaterialSeeds\(\{ silent: true \}\)\.catch\(\(\) => \{\}\)/u)
  assert.match(clientSource, /loadMaterialFacets\(\)\.catch\(\(\) => \{\}\)/u)
  // 真机验收问题 4：MaterialPage section 受控（跨子页跳转「查看看板」）；
  // 批次过滤（runFilter/runId 参数）整套移除，不再回归。
  assert.match(clientSource, /section: materialSection,/u)
  assert.match(clientSource, /onSectionChange: setMaterialSection,/u)
  assert.match(clientSource, /const viewMaterialRunBoard = useCallback\(\(\) => \{/u)
  assert.doesNotMatch(clientSource, /materialRunFilter/u)
  assert.doesNotMatch(clientSource, /runId: filterRunId/u)
  // 真机验收问题 3：启停确认弹框提取为导出组件（截图可覆盖），宿主只接线；
  // 字面「确认/取消」断言落在 materialSource（见 MaterialConfirmDialog 组件测试）
  assert.doesNotMatch(clientSource, /'aria-label': t\('confirmYes'\)/u)
  assert.match(clientSource, /h\(MaterialConfirmDialog, \{\s*\n\s*confirm: materialToggleConfirm,/u)
  // 真机验收问题 4：采集确认无参数（上限/档位由服务端配置维护）
  assert.match(clientSource, /const confirmMaterialCollect = useCallback\(async \(\) => \{/u)
  assert.doesNotMatch(clientSource, /keywordLimit/u)
  assert.doesNotMatch(clientSource, /candidateMinLevel/u)
})

test('MaterialConfirmDialog：字面确认/取消按钮与四分支文案（真机验收问题 3）', () => {
  // 启用关键词（问题 3 现场：旧版误用 confirmYes 渲染「确认删除」）
  const enable = MaterialConfirmDialog({
    confirm: { mode: 'keyword', row: { keyword: '新手上路', status: 'disabled' } },
    onConfirm: () => {}, onCancel: () => {},
  })
  const enableText = treeText(enable)
  assert.match(enableText, /确认启用该关键词？下次采集将按优先级参与。/)
  assert.doesNotMatch(enableText, /确认删除/)
  const buttons = allNodes(enable).filter(node => node.type === 'button')
  assert.equal(buttons.length, 2)
  assert.equal(treeText(buttons.find(node => node.props.className === 'ydo-confirm-primary')), '确认')
  assert.equal(treeText(buttons.find(node => node.props.className === 'ydo-confirm-secondary')), '取消')
  // 禁用对标账号分支
  const disableAccount = treeText(MaterialConfirmDialog({
    confirm: { mode: 'account', row: { displayName: '示例账号甲', status: 'active' } },
    onConfirm: () => {}, onCancel: () => {},
  }))
  assert.match(disableAccount, /确认禁用该对标账号？禁用后不再参与后续采集。/)
  // 禁用关键词分支
  assert.match(treeText(MaterialConfirmDialog({
    confirm: { mode: 'keyword', row: { keyword: 'x', status: 'active' } },
    onConfirm: () => {}, onCancel: () => {},
  })), /确认禁用该关键词？禁用后不再参与后续采集。/)
  // 启用对标账号分支
  assert.match(treeText(MaterialConfirmDialog({
    confirm: { mode: 'account', row: { displayName: 'x', status: 'disabled' } },
    onConfirm: () => {}, onCancel: () => {},
  })), /确认启用该对标账号？下次采集将参与。/)
  // null 短路
  assert.equal(MaterialConfirmDialog({ confirm: null }), null)
})

test('MaterialSeedModal：modal={mode,row} 展开透传到 SeedModal 顶层（截图验收回归）', () => {
  // 截图验收发现的缺陷：整包透传导致 SeedModal 顶层解构 mode/row 恒 undefined，
  // 任何种子弹窗都渲染成「新增对标账号」空表单。此处锁定展开透传行为。
  const noop = () => {}
  const tree = MaterialSeedModal({
    modal: { mode: 'keyword', row: { keyword: '增程车', priority: 'P1' } },
    busy: true, errorReason: 'VALIDATION_ERROR', onConfirm: noop, onClose: noop,
  })
  assert.equal(tree.props.mode, 'keyword')
  assert.deepEqual(tree.props.row, { keyword: '增程车', priority: 'P1' })
  assert.equal(tree.props.busy, true)
  assert.equal(tree.props.errorReason, 'VALIDATION_ERROR')
  assert.equal(tree.props.onConfirm, noop)
  assert.equal(tree.props.onClose, noop)
  // modal=null（关闭态）短路渲染 null
  assert.equal(MaterialSeedModal({ modal: null, busy: false }), null)
})

test('index.js 接线：8 个 material action 分发与抖音域白名单（dashboard 已删，审查 P2-5）', () => {
  for (const action of [
    'material.seeds.list', 'material.keyword.upsert', 'material.account.upsert',
    'material.collect.start', 'material.collect.status', 'material.videos.list',
    'material.runs.list', 'material.facets',
  ]) {
    assert.ok(indexSource.includes(`case '${action}'`), `missing case ${action}`)
  }
  for (const handler of [
    'handleMaterialSeedsList', 'handleMaterialKeywordUpsert', 'handleMaterialAccountUpsert',
    'handleMaterialCollectStart', 'handleMaterialCollectStatus', 'handleMaterialVideosList',
    'handleMaterialRunsList', 'handleMaterialFacets',
  ]) {
    assert.match(indexSource, new RegExp(`async function ${handler}\\(`, 'u'))
  }
  // dashboard action/handler 均已移除
  assert.ok(!indexSource.includes("'material.dashboard'"), 'material.dashboard action should be removed')
  assert.ok(!indexSource.includes('handleMaterialDashboard'), 'handleMaterialDashboard should be removed')
  // 主页链接：HTTPS + 抖音域白名单（防站外输入直达服务端）
  assert.match(indexSource, /host === 'douyin\.com' \|\| host\.endsWith\('\.douyin\.com'\)/u)
})
