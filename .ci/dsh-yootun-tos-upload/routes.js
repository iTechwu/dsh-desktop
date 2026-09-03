/**
 * HTTP 触发通道：插件 UI 按钮两次同源 fetch。
 *   POST /_dsh/uploader/pick-file  -> { path, name, size, mime }（原生 showOpenDialog）
 *   POST /_dsh/uploader/upload     { path } -> { url, key, size, contentType }
 * 加固口径同 dofe-access-route.ts：loopback + Origin + sec-fetch-site 校验；
 * upload 只接受本会话 pick-file 登记过的路径（允许清单），上传前做 TOCTOU 复查
 * （存在性/普通文件/符号链接/大小一致），文件被替换返回 file_changed。
 * 错误响应只回固定错误码，不回传本地绝对路径与内部诊断。
 */

import { revalidateAdmittedFile } from './allowlist.js'
import { toPublicCode } from './lib/errors.js'

export const PICK_FILE_PATH = '/_dsh/uploader/pick-file'
export const UPLOAD_PATH = '/_dsh/uploader/upload'

const MAX_BODY_BYTES = 16 * 1024
const MAX_PATH_LENGTH = 4096

function finishJson(res, statusCode, value) {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

/** 同源校验：loopback 由 webserver 层强制，这里再独立核一次（深度防御）。 */
function permitted(req, expectedOrigin) {
  const address = req.socket?.remoteAddress ?? ''
  const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
  return loopback
    && req.headers.origin === expectedOrigin
    && (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin')
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** 固定错误码 -> HTTP 状态码。 */
function statusForCode(code) {
  switch (code) {
    case 'picker_unavailable':
    case 'uploader_not_configured':
      return 503
    case 'upload_timeout':
      return 504
    case 'storage_auth_failed':
    case 'storage_unavailable':
    case 'upload_failed':
    case 'upload_cancelled':
      return 502
    case 'user_cancelled':
      return 409
    case 'file_not_found':
    case 'file_changed':
    case 'extension_not_allowed':
      return 400
    default:
      return 500
  }
}

/**
 * pick-file：弹原生文件选择框（视频/图片扩展名过滤），选中路径自动进入允许清单。
 * @param {object} deps { expectedOrigin, pickFile, reportError? }
 */
export async function handlePickFileRequest(req, res, deps) {
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method_not_allowed' })
  if (!permitted(req, deps.expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })
  let kind
  // 允许空 body；有 body 时必须是 JSON 且可带 { kind: 'media'|'image'|'video' }。
  if (req.headers['content-type'] !== undefined) {
    if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return finishJson(res, 415, { error: 'content_type_must_be_json' })
    }
    try {
      const body = await readJson(req)
      if (typeof body?.kind === 'string') kind = body.kind
    } catch {
      return finishJson(res, 400, { error: 'invalid_request' })
    }
  }
  try {
    const picked = await deps.pickFile({ kind })
    if (picked === null) return finishJson(res, 200, { picked: false })
    return finishJson(res, 200, { picked: true, ...picked })
  } catch (cause) {
    deps.reportError?.(cause)
    const code = toPublicCode(cause, 'picker_unavailable')
    return finishJson(res, statusForCode(code), { error: code })
  }
}

/**
 * upload：只允许上传允许清单内的路径，TOCTOU 复查后流式上传并返回公网 URL。
 * v1 先 await 整个上传；进度反馈（任务 ID + 轮询路由）列为 v2。
 * @param {object} deps { expectedOrigin, store, driver, maxBytes, reportError? }
 */
export async function handleUploadRequest(req, res, deps) {
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method_not_allowed' })
  if (!permitted(req, deps.expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finishJson(res, 415, { error: 'content_type_must_be_json' })
  }
  let body
  try {
    body = await readJson(req)
  } catch {
    return finishJson(res, 400, { error: 'invalid_request' })
  }
  const path = typeof body?.path === 'string' ? body.path : ''
  if (path === '' || path.length > MAX_PATH_LENGTH) {
    return finishJson(res, 400, { error: 'invalid_request' })
  }
  if (deps.driver === null) return finishJson(res, 503, { error: 'uploader_not_configured' })

  // 安全模型核心 + TOCTOU：只接受本会话 pick-file 登记过的路径，且实时状态
  // （存在/普通文件/非符号链接/大小一致/未超限）必须全部成立。
  const check = await revalidateAdmittedFile(deps.store, path, { maxBytes: deps.maxBytes })
  if (!check.ok) {
    const code = toPublicCode({ code: check.error })
    return finishJson(res, statusForCode(code), { error: code })
  }

  try {
    const result = await deps.driver.upload(path, { name: check.entry.name, mime: check.entry.mime })
    return finishJson(res, 200, result)
  } catch (cause) {
    deps.reportError?.(cause)
    const code = toPublicCode(cause)
    return finishJson(res, statusForCode(code), { error: code })
  }
}
