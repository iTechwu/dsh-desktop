// 头像 URL 标准化（docs/0909/douyin 二次优化 §5.1）：全插件唯一的纯函数实现。
//
// 抖音 user/info 的 `avatar_uri` 真实形态可能是 `{ uri, url_list: [...] }` 图集对象，
// 历史代码把对象直接当 URL 透传，导致 `<img src>` 与 `douyin_account_save` 拿到非
// 字符串值。collector（采集读取）、session（登录读取）与 index.js（宿主投影）必须
// 共用本函数，保证登录和采集得到同一类型的头像值；宿主侧最终白名单仍保留不删。
//
// 安全边界（§4.2）：对象、空值、非字符串非对象、危险协议（javascript:/data:/file:）、
// 协议相对地址与超长 URL 一律返回 null；绝不做无法验证的改写（不拼接域名、不截断）。

const MAX_AVATAR_URL_LENGTH = 2048

/** 单个候选值 → 合法 http(s) URL 字符串；其余一律 null。 */
function safeUrlString(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_AVATAR_URL_LENGTH) return null
  let url
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return trimmed
}

/**
 * 头像候选统一标准化：字符串或图集对象 → 第一个合法 http(s) URL，否则 null。
 *
 * 对象形态优先按原顺序取 `url_list` 中第一个合法 URL；`uri` 只作为必要的兼容候选。
 */
export function normalizeAvatarUrl(value) {
  if (typeof value === 'string') return safeUrlString(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidates = Array.isArray(value.url_list) ? value.url_list : []
  for (const item of candidates) {
    const url = safeUrlString(item)
    if (url) return url
  }
  return safeUrlString(value.uri)
}
