// 爆款基因知识库 UI 模块（RQ-2026-010 阶段 5，UI 基准 docs/1103/douyin/ui-demo.html v3）。
// 与 material-ui.js 同法：模块内中文硬编码（仅 Tab 按钮文案 tabGene 走 client.js i18n），
// 构建脚本内联进 lib/client.js（顶部 CommonJS require 由构建剥离，React/h 由 client.js
// 顶部声明提供，hooks 以 React.xxx 形式使用）；本模块只做展示与本地格式化，不计算口径，
// NULL/未采集一律渲染「—」或「未采集」，绝不冒充 0。
//
// 样式（C7）：严格复用宿主既有类（ydo-tabs/ydo-toolbar/ydo-primary/ydo-secondary/
// ydo-panel/ydo-mat-*/ydo-report-works/ydo-report-work-card/ydo-report-seg*/ydo-work-cover*/
// ydo-ai-modal*/ydo-tags），新增仅 `ydo-gene-*` 前缀与维度色板（demo v3 终稿参数：
// chip 淡底 6% / 选中 16%、文字 42%/44%、深色主题微调）；深色主题由宿主注入
// --dsw-alias-* 变量驱动，模块内只带维度色板的 dark 微调规则（demo [data-theme=dark]
// 的宿主变量块不进插件）。

const React = require('react')
const { createElement: h } = React

// ---------------------------------------------------------------------------
// 维度色板与文案
// ---------------------------------------------------------------------------

// 维度色相（demo v3 终稿；仅前端展示，服务端不下发颜色）
const GENE_DIM_HUES = {
  category: '221',
  topic: '165',
  hook: '24',
  structure: '262',
  script: '345',
  shot: '192',
  bgm: '315',
  audience: '145',
  engagement: '45',
}

export const GENE_ERROR_REASON_COPY = {
  // 宿主校验 reason（index.js gene 五 handler）
  idempotency_key_required: '缺少受理幂等键，请重试',
  INVALID_IDEMPOTENCY_KEY: '受理键格式不正确，请重新发起',
  VALIDATION_ERROR: '提交的参数不完整或不合法，请检查后重试',
  // tools 稳定码（§6.4 错误码总表；通用码沿用既有文案）
  KNOWLEDGE_NOT_FOUND: '知识条目不存在或已被清理',
  GENE_NOT_READY: '该条目尚未完成基因提取，暂只能编辑备注',
  GENE_EXTRACT_RUNNING: '基因提取正在进行中，请稍后刷新查看',
  GENE_INPUT_MISSING: '拆解产物缺失，无法提取基因；请先重跑拆解',
  GENE_EXTRACT_MODEL_FAILED: '基因提取模型调用失败，请重试',
  GENE_EXTRACT_TIMEOUT: '基因提取超时，请重试（拆解结果不受影响）',
  GENE_EXTRACT_PARSE_FAILED: '模型输出解析失败，请重试',
  GENE_EXTRACT_QUALITY_FAILED: '提取结果未通过质量校验（品类必填、其余维度至少 4 个非空）；可重试',
  GENE_EXTRACT_LEASE_EXPIRED: '提取任务租约过期被回收，请重试',
  GENE_EXTRACT_DISABLED: '基因提取功能未启用，请联系管理员',
  IDEMPOTENCY_CONFLICT: '请求与该受理键的历史记录不一致，请刷新后重试',
  IDEMPOTENCY_IN_PROGRESS: '同一请求正在处理中，请稍后查看结果',
  IDEMPOTENCY_OUTCOME_UNKNOWN: '请求结果未知，请稍后刷新查看',
}

export function geneErrorCopy(reason) {
  if (!reason) return '操作失败，请稍后重试'
  return GENE_ERROR_REASON_COPY[reason] || '操作失败，请稍后重试'
}

// ---------------------------------------------------------------------------
// 本地格式化（自包含，不依赖 ui-format，避免同名导出混淆——material-ui 同法）
// ---------------------------------------------------------------------------

const GENE_DASH = '—'

function geneText(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return text.trim() ? text.trim() : GENE_DASH
}

function geneNum(value) {
  if (value === null || value === undefined) return GENE_DASH
  const num = Number(value)
  if (!Number.isFinite(num)) return GENE_DASH
  return num.toLocaleString('zh-CN')
}

function geneWan(value) {
  if (value === null || value === undefined) return GENE_DASH
  const num = Number(value)
  if (!Number.isFinite(num)) return GENE_DASH
  if (num >= 10000) {
    const wan = num / 10000
    const digits = wan >= 100 ? 0 : 1
    return `${wan.toFixed(digits).replace(/\.0$/, '')}w`
  }
  return String(num)
}

function geneDate(value) {
  return typeof value === 'string' && value ? value.slice(0, 10) : GENE_DASH
}

function geneDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return null
  const total = Math.max(0, Math.round(Number(seconds)))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

const GENE_ADOPTION_PILL = {
  ai_draft: ['ydo-mat-status ydo-mat-status-muted', 'AI 草稿'],
  adopted: ['ydo-mat-status ydo-mat-status-success', '已采纳'],
  revised: ['ydo-mat-status ydo-mat-status-success', '已修正'],
}
const GENE_FAILED_PILL = ['ydo-mat-status ydo-mat-status-error', '提取失败']

function adoptionPill(status) {
  const entry = GENE_ADOPTION_PILL[status]
  if (!entry) return ['ydo-mat-status ydo-mat-status-muted', geneText(status)]
  return entry
}

function statusPill(record) {
  if (record.geneStatus === 'failed') return GENE_FAILED_PILL
  // 重试受理后回到 pending/running 的条目显示「提取中」而非「AI 草稿」（P3-7）
  if (record.geneStatus === 'pending' || record.geneStatus === 'running') {
    return ['ydo-mat-status ydo-mat-status-muted', '提取中']
  }
  return adoptionPill(record.adoptionStatus)
}

