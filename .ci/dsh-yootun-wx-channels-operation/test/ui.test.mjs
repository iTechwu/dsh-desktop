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
  normalizeProfileRows,
  normalizeTrafficRows,
  progressText,
  safeAvatarSrc,
  safeWorkUrl,
  sortWorks,
  summarizeAccountMetrics,
  summarizeFansTrend,
  weightedCompletionRate,
  workTitle,
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
  // 位置契约（2026-11-11 真机反馈「应该放在采集按钮下方」）：进度行必须是按钮组
  // 之后的兄弟节点，而不是工具栏尾部/页面顶部之外的位置。
  // 运行中按钮文案是「采集中…」，所以按容器类名定位按钮组。
  const buttonGroupIndex = running.indexOf('ywc-toolbar-left')
  const progressIndex = running.indexOf('ywc-progress')
  assert.ok(buttonGroupIndex >= 0 && progressIndex > buttonGroupIndex, '进度行必须在按钮组之后')
})

test('WorkDetailDialog：留存渲染真实百分比；缺失显示「—」不造 0；趋势线缺失断线', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkDetailDialog, recentDays } = await import('../src/work-ui.js')
  // 趋势图 x 轴固定最近 7 个自然日，测试数据必须落在该窗口内。
  const [dayA, dayB, dayC] = recentDays(7).slice(0, 3)
  const work = {
    work_id: 'w-ret',
    description: '留存口径',
    cover_url: null,
    // 发布日设为窗口首日：后续缺失属「发布后未采到」，应断线而非补 0。
    publish_time: `${dayA}T10:00:00+08:00`,
    latest_collected_at: '2026-11-09T11:00:00+08:00',
    play_count: 100,
  }
  const html = renderToString(h(WorkDetailDialog, {
    work,
    detail: {
      // 生产形状：parse 产出 ratePct；缺失率值必须是 null。
      retention_trend: { points: [{ second: 3, ratePct: 71.2 }, { second: 6, ratePct: null }] },
      traffic_source: { rows: [{ sourceKey: 'recommend', name: '推荐', playCount: 173 }] },
    },
    dailyMetrics: [
      { day: dayA, daily_play_count: 10 },
      { day: dayB, daily_play_count: null },
      { day: dayC, daily_play_count: 30 },
    ],
    onClose: () => {},
  }))
  assert.ok(html.includes('71%'), '留存真实值未渲染（键名不匹配会全部 0%）')
  // 精确定位 6s 这一缺失行：值必须是「—」且条形宽度 0%，不能被折算成 0%。
  const missingRow = (html.match(/<div class="ywc-bar-row"><span>6s<\/span>.*?<\/div><\/div><span class="ywc-bar-value">([^<]*)<\/span>/) || [])[1]
  assert.equal(missingRow, '—', '缺失留存值应显示「—」')
  const missingRowHtml = (html.match(/<div class="ywc-bar-row"><span>6s<\/span>.*?<\/div><\/div><span class="ywc-bar-value">/) || [])[0] || ''
  assert.ok(missingRowHtml.includes('width:0%'), '缺失值不得折算 0% 宽度')
  // 缺失日必须断线：播放量路径应出现两段 M（断点后重新起笔）。
  const playPath = (html.match(/d="([^"]*)" stroke="var\(--ywc-brand\)"/) || [])[1] || ''
  assert.ok((playPath.match(/M/g) || []).length >= 2, `缺失日未断线：${playPath}`)
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
  assert.ok(running.includes('成功 1 · 部分完成 0 · 失败 0 · 跳过 0'), '实时计数行缺失')
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
  assert.ok(done.includes('批量结束：成功 1、部分完成 0、失败 0、跳过 1'), '终态汇总缺失')
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

