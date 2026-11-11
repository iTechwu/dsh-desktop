// UI 纯函数与渲染回归（阶段 3）：摘要卡口径、本地分页/排序筛选、加权完播率、render smoke。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  DEFAULT_SORT_STATE,
  EMPTY,
  batchProgressText,
  batchReasonText,
  fmtPair,
  gapWorkCount,
  nextSortState,
  normalizeTrafficRows,
  progressText,
  sortWorks,
  summarizeAccountMetrics,
  summarizeFansTrend,
  weightedCompletionRate,
} from '../src/ui-format.js'

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

test('进度文案：work/batch_done 对齐抖音语义，阶段提示与兜底', () => {
  assert.equal(progressText(null), '采集中…')
  assert.equal(progressText({}), '采集中…')
  assert.equal(progressText({ phase: 'probing' }), '正在检查会话…')
  assert.equal(progressText({ phase: 'list' }), '正在获取作品列表…')
  assert.equal(progressText({ phase: 'list', collected: 160 }), '正在获取作品列表（已收集 160 个）…')
  assert.equal(progressText({ phase: 'work', index: 12, total: 30 }), '采集进度 12/30')
  assert.equal(progressText({ phase: 'account_level' }), '正在采集账号数据…')
  assert.equal(progressText({ phase: 'batch_done', batchNo: 2, totalBatches: 3, succeeded: 40, expected: 45 }), '入库进度 2/3 · 40/45')
  assert.equal(progressText({ phase: 'unknown' }), '采集中…')
})

test('批量总进度行与未完成原因文案（probing/collecting/终态收敛）', () => {
  assert.equal(batchProgressText(null), null)
  assert.equal(batchProgressText({ phase: 'finished', items: [{}, {}] }), null)
  assert.equal(batchProgressText({ phase: 'probing', currentAccountIndex: 1, items: [{}, {}, {}] }), '正在检查会话 2/3')
  assert.equal(batchProgressText({ phase: 'collecting', currentAccountIndex: 0, items: [{}, {}] }), '第 1/2 个账号')
  assert.equal(batchReasonText('session_required'), '会话已过期，请重新扫码')
  assert.equal(batchReasonText('session_expired'), '会话已过期，请重新扫码')
  // 正则匹配保持语义精确，客户端产物不出现 storage_state 连续字面量。
  assert.equal(batchReasonText('storage_state_missing'), '缺少本机登录态，请重新扫码登录')
  assert.equal(batchReasonText('pending_account'), '待升级账号')
  assert.equal(batchReasonText('probe_failed'), '会话检测失败')
  assert.equal(batchReasonText('partial'), '部分作品缺失')
  assert.equal(batchReasonText('SOMETHING_ELSE'), '采集失败')
  assert.equal(batchReasonText(null), '')
})

test('WorkToolbar：运行中在工具栏内渲染进度行（绝不放页面顶部），空闲不渲染', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkToolbar } = await import('../src/work-ui.js')
  const running = renderToString(h(WorkToolbar, {
    onCollect: () => {}, onRefresh: () => {},
    collectDisabled: true, refreshDisabled: false,
    collect: { accountId: 'a1', status: 'running', progress: { phase: 'work', index: 3, total: 10 } },
  }))
  assert.ok(running.includes('采集中…'), '运行中按钮文案缺失')
  assert.ok(running.includes('采集进度 3/10'), '进度文案缺失')
  assert.ok(running.includes('ywc-spinner'), 'spinner 缺失')
  assert.ok(running.includes('aria-busy'), 'aria-busy 缺失')
  assert.ok(running.includes('role="status"'), '进度行 role=status 缺失')
  const idle = renderToString(h(WorkToolbar, { onCollect: () => {}, onRefresh: () => {} }))
  assert.ok(idle.includes('采集本账号全部'))
  assert.ok(!idle.includes('ywc-progress'), '空闲态不得渲染进度行')
})

