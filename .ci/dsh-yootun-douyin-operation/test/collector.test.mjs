// 采集引擎回归：分页、失败恢复、批量/单稿/热词采集（伪造 page，不触网）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  DEFAULT_PAGE_SIZE,
  DETAIL_TARGETS,
  ITEM_GENRES,
  USER_INFO_PATH,
  WORK_LIST_PATH,
  collectAccountProfile,
  collectAccountWorks,
  collectDashboard,
  collectHotword,
  collectItemAnalysis,
  collectWorkDetail,
  collectWorkList,
  fetchJson,
  MAX_EXPECTED_WORK_COUNT,
} from '../src/collector.js'
import { SessionInvalidError } from '../src/parse.js'

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url)
async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8'))
}

function makeWork(id, overrides = {}) {
  return {
    aweme_id: id,
    desc: `作品 ${id}`,
    create_time: 1787000000,
    statistics: { play_count: 100, digg_count: 1, comment_count: 1, collect_count: 1, share_count: 1 },
    video: { duration: 60000, cover: { url_list: ['https://example.invalid/c.jpeg'] } },
    status: { is_private: false },
    ...overrides,
  }
}

/** 伪造 page：按 URL 路由 evaluate；可注入失败次数、导航失败次数与响应拦截。 */
function fakePage({ jsonRoutes = {}, failTimes = {}, responseRoutes = {}, onGoto = null, gotoFailTimes = 0 } = {}) {
  const calls = []
  const failures = { ...failTimes }
  const listeners = new Set()
  let gotoFailures = gotoFailTimes
  const page = {
    calls,
    gotoCalls: [],
    async evaluate(_fn, arg) {
      const { url, method, body } = arg
      calls.push({ url, method, body })
      const key = Object.keys(jsonRoutes).find(pattern => url.includes(pattern))
      const failKey = Object.keys(failures).find(pattern => url.includes(pattern) && failures[pattern] > 0)
      if (failKey) {
        failures[failKey] -= 1
        return { status: 500, text: '' }
      }
      if (!key) return { status: 404, text: '' }
      const value = typeof jsonRoutes[key] === 'function' ? jsonRoutes[key]({ url, method, body }) : jsonRoutes[key]
      if (value === null) return { status: 0, text: '', error: 'network_error' }
      // 模拟真实链路：文本 → 长数字安全解析
      return { status: 200, text: JSON.stringify(value) }
    },
    async goto(url) {
      page.gotoCalls.push(url)
      if (gotoFailures > 0) {
        // 复刻真机故障：网络抖动 / 客户端路由抢占，都会让 goto 抛错并把页面留在错误页。
        gotoFailures -= 1
        throw new Error('page.goto: Navigation is interrupted by another navigation')
      }
      if (onGoto) onGoto(url)
      for (const listener of listeners) {
        for (const [name, fragment] of Object.entries(responseRoutes)) {
          if (url.includes(fragment)) {
            listener(fakeResponse(name, responseRoutes[name]))
          }
        }
      }
      return { status: 200 }
    },
    on(event, listener) { if (event === 'response') listeners.add(listener) },
    off(event, listener) { if (event === 'response') listeners.delete(listener) },
    async waitForTimeout() {},
  }
  return page
}

function fakeResponse(name, json) {
  return {
    name,
    url: () => `https://creator.douyin.com${DETAIL_TARGETS[name] || name}`,
    text: async () => JSON.stringify(json),
    status: () => 200,
  }
}

async function pagedRoutes({ total = 25 }) {
  const works = Array.from({ length: total }, (_, index) => makeWork(`70000000000000000${String(index).padStart(2, '0')}`))
  const pages = []
  for (let index = 0; index < works.length; index += DEFAULT_PAGE_SIZE) {
    pages.push(works.slice(index, index + DEFAULT_PAGE_SIZE))
  }
  let call = 0
  return {
    routes: {
      [WORK_LIST_PATH]: () => {
        const slice = pages[call] || []
        call += 1
        const isLast = call >= pages.length
        return { status_code: 0, aweme_list: slice, has_more: !isLast, max_cursor: isLast ? 999 : 1000 + call, cursor: isLast ? 999 : 1000 + call }
      },
    },
    total,
  }
}

test('作品列表分页：25 条按 12+12+1 取完，has_more=false 时列表完整', async () => {
  const { routes } = await pagedRoutes({ total: 25 })
  const page = fakePage({ jsonRoutes: routes })
  const seen = []
  const result = await collectWorkList(page, { intervalMs: 0, onPage: info => seen.push(info) })
  assert.equal(result.works.length, 25)
  assert.equal(result.listComplete, true)
  assert.equal(result.reason, 'has_more_false')
  assert.deepEqual(seen.map(item => item.count), [12, 12, 1])
  assert.equal(result.pages.length, 3)
  // 首页游标为 0，且请求参数与 P0 实证一致
  assert.ok(page.calls[0].url.includes('scene=star_atlas'))
  assert.ok(page.calls[0].url.includes('device_platform=android'))
  assert.ok(page.calls[0].url.includes('aid=1128'))
  assert.ok(page.calls[0].url.includes('status=0'))
  assert.ok(page.calls[0].url.includes('count=12'))
  assert.ok(page.calls[0].url.includes('max_cursor=0'))
  assert.ok(page.calls[1].url.includes('max_cursor=1001'))
})