test('render smoke：构建产物工厂在真 React 下渲染不抛错（含 5 张摘要卡与 14 列表头）', async () => {
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
  // 空闲态不渲染采集进度行（进度行只在工具栏按钮下方/批量面板运行时出现，不在页面顶部）；
  // 断言 DOM 元素而非类名字符串——内联 STYLES 的规则文本本身含 .ywc-progress。
  assert.ok(!html.includes('class="ywc-spinner"'))
  assert.ok(!html.includes('正在采集'))
  // 二维码占位弹层已移除：点击添加账号直接打开浏览器。
  assert.ok(!html.includes('官方二维码占位'))

  // 真实数据形态（2026-11-11 作品列表新交互 + 账号 Tab 画像卡片组）：
  const workHtml = renderToString(module_.renderWxWorkbench({
    host: noop,
    initial: {
      accounts: [{ accountId: 'a1', nickname: '账号一', sessionStatus: 'ok', deleteState: 'none' }],
      selectedId: 'a1',
      works: [{
        work_id: 'w1', title: '短标题', description: '发布文案',
        cover_url: 'https://example.invalid/c.jpg', duration_s: 16,
        publish_time: '2026-11-08T10:00:00+08:00', play_count: 205,
      }],
    },
  }))
  assert.ok(workHtml.includes('ywc-cover-img'), '作品封面 img 缺失')
  assert.ok(workHtml.includes('发布文案'), '标题应取发布文案')
  assert.ok(workHtml.includes('双击查看作品详情'), '行双击提示缺失')
  // 账号数据 Tab：画像同屏卡片组（环形图 + 柱状图 + 省市条形）。
  const accountHtml = renderToString(module_.renderWxWorkbench({
    host: noop,
    initial: {
      tab: 'account',
      accounts: [{ accountId: 'a1', nickname: '账号一', sessionStatus: 'ok', deleteState: 'none' }],
      selectedId: 'a1',
      profile: {
        day: '2026-11-10',
        gender: [{ key: '1', count: 30 }, { key: '2', count: 60 }, { key: 'unknow', count: 10 }],
        device: [{ key: '1', count: 80 }, { key: '2', count: 20 }],
        age: [{ key: 'fage_24_30', count: 48 }],
        province: [{ key: '广东省', count: 40 }],
        city: [{ key: '杭州市', count: 15 }],
      },
    },
  }))
  assert.ok(accountHtml.includes('性别分布'), '画像性别卡缺失')
  assert.ok(accountHtml.includes('访问设备分布'), '画像设备卡缺失')
  assert.ok(accountHtml.includes('年龄分布'), '画像年龄卡缺失')
  assert.ok(accountHtml.includes('conic-gradient'), '环形图缺失')
  assert.ok(accountHtml.includes('总人数'), '环形图中心总人数缺失')
  assert.ok(!accountHtml.includes('unknown'), '英文 unknown 不应透出')
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

test('batchReasonText：服务端确定性业务错误给可行动文案（2026-11-11 真机链路排查）', () => {
  assert.equal(batchReasonText('ACCOUNT_NOT_FOUND'), '云端缺少账号记录，请重新扫码登录后重试')
  assert.equal(batchReasonText('WX_TOOL_UNAVAILABLE'), '桌面未接通视频号工具通道，请升级客户端后重试')
  // 既有映射不回归；未知稳定码仍收敛通用文案。
  assert.equal(batchReasonText('session_expired'), '会话已过期，请重新扫码')
  assert.equal(batchReasonText('SOMETHING_ELSE'), '采集失败')
  assert.equal(batchReasonText(''), '')
})

test('workTitle：标题口径与官方后台一致——发布文案优先，回退系统短标题', () => {
  // 官方后台列表显示发布文案（description）；系统短标题（title）只是兜底。
  assert.equal(workTitle({ description: '发布文案', title: '短标题' }), '发布文案')
  assert.equal(workTitle({ description: null, title: '短标题' }), '短标题')
  assert.equal(workTitle({ description: '', title: '短标题' }), '短标题')
  assert.equal(workTitle({ description: null, title: null }), null)
  assert.equal(workTitle(null), null)
  // 纯空白文案不算有效标题，必须回退（否则列表显示空白行）。
  assert.equal(workTitle({ description: '   ', title: '短标题' }), '短标题')
  assert.equal(workTitle({ description: ' \n ', title: '  ' }), null)
})

test('normalizeRetentionPoints：兼容 rate_pct/ratePct，缺失值保留 null 不造 0', async () => {
  const { normalizeRetentionPoints } = await import('../src/ui-format.js')
  // 生产形状：parse 产出 camelCase `ratePct`，服务端原样 JSON 存取。
  assert.deepEqual(
    normalizeRetentionPoints({ points: [{ second: 3, ratePct: 71.2 }, { second: 6, rate_pct: 55.5 }] }),
    [{ s: 3, v: 71 }, { s: 6, v: 56 }],
  )
  // 缺失率值保留 null（渲染「—」），不得折算 0——否则真机留存全显示 0%。
  assert.deepEqual(
    normalizeRetentionPoints({ points: [{ second: 3, ratePct: null }, { second: 6 }] }),
    [{ s: 3, v: null }, { s: 6, v: null }],
  )
  assert.deepEqual(normalizeRetentionPoints(null), [])
})

test('normalizeTrafficRows：播放量缺失保留 null，不折算 0', async () => {
  const { normalizeTrafficRows } = await import('../src/ui-format.js')
  const rows = normalizeTrafficRows({ rows: [
    { sourceKey: 'recommend', name: '推荐', playCount: 173 },
    { sourceKey: 'share', name: '分享', playCount: null },
    { sourceType: 999, name: '全部', playCount: 999 },
  ] })
  assert.deepEqual(rows, [{ name: '推荐', value: 173 }, { name: '分享', value: null }])
})

test('normalizeProfileRows：age/device 的 unknow 显示「未知」，年龄标签去前导零', async () => {
  assert.deepEqual(normalizeProfileRows([
    { key: 'fage_01_17', count: 3 },
    { key: 'fage_50_+', count: 3 },
    { key: 'unknow', count: 2 },
  ], 'age'), [['1-17岁', 3], ['50岁+', 3], ['未知', 2]])
  // 设备编码按官方后台口径：1=iOS、2=安卓（2026-11-11 真机比例交叉验证）。
  assert.deepEqual(normalizeProfileRows([
    { key: '1', count: 58 },
    { key: '2', count: 10 },
    { key: 'unknow', count: 2 },
  ], 'device'), [['iOS', 58], ['安卓', 10], ['未知', 2]])
  // 省份/城市等无标签映射的维度同样不得透出 unknow。
  assert.deepEqual(normalizeProfileRows([
    { key: '示例省一', count: 31 },
    { key: 'unknow', count: 2 },
  ], 'province'), [['示例省一', 31], ['未知', 2]])
})

test('safeWorkUrl：仅视频号官方域 + http(s)，其余按纯文本展示', () => {
  assert.equal(safeWorkUrl('https://channels.weixin.qq.com/m/video/x'), 'https://channels.weixin.qq.com/m/video/x')
  assert.equal(safeWorkUrl('https://weixin.qq.com/sph/AbCdEf'), 'https://weixin.qq.com/sph/AbCdEf')
  assert.equal(safeWorkUrl('javascript:alert(1)'), null)
  assert.equal(safeWorkUrl('https://evil.example.com/sph/x'), null)
  assert.equal(safeWorkUrl('not-a-url'), null)
  assert.equal(safeWorkUrl(null), null)
  assert.equal(safeWorkUrl(123), null)
})

test('safeAvatarSrc：封面 URL 仅 http(s)', () => {
  assert.equal(safeAvatarSrc('https://wxlogo.example.com/c.jpg'), 'https://wxlogo.example.com/c.jpg')
  assert.equal(safeAvatarSrc('data:image/png;base64,xxx'), null)
  assert.equal(safeAvatarSrc(''), null)
})

test('normalizeProfileRows：unknown 两种拼写统一映射「未知」，不向用户透出英文码', () => {
  const rows = normalizeProfileRows([
    { key: '1', count: 30 },
    { key: '2', count: 60 },
    { key: 'unknow', count: 10 },
    { key: '@_all', count: 100 },
  ], 'gender')
  assert.deepEqual(rows, [['男', 30], ['女', 60], ['未知', 10]])
})

test('WorkTable（2026-11-11 真机反馈）：无操作列/无 ID 副行、双击行开详情、封面 img、标题取发布文案', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkTable } = await import('../src/work-ui.js')
  const html = renderToString(h(WorkTable, {
    rows: [{
      work_id: '15050379357367110280',
      title: '系统短标题',
      description: '官方发布文案',
      cover_url: 'https://example.invalid/c.jpg',
      duration_s: 16,
      publish_time: '2026-11-08T10:00:00+08:00',
      play_count: 205,
      latest_collected_at: '2026-11-09T11:00:00+08:00',
    }],
    sort: DEFAULT_SORT_STATE,
    onSortChange: () => {},
    onOpenDetail: () => {},
  }))
  // 操作列与详情按钮移除；ID 副行不再显示。
  assert.ok(!html.includes('>操作<'), '不应再有操作列')
  assert.ok(!html.includes('最近采集'), '表格不应再有「最近采集」列（2026-11-12 真机反馈）')
  assert.ok(!html.includes('>详情<'), '不应再有详情按钮')
  assert.ok(!html.includes('ID：15050379357367110280'), '作品列不再显示 ID 副行')
  // 行级双击打开详情：行 title 提示 + tabIndex 可聚焦（键盘 Enter 同效）。
  assert.ok(html.includes('双击查看作品详情'), '行双击提示缺失')
  assert.ok(html.includes('tabindex="0"'), '行 tabIndex 缺失')
  // 封面渲染真实 img（http 源 + lazy + no-referrer），无 cover_url 时占位文字。
  assert.ok(html.includes('ywc-cover-img'), '封面 img 缺失')
  assert.ok(html.includes('src="https://example.invalid/c.jpg"'), '封面 src 缺失')
  assert.ok(html.includes('16s'), '时长角标缺失')
  // 标题口径：发布文案优先于系统短标题（对齐官方后台）。
  assert.ok(html.includes('官方发布文案'), '标题应为发布文案')
  assert.ok(!html.includes('系统短标题'), '系统短标题不应显示')
  const fallback = renderToString(h(WorkTable, {
    rows: [{ work_id: 'w2', cover_url: null, title: null, description: null }],
    onOpenDetail: () => {},
  }))
  assert.ok(fallback.includes('封面'), '缺封面应显示占位文字')
  assert.ok(fallback.includes(EMPTY), '标题双缺应显示「—」')
})

