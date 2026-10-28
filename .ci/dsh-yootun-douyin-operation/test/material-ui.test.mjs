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

test('MaterialFilterBar：档位/来源/时间窗/排序选项齐全，标签 facets 注入', () => {
  const filters = { q: '增程', minLevel: '', sourceKind: '', publishedRange: '30d', tag: '', sortBy: 'hot' }
  const bar = MaterialFilterBar({
    filters,
    facets: [{ tag: '自驾', count: 4 }, { tag: '露营', count: 2 }],
    onChange: () => {}, onRefresh: () => {}, loading: false,
  })
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
})

test('client.js 接线：Tab/i18n/全宽 body/轮询守卫/幂等键模板', () => {
  // i18n：中英 tabMaterial
  assert.ok(clientSource.includes("tabMaterial: '素材看板'"))
  assert.ok(clientSource.includes("tabMaterial: 'Materials'"))
  // Tab nav 第 5 个按钮
  assert.match(clientSource, /'aria-current': tab === 'material' \|\| undefined/u)
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

test('index.js 接线：9 个 material action 分发与抖音域白名单', () => {
  for (const action of [
    'material.seeds.list', 'material.keyword.upsert', 'material.account.upsert',
    'material.collect.start', 'material.collect.status', 'material.videos.list',
    'material.dashboard', 'material.runs.list', 'material.facets',
  ]) {
    assert.ok(indexSource.includes(`case '${action}'`), `missing case ${action}`)
  }
  for (const handler of [
    'handleMaterialSeedsList', 'handleMaterialKeywordUpsert', 'handleMaterialAccountUpsert',
    'handleMaterialCollectStart', 'handleMaterialCollectStatus', 'handleMaterialVideosList',
    'handleMaterialDashboard', 'handleMaterialRunsList', 'handleMaterialFacets',
  ]) {
    assert.match(indexSource, new RegExp(`async function ${handler}\\(`, 'u'))
  }
  // 主页链接：HTTPS + 抖音域白名单（防站外输入直达服务端）
  assert.match(indexSource, /host === 'douyin\.com' \|\| host\.endsWith\('\.douyin\.com'\)/u)
})
