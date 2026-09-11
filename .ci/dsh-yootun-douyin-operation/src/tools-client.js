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

/**
 * 出网前的载荷净化：深度剔除 `undefined` 值属性与非有限数值。
 *
 * 宿主 ToolRuntime 在派发前用 `snapshotJsonValue` 做「无损 JSON」校验：
 * 任何属性值为 undefined（或 NaN/Infinity）都会让**整个调用**在进程内被拒绝
 * （`Error: tool execution arguments must be losslessly JSON-serializable`），
 * 网络层零痕迹。`avatar: profile.avatar || undefined` 这类写法因此是致命的——
 * 服务端明明把这些字段声明为可选。这里统一收敛，调用侧不再依赖运气。
 */
export function toWireArgs(value) {
  if (Array.isArray(value)) {
    // 数组补 null 保下标；对象属性则直接剔除（与非 Optional 字段的 null 冲突更小）。
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
  // -0 会被宿主 snapshotJsonValue 判为非无损 JSON（Object.is(-0) 检查），归一化为 0。
  if (Object.is(value, -0)) return 0
  return value
}

/**
 * 从宿主错误文本中提取 JSON envelope。
 *
 * 真实宿主（dsh-tools `toolErrorResult`）对**所有** isError 结果统一输出
 * `` `Error: ${message}` `` 前缀文本——服务端业务 envelope 到达插件时形如
 * `Error: {"error":{"code":"ACCOUNT_NOT_FOUND",...}}`。直接 JSON.parse 必然
 * 失败、把确定性业务错误打成传输兜底码。这里依次尝试：原文 → 去 `Error: `
 * 前缀 → 首个 `{` 到末个 `}` 的子串。
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

/** 同毫秒内的并发调用也会拿到唯一 callId（登录轮询/采集进度会并行触发多条调用）。 */
let callIdSeq = 0

/** 调用 tools 工具并返回 structuredContent（兼容 content[0].text 的 JSON 形态）。 */
export async function callTool(ctx, name, args, { signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS), callIdPrefix = 'yootun-douyin' } = {}) {
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
 * tools 服务端把错误 envelope **同时**写进 content 文本与 structuredContent
 * （mcp/core/errors.py `tool_error`：content=[text(envelope)], structuredContent=envelope,
 * isError=true）。三条路径都必须拦截，否则 ACCOUNT_NOT_FOUND 这类确定性业务错误
 * 会被当成功返回——历史上空 run 因此被持久化成 runId: null 的脏状态。
 */
export function parseToolResult(result) {
  if (!result || typeof result !== 'object') return {}
  if (result.isError === true) {
    const text = Array.isArray(result.content)
      ? result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
      : ''
    // 宿主对 isError 文本统一加 `Error: ` 前缀（dsh-tools toolErrorResult），
    // 必须经 extractJsonEnvelope 才能还原服务端业务 envelope。
    const code = errorEnvelopeCode(extractJsonEnvelope(text))
    throw new ToolsCallError('unknown', code ? safeErrorCode(code) : 'douyin_operation_request_failed')
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
 * 入参既可以是宿主抛出的 Error（从 message 中的 JSON envelope 提取），
 * 也可以是 parseToolResult 已从 envelope 解析出的裸错误码字符串。
 */
export function safeErrorCode(error) {
  if (typeof error === 'string') return ALLOWED_ERROR_CODES.has(error) ? error : 'douyin_operation_request_failed'
  const raw = error && typeof error.message === 'string' ? error.message : ''
  // 宿主抛错文本可能带 `Error: ` 前缀或包装文案，先还原 envelope 再取码。
  const payload = extractJsonEnvelope(raw)
  if (payload) {
    const code = payload?.error?.code
    if (typeof code === 'string' && ALLOWED_ERROR_CODES.has(code)) return code
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
//
// session 键必须带上 checkedAt：服务端幂等收据（mcp_mutations）持久保留，而客户端
// 重装/换机后 sessionSeq 会从 1 重新计数——同键不同载荷（checkedAt 必然不同）会被
// 判 IDEMPOTENCY_CONFLICT，且服务端残留的 indeterminate 收据永不放行（2026-09-11
// 实测：旧尝试留下的 seq=1 收据让后续所有登录的状态上报全部被拒）。键内纳入
// checkedAt 后「同键 ⇒ 同载荷」，重试仍走幂等回放，新探测永远拿新键。
export const sessionIdempotencyKey = (accountId, seq, checkedAt) => {
  const stamp = Date.parse(checkedAt)
  // base36 压缩：schema 上限（80 字符账号 + 20 位序号）下 13 位十进制时间戳会破 128。
  const suffix = Number.isFinite(stamp) ? stamp.toString(36) : 'na'
  return `douyin:session:${accountId}:${seq}:${suffix}`
}
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