test('WorkTable（2026-11-12 真机反馈）：首屏加载态与「暂无作品」空态必须可区分', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkTable } = await import('../src/work-ui.js')
  const loading = renderToString(h(WorkTable, { rows: [], loading: true }))
  assert.ok(loading.includes('正在加载作品'), '加载中应显示专属文案')
  assert.ok(loading.includes('ywc-spinner'), '加载中应显示 spinner')
  assert.ok(loading.includes('aria-busy="true"'), '加载中应标记 aria-busy')
  assert.ok(!loading.includes('当前账号暂无已入库作品'), '加载中不得显示空态文案')
  const empty = renderToString(h(WorkTable, { rows: [] }))
  assert.ok(empty.includes('当前账号暂无已入库作品'), '未加载时应保留原空态')
  assert.ok(!empty.includes('正在加载作品'), '空态不得显示加载文案')
})

test('WorkDetailDialog（2026-11-11 真机反馈）：头部封面+元信息、KPI 铺满、来源/留存左右卡、按日 7 天趋势线', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkDetailDialog, recentDays } = await import('../src/work-ui.js')
  const work = {
    work_id: 'wx-work-0002',
    title: '系统短标题',
    description: '官方发布文案',
    cover_url: 'https://example.invalid/c.jpg',
    duration_s: 16,
    publish_time: '2026-11-08T10:00:00+08:00',
    latest_collected_at: '2026-11-09T11:00:00+08:00',
    play_count: 205,
    completion_rate_pct: 8.29,
    traffic_source: { rows: [{ sourceType: 4, sourceKey: 'recommend', name: '推荐', playCount: 180 }] },
    retention_trend: { points: [{ second: 3, rate_pct: 71.2 }] },
  }
  // x 轴固定最近 7 个自然日：窗口内有数据的日期正常出线，窗口外数据不出现。
  const windowDays = recentDays(7)
  const outOfWindowDay = recentDays(8)[0]
  const daily = [
    { day: outOfWindowDay, daily_play_count: 999 },
    ...windowDays.map((day, i) => ({
      day,
      daily_play_count: 10 + i,
      daily_like_count: 1,
      daily_follow_count: i,
    })),
  ]
  const html = renderToString(h(WorkDetailDialog, {
    work,
    detail: { traffic_source: work.traffic_source, retention_trend: work.retention_trend },
    dailyMetrics: daily,
    onClose: () => {},
  }))
  // 头部：封面（large）+ 元信息；KPI 不再嵌在头部 grid 内（铺满整行）。
  assert.ok(html.includes('ywc-cover-large'), '详情头部大封面缺失')
  assert.ok(html.includes('ID：wx-work-0002'), 'ID 元信息缺失')
  assert.ok(html.includes('发布时间：'), '发布时间元信息缺失')
  assert.ok(html.includes('官方发布文案'), '弹层标题应为发布文案')
  // 左右双卡片：来源分布与观众留存趋势并列（ywc-two-column 容器内两个 section）。
  assert.ok(html.includes('来源分布（不限）'), '来源分布段缺失')
  assert.ok(html.includes('观众留存趋势'), '留存趋势段缺失')
  assert.ok(html.includes('ywc-two-column'), '左右双卡容器缺失')
  // 按日数据：趋势线（图例 + svg），只显示最近 7 天。
  assert.ok(html.includes('按日数据（近 7 天）'), '按日趋势段标题缺失')
  assert.ok(html.includes('aria-label="按日数据近 7 天趋势"'), '趋势 svg 缺失')
  assert.ok(html.includes('关注量'), '趋势图例缺失')
  assert.ok(!html.includes(outOfWindowDay.slice(5)), '趋势线应只显示最近 7 天（窗口外日期不得出现）')
  assert.ok(!html.includes('日期'), '明细表表头不应再渲染')
})

