/**
 * dsh-yootun-tos-upload：Yootun 通用媒体上传能力（纯宿主插件，无客户端半）。
 * 双触发通道共用同一驱动与安全模型：
 *   1. HTTP 路由 /_dsh/uploader/pick-file + /_dsh/uploader/upload（插件 UI 按钮）
 *   2. agent 工具 media_upload（会话中模型调用，人机回环选文件）
 *
 * Cordis 契约：
 * - apply(ctx, config) 第二参数是 Loader 行 config（非敏感项），插件绝不读
 *   上下文里的 config 服务，也不把 config 加入 inject；
 * - 硬依赖 webServer/tools 走 inject；可选服务 credentials/systemPrompt 统一用
 *   ctx.get() 读取——缺失时不阻断插件加载（credential store 不在就回退环境
 *   变量/密钥文件，system prompt 服务不在工具照常注册）；logger 用 Cordis
 *   内置上下文属性，不加入 inject；
 * - 注册具备事务性：任一步失败即逆序注销已注册内容并释放驱动/允许清单，
 *   不会留下半注册状态；重载后不会出现重复工具/路由/prompt。
 */

import { loadConfig } from './config.js'
import { createFilePicker } from './picker.js'
import { createTosDriver } from './drivers/tos.js'
import { handlePickFileRequest, handleUploadRequest, PICK_FILE_PATH, UPLOAD_PATH } from './routes.js'
import { registerMediaUploadTool } from './tool.js'

export const name = 'yootun-tos-upload'
/** 硬依赖：缺失时 Cordis 会等待/拒绝启动，不进入半注册状态。 */
export const inject = ['webServer', 'tools']

/**
 * 从部署注入的 credential store 解析 TOS AK/SK（对齐 MODELS_API_KEY 的既有模式）。
 * credential store 不存在或读取失败都不抛出——返回空值，由环境变量/密钥文件兜底。
 * @param {object} ctx 宿主上下文。
 * @returns {Promise<{accessKeyId:string,accessKeySecret:string}>}
 */
async function resolveStoredCredentials(ctx) {
  const out = { accessKeyId: '', accessKeySecret: '' }
  try {
    const store = ctx.get?.('credentials')
    if (!store || typeof store.resolve !== 'function') return out
    const id = await store.resolve('STORAGE_ACCESS_KEY_ID')
    const secret = await store.resolve('STORAGE_ACCESS_KEY_SECRET')
    out.accessKeyId = id?.value ?? ''
    out.accessKeySecret = secret?.value ?? ''
  } catch {
    // credential store 不可用时降级到环境变量 / 密钥文件。
  }
  return out
}

/** 逆序执行清理；单个 disposer 失败不阻断其余清理。 */
function unwindDisposers(disposers, logger) {
  for (const dispose of disposers.reverse()) {
    try {
      dispose?.()
    } catch (cause) {
      logger?.warn?.('yootun-tos-upload: disposer failed during cleanup: %s',
        cause instanceof Error ? cause.message : String(cause))
    }
  }
  disposers.length = 0
}

/**
 * @param {object} ctx 宿主上下文。
 * @param {object} [config] Loader 行配置（非敏感项）。
 * @param {object} [overrides] 测试注入点：{ env?, homeDir?, secrets?, credentials?, dialog?, driver?, config? }。
 * @returns {Promise<() => void>} 注销函数（幂等，可重复调用）。
 */
export async function apply(ctx, config = {}, overrides = {}) {
  const logger = ctx.logger
  const disposers = []
  let disposed = false
  /** 已分配资源的登记处（disposeAll 与正常注销共用）。 */
  const state = { picker: null, driver: null }

  /** 一次性事务性清理：注销已注册内容、释放允许清单与驱动。 */
  const disposeAll = () => {
    if (disposed) return
    disposed = true
    unwindDisposers(disposers, logger)
    state.picker?.store.clear()
    state.driver?.destroy?.()
  }

  try {
    // 可选服务：统一 ctx.get()，缺失不阻断。
    const credentials = overrides.credentials
      ?? await resolveStoredCredentials(ctx)

    const rowConfig = overrides.config ?? config
    const effectiveConfig = await loadConfig(rowConfig, {
      env: overrides.env,
      homeDir: overrides.homeDir,
      secrets: overrides.secrets,
      credentials,
    })

    // 配置校验问题：明确日志 + “不可上传但插件可加载”降级。
    for (const problem of effectiveConfig.errors) {
      logger?.warn?.('yootun-tos-upload: config problem: %s', problem)
    }
    if (!effectiveConfig.ready) {
      logger?.warn?.('yootun-tos-upload: 上传能力不可用（缺 %s），插件以降级状态加载；请配置 STORAGE_* 环境变量或 $DSH_HOME 密钥文件',
        effectiveConfig.missing.concat(effectiveConfig.errors.length > 0 ? ['valid-config'] : []).join('/') || 'credentials')
    }

    const picker = createFilePicker({
      ...(overrides.dialog !== undefined ? { dialog: overrides.dialog } : {}),
      maxBytes: effectiveConfig.limits.maxBytes,
    })
    state.picker = picker

    // 驱动抽象：第一期 tos；后期 ci-server 实现同一接口，config.backend 切换。
    let driver = overrides.driver ?? null
    if (driver === null && effectiveConfig.backend === 'tos' && effectiveConfig.ready) {
      try {
        driver = await createTosDriver(effectiveConfig.tos)
      } catch (cause) {
        // 驱动初始化失败不输出签名或请求内容，只记录消息。
        logger?.error?.('yootun-tos-upload: TOS driver init failed: %s', cause?.message ?? 'unknown')
      }
    }
    state.driver = driver

    if (ctx.webServer) {
      const expectedOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
      const reportError = (cause) => {
        logger?.error?.('yootun-tos-upload: route failed: %s', cause instanceof Error ? cause.message : String(cause))
      }
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: PICK_FILE_PATH,
        handler: (req, res) => handlePickFileRequest(req, res, {
          expectedOrigin,
          pickFile: (req2) => picker.pickFile(req2),
          reportError,
        }),
      }))
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: UPLOAD_PATH,
        handler: (req, res) => handleUploadRequest(req, res, {
          expectedOrigin,
          store: picker.store,
          driver,
          maxBytes: effectiveConfig.limits.maxBytes,
          reportError,
        }),
      }))
    }

    if (ctx.tools) {
      // 工具注册失败会抛出 -> 上面的 catch 逆序注销已注册路由，不留半注册状态。
      disposers.push(registerMediaUploadTool(ctx, {
        picker,
        driver,
        maxBytes: effectiveConfig.limits.maxBytes,
        timeoutMs: effectiveConfig.tool.timeoutMs,
        logger,
      }))
      // system prompt 是可选服务：缺失时工具照常注册。
      const systemPrompt = ctx.get?.('systemPrompt')
      if (systemPrompt && typeof systemPrompt.section === 'function') {
        disposers.push(systemPrompt.section({
          name: 'tool:media-upload',
          order: 117,
          text: '需要把本地图片/视频变成公网 URL 时使用 media_upload 工具。它会弹出原生文件选择框由用户亲手选文件；不要尝试向它传本地路径，也不要用其他方式读取用户本地文件。上传成功后把返回的 url 交给需要公网媒体地址的下游工具。',
        }))
      }
    }

    return disposeAll
  } catch (cause) {
    // 事务性：任一步失败，逆序注销已成功注册的内容，再释放驱动与允许清单。
    logger?.error?.('yootun-tos-upload: apply failed, rolling back registrations: %s',
      cause instanceof Error ? cause.message : String(cause))
    disposeAll()
    throw cause
  }
}