test('作品列表：跨页重复 aweme_id 去重', async () => {
  const duplicate = makeWork('7000000000000000001')
  const page = fakePage({
    jsonRoutes: {
      [WORK_LIST_PATH]: (() => {
        let call = 0
        return () => {
          call += 1
          if (call === 1) return { aweme_list: [duplicate], has_more: true, max_cursor: 1001 }
          return { aweme_list: [duplicate, makeWork('7000000000000000002')], has_more: false, max_cursor: 1001 }
        }
      })(),
    },
  })
  const result = await collectWorkList(page, { intervalMs: 0 })
  assert.deepEqual(result.works.map(item => item.work_id), ['7000000000000000001', '7000000000000000002'])
})

test('作品列表：has_more=true 但空列表 → 判定不完整', async () => {
  const page = fakePage({ jsonRoutes: { [WORK_LIST_PATH]: { aweme_list: [], has_more: true, max_cursor: 5 } } })
  const result = await collectWorkList(page, { intervalMs: 0 })
  assert.equal(result.listComplete, false)
  assert.equal(result.reason, 'empty_page_with_more')
})

test('作品列表：游标不前进 → 判定不完整', async () => {
  const page = fakePage({
    jsonRoutes: { [WORK_LIST_PATH]: { aweme_list: [makeWork('1')], has_more: true, max_cursor: 0 } },
  })
  const result = await collectWorkList(page, { intervalMs: 0 })
  assert.equal(result.listComplete, false)
  assert.equal(result.reason, 'cursor_not_advancing')
})

test('作品列表：达到 max_pages 上限 → 判定不完整', async () => {
  const page = fakePage({
    jsonRoutes: {
      [WORK_LIST_PATH]: (() => {
        let call = 0
        return () => { call += 1; return { aweme_list: [makeWork(`w${call}`)], has_more: true, max_cursor: 100 + call } }
      })(),
    },
  })
  const result = await collectWorkList(page, { intervalMs: 0, maxPages: 3 })
  assert.equal(result.pages.length, 3)
  assert.equal(result.listComplete, false)
  assert.equal(result.reason, 'max_pages_reached')
})

test('作品列表：页请求失败（指数退避后仍失败）→ 不完整，不按空列表结算', async () => {
  const page = fakePage({
    jsonRoutes: { [WORK_LIST_PATH]: { aweme_list: [makeWork('w1')], has_more: true, max_cursor: 7 } },
    failTimes: { [WORK_LIST_PATH]: 99 },
  })
  const result = await collectWorkList(page, { intervalMs: 0, retries: 1 })
  assert.equal(result.works.length, 0)
  assert.equal(result.listComplete, false)
  assert.equal(result.reason, 'page_request_failed')
  assert.equal(page.calls.length, 2, '初次 + 1 次重试')
})

test('作品列表：max_pages 越界拒绝执行', async () => {
  const page = fakePage({})
  await assert.rejects(() => collectWorkList(page, { maxPages: 0 }), /max_pages_out_of_range/)
  await assert.rejects(() => collectWorkList(page, { maxPages: 1001 }), /max_pages_out_of_range/)
})

test('批量分析：请求体包含日期窗口/genres/primary_verticals/metric_type', async () => {
  const page = fakePage({
    jsonRoutes: {
      'item_analysis/involved_vertical': { primary_verticals: ['美妆'] },
      'item_analysis/item_performance': await fixture('item_analysis.sample.json'),
      'item_analysis/overview': { status_code: 0, overview: {} },
    },
  })
  const result = await collectItemAnalysis(page, { days: 30, now: () => new Date('2026-09-10T12:00:00Z') })
  assert.deepEqual(result.primaryVerticals, ['美妆'])
  assert.equal(result.performance.get('7000000000000000001').completion_rate_5s_pct, 40.17)

  const performance = page.calls.find(call => call.url.includes('item_performance'))
  assert.equal(performance.method, 'POST')
  assert.deepEqual(performance.body.genres, ITEM_GENRES)
  assert.deepEqual(performance.body.primary_verticals, ['美妆'])
  assert.equal(performance.body.metric_type, 1)
  assert.match(performance.body.start_date, /^\d{8}$/)
  assert.match(performance.body.end_date, /^\d{8}$/)
})

test('批量分析失败：返回空 Map 且记录错误，不影响后续字段', async () => {
  const page = fakePage({
    jsonRoutes: {
      'item_analysis/involved_vertical': { primary_verticals: [] },
      'item_analysis/item_performance': { status_code: 500 },
      'item_analysis/overview': {},
    },
  })
  const result = await collectItemAnalysis(page, { now: () => new Date('2026-09-10T12:00:00Z') })
  assert.equal(result.performance.size, 0)
  assert.equal(result.performanceError, null, 'HTTP 200 + 业务错误码仍按已响应处理，由解析层记缺口')
})

test('批量分析任一端点命中 status_code=8 → 立即抛 SessionInvalidError', async () => {
  const expiredPayload = { status_code: 8, status_msg: '示例：用户未登录' }
  for (const expiredRoute of [
    'item_analysis/involved_vertical',
    'item_analysis/item_performance',
    'item_analysis/overview',
  ]) {
    const page = fakePage({
      jsonRoutes: {
        'item_analysis/involved_vertical': { primary_verticals: [] },
        'item_analysis/item_performance': await fixture('item_analysis.sample.json'),
        'item_analysis/overview': { status_code: 0, overview: {} },
        [expiredRoute]: expiredPayload,
      },
    })
    await assert.rejects(
      () => collectItemAnalysis(page, { now: () => new Date('2026-09-10T12:00:00Z') }),
      SessionInvalidError,
    )
  }
})

