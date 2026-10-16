// 脱敏 fixture 解析回归（结构与类型真实、数值为占位）。
// 插件自带 test/fixtures/ 一份，`.ci` 快照因此不依赖 docker-helm 工作区即可独立回归；
// docs/0909/douyin/fixtures/ 保留人工可读的契约样例，可达时会交叉校验两者一致。
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  LOW_PLAY_STATUS_CODE,
  SESSION_EXPIRED_STATUS_CODE,
  SessionInvalidError,
  buildWorkPayload,
  decidePagination,
  dedupeWorks,
  isSessionExpiredPayload,
  normalizeWork,
  parseItemCompare,
  parseItemMget,
  parseItemPerformance,
  dashboardDay,
  dashboardMetricValue,
  parseDashboardMetrics,
  parseDashboard,
  parseDashboardFans,
  parseFansSummary,
  parseJsonPreservingIds,
  parseItemSummarize,
  parsePlaySource,
  parsePortrait,
  parseProgressAnalysis,
  parseSearchKeywords,
  parseWorkListPage,
  parseWordCloud,
  pct,
  round2,
  toInt,
  toNumber,
} from '../src/parse.js'

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url)
const DOCS_FIXTURE_DIR = new URL('../../../docs/0909/douyin/fixtures/', import.meta.url)

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8'))
}

test('fixture 目录可达（回归基线自检）', async () => {
  const dir = fileURLToPath(FIXTURE_DIR)
  assert.ok(dir.endsWith('dsh-yootun-douyin-operation/test/fixtures/'))
  const page1 = await fixture('work_list.page1.sample.json')
  assert.equal(page1.has_more, true)
})

test('插件 fixture 与 docs 契约样例一致（docs 可达时）', async () => {
  if (!existsSync(DOCS_FIXTURE_DIR)) return
  const names = async dir => (await readdir(dir)).filter(name => name.endsWith('.sample.json')).sort()
  const local = await names(FIXTURE_DIR)
  assert.deepEqual(local, await names(DOCS_FIXTURE_DIR))
  for (const name of local) {
    const [a, b] = await Promise.all([
      readFile(new URL(name, FIXTURE_DIR)),
      readFile(new URL(name, DOCS_FIXTURE_DIR)),
    ])
    assert.ok(a.equals(b), `fixture 与 docs 样例不一致：${name}`)
  }
})

test('比例换算：0..1 → 百分比 2 位小数', () => {
  assert.equal(pct(0.4017), 40.17)
  assert.equal(pct(0.0309), 3.09)
  assert.equal(pct(1), 100)
  assert.equal(pct(null), null)
  assert.equal(pct('x'), null)
})

// 2026-09-11 全面排查加固：tools 侧所有 `*_pct` 字段都有 ge=0 le=100 硬约束，
// 越界值会让整批（≤50 条作品）入库被 VALIDATION_ERROR 一次性拒绝。抖音异常
// 响应给出的比率超出 0..1 定义域时必须落 null（缺口），不能生成越界百分比。
test('pct 定义域守卫：超界/负数比率 → null（记缺口而不是整批被服务端拒绝）', () => {
  assert.equal(pct(1.5), null)
  assert.equal(pct(-0.02), null)
  assert.equal(pct(0), 0)
  assert.equal(pct(-0), 0)
})

test('数值换算不得产生 -0（宿主 snapshotJsonValue 拒绝 -0，整调用进程内失败）', () => {
  // Number('-0')、Math.trunc(-0.2) 在 JS 里都是 -0。
  assert.equal(1 / toNumber('-0'), Infinity, 'toNumber: -0 → 0')
  assert.equal(1 / toInt(-0.2), Infinity, 'toInt: trunc(-0.2) → 0 而不是 -0')
  assert.equal(toInt(-5), -5, '负整数正常保留')
  assert.equal(round2(-0.3), null, '负时长是数据异常 → null（ge=0 约束）')
  assert.equal(round2(1234.567), 1234.57)
})

test('长数字 ID 解析不丢精度（19 位 aweme_id）', () => {
  const raw = '{"aweme_list":[{"aweme_id":7681246740913222722,"desc":"x"}],"has_more":false}'
  const naive = JSON.parse(raw)
  assert.notEqual(String(naive.aweme_list[0].aweme_id), '7681246740913222722', '裸 JSON.parse 会舍入')
  const guarded = parseJsonPreservingIds(raw)
  assert.equal(guarded.aweme_list[0].aweme_id, '7681246740913222722')
})

test('长数字加引号必须是字符串感知的（正文里的数字不能被改写）', () => {
  // 真实响应里作品标题/话题常含数字与逗号：朴素正则会写出嵌套引号并破坏 JSON。
  const withDigitsInText = '{"desc":"内容: 1234567890123456, 继续","has_more":false}'
  const parsedText = parseJsonPreservingIds(withDigitsInText)
  assert.equal(parsedText.desc, '内容: 1234567890123456, 继续')
  // 数组末尾的长数字（后面是 ]）同样要处理
  assert.equal(parseJsonPreservingIds('{"ids":[1234567890123456789]}').ids[0], '1234567890123456789')
  // 非 16 位以上的数字保持数值类型（游标 / 计数）
  assert.equal(parseJsonPreservingIds('{"cursor":1785820989000}').cursor, 1785820989000)
  assert.equal(parseJsonPreservingIds('{"play_count":10847}').play_count, 10847)
  // 转义引号不能破坏字符串状态判定
  assert.equal(parseJsonPreservingIds('{"x":"a\\"1234567890123456,"}').x, 'a"1234567890123456,')
  // 空/非法输入返回 null，不抛错
  assert.equal(parseJsonPreservingIds(''), null)
  assert.equal(parseJsonPreservingIds('{'), null)
})

