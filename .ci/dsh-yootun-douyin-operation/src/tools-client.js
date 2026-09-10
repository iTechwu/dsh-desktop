// tools 调用封装：只经宿主 `ctx.tools.execute`（= 公共网关 https://ixicai.cn/mcp/tools/douyin-operation）。
//
// 凭证边界：本模块**不接触** Cookie/storage_state；`sessionRef` 只是 vault:// 不透明引用。
// 错误只回传白名单内的稳定码，不透传传输错误或原始报文。

const TOOL_CALL_TIMEOUT_MS = 60_000
export const TOOL_NAMES = [
  'douyin_account_save',
  'douyin_account_remove',
  'douyin_session_status_report',
  'douyin_collect_run_start',
  'douyin_collect_run_set_list_meta',
  'douyin_collect_run_heartbeat',
  'douyin_collect_ingest_batch',
  'douyin_collect_run_finish',
  'douyin_collect_run_cancel',
  'douyin_account_list',
  'douyin_work_list',
  'douyin_work_get',
  'douyin_work_trend',
  'douyin_collect_run_get',
  'douyin_export',
]

const ALLOWED_ERROR_CODES = new Set([
  'ACCOUNT_NOT_FOUND',
  'WORK_NOT_FOUND',
  'RUN_NOT_FOUND',
  'RUN_ACCOUNT_MISMATCH',
  'RUN_NOT_RUNNING',
  'RUN_STILL_ACTIVE',
  'RUN_LIST_META_REQUIRED',
  'HEARTBEAT_SEQ_REGRESSED',
  'INVALID_IDEMPOTENCY_KEY',
  'CONFIRMATION_REQUIRED',
  'VALIDATION_ERROR',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_OUTCOME_UNKNOWN',
  'UNAUTHORIZED',
  'PAYLOAD_TOO_LARGE',
])

export class ToolsUnavailableError extends Error {
  constructor(tool) {
    super('douyin_operation_tool_unavailable')
    this.name = 'ToolsUnavailableError'
    this.code = 'DOUYIN_TOOL_UNAVAILABLE'
    this.tool = tool
  }
}

export class ToolsCallError extends Error {
  constructor(tool, code) {
    super(code)
    this.name = 'ToolsCallError'
    this.code = code
    this.tool = tool
  }
}

/**
 * 解析宿主注入的工具 schema。
 *
 * 宿主把工具名限定为 `mcp__<client>__<tool>`；这里要求**分段边界**匹配
 * （整名相等，或以 `__` 相接为后缀），避免 `douyin_account_list_extra`
 * 这类同前缀工具被误判成 `douyin_account_list`。
 */
export function findTool(ctx, name) {
  const schemas = ctx?.tools?.schemas?.() || []
  return schemas.find((item) => {
    const candidate = String(item?.name || '')
    return candidate === name || candidate.endsWith(`__${name}`)
  }) || null
}

export function requireTool(ctx, name) {
  const schema = findTool(ctx, name)
  if (!schema) throw new ToolsUnavailableError(name)
  return schema
}

/** 调用 tools 工具并返回 structuredContent（兼容 content[0].text 的 JSON 形态）。 */
export async function callTool(ctx, name, args, { signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS), callIdPrefix = 'yootun-douyin' } = {}) {
  const schema = requireTool(ctx, name)
  let result
  try {
    result = await ctx.tools.execute({
      callId: `${callIdPrefix}-${Date.now()}`,
      name: schema.name,
      arguments: args,
      signal,
    })
  } catch (error) {
    throw new ToolsCallError(name, safeErrorCode(error))
  }
  return parseToolResult(result)
}

export function parseToolResult(result) {
  if (!result || typeof result !== 'object') return {}
  let payload = null
  if (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)) {
    payload = result.structuredContent
  } else if (Array.isArray(result.content)) {
    const text = result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        return {}
      }
    } else {
      payload = {}
    }
  } else {
    payload = result
  }
  if (toolResultFailed(result, payload)) {
    throw new ToolsCallError('unknown', toolErrorCode(result, payload))
  }
  return payload && typeof payload === 'object' ? payload : {}
}

