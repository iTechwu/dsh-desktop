/**
 * agent 触发通道：media_upload 工具，会话中由模型调用。
 * 安全模型（关键）：工具不接受模型传入的任意路径（否则提示注入即可窃取本地
 * 文件传上公网）。工具走人机回环——触发原生对话框由用户亲手选文件，选中路径
 * 自动进入允许清单，与 HTTP 通道共用同一套防护。
 *
 * 上传链路：选文件 -> TOCTOU 复查 -> tos_upload_authorize 授权 -> 预签名 PUT 直传。
 * 插件不再持有 TOS 凭证/桶/地域/endpoint，也不自行生成对象 key；公网 URL 由
 * 授权响应下发（publicUrl）。
 *
 * 错误契约：execute 只返回固定错误码（lib/errors.js 的 ERROR_CODES），
 * 绝不返回本地路径、预签名 URL、object key、访问密钥或内部错误堆栈；诊断细节只进日志。
 */

import { createHash } from 'node:crypto'
import { revalidateAdmittedFile } from './allowlist.js'
import { authorizeUpload } from './authorize.js'
import { toPublicCode } from './lib/errors.js'

const TOOL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      url: { type: 'string' },
      size: { type: 'number' },
      contentType: { type: 'string' },
      name: { type: 'string' },
    },
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

/**
 * 注册 media_upload 工具，返回 disposer。
 * @param {object} ctx 宿主上下文（ctx.tools.register）。
 * @param {object} deps { picker, driver, tools, store?, maxBytes, timeoutMs, logger? }
 */
export function registerMediaUploadTool(ctx, deps) {
  return ctx.tools.register({
    name: 'media_upload',
    description: '上传本地图片/视频到对象存储并返回公网 URL。调用后会弹出原生文件选择框，由用户亲手选择文件；' +
      '本工具不接受、也不应该由调用方提供任何本地路径。拿到 URL 后可把它交给需要公网媒体地址的下游工具。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          enum: ['media', 'image', 'video'],
          description: '文件类型过滤档位，缺省 media（图片+视频）。',
        },
      },
    },
    output: TOOL_OUTPUT,
    timeoutMs: deps.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (deps.driver === null) return { ok: false, error: 'uploader_not_configured' }
      if (!deps.picker.available) return { ok: false, error: 'picker_unavailable' }
      const kind = typeof args?.kind === 'string' ? args.kind : undefined

      let picked
      try {
        picked = await deps.picker.pickFile({ kind })
      } catch (cause) {
        deps.logger?.warn?.('media_upload: picker failed: %s', cause?.code ?? cause?.message ?? 'unknown')
        return { ok: false, error: toPublicCode(cause, 'picker_unavailable') }
      }
      // 用户在原生对话框里取消：正常分支，不是错误。
      if (picked === null) return { ok: false, error: 'user_cancelled' }

      // TOCTOU 复查：选择与上传之间文件可能被替换/截断/超限。
      const check = await revalidateAdmittedFile(
        deps.store ?? deps.picker.store,
        picked.path,
        { maxBytes: deps.maxBytes },
      )
      if (!check.ok) {
        deps.logger?.warn?.('media_upload: admission recheck failed: %s', check.error)
        return { ok: false, error: toPublicCode({ code: check.error }) }
      }

      try {
        // 授权：只把文件元数据交给授权工具，换取 PUT 预签名直传授权。
        const auth = await authorizeUpload(deps.tools, {
          filename: check.entry.name,
          contentType: check.entry.mime,
          size: check.size,
        }, exec?.signal)
        await deps.driver.upload(
          picked.path,
          { url: auth.url, method: auth.method, headers: auth.headers },
          exec?.signal,
        )
        await recordMediaUploadAudit(deps.yootunAudit, deps.logger, 'agent_tool', { publicUrl: auth.publicUrl, size: check.size, mime: check.entry.mime })
        // 回到对话上下文的只有公网 URL 与对象元信息，不含预签名 URL/key/本地路径。
        return {
          ok: true,
          url: auth.publicUrl,
          size: check.size,
          contentType: check.entry.mime,
          name: check.entry.name,
        }
      } catch (cause) {
        // 用户主动取消（宿主中止信号）与插件卸载取消分开归因。
        if (exec?.signal?.aborted || cause?.name === 'AbortError') {
          deps.logger?.warn?.('media_upload: upload cancelled')
          return { ok: false, error: 'user_cancelled' }
        }
        const code = toPublicCode(cause)
        deps.logger?.warn?.('media_upload: upload failed: %s (%s)', cause?.message ?? 'unknown', code)
        await recordMediaUploadAudit(deps.yootunAudit, deps.logger, 'agent_tool', { size: check.size, mime: check.entry.mime, errorCode: code })
        return { ok: false, error: code }
      }
    },
  })
}

function sizeBucket(size) {
  if (size < 1024 * 1024) return 'under_1mb'
  if (size < 10 * 1024 * 1024) return 'under_10mb'
  if (size < 100 * 1024 * 1024) return 'under_100mb'
  return 'over_100mb'
}

export async function recordMediaUploadAudit(audit, logger, surface, result) {
  if (!audit?.record) return
  const succeeded = typeof result.publicUrl === 'string'
  const assetSeed = succeeded ? result.publicUrl : `${surface}:${result.mime}:${result.size}:${result.errorCode}`
  const id = `asset-${createHash('sha256').update(assetSeed).digest('hex').slice(0, 24)}`
  const mimeFamily = typeof result.mime === 'string' && result.mime.includes('/') ? result.mime.split('/', 1)[0] : 'unknown'
  const errorCode = typeof result.errorCode === 'string' && /^[a-z0-9_:-]{1,80}$/u.test(result.errorCode) ? result.errorCode : 'upload_failed'
  try {
    await audit.record({
      actionCode: 'media.upload.completed', category: 'create',
      source: { pluginId: '@dofe/dsh-yootun-tos-upload', pluginVersion: '0.1.0', surface },
      target: { type: 'media_asset', id }, outcome: succeeded ? 'succeeded' : 'failed',
      changes: [{ field: 'sizeBucket', after: sizeBucket(result.size) }, { field: 'mimeFamily', after: mimeFamily }], effects: [],
      ...(succeeded ? {} : { errorCode }),
    })
  } catch { logger?.warn?.('yootun audit record failed: audit_record_failed') }
}
