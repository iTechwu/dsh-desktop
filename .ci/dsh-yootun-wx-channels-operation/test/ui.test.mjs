// UI 纯函数与渲染回归（阶段 3）：摘要卡口径、本地分页/排序筛选、加权完播率、render smoke。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  EMPTY,
  filterWorksByRange,
  fmtPair,
  gapWorkCount,
  normalizeTrafficRows,
  sortWorks,
  summarizeAccountMetrics,
  summarizeFansTrend,
  weightedCompletionRate,
} from '../src/ui-format.js'

const NOW = new Date('2026-11-09T12:00:00+08:00')

function makeWork(overrides = {}) {
  return {
    work_id: 'w1',
    publish_time: '2026-11-08T10:00:00+08:00',
    play_count: 205,
    like_count: 3,
    completion_rate_pct: 8.29,
    data_gap: null,
    ...overrides,
  }
}

test('播放加权完播率：仅双非空作品参与，分母 0 为 null（§9.2 口径）', () => {
  const works = [
    makeWork({ completion_rate_pct: 8.29, play_count: 205 }),
    makeWork({ completion_rate_pct: 4.04, play_count: 297 }),
    makeWork({ completion_rate_pct: null, play_count: 100 }), // 缺失不参与分母
    makeWork({ completion_rate_pct: 10, play_count: null }),
  ]
  const rate = weightedCompletionRate(works)
  const expected = (8.29 * 205 + 4.04 * 297) / (205 + 297)
  assert.equal(rate, Number(expected.toFixed(2)))
  assert.equal(weightedCompletionRate([makeWork({ completion_rate_pct: 10, play_count: null })]), null)
  assert.equal(weightedCompletionRate([]), null)
})

test('缺口作品数：data_gap 非空对象计数', () => {
  const works = [
    makeWork({ data_gap: { like_count: { reason: 'not_exposed' } } }),
    makeWork({ data_gap: {} }),
    makeWork({}),
  ]
  assert.equal(gapWorkCount(works), 1)
})

test('发布时间范围过滤与排序（本地、只基于已入库数据）', () => {
  const works = [
    makeWork({ work_id: 'a', publish_time: '2026-11-08T10:00:00+08:00', play_count: 100 }),
    makeWork({ work_id: 'b', publish_time: '2026-11-01T10:00:00+08:00', play_count: 500 }),
    makeWork({ work_id: 'c', publish_time: '2026-10-20T10:00:00+08:00', play_count: 300 }),
  ]
  assert.equal(filterWorksByRange(works, '7d', NOW).length, 1) // 只有 a
  assert.equal(filterWorksByRange(works, '30d', NOW).length, 3) // 10-20 也在 30 天内
  assert.equal(filterWorksByRange(works, 'all', NOW).length, 3)
  const sorted = sortWorks(works, 'play_count', 'desc')
  assert.deepEqual(sorted.map(work => work.work_id), ['b', 'c', 'a'])
  // 缺失排序值沉底（Demo 语义）。
  const withNull = [...works, makeWork({ work_id: 'd', play_count: null })]
  const desc = sortWorks(withNull, 'play_count', 'desc')
  assert.equal(desc[desc.length - 1].work_id, 'd')
})

test('来源分布规范化：排除 999「全部」，行名取官方名', () => {
  const rows = normalizeTrafficRows({
    window: { startDay: '2026-11-03', endDay: '2026-11-09' },
    rows: [
      { sourceType: 999, sourceKey: 'all', name: '全部', playCount: 500 },
      { sourceType: 4, sourceKey: 'recommend', name: '推荐', playCount: 300 },
      { sourceType: 42, sourceKey: 'unknown_42', name: '其他', playCount: 12 },
    ],
  })
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { name: '推荐', value: 300 })
  assert.deepEqual(rows[1], { name: '其他', value: 12 })
  assert.deepEqual(normalizeTrafficRows(null), [])
})

test('次数/人数组合列：uv 缺失只显示次数，双缺失「—」', () => {
  assert.equal(fmtPair(5, 3), '5 / 3')
  assert.equal(fmtPair(5, null), '5')
  assert.equal(fmtPair(null, 3), EMPTY)
})

test('关注者增长与账号指标摘要（官方口径命名）', () => {
  const fans = summarizeFansTrend({
    totals: { follower_net_count: 7, follower_add_count: 10, follower_reduce_count: 3 },
    follower_total_count: 66,
  })
  assert.deepEqual(fans.map(([label]) => label), ['净增关注', '新增关注', '取消关注', '关注者总数'])
  const metrics = summarizeAccountMetrics({ totals: { daily_play_count: 3384, daily_follow_count: 8 } })
  const labels = metrics.map(([label]) => label)
  assert.ok(labels.includes('转发聊天和朋友圈'))
  assert.ok(labels.includes('关注量'))
})

