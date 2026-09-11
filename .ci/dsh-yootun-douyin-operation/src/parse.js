// 创作者中心响应解析（纯函数，可用脱敏 fixture 直接回归）。
//
// 依据 docs/0909/douyin/fixtures/README.md 的字段契约与 P0 参考实现：
// - 比例字段（0..1）→ 百分比（×100，保留 2 位），写入 `*_pct` canonical 列；
// - 时长字段一律秒；作品列表的 `video.duration` 是毫秒，转秒；
// - 缺字段不猜：返回 null，由调用方记 data_gap（not_exposed / 具体原因）；
// - 低播放 `item_compare`（status_code=10001）不是错误，只表示完播类指标不可得。

export const LOW_PLAY_STATUS_CODE = 10001

// 流量来源 key → 中文标签（未知 key 原样透出，不编造）。
export const SOURCE_LABELS = {
  homepage_hot: '推荐(首页推荐)',
  follow: '关注',
  homepage: '个人主页',
  search: '搜索',
  message: '私信/分享',
  familiar: '朋友/熟人',
  nearby: '同城',
  other: '其他',
}

// 年龄/性别等分桶 key 原样透出（抖音侧已是展示用分桶，如 '41-50' / 'male'）。

/**
 * 字符串感知的长数字加引号：19 位 `aweme_id` 作为裸 JSON 数字会被 JSON.parse 舍入成
 * float64（…066994 → …067000），因此解析前把**字符串外部**的 ≥16 位数字转成字符串。
 *
 * 必须感知字符串状态：朴素正则会命中 `"标题: 1234567890123456, 后续"` 这类正文并写出
 * 嵌套引号，直接破坏 JSON。
 */
export function quoteLongNumbers(text) {
  if (typeof text !== 'string' || !text) return text
  let out = ''
  let index = 0
  let inString = false
  while (index < text.length) {
    const char = text[index]
    if (inString) {
      if (char === '\\') {
        out += char + (text[index + 1] ?? '')
        index += 2
        continue
      }
      if (char === '"') inString = false
      out += char
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index += 1
      continue
    }
    if (char >= '0' && char <= '9') {
      const prev = text[index - 1]
      if (prev && /[0-9A-Za-z_.\-+]/.test(prev)) {
        out += char
        index += 1
        continue
      }
      let end = index
      while (end < text.length && text[end] >= '0' && text[end] <= '9') end += 1
      const digits = text.slice(index, end)
      const next = text[end]
      const terminates = next === undefined || next === ',' || next === ']' || next === '}' || /\s/.test(next)
      out += digits.length >= 16 && terminates ? `"${digits}"` : digits
      index = end
      continue
    }
    out += char
    index += 1
  }
  return out
}

/** 长数字安全解析：先做字符串感知的加引号，再 JSON.parse。 */
export function parseJsonPreservingIds(text) {
  if (typeof text !== 'string' || !text) return null
  try {
    return JSON.parse(quoteLongNumbers(text))
  } catch {
    return null
  }
}

/**
 * 严格数值转换：缺失（null/undefined/空串/布尔）返回 null，不伪造成 0。
 *
 * 这一点是 dataGap 语义的基础：接口没给的字段必须落成 null（缺口），
 * 而不是 0（会被 UI 当成真实数据展示）。
 *
 * `-0` 归一化为 `0`：宿主 snapshotJsonValue 的「无损 JSON」校验明确拒绝 -0
 * （`Object.is(current, -0)` → 整调用进程内拒绝），而 `Number('-0')`、
 * `Math.trunc(-0.2)` 都会产生 -0，必须在这里收敛。
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num === 0 ? 0 : num
}

/**
 * 0..1 比例 → 百分比（2 位小数）。缺失/非数值/超出 0..1 定义域返回 null。
 *
 * 定义域守卫：所有 `*_pct` 字段在 tools 侧都有 `ge=0, le=100` 硬约束，而
 * 抖音异常响应可能给出负数或 >1 的「比率」——落库前不拦，整批 50 条作品会
 * 被服务端 VALIDATION_ERROR 一次性拒绝。超界视为本次未暴露（缺口），与
 * 缺字段同等处理，其余字段的入库不受影响。
 */
export function pct(value) {
  const num = toNumber(value)
  if (num === null || num < 0 || num > 1) return null
  return Math.round(num * 100 * 100) / 100
}

/**
 * 数值取 2 位小数；缺失/非数值/负数返回 null。
 *
 * 仅用于时长类字段（duration_s / avg_watch_duration_s），语义上非负；
 * 负值必然是抖音侧数据异常，落 null 记缺口，避免服务端 `ge=0` 拒批。
 */