/** 编辑人展示（§6.2/C5）：服务端本期恒写 system，渲染为「系统」；未来返回真实编辑人时原样展示。 */
function editorDisplay(value) {
  const text = geneText(value)
  return text === 'system' ? '系统' : text
}

function dimHue(dimId) {
  return GENE_DIM_HUES[dimId] || '221'
}

/** 详情报告「未采集」判定：字段缺失（null/undefined）渲染「未采集」，绝不造默认值（T5.4）。 */
function reportText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text : null
}

// ---------------------------------------------------------------------------
// 样式（demo v3 终稿逐类移植；仅 ydo-gene-* 与维度色板，复用类不在此重复声明）
// ---------------------------------------------------------------------------

export const GENE_CSS_TEXT = `
[data-h="221"]{--h:221}[data-h="165"]{--h:165}[data-h="24"]{--h:24}[data-h="262"]{--h:262}
[data-h="345"]{--h:345}[data-h="192"]{--h:192}[data-h="315"]{--h:315}[data-h="145"]{--h:145}[data-h="45"]{--h:45}
.ydo-gene-tag{display:inline-flex;align-items:center;padding:2px 8px;border-radius:6px;background:hsl(var(--h) 75% 50% / .13);color:hsl(var(--h) 58% 30%);font-size:11px;font-weight:600;line-height:18px;white-space:nowrap}
html[data-theme="dark"] .ydo-gene-tag{background:hsl(var(--h) 75% 60% / .2);color:hsl(var(--h) 85% 76%)}
.ydo-gene-chip{--h:221;display:inline-flex;align-items:center;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;border:1px solid hsl(var(--h) 70% 48% / .2);background:hsl(var(--h) 72% 50% / .06);color:hsl(var(--h) 42% 44%);cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}
.ydo-gene-chip:hover{background:hsl(var(--h) 72% 50% / .12);border-color:hsl(var(--h) 70% 46% / .4)}
.ydo-gene-chip[aria-pressed="true"],.ydo-gene-chip.is-selected{background:hsl(var(--h) 72% 50% / .16);border-color:hsl(var(--h) 70% 48% / .8);color:hsl(var(--h) 62% 26%)}
.ydo-gene-chip .chip-count{opacity:.66;margin-left:4px;font-weight:500}
.ydo-gene-chip[aria-pressed="true"] .chip-count,.ydo-gene-chip.is-selected .chip-count{opacity:.85}
html[data-theme="dark"] .ydo-gene-chip{background:hsl(var(--h) 72% 60% / .12);color:hsl(var(--h) 70% 82%);border-color:hsl(var(--h) 72% 60% / .24)}
html[data-theme="dark"] .ydo-gene-chip:hover{background:hsl(var(--h) 72% 60% / .19)}
html[data-theme="dark"] .ydo-gene-chip[aria-pressed="true"],html[data-theme="dark"] .ydo-gene-chip.is-selected{background:hsl(var(--h) 72% 60% / .22);border-color:hsl(var(--h) 72% 65% / .65);color:hsl(var(--h) 95% 88%)}
.ydo-gene-chip-remove{margin-left:5px;opacity:.8}
.ydo-gene-chip-remove:hover{opacity:1}
.ydo-gene-facet-more{display:inline-flex;align-items:center;height:22px;padding:0 9px;border:1px dashed color-mix(in srgb,var(--dsw-alias-label-secondary) 38%,transparent);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;font-weight:600;cursor:pointer}
.ydo-gene-facet-more:hover{border-style:solid;border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary)}
.ydo-gene-head-left{display:grid;gap:2px;min-width:0}
.ydo-gene-head-left h2{margin:0;font-size:16px}
.ydo-gene-alert{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px 0 10px;border:0;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 78%,var(--dsw-alias-label-primary));font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.ydo-gene-alert:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent)}
.ydo-gene-alert-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-error-primary)}
.ydo-gene-alert-count{min-width:16px;height:16px;display:grid;place-items:center;border-radius:999px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);font-size:10px;font-weight:700;padding:0 4px}
.ydo-gene-facet-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ydo-gene-facet-head h4{margin:0;flex:1}
.ydo-gene-facet-title-note{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400}
.ydo-gene-facet-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px 20px;margin-top:12px}
.ydo-gene-facet-body.is-collapsed{display:none}
.ydo-gene-facet-group{display:grid;gap:6px;align-content:start;min-width:0}
.ydo-gene-facet-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.ydo-gene-facet-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ydo-gene-selected{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}
.ydo-gene-selected.is-empty{display:none}
.ydo-gene-selected-label{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}
.ydo-gene-card{display:flex;flex-direction:column;gap:10px;text-align:left}
.ydo-gene-card-head{display:flex;gap:10px;align-items:flex-start}
.ydo-gene-card-main{display:grid;gap:4px;min-width:0;flex:1}
.ydo-gene-card-title{margin:0;font-size:13px;font-weight:650;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ydo-gene-card-meta{color:var(--dsw-alias-label-secondary);font-size:11px;display:flex;gap:8px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
.ydo-gene-card-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:0}
.ydo-gene-card-metrics dt{color:var(--dsw-alias-label-secondary);font-size:11px}
.ydo-gene-card-metrics dd{margin:0;font-size:14px;font-weight:650;font-variant-numeric:tabular-nums}
.ydo-gene-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.ydo-gene-cover-fallback{width:100%;height:100%;display:grid;place-items:center;font-size:11px;color:var(--dsw-alias-label-secondary);background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,var(--dsw-alias-bg-layer-2)))}
.ydo-gene-detail-head{display:flex;gap:14px;align-items:flex-start;padding:4px 44px 0 4px}
.ydo-gene-detail-main{display:grid;gap:6px;min-width:0;flex:1}
.ydo-gene-detail-title{margin:0;font-size:15px;line-height:1.4}
.ydo-gene-dims{display:grid;gap:14px}
.ydo-gene-dim{display:grid;gap:8px}
.ydo-gene-dim-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ydo-gene-dim-name{font-size:13.5px;font-weight:700}
.ydo-gene-textarea{min-height:72px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,#dee0e3);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:13px;resize:vertical}
.ydo-gene-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ydo-gene-note-block{border-top:1px dashed var(--dsw-alias-border-l1,#dee0e3);padding:10px 0 0;color:var(--dsw-alias-label-secondary,#646a73);font-size:11px;line-height:1.7}
.ydo-gene-input{height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1,#dee0e3);border-radius:6px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:12px;min-width:0}
.ydo-gene-fail-item{display:grid;gap:6px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f5f6f7)}
`

