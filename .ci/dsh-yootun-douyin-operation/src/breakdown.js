// 爆款拆解 Tab UI 模块（0922 方案 §4.1；0923 视觉对齐 docs/0922/douyin/breakdown-tab-preview.html）。
//
// 职责边界与 overview-ui / analysis-ui 相同：只做展示与本地格式化，零口径计算；
// 状态文案（状态标签/步骤名/错误文案）一律以 copy 登记为准，组件只按 reason 键取文案。
// 数据源 = 宿主 breakdown.* action（index.js 组合 viral_video 域工具）：
// - workflow 投影（history / workflowStatus）：状态/当前步骤/标题/作者/播放量/规则 id
//   （P2 已把服务端蛇形 candidate_id 归一化为 candidateId）
// - detail.storyboards[0]：originalVideoAnalysis / rewrittenStoryboard / shotScript /
//   input（规则回显）四块投影
// - detail.analysis.candidates[0].products.asr.transcript：口播全文
// - detail.candidate：候选公开指标（互动数据/发布时间/原视频链接），缺失独立降级为 —
// 拍摄脚本是服务端产出的 Markdown 表格（纯文本），用 shotScriptTable 解析后以普通
// 表格元素渲染（React 文本子节点自动转义，无 HTML 注入面），不引入 markdown 依赖。

import { formatCount, formatDateTime } from './ui-format.js'

// React 由 client.js 内联作用域提供（构建时剥离本模块的 require，与 overview-ui 同法）；
// hooks 以 React.xxx 形式使用，避免与 client.js 顶部解构重复声明同名绑定。
const React = require('react')
const { createElement: h } = React
// 关闭图标与作品详情/AI 弹框同款（client.js 顶部解构统一提供，构建时剥离此处 require）。
const { IconCloseOutline16 } = require('@deepseek-ai/dsh-client-ui-primitives')

// 稳定 reason → 已登记文案键（与 overview-ui 同一策略；未登记码由调用方兜底）。
// 仅收 isError 形态 envelope 的白名单码；workflow_start 失败 payload 内的小写
// errorCode 走 WORKFLOW_ERROR_COPY，不经此处。
export const BREAKDOWN_ERROR_REASON_COPY = Object.freeze({
  IDEMPOTENCY_KEY_REQUIRED: 'bdErrorInvalidKey',
  ASYNC_RUN_NOT_FOUND: 'bdErrorRunNotFound',
  UNKNOWN_REWRITE_RULE: 'bdErrorUnknownRule',
  IDEMPOTENCY_CONFLICT: 'bdErrorConflict',
  DOUYIN_TOOL_UNAVAILABLE: 'operationUnavailable',
  douyin_operation_request_failed: 'operationUnavailable',
})

// workflow 投影 status → 徽标语义色（类名后缀）；workflow_start 失败 payload 的
// status（invalid_input 等）一并收敛，未登记值按进行中处理（不误报成功/失败）。
export const BREAKDOWN_STATUS_TONE = Object.freeze({
  succeeded: 'ok',
  failed: 'error',
  cancelled: 'warn',
  invalid_input: 'error',
  idempotency_conflict: 'error',
  needs_input: 'warn',
  queued: 'running',
  running: 'running',
  waiting: 'running',
})

// Workflow Driver 推进步骤顺序（服务端 _WORKFLOW_STEP_LABELS 同序；queued/completed
// 是首尾状态不进条）。进行中条按此渲染 8 步：当前步高亮、之前的步视为已过。
export const BREAKDOWN_WORKFLOW_STEPS = Object.freeze([
  'archive_original',
  'transcode_audio',
  'asr',
  'extract_frames',
  'vision',
  'breakdown',
  'storyboard',
  'shot_script',
])

// 服务端 workflow 失败 errorCode（小写蛇形，payload/admin.errorCode）→ 文案键。
const WORKFLOW_ERROR_COPY = Object.freeze({
  unknown_rewrite_rule: 'bdErrorUnknownRule',
  candidate_not_found: 'bdErrorCandidateNotFound',
  idempotency_conflict: 'bdErrorConflict',
  invalid_input: 'bdErrorInvalidInput',
  needs_product_input: 'bdErrorNeedsInput',
  soft_time_limit: 'bdErrorRetryable',
  waiting_timeout: 'bdErrorRetryable',
  nonretryable_step: 'bdErrorFailed',
  storyboard_quality: 'bdErrorRetryable',
})