test('账号采集批量分析命中 status_code=8：错误带出已采集列表，不继续假采集', async () => {
  const { routes } = await pagedRoutes({ total: 2 })
  const page = fakePage({
    jsonRoutes: {
      ...routes,
      'item_analysis/involved_vertical': { primary_verticals: [] },
      'item_analysis/item_performance': { status_code: 8, status_msg: '示例：用户未登录' },
      'item_analysis/overview': { status_code: 0, overview: {} },
    },
  })
  let thrown = null
  try {
    await collectAccountWorks(page, { intervalMs: 0, observedAt: '2026-09-15T00:00:00.000Z' })
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof SessionInvalidError)
  assert.equal(thrown.statusCode, 8)
  assert.equal(thrown.partialCollected?.works?.length, 2)
  assert.equal(thrown.partialCollected.listComplete, true)
  assert.equal(thrown.partialCollected.expectedWorkCount, 2)
  assert.equal(thrown.partialCollected.works[0].dataGap.bounce_rate_2s_pct.reason, 'not_exposed')
})

test('单稿详情：响应拦截拿到的数据优先，缺失项用页面内 fetch 兜底', async () => {
  const portrait = await fixture('portrait.sample.json')
  const page = fakePage({
    jsonRoutes: {
      [WORK_LIST_PATH]: {},
      '/data/diagnose/item_compare': await fixture('item_compare.high.sample.json'),
      '/data/item/play/source': await fixture('play_source.sample.json'),
      '/janus/douyin/creator/bff/data/progress/analysis/v2': null, // 模拟兜底请求失败
      '/data/item_analysis/search/keyword': await fixture('search_keywords.sample.json'),
      '/data/fans/item/portrait': portrait,
      '/web/api/creator/item/mget': null, // 单稿指标同样失败
    },
    responseRoutes: { compare: await fixture('item_compare.high.sample.json'), source: await fixture('play_source.sample.json') },
  })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(detail.compare.lowPlay, false)
  assert.equal(detail.compare.metrics.completion_rate_pct, 3.09)
  assert.equal(detail.source[0].source_key, 'homepage_hot')
  assert.ok(detail.endpointsSeen.includes('compare'))
  assert.ok(detail.endpointsSeen.includes('portrait'), '拦截漏取时由页面内 fetch 兜底')
  assert.equal(detail.progress, null, '兜底请求失败 → 保持缺口')
  assert.equal(detail.mget, null, '单稿指标失败 → 保持缺口，不阻塞其余字段')
  assert.equal(detail.portrait.gender[0].key, 'male')
})

test('单稿详情：低播放 item_compare 不抛错，记录 below_min_view', async () => {
  const page = fakePage({
    jsonRoutes: {
      '/data/diagnose/item_compare': await fixture('item_compare.low.sample.json'),
      '/data/item/play/source': await fixture('play_source.sample.json'),
      '/data/fans/item/portrait': await fixture('portrait.sample.json'),
      '/data/item_analysis/search/keyword': await fixture('search_keywords.sample.json'),
      '/janus/douyin/creator/bff/data/progress/analysis/v2': await fixture('progress_analysis.sample.json'),
      '/web/api/creator/item/mget': { items: [{ id: '7000000000000000001', metrics: { danmaku_count: '15' } }] },
      '/data/item/summarize/': { item_list: [] },
    },
  })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(detail.compare.lowPlay, true)
  assert.equal(detail.compare.gapReason, 'below_min_view')
  assert.ok(detail.source.length, '低播放仍拿到流量来源')
  assert.ok(detail.portrait.gender.length, '低播放仍拿到观众画像')
  assert.equal(detail.mget.get('7000000000000000001').danmaku_count, 15)
  assert.ok(detail.endpointsSeen.includes('mget'), '单稿指标进入 endpointsSeen')
  // 注意 page.calls 也记录 clickByText 的求值（该次 evaluate 的入参是字符串，没有 url）。
  const mgetCall = page.calls.find(call => call.url && call.url.includes('/web/api/creator/item/mget'))
  assert.ok(mgetCall.url.includes('fields=metrics'), '必须带 fields，否则响应不含 metrics')
})

test('单稿详情：拦截漏取 item_compare 时由页面内 fetch 兜底', async () => {
  const page = fakePage({
    jsonRoutes: {
      '/data/diagnose/item_compare': await fixture('item_compare.high.sample.json'),
      '/data/item/play/source': await fixture('play_source.sample.json'),
      '/data/fans/item/portrait': await fixture('portrait.sample.json'),
      '/data/item_analysis/search/keyword': await fixture('search_keywords.sample.json'),
      '/janus/douyin/creator/bff/data/progress/analysis/v2': await fixture('progress_analysis.sample.json'),
      '/web/api/creator/item/mget': { items: [] },
      '/data/item/summarize/': { item_list: [] },
    },
  })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(detail.compare.lowPlay, false)
  assert.equal(detail.compare.gapReason, null)
  assert.equal(detail.compare.metrics.completion_rate_pct, 3.09)
  assert.ok(detail.endpointsSeen.includes('compare'), 'compare 必须和其他端点一样参与兜底')
  const compareCall = page.calls.find(call => call.url?.includes('/data/diagnose/item_compare'))
  assert.ok(compareCall, '拦截漏取时必须主动发起同源兜底请求')
  assert.ok(compareCall.url.includes('item_id=7000000000000000001'))
})