test('AccountTab 关注者画像（2026-11-11 真机反馈）：去 Tab 同屏卡片——环形图/柱状图/省市两列', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { AccountTab } = await import('../src/account-ui.js')
  const profile = {
    day: '2026-11-10',
    gender: [{ key: '1', count: 30 }, { key: '2', count: 60 }, { key: 'unknown', count: 10 }],
    device: [{ key: '1', count: 80 }, { key: '2', count: 20 }],
    age: [{ key: 'fage_18_23', count: 12 }, { key: 'fage_24_30', count: 48 }],
    province: [{ key: '广东省', count: 40 }, { key: '浙江省', count: 20 }],
    city: [{ key: '杭州市', count: 15 }],
  }
  const html = renderToString(h(AccountTab, {
    window: 'last_7d', onWindow: () => {},
    overview: { metrics: { totals: {} }, availability: {}, fans_trend: null },
    profile,
    accounts: [{ accountId: 'a1', nickname: '账号一', deleteState: 'none' }],
    selectedId: 'a1',
    onSelectAccount: () => {},
  }))
  // 五个维度同屏卡片（无 Tab 切换按钮）。
  for (const title of ['性别分布', '访问设备分布', '年龄分布', '省份分布', '城市分布']) {
    assert.ok(html.includes(title), `画像卡「${title}」缺失`)
  }
  assert.ok(!html.includes('ywc-profile-tabs'), '画像 Tab 切换应移除')
  assert.ok(!html.includes('unknown'), '英文 unknown 不应透出，应显示「未知」')
  assert.ok(html.includes('未知'), '未知应显示中文')
  // 环形图：中心总人数（性别 30+60+10=100）+ conic-gradient。
  assert.ok(html.includes('conic-gradient'), '环形图 conic-gradient 缺失')
  assert.ok(html.includes('总人数'), '环形图中心总人数标签缺失')
  assert.ok(html.includes('aria-label="性别分布：共 100 人"'), '性别环形 aria 总数缺失')
  // 年龄柱状图带百分比标签（12/60=20%、48/60=80%）。
  assert.ok(html.includes('>20%<') || html.includes('>20%</span>'), '年龄百分比标签缺失')
  // 省市两列卡片沿用横向条形。
  assert.ok(html.includes('广东省'), '省份条形缺失')
})

test('WorkCover：加载失败回退占位、size=large、非 http 源不发请求', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkCover } = await import('../src/work-ui.js')
  const ok = renderToString(h(WorkCover, { coverUrl: 'https://example.invalid/c.jpg', durationText: '16s' }))
  assert.ok(ok.includes('ywc-cover-img'), 'img 缺失')
  assert.ok(ok.includes('ywc-cover-duration'), '时长角标缺失')
  const large = renderToString(h(WorkCover, { coverUrl: 'https://example.invalid/c.jpg', size: 'large' }))
  assert.ok(large.includes('ywc-cover-large'), 'large 尺寸类缺失')
  const bad = renderToString(h(WorkCover, { coverUrl: 'data:image/png;base64,x' }))
  assert.ok(bad.includes('ywc-cover-fallback'), '非 http 源应回退占位')
  assert.ok(!bad.includes('<img'), '非 http 源不得渲染 img')
})

test('TrendChart（2026-11-11 真机反馈）：固定 7 天 x 轴、真实 y 轴刻度、缺失断线', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { TrendChart, recentDays } = await import('../src/work-ui.js')
  const days = recentDays(7)
  const rows = days.map((day, index) => ({
    day,
    a: index === 0 || index === 1 ? null : index * 10, // 前两天空 → 断线
    b: 5,
  }))
  const html = renderToString(h(TrendChart, { rows, series: [
    { key: 'a', label: '播放', color: '#000' },
    { key: 'b', label: '喜欢', color: '#4ea6ff' },
  ] }))
  // x 轴：7 个自然日标签齐全（缺数据的日期也要有刻度）。
  for (const day of days) assert.ok(html.includes(day.slice(5)), `x 轴缺日期 ${day}`)
  // y 轴：5 条刻度标签（0 / 25% / 50% / 75% / 100% 位置），按真实数量而非相对百分比。
  const yLabels = [...html.matchAll(/text-anchor="end"[^>]*>([^<]+)<\/text>/g)].map(match => match[1])
  assert.equal(yLabels.length, 5, `y 轴刻度数量应为 5，实际 ${yLabels.length}`)
  // y 轴取真实数据范围（对齐官方：不从 0 强行起算），底部=最小值 5、顶部=最大值 60。
  assert.equal(yLabels[0], '5', 'y 轴底部应为数据最小值')
  assert.equal(yLabels[yLabels.length - 1], '60', 'y 轴顶部应为数据最大值')
  // 断线：播放序列前两天空缺，路径应从第 3 个点开始（只有 1 段）。
  const paths = [...html.matchAll(/<path d="([^"]+)"/g)].map(match => match[1])
  const playPath = paths.find(path => path.startsWith('M')) || ''
  assert.ok(playPath.length > 0, '播放序列路径缺失')
  assert.equal((playPath.match(/M/g) || []).length, 1, '连续 5 天数据应只有 1 段路径')
  // 悬停浮层容器常驻（内容随 hover 渲染），宽度自适应不应撑破布局。
  assert.ok(html.includes('ywc-chart-wrap'), '趋势图容器缺失')
})

