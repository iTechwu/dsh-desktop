// 发布排期看板 UI 测试（RQ-2026-013 开发文档 §13.3 / 验收 P3-U 系列）。
//
// 渲染方式与 material-ui.test.mjs 同法：剥离 export 后在 vm 上下文求值，
// createElement 返回普通对象树，递归断言（SchedulePage 为无 hooks 纯函数）。
// 状态机行为经纯决策函数（canSwitchAccount/deleteAllowed/rowStatusOnFailure/
// mergeDirtyPatch/dirtyResubmitNeeded/compareRowId/buildServerSnapshot）真实
// 测试；异步编排（client.js）以源码契约断言锚定（构建产物真渲染由
// render-smoke.test.mjs 兜底）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const scheduleSource = (await readFile(new URL('../src/schedule-ui.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '')
const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')

const context = {
  require: name => {
    assert.equal(name, 'react')
    return { createElement: (type, props, ...children) => ({ type, props, children: children.flat() }) }
  },
}
vm.createContext(context)
vm.runInContext(scheduleSource, context)
const {
  SCHEDULE_BUSINESS_HEADERS,
  SCHEDULE_ERROR_REASON_COPY,
  SCHEDULE_PLATFORMS,
  SchedulePage,
  buildServerSnapshot,
  canSwitchAccount,
  compareRowId,
  createRowState,
  deleteAllowed,
  dirtyResubmitNeeded,
  mergeDirtyPatch,
  rowHasPendingWork,
  rowStatusMeta,
  rowStatusOnFailure,
  refreshScheduleBlocked,
  restoreUiRowFromServerSnapshot,
  savedSnapshotChanged,
  scheduleErrorCopy,
  toUiRow,
  comparePublishDate,
  partitionScheduleRows,
  sortScheduleRows,
} = vm.runInContext('({ ' + [
  'SCHEDULE_BUSINESS_HEADERS', 'SCHEDULE_ERROR_REASON_COPY', 'SCHEDULE_PLATFORMS', 'SchedulePage',
  'buildServerSnapshot', 'canSwitchAccount', 'compareRowId',
  'createRowState', 'deleteAllowed', 'dirtyResubmitNeeded', 'mergeDirtyPatch',
  'rowHasPendingWork', 'rowStatusMeta', 'rowStatusOnFailure', 'restoreUiRowFromServerSnapshot',
  'refreshScheduleBlocked',
  'savedSnapshotChanged',
  'scheduleErrorCopy', 'toUiRow',
  'comparePublishDate', 'partitionScheduleRows', 'sortScheduleRows',
].join(', ') + ' })', context)

// 递归收集元素树中的字符串与 className。
function collectStrings(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) node.forEach(item => collectStrings(item, out))
  else if (node && typeof node === 'object') {
    if (node.props) {
      for (const value of Object.values(node.props || {})) collectStrings(value, out)
    }
    if (node.children) collectStrings(node.children, out)
  }
  return out
}

function collectClasses(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach(item => collectClasses(item, out))
  } else if (node && typeof node === 'object') {
    const cls = node.props && node.props.className
    if (typeof cls === 'string') out.push(...cls.split(' '))
    if (node.children) collectClasses(node.children, out)
  }
  return out
}

const noop = () => {}
const baseActions = {
  onBoardRetry: noop, onCreate: noop, onBlurCell: noop, onCheckbox: noop,
  onPlatformToggle: noop, onDelete: noop, onConfirmDelete: noop, onCancelDelete: noop,
  onSwitchAccount: noop, onRetry: noop, onDiscard: noop, onRefresh: noop, focusRef: noop,
}

const ACCOUNTS = [
  { accountId: 'acc-b', nickname: '包姐', deleteState: 'none', fanCount: 120, ownerName: '包姐' },
  { accountId: 'acc-p', nickname: '保罗', deleteState: 'none', fanCount: null, ownerName: null },
]

