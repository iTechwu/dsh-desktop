/**
 * TOS 对象存储 S3 兼容协议的 SigV4 签名（零依赖，node:crypto）。
 * 对齐 tools.dofe.ai 的 boto3 口径：s3v4 签名 + virtual addressing。
 *
 * 只覆盖本插件需要的面：单次流式 PUT、固定 header 集、service 恒为 "s3"
 * （火山 TOS 的 S3 兼容端点按 S3 service 签名，endpoint 为 tos-s3-*）。
 * 纯函数、可单测；与 @aws-sdk/client-s3 的输出已对拍验证（见 test）。
 */

import { createHash, createHmac } from 'node:crypto'

/** 按 AWS SigV4 规则做 URI 编码：保留 unreserved(A-Za-z0-9-._~) 与 `/`，其余 %XX 大写。 */
export function uriEncode(value, encodeSlash = false) {
  let out = ''
  for (const char of String(value)) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char
    } else if (char === '/') {
      out += encodeSlash ? '%2F' : '/'
    } else {
      out += encodeURIComponent(char).replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase())
    }
  }
  return out
}

/** 十六进制 SHA-256。 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest()
}

function hmacHex(key, data) {
  return createHmac('sha256', key).update(data).digest('hex')
}

/**
 * 计算 SigV4 签名。
 * @param {object} input
 * @param {string} input.method HTTP 方法（如 'PUT'）。
 * @param {string} input.path 规范路径（已按 uriEncode 处理，含前导 `/`）。
 * @param {string} input.query 规范查询串（通常空）。
 * @param {Record<string,string>} input.headers 小写名为键的待签名 header（含 host）。
 * @param {string} input.payloadHash 负载哈希：文件真实 SHA-256 或 'UNSIGNED-PAYLOAD'。
 * @param {string} input.amzDate ISO 时间 `YYYYMMDDTHHMMSSZ`。
 * @param {string} input.region 区域（如 cn-beijing）。
 * @param {string} [input.service='s3'] 签名服务名。
 * @param {string} input.accessKeyId AK。
 * @param {string} input.secretAccessKey SK。
 * @returns {{authorization:string,signature:string,canonicalRequest:string,stringToSign:string}}
 */
export function signV4(input) {
  const {
    method,
    path,
    query = '',
    headers,
    payloadHash,
    amzDate,
    region,
    service = 's3',
    accessKeyId,
    secretAccessKey,
  } = input

  const headerNames = Object.keys(headers).sort()
  const canonicalHeaders = headerNames
    .map((name) => `${name}:${headers[name].trim().replace(/\s+/g, ' ')}\n`)
    .join('')
  const signedHeaders = headerNames.join(';')

  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const date = amzDate.slice(0, 8)
  const scope = `${date}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac(`AWS4${secretAccessKey}`, date)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = hmacHex(kSigning, stringToSign)

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return { authorization, signature, canonicalRequest, stringToSign }
}