test('单稿详情：item_compare 10005 时 mget/summarize 参与兜底', async () => {
  const page = fakePage({
    jsonRoutes: {
      '/data/diagnose/item_compare': {
        status_code: 10005,
        status_msg: 'past item count less than min count',
        item: {},
      },
      '/data/item/play/source': await fixture('play_source.sample.json'),
      '/data/fans/item/portrait': await fixture('portrait.sample.json'),
      '/data/item_analysis/search/keyword': await fixture('search_keywords.sample.json'),
      '/janus/douyin/creator/bff/data/progress/analysis/v2': await fixture('progress_analysis.sample.json'),
      '/web/api/creator/item/mget': {
        items: [{
          id: '7000000000000000001',
          metrics: {
            bounce_rate_2s: '0.292388',
            avg_view_proportion: '0.65836',
          },
        }],
      },
      '/data/item/summarize/': {
        item_list: [{
          aweme_id: '7000000000000000001',
          summarize_data: { play_finish_ratio: 0.342178 },
        }],
      },
    },
  })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(detail.compare.statusCode, 10005)
  assert.equal(detail.compare.gapReason, 'past_item_below_min_count')
  assert.equal(detail.mget.get('7000000000000000001').bounce_rate_2s_pct, 29.24)
  assert.equal(detail.summarize.get('7000000000000000001').completion_rate_pct, 34.22)
  assert.ok(detail.endpointsSeen.includes('mget'))
  assert.ok(detail.endpointsSeen.includes('summarize'))
})

test('单稿详情：拦截与兜底都失败 → request_failed，不误标低播放', async () => {
  const page = fakePage({
    jsonRoutes: {
      '/data/item/play/source': await fixture('play_source.sample.json'),
      '/data/fans/item/portrait': await fixture('portrait.sample.json'),
      '/data/item_analysis/search/keyword': await fixture('search_keywords.sample.json'),
    },
  })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(detail.compare.statusCode, null)
  assert.equal(detail.compare.lowPlay, false)
  assert.equal(detail.compare.gapReason, 'request_failed')
  assert.ok(!detail.endpointsSeen.includes('compare'))
})

test('单稿详情：item_compare 命中 status_code=8 → 立即抛 SessionInvalidError', async () => {
  const page = fakePage({
    jsonRoutes: {
      '/data/diagnose/item_compare': { status_code: 8, status_msg: '示例：用户未登录', item: {} },
      '/data/item/play/source': await fixture('play_source.sample.json'),
    },
  })
  await assert.rejects(() => collectWorkDetail(page, '7000000000000000001'), SessionInvalidError)
})

test('单稿详情：goto 瞬时失败退避重试，不把一次抖动扩散成整轮失败', async () => {
  const page = fakePage({
    jsonRoutes: {
      '/data/diagnose/item_compare': await fixture('item_compare.high.sample.json'),
      '/data/item/play/source': await fixture('play_source.sample.json'),
      '/data/fans/item/portrait': await fixture('portrait.sample.json'),
      '/data/item_analysis/search/keyword': await fixture('search_keywords.sample.json'),
      '/janus/douyin/creator/bff/data/progress/analysis/v2': await fixture('progress_analysis.sample.json'),
    },
    gotoFailTimes: 2,
  })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(page.gotoCalls.length, 3, '两次失败后第三次成功')
  assert.ok(detail.source.length, '重试成功后照常采集')
})

test('单稿详情：goto 持续失败则抛出，由上层记为该作品失败（不静默成功）', async () => {
  const page = fakePage({ gotoFailTimes: 99 })
  await assert.rejects(() => collectWorkDetail(page, '7000000000000000001'), /Navigation is interrupted/)
  assert.equal(page.gotoCalls.length, 3, '重试次数有上限，不无限重试')
})

test('热词：成功/空/失败三态区分', async () => {
  const ok = fakePage({ jsonRoutes: { item: await fixture('wordCloud.sample.json') } })
  const empty = fakePage({ jsonRoutes: { item: { status_code: 0, word_cloud_list: [] } } })
  const failed = fakePage({ jsonRoutes: { item: { status_code: 500, status_msg: 'err' } } })
  const networkError = fakePage({ jsonRoutes: { item: null } })

  assert.equal((await collectHotword(ok, 'w1')).status, 'ok')
  assert.deepEqual((await collectHotword(empty, 'w1')).words, [])
  assert.equal((await collectHotword(empty, 'w1')).status, 'ok')
  assert.equal((await collectHotword(failed, 'w1')).status, 'unavailable')
  assert.equal((await collectHotword(networkError, 'w1')).status, 'unavailable')
  assert.ok(ok.calls[0].url.includes('/aweme/v1/creator/data/item/wordCloud/?item_id=w1&mcn_type=0'))
})

test('账号采集编排：列表 + 批量 + 单稿 + 热词产出可入库载荷', async () => {
  const { routes } = await pagedRoutes({ total: 3 })
  const page = fakePage({
    jsonRoutes: {
      ...routes,
      'item_analysis/involved_vertical': { primary_verticals: [] },
      'item_analysis/item_performance': await fixture('item_analysis.sample.json'),
      'item_analysis/overview': {},
      '/web/api/media/user/info/': { user: { sec_uid: 'acc-1', nickname: '示例账号', follower_count: 290 } },
      '/data/diagnose/item_compare': await fixture('item_compare.high.sample.json'),
      '/data/item/play/source': await fixture('play_source.sample.json'),
      '/data/fans/item/portrait': await fixture('portrait.sample.json'),
      '/data/item_analysis/search/keyword': await fixture('search_keywords.sample.json'),
      '/janus/douyin/creator/bff/data/progress/analysis/v2': await fixture('progress_analysis.sample.json'),
      // 模拟真实接口：响应里的 id 回显请求的 ids（详情页还会带别的字段，此处只留弹幕数）。
      '/web/api/creator/item/mget': ({ url }) => {
        const ids = new URL(url, 'https://creator.douyin.com').searchParams.get('ids')
        return { items: [{ id: ids, metrics: { danmaku_count: '3' } }] }
      },
      'wordCloud': await fixture('wordCloud.sample.json'),
    },
  })
  const progress = []
  const result = await collectAccountWorks(page, {
    intervalMs: 0,
    observedAt: '2026-09-10T00:00:00.000Z',
    onProgress: info => progress.push(info.workId),
  })
  assert.equal(result.expectedWorkCount, 3)
  assert.equal(result.listComplete, true)
  assert.equal(result.works.length, 3)
  assert.equal(result.failures.length, 0)
  assert.equal(result.profile.accountId, 'acc-1')
  assert.equal(progress.length, 3)
  const payload = result.works[0]
  assert.ok(payload.work_id)
  assert.equal(payload.danmaku_count, 3, '单稿指标 → 入库载荷')
  assert.equal(payload.traffic_source[0].source_label, '推荐(首页推荐)')
  assert.equal(payload.hotword.status, 'ok')
  assert.equal(payload.audience.gender[0].key, 'male')
})

