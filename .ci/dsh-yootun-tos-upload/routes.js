/**
 * HTTP 触发通道：插件 UI 按钮两次同源 fetch。
 *   POST /_dsh/uploader/pick-file     -> { path, name, size, mime }（原生 showOpenDialog）
 *   POST /_dsh/uploader/upload        { path } -> { url, size, contentType, name }（同步 v1）
 *   POST /_dsh/uploader/uploadStart   { path } -> { uploadId, name, size, mime }（后台启动）
 *   POST /_dsh/uploader/uploadStatus  { uploadId } -> { status, progress, ... }（轮询）
 *   GET  /_dsh/uploader/media?path=…  -> 本地文件只读流（webview 预览，支持 Range）
 * 加固口径同 dofe-access-route.ts：loopback + Origin + sec-fetch-site 校验；
 * upload/uploadStart 只接受本会话 pick-file 登记过的路径（允许清单），上传前做
 * TOCTOU 复查（存在性/普通文件/符号链接/大小一致），文件被替换返回 file_changed。
 * media 路由用独立校验（mediaPermitted）：媒体加载是 no-cors 请求，浏览器不带
 * Origin 头，照抄 permitted() 会让每个预览请求 403（docs/0907/xhs P1）。
 * 错误响应只回固定错误码，不回传本地绝对路径与内部诊断。
 */

import { createReadStream } from 'node:fs'
import { revalidateAdmittedFile } from './allowlist.js'
import { authorizeUpload } from './authorize.js'
import { guessContentType } from './mime.js'
import { toPublicCode } from './lib/errors.js'
import { recordMediaUploadAudit } from './tool.js'

export const PICK_FILE_PATH = '/_dsh/uploader/pick-file'
export const UPLOAD_PATH = '/_dsh/uploader/upload'
export const UPLOAD_START_PATH = '/_dsh/uploader/uploadStart'
export const UPLOAD_STATUS_PATH = '/_dsh/uploader/uploadStatus'
export const MEDIA_PATH = '/_dsh/uploader/media'

const MAX_BODY_BYTES = 16 * 1024
const MAX_PATH_LENGTH = 4096
const MAX_UPLOAD_ID_LENGTH = 128
/** media 响应允许的 MIME（与 mime.js / Tools to_upload_allowed_content_types 对齐）。 */
const MEDIA_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])

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

/**
 * media 路由独立校验（不复用 permitted，docs/0907/xhs P1）：
 * `<img>`/`<video>` 的媒体加载是 no-cors 请求，浏览器不发送 Origin 头
 * （同源也不带）；要求 origin 严格相等会让每个预览请求 403，「已选即预览」失效。
 * 规则：loopback 保留；sec-fetch-site ∈ {same-origin, undefined, none}（据此挡
 * 外部页面的跨站媒体读取）；Origin 缺失放行，存在时必须等于 expectedOrigin。
 * 风险可控：GET 只读 + 路径必须在允许清单（攻击者不可知）+ cross-site 被拒。
 */
function mediaPermitted(req, expectedOrigin) {
  const address = req.socket?.remoteAddress ?? ''
  const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
  if (!loopback) return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) return false
  return true
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
    case 'upload_authorization_invalid':
      return 502
    case 'user_cancelled':
      return 409
    case 'file_not_found':
    case 'file_changed':
    case 'file_too_large':
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
 * upload：只允许上传允许清单内的路径，TOCTOU 复查 -> 授权 -> 预签名 PUT 直传。
 * 返回公网 URL（授权响应下发的 publicUrl），不回传预签名 URL/object key。
 * v1 同步通道保留（agent 工具与旧客户端）；插件 UI 的新交互走 uploadStart/uploadStatus。
 * @param {object} deps { expectedOrigin, store, driver, tools, maxBytes, reportError? }
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
    const auth = await authorizeUpload(deps.tools, {
      filename: check.entry.name,
      contentType: check.entry.mime,
      size: check.size,
    })
    await deps.driver.upload(
      path,
      { url: auth.url, method: auth.method, headers: auth.headers },
    )
    await recordMediaUploadAudit(deps.audit, deps.logger, 'human_ui', { publicUrl: auth.publicUrl, size: check.size, mime: check.entry.mime })
    return finishJson(res, 200, {
      url: auth.publicUrl,
      size: check.size,
      contentType: check.entry.mime,
      name: check.entry.name,
    })
  } catch (cause) {
    deps.reportError?.(cause)
    const code = toPublicCode(cause)
    await recordMediaUploadAudit(deps.audit, deps.logger, 'human_ui', { size: check.size, mime: check.entry.mime, errorCode: code })
    return finishJson(res, statusForCode(code), { error: code })
  }
}

