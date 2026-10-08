// 片段 2/7：数值/日期格式化与口径计算（对齐前端 finance-format.ts：万元 1 位小数千分位，空值 —）

function finite(value) {
  const parsed = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value) {
  const parsed = finite(value)
  return parsed === null ? null : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(parsed)
}

/** 元 → 万元（≥1 亿转亿）；1 位小数千分位，对齐前端 wanLabel 口径 */
function wan(value) {
  const parsed = finite(value)
  if (parsed === null) return null
  if (Math.abs(parsed) >= 100000000) return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(parsed / 100000000)} 亿`
  if (Math.abs(parsed) >= 10000) return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(parsed / 10000)} 万`
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(parsed)
}

/** 执行率等比值 → 百分数字符串 */
function ratio(part, total) {
  const p = finite(part), t = finite(total)
  if (p === null || !t) return null
  return `${Math.round((p / t) * 100)}%`
}

/** 环比：(本期-上期)/|上期| → 百分比（上期为 0 时返回 null） */
function momDelta(current, previous) {
  const c = finite(current), p = finite(previous)
  if (c === null || p === null || p === 0) return null
  return `${c >= p ? '+' : ''}${Math.round(((c - p) / Math.abs(p)) * 100)}%`
}

function shortDate(value) {
  if (!value) return null
  return String(value).slice(0, 10)
}

function yearOptions() {
  const year = new Date().getFullYear()
  // 近 7 年倒序，对齐前端全局年度筛选
  return Array.from({ length: 7 }, (_, index) => [String(year - index), String(year - index)])
}

/** 执行率热力分档：>100 超支 / ≥70 健康 / ≥30 偏慢 / 其余早期 */
function heatLevel(execRate) {
  const value = typeof execRate === 'number' ? execRate : null
  if (value === null) return null
  if (value > 1) return 'over'
  if (value >= 0.7) return 'healthy'
  if (value >= 0.3) return 'slow'
  return 'early'
}

/** (已打PR+预计PR)/预算，未传预算返回 null */
function execRateOf(prSubmitted, prEstimated, budget) {
  const budgetValue = finite(budget)
  if (!budgetValue) return null
  return ((finite(prSubmitted) ?? 0) + (finite(prEstimated) ?? 0)) / budgetValue
}

/** 审批链状态 → 中文键（调整单/调增单共用） */
const ADJ_STATUS_KEYS = {
  DRAFT: 'stDraft', SUBMITTED: 'stSubmitted', APPROVED: 'stApproved',
  POSTED: 'stPosted', REJECTED: 'stRejected', CANCELLED: 'stCancelled',
}
/** 审批链状态 → 语义色（对齐前端 pill 套路） */
const ADJ_STATUS_TONES = {
  DRAFT: 'muted', SUBMITTED: 'blue', APPROVED: 'amber', POSTED: 'green',
  REJECTED: 'rose', CANCELLED: 'muted',
}
/** 预算版本状态 */
const VERSION_STATUS_KEYS = { DRAFT: 'vstDraft', CONFIRMED: 'vstConfirmed', PUBLISHED: 'vstPublished', LOCKED: 'vstLocked' }
const VERSION_STATUS_TONES = { DRAFT: 'muted', CONFIRMED: 'blue', PUBLISHED: 'green', LOCKED: 'amber' }
/** 预警处理状态 */
const ALERT_STATUS_KEYS = { OPEN: 'stPending', CONFIRMED: 'stConfirmed', RESOLVED: 'stResolved', IGNORED: 'stIgnored' }
/** 预警严重度 → 语义色 */
const SEVERITY_TONES = { CRITICAL: 'rose', WARN: 'amber', INFO: 'sky' }
const SEVERITY_KEYS = { CRITICAL: 'sevCritical', WARN: 'sevWarn', INFO: 'sevInfo' }
