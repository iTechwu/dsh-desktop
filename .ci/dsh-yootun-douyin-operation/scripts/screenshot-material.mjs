// 抖音爆款素材看板（RQ-2026-008 阶段 4）· Playwright 截图验收脚本。
//
// 用法：node scripts/screenshot-material.mjs [输出目录]
//（默认 docs/1025/douyin/screenshots，与验收文档同目录）。
// 机制与 scripts/screenshot.mjs（1015 先例）一致：Node 侧用 react-dom/server 把
// 素材看板各区块（整页看板 / 关键词管理 / 对标账号 / 采集记录 / 评分理由抽屉 / 种子弹窗 /
// 采集弹窗 / 失败明细）SSR 成静态 HTML（内联插件真实 CSS + DSW 变量兜底 +
// 真实中文文案），Playwright 系统 Chrome 无头截图。
//
// 截图数据是**脱敏占位 fixture**（结构真实、数值占位），封面用 Playwright route
// 本地返回的 SVG（不触网、不携带任何真实业务数据）。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

import { loadPlaywrightDriver, resolveSystemChrome } from '../src/chrome.js'

const React_ = React.default ?? React
const h = (type, props, ...children) => React_.createElement(type, props ?? null, ...children)

const pluginPath = new URL('../lib/client.js', import.meta.url)

// DSW 设计变量兜底（浅色主题近似值）：插件 CSS 全部经 var() 引用宿主主题，
// 截图页不在 DSH 宿主内，必须提供一套完整可读的变量值（1015 先例同款）。
const DSW_SHARED_BASE_CSS = `*{box-sizing:border-box}
body{margin:0;font-family:'Noto Sans CJK SC','Source Han Sans SC','Microsoft YaHei',sans-serif}
.screenshot-block{padding:24px;border-bottom:16px solid}
.screenshot-title{margin:0 0 4px;font-size:18px;font-weight:700}
.screenshot-sub{margin:0 0 16px;font-size:13px}`
const DSW_FALLBACK_CSS = `:root{
  --dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#f6f7f9;--dsw-alias-bg-layer-2:#eceef1;
  --dsw-alias-border-l1:#e0e3e8;--dsw-alias-border-l2:#d4d8de;
  --dsw-alias-label-primary:#1f2329;--dsw-alias-label-secondary:#646a73;
  --dsw-alias-label-primary-foreground:#ffffff;--dsw-alias-brand-primary:#0f1115;
  --dsw-alias-interactive-bg-hover:rgba(38,49,72,.06);
  --dsw-alias-state-success-primary:#1a7f37;--dsw-alias-state-error-primary:#d03a3a;
  --dsw-alias-state-warn-primary:#d29922;
  --dsw-font-l-20-font-size:20px;--dsw-font-base-16-font-size:16px;
  --dsh-content-font-size:14px;--dsh-content-font-size-secondary:13px;
}
${DSW_SHARED_BASE_CSS}
body{background:#fff;color:#1f2329}
.screenshot-block{border-bottom-color:#d4d8de}
.screenshot-sub{color:#646a73}
`
// 深色主题兜底（2026-10-29 真机验收）：取宿主 dark 主题真实值
// （dsh-plugin-desktop native-ui shared/theme.css .dark 段的 oklch 近似 hex），
// 用于深色可读性回归截图（*-dark.png）——重点验证页签选中态/主按钮/徽标。
const DSW_DARK_FALLBACK_CSS = `:root{
  --dsw-alias-bg-base:#232323;--dsw-alias-bg-layer-1:#343434;--dsw-alias-bg-layer-2:#454545;
  --dsw-alias-border-l1:rgba(255,255,255,.1);--dsw-alias-border-l2:rgba(255,255,255,.1);
  --dsw-alias-label-primary:#fafafa;--dsw-alias-label-secondary:#b4b4b4;
  --dsw-alias-label-primary-foreground:#343434;--dsw-alias-brand-primary:#e9e9e9;
  --dsw-alias-interactive-bg-hover:rgba(255,255,255,.08);
  --dsw-alias-state-success-primary:#4ade80;--dsw-alias-state-error-primary:#e0524a;
  --dsw-alias-state-warn-primary:#d29922;
  --dsw-font-l-20-font-size:20px;--dsw-font-base-16-font-size:16px;
  --dsh-content-font-size:14px;--dsh-content-font-size-secondary:13px;
}
${DSW_SHARED_BASE_CSS}
body{background:#232323;color:#fafafa}
.screenshot-block{border-bottom-color:#0c0c0c}
.screenshot-sub{color:#b4b4b4}
`

