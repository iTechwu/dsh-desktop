// 负责人筛选测试（RQ-2026-009 §6.5）：候选生成、请求参数、下拉联动。
// 纯函数（buildOwnerOptions/buildOverviewFilters/buildAccountCatalog）与
// OverviewPage 渲染经 vm 沙箱真实执行（同 ui.test.mjs evalUiModule 模式）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import * as uiFormat from '../src/ui-format.js'

async function evalOverviewModule(reactStub) {
  let source = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
  source = source.replace(/^import [\s\S]*?$/gm, '').replace(/^export /gm, '')
  const requireStub = spec => {
    if (spec === 'react') return reactStub
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { IconDownloadOutlineRegular: () => null }
    return {}
  }
  const sandbox = vm.createContext({
    require: requireStub,
    FilterSelect: function FilterSelect() { return null },
    console,
    ...uiFormat,
  })
  vm.runInContext(source, sandbox)
  return sandbox
}

test('buildOwnerOptions：非空负责人去重 + 中文 locale 排序 +「全部」恒为首项（§6.5）', async () => {
  const reactStub = { createElement: () => null }
  const sandbox = await evalOverviewModule(reactStub)
  const buildOwnerOptions = vm.runInContext('buildOwnerOptions', sandbox)
  const t = key => key
  const catalog = [
    { id: 'a1', label: '燃豚豚', workCount: 5, ownerName: ' 王五 ' },
    { id: 'a2', label: '车研社', workCount: 3, ownerName: '张三' },
    { id: 'a3', label: '号三', workCount: 0, ownerName: null },
    { id: 'a4', label: '号四', workCount: 2, ownerName: '  ' },
    { id: 'a5', label: '号五', workCount: 1, ownerName: '李四' },
    { id: 'a6', label: '号六', workCount: 1, ownerName: '张三 ' },
  ]
  const options = [...buildOwnerOptions(catalog, t).map(option => ({ ...option }))]
  // 「全部」首项 value=''；候选 trim 后去重（同名文本同一负责人）；中文拼音序。
  assert.deepEqual(options, [
    { value: '', label: 'ownerFilterAll' },
    { value: '李四', label: '李四' },
    { value: '王五', label: '王五' },
    { value: '张三', label: '张三' },
  ])
  // 空目录/全部无负责人 → 只有「全部」。
  assert.deepEqual([...buildOwnerOptions([], t).map(o => ({ ...o }))], [{ value: '', label: 'ownerFilterAll' }])
  assert.deepEqual(
    [...buildOwnerOptions([{ id: 'a', label: 'a', workCount: 0, ownerName: null }], t).map(o => ({ ...o }))],
    [{ value: '', label: 'ownerFilterAll' }],
    '全部账号未设置负责人 → 只有「全部」项')
})

test('buildOverviewFilters：ownerName 透传请求、空串不透传（§6.5）', async () => {
  const reactStub = { createElement: () => null }
  const sandbox = await evalOverviewModule(reactStub)
  const buildOverviewFilters = vm.runInContext('buildOverviewFilters', sandbox)
  // 选中负责人：请求同时带 ownerName 与 accountIds（只选负责人时 accountIds=[]）。
  const withOwner = buildOverviewFilters({ window: '30d', sort: 'hot_count', accountIds: [], ownerName: '张三' })
  assert.equal(withOwner.ownerName, '张三')
  assert.ok('accountIds' in withOwner, '请求始终携带 accountIds 字段')
  assert.ok(withOwner.publishFrom && withOwner.publishTo, '预设窗口归一为日期区间')
  // 空串（全部负责人）→ 不进请求参数。
  const allOwners = buildOverviewFilters({ window: '30d', sort: 'hot_count', accountIds: ['a1'], ownerName: '' })
  assert.equal('ownerName' in allOwners, false, "'' = 全部负责人，不进请求")
  // 自定义窗口分支同样透传。
  const custom = buildOverviewFilters({
    window: 'custom', sort: 'hot_count', accountIds: [], ownerName: '李四',
    customFrom: '2026-10-01', customTo: '2026-10-31',
  })
  assert.equal(custom.ownerName, '李四')
  assert.equal(custom.publishFrom, '2026-10-01')
  assert.equal(custom.publishTo, '2026-11-01', '排他终点 = 截止+1')
})