test('profileBarsCard 省份/城市：按人数降序取前 5', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { AccountTab } = await import('../src/account-ui.js')
  const profile = {
    day: '2026-11-10',
    province: [
      { key: '湖南省', count: 48 }, { key: '广东省', count: 4 }, { key: '浙江省', count: 5 },
      { key: '江西省', count: 3 }, { key: '江苏省', count: 1 }, { key: '湖北省', count: 1 },
      { key: '上海市', count: 1 },
    ],
    city: [{ key: '长沙市', count: 41 }, { key: '岳阳市', count: 3 }, { key: '湖州市', count: 2 }],
  }
  const html = renderToString(h(AccountTab, {
    window: 'last_7d', onWindow: () => {},
    overview: { metrics: { totals: {} }, availability: {}, fans_trend: null },
    profile,
    accounts: [{ accountId: 'a1', nickname: '账号一', deleteState: 'none' }],
    selectedId: 'a1', onSelectAccount: () => {},
  }))
  const provinceCard = html.slice(html.indexOf('省份分布'), html.indexOf('城市分布'))
  const names = [...provinceCard.matchAll(/<span>([^<]+)<\/span>/g)].map(match => match[1]).filter(name => name !== '省份分布')
  // 前 4 名按人数降序确定；第 5 名落在并列 count=1 的集合内（同数量的顺序无关）。
  assert.deepEqual(names.slice(0, 4), ['湖南省', '浙江省', '广东省', '江西省'], '省份应按人数降序取前 5')
  assert.equal(names.length, 5, '省份只展示前 5 条')
  assert.ok(['江苏省', '上海市'].includes(names[4]), '第 5 名应为并列 count=1 的省份')
  assert.ok(!provinceCard.includes('湖北省'), '第 6 名及以后不应展示')
})

test('详情页数据缺口：只展示核心字段，is_original 等静默过滤', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkDetailDialog } = await import('../src/work-ui.js')
  const work = {
    work_id: 'w-gap', description: '缺口口径',
    publish_time: '2026-11-08T10:00:00+08:00', latest_collected_at: '2026-11-09T11:00:00+08:00',
    data_gap: {
      is_original: { at: '2026-11-11T07:00:00+00:00', reason: 'not_exposed' },
      retention_trend: { at: '2026-11-11T07:00:00+00:00', reason: 'not_exposed' },
    },
  }
  const html = renderToString(h(WorkDetailDialog, {
    work, detail: {}, dailyMetrics: [], onClose: () => {},
  }))
  assert.ok(!html.includes('is_original'), '非核心缺口不应展示')
  assert.ok(html.includes('观众留存'), '核心缺口应展示')
})

test('sessionActionFor：会话有效只探活，过期/未知走重新扫码登录', async () => {
  const { sessionActionFor } = await import('../src/account-ui.js')
  assert.equal(sessionActionFor({ sessionStatus: 'ok' }), 'probe')
  assert.equal(sessionActionFor({ sessionStatus: 'expired' }), 'relogin')
  assert.equal(sessionActionFor({ sessionStatus: 'unknown' }), 'relogin')
  assert.equal(sessionActionFor({}), 'relogin')
  assert.equal(sessionActionFor(null), 'relogin')
})

test('按日趋势图：作品发布日之前的日期按 0 处理（不是空白断线）', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkDetailDialog, recentDays } = await import('../src/work-ui.js')
  const days = recentDays(7)
  const publishDay = days[4] // 第 5 天发布
  const work = {
    work_id: 'w-pre',
    description: '发布前补 0',
    publish_time: `${publishDay}T10:00:00+08:00`,
    latest_collected_at: `${days[6]}T11:00:00+08:00`,
    play_count: 100,
  }
  const html = renderToString(h(WorkDetailDialog, {
    work,
    detail: {},
    // 只给发布日之后的数据；发布前的 4 天应由 UI 补 0。
    dailyMetrics: days.slice(4).map((day, index) => ({ day, daily_play_count: 10 + index })),
    onClose: () => {},
  }))
  // 补 0 后播放线从第一个点连续到最后一个点：整条路径只有 1 段（无断点）。
  const playPath = (html.match(/d="([^"]*)" stroke="var\(--ywc-brand\)"/) || [])[1] || ''
  assert.ok(playPath.length > 0, '播放路径缺失')
  assert.equal((playPath.match(/M/g) || []).length, 1, `发布前应补 0 连续，实际路径：${playPath}`)
  // y 轴底部因补 0 而回到 0。
  const yLabels = [...html.matchAll(/text-anchor="end"[^>]*>([^<]+)<\/text>/g)].map(match => match[1])
  assert.equal(yLabels[0], '0', '发布前补 0 后 y 轴应从 0 开始')
})

test('gapWorkCount：与详情页同口径，只统计核心缺口（is_original 不计）', async () => {
  const { gapWorkCount } = await import('../src/ui-format.js')
  const works = [
    { work_id: 'a', data_gap: { is_original: { reason: 'not_exposed' } } },
    { work_id: 'b', data_gap: { retention_trend: { reason: 'not_exposed' } } },
    { work_id: 'c', data_gap: null },
  ]
  assert.equal(gapWorkCount(works), 1, '只有 is_original 缺口不算缺口作品')
})

