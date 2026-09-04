/**
 * 上传授权编排：把文件元数据交给 Tools 服务的 `tos_upload_authorize` 工具，
 * 换取 PUT 预签名直传授权，并校验授权响应。
 *
 * 安全边界：
 * - 插件绝不向授权工具传 bucket/region/endpoint/AK/SK/tenantId/userId/Models key，
 *   只传三个文件元数据字段 { filename, contentType, size }；
 * - 授权响应必须满足：method=PUT、url 为 HTTPS、不指向 loopback/私网/CI、
 *   expiresAt 未过期、size ≤ maxBytes、headers 的 Content-Type 与本地 MIME 一致；
 * - 任一不满足统一映射为 upload_authorization_invalid（服务端拒绝则按稳定码映射）。
 */

import { randomUUID } from 'node:crypto'
import { makeCodedError } from './lib/errors.js'

/** 授权工具在 Tools 域内的 serverName 与 raw tool 名（对应公网 /mcp/tools/tos-upload）。 */
export const AUTHORIZE_SERVER_NAME = 'tools-tos-upload'
export const AUTHORIZE_TOOL_NAME = 'tos_upload_authorize'
/** dsh-mcp-client 的公共工具名：mcp__<serverName>__<rawName>。 */
export const AUTHORIZE_PUBLIC_NAME = `mcp__${AUTHORIZE_SERVER_NAME}__${AUTHORIZE_TOOL_NAME}`

/** 授权调用缺省超时（毫秒）；仅元数据请求，无需与上传超时同级。 */
export const AUTHORIZE_TIMEOUT_MS = 60_000

/** 服务端稳定错误码 -> 插件公开错误码。 */
const SERVER_CODE_MAP = [
  ['UPLOAD_SIZE_EXCEEDED', 'file_too_large'],
  ['UPLOAD_TYPE_NOT_ALLOWED', 'extension_not_allowed'],
  ['UNAUTHORIZED', 'storage_auth_failed'],
  ['STORAGE_AUTH_FAILED', 'storage_auth_failed'],
  ['STORAGE_UNAVAILABLE', 'storage_unavailable'],
  ['VALIDATION_ERROR', 'upload_failed'],
]

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 去掉 MIME 的 `; 参数` 并小写化，用于 Content-Type 一致性比较。 */
function normalizeMime(value) {
  if (typeof value !== 'string') return ''
  return value.split(';', 1)[0].trim().toLowerCase()
}

/** 大小写不敏感地取 headers 里的某个头值。 */
function headerValue(headers, name) {
  if (!isPlainObject(headers)) return undefined
  const lower = String(name).toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === lower) return value
  }
  return undefined
}

/** 解析 URL，非法返回 null。 */
function safeUrl(value) {
  if (typeof value !== 'string') return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * 判断主机名是否指向 loopback / 私网 / 链路本地 / CGNAT / CI 私有地址。
 * 这些地址绝不允许出现在授权下发的直传 URL 或公网 URL 里。
 */
export function isForbiddenPublicHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').trim()
  if (host === '') return true
  // loopback
  if (host === 'localhost' || host === '::1' || host === '::ffff:127.0.0.1') return true
  if (/^127\./.test(host) || /^0\./.test(host)) return true

  // IPv4 私网 / 链路本地 / CGNAT（含 CI 的 172.16/12 内网段，一并拒绝）。
  const v4 = host.split('.')
  if (v4.length === 4 && v4.every((n) => /^\d{1,3}$/.test(n))) {
    const [a, b] = v4.map(Number)
    if (a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }

  // IPv6 loopback / link-local / ULA
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true
    if (host.startsWith('fe80:')) return true
    if (host.startsWith('fc') || host.startsWith('fd')) return true
  }
  return false
}

/**
 * 在 ToolRuntime 的 schemas() 里定位授权工具的公共名。
 * 精确匹配 AUTHORIZE_PUBLIC_NAME 优先；否则按后缀 __tos_upload_authorize 兜底
 * （容忍 serverName 因部署而异，只要 raw tool 名一致）。
 * @param {object} tools 宿主 ToolRuntime（含 schemas()）。
 * @returns {string|null} 公共工具名，未注册返回 null。
 */
export function findAuthorizeToolName(tools) {
  const schemas = typeof tools?.schemas === 'function' ? tools.schemas() : []
  if (!Array.isArray(schemas)) return null
  const exact = schemas.find((s) => s?.name === AUTHORIZE_PUBLIC_NAME)
  if (exact) return exact.name
  const suffix = schemas.find((s) => typeof s?.name === 'string' && s.name.endsWith(`__${AUTHORIZE_TOOL_NAME}`))
  return suffix?.name ?? null
}

