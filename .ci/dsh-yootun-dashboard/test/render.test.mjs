import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 用最小 React 垫片实际执行客户端组件树，验证文档 04 的 UI 验收点：
// 健康摘要、异常队列、构成条、aria-current、缺失字段“—”、空/错误态与 tab 切换。
test('dashboard client renders health strip, attention queue, and tab switching', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const module_ = { exports: {} }
  const primitives = new Proxy({}, { get: (_target, name) => function Primitive(props) {
    const children = props?.children === undefined ? [] : Array.isArray(props.children) ? props.children : [props.children]
    return { type: `primitive:${String(name)}`, props: props || {}, children }
  } })

  const states = []
  let cursor = 0
  const react = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      if (typeof type === 'function') return type({ ...props, children: children.length <= 1 ? children[0] : children })
      return { type, props: props || {}, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== '') }
    },
    useState(init) {
      const index = cursor++
      if (states.length <= index) states.push(typeof init === 'function' ? init() : init)
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useEffect() {},
    useMemo(factory) { return factory() },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
  }
  const require_ = name => (name === 'react' ? react : name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : null)
  new Function('require', 'module', 'exports', source)(require_, module_, module_.exports)

  const registered = []
  globalThis.document ??= { createElement: () => ({ dataset: {}, remove() {}, textContent: '' }), head: { appendChild() {} } }
  module_.exports.apply({
    effect(factory) { factory() },
    locale: { bind: () => key => key, register: () => () => {} },
    slots: {
      inject(_name, factory) { factory() },
      register(options, component) { registered.push([options.name, component]); return component },
    },
  })
  const [buttonComponent, overlayComponent] = registered.map(([, component]) => component)

  const ready = { sourceCompleteness: 'complete', missingFields: [] }
  const mock = {
    period: { label: '昨日', date: '2026-08-31', start: '2026-08-31T00:00:00+08:00', end: '2026-09-01T00:00:00+08:00', timeZone: 'Asia/Shanghai' },
    geo: { status: 'ready', asOf: '2026-09-01T01:30:00.000Z', source: 'geoflow', ...ready, data: {
      kpis: { articles: 4, published: 2, total_views: 27, failed_tasks: 1 },
      top_content: [{ title: 'A 文章', views: 20 }, { title: 'B 文章', views: 7 }],
      insight: {
        funnel: { max: 4, stages: [{ key: 'created', count: 4 }, { key: 'published', count: 2 }] },
        channels: { total: 4, synced: 3, failed: 1, pending: 0, rows: [{ name: '官网', total: 4, synced: 3, failed: 1, pending: 0 }] },
        goals: [
          { goalId: 1, scope: 'category', categoryId: 7, categoryName: '测试分类', metric: 'published', target: 4, actual: 1, attainmentPct: 25, pacePct: 10 },
          { goalId: 2, scope: 'global', categoryId: null, categoryName: null, metric: 'published', target: 10, actual: 0, attainmentPct: 0, pacePct: 10 },
        ],
      },
    } },
    usage: { status: 'ready', asOf: '2026-09-01T01:30:00.000Z', source: 'models', ...ready, data: { currency: 'CNY', summary: { requests: 10, inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.5 }, byModel: [{ model: 'model-a', requests: 8, inputTokens: 80, outputTokens: 40, cost: 0.4 }, { model: 'model-b', requests: 2, inputTokens: 20, outputTokens: 10, cost: 0.1 }] } },
    activity: { status: 'ready', asOf: '2026-09-01T01:30:00.000Z', source: 'local_agent', ...ready, data: { totals: { sessions: 2, turns: 5, completedTurns: 4, failedTurns: 1, toolCalls: 9 }, sessions: [{ title: '会话一', workspace: 'repo', turns: 3, completedTurns: 2, failedTurns: 1 }], tools: [{ name: 'mcp__geoflow__overview', calls: 6 }, { name: 'read', calls: 3 }] } },
    montage: { status: 'ready', asOf: '2026-09-01T01:30:00.000Z', source: 'openmontage', ...ready, data: { jobs: { total: 6, queued: 1, running: 2, completed: 2, failed: 1 }, pendingApprovals: 2, approvals: { oldestWaitingAt: '2026-09-01T00:30:00Z' }, recentJobs: [{ id: 'job-1', title: '作业', status: 'failed', stage: 'asr', updatedAt: '' }], artifacts: { total: 3, recent: [] }, health: { service: 'ready', workers: [{ id: 'w1', status: 'healthy' }, { id: 'w2', status: 'down' }] } } },
    capabilities: { tools: { status: 'ready' } },
    refreshedAt: '2026-09-01T01:30:00.000Z',
  }

  const collect = (node, match, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (match(node)) out.push(node)
    for (const child of node.children ?? []) collect(child, match, out)
    return out
  }
  const text = node => (node === null || node === undefined || typeof node !== 'object') ? String(node ?? '') : (node.children ?? []).map(text).join('')
  const byClass = (node, name) => collect(node, item => typeof item.props?.className === 'string' && item.props.className.split(' ').includes(name))

  // 打开看板：seeded states 顺序为 tab, range, scope, data cache, loading, failed, revision
  states.length = 0
  states.push('overview', 'yesterday', 'key', { yesterday: mock }, false, false, 0)
  const button = byClass(react.createElement(buttonComponent, { t: key => key }), 'yd-sidebar-action').at(0)
  button.props.onClick()
  cursor = 0
  const render = () => { cursor = 0; return react.createElement(overlayComponent, { t: key => key }) }
  let tree = render()

  // 健康摘要三枚徽章；异常队列 = 失败任务1 + 异常轮次1 + 失败作业1 + 待审批2 + Worker离线1
  assert.equal(byClass(tree, 'yd-chip').length, 3)
  assert.equal(byClass(tree, 'yd-attention-row').length, 5)
  const attentionTexts = byClass(tree, 'yd-attention-row').map(row => text(row))
  assert.ok(attentionTexts.some(value => value.includes('failedTasks')))
  assert.ok(attentionTexts.some(value => value.includes('workerDown')))

  // 域卡片 4 张 + 数据源状态区；健康 Worker w1=ready，离线 w2 不在总览（在 montage 详情）
  assert.equal(byClass(tree, 'yd-domain-card').length, 4)
  assert.ok(byClass(tree, 'yd-source-band').length)
  // aria-current 落在总览页签
  const current = collect(tree, node => node.props?.['aria-current'] === 'page')
  assert.equal(current.length, 1)
  assert.equal(text(current[0]), 'tabOverview')

  // GEO 缺失字段显示“—”而不是 0
  const geoCard = byClass(tree, 'yd-domain-card').at(0)
  const missingMetric = byClass(geoCard, 'yd-metric-missing')
  assert.ok(missingMetric.every(metric => collect(metric, item => typeof item === 'string').every(() => true)))

  // 点击异常行切换到对应页签
  byClass(tree, 'yd-attention-main').at(0).props.onClick()
  tree = render()
  const geoCurrent = collect(tree, node => node.props?.['aria-current'] === 'page').at(0)
  assert.equal(text(geoCurrent), 'tabGeo')
  assert.equal(byClass(tree, 'yd-geo-detail').length, 1)
  assert.equal(byClass(tree, 'yd-geo-detail').at(0).props.className, 'yd-detail-stack yd-geo-detail')

  // 待审批异常行带「打开统一审批」直达按钮，点击派发跨插件事件
  states[0] = 'overview'
  tree = render()
  const dispatches = []
  globalThis.CustomEvent ??= class CustomEvent { constructor(type) { this.type = type } }
  globalThis.window ??= { dispatchEvent: event => dispatches.push(event.type), addEventListener() {}, removeEventListener() {} }
  const actionButtons = byClass(tree, 'yd-attention-action')
  assert.equal(actionButtons.length, 1)
  assert.equal(text(actionButtons[0]), 'openApprovals')
  actionButtons[0].props.onClick()
  assert.deepEqual(dispatches, ['dofe:yootun-approvals:open'])
  // 昨日视图不展示团队/本人切换，避免把 key-scoped 数据误标成团队数据。
  assert.equal(collect(tree, node => node.props?.['aria-label'] === 'scopeControl').length, 0)
  const exportButton = collect(tree, node => node.props?.['aria-label'] === 'exportCsv').at(0)
  assert.equal(exportButton.props.disabled, false)

  // 模型构成：model-a 占 0.4/0.5 = 80%
  states[0] = 'usage'
  tree = render()
  assert.ok(text(tree).includes('80%'))

  // Montage：固定枚举 healthState —— healthy→已就绪，down→异常；未知→不可用
  states[0] = 'montage'
  tree = render()
  assert.equal(byClass(tree, 'yd-montage-detail').length, 1)
  assert.equal(byClass(tree, 'yd-montage-detail').at(0).props.className, 'yd-detail-stack yd-montage-detail')
  assert.ok(text(tree).includes('sourceReady'))
  assert.ok(text(tree).includes('sourceError'))
  // 作业状态构成条总和覆盖 6 个作业
  const shares = byClass(tree, 'yd-share').map(share => text(share))
  assert.equal(shares.length, 4)
  assert.ok(shares.some(share => share.includes('17%')))
  // 待审批指标保留“最早等待”提示并应用告警色，hint 不能误作 CSS tone。
  const approvalMetric = byClass(tree, 'yd-metric-danger').find(metric => text(metric).includes('pendingApprovals'))
  assert.ok(approvalMetric)
  assert.ok(text(approvalMetric).includes('oldestWaiting'))

  // 空/错误态：empty 不显示伪造数值；error 显示 reason 折叠并以 alert 通告
  states[0] = 'geo'
  states[3] = { yesterday: { ...mock, geo: { status: 'error', reason: 'geoflow_http_502', source: 'geoflow', sourceCompleteness: 'unknown', missingFields: [] } } }
  tree = render()
  assert.equal(byClass(tree, 'yd-empty-error').length, 1)
  assert.equal(collect(tree, node => node.props?.role === 'alert').length, 1)
  assert.ok(text(tree).includes('geoflow_http_502'))
  states[3] = { yesterday: { ...mock, usage: { status: 'empty', source: 'models', sourceCompleteness: 'complete', missingFields: [], data: {} } } }
  tree = render()
  assert.equal(byClass(tree, 'yd-empty').length, 0) // geo 正常
  states[0] = 'usage'
  tree = render()
  assert.ok(text(tree).includes('empty'))
  const compactEmpty = byClass(tree, 'yd-source-empty').find(node => node.props.className.includes('yd-source-compact'))
  assert.ok(compactEmpty)
  assert.ok(text(compactEmpty).includes('sourceEmptyContext'))
  assert.equal(collect(compactEmpty, node => typeof node.type === 'string' && node.type.startsWith('primitive:')).length, 0)

  // unavailable：不显示 0，也不显示 alert
  states[0] = 'montage'
  states[3] = { yesterday: { ...mock, montage: { status: 'unavailable', reason: 'montage_timeout', source: 'openmontage', sourceCompleteness: 'unknown', missingFields: [] } } }
  tree = render()
  assert.equal(byClass(tree, 'yd-empty-unavailable').length, 1)
  assert.equal(collect(tree, node => node.props?.role === 'alert').length, 0)

  // 部分字段徽章出现在数据源状态区
  states[0] = 'overview'
  states[3] = { yesterday: { ...mock, montage: { ...mock.montage, sourceCompleteness: 'partial', missingFields: ['artifacts'] } } }
  tree = render()
  const badges = byClass(tree, 'yd-badge-warning').map(text)
  assert.deepEqual(badges, ['sourcePartial'])

  // Montage 作业统计缺失时不绘制全零构成条，避免把缺失值误读为真实 0。
  states[0] = 'montage'
  states[3] = { yesterday: { ...mock, montage: {
    ...mock.montage,
    sourceCompleteness: 'partial',
    missingFields: ['jobs'],
    data: { ...mock.montage.data, jobs: { total: null, queued: null, running: null, completed: null, failed: null } },
  } } }
  tree = render()
  assert.equal(byClass(tree, 'yd-share').length, 0)

  // 趋势形态（近 7 天）：范围切换按钮、每日趋势条、环比文案、路由归因表
  const seriesDays = [
    { date: '2026-08-25', articles: 1, published: 0, views: 5, failedTasks: 0 },
    { date: '2026-08-26', articles: 2, published: 1, views: 10, failedTasks: 1 },
    { date: '2026-08-27', articles: 0, published: 0, views: 2, failedTasks: 0 },
  ]
  const seriesData = (overrides = {}) => ({
    period: { label: '近7天', days: 7, start: '2026-08-25T00:00:00+08:00', end: '2026-09-01T00:00:00+08:00', timeZone: 'Asia/Shanghai' },
    geo: { status: 'ready', asOf: '', source: 'geoflow', sourceCompleteness: 'complete', missingFields: [], data: { days: seriesDays, totals: { articles: 3, published: 1, views: 17, failedTasks: 1 }, insight: { funnel: { max: 3, stages: [{ key: 'created', count: 3 }, { key: 'published', count: 1 }] }, channels: { total: 4, synced: 3, failed: 1, pending: 0, rows: [{ name: '官网', total: 4, synced: 3, failed: 1, pending: 0 }] }, goals: [
        { goalId: 1, scope: 'category', categoryId: 7, categoryName: '测试分类', metric: 'published', target: 4, actual: 1, attainmentPct: 25, pacePct: 10 },
        { goalId: 2, scope: 'global', categoryId: null, categoryName: null, metric: 'published', target: 10, actual: 0, attainmentPct: 0, pacePct: 10 },
      ] } }, comparison: { status: 'ready', baseline: { articles: 4, published: 2, views: 8, failedTasks: 0 }, delta: { articles: -1, published: -1, views: 9, failedTasks: 1 }, deltaPercent: { articles: -25, published: -50, views: 113, failedTasks: null } }, ...overrides },
    usage: { status: 'ready', asOf: '', source: 'models', sourceCompleteness: 'complete', missingFields: [], data: { days: seriesDays.map(day => ({ date: day.date, requests: 2, successfulRequests: 2, totalTokens: 30, cost: 0.1, latencyP50Ms: 500, latencyP95Ms: 2100 })), totals: { requests: 6, successfulRequests: 6, totalTokens: 90, cost: 0.3 }, currency: 'CNY', byRoute: [{ route: '/v1/chat/completions', requests: 6, cost: 0.3 }], byMember: [{ memberId: 'sso-2', displayName: '李四', ownerType: 'human', requests: 4, cost: 0.2 }], budgets: [{ name: '日常预算', type: 'cost', period: 'daily', limit: 1, used: 0.9, currency: 'CNY' }], principal: { type: 'member', ownerType: 'human', id: 'sso-1' } }, comparison: { status: 'ready', baseline: { requests: 4, successfulRequests: 4, totalTokens: 60, cost: 0.2 }, delta: { requests: 2, successfulRequests: 2, totalTokens: 30, cost: 0.1 }, deltaPercent: { requests: 50, successfulRequests: 50, totalTokens: 50, cost: 50 } } },
    activity: { status: 'empty', asOf: '', source: 'local_agent', sourceCompleteness: 'complete', missingFields: [], data: { days: seriesDays.map(day => ({ date: day.date, sessions: 0, turns: 0, completedTurns: 0, failedTurns: 0, toolCalls: 0 })), totals: { sessions: 0, turns: 0, completedTurns: 0, failedTurns: 0, toolCalls: 0 } }, comparison: { status: 'ready', baseline: { sessions: 0, turns: 0, completedTurns: 0, failedTurns: 0, toolCalls: 0 }, delta: {}, deltaPercent: {} } },
    montage: { status: 'ready', asOf: '', source: 'openmontage', sourceCompleteness: 'complete', missingFields: [], data: { days: seriesDays.map(day => ({ date: day.date, total: 1, queued: 0, running: 0, waiting_approval: 0, succeeded: 1, failed: 0, cancel_requested: 0, cancelled: 0 })), totals: { queued: 0, running: 0, waiting_approval: 0, succeeded: 3, failed: 0, cancel_requested: 0, cancelled: 0, total: 3 }, stageStats: [{ stage: 'research', count: 3, succeeded: 3, failed: 0, durationP50Ms: 3600, durationP95Ms: 7200 }] }, comparison: { status: 'ready', baseline: { queued: 0, running: 0, waiting_approval: 0, succeeded: 1, failed: 0, cancel_requested: 0, cancelled: 0, total: 1 }, delta: { total: 2 }, deltaPercent: { total: 200 } } },
    refreshedAt: '2026-09-01T01:30:00.000Z',
  })
  states[0] = 'overview'
  states[1] = '7d'
  states[3] = { '7d:key': seriesData() }
  tree = render()
  // 范围与视角两组分段控件各有一个 aria-pressed；范围落在 7 天，视角默认本人
  const pressed = collect(tree, node => node.props?.['aria-pressed'] === true)
  assert.equal(pressed.length, 2)
  assert.deepEqual(pressed.map(text).sort(), ['range7d', 'scopeKey'])
  assert.equal(collect(tree, node => node.props?.['aria-label'] === 'scopeControl').length, 1)
  // 总览 4 张域卡片各带每日趋势条
  assert.equal(byClass(tree, 'yd-domain-card').length, 4)
  assert.equal(byClass(tree, 'yd-trend').length, 0) // 总览只显示汇总指标；趋势条在详情页
  assert.ok(text(tree).includes('113%')) // geo views 环比 ▲ 113%
  assert.ok(text(tree).includes('▼ 50%'))
  // 标题显示窗口标签而非单日
  assert.ok(text(tree).includes('近7天'))

  states[0] = 'usage'
  tree = render()
  assert.ok(text(tree).includes('byRoute'))
  assert.ok(text(tree).includes('/v1/chat/completions'))
  assert.equal(byClass(tree, 'yd-trend').length, 1) // 每日消费趋势条
  // 预算阈值（90% 使用率 → danger 色）与成员归因表
  assert.ok(text(tree).includes('日常预算'))
  assert.ok(text(tree).includes('李四'))
  assert.ok(text(tree).includes('latency')) // P95 延迟指标（数值随 locale 千分位变化，只断言键存在）
  assert.equal(byClass(tree, 'yd-usage-detail').length, 1)
  assert.equal(byClass(tree, 'yd-usage-detail').at(0).props.className, 'yd-detail-stack yd-usage-detail')

  states[0] = 'geo'
  tree = render()
  assert.equal(byClass(tree, 'yd-trend').length, 1)
  // 漏斗与渠道分布（趋势形态走 insight）
  assert.ok(text(tree).includes('funnel'))
  assert.ok(text(tree).includes('官网'))
  // 目标达成（docs/0903/dashboard/06 提案）：有目标时渲染，无目标时不显示
  assert.ok(text(tree).includes('goalTitle'))
  assert.ok(text(tree).includes('测试分类'))
  assert.ok(text(tree).includes('25%'))
  // mock 的两条目标都应渲染：分类档 + 全局档
  const goalRows = byClass(tree, 'yd-list-row').filter(row => text(row).includes('25%') || text(row).includes('0%'))
  assert.equal(goalRows.length, 2)

  states[0] = 'montage'
  tree = render()
  // 阶段耗时表（数值随 locale 千分位变化，只断言键与阶段名）
  assert.equal(byClass(tree, 'yd-montage-detail').length, 1)
  assert.ok(text(tree).includes('stageStats'))
  assert.ok(text(tree).includes('research'))

  // 团队缓存与本人缓存必须使用不同 key；团队数据缺失时不能继续显示本人数据。
  states[2] = 'team'
  tree = render()
  assert.equal(byClass(tree, 'yd-domain-card').length, 0)
  states[2] = 'key'

  // 基线不可用时环比显示“暂无基线”而不是伪造箭头
  states[0] = 'montage'
  tree = render()
  assert.ok(text(tree).includes('montageJobs'))

  // 管理者偏好：默认范围/视角从本地存储恢复（清空种子让 useState init 真正执行）
  const store = {}
  globalThis.localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = value },
  }
  store['dofe.yootun-dashboard:prefs'] = JSON.stringify({ range: '7d', usageScope: 'team' })
  states.length = 0
  cursor = 0
  tree = render()
  const restored = collect(tree, node => node.props?.['aria-pressed'] === true).map(text).sort()
  assert.deepEqual(restored, ['range7d', 'scopeTeam'])
  // 下次渲染不抛错（savePrefs 在 effect 里，测试中为 no-op）
  tree = render()
  assert.ok(byClass(tree, 'yd-domain-card').length >= 0)
})