export function workflowErrorCopyKey(workflow) {
  const code = workflow?.admin?.errorCode || workflow?.errorCode
  return WORKFLOW_ERROR_COPY[code] || 'bdErrorFailed'
}

export function breakdownStatusTone(status) {
  return BREAKDOWN_STATUS_TONE[status] || 'running'
}

/**
 * 解析拍摄脚本的 Markdown 表格（服务端 _request_shot_script_once 产出九列表）。
 * 只认 `|` 分隔的连续表格块（首行是表头、第二行是 `---` 分隔线）；表格外非空行
 * 按段落收集。全部以纯文本返回，渲染交给 React 子节点（自动转义）。
 */
export function shotScriptTable(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  const lines = text.split(/\r?\n/)
  const head = []
  const rows = []
  const paragraphs = []
  let i = 0
  while (i < lines.length) {
    const cells = splitMarkdownRow(lines[i])
    const separator = /^[\s|:-]+$/u.test(lines[i + 1] || '')
    if (cells.length >= 2 && separator) {
      head.push(...cells)
      i += 2
      while (i < lines.length) {
        const row = splitMarkdownRow(lines[i])
        if (row.length < 2) break
        rows.push(row)
        i += 1
      }
      continue
    }
    const trimmed = lines[i].trim()
    if (trimmed) paragraphs.push(trimmed)
    i += 1
  }
  return { head, rows, paragraphs }
}

function splitMarkdownRow(line) {
  const text = typeof line === 'string' ? line.trim() : ''
  if (!text.startsWith('|')) return []
  const body = text.endsWith('|') ? text.slice(1, -1) : text.slice(1)
  return body.split('|').map(cell => cell.trim())
}

// 原视频链接白名单（与 ui-format safeWorkUrl 同策略的拆解版）：分享链接可能来自
// v.douyin.com 短链域，只放行 http(s) 且主机名以 douyin.com / iesdouyin.com 结尾；
// 不满足返回 null，链接按普通文本展示，绝不调用外部浏览器打开未知地址。
export function safeShareUrl(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) return null
  let url
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  return host === 'douyin.com' || host.endsWith('.douyin.com')
    || host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com')
    ? trimmed
    : null
}

// 互动率是 (赞+评+转+藏)/播放 的小数（服务端 5 位小数），展示为百分比两位小数。
export function formatInteractionRate(value) {
  const num = Number(value)
  if (value === null || value === undefined || !Number.isFinite(num)) return '—'
  return `${Math.round(num * 10000) / 100}%`
}

/** 规则 id → 已加载规则（name/description）；未加载到时回退用 id 兜底显示。 */
function ruleById(rules, ruleId) {
  if (!ruleId) return null
  const found = (Array.isArray(rules) ? rules : []).find(rule => rule && rule.rewriteRuleId === ruleId)
  return found || { rewriteRuleId: ruleId, name: ruleId, description: null }
}

// ---------------------------------------------------------------------------
// 展示原子（状态徽标 / 规则 pill / 步骤条 / KPI）
// ---------------------------------------------------------------------------

function StatusBadge({ status, t }) {
  const tone = breakdownStatusTone(status)
  // needs_input 语义是「待补充信息」（warn 色），不落入 warn 默认的「已取消」。
  const key = status === 'needs_input'
    ? 'bdStatusNeedsInput'
    : {
      ok: 'bdStatusSucceeded', error: 'bdStatusFailed', warn: 'bdStatusCancelled', running: 'bdStatusRunning',
    }[tone]
  return h('span', { className: `ydo-bd-status ydo-bd-status-${tone}` }, t(key))
}

// 仿写规则 pill（列表列与详情规则卡共用）：有规则紫色弱底，未选规则中性「默认」。
function RulePill({ rule, t }) {
  if (!rule) return h('span', { className: 'ydo-bd-rule-pill ydo-bd-rule-pill-default' }, t('bdRuleDefault'))
  return h('span', { className: 'ydo-bd-rule-pill' }, rule.name || rule.rewriteRuleId)
}

