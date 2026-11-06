// 爆款基因库测试（RQ-2026-010 阶段 5，开发文档 §9.2）：
// - Host gene 五 action 行为级测试（handler 直调 + mock ctx.tools，仿 host-writes 骨架）；
// - GenePage 真渲染（react-dom/server + 源码 vm 求值，hooks 组件也能渲染）：
//   facets 收纳 / 失败入口状态机 / 已选条件条 / 失败卡片 / 未采集渲染 / 维度色板；
// - 素材看板「去拆解」两种行为（有/无 share_url）；
// - 样式契约：新增 className 仅 ydo-gene-* 前缀（C7）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import React from 'react'
import { renderToString } from 'react-dom/server'

import {
  handleGeneGet,
  handleGeneList,
  handleGeneRegenerate,
  handleGeneSearch,
  handleGeneUpdate,
} from '../index.js'

// ---------------------------------------------------------------------------
// 宿主 gene 五 action（host-writes 骨架同款 mock ctx）
// ---------------------------------------------------------------------------

const GENE_TOOLS = [
  'viral_video_knowledge_search',
  'viral_video_knowledge_get',
  'viral_video_knowledge_update',
  'viral_video_knowledge_regenerate',
  'viral_video_knowledge_list',
]

function makeCtx({ result = { structuredContent: { ok: true } }, error = null } = {}) {
  const calls = []
  return {
    calls,
    ctx: {
      tools: {
        schemas: () => GENE_TOOLS.map(name => ({ name })),
        execute: async ({ name, arguments: args }) => {
          calls.push({ name, args })
          if (error) throw error
          return result
        },
      },
    },
  }
}

