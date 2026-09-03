/**
 * 插件配置解析：默认值 <- Loader 行 config（apply 第二参数，仅非敏感项）
 * <- STORAGE_* 环境变量 <- $DSH_HOME/tos-upload.env（gitignored 密钥文件）。
 *
 * 契约（与 AGENTS/README 一致）：
 * - apply(ctx, config) 的第二参数是 Cordis Loader 行 config，插件绝不读 ctx.config；
 * - Loader config 只放非敏感项；AK/SK 永不入库、不进安装包，只从
 *   credential store -> 环境变量 -> $DSH_HOME 密钥文件三处解析；
 * - 配置非法时插件仍可加载，但进入“不可上传”降级状态（ready=false + errors）。
 *
 * 凭证卫生：密钥文件用 lstat 防护（拒绝符号链接、限制大小），凭证读取统一走
 * resolveCredentials()，日志只能记录来源名与脱敏标识，禁止输出明文值。
 */

import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const SECRETS_FILENAME = 'tos-upload.env'
const MAX_SECRETS_BYTES = 64 * 1024

/** 受支持的后端列表（第一期只有 tos；ci-server 落地后在此扩展）。 */
export const SUPPORTED_BACKENDS = ['tos']

const DEFAULTS = {
  backend: 'tos',
  region: 'cn-beijing',
  keyPrefix: 'yootun/uploads',
  addressingStyle: 'virtual',
  maxBytes: 500 * 1024 * 1024,
  toolTimeoutMs: 30 * 60 * 1000,
}

/** 单文件大小硬上限：2GB（配置超过此值直接判非法）。 */
export const MAX_MAX_BYTES = 2 * 1024 * 1024 * 1024
/** 工具超时硬上限：60 分钟。 */
export const MAX_TOOL_TIMEOUT_MS = 60 * 60 * 1000

/** region 归一化并校验：容忍 `tos-s3-` / `tos-` 前缀（对齐 boto3 normalize_region）。 */
function normalizeRegion(region) {
  return String(region).replace(/^tos-s3-/, '').replace(/^tos-/, '')
}

const REGION_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const KEY_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/