// 8 步进度条（预览稿段条式）：每步上方 4px 色条 + 下方步骤名；终态（succeeded 或
// currentStep=completed）整条完成；进行中当前步蓝、之前的步绿。失败时服务端把
// current_step 覆写为 'failed'（不在本数组内，indexOf=-1），进度条整体保持灰态
// ——失败原因由详情页失败文案专门承载。
function StepProgress({ workflow, t }) {
  const steps = BREAKDOWN_WORKFLOW_STEPS
  const currentIndex = steps.indexOf(workflow?.currentStep)
  const done = workflow?.status === 'succeeded' || workflow?.currentStep === 'completed'
  return h('ol', { className: 'ydo-bd-steps', 'aria-label': t('bdProgressLabel') },
    ...steps.map((step, index) => {
      const active = !done && index === currentIndex
      const passed = done || (currentIndex >= 0 && index < currentIndex)
      const state = active ? 'active' : passed ? 'done' : 'todo'
      return h('li', {
        key: step,
        className: `ydo-bd-step ydo-bd-step-${state}`,
        'aria-current': active ? 'step' : undefined,
      },
      h('span', { className: 'ydo-bd-step-bar', 'aria-hidden': true }),
      h('span', { className: 'ydo-bd-step-name' }, t(`bdStep_${step}`)))
    }))
}

// 候选公开指标 6 卡（预览稿 KPI 条）：数值缺失显示 —，绝不回填或估算。
function KpiGrid({ candidate, t }) {
  const cells = [
    ['bdKpiPlay', formatCount(candidate?.playCount)],
    ['bdKpiLike', formatCount(candidate?.likeCount)],
    ['bdKpiComment', formatCount(candidate?.commentCount)],
    ['bdKpiCollect', formatCount(candidate?.collectCount)],
    ['bdKpiShare', formatCount(candidate?.shareCount)],
    ['bdKpiInteraction', formatInteractionRate(candidate?.interactionRate)],
  ]
  return h('div', { className: 'ydo-bd-kpis', role: 'list', 'aria-label': t('bdKpiLabel') },
    ...cells.map(([key, value]) => h('div', { key, className: 'ydo-bd-kpi', role: 'listitem' },
      h('div', { className: 'ydo-bd-kpi-label' }, t(key)),
      h('div', { className: 'ydo-bd-kpi-value' }, value))))
}

// 段落角色语义色标签（hook/build/turn/cta），未登记角色走中性「其他」。
const ROLE_TONES = Object.freeze(['hook', 'build', 'turn', 'cta'])

function RoleTag({ role, t }) {
  const tone = ROLE_TONES.includes(role) ? role : 'other'
  return h('span', { className: `ydo-bd-role ydo-bd-role-${tone}` }, t(`bdRole_${tone}`))
}

// 原视频拆解分段表（预览稿四列：时间/角色/画面/口播）。
function OriginalSegmentTable({ segments, t }) {
  return h('div', { className: 'ydo-bd-seg-wrap' },
    h('table', { className: 'ydo-bd-table' },
      h('thead', null, h('tr', null,
        h('th', null, t('bdColTime')), h('th', null, t('bdColRole')),
        h('th', null, t('bdColVisual')), h('th', null, t('bdColSpeech')))),
      h('tbody', null, ...segments.map((segment, index) => h('tr', { key: index },
        h('td', { className: 'ydo-bd-cell-time' }, segment.timeRange || '—'),
        h('td', null, h(RoleTag, { role: segment.role, t })),
        h('td', { className: 'ydo-bd-cell-visual' }, segment.originalVisual || '—'),
        h('td', null, segment.originalSpeech || '—'))))))
}

