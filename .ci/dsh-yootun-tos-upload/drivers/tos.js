/**
 * TOS 驱动：零依赖实现 UploaderDriver 契约。
 * 用 node:http/https + 自实现 SigV4 签名（见 tos-signer.js）做单次流式 PUT，不分片。
 * 对齐 tools.dofe.ai 的 boto3 口径：s3v4 签名 + virtual addressing + tos-s3-* endpoint。
 * payload 用 UNSIGNED-PAYLOAD（对齐 boto3 payload_signing=False，避免整文件读一遍做哈希），
 * 同时显式带 Content-Length，正是 @aws-sdk/client-s3 + requestChecksumCalculation=WHEN_REQUIRED
 * 在火山 TOS 上跑通的那套组合。
 *
 * 稳定性契约：
 * - 流式上传，文件不整块读内存；请求结束/失败/取消都会关闭文件流与 HTTP 请求；
 * - 分层超时：建连 / 响应头 / 整体上传，均会中止底层请求并等待流关闭；
 * - destroy() 取消所有未完成请求（插件卸载路径）；
 * - 有限重试：仅网络错误与 5xx/429，指数退避；认证失败/参数错误/4xx 不重试；
 * - 对象 key 不含本地路径：文件名安全规范化 + 时间戳 + 随机后缀防覆盖；
 * - 错误只带诊断标记（isTimeout/isStorageNetwork/statusCode），不携带签名或请求内容。
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { randomBytes } from 'node:crypto'
import { guessContentType } from '../mime.js'
import { makeCodedError } from '../lib/errors.js'
import { signV4, uriEncode } from './tos-signer.js'

/** 上传尝试次数（首次 + 2 次重试），禁止无限重试。 */
export const MAX_UPLOAD_ATTEMPTS = 3
/** 重试退避上限（毫秒）。 */
export const MAX_BACKOFF_MS = 8000
/** 对象存储 PUT 的负载哈希哨兵（对齐 boto3 payload_signing=False）。 */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

/** 默认分层超时（毫秒）：建连 / 响应头 / 整体上传。 */
export const DEFAULT_TIMEOUTS = Object.freeze({
  connectMs: 10_000,
  headersMs: 30_000,
  overallMs: 30 * 60 * 1000,
})

/** 构造一个取消错误（AbortError）。 */
function makeAbortError() {
  const error = new Error('上传已取消')
  error.name = 'AbortError'
  return error
}

/** 指数退避延迟，支持取消信号。 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(makeAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 是否可重试：网络错误（无状态码）或 5xx/429；4xx 客户端错误与认证失败不重试。 */
function isRetryable(statusCode) {
  if (statusCode === undefined) return true
  return statusCode >= 500 || statusCode === 429
}

/** 生成 `yyyyMMdd_HHmmss` 时间戳，用于默认 key 去重。 */
function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 短随机 ID（hex），避免同一秒内同名文件互相覆盖。 */
function randomSuffix() {
  return randomBytes(4).toString('hex')
}

/**
 * 文件名安全规范化：只保留路径末段（POSIX 与 Windows 分隔符都处理），
 * 剔除盘符/分隔符与不安全字符，保证对象 key 永远不携带本地路径，
 * 也不会出现 `..` 等穿越片段。
 */
export function sanitizeFilename(name) {
  const raw = String(name ?? '')
  const leaf = raw.slice(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1)
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').replace(/_{2,}/g, '_')
  const trimmed = cleaned.replace(/^_+|_+$/g, '')
  return trimmed === '' || trimmed === '.' || trimmed === '..' ? 'file' : trimmed.slice(-128)
}

/** 根据 endpoint 协议选择 http/https 模块（本地联调 loopback http，公网 https）。 */
function transportFor(endpoint) {
  return String(endpoint).startsWith('http://') ? http : https
}

/**
 * 等待流彻底关闭（Windows 句柄释放关键路径：请求结束时必须回收读流）。
 * @returns {Promise<void>}
 */
function streamClosed(stream) {
  return new Promise((resolve) => {
    if (stream.destroyed || stream.closed) {
      resolve()
      return
    }
    stream.once('close', resolve)
  })
}

/**
 * 用 node:http/https 发一次签名 PUT，把文件流 pipe 到对象存储。
 * 超时/取消/失败都会销毁请求并等待文件流关闭。
 * @returns {Promise<{statusCode:number,etag:string|null}>}
 */
