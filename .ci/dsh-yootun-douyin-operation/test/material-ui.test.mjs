// 爆款素材看板 UI 测试（RQ-2026-008 开发文档 §6.6）。
//
// 渲染方式与 report-ui.test.mjs 同法：剥离 export 后在 vm 上下文求值，
// createElement 返回普通对象树，再递归断言（展示组件均为无 hooks 纯函数；
// MaterialPage/SeedModal/CollectModal 含 React.useState，真实渲染由
// render-smoke.test.mjs 兜底，此处只做宿主接线源码契约断言）。
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
} = vm.runInContext(
  '({ MATERIAL_ERROR_REASON_COPY, MATERIAL_CSS_TEXT, materialErrorCopy, materialStatusPill, '
  + 'MaterialKpiCards, MaterialFilterBar, MaterialBoardTable, MaterialReasonDrawer, '
  + 'MaterialKeywordsTable, MaterialAccountsTable, MaterialRunsTable, MaterialFailureModal, MaterialSeedModal })',
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

test('MaterialKpiCards：素材域累计与最新批次投影，全缺失渲染「—」', () => {
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
  assert.match(filled, /0 \/ 3/)
  assert.match(filled, /最新批次分布/)
  assert.match(filled, /发现 30 · 入库 28/)
  assert.match(filled, /去重跳过 2/)
  assert.match(filled, /手动采集 · 已完成/)
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
  assert.match(text, /关键词种子（1）/)
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
  assert.match(text, /查看本批候选/)
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

test('MaterialRunsTable：runsTotal 标题展示全量计数与截断提示（审查 P2-9）', () => {
  const rows = [
    { runId: 'vv-mat-t1', runStatus: 'completed', startedAt: '2026-10-28T10:00:00+08:00', hotLevelSummary: {} },
    { runId: 'vv-mat-t2', runStatus: 'completed', startedAt: '2026-10-28T09:00:00+08:00', hotLevelSummary: {} },
  ]
  const handlers = {
    activeRun: null, collecting: false, errorReason: null,
    onStartCollect: () => {}, onViewBoard: () => {}, onOpenFailure: () => {}, onRefresh: () => {},
  }
  const truncated = treeText(MaterialRunsTable({ runs: rows, runsTotal: 50, ...handlers }))
  assert.match(truncated, /采集记录（50 · 显示最近 2 条）/)
  // 未传 runsTotal（旧宿主/直接渲染）与 total==rows.length 均不出现截断提示
  const fallback = treeText(MaterialRunsTable({ runs: rows, ...handlers }))
  assert.match(fallback, /采集记录（2）/)
  assert.doesNotMatch(fallback, /显示最近/)
  const full = treeText(MaterialRunsTable({ runs: rows, runsTotal: 2, ...handlers }))
  assert.doesNotMatch(full, /显示最近/)
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
  // i18n：中英 tabMaterial
  assert.ok(clientSource.includes("tabMaterial: '素材看板'"))
  assert.ok(clientSource.includes("tabMaterial: 'Materials'"))
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
  assert.match(clientSource, /if \(!visible \|\| tab !== 'material'\) return/u)
  // 终审 P2-4 竞态防护：overlay 关闭后晚到响应不得恢复轮询/受理落位
  assert.match(clientSource, /if \(!materialVisibleRef\.current\) return/u, 'resume guard')
  assert.doesNotMatch(clientSource, /resumeMaterialPollingFromRows = useCallback\(rows => \{\n    const latest/u, 'resume 必须先过 visibleRef 守卫')
  // 轮询终态同步刷新 seeds/facets（审查 P2-2）
  assert.match(clientSource, /loadMaterialSeeds\(\{ silent: true \}\)\.catch\(\(\) => \{\}\)/u)
  assert.match(clientSource, /loadMaterialFacets\(\)\.catch\(\(\) => \{\}\)/u)
  // runs 全量 total 投影进 UI 状态（审查 P2-9）
  assert.match(materialSource, /runsTotal: runs && runs\.total/u)
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