test('作品列表首页：has_more=true 且游标前进 → 继续翻页', async () => {
  const json = await fixture('work_list.page1.sample.json')
  const page = parseWorkListPage(json)
  assert.equal(page.rawCount, 1)
  assert.equal(page.hasMore, true)
  assert.equal(String(page.nextCursor), '1787000000000')
  const work = page.works[0]
  assert.equal(work.work_id, '7000000000000000001')
  assert.equal(work.title, '示例作品标题 #示例话题')
  assert.equal(work.play_count, 10000)
  assert.equal(work.like_count, 100)
  assert.equal(work.comment_count, 10)
  assert.equal(work.collect_count, 5)
  assert.equal(work.share_count, 3)
  assert.equal(work.duration_s, 60, 'video.duration 毫秒转秒')
  assert.equal(work.cover_url, 'https://example.invalid/cover.jpeg')
  assert.equal(work.url, 'https://www.douyin.com/video/7000000000000000001')
  assert.ok(work.publish_time.startsWith('20'))
  assert.equal(work.is_private, false)

  const decision = decidePagination({ page, cursor: 0, pageNumber: 1, maxPages: 1000 })
  assert.deepEqual(decision, { stop: false, listComplete: false, reason: 'continue' })
})

test('作品列表末页：has_more=false → stop 且完整结束', async () => {
  const json = await fixture('work_list.lastpage.sample.json')
  const page = parseWorkListPage(json)
  assert.equal(page.hasMore, false)
  assert.equal(page.rawCount, 1)
  const decision = decidePagination({ page, cursor: 1785820989000, pageNumber: 3, maxPages: 1000 })
  assert.equal(decision.stop, true)
  assert.equal(decision.listComplete, true)
  assert.equal(decision.reason, 'has_more_false')
})

test('会话失效（HTTP 200 + status_code=8）：列表解析抛 SessionInvalidError，绝不解析成空列表', async () => {
  // 脱敏 fixture：HTTP 200 + status_code=8，无 aweme_list/has_more（真实过期响应形态）。
  const json = await fixture('work_list.status_code_8.sample.json')
  assert.throws(() => parseWorkListPage(json), error => {
    assert.ok(error instanceof SessionInvalidError)
    assert.equal(error.name, 'SessionInvalidError')
    assert.equal(error.code, 'session_invalid')
    assert.equal(error.statusCode, SESSION_EXPIRED_STATUS_CODE)
    return true
  })

  // 兜底形态：带空 aweme_list 的 8 同样必须抛（不能走"0 作品"分支）。
  assert.throws(() => parseWorkListPage({ status_code: 8, aweme_list: [], has_more: false }), SessionInvalidError)

  // 非过期码不抛：0（正常）与字符串形态的 8（防御性归一化）。
  assert.equal(parseWorkListPage({ status_code: 0, aweme_list: [], has_more: false }).rawCount, 0)
  assert.throws(() => parseWorkListPage({ status_code: '8' }), SessionInvalidError)
})

test('isSessionExpiredPayload：仅 status_code=8 命中，缺失/0/null 不误报', () => {
  assert.equal(isSessionExpiredPayload({ status_code: 8 }), true)
  assert.equal(isSessionExpiredPayload({ status_code: 0, aweme_list: [] }), false)
  assert.equal(isSessionExpiredPayload({}), false)
  assert.equal(isSessionExpiredPayload(null), false)
  assert.equal(isSessionExpiredPayload('user not login'), false)
})

test('既有约定回归：item_compare 10001（低播放）与热词非零码不受会话失效改动影响', () => {
  // 10001 仍是低播放语义：不抛错，完播类指标记缺口。
  const compare = parseItemCompare({ status_code: 10001, status_msg: 'view count less than min view count', item: {} })
  assert.equal(compare.statusCode, LOW_PLAY_STATUS_CODE)
  assert.equal(compare.lowPlay, true)
  // 热词 status_code=0 成功、非 0（含 8）→ unavailable 保留旧集合，均不抛 SessionInvalidError。
  assert.equal(parseWordCloud({ status_code: 0, word_cloud_list: [{ word: '路政', rank: 1, score: '2' }] }).status, 'ok')
  const stale = parseWordCloud({ status_code: 8, status_msg: 'user not login' })
  assert.equal(stale.status, 'unavailable')
  assert.equal(stale.statusCode, 8)
})