// facets 每维度默认展示 Top3（demo COLLAPSE_AT；隐藏 ≤2 个时默认展开，避免「+1/+2」无意义点击）
const GENE_COLLAPSE_AT = 3

// ---------------------------------------------------------------------------
// 页面组件
// ---------------------------------------------------------------------------

function CoverImage({ record }) {
  const duration = geneDuration(record.durationSeconds)
  return h('span', { className: 'ydo-work-cover ydo-work-cover-large' },
    record.coverUrl
      ? h('img', {
        src: record.coverUrl, alt: '封面', loading: 'lazy', referrerPolicy: 'no-referrer',
        style: { width: '100%', height: '100%', objectFit: 'cover' },
        onError: event => {
          const img = event.currentTarget
          const doc = img.ownerDocument
          const parent = img.parentElement
          if (!doc || !parent) return
          const fallback = doc.createElement('span')
          fallback.className = 'ydo-gene-cover-fallback'
          fallback.textContent = '封面'
          img.replaceWith(fallback)
        },
      })
      : h('span', { className: 'ydo-gene-cover-fallback' }, '封面'),
    duration ? h('span', { className: 'ydo-work-cover-duration' }, duration) : null)
}

function CardTags({ record, dimensions }) {
  const geneTags = record.geneTags && typeof record.geneTags === 'object' ? record.geneTags : {}
  const names = dimensionsNameMap(dimensions)
  const chips = []
  for (const [dim, labels] of Object.entries(geneTags)) {
    if (!Array.isArray(labels)) continue
    for (const label of labels) {
      chips.push(h('span', { key: `${dim}:${label}`, className: 'ydo-gene-tag', 'data-h': dimHue(dim) }, String(label)))
    }
    if (chips.length >= 6) break
  }
  return h('div', { className: 'ydo-tags' },
    chips.length ? chips : h('span', { className: 'ydo-mat-hint' }, record.geneStatus === 'failed' ? '提取失败' : '暂无标签'))
}

// 供 CardTags 使用的维度名映射（容忍引用顺序：声明前置的函数提升）
function dimensionsNameMap(dimensions) {
  const map = {}
  if (Array.isArray(dimensions)) {
    for (const dim of dimensions) map[dim.id] = dim.name
  }
  return map
}

function GeneCard({ record, dimensions, actions }) {
  const [pillClass, pillText] = statusPill(record)
  const metrics = record.metrics || {}
  const failed = record.geneStatus === 'failed'
  return h('article', { className: 'ydo-report-work-card ydo-gene-card', 'data-status': record.geneStatus || '' },
    h('div', { className: 'ydo-gene-card-head' },
      CoverImage({ record }),
      h('div', { className: 'ydo-gene-card-main' },
        h('h3', { className: 'ydo-gene-card-title' }, geneText(record.title)),
        h('div', { className: 'ydo-gene-card-meta' },
          h('span', null, geneText(record.authorName)),
          h('span', null, geneDate(record.publishedAt)),
          h('span', { className: pillClass }, pillText)))),
    CardTags({ record, dimensions }),
    failed ? h('p', { className: 'ydo-mat-hint ydo-mat-danger' }, '基因提取失败；拆解结果不受影响，可重试') : null,
    h('dl', { className: 'ydo-gene-card-metrics' },
      h('dt', null, '播放'), h('dd', null, geneWan(metrics.playCount)),
      h('dt', null, '点赞'), h('dd', null, geneWan(metrics.likeCount)),
      h('dt', null, '收藏'), h('dd', null, geneWan(metrics.collectCount))),
    h('div', { className: 'ydo-gene-card-foot' },
      failed
        ? h('button', {
          type: 'button', className: 'ydo-mat-mini', onClick: () => actions.onRegenerate(record.recordId),
        }, '重试提取')
        : null,
      h('button', {
        type: 'button', className: 'ydo-mat-mini', onClick: () => actions.onOpenDetail(record.recordId),
      }, '查看详情'),
      h('span', { className: 'ydo-mat-hint' }, `${geneText(record.genePromptVersion)} · ${editorDisplay(record.editedBy)}`)))
}

