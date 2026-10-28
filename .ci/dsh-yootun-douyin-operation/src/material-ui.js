// 爆款素材看板 UI 模块（RQ-2026-008 开发文档 §6：素材看板/种子管理/采集记录三子页
// + 评分理由抽屉 + 种子/采集/失败明细弹层）。UI 基准为 tools 验证页
// src/tools_dofe/static/viral_video_material.html（demo 模板），数据全部来自宿主
// action 投影，本模块只做展示与本地格式化，不计算任何口径；NULL/未采集一律渲染
// 「—」，绝不冒充 0（interactionRate 是 0–1 比率，展示层统一 ×100 两位小数）。
//
// 文案口径与 report-ui.js 一致：模块内中文硬编码，不进 client.js 的 i18n 表
// （仅 Tab 按钮文案 tabMaterial 走 i18n）。构建脚本把本模块内联进 lib/client.js
// （与 report-ui 同法）：顶部 CommonJS require（DSH 运行时提供）由构建剥离，
// React/h 与 ui-format 纯函数由 client.js 顶部声明提供；hooks 以 React.xxx 形式
// 使用（与 breakdown.js 同款），不与 client.js 顶部解构的 const 绑定重复声明。

const React = require('react')
const { createElement: h } = React

// ---------------------------------------------------------------------------
// 错误码/宿主 reason → 中文文案（与 index.js 校验 reason、tools 稳定码一一对应）
// ---------------------------------------------------------------------------

export const MATERIAL_ERROR_REASON_COPY = {
  // 宿主校验 reason（index.js 9 个 material handler）
  idempotency_key_required: '缺少受理幂等键，请重试',
  INVALID_IDEMPOTENCY_KEY: '受理键格式不正确，请重新发起',
  CONFIRMATION_REQUIRED: '缺少确认标记，请重新提交',
  INVALID_HOMEPAGE_URL: '主页链接必须是 https://douyin.com 或其子页面地址',
  INVALID_SORT: '排序字段不正确，请刷新后重试',
  VALIDATION_ERROR: '提交的参数不完整或不合法，请检查后重试',
  // tools 稳定码（ALLOWED_ERROR_CODES 白名单内）+ 通用码
  VIRAL_VIDEO_NO_ACTIVE_SEEDS: '暂无启用的关键词与对标账号种子，请先在种子管理页添加',
  VIRAL_VIDEO_ACTIVE_RUN_EXISTS: '已有进行中的采集任务，请等待其完成后再发起',
  VIRAL_VIDEO_SEED_LIMIT_INVALID: '种子数量或上限参数不合法，请检查后重试',
  VIRAL_VIDEO_SEARCH_DISPATCH_FAILED: '采集任务派发失败，请稍后重试',
  // 轮询/受理态 run 不存在（tools ASYNC_RUN_NOT_FOUND，白名单既有码；原名
  // VIRAL_VIDEO_RUN_NOT_FOUND 是笔误，永不命中）。
  ASYNC_RUN_NOT_FOUND: '采集任务不存在或已被清理',
  IDEMPOTENCY_CONFLICT: '请求与该受理键的历史记录不一致，请刷新后重试',
  IDEMPOTENCY_IN_PROGRESS: '同一请求正在处理中，请稍后查看结果',
  IDEMPOTENCY_OUTCOME_UNKNOWN: '请求结果未知，请稍后刷新查看',
  ONEAPI_BUDGET_EXHAUSTED: '搜索额度已用完，请明天再试',
  PROVIDER_ERROR: '上游搜索服务异常，请稍后重试',
  douyin_operation_request_failed: '请求失败，请检查网络后重试',
}

export function materialErrorCopy(reason) {
  return MATERIAL_ERROR_REASON_COPY[reason] || '操作失败，请稍后重试'
}

// ---------------------------------------------------------------------------
// 本地格式化（NULL/缺失一律「—」）
// ---------------------------------------------------------------------------

const DASH = '—'

const matNum = value => (typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : DASH)
const matText = value => (value === null || value === undefined || value === '' ? DASH : String(value))
// interactionRate 为 0–1 比率（服务端热度评分口径），展示层统一 ×100 两位小数。
const matRate = value => (typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : DASH)
const matDateTime = iso => (typeof iso === 'string' && iso ? iso.slice(0, 16).replace('T', ' ') : DASH)

