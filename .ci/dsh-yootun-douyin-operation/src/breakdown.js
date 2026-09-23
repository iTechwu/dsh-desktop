// 爆款拆解 Tab UI 模块（0922 方案 §4.1）。
//
// 职责边界与 overview-ui / analysis-ui 相同：只做展示与本地格式化，零口径计算；
// 状态文案（状态标签/步骤名/错误文案）一律以 copy 登记为准，组件只按 reason 键取文案。
// 数据源 = 宿主 breakdown.* action（index.js 组合 viral_video 域工具）：
// - workflow 投影（history / workflowStatus）：状态/当前步骤/标题作者（P2 已把服务端
//   蛇形 candidate_id 归一化为 candidateId）
// - detail.storyboards[0]：originalVideoAnalysis / rewrittenStoryboard / shotScript /
//   input（规则回显）四块投影
// - detail.analysis.candidates[0].products.asr.transcript：口播全文
// 拍摄脚本是服务端产出的 Markdown 表格（纯文本），用 shotScriptTable 解析后以普通
// 表格元素渲染（React 文本子节点自动转义，无 HTML 注入面），不引入 markdown 依赖。

import { formatDateTime } from './ui-format.js'

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

// 8 步进度条：终态（succeeded 或 currentStep=completed）整条完成；进行中当前步
// 高亮、之前的步视为已过。失败时服务端把 current_step 覆写为 'failed'（不在本
// 数组内，indexOf=-1），进度条整体保持灰态——失败原因由详情页失败文案专门承载。
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
      }, t(`bdStep_${step}`))
    }))
}

// 段落角色语义色标签（hook/build/turn/cta），未登记角色走中性「其他」。
const ROLE_TONES = Object.freeze(['hook', 'build', 'turn', 'cta'])

function RoleTag({ role, t }) {
  const tone = ROLE_TONES.includes(role) ? role : 'other'
  return h('span', { className: `ydo-bd-role ydo-bd-role-${tone}` }, t(`bdRole_${tone}`))
}

// 原视频拆解分段：时间 + 角色标签 + 画面 + 口播，纵向卡片列表（窄幅不挤压）。
function OriginalSegmentList({ segments, t }) {
  return h('div', { className: 'ydo-bd-seg-list' },
    ...segments.map((segment, index) => h('div', { key: index, className: 'ydo-bd-seg' },
      h('div', { className: 'ydo-bd-seg-head' },
        h('span', { className: 'ydo-bd-seg-time' }, segment.timeRange || '—'),
        h(RoleTag, { role: segment.role, t })),
      h('p', { className: 'ydo-bd-seg-visual' }, segment.originalVisual || '—'),
      segment.originalSpeech ? h('p', { className: 'ydo-bd-seg-speech' }, segment.originalSpeech) : null)))
}