test('账号采集：单作品失败记入 failures，不阻塞其余作品', async () => {
  const { routes } = await pagedRoutes({ total: 2 })
  const page = fakePage({
    jsonRoutes: { ...routes, 'item_analysis/involved_vertical': { primary_verticals: [] }, 'item_analysis/item_performance': {}, 'item_analysis/overview': {} },
  })
  // 详情页 goto 抛错 → 该作品失败
  let gotos = 0
  const originalGoto = page.goto
  page.goto = async url => {
    gotos += 1
    if (url.includes('work-detail')) throw new Error('detail_navigation_failed')
    return originalGoto(url)
  }
  const result = await collectAccountWorks(page, { intervalMs: 0 })
  assert.equal(result.works.length, 0)
  assert.equal(result.failures.length, 2)
  assert.ok(result.failures[0].reason)
  assert.ok(gotos >= 3)
})

test('账号采集：作品数超出 expectedWorkCount 上限时提前失败', async () => {
  // tools 侧 schema 上限即 MAX_EXPECTED_WORK_COUNT；超限会在 run_set_list_meta 被
  // 确定性拒绝，因此必须在展开逐稿详情之前就抛错，而不是白跑完全部详情。
  const works = Array.from({ length: MAX_EXPECTED_WORK_COUNT + 1 }, (_, index) => makeWork(`70000000000000${String(index).padStart(4, '0')}`))
  let detailRequests = 0
  const page = fakePage({
    jsonRoutes: {
      [WORK_LIST_PATH]: { status_code: 0, aweme_list: works, has_more: false, max_cursor: 999, cursor: 999 },
    },
  })
  const originalEvaluate = page.evaluate
  page.evaluate = async (fn, arg) => {
    if (String(arg?.url || '').includes('work-detail')) detailRequests += 1
    return originalEvaluate(fn, arg)
  }
  await assert.rejects(
    () => collectAccountWorks(page, { intervalMs: 0 }),
    error => error.message === 'expected_work_count_out_of_range',
  )
  assert.equal(detailRequests, 0, '超限时不得再逐稿打开详情页')
})

test('fetchJson：HTTP 200 但非 JSON / 非 200 均判为失败', async () => {
  const bad = fakePage({ jsonRoutes: { '/not-json': null } })
  assert.equal((await fetchJson(bad, '/not-json')).ok, false)
  const missing = fakePage({ jsonRoutes: {} })
  const result = await fetchJson(missing, '/unknown')
  assert.equal(result.ok, false)
  assert.equal(result.status, 404)
})

// ---------------------------------------------------------------------------
// 会话失效（HTTP 200 + status_code=8，0914 方案 §3.6 前置门禁）
// ---------------------------------------------------------------------------

test('作品列表首页命中 status_code=8：抛 SessionInvalidError，立即中止（不重试、不翻页）', async () => {
  const page = fakePage({
    jsonRoutes: { [WORK_LIST_PATH]: { status_code: 8, status_msg: '示例：用户未登录' } },
  })
  await assert.rejects(() => collectWorkList(page, { retries: 2, intervalMs: 0 }), SessionInvalidError)
  // status_code=8 是业务层失败：不做 HTTP 退避重试，work_list 只应被打过一次。
  assert.equal(page.calls.filter(call => call.url.includes('work_list')).length, 1)
})

test('user/info 命中 status_code=8：collectAccountProfile 抛 SessionInvalidError', async () => {
  const page = fakePage({ jsonRoutes: { [USER_INFO_PATH]: { status_code: 8, status_msg: '示例：用户未登录' } } })
  await assert.rejects(() => collectAccountProfile(page), SessionInvalidError)
  // 正常响应不受影响。
  const ok = fakePage({ jsonRoutes: { [USER_INFO_PATH]: { user: { sec_uid: 'sec-1', nickname: '示例账号', follower_count: 290 } } } })
  const profile = await collectAccountProfile(ok)
  assert.equal(profile.accountId, 'sec-1')
  assert.equal(profile.fanCount, 290)
})

