// 采集引擎回归：分页、失败恢复、批量/单稿/热词采集（伪造 page，不触网）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  DEFAULT_PAGE_SIZE,
  DETAIL_TARGETS,
  ITEM_GENRES,
  WORK_LIST_PATH,
  collectAccountWorks,
  collectHotword,
  collectItemAnalysis,
  collectWorkDetail,
  collectWorkList,
  fetchJson,
} from '../src/collector.js'

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
    },
  })
  const detail = await collectWorkDetail(page, '7000000000000000001')
  assert.equal(detail.compare.lowPlay, true)
  assert.equal(detail.compare.lowPlayReason, 'below_min_view')
  assert.ok(detail.source.length, '低播放仍拿到流量来源')
  assert.ok(detail.portrait.gender.length, '低播放仍拿到观众画像')
  assert.equal(detail.mget.get('7000000000000000001').danmaku_count, 15)
  assert.ok(detail.endpointsSeen.includes('mget'), '单稿指标进入 endpointsSeen')
  // 注意 page.calls 也记录 clickByText 的求值（该次 evaluate 的入参是字符串，没有 url）。
  const mgetCall = page.calls.find(call => call.url && call.url.includes('/web/api/creator/item/mget'))
  assert.ok(mgetCall.url.includes('fields=metrics'), '必须带 fields，否则响应不含 metrics')
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

test('fetchJson：HTTP 200 但非 JSON / 非 200 均判为失败', async () => {
  const bad = fakePage({ jsonRoutes: { '/not-json': null } })
  assert.equal((await fetchJson(bad, '/not-json')).ok, false)
  const missing = fakePage({ jsonRoutes: {} })
  const result = await fetchJson(missing, '/unknown')
  assert.equal(result.ok, false)
  assert.equal(result.status, 404)
})