function putObject(config, localPath, key, contentType, size, signal, timeouts, onPending, injectedTransport = null, streamFactory = createReadStream) {
  const endpoint = new URL(config.endpoint)
  // virtual = https://{bucket}.{endpoint}/{key}；path = https://{endpoint}/{bucket}/{key}。
  const usePathStyle = config.addressingStyle === 'path'
  const hostname = usePathStyle ? endpoint.hostname : `${config.bucket}.${endpoint.hostname}`
  const port = endpoint.port ? Number(endpoint.port) : (endpoint.protocol === 'https:' ? 443 : 80)
  const host = endpoint.port ? `${hostname}:${endpoint.port}` : hostname
  const objectPath = usePathStyle ? `/${config.bucket}/${key}` : `/${key}`
  const encodedPath = uriEncode(objectPath, false)
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

  const headers = {
    host,
    'content-type': contentType,
    'content-length': String(size),
    'content-disposition': 'inline',
    'x-amz-content-sha256': UNSIGNED_PAYLOAD,
    'x-amz-date': amzDate,
  }
  headers.authorization = signV4({
    method: 'PUT',
    path: encodedPath,
    headers,
    payloadHash: UNSIGNED_PAYLOAD,
    amzDate,
    region: config.region,
    service: 's3',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.accessKeySecret,
  }).authorization

  const transport = injectedTransport ?? transportFor(config.endpoint)
  const transportOptions = {
    hostname,
    port,
    path: encodedPath,
    method: 'PUT',
    headers,
    signal,
  }

  return new Promise((resolve, reject) => {
    /** @type {import('node:http').ClientRequest} */
    let req
    /** @type {import('node:fs').ReadStream|undefined} */
    let fileStream
    /** 定时器集合：整体 / 建连 / 响应头。 */
    const timers = new Set()
    let settled = false

    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }

    /** 以固定原因终结本次尝试（只终结一次），并回收文件流与请求。 */
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimers()
      unregister?.()
      // 确保文件流与底层请求都被回收（Windows 句柄释放关键路径）。
      fileStream?.destroy()
      if (req && !req.destroyed) req.destroy()
      void streamClosed(fileStream).then(() => fn(value))
    }

    const rejectWith = (cause) => finish(reject, cause)

    /** 超时中止：统一打上 isTimeout 标记（可归一为 upload_timeout）。 */
    const timeoutAbort = (label) => {
      const error = makeCodedError('upload_timeout', `upload timed out: ${label}`)
      error.isTimeout = true
      error.isStorageNetwork = true
      rejectWith(error)
    }

    if (signal?.aborted) {
      finish(reject, makeAbortError())
      return
    }

    req = transport.request(transportOptions, (res) => {
      // 响应头到达：立即取状态码并消费响应体，避免连接挂起。
      res.resume()
      const statusCode = res.statusCode ?? 0
      const etag = typeof res.headers.etag === 'string'
        ? res.headers.etag.replace(/^"|"$/g, '')
        : null
      const error = new Error(`TOS PUT HTTP ${statusCode}`)
      error.statusCode = statusCode
      finish(resolve, { statusCode, etag, error })
    })

    // 登记到驱动的未完成集合；终结时反注册，destroy() 会统一取消。
    const unregister = onPending?.(req)

    req.on('error', (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
        rejectWith(signal?.aborted ? makeAbortError() : error)
        return
      }
      // 网络层错误（DNS/ECONNRESET/EPIPE...）：标记后归一为 storage_unavailable。
      error.isStorageNetwork = true
      rejectWith(error)
    })

    if (signal) {
      signal.addEventListener('abort', () => rejectWith(makeAbortError()), { once: true })
    }

    // 分层超时状态机：connect 超时只负责建连，headers 超时只在“建连成功且请求体
    // 写完”之后才启动，避免大文件上传时把写 body 的耗时误判为响应头超时。
    // - finish 只置 bodyFinished 标记，绝不清除 connect timer；
    // - 只有确认 socket 建连成功才清除 connect timer；
    // - headers timer 仅在 connected && bodyFinished 都成立时启动。
    timers.add(setTimeout(() => timeoutAbort('overall upload'), timeouts.overallMs))
    const connectTimer = setTimeout(() => timeoutAbort('establishing connection'), timeouts.connectMs)
    timers.add(connectTimer)
    let connected = false
    let bodyFinished = false
    const startHeaderTimer = () => {
      if (settled || !connected || !bodyFinished) return
      timers.add(setTimeout(() => timeoutAbort('waiting for response headers'), timeouts.headersMs))
    }
    const markConnected = () => {
      if (settled || connected) return
      connected = true
      clearTimeout(connectTimer)
      startHeaderTimer()
    }
    // 建连完成事件：HTTP 看 connect，HTTPS 看 secureConnect（含 TLS 握手）。
    const connectEvent = transport === https ? 'secureConnect' : 'connect'
    req.on('socket', (socket) => {
      // 复用已建连的 socket 时不会再触发 connect 事件，需立即视为已建连。
      if (socket.connecting === false) {
        markConnected()
        return
      }
      socket.once(connectEvent, markConnected)
    })
    req.on('finish', () => {
      if (settled) return
      bodyFinished = true
      startHeaderTimer()
    })

    fileStream = streamFactory(localPath)
    fileStream.on('error', (cause) => {
      // 本地读失败（文件被删/权限变化）：不带网络标记，按 upload_failed 处理。
      const error = cause instanceof Error ? cause : new Error(String(cause))
      rejectWith(error)
    })
    fileStream.pipe(req)
  })
}