test('user/info 命中 status_code=8：列表成果以正规入库载荷挂在错误上（partialCollected）', async () => {
  const { routes } = await pagedRoutes({ total: 2 })
  const page = fakePage({
    jsonRoutes: { ...routes, [USER_INFO_PATH]: { status_code: 8, status_msg: '示例：用户未登录' } },
  })
  let thrown = null
  try {
    await collectAccountWorks(page, { intervalMs: 0, observedAt: '2026-09-15T00:00:00.000Z' })
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof SessionInvalidError)
  assert.ok(Array.isArray(thrown.partialCollected?.works), '中断前已完成的列表成果必须带出')
  assert.equal(thrown.partialCollected.works.length, 2)
  // 载荷是 buildWorkPayload 正规形态：带全缺口 dataGap，可直接进 ingest_batch。
  const payload = thrown.partialCollected.works[0]
  assert.ok(payload.work_id)
  assert.ok(payload.dataGap, '未采集详情的列表作品必须带 dataGap 缺口标记')
  assert.equal(payload.dataGap.traffic_source.reason, 'not_exposed')
  assert.equal(thrown.partialCollected.expectedWorkCount, 2)
})

test('账号采集编排命中 status_code=8：错误向上传播，绝不结算成"空列表健康完成"', async () => {
  const page = fakePage({
    jsonRoutes: { [WORK_LIST_PATH]: { status_code: 8, status_msg: '示例：用户未登录' } },
  })
  await assert.rejects(() => collectAccountWorks(page, { intervalMs: 0 }), SessionInvalidError)
})

test('作品列表翻页中途 status_code=8：前几页成果挂在 partialListWorks 带出（审查 O5）', async () => {
  let call = 0
  const page = fakePage({
    jsonRoutes: {
      [WORK_LIST_PATH]: () => {
        call += 1
        if (call === 1) return { status_code: 0, aweme_list: [makeWork('7000000000000000001')], has_more: true, max_cursor: 1001, cursor: 1001 }
        return { status_code: 8, status_msg: '示例：用户未登录' }
      },
    },
  })
  let thrown = null
  try {
    await collectWorkList(page, { intervalMs: 0 })
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof SessionInvalidError)
  assert.equal(thrown.partialListWorks?.length, 1, '第 1 页成果必须带出')
  assert.equal(thrown.partialListWorks[0].work_id, '7000000000000000001')
})

test('账号采集编排：翻页中途过期 → partialCollected 携带前几页正规化载荷', async () => {
  let call = 0
  const page = fakePage({
    jsonRoutes: {
      [WORK_LIST_PATH]: () => {
        call += 1
        if (call === 1) return { status_code: 0, aweme_list: [makeWork('7000000000000000001')], has_more: true, max_cursor: 1001, cursor: 1001 }
        return { status_code: 8, status_msg: '示例：用户未登录' }
      },
    },
  })
  let thrown = null
  try {
    await collectAccountWorks(page, { intervalMs: 0, observedAt: '2026-09-15T00:00:00.000Z' })
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof SessionInvalidError)
  assert.equal(thrown.partialCollected?.works?.length, 1)
  assert.ok(thrown.partialCollected.works[0].dataGap, '列表成果正规化为带缺口的入库载荷')
  assert.equal(thrown.partialCollected.expectedWorkCount, 1)
})

// ---------------------------------------------------------------------------
// 账号大盘三连（1015 方案 §6.1）：独立失败不互相阻断、会话失效传播、gap 上报
// ---------------------------------------------------------------------------

const DASH_SAMPLE = {
  status_code: 0,
  metrics: [{ english_metric_name: 'play_cnt', trends: [{ date_time: '20261008', value: 83443 }] }],
}
const FANS_SAMPLE = {
  status_code: 0,
  metrics: [{ english_metric_name: 'net_fans_cnt', trends: [{ date_time: '20261008', value: -3 }] }],
}
const SUMMARY_SAMPLE = {
  status_code: 0,
  active_levels: [{ label: '重度', count: 12 }],
}

test('collectDashboard：三请求全部成功 → rows/profile 齐备且无 gap', async () => {
  const page = fakePage({
    jsonRoutes: {
      'overview/dashboard?recent_days': DASH_SAMPLE,
      'overview/dashboard/fans': FANS_SAMPLE,
      'fans/summary/v2': SUMMARY_SAMPLE,
    },
  })
  const result = await collectDashboard(page)
  assert.equal(result.dashboardRows.length, 1)
  assert.equal(result.dashboardRows[0].play_cnt, 83443)
  assert.equal(result.dashboardFansRows[0].net_fans_cnt, -3)
  assert.deepEqual(result.fansProfile.active_levels, [{ label: '重度', count: 12 }])
  assert.deepEqual(result.gaps, [])
})

// 上海"今天"（数据未出：后台每日 10 点更新前一日数据）。与 collector.dropFuture
// 同一口径（sv-SE 格式 = YYYY-MM-DD），mock 与断言共用同一计算值避免跨日漂移。
const shanghaiToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
const shanghaiDayOffset = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
const compactDay = day => day.replaceAll('-', '')

test('collectDashboard：今天/未来的 trends 占位行整行丢弃，历史行保留（真机 1026：今日点≈累计值被当作当日增量）', async () => {
  const yesterday = shanghaiDayOffset(-1)
  const today = shanghaiToday()
  const page = fakePage({
    jsonRoutes: {
      'overview/dashboard?recent_days': {
        status_code: 0,
        metrics: [{ english_metric_name: 'play_cnt', trends: [
          { date_time: compactDay(yesterday), value: 83443 },
          { date_time: compactDay(today), value: 6330000 },
          { date_time: compactDay(shanghaiDayOffset(1)), value: 9999999 },
        ] }],
      },
      'overview/dashboard/fans': {
        status_code: 0,
        metrics: [{ english_metric_name: 'net_fans_cnt', trends: [{ date_time: compactDay(yesterday), value: -3 }] }],
      },
      'fans/summary/v2': SUMMARY_SAMPLE,
    },
  })
  const result = await collectDashboard(page)
  assert.equal(result.dashboardRows.length, 1, '今天/未来行不进入 daily 载荷')
  assert.equal(result.dashboardRows[0].day, yesterday)
  assert.equal(result.dashboardRows[0].play_cnt, 83443)
  assert.equal(result.dashboardFansRows[0].net_fans_cnt, -3)
  assert.deepEqual(result.gaps, [], '仍有历史行留存时不因丢弃记缺口')
})