/** 去掉首尾斜杠，保证 key 前缀格式稳定。 */
function trimSlashes(value) {
  return String(value).replace(/^\/+|\/+$/g, '')
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/** 正整数解析，越界或非法返回 null（由调用方决定降级方式）。 */
function toBoundedPositiveInt(value, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  const floored = Math.floor(parsed)
  if (floored > max) return null
  return floored
}

/**
 * HTTPS 校验：endpoint/publicBaseUrl 只允许 https（loopback http 例外，
 * 供本地联调的对象存储替身使用，不会进入客户端安装包）。
 */
function isAcceptableHttpUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.protocol === 'http:') {
      const host = url.hostname
      return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
    }
    return true
  } catch {
    return false
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析 $DSH_HOME/tos-upload.env（KEY=VALUE 行格式）。
 * 防护：lstat 必须是普通文件、拒绝符号链接、大小上限 64KB；任何失败都视为无密钥文件。
 * @param {string} homeDir DSH_HOME 目录。
 * @returns {Promise<Record<string, string>>}
 */
export async function readSecretsFile(homeDir) {
  try {
    const file = join(homeDir, SECRETS_FILENAME)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SECRETS_BYTES) return {}
    const text = await readFile(file, 'utf8')
    const out = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 生成凭证的脱敏标识（只暴露前 2 位与后 2 位，长度不足则完全掩蔽）。
 * 这是凭证唯一允许出现在日志里的形态。
 */
function redact(value) {
  if (typeof value !== 'string' || value.length < 8) return '***'
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

/**
 * 统一凭证解析接口。
 *
 * 来源优先级：credential store -> environment -> $DSH_HOME/tos-upload.env。
 * 返回结构化元数据（是否存在/来源/可用性/脱敏标识），绝不返回明文值给日志；
 * 明文值只进入 loadConfig 内部合成，不进入返回结果。
 *
 * credential store 读取失败视为该来源不存在，不抛出异常。
 * @param {object} [options] { credentials?, env?, secrets? }
 *   credentials 为宿主 credential store 读取结果 { accessKeyId?, accessKeySecret? }；
 *   env 默认 process.env；secrets 可注入以跳过文件读取。
 * @returns {Promise<{accessKeyId:string, accessKeySecret:string,
 *   info:{accessKeyId:{present:boolean,source:string|null,available:boolean,redacted:string},
 *         accessKeySecret:{present:boolean,source:string|null,available:boolean,redacted:string},
 *         bothPresent:boolean, ready:boolean}}>}
 */
export async function resolveCredentials(options = {}) {
  const env = options.env ?? process.env
  const homeDir = env.DSH_HOME ?? join(homedir(), '.dsh')
  const secrets = options.secrets ?? await readSecretsFile(homeDir)

  const envKeys = { accessKeyId: 'STORAGE_ACCESS_KEY_ID', accessKeySecret: 'STORAGE_ACCESS_KEY_SECRET' }
  const stored = {}
  const info = {}
  for (const name of ['accessKeyId', 'accessKeySecret']) {
    const holder = isPlainObject(options.credentials) ? options.credentials : {}
    /** @type {[string, string]|null} [来源, 值] */
    let found = null
    if (typeof holder[name] === 'string' && holder[name].trim() !== '') {
      found = ['credential-store', holder[name].trim()]
    } else if (typeof env[envKeys[name]] === 'string' && env[envKeys[name]].trim() !== '') {
      found = ['environment', env[envKeys[name]].trim()]
    } else if (typeof secrets[envKeys[name]] === 'string' && secrets[envKeys[name]].trim() !== '') {
      found = ['secret-file', secrets[envKeys[name]].trim()]
    }
    const value = found?.[1] ?? ''
    stored[name] = value
    info[name] = {
      present: value !== '',
      source: found?.[0] ?? null,
      available: value !== '',
      redacted: value === '' ? '' : redact(value),
    }
  }
  const bothPresent = stored.accessKeyId !== '' && stored.accessKeySecret !== ''
  info.bothPresent = bothPresent
  info.ready = bothPresent
  return { ...stored, info }
}

/**
 * 合成生效配置。
 * @param {object} [rowConfig] Cordis Loader 行 config（apply 第二参数，仅非敏感项）。
 * @param {object} [options] { env?, homeDir?, secrets?, credentials? }，
 *   credentials 为宿主 credential store 读取结果（经 resolveCredentialStore），
 *   secrets 可注入以跳过文件读取。
 * @returns {Promise<object>} 含 backend/tos/limits/tool/ready/missing/errors/info。
 */
export async function loadConfig(rowConfig = {}, options = {}) {
  const row = isPlainObject(rowConfig) ? rowConfig : {}
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? env.DSH_HOME ?? join(homedir(), '.dsh')
  const secrets = options.secrets ?? await readSecretsFile(homeDir)
  const credentials = isPlainObject(options.credentials) ? options.credentials : {}
  const credentialInfo = options.credentialInfo ?? null

  /** 配置校验问题（不阻断加载，只降级上传能力）。 */
  const errors = []

  const tos = isPlainObject(row.tos) ? row.tos : {}
  const limits = isPlainObject(row.limits) ? row.limits : {}
  const tool = isPlainObject(row.tool) ? row.tool : {}

  // 安全红线：Loader config / 环境之外的任何 AK/SK 字段一律拒绝并忽略。
  for (const banned of ['accessKeyId', 'accessKeySecret', 'ak', 'sk', 'secretAccessKey']) {
    if (tos[banned] !== undefined || row[banned] !== undefined) {
      errors.push(`credential field "${banned}" is not allowed in loader config and was ignored`)
    }
  }

  // backend
  const backend = firstNonEmpty(row.backend) || DEFAULTS.backend
  if (!SUPPORTED_BACKENDS.includes(backend)) {
    errors.push(`unsupported backend "${backend}" (supported: ${SUPPORTED_BACKENDS.join(', ')})`)
  }

  // region
  const region = normalizeRegion(firstNonEmpty(tos.region, env.STORAGE_REGION, secrets.STORAGE_REGION) || DEFAULTS.region)
  if (!REGION_PATTERN.test(region)) {
    errors.push(`invalid region "${region}"`)
  }

  // endpoint / publicBaseUrl
  const endpoint = firstNonEmpty(tos.endpoint, env.STORAGE_ENDPOINT, secrets.STORAGE_ENDPOINT)
    || (REGION_PATTERN.test(region) ? `https://tos-s3-${region}.volces.com` : '')
  if (endpoint !== '' && !isAcceptableHttpUrl(endpoint)) {
    errors.push(`endpoint must be an HTTPS address (loopback http allowed for local testing), got "${endpoint}"`)
  }
  const publicBaseUrl = firstNonEmpty(tos.publicBaseUrl, env.STORAGE_PUBLIC_BASE_URL, secrets.STORAGE_PUBLIC_BASE_URL)
  if (publicBaseUrl !== '' && !isAcceptableHttpUrl(publicBaseUrl)) {
    errors.push(`publicBaseUrl must be an HTTPS address, got "${publicBaseUrl}"`)
  }

  // bucket
  const bucket = firstNonEmpty(tos.bucket, env.STORAGE_BUCKET, secrets.STORAGE_BUCKET)
  if (bucket !== '' && !BUCKET_PATTERN.test(bucket)) {
    errors.push(`invalid bucket name "${bucket}"`)
  }

  // keyPrefix：规范化斜杠并校验字符集
  const keyPrefix = trimSlashes(firstNonEmpty(tos.keyPrefix, env.STORAGE_KEY_PREFIX, secrets.STORAGE_KEY_PREFIX) || DEFAULTS.keyPrefix)
  if (keyPrefix === '' || !KEY_PREFIX_PATTERN.test(keyPrefix)) {
    errors.push(`invalid keyPrefix "${keyPrefix}"`)
  }

  // addressingStyle
  const addressingStyle = firstNonEmpty(tos.addressingStyle, env.STORAGE_ADDRESSING_STYLE) || DEFAULTS.addressingStyle
  if (addressingStyle !== 'virtual' && addressingStyle !== 'path') {
    errors.push(`unsupported addressingStyle "${addressingStyle}"`)
  }

  // maxBytes：正整数且不超过硬上限
  const maxBytesRaw = limits.maxBytes ?? env.STORAGE_MAX_BYTES
  const maxBytes = maxBytesRaw === undefined ? DEFAULTS.maxBytes : toBoundedPositiveInt(maxBytesRaw, MAX_MAX_BYTES)
  if (maxBytes === null) {
    errors.push(`invalid limits.maxBytes "${maxBytesRaw}" (must be a positive integer <= ${MAX_MAX_BYTES})`)
  }

  // timeoutMs：正整数且不超过硬上限
  const timeoutMs = toBoundedPositiveInt(tool.timeoutMs, MAX_TOOL_TIMEOUT_MS) ?? DEFAULTS.toolTimeoutMs
  if (tool.timeoutMs !== undefined && toBoundedPositiveInt(tool.timeoutMs, MAX_TOOL_TIMEOUT_MS) === null) {
    errors.push(`invalid tool.timeoutMs "${tool.timeoutMs}" (must be a positive integer <= ${MAX_TOOL_TIMEOUT_MS})`)
  }

  // 凭证：统一解析接口（明文只进入合成，元数据进入 info）。
  const resolved = options.credentialInfo
    ? { accessKeyId: credentials.accessKeyId ?? '', accessKeySecret: credentials.accessKeySecret ?? '', info: credentialInfo }
    : await resolveCredentials({ credentials, env, secrets })

  const missing = []
  if (bucket === '' || !BUCKET_PATTERN.test(bucket)) missing.push('bucket')
  if (resolved.accessKeyId === '') missing.push('accessKeyId')
  if (resolved.accessKeySecret === '') missing.push('accessKeySecret')

  const structural = [
    !SUPPORTED_BACKENDS.includes(backend),
    REGION_PATTERN.test(region) === false,
    endpoint === '' || !isAcceptableHttpUrl(endpoint),
    publicBaseUrl !== '' && !isAcceptableHttpUrl(publicBaseUrl),
    bucket !== '' && !BUCKET_PATTERN.test(bucket),
    keyPrefix === '' || !KEY_PREFIX_PATTERN.test(keyPrefix),
    addressingStyle !== 'virtual' && addressingStyle !== 'path',
    maxBytes === null,
  ]

  return {
    backend,
    tos: {
      bucket,
      region,
      endpoint,
      accessKeyId: resolved.accessKeyId,
      accessKeySecret: resolved.accessKeySecret,
      keyPrefix,
      addressingStyle,
      cdnDomain: firstNonEmpty(tos.cdnDomain, env.STORAGE_CDN_DOMAIN, secrets.STORAGE_CDN_DOMAIN),
      publicBaseUrl,
    },
    limits: {
      maxBytes: maxBytes ?? DEFAULTS.maxBytes,
    },
    tool: {
      timeoutMs,
    },
    /** 凭证与桶配置齐全且配置合法，可执行真实上传。 */
    ready: missing.length === 0 && !structural.some(Boolean) && errors.length === 0,
    missing,
    /** 配置校验问题（诊断日志用，不含敏感值）。 */
    errors,
    /** 凭证来源元数据（脱敏，可安全打印）。 */
    info: resolved.info,
  }
}