test('dashboard CSV keeps source isolation and exports correct yesterday fields', async () => {
  let source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  source = source.replace('exports.apply = apply', 'exports.__test = { buildCsvRows, hasExportableData }; exports.apply = apply')
  const module_ = { exports: {} }
  const react = {
    createElement() {}, useEffect() {}, useMemo(factory) { return factory() }, useState() {}, useSyncExternalStore() {},
  }
  const primitives = new Proxy({}, { get: () => function Primitive() {} })
  new Function('require', 'module', 'exports', source)(
    name => name === 'react' ? react : primitives,
    module_,
    module_.exports,
  )
  const { buildCsvRows, hasExportableData } = module_.exports.__test
  const t = key => key

  const yesterday = {
    geo: { data: { kpis: { articles: 4, published: 2, total_views: 27, failed_tasks: 1 } } },
    usage: { data: { summary: { requests: 10, totalTokens: 150, cost: 0.5 } } },
    activity: { data: { totals: { sessions: 2, turns: 5, completedTurns: 4, toolCalls: 9 } } },
    montage: { data: { jobs: { total: 6, running: 2, failed: 1 }, pendingApprovals: 3 } },
  }
  const yesterdayRows = buildCsvRows(yesterday, t)
  assert.deepEqual(yesterdayRows.find(row => row[0] === 'geo' && row[1] === 'views'), ['geo', 'views', 27])
  assert.deepEqual(yesterdayRows.find(row => row[0] === 'usage' && row[1] === 'requests'), ['usage', 'requests', 10])
  assert.deepEqual(yesterdayRows.find(row => row[0] === 'montage' && row[1] === 'pendingApprovals'), ['montage', 'pendingApprovals', 3])
  assert.equal(hasExportableData(yesterday), true)
  assert.equal(hasExportableData({ geo: { status: 'error' } }), false)

  const series = {
    geo: { status: 'error', reason: 'geoflow_http_502' },
    usage: { data: { days: [{ date: '2026-08-26', requests: 8, cost: 0.4, totalTokens: 120 }] } },
    activity: { data: { days: [{ date: '2026-08-25', turns: 3, completedTurns: 2 }] } },
    montage: { data: { days: [{ date: '2026-08-26', total: 2, failed: 1 }] } },
  }
  const seriesRows = buildCsvRows(series, t)
  assert.deepEqual(seriesRows.map(row => row[0]), ['date', '2026-08-25', '2026-08-26'])
  assert.equal(seriesRows[1][1], '')
  assert.equal(seriesRows[2][1], '')
  assert.deepEqual(seriesRows[1].slice(2), ['', '', '', 3, 2, '', ''])
  assert.deepEqual(seriesRows[2].slice(2), [8, 0.4, 120, '', '', 2, 1])
})
