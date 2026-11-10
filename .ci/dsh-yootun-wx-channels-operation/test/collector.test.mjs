// 采集引擎回归：全量分页、objectId 去重、超页防御、详情失败隔离、批次切分（伪造 page，不触网）。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  collectWorkList,
  fetchAuthData,
  splitIngestBatches,
  MAX_BATCH_DAILY_ROWS,
  MAX_BATCH_WORKS,
} from '../src/collector.js'
import { SessionInvalidError } from '../src/session-errors.js'


const sleepImmediate = async () => {}

/** 伪造 page：按 URL 匹配返回脚本化响应序列（页面上下文 fetch 不触网）。 */
function fakePage(handlers) {
  return {
    async evaluate(fn, arg) {
      const { url, body } = arg
      for (const handler of handlers) {
        if (url.includes(handler.match)) {
          const response = typeof handler.reply === 'function' ? await handler.reply(body, url) : handler.reply
          return { status: 200, text: JSON.stringify(response) }
        }
      }
      return { status: 404, text: '' }
    },
  }
}

function postListPayload({ items, totalCount }) {
  return {
    errCode: 0,
    errMsg: 'request successful',
    data: { totalCount, list: items },
  }
}

function makeItem(id, createTime = 1780000000) {
  return {
    objectId: id,
    exportId: `export/${id}`,
    createTime,
    desc: {
      description: `描述 ${id}`,
      shortTitle: [{ shortTitle: `作品 ${id}` }],
      media: [{ coverUrl: 'https://example.invalid/c.jpg', videoPlayLen: 16, width: 720, height: 1280, mediaType: 2 }],
    },
    readCount: 100,
    likeCount: 2,
    favCount: 1,
    commentCount: 0,
    forwardCount: 1,
    forwardAggregationCount: 1,
    followCount: 0,
  }
}

test('auth_data 正常：fetchAuthData 读出 finderUsername', async () => {
  const page = fakePage([
    {
      match: 'auth_data',
      reply: { errCode: 0, errMsg: 'ok', data: { finderUser: { finderUsername: 'v2_finder_demo', nickname: '示例', fansCount: 66, feedsCount: 5, isMasterFinder: true } } },
    },
  ])
  const profile = await fetchAuthData(page)
  assert.equal(profile.accountId, 'v2_finder_demo')
  assert.equal(profile.fansCount, 66)
  assert.equal(profile.feedsCount, 5)
})

test('全量分页：totalCount 达标即停、objectId 去重、listComplete=true', async () => {
  const items = Array.from({ length: 30 }, (_, index) => makeItem(`w${String(index + 1).padStart(3, '0')}`))
  const pages = [items.slice(0, 100)]
  const page = fakePage([
    { match: 'statistic/post_list', reply: body => postListPayload({ items: pages[body.currentPage - 1] || [], totalCount: 30 }) },
  ])
  const result = await collectWorkList(page, {
    finderId: 'f1',
    pageSize: 100,
    intervalMs: 0,
    sleep: sleepImmediate,
  })
  assert.equal(result.listComplete, true)
  assert.equal(result.totalCount, 30)
  assert.equal(result.works.length, 30)
  assert.equal(new Set(result.works.map(work => work.workId)).size, 30)
})

test('超页返回首批数据的防御：无新增 objectId 停止翻页（§1.3）', async () => {
  const firstPage = Array.from({ length: 10 }, (_, index) => makeItem(`w${index + 1}`))
  let call = 0
  const page = fakePage([
    {
      match: 'statistic/post_list',
      reply: body => {
        call += 1
        // 官方末页异常行为：第 2 页返回与第 1 页相同的数据（fixture overflow-duplicate 形态）。
        return postListPayload({ items: firstPage, totalCount: 30 })
      },
    },
  ])
  const result = await collectWorkList(page, { finderId: 'f1', pageSize: 10, intervalMs: 0, sleep: sleepImmediate })
  assert.equal(call, 2) // 第 2 页无新增即停
  assert.equal(result.works.length, 10)
  assert.equal(result.listComplete, false)
  // 唯一作品数（10）不足 totalCount（30）→ 统一 LIST_INCOMPLETE（§5.3 规则 6）。
  assert.equal(result.reason, 'LIST_INCOMPLETE')
})