test('分页不完整判定：has_more + 空列表 / 游标不前进 / 达上限', () => {
  const emptyButMore = { works: [], hasMore: true, nextCursor: 1, rawCount: 0 }
  assert.deepEqual(decidePagination({ page: emptyButMore, cursor: 0, pageNumber: 1, maxPages: 10 }), {
    stop: true, listComplete: false, reason: 'empty_page_with_more',
  })
  const stuck = { works: [{}], hasMore: true, nextCursor: 5, rawCount: 1 }
  assert.deepEqual(decidePagination({ page: stuck, cursor: 5, pageNumber: 1, maxPages: 10 }), {
    stop: true, listComplete: false, reason: 'cursor_not_advancing',
  })
  const missingCursor = { works: [{}], hasMore: true, nextCursor: null, rawCount: 1 }
  assert.equal(decidePagination({ page: missingCursor, cursor: 1, pageNumber: 1, maxPages: 10 }).listComplete, false)
  const advancing = { works: [{}], hasMore: true, nextCursor: 9, rawCount: 1 }
  assert.deepEqual(decidePagination({ page: advancing, cursor: 1, pageNumber: 10, maxPages: 10 }), {
    stop: true, listComplete: false, reason: 'max_pages_reached',
  })
})

test('跨页按 work_id 去重', () => {
  const deduped = dedupeWorks([
    { work_id: 'a' }, { work_id: 'b' }, { work_id: 'a' }, { work_id: null }, { work_id: 'c' },
  ])
  assert.deepEqual(deduped.map(item => item.work_id), ['a', 'b', 'c'])
})

test('批量作品分析 item_performance 解析（2s/5s/平均时长来源）', async () => {
  const json = await fixture('item_analysis.sample.json')
  const map = parseItemPerformance(json)
  const row = map.get('7000000000000000001')
  assert.equal(row.play_count, 10000)
  assert.equal(row.avg_watch_duration_s, 13.46)
  assert.equal(row.completion_rate_5s_pct, 40.17)
  assert.equal(row.bounce_rate_2s_pct, 31.73)
  assert.equal(row.cover_url, 'https://example.invalid/cover.jpeg')
})

test('高播放 item_compare：完播/时长/占比/粉丝播放占比全部可解析', async () => {
  const json = await fixture('item_compare.high.sample.json')
  const parsed = parseItemCompare(json)
  assert.equal(parsed.lowPlay, false)
  assert.equal(parsed.statusCode, 0)
  assert.equal(parsed.metrics.completion_rate_pct, 3.09)
  assert.equal(parsed.metrics.completion_rate_5s_pct, 40.17)
  assert.equal(parsed.metrics.bounce_rate_2s_pct, 31.73)
  assert.equal(parsed.metrics.avg_watch_duration_s, 13.46)
  assert.equal(parsed.metrics.avg_view_proportion_pct, 17.61)
  assert.equal(parsed.metrics.cover_click_rate_pct, 1.23)
  assert.equal(parsed.metrics.follower_play_ratio_pct, 0.53)
  assert.equal(parsed.hasMetrics, true)
  assert.equal(parsed.gapReason, null)
  assert.equal(parsed.engagement_rates.like_rate, 0.91)
  assert.equal(parsed.engagement_rates.favorite_rate, 0.05)
})

test('低播放 item_compare：status_code=10001 不算错误，完播类记缺口', async () => {
  const json = await fixture('item_compare.low.sample.json')
  const parsed = parseItemCompare(json)
  assert.equal(parsed.statusCode, LOW_PLAY_STATUS_CODE)
  assert.equal(parsed.lowPlay, true)
  assert.equal(parsed.hasMetrics, false)
  assert.equal(parsed.gapReason, 'below_min_view')
  assert.equal(parsed.metrics.completion_rate_pct, null)
  assert.equal(parsed.metrics.avg_watch_duration_s, null)
})

test('item_compare：成功但无 metrics → not_exposed，不得误判低播放', () => {
  const parsed = parseItemCompare({ status_code: 0, status_msg: '', item: {} })
  assert.equal(parsed.statusCode, 0)
  assert.equal(parsed.lowPlay, false)
  assert.equal(parsed.hasMetrics, false)
  assert.equal(parsed.gapReason, 'not_exposed')
})

test('item_compare：历史作品数门槛 10005 → 专用缺口原因', () => {
  const parsed = parseItemCompare({
    status_code: 10005,
    status_msg: 'past item count less than min count',
    item: {},
  })
  assert.equal(parsed.statusCode, 10005)
  assert.equal(parsed.lowPlay, false)
  assert.equal(parsed.hasMetrics, false)
  assert.equal(parsed.gapReason, 'past_item_below_min_count')
})

test('流量来源解析：key → 中文标签、按占比降序', async () => {
  const json = await fixture('play_source.sample.json')
  const rows = parsePlaySource(json)
  assert.equal(rows[0].source_key, 'homepage_hot')
  assert.equal(rows[0].source_label, '推荐(首页推荐)')
  assert.equal(rows[0].share_pct, 99.36)
  assert.equal(rows.at(-1).share_pct, 0.07, '末位为占比最低项')
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].share_pct >= row.share_pct))
})

test('流量来源未知 key：source_label 置 null（原始英文只留在 source_key），自带中文 label 优先保留', () => {
  const rows = parsePlaySource({
    play_source: [
      { source_key: 'fresh', value: 0.6 },
      { source_key: 'fresh', source_label: 'fresh', value: 0.3 },
      { source_key: 'follow', source_label: '自定义中文来源', value: 0.1 },
    ],
  })
  assert.equal(rows.length, 3)
  assert.equal(rows[0].source_key, 'fresh')
  assert.equal(rows[0].source_label, null, '未知 key 无 label → null，不透出英文')
  assert.equal(rows[1].source_key, 'fresh')
  assert.equal(rows[1].source_label, null, '未知 key 自带裸枚举 label（等于 key）→ 不可信，置 null')
  assert.equal(rows[2].source_label, '自定义中文来源', '自带非 key 中文 label 优先保留')
  assert.ok(rows[0].share_pct === 60 && rows[1].share_pct === 30 && rows[2].share_pct === 10)
})