// 改写分镜卡片（预览稿 shot 卡）：角色 + 时间 + 来源段落标注、原片段引用（从原视频
// 段落按 sourceSegmentIndexes 装配，纯投影读取）、新口播主行、画面提示次行；
// 「原片段/改写文案/画面提示」前缀走文案键（不用 CSS content，保证双语）。
function RewrittenSegmentList({ segments, originalSegments, t }) {
  const source = (index => (originalSegments && originalSegments[index] ? originalSegments[index] : null))
  return h('div', { className: 'ydo-bd-shot-list' },
    ...segments.map((segment, index) => {
      const sources = Array.isArray(segment.sourceSegmentIndexes) ? segment.sourceSegmentIndexes : []
      const sourceTexts = sources
        .map(i => {
          const row = source(Number(i) - 1)
          return row && row.originalSpeech ? `#${i} ${row.originalSpeech}` : null
        })
        .filter(Boolean)
      return h('div', { key: index, className: 'ydo-bd-shot' },
        h('div', { className: 'ydo-bd-shot-head' },
          h(RoleTag, { role: segment.role, t }),
          h('span', { className: 'ydo-bd-seg-time' }, segment.timeRange || '—'),
          h('span', { className: 'ydo-bd-seg-source' },
            `${t('bdSourceFrom')} ${sources.length ? sources.map(i => `#${i}`).join(' ') : '—'}`)),
        sourceTexts.length
          ? h('p', { className: 'ydo-bd-shot-src' },
            h('span', { className: 'ydo-bd-shot-prefix' }, t('bdShotSrcPrefix')),
            sourceTexts.join('；'))
          : null,
        segment.rewrittenSpeech
          ? h('p', { className: 'ydo-bd-shot-copy' },
            h('span', { className: 'ydo-bd-shot-prefix ydo-bd-shot-prefix-copy' }, t('bdShotCopyPrefix')),
            segment.rewrittenSpeech)
          : null,
        segment.rewrittenVisual
          ? h('p', { className: 'ydo-bd-shot-visual' },
            h('span', { className: 'ydo-bd-shot-prefix' }, t('bdShotVisualPrefix')),
            segment.rewrittenVisual)
          : null)
    }))
}

// 拍摄脚本：Markdown 表格横向滚动 + 表格外段落（配额摘要移到卡 digest，预览稿口径）。
function ShotScriptBlock({ shotScript, t }) {
  if (!shotScript || shotScript.status !== 'succeeded' || !shotScript.markdown) {
    return h('p', { className: 'ydo-hint' }, t('bdSectionPending'))
  }
  const parsed = shotScriptTable(shotScript.markdown)
  return h('div', null,
    parsed.head.length
      ? h('div', { className: 'ydo-bd-shot-wrap' },
        h('table', { className: 'ydo-bd-shot-table' },
          h('thead', null, h('tr', null, ...parsed.head.map((cell, index) => h('th', { key: index }, cell)))),
          h('tbody', null, ...parsed.rows.map((row, rowIndex) =>
            h('tr', { key: rowIndex }, ...row.map((cell, cellIndex) => h('td', { key: cellIndex }, cell)))))))
      : null,
    ...parsed.paragraphs.map((text, index) => h('p', { key: index, className: 'ydo-bd-shot-note' }, text)))
}

// ---------------------------------------------------------------------------
// 详情页数据装配（全部是投影读取，无口径计算）。
// ---------------------------------------------------------------------------

function latestStoryboard(detail) {
  const items = Array.isArray(detail?.storyboards) ? detail.storyboards : []
  return items.length ? items[0] : null
}

function asrTranscript(detail) {
  const candidates = Array.isArray(detail?.analysis?.candidates) ? detail.analysis.candidates : []
  const transcript = candidates.length ? candidates[0]?.products?.asr?.transcript : null
  return typeof transcript === 'string' && transcript.trim() ? transcript : null
}

// 规则回显：input 投影里的保留 key（P1 契约：rewriteRuleId + rewriteRulePrompt）。
function usedRule(storyboardRow) {
  const input = storyboardRow?.input
  if (!input || typeof input !== 'object') return null
  const id = typeof input.rewriteRuleId === 'string' ? input.rewriteRuleId : ''
  if (!id) return null
  const prompt = typeof input.rewriteRulePrompt === 'string' ? input.rewriteRulePrompt : ''
  return { id, prompt }
}

// 拍摄脚本配额摘要（预览稿 digest 口径：「远2/中3/近1/特1」形态）。
function shotQuotaDigest(shotScript) {
  const quotas = shotScript?.shotSizeQuotas
  if (!quotas || typeof quotas !== 'object' || Array.isArray(quotas)) return null
  const text = Object.entries(quotas).map(([size, count]) => `${size}×${count}`).join(' · ')
  return text || null
}

// 规则单选卡片组：主视图与重新改写弹框共用；再点一次取消选中（= 不带规则仿写）。
export function BreakdownRulePicker({ rules, value, onChange, disabled, t }) {
  return h('div', { className: 'ydo-bd-rules', role: 'radiogroup', 'aria-label': t('bdRulesLabel') },
    rules.length
      ? rules.map(rule => h('button', {
        key: rule.rewriteRuleId,
        type: 'button',
        className: `ydo-bd-radio${value === rule.rewriteRuleId ? ' ydo-bd-radio-active' : ''}`,
        role: 'radio',
        'aria-checked': value === rule.rewriteRuleId,
        disabled,
        onClick: () => onChange(value === rule.rewriteRuleId ? null : rule.rewriteRuleId),
      },
      h('span', { className: 'ydo-bd-radio-name' },
        h('span', { className: 'ydo-bd-radio-box', 'aria-hidden': true }),
        rule.name),
      rule.description ? h('span', { className: 'ydo-bd-radio-desc' }, rule.description) : null))
      : h('span', { className: 'ydo-hint' }, t('bdRulesEmpty')))
}

// ---------------------------------------------------------------------------
// 主视图：发起拆解 + 拆解记录（预览稿 view-main 结构）。
// ---------------------------------------------------------------------------

export function BreakdownNewPage({ rules, rulesError, onRetryRules, submitting, archiveTask, startError, onStart, t }) {
  const [shareUrl, setShareUrl] = React.useState('')
  const [ruleId, setRuleId] = React.useState(null)
  const submit = () => {
    const value = shareUrl.trim()
    if (!value || submitting) return
    onStart(value, ruleId)
    setShareUrl('')
    setRuleId(null)
  }
  return h('section', { className: 'ydo-ov-panel ydo-bd-panel' },
    h('h3', null, t('bdNewTitle')),
    h('div', { className: 'ydo-bd-new' },
      h('input', {
        className: 'ydo-date-input ydo-bd-input',
        type: 'text',
        value: shareUrl,
        placeholder: t('bdSharePlaceholder'),
        'aria-label': t('bdShareLabel'),
        disabled: submitting,
        onChange: event => setShareUrl(event.target.value),
        onKeyDown: event => { if (event.key === 'Enter') submit() },
      }),
      h('button', {
        type: 'button', className: 'ydo-primary', disabled: submitting || !shareUrl.trim(),
        'aria-busy': submitting,
        onClick: submit,
      }, submitting ? t('bdSubmitting') : t('bdStartButton'))),
    startError ? h('p', { className: 'ydo-error', role: 'alert', 'aria-live': 'assertive' }, t(startError)) : null,
    // 规则标签在网格上方（预览稿 field-label 口径）；失败态与提示语在网格下方。
    rulesError
      ? h('div', null,
        h('p', { className: 'ydo-error', role: 'alert' }, t(rulesError)),
        onRetryRules
          ? h('button', {
            type: 'button', className: 'ydo-secondary', style: { marginTop: 6 },
            onClick: () => onRetryRules(),
          }, t('bdRulesRetry'))
          : null)
      : h('div', { className: 'ydo-bd-rules-field' },
        h('p', { className: 'ydo-bd-field-label' },
          t('bdRulesLabel'),
          h('span', { className: 'ydo-bd-field-label-opt' }, t('bdRulesOptional'))),
        h(BreakdownRulePicker, { rules, value: ruleId, onChange: setRuleId, disabled: submitting, t })),
    h('p', { className: 'ydo-hint' }, t('bdRulesHint')),
    archiveTask
      ? h('div', { className: 'ydo-progress', role: 'status', 'aria-live': 'polite', 'aria-busy': true },
        h('span', { className: 'ydo-spinner' }),
        h('span', null, t('bdArchivePending')))
      : null)
}

export function BreakdownHistoryList({ history, rules, loading, errorReason, hasMore, loadingMore, onLoadMore, onOpen, t }) {
  // 行数据 = workflow 投影：标题/作者/播放量/规则 id（服务端投影直出，防 N+1）。
  // 表格结构（预览稿 tbl）：视频 | 状态 | 仿写规则 | 当前步骤 | 时间。
  const rows = history.map((item, index) => {
    const tone = breakdownStatusTone(item.status)
    const failed = tone === 'error'
    const running = tone === 'running' && item.currentStepLabel
    return h('tr', {
      key: `${item.candidateId}-${item.admin?.workflowId || index}`,
      tabIndex: 0,
      onClick: () => onOpen(item),
      onKeyDown: event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(item)
        }
      },
    },
    h('td', { className: 'ydo-bd-cell-main' },
      h('span', { className: 'ydo-bd-row-title' }, item.candidateTitle || item.candidateId || '—'),
      h('span', { className: 'ydo-bd-row-sub' },
        item.candidateAuthor ? `@${item.candidateAuthor}` : null,
        item.candidateAuthor && item.candidatePlayCount !== null && item.candidatePlayCount !== undefined
          ? ` · ${t('bdPlayLabel')} ${formatCount(item.candidatePlayCount)}`
          : null)),
    h('td', null, h(StatusBadge, { status: item.status, t })),
    h('td', null, h(RulePill, { rule: ruleById(rules, item.rewriteRuleId), t })),
    h('td', { className: `ydo-bd-row-step${failed ? ' ydo-bd-row-step-failed' : running ? ' ydo-bd-row-step-running' : ''}` },
      failed ? t('bdStatusFailed') : (item.currentStepLabel || '—')),
    h('td', { className: 'ydo-bd-row-time' }, formatDateTime(item.updatedAt)))
  })
  // 预览稿 panel 口径：可见标题「拆解记录（团队共享，按时间倒序）」，记录区与
  // 发起区同为 ydo-ov-panel；空态/错误态同样带标题，保持结构对称。
  return h('section', { className: 'ydo-ov-panel ydo-bd-panel ydo-bd-history', role: 'group', 'aria-label': t('bdHistoryLabel') },
    h('h3', null, t('bdHistoryLabel'),
      h('span', { className: 'ydo-bd-history-sub' }, t('bdHistorySub'))),
    errorReason
      ? h('p', { className: 'ydo-error', role: 'alert' }, t(errorReason))
      : !history.length
        ? h('p', { className: 'ydo-hint', role: 'status' }, loading ? t('loading') : t('bdHistoryEmpty'))
        : [
          h('table', { key: 'table', className: 'ydo-bd-table' },
            h('thead', null, h('tr', null,
              h('th', null, t('bdColVideo')),
              h('th', null, t('bdColStatus')),
              h('th', null, t('bdColRule')),
              h('th', null, t('bdColStep')),
              h('th', null, t('bdColTime')))),
            h('tbody', null, ...rows)),
          hasMore
            ? h('div', { key: 'more', className: 'ydo-bd-more' },
              h('button', {
                type: 'button', className: 'ydo-secondary', disabled: loadingMore,
                'aria-busy': loadingMore,
                onClick: onLoadMore,
              }, t('bdLoadMore')))
            : null,
        ])
}