export function round2(value) {
  const num = toNumber(value)
  if (num === null || num < 0) return null
  return Math.round(num * 100) / 100
}

/** 截断整数；缺失/非数值返回 null；`-0` 归一化为 `0`（Math.trunc(-0.2) === -0）。 */
export function toInt(value) {
  const num = toNumber(value)
  if (num === null) return null
  const truncated = Math.trunc(num)
  return truncated === 0 ? 0 : truncated
}

/**
 * 按 schema 边界收敛文本：超长字段截断，而不是让整批入库被校验拒绝。
 *
 * tools 侧 `extra="forbid"` + 长度上限是硬边界；抖音标题/话题经常超长，
 * 设备端必须在提交前收敛（截断而非丢弃，保留可读前缀）。
 */
export function clampText(value, max) {
  if (value === null || value === undefined) return null
  const text = String(value)
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

/** 从 `{url_list: [...]}` 或字符串取第一个 URL。 */
export function firstUrl(node) {
  if (!node) return null
  if (typeof node === 'string') return node.trim() || null
  if (Array.isArray(node)) return firstUrl(node[0])
  if (typeof node !== 'object') return null
  const list = node.url_list || node.urlList || node.url
  const found = firstUrl(list)
  return found
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

/**
 * 作品列表元素 → canonical 作品字段。
 *
 * 映射（README §7.2）：`aweme_id→work_id`、`desc→title`、`create_time→publish_time`、
 * `statistics.*→counts`、`video.duration(ms)→duration_s`、`video.cover.url_list[0]→cover_url`、
 * `status.is_private→isPrivate（private 作品以 dataGap 标记，见 collector 注释）`。
 */
export function normalizeWork(raw) {
  if (!raw || typeof raw !== 'object') return null
  const stats = raw.statistics || raw.Statistics || {}
  const video = raw.video || raw.Video || {}
  const status = raw.status || raw.Status || {}
  const workId = firstPresent(raw.aweme_id, raw.awemeId, raw.item_id, raw.id)
  if (!workId) return null
  const createTime = toInt(firstPresent(raw.create_time, raw.createTime))
  const durationMs = toInt(firstPresent(video.duration, raw.duration))
  return {
    work_id: String(workId),
    title: clampText(firstPresent(raw.desc, raw.Description, raw.title), 1024),
    url: clampText(`https://www.douyin.com/video/${String(workId)}`, 2048),
    publish_time: createTime === null ? null : new Date(createTime * 1000).toISOString(),
    play_count: toInt(firstPresent(stats.play_count, stats.playCount)),
    like_count: toInt(firstPresent(stats.digg_count, stats.diggCount)),
    comment_count: toInt(firstPresent(stats.comment_count, stats.commentCount)),
    collect_count: toInt(firstPresent(stats.collect_count, stats.collectCount)),
    share_count: toInt(firstPresent(stats.share_count, stats.shareCount)),
    danmaku_count: toInt(firstPresent(stats.danmaku_count, stats.danmakuCount)),
    duration_s: durationMs === null ? null : round2(durationMs / 1000),
    cover_url: firstUrl(firstPresent(video.cover, raw.cover)),
    is_private: status.is_private === true || status.isPrivate === true,
  }
}

/**
 * 作品列表单页解析。
 *
 * @returns {{works: object[], hasMore: boolean, nextCursor: string|number|null, rawCount: number}}
 */
export function parseWorkListPage(json) {
  const payload = json && typeof json === 'object' ? json : {}
  const list = Array.isArray(payload.aweme_list) ? payload.aweme_list : []
  const works = list.map(normalizeWork).filter(Boolean)
  const nextCursor = firstPresent(payload.max_cursor, payload.cursor)
  return {
    works,
    hasMore: payload.has_more === true,
    nextCursor: nextCursor === null ? null : nextCursor,
    rawCount: list.length,
  }
}

/**
 * 判断是否需要停止翻页，并给出是否"完整结束"。
 *
 * 终止/不完整规则（README §7.2）：
 * - `has_more=false` 且当前页已处理 → 完整结束；
 * - `has_more=true` + 空列表 → 不完整；
 * - 下一页游标为空或与当前相同 → 不完整；
 * - 达到 max_pages 硬上限 → 不完整。
 */
export function decidePagination({ page, cursor, pageNumber, maxPages }) {
  if (!page.hasMore) return { stop: true, listComplete: true, reason: 'has_more_false' }
  if (page.rawCount === 0) return { stop: true, listComplete: false, reason: 'empty_page_with_more' }
  if (page.nextCursor === null || page.nextCursor === '' || String(page.nextCursor) === String(cursor)) {
    return { stop: true, listComplete: false, reason: 'cursor_not_advancing' }
  }
  if (pageNumber >= maxPages) return { stop: true, listComplete: false, reason: 'max_pages_reached' }
  return { stop: false, listComplete: false, reason: 'continue' }
}

/** 跨页按 work_id 去重（保留首次出现顺序）。 */
export function dedupeWorks(works) {
  const seen = new Set()
  const out = []
  for (const work of works) {
    if (!work || !work.work_id || seen.has(work.work_id)) continue
    seen.add(work.work_id)
    out.push(work)
  }
  return out
}

/** 批量作品分析 `item_performance` → Map(work_id → 早期留存指标)。 */
export function parseItemPerformance(json) {
  const payload = json && typeof json === 'object' ? json : {}
  const items = Array.isArray(payload.items) ? payload.items : []
  const map = new Map()
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const workId = firstPresent(item.item_id, item.itemId)
    if (!workId) continue
    map.set(String(workId), {
      play_count: toInt(item.play_count),
      avg_watch_duration_s: round2(item.average_play_duration),
      completion_rate_5s_pct: pct(item.completion_rate_5s),
      bounce_rate_2s_pct: pct(item.bounce_rate_2s),
      cover_url: firstUrl(item.cover),
    })
  }
  return map
}

/** 单稿分析 `item_compare`：低播放（status_code=10001）不是错误，返回 lowPlay。 */
export function parseItemCompare(json) {
  const payload = json && typeof json === 'object' ? json : {}
  const statusCode = toInt(payload.status_code)
  const metrics = (payload.item && payload.item.metrics) || {}
  const lowPlay = statusCode === LOW_PLAY_STATUS_CODE || Object.keys(metrics).length === 0
  return {
    statusCode,
    lowPlay,
    statusMessage: typeof payload.status_msg === 'string' ? payload.status_msg : null,
    metrics: {
      play_count: toInt(metrics.view_count),
      avg_watch_duration_s: round2(metrics.avg_view_second),
      completion_rate_pct: pct(metrics.completion_rate),
      completion_rate_5s_pct: pct(metrics.completion_rate_5s),
      bounce_rate_2s_pct: pct(metrics.bounce_rate_2s),
      avg_view_proportion_pct: pct(metrics.avg_view_proportion),
      cover_click_rate_pct: pct(metrics.cover_click_rate),
      follower_play_ratio_pct: pct(metrics.fan_view_proportion),
    },
    engagement_rates: {
      like_rate: pct(metrics.like_rate),
      comment_rate: pct(metrics.comment_rate),
      share_rate: pct(metrics.share_rate),
      favorite_rate: pct(metrics.favorite_rate),
    },
  }
}

/**
 * 流量来源 `play/source`：[{source_key, source_label, share_pct}]，按占比降序。
 *
 * 响应里没有 `play_source` 数组（例如空桩响应）→ 返回 null（本次未暴露），
 * 而不是空数组——空数组会被当作"已采集但无数据"，把缺口伪造成真实值。
 */
export function parsePlaySource(json) {
  const payload = json && typeof json === 'object' ? json : {}
  if (!Array.isArray(payload.play_source)) return null
  const list = payload.play_source
  const rows = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const key = firstPresent(item.key, item.source_key)
    const share = pct(item.value)
    if (!key || share === null) continue
    rows.push({
      source_key: clampText(key, 64),
      source_label: clampText(SOURCE_LABELS[String(key)] || String(key), 128),
      share_pct: share,
    })
  }
  return rows.sort((a, b) => b.share_pct - a.share_pct)
}

