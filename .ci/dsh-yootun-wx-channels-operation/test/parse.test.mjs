// 解析器回归：fixtures 契约、长数字 ID、分级时间序列校验、画像二次解析。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  CORE_METRICS,
  expectedSeriesLength,
  latestCompletedDay,
  parseAuthData,
  parseDailySeries,
  parseFansPortrait,
  parseFansTrend,
  parseFeedLostRate,
  parseJsonPreservingIds,
  parsePostListItem,
  parsePostListPage,
  shanghaiDayFromTs,
  shanghaiDayStartTs,
} from '../src/parse.js'
import { SessionInvalidError } from '../src/session-errors.js'

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url)
async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIR), 'utf8'))
}

const START_TS = shanghaiDayStartTs('2026-11-08')
const END_TS = shanghaiDayStartTs('2026-11-09')

test('公共时间工具：上海语义日与窗口长度公式（§15.1）', () => {
  assert.equal(shanghaiDayStartTs('2026-11-08'), Math.floor(Date.parse('2026-11-08T00:00:00+08:00') / 1000))
  assert.equal(shanghaiDayFromTs(shanghaiDayStartTs('2026-11-08')), '2026-11-08')
  // 上海 2026-11-10 00:30（UTC 16:30 前一日）时 latestCompletedDay=11-09。
  assert.equal(latestCompletedDay(new Date('2026-11-09T16:30:00Z')), '2026-11-09')
  assert.equal(latestCompletedDay(new Date('2026-11-09T15:59:00Z')), '2026-11-08')
  assert.equal(expectedSeriesLength(START_TS, END_TS), 2)
  assert.equal(expectedSeriesLength(START_TS, START_TS), 1)
})

test('长数字 ID 解析加引号，不发生精度舍入', () => {
  const raw = '{"objectId":123456789012345678,"exportId":"export/x","finderUsername":123456789012345678}'
  const parsed = parseJsonPreservingIds(raw)
  assert.equal(parsed.objectId, '123456789012345678')
  assert.equal(parsed.finderUsername, '123456789012345678')
})

test('auth_data 正常样本：读出 finderUsername 与资料', async () => {
  const profile = parseAuthData(await fixture('auth_data.sample.json'))
  assert.equal(profile.accountId.length > 0, true)
  assert.equal(typeof profile.accountId, 'string')
  assert.ok('fansCount' in profile)
  assert.ok('feedsCount' in profile)
})

test('auth_data 会话失效样本：抛 SessionInvalidError', async () => {
  const payload = await fixture('auth_data.session_invalid.sample.json')
  assert.throws(() => parseAuthData(payload), SessionInvalidError)
})

test('post_list 正常样本：字段映射与 NULL 口径', async () => {
  const page = parsePostListPage(await fixture('statistic_post_list.sample.json'))
  assert.equal(page.works.length, 2)
  assert.equal(page.totalCount, 2)
  const work = page.works[0]
  assert.equal(work.workId, 'wx-work-0001')
  assert.equal(work.playCount, 205)
  assert.equal(work.likeCount, 3)
  assert.equal(work.completionRatePct, 8.29) // fullPlayRate 0.0829 × 100
  assert.equal(work.fastFlipRatePct, 64.09)
  // 未在断言中的可空字段不臆造。
  assert.ok('commentCount' in work)
})

test('post_list partial 样本：缺失字段为 null 不补 0', async () => {
  const page = parsePostListPage(await fixture('statistic_post_list.partial.sample.json'))
  assert.equal(page.works.length > 0, true)
  const work = page.works[0]
  assert.ok(Object.values(work).some(value => value === null))
})

test('post_list cancelFollowCount 字符串数字兼容（fixture 类型形态）', async () => {
  const page = parsePostListPage(await fixture('statistic_post_list.sample.json'))
  // 字符串 '0' 归一化为数字 0（README 类型差异条款）。
  assert.ok(page.works.every(work => typeof work.workId === 'string'))
})

test('post_list 空列表样本：totalCount=0 空态', async () => {
  const page = parsePostListPage(await fixture('statistic_post_list.empty.sample.json'))
  assert.equal(page.totalCount, 0)
  assert.equal(page.works.length, 0)
})

test('feed_aggregate：只取 fansType=1「不限」分组，按日行与来源分布', async () => {
  const payload = await fixture('feed_aggregate.sample.json')
  // fixture 序列为 7 点窗口（2026-11-03..09）。
  const startTs = shanghaiDayStartTs('2026-11-03')
  const endTs = shanghaiDayStartTs('2026-11-09')
  const parsed = parseDailySeries(payload, { startTs, endTs })
  assert.equal(parsed.rows.length, 7)
  assert.equal(parsed.rows[0].day, '2026-11-03')
  assert.ok(Number.isFinite(parsed.rows[0].daily_play_count))
  // 来源分布含 999「全部」与官方映射名。
  const keys = parsed.trafficSource.rows.map(row => row.sourceKey)
  assert.ok(keys.includes('all'))
  assert.ok(parsed.trafficSource.rows.every(row => row.name.length > 0))
})