test('观众画像解析：性别/年龄/城市级全量、地域取前 8', async () => {
  const json = await fixture('portrait.sample.json')
  const portrait = parsePortrait(json)
  assert.deepEqual(portrait.gender[0], { key: 'male', pct: 92.66 })
  assert.deepEqual(portrait.gender[1], { key: 'female', pct: 7.34 })
  assert.equal(portrait.age[0].key, '41-50')
  assert.equal(portrait.age[0].pct, 34.44)
  assert.equal(portrait.city_level[0].key, '三线')
  assert.equal(portrait.province.length, 2)
})

test('搜索词解析：空数组即无搜索词，字段缺失则为缺口', async () => {
  const json = await fixture('search_keywords.sample.json')
  assert.deepEqual(parseSearchKeywords(json), [])
  assert.equal(parseSearchKeywords({ status_code: 0 }), null, '缺少 show_from → 本次未暴露')
  const rows = parseSearchKeywords({ show_from: [{ keyword: '示例词', percent: 12.5 }] })
  assert.deepEqual(rows, [{ keyword: '示例词', percent: 12.5 }])
})

test('进度分析解析：jump_backward/jump_forward → 拖回/拖前曲线（秒 → 百分比）', async () => {
  const json = await fixture('progress_analysis.sample.json')
  const progress = parseProgressAnalysis(json)
  assert.deepEqual(progress.drag_back_curve, [{ key: '1', value: 1 }, { key: '2', value: 0.8 }])
  assert.deepEqual(progress.drag_forward_curve, [{ key: '1', value: 2 }, { key: '2', value: 1.5 }])
  assert.equal(progress.empty, false)
  // 桩响应（无 jump_* 字段）→ null（缺口），不能伪造成"空曲线已采集"
  assert.equal(parseProgressAnalysis({ status_code: 0, status_msg: '' }), null)
})

test('进度分析解析：端点可达但作品无数据 → empty 标记（与"没取到"区分）', async () => {
  // 真实端点在无数据账号上的响应形状：两条空曲线 + video_data=null。
  const progress = parseProgressAnalysis({ jump_backward: [], jump_forward: [], video_data: null })
  assert.deepEqual(progress.drag_back_curve, [])
  assert.deepEqual(progress.drag_forward_curve, [])
  assert.equal(progress.empty, true)
  // 有 video_data 帧就说明确实有进度数据，不能算空。
  assert.equal(parseProgressAnalysis({ jump_backward: [], jump_forward: [], video_data: { frames: [] } }).empty, false)
})

test('单稿指标解析：按作品 id 建索引，字符串计数 → 整数', async () => {
  const rows = parseItemMget({
    items: [{
      id: '111',
      metrics: {
        danmaku_count: '42',
        view_count: '1772',
        avg_view_second: '6.28',
        completion_rate: '0.3422',
        completion_rate_5s: '0.4591',
        bounce_rate_2s: '0.2924',
        avg_view_proportion: '0.6584',
        cover_click_rate: '0.123',
        fan_view_proportion: '0.021',
      },
    }, { id: '222', metrics: {} }],
  })
  assert.deepEqual(rows.get('111'), {
    danmaku_count: 42,
    play_count: 1772,
    avg_watch_duration_s: 6.28,
    completion_rate_pct: 34.22,
    completion_rate_5s_pct: 45.91,
    bounce_rate_2s_pct: 29.24,
    avg_view_proportion_pct: 65.84,
    cover_click_rate_pct: 12.3,
    follower_play_ratio_pct: 2.1,
  })
  assert.equal(rows.get('222').danmaku_count, null)
  assert.equal(rows.get('333'), undefined, '批量响应里没有本条作品 → 取不到（记缺口），不张冠李戴')
  assert.equal(parseItemMget({ items: [] }).size, 0)
  assert.equal(parseItemMget({}).size, 0)
})

test('作品总览解析：summarize 完播率按作品 id 建索引', () => {
  const rows = parseItemSummarize({
    item_list: [
      { aweme_id: '111', summarize_data: { play_finish_ratio: 0.3422 } },
      { item_id: '222', summarize_data: { play_finish_ratio: '0.1234' } },
      { aweme_id: '333', summarize_data: {} },
      { aweme_id: '444' },
    ],
  })
  // 1015 方案 §2.5：完播率与吸粉量独立判缺——缺失方为 null（列级缺口），不丢行。
  assert.deepEqual(rows.get('111'), { completion_rate_pct: 34.22, fans_gain_count: null })
  assert.deepEqual(rows.get('222'), { completion_rate_pct: 12.34, fans_gain_count: null })
  assert.equal(rows.get('333'), undefined)
  assert.equal(rows.get('444'), undefined)
  assert.equal(parseItemSummarize({}).size, 0)
})