/** 观众画像 `fans/item/portrait`：四类分布，各按占比降序；地域取前 8。 */
export function parsePortrait(json) {
  const payload = json && typeof json === 'object' ? json : {}
  const hasAnyBlock = ['gender', 'age', 'province', 'city_level'].some(
    name => payload[name] && Array.isArray(payload[name].ratio_list),
  )
  if (!hasAnyBlock) return null
  const block = name => {
    const node = payload[name]
    const list = node && Array.isArray(node.ratio_list) ? node.ratio_list : []
    const rows = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const key = firstPresent(item.key, item.name)
      const share = pct(item.value)
      if (!key || share === null) continue
      rows.push({ key: clampText(key, 64), pct: share })
    }
    return rows.sort((a, b) => b.pct - a.pct)
  }
  const provinces = block('province')
  return {
    gender: block('gender'),
    age: block('age'),
    province: provinces.slice(0, 8),
    city_level: block('city_level'),
  }
}

/** 搜索词 `item_analysis/search/keyword`：`show_from[]` → [{keyword, percent}]。
 *
 * `show_from` 存在但为空是有效数据（该作品确无搜索词）；字段缺失则返回 null（缺口）。
 */
export function parseSearchKeywords(json) {
  const payload = json && typeof json === 'object' ? json : {}
  if (!Array.isArray(payload.show_from)) return null
  const list = payload.show_from
  const rows = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const keyword = firstPresent(item.keyword, item.word)
    const percent = toNumber(item.percent)
    if (!keyword) continue
    if (percent === null) continue
    // 抖音该字段本身以百分数返回，原样透出（不二次放大），并夹在契约允许范围内。
    rows.push({
      keyword: clampText(keyword, 128),
      percent: Math.min(100, Math.max(0, Math.round(percent * 100) / 100)),
    })
  }
  return rows.sort((a, b) => b.percent - a.percent)
}