// ---------------------------------------------------------------------------
// 脱敏占位 fixture：结构真实（与 tools 投影字段一致）、数值占位、零真实业务数据。
// ---------------------------------------------------------------------------

const noop = () => {}

function boardRowsFixture() {
  return [
    {
      candidateId: 'cand-1', awemeId: '7123', title: '增程车冬季续航横评（示例）',
      hotScore: 88.5, hotLevel: 'S', scoreRuleVersion: 'hot-v1-potential',
      scoreReasons: ['播放增速 320%', '完播率高于阈值'],
      shareUrl: 'https://v.douyin.com/example-1/',
      playCount: 123456, likeCount: 8000, commentCount: 620, shareCount: 310,
      collectCount: 1540, interactionRate: 0.1234,
      publishedAt: '2026-10-20T19:00:00+08:00',
      tags: ['新能源汽车', '自驾'], coverUrl: 'https://cdn.example/cover-a.svg',
      sourceMatches: [
        { sourceType: 'keyword_search', keyword: '增程车' },
        { sourceType: 'account_search', accountSeedId: 'as-1' },
      ],
    },
    {
      candidateId: 'cand-2', awemeId: '7124', title: '新手司机上路避坑指南（示例）',
      hotScore: 76, hotLevel: 'B', scoreRuleVersion: 'hot-v1-potential',
      scoreReasons: ['互动率高于阈值'],
      shareUrl: 'https://v.douyin.com/example-2/',
      playCount: 45210, likeCount: 1200, commentCount: null, shareCount: null,
      collectCount: null, interactionRate: 0.0521,
      publishedAt: '2026-10-22T12:30:00+08:00',
      tags: ['学车'], coverUrl: null,
      sourceMatches: [{ sourceType: 'keyword_search', keyword: '新手司机' }],
    },
    {
      candidateId: 'cand-3', awemeId: '7125', title: '汽车知识：保养周期详解（示例）',
      hotScore: 61.5, hotLevel: 'C', scoreRuleVersion: 'hot-v1-potential',
      scoreReasons: [],
      playCount: 9870, likeCount: 210, commentCount: 18, shareCount: 4,
      collectCount: 33, interactionRate: null,
      publishedAt: '2026-10-24T08:00:00+08:00',
      tags: null, coverUrl: null,
      sourceMatches: [
        { sourceType: 'both', keyword: '汽车知识', accountSeedId: 'as-1' },
      ],
    },
  ]
}

const kpiFixture = {
  total: 42,
  latest: {
    runStatus: 'completed', startedAt: '2026-10-28T10:30:00+08:00',
    hotLevelSummary: { A: 3, B: 5 },
    newVideos: 12, discovered: 30, candidatesInserted: 28,
    promotedCandidates: 6, duplicatesSkipped: 2,
  },
}

const facetsFixture = [
  { tag: '新能源汽车', count: 12 },
  { tag: '自驾', count: 4 },
  { tag: '露营', count: 2 },
]

const keywordsFixture = [
  {
    seedId: 'ks-1', keyword: '增程车', category: 'other', priority: 'P1',
    status: 'active', dailyLimit: null, searchCount: 12,
    lastReviewedAt: null, createdAt: '2026-10-25T09:00:00+08:00', updatedAt: '2026-10-28T09:30:00+08:00',
  },
  {
    seedId: 'ks-2', keyword: '汽车知识分享', category: 'other', priority: 'P2',
    status: 'active', dailyLimit: 5, searchCount: 8,
    lastReviewedAt: null, createdAt: '2026-10-25T09:00:00+08:00', updatedAt: '2026-10-27T15:00:00+08:00',
  },
  {
    seedId: 'ks-3', keyword: '新手上路', category: 'other', priority: 'P3',
    status: 'disabled', dailyLimit: null, searchCount: 3,
    lastReviewedAt: null, createdAt: '2026-10-25T09:00:00+08:00', updatedAt: '2026-10-26T11:00:00+08:00',
  },
]