test('TrendChart y 轴：大数值用万/亿压缩（避免被左侧裁剪），小跨度不出现重复刻度', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { TrendChart, recentDays } = await import('../src/work-ui.js')
  const days = recentDays(7)
  const bigRows = days.map((day, index) => ({ day, plays: 1200000 + index * 500000 }))
  const bigHtml = renderToString(h(TrendChart, { rows: bigRows, series: [{ key: 'plays', label: '播放', color: '#000' }] }))
  const bigLabels = [...bigHtml.matchAll(/text-anchor="end"[^>]*>([^<]+)<\/text>/g)].map(match => match[1])
  assert.equal(bigLabels.length, 5)
  assert.ok(bigLabels.every(label => label.length <= 8), `y 轴标签过长会被裁剪：${bigLabels.join(',')}`)
  assert.ok(bigLabels.some(label => label.endsWith('万')), '大数值应使用万/亿紧凑格式')

  // 小跨度（63~66）：标签不得重复。
  const smallRows = days.map((day, index) => ({ day, total: 63 + index * 0.5 }))
  const smallHtml = renderToString(h(TrendChart, { rows: smallRows, series: [{ key: 'total', label: '总数', color: '#000' }] }))
  const smallLabels = [...smallHtml.matchAll(/text-anchor="end"[^>]*>([^<]+)<\/text>/g)].map(match => match[1])
  assert.equal(new Set(smallLabels).size, smallLabels.length, `小跨度刻度不应重复：${smallLabels.join(',')}`)
})

test('TrendChart：无任何有效值时渲染空态，不画伪坐标轴', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { TrendChart, recentDays } = await import('../src/work-ui.js')
  const days = recentDays(7)
  const html = renderToString(h(TrendChart, {
    rows: days.map(day => ({ day, total: null })),
    series: [{ key: 'total', label: '总数', color: '#000' }],
  }))
  assert.ok(html.includes('暂无可展示的趋势数据'), '无数据应显示空态')
  assert.ok(!html.includes('<svg'), '无数据不应渲染坐标轴')
})

test('AccountTab：窗口切到「昨日」时，关注者增长图仍按 trendOverview 画满 7 天轴', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { AccountTab } = await import('../src/account-ui.js')
  const { recentDays } = await import('../src/work-ui.js')
  const days = recentDays(7)
  // 当前窗口（昨日）只有 2 天数据；trendOverview（last_7d）有完整 7 天。
  const yesterday = { metrics: { totals: {} }, availability: {}, fans_trend: { daily: [
    { day: days[5], follower_total_count: 66 },
    { day: days[6], follower_total_count: 67 },
  ] } }
  const week = { metrics: { totals: {} }, availability: {}, fans_trend: { daily: days.map((day, i) => ({ day, follower_total_count: 60 + i })) } }
  const html = renderToString(h(AccountTab, {
    window: 'yesterday', onWindow: () => {},
    overview: yesterday, trendOverview: week, profile: null,
    accounts: [{ accountId: 'a1', nickname: '账号一', deleteState: 'none' }],
    selectedId: 'a1', onSelectAccount: () => {},
  }))
  for (const day of days) assert.ok(html.includes(day.slice(5)), `趋势图应显示满 7 天，缺 ${day}`)
  // 关键：折线必须真的画出 7 个点（横轴标签本来就是 7 个，只看标签区分不出来）。
  const path = (html.match(/<path d="(M[^"]+)" stroke="var\(--ywc-brand\)"/) || [])[1] || ''
  assert.ok(path.length > 0, '关注者增长折线缺失')
  assert.ok((path.match(/L/g) || []).length >= 6, `应画出 7 个数据点，实际路径：${path}`)
})

test('账号卡按钮：登录进行中与墓碑账号时「重新扫码」禁用', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { AccountList } = await import('../src/account-ui.js')
  const accounts = [
    { accountId: 'a-expired', nickname: '过期号', sessionStatus: 'expired', deleteState: 'none' },
    { accountId: 'a-deleted', nickname: '墓碑号', sessionStatus: 'expired', deleteState: 'remote_deleted' },
  ]
  const normal = renderToString(h(AccountList, {
    accounts, selectedId: null, busy: false, running: false,
    loginActive: false, browserBlocked: false,
    onSelect: () => {}, onProbe: () => {}, onRemove: () => {}, onBeginLogin: () => {}, onCollectAll: () => {},
  }))
  // 普通过期账号：按钮可用（可点重新扫码）。
  const expiredButton = normal.match(/<button[^>]*>重新扫码<\/button>/g) || []
  assert.equal(expiredButton.length, 2, '过期账号应显示两个「重新扫码」')
  assert.ok(expiredButton[0].includes('class="ywc-mini-button"'), '首个非墓碑按钮应为启用态（无 disabled）')
  assert.ok(!expiredButton[0].includes('disabled'), '普通过期账号的重新扫码应可点击')
  assert.ok(expiredButton[1].includes('disabled'), '墓碑账号的重新扫码应禁用')

  const busyLogin = renderToString(h(AccountList, {
    accounts, selectedId: null, busy: false, running: false,
    loginActive: true, browserBlocked: false,
    onSelect: () => {}, onProbe: () => {}, onRemove: () => {}, onBeginLogin: () => {}, onCollectAll: () => {},
  }))
  const busyButtons = busyLogin.match(/<button[^>]*>重新扫码<\/button>/g) || []
  assert.ok(busyButtons.every(button => button.includes('disabled')), '登录进行中所有「重新扫码」应禁用')
})