/** 进度分析 `progress/analysis/v2`：jump_backward/jump_forward → 拖回/拖前曲线。 */
export function parseProgressAnalysis(json) {
  const payload = json && typeof json === 'object' ? json : {}
  if (!Array.isArray(payload.jump_backward) && !Array.isArray(payload.jump_forward)) return null
  const curve = points => {
    const list = Array.isArray(points) ? points : []
    const rows = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const key = firstPresent(item.key, item.second)
      const value = pct(item.value)
      if (key === null || value === null) continue
      rows.push({ key: clampText(key, 32), value })
    }
    return rows
  }
  const dragBack = curve(payload.jump_backward)
  const dragForward = curve(payload.jump_forward)
  const videoData = payload.video_data && typeof payload.video_data === 'object' ? payload.video_data : null
  return {
    drag_back_curve: dragBack,
    drag_forward_curve: dragForward,
    // 端点可达、契约正确，但该作品确实没有任何进度数据（抖音返回两条空曲线 +
    // video_data=null）。与"根本没取到"必须区分：调用方据此记 `no_data` 缺口，
    // UI 才能说明是"暂无数据"而不是加载失败。注意 `empty` 只在本函数内部传递，
    // 入库前必须剥离——tools 的 DouyinProgressAnalysis 是 extra="forbid"。
    empty: dragBack.length === 0 && dragForward.length === 0 && videoData === null,
  }
}

/**
 * 单稿指标 `item/mget`：详情页概览自身调用的接口，补齐列表 `statistics` 未暴露的计数类指标。
 *
 * 只取 README §8 canonical 契约已有的 `danmaku_count`；响应里的 `cover_show`、
 * `dislike_*` 等字段暂不入库，避免超出既定列契约。
 *
 * 返回 `Map<workId, {danmaku_count}>` 而**不是**只取 `items[0]`：该接口的 `ids`
 * 是复数，拦截到的响应可能是多作品批量请求，盲取首元素会把别的作品的弹幕数
 * 记到当前作品上。按 `id` 建索引后，取不到就是取不到（记缺口），不会张冠李戴。
 */
export function parseItemMget(json) {
  const payload = json && typeof json === 'object' ? json : {}
  const list = Array.isArray(payload.items) ? payload.items : []
  const rows = new Map()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = firstPresent(item.id, item.item_id, item.aweme_id)
    if (id === null) continue
    const metrics = item.metrics || {}
    rows.set(String(id), {
      danmaku_count: toInt(firstPresent(metrics.danmaku_count, metrics.danmakuCount)),
    })
  }
  return rows
}

/**
 * 评论热词 `wordCloud`：区分"成功但为空"与"请求失败"。
 *
 * - `status_code==0` → ok（`words` 可能为空 → 服务端清空当前集合）；
 * - 非零/解析失败 → unavailable（服务端保留旧集合并记 data_gap）。
 */
export function parseWordCloud(json) {
  const payload = json && typeof json === 'object' ? json : {}
  const statusCode = toInt(payload.status_code)
  if (!payload || Object.keys(payload).length === 0) {
    return { status: 'unavailable', statusCode, words: [] }
  }
  if (statusCode !== 0) return { status: 'unavailable', statusCode, words: [] }
  const list = Array.isArray(payload.word_cloud_list) ? payload.word_cloud_list : []
  const words = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const word = firstPresent(item.word, item.text)
    if (!word) continue
    words.push({
      word: clampText(word, 128),
      rank: toInt(item.rank) === null ? null : Math.max(0, toInt(item.rank)),
      raw_score: clampText(item.score, 64),
    })
  }
  return { status: 'ok', statusCode, words }
}

