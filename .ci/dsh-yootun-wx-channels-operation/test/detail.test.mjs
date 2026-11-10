// 单作品详情回归：180 天块拆分、trafficSource 单块/多块合并、详情失败隔离（伪造 page）。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collectWorkDetail } from '../src/collector.js'

const sleepImmediate = async () => {}

function aggregatePayload(startTs, endTs, sourceTag) {
  // 序列长度严格按请求窗口期望长度生成（§15.1.6 长度公式），不预设——生产侧
  // 块边界由上海日推算决定，mock 必须跟随实际窗口否则长度校验拒绝。
  const days = Math.floor((Number(endTs) - Number(startTs)) / 86400) + 1
  const series = Array.from({ length: days }, () => '1')
  return {
    errCode: 0,
    data: {
      dataByFanstype: [
        {
          fansType: 1,
          dataByTabtype: [
            {
              tabType: 999,
              data: {
                browse: series,
                like: series,
                comment: series,
                forward: series,
                fav: series,
                ringset: ['0'],
                snscover: [],
                statusref: [],
                forwardAggregation: [],
                follow: series,
                wecomLinkClick: [],
                wecomContactAdd: [],
              },
            },
            { tabType: sourceTag, data: { browse: series, like: series, comment: series, forward: series, fav: series, follow: series } },
          ],
        },
      ],
    },
  }
}

/** 顺序队列 mock：聚合请求按收到的 startTs/endTs 生成对应长度序列（不预设块值，
 *  由生产侧上海日推算决定），并记录窗口供块不重叠断言。 */
function fakeDetailPage(blocks, received = []) {
  let aggregateCalls = 0
  return {
    async evaluate(fn, arg) {
      const { url, body } = arg
      if (url.includes('get_feed_lost_rate')) {
        return { status: 200, text: JSON.stringify({ errCode: 0, data: { items: [{ sec: 1, rate: 0.5 }], videoLen: 16, maxLostRateSec: 3 } }) }
      }
      if (url.includes('feed_aggreagate_data_by_tab_type')) {
        const index = aggregateCalls
        aggregateCalls += 1
        const block = blocks[index]
        if (!block) return { status: 500, text: '' }
        const startTs = Number(body.startTs)
        const endTs = Number(body.endTs)
        received.push({ startTs, endTs, days: Math.floor((endTs - startTs) / 86400) + 1 })
        return { status: 200, text: JSON.stringify(aggregatePayload(startTs, endTs, block.sourceTag)) }
      }
      return { status: 404, text: '' }
    },
  }
}

test('详情：近期作品单块，日行数=发布日至今，work.trafficSource 完整窗口', async () => {
  // 发布 15 天前 → 单块（≤180 天）。
  const publish = new Date(Date.now() - 15 * 86400_000).toISOString()
  const work = { workId: 'w1', publishTime: publish, dailyMetrics: [] }
  const received = []
  const result = await collectWorkDetail(fakeDetailPage([{ days: 16, sourceTag: 4 }], received), {
    finderId: 'f1',
    work,
    intervalMs: 0,
    sleep: sleepImmediate,
  })
  // 单块：日行数 == 块窗口期望长度（(endTs-startTs)/86400+1）。
  assert.equal(result.dailyMetrics.length, received[0].days)
  assert.ok(result.trafficSource)
  assert.ok(result.trafficSource.rows.length >= 1)
  assert.equal(result.retentionTrend.points.length, 1)
  // 扩展指标缺口落行级 dataGap。
  assert.ok(result.dailyMetrics[0].dataGap)
})

test('详情：老作品多块拆分（>180 天），块间不重叠且合并来源', async () => {
  // 发布 400 天前 → 3 块（180/180/41 左右）。
  const publish = new Date(Date.now() - 400 * 86400_000).toISOString()
  const work = { workId: 'w2', publishTime: publish, dailyMetrics: [] }
  const received = []
  const result = await collectWorkDetail(fakeDetailPage([
    { days: 180, sourceTag: 4 },
    { days: 180, sourceTag: 4 },
    { days: 41, sourceTag: 4 },
  ], received), { finderId: 'f1', work, intervalMs: 0, sleep: sleepImmediate })
  assert.equal(received.length, 3)
  // 块间相邻不重叠（review P0-3 同类换算回归）。
  for (let index = 1; index < received.length; index += 1) {
    assert.equal(received[index].startTs, received[index - 1].endTs + 86400)
  }
  // 日行总数 = 各块窗口长度之和 = 发布日零点至最新完整日的自然日数（≥400）。
  assert.equal(result.dailyMetrics.length, received.reduce((sum, block) => sum + block.days, 0))
  assert.ok(result.dailyMetrics.length >= 400)
  // work.trafficSource 为合并后完整窗口（rows 按 sourceKey 去重合并）。
  assert.ok(result.trafficSource)
  const all = result.trafficSource.rows.find(row => row.sourceKey === 'all')
  assert.ok(all && all.playCount === result.dailyMetrics.length) // 每天 browse=1 聚合
  // 末日行携带最后一块窗口（日行级来源契约保留）。
  assert.ok(result.dailyMetrics[result.dailyMetrics.length - 1].trafficSource)
})

test('详情：发布时间缺失回退 180 天窗口', async () => {
  const work = { workId: 'w3', publishTime: null, dailyMetrics: [] }
  const result = await collectWorkDetail(fakeDetailPage([{ days: 180, sourceTag: 4 }]), {
    finderId: 'f1',
    work,
    intervalMs: 0,
    sleep: sleepImmediate,
  })
  assert.equal(result.dailyMetrics.length, 180)
})

test('详情：聚合接口失败抛错（调用方记该作品缺口，不入库）', async () => {
  const work = { workId: 'w4', publishTime: '2026-11-08T00:00:00+08:00', dailyMetrics: [] }
  const page = {
    async evaluate(fn, arg) {
      if (arg.url.includes('feed_aggreagate_data_by_tab_type')) return { status: 0, text: '' }
      return { status: 200, text: JSON.stringify({ errCode: 0, data: { items: [] } }) }
    },
  }
  await assert.rejects(
    () => collectWorkDetail(page, { finderId: 'f1', work, retries: 0, sleep: sleepImmediate }),
    /aggregate_request_failed/,
  )
})