test('collectDashboard：响应只有今天/未来行 → 全部丢弃后按 not_exposed 记缺口（不静默吞）', async () => {
  const page = fakePage({
    jsonRoutes: {
      'overview/dashboard?recent_days': {
        status_code: 0,
        metrics: [{ english_metric_name: 'play_cnt', trends: [{ date_time: compactDay(shanghaiToday()), value: 6330000 }] }],
      },
      'overview/dashboard/fans': {
        status_code: 0,
        metrics: [{ english_metric_name: 'net_fans_cnt', trends: [{ date_time: compactDay(shanghaiDayOffset(-1)), value: -3 }] }],
      },
      'fans/summary/v2': SUMMARY_SAMPLE,
    },
  })
  const result = await collectDashboard(page)
  assert.deepEqual(result.dashboardRows, [])
  assert.equal(result.dashboardFansRows.length, 1, 'fans 链路不受 dashboard 丢弃影响')
  assert.deepEqual(result.gaps, [{ source: 'dashboard', reason: 'not_exposed' }])
})

test('collectDashboard：dashboard_fans 只剩今天/未来行 → 同样整行丢弃并记缺口（对称防御）', async () => {
  const page = fakePage({
    jsonRoutes: {
      'overview/dashboard?recent_days': DASH_SAMPLE,
      'overview/dashboard/fans': {
        status_code: 0,
        metrics: [{ english_metric_name: 'net_fans_cnt', trends: [
          { date_time: compactDay(shanghaiToday()), value: 99999 },
          { date_time: compactDay(shanghaiDayOffset(1)), value: 88888 },
        ] }],
      },
      'fans/summary/v2': SUMMARY_SAMPLE,
    },
  })
  const result = await collectDashboard(page)
  assert.equal(result.dashboardRows.length, 1, 'dashboard 历史行不受影响')
  assert.deepEqual(result.dashboardFansRows, [], 'fans 的今天/未来行同样丢弃')
  assert.deepEqual(result.gaps, [{ source: 'dashboard_fans', reason: 'not_exposed' }])
})

test('collectDashboard：任一请求失败只记 gap，不阻断其余两个', async () => {
  const page = fakePage({
    jsonRoutes: {
      // dashboard 持续 500（failTimes 打桩）→ gap；
      'overview/dashboard?recent_days': null,
      'overview/dashboard/fans': FANS_SAMPLE,
      'fans/summary/v2': null,
    },
  })
  const result = await collectDashboard(page)
  assert.deepEqual(result.dashboardRows, [])
  assert.equal(result.dashboardFansRows.length, 1, 'fans 请求不受 dashboard 失败影响')
  assert.equal(result.fansProfile, null)
  const sources = result.gaps.map(gap => gap.source)
  assert.deepEqual(sources.sort(), ['dashboard', 'fans_summary'])
  for (const gap of result.gaps) {
    assert.ok(typeof gap.reason === 'string' && gap.reason.length > 0)
  }
})

test('collectDashboard：解析容错（metrics 非数组 → 空行，零指标不造 0）', async () => {
  const page = fakePage({
    jsonRoutes: {
      'overview/dashboard?recent_days': { status_code: 0, metrics: 'not-an-array' },
      'overview/dashboard/fans': FANS_SAMPLE,
      'fans/summary/v2': SUMMARY_SAMPLE,
    },
  })
  const result = await collectDashboard(page)
  // 低门槛/异常形态解析为空行（缺 metric 整组缺省），不抛错、不造 0；
  // 响应到达但零指标行 → 显式 not_exposed 缺口（不静默吞掉，缺口说明不变量）。
  assert.deepEqual(result.dashboardRows, [])
  assert.equal(result.dashboardFansRows.length, 1)
  assert.deepEqual(result.gaps, [{ source: 'dashboard', reason: 'not_exposed' }])
})

test('collectDashboard：会话失效（status_code=8）立即抛 SessionInvalidError', async () => {
  const expired = { status_code: 8, status_msg: '用户未登录' }
  const page = fakePage({
    jsonRoutes: {
      'overview/dashboard?recent_days': expired,
      'overview/dashboard/fans': FANS_SAMPLE,
      'fans/summary/v2': SUMMARY_SAMPLE,
    },
  })
  await assert.rejects(
    () => collectDashboard(page),
    error => error instanceof SessionInvalidError,
  )
  // 会话失效 fail-fast：后续两个请求不再发起（过期会话继续请求无意义）。
  assert.ok(!page.calls.some(call => call.url.includes('dashboard/fans')))
})

