/**
 * 预签名 PUT 上传驱动：零依赖实现 UploaderDriver 契约。
 * 把本地文件流式 PUT 到授权工具下发的预签名 URL，不接触 TOS 桶/地域/endpoint/
 * AK/SK，也不自行生成对象 key 或公网 URL——这些全部来自 Tools 服务授权响应。
 *
 * 稳定性契约：
 * - 流式上传，文件不整块读内存；请求结束/失败/取消都会关闭文件流与 HTTP 请求；
 * - 分层超时：建连 / 响应头 / 整体上传，均会中止底层请求并等待流关闭；
 * - destroy() 取消所有未完成请求（插件卸载路径）；
 * - 有限重试：仅网络错误与 5xx/429，指数退避；认证失败/参数错误/4xx（含 403
 *   签名过期）不重试；
 * - 错误只带诊断标记（isTimeout/isStorageNetwork/statusCode），不携带预签名
 *   URL（含 query 签名）或请求内容。
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { makeCodedError } from '../lib/errors.js'

/** 上传尝试次数（首次 + 2 次重试），禁止无限重试。 */
export const MAX_UPLOAD_ATTEMPTS = 3
/** 重试退避上限（毫秒）。 */
export const MAX_BACKOFF_MS = 8000

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

/** 根据预签名 URL 协议选择 http/https 模块。 */
function transportFor(url) {
  return String(url).startsWith('http://') ? http : https
}

/**
 * 等待流彻底关闭（Windows 句柄释放关键路径：请求结束时必须回收读流）。
 * @returns {Promise<void>}
 */
function streamClosed(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.destroyed || stream.closed) {
      resolve()
      return
    }
    stream.once('close', resolve)
  })
}

/**
 * 用 node:http/https 发一次 PUT，把文件流 pipe 到预签名 URL。
 * 超时/取消/失败都会销毁请求并等待文件流关闭。
 * @param {object} target { url, method, headers }（headers 含授权服务返回的 Content-Type）。
 * @param {string} localPath 本地文件绝对路径。
 * @param {number} size 实际文件字节数（用于 Content-Length）。
 * @param {AbortSignal} [signal] 取消信号。
 * @param {object} timeouts 分层超时。
 * @param {(req:import('node:http').ClientRequest)=>()=>void} onPending 登记未完成请求。
 * @param {object} [injectedTransport] 测试注入的 http/https 替身。
 * @param {(path:string)=>import('node:fs').ReadStream} [streamFactory] 测试注入的读流工厂。
 * @returns {Promise<{statusCode:number,etag:string|null}>}
 */
function putObject(target, localPath, size, signal, timeouts, onPending, injectedTransport = null, streamFactory = createReadStream) {
  const url = new URL(target.url)
  const method = typeof target.method === 'string' ? target.method : 'PUT'
  const headers = { ...(target.headers ?? {}) }
  // Content-Length 由本驱动按实际文件大小显式设置（不信任授权响应的任何长度字段）。
  headers['content-length'] = String(size)

  const transport = injectedTransport ?? transportFor(target.url)
  const transportOptions = {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method,
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
      const error = new Error(`storage PUT HTTP ${statusCode}`)
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
 * 创建预签名 PUT 上传驱动（实现 UploaderDriver 契约）。
 * 不接收任何 TOS 拓扑/凭证配置：每次上传的 URL/方法/头都来自授权响应。
 * @param {object} [options] 测试注入点：{ timeouts?, transport?, createReadStream? }。
 */
export function createTosDriver(options = {}) {
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

  return {
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
     * 把本地文件流式 PUT 到授权响应给定的预签名 URL。
     * @param {string} localPath 本地文件绝对路径。
     * @param {object} target { url, method, headers }（来自授权工具）。
     * @param {AbortSignal} [signal] 取消信号。
     * @returns {Promise<{etag?:string}>} 上传成功（2xx）时返回，失败抛出诊断错误。
     */
    async upload(localPath, target, signal) {
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
            target, localPath, info.size, effectiveSignal, timeouts, onPending, injectedTransport, streamFactory,
          )
          if (statusCode >= 200 && statusCode < 300) {
            const out = {}
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