const accountsFixture = [
  {
    accountSeedId: 'as-1', platform: 'douyin', displayName: '示例账号甲',
    inputForm: 'douyin_id', inputValue: 'example-creator-a', resolved: true,
    verificationStatus: 'verified', status: 'active', maxVideos: null,
    lastContentFetchedAt: '2026-10-28T10:05:00+08:00', lastResolutionError: null,
    createdAt: null, updatedAt: '2026-10-28T10:05:00+08:00',
  },
  {
    accountSeedId: 'as-2', platform: 'douyin', displayName: '长口令示例账号乙',
    inputForm: 'homepage_url',
    inputValue: '长按复制此条消息，打开抖音搜索，查看TA的更多作品。 https://v.douyin.com/example-short-link/',
    resolved: false, verificationStatus: 'pending', status: 'active', maxVideos: 10,
    lastContentFetchedAt: null, lastResolutionError: null,
    createdAt: null, updatedAt: null,
  },
  {
    accountSeedId: 'as-3', platform: 'douyin', displayName: null,
    inputForm: 'sec_user_id', inputValue: 'MS4wLjABAAAAexample',
    resolved: false, verificationStatus: 'resolution_failed', status: 'disabled',
    maxVideos: null, lastContentFetchedAt: null,
    lastResolutionError: { reason: 'profile_not_found' },
    createdAt: null, updatedAt: '2026-10-27T20:00:00+08:00',
  },
]

const runsFixture = [
  {
    runId: 'vv-mat-r1', runStatus: 'partial_failed', startedAt: '2026-10-28T10:00:00+08:00',
    finishedAt: '2026-10-28T10:05:00+08:00', durationSeconds: 300,
    keywordCount: 8, accountCount: 2, plannedJobs: 10, selectedJobs: 10,
    succeededJobs: 9, failedJobs: 1, failedKeywords: ['冷门词（示例）'], failedAccounts: [],
    discovered: 40, newVideos: 20, candidatesInserted: 18,
    promotedCandidates: 5, duplicatesSkipped: 3,
    hotLevelSummary: { S: 1, A: 4, B: 5 },
  },
  {
    runId: 'vv-mat-r2', runStatus: 'completed', startedAt: '2026-10-27T10:00:00+08:00',
    finishedAt: '2026-10-27T10:04:12+08:00', durationSeconds: 252,
    keywordCount: 6, accountCount: 2, plannedJobs: 8, selectedJobs: 8,
    succeededJobs: 8, failedJobs: 0, failedKeywords: [], failedAccounts: [],
    discovered: 36, newVideos: 18, candidatesInserted: 16,
    promotedCandidates: 4, duplicatesSkipped: 2,
    hotLevelSummary: { A: 3, B: 5 },
  },
  {
    runId: 'vv-mat-r3', runStatus: 'failed', startedAt: '2026-10-26T10:00:00+08:00',
    finishedAt: '2026-10-26T10:01:30+08:00', durationSeconds: 90,
    keywordCount: 6, accountCount: 1, plannedJobs: 7, selectedJobs: 0,
    succeededJobs: 0, failedJobs: 7, failedKeywords: ['关键词甲（示例）', '关键词乙（示例）'], failedAccounts: ['示例账号丙'],
    discovered: 0, newVideos: 0, candidatesInserted: 0, materialCandidateCount: 0,
    promotedCandidates: 0, duplicatesSkipped: 0,
    hotLevelSummary: {},
  },
]

// 审查批 4：评分理由抽屉结构化对照（scoreReasonDetails，tools 投影实时生成）。
const reasonRowFixture = {
  title: '增程车冬季续航横评（示例）', hotScore: 88.5, hotLevel: 'S',
  scoreRuleVersion: 'hot-v1-potential', publishedAt: '2026-10-20 19:00',
  shareUrl: 'https://v.douyin.com/example/',
  scoreReasons: [
    '播放增速 320%（近 7 天播放相对前窗口）',
    '完播率 41.7%，高于同类阈值',
    '互动率 12.34%，进入候选池 top10%',
  ],
  scoreReasonDetails: [
    { name: '点赞', observed: 8000, threshold: 5000, points: 10, hit: true },
    { name: '评论', observed: 620, threshold: 500, points: 8, hit: true },
    { name: '转发', observed: 310, threshold: 500, points: 0, hit: false },
    { name: '收藏', observed: 1540, threshold: 1000, points: 10, hit: true },
    { name: '播放', observed: 123456, threshold: 100000, points: 15, hit: true },
    { name: '互动率', observed: 0.1234, threshold: 0.08, points: 15, hit: true },
  ],
}