/**
 * uploadStart：校验 + 授权快速失败，随后后台启动上传并立即返回 uploadId。
 * 真正的文件流由注册表后台执行（不 await 本响应），进度通过 uploadStatus 轮询。
 * 契约 { path, kind? }：kind ∈ {media, image, video} 与 pick-file 的过滤档位一致，
 * 仅作入参校验（实际类型由允许清单登记为准）；不校验时按 media 处理。
 * @param {object} deps { expectedOrigin, store, driver, tools, maxBytes, registry, reportError? }
 */
export async function handleUploadStartRequest(req, res, deps) {
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
  // kind 契约校验（与 pick-file 同档位）：非法值按请求错误拒绝，避免契约漂移。
  if (body?.kind !== undefined && body.kind !== 'media' && body.kind !== 'image' && body.kind !== 'video') {
    return finishJson(res, 400, { error: 'invalid_request' })
  }
  if (deps.driver === null) return finishJson(res, 503, { error: 'uploader_not_configured' })

  // 快速失败：TOCTOU 复查（登记/存在/普通文件/非符号链接/大小一致/未超限）。
  const check = await revalidateAdmittedFile(deps.store, path, { maxBytes: deps.maxBytes })
  if (!check.ok) {
    const code = toPublicCode({ code: check.error })
    return finishJson(res, statusForCode(code), { error: code })
  }

  try {
    // 授权同样快速失败：预签名 URL 过期类问题在启动前暴露，而非轮询中失败。
    const auth = await authorizeUpload(deps.tools, {
      filename: check.entry.name,
      contentType: check.entry.mime,
      size: check.size,
    })
    const { id } = deps.registry.launch({
      path,
      entry: check.entry,
      size: check.size,
      auth,
    })
    return finishJson(res, 200, {
      uploadId: id,
      name: check.entry.name,
      size: check.size,
      mime: check.entry.mime,
    })
  } catch (cause) {
    deps.reportError?.(cause)
    const code = toPublicCode(cause)
    await recordMediaUploadAudit(deps.audit, deps.logger, 'human_ui', { size: check.size, mime: check.entry.mime, errorCode: code })
    return finishJson(res, statusForCode(code), { error: code })
  }
}

/** 由已写字节与总字节计算 0..100 进度；总字节未知时保守返回 0。 */
function progressOf(bytesWritten, bytesTotal) {
  if (!Number.isFinite(bytesTotal) || bytesTotal <= 0) return 0
  return Math.min(100, Math.max(0, Math.floor((bytesWritten / bytesTotal) * 100)))
}

/**
 * uploadStatus：按 uploadId 查询后台上传状态。
 * 返回 { status: uploading|done|failed|not_found, progress, bytesWritten,
 * bytesTotal, attempt, url?, name?, size?, error? }；done 含公网 URL。
 * done/failed 结果在注册表保留 doneTtlMs 后清理（P2），过期后返回 not_found。
 * @param {object} deps { expectedOrigin, registry }
 */
export async function handleUploadStatusRequest(req, res, deps) {
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
  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId : ''
  if (uploadId === '' || uploadId.length > MAX_UPLOAD_ID_LENGTH) {
    return finishJson(res, 400, { error: 'invalid_request' })
  }
  const item = deps.registry.get(uploadId)
  if (!item) return finishJson(res, 200, { status: 'not_found' })
  const progress = progressOf(item.bytesWritten, item.bytesTotal)
  if (item.status === 'done') {
    return finishJson(res, 200, {
      status: 'done',
      progress: 100,
      bytesWritten: item.bytesWritten,
      bytesTotal: item.bytesTotal,
      attempt: item.attempt,
      url: item.url,
      name: item.name,
      size: item.size,
    })
  }
  if (item.status === 'failed') {
    return finishJson(res, 200, {
      status: 'failed',
      progress,
      bytesWritten: item.bytesWritten,
      bytesTotal: item.bytesTotal,
      attempt: item.attempt,
      error: item.error ?? 'upload_failed',
      name: item.name,
      size: item.size,
    })
  }
  return finishJson(res, 200, {
    status: 'uploading',
    progress,
    bytesWritten: item.bytesWritten,
    bytesTotal: item.bytesTotal,
    attempt: item.attempt,
  })
}

/**
 * 解析单区间 Range 头（bytes=start-end / bytes=start- / bytes=-suffix）。
 * @returns {{start:number,end:number}|null|undefined} null=忽略按全量；
 *   undefined=区间不可满足（416）。
 */
