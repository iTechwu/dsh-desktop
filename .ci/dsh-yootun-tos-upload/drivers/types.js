/**
 * UploaderDriver 契约（JSDoc 表达，纯宿主插件无 TS 构建）：
 *
 * @typedef {object} UploadMeta
 * @property {string} [name] 原始文件名（用于默认 key 与 Content-Type 推断）。
 * @property {string} [mime] 显式 Content-Type。
 *
 * @typedef {object} UploadResult
 * @property {string} key 对象 key。
 * @property {string} url 公网可访问 URL。
 * @property {number} size 字节数。
 * @property {string} contentType 实际写入的 Content-Type。
 * @property {string} [etag] 对象 ETag（如有）。
 *
 * @typedef {object} UploaderDriver
 * @property {(path: string, meta?: UploadMeta, signal?: AbortSignal) => Promise<UploadResult>} upload
 * @property {() => void} [destroy] 释放底层连接。
 *
 * 第一期实现：drivers/tos.js（火山 TOS，S3 兼容协议）。
 * 后期 drivers/ci-server.js 实现同一接口，config.backend 切换，对外契约不变。
 */
export {}