test('批量采集乐观投影：空 items 的 probing 形状可安全渲染（点击即反馈）', async () => {
  const { batchProgressText } = await import('../src/ui-format.js')
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { AccountList } = await import('../src/account-ui.js')
  const optimistic = { phase: 'probing', items: [], currentAccountIndex: 0 }
  assert.equal(batchProgressText(optimistic), null, '空 items 时进度文案回退到默认')

  const html = renderToString(h(AccountList, {
    accounts: [{ accountId: 'a1', nickname: '账号一', sessionStatus: 'ok', deleteState: 'none' }],
    selectedId: 'a1', busy: false, running: false,
    loginActive: false, browserBlocked: false,
    batch: optimistic, onCollectAll: () => {},
    onSelect: () => {}, onProbe: () => {}, onRemove: () => {}, onBeginLogin: () => {},
  }))
  assert.ok(html.includes('正在采集…'), '乐观态应立刻显示采集 spinner 文案')
  assert.ok(html.includes('ywc-spinner'), '乐观态应有 spinner')
  assert.ok(html.includes('成功 0 · 部分完成 0 · 失败 0 · 跳过 0'), '计数需安全兜底为 0')
})

test('按钮交互样式：所有可点击元素都有 cursor:pointer 与 hover 效果', async () => {
  const { readFile } = await import('node:fs/promises')
  const css = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // 抽取样式块（STYLES 常量的模板字符串）。
  const styles = css.slice(css.indexOf('const STYLES'), css.indexOf('const STYLES') + 40000)
  const required = [
    '.ywc-button',
    '.ywc-primary',
    '.ywc-mini-button',
    '.ywc-tab',
    '.ywc-window-group button',
    '.ywc-select',
    // 账号卡主按钮（切账号入口）与弹层关闭按钮——漏这两处等于修复没做完（review P1-1）。
    '.ywc-card-main',
    '.ywc-close',
  ]
  for (const selector of required) {
    // 选择器后必须紧跟 '{'，避免 `.ywc-tab` 误匹配到 `.ywc-tabs`。
    // 同一选择器可能出现在组合规则里（如 `.ywc-input, .ywc-select {`），因此扫描
    // 全部出现位置，只要有一处声明了 cursor:pointer 即可。
    const needle = `${selector} {`
    const blocks = []
    let from = 0
    for (;;) {
      const index = styles.indexOf(needle, from)
      if (index < 0) break
      blocks.push(styles.slice(index, styles.indexOf('}', index)))
      from = index + needle.length
    }
    assert.ok(blocks.length > 0, `样式缺少 ${selector}`)
    assert.ok(
      blocks.some(block => block.includes('cursor:pointer')),
      `${selector} 缺少 cursor:pointer（鼠标不显示手型）`,
    )
  }
  // 主按钮与添加账号按钮必须有 hover 态。
  assert.ok(/\.ywc-button\.primary:hover/.test(styles), '主按钮缺少 hover 态')
  assert.ok(/\.ywc-primary:hover/.test(styles), '添加账号按钮缺少 hover 态')
  assert.ok(/\.ywc-mini-button:hover/.test(styles), '账号卡按钮缺少 hover 态')
  // 禁用态必须不因 hover 变色（review P2-1）。
  assert.ok(/\.ywc-mini-button:disabled:hover/.test(styles), '禁用的账号卡按钮 hover 不应变色')
  assert.ok(/\.ywc-mini-button\.danger:disabled:hover/.test(styles), '禁用的删除按钮 hover 不应变红')
  assert.ok(/\.ywc-button:disabled:hover/.test(styles), '禁用的按钮 hover 不应变色')
  // 文本框用 text 光标，不能是 pointer（review P2-3）。
  assert.ok(/\.ywc-input \{[^}]*cursor:text/.test(styles), '输入框应使用 text 光标')
  // hover 色按主题定义，浅色主题不能靠混黑（review P2-2）。
  assert.ok(/--ywc-brand-hover/.test(styles), '缺少按主题定义的 --ywc-brand-hover')
})

test('WorkToolbar：刷新按钮在刷新中显示「刷新中…」并禁用', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkToolbar } = await import('../src/work-ui.js')
  const idle = renderToString(h(WorkToolbar, { onCollect: () => {}, onRefresh: () => {} }))
  assert.ok(idle.includes('>刷新<'), '空闲态显示「刷新」')
  assert.ok(!idle.includes('刷新中'), '空闲态不应显示「刷新中…」')

  const busy = renderToString(h(WorkToolbar, { onCollect: () => {}, onRefresh: () => {}, refreshing: true }))
  assert.ok(busy.includes('刷新中…'), '刷新中应显示「刷新中…」')
  assert.ok(/<button[^>]*aria-busy="true"[^>]*>刷新中…/.test(busy) || /aria-busy="true"[^>]*>刷新中…/.test(busy), '刷新中按钮应有 aria-busy')
})

test('shouldApplyResponse：序号最新 + 账号仍是当前选中才落屏（review P1-4）', async () => {
  const { shouldApplyResponse } = await import('../src/ui-format.js')
  const base = { requestId: 2, currentRequestId: 2, responseAccountId: 'a1', currentAccountId: 'a1' }
  assert.equal(shouldApplyResponse(base), true, '同账号、序号最新应落屏')
  // 序号过期：同账号并发时后到的旧响应不得覆盖。
  assert.equal(shouldApplyResponse({ ...base, requestId: 1 }), false)
  // 账号已切换：采集回调按采集账号刷新，旧账号响应不得写进新账号视图。
  assert.equal(shouldApplyResponse({ ...base, responseAccountId: 'a2' }), false)
  assert.equal(shouldApplyResponse({ ...base, currentAccountId: 'a2' }), false)
})

test('refreshResultLabel：部分失败要明确指出失败路（review P1-2）', async () => {
  const { refreshResultLabel } = await import('../src/ui-format.js')
  assert.equal(refreshResultLabel({ works: true, overview: true, accounts: true }), '已刷新')
  assert.equal(
    refreshResultLabel({ works: false, overview: true, accounts: true }),
    '部分刷新失败：作品列表',
  )
  assert.equal(
    refreshResultLabel({ works: true, overview: false, accounts: false }),
    '部分刷新失败：账号总览、账号列表',
  )
  // 未知状态（未显式 false）按成功处理，不误报失败。
  assert.equal(refreshResultLabel({}), '已刷新')
})

