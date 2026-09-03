/**
 * 原生文件选择器：Electron dialog.showOpenDialog 封装 + 允许清单登记。
 * 照抄 dsh-plugin-desktop 目录选择器全链路（directory-picker-route.ts ->
 * workspace-admission.ts 的 showOpenDialog 注入），openDirectory 换 openFile +
 * 扩展名过滤器；路由注册不加平台门限（showOpenDialog 天然跨 Windows/macOS/Linux）。
 */

import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { PickedFileStore, validateUploadableFile } from './allowlist.js'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, MEDIA_EXTENSIONS, extensionOf, guessContentType } from './mime.js'

const FILTERS = {
  image: [{ name: '图片', extensions: IMAGE_EXTENSIONS }],
  video: [{ name: '视频', extensions: VIDEO_EXTENSIONS }],
  media: [
    { name: '媒体文件', extensions: MEDIA_EXTENSIONS },
    { name: '图片', extensions: IMAGE_EXTENSIONS },
    { name: '视频', extensions: VIDEO_EXTENSIONS },
  ],
}

const ALLOWED = {
  image: new Set(IMAGE_EXTENSIONS),
  video: new Set(VIDEO_EXTENSIONS),
  media: new Set(MEDIA_EXTENSIONS),
}

/**
 * 在宿主进程内加载 Electron dialog。
 * Electron 主进程里 require('electron') 返回模块对象；普通 Node（如 dsh web
 * profile）下要么抛 MODULE_NOT_FOUND，要么拿到 npm 占位包的路径字符串，
 * 两种情况都归一为 null（选择器不可用，路由/工具返回结构化错误）。
 */
export function loadElectronDialog() {
  try {
    const require = createRequire(import.meta.url)
    const electron = require('electron')
    const dialog = electron?.dialog ?? electron?.default?.dialog
    if (typeof dialog?.showOpenDialog === 'function') return dialog
    return null
  } catch {
    return null
  }
}

/**
 * 创建文件选择器。
 * @param {object} options { dialog, store, maxBytes, title? }
 *   dialog 可注入假实现用于测试；缺省 loadElectronDialog()。
 */
export function createFilePicker(options = {}) {
  const dialog = 'dialog' in options ? options.dialog : loadElectronDialog()
  const store = options.store ?? new PickedFileStore()
  const maxBytes = options.maxBytes ?? Infinity
  /** @type {Promise<object|null>|undefined} 并发合并：同一时间只允许一个原生对话框。 */
  let pickTask

  /**
   * 弹出原生文件选择框并登记选中的文件。
   * @param {object} [req] { kind?: 'media'|'image'|'video' } 扩展名过滤档位。
   * @returns {Promise<{path:string,name:string,size:number,mime:string}|null>} 用户取消返回 null。
   */
  async function pickFile(req = {}) {
    if (dialog === null) {
      const error = new Error('native file picker is unavailable in this host')
      error.code = 'picker_unavailable'
      throw error
    }
    const kind = typeof req.kind === 'string' && req.kind in FILTERS ? req.kind : 'media'
    if (pickTask !== undefined) return await pickTask
    const task = showAndAdmit(kind)
    pickTask = task
    try {
      return await task
    } finally {
      if (pickTask === task) pickTask = undefined
    }
  }

  async function showAndAdmit(kind) {
    const result = await dialog.showOpenDialog({
      title: options.title ?? '选择要上传的文件',
      properties: ['openFile', 'dontAddToRecent'],
      filters: FILTERS[kind],
    })
    if (result.canceled) return null
    const path = result.filePaths[0]
    if (typeof path !== 'string' || path === '') return null

    // 过滤器只是 UI 层提示，宿主侧再强制一次扩展名允许清单（双端均生效）。
    if (!ALLOWED[kind].has(extensionOf(path))) {
      const error = new Error(`extension is not allowed for kind ${kind}`)
      error.code = 'extension_not_allowed'
      throw error
    }
    const check = await validateUploadableFile(path, { maxBytes })
    if (!check.ok) {
      const error = new Error(`picked file is not uploadable: ${check.error}`)
      error.code = check.error
      throw error
    }
    return store.admit(path, {
      name: basename(path),
      size: check.size,
      mime: guessContentType(path),
    })
  }

  return { pickFile, store, available: dialog !== null }
}