/**
 * 把列表/批量/单稿三路数据合并为入库载荷（canonical 键 + data_gap）。
 *
 * 缺口语义（开发实施说明 §6）：本次未取到的字段一律 null 并记
 * `dataGap[field] = { reason, at }`；`reason` 取 `not_exposed`（接口未返回）或
 * 具体原因（如低播放 `below_min_view`、`request_failed`）。
 */
export function buildWorkPayload({ work, performance, compare, source, portrait, search, progress, mget, hotword, observedAt }) {
  const gaps = {}
  const mark = (field, reason) => { gaps[field] = { reason, at: observedAt } }
  const from = (value, field, reason = 'not_exposed') => {
    if (value === null || value === undefined) { mark(field, reason); return null }
    return value
  }

  const perf = performance || {}
  const cmp = compare ? compare.metrics : null
  const engagement = compare ? compare.engagement_rates : null
  // 低播放：完播类指标不可得，但不影响其余字段。
  const lowPlayReason = compare && compare.lowPlay ? 'below_min_view' : 'not_exposed'
  // 进度分析：只有取到**非空**曲线才算有值。取到但为空 → `no_data`（作品确实没有
  // 拖拽数据）；完全没取到 → `not_exposed`。`empty` 是解析器的内部分隔标记，剥离后入库。
  const progressValue = progress && !progress.empty
    ? { drag_back_curve: progress.drag_back_curve, drag_forward_curve: progress.drag_forward_curve }
    : null
  // 单稿指标按 workId 取值：拦截到的批量响应里可能没有本条作品。
  const mgetRow = mget && typeof mget.get === 'function' ? mget.get(work.work_id) : null

  return {
    work_id: work.work_id,
    title: from(work.title, 'title'),
    url: from(work.url, 'url'),
    publish_time: from(work.publish_time, 'publish_time'),
    play_count: from(firstNonNull(cmp && cmp.play_count, perf.play_count, work.play_count), 'play_count'),
    like_count: from(work.like_count, 'like_count'),
    comment_count: from(work.comment_count, 'comment_count'),
    collect_count: from(work.collect_count, 'collect_count'),
    share_count: from(work.share_count, 'share_count'),
    danmaku_count: from(firstNonNull(mgetRow && mgetRow.danmaku_count, work.danmaku_count), 'danmaku_count'),
    bounce_rate_2s_pct: from(firstNonNull(cmp && cmp.bounce_rate_2s_pct, perf.bounce_rate_2s_pct), 'bounce_rate_2s_pct', lowPlayReason),
    completion_rate_5s_pct: from(firstNonNull(cmp && cmp.completion_rate_5s_pct, perf.completion_rate_5s_pct), 'completion_rate_5s_pct', lowPlayReason),
    completion_rate_pct: from(cmp && cmp.completion_rate_pct, 'completion_rate_pct', lowPlayReason),
    avg_watch_duration_s: from(firstNonNull(cmp && cmp.avg_watch_duration_s, perf.avg_watch_duration_s), 'avg_watch_duration_s', lowPlayReason),
    avg_view_proportion_pct: from(cmp && cmp.avg_view_proportion_pct, 'avg_view_proportion_pct', lowPlayReason),
    cover_click_rate_pct: from(cmp && cmp.cover_click_rate_pct, 'cover_click_rate_pct', lowPlayReason),
    follower_play_ratio_pct: from(cmp && cmp.follower_play_ratio_pct, 'follower_play_ratio_pct', lowPlayReason),
    traffic_source: from(source, 'traffic_source'),
    search_keywords: from(search, 'search_keywords'),
    progress_analysis: from(progressValue, 'progress_analysis', progress ? 'no_data' : 'not_exposed'),
    engagement_rates: from(engagement, 'engagement_rates'),
    audience: portrait
      ? { gender: portrait.gender, age: portrait.age, province: portrait.province, city_level: portrait.city_level }
      : from(null, 'audience'),
    hotword: hotword && hotword.status === 'ok'
      ? { source: 'tab', status: 'ok', words: hotword.words }
      : { source: 'tab', status: 'unavailable', words: [] },
    dataGap: Object.keys(gaps).length ? gaps : null,
    // 私有作品不进入库（tools 的 visibility 由服务端结算）：仅作为设备端提示。
    is_private: work.is_private === true,
  }
}

function firstNonNull(...values) {
  for (const value of values) if (value !== null && value !== undefined) return value
  return null
}