function parseSingleRange(header, size) {
  // 空文件上任何区间都不可满足（RFC 7233），也避免后缀区间算出负长度。
  if (!Number.isFinite(size) || size <= 0) return undefined
  const match = /^bytes=(\d*)-(\d*)$/u.exec(String(header ?? '').trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    // 后缀区间：bytes=-N 取最后 N 字节。
    const suffix = Number(rawEnd)
    if (!Number.isInteger(suffix) || suffix <= 0) return null
    const length = Math.min(suffix, size)
    return { start: size - length, end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isInteger(start) || start < 0 || start >= size) return undefined
  let end = size - 1
  if (rawEnd !== '') {
    const parsed = Number(rawEnd)
    if (!Number.isInteger(parsed) || parsed < start) return undefined
    end = Math.min(parsed, size - 1)
  }
  return { start, end }
}

/**
 * media：只读流式提供本地文件给 webview 预览（已选即预览的唯一可行路径）。
 * - 独立校验 mediaPermitted（P1）：loopback + sec-fetch-site + Origin 缺失放行；
 * - 路径必须在允许清单且实时状态成立（每个请求含 Range 子请求都走
 *   revalidateAdmittedFile，文件被替换即拒绝供流，保持 TOCTOU 语义，P9）；
 * - MIME 仅 jpg/jpeg/png/webp/mp4/mov（P9），无 SVG 等脚本注入面；
 * - 支持 206 单区间 Range（视频 seek/首帧），nosniff + no-store；不落库、只读。
 * @param {object} deps { expectedOrigin, store, maxBytes }
 */
export async function handleMediaRequest(req, res, deps) {
  if (req.method !== 'GET') return finishJson(res, 405, { error: 'method_not_allowed' })
  if (!mediaPermitted(req, deps.expectedOrigin)) return finishJson(res, 403, { error: 'forbidden' })
  let pathname = ''
  let requestedPath = ''
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    pathname = url.pathname
    requestedPath = url.searchParams.get('path') ?? ''
  } catch {
    return finishJson(res, 400, { error: 'invalid_request' })
  }
  if (pathname !== MEDIA_PATH || requestedPath === '' || requestedPath.length > MAX_PATH_LENGTH) {
    return finishJson(res, 400, { error: 'invalid_request' })
  }
  const check = await revalidateAdmittedFile(deps.store, requestedPath, { maxBytes: deps.maxBytes })
  if (!check.ok) {
    // 未登记/被替换等一律不解释允许清单语义：统一 403，禁止任意路径读取。
    return finishJson(res, 403, { error: 'forbidden' })
  }
  const mime = check.entry.mime || guessContentType(requestedPath)
  if (!MEDIA_MIME.has(mime)) return finishJson(res, 403, { error: 'forbidden' })

  const size = check.size
  const rangeHeader = req.headers.range
  const baseHeaders = {
    'content-type': mime,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
  if (rangeHeader !== undefined) {
    const parsed = parseSingleRange(rangeHeader, size)
    if (parsed === undefined) {
      // 语法可解析但区间不可满足：416（带当前长度提示）。
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${size}`)
      for (const [key, value] of Object.entries(baseHeaders)) res.setHeader(key, value)
      res.setHeader('content-length', 0)
      res.end()
      return
    }
    if (parsed !== null) {
      const { start, end } = parsed
      res.statusCode = 206
      res.setHeader('content-range', `bytes ${start}-${end}/${size}`)
      res.setHeader('content-length', end - start + 1)
      for (const [key, value] of Object.entries(baseHeaders)) res.setHeader(key, value)
      await pipeMediaFile(requestedPath, res, { start, end })
      return
    }
  }
  res.statusCode = 200
  res.setHeader('content-length', size)
  for (const [key, value] of Object.entries(baseHeaders)) res.setHeader(key, value)
  await pipeMediaFile(requestedPath, res, undefined)
}

/** 把本地文件（或其区间）流式写入响应；pipe 结束/出错后释放读流并收敛 Promise。 */
function pipeMediaFile(path, res, range) {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const stream = createReadStream(path, range ? { start: range.start, end: range.end } : undefined)
    // 响应收尾（finish/close）与读流失败都会收敛 Promise；读流随后统一销毁。
    res.on?.('finish', done)
    res.on?.('close', done)
    stream.on('error', () => {
      // 复查后文件被删等兜底：头部通常已发出，直接断开响应并收敛。
      if (!res.writableEnded) res.destroy()
      done()
    })
    stream.on('close', () => done())
    stream.pipe(res)
  })
}
