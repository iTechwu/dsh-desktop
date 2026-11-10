// tools 调用封装：只经宿主 `ctx.tools.execute`（= 公共网关 https://ixicai.cn/mcp/tools/wx-channels-operation）。
//
// 凭证边界：本模块**不接触** Cookie/storage_state；`sessionRef` 只是 vault:// 不透明引用。
// 错误只回传白名单内的稳定码，不透传传输错误或原始报文。

const TOOL_CALL_TIMEOUT_MS = 60_000
export const TOOL_NAMES = [
  'wx_channels_account_save',
  'wx_channels_account_remove',
  'wx_channels_session_status_report',
  'wx_channels_collect_run_start',
  'wx_channels_collect_run_set_list_meta',
  'wx_channels_collect_run_heartbeat',
  'wx_channels_collect_ingest_works',
  'wx_channels_collect_ingest_account_metrics',
  'wx_channels_collect_ingest_fans_trend',
  'wx_channels_collect_ingest_fans_profile',
  'wx_channels_collect_run_finish',
  'wx_channels_collect_run_cancel',
  'wx_channels_account_list',
  'wx_channels_collect_run_get',
  'wx_channels_work_list',
  'wx_channels_work_get',
  'wx_channels_work_trend',
  'wx_channels_account_overview',
  'wx_channels_fans_profile_get',
]

// 与 tools 服务端 §16.7 稳定错误码全集一一对应（tools mcp/domains/common.py
// ValueError 哨兵映射 + BusinessError error_code）。
const ALLOWED_ERROR_CODES = new Set([
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_NOT_ACCESSIBLE',
  'CONFIRMATION_REQUIRED',
  'LOCAL_CLEARED_REQUIRED',
  'DELETE_CLEANUP_FAILED',
  'WORK_NOT_FOUND',
  'RUN_NOT_FOUND',
  'RUN_ACCOUNT_MISMATCH',
  'RUN_NOT_RUNNING',
  'RUN_STILL_ACTIVE',
  'RUN_LIST_META_REQUIRED',
  'LIST_INCOMPLETE',
  'TIME_SERIES_LENGTH_MISMATCH',
  'FIELD_LENGTH_MISMATCH',
  'INVALID_DAY_RANGE',
  'INVALID_SORT',
  'INVALID_TIME_WINDOW',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_IDEMPOTENCY_KEY',
  'VALIDATION_ERROR',
  'PAYLOAD_TOO_LARGE',
  'UNAUTHORIZED',
  'HEARTBEAT_SEQ_REGRESSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_OUTCOME_UNKNOWN',
  'IDEMPOTENCY_KEY_REQUIRED',
])

export class ToolsUnavailableError extends Error {
  constructor(tool) {
    super('wx_channels_operation_tool_unavailable')
    this.name = 'ToolsUnavailableError'
    this.code = 'WX_TOOL_UNAVAILABLE'
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
 * （整名相等，或以 `__` 相接为后缀），避免 `wx_channels_work_list_extra`
 * 这类同前缀工具被误判成 `wx_channels_work_list`。
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

/**
 * 出网前的载荷净化：深度剔除 `undefined` 值属性与非有限数值。
 *
 * 宿主 ToolRuntime 在派发前用 `snapshotJsonValue` 做「无损 JSON」校验：任何属性值为
 * undefined（或 NaN/Infinity）都会让整个调用在进程内被拒绝。统一收敛，调用侧不再
 * 依赖运气。
 */
export function toWireArgs(value) {
  if (Array.isArray(value)) {
    return value.map(item => (typeof item === 'number' && !Number.isFinite(item) ? null : toWireArgs(item)))
  }
  if (value && typeof value === 'object') {
    const target = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      if (typeof item === 'number' && !Number.isFinite(item)) continue
      target[key] = toWireArgs(item)
    }
    return target
  }
  if (Object.is(value, -0)) return 0
  return value
}

/**
 * 从宿主错误文本中提取 JSON envelope。
 *
 * 真实宿主对**所有** isError 结果统一输出 `` `Error: ${message}` `` 前缀文本——
 * 服务端业务 envelope 到达插件时形如 `Error: {"error":{"code":"ACCOUNT_NOT_FOUND",...}}`。
 * 依次尝试：原文 → 去 `Error: ` 前缀 → 首个 `{` 到末个 `}` 的子串。
 */
export function extractJsonEnvelope(text) {
  if (typeof text !== 'string') return null
  const candidates = [text, text.replace(/^Error:\s*/iu, '')]
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate)
    if (parsed !== null) return parsed
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return tryParseJson(text.slice(start, end + 1))
  return null
}

let callIdSeq = 0

/** 调用 tools 工具并返回 structuredContent（兼容 content[0].text 的 JSON 形态）。 */
export async function callTool(ctx, name, args, { signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS), callIdPrefix = 'yootun-wx-channels' } = {}) {
  const schema = requireTool(ctx, name)
  let result
  try {
    result = await ctx.tools.execute({
      callId: `${callIdPrefix}-${Date.now()}-${++callIdSeq}`,
      name: schema.name,
      arguments: toWireArgs(args),
      signal,
    })
  } catch (error) {
    throw new ToolsCallError(name, safeErrorCode(error))
  }
  return parseToolResult(result)
}