test('collectAccountWorks：作品链路完成后挂 dashboard 结果（缺口收敛为 gaps）', async () => {
  const { routes } = await pagedRoutes({ total: 1 })
  const page = fakePage({
    jsonRoutes: {
      ...routes,
      'item_analysis/involved_vertical': { primary_verticals: [] },
      'item_analysis/item_performance': {},
      'item_analysis/overview': {},
      '/web/api/media/user/info/': { user: { sec_uid: 'acc-dash', nickname: '示例', follower_count: 500 } },
      '/data/diagnose/item_compare': { status_code: 10001 },
      '/data/item/play/source': { play_source: [] },
      '/data/fans/item/portrait': {},
      '/data/item_analysis/search/keyword': {},
      '/janus/douyin/creator/bff/data/progress/analysis/v2': {},
      '/web/api/creator/item/mget': ({ url }) => {
        const ids = new URL(url, 'https://creator.douyin.com').searchParams.get('ids')
        return { items: [{ id: ids, metrics: { danmaku_count: '3' } }] }
      },
      'wordCloud': { status_code: 0, word_cloud_list: [] },
      'overview/dashboard?recent_days': DASH_SAMPLE,
      'overview/dashboard/fans': FANS_SAMPLE,
      'fans/summary/v2': SUMMARY_SAMPLE,
    },
  })
  const collected = await collectAccountWorks(page, { intervalMs: 0 })
  assert.equal(collected.works.length, 1)
  assert.ok(collected.dashboard)
  assert.equal(collected.dashboard.dashboardRows.length, 1)
  assert.deepEqual(collected.dashboard.gaps, [])
  // 作品载荷带封面（列表键）与吸粉量（summarize 未取到 → null + gap）。
  assert.ok(collected.works[0].cover_url || collected.works[0].dataGap?.cover_url)
})

// ---------------------------------------------------------------------------
// 1026 方案：单作品按日累计播放趋势（metrics_trend 主动直取，不进页面拦截）
// ---------------------------------------------------------------------------

const TREND_ROUTE = '/data/item_analysis/metrics_trend'

function trendSample({ extraGroups = true } = {}) {
  const points = [
    { date_time: '2026-10-08 00:00:00', value: '100.000000' },
    { date_time: '2026-10-09 00:00:00', value: '200.000000' },
  ]
  return {
    status_code: 0,
    status_msg: 'success',
    trend_map: {
      view_count: {
        // 真实接口 [0]/[1]/[3] 三组并存，口径必须只取 [0]（新增/累计混拿会错）
        ...(extraGroups ? { '1': [{ date_time: '2026-10-08 00:00:00', value: '4.000000' }] } : {}),
        '0': points,
      },
      subscribe_count: { '0': [{ date_time: '2026-10-08 00:00:00', value: '888.000000' }] },
    },
  }
}

async function detailPageWithTrend(jsonRoutes) {
  return fakePage({
    jsonRoutes: {
      '/data/diagnose/item_compare': await fixture('item_compare.high.sample.json'),
      '/data/item/play/source': await fixture('play_source.sample.json'),
      '/data/fans/item/portrait': await fixture('portrait.sample.json'),
      '/data/item_analysis/search/keyword': await fixture('search_keywords.sample.json'),
      ...jsonRoutes,
    },
  })
}

test('单稿详情：metrics_trend 主动直取（累计/按天口径、只取 view_count[0]），请求参数锁定', async () => {
  const page = await detailPageWithTrend({ [TREND_ROUTE]: trendSample() })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.deepEqual(detail.metricsTrend, [
    { day: '2026-10-08', playCount: 100 },
    { day: '2026-10-09', playCount: 200 },
  ], '字符串 value 取整入库；subscribe_count 与 [1] 组不得串入')
  assert.equal(detail.metricsTrendGap, null)
  const call = page.calls.find(item => item.url?.includes(TREND_ROUTE))
  assert.ok(call, '必须主动发起 metrics_trend 同源请求（页面自发的组合是新增/每小时，口径错误）')
  const url = new URL(call.url, 'https://creator.douyin.com')
  assert.equal(url.searchParams.get('item_id'), '7000000000000000001')
  assert.equal(url.searchParams.get('trend_type'), '2', '累计口径（页面展示默认新增，不能拦）')
  assert.equal(url.searchParams.get('time_unit'), '1', '按天口径')
  assert.equal(url.searchParams.get('metrics'), 'view_count')
  assert.equal(url.searchParams.get('metrics_group'), '0,1,3', 'metrics_group 必填，缺省 status_code=4')
})

test('单稿详情：metrics_trend 今天/未来占位点丢弃，全占位 → null + not_exposed（与 dashboard dropFuture 同口径）', async () => {
  const today = shanghaiToday()
  const tomorrow = shanghaiDayOffset(1)
  const page = await detailPageWithTrend({
    [TREND_ROUTE]: {
      status_code: 0,
      trend_map: { view_count: { '0': [
        { date_time: `${today} 00:00:00`, value: '6330000.000000' },
        { date_time: `${tomorrow} 00:00:00`, value: '9999999.000000' },
      ] } },
    },
  })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(detail.metricsTrend, null, '今日点≈累计量级占位（总览 bug 根因），绝不入库')
  assert.equal(detail.metricsTrendGap, 'not_exposed')
})

test('单稿详情：metrics_trend 请求失败 → request_failed 缺口，不阻塞其余字段', async () => {
  const page = await detailPageWithTrend({ [TREND_ROUTE]: null })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(detail.metricsTrend, null)
  assert.equal(detail.metricsTrendGap, 'request_failed')
  assert.equal(detail.compare.lowPlay, false, '趋势失败不影响 compare 主链路')
  assert.ok(detail.source.length, '其余字段照常返回')
})

test('单稿详情：metrics_trend status_code=8 → SessionInvalidError 传播（与其他端点同会话语义）', async () => {
  const page = await detailPageWithTrend({
    [TREND_ROUTE]: { status_code: 8, status_msg: '示例：用户未登录' },
  })
  await assert.rejects(() => collectWorkDetail(page, '7000000000000000001'), SessionInvalidError)
})