test('作品总览解析：summarize 吸粉量独立判缺（1015 方案 §2.5）', () => {
  const rows = parseItemSummarize({
    item_list: [
      // 只有吸粉量（完播率缺失）：仍建行，完播率为 null。
      { aweme_id: 'aaa', summarize_data: { new_fans_count: 9 } },
      // 两者都有。
      { aweme_id: 'bbb', summarize_data: { play_finish_ratio: 0.5, new_fans_count: 3 } },
      // 负吸粉量视为异常响应 → null（记缺口），不透传负值。
      { aweme_id: 'ccc', summarize_data: { new_fans_count: -2 } },
      // 两者都缺 → 不建行。
      { aweme_id: 'ddd', summarize_data: { home_page_view_count: 6 } },
    ],
  })
  assert.deepEqual(rows.get('aaa'), { completion_rate_pct: null, fans_gain_count: 9 })
  assert.deepEqual(rows.get('bbb'), { completion_rate_pct: 50, fans_gain_count: 3 })
  assert.deepEqual(rows.get('ccc'), { completion_rate_pct: null, fans_gain_count: null })
  assert.equal(rows.get('ddd'), undefined)
})

test('流量来源/画像：期望字段缺失时返回 null（缺口而不是空数据）', async () => {
  assert.equal(parsePlaySource({ status_code: 0 }), null)
  assert.equal(parsePortrait({ status_code: 0, active: true }), null)
  assert.deepEqual(parsePlaySource({ play_source: [] }), [], '空数组是有效数据')
})

test('评论热词解析：成功（含空）与失败严格区分', async () => {
  const json = await fixture('wordCloud.sample.json')
  const ok = parseWordCloud(json)
  assert.equal(ok.status, 'ok')
  assert.equal(ok.words.length, 4)
  assert.deepEqual(ok.words[0], { word: '示例词A', rank: 1, raw_score: '2' })

  // 成功但为空 → 服务端清空当前集合
  assert.deepEqual(parseWordCloud({ status_code: 0, word_cloud_list: [] }), { status: 'ok', statusCode: 0, words: [] })
  // 非零业务码 / 空响应 → 保留旧集合
  assert.equal(parseWordCloud({ status_code: 500, status_msg: 'err' }).status, 'unavailable')
  assert.equal(parseWordCloud({}).status, 'unavailable')
  assert.equal(parseWordCloud(null).status, 'unavailable')
})

test('normalizeWork：create_time 秒 → ISO 时间，private 标记不丢失', () => {
  const work = normalizeWork({
    aweme_id: '1234567890123456789',
    desc: 't',
    create_time: 1787000000,
    statistics: { play_count: 1 },
    video: { duration: 30000 },
    status: { is_private: true },
  })
  assert.equal(work.publish_time, new Date(1787000000 * 1000).toISOString())
  assert.equal(work.duration_s, 30)
  assert.equal(work.is_private, true)
  assert.equal(normalizeWork({}), null)
})

test('buildWorkPayload：合并三路数据并把缺失字段写成 dataGap', async () => {
  const listJson = await fixture('work_list.page1.sample.json')
  const work = parseWorkListPage(listJson).works[0]
  const performance = parseItemPerformance(await fixture('item_analysis.sample.json')).get(work.work_id)
  const compare = parseItemCompare(await fixture('item_compare.high.sample.json'))
  const payload = buildWorkPayload({
    work,
    performance,
    compare,
    source: parsePlaySource(await fixture('play_source.sample.json')),
    portrait: parsePortrait(await fixture('portrait.sample.json')),
    search: parseSearchKeywords(await fixture('search_keywords.sample.json')),
    progress: parseProgressAnalysis(await fixture('progress_analysis.sample.json')),
    mget: parseItemMget({ items: [{ id: work.work_id, metrics: { danmaku_count: '7' } }] }),
    hotword: parseWordCloud(await fixture('wordCloud.sample.json')),
    observedAt: '2026-09-10T00:00:00.000Z',
  })
  assert.equal(payload.work_id, work.work_id)
  assert.equal(payload.completion_rate_pct, 3.09)
  assert.equal(payload.avg_watch_duration_s, 13.46)
  assert.equal(payload.follower_play_ratio_pct, 0.53)
  assert.equal(payload.danmaku_count, 7, '弹幕数取自单稿指标接口（列表 statistics 未暴露）')
  assert.ok(!payload.dataGap || !payload.dataGap.danmaku_count, '指标已取到就不该记缺口')
  assert.deepEqual(payload.progress_analysis.drag_back_curve, [{ key: '1', value: 1 }, { key: '2', value: 0.8 }])
  assert.equal(payload.progress_analysis.empty, undefined, '解析器的 empty 标记不得入库（extra="forbid"）')
  assert.equal(payload.traffic_source[0].source_key, 'homepage_hot')
  assert.equal(payload.audience.gender[0].key, 'male')
  assert.equal(payload.hotword.status, 'ok')
  assert.equal(payload.hotword.source, 'tab')
})