const actionsFixture = {
  onFilterChange: noop, onOpenReason: noop, onBoardPage: noop,
  onOpenSeedModal: noop, onToggleSeed: noop, onSaveSeed: noop, onCloseSeedModal: noop,
  onOpenCollect: noop, onCollectConfirm: noop, onCloseCollect: noop,
  onViewRunBoard: noop, onOpenFailure: noop, onCloseFailure: noop,
  onRefreshRuns: noop, onCloseReason: noop,
}

// ---------------------------------------------------------------------------
// 区块拼装
// ---------------------------------------------------------------------------

function buildBlocks(plugin) {
  const blocks = []

  // 整页看板（board section：四子页签 + 筛选条 + KPI 5 卡 + 候选表 + 分页；
  // 2026-10-29 布局拍板：筛选上、KPI 下；第二轮真机验收：批次过滤横幅移除、
  // section 由宿主受控注入）
  blocks.push(h('div', { className: 'screenshot-block', id: 'mat-board' },
    h('h2', { className: 'screenshot-title' }, 'Tab3 素材看板 · 整页（子页签 + 筛选条 + KPI 5 卡 + 候选表）'),
    h('p', { className: 'screenshot-sub' }, 'RQ-2026-008 阶段 4：候选素材=按当前筛选（2026-10-30 拍板，对齐车衣看板）；S/A 等四卡=最新批次投影（缺桶=0）；「—」为未返回缺口；命中来源=关键词/对标账号/双源；视频标题=作品页链接按钮'),
    h(plugin.MaterialPage, {
      board: {
        rows: boardRowsFixture(), total: 42, offset: 0, limit: 20,
        loading: false, errorReason: null, loaded: true,
      },
      kpi: kpiFixture,
      facets: facetsFixture,
      filters: { q: '', minLevel: '', sourceKind: '', publishedRange: '30d', tag: '', sortBy: 'hot', offset: 0 },
      seedAccounts: [{ accountSeedId: 'as-1', displayName: '示例账号甲' }],
      seeds: {
        data: {
          keywords: keywordsFixture, accounts: accountsFixture,
          keywordByStatus: { active: 2, disabled: 1 }, accountByStatus: { active: 2, disabled: 1 },
        },
        loading: false, errorReason: null,
      },
      runs: { rows: [], loading: false, errorReason: null },
      activeRun: null, collecting: false, reason: null, seedModal: null,
      collectOpen: false, collectError: null, failure: null,
      savingSeed: false, seedError: null,
      section: 'board', onSectionChange: noop,
      actions: actionsFixture,
    })))

  // 关键词管理 / 对标账号（2026-10-29 真机验收定稿：两个独立子页，对齐静态页；
  // 第二轮真机验收：区块标题删除、副标题定稿）
  blocks.push(h('div', { className: 'screenshot-block', id: 'mat-keywords' },
    h('h2', { className: 'screenshot-title' }, 'Tab3 素材看板 · 关键词管理'),
    h('p', { className: 'screenshot-sub' }, '子页签形态：素材看板 / 关键词管理 / 对标账号 / 采集记录（下划线式，对齐主 Tab）；禁用后不参与下一轮手动采集；历史 run 仍可追溯'),
    h(plugin.MaterialKeywordsTable, { rows: keywordsFixture, onAdd: noop, onEdit: noop, onToggle: noop })))
  blocks.push(h('div', { className: 'screenshot-block', id: 'mat-accounts' },
    h('h2', { className: 'screenshot-title' }, 'Tab3 素材看板 · 对标账号'),
    h('p', { className: 'screenshot-sub' }, '支持抖音号、主页链接或 sec_user_id；解析失败不阻断其他账号（解析状态徽标：已解析 / 未解析 / 解析失败）'),
    h(plugin.MaterialAccountsTable, { rows: accountsFixture, onAdd: noop, onEdit: noop, onToggle: noop })))

  // 采集记录（run 历史 + 进行中横幅；第二轮真机验收：标题删除、查看看板跨子页跳转）
  blocks.push(h('div', { className: 'screenshot-block', id: 'mat-runs' },
    h('h2', { className: 'screenshot-title' }, 'Tab3 素材看板 · 采集记录（run 历史 + 进行中横幅 + 立即采集）'),
    h('p', { className: 'screenshot-sub' }, '采集执行状态、进度和失败明细统一在采集记录中维护；failed 且零候选隐藏「查看看板」（materialCandidateCount 判定）'),
    h(plugin.MaterialRunsTable, {
      runs: runsFixture,
      activeRun: { runId: 'vv-mat-r9', status: 'running', startedAt: '2026-10-28T11:00:00+08:00' },
      collecting: false, errorReason: null,
      onStartCollect: noop, onViewBoard: noop, onOpenFailure: noop, onRefresh: noop,
    })))

  // 滚动回归（第二轮真机验收问题 5）：宿主真实容器 .ydo-right 内整页渲染，
  // 容器高度受限时 .ydo-mat-page 必须自身可上下滚动（截图后另有运行时断言）。
  const scrollRows = []
  for (let i = 0; i < 10; i += 1) {
    for (const row of boardRowsFixture()) {
      scrollRows.push({ ...row, candidateId: `${row.candidateId}-${i}` })
    }
  }
  blocks.push(h('div', { className: 'screenshot-block', id: 'mat-board-scroll' },
    h('h2', { className: 'screenshot-title' }, 'Tab3 素材看板 · 滚动回归（宿主 .ydo-right 容器内整页，容器限高）'),
    h('p', { className: 'screenshot-sub' }, '.ydo-mat-page 跨 ydo-right 全部 grid 行并自身滚动（grid-row:1/-1 + overflow:auto），底部候选表可达'),
    h('div', { className: 'ydo-right', style: { height: '720px', border: '1px dashed var(--dsw-alias-border-l2,#d4d8de)' } },
      h(plugin.MaterialPage, {
        board: {
          rows: scrollRows, total: scrollRows.length, offset: 0, limit: 20,
          loading: false, errorReason: null, loaded: true,
        },
        kpi: kpiFixture,
        facets: facetsFixture,
        filters: { q: '', minLevel: '', sourceKind: '', publishedRange: '30d', tag: '', sortBy: 'hot', offset: 0 },
        seedAccounts: [{ accountSeedId: 'as-1', displayName: '示例账号甲' }],
        seeds: {
          data: {
            keywords: keywordsFixture, accounts: accountsFixture,
            keywordByStatus: { active: 2, disabled: 1 }, accountByStatus: { active: 2, disabled: 1 },
          },
          loading: false, errorReason: null,
        },
        runs: { rows: [], loading: false, errorReason: null },
        activeRun: null, collecting: false, reason: null, seedModal: null,
        collectOpen: false, collectError: null, failure: null,
        savingSeed: false, seedError: null,
        section: 'board', onSectionChange: noop,
        actions: actionsFixture,
      }))))

  return blocks
}