function FacetGroup({ dimId, dimName, entries, selected, expanded, onToggleTag, onToggleDim }) {
  const chips = []
  const hidden = Math.max(0, entries.length - GENE_COLLAPSE_AT)
  const showAll = expanded || hidden <= 2
  entries.forEach((entry, index) => {
    const isSelected = selected.includes(entry.label)
    const hiddenByCollapse = !showAll && index >= GENE_COLLAPSE_AT
    chips.push(h('button', {
      key: entry.label,
      type: 'button',
      className: 'ydo-gene-chip',
      'data-h': dimHue(dimId),
      'data-dim': dimId,
      'data-tag': entry.label,
      'aria-pressed': isSelected ? 'true' : 'false',
      style: hiddenByCollapse ? { display: 'none' } : undefined,
      onClick: () => onToggleTag(dimId, entry.label),
    }, entry.label, h('span', { className: 'chip-count' }, String(entry.count))))
  })
  if (hidden > 2) {
    chips.push(h('button', {
      key: 'more', type: 'button', className: 'ydo-gene-facet-more',
      onClick: () => onToggleDim(dimId),
    }, showAll ? '收起' : `+${hidden}`))
  }
  return h('div', { className: 'ydo-gene-facet-group' },
    h('div', { className: 'ydo-gene-facet-label' }, dimName),
    h('div', { className: 'ydo-gene-facet-chips' }, chips))
}

function SelectedBar({ filters, dimensions, onRemoveTag, onClearTags }) {
  const names = dimensionsNameMap(dimensions)
  const chips = []
  for (const [dim, labels] of Object.entries(filters.dims || {})) {
    for (const label of labels) {
      chips.push(h('button', {
        key: `${dim}:${label}`, type: 'button', className: 'ydo-gene-chip is-selected',
        'data-h': dimHue(dim), 'data-dim': dim, 'data-tag': label,
        onClick: () => onRemoveTag(dim, label),
        title: '点击移除该条件',
      }, `${names[dim] || dim}·${label}`, h('span', { className: 'ydo-gene-chip-remove', 'aria-hidden': true }, '✕')))
    }
  }
  return h('div', { className: `ydo-gene-selected${chips.length ? '' : ' is-empty'}`, 'aria-live': 'polite' },
    h('span', { className: 'ydo-gene-selected-label' }, '已选条件'),
    chips,
    chips.length
      ? h('button', { type: 'button', className: 'ydo-mat-link', onClick: onClearTags }, '清空全部')
      : null)
}

function Kpis({ stats, statsError, onOpenFailed }) {
  const failed = stats && typeof stats.failedCount === 'number' ? stats.failedCount : null
  const ratio = stats && typeof stats.adoptedRatio === 'number'
    ? `${Math.round(stats.adoptedRatio * 100)}%`
    : GENE_DASH
  return h('div', { className: 'ydo-mat-kpis' },
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, '知识条目'),
      h('p', { className: 'ydo-mat-kpi-value' }, statsError || !stats ? GENE_DASH : geneNum(stats.total)),
      h('p', { className: 'ydo-mat-kpi-foot' }, '拆解成功自动入库')),
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, '本周新增'),
      h('p', { className: 'ydo-mat-kpi-value' }, statsError || !stats ? GENE_DASH : geneNum(stats.last7d)),
      h('p', { className: 'ydo-mat-kpi-foot' }, '近 7 天入库')),
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, '已采纳 / 已修正'),
      h('p', { className: 'ydo-mat-kpi-value' }, ratio),
      h('p', { className: 'ydo-mat-kpi-foot' }, '占全部条目比例')),
    h('div', { className: 'ydo-mat-kpi' },
      h('p', { className: 'ydo-mat-kpi-label' }, '提取失败待重试'),
      // T9.7 状态机：=0 中性显示，>0 标红；胶囊与 KPI 卡同数据源（stats，P1-4）
      h('button', {
        type: 'button',
        className: `ydo-mat-kpi-value${failed && failed > 0 ? ' is-alert' : ''}`,
        style: { background: 'transparent', border: 0, padding: 0, cursor: failed && failed > 0 ? 'pointer' : 'default', textAlign: 'left' },
        hidden: false,
        onClick: () => { if (failed && failed > 0) onOpenFailed() },
        title: failed && failed > 0 ? '查看提取失败条目' : undefined,
      }, failed === null ? GENE_DASH : geneNum(failed)),
      h('p', { className: 'ydo-mat-kpi-foot' }, failed && failed > 0 ? '失败不影响拆解结果，点击查看' : '暂无异常')))
}

function ReportGrid({ report }) {
  const rows = []
  const addRow = (label, value) => {
    const text = reportText(value)
    rows.push([label, text === null ? '未采集' : text])
  }
  const insight = report && typeof report.audienceInsight === 'object' && report.audienceInsight !== null
    ? report.audienceInsight
    : null
  const bgm = report && typeof report.bgmStyle === 'object' && report.bgmStyle !== null ? report.bgmStyle : null
  const joinList = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).join('、') : '')
  addRow('整体摘要', report ? report.summary : null)
  addRow('开头钩子', report ? report.hook : null)
  addRow('节奏判断', report ? report.rhythm : null)
  addRow('目标受众', report ? report.audience : null)
  addRow('卖点', report ? joinList(report.sellingPoints) : null)
  addRow('改写提示', report ? joinList(report.rewriteHints) : null)
  addRow(
    '受众画像（AI 推断）',
    insight
      ? [
        joinList(insight.targetGroups) && `人群：${joinList(insight.targetGroups)}`,
        joinList(insight.scenes) && `场景：${joinList(insight.scenes)}`,
        joinList(insight.painPoints) && `痛点：${joinList(insight.painPoints)}`,
      ].filter(Boolean).join('；') || null
      : null,
  )
  addRow(
    'BGM 风格',
    bgm
      ? [
        reportText(bgm.style) && `风格：${reportText(bgm.style)}`,
        reportText(bgm.tempo) && `节奏：${reportText(bgm.tempo)}`,
        reportText(bgm.mood) && `情绪：${reportText(bgm.mood)}`,
        reportText(bgm.usage) && `配合：${reportText(bgm.usage)}`,
      ].filter(Boolean).join('；') || null
      : null,
  )
  addRow('分镜段数', report && typeof report.segmentCount === 'number' ? `${report.segmentCount} 段` : null)
  return h('div', { className: 'ydo-mat-failure-grid' },
    rows.flatMap(([label, text]) => [h('b', { key: `k:${label}` }, label), h('span', { key: `v:${label}` }, text)]))
}