test('buildWorkPayload：低播放作品保留其他字段且缺口原因是 below_min_view', async () => {
  const listJson = await fixture('work_list.lastpage.sample.json')
  const work = parseWorkListPage(listJson).works[0]
  const compare = parseItemCompare(await fixture('item_compare.low.sample.json'))
  const payload = buildWorkPayload({
    work,
    performance: null,
    compare,
    source: parsePlaySource(await fixture('play_source.sample.json')),
    portrait: parsePortrait(await fixture('portrait.sample.json')),
    search: null,
    progress: null,
    hotword: { status: 'unavailable', statusCode: 500, words: [] },
    observedAt: '2026-09-10T00:00:00.000Z',
  })
  assert.equal(payload.completion_rate_pct, null)
  assert.equal(payload.dataGap.completion_rate_pct.reason, 'below_min_view')
  assert.equal(payload.dataGap.search_keywords.reason, 'not_exposed')
  assert.equal(payload.play_count, 1, '列表侧播放量仍然保留')
  assert.equal(payload.hotword.status, 'unavailable', '热词失败保留旧集合由服务端处理')
  assert.ok(payload.traffic_source.length > 0, '低播放不阻塞流量来源')
  assert.ok(payload.audience.gender.length > 0, '低播放不阻塞观众画像')
})

test('buildWorkPayload：单稿通道完全失败 → 缺口原因是 request_failed', async () => {
  const listJson = await fixture('work_list.lastpage.sample.json')
  const work = parseWorkListPage(listJson).works[0]
  const compare = { ...parseItemCompare(null), gapReason: 'request_failed' }
  const payload = buildWorkPayload({
    work,
    performance: null,
    compare,
    source: null,
    portrait: null,
    search: null,
    progress: null,
    hotword: null,
    observedAt: '2026-09-10T00:00:00.000Z',
  })
  assert.equal(payload.completion_rate_pct, null)
  assert.equal(payload.dataGap.completion_rate_pct.reason, 'request_failed')
  assert.equal(payload.dataGap.bounce_rate_2s_pct.reason, 'request_failed')
})

test('buildWorkPayload：item_compare 10005 时用 mget/summarize 补齐红框指标', async () => {
  const listJson = await fixture('work_list.lastpage.sample.json')
  const work = parseWorkListPage(listJson).works[0]
  const compare = parseItemCompare({
    status_code: 10005,
    status_msg: 'past item count less than min count',
    item: {},
  })
  const mget = parseItemMget({
    items: [{
      id: work.work_id,
      metrics: {
        bounce_rate_2s: '0.292388',
        completion_rate: '0.000001',
        completion_rate_5s: '0.4591',
        avg_view_proportion: '0.65836',
      },
    }],
  })
  const summarize = parseItemSummarize({
    item_list: [{ aweme_id: work.work_id, summarize_data: { play_finish_ratio: 0.342178 } }],
  })
  const payload = buildWorkPayload({
    work,
    performance: null,
    compare,
    source: null,
    portrait: null,
    search: null,
    progress: null,
    mget,
    summarize,
    hotword: null,
    observedAt: '2026-09-30T00:00:00.000Z',
  })
  assert.equal(payload.completion_rate_pct, 34.22, '完播率优先用 summarize 展示口径')
  assert.equal(payload.bounce_rate_2s_pct, 29.24)
  assert.equal(payload.avg_view_proportion_pct, 65.84)
  assert.ok(!payload.dataGap?.completion_rate_pct)
  assert.ok(!payload.dataGap?.bounce_rate_2s_pct)
  assert.ok(!payload.dataGap?.avg_view_proportion_pct)
})

test('buildWorkPayload：进度分析取到但为空 → no_data，未取到 → not_exposed', async () => {
  const listJson = await fixture('work_list.page1.sample.json')
  const work = parseWorkListPage(listJson).works[0]
  const base = { work, performance: null, compare: null, source: null, portrait: null, search: null, hotword: null, observedAt: '2026-09-10T00:00:00.000Z' }

  // 端点可达、契约正确、但该作品确实没有进度数据。
  const empty = buildWorkPayload({ ...base, progress: parseProgressAnalysis({ jump_backward: [], jump_forward: [], video_data: null }) })
  assert.equal(empty.progress_analysis, null)
  assert.equal(empty.dataGap.progress_analysis.reason, 'no_data')

  // 完全没取到（请求失败/未拦截）→ 仍是未暴露，不能与"确认无数据"混为一谈。
  const missing = buildWorkPayload({ ...base, progress: null })
  assert.equal(missing.dataGap.progress_analysis.reason, 'not_exposed')
})

// ---------------------------------------------------------------------------
// 账号大盘 / 粉丝画像解析回归（1015 方案 §6.2；fixture：test/fixtures/1015/）
// ---------------------------------------------------------------------------

const FIXTURE_DIR_1015 = new URL('./fixtures/1015/', import.meta.url)
const DOCS_FIXTURE_DIR_1015 = new URL('../../../docs/1015/douyin/fixtures/', import.meta.url)

async function fixture1015(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIR_1015), 'utf8'))
}

test('1015 fixture 与 docs 契约样例一致（docs 可达时）', async () => {
  if (!existsSync(DOCS_FIXTURE_DIR_1015)) return
  const names = [
    'dashboard.sample.json',
    'dashboard.recent30.sample.json',
    'dashboard.recent90.degraded.sample.json',
    'dashboard.partial_metrics.sample.json',
    'dashboard.session_code_8.sample.json',
    'dashboard_fans.sample.json',
    'dashboard_fans.recent90.error.sample.json',
    'fans_summary.sample.json',
    'item_summarize.sample.json',
    'work_list.cover.sample.json',
    'work_list.private_item.sample.json',
    'mcp_account_overview.sample.json',
    'mcp_work_detail.sample.json',
  ]
  for (const name of names) {
    const [a, b] = await Promise.all([
      readFile(new URL(name, FIXTURE_DIR_1015)),
      readFile(new URL(name, DOCS_FIXTURE_DIR_1015)),
    ])
    assert.ok(a.equals(b), `1015 fixture 与 docs 样例不一致：${name}`)
  }
})

