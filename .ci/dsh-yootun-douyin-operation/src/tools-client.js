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

export function findTool(ctx, name) {
  const schemas = ctx?.tools?.schemas?.() || []
  return schemas.find(item => String(item?.name || '').endsWith(name)) || null
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
  if (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)) {
    return result.structuredContent
  }
  if (Array.isArray(result.content)) {
    const text = result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
    if (!text) return {}
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && parsed.error && parsed.error.code) {
        throw new ToolsCallError('unknown', safeErrorCode(parsed.error.code))
      }
      return parsed
    } catch (error) {
      if (error instanceof ToolsCallError) throw error
      return {}
    }
  }
  return result
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
export const accountSaveIdempotencyKey = (accountId, stamp = Date.now()) => `douyin:account:${accountId}:${stamp}`
export const accountRemoveIdempotencyKey = (accountId, stamp = Date.now()) => `douyin:account_remove:${accountId}:${stamp}`
