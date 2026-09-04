/**
 * 统一错误模型：插件对外的全部错误码收敛在这里。
 *
 * 规则：
 * - 工具结果 / HTTP 响应只允许出现 ERROR_CODES 中的码值，日志才允许带诊断上下文；
 * - 底层错误（Node 系统码、内部校验码、对象存储状态码）通过 toPublicCode()
 *   归一化为固定码，禁止把内部细节（本地路径、签名、Authorization、堆栈）
 *   泄漏给调用方；
 * - 新增错误码必须同步这里与 README 的错误模型小节。
 */

/** 对外固定错误码（工具结果与 HTTP 错误响应的唯一合法取值）。 */
export const ERROR_CODES = Object.freeze([
  'uploader_not_configured',
  'picker_unavailable',
  'user_cancelled',
  'extension_not_allowed',
  'file_not_found',
  'file_too_large',
  'file_changed',
  'upload_timeout',
  'upload_cancelled',
  'upload_authorization_invalid',
  'storage_auth_failed',
  'storage_unavailable',
  'upload_failed',
])

/**
 * 构造带固定 code 的 Error（内部诊断用，不直接出现在工具结果里）。
 */
export function makeCodedError(code, message, { cause } = {}) {
  const error = new Error(message)
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

/** 判断一个值是否是带固定码的错误。 */
export function hasPublicCode(cause) {
  return cause !== null && typeof cause === 'object'
    && typeof cause.code === 'string'
    && ERROR_CODES.includes(cause.code)
}

/**
 * 把任意底层原因归一化为固定错误码。
 *
 * 映射规则（保守优先，能不暴露的细节一律收敛到 upload_failed）：
 * - 已是固定码 -> 原样；
 * - AbortError / ABORT_ERR -> upload_cancelled；
 * - symlink/非普通文件/未登记路径等内部安全码 -> file_not_found（不向调用方
 *   解释拒绝原因，只表示“这个路径不可上传”）；
 * - 扩展名不允许 -> extension_not_allowed；
 * - 驱动标记 `isTimeout` -> upload_timeout；
 * - 驱动标记 `isStorageNetwork` 或对象存储 5xx/429 -> storage_unavailable；
 * - 对象存储 401/403 -> storage_auth_failed；
 * - 其余 -> fallback（默认 upload_failed）。
 * @param {unknown} cause 任意抛出的原因。
 * @param {string} [fallback] 缺省码，默认 upload_failed。
 * @returns {string} ERROR_CODES 中的一个码。
 */
export function toPublicCode(cause, fallback = 'upload_failed') {
  if (hasPublicCode(cause)) return cause.code
  const code = cause?.code
  const name = cause?.name
  if (name === 'AbortError' || code === 'ABORT_ERR') return 'upload_cancelled'
  if (cause?.isTimeout) return 'upload_timeout'
  if (code === 'symlink_rejected' || code === 'not_a_regular_file' || code === 'path_not_admitted') {
    return 'file_not_found'
  }
  if (code === 'extension_not_allowed') return 'extension_not_allowed'
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'file_not_found'
  const statusCode = cause?.statusCode
  if (statusCode === 401 || statusCode === 403) return 'storage_auth_failed'
  if (cause?.isStorageNetwork
    || (typeof statusCode === 'number' && (statusCode >= 500 || statusCode === 429))) {
    return 'storage_unavailable'
  }
  return fallback
}