const matDuration = seconds => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return DASH
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`
}

const RUN_STATUS_META = {
  completed: ['已完成', 'ydo-mat-status-success'],
  partial_failed: ['部分完成', 'ydo-mat-status-partial'],
  failed: ['失败', 'ydo-mat-status-error'],
  running: ['进行中', 'ydo-mat-status-partial'],
  queued: ['排队中', 'ydo-mat-status-muted'],
}

export function materialStatusPill(status) {
  const [label, className] = RUN_STATUS_META[status] || [matText(status), 'ydo-mat-status-muted']
  return h('span', { className: `ydo-mat-status ${className}` }, label)
}

const INPUT_FORM_LABEL = { douyin_id: '抖音号', homepage_url: '主页链接', sec_user_id: 'sec_user_id' }

const LEVEL_CLASS = { S: 'ydo-mat-level-s', A: 'ydo-mat-level-a', B: 'ydo-mat-level-b', C: 'ydo-mat-level-c' }

// 对标账号 seedId → 显示名（种子列表传入，候选行来源列解析用）。
const seedAccountName = (seedAccounts, accountSeedId) => {
  if (!accountSeedId) return DASH
  const rows = Array.isArray(seedAccounts) ? seedAccounts : []
  const row = rows.find(item => item && item.accountSeedId === accountSeedId)
  return (row && row.displayName) || accountSeedId
}

// ---------------------------------------------------------------------------
// 样式（与 report-ui 的 REPORT_CSS_TEXT 同形态；前缀 ydo-mat- 避免与既有类冲突）
// ---------------------------------------------------------------------------

export const MATERIAL_CSS_TEXT = `
.ydo-mat-page{display:flex;flex-direction:column;gap:14px;min-width:0}
.ydo-mat-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1,#dee0e3);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);width:fit-content}
.ydo-mat-seg button{height:30px;padding:0 14px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#646a73);font:inherit;font-size:12px;cursor:pointer}
.ydo-mat-seg button[aria-current]{background:var(--dsw-alias-brand-primary,#0f1115);color:#fff;font-weight:650}
.ydo-mat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ydo-mat-title{margin:0;font-size:15px;font-weight:650}
.ydo-mat-sub{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
/* 按钮（§6.5）：primary 深色 40px / secondary 浅色 36px / link 30px */
.ydo-mat-primary{display:inline-flex;height:40px;align-items:center;gap:6px;padding:0 16px;border:0;border-radius:8px;background:var(--dsw-alias-brand-primary,#0f1115);color:#fff;font:inherit;font-size:13px;font-weight:650;cursor:pointer}
.ydo-mat-primary:disabled{opacity:.45;cursor:not-allowed}
.ydo-mat-secondary{display:inline-flex;height:36px;align-items:center;gap:6px;padding:0 14px;border:1px solid var(--dsw-alias-border-l1,#dee0e3);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;cursor:pointer}
.ydo-mat-secondary:disabled{opacity:.45;cursor:not-allowed}
.ydo-mat-link{height:30px;padding:0 4px;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#0f1115);font:inherit;font-size:12px;cursor:pointer}
.ydo-mat-link:disabled{opacity:.45;cursor:not-allowed}
.ydo-mat-danger{color:#d83931}
/* KPI 五卡（demo 口径：素材域累计 + 最新批次投影） */
.ydo-mat-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.ydo-mat-kpi{border:1px solid var(--dsw-alias-border-l1,#dee0e3);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1,#fff)}
.ydo-mat-kpi-label{margin:0;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
.ydo-mat-kpi-value{margin:6px 0 0;font-size:22px;font-weight:700;line-height:1.2}
.ydo-mat-kpi-foot{margin:4px 0 0;color:var(--dsw-alias-label-secondary,#646a73);font-size:11px}
/* 筛选条 */
.ydo-mat-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ydo-mat-filters input[type="text"],.ydo-mat-filters select,.ydo-mat-form input[type="text"],.ydo-mat-form input[type="number"],.ydo-mat-form select{height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#dee0e3);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px}
.ydo-mat-filters input[type="text"]{width:200px}
/* 表格 */
.ydo-mat-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1,#dee0e3);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff)}
.ydo-mat-table{width:100%;border-collapse:collapse;font-size:13px}
.ydo-mat-table th{text-align:left;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#dee0e3);color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;font-weight:600;white-space:nowrap;background:var(--dsw-alias-bg-layer-2,#f5f6f7)}
.ydo-mat-table td{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#f0f1f3);vertical-align:top}
.ydo-mat-table tr:last-child td{border-bottom:0}
.ydo-mat-table td.num,.ydo-mat-table th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ydo-mat-cover{width:56px;height:72px;object-fit:cover;border-radius:8px;display:block}
.ydo-mat-cover-placeholder{width:56px;height:72px;display:grid;place-items:center;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f5f6f7);color:var(--dsw-alias-label-secondary,#646a73)}
.ydo-mat-video-title{margin:0;font-weight:650;line-height:1.45;max-width:260px}
.ydo-mat-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.ydo-mat-tag{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f5f6f7);color:var(--dsw-alias-label-secondary,#646a73);font-size:11px}
.ydo-mat-tag-miss{color:#de7802}
.ydo-mat-score{font-weight:700;font-size:15px}
.ydo-mat-level{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:6px;font-size:11px;font-weight:700;color:#fff}
.ydo-mat-level-s{background:#d83931}
.ydo-mat-level-a{background:#de7802}
.ydo-mat-level-b{background:#2f66d0}
.ydo-mat-level-c{background:#8f959e}
.ydo-mat-mini{color:var(--dsw-alias-label-secondary,#646a73);font-size:11px}
.ydo-mat-source{display:flex;flex-direction:column;gap:2px;font-size:12px}
.ydo-mat-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ydo-mat-actions-col{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
/* 状态徽标 */
.ydo-mat-status{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;white-space:nowrap}
.ydo-mat-status-success{background:#e5f3ea;color:#157347}
.ydo-mat-status-partial{background:#fdf1e2;color:#b45805}
.ydo-mat-status-error{background:#fce8e6;color:#c5221f}
.ydo-mat-status-muted{background:var(--dsw-alias-bg-layer-2,#f5f6f7);color:var(--dsw-alias-label-secondary,#646a73)}
/* 进行中横幅 / 分页 / 空态 */
.ydo-mat-active{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px dashed #de7802;border-radius:10px;background:#fdf8ef;font-size:13px}
.ydo-mat-spinner{width:14px;height:14px;border:2px solid #de7802;border-top-color:transparent;border-radius:50%;animation:ydo-mat-spin 1s linear infinite;flex:none}
@keyframes ydo-mat-spin{to{transform:rotate(360deg)}}
.ydo-mat-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
.ydo-mat-empty{padding:32px;text-align:center;color:var(--dsw-alias-label-secondary,#646a73);font-size:13px}
.ydo-mat-error{margin:0;padding:10px 14px;border:1px solid #f3c8c5;border-radius:10px;background:#fce8e6;color:#c5221f;font-size:13px}
/* 抽屉（评分理由） */
.ydo-mat-drawer-overlay{position:fixed;inset:0;z-index:560;background:rgba(15,17,21,.4)}
.ydo-mat-drawer{position:fixed;top:0;right:0;bottom:0;z-index:561;width:min(420px,92vw);display:flex;flex-direction:column;gap:12px;padding:20px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:-8px 0 24px rgba(15,17,21,.16);overflow:auto}
.ydo-mat-drawer h3{margin:0;font-size:15px}
.ydo-mat-drawer-close{position:absolute;top:14px;right:14px}
.ydo-mat-reason-list{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.ydo-mat-reason-item{padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f5f6f7);font-size:12px;line-height:1.6}
/* 弹层（种子/采集/失败明细） */
.ydo-mat-modal-overlay{position:fixed;inset:0;z-index:570;display:grid;place-items:center;background:rgba(15,17,21,.4)}
.ydo-mat-modal{width:min(480px,92vw);max-height:86vh;overflow:auto;display:flex;flex-direction:column;gap:14px;padding:20px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 12px 32px rgba(15,17,21,.2)}
.ydo-mat-modal h3{margin:0;font-size:15px}
.ydo-mat-modal-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.ydo-mat-modal-close{width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#646a73);font-size:18px;line-height:1;cursor:pointer}
.ydo-mat-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#1f2329)}
.ydo-mat-form{display:grid;gap:10px}
.ydo-mat-field{display:grid;gap:4px}
.ydo-mat-field>span{color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
.ydo-mat-form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ydo-mat-modal-actions{display:flex;justify-content:flex-end;gap:10px}
.ydo-mat-failure-grid{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;line-height:1.6}
.ydo-mat-failure-grid b{color:var(--dsw-alias-label-secondary,#646a73);font-weight:600}
.ydo-mat-hint{margin:0;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;line-height:1.6}
@media (max-width:900px){.ydo-mat-form-row{grid-template-columns:1fr}}
`

// ---------------------------------------------------------------------------
// KPI 五卡（demo renderKpis 口径）：素材域累计 + 最新批次投影
// ---------------------------------------------------------------------------

export function MaterialKpiCards({ kpi }) {
  // kpi = { total: number|null, latest: run 投影|null }（client.js 组装）
  const latest = kpi && kpi.latest
  const levels = latest && latest.hotLevelSummary && typeof latest.hotLevelSummary === 'object'
    ? latest.hotLevelSummary
    : {}
  const s = typeof levels.S === 'number' ? levels.S : null
  const a = typeof levels.A === 'number' ? levels.A : null
  const statusLabel = latest ? (RUN_STATUS_META[latest.runStatus] || [latest.runStatus])[0] : null
  return h('div', { className: 'ydo-mat-kpis' },
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, '候选素材'),
      h('p', { className: 'ydo-mat-kpi-value' }, matNum(kpi ? kpi.total : null)),
      h('p', { className: 'ydo-mat-kpi-foot' }, '素材域累计')),
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, 'S / A 档候选'),
      h('p', { className: 'ydo-mat-kpi-value' }, s === null && a === null ? DASH : `${s ?? 0} / ${a ?? 0}`),
      h('p', { className: 'ydo-mat-kpi-foot' }, latest ? '最新批次分布' : '暂无批次')),
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, '本轮新增入库'),
      h('p', { className: 'ydo-mat-kpi-value' }, latest ? matNum(latest.newVideos) : DASH),
      h('p', { className: 'ydo-mat-kpi-foot' }, latest ? `发现 ${matNum(latest.discovered)} · 入库 ${matNum(latest.candidatesInserted)}` : '最新批次')),
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, '晋升候选'),
      h('p', { className: 'ydo-mat-kpi-value' }, latest ? matNum(latest.promotedCandidates) : DASH),
      h('p', { className: 'ydo-mat-kpi-foot' }, latest ? `去重跳过 ${matNum(latest.duplicatesSkipped)}` : '最新批次')),
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, '最近采集'),
      h('p', { className: 'ydo-mat-kpi-value' }, latest ? (latest.startedAt ? matDateTime(latest.startedAt).slice(5) : DASH) : DASH),
      h('p', { className: 'ydo-mat-kpi-foot' }, latest ? `手动采集 · ${statusLabel}` : '手动采集')))
}

// ---------------------------------------------------------------------------
// 筛选条（demo data-filter 同款：变化即查，q 由 client.js 防抖）
// ---------------------------------------------------------------------------

const SOURCE_KIND_OPTIONS = [
  ['', '全部来源'],
  ['keyword', '仅关键词命中'],
  ['account', '仅对标账号命中'],
  ['both', '双源同时命中'],
]
const PUBLISHED_RANGE_OPTIONS = [
  ['7d', '近 7 天'],
  ['30d', '近 30 天'],
  ['90d', '近 90 天'],
  ['all', '全部时间'],
]
const SORT_OPTIONS = [
  ['hot', '热度排序'],
  ['latest', '采集最新'],
  ['published_at', '发布时间'],
  ['play_count', '播放量'],
  ['like_count', '点赞量'],
  ['comment_count', '评论量'],
  ['share_count', '分享量'],
  ['collect_count', '收藏量'],
  ['interaction_rate', '互动率'],
]

export function MaterialFilterBar({ filters, facets, onChange, onRefresh, loading }) {
  const tags = Array.isArray(facets) ? facets : []
  const patch = (key, value) => onChange({ ...filters, [key]: value, offset: 0 })
  return h('div', { className: 'ydo-mat-filters' },
    h('input', {
      type: 'text', value: filters.q, placeholder: '搜索标题 / 关键词',
      'aria-label': '搜索素材', onChange: event => patch('q', event.target.value),
    }),
    h('select', { value: filters.minLevel, 'aria-label': '最低档位', onChange: event => patch('minLevel', event.target.value) },
      h('option', { value: '' }, '全部档位'),
      ...['S', 'A', 'B', 'C'].map(level => h('option', { value: level }, `${level} 档及以上`))),
    h('select', { value: filters.sourceKind, 'aria-label': '来源类型', onChange: event => patch('sourceKind', event.target.value) },
      ...SOURCE_KIND_OPTIONS.map(([value, label]) => h('option', { value }, label))),
    h('select', { value: filters.publishedRange, 'aria-label': '发布时间', onChange: event => patch('publishedRange', event.target.value) },
      ...PUBLISHED_RANGE_OPTIONS.map(([value, label]) => h('option', { value }, label))),
    h('select', { value: filters.tag, 'aria-label': '标签', onChange: event => patch('tag', event.target.value) },
      h('option', { value: '' }, '全部标签'),
      ...tags.map(item => h('option', { value: item.tag }, `${item.tag}（${item.count}）`))),
    h('select', { value: filters.sortBy, 'aria-label': '排序', onChange: event => patch('sortBy', event.target.value) },
      ...SORT_OPTIONS.map(([value, label]) => h('option', { value }, label))),
    h('button', { type: 'button', className: 'ydo-mat-secondary', disabled: loading, onClick: onRefresh }, '刷新'))
}

// ---------------------------------------------------------------------------
// 候选看板表（demo boardRow 口径：封面/视频信息/评分/指标五列/发布/来源/操作）
// ---------------------------------------------------------------------------

function BoardRow({ row, seedAccounts, onOpenReason }) {
  const tags = Array.isArray(row.tags) && row.tags.length ? row.tags : null
  const matches = Array.isArray(row.sourceMatches) ? row.sourceMatches : []
  const seen = new Set()
  const sourceLines = []
  for (const match of matches) {
    if (!match) continue
    if (match.keyword && !seen.has(`k:${match.keyword}`)) {
      seen.add(`k:${match.keyword}`)
      sourceLines.push(h('span', { key: `k:${match.keyword}` }, `关键词：${match.keyword}`))
    }
    if (match.accountSeedId && !seen.has(`a:${match.accountSeedId}`)) {
      seen.add(`a:${match.accountSeedId}`)
      sourceLines.push(h('span', { key: `a:${match.accountSeedId}`, className: 'ydo-mat-mini' }, `对标账号：${seedAccountName(seedAccounts, match.accountSeedId)}`))
    }
  }
  return h('tr', null,
    h('td', null, row.coverUrl
      ? h('img', { className: 'ydo-mat-cover', src: row.coverUrl, alt: '封面', loading: 'lazy', referrerPolicy: 'no-referrer' })
      : h('div', { className: 'ydo-mat-cover-placeholder' }, DASH)),
    h('td', null,
      h('p', { className: 'ydo-mat-video-title' }, matText(row.title)),
      h('div', { className: 'ydo-mat-tags' }, tags
        ? tags.map((tag, index) => h('span', { key: `${tag}:${index}`, className: 'ydo-mat-tag' }, String(tag)))
        : h('span', { className: 'ydo-mat-tag ydo-mat-tag-miss' }, '标签未返回'))),
    h('td', null,
      h('span', { className: 'ydo-mat-score' }, matNum(row.hotScore)),
      row.hotLevel ? h('span', { className: `ydo-mat-level ${LEVEL_CLASS[row.hotLevel] || 'ydo-mat-level-c'}` }, String(row.hotLevel)) : null,
      h('div', { className: 'ydo-mat-mini' }, `${matText(row.scoreRuleVersion)} · ${Array.isArray(row.scoreReasons) ? row.scoreReasons.length : 0} 项理由`)),
    h('td', { className: 'num' }, matNum(row.playCount)),
    h('td', { className: 'num' }, matNum(row.likeCount)),
    h('td', { className: 'num' }, matNum(row.commentCount)),
    h('td', { className: 'num' }, matNum(row.collectCount)),
    h('td', { className: 'num' }, matNum(row.shareCount)),
    h('td', { className: 'num' }, matRate(row.interactionRate)),
    h('td', null, typeof row.publishedAt === 'string' && row.publishedAt ? row.publishedAt.slice(0, 10) : DASH),
    h('td', null, h('div', { className: 'ydo-mat-source' }, sourceLines.length ? sourceLines : h('span', { className: 'ydo-mat-mini' }, DASH))),
    h('td', null, h('div', { className: 'ydo-mat-actions' },
      h('button', { type: 'button', className: 'ydo-mat-primary', onClick: () => onOpenReason(row) }, '评分理由'))))
}

export function MaterialBoardTable({ board, seedAccounts, onOpenReason, onPage }) {
  const rows = board && Array.isArray(board.rows) ? board.rows : []
  const total = board && typeof board.total === 'number' ? board.total : null
  const offset = board ? board.offset || 0 : 0
  const limit = board ? board.limit || 20 : 20
  const pages = total !== null ? Math.max(1, Math.ceil(total / limit)) : null
  const page = Math.floor(offset / limit) + 1
  return h('div', null,
    board && board.errorReason
      ? h('p', { className: 'ydo-mat-error', role: 'alert' }, materialErrorCopy(board.errorReason))
      : null,
    h('div', { className: 'ydo-mat-table-wrap' },
      h('table', { className: 'ydo-mat-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, '封面'), h('th', null, '视频'), h('th', null, '热度评分'),
            h('th', { className: 'num' }, '播放'), h('th', { className: 'num' }, '点赞'),
            h('th', { className: 'num' }, '评论'), h('th', { className: 'num' }, '收藏'),
            h('th', { className: 'num' }, '分享'), h('th', { className: 'num' }, '互动率'),
            h('th', null, '发布日期'), h('th', null, '命中来源'), h('th', null, '操作'))),
        h('tbody', null, rows.length
          ? rows.map((row, index) => h(BoardRow, { key: row.candidateId || row.awemeId || `row:${index}`, row, seedAccounts, onOpenReason }))
          : h('tr', null,
            h('td', { colSpan: 12 },
              h('p', { className: 'ydo-mat-empty' }, board && board.loaded && !board.loading
                ? '暂无素材候选；可先在种子管理页添加关键词 / 对标账号，再点采集记录页「立即采集」。'
                : '素材候选加载中…')))))),
    h('div', { className: 'ydo-mat-meta' },
      h('span', null, total !== null ? `共 ${matNum(total)} 条 · 第 ${page} / ${pages} 页` : '统计加载中…'),
      h('div', { className: 'ydo-mat-actions' },
        h('button', { type: 'button', className: 'ydo-mat-secondary', disabled: !rows.length || offset <= 0, onClick: () => onPage(offset - limit) }, '上一页'),
        h('button', { type: 'button', className: 'ydo-mat-secondary', disabled: total === null || offset + limit >= total, onClick: () => onPage(offset + limit) }, '下一页'))))
}

// ---------------------------------------------------------------------------
// 评分理由抽屉（demo openReason 口径：候选基础信息 + scoreReasons 逐条列表）
// ---------------------------------------------------------------------------

export function MaterialReasonDrawer({ row, onClose }) {
  if (!row) return null
  const reasons = Array.isArray(row.scoreReasons) ? row.scoreReasons : []
  return h('div', null,
    h('div', { className: 'ydo-mat-drawer-overlay', onClick: onClose }),
    h('aside', { className: 'ydo-mat-drawer', role: 'dialog', 'aria-modal': true, 'aria-label': '评分理由' },
      h('button', { type: 'button', className: 'ydo-mat-secondary ydo-mat-drawer-close', onClick: onClose }, '关闭'),
      h('h3', null, '评分理由'),
      h('p', { className: 'ydo-mat-hint' }, matText(row.title)),
      h('div', { className: 'ydo-mat-failure-grid' },
        h('b', null, '热度评分'), h('span', null, `${matNum(row.hotScore)}（${matText(row.hotLevel)} 档）`),
        h('b', null, '规则版本'), h('span', null, matText(row.scoreRuleVersion)),
        h('b', null, '发布日期'), h('span', null, typeof row.publishedAt === 'string' && row.publishedAt ? row.publishedAt.slice(0, 10) : DASH),
        h('b', null, '视频链接'), h('span', null, matText(row.shareUrl))),
      h('h3', null, `命中理由（${reasons.length}）`),
      reasons.length
        ? h('ul', { className: 'ydo-mat-reason-list' },
          ...reasons.map((reason, index) => h('li', { key: `${index}:${reason}`, className: 'ydo-mat-reason-item' }, matText(reason))))
        : h('p', { className: 'ydo-mat-hint' }, '该候选没有评分理由明细。')))
}

// ---------------------------------------------------------------------------
// 种子管理（关键词 + 对标账号两表；demo renderKeywords/renderAccounts 口径）
// ---------------------------------------------------------------------------

export function MaterialKeywordsTable({ rows, onAdd, onEdit, onToggle }) {
  const list = Array.isArray(rows) ? rows : []
  return h('section', { 'aria-label': '关键词种子' },
    h('div', { className: 'ydo-mat-head' },
      h('div', null,
        h('h3', { className: 'ydo-mat-title' }, `关键词种子（${matNum(list.length)}）`),
        h('p', { className: 'ydo-mat-sub' }, '采集记录页「立即采集」按优先级 P1→P5 依次消耗启用中的关键词。')),
      h('button', { type: 'button', className: 'ydo-mat-primary', onClick: onAdd }, '新增关键词')),
    h('div', { className: 'ydo-mat-table-wrap' },
      h('table', { className: 'ydo-mat-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, '关键词'), h('th', null, '状态'), h('th', null, '优先级'),
            h('th', { className: 'num' }, '日上限'), h('th', { className: 'num' }, '累计搜索'),
            h('th', null, '最近更新'), h('th', null, '操作'))),
        h('tbody', null, list.length
          ? list.map(row => h('tr', { key: row.seedId },
            h('td', null, matText(row.keyword)),
            h('td', null, h('span', { className: `ydo-mat-status ${row.status === 'active' ? 'ydo-mat-status-success' : 'ydo-mat-status-muted'}` }, row.status === 'active' ? '启用' : '禁用')),
            h('td', null, matText(row.priority)),
            h('td', { className: 'num' }, matNum(row.dailyLimit)),
            h('td', { className: 'num' }, matNum(row.searchCount)),
            h('td', null, matDateTime(row.updatedAt)),
            h('td', null, h('div', { className: 'ydo-mat-actions' },
              h('button', { type: 'button', className: 'ydo-mat-secondary', onClick: () => onEdit(row) }, '编辑'),
              h('button', { type: 'button', className: 'ydo-mat-link', onClick: () => onToggle(row) }, row.status === 'active' ? '禁用' : '启用')))))
          : h('tr', null, h('td', { colSpan: 7 }, h('p', { className: 'ydo-mat-empty' }, '暂无关键词种子；点右上「新增关键词」添加。')))))),
    h('p', { className: 'ydo-mat-hint' }, '分类由服务端维护（页面不展示、不修改）；编辑只更新上述字段，未填写的上限保持服务端原值。'))
}

export function MaterialAccountsTable({ rows, onAdd, onEdit, onToggle }) {
  const list = Array.isArray(rows) ? rows : []
  return h('section', { 'aria-label': '对标账号种子' },
    h('div', { className: 'ydo-mat-head' },
      h('div', null,
        h('h3', { className: 'ydo-mat-title' }, `对标账号种子（${matNum(list.length)}）`),
        h('p', { className: 'ydo-mat-sub' }, '支持抖音号 / 主页链接 / sec_user_id 三种输入；解析由服务端异步完成。')),
      h('button', { type: 'button', className: 'ydo-mat-primary', onClick: onAdd }, '新增对标账号')),
    h('div', { className: 'ydo-mat-table-wrap' },
      h('table', { className: 'ydo-mat-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, '账号输入'), h('th', null, '显示名'), h('th', null, '输入类型'),
            h('th', null, '解析状态'), h('th', null, '状态'),
            h('th', null, '最近采集'), h('th', null, '操作'))),
        h('tbody', null, list.length
          ? list.map(row => h('tr', {
            key: row.accountSeedId,
            title: row.lastResolutionError && typeof row.lastResolutionError === 'object'
              ? `最近解析失败：${row.lastResolutionError.reason || '未知原因'}`
              : undefined,
          },
          h('td', null, matText(row.inputValue)),
          h('td', null, matText(row.displayName)),
          h('td', null, matText(INPUT_FORM_LABEL[row.inputForm] || row.inputForm)),
          h('td', null, row.resolved
            ? h('span', { className: 'ydo-mat-status ydo-mat-status-success' }, '已解析')
            : h('span', { className: `ydo-mat-status ${row.verificationStatus === 'resolution_failed' ? 'ydo-mat-status-error' : 'ydo-mat-status-muted'}` }, row.verificationStatus === 'resolution_failed' ? '解析失败' : '未解析')),
          h('td', null, h('span', { className: `ydo-mat-status ${row.status === 'active' ? 'ydo-mat-status-success' : 'ydo-mat-status-muted'}` }, row.status === 'active' ? '启用' : '禁用')),
          h('td', null, matDateTime(row.lastContentFetchedAt)),
          h('td', null, h('div', { className: 'ydo-mat-actions' },
            h('button', { type: 'button', className: 'ydo-mat-secondary', onClick: () => onEdit(row) }, '编辑'),
            h('button', { type: 'button', className: 'ydo-mat-link', onClick: () => onToggle(row) }, row.status === 'active' ? '禁用' : '启用')))))
          : h('tr', null, h('td', { colSpan: 7 }, h('p', { className: 'ydo-mat-empty' }, '暂无对标账号种子；点右上「新增对标账号」添加。')))))))}


// ---------------------------------------------------------------------------
// 种子弹窗（新增/编辑关键词或账号；React.useState 局部表单，modal=null 卸载重置）
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4', 'P5']

function SeedModal({ mode, row, busy, errorReason, onConfirm, onClose }) {
  const isKeyword = mode === 'keyword'
  const editing = Boolean(row)
  const [keyword, setKeyword] = React.useState(row ? row.keyword || '' : '')
  const [displayName, setDisplayName] = React.useState(row ? row.displayName || '' : '')
  const [inputForm, setInputForm] = React.useState(row ? row.inputForm || 'douyin_id' : 'douyin_id')
  const [inputValue, setInputValue] = React.useState(row ? row.inputValue || '' : '')
  const [priority, setPriority] = React.useState(row && row.priority ? row.priority : 'P1')
  const [status, setStatus] = React.useState(row && row.status ? row.status : 'active')
  const [dailyLimit, setDailyLimit] = React.useState(row && row.dailyLimit !== null && row.dailyLimit !== undefined ? String(row.dailyLimit) : '')
  const [maxVideos, setMaxVideos] = React.useState(row && row.maxVideos !== null && row.maxVideos !== undefined ? String(row.maxVideos) : '')
  const submit = () => {
    if (busy) return
    const payload = { priority, status }
    if (isKeyword) {
      payload.keyword = keyword.trim()
      const limit = Number(dailyLimit)
      payload.dailyLimit = dailyLimit.trim() && Number.isFinite(limit) && limit > 0 ? limit : null
    } else {
      payload.displayName = displayName.trim()
      payload.inputForm = inputForm
      payload.inputValue = inputValue.trim()
      const max = Number(maxVideos)
      payload.maxVideos = maxVideos.trim() && Number.isFinite(max) && max > 0 ? max : null
    }
    onConfirm(payload)
  }
  return h('div', { className: 'ydo-mat-modal-overlay', onClick: event => { if (event.target === event.currentTarget && !busy) onClose() } },
    h('div', { className: 'ydo-mat-modal', role: 'dialog', 'aria-modal': true, 'aria-label': editing ? `编辑${isKeyword ? '关键词' : '对标账号'}` : `新增${isKeyword ? '关键词' : '对标账号'}` },
      h('h3', null, editing ? `编辑${isKeyword ? '关键词' : '对标账号'}` : `新增${isKeyword ? '关键词' : '对标账号'}`),
      h('div', { className: 'ydo-mat-form' },
        isKeyword
          ? h('label', { className: 'ydo-mat-field' },
            h('span', null, editing ? '关键词（编辑时锁定；改文本等于新增另一条）' : '关键词（必填）'),
            h('input', {
              type: 'text', value: keyword, placeholder: '如 增程车对比', disabled: busy || editing,
              onChange: event => setKeyword(event.target.value),
            }))
          : [
            h('div', { className: 'ydo-mat-form-row', key: 'account-row-1' },
              h('label', { className: 'ydo-mat-field' },
                h('span', null, '显示名（可选）'),
                h('input', { type: 'text', value: displayName, placeholder: '账号备注名', disabled: busy, onChange: event => setDisplayName(event.target.value) })),
              h('label', { className: 'ydo-mat-field' },
                h('span', null, editing ? '输入类型（编辑时锁定）' : '输入类型'),
                h('select', { value: inputForm, disabled: busy || editing, onChange: event => setInputForm(event.target.value) },
                  ...Object.entries(INPUT_FORM_LABEL).map(([value, label]) => h('option', { value }, label))))),
            h('label', { className: 'ydo-mat-field', key: 'account-row-2' },
              h('span', null, inputForm === 'homepage_url' ? '主页链接（https://douyin.com/…）' : '账号输入（必填）'),
              h('input', {
                type: 'text', value: inputValue, disabled: busy,
                placeholder: inputForm === 'homepage_url' ? 'https://www.douyin.com/user/…' : inputForm === 'sec_user_id' ? 'MS4wLjABAAAA…' : '抖音号',
                onChange: event => setInputValue(event.target.value),
              })),
          ],
        h('div', { className: 'ydo-mat-form-row' },
          h('label', { className: 'ydo-mat-field' },
            h('span', null, '优先级'),
            h('select', { value: priority, disabled: busy, onChange: event => setPriority(event.target.value) },
              ...PRIORITY_OPTIONS.map(value => h('option', { value }, value)))),
          h('label', { className: 'ydo-mat-field' },
            h('span', null, '状态'),
            h('select', { value: status, disabled: busy, onChange: event => setStatus(event.target.value) },
              h('option', { value: 'active' }, '启用'),
              h('option', { value: 'disabled' }, '禁用')))),
        isKeyword
          ? h('label', { className: 'ydo-mat-field' },
            h('span', null, '每日搜索上限（可选，留空保持服务端原值）'),
            h('input', { type: 'number', min: 1, value: dailyLimit, disabled: busy, onChange: event => setDailyLimit(event.target.value) }))
          : h('label', { className: 'ydo-mat-field' },
            h('span', null, '每次采集作品数上限（可选，留空保持服务端原值）'),
            h('input', { type: 'number', min: 1, value: maxVideos, disabled: busy, onChange: event => setMaxVideos(event.target.value) }))),
      errorReason ? h('p', { className: 'ydo-mat-error', role: 'alert' }, materialErrorCopy(errorReason)) : null,
      h('div', { className: 'ydo-mat-modal-actions' },
        h('button', { type: 'button', className: 'ydo-mat-secondary', disabled: busy, onClick: onClose }, '取消'),
        h('button', { type: 'button', className: 'ydo-mat-primary', disabled: busy, 'aria-busy': busy, onClick: submit }, busy ? '保存中…' : '确认保存'))))
}

// modal={mode,row} 展开后传给 SeedModal（顶层 mode/row）；busy/error 等接线态
// 由 client.js 注入。截图验收发现的缺陷：此前整包透传，SeedModal 顶层解构
// mode/row 恒 undefined，任何种子弹窗都渲染成「新增对标账号」空表单。
export const MaterialSeedModal = props => (props.modal
  ? h(SeedModal, { ...props.modal, busy: props.busy, errorReason: props.errorReason, onConfirm: props.onConfirm, onClose: props.onClose })
  : null)

// ---------------------------------------------------------------------------
// 采集记录（run 表 + 进行中横幅 + 立即采集；demo renderRuns 口径）
// ---------------------------------------------------------------------------

export function MaterialRunsTable({ runs, activeRun, collecting, errorReason, onStartCollect, onViewBoard, onOpenFailure, onRefresh }) {
  const list = Array.isArray(runs) ? runs : []
  return h('section', { 'aria-label': '采集记录' },
    h('div', { className: 'ydo-mat-head' },
      h('div', null,
        h('h3', { className: 'ydo-mat-title' }, `采集记录（${matNum(list.length)}）`),
        h('p', { className: 'ydo-mat-sub' }, '手动采集按启用种子派发 Worker 搜索；同一时间只允许一个采集任务。')),
      h('div', { className: 'ydo-mat-actions' },
        h('button', { type: 'button', className: 'ydo-mat-secondary', disabled: collecting, onClick: onRefresh }, '刷新'),
        h('button', { type: 'button', className: 'ydo-mat-primary', disabled: collecting || Boolean(activeRun), 'aria-busy': collecting, onClick: onStartCollect },
          collecting ? '提交中…' : '立即采集'))),
    activeRun
      ? h('div', { className: 'ydo-mat-active', role: 'status' },
        h('span', { className: 'ydo-mat-spinner', 'aria-hidden': true }),
        h('span', null, `采集任务进行中：${materialStatusPill(activeRun.status)} ${matDateTime(activeRun.startedAt)} · 完成后自动刷新看板`),
        activeRun.runId ? h('button', { type: 'button', className: 'ydo-mat-link', onClick: () => onViewBoard(activeRun.runId) }, '查看本批候选') : null)
      : null,
    errorReason ? h('p', { className: 'ydo-mat-error', role: 'alert' }, materialErrorCopy(errorReason)) : null,
    h('div', { className: 'ydo-mat-table-wrap' },
      h('table', { className: 'ydo-mat-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, '状态'), h('th', null, '开始时间'), h('th', { className: 'num' }, '耗时'),
            h('th', { className: 'num' }, '关键词'), h('th', { className: 'num' }, '账号'),
            h('th', { className: 'num' }, '任务成功/失败'), h('th', { className: 'num' }, '新增/晋升'),
            h('th', null, '档位分布'), h('th', null, '操作'))),
        h('tbody', null, list.length
          ? list.map(row => {
            const levels = row.hotLevelSummary && Object.keys(row.hotLevelSummary).length
              ? ['S', 'A', 'B', 'C'].map(level => `${level} ${matNum(row.hotLevelSummary[level])}`).join(' · ')
              : null
            const hasFailures = (Array.isArray(row.failedKeywords) && row.failedKeywords.length)
              || (Array.isArray(row.failedAccounts) && row.failedAccounts.length)
            return h('tr', { key: row.runId },
              h('td', null, materialStatusPill(row.runStatus)),
              h('td', null, matDateTime(row.startedAt)),
              h('td', { className: 'num' }, matDuration(row.durationSeconds)),
              h('td', { className: 'num' }, matNum(row.keywordCount)),
              h('td', { className: 'num' }, matNum(row.accountCount)),
              h('td', { className: 'num' }, typeof row.succeededJobs === 'number' || typeof row.failedJobs === 'number'
                ? `${matNum(row.succeededJobs)} / ${matNum(row.failedJobs)}`
                : DASH),
              h('td', { className: 'num' }, typeof row.newVideos === 'number' || typeof row.promotedCandidates === 'number'
                ? `${matNum(row.newVideos)} / ${matNum(row.promotedCandidates)}`
                : DASH),
              h('td', null, levels || DASH),
              h('td', null, h('div', { className: 'ydo-mat-actions' },
                h('button', { type: 'button', className: 'ydo-mat-link', onClick: () => onViewBoard(row.runId) }, '查看看板'),
                hasFailures
                  ? h('button', { type: 'button', className: 'ydo-mat-link ydo-mat-danger', onClick: () => onOpenFailure(row) }, '失败明细')
                  : null)))
          })
          : h('tr', null, h('td', { colSpan: 9 }, h('p', { className: 'ydo-mat-empty' }, '暂无采集记录；点右上「立即采集」发起第一次素材采集。')))))))
}

// ---------------------------------------------------------------------------
// 采集参数弹窗（demo collect-modal 口径：展示启用种子规模 + 数量上限 + 最低档位）
// ---------------------------------------------------------------------------

function CollectModal({ activeKeywords, activeAccounts, busy, errorReason, onConfirm, onClose }) {
  const [keywordLimit, setKeywordLimit] = React.useState('')
  const [accountLimit, setAccountLimit] = React.useState('')
  const [candidateMinLevel, setCandidateMinLevel] = React.useState('B')
  const submit = () => {
    if (busy) return
    const keywordNumber = Number(keywordLimit)
    const accountNumber = Number(accountLimit)
    onConfirm({
      keywordLimit: keywordLimit.trim() && Number.isFinite(keywordNumber) && keywordNumber > 0 ? keywordNumber : null,
      accountLimit: accountLimit.trim() && Number.isFinite(accountNumber) && accountNumber > 0 ? accountNumber : null,
      candidateMinLevel,
    })
  }
  return h('div', { className: 'ydo-mat-modal-overlay', onClick: event => { if (event.target === event.currentTarget && !busy) onClose() } },
    h('div', { className: 'ydo-mat-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '发起素材采集' },
      h('h3', null, '发起素材采集'),
      h('p', { className: 'ydo-mat-hint' },
        `当前启用种子：关键词 ${matNum(activeKeywords)} 个 · 对标账号 ${matNum(activeAccounts)} 个。`
        + '任务按优先级 P1→P5 消耗启用种子；同一时间只允许一个采集任务。'),
      h('div', { className: 'ydo-mat-form' },
        h('div', { className: 'ydo-mat-form-row' },
          h('label', { className: 'ydo-mat-field' },
            h('span', null, '关键词数量上限（可选，默认全部启用关键词）'),
            h('input', { type: 'number', min: 1, value: keywordLimit, disabled: busy, onChange: event => setKeywordLimit(event.target.value) })),
          h('label', { className: 'ydo-mat-field' },
            h('span', null, '账号数量上限（可选，默认全部启用账号）'),
            h('input', { type: 'number', min: 1, value: accountLimit, disabled: busy, onChange: event => setAccountLimit(event.target.value) }))),
        h('label', { className: 'ydo-mat-field' },
          h('span', null, '候选晋升最低档位'),
          h('select', { value: candidateMinLevel, disabled: busy, onChange: event => setCandidateMinLevel(event.target.value) },
            ...['S', 'A', 'B', 'C'].map(value => h('option', { value }, `${value} 档`))))),
      errorReason ? h('p', { className: 'ydo-mat-error', role: 'alert' }, materialErrorCopy(errorReason)) : null,
      h('div', { className: 'ydo-mat-modal-actions' },
        h('button', { type: 'button', className: 'ydo-mat-secondary', disabled: busy, onClick: onClose }, '取消'),
        h('button', { type: 'button', className: 'ydo-mat-primary', disabled: busy, 'aria-busy': busy, onClick: submit }, busy ? '提交中…' : '确认采集'))))
}

export const MaterialCollectModal = props => (props.open ? h(CollectModal, props) : null)

// ---------------------------------------------------------------------------
// 失败明细弹窗（demo failure-modal 口径：关键词/账号两列）
// ---------------------------------------------------------------------------

export function MaterialFailureModal({ run, onClose }) {
  if (!run) return null
  const failedKeywords = Array.isArray(run.failedKeywords) ? run.failedKeywords : []
  const failedAccounts = Array.isArray(run.failedAccounts) ? run.failedAccounts : []
  const failedTotal = failedKeywords.length + failedAccounts.length
  return h('div', { className: 'ydo-mat-modal-overlay', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ydo-mat-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '失败明细' },
      h('div', { className: 'ydo-mat-modal-head' },
        h('h3', null, '失败明细'),
        h('button', { type: 'button', className: 'ydo-mat-modal-close', 'aria-label': '关闭', onClick: onClose }, '×')),
      h('div', { className: 'ydo-mat-failure-grid' },
        h('b', null, '批次'), h('span', null, matText(run.runId)),
        h('b', null, '状态'), h('span', null, materialStatusPill(run.runStatus)),
        h('b', null, '开始时间'), h('span', null, matDateTime(run.startedAt)),
        h('b', null, '耗时'), h('span', null, matDuration(run.durationSeconds)),
        h('b', null, '失败数量'), h('span', null, String(failedTotal))),
      failedKeywords.length || failedAccounts.length
        ? h('div', { className: 'ydo-mat-table-wrap' },
          h('table', { className: 'ydo-mat-table' },
            h('thead', null, h('tr', null, h('th', null, '类型'), h('th', null, '明细'))),
            h('tbody', null,
              h('tr', null, h('td', null, `失败关键词（${failedKeywords.length}）`), h('td', null, failedKeywords.join('、') || '—')),
              h('tr', null, h('td', null, `失败账号（${failedAccounts.length}）`), h('td', null, failedAccounts.join('、') || '—')))))
        : h('p', { className: 'ydo-mat-hint' }, '该批次没有失败明细。'),
      h('div', { className: 'ydo-mat-modal-actions' },
        h('button', { type: 'button', className: 'ydo-mat-secondary', onClick: onClose }, '关闭'))))
}

// ---------------------------------------------------------------------------
// 顶层页面：三子页 seg（看板/种子管理/采集记录）+ 弹层组装。
// section 是纯 UI 切换（local state）；数据与动作全部由 client.js 注入。
// ---------------------------------------------------------------------------

export function MaterialPage({
  board, kpi, facets, filters, seedAccounts, seeds, runs, activeRun, collecting,
  reason, seedModal, collectOpen, collectError, failure, savingSeed, seedError,
  runFilter, actions,
}) {
  const [section, setSection] = React.useState('board')
  const changeSection = next => {
    setSection(next)
    if (actions.onSectionChange) actions.onSectionChange(next)
  }
  return h('div', { className: 'ydo-mat-page' },
    h('div', { className: 'ydo-mat-head' },
      h('div', null,
        h('h2', { className: 'ydo-mat-title' }, '爆款素材看板'),
        h('p', { className: 'ydo-mat-sub' }, '关键词与对标账号双源采集的爆款素材候选池；评分口径由服务端统一配置（候选只读展示）。')),
      h('div', { className: 'ydo-mat-seg', role: 'tablist', 'aria-label': '素材看板子页' },
        h('button', { type: 'button', 'aria-current': section === 'board' || undefined, onClick: () => changeSection('board') }, '素材看板'),
        h('button', { type: 'button', 'aria-current': section === 'seeds' || undefined, onClick: () => changeSection('seeds') }, '种子管理'),
        h('button', { type: 'button', 'aria-current': section === 'runs' || undefined, onClick: () => changeSection('runs') }, '采集记录'))),
    section === 'board'
      ? [
        h(MaterialKpiCards, { key: 'kpi', kpi }),
        runFilter
          ? h('div', { key: 'run-filter', className: 'ydo-mat-active', role: 'status' },
            h('span', null, `按批次过滤：${runFilter}（看板只显示该批次命中的候选）`),
            h('button', { type: 'button', className: 'ydo-mat-link', onClick: actions.onClearRunFilter }, '清除过滤'))
          : null,
        h(MaterialFilterBar, {
          key: 'filters', filters, facets, loading: board && board.loading,
          onChange: actions.onFilterChange, onRefresh: actions.onRefreshBoard,
        }),
        h(MaterialBoardTable, {
          key: 'board', board, seedAccounts, onOpenReason: actions.onOpenReason, onPage: actions.onBoardPage,
        }),
      ]
      : null,
    section === 'seeds'
      ? [
        seeds && seeds.errorReason ? h('p', { key: 'seed-error', className: 'ydo-mat-error', role: 'alert' }, materialErrorCopy(seeds.errorReason)) : null,
        h(MaterialKeywordsTable, {
          key: 'keywords', rows: seeds && seeds.data ? seeds.data.keywords : [],
          onAdd: () => actions.onOpenSeedModal('keyword', null),
          onEdit: row => actions.onOpenSeedModal('keyword', row),
          onToggle: row => actions.onToggleSeed('keyword', row),
        }),
        h(MaterialAccountsTable, {
          key: 'accounts', rows: seeds && seeds.data ? seeds.data.accounts : [],
          onAdd: () => actions.onOpenSeedModal('account', null),
          onEdit: row => actions.onOpenSeedModal('account', row),
          onToggle: row => actions.onToggleSeed('account', row),
        }),
      ]
      : null,
    section === 'runs'
      ? h(MaterialRunsTable, {
        runs: runs && runs.rows, activeRun, collecting, errorReason: runs && runs.errorReason,
        onStartCollect: actions.onOpenCollect, onViewBoard: actions.onViewRunBoard,
        onOpenFailure: actions.onOpenFailure, onRefresh: actions.onRefreshRuns,
      })
      : null,
    h(MaterialReasonDrawer, { key: 'drawer', row: reason, onClose: actions.onCloseReason }),
    h(MaterialSeedModal, {
      key: 'seed-modal', modal: seedModal, busy: savingSeed, errorReason: seedError,
      onConfirm: actions.onSaveSeed, onClose: actions.onCloseSeedModal,
    }),
    h(MaterialCollectModal, {
      key: 'collect-modal', open: collectOpen,
      // 启用种子计数（demo 同款）：种子未加载为 null（显示「—」），已加载后缺桶
      // 即 0 个启用（桶由服务端按状态动态生成）。
      activeKeywords: seeds && seeds.data
        ? (typeof seeds.data.keywordByStatus?.active === 'number' ? seeds.data.keywordByStatus.active : 0)
        : null,
      activeAccounts: seeds && seeds.data
        ? (typeof seeds.data.accountByStatus?.active === 'number' ? seeds.data.accountByStatus.active : 0)
        : null,
      busy: collecting, errorReason: collectError,
      onConfirm: actions.onCollectConfirm, onClose: actions.onCloseCollect,
    }),
    h(MaterialFailureModal, { key: 'failure-modal', run: failure, onClose: actions.onCloseFailure }))
}