/** 从 ToolRuntime 失败结果里拼出诊断文本（不包含签名/URL）。 */
function failureText(result) {
  const parts = []
  const err = result?.error
  if (typeof err?.message === 'string') parts.push(err.message)
  else if (typeof err?.code === 'string') parts.push(err.code)
  else if (err !== undefined) parts.push(String(err))
  if (Array.isArray(result?.content)) {
    for (const block of result.content) {
      if (typeof block?.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** 把服务端稳定错误码（文本里的 camelCase 码）映射为插件公开错误码。 */
function mapServerErrorCode(text) {
  const hay = String(text ?? '')
  for (const [code, publicCode] of SERVER_CODE_MAP) {
    if (hay.includes(code)) return publicCode
  }
  return 'upload_authorization_invalid'
}

/** 从 MCP 工具返回值（{ content, structuredContent? }）里解析授权对象。 */
function parseMcpValue(value) {
  if (isPlainObject(value)) {
    const structured = value.structuredContent
    if (isPlainObject(structured) && typeof structured.url === 'string') return structured
    if (Array.isArray(value.content)) {
      const parsed = parseContentBlocks(value.content)
      if (parsed !== undefined) return parsed
    }
  }
  return undefined
}

/** 从文本块数组里提取首个 JSON 对象（容忍 markdown 代码围栏）。 */
function parseContentBlocks(blocks) {
  const texts = []
  for (const block of blocks) {
    if (typeof block?.text === 'string') texts.push(block.text)
  }
  let text = texts.join('\n').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  try {
    const parsed = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 校验授权响应（Tools 服务 tos_upload_authorize 的返回结构）。
 * 任一字段不合法都抛出 upload_authorization_invalid。
 * @param {unknown} resp 解析后的授权对象。
 * @param {object} meta { contentType, size }（size 为本地实际字节数，可选）。
 * @returns {{method:string,url:string,headers:object,publicUrl:string,expiresAt:string,maxBytes:number}}
 */
export function validateAuthorizationResponse(resp, meta = {}) {
  const invalid = (message) => makeCodedError('upload_authorization_invalid', message)
  if (!isPlainObject(resp)) throw invalid('authorization response is not an object')
  if (resp.method !== 'PUT') throw invalid(`authorization method must be PUT, got "${resp.method}"`)

  const url = safeUrl(resp.url)
  if (!url || url.protocol !== 'https:') throw invalid('authorization url must be HTTPS')
  if (isForbiddenPublicHost(url.hostname)) throw invalid('authorization url must not point to loopback/private/CI')

  const publicUrl = safeUrl(resp.publicUrl)
  if (!publicUrl || publicUrl.protocol !== 'https:') throw invalid('publicUrl must be HTTPS')
  if (isForbiddenPublicHost(publicUrl.hostname)) throw invalid('publicUrl must not point to loopback/private/CI')

  const expiresAt = Date.parse(resp.expiresAt)
  if (!Number.isFinite(expiresAt)) throw invalid('expiresAt must be a valid date')
  if (expiresAt <= Date.now()) throw invalid('expiresAt must be in the future')

  const maxBytes = Number(resp.maxBytes)
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw invalid('maxBytes must be a positive integer')
  if (meta.size !== undefined && meta.size > maxBytes) throw invalid('file size exceeds authorized maxBytes')

  // headers["Content-Type"] 与本地 MIME 一致（忽略大小写与 ; 参数）。
  const expectedType = normalizeMime(meta.contentType)
  if (expectedType && normalizeMime(headerValue(resp.headers, 'content-type')) !== expectedType) {
    throw invalid(`authorized Content-Type does not match local "${meta.contentType}"`)
  }

  return {
    method: resp.method,
    url: resp.url,
    headers: isPlainObject(resp.headers) ? resp.headers : {},
    publicUrl: resp.publicUrl,
    expiresAt: resp.expiresAt,
    maxBytes,
  }
}

/**
 * 授权一次上传：调用 tos_upload_authorize 并校验响应。
 * @param {object} tools 宿主 ToolRuntime（含 execute()/schemas()）。
 * @param {object} meta { filename, contentType, size }。
 * @param {AbortSignal} [signal] 取消信号（缺省用 AUTHORIZE_TIMEOUT_MS 兜底）。
 * @returns {Promise<{method:string,url:string,headers:object,publicUrl:string,expiresAt:string,maxBytes:number}>}
 */
export async function authorizeUpload(tools, meta, signal) {
  const name = findAuthorizeToolName(tools)
  if (name === null) {
    throw makeCodedError('uploader_not_configured', `${AUTHORIZE_TOOL_NAME} tool is not available`)
  }

  let result
  try {
    result = await tools.execute({
      callId: `tos-upload-authorize-${randomUUID()}`,
      name,
      arguments: {
        filename: meta.filename,
        contentType: meta.contentType,
        size: meta.size,
      },
      signal: signal ?? AbortSignal.timeout(AUTHORIZE_TIMEOUT_MS),
    })
  } catch (cause) {
    // transport / 注册表层错误：授权网关不可达，按存储不可用处理。
    throw makeCodedError('storage_unavailable', 'authorize tool call failed', { cause })
  }

  if (result?.isError) {
    const code = mapServerErrorCode(failureText(result))
    throw makeCodedError(code, 'authorize rejected')
  }

  const auth = parseMcpValue(result?.value)
  return validateAuthorizationResponse(auth, meta)
}