function sampleRow(overrides = {}) {
  return toUiRow({
    id: '2',
    account_id: 'acc-b',
    shooting_date: '2026-11-18',
    video_content: '踏板好物分享',
    shooting_status: true,
    published: false,
    asset_link: 'https://pan.example.com/s/abc',
    note: null,
    publish_date: '2026-11-20',
    publish_platforms: ['douyin'],
    shooting_owner: '包姐',
    editing_owner: null,
    row_version: 3,
    created_by: 'member-a',
    updated_by: 'member-b',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 投影与表头契约（P3-U02/P3-U03/§8.3）
// ---------------------------------------------------------------------------

test('表格视觉列 = 序号 + 10 业务列 + 操作，共 12 个（P3-U02/U03）', () => {
  assert.equal(SCHEDULE_BUSINESS_HEADERS.length, 10)
  const html = collectStrings(
    SchedulePage({
      loading: false, errorReason: null, accounts: ACCOUNTS, activeAccountId: 'acc-b',
      rows: [], rowStates: {}, hint: null, creating: false, deleteTarget: null,
      deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
      renderAvatar: noop, actions: baseActions,
    }),
  )
  for (const header of ['序号', ...SCHEDULE_BUSINESS_HEADERS.map(item => item.label), '操作']) {
    assert.ok(html.includes(header), `missing header ${header}`)
  }
  // 业务列顺序完全一致（AC-02：文案与顺序不可变）；vm realm 数组拷回宿主后比较
  const labels = [...SCHEDULE_BUSINESS_HEADERS].map(item => item.label)
  assert.deepEqual(labels, [
    '拍摄日期', '视频内容', '拍摄情况', '是否发布', '成片/封面网盘链接',
    '备注', '发布日期', '发布平台', '拍摄负责人', '剪辑负责人',
  ])
  assert.equal(SCHEDULE_BUSINESS_HEADERS[2].sub, '（需要补拍或配音在下方补充）')
  assert.equal(SCHEDULE_BUSINESS_HEADERS[4].sub, '（编导和账号主理人确认）')
})

test('toUiRow 投影为 UI camelCase 并丢弃 created_by/updated_by（§8.3/§12）', () => {
  const row = sampleRow()
  assert.equal(row.rowId, '2')
  assert.equal(row.rowVersion, '3')
  assert.equal(row.publishPlatforms.join(','), 'douyin')
  const text = JSON.stringify(row)
  assert.ok(!text.includes('created_by') && !text.includes('createdBy'))
  assert.ok(!text.includes('updated_by') && !text.includes('updatedBy'))
  // 非 http(s) 平台值不出现在 UI 投影（防御性过滤）
  const filtered = toUiRow({ id: '9', publish_platforms: ['douyin', 'tiktok'] })
  assert.equal(JSON.stringify(filtered.publishPlatforms), JSON.stringify(['douyin']))
})

test('rowId 十进制字符串比较不走 Number（§9.3 / §13.3 第 19 项）', () => {
  const bigA = (Number.MAX_SAFE_INTEGER + 1).toString() // 9007199254740992
  const bigB = '9007199254740993'
  assert.equal(compareRowId(bigA, bigB), -1) // Number 化会相等，字符串比较正确区分
  assert.equal(compareRowId('9', '10'), -1)  // 长度优先：9 < 10
  assert.equal(compareRowId('42', '42'), 0)
  assert.equal(compareRowId('100', '99'), 1)
})

test('buildServerSnapshot：strip 空转 null、平台白名单重读去重固定顺序（§9.6）', () => {
  const snapshot = buildServerSnapshot(sampleRow({
    video_content: '  内容  ', note: '   ', asset_link: ' https://pan.example.com/x ',
    shooting_owner: ' 包姐 ', editing_owner: '',
    publish_platforms: ['wx_channels', 'douyin', 'xhs', 'douyin', 'tiktok'],
  }))
  assert.equal(snapshot.videoContent, '内容')
  assert.equal(snapshot.note, null)
  assert.equal(snapshot.assetLink, 'https://pan.example.com/x')
  assert.equal(snapshot.shootingOwner, '包姐')
  assert.equal(snapshot.editingOwner, null)
  assert.equal(snapshot.shootingDate, '2026-11-18')
  assert.equal(JSON.stringify(snapshot.publishPlatforms), JSON.stringify(['xhs', 'douyin', 'wx_channels']))
  const empty = buildServerSnapshot(sampleRow({ shooting_date: '', publish_date: '' }))
  assert.equal(empty.shootingDate, null)
  assert.equal(empty.publishDate, null)
})

// ---------------------------------------------------------------------------
// 行状态机纯决策（P3-U13~U16/U18/U23/U24）
// ---------------------------------------------------------------------------

test('失败原因 → 行状态映射（unknown/conflict/failed，§9.4 第 5-7 条）', () => {
  assert.equal(rowStatusOnFailure('IDEMPOTENCY_OUTCOME_UNKNOWN'), 'unknown')
  assert.equal(rowStatusOnFailure('SCHEDULE_ROW_CONFLICT'), 'conflict')
  assert.equal(rowStatusOnFailure('SCHEDULE_VALIDATION_ERROR'), 'failed')
  assert.equal(rowStatusOnFailure('douyin_operation_request_failed'), 'failed')
})

test('conflict/unknown 行输入只读；saving 行显示 saving 类（P3-U18/U19）', () => {
  assert.equal(rowStatusMeta(createRowState('1')).locked, false)
  assert.equal(rowStatusMeta({ ...createRowState('1'), status: 'conflict' }).locked, true)
  assert.equal(rowStatusMeta({ ...createRowState('1'), status: 'unknown' }).locked, true)
  const savingMeta = rowStatusMeta({ ...createRowState('1'), status: 'saving' })
  assert.equal(savingMeta.rowClass, 'ydo-schedule-row-saving')
  assert.equal(rowStatusMeta({ ...createRowState('1'), status: 'failed' }).rowClass, 'ydo-schedule-row-error')
})

test('dirty 队列：saving 中编辑合并进待提交快照，不产生第二个请求载体（P3-U16）', () => {
  let state = { ...createRowState('2'), status: 'saving', idempotencyKey: 'k1' }
  state = { ...state, dirtySnapshot: mergeDirtyPatch(state, 'videoContent', '第二次编辑') }
  state = { ...state, dirtySnapshot: mergeDirtyPatch(state, 'note', '补充') }
  // vm realm 对象用 JSON 比较避免跨 realm 原型差异
  assert.equal(JSON.stringify(state.dirtySnapshot), JSON.stringify({ videoContent: '第二次编辑', note: '补充' }))
  // idle 编辑不产生 dirty（空补丁对象）
  assert.deepEqual({ ...mergeDirtyPatch({ ...createRowState('1'), status: 'idle' }, 'note', 'x') }, { note: 'x' })
})

test('成功落库后：版本被覆盖为服务器 row_version，仍有差异才用新键补提交（P3-U17）', () => {
  const serverRow = sampleRow({ row_version: 4 }) // toUiRow → '4'
  assert.equal(serverRow.rowVersion, '4')
  // dirty 与服务器行一致 → 不补提交
  const mergedSame = { ...serverRow, videoContent: serverRow.videoContent }
  assert.equal(dirtyResubmitNeeded(serverRow, mergedSame), false)
  // dirty 与服务器行不一致 → 用新键提交一次
  const mergedDiff = { ...serverRow, videoContent: '保存期间又改了' }
  assert.equal(dirtyResubmitNeeded(serverRow, mergedDiff), true)
  // 源码契约：成功路径用服务器 rowVersion 重建行状态（§9.4 第 1 条）
  assert.ok(
    clientSource.includes('createRowState(serverRow.rowVersion, buildServerSnapshot(serverRow))'),
    '成功后应以服务器版本和最新保存快照重建行状态',
  )
})

test('保存与删除互斥：非 idle 行禁删；delete 在途禁删（P3-U23）', () => {
  const idle = createRowState('1')
  assert.equal(deleteAllowed(idle, false), true)
  assert.equal(deleteAllowed(idle, true), false)
  for (const status of ['saving', 'queued', 'unknown', 'conflict', 'failed']) {
    assert.equal(deleteAllowed({ ...idle, status }, false), false, status)
  }
  // 源码契约：删除在途时整表按钮禁用（deleteInFlight 由 deleteBusy 驱动）
  assert.ok(clientSource.includes('setScheduleDeleteBusy(true)'), '删除在途应有 busy 标记')
})

test('账号切换互斥：saving/queued/unknown 禁止；failed/conflict 持 dirty 禁止（P3-U24）', () => {
  const idle = createRowState('1')
  assert.equal(canSwitchAccount({ a: idle }), true)
  for (const status of ['saving', 'queued', 'unknown']) {
    assert.equal(canSwitchAccount({ a: { ...idle, status } }), false, status)
  }
  // failed/conflict 但无未提交修改 → 允许切换
  assert.equal(canSwitchAccount({ a: { ...idle, status: 'failed', dirtySnapshot: null } }), true)
  assert.equal(canSwitchAccount({ a: { ...idle, status: 'conflict', dirtySnapshot: null } }), true)
  // failed/conflict 持有 dirty → 禁止
  assert.equal(canSwitchAccount({ a: { ...idle, status: 'failed', dirtySnapshot: { note: 'x' } } }), false)
  assert.equal(canSwitchAccount({ a: { ...idle, status: 'conflict', dirtySnapshot: { note: 'x' } } }), false)
  assert.equal(rowHasPendingWork({ ...idle, status: 'saving' }), true)
  // 源码契约：切换前调用 canSwitchAccount
  assert.ok(clientSource.includes('canSwitchAccount(scheduleRowStatesRef.current)'), '切换账号应检查行状态互斥')
})

test('错误码 → 中文文案（P3-U25 copy 项）', () => {
  assert.equal(scheduleErrorCopy('SCHEDULE_ROW_CONFLICT'), '数据已被更新，请刷新后重新编辑')
  assert.equal(scheduleErrorCopy('SCHEDULE_ROW_NOT_FOUND'), '排期行不存在或已被删除，请刷新列表')
  assert.equal(scheduleErrorCopy('SCHEDULE_VALIDATION_ERROR'), SCHEDULE_ERROR_REASON_COPY.SCHEDULE_VALIDATION_ERROR)
  assert.equal(scheduleErrorCopy('IDEMPOTENCY_OUTCOME_UNKNOWN'), SCHEDULE_ERROR_REASON_COPY.IDEMPOTENCY_OUTCOME_UNKNOWN)
  assert.equal(scheduleErrorCopy('ACCOUNT_NOT_ACCESSIBLE'), SCHEDULE_ERROR_REASON_COPY.ACCOUNT_NOT_ACCESSIBLE)
  assert.equal(scheduleErrorCopy('random_code'), '操作失败，请稍后重试')
})

// ---------------------------------------------------------------------------
// 页面渲染（P3-U07/U08 空态、账号栏、删除确认）
// ---------------------------------------------------------------------------

test('无有效账号：只展示空态，隐藏表格与新增入口（P3-U07）', () => {
  const html = SchedulePage({
    loading: false, errorReason: null, accounts: [], activeAccountId: null,
    rows: [], rowStates: {}, hint: null, creating: false, deleteTarget: null,
    deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
    renderAvatar: noop, actions: baseActions,
  })
  const text = collectStrings(html).join('')
  assert.ok(text.includes('暂无抖音账号，请先在抖音工作台中添加账号'))
  const classes = collectClasses(html)
  assert.ok(!classes.includes('ydo-schedule-table'), '空账号态不得渲染表格')
  assert.ok(!classes.includes('ydo-schedule-actions'), '空账号态不得渲染新增入口')
})

test('初始加载/账号列表失败保持 shell，不冒充无账号（真机验收 d review P1-1）', () => {
  const base = { errorReason: null, activeAccountId: null, rows: [], rowStates: {}, hint: null,
    creating: false, deleteTarget: null, deleteBusy: false, deleteTargetSequence: null,
    ownerSuggestions: [], focusRowId: null, renderAvatar: noop, actions: baseActions }
  const loadingHtml = SchedulePage({ ...base, loading: true, accounts: [] })
  const loadingText = collectStrings(loadingHtml).join('')
  const loadingClasses = collectClasses(loadingHtml).join(' ')
  assert.ok(!loadingText.includes('暂无抖音账号，请先'), 'loading 不得冒充无账号')
  assert.ok(loadingText.includes('加载中…'))
  assert.ok(loadingClasses.includes('ydo-schedule-actions') && loadingClasses.includes('ydo-schedule-table'))

  const errorHtml = SchedulePage({ ...base, loading: false, accounts: [], errorReason: 'douyin_operation_request_failed' })
  const errorText = collectStrings(errorHtml).join('')
  assert.ok(!errorText.includes('暂无抖音账号，请先'), '账号列表失败不得冒充无账号')
  assert.ok(errorText.includes('请求失败，请检查网络后重试') && errorText.includes('重试'))
})

test('空排期展示引导文案；账号栏 chip 选中态可区分（P3-U08/AC-03）', () => {
  const html = SchedulePage({
    loading: false, errorReason: null, accounts: ACCOUNTS, activeAccountId: 'acc-b',
    rows: [], rowStates: {}, hint: null, creating: false, deleteTarget: null,
    deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
    renderAvatar: noop, actions: baseActions,
  })
  const text = collectStrings(html).join('')
  assert.ok(text.includes('暂无排期，点击新增行开始录入'))
  assert.ok(!text.includes('当前账号：'), '顶部不再重复当前账号')
  assert.ok(!text.includes('就绪'), '顶部不再显示就绪占位')
  assert.ok(!text.includes('除序号由系统生成外'), '表格上方说明文案已删除')
  assert.ok(text.includes('保罗'))
  assert.ok(text.includes('刷新'), '工具栏应提供常驻刷新入口（放弃修改刷新失败可达）')
  // aria-pressed 区分选中态（渲染树 props 断言）
  const pressed = []
  ;(function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && typeof node === 'object') {
      if (node.props && 'aria-pressed' in node.props) pressed.push(node.props['aria-pressed'])
      if (node.children) walk(node.children)
    }
  })(html)
  assert.ok(pressed.includes(true), '选中 chip 应有 aria-pressed=true')
  assert.ok(pressed.includes(undefined) || pressed.includes(false), '未选中 chip 无选中态')
})

test('工具栏常驻刷新按钮在 loading/creating 时禁用（P3-015 回归）', () => {
  const buildPage = ({ loading, creating }) => SchedulePage({
    loading, errorReason: null, accounts: ACCOUNTS, activeAccountId: 'acc-b',
    rows: [sampleRow()], rowStates: {}, hint: null, creating, deleteTarget: null,
    deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
    renderAvatar: noop, actions: baseActions,
  })
  const actionsIdx = scheduleSource.indexOf("className: 'ydo-schedule-actions'")
  const actionsBody = scheduleSource.slice(actionsIdx, actionsIdx + 900)
  assert.ok(actionsBody.includes("onClick: actions.onBoardRetry"), '刷新按钮应绑定 onBoardRetry')
  assert.ok(
    /disabled:\s*loading\s*\|\|\s*creating(\s*\|\|\s*deleteBusy)?\s*\|\|\s*undefined/.test(actionsBody),
    '刷新按钮在 loading 或 creating 时禁用',
  )
  assert.ok(actionsBody.includes("'刷新'"), '工具栏刷新入口存在')
  const loadingHtml = collectStrings(buildPage({ loading: true, creating: false })).join('')
  const idleHtml = collectStrings(buildPage({ loading: false, creating: false })).join('')
  assert.ok(loadingHtml.includes('刷新中…') && idleHtml.includes('刷新'), '刷新入口随 loading 状态切换')
})

test('刷新与切换账号使用同一表格刷新机制（真机验收 f）', () => {
  const refreshIdx = clientSource.indexOf('const refreshScheduleBoard')
  const refreshBody = clientSource.slice(refreshIdx, clientSource.indexOf('const editScheduleCell', refreshIdx))
  assert.ok(refreshBody.includes('applyScheduleRows([])'), '刷新先清空表格旧数据')
  assert.ok(refreshBody.includes('applyScheduleRowStates({})'), '刷新先清空表格行状态')
  assert.ok(refreshBody.includes('loadScheduleRows(scheduleAccountIdRef.current)'), '刷新当前账号排期')
  const switchIdx = clientSource.indexOf('const switchScheduleAccount')
  const switchBody = clientSource.slice(switchIdx, clientSource.indexOf('const createScheduleRow', switchIdx))
  assert.ok(switchBody.includes('applyScheduleRows([])') && switchBody.includes('applyScheduleRowStates({})'))
  assert.ok(switchBody.includes('loadScheduleRows(accountId)'))
})

test('刷新阻塞 saving/queued/dirty 行，不阻塞 unknown/conflict 的无 dirty 恢复（review P1-2）', () => {
  const idle = createRowState('1')
  assert.equal(refreshScheduleBlocked({ a: idle }, false), false)
  assert.equal(refreshScheduleBlocked({ a: { ...idle, status: 'unknown' } }, false), false)
  assert.equal(refreshScheduleBlocked({ a: { ...idle, status: 'conflict' } }, false), false)
  for (const status of ['saving', 'queued']) {
    assert.equal(refreshScheduleBlocked({ a: { ...idle, status } }, false), true, status)
  }
  assert.equal(refreshScheduleBlocked({ a: { ...idle, status: 'failed', dirtySnapshot: { note: 'x' } } }, false), true)
  assert.equal(refreshScheduleBlocked({ a: { ...idle, status: 'unknown', dirtySnapshot: { note: 'x' } } }, false), true)
  assert.equal(refreshScheduleBlocked({}, true), true)
  const refreshIdx = clientSource.indexOf('const refreshScheduleBoard')
  const refreshBody = clientSource.slice(refreshIdx, clientSource.indexOf('const editScheduleCell', refreshIdx))
  assert.ok(refreshBody.includes('refreshScheduleBlocked(scheduleRowStatesRef.current, scheduleDeleteBusy)'))
})

test('真机修复：按钮左置、勾选统一样式、删除提示与切号清焦（2026-11-17）', () => {
  assert.ok(clientSource.includes('.ydo-schedule-actions{margin-right:auto;margin-left:0'))
  assert.ok(
    clientSource.includes('.ydo-schedule-checkbox input,.ydo-schedule-platform-group input{width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}'),
    '拍摄情况/是否发布与发布平台复选框样式一致',
  )
  assert.ok(
    !clientSource.includes('.ydo-schedule-checkbox input:checked::after{\n  border-color:#fff;\n}'),
    '不再使用自绘白色勾',
  )
  assert.ok(scheduleSource.includes('确认删除：'), '删除弹框确认文案前缀正确')
  assert.ok(scheduleSource.includes('deleteTargetContent'), '删除弹框显示视频内容')
  assert.ok(scheduleSource.includes('未填写视频内容'), '空视频内容有兜底文案')
  assert.ok(scheduleSource.includes('删除后数据不可恢复。'), '删除风险文案已更新')
  assert.ok(!scheduleSource.includes('删除后数据库记录同步删除'))

  const switchIdx = clientSource.indexOf('const switchScheduleAccount')
  const switchBody = clientSource.slice(switchIdx, clientSource.indexOf('const createScheduleRow', switchIdx))
  assert.ok(switchBody.includes('setScheduleFocusRowId(null)'), '切换账号清除默认聚焦')
})

test('加载失败展示错误态与重试（§5.3 空态表）', () => {
  const html = SchedulePage({
    loading: false, errorReason: 'SCHEDULE_ROW_CONFLICT', accounts: ACCOUNTS, activeAccountId: 'acc-b',
    rows: [], rowStates: {}, hint: null, creating: false, deleteTarget: null,
    deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
    renderAvatar: noop, actions: baseActions,
  })
  const text = collectStrings(html).join('')
  assert.ok(text.includes('数据已被更新，请刷新后重新编辑'))
  assert.ok(text.includes('重试'))
  const classes = collectClasses(html)
  for (const className of ['ydo-schedule-actions', 'ydo-schedule-table', 'ydo-schedule-account-chip']) {
    assert.ok(classes.includes(className), `加载/错误时保留 ${className}`)
  }
  const loadingHtml = SchedulePage({
    loading: true, errorReason: null, accounts: ACCOUNTS, activeAccountId: 'acc-b',
    rows: [], rowStates: {}, hint: null, creating: false, deleteTarget: null,
    deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
    renderAvatar: noop, actions: baseActions,
  })
  const loadingText = collectStrings(loadingHtml).join('')
  const loadingClasses = collectClasses(loadingHtml)
  assert.ok(loadingText.includes('加载中…'), '加载状态显示在表格区')
  for (const className of ['ydo-schedule-actions', 'ydo-schedule-table', 'ydo-schedule-account-chip']) {
    assert.ok(loadingClasses.includes(className), `加载状态保留 ${className}`)
  }
})

test('负责人输入不复用已有数据建议，由用户手填（真机验收 4）', () => {
  const html = SchedulePage({
    loading: false, errorReason: null, accounts: ACCOUNTS, activeAccountId: 'acc-b',
    rows: [sampleRow({ shooting_owner: '阿泽', editing_owner: '保罗' })], rowStates: {}, hint: null,
    creating: false, deleteTarget: null, deleteBusy: false, deleteTargetSequence: null,
    ownerSuggestions: [], focusRowId: null, renderAvatar: noop, actions: baseActions,
  })
  const text = collectStrings(html).join('')
  assert.ok(!text.includes('ydo-schedule-owner-options'))
  assert.ok(!scheduleSource.includes("list: 'ydo-schedule-owner-options'"), '拍摄/剪辑负责人不得绑定 datalist')
  assert.ok(!scheduleSource.includes('collectOwnerSuggestions'))
  assert.ok(!clientSource.includes('collectOwnerSuggestions'))
  assert.ok(!clientSource.includes('ownerSuggestions: collectOwnerSuggestions'))
})

// ---------------------------------------------------------------------------
// client.js 源码契约（创建/编辑/删除/账号切换编排）
// ---------------------------------------------------------------------------

test('创建流：服务端成功才 append，失败不插伪行；unknown 按账号保留 create 键重试（P3-U09/U10/P3-016）', () => {
  // append 在 result.status === 'ready' 之后
  const createFn = clientSource.slice(
    clientSource.indexOf('const createScheduleRow'),
    clientSource.indexOf('const createScheduleRow') + 4600,
  )
  assert.ok(createFn.includes("applyScheduleRows(prev => [...prev, row])"), '成功才追加本地行')
  assert.ok(
    createFn.indexOf("result.status !== 'ready'") > -1,
    'create 失败路径存在且不调用 applyScheduleRows',
  )
  assert.ok(
    createFn.includes('scheduleCreateRetryKeysRef.current[accountId] = key'),
    'unknown 保留当前账号 create 键',
  )
  assert.ok(
    createFn.includes('delete scheduleCreateRetryKeysRef.current[accountId]'),
    '发起时先摘除旧键，成功/确定性失败后不复用',
  )
  assert.ok(
    createFn.includes('createRowState(row.rowVersion, buildServerSnapshot(row))'),
    'create 成功后新行状态必须初始化 lastSavedSnapshot（P3-011/P1-1）',
  )
})

test('失焦/勾选/平台三入口都在 idle 时发起整行保存（P3-U11/U14/U15）', () => {
  for (const fn of ['handleScheduleBlur', 'handleScheduleCheckbox', 'handleSchedulePlatformToggle']) {
    const idx = clientSource.indexOf(`const ${fn}`)
    assert.ok(idx > -1, fn)
    const body = clientSource.slice(idx, clientSource.indexOf('}, [', idx))
    assert.ok(body.includes("performScheduleSaveRef.current(rowId)"), `${fn} idle 应发起保存`)
  }
  // 平台切换固定顺序重排（与 tools DTO 同口径）
  const toggleIdx = clientSource.indexOf('const handleSchedulePlatformToggle')
  const toggleBody = clientSource.slice(toggleIdx, clientSource.indexOf('}, [', toggleIdx))
  assert.ok(toggleBody.includes('SCHEDULE_PLATFORMS.map'), '平台顺序由 SCHEDULE_PLATFORMS 固定序承载')
})

test('no-op 失焦不发送保存、不递增版本；内容变化才保存（P3-011）', () => {
  const row = sampleRow()
  const saved = buildServerSnapshot(row)
  const state = createRowState(row.rowVersion, saved)
  assert.equal(savedSnapshotChanged(row, state), false)
  assert.equal(savedSnapshotChanged({ ...row, note: '新增备注' }, state), true)
  // trim/空串归一后相等也视为 no-op。
  assert.equal(savedSnapshotChanged({ ...row, note: '  ' }, state), false)
  const saveFn = clientSource.slice(
    clientSource.indexOf('const performScheduleSave'),
    clientSource.indexOf('const handleScheduleBlur'),
  )
  assert.ok(saveFn.includes('!savedSnapshotChanged(row, state)'), 'idle no-op 应直接 return')
})

test('放弃修改先还原最近服务端快照，再刷新（P2-1）', () => {
  const discardIdx = clientSource.indexOf('const discardScheduleRow')
  const discardHead = clientSource.slice(discardIdx, clientSource.indexOf('const row =', discardIdx))
  assert.ok(discardHead.includes('if (scheduleCreatingRef.current)'), '放弃修改共用 create 在途守卫')
  assert.ok(discardHead.includes('正在新增行，请等待完成后再操作'), 'create 在途时放弃修改被拒绝')
  const row = sampleRow({ note: '未保存修改' })
  const snapshot = buildServerSnapshot(sampleRow())
  const restored = restoreUiRowFromServerSnapshot(row, snapshot)
  assert.equal(restored.note, '')
  assert.equal(restored.videoContent, sampleRow().videoContent)
  assert.deepEqual(buildServerSnapshot(restored), snapshot)

  const discardFn = clientSource.slice(
    clientSource.indexOf('const discardScheduleRow'),
    clientSource.indexOf('const switchScheduleAccount'),
  )
  assert.ok(discardFn.includes('restoreUiRowFromServerSnapshot(item, savedSnapshot)'), '先还原行内容')
  assert.ok(discardFn.includes('createRowState((prev[rowId] || {}).expectedVersion || \'1\', savedSnapshot)'), '状态保留 saved snapshot')
  assert.ok(discardFn.includes('await loadScheduleRows(accountId)'), '等待刷新结果并反馈')
})

test('create 在途阻止页面误关闭/刷新（P3-015）', () => {
  assert.ok(clientSource.includes('if (!scheduleCreating) return undefined'), 'create 在途才挂 beforeunload')
  assert.ok(clientSource.includes("window.addEventListener('beforeunload', beforeUnload)"), '注册 beforeunload')
  const refreshIdx = clientSource.indexOf('const refreshScheduleBoard')
  const refreshBody = clientSource.slice(refreshIdx, clientSource.indexOf('const editScheduleCell', refreshIdx))
  assert.ok(refreshBody.includes('if (scheduleCreatingRef.current)'), '行级/工具栏刷新共用 create 在途守卫')
  assert.ok(refreshBody.includes('正在新增行，请等待完成后再刷新'), '刷新被守卫时给出可读提示')
})

test('删除确认：只在 idle 打开，确认后带 confirm/expectedVersion/新键调用（P3-U21）', () => {
  assert.ok(clientSource.includes("state.status !== 'idle'"), '非 idle 打开删除被拒绝')
  const delIdx = clientSource.indexOf('const performScheduleDelete')
  const delBody = clientSource.slice(delIdx, clientSource.indexOf('}, [', delIdx))
  assert.ok(delBody.includes("action: 'schedule.rowDelete'"))
  assert.ok(delBody.includes('confirm: true'))
  assert.ok(delBody.includes('expectedVersion: Number(state.expectedVersion)'))
  // 成功后直接清除行与状态，不复用旧 version（§9.4 第 4 条）
  assert.ok(delBody.includes('delete next[rowId]'))
})

test('账号栏数据源：只保留 deleteState none，默认选中过滤后第一个（P3-U04/U05）', () => {
  assert.ok(clientSource.includes("account.deleteState === 'none'"), '墓碑过滤')
  assert.ok(clientSource.includes('const preferred = active.find'), '优先保留当前选中账号')
  assert.ok(clientSource.includes('const first = preferred || active[0]'), '默认第一个有效账号')
  // Host accounts.list 已过滤 remote_deleted 墓碑，client 再过滤其余 delete_state
  assert.ok(indexSource.includes("cleanString(item.delete_state, 24) === 'remote_deleted'"), 'Host 过滤 remote_deleted')
})

test('样式白名单：新增 className 严格限定 ydo-schedule-* 清单，无 demo-note、无内联样式（P3-U26）', async () => {
  const scheduleModuleSource = await readFile(new URL('../src/schedule-ui.js', import.meta.url), 'utf8')
  const WHITELIST = new Set([
    'ydo-schedule-page',
    'ydo-schedule-actions', 'ydo-schedule-table', 'ydo-schedule-sequence-cell',
    'ydo-schedule-cell-input', 'ydo-schedule-cell-textarea', 'ydo-schedule-checkbox',
    'ydo-schedule-checkbox-label', 'ydo-schedule-platform-group', 'ydo-schedule-empty',
    'ydo-schedule-account-bar', 'ydo-schedule-account-bar-label', 'ydo-schedule-account-chip',
    'ydo-schedule-account-text', 'ydo-schedule-account-name', 'ydo-schedule-account-meta',
    'ydo-schedule-delete-cell', 'ydo-schedule-delete-button', 'ydo-schedule-row-saving',
    'ydo-schedule-row-error', 'ydo-schedule-toggle-row', 'ydo-schedule-row-published',
    'ydo-schedule-row-striped',
  ])
  for (const [name, source] of [['schedule-ui.js', scheduleModuleSource], ['client.js 排期样式段', clientSource]]) {
    const found = [...source.matchAll(/className:\s*[`'"]([^`'"]+)[`'"]/g)]
      .flatMap(match => match[1].split(/\s+/))
      .filter(name => name.startsWith('ydo-schedule'))
    const unknown = [...new Set(found)].filter(name => !WHITELIST.has(name))
    assert.deepEqual(unknown, [], `${name} 出现白名单外 ydo-schedule-* 类`)
  }
  // demo 专属类不得进入生产
  assert.ok(!scheduleModuleSource.includes('ydo-schedule-demo-note'))
  assert.ok(!clientSource.includes('ydo-schedule-demo-note'))
  // 排期 JSX 无内联 style（col 用 width 属性而非 style）
  for (const line of scheduleModuleSource.split('\n')) {
    if (line.includes('ydo-schedule') || line.includes('ScheduleRow') || line.includes('SchedulePage')) {
      assert.ok(!/\bstyle:\s*[`'"{]/.test(line), `排期 JSX 无内联 style：${line.trim().slice(0, 60)}`)
    }
  }
  // 白名单中每个类都在共享 CSS 中定义；CSS 只用 --dsw-*/--dsh-* 变量
  const cssStart = clientSource.indexOf('/* 发布排期看板（RQ-2026-013 §10）')
  const cssEnd = clientSource.indexOf('`;')
  const scheduleCss = clientSource.slice(cssStart, cssEnd > cssStart ? cssEnd : undefined)
  for (const name of WHITELIST) {
    assert.ok(scheduleCss.includes(`.${name}`), `.${name} 应在共享 CSS 中定义`)
  }
  assert.ok(!scheduleCss.includes('ydo-schedule-demo-note'), '生产 CSS 不含 demo-note')
  const offendingColors = (scheduleCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [])
    .filter(color => color.toLowerCase() !== '#fff')
  assert.deepEqual(offendingColors, [], '排期 CSS 只允许白色勾选固定色，其余使用主题变量')
  assert.ok(scheduleCss.includes('grid-template-rows:auto minmax(0,1fr) auto'), '表格区占满剩余高度，账号栏固定底部')
  assert.ok(scheduleCss.includes('min-width:2250px'), '表格按内容放宽并支持横向滚动（发布平台列加宽至 220）')
  assert.ok(scheduleCss.includes('table-layout:fixed'), '列宽由 colgroup 控制')
})

// ---------------------------------------------------------------------------
// P3 review 修复回归锚（2026-11-17 review P0-1/P1-1/P2-2）
// ---------------------------------------------------------------------------

test('受控输入契约：ScheduleRow 所有 value 输入必须带 onChange（P0-1 回归锚）', async () => {
  // React 对「value 无 onChange」的受控输入，每次键入都会把 DOM 还原为 props.value
  // （react-dom restoreStateIfNeeded + updateWrapper 强制回写）——5 个文本列曾因此
  // 完全无法录入。真实浏览器键入探针属 P5/真机验证；这里以源码契约锁定结构：
  // inputProps 必须同时携带 onChange（只更新行值）与 onBlur（失焦保存）。
  const moduleSource = await readFile(new URL('../src/schedule-ui.js', import.meta.url), 'utf8')
  const inputPropsStart = moduleSource.indexOf('const inputProps = (field, extra) => ({')
  assert.ok(inputPropsStart > -1, '存在 inputProps 工厂')
  const inputPropsBody = moduleSource.slice(inputPropsStart, moduleSource.indexOf('})', inputPropsStart))
  assert.ok(inputPropsBody.includes('onChange: event => actions.onEditCell('), 'inputProps 必须带 onChange（onEditCell）')
  assert.ok(inputPropsBody.includes('onBlur: event => actions.onBlurCell('), 'inputProps 必须带 onBlur（失焦保存）')
  // 5 个文本列全部经 inputProps 受控
  for (const field of ['videoContent', 'assetLink', 'note', 'shootingOwner', 'editingOwner']) {
    assert.ok(moduleSource.includes(`inputProps('${field}'`), `${field} 走受控 inputProps`)
  }
  // 日期列：inputProps + 显式 change 即保存（§9.6 第 2 条）
  assert.ok(moduleSource.includes("onChange: event => actions.onBlurCell(row.rowId, 'shootingDate'"), '拍摄日期 change 即保存')
  assert.ok(moduleSource.includes("onChange: event => actions.onBlurCell(row.rowId, 'publishDate'"), '发布日期 change 即保存')
  // 复选框：checked 必须配 onChange
  const checkboxCount = (moduleSource.match(/onChange: event => actions\.onCheckbox\(/gu) || []).length
  assert.equal(checkboxCount, 2, '两个业务复选框都带 onChange')
  // 平台复选由 PlatformGroup 的 onChange 驱动
  assert.ok(moduleSource.includes('onPlatformToggle(row.rowId, item.value, event.target.checked)'))
})

test('复选框列 td 保持 table-cell 语义（真机错位回归锚）', async () => {
  // td.ydo-schedule-checkbox 若被 CSS 写成 display:inline-grid + width/height，
  // td 脱离表格列布局，两个复选框格并进一个匿名单元格（真机截图错位根因）。
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const rule = source.match(/\.ydo-schedule-checkbox\{[^}]*\}/u)
  assert.ok(rule, '存在 .ydo-schedule-checkbox 规则')
  assert.ok(!/display:\s*inline-grid|width:\s*\d|height:\s*\d/.test(rule[0]),
    `td 类不得覆盖 display/width/height：${rule[0]}`)
  assert.ok(rule[0].includes('text-align:center'), '复选框列居中')
  // input 自身尺寸保留（与平台组共用规则）
  assert.ok(
    source.includes('.ydo-schedule-checkbox input,.ydo-schedule-platform-group input{width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}'),
    'input 15px 尺寸规则保留')
  // 标记结构：两个业务复选框各自独占 td.ydo-schedule-checkbox
  const moduleSource = await readFile(new URL('../src/schedule-ui.js', import.meta.url), 'utf8')
  assert.equal(
    (moduleSource.match(/className: 'ydo-schedule-checkbox'/gu) || []).length, 2,
    '两个复选框 td 使用该类')
})

test('delete 在途整行只读；save 在途可继续编辑入队（P2-2 修复，§9.4 第 9 条）', () => {
  assert.equal(rowStatusMeta({ status: 'saving', operation: 'delete' }).locked, true, 'delete 在途锁定行编辑')
  assert.equal(rowStatusMeta({ status: 'saving', operation: 'delete' }).rowClass, 'ydo-schedule-row-saving')
  assert.equal(rowStatusMeta({ status: 'saving', operation: 'save' }).locked, false, 'save 在途允许继续编辑（dirty 队列）')
  assert.equal(rowStatusMeta({ status: 'conflict' }).locked, true)
  assert.equal(rowStatusMeta({ status: 'unknown' }).locked, true)
  assert.equal(rowStatusMeta(createRowState('1')).locked, false)
  // client：performScheduleDelete 在途置 operation='delete'
  assert.ok(clientSource.includes("operation: 'delete',\n        idempotencyKey: key,") || clientSource.includes("operation: 'delete'"), 'delete 在途标记 operation')
})

test('create 在途禁止切换账号；迟到响应不跨账号串板（P1-1 修复）', () => {
  // 切换互斥：scheduleCreatingRef 在途直接拒绝
  const switchIdx = clientSource.indexOf('const switchScheduleAccount')
  const switchBody = clientSource.slice(switchIdx, clientSource.indexOf('}, [', switchIdx))
  assert.ok(switchBody.includes('scheduleCreatingRef.current'), '切换账号检查 create 在途')
  assert.ok(switchBody.includes('正在新增行，请等待完成后再切换账号'))
  assert.ok(switchBody.includes('applyScheduleRows([])'), '切换即清空旧账号行（防瞬时残留）')
  // create 响应守卫：seq 推进（切账号/重拉列表）后丢弃迟到响应
  const createIdx = clientSource.indexOf('const createScheduleRow')
  const createBody = clientSource.slice(createIdx, createIdx + 4800)
  assert.ok(createBody.includes('const seq = scheduleSeqRef.current'), 'create 捕获发起时序号')
  assert.ok(createBody.includes('if (seq !== scheduleSeqRef.current)'), '迟到响应按 seq 丢弃')
  assert.ok(createBody.includes('row.accountId !== accountId'), '响应行账号必须匹配发起账号')
  // 双守卫镜像：scheduleCreatingRef 与 state 同步置位/复位
  const count = (clientSource.match(/scheduleCreatingRef\.current = /gu) || []).length
  assert.ok(count >= 3, `creating ref 置位/复位完整（实际 ${count} 处）`)
})

test('accounts.list 失败给错误态而非空账号态（review P3-5）', () => {
  const boardIdx = clientSource.indexOf('const loadScheduleBoard')
  const boardBody = clientSource.slice(boardIdx, clientSource.indexOf('}, [', boardIdx))
  assert.ok(boardBody.includes("setScheduleError((result && result.reason) || 'douyin_operation_request_failed')"), '账号列表失败走错误态')
})

// ---------------------------------------------------------------------------
// 业务优化迭代（2026-11-20）：已发布折叠 / 平台横排 / 发布日期排序 / 斑马纹 /
// 已发布行专用底色 / sticky 列随行色
// ---------------------------------------------------------------------------

function mkUiRow(rowId, { published = false, publishDate = null } = {}) {
  return { rowId, accountId: 'a', shootingDate: '', videoContent: '', shootingStatus: false, published, assetLink: '', note: '', publishDate, publishPlatforms: [], shootingOwner: '', editingOwner: '', rowVersion: '1' }
}

test('发布日期升序排序：无日期排最后，同日期按 rowId 稳定（迭代 3）', () => {
  const list = [
    mkUiRow('30', { publishDate: '2026-11-20' }),
    mkUiRow('11', { publishDate: null }),
    mkUiRow('22', { publishDate: '2026-11-18' }),
    mkUiRow('12', { publishDate: null }),
    mkUiRow('21', { publishDate: '2026-11-18' }),
  ]
  const sorted = [...sortScheduleRows(list)].map(row => row.rowId)
  assert.deepEqual(sorted, ['21', '22', '30', '11', '12'])
  // 不改传入数组
  assert.equal(list.length, 5)
})

test('分组：仅「published 且 idle」进入已发布组；非 idle 已发布行留在未发布组保证反馈可见（迭代 1 保护）', () => {
  const rows = [
    mkUiRow('1', { published: true }),
    mkUiRow('2', { published: true }),
    mkUiRow('3', { published: false }),
    mkUiRow('4', { published: true }),
  ]
  const states = {
    '2': { ...createRowState('1'), status: 'saving' },
    '4': { ...createRowState('1'), status: 'conflict' },
  }
  const { published, unpublished, foldedCount } = partitionScheduleRows(rows, states)
  assert.deepEqual([...published].map(row => row.rowId), ['1'])
  assert.deepEqual([...unpublished].map(row => row.rowId), ['2', '3', '4'])
  assert.equal(foldedCount, 1)
})

test('渲染顺序：展开时已发布组在顶部，折叠行居交界；收起时折叠行在顶（迭代 1/用户拍板）', async () => {
  // ScheduleRow 是函数组件，fake createElement 不展开——本测试用真 react-dom/server
  // 渲染（render-smoke 同法），以 HTML 出现顺序断言分组次序。
  const React = (await import('react')).default ?? (await import('react'))
  const { renderToString } = await import('react-dom/server')
  const scheduleSource = (await readFile(new URL('../src/schedule-ui.js', import.meta.url), 'utf8')).replace(/^export /gm, '')
  const context2 = { require: name => { if (name !== 'react') throw new Error(name); return React } }
  vm.createContext(context2)
  vm.runInContext(scheduleSource, context2)
  const { SchedulePage: RealSchedulePage, createRowState: RealCreateRowState } =
    vm.runInContext('({ SchedulePage, createRowState })', context2)
  const mkUiRow = (rowId, { published = false, publishDate = null, videoContent = '占位内容' } = {}) => ({
    rowId, accountId: 'a', shootingDate: '', videoContent, shootingStatus: false, published,
    assetLink: '', note: '', publishDate, publishPlatforms: [], shootingOwner: '', editingOwner: '', rowVersion: '1',
  })
  const rows = [
    mkUiRow('2', { published: false, videoContent: '未发布占位' }),
    mkUiRow('1', { published: true, publishDate: '2026-11-18', videoContent: '已发布占位' }),
  ]
  const states = { '1': RealCreateRowState('1'), '2': RealCreateRowState('1') }
  const noop = () => {}
  const htmlFor = expanded => renderToString(RealSchedulePage({
    loading: false, errorReason: null, accounts: [{ accountId: 'a', nickname: '甲', deleteState: 'none', fanCount: 1 }],
    activeAccountId: 'a', rows, rowStates: states, hint: null, creating: false, deleteTarget: null,
    deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
    renderAvatar: null, publishedExpanded: expanded,
    actions: { onTogglePublished: noop },
  }))
  const collapsedHtml = htmlFor(false)
  const expandedHtml = htmlFor(true)
  const collapsedToggle = collapsedHtml.indexOf('ydo-schedule-toggle-row')
  assert.ok(collapsedToggle > -1, '收起时存在折叠行')
  assert.equal(collapsedHtml.includes('ydo-schedule-row-published'), false, '收起时已发布行不渲染')
  const expandedToggle = expandedHtml.indexOf('ydo-schedule-toggle-row')
  const expandedPublished = expandedHtml.indexOf('ydo-schedule-row-published')
  assert.ok(expandedPublished > -1, '展开时渲染已发布行')
  assert.ok(expandedPublished < expandedToggle, '已发布组在折叠行之前（表格顶部）')
  assert.ok(expandedHtml.includes('已发布（1 条）'), '折叠行显示已发布计数')
  assert.ok(expandedHtml.includes('点击收起'), '展开态提示收起')
  assert.ok(collapsedHtml.includes('点击展开'), '收起态提示展开')
  // 已发布组在顶部（其内容早于折叠行），未发布组在折叠行之后
  assert.ok(expandedHtml.indexOf('已发布占位') > -1 && expandedHtml.indexOf('已发布占位') < expandedToggle, '已发布组位于顶部')
  assert.ok(expandedHtml.indexOf('未发布占位') > expandedToggle, '未发布行位于折叠行之后')
  // 全部已发布且收起：给出「所有排期均已发布」提示行
  const allPublishedHtml = renderToString(RealSchedulePage({
    loading: false, errorReason: null, accounts: [{ accountId: 'a', nickname: '甲', deleteState: 'none', fanCount: 1 }],
    activeAccountId: 'a', rows: [mkUiRow('9', { published: true, publishDate: '2026-11-18' })],
    rowStates: { '9': RealCreateRowState('1') }, hint: null, creating: false, deleteTarget: null,
    deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
    renderAvatar: null, publishedExpanded: false,
    actions: { onTogglePublished: noop },
  }))
  assert.ok(allPublishedHtml.includes('所有排期均已发布'), '全部已发布且收起时给出提示行')
})

test('斑马纹：未发布组内按组内奇偶计算，已发布行不参与（迭代 4）', async () => {
  const React = (await import('react')).default ?? (await import('react'))
  const { renderToString } = await import('react-dom/server')
  const scheduleSource = (await readFile(new URL('../src/schedule-ui.js', import.meta.url), 'utf8')).replace(/^export /gm, '')
  const context2 = { require: name => { if (name !== 'react') throw new Error(name); return React } }
  vm.createContext(context2)
  vm.runInContext(scheduleSource, context2)
  const { SchedulePage: RealSchedulePage, createRowState: RealCreateRowState } =
    vm.runInContext('({ SchedulePage, createRowState })', context2)
  const mkUiRow = (rowId, { published = false, publishDate = null } = {}) => ({
    rowId, accountId: 'a', shootingDate: '', videoContent: '', shootingStatus: false, published,
    assetLink: '', note: '', publishDate, publishPlatforms: [], shootingOwner: '', editingOwner: '', rowVersion: '1',
  })
  // 未发布 3 行：组内 index1（rowId 3）带 striped；已发布行不带
  const rows = [
    mkUiRow('1', { published: true, publishDate: '2026-11-18' }),
    mkUiRow('2'), mkUiRow('3'), mkUiRow('4'),
  ]
  const states = { '1': RealCreateRowState('1'), '2': RealCreateRowState('1'), '3': RealCreateRowState('1'), '4': RealCreateRowState('1') }
  const noop = () => {}
  const html = renderToString(RealSchedulePage({
    loading: false, errorReason: null, accounts: [{ accountId: 'a', nickname: '甲', deleteState: 'none', fanCount: 1 }],
    activeAccountId: 'a', rows, rowStates: states, hint: null, creating: false, deleteTarget: null,
    deleteBusy: false, deleteTargetSequence: null, ownerSuggestions: [], focusRowId: null,
    renderAvatar: null, publishedExpanded: true,
    actions: { onTogglePublished: noop },
  }))
  const stripedIds = [...html.matchAll(/class="[^"]*ydo-schedule-row-striped[^"]*" data-row-id="(\d+)"/gu)].map(m => m[1])
  assert.deepEqual(stripedIds, ['3'], '未发布组内仅偶数序行（rowId 3）带斑马纹')
  assert.ok(!/ydo-schedule-row-published[^"]*"[^>]*data-row-id="\d+"[^>]*ydo-schedule-row-striped/u.test(html), '已发布行不带斑马纹')
})

test('CSS：行底色体系/折叠行/平台横排/已发布专用色（迭代 2/4/5）', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const cssStart = source.indexOf('/* 发布排期看板（RQ-2026-013 §10）')
  const scheduleCss = source.slice(cssStart, source.indexOf('`;', cssStart))
  // 行底色由 td 承载，sticky 序号/操作列不再写死背景
  assert.ok(scheduleCss.includes('.ydo-schedule-table tbody td{background:var(--dsw-alias-bg-base)}'))
  assert.ok(
    scheduleCss.includes('tr.ydo-schedule-row-striped td{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-alias-bg-base))}'),
    '斑马色=文字色 5% 混底（浅色主题可见，不依赖 layer 变量取值）')
  assert.ok(
    scheduleCss.includes('tr.ydo-schedule-row-published td{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,var(--dsw-alias-bg-base))}'),
    '已发布组使用主题成功色混合底色（深浅主题自适应）')
  assert.ok(scheduleCss.includes('tr.ydo-schedule-row-saving td{'), '状态色迁移到 td 级（sticky 列同色）')
  assert.ok(scheduleCss.includes('.ydo-schedule-toggle-row td{background:var(--dsw-alias-bg-layer-2)'), '折叠行样式')
  // sticky 列规则不得再写死背景（跟随行色）
  const stickyRule = scheduleCss.match(/\.ydo-schedule-sequence-cell,\.ydo-schedule-delete-cell\{[^}]*\}/u)
  assert.ok(stickyRule && !stickyRule[0].includes('background:'), 'sticky 列不再写死背景')
  // 平台横排
  assert.ok(
    scheduleCss.includes('.ydo-schedule-platform-group{display:flex;flex-wrap:wrap;gap:4px 12px'),
    '发布平台横向排列')
  // 发布平台列加宽
  const moduleSource = await readFile(new URL('../src/schedule-ui.js', import.meta.url), 'utf8')
  assert.ok(moduleSource.includes('[80, 160, 300, 220, 140, 300, 240, 160, 220, 170, 170, 90]'), '发布平台列宽 220')
})