test('WorkToolbar：刷新提示就地显示在按钮下方（统一状态行），不进顶部通知', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkToolbar } = await import('../src/work-ui.js')

  // 失败提示：显示在状态行（采集按钮下方），与进度行同一容器。
  const withMessage = renderToString(h(WorkToolbar, {
    onCollect: () => {}, onRefresh: () => {}, refreshMessage: '部分刷新失败：作品列表',
  }))
  assert.ok(withMessage.includes('部分刷新失败：作品列表'), '刷新提示应显示在工具栏状态行')
  assert.ok(withMessage.includes('ywc-progress'), '提示应复用进度行容器（按钮下方）')
  // 提示在按钮组之后（DOM 顺序 = 视觉顺序）。
  const toolbarIndex = withMessage.indexOf('ywc-toolbar-left')
  const statusIndex = withMessage.indexOf('ywc-progress')
  assert.ok(toolbarIndex >= 0 && statusIndex > toolbarIndex, '状态行必须在按钮组之后')

  // 采集进行中：进度优先于刷新提示。
  const running = renderToString(h(WorkToolbar, {
    onCollect: () => {}, onRefresh: () => {}, refreshMessage: '部分刷新失败：作品列表',
    collect: { accountId: 'a1', status: 'running', progress: { phase: 'work', index: 3, total: 10 } },
  }))
  assert.ok(running.includes('采集进度 3/10'), '采集进度优先')
  assert.ok(!running.includes('部分刷新失败'), '采集中不显示刷新提示')

  // 无状态：状态行不渲染。
  const idle = renderToString(h(WorkToolbar, { onCollect: () => {}, onRefresh: () => {} }))
  assert.ok(!idle.includes('ywc-progress'), '空闲态不渲染状态行')
})

test('latestCollectedAt（2026-11-12 真机反馈）：取最新采集时刻，忽略空/非法值', async () => {
  const { latestCollectedAt } = await import('../src/ui-format.js')
  const rows = [
    { work_id: 'a', latest_collected_at: '2026-11-12T13:10:00+08:00' },
    { work_id: 'b', latest_collected_at: '2026-11-12T12:50:00+08:00' },
    { work_id: 'c', latest_collected_at: null },
    { work_id: 'd', latest_collected_at: 'not-a-date' },
  ]
  assert.equal(latestCollectedAt(rows), '2026-11-12T13:10:00+08:00')
  assert.equal(latestCollectedAt([]), null)
  assert.equal(latestCollectedAt(null), null)
})

test('WorkToolbar（2026-11-12 真机反馈）：刷新按钮后显示最近采集时间', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkToolbar } = await import('../src/work-ui.js')
  const html = renderToString(h(WorkToolbar, {
    onCollect: () => {}, onRefresh: () => {},
    latestCollectedAt: '2026-11-12T13:10:00+08:00',
  }))
  assert.ok(html.includes('最近采集时间：2026-11-12 13:10'), '应显示最近采集时间')
  // 位置契约：提示在「刷新」按钮之后（同一按钮行内），不占表格列。
  assert.ok(html.indexOf('刷新') < html.indexOf('最近采集时间'), '最近采集时间应在刷新按钮之后')
  assert.ok(html.includes('ywc-toolbar-note'), '应使用工具栏提示样式类')
  // 无数据时显示「—」，不隐藏（避免布局跳动）。
  const empty = renderToString(h(WorkToolbar, { onCollect: () => {}, onRefresh: () => {} }))
  assert.ok(empty.includes('最近采集时间：—'), '无数据应显示「—」')
})

test('sortTrafficRowsByValue（2026-11-12 真机反馈）：按播放量降序，缺失值沉底', async () => {
  const { sortTrafficRowsByValue } = await import('../src/ui-format.js')
  const sorted = sortTrafficRowsByValue([
    { name: '关注', value: 0 },
    { name: '推荐', value: 174 },
    { name: '朋友', value: 22 },
    { name: '未知', value: null },
  ])
  assert.deepEqual(sorted.map(row => row.name), ['推荐', '朋友', '关注', '未知'])
  assert.deepEqual(sortTrafficRowsByValue([]), [])
})

test('WorkDetailDialog（2026-11-12 真机反馈）：来源分布按播放量从大到小渲染', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkDetailDialog, recentDays } = await import('../src/work-ui.js')
  const day = recentDays(7)[0]
  const work = {
    work_id: 'w-traffic',
    description: '来源排序',
    cover_url: null,
    publish_time: `${day}T10:00:00+08:00`,
    latest_collected_at: '2026-11-12T13:10:00+08:00',
    play_count: 100,
  }
  const html = renderToString(h(WorkDetailDialog, {
    work,
    // 官方行序（升序）传入，渲染必须按数值降序：甲(5) 乙(40) 丙(174)。
    detail: { traffic_source: { rows: [
      { sourceKey: 'a', name: '甲', playCount: 5 },
      { sourceKey: 'b', name: '乙', playCount: 40 },
      { sourceKey: 'c', name: '丙', playCount: 174 },
    ] } },
    dailyMetrics: [],
    onClose: () => {},
  }))
  const iA = html.indexOf('甲')
  const iB = html.indexOf('乙')
  const iC = html.indexOf('丙')
  assert.ok(iC >= 0 && iB >= 0 && iA >= 0, '来源行缺失')
  assert.ok(iC < iB && iB < iA, `来源分布未按降序渲染（丙174 → 乙40 → 甲5），实际顺序索引 ${iC}/${iB}/${iA}`)
})