// fixed 定位元素（抽屉 / 弹窗）独立文档渲染，避免与其他区块互相遮挡。
function buildOverlays(plugin) {
  return [
    {
      id: 'mat-reason-drawer', title: '评分理由抽屉（右侧固定，Esc 关闭、列表行位置不变）',
      sub: '摘要卡：总分 / 档位 / 评分版本；评分明细表（scoreReasonDetails 结构化对照：命中 +N分 / 未命中还差 X / 缺失未采集，互动率口径行）；加分项文字列表兜底',
      node: h(plugin.MaterialReasonDrawer, { row: reasonRowFixture, onClose: noop }),
    },
    {
      id: 'mat-seed-modal-keyword', title: '种子弹窗 · 编辑关键词（关键词编辑锁定；category 页面不维护）',
      sub: '字段：关键词（锁定）/ 优先级 P1-P5 / 状态；日上限与单轮搜索数不设输入（审查 P2-7 拍板：dailyLimit 不参与调度，前端不展示不提交）；confirm + 幂等键门禁',
      node: h(plugin.MaterialSeedModal, {
        modal: {
          mode: 'keyword',
          row: { keyword: '增程车', priority: 'P1', status: 'active', searchCount: 12 },
        },
        busy: false, errorReason: null, onConfirm: noop, onClose: noop,
      }),
    },
    {
      id: 'mat-seed-modal-account', title: '种子弹窗 · 新增对标账号（douyin_id / homepage_url / sec_user_id）',
      sub: '主页链接 HTTPS + 抖音域白名单（宿主预校验，服务端二次校验）',
      node: h(plugin.MaterialSeedModal, {
        modal: { mode: 'account', row: null },
        busy: false, errorReason: null, onConfirm: noop, onClose: noop,
      }),
    },
    {
      id: 'mat-collect-modal', title: '确认手动采集弹窗（纯确认式，对齐静态测试页）',
      sub: '启用关键词 / 启用对标账号 / 预计任务数三格只读统计；无输入字段（数量上限与候选档位由服务端配置维护）；confirm + 幂等键门禁',
      node: h(plugin.MaterialCollectModal, {
        open: true, activeKeywords: 2, activeAccounts: 2,
        busy: false, errorReason: null, onConfirm: noop, onClose: noop,
      }),
    },
    {
      id: 'mat-toggle-confirm-enable', title: '关键词启停二次确认 · 启用（字面「确认/取消」按钮）',
      sub: '真机验收问题 3 现场回归：旧版误用 i18n confirmYes 渲染「确认删除」；现字面「确认/取消」，aria-label=确认操作',
      node: h(plugin.MaterialConfirmDialog, {
        confirm: { mode: 'keyword', row: { keyword: '新手上路', status: 'disabled' } },
        onConfirm: noop, onCancel: noop,
      }),
    },
    {
      id: 'mat-toggle-confirm-disable', title: '对标账号启停二次确认 · 禁用',
      sub: '禁用后不再参与后续采集；历史 run 仍可追溯（同删除账号弹框观感，样式复用 ydo-confirm-*）',
      node: h(plugin.MaterialConfirmDialog, {
        confirm: { mode: 'account', row: { displayName: '示例账号甲', status: 'active' } },
        onConfirm: noop, onCancel: noop,
      }),
    },
    {
      id: 'mat-failure-modal', title: '失败明细弹窗（按 run 打开，failed 关键词 / 账号两列）',
      sub: '§6.4：不使用主列表嵌套展开行；内容为 failed seed / run 级错误',
      node: h(plugin.MaterialFailureModal, {
        run: runsFixture[2], onClose: noop,
      }),
    },
  ]
}