// vm 求值置于所有 test() 注册之前：node:test 会在顶层 await 处让已注册的
// 测试先行执行，求值放后面会 TDZ（geneErrorCopy before initialization）。
const geneSource = (await readFile(new URL('../src/gene-ui.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '')
const geneContext = {
  require: name => {
    assert.equal(name, 'react')
    return React
  },
}
vm.createContext(geneContext)
vm.runInContext(geneSource, geneContext)
const { GenePage, GENE_CSS_TEXT, GENE_ERROR_REASON_COPY, geneErrorCopy } = vm.runInContext(
  '({ GenePage, GENE_CSS_TEXT, GENE_ERROR_REASON_COPY, geneErrorCopy })',
  geneContext,
)

const RECORD_ID = 'vvk_abcdef1234567890'
const UPD_KEY = `douyin:vv_gene_upd:${RECORD_ID}:11111111-1111-4111-8111-111111111111`
const REG_KEY = `douyin:vv_gene_reg:${RECORD_ID}:22222222-2222-4222-8222-222222222222`

test('gene.search：入参清洗与透传（query 截断/geneTags 白名单/枚举/clamp）', async () => {
  const { ctx, calls } = makeCtx()
  const payload = await handleGeneSearch({}, ctx, {
    query: '  车衣  ',
    category: '车衣',
    geneTags: { hook: ['悬念开场', '  ', 123, '结果前置'], badDim: 'not-array' },
    adoptionStatus: 'adopted',
    offset: -5,
    limit: 999,
  })
  assert.equal(payload.status, 'ready')
  assert.deepEqual(calls[0].args, {
    query: '车衣',
    category: '车衣',
    geneTags: { hook: ['悬念开场', '结果前置'] },
    adoptionStatus: 'adopted',
    offset: 0,
    limit: 50,
  })
})

test('gene.search：非法采纳状态拒绝且不触达 tools', async () => {
  const { ctx, calls } = makeCtx()
  assert.equal((await handleGeneSearch({}, ctx, { adoptionStatus: 'nope' })).reason, 'VALIDATION_ERROR')
  assert.equal(calls.length, 0)
})

test('gene.update：键模板校验 + geneTags/manualNotes/adoptionStatus 白名单', async () => {
  const { ctx, calls } = makeCtx()
  const payload = await handleGeneUpdate({}, ctx, {
    recordId: RECORD_ID,
    idempotencyKey: UPD_KEY,
    geneTags: { hook: ['悬念开场'], empty: [] },
    manualNotes: '人工备注'.repeat(600) + '超长部分',
    adoptionStatus: 'revised',
  })
  assert.equal(payload.status, 'ready')
  const args = calls[0].args
  assert.equal(args.recordId, RECORD_ID)
  assert.equal(args.idempotencyKey, UPD_KEY)
  assert.deepEqual(args.geneTags, { hook: ['悬念开场'] })
  assert.equal(args.manualNotes.length, 2000)
  assert.equal(args.adoptionStatus, 'revised')
})

test('gene.update/regenerate：坏键模板与缺参拒绝', async () => {
  const { ctx, calls } = makeCtx()
  assert.equal((await handleGeneUpdate({}, ctx, { recordId: RECORD_ID, idempotencyKey: 'douyin:other:1:2' })).reason, 'INVALID_IDEMPOTENCY_KEY')
  assert.equal((await handleGeneUpdate({}, ctx, { idempotencyKey: UPD_KEY })).reason, 'VALIDATION_ERROR')
  assert.equal((await handleGeneUpdate({}, ctx, { recordId: RECORD_ID, idempotencyKey: UPD_KEY, adoptionStatus: 'bad' })).reason, 'VALIDATION_ERROR')
  assert.equal((await handleGeneRegenerate({}, ctx, { recordId: RECORD_ID, idempotencyKey: UPD_KEY })).reason, 'INVALID_IDEMPOTENCY_KEY', 'regenerate 拒绝 upd 前缀')
  assert.equal((await handleGeneRegenerate({}, ctx, { recordId: RECORD_ID })).reason, 'idempotency_key_required')
  assert.equal(calls.length, 0, '拒绝路径不触达 tools')
})

test('gene.regenerate/list/get：合法透传', async () => {
  const { ctx, calls } = makeCtx()
  assert.equal((await handleGeneRegenerate({}, ctx, { recordId: RECORD_ID, idempotencyKey: REG_KEY })).status, 'ready')
  assert.deepEqual(calls[0].args, { recordId: RECORD_ID, idempotencyKey: REG_KEY })
  assert.equal((await handleGeneList({}, ctx, { geneStatus: 'failed', limit: 999 })).status, 'ready')
  assert.deepEqual(calls[1].args, { geneStatus: 'failed', limit: 200 })
  assert.equal((await handleGeneList({}, ctx, { geneStatus: 'bogus' })).reason, 'VALIDATION_ERROR')
  assert.equal((await handleGeneGet({}, ctx, {})).reason, 'VALIDATION_ERROR')
  assert.equal((await handleGeneGet({}, ctx, { recordId: RECORD_ID })).status, 'ready')
})

test('geneErrorCopy：稳定码命中文案、未登记码收敛兜底', () => {
  assert.equal(geneErrorCopy('GENE_NOT_READY'), GENE_ERROR_REASON_COPY.GENE_NOT_READY)
  assert.ok(geneErrorCopy('GENE_NOT_READY').includes('备注'))
  assert.notEqual(geneErrorCopy('TOTALLY_UNKNOWN'), undefined)
  assert.equal(geneErrorCopy(null), geneErrorCopy('TOTALLY_UNKNOWN'))
})

// ---------------------------------------------------------------------------
// GenePage 真渲染（vm 求值 + 真实 react/react-dom）
// ---------------------------------------------------------------------------



const DIMENSIONS = [
  { id: 'category', name: '品类', maxLabels: 1 },
  { id: 'hook', name: '前3秒钩子', maxLabels: 3 },
  { id: 'shot', name: '镜头手法', maxLabels: 3 },
]

function baseRecords(overrides = {}) {
  return {
    results: [
      {
        recordId: 'vvk_rec_ok',
        title: '贴车衣避坑指南',
        coverUrl: 'https://cdn.example.com/c.jpg',
        authorName: '膜界老张',
        publishedAt: '2026-10-28T00:00:00+00:00',
        durationSeconds: 47,
        metrics: { playCount: 1286000, likeCount: 98000, commentCount: 12000, shareCount: 3000, collectCount: 21000 },
        geneTags: { category: ['车衣'], hook: ['悬念开场'] },
        adoptionStatus: 'adopted',
        geneStatus: 'succeeded',
        genePromptVersion: 'gene-v1',
        editedBy: 'system',
      },
      {
        recordId: 'vvk_rec_fail',
        title: '失败的条目',
        coverUrl: null,
        authorName: null,
        publishedAt: null,
        durationSeconds: null,
        metrics: {},
        geneTags: {},
        adoptionStatus: 'ai_draft',
        geneStatus: 'failed',
        genePromptVersion: null,
        editedBy: 'system',
      },
    ],
    total: 2,
    hasMore: false,
    facets: { category: [{ label: '车衣', count: 46 }, { label: '贴膜', count: 31 }], hook: [{ label: `钩子${1}`, count: 9 }] },
    stats: { total: 128, last7d: 12, adoptedRatio: 0.63, failedCount: 1 },
    dimensions: DIMENSIONS,
    loading: false,
    errorReason: null,
    ...overrides,
  }
}

function renderGenePage({ records, filters, detail = null, failed = null, retryError = null }) {
  const noop = () => {}
  return renderToString(
    React.createElement(GenePage, {
      t: key => key,
      records,
      filters: filters || { query: '', category: '', adoption: '', dims: {} },
      detail,
      failed,
      saving: false,
      saveError: null,
      retryingId: null,
      retryError,
      actions: {
        onFilterChange: noop, onFilterApply: noop, onSearch: noop, onReset: noop,
        onLoadMore: noop, onToggleTag: noop, onRemoveTag: noop, onClearTags: noop,
        onOpenDetail: noop, onCloseDetail: noop, onOpenFailed: noop, onCloseFailed: noop,
        onSaveEdit: noop, onRegenerate: noop,
      },
    }),
  )
}

test('失败入口状态机（T9.7）：failed>0 显示胶囊与 KPI 标红；=0 完全隐藏', () => {
  const withFail = renderGenePage({ records: baseRecords() })
  assert.ok(withFail.includes('ydo-gene-alert'), '失败胶囊存在')
  assert.ok(withFail.includes('is-alert'), 'KPI 失败数标红')
  assert.ok(withFail.includes('data-status="failed"'), '失败卡片存在')
  const noFail = renderGenePage({
    records: baseRecords({
      stats: { total: 128, last7d: 12, adoptedRatio: 0.63, failedCount: 0 },
      results: baseRecords().results.filter(record => record.geneStatus !== 'failed'),
    }),
  })
  assert.ok(!noFail.includes('ydo-gene-alert'), '失败数=0 胶囊完全隐藏')
  assert.ok(!noFail.includes('is-alert'), 'KPI 失败数中性')
})

test('facets 收纳（v3）：Top3 之外隐藏、hidden>2 显示「+N」虚线胶囊', () => {
  const records = baseRecords()
  records.facets.hook = [
    { label: '钩子一', count: 38 },
    { label: '钩子二', count: 27 },
    { label: '钩子三', count: 19 },
    { label: '钩子四', count: 14 },
    { label: '钩子五', count: 9 },
    { label: '钩子六', count: 3 },
  ]
  const html = renderGenePage({ records })
  assert.ok(html.includes('+3'), '虚线胶囊展示 +N')
  assert.ok(html.includes('>钩子一<'), 'Top3 可见')
  assert.ok(html.includes('display:none'), '第 4 个起隐藏')
  // 少量标签（hidden<=2）默认展开：category 只有 2 个 → 无「+N」
  assert.ok(!html.includes('>+1<'))
})

test('已选条件条：chip 渲染 + 清空全部（remove 联动由客户端 handler 承担）', () => {
  const html = renderGenePage({
    records: baseRecords(),
    filters: { query: '', category: '', adoption: '', dims: { hook: ['悬念开场'] } },
  })
  assert.ok(html.includes('已选条件'))
  assert.ok(html.includes('前3秒钩子·悬念开场'))
  assert.ok(html.includes('清空全部'))
})

test('失败卡片：重试提取按钮与原因提示；成功卡为查看详情', () => {
  const html = renderGenePage({ records: baseRecords() })
  assert.ok(html.includes('重试提取'))
  assert.ok(html.includes('基因提取失败；拆解结果不受影响，可重试'))
  assert.ok(html.includes('查看详情'))
})

test('未采集渲染（T5.4）：metrics/日期缺失显示「—」，不造 0', () => {
  const html = renderGenePage({ records: baseRecords() })
  assert.ok(html.includes('—'))
})

test('详情报告未采集（T5.4）：audienceInsight/bgmStyle 缺失渲染「未采集」', () => {
  const detail = {
    loading: false,
    errorReason: null,
    record: {
      recordId: 'vvk_rec_ok',
      title: '贴车衣避坑指南',
      coverUrl: null, shareUrl: null,
      authorName: '膜界老张', publishedAt: '2026-10-28T00:00:00+00:00',
      durationSeconds: null,
      metrics: { playCount: 1, likeCount: 2, commentCount: 3, shareCount: 4, collectCount: 5 },
      geneTags: { category: ['车衣'], audience: ['新车车主'] },
      geneEvidenceJson: { audience: [{ label: '新车车主', basis: '依据：内容推断' }] },
      manualNotes: null,
      adoptionStatus: 'adopted', geneStatus: 'succeeded',
      genePromptVersion: 'gene-v1', geneModel: 'minimax-m3',
      geneAttemptCount: 1, geneErrorCode: null, geneErrorSummary: null,
      editedBy: 'system', editedAt: '2026-11-06T00:00:00+00:00',
      createdAt: '2026-11-06T00:00:00+00:00', updatedAt: '2026-11-06T00:00:00+00:00',
      reportJson: { summary: '摘要', hook: '钩子', rhythm: '节奏', audience: '受众', sellingPoints: [], rewriteHints: [], audienceInsight: null, bgmStyle: null, segmentCount: 16, segments: [] },
    },
  }
  const html = renderToString(
    React.createElement(GenePage, {
      t: key => key,
      records: baseRecords(),
      filters: { query: '', category: '', adoption: '', dims: {} },
      detail,
      failed: null,
      saving: false,
      saveError: null,
      retryingId: null,
      retryError: null,
      actions: {
        onFilterChange: () => {}, onFilterApply: () => {}, onSearch: () => {}, onReset: () => {},
        onLoadMore: () => {}, onToggleTag: () => {}, onRemoveTag: () => {}, onClearTags: () => {},
        onOpenDetail: () => {}, onCloseDetail: () => {}, onOpenFailed: () => {}, onCloseFailed: () => {},
        onSaveEdit: () => {}, onRegenerate: () => {},
      },
    }),
  )
  assert.ok(html.includes('未采集'), '缺字段渲染未采集')
  assert.ok(html.includes('受众画像（AI 推断）'))
  assert.ok(html.includes('依据：内容推断'), 'evidence 依据行渲染')
  // 用户 2026-11-06 指示：详情头部「gene-v1 · 拆解 breakdown-v2 · 编辑：系统」行移除；
  // C5 的「系统」口径改由修正区编辑记录说明承载
  // t 为键直传：说明位存在即渲染（运行时由 i18n 字典输出「系统」口径文案）
  assert.ok(html.includes('geneEditNote'), 'C5：编辑记录说明位渲染')
  assert.ok(!html.includes('编辑：system'), '不得原样输出 system')
  assert.ok(!html.includes('拆解 breakdown-v2 · 编辑'), '头部版本/编辑人行已移除')
})

test('维度色板（v3）：data-h 与维度一一对应', () => {
  const html = renderGenePage({ records: baseRecords() })
  assert.ok(html.includes('data-h="221"'), 'category 蓝')
  assert.ok(html.includes('data-h="24"'), 'hook 橙')
})

function detailFor(geneStatus) {
  return {
    loading: false,
    errorReason: null,
    record: {
      recordId: 'vvk_rec_ok',
      title: '贴车衣避坑指南',
      coverUrl: null, shareUrl: null,
      authorName: '膜界老张', publishedAt: '2026-10-28T00:00:00+00:00',
      durationSeconds: null,
      metrics: { playCount: 1, likeCount: 2, commentCount: 3, shareCount: 4, collectCount: 5 },
      geneTags: { category: ['车衣'], audience: ['新车车主'] },
      geneEvidenceJson: {},
      manualNotes: null,
      adoptionStatus: 'ai_draft', geneStatus,
      genePromptVersion: 'gene-v1', geneModel: 'minimax-m3',
      geneAttemptCount: 2, geneErrorCode: null, geneErrorSummary: null,
      editedBy: 'system', editedAt: '2026-11-06T00:00:00+00:00',
      createdAt: '2026-11-06T00:00:00+00:00', updatedAt: '2026-11-06T00:00:00+00:00',
      reportJson: { summary: '摘要', hook: '钩子', rhythm: '节奏', audience: '受众', sellingPoints: [], rewriteHints: [], audienceInsight: null, bgmStyle: null, segmentCount: 0, segments: [] },
    },
  }
}

test('提取中禁用矩阵：running 时保存/重新提取按钮禁用并显示进行中提示', () => {
  const html = renderGenePage({ records: baseRecords(), detail: detailFor('running') })
  assert.ok(html.includes('基因提取进行中'), '进行中提示存在')
  assert.ok(/disabled=""[^>]*>重新提取基因/.test(html), '重新提取触发按钮禁用')
  assert.ok(/disabled=""[^>]*>保存修正/.test(html), '保存修正按钮禁用')
})

test('提取中禁用矩阵：succeeded 时保存/重新提取按钮可用', () => {
  const html = renderGenePage({ records: baseRecords(), detail: detailFor('succeeded') })
  assert.ok(!html.includes('基因提取进行中'), '无进行中提示')
  assert.ok(/>重新提取基因</.test(html) && !/disabled=""[^>]*>重新提取基因/.test(html), '重新提取触发按钮可用')
  assert.ok(/>保存修正</.test(html) && !/disabled=""[^>]*>保存修正/.test(html), '保存修正按钮可用')
})

test('样式契约（C7）：新增 className 仅 ydo-gene-* 前缀或白名单复用类', () => {
  // 扫 gene-ui 源码的 className 字符串与 CSS 选择器
  const classNames = new Set()
  // 先剥离模板串插值（${...} → 空格），再统一匹配静态 className
  const staticSource = geneSource.replace(/\$\{[^}]*\}/g, ' ')
  for (const match of staticSource.matchAll(/className:\s*['"`]([^'"`]+)['"`]/g)) {
    for (const name of match[1].split(' ')) {
      if (name) classNames.add(name)
    }
  }
  const reusedWhitelist = new Set([
    'ydo-work-cover', 'ydo-work-cover-large', 'ydo-work-cover-duration',
    'ydo-tags', 'ydo-mat-status', 'ydo-mat-status-muted', 'ydo-mat-status-success',
    'ydo-mat-status-error', 'ydo-mat-hint', 'ydo-mat-danger', 'ydo-mat-mini',
    'ydo-mat-link', 'ydo-mat-empty', 'ydo-mat-head', 'ydo-mat-sub',
    'ydo-mat-kpis', 'ydo-mat-kpi', 'ydo-mat-kpi-label', 'ydo-mat-kpi-value',
    'ydo-mat-kpi-foot', 'ydo-mat-filters', 'ydo-toolbar', 'ydo-primary', 'ydo-secondary',
    'ydo-panel', 'ydo-mat-page', 'ydo-mat-meta', 'ydo-mat-reason-list', 'ydo-mat-reason-item',
    'ydo-mat-failure-grid', 'ydo-report-works', 'ydo-report-work-card', 'ydo-report-seg',
    'ydo-report-seg-item', 'ydo-ai-modal-overlay', 'ydo-ai-modal', 'ydo-ai-modal-close',
    'ydo-ai-modal-body', 'ydo-modal-sec-title', 'ydo-bd-head-meta', 'ydo-error', 'is-alert',
    // 基因库状态修饰类（定义在 .ydo-gene-chip / .ydo-ai-modal-overlay 作用域内）
    'chip-count', 'is-selected', 'is-open',
  ])
  const unknown = [...classNames].filter(name => !name.startsWith('ydo-gene-') && !reusedWhitelist.has(name))
  assert.deepEqual(unknown, [], `出现白名单外的 className: ${unknown.join(', ')}`)
  // CSS 选择器仅 ydo-gene-*/[data-h]/主题与色板规则
  // 状态修饰类（is-* 与 chip-count）定义在 ydo-gene-* / ydo-ai-modal-* 复合选择器内，
  // 不独立成新功能选择器；功能类必须 ydo-gene-* 前缀。
  for (const match of GENE_CSS_TEXT.matchAll(/\.([\w-]+)\{/g)) {
    const selector = match[1]
    const allowed = selector.startsWith('ydo-gene-') || selector.startsWith('is-') || selector === 'chip-count'
    assert.ok(allowed, `CSS 选择器 ${selector} 不在 ydo-gene-* 前缀内`)
  }
})

// ---------------------------------------------------------------------------
// 素材看板「去拆解」两种行为（T8.1/T8.2）
// ---------------------------------------------------------------------------

const materialSource = (await readFile(new URL('../src/material-ui.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '')
const materialContext = {
  require: name => {
    assert.ok(name === 'react' || name.includes('ui-format') || name.includes('ui-primitives') || name.includes('select-ui'), name)
    if (name === 'react') return React
    if (name.includes('ui-format')) {
      return { formatCount: v => String(v ?? '—'), formatPercent: v => String(v ?? '—') }
    }
    if (name.includes('ui-primitives')) return {}
    return {}
  },
}
vm.createContext(materialContext)
vm.runInContext(materialSource, materialContext)
const { MaterialBoardTable } = vm.runInContext('({ MaterialBoardTable })', materialContext)

test('去拆解（T8.1/T8.2）：有 share_url 可点；无 share_url 置灰 + 提示', () => {
  const rows = [
    { candidateId: 'c1', shareUrl: 'https://v.douyin.com/abc', title: '有链接' },
    { candidateId: 'c2', shareUrl: null, title: '无链接' },
  ]
  let clicked = null
  const table = MaterialBoardTable({
    board: { rows, total: 2, offset: 0, limit: 20, loaded: true, loading: false },
    seedAccounts: [],
    onOpenReason: () => {},
    onPage: () => {},
    onStartBreakdown: row => { clicked = row },
  })
  // fake createElement 对象树：找「去拆解」按钮断言 disabled/title/onClick
  const stack = [table]
  const found = []
  while (stack.length) {
    const node = stack.pop()
    if (!node) continue
    if (Array.isArray(node)) { stack.push(...node); continue }
    if (typeof node !== 'object' || !node.props) continue
    // 函数组件手动展开一层（BoardRow 等在 fake createElement 下是函数元素）
    if (typeof node.type === 'function') stack.push(node.type(node.props))
    const children = node.props.children
    if (Array.isArray(children)) stack.push(...children)
    else if (children) stack.push(children)
    if (node.props.children === '去拆解') found.push(node)
  }
  assert.equal(found.length, 2, '每行一个去拆解按钮')
  // 顺序无关断言（栈遍历逆序）：有链接行可点；无链接行置灰 + 提示文案。
  // 分页「上一页/下一页」也是 disabled 按钮，必须先按「去拆解」文案筛。
  const enabled = found.find(node => !node.props.disabled)
  const disabled = found.find(node => node.props.disabled === true)
  assert.ok(enabled && disabled, '恰好一可点一置灰')
  // 真实 React 元素：字段在 node.props 下（materialContext.require 返回真 React）
  assert.equal(disabled.props.title, '该作品缺少可解析链接')
  assert.ok(String(enabled.props.title).includes('预填'), '有链接按钮 title 为预填提示')
  // 点击行为经 onStartBreakdown 上抛（宿主侧 setPrefill+setTab，客户端另测）
  enabled.props.onClick()
  assert.equal(clicked.candidateId, 'c1')
})