/** 基因标签与依据（T5.4/T6.3）：每维度标签 chip + evidence 依据列表；全空维度不渲染。 */
function GeneDimsView({ record, dimensions }) {
  const geneTags = record.geneTags && typeof record.geneTags === 'object' ? record.geneTags : {}
  const evidence = record.geneEvidenceJson && typeof record.geneEvidenceJson === 'object'
    ? record.geneEvidenceJson
    : {}
  const names = dimensionsNameMap(dimensions)
  const dims = Object.entries(geneTags).filter(([, labels]) => Array.isArray(labels) && labels.length)
  if (!dims.length) {
    return h('p', { className: 'ydo-mat-hint' }, record.geneStatus === 'failed' ? '提取失败，暂无基因标签' : '暂无基因标签')
  }
  return h('div', { className: 'ydo-gene-dims' }, dims.map(([dim, labels]) => {
    const entries = Array.isArray(evidence[dim]) ? evidence[dim] : []
    return h('div', { key: dim, className: 'ydo-gene-dim' },
      h('div', { className: 'ydo-gene-dim-head' },
        h('span', { className: 'ydo-gene-dim-name' }, names[dim] || dim),
        dim === 'audience' ? h('span', { className: 'ydo-mat-status ydo-mat-status-muted' }, 'AI 推断') : null),
      h('div', { className: 'ydo-tags' }, labels.map(label =>
        h('span', { key: label, className: 'ydo-gene-tag', 'data-h': dimHue(dim) }, String(label)))),
      entries.length
        ? h('ul', { className: 'ydo-mat-reason-list' }, entries.map((entry, index) =>
          h('li', { key: `${dim}:${index}`, className: 'ydo-mat-reason-item' },
            `依据（${geneText(entry.label)}）：${geneText(entry.basis)}`)))
        : null)
  }))
}

/** 人工修正表单（detail 弹窗内；内部 state，保存经 actions.onSaveEdit 上抛）。
 * gene_status 非 succeeded 时仅备注可编辑（GENE_NOT_READY 口径，P3-4）。 */
