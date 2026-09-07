/**
 * 后台上传注册表：uploadStart 启动的异步上传任务在这里持有生命周期。
 *
 * 语义（对应 docs/0907/xhs/仿写素材上传体验优化方案.md）：
 * - launch() 后台启动 driver.upload（不 await），立即返回 uploadId 供客户端轮询；
 * - done 状态（含公网 URL）保留 doneTtlMs（默认 ≥60s）后才清理，避免「done 写入后
 *   客户端当次轮询丢失 → 下次拿到 not_found」的竞态（P2）；
 * - 孤儿上传（P10）：客户端刷新/崩溃后无人认领，传完仍落审计（TTL 内可被重新查询
 *   取回结果）；uploading 状态超过 orphanMs 直接中止并标记 failed；
 * - destroy()（插件卸载/驱动销毁路径）：中止全部未完成任务、清空 Map；
 *   未完成的 upload Promise 被 reject，之后 uploadStatus 一律返回 not_found；
 * - 成功/失败都落审计（P7），与 v1 同步上传路由共用 recordMediaUploadAudit。
 */

import { randomUUID } from 'node:crypto'
import { recordMediaUploadAudit } from './tool.js'
import { toPublicCode } from './lib/errors.js'

/** done/failed 结果保留的缺省时长（毫秒）：数倍于客户端 350ms 轮询间隔。 */
export const DEFAULT_DONE_TTL_MS = 60_000
/** uploading 状态的孤儿中止缺省时长（毫秒）：30 分钟，宽于驱动整体上传超时。 */
export const DEFAULT_ORPHAN_MS = 30 * 60_000
/** 周期清理缺省间隔（毫秒）。 */
export const DEFAULT_SWEEP_MS = 60_000

/**
 * 创建后台上传注册表。
 * @param {object} deps { driver, audit?, logger?, doneTtlMs?, orphanMs?, sweepMs?, idFactory?, now? }
 *   driver 需实现 upload(path, target, signal, handlers)；
 *   idFactory/now 为测试注入点。
 */
export function createUploadRegistry(deps) {
  const driver = deps.driver
  const audit = deps.audit ?? null
  const logger = deps.logger ?? null
  const doneTtlMs = deps.doneTtlMs ?? DEFAULT_DONE_TTL_MS
  const orphanMs = deps.orphanMs ?? DEFAULT_ORPHAN_MS
  const sweepMs = deps.sweepMs ?? DEFAULT_SWEEP_MS
  const idFactory = deps.idFactory ?? randomUUID
  const now = deps.now ?? (() => Date.now())

  /** @type {Map<string, object>} uploadId -> 条目 */
  const uploads = new Map()
  let destroyed = false

  const sweepTimer = sweepMs > 0 && typeof setInterval === 'function'
    ? setInterval(() => { try { sweep() } catch { /* 清理失败不影响主流程 */ } }, sweepMs)
    : null
  sweepTimer?.unref?.()

  /** 上报审计（成功/失败共用）；audit 缺失时静默跳过。 */
  function recordAudit(result) {
    void recordMediaUploadAudit(audit, logger, 'human_ui', result).catch(() => {})
  }

  /** 后台上传终结后的公共收尾；destroy 后不再回填 Map。 */
  function settle(entry, patch) {
    if (destroyed) return
    if (entry.status === 'done' || entry.status === 'failed') return
    Object.assign(entry, patch)
    entry.finishedAt = now()
    uploads.set(entry.id, entry)
  }

  /**
   * 启动一个后台上传任务。
   * @param {object} input { path, entry, size, auth }
   *   entry 为允许清单条目（{ name, mime }），auth 为已校验的授权响应
   *   （{ url, method, headers, publicUrl }）。
   * @returns {{ id:string }} uploadId。
   */
  function launch({ path, entry, size, auth }) {
    const id = idFactory()
    const item = {
      id,
      path,
      name: entry?.name ?? '',
      mime: entry?.mime ?? '',
      size,
      status: 'uploading',
      attempt: 0,
      bytesWritten: 0,
      bytesTotal: size,
      url: null,
      error: null,
      startedAt: now(),
      finishedAt: null,
      controller: new AbortController(),
    }
    uploads.set(id, item)

    const task = driver.upload(
      path,
      { url: auth.url, method: auth.method, headers: auth.headers },
      item.controller.signal,
      {
        onProgress: ({ bytesWritten, bytesTotal }) => {
          item.bytesWritten = bytesWritten
          item.bytesTotal = bytesTotal
        },
        onAttempt: (attempt) => {
          item.attempt = attempt
          item.bytesWritten = 0
        },
      },
    )
    void task.then(
      () => {
        settle(item, { status: 'done', url: auth.publicUrl, bytesWritten: size, error: null })
        recordAudit({ publicUrl: auth.publicUrl, size, mime: item.mime })
      },
      (cause) => {
        const code = toPublicCode(cause, 'upload_failed')
        settle(item, { status: 'failed', error: code })
        recordAudit({ size, mime: item.mime, errorCode: code })
        logger?.warn?.('yootun-tos-upload: background upload failed: %s', code)
      },
    )
    return { id }
  }

  /**
   * 查询上传条目（带惰性 TTL/孤儿清理）。
   * @returns {object|null} 条目快照（剥离 path/controller 等内部字段，可安全序列化），
   *   不存在返回 null。
   */
  function get(id) {
    if (destroyed || typeof id !== 'string') return null
    const item = uploads.get(id)
    if (!item) return null
    const stamp = now()
    if (item.status === 'uploading' && stamp - item.startedAt > orphanMs) {
      // 孤儿上传：超时中止（abort 会让后台 Promise 以 upload_cancelled 收尾）。
      item.controller?.abort?.()
      settle(item, { status: 'failed', error: 'upload_cancelled' })
    }
    if ((item.status === 'done' || item.status === 'failed') && item.finishedAt !== null
      && stamp - item.finishedAt > doneTtlMs) {
      uploads.delete(id)
      return null
    }
    // 快照：只暴露路由层需要的字段，杜绝 path/controller 被整体序列化泄漏。
    return {
      id: item.id,
      name: item.name,
      mime: item.mime,
      size: item.size,
      status: item.status,
      attempt: item.attempt,
      bytesWritten: item.bytesWritten,
      bytesTotal: item.bytesTotal,
      url: item.url,
      error: item.error,
    }
  }

  /** 周期清理：与 get() 同一套 TTL/孤儿规则，防止无人查询时的条目滞留。 */
  function sweep() {
    if (destroyed) return
    const stamp = now()
    for (const item of [...uploads.values()]) {
      if (item.status === 'uploading' && stamp - item.startedAt > orphanMs) {
        item.controller?.abort?.()
        settle(item, { status: 'failed', error: 'upload_cancelled' })
      }
      if ((item.status === 'done' || item.status === 'failed') && item.finishedAt !== null
        && stamp - item.finishedAt > doneTtlMs) {
        uploads.delete(item.id)
      }
    }
  }

  /** 插件卸载路径：中止全部未完成任务并清空；之后 uploadStatus 一律 not_found。 */
  function destroy() {
    if (destroyed) return
    destroyed = true
    if (sweepTimer) clearInterval(sweepTimer)
    for (const item of uploads.values()) {
      if (item.status === 'uploading') item.controller?.abort?.()
    }
    uploads.clear()
  }

  return { launch, get, sweep, destroy, get size() { return uploads.size } }
}