test('唯一作品数不足 totalCount：LIST_INCOMPLETE，绝不按空列表结算', async () => {
  const page = fakePage([
    { match: 'statistic/post_list', reply: body => (body.currentPage === 1
      ? postListPayload({ items: [makeItem('w1'), makeItem('w2')], totalCount: 5 })
      : postListPayload({ items: [], totalCount: 5 })),
    },
  ])
  const result = await collectWorkList(page, { finderId: 'f1', pageSize: 10, intervalMs: 0, sleep: sleepImmediate })
  assert.equal(result.listComplete, false)
  assert.equal(result.reason, 'LIST_INCOMPLETE')
  assert.equal(result.works.length, 2)
})

test('分页请求失败：listComplete=false 不按空列表结算（§8.4）', async () => {
  const page = fakePage([{ match: 'statistic/post_list', reply: { status: 0 } }])
  const result = await collectWorkList(page, { finderId: 'f1', pageSize: 10, retries: 0, sleep: sleepImmediate })
  assert.equal(result.listComplete, false)
  assert.equal(result.works.length, 0)
})

test('会话失效：SessionInvalidError 带出已采集作品（partialListWorks）', async () => {
  let call = 0
  const page = fakePage([
    {
      match: 'statistic/post_list',
      reply: () => {
        call += 1
        if (call === 1) return postListPayload({ items: [makeItem('w1')], totalCount: 3 })
        return { errCode: -1, errMsg: 'not login' }
      },
    },
  ])
  await assert.rejects(
    () => collectWorkList(page, { finderId: 'f1', pageSize: 10, intervalMs: 0, sleep: sleepImmediate }),
    error => error instanceof SessionInvalidError && error.partialListWorks.length === 1,
  )
})

test('批次切分（§15.1.2）：≤20 作品、≤3000 日行、发布日从旧到新、批次号连续', () => {
  const works = []
  for (let index = 0; index < 50; index += 1) {
    works.push({
      workId: `w${index}`,
      publishTime: `2026-1${String(Math.floor(index / 10)).padStart(2, '0')}-1${index % 10}T00:00:00+08:00`,
      dailyMetrics: Array.from({ length: 30 }, (_, day) => ({ day: `2026-11-${String(day + 1).padStart(2, '0')}`, daily_play_count: 1 })),
    })
  }
  const batches = splitIngestBatches(works)
  assert.equal(batches.length, 3) // 50×30=1500 行，20 作品/批 → 3 批
  assert.deepEqual(batches.map(batch => batch.batchNo), [1, 2, 3])
  assert.ok(batches.every(batch => batch.works.length <= MAX_BATCH_WORKS))
  assert.ok(batches.every(batch => batch.totalDailyMetricRows <= MAX_BATCH_DAILY_ROWS))
  // 首批是发布最早的 20 个作品。
  assert.equal(batches[0].works[0].workId, 'w0')
})

test('批次切分：老作品超长序列防御性拆分（>2300 行）', () => {
  const longDaily = Array.from({ length: 2400 }, (_, day) => ({ day: `d${day}`, daily_play_count: 1 }))
  const work = { workId: 'old', publishTime: '2020-08-19T00:00:00+08:00', dailyMetrics: longDaily }
  const batches = splitIngestBatches([work])
  assert.ok(batches.length >= 2)
  assert.ok(batches.every(batch => batch.totalDailyMetricRows <= MAX_BATCH_DAILY_ROWS))
  assert.equal(batches.reduce((sum, batch) => sum + batch.works.reduce((acc, item) => acc + item.dailyMetrics.length, 0), 0), 2400)
})
