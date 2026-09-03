/**
 * 按扩展名推断 Content-Type，覆盖图片/音频/视频常见格式。
 * TOS 对象带上正确 Content-Type，浏览器才能直接预览/播放。
 * 实现口径对齐 tools.dofe.ai 的 S3 兼容上传（boto3 那套）。
 */

const MIME = {
  // 图片
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  // 音频
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  // 视频
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.3gp': 'video/3gpp',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff']
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'flv', '3gp', 'mpg', 'mpeg']
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
