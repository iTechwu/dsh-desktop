/**
 * 按扩展名推断 Content-Type，覆盖本插件允许上传的图片/视频格式。
 *
 * 口径与 Tools 服务 `tos_upload_authorize` 的 MIME allowlist 严格对齐
 * （`tos_upload_allowed_content_types`）：只允许
 * video/mp4、video/quicktime、image/jpeg、image/png、image/webp。
 * 选择器过滤器与授权服务双重收口，避免用户选中一个授权阶段必然被拒的类型。
 */

const MIME = {
  // 图片
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  // 视频
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
export const VIDEO_EXTENSIONS = ['mp4', 'mov']
export const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]

/** 取小写扩展名（不含点），无扩展名返回空串。 */
export function extensionOf(filename) {
  const dot = String(filename).lastIndexOf('.')
  if (dot < 0) return ''
  return String(filename).slice(dot + 1).toLowerCase()
}

/**
 * 推断文件的 Content-Type。
 * @param {string} filename 文件名（可含路径）。
 * @returns {string} MIME 类型，未知时回退 application/octet-stream。
 */
export function guessContentType(filename) {
  const ext = extensionOf(filename)
  if (ext === '') return 'application/octet-stream'
  return MIME[`.${ext}`] ?? 'application/octet-stream'
}