// 改写分镜卡片：新口播为主行、新画面次行，标注来源段落（sourceSegmentIndexes）。
function RewrittenSegmentList({ segments, t }) {
  return h('div', { className: 'ydo-bd-seg-list' },
    ...segments.map((segment, index) => h('div', { key: index, className: 'ydo-bd-seg' },
      h('div', { className: 'ydo-bd-seg-head' },
        h('span', { className: 'ydo-bd-seg-time' }, segment.timeRange || '—'),
        h(RoleTag, { role: segment.role, t }),
        h('span', { className: 'ydo-bd-seg-source' },
          `${t('bdSourceFrom')} ${Array.isArray(segment.sourceSegmentIndexes) && segment.sourceSegmentIndexes.length
            ? segment.sourceSegmentIndexes.map(i => `#${i}`).join(' ')
            : '—'}`)),
      segment.rewrittenSpeech ? h('p', { className: 'ydo-bd-seg-copy' }, segment.rewrittenSpeech) : null,
      segment.rewrittenVisual ? h('p', { className: 'ydo-bd-seg-visual' }, segment.rewrittenVisual) : null)))
}

// 拍摄脚本：景别配额摘要行 + Markdown 表格横向滚动 + 表格外段落。
function ShotScriptBlock({ shotScript, t }) {
  if (!shotScript || shotScript.status !== 'succeeded' || !shotScript.markdown) {
    return h('p', { className: 'ydo-hint' }, t('bdSectionPending'))
  }
  const parsed = shotScriptTable(shotScript.markdown)
  const quotas = shotScript.shotSizeQuotas
  const quotaText = quotas && typeof quotas === 'object' && !Array.isArray(quotas)
    ? Object.entries(quotas).map(([size, count]) => `${size}×${count}`).join(' · ')
    : ''
  return h('div', null,
    quotaText ? h('p', { className: 'ydo-hint' }, `${t('bdShotQuotas')}：${quotaText}`) : null,
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
      h('span', { className: 'ydo-bd-radio-name' }, rule.name),
      rule.description ? h('span', { className: 'ydo-bd-radio-desc' }, rule.description) : null))
      : h('span', { className: 'ydo-hint' }, t('bdRulesEmpty')))
}

// ---------------------------------------------------------------------------
// 三个视图 + 重新改写弹框（开关由 client.js 持有，接入统一 Esc 链）。
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
  return h('section', { className: 'ydo-ov-panel' },
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
    h('p', { className: 'ydo-hint' }, t('bdRulesHint')),
    rulesError
      ? h('div', null,
        h('p', { className: 'ydo-error', role: 'alert' }, t(rulesError)),
        onRetryRules
          ? h('button', {
            type: 'button', className: 'ydo-secondary', style: { marginTop: 6 },
            onClick: () => onRetryRules(),
          }, t('bdRulesRetry'))
          : null)
      : h(BreakdownRulePicker, { rules, value: ruleId, onChange: setRuleId, disabled: submitting, t }),
    archiveTask
      ? h('div', { className: 'ydo-progress', role: 'status', 'aria-live': 'polite', 'aria-busy': true },
        h('span', { className: 'ydo-spinner' }),
        h('span', null, t('bdArchivePending')))
      : null)
}

export function BreakdownHistoryList({ history, loading, errorReason, onOpen, t }) {
  if (errorReason) return h('p', { className: 'ydo-error', role: 'alert' }, t(errorReason))
  if (!history.length) {
    return h('p', { className: 'ydo-hint', role: 'status' }, loading ? t('loading') : t('bdHistoryEmpty'))
  }
  // 行数据 = workflow 投影（无播放量/规则字段；规则回显在详情页第五卡）。
  return h('div', { className: 'ydo-bd-history', role: 'list', 'aria-label': t('bdHistoryLabel') },
    ...history.map((item, index) => h('button', {
      key: `${item.candidateId}-${item.admin?.workflowId || index}`,
      type: 'button', className: 'ydo-bd-row', role: 'listitem',
      onClick: () => onOpen(item),
    },
    h('span', { className: 'ydo-bd-row-main' },
      h('span', { className: 'ydo-bd-row-title' }, item.candidateTitle || item.candidateId || '—'),
      item.candidateAuthor ? h('span', { className: 'ydo-bd-row-author' }, item.candidateAuthor) : null),
    h(StatusBadge, { status: item.status, t }),
    h('span', { className: 'ydo-bd-row-step' }, item.currentStepLabel || '—'),
    h('span', { className: 'ydo-bd-row-time' }, formatDateTime(item.updatedAt)))))
}

export function BreakdownDetailPage({ workflow, detail, loading, errorReason, onBack, onRequestRewrite, t }) {
  if (errorReason) {
    return h('div', { className: 'ydo-state ydo-state-error', role: 'alert' },
      h('p', null, t(errorReason)),
      h('button', { type: 'button', className: 'ydo-secondary', onClick: onBack }, t('bdBackToList')))
  }
  const storyboardRow = latestStoryboard(detail)
  const original = storyboardRow?.originalVideoAnalysis || null
  const rewritten = storyboardRow?.rewrittenStoryboard || null
  const transcript = asrTranscript(detail)
  const rule = usedRule(storyboardRow)
  // 失败文案承载两态：error 色失败，以及 needs_input（warn 色但带 errorCode 的
  // 同步失败 payload，如 needs_product_input——用户需要知道为什么没有产出）。
  const failed = Boolean(
    workflow && (breakdownStatusTone(workflow.status) === 'error' || workflow.status === 'needs_input'),
  )
  const pending = !workflow || (!failed && breakdownStatusTone(workflow.status) === 'running')
  return h('div', { className: 'ydo-bd-page' },
    h('div', { className: 'ydo-an-toolbar' },
      h('button', { type: 'button', className: 'ydo-secondary', onClick: onBack }, t('bdBackToList')),
      h('button', {
        type: 'button', className: 'ydo-secondary',
        disabled: pending || loading,
        onClick: onRequestRewrite,
      }, t('bdRewriteButton'))),
    workflow
      ? h('header', { className: 'ydo-an-head' },
        h('div', { className: 'ydo-bd-head-row' },
          h('h3', null, workflow.candidateTitle || workflow.candidateId || '—'),
          h(StatusBadge, { status: workflow.status, t })),
        workflow.candidateAuthor ? h('p', { className: 'ydo-hint' }, workflow.candidateAuthor) : null,
        h(StepProgress, { workflow, t }),
        failed ? h('p', { className: 'ydo-error', role: 'alert' }, t(workflowErrorCopyKey(workflow))) : null,
        pending ? h('p', { className: 'ydo-hint', role: 'status' }, t('bdRunningHint')) : null)
      : null,
    loading && !storyboardRow
      ? h('div', { className: 'ydo-state', role: 'status' }, h('span', { className: 'ydo-spinner' }), h('p', null, t('loading')))
      : !storyboardRow
      ? h('p', { className: 'ydo-hint', role: 'status' }, t('bdDetailEmpty'))
      : h('div', { className: 'ydo-bd-cards' },
        h(FoldCard, {
          tone: 'summary', title: t('bdCardOriginal'), defaultOpen: true,
          digest: original ? `${original.segments.length} ${t('bdSegmentUnit')}` : null,
        },
        original
          ? h('div', null,
            original.summary ? h('blockquote', { className: 'ydo-bd-quote' }, original.summary) : null,
            h(OriginalSegmentList, { segments: original.segments, t }))
          : h('p', { className: 'ydo-hint' }, t('bdSectionPending'))),
        h(FoldCard, { tone: 'dims', title: t('bdCardTranscript') },
          transcript
            ? h('blockquote', { className: 'ydo-bd-quote' }, transcript)
            : h('p', { className: 'ydo-hint' }, t('bdSectionPending'))),
        h(FoldCard, {
          tone: 'patterns', title: t('bdCardStoryboard'), defaultOpen: true,
          digest: rewritten ? `${rewritten.segments.length} ${t('bdSegmentUnit')}` : null,
        },
        rewritten
          ? h('div', null,
            rewritten.summary ? h('p', { className: 'ydo-hint' }, rewritten.summary) : null,
            h(RewrittenSegmentList, { segments: rewritten.segments, t }))
          : h('p', { className: 'ydo-hint' }, t('bdSectionPending'))),
        h(FoldCard, { tone: 'recs', title: t('bdCardShotScript') },
          h(ShotScriptBlock, { shotScript: storyboardRow.shotScript, t })),
        h(FoldCard, { tone: 'dims', title: t('bdCardRule'), digest: rule ? rule.id : null },
          rule
            ? h('div', { className: 'ydo-bd-rule-used' },
              h('span', { className: 'ydo-bd-role ydo-bd-role-other' }, rule.id),
              rule.prompt ? h('p', { className: 'ydo-hint' }, rule.prompt) : null)
            : h('p', { className: 'ydo-hint' }, t('bdRuleNone')))))
}

// 重新改写弹框（方案 §4.1）：规则单选 + 取消/开始改写。确认回传选中的
// rewriteRuleId（可为 null = 不带规则）；client.js 以新幂等键 workflowStart，
// 新规则版本 = 新 workflow 记录。规则选中态在弹框内部持有，关闭即复位（open 分支重挂）。
export function BreakdownRewriteModal({ open, rules, submitting, onConfirm, onClose, t }) {
  const [ruleId, setRuleId] = React.useState(null)
  if (!open) return null
  return h('div', { className: 'ydo-ai-modal-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('bdRewriteTitle') },
    h('div', { className: 'ydo-ai-modal' },
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