test('feed_aggregate 基础指标数组长度异常：整窗 TIME_SERIES_LENGTH_MISMATCH', () => {
  const payload = {
    data: {
      dataByFanstype: [
        {
          fansType: 1,
          dataByTabtype: [
            { tabType: 999, data: { browse: ['1'], like: ['1'], comment: ['1'], forward: ['1'], fav: ['1'] } },
          ],
        },
      ],
    },
  }
  // 窗口期望 2 点，数组只有 1 点 → 拒绝。
  assert.throws(() => parseDailySeries(payload, { startTs: START_TS, endTs: END_TS }), /TIME_SERIES_LENGTH_MISMATCH/)
})

test('扩展指标缺失/长度异常：字段级缺口，不拒绝窗口（§15.1.1 分级）', () => {
  const payload = {
    data: {
      dataByFanstype: [
        {
          fansType: 1,
          dataByTabtype: [
            {
              tabType: 999,
              data: {
                browse: ['1', '2'],
                like: ['1', '2'],
                comment: ['0', '0'],
                forward: ['0', '0'],
                fav: ['0', '0'],
                // ringset 缺失 → not_exposed；wecomLinkClick 长度异常 → FIELD_LENGTH_MISMATCH。
                wecomLinkClick: ['1'],
              },
            },
          ],
        },
      ],
    },
  }
  const parsed = parseDailySeries(payload, { startTs: START_TS, endTs: END_TS })
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rows[0].dataGap.daily_ringset_count.reason, 'not_exposed')
  assert.equal(parsed.rows[0].dataGap.daily_wecom_link_click_count.reason, 'FIELD_LENGTH_MISMATCH')
  assert.equal(parsed.rows[0].daily_ringset_count, undefined) // 缺口列不写值（NULL ≠ 0）
})

test('未知 tabType 不并入 0：unknown_{tabType} + 来源缺口', () => {
  const payload = {
    data: {
      dataByFanstype: [
        {
          fansType: 1,
          dataByTabtype: [
            { tabType: 999, data: { browse: ['1', '1'], like: ['0', '0'], comment: ['0', '0'], forward: ['0', '0'], fav: ['0', '0'] } },
            { tabType: 42, data: { browse: ['5', '5'], like: ['0', '0'], comment: ['0', '0'], forward: ['0', '0'], fav: ['0', '0'] } },
          ],
        },
      ],
    },
  }
  const parsed = parseDailySeries(payload, { startTs: START_TS, endTs: END_TS })
  const unknown = parsed.trafficSource.rows.find(row => row.sourceType === 42)
  assert.equal(unknown.sourceKey, 'unknown_42')
  assert.equal(unknown.name, '其他')
  assert.deepEqual(parsed.trafficSource.dataGap.unknown_source_type, [42])
})

test('get_feed_lost_rate：留存点位 rate×100', async () => {
  const parsed = parseFeedLostRate(await fixture('get_feed_lost_rate.sample.json'))
  assert.ok(parsed.points.length > 0)
  assert.ok(parsed.points.every(point => point.ratePct === null || (point.ratePct >= 0 && point.ratePct <= 100)))
})

test('fans_trend：四指标核心校验 + 日期映射 + 跨月窗口', async () => {
  const startTs = shanghaiDayStartTs('2026-10-28')
  const endTs = shanghaiDayStartTs('2026-11-03')
  const payload = await fixture('fans_trend.sample.json')
  const parsed = parseFansTrend(payload, { startTs, endTs })
  assert.equal(parsed.daily.length, 7)
  assert.ok(parsed.daily.every(row => 'follower_net_count' in row))
  // 长度异常 → 整窗拒绝。
  assert.throws(
    () => parseFansTrend(payload, { startTs: startTs - 86400, endTs }),
    /TIME_SERIES_LENGTH_MISMATCH/,
  )
})

test('fans_trend.cross-month：跨月窗口日期映射', async () => {
  const startTs = shanghaiDayStartTs('2026-10-30')
  const endTs = shanghaiDayStartTs('2026-11-02')
  const parsed = parseFansTrend(await fixture('fans_trend.cross-month.sample.json'), { startTs, endTs })
  assert.equal(parsed.daily.length, 4)
  assert.equal(parsed.daily[0].day, '2026-10-30')
  assert.equal(parsed.daily[3].day, '2026-11-02')
})

test('fans_portrait：respJson 二次解析 + 五维 + 未知维度只记缺口', async () => {
  const parsed = parseFansPortrait(await fixture('fans_portrait.sample.json'))
  const dimensions = ['age', 'gender', 'province', 'city', 'device']
  for (const dimension of dimensions) {
    assert.ok(dimension in parsed)
  }
  assert.ok(parsed.gender === null || Array.isArray(parsed.gender))
})

test('fans_portrait.partial：部分维度缺失保持 null', async () => {
  const parsed = parseFansPortrait(await fixture('fans_portrait.partial.sample.json'))
  const present = dimensions().filter(name => parsed[name] !== null)
  assert.ok(present.length < 5)
  assert.ok(present.length >= 1)

  function dimensions() {
    return ['age', 'gender', 'province', 'city', 'device']
  }
})

test('new_post_total_data：与 feed_aggregate 同一解析路径（fansType=1，7 点窗口）', async () => {
  const payload = await fixture('new_post_total_data.sample.json')
  const startTs = shanghaiDayStartTs('2026-11-03')
  const endTs = shanghaiDayStartTs('2026-11-09')
  const parsed = parseDailySeries(payload, { startTs, endTs })
  assert.equal(parsed.rows.length, 7)
  assert.equal(parsed.rows[6].day, '2026-11-09')
  assert.ok(Number.isFinite(parsed.rows[6].daily_play_count))
})