// MCP 网关有时会把业务失败作为已解析的 JSON 返回，而不是 reject。
// 统一在工具边界识别这些形态，避免宿主把失败投影成 ready + 空数据。
function toolResultFailed(raw, payload) {
  if (raw?.isError === true || raw?.error || payload?.isError === true || payload?.error || payload?.ok === false) return true
  if (payload?.error && typeof payload.error === 'object') return true
  const status = typeof payload?.status === 'string' ? payload.status.toLowerCase() : ''
  return ['error', 'failed', 'failure', 'unavailable', 'blocked'].includes(status)
}

function toolErrorCode(raw, payload) {
  const candidates = [
    payload?.error?.code,
    payload?.reason,
    payload?.code,
    raw?.error?.code,
    raw?.reason,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && ALLOWED_ERROR_CODES.has(candidate)) return candidate
  }
  return 'douyin_operation_request_failed'
}

/** 把宿主/网关错误收敛为稳定码：白名单外一律 unknown，不透传原文。 */
export function safeErrorCode(error) {
  const raw = error && typeof error.message === 'string' ? error.message : ''
  try {
    const payload = JSON.parse(raw)
    const code = payload?.error?.code
    if (typeof code === 'string' && ALLOWED_ERROR_CODES.has(code)) return code
  } catch {
    // 非 JSON：继续按纯文本匹配。
  }
  if (typeof raw === 'string' && ALLOWED_ERROR_CODES.has(raw)) return raw
  if (error && typeof error.code === 'string' && error.code === 'DOUYIN_TOOL_UNAVAILABLE') return error.code
  return 'douyin_operation_request_failed'
}

// 幂等键模板（与 tools 服务端 constants.py / common.py 一一对应）。
//
// 键里不嵌账号的**唯一**一处是 run_start：真实 sec_uid 为 76 字符，
// `douyin:run_start:{accountId}:{uuid}` 会到 130 字符、突破仓库全域不变量
// （幂等键 1–128，tests/platform 强制）。去重锚点是本次尝试的 UUID，账号绑定由
// 载荷 accountId 与运行记录一致性校验保证。其余模板在 accountId/runId ≤80 时
// 最长 121 字符（见 tools 侧 services/douyin_operation/schemas.py 的算术注释）。
export const sessionIdempotencyKey = (accountId, seq) => `douyin:session:${accountId}:${seq}`
export const runStartIdempotencyKey = runAttemptId => `douyin:run_start:${runAttemptId}`
export const listMetaIdempotencyKey = runId => `douyin:list_meta:${runId}`
export const heartbeatIdempotencyKey = (runId, seq) => `douyin:heartbeat:${runId}:${seq}`
export const ingestIdempotencyKey = (runId, batchNo) => `douyin:ingest:${runId}:${batchNo}`
export const runFinishIdempotencyKey = runId => `douyin:run_finish:${runId}`
export const runCancelIdempotencyKey = runId => `douyin:run_cancel:${runId}`
// 账号保存/删除的键带**时间戳**而不是固定值，这是刻意为之：
// - `account_save` 是 upsert，昵称/粉丝数会变；固定键会让第二次保存命中历史回执、
//   把新资料吞掉；`account_remove` 是一次性单向清理，账号删除后可能被重新登录创建，
//   固定键同样会把新数据的清理跳过。
// - 时间戳让「用户每点一次 = 一次独立操作」，重试由服务端幂等/upsert 语义兜底，
//   不依赖客户端去重（当前也没有带重试的调用路径会因此重复）。
export const accountSaveIdempotencyKey = (accountId, stamp = Date.now()) => `douyin:account:${accountId}:${stamp}`
export const accountRemoveIdempotencyKey = (accountId, stamp = Date.now()) => `douyin:account_remove:${accountId}:${stamp}`