test('OverviewPage：负责人下拉位置、值绑定、禁用态与账号下拉联动（§6.5）', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
  }
  const sandbox = await evalOverviewModule(reactStub)
  const OverviewPage = vm.runInContext('OverviewPage', sandbox)
  const t = key => key
  const fixture = {
    summary: { accountCount: 3, workCount: 30, totalPlayCount: 50000, hotWorkCount: 3, hotRatePct: 10 },
    accounts: [
      { accountId: 'a1', nickname: '燃豚豚', sessionStatus: 'ok', fanCount: 287, workCount: 10, medianPlayCount: 1000, hotWorkCount: 2, hotRatePct: 20, engagementRatePct: 6.2 },
      { accountId: 'a2', nickname: '车研社', sessionStatus: 'ok', fanCount: 18000, workCount: 20, medianPlayCount: 2000, hotWorkCount: 1, hotRatePct: 5, engagementRatePct: 5.1 },
    ],
    accountOptions: [
      { accountId: 'a1', nickname: '燃豚豚', workCount: 10, ownerName: '张三' },
      { accountId: 'a2', nickname: '车研社', workCount: 20, ownerName: '李四' },
    ],
    accountTotal: 2,
    hotWorks: [],
  }
  const changes = []
  const renderPage = filters => {
    hLog.length = 0
    changes.length = 0
    return OverviewPage({
      overview: fixture,
      loading: true,
      errorReason: null,
      filters,
      accounts: fixture.accounts,
      collecting: false,
      exporting: false,
      onFilterChange: next => changes.push(next),
      onRefresh: () => {},
      onExport: () => {},
      onAddAccount: () => {},
      t,
    })
  }

  // 目录完整 → 负责人下拉启用；是工具栏第 4 个下拉（账号/发布时间/排序之后）。
  renderPage({ window: '30d', sort: 'hot_count', accountIds: [], ownerName: '' })
  const FilterSelectType = hLog.find(node => typeof node.type === 'function' && node.type.name === 'FilterSelect')?.type
  const selects = hLog.filter(node => node.type === FilterSelectType)
  assert.equal(selects.length, 4, '账号/发布时间/排序/负责人共 4 个下拉')
  const ownerSelect = selects[3]
  assert.equal(ownerSelect.props.value, '', '默认全部负责人')
  assert.deepEqual([...ownerSelect.props.options.map(o => ({ ...o }))], [
    { value: '', label: 'ownerFilterAll' },
    { value: '李四', label: '李四' },
    { value: '张三', label: '张三' },
  ], '候选来自完整目录去重、拼音序，「全部」首项')
  assert.equal(ownerSelect.props.disabled, false)
  // 账号下拉此时列出完整目录（含零作品标注）。
  const accountSelect = selects[0]
  assert.equal(accountSelect.props.options.length, 3, '全部账号 + 2 个目录账号')
  // 选中负责人后账号下拉只剩该负责人名下账号（§6.5 联动）。
  renderPage({ window: '30d', sort: 'hot_count', accountIds: [], ownerName: '李四' })
  const scopedAccount = hLog.filter(node => node.type === FilterSelectType)[0]
  assert.deepEqual([...scopedAccount.props.options.map(o => o.value)], ['', 'a2'], '账号下拉只列李四名下账号')
  const scopedOwner = hLog.filter(node => node.type === FilterSelectType)[3]
  assert.equal(scopedOwner.props.value, '李四', '负责人下拉受控绑定 filters.ownerName')
  // 联动重置分支：已选中 a1（张三名下）时切到李四 → a1 不在李四目录 → accountIds 重置。
  renderPage({ window: '30d', sort: 'hot_count', accountIds: ['a1'], ownerName: '' })
  const fromA1 = hLog.filter(node => node.type === FilterSelectType)[3]
  fromA1.props.onChange('李四')
  assert.equal(changes.length, 1, '切负责人单次 setState 只触发一次查询')
  assert.deepEqual([...changes[0].accountIds], [], '原选中账号不在新负责人目录 → 重置全部账号')
  assert.equal(changes[0].ownerName, '李四')
  // 联动保留分支：选中 a2（李四名下）时切到李四 → 保留账号选择。
  renderPage({ window: '30d', sort: 'hot_count', accountIds: ['a2'], ownerName: '' })
  const fromA2 = hLog.filter(node => node.type === FilterSelectType)[3]
  fromA2.props.onChange('李四')
  assert.deepEqual([...changes[0].accountIds], ['a2'], '原选中账号属新负责人 → 保留')
  // 切回「全部负责人」：单选账号与负责人独立——选中账号保留（条件分支 !value 放行）。
  renderPage({ window: '30d', sort: 'hot_count', accountIds: ['a2'], ownerName: '李四' })
  const backToAll = hLog.filter(node => node.type === FilterSelectType)[3]
  backToAll.props.onChange('')
  assert.deepEqual([...changes[0].accountIds], ['a2'])
  assert.equal(changes[0].ownerName, '')

  // 目录不完整（accountTotal 缺失）→ 负责人下拉禁用（同账号下拉口径）。
  renderPage({ ...({ window: '30d', sort: 'hot_count', accountIds: [], ownerName: '' }) })
  const incomplete = { ...fixture, accountTotal: undefined }
  hLog.length = 0
  OverviewPage({
    overview: incomplete,
    loading: true,
    errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [], ownerName: '' },
    accounts: fixture.accounts,
    collecting: false,
    exporting: false,
    onFilterChange: () => {},
    onRefresh: () => {},
    onExport: () => {},
    onAddAccount: () => {},
    t,
  })
  const disabledOwner = hLog.filter(node => node.type === FilterSelectType)[3]
  assert.equal(disabledOwner.props.disabled, true, '目录不完整 → 负责人下拉禁用')
})