// ---------------------------------------------------------------------------
// 详情页（预览稿 view-detail 结构）：白卡头部（标题/meta/状态/步骤条）+ KPI 条
// + 五张折叠卡。规则名从已加载规则清单解析；候选指标缺失独立降级为 —。
// ---------------------------------------------------------------------------

export function BreakdownDetailPage({ workflow, detail, candidate, rules, loading, errorReason, onBack, onRequestRewrite, t }) {
  if (errorReason) {
    return h('div', { className: 'ydo-state ydo-state-error', role: 'alert' },
      h('p', null, t(errorReason)),
      h('button', { type: 'button', className: 'ydo-secondary', onClick: onBack }, t('bdBackToList')))
  }
  const storyboardRow = latestStoryboard(detail)
  const originalRaw = storyboardRow?.originalVideoAnalysis || null
  const rewrittenRaw = storyboardRow?.rewrittenStoryboard || null
  // segments 契约上恒为数组；单条坏记录按空数组降级，不崩整个详情页。
  const original = originalRaw
    ? { ...originalRaw, segments: Array.isArray(originalRaw.segments) ? originalRaw.segments : [] }
    : null
  const rewritten = rewrittenRaw
    ? { ...rewrittenRaw, segments: Array.isArray(rewrittenRaw.segments) ? rewrittenRaw.segments : [] }
    : null
  const transcript = asrTranscript(detail)
  const rule = usedRule(storyboardRow)
  const ruleResolved = rule ? ruleById(rules, rule.id) : null
  const shareUrl = safeShareUrl(candidate?.shareUrl)
  // 失败文案承载两态：error 色失败，以及 needs_input（warn 色但带 errorCode 的
  // 同步失败 payload，如 needs_product_input——用户需要知道为什么没有产出）。
  const failed = Boolean(
    workflow && (breakdownStatusTone(workflow.status) === 'error' || workflow.status === 'needs_input'),
  )
  // 仅在确有 workflow 且处于运行态时显示「拆解进行中」；无 workflow 的空态
  // 走「暂无拆解内容」引导，避免误导。
  const pending = Boolean(workflow) && !failed && breakdownStatusTone(workflow.status) === 'running'
  return h('div', { className: 'ydo-bd-page' },
    // 预览稿 detail-top：返回靠左、「重新改写」靠右（弹性撑开）。
    h('div', { className: 'ydo-an-toolbar' },
      h('button', { type: 'button', className: 'ydo-secondary', onClick: onBack }, t('bdBackToList')),
      h('button', {
        type: 'button', className: 'ydo-secondary ydo-bd-toolbar-rewrite',
        disabled: pending || loading,
        onClick: onRequestRewrite,
      }, t('bdRewriteButton'))),
    workflow
      ? h('header', { className: 'ydo-bd-head' },
        h('div', { className: 'ydo-bd-head-row' },
          h('div', { className: 'ydo-bd-head-main' },
            h('h3', null, workflow.candidateTitle || workflow.candidateId || '—'),
            workflow.candidateAuthor || candidate?.publishedAt || shareUrl
              ? h('p', { className: 'ydo-bd-head-meta' },
                workflow.candidateAuthor ? h('span', null, `@${workflow.candidateAuthor}`) : null,
                candidate?.publishedAt
                  ? h('span', null, `${t('bdPublishedAt')} ${formatDateTime(candidate.publishedAt)}`)
                  : null,
                shareUrl ? h('a', { href: shareUrl, target: '_blank', rel: 'noreferrer noopener' }, `${t('bdOriginalLink')} ↗`) : null)
              : null),
          h(StatusBadge, { status: workflow.status, t })),
        h(StepProgress, { workflow, t }),
        failed ? h('p', { className: 'ydo-bd-error-box', role: 'alert' }, t(workflowErrorCopyKey(workflow))) : null)
      : null,
    Number.isFinite(Number(candidate?.playCount)) || candidate
      ? h(KpiGrid, { candidate, t })
      : null,
    loading && !storyboardRow
      ? h('div', { className: 'ydo-state', role: 'status' }, h('span', { className: 'ydo-spinner' }), h('p', null, t('loading')))
      : !storyboardRow
      ? h('div', { className: 'ydo-bd-empty', role: 'status' },
        pending ? h('span', { className: 'ydo-spinner ydo-bd-empty-spinner', 'aria-hidden': true }) : null,
        h('p', { className: 'ydo-bd-empty-title' }, pending ? t('bdRunningTitle') : t('bdDetailEmpty')),
        h('p', { className: 'ydo-bd-empty-sub' }, pending ? t('bdRunningSub') : t('bdDetailEmptySub')))
      : h('div', { className: 'ydo-bd-cards' },
        h(FoldCard, {
          tone: 'summary', title: t('bdCardOriginal'), defaultOpen: true,
          digest: original?.summary ? String(original.summary).slice(0, 60) : null,
        },
        original
          ? h('div', { className: 'ydo-bd-card-body-gap' },
            original.summary ? h('blockquote', { className: 'ydo-bd-quote' }, original.summary) : null,
            h(OriginalSegmentTable, { segments: original.segments, t }))
          : h('p', { className: 'ydo-hint' }, t('bdSectionPending'))),
        h(FoldCard, {
          tone: 'dims', title: t('bdCardTranscript'),
          digest: transcript ? `${t('bdDigestAsr')} · ${transcript.length}${t('bdDigestCharUnit')}` : null,
        },
        transcript
          ? h('blockquote', { className: 'ydo-bd-quote' }, transcript)
          : h('p', { className: 'ydo-hint' }, t('bdSectionPending'))),
        h(FoldCard, {
          tone: 'patterns', title: t('bdCardStoryboard'), defaultOpen: true,
          digest: rewritten
            ? `${rewritten.segments.length}${t('bdSegmentUnit')}${ruleResolved ? ` · ${ruleResolved.name || ruleResolved.rewriteRuleId}` : ''}`
            : null,
        },
        rewritten
          ? h('div', { className: 'ydo-bd-card-body-gap' },
            rewritten.summary ? h('p', { className: 'ydo-hint' }, rewritten.summary) : null,
            h(RewrittenSegmentList, { segments: rewritten.segments, originalSegments: original?.segments || null, t }))
          : h('p', { className: 'ydo-hint' }, t('bdSectionPending'))),
        h(FoldCard, {
          tone: 'recs', title: t('bdCardShotScript'),
          digest: shotQuotaDigest(storyboardRow.shotScript),
        },
        h(ShotScriptBlock, { shotScript: storyboardRow.shotScript, t })),
        h(FoldCard, {
          tone: 'dims', title: t('bdCardRule'),
          digest: ruleResolved
            ? (ruleResolved.name || ruleResolved.rewriteRuleId)
            : t('bdRuleDefault'),
        },
        ruleResolved
          ? h('div', { className: 'ydo-bd-rule-used' },
            h('div', null,
              h(RulePill, { rule: ruleResolved, t }),
              ruleResolved.description && ruleResolved.description !== ruleResolved.name
                ? h('span', { className: 'ydo-bd-rule-desc' }, ruleResolved.description)
                : null),
            rule.prompt && rule.prompt !== ruleResolved.description
              ? h('p', { className: 'ydo-hint' }, rule.prompt)
              : null)
          : h('p', { className: 'ydo-hint' }, t('bdRuleNone')))))
}