test('parseDashboard：13 指标 × 日度 trends → 按日合并行（比率 ×100）', async () => {
  const json = await fixture1015('dashboard.sample.json')
  const rows = parseDashboard(json)
  assert.ok(Array.isArray(rows) && rows.length >= 1)
  const first = rows[0]
  assert.equal(first.day, '2026-10-01')
  assert.equal(first.play_cnt, 7407)
  assert.equal(first.share_cnt, rows[0].share_cnt)
  // 比率指标 ×100（fixture cover_click_ratio 为 0..1 原值占位）。
  const ratioRow = rows.find(row => row.cover_click_ratio_pct !== undefined)
  assert.ok(ratioRow, '比率列存在')
  assert.ok(ratioRow.cover_click_ratio_pct > 0 && ratioRow.cover_click_ratio_pct <= 100)
  // 同构校验：所有行都带 play_cnt；平均播放时长为秒（不 ×100）。
  for (const row of rows) {
    assert.equal(typeof row.play_cnt, 'number')
    if (row.avg_view_second !== undefined) assert.ok(row.avg_view_second < 3600)
  }
})

test('parseDashboard：回填窗口（recent30）与部分指标缺省', async () => {
  const recent30 = await fixture1015('dashboard.recent30.sample.json')
  const rows30 = parseDashboard(recent30)
  // fixture 为占位形态（play_cnt 单指标 × 2 个日度点）：行数 = trends 点数，
  // 语义验证"窗口内每日一行"而非 30 天满量。
  assert.equal(rows30.length, 2)
  assert.equal(rows30[0].day, '2026-09-15')
  assert.ok(rows30.every(row => typeof row.play_cnt === 'number'))

  const partial = await fixture1015('dashboard.partial_metrics.sample.json')
  const rowsPartial = parseDashboard(partial)
  assert.ok(rowsPartial.length >= 1)
  // 缺失 metric 整组缺省：出现的行只含实际返回的指标列，绝不造 0。
  for (const row of rowsPartial) {
    for (const [key, value] of Object.entries(row)) {
      if (key !== 'day') assert.notEqual(value, 0, `${key} 缺省不得伪造 0`)
    }
  }
})

test('parseDashboard：90 降级形态（仅 1 指标）与会话失效（status_code=8）', async () => {
  const degraded = await fixture1015('dashboard.recent90.degraded.sample.json')
  const rows = parseDashboard(degraded)
  assert.ok(rows.length >= 1)
  const keys = new Set(rows.flatMap(row => Object.keys(row).filter(key => key !== 'day')))
  assert.ok(keys.size <= 2, `降级形态只有极少数指标：${[...keys].join(',')}`)

  const expired = await fixture1015('dashboard.session_code_8.sample.json')
  assert.throws(() => parseDashboard(expired), SessionInvalidError)
})

test('parseDashboardFans：6 粉丝指标与 status_code=5 拒绝（非会话失效）', async () => {
  const fans = await fixture1015('dashboard_fans.sample.json')
  const rows = parseDashboardFans(fans)
  assert.ok(rows.length >= 1)
  const names = new Set(rows.flatMap(row => Object.keys(row).filter(key => key !== 'day')))
  for (const expected of ['net_fans_cnt', 'total_fans_cnt', 'new_fans_cnt', 'home_view_fans_cnt']) {
    assert.ok(names.has(expected), `粉丝指标 ${expected} 应存在`)
  }

  // 90 天请求 status_code=5 拒绝：不是会话失效，解析为空行（由采集层记 gap）。
  const rejected = await fixture1015('dashboard_fans.recent90.error.sample.json')
  const rejectedRows = parseDashboardFans(rejected)
  assert.ok(Array.isArray(rejectedRows))
})

test('parseFansSummary：六类分布 + 隐私榜单物理剔除', async () => {
  const json = await fixture1015('fans_summary.sample.json')
  const profile = parseFansSummary(json)
  assert.ok(profile && typeof profile === 'object')
  assert.deepEqual(profile.age_distribution?.[0], { label: '<23', count: 11 })
  // 性别 label 英文原值透出（中文转换属 UI 层职责）。
  assert.equal(profile.device_distribution === null || Array.isArray(profile.device_distribution), true)
  const keys = Object.keys(profile)
  assert.deepEqual(keys.sort(), [
    'active_levels',
    'active_time_range',
    'age_distribution',
    'city_distribution',
    'device_distribution',
    'interest_distribution',
  ].sort())
  // 隐私边界：输出物理上不含任何榜单/涨粉来源/趋势键。
  const serialized = JSON.stringify(profile)
  for (const forbidden of ['billboard', 'sec_uid', 'from_label', 'trend']) {
    assert.ok(!serialized.includes(forbidden), `隐私边界：输出不得含 ${forbidden}`)
  }
})

test('parseFansSummary：空画像返回 null（缺口而不是空对象）', () => {
  assert.equal(parseFansSummary({ status_code: 0 }), null)
  assert.equal(parseFansSummary({}), null)
})