function EditPanel({ record, dimensions, saving, saveError, onSave, t }) {
  // succeeded 态：标签/采纳/备注全部可编辑；非 succeeded（failed/pending）态：
  // 仅备注可编辑（GENE_NOT_READY 口径，P3-4/T7.7——保存只带 manualNotes 零冲突）
  const editable = record.geneStatus === 'succeeded'
  const initialAdoption =
    record.adoptionStatus === 'adopted' || record.adoptionStatus === 'revised'
      ? record.adoptionStatus
      : 'ai_draft'
  const initialTags = React.useMemo(() => {
    const draft = {}
    const geneTags = record.geneTags && typeof record.geneTags === 'object' ? record.geneTags : {}
    for (const [dim, labels] of Object.entries(geneTags)) {
      draft[dim] = Array.isArray(labels) ? [...labels] : []
    }
    return draft
  }, [record.recordId, record.updatedAt])
  const [draftTags, setDraftTags] = React.useState(initialTags)
  const [addValue, setAddValue] = React.useState({})
  const [notes, setNotes] = React.useState(typeof record.manualNotes === 'string' ? record.manualNotes : '')
  const [adoption, setAdoption] = React.useState(initialAdoption)
  // 打开新条目时重置表单（recordId 变化）
  React.useEffect(() => {
    setDraftTags(initialTags)
    setAddValue({})
    setNotes(typeof record.manualNotes === 'string' ? record.manualNotes : '')
    setAdoption(initialAdoption)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.recordId])

  const names = dimensionsNameMap(dimensions)
  const maxLabels = dim => {
    if (Array.isArray(dimensions)) {
      const found = dimensions.find(dimInfo => dimInfo.id === dim)
      if (found && typeof found.maxLabels === 'number') return found.maxLabels
    }
    return 3
  }
  const removeAt = (dim, label) => {
    setDraftTags(prev => ({ ...prev, [dim]: (prev[dim] || []).filter(item => item !== label) }))
  }
  const addLabel = dim => {
    const value = String(addValue[dim] || '').trim()
    if (!value) return
    setDraftTags(prev => {
      const labels = prev[dim] || []
      if (labels.includes(value) || labels.length >= maxLabels(dim)) return prev
      return { ...prev, [dim]: [...labels, value] }
    })
    setAddValue(prev => ({ ...prev, [dim]: '' }))
  }
  const save = () => {
    if (saving) return
    if (!editable) {
      // 非 succeeded：只提交备注（不带 geneTags/adoptionStatus，服务端零冲突，T7.7）
      onSave(record.recordId, { manualNotes: notes })
      return
    }
    const geneTags = {}
    for (const [dim, labels] of Object.entries(draftTags)) {
      if (labels.length) geneTags[dim] = labels
    }
    // 采纳态仅在用户显式改动分段时传递；只改标签未动分段 → undefined，
    // 服务端收敛为「已修正」（开发文档 §6.1，T7.3）；显式选择始终尊重（T7.4）。
    const adoptionStatus = adoption !== initialAdoption ? adoption : undefined
    onSave(record.recordId, { geneTags, manualNotes: notes, adoptionStatus })
  }
  const dims = Array.isArray(dimensions) ? dimensions : []
  return h('div', { className: 'ydo-gene-dims' },
    h('div', { className: 'ydo-gene-dim' },
      h('div', { className: 'ydo-gene-dim-head' },
        h('span', { className: 'ydo-gene-dim-name' }, '标签修正'),
        editable ? null : h('span', { className: 'ydo-mat-hint' }, '仅备注可编辑（提取未完成）')),
      dims.map(dim => {
        const labels = draftTags[dim.id] || []
        return h('div', { key: dim.id, className: 'ydo-gene-dim' },
          h('div', { className: 'ydo-gene-facet-label' }, `${dim.name}（≤${dim.maxLabels} 个）`),
          h('div', { className: 'ydo-gene-facet-chips' },
            labels.map(label => h('button', {
              key: label, type: 'button', className: 'ydo-gene-chip is-selected',
              'data-h': dimHue(dim.id), disabled: !editable,
              onClick: () => removeAt(dim.id, label),
              title: editable ? '点击移除' : undefined,
            }, label, editable ? h('span', { className: 'ydo-gene-chip-remove', 'aria-hidden': true }, '✕') : null)),
            labels.length === 0 ? h('span', { className: 'ydo-mat-hint' }, '无标签') : null),
          editable
            ? h('div', { className: 'ydo-gene-actions' },
              h('input', {
                className: 'ydo-gene-input', type: 'text', value: addValue[dim.id] || '',
                placeholder: `添加 ${dim.name} 标签（2-8 字短语）`,
                onChange: event => setAddValue(prev => ({ ...prev, [dim.id]: event.target.value })),
                onKeyDown: event => { if (event.key === 'Enter') addLabel(dim.id) },
              }),
              h('button', { type: 'button', className: 'ydo-mat-mini', onClick: () => addLabel(dim.id) }, '添加'))
            : null)
      })),
    h('div', { className: 'ydo-gene-dim' },
      h('div', { className: 'ydo-gene-dim-head' },
        h('span', { className: 'ydo-gene-dim-name' }, '备注')),
      h('textarea', {
        className: 'ydo-gene-textarea', value: notes,
        placeholder: '补充人工判断、使用建议或纠错说明（选填；失败条目也可备注）',
        onChange: event => setNotes(event.target.value),
      })),
    h('div', { className: 'ydo-gene-dim' },
      h('div', { className: 'ydo-gene-dim-head' },
        h('span', { className: 'ydo-gene-dim-name' }, '采纳状态')),
      h('div', { className: 'ydo-report-seg', role: 'group', 'aria-label': '采纳状态' },
        [['ai_draft', 'AI 草稿'], ['adopted', '已采纳'], ['revised', '已修正']].map(([value, label]) =>
          h('button', {
            key: value, type: 'button',
            className: `ydo-report-seg-item${adoption === value ? ' is-active' : ''}`,
            disabled: !editable,
            onClick: () => setAdoption(value),
          }, label))),
      h('p', { className: 'ydo-mat-hint' },
        'AI 草稿 = 提取完成未经人工处理；已采纳 = 人工确认可直接使用；已修正 = 人工编辑过标签或备注。')),
    saveError ? h('p', { className: 'ydo-error', role: 'alert' }, geneErrorCopy(saveError)) : null,
    h('div', { className: 'ydo-gene-actions', style: { marginTop: 12 } },
      h('button', {
        type: 'button', className: 'ydo-primary', disabled: saving,
        onClick: save,
      }, saving ? '保存中…' : '保存修正'),
      h('p', { className: 'ydo-mat-hint' },
        '修正后筛选选项（facets）自动按新标签聚合收敛；编辑记录本期显示「系统」（决策 D8）。')),
    h('p', { className: 'ydo-gene-note-block' }, t ? t('geneEditNote') : '编辑记录：本期统一显示「系统」；账号体系支持返回真实编辑人后再升级。'))
}

/** 失败条目列表弹窗（管理态入口，§7.2：失败原因 + 重试按钮）。 */
function FailedListModal({ failed, onRetry, onClose, retryingId, retryError }) {
  const items = failed && Array.isArray(failed.items) ? failed.items : []
  return h('div', { className: 'ydo-ai-modal-overlay is-open', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ydo-ai-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '基因提取失败条目' },
      h('button', { type: 'button', className: 'ydo-ai-modal-close', onClick: onClose, 'aria-label': '关闭' }, '✕'),
      h('div', { className: 'ydo-ai-modal-body' },
        h('section', { className: 'ydo-panel' },
          h('h4', { className: 'ydo-modal-sec-title' }, '基因提取失败条目'),
          failed && failed.errorReason
            ? h('p', { className: 'ydo-mat-hint ydo-mat-danger' }, geneErrorCopy(failed.errorReason))
            : null,
          retryError
            ? h('p', { className: 'ydo-error', role: 'alert' }, geneErrorCopy(retryError))
            : null,
          items.length
            ? h('div', { className: 'ydo-gene-dims' }, items.map(item =>
              h('div', { key: item.recordId, className: 'ydo-gene-fail-item' },
                h('div', { className: 'ydo-gene-card-title' }, geneText(item.title)),
                h('p', { className: 'ydo-mat-hint ydo-mat-danger' },
                  `${geneText(item.geneErrorCode)}（第 ${geneNum(item.geneAttemptCount)} 次尝试；拆解结果不受影响）`),
                item.geneErrorSummary
                  ? h('p', { className: 'ydo-mat-hint' }, geneText(item.geneErrorSummary))
                  : null,
                h('div', { className: 'ydo-gene-actions' },
                  h('button', {
                    type: 'button', className: 'ydo-mat-mini',
                    disabled: retryingId === item.recordId,
                    onClick: () => onRetry(item.recordId),
                  }, retryingId === item.recordId ? '重试中…' : '重试提取')))))
            : h('p', { className: 'ydo-mat-empty' }, failed && failed.loading ? '加载中…' : '暂无提取失败条目')))))
}