test('render smoke：构建产物工厂在真 React 下渲染不抛错（含 5 张摘要卡与 15 列表头）', async () => {
  const react = await import('react')
  const React = react.default ?? react
  const { renderToString } = await import('react-dom/server')

  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory = null
  // 产物顶层调用 window.__ModuleLoader__.load({ id, factory })：stub 捕获工厂。
  const windowStub = {
    __ModuleLoader__: {
      load(mod) { factory = mod.factory },
    },
  }
  const requireStub = name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      // 侧栏入口图标/Tooltip 桩：静态渲染仅需可调用元素。
      return {
        IconSparkleRegular: () => null,
        Tooltip: props => props.children,
      }
    }
    throw new Error(`unexpected require: ${name}`)
  }
  // 执行产物：捕获工厂（factory (require) => …，返回 module.exports）。
  new Function('window', source)(windowStub)
  assert.ok(typeof factory === 'function')

  const module_ = factory(requireStub)
  assert.equal(typeof module_.renderWxWorkbench, 'function')

  const noop = async () => ({ accounts: [], works: [] })
  const html = renderToString(module_.renderWxWorkbench({ host: noop }))
  // 关键结构断言（§9.1 布局 + §9.2 摘要卡 + 15 列表头）。
  assert.ok(html.includes('视频号工作台'))
  assert.ok(html.includes('作品数据'))
  assert.ok(html.includes('账号数据'))
  assert.ok(html.includes('按播放加权计算'))
  assert.ok(html.includes('非净关注'))
  assert.ok(html.includes('缺口作品'))
  assert.ok(html.includes('转发聊天和朋友圈'))
  assert.ok(html.includes('加载更多'))
})


test('render smoke（真实形状）：详情弹层含来源/留存/缺口不崩溃，摘要卡取 summaryOverview 与 account.feedCount', async () => {
  const react = await import('react')
  const React = react.default ?? react
  const { renderToString } = await import('react-dom/server')
  const { createElement: h } = React
  const { WorkDetailDialog, WorkSummaryCards } = await import('../src/work-ui.js')

  // review P0-1 复现形状：对象行来源分布 + 百分比留存 + data_gap。
  const work = {
    work_id: 'wx-work-0001',
    title: '示例作品',
    publish_time: '2026-11-08T10:00:00+08:00',
    latest_collected_at: '2026-11-09T11:00:00+08:00',
    play_count: 205,
    like_count: null,
    completion_rate_pct: 8.29,
    avg_play_duration_s: 7.4,
    traffic_source: {
      window: { startDay: '2026-11-03', endDay: '2026-11-09' },
      rows: [
        { sourceType: 999, sourceKey: 'all', name: '全部', playCount: 500 },
        { sourceType: 4, sourceKey: 'recommend', name: '推荐', playCount: 180 },
        { sourceType: 20, sourceKey: 'profile', name: '主页', playCount: 24 },
      ],
    },
    retention_trend: { videoDurationS: 16, maxLostRateSecond: 15, points: [{ second: 3, rate_pct: 71.2 }, { second: 6, rate_pct: 45 }] },
    data_gap: { like_count: { reason: 'not_exposed', at: '2026-11-09T11:00:00+08:00' } },
  }
  const detailHtml = renderToString(h(WorkDetailDialog, {
    work,
    detail: { traffic_source: work.traffic_source, retention_trend: work.retention_trend },
    dailyMetrics: [{ day: '2026-11-08', daily_play_count: 50, daily_like_count: 2 }],
    onClose: () => {},
  }))
  assert.ok(detailHtml.includes('来源分布'), '来源分段缺失')
  assert.ok(detailHtml.includes('推荐'))
  assert.ok(detailHtml.includes('观众留存趋势'))
  assert.ok(detailHtml.includes('71.2%') || detailHtml.includes('71%'), '留存值缺失')
  assert.ok(detailHtml.includes('喜欢 · 本次接口未提供'), '缺口徽标缺失')

  // review P0-3/P0-4：摘要卡从 summaryOverview（固定 7d）与 account.feedCount 取值。
  const summaryCards = renderToString(h(WorkSummaryCards, {
    works: [work],
    summaryOverview: { metrics: { totals: { daily_play_count: 3384, daily_follow_count: 12 } } },
    account: { feedCount: 50 },
  }))
  assert.ok(summaryCards.includes('3,384'), '近7日播放取 summaryOverview 失败')
  assert.ok(summaryCards.includes('50'), '作品总数取 account.feedCount 失败')
  // 加权完播率提示保留（§9.2 规范）。
  assert.ok(summaryCards.includes('按播放加权计算'))
})