test('normalizeWork：大写 Cover 键兼容（1015 §2.4 页面 Web 模式实测）', async () => {
  const json = await fixture1015('work_list.cover.sample.json')
  const data = json.data || json
  const aweme = (data.aweme_list || data.items || [])[0]
  const work = normalizeWork(aweme)
  assert.equal(work.cover_url, 'https://p-sign.douyinpic.com/example~tplv.webp')
  assert.equal(work.work_id, '7696000000000000001', '19 位 id 文本保护')
  assert.equal(work.is_private, false)
  // 私密作品样本：is_private=true 且计数缺失。
  const priv = await fixture1015('work_list.private_item.sample.json')
  const privData = priv.data || priv
  const privAweme = (privData.aweme_list || privData.items || [])[0]
  const privWork = normalizeWork(privAweme)
  assert.equal(privWork.is_private, true)
})

test('buildWorkPayload：封面与吸粉量透传 + 缺失记 gap', () => {
  const base = {
    work_id: 'w1',
    title: '示例',
    url: 'https://www.douyin.com/video/w1',
    publish_time: '2026-10-01T00:00:00.000Z',
    cover_url: 'https://cdn.example/c.webp',
    play_count: 100,
  }
  const summarize = new Map([['w1', { completion_rate_pct: 12.09, fans_gain_count: 9 }]])
  const at = '2026-10-15T00:00:00.000Z'
  const payload = buildWorkPayload({
    work: base, performance: null, compare: null, source: null, portrait: null,
    search: null, progress: null, mget: null, summarize, hotword: null, observedAt: at,
  })
  assert.equal(payload.cover_url, 'https://cdn.example/c.webp')
  assert.equal(payload.fans_gain_count, 9)
  const missing = buildWorkPayload({
    work: { ...base, cover_url: null }, performance: null, compare: null, source: null,
    portrait: null, search: null, progress: null, mget: null, summarize: null, hotword: null, observedAt: at,
  })
  assert.equal(missing.cover_url, null)
  assert.equal(missing.fans_gain_count, null)
  assert.equal(missing.dataGap.cover_url.reason, 'not_exposed')
  assert.equal(missing.dataGap.fans_gain_count.reason, 'not_exposed')
})

test('dashboardDay：round-trip 校验拒绝 roll-over 日期（1015 review P1）', () => {
  assert.equal(dashboardDay('20261008'), '2026-10-08')
  assert.equal(dashboardDay('20260230'), null, '2 月 30 日是 roll-over 不是 NaN')
  assert.equal(dashboardDay('20261301'), null, '13 月')
  assert.equal(dashboardDay('20260431'), null, '4 月 31 日')
  assert.equal(dashboardDay('2026-10-08'), null, '非紧凑格式')
  assert.equal(dashboardDay(''), null)
  assert.equal(dashboardDay(null), null)
})

test('dashboardMetricValue：计数列值域守卫（畸形值列缺省，不透传拒批）', () => {
  // 计数列 ge=0：负值 → undefined。
  assert.equal(dashboardMetricValue('play_cnt', -5), undefined)
  assert.equal(dashboardMetricValue('play_cnt', 0), 0, '0 是真实值')
  assert.equal(dashboardMetricValue('play_cnt', 83443), 83443)
  // net_fans_cnt 可负但限 64 位。
  assert.equal(dashboardMetricValue('net_fans_cnt', -3), -3)
  assert.equal(dashboardMetricValue('net_fans_cnt', -(2 ** 64)), undefined, '超安全整数下界')
  // 超安全整数上界（float64 精度不可信）/ 非有限 / 缺失 → undefined。
  assert.equal(dashboardMetricValue('play_cnt', Number.MAX_SAFE_INTEGER + 2), undefined)
  assert.equal(dashboardMetricValue('play_cnt', 'abc'), undefined)
  assert.equal(dashboardMetricValue('play_cnt', null), undefined)
  // avg_view_second 非负秒（2 位小数）。
  assert.equal(dashboardMetricValue('avg_view_second', 12.7879), 12.79)
  assert.equal(dashboardMetricValue('avg_view_second', -1), undefined)
})

test('parseDashboardMetrics：畸形行剔除不拒批（值域守卫集成）', () => {
  const json = {
    status_code: 0,
    metrics: [
      {
        english_metric_name: 'play_cnt',
        trends: [
          { date_time: '20261008', value: 100 },
          { date_time: '20261009', value: -50 },
          { date_time: '20260230', value: 200 },
          { date_time: '20261010', value: Number.MAX_SAFE_INTEGER + 2 },
        ],
      },
    ],
  }
  const rows = parseDashboardMetrics(json)
  assert.deepEqual(rows, [{ day: '2026-10-08', play_cnt: 100 }], '畸形日期/负值/超界行级剔除，其余照常入库')
})

test('parseFansSummary：分布条目截断至服务端上限 64', () => {
  const city = Array.from({ length: 70 }, (_, index) => ({ label: `省${index}`, count: index + 1 }))
  const profile = parseFansSummary({ status_code: 0, city_distribution: city })
  assert.equal(profile.city_distribution.length, 64, '超限截断而不是整批被服务端 max_length 拒绝')
  assert.deepEqual(profile.city_distribution[0], { label: '省0', count: 1 })
})