/** 详情弹窗（demo v3：报告 + 标签依据 + 人工修正）。 */
function DetailModal({ detail, dimensions, saving, saveError, retryingId, retryError, actions, onClose, t }) {
  const record = detail && detail.record ? detail.record : null
  const [confirmRegenerate, setConfirmRegenerate] = React.useState(false)
  React.useEffect(() => {
    setConfirmRegenerate(false)
  }, [record && record.recordId])
  if (!detail) return null
  const failed = record && record.geneStatus === 'failed'
  return h('div', { className: 'ydo-ai-modal-overlay is-open', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ydo-ai-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '基因条目详情' },
      h('button', { type: 'button', className: 'ydo-ai-modal-close', onClick: onClose, 'aria-label': '关闭' }, '✕'),
      h('div', { className: 'ydo-ai-modal-body' },
        detail.loading
          ? h('p', { className: 'ydo-mat-empty' }, '加载中…')
          : detail.errorReason
            ? h('p', { className: 'ydo-error', role: 'alert' }, geneErrorCopy(detail.errorReason))
            : record
              ? [
                h('div', { key: 'head', className: 'ydo-gene-detail-head' },
                  CoverImage({ record }),
                  h('div', { className: 'ydo-gene-detail-main' },
                    h('h3', { className: 'ydo-gene-detail-title' }, geneText(record.title)),
                    h('p', { className: 'ydo-bd-head-meta' },
                      h('span', null, geneText(record.authorName)),
                      h('span', null, geneDate(record.publishedAt)),
                      h('span', null, `播放 ${geneWan(record.metrics ? record.metrics.playCount : null)}`),
                      h('span', null, `点赞 ${geneWan(record.metrics ? record.metrics.likeCount : null)}`),
                      h('span', null, `评论 ${geneWan(record.metrics ? record.metrics.commentCount : null)}`),
                      h('span', null, `收藏 ${geneWan(record.metrics ? record.metrics.collectCount : null)}`),
                      record.shareUrl
                        ? h('a', { href: record.shareUrl, target: '_blank', rel: 'noreferrer' }, '原视频链接')
                        : null),
                    h('p', { className: 'ydo-bd-head-meta' },
                      ...Object.entries(record.geneTags || {}).filter(([, labels]) => Array.isArray(labels) && labels.length)
                        .flatMap(([dim, labels]) => labels.map(label =>
                          h('span', { key: `${dim}:${label}`, className: 'ydo-gene-tag', 'data-h': dimHue(dim) }, String(label)))),
                      (() => {
                        const [pillClass, pillText] = statusPill(record)
                        return h('span', { className: pillClass }, pillText)
                      })(),
                      h('span', { className: 'ydo-mat-hint' },
                        `${geneText(record.genePromptVersion)} · 拆解 breakdown-v2 · 编辑：${editorDisplay(record.editedBy)}`)))),
                h('section', { key: 'dims', className: 'ydo-panel' },
                  h('h4', { className: 'ydo-modal-sec-title' }, '基因标签与依据'),
                  GeneDimsView({ record, dimensions })),
                h('section', { key: 'report', className: 'ydo-panel' },
                  h('h4', { className: 'ydo-modal-sec-title' }, '完整拆解报告（breakdown-v2）'),
                  ReportGrid({ report: record.reportJson })),
                h('section', { key: 'edit', className: 'ydo-panel' },
                  h('h4', { className: 'ydo-modal-sec-title' }, '人工修正'),
                  EditPanel({
                    record, dimensions, saving, saveError, t,
                    onSave: actions.onSaveEdit,
                  }),
                  h('div', { className: 'ydo-gene-actions', style: { marginTop: 12 } },
                    confirmRegenerate
                      ? [
                        h('span', { key: 'confirm', className: 'ydo-mat-hint' },
                          '重新提取将覆盖当前 AI 标签与依据，状态回到「AI 草稿」；人工备注保留。确认重新提取？'),
                        h('button', {
                          key: 'yes', type: 'button', className: 'ydo-primary',
                          disabled: retryingId === record.recordId,
                          onClick: () => { setConfirmRegenerate(false); actions.onRegenerate(record.recordId) },
                        }, retryingId === record.recordId ? '提交中…' : '确认重新提取'),
                        h('button', {
                          key: 'no', type: 'button', className: 'ydo-secondary', onClick: () => setConfirmRegenerate(false),
                        }, '取消'),
                      ]
                      : h('button', {
                        type: 'button', className: 'ydo-secondary',
                        onClick: () => setConfirmRegenerate(true),
                      }, failed ? '重试提取' : '重新提取基因')),
                  failed && record.geneErrorCode
                    ? h('p', { className: 'ydo-mat-hint ydo-mat-danger' },
                      `${record.geneErrorCode}（第 ${geneNum(record.geneAttemptCount)} 次尝试）`)
                    : null,
                  retryError
                    ? h('p', { className: 'ydo-error', role: 'alert' }, geneErrorCopy(retryError))
                    : null)]
              : null)))
}

