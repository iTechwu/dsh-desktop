/**
 * 插件配置解析：只保留非敏感的运行参数（limits.maxBytes / tool.timeoutMs）。
 *
 * 契约（与 AGENTS/README 一致）：
 * - apply(ctx, config) 的第二参数是 Cordis Loader 行 config，插件绝不读 ctx.config；
 * - 本插件已不再持有 TOS 凭证或桶/地域/endpoint 拓扑——上传授权一律由
 *   Tools 服务的 `tos_upload_authorize` 工具下发（PUT 预签名 URL），凭证与
 *   内部拓扑永不出服务端；
 * - 因此这里不再解析 STORAGE_* 环境变量 / $DSH_HOME 密钥文件，也不接受任何
 *   AK/SK、bucket、region、endpoint、keyPrefix 配置字段；
 * - 配置非法时插件仍可加载，但进入“不可上传”降级状态（ready=false + errors）。
 */

export const DEFAULT_MAX_BYTES = 500 * 1024 * 1024
export const DEFAULT_TOOL_TIMEOUT_MS = 30 * 60 * 1000

/** 单文件大小硬上限：2GB（配置超过此值直接判非法）。 */
export const MAX_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** 工具超时硬上限：60 分钟。 */
export const MAX_TOOL_TIMEOUT_MS = 60 * 60 * 1000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 正整数解析，越界或非法返回 null（由调用方决定降级方式）。 */
function toBoundedPositiveInt(value, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  const floored = Math.floor(parsed)
  if (floored > max) return null
  return floored
}

/**
 * 合成生效配置。
 * @param {object} [rowConfig] Cordis Loader 行 config（apply 第二参数，仅非敏感项）。
 * @returns {{limits:{maxBytes:number}, tool:{timeoutMs:number}, ready:boolean, errors:string[]}}
 */
export function loadConfig(rowConfig = {}) {
  const row = isPlainObject(rowConfig) ? rowConfig : {}
  const limits = isPlainObject(row.limits) ? row.limits : {}
  const tool = isPlainObject(row.tool) ? row.tool : {}

  /** 配置校验问题（不阻断加载，只降级上传能力）。 */
  const errors = []

  // maxBytes：正整数且不超过硬上限。
  const maxBytesRaw = limits.maxBytes
  const maxBytes = maxBytesRaw === undefined
    ? DEFAULT_MAX_BYTES
    : toBoundedPositiveInt(maxBytesRaw, MAX_MAX_BYTES)
  if (maxBytes === null) {
    errors.push(`invalid limits.maxBytes "${maxBytesRaw}" (must be a positive integer <= ${MAX_MAX_BYTES})`)
  }

  // timeoutMs：正整数且不超过硬上限。
  const timeoutMsRaw = tool.timeoutMs
  const timeoutMs = timeoutMsRaw === undefined
    ? DEFAULT_TOOL_TIMEOUT_MS
    : toBoundedPositiveInt(timeoutMsRaw, MAX_TOOL_TIMEOUT_MS)
  if (timeoutMs === null) {
    errors.push(`invalid tool.timeoutMs "${timeoutMsRaw}" (must be a positive integer <= ${MAX_TOOL_TIMEOUT_MS})`)
  }

  return {
    limits: {
      maxBytes: maxBytes ?? DEFAULT_MAX_BYTES,
    },
    tool: {
      timeoutMs: timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    },
    /** 结构合法即可上传（授权能力在运行时由 Tools MCP 工具提供，不依赖本地凭证）。 */
    ready: errors.length === 0,
    /** 配置校验问题（诊断日志用，不含敏感值）。 */
    errors,
  }
}
