/**
 * UploaderDriver 契约（JSDoc 表达，纯宿主插件无 TS 构建）。
 *
 * 本插件不再持有对象存储凭证/桶/地域/endpoint，也不自行生成对象 key 或公网 URL。
 * 上传分两步：
 *   1. 授权（见 authorize.js）：把 { filename, contentType, size } 交给 Tools 服务的
 *      `tos_upload_authorize` 工具，拿到 PUT 预签名 URL + 头 + 公网 URL；
 *   2. 直传（本契约）：把本地文件流式 PUT 到预签名 URL。
 *
 * @typedef {object} UploadTarget
 * @property {string} url 预签名 PUT URL（含 query 签名）。
 * @property {string} [method] HTTP 方法，默认 "PUT"。
 * @property {Record<string,string>} [headers] 授权响应下发的请求头（含 Content-Type）。
 *
 * @typedef {object} UploadResult
 * @property {string} [etag] 对象 ETag（如有）。
 *
 * @typedef {object} UploaderDriver
 * @property {(path: string, target: UploadTarget, signal?: AbortSignal) => Promise<UploadResult>} upload
 * @property {() => void} [destroy] 释放底层连接。
 *
 * 唯一实现：drivers/tos.js（预签名 PUT 直传，零依赖 node:http/https）。
 */
export {}