export function GenePage({
  t, records, filters, detail, failed,
  saving, saveError, retryingId, retryError,
  actions,
}) {
  const dimensions = records && Array.isArray(records.dimensions) ? records.dimensions : []
  const facets = records && records.facets && typeof records.facets === 'object' ? records.facets : {}
  const stats = records ? records.stats : null
  const failedCount = stats && typeof stats.failedCount === 'number' ? stats.failedCount : 0
  const items = records && Array.isArray(records.results) ? records.results : []
  const dimNames = dimensionsNameMap(dimensions)
  const [facetsOpen, setFacetsOpen] = React.useState(true)
  const [expandedDims, setExpandedDims] = React.useState({})
  const toggleDim = dim => setExpandedDims(prev => ({ ...prev, [dim]: !prev[dim] }))
  const selectedEntries = Object.entries(filters.dims || {}).flatMap(([dim, labels]) =>
    labels.map(label => ({ dim, label })))

  return h('div', { className: 'ydo-mat-page' },
    // 页头：标题 + 失败警示胶囊（失败数=0 时完全隐藏，T9.7 状态机）
    h('div', { className: 'ydo-mat-head' },
      h('div', { className: 'ydo-gene-head-left' },
        h('h2', null, t('geneTitle')),
        h('p', { className: 'ydo-mat-sub' }, '拆解完成后自动生成基因条目；品类与基因标签由 AI 自动生成，筛选选项随库内标签动态更新')),
      failedCount > 0
        ? h('button', {
          type: 'button', className: 'ydo-gene-alert', 'aria-label': '查看基因提取失败条目',
          onClick: actions.onOpenFailed,
        },
        h('span', { className: 'ydo-gene-alert-dot', 'aria-hidden': true }),
        '基因提取失败',
        h('span', { className: 'ydo-gene-alert-count' }, String(failedCount)))
        : null),
    // 检索工具栏（demo：query/品类/采纳态/搜索/重置）
    h('div', { className: 'ydo-toolbar' },
      h('div', { className: 'ydo-mat-filters' },
        h('input', {
          type: 'text', value: filters.query,
          placeholder: '搜索标题 / 拆解报告 / 标签 / 备注', 'aria-label': '关键词全文检索',
          onChange: event => actions.onFilterChange({ query: event.target.value }),
          onKeyDown: event => { if (event.key === 'Enter') actions.onSearch() },
        }),
        h('select', {
          value: filters.category, 'aria-label': '品类筛选',
          onChange: event => actions.onFilterApply({ category: event.target.value }),
        },
        h('option', { value: '' }, '全部品类'),
        (facets.category || []).map(entry =>
          h('option', { key: entry.label, value: entry.label }, `${entry.label}（${entry.count}）`))),
        h('select', {
          value: filters.adoption, 'aria-label': '采纳状态筛选',
          onChange: event => actions.onFilterApply({ adoption: event.target.value }),
        },
        h('option', { value: '' }, '全部状态'),
        h('option', { value: 'ai_draft' }, 'AI 草稿'),
        h('option', { value: 'adopted' }, '已采纳'),
        h('option', { value: 'revised' }, '已修正')),
        h('button', { type: 'button', className: 'ydo-primary', style: { minHeight: 36 }, onClick: actions.onSearch }, '搜索'),
        h('button', { type: 'button', className: 'ydo-secondary', onClick: actions.onReset }, '重置'))),
    // KPI 四卡（stats 唯一数据源，P1-4）
    Kpis({ stats, statsError: records ? records.statsError : false, onOpenFailed: actions.onOpenFailed }),
    // 动态 facets 面板（可收起 / Top3 +「+N」/ 已选条件独立成条）
    h('div', { className: 'ydo-panel' },
      h('div', { className: 'ydo-gene-facet-head' },
        h('h4', null,
          '基因标签筛选 ',
          h('span', { className: 'ydo-gene-facet-title-note' }, '动态 facets · 每维度默认显示前 3 个，随库内标签自动生长')),
        h('button', {
          type: 'button', className: 'ydo-mat-link', 'aria-expanded': facetsOpen ? 'true' : 'false',
          onClick: () => setFacetsOpen(prev => !prev),
        }, facetsOpen ? '收起' : '展开')),
      h('div', { className: `ydo-gene-facet-body${facetsOpen ? '' : ' is-collapsed'}` },
        dimensions.map(dim => {
          const entries = Array.isArray(facets[dim.id]) ? facets[dim.id] : []
          const selected = (filters.dims || {})[dim.id] || []
          return h(FacetGroup, {
            key: dim.id, dimId: dim.id, dimName: dimNames[dim.id] || dim.id,
            entries, selected,
            expanded: !!expandedDims[dim.id],
            onToggleTag: actions.onToggleTag, onToggleDim: toggleDim,
          })
        })),
      SelectedBar({ filters, dimensions, onRemoveTag: actions.onRemoveTag, onClearTags: actions.onClearTags })),
    // 卡片网格（复用报表作品卡）
    records && records.errorReason
      ? h('p', { className: 'ydo-error', role: 'alert' }, geneErrorCopy(records.errorReason))
      : null,
    h('div', { className: 'ydo-report-works' }, items.map(record =>
      h(GeneCard, { key: record.recordId, record, dimensions, actions }))),
    !items.length && records && !records.loading
      ? h('div', { className: 'ydo-mat-empty' }, '没有匹配的知识条目；可调整关键词或清除标签筛选')
      : null,
    h('div', { className: 'ydo-mat-meta' },
      h('span', null, records
        ? `共 ${geneNum(records.total)} 条 · 当前展示 ${items.length} 条${records.loading ? '（加载中…）' : ''}`
        : '加载中…'),
      h('span', null,
        h('button', {
          type: 'button', className: 'ydo-secondary', style: { minHeight: 30 },
          disabled: !records || !records.hasMore || records.loading,
          onClick: actions.onLoadMore,
        }, '加载更多'))),
    // 详情弹窗 / 失败列表弹窗（由 client.js 状态驱动开闭）
    detail
      ? h(DetailModal, {
        detail, dimensions, saving, saveError, retryingId, retryError, t,
        actions, onClose: actions.onCloseDetail,
      })
      : null,
    failed
      ? h(FailedListModal, {
        failed, retryingId, retryError,
        onRetry: actions.onRegenerate, onClose: actions.onCloseFailed,
      })
      : null)
}