test('总览导出参数收敛（审查 P0-2）：sort/ownerName 不透传、负责人解析为 accountIds', async () => {
  // exportOverview 的源码契约：douyin_overview_export DTO（extra=forbid）只接受
  // accountIds/publishFrom/publishTo/ruleVersion——展示参数在客户端剥离，负责人
  // 筛选基于完整目录解析为 accountIds（与已选账号取交集），宿主再兜底白名单。
  const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const exportBody = clientSource.slice(
    clientSource.indexOf('const exportOverview = useCallback'),
    clientSource.indexOf('const changeOverviewFilters = useCallback'),
  )
  assert.match(exportBody, /const filters = buildOverviewFilters\(overviewFilters\)/u)
  assert.match(exportBody, /delete filters\.sort\n      delete filters\.ownerName/u)
  assert.match(exportBody, /const owned = buildAccountCatalog\(overview\)\n          \.filter\(item => typeof item\.ownerName === 'string' && item\.ownerName\.trim\(\) === ownerName\)\n          \.map\(item => item\.id\)/u)
  assert.match(exportBody, /const merged = picked\.length \? owned\.filter\(id => picked\.includes\(id\)\) : owned/u)
  // 负责人在目录下无账号（防御）→ 不发请求，绝不静默按「全部账号」扩大导出范围。
  assert.match(exportBody, /if \(!merged\.length\) \{\n          setError\('exportFailed'\)\n          return\n        \}/u)
  // 宿主 handleOverviewExport 按 schema 重建参数：projectOverviewArgs 的总览查询
  // 白名单（含 sort/ownerName/topN 等）不能复用到 export。
  const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  const handlerBody = indexSource.slice(
    indexSource.indexOf('async function handleOverviewExport'),
    indexSource.indexOf('// 单账号分析与趋势'),
  )
  assert.ok(!/projectOverviewArgs\(body\)/.test(handlerBody), '导出不再复用总览查询白名单')
  assert.match(handlerBody, /if \(ids\.length\) args\.accountIds = ids/u)
  assert.match(handlerBody, /if \(publishFrom\) args\.publishFrom = publishFrom/u)
  assert.match(handlerBody, /if \(ruleVersion\) args\.ruleVersion = ruleVersion/u)
  for (const forbidden of ['args.sort', 'args.ownerName', 'args.topN', 'args.cursor', 'args.limit', 'args.hotType']) {
    assert.ok(!handlerBody.includes(forbidden), `导出参数不含 ${forbidden}（schema 外字段会被 UnknownArgsGuard 拒绝）`)
  }
})