test('AccountList 批量面板：运行中总进度+当前账号·细粒度+计数；终态未完成明细', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { AccountList } = await import('../src/account-ui.js')
  const base = {
    accounts: [
      { accountId: 'a1', nickname: '账号一', sessionStatus: 'ok', deleteState: 'none' },
      { accountId: 'a2', nickname: '账号二', sessionStatus: 'ok', deleteState: 'none' },
    ],
    selectedId: 'a1', onSelect: () => {}, onProbe: () => {}, onRemove: () => {}, onBeginLogin: () => {},
    onCollectAll: () => {}, busy: false, browserBlocked: false, loginActive: false,
  }
  const running = renderToString(h(AccountList, {
    ...base,
    batch: {
      phase: 'collecting', items: [{ accountId: 'a1' }, { accountId: 'a2' }],
      currentAccountIndex: 1, currentAccountId: 'a2',
      currentProgress: { phase: 'work', index: 5, total: 20 },
      completedCount: 1, failedCount: 0, skippedCount: 0,
    },
  }))
  assert.ok(running.includes('第 2/2 个账号'), '总进度行缺失')
  assert.ok(running.includes('当前账号 账号二'), '当前账号名缺失')
  assert.ok(running.includes('采集进度 5/20'), '细粒度进度缺失')
  assert.ok(running.includes('成功 1 · 失败 0 · 跳过 0'), '实时计数行缺失')
  assert.ok(running.includes('ywc-spinner'), '运行中 spinner 缺失')
  const done = renderToString(h(AccountList, {
    ...base,
    batch: {
      phase: 'finished', items: [
        { accountId: 'a1', status: 'completed' },
        { accountId: 'a2', status: 'skipped', reason: 'session_required' },
      ],
      currentAccountIndex: 1, currentAccountId: null, currentProgress: null,
      summary: { completed: 1, failed: 0, skipped: 1, eligible: 1, status: 'partial' },
      completedCount: 1, failedCount: 0, skippedCount: 1,
    },
  }))
  assert.ok(done.includes('批量结束：成功 1、失败 0、跳过 1'), '终态汇总缺失')
  assert.ok(done.includes('账号二'), '未完成账号名缺失')
  assert.ok(done.includes('会话已过期，请重新扫码'), '未完成原因文案缺失')
})

test('表头排序状态机与排序（本地、只基于已入库数据）', () => {
  const works = [
    makeWork({ work_id: 'a', publish_time: '2026-11-08T10:00:00+08:00', play_count: 100 }),
    makeWork({ work_id: 'b', publish_time: '2026-11-01T10:00:00+08:00', play_count: 500 }),
    makeWork({ work_id: 'c', publish_time: '2026-10-20T10:00:00+08:00', play_count: 300 }),
  ]
  // 三态循环（对齐抖音）：新列 desc → 同列 asc → 回默认态（发布时间降序）。
  assert.deepEqual(nextSortState(DEFAULT_SORT_STATE, 'play_count'), { key: 'play_count', direction: 'desc' })
  assert.deepEqual(nextSortState({ key: 'play_count', direction: 'desc' }, 'play_count'), { key: 'play_count', direction: 'asc' })
  assert.deepEqual(nextSortState({ key: 'play_count', direction: 'asc' }, 'play_count'), DEFAULT_SORT_STATE)
  const sorted = sortWorks(works, { key: 'play_count', direction: 'desc' })
  assert.deepEqual(sorted.map(work => work.work_id), ['b', 'c', 'a'])
  assert.deepEqual(sortWorks(works, { key: 'play_count', direction: 'asc' }).map(work => work.work_id), ['a', 'c', 'b'])
  // 缺失排序值恒沉底，与方向无关（对齐抖音 compareNullableNumbers 语义）。
  const withNull = [...works, makeWork({ work_id: 'd', play_count: null })]
  const desc = sortWorks(withNull, { key: 'play_count', direction: 'desc' })
  assert.equal(desc[desc.length - 1].work_id, 'd')
  const asc = sortWorks(withNull, { key: 'play_count', direction: 'asc' })
  assert.equal(asc[asc.length - 1].work_id, 'd')
  // 默认态即发布时间降序。
  assert.deepEqual(sortWorks(works, DEFAULT_SORT_STATE).map(work => work.work_id), ['a', 'b', 'c'])
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
        IconCloseOutlineRegular: () => null,
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
  // 关键结构断言（§9.1 布局 + §9.2 摘要卡 + 右上角关闭按钮）。
  assert.ok(html.includes('视频号工作台'))
  assert.ok(html.includes('作品数据'))
  assert.ok(html.includes('账号数据'))
  assert.ok(html.includes('按播放加权计算'))
  assert.ok(html.includes('非净关注'))
  assert.ok(html.includes('缺口作品'))
  // 右上角关闭按钮（对齐抖音 ydo-header-buttons）与 Esc 兜底关闭。
  assert.ok(html.includes('关闭视频号工作台'))
  // 空数据不渲染表格框架，只渲染居中空态（对齐抖音 ydo-state）。
  assert.ok(html.includes('当前账号暂无已入库作品'))
  assert.ok(!html.includes('加载更多'))
  // 空闲态不渲染采集进度行（进度行只在工作栏/批量面板运行时出现，不在页面顶部）；
  // 断言 DOM 元素而非类名字符串——内联 STYLES 的规则文本本身含 .ywc-progress。
  assert.ok(!html.includes('class="ywc-spinner"'))
  assert.ok(!html.includes('正在采集'))
  // 二维码占位弹层已移除：点击添加账号直接打开浏览器。
  assert.ok(!html.includes('官方二维码占位'))
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