const renderNode = node => renderToStaticMarkup(node)

async function main() {
  const outDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    process.argv[2] || '../../../docs/1025/douyin/screenshots',
  )
  const built = await readFile(pluginPath, 'utf8')
  // 从构建产物工厂取插件导出（与运行时同一份内联产物）。
  const loaded = []
  const sandbox = {
    console,
    URL,
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    window: { __ModuleLoader__: { load: d => loaded.push(d) }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  }
  const vm = await import('node:vm')
  vm.createContext(sandbox)
  vm.runInContext(built, sandbox)
  // 图标 stub：素材看板组件不使用宿主图标库（material-ui 自包含）；主 client
// 顶部仍解构 ui-primitives 图标（拆解导出按钮等），给近似线性图标兜底观感。
  const icon = paths => h('svg', {
    width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
    'aria-hidden': true, style: { display: 'block' },
  }, paths.map((d, i) => h('path', { key: i, d })))
  const iconClose = () => icon(['M4 4 L12 12', 'M12 4 L4 12'])
  const iconDownload = () => icon(['M8 2 L8 10', 'M4.5 7 L8 10.5 L11.5 7', 'M3 13 L13 13'])
  const iconPlay = () => icon(['M5 3 L12 8 L5 13 Z'])
  const stubs = {
    react: React_,
    '@deepseek-ai/dsh-client-ui-primitives': {
      IconCloseOutlineRegular: iconClose,
      IconCloseOutline16: iconClose,
      IconDownloadOutlineRegular: iconDownload,
      IconDownloadOutline16: iconDownload,
      IconPlayOutlineRegular: iconPlay,
      IconPlayOutline16: iconPlay,
      Tooltip: props => h('span', props, props && props.children),
    },
  }
  const plugin = loaded[0].factory(name => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`)
    return stubs[name]
  })

  // 双主题（2026-10-29 真机验收）：light 无后缀（既有文件名，验收文档引用不变）、
  // dark 加 -dark 后缀——深色可读性回归截图。
  const pageHtml = (body, dark) => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${dark ? DSW_DARK_FALLBACK_CSS : DSW_FALLBACK_CSS}${plugin.css}</style></head><body>${body}</body></html>`

  const mainBlocks = buildBlocks(plugin)
  const overlays = buildOverlays(plugin)

  await mkdir(outDir, { recursive: true })

  const driver = await loadPlaywrightDriver()
  const chromePath = await resolveSystemChrome({ platform: process.platform })
  const browser = await driver.chromium.launch({
    channel: chromePath.channel,
    executablePath: chromePath.path,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=2', '--font-render-hinting=none'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, locale: 'zh-CN' })
    // 封面图本地路由：返回内嵌 SVG（渐变 + 文字），演示真实封面观感、零网络依赖。
    await page.route('**/cdn.example/**', route => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a7fd4"/><stop offset="1" stop-color="#7ba7e8"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><text x="160" y="112" font-size="30" fill="rgba(255,255,255,.92)" text-anchor="middle" font-family="sans-serif">示例封面</text></svg>',
    }))

    for (const dark of [false, true]) {
      const suffix = dark ? '-dark' : ''
      const mainHtml = pageHtml(mainBlocks.map(renderNode).join(''), dark)
      const overlayHtml = new Map(overlays.map(item => [item.id, pageHtml(renderNode(item.node), dark)]))

      // 预览 HTML 同步双主题（dark 后缀命名，便于浏览器内对照）。
      const previewPath = path.join(outDir, `material-preview${suffix}.html`)
      // SSR 嵌套缩进会产出尾随空白（审查 P3-3）：落盘前统一剥除，避免 diff 噪声。
      await writeFile(previewPath, (mainHtml + [...overlayHtml.values()].join('')).replace(/[ \t]+$/gm, ''))
      console.log(`preview html: ${previewPath}`)

      await page.setContent(mainHtml, { waitUntil: 'networkidle' })
      await page.evaluate(() => (document.fonts ? document.fonts.ready : null))
      for (const [name, selector] of [
        ['material-board', '#mat-board'],
        ['material-keywords', '#mat-keywords'],
        ['material-accounts', '#mat-accounts'],
        ['material-runs', '#mat-runs'],
        ['material-board-scroll', '#mat-board-scroll'],
      ]) {
        const file = path.join(outDir, `${name}${suffix}.png`)
        await page.locator(selector).screenshot({ path: file })
        console.log(`saved: ${file}`)
      }

      // 滚动运行时断言（真机验收问题 5 回归）：.ydo-mat-page 必须比容器内容矮、
      // 且 scrollTop 可滚到底（否则底部列表不可达）。
      const scrollInfo = await page.evaluate(() => {
        const el = document.querySelector('#mat-board-scroll .ydo-mat-page')
        if (!el) throw new Error('滚动回归块 #mat-board-scroll .ydo-mat-page 未找到（块 id 或类名失配）')
        el.scrollTop = 99999
        return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTopAfter: el.scrollTop }
      })
      if (!(scrollInfo.scrollHeight > scrollInfo.clientHeight && scrollInfo.scrollTopAfter > 0)) {
        throw new Error(`素材页不可滚动（问题 5 回归失败）: ${JSON.stringify(scrollInfo)}`)
      }
      console.log(`scroll check ok: ${JSON.stringify(scrollInfo)}`)

      // 抽屉 / 弹窗（fixed 定位）逐个独立文档渲染。
      for (const item of overlays) {
        await page.setContent(overlayHtml.get(item.id), { waitUntil: 'networkidle' })
        await page.evaluate(() => (document.fonts ? document.fonts.ready : null))
        const file = path.join(outDir, `${item.id}${suffix}.png`)
        await page.screenshot({ path: file, fullPage: true })
        console.log(`saved: ${file}`)
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