/** 服务端错误 envelope 形如 {"error":{"code","message",...}}；无错误时返回 null。 */
function errorEnvelopeCode(payload) {
  if (!payload || typeof payload !== 'object') return null
  const code = payload.error && payload.error.code
  return typeof code === 'string' && code ? code : null
}

/**
 * 解析工具执行结果并返回 structuredContent（兼容 content[0].text 的 JSON 形态）。
 *
 * tools 服务端把错误 envelope 同时写进 content 文本与 structuredContent；三条路径
 * 都必须拦截，否则确定性业务错误会被当成功返回。
 */
export function parseToolResult(result) {
  if (!result || typeof result !== 'object') return {}
  if (result.isError === true) {
    const text = Array.isArray(result.content)
      ? result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
      : ''
    const code = errorEnvelopeCode(extractJsonEnvelope(text))
    throw new ToolsCallError('unknown', code ? safeErrorCode(code) : 'wx_channels_operation_request_failed')
  }
  const structured = result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)
    ? result.structuredContent
    : null
  const code = errorEnvelopeCode(structured)
  if (code) throw new ToolsCallError('unknown', safeErrorCode(code))
  if (structured) return structured
  if (Array.isArray(result.content)) {
    const text = result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
    if (!text) return {}
    const parsed = tryParseJson(text)
    if (parsed === null) return {}
    const errorCode = errorEnvelopeCode(parsed)
    if (errorCode) throw new ToolsCallError('unknown', safeErrorCode(errorCode))
    return parsed
  }
  return result
}

function tryParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 把错误收敛为稳定码：白名单外一律 unknown 兜底码，不透传原文。
 */
export function safeErrorCode(error) {
  if (typeof error === 'string') return ALLOWED_ERROR_CODES.has(error) ? error : 'wx_channels_operation_request_failed'
  const raw = error && typeof error.message === 'string' ? error.message : ''
  const payload = extractJsonEnvelope(raw)
  if (payload) {
    const code = payload?.error?.code
    if (typeof code === 'string' && ALLOWED_ERROR_CODES.has(code)) return code
  }
  if (typeof raw === 'string' && ALLOWED_ERROR_CODES.has(raw)) return raw
  if (error && typeof error.code === 'string' && error.code === 'WX_TOOL_UNAVAILABLE') return error.code
  return 'wx_channels_operation_request_failed'
}

// 幂等键模板（与 tools 服务端 constants.py / common.py 一一对应，开发实施文档 §7.2）。
//
// - `run_start` 键不嵌账号且键段 == runId（服务端 suffix 模板强制）：runId ≤71，
//   `wx_channels:run_start:{runId}` = 22+36 ≈ 58 ≤128；finderUsername 86 字符嵌账号
//   会突破全域幂等键 1–128 不变量。账号绑定由载荷 accountId 进 stable_request_hash；
//   同 attempt 复用同 runId 即同键（重试/恢复安全）。
// - `account_save` / `account_remove` 键带时间戳（对齐抖音客户端惯例）：save 是
//   upsert（资料会变），remove 后账号可能重新登录；固定键会命中历史回据吞掉新
//   请求。服务端只做前缀校验。
// - session 键与服务端严格相等校验一致（键内不得带 checkedAt 等额外后缀）。
export const sessionIdempotencyKey = (accountId, seq) => `wx_channels:session:${accountId}:${seq}`
export const runStartIdempotencyKey = runAttemptId => `wx_channels:run_start:${runAttemptId}`
export const listMetaIdempotencyKey = runId => `wx_channels:run_meta:${runId}`
export const heartbeatIdempotencyKey = (runId, seq) => `wx_channels:heartbeat:${runId}:${seq}`
export const ingestWorksIdempotencyKey = (runId, batchNo) => `wx_channels:ingest_works:${runId}:${batchNo}`
// 账号级三类入库批次号由服务端分配（§16.5），幂等键嵌 runId 与窗口（客户端自生成）。
export const ingestAccountMetricsIdempotencyKey = (runId, startDay, endDay) =>
  `wx_channels:ingest_account_metrics:${runId}:${startDay}:${endDay}`
export const ingestFansTrendIdempotencyKey = (runId, startDay, endDay) =>
  `wx_channels:ingest_fans_trend:${runId}:${startDay}:${endDay}`
export const ingestFansProfileIdempotencyKey = (runId, day) =>
  `wx_channels:ingest_fans_profile:${runId}:${day}`
export const runFinishIdempotencyKey = runId => `wx_channels:run_finish:${runId}`
export const runCancelIdempotencyKey = runId => `wx_channels:run_cancel:${runId}`
// 账号保存/删除的键带**时间戳**而不是固定值（对齐抖音 client 惯例，服务端只做前缀校验）：
// save 是 upsert（昵称/粉丝数会变），固定键会命中历史回执吞掉新资料；remove 后账号
// 可能被重新登录创建，固定键同样会跳过新数据的清理。
export const accountSaveIdempotencyKey = (accountId, stamp = Date.now()) => `wx_channels:account_save:${accountId}:${stamp}`
export const accountRemoveIdempotencyKey = (accountId, stamp = Date.now()) => `wx_channels:account_remove:${accountId}:${stamp}`