// 折叠卡复用 0916 AI 卡结构（.ydo-ai-card + 左边框色调类 summary/patterns/recs/dims），
// 开关状态每卡内部持有（方案 §4.2：原视频拆解与改写分镜默认展开）。
function FoldCard({ tone, title, defaultOpen = false, digest = null, children }) {
  const [open, setOpen] = React.useState(defaultOpen)
  return h('section', { className: `ydo-ai-card ydo-ai-card-${tone}${open ? ' ydo-ai-card-open' : ''}` },
    h('button', {
      type: 'button', className: 'ydo-ai-card-toggle', 'aria-expanded': open,
      onClick: () => setOpen(value => !value),
    },
    h('span', { className: 'ydo-ai-arrow', 'aria-hidden': true }, '▶'),
    h('h4', null, title),
    digest ? h('span', { className: 'ydo-ai-digest' }, digest) : null),
    open ? h('div', { className: 'ydo-ai-card-body' }, children) : null)
}

// 重新改写弹框（方案 §4.1）：规则单选 + 取消/开始改写。确认回传选中的
// rewriteRuleId（可为 null = 不带规则）；client.js 以新幂等键 workflowStart，
// 新规则版本 = 新 workflow 记录。规则选中态在弹框内部持有，关闭即复位（open 分支重挂）。
export function BreakdownRewriteModal({ open, rules, submitting, onConfirm, onClose, t }) {
  const [ruleId, setRuleId] = React.useState(null)
  if (!open) return null
  // 预览稿 dialog 口径：560px 居中、radius 10、深遮罩；特化类只覆盖宽度/
  // 遮罩/字号/底部按钮行，交互复用 ydo-ai-modal 既有结构（含右上 × 关闭）。
  return h('div', { className: 'ydo-ai-modal-overlay ydo-bd-modal-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('bdRewriteTitle') },
    h('div', { className: 'ydo-ai-modal ydo-bd-modal' },
      h('button', { type: 'button', className: 'ydo-ai-modal-close', 'aria-label': t('close'), onClick: onClose },
        h(IconCloseOutline16, { size: 16 })),
      h('div', { className: 'ydo-ai-modal-body' },
        h('h3', null, t('bdRewriteTitle')),
        h('p', { className: 'ydo-hint' }, t('bdRewriteHint')),
        h(BreakdownRulePicker, { rules, value: ruleId, onChange: setRuleId, disabled: submitting, t })),
      h('div', { className: 'ydo-bd-modal-actions' },
        h('button', { type: 'button', className: 'ydo-confirm-secondary', disabled: submitting, onClick: onClose }, t('confirmNo')),
        h('button', {
          type: 'button', className: 'ydo-confirm-primary', disabled: submitting, 'aria-busy': submitting,
          onClick: () => { onConfirm(ruleId); setRuleId(null) },
        }, t('bdRewriteStart')))))
}
