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
  const { WorkDetailDialog } = await import('../src/work-ui.js')
  const work = {
    work_id: 'w-ret',
    description: '留存口径',
    cover_url: null,
    publish_time: '2026-11-08T10:00:00+08:00',
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
      { day: '2026-11-01', daily_play_count: 10 },
      { day: '2026-11-02', daily_play_count: null },
      { day: '2026-11-03', daily_play_count: 30 },
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
  assert.deepEqual(normalizeProfileRows([
    { key: '1', count: 58 },
    { key: 'unknow', count: 2 },
  ], 'device'), [['设备 1', 58], ['未知', 2]])
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

test('WorkDetailDialog（2026-11-11 真机反馈）：头部封面+元信息、KPI 铺满、来源/留存左右卡、按日 7 天趋势线', async () => {
  const react = await import('react')
  const { createElement: h } = react
  const { renderToString } = await import('react-dom/server')
  const { WorkDetailDialog } = await import('../src/work-ui.js')
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
  // 8 天按日数据：趋势线只显示最近 7 天（最旧一天不出现）。
  const daily = Array.from({ length: 8 }, (_, i) => ({
    day: `2026-10-${25 + i}`,
    daily_play_count: 10 + i,
    daily_like_count: 1,
    daily_follow_count: i,
  }))
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
  assert.ok(!html.includes('10-25'), '趋势线应只显示最近 7 天（最旧日 10-25 不得出现）')
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
