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
  buildWorkPayload,
  decidePagination,
  dedupeWorks,
  normalizeWork,
  parseItemCompare,
  parseItemMget,
  parseItemPerformance,
  parseJsonPreservingIds,
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
  assert.equal(parsed.engagement_rates.like_rate, 0.91)
  assert.equal(parsed.engagement_rates.favorite_rate, 0.05)
})

test('低播放 item_compare：status_code=10001 不算错误，完播类记缺口', async () => {
  const json = await fixture('item_compare.low.sample.json')
  const parsed = parseItemCompare(json)
  assert.equal(parsed.statusCode, LOW_PLAY_STATUS_CODE)
  assert.equal(parsed.lowPlay, true)
  assert.equal(parsed.metrics.completion_rate_pct, null)
  assert.equal(parsed.metrics.avg_watch_duration_s, null)
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
  const rows = parseItemMget({ items: [{ id: '111', metrics: { danmaku_count: '42' } }, { id: '222', metrics: {} }] })
  assert.deepEqual(rows.get('111'), { danmaku_count: 42 })
  assert.equal(rows.get('222').danmaku_count, null)
  assert.equal(rows.get('333'), undefined, '批量响应里没有本条作品 → 取不到（记缺口），不张冠李戴')
  assert.equal(parseItemMget({ items: [] }).size, 0)
  assert.equal(parseItemMget({}).size, 0)
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