/**
 * 创建 TOS 上传驱动（实现 UploaderDriver 契约）。
 * @param {object} config loadConfig() 返回的 config.tos。
 * @param {object} [options] 测试注入点：
 *   { timeouts?, transport?, createReadStream? }。
 *   transport 覆盖 http/https 模块；createReadStream 覆盖请求体读取流工厂。
 */
export async function createTosDriver(config, options = {}) {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(options.timeouts ?? {}) }
  const injectedTransport = options.transport ?? null
  const streamFactory = options.createReadStream ?? createReadStream

  /** @type {Set<import('node:http').ClientRequest>} 未完成请求集合（destroy 时全部取消）。 */
  const pending = new Set()
  /** 驱动是否已被销毁：销毁后不再发起新的上传尝试。 */
  let destroyed = false
  /** 驱动级取消信号：destroy() 触发，终止退避等待中的重试。 */
  const unloadController = new AbortController()
  const onPending = (req) => {
    if (destroyed) {
      req.destroy(makeAbortError())
      return () => {}
    }
    pending.add(req)
    return () => {
      pending.delete(req)
    }
  }

  /** 解析对象 key：去掉前导斜杠，未带前缀时自动补 `{keyPrefix}/`。 */
  function resolveKey(key) {
    const cleaned = String(key).replace(/^\/+/, '')
    if (config.keyPrefix && !cleaned.startsWith(`${config.keyPrefix}/`)) {
      return `${config.keyPrefix}/${cleaned}`
    }
    return cleaned
  }

  /**
   * 构造固定公网 URL。优先级：CDN 域名 > 显式 publicBaseUrl > 默认推导。
   * 默认与 boto3 的 to_public_url 对齐：`https://{bucket}.tos-{region}.volces.com/{key}`。
   * 只由已配置的 bucket/region/key 合成，禁止任何任意外部模板。
   */
  function publicUrl(key) {
    const cleaned = String(key).replace(/^\/+/, '')
    if (config.cdnDomain) {
      const domain = config.cdnDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
      return `https://${domain}/${cleaned}`
    }
    if (config.publicBaseUrl) {
      return `${config.publicBaseUrl.replace(/\/+$/, '')}/${cleaned}`
    }
    return `https://${config.bucket}.tos-${config.region}.volces.com/${cleaned}`
  }

  return {
    resolveKey,
    publicUrl,
    get pendingCount() {
      return pending.size
    },

    /** 取消所有未完成请求并释放资源（插件卸载路径）；之后不再接受新尝试。 */
    destroy() {
      destroyed = true
      unloadController.abort()
      for (const req of [...pending]) {
        req.destroy(makeAbortError())
      }
      pending.clear()
    },

    /**
     * 上传单个本地文件（流式，不整块读内存；网络/5xx 错误自动重试，4xx 不重试）。
     * @param {string} localPath 本地文件绝对路径。
     * @param {object} [meta] { name?, mime?, key? }。
     * @param {AbortSignal} [signal] 取消信号。
     * @returns {Promise<{key:string,url:string,size:number,contentType:string,etag?:string}>}
     */
    async upload(localPath, meta = {}, signal) {
      // 文件名安全规范化：key 不携带本地路径，随机后缀避免覆盖。
      const filename = sanitizeFilename(meta.name ?? localPath)
      const key = resolveKey(meta.key ?? `${timestamp()}_${randomSuffix()}_${filename}`)
      const contentType = meta.mime ?? guessContentType(filename)

      const info = await stat(localPath)
      if (!info.isFile()) {
        throw makeCodedError('not_a_regular_file', 'not a regular file')
      }

      // 有效取消信号 = 调用方信号 ∪ 驱动卸载信号。
      const signals = [signal, unloadController.signal].filter(Boolean)
      const effectiveSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)

      let lastError
      for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt++) {
        if (effectiveSignal.aborted) throw makeAbortError()
        try {
          const { statusCode, etag, error } = await putObject(
            config, localPath, key, contentType, info.size, effectiveSignal, timeouts, onPending, injectedTransport, streamFactory,
          )
          if (statusCode >= 200 && statusCode < 300) {
            const out = { key, url: publicUrl(key), size: info.size, contentType }
            if (etag) out.etag = etag
            return out
          }
          lastError = error
          if (!isRetryable(statusCode)) throw error
        } catch (error) {
          lastError = error
          if (effectiveSignal.aborted || error?.name === 'AbortError') throw error
          if (error?.isTimeout) throw error
          if (!isRetryable(error?.statusCode)) throw error
        }
        if (attempt < MAX_UPLOAD_ATTEMPTS - 1) {
          await delay(Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS), effectiveSignal)
        }
      }
      throw lastError
    },
  }
}
