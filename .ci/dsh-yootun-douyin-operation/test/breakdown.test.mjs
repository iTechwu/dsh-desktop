// 爆款拆解 Tab（0922 方案 §4.1）UI 回归：Markdown 拍摄脚本解析、状态/错误映射、
// 三视图组件行为（规则单选、详情折叠卡、重新改写弹框）与 client.js 接线契约。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { test } from 'node:test'

// ---------------------------------------------------------------------------
// 模块加载辅助：vm 沙箱按构建脚本同法剥离 ESM import/export 后求值；
// ui-format 注入真实实现（内联后同作用域）；React/primitives 用记录式桩。
// ---------------------------------------------------------------------------
const UI_FORMAT_IMPORT = /^import \{[\s\S]*?\} from '\.\/ui-format\.js'\n/m
const SELECT_UI_IMPORT = /^import \{[\s\S]*?\} from '\.\/select-ui\.js'\n/m

async function evalBdModule(reactStub) {
  let source = await readFile(new URL('../src/breakdown.js', import.meta.url), 'utf8')
  if (!UI_FORMAT_IMPORT.test(source)) throw new Error('test: ui-format import not found')
  if (!SELECT_UI_IMPORT.test(source)) throw new Error('test: select-ui import not found')
  source = source
    .replace(UI_FORMAT_IMPORT, '')
    .replace(SELECT_UI_IMPORT, '')
    .replace(/^export /gm, '')
  const uiFormatModule = await import(new URL('../src/ui-format.js', import.meta.url).href)
  const context = {
    console,
    ...uiFormatModule,
    // FilterSelect 桩（构建时与 ui-format/select-ui 同为内联同作用域）：只记录 props，
    // 不执行真实下拉逻辑。FilterSelect 本体已在 overview/analysis 生产路径验证；
    // render-smoke 只覆盖初始关闭态 Overlay，不执行 overlay 打开分支里的本列表，
    // 其真实 React 渲染路径与既有列表测试同为 vm 桩覆盖。
    FilterSelect: props => ({ type: 'filter-select', props: props || {}, children: null }),
    require: name => {
      if (name === 'react') return reactStub
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconCloseOutline16: props => ({ type: 'icon-close', props: props || {}, children: null }) }
      throw new Error(`unexpected require: ${name}`)
    },
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  return context
}

/** 记录式 React 桩：createElement 记录调用树，useState 返回固定值与 no-op setter。 */
function recordingReact() {
  const calls = []
  const stub = {
    createElement: (type, props, ...children) => {
      const node = { type, props: props || {}, children }
      calls.push(node)
      return node
    },
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
  }
  return { stub, calls }
}

/**
 * 可重渲染 React 桩：useState 按「本次渲染内调用序号」跨渲染记忆槽位，
 * 配合 beginRender() 手动重渲染可测交互后的状态变化（选中规则/关闭弹框），
 * 语义与真实 React 的同序槽位一致（0916 hooks 守卫同款思路）。
 */
function rerenderableReact() {
  const calls = []
  const slots = []
  let slotIndex = 0
  const stub = {
    createElement: (type, props, ...children) => {
      const node = { type, props: props || {}, children }
      calls.push(node)
      return node
    },
    useState: initial => {
      const index = slotIndex
      slotIndex += 1
      if (slots[index] === undefined) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
  }
  const beginRender = () => { slotIndex = 0; calls.length = 0 }
  return { stub, beginRender, calls }
}

/** vm 跨 realm 数组/对象不能直接 deepEqual（原型不同），JSON 归一化后比较。 */
const sameJson = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message)

// 渲染文本提取：走 mini renderNode（函数组件显式展开）后收集字符串。
const renderNode = node => {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderNode)
  if (typeof node.type === 'function') return renderNode(node.type({ ...(node.props || {}), children: node.children }))
  return {
    type: node.type,
    props: node.props,
    children: node.children === undefined ? undefined : (Array.isArray(node.children) ? node.children.map(renderNode) : renderNode(node.children)),
  }
}
const collectText = tree => {
  const text = []
  const walk = node => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node !== 'object') { text.push(String(node)); return }
    walk(node.children)
  }
  walk(renderNode(tree))
  return text.join('|')
}
const collectFlat = tree => {
  const flat = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    flat.push(node)
    walk(node.children)
  }
  walk(renderNode(tree))
  return flat
}

const t = key => key

// ---------------------------------------------------------------------------
// shotScriptTable：服务端 Markdown 表格（九列）→ 纯文本结构
// ---------------------------------------------------------------------------

test('shotScriptTable 解析标准 Markdown 表格：表头/行/单元格 trim', async () => {
  const sandbox = await evalBdModule(recordingReact().stub)
  const shotScriptTable = vm.runInContext('shotScriptTable', sandbox)
  const markdown = [
    '| 序号 | 景别 | 画面 | 台词 | 时长 | 情绪 | 运镜 | 备注 | 素材 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 1 | 特写 | 产品特写 | 开场口播 | 3s | 紧张 | 固定 | - | - |',
    '| 2 | 中景 | 主演出镜 | 卖点讲解 | 8s | 平稳 | 推近 | - | - |',
  ].join('\n')
  const parsed = shotScriptTable(markdown)
  assert.equal(parsed.head.length, 9)
  assert.equal(parsed.head[0], '序号')
  assert.equal(parsed.head[8], '素材')
  assert.equal(parsed.rows.length, 2)
  sameJson(parsed.rows[0], ['1', '特写', '产品特写', '开场口播', '3s', '紧张', '固定', '-', '-'])
  assert.equal(parsed.rows[1][3], '卖点讲解')
  sameJson(parsed.paragraphs, [])
})

test('shotScriptTable：表格外文本按段落收集、无表格纯段落、空/非字符串安全', async () => {
  const sandbox = await evalBdModule(recordingReact().stub)
  const shotScriptTable = vm.runInContext('shotScriptTable', sandbox)
  const mixed = ['# 拍摄脚本', '', '| A | B |', '| - | - |', '| 1 | 2 |', '', '补充说明：全程手持'].join('\n')
  const parsed = shotScriptTable(mixed)
  sameJson(parsed.head, ['A', 'B'])
  sameJson(parsed.rows, [['1', '2']])
  sameJson(parsed.paragraphs, ['# 拍摄脚本', '补充说明：全程手持'])

  const paragraphsOnly = shotScriptTable('只有一段话\n\n第二段话')
  sameJson(paragraphsOnly.head, [])
  sameJson(paragraphsOnly.rows, [])
  sameJson(paragraphsOnly.paragraphs, ['只有一段话', '第二段话'])

  for (const value of ['', '   ', null, undefined, 42, {}]) {
    const empty = shotScriptTable(value)
    sameJson(empty, { head: [], rows: [], paragraphs: [] }, `非法输入 ${String(value)} 返回空结构`)
  }
})

test('shotScriptTable：非表格的 | 开头行（无分隔线）不误判为表头；--- 分隔线缺失即中断', async () => {
  const sandbox = await evalBdModule(recordingReact().stub)
  const shotScriptTable = vm.runInContext('shotScriptTable', sandbox)
  // 第二行不是 --- 分隔线：不进表格，按段落收集。
  const noTable = shotScriptTable('| 看起来像表格 | 但不是 |')
  sameJson(noTable.head, [])
  sameJson(noTable.paragraphs, ['| 看起来像表格 | 但不是 |'])
  // 表格块被段落行中断后即结束（head 单数语义——服务端产出的拍摄脚本是单一
  // 连续表格）；中断后的孤立 `|` 行按段落收集，不再并入或新开表格。
  const interrupted = shotScriptTable('| A | B |\n| - | - |\n| 1 | 2 |\n备注 |\n| 3 | 4 |')
  assert.equal(interrupted.rows.length, 1)
  sameJson(interrupted.rows, [['1', '2']])
  sameJson(interrupted.paragraphs, ['备注 |', '| 3 | 4 |'])
})

// ---------------------------------------------------------------------------
// 状态与错误映射
// ---------------------------------------------------------------------------

test('breakdownStatusTone：终态语义收敛，未知状态按进行中处理（不误报成功/失败）', async () => {
  const sandbox = await evalBdModule(recordingReact().stub)
  const breakdownStatusTone = vm.runInContext('breakdownStatusTone', sandbox)
  assert.equal(breakdownStatusTone('succeeded'), 'ok')
  assert.equal(breakdownStatusTone('failed'), 'error')
  assert.equal(breakdownStatusTone('cancelled'), 'warn')
  // workflow_start 失败 payload 的 status 一并收敛为 error。
  assert.equal(breakdownStatusTone('invalid_input'), 'error')
  assert.equal(breakdownStatusTone('idempotency_conflict'), 'error')
  assert.equal(breakdownStatusTone('needs_input'), 'warn')
  for (const status of ['queued', 'running', 'waiting', 'in_progress']) {
    assert.equal(breakdownStatusTone(status), 'running', `${status} 按进行中`)
  }
  assert.equal(breakdownStatusTone('future_status'), 'running', '未知状态绝不映射成 ok/error')
  assert.equal(breakdownStatusTone(undefined), 'running')
})

test('workflowErrorCopyKey：admin.errorCode / 顶层 errorCode 双位读取，未登记码兜底 bdErrorFailed', async () => {
  const sandbox = await evalBdModule(recordingReact().stub)
  const workflowErrorCopyKey = vm.runInContext('workflowErrorCopyKey', sandbox)
  assert.equal(workflowErrorCopyKey({ admin: { errorCode: 'unknown_rewrite_rule' } }), 'bdErrorUnknownRule')
  assert.equal(workflowErrorCopyKey({ errorCode: 'candidate_not_found' }), 'bdErrorCandidateNotFound')
  assert.equal(workflowErrorCopyKey({ admin: { errorCode: 'soft_time_limit' } }), 'bdErrorRetryable')
  assert.equal(workflowErrorCopyKey({ admin: { errorCode: 'waiting_timeout' } }), 'bdErrorRetryable')
  assert.equal(workflowErrorCopyKey({ admin: { errorCode: 'storyboard_quality' } }), 'bdErrorRetryable')
  assert.equal(workflowErrorCopyKey({ admin: { errorCode: 'nonretryable_step' } }), 'bdErrorFailed')
  assert.equal(workflowErrorCopyKey({ admin: { errorCode: 'brand_new_failure' } }), 'bdErrorFailed', '未登记失败码不透出原始值')
  assert.equal(workflowErrorCopyKey({}), 'bdErrorFailed')
  assert.equal(workflowErrorCopyKey(null), 'bdErrorFailed')
})

test('BREAKDOWN_ERROR_REASON_COPY 只收 isError 形态白名单码，文案键在 zh/en copy 中登记', async () => {
  const sandbox = await evalBdModule(recordingReact().stub)
  const copyTable = vm.runInContext('BREAKDOWN_ERROR_REASON_COPY', sandbox)
  assert.deepEqual(
    Object.keys(copyTable).sort(),
    ['ASYNC_RUN_NOT_FOUND', 'DOUYIN_TOOL_UNAVAILABLE', 'IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_KEY_REQUIRED', 'UNKNOWN_REWRITE_RULE', 'douyin_operation_request_failed'].sort(),
  )
  const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  for (const key of Object.values(copyTable)) {
    assert.match(clientSource, new RegExp(`${key}: '[^']+'`), `文案键 ${key} 在 zh copy 登记`)
  }
  // isError 形态专用码不经 workflow 小写 errorCode 通道（双轨不混用）。
  assert.match(clientSource, /bdErrorArchiveFailed: '/u)
})

// ---------------------------------------------------------------------------
// 组件行为
// ---------------------------------------------------------------------------

test('BreakdownNewPage：规则单选可切换/再点取消，onStart 回传 (shareUrl, ruleId)，空链接与提交中禁用', async () => {
  const rules = [
    { rewriteRuleId: 'r1', name: '规则一', description: '描述一' },
    { rewriteRuleId: 'r2', name: '规则二', description: null },
  ]
  const started = []

  // 可重渲染桩：点选规则 → 重渲染 → 选中态与提交回传一致。
  const { stub, beginRender } = rerenderableReact()
  const sandbox = await evalBdModule(stub)
  const BreakdownNewPage = vm.runInContext('BreakdownNewPage', sandbox)
  const render = () => {
    beginRender()
    return BreakdownNewPage({ rules, rulesError: null, submitting: false, archiveTask: null, startError: null, onStart: (url, ruleId) => started.push([url, ruleId]), t })
  }

  let page = render()
  // 输入框 + 开始按钮（无链接禁用）。
  const input = collectFlat(page).find(node => node.type === 'input')
  assert.equal(input.props['aria-label'], 'bdShareLabel')
  const startButton = collectFlat(page).filter(node => node.type === 'button').find(node => String(node.props.className || '').includes('ydo-primary'))
  assert.equal(startButton.props.disabled, true, '空链接禁用开始按钮')

  // 规则单选：radio 语义；点选第一项 → 重渲染后选中态成立。
  let radios = collectFlat(page).filter(node => node.props && node.props.role === 'radio')
  assert.equal(radios.length, 2)
  assert.equal(radios[0].props['aria-checked'], false)
  radios[0].props.onClick()
  page = render()
  radios = collectFlat(page).filter(node => node.props && node.props.role === 'radio')
  assert.equal(radios[0].props['aria-checked'], true, '点选后 aria-checked')
  assert.ok(radios[0].props.className.includes('ydo-bd-radio-active'), '选中态类')
  // 预览稿对齐：规则卡名称前有单选圆圈（ydo-bd-radio-box）；面板挂 16px 特化类。
  const radioBox = collectFlat(page).find(node => String(node.props.className || '') === 'ydo-bd-radio-box')
  assert.ok(radioBox && radioBox.props['aria-hidden'] === true, '规则卡含单选圆圈')
  const panel = collectFlat(page).find(node => String(node.props.className || '').includes('ydo-bd-panel'))
  assert.ok(panel, '发起区面板挂 ydo-bd-panel（16px 内边距）')
  radios[0].props.onClick()
  page = render()
  radios = collectFlat(page).filter(node => node.props && node.props.role === 'radio')
  assert.equal(radios[0].props['aria-checked'], false, '再点同卡取消选中')

  // 带选中规则提交：链接 trim、规则 id 随提交传递。
  radios[1].props.onClick()
  page = render()
  const input2 = collectFlat(page).find(node => node.type === 'input')
  input2.props.onChange({ target: { value: '  https://v.douyin.com/abc  ' } })
  page = render()
  const start2 = collectFlat(page).filter(node => node.type === 'button').find(node => String(node.props.className || '').includes('ydo-primary'))
  assert.equal(start2.props.disabled, false, '有链接后可提交')
  start2.props.onClick()
  assert.deepEqual(started, [['https://v.douyin.com/abc', 'r2']], '链接 trim 后回传，规则 id 随提交传递')

  // 提交中：按钮禁用 + aria-busy（提交态由宿主持有，组件纯展示）。
  const { stub: stub3 } = recordingReact()
  const sandbox3 = await evalBdModule(stub3)
  const busyPage = vm.runInContext('BreakdownNewPage', sandbox3)({ rules, rulesError: null, submitting: true, archiveTask: null, startError: null, onStart: () => {}, t })
  const busyButtons = collectFlat(busyPage).filter(node => node.type === 'button')
  assert.ok(busyButtons.every(node => node.props.disabled), '提交中全部按钮禁用')
  assert.equal(busyButtons.find(node => String(node.props.className || '').includes('ydo-primary')).props['aria-busy'], true)

  // 过渡条 + 规则错误态（含重新加载按钮）+ 提交错误槽。
  const { stub: stub4 } = recordingReact()
  const sandbox4 = await evalBdModule(stub4)
  let retried = 0
  const withStates = vm.runInContext('BreakdownNewPage', sandbox4)({
    rules, rulesError: 'operationUnavailable', submitting: false,
    archiveTask: { runId: 'run-1' }, startError: 'bdErrorArchiveFailed', onStart: () => {},
    onRetryRules: () => { retried += 1 }, t,
  })
  const text = collectText(withStates)
  assert.ok(text.includes('bdArchivePending'), '归档过渡条可见')
  assert.ok(text.includes('operationUnavailable'), '规则加载失败显示已登记文案')
  assert.ok(text.includes('bdErrorArchiveFailed'), '提交失败显示错误文案')
  assert.equal(collectFlat(withStates).filter(node => node.props && node.props.role === 'radio').length, 0, '规则错误态下不渲染规则卡')
  const retryButton = collectFlat(withStates).filter(node => node.type === 'button').find(node => collectText(node) === 'bdRulesRetry')
  assert.ok(retryButton, '规则错误态提供重新加载按钮')
  retryButton.props.onClick()
  assert.equal(retried, 1, '重新加载按钮回传 onRetryRules')
})

test('BreakdownHistoryList：表格结构（五列表头）、规则 pill、分页「加载更多」与 onOpen 回传', async () => {
  const { stub } = recordingReact()
  const sandbox = await evalBdModule(stub)
  const BreakdownHistoryList = vm.runInContext('BreakdownHistoryList', sandbox)

  const empty = BreakdownHistoryList({ history: [], rules: [], loading: false, errorReason: null, onOpen: () => {}, t })
  assert.ok(collectText(empty).includes('bdHistoryEmpty'), '空历史显示引导文案')
  // 预览稿 panel 口径：空态/错误态同样带可见标题「拆解记录（团队共享，按时间倒序）」。
  assert.ok(collectText(empty).includes('bdHistoryLabel') && collectText(empty).includes('bdHistorySub'), '空态带可见标题与副标题')
  const loading = BreakdownHistoryList({ history: [], rules: [], loading: true, errorReason: null, onOpen: () => {}, t })
  assert.ok(collectText(loading).includes('loading'), '加载态显示加载中文案')

  const errored = BreakdownHistoryList({ history: [], rules: [], loading: false, errorReason: 'operationUnavailable', onOpen: () => {}, t })
  assert.equal(collectFlat(errored).find(node => node.props && node.props.role === 'alert').props.className, 'ydo-error', '错误态 role=alert')
  assert.ok(collectText(errored).includes('bdHistoryLabel'), '错误态同样带可见标题')

  const opened = []
  const rules = [{ rewriteRuleId: 'r1', name: '规则一', description: '描述一' }]
  const rows = [
    { candidateId: 'c1', candidateTitle: '标题甲', candidateAuthor: '作者A', candidatePlayCount: 2865000, rewriteRuleId: 'r1', status: 'succeeded', currentStepLabel: '已完成', updatedAt: '2026-09-22T08:00:00.000Z', hasStoryboard: true, admin: { workflowId: 'w1' } },
    { candidateId: 'c2', candidateTitle: null, candidateAuthor: null, candidatePlayCount: null, rewriteRuleId: null, status: 'failed', currentStepLabel: '拍摄脚本', updatedAt: null, hasStoryboard: false, admin: {} },
    { candidateId: 'c3', candidateTitle: '标题丙', candidateAuthor: '作者C', candidatePlayCount: null, rewriteRuleId: null, status: 'running', currentStepLabel: '画面理解', updatedAt: null, hasStoryboard: false, admin: {} },
  ]
  const list = BreakdownHistoryList({
    history: rows, rules, loading: false, errorReason: null,
    hasMore: true, loadingMore: false, onLoadMore: () => {}, onOpen: item => opened.push(item), t,
  })
  // 表格结构：五列表头（视频/状态/仿写规则/当前步骤/时间）+ 三行。
  const table = collectFlat(list).find(node => node.type === 'table')
  assert.ok(table, '渲染表格结构')
  const headCells = collectFlat(list).filter(node => node.type === 'th').map(node => collectText(node))
  assert.deepEqual(headCells, ['bdColVideo', 'bdColStatus', 'bdColRule', 'bdColStep', 'bdColTime'], '五列表头走文案键')
  const trs = collectFlat(list).filter(node => node.type === 'tr' && node.props && node.props.tabIndex === 0)
  assert.equal(trs.length, 3)
  const text = collectText(list)
  assert.ok(text.includes('标题甲') && text.includes('@作者A'), '标题与作者副行渲染')
  assert.ok(text.includes('bdPlayLabel') && text.includes('286.5万'), '播放数万格式化（formatCount）')
  assert.ok(text.includes('规则一'), '规则名从 rules 清单解析渲染')
  assert.ok(text.includes('c2'), '缺标题行回退渲染 candidateId')
  assert.ok(text.includes('2026-09-22 16:00'), '时间按上海时区展示（formatDateTime）')
  assert.ok(text.includes('—'), '缺失步骤/时间显示 —')
  const failedBadge = collectFlat(list).find(node => String(node.props.className || '').includes('ydo-bd-status-error'))
  assert.ok(failedBadge, '失败状态徽标语义色')
  const failedStep = collectFlat(list).find(node => String(node.props.className || '').includes('ydo-bd-row-step-failed'))
  assert.ok(failedStep && collectText(failedStep).includes('bdStatusFailed'), '失败行步骤列红色显示失败')
  const runningStep = collectFlat(list).find(node => String(node.props.className || '').includes('ydo-bd-row-step-running'))
  assert.ok(runningStep && collectText(runningStep).includes('画面理解'), '运行行步骤列蓝色显示当前步')
  const defaultPill = collectFlat(list).find(node => String(node.props.className || '').includes('ydo-bd-rule-pill-default'))
  assert.ok(defaultPill && collectText(defaultPill).includes('bdRuleDefault'), '未选规则显示中性「默认」pill')
  const loadMore = collectFlat(list).filter(node => node.type === 'button').find(node => collectText(node) === 'bdLoadMore')
  assert.ok(loadMore, 'hasMore 渲染加载更多按钮')
  trs[0].props.onClick()
  assert.equal(opened[0].candidateId, 'c1', '行点击回传原始行对象')
  trs[0].props.onKeyDown({ key: 'Enter', preventDefault: () => {} })
  assert.equal(opened.length, 2, '键盘 Enter 打开行（可访问性）')

  // 无更多数据：不渲染加载更多。
  const noMore = BreakdownHistoryList({ history: rows, rules, loading: false, errorReason: null, hasMore: false, loadingMore: false, onLoadMore: () => {}, onOpen: () => {}, t })
  assert.equal(collectFlat(noMore).filter(node => node.type === 'button').length, 0, 'hasMore=false 无加载更多按钮')
})

test('filterBreakdownHistory：按 tone 分组过滤（失败组收 error+warn，未知状态归进行中）', async () => {
  const sandbox = await evalBdModule(recordingReact().stub)
  const filterBreakdownHistory = vm.runInContext('filterBreakdownHistory', sandbox)
  const rows = [
    { candidateId: 'ok', status: 'succeeded' },
    { candidateId: 'err', status: 'failed' },
    { candidateId: 'bad-input', status: 'invalid_input' },
    { candidateId: 'warn', status: 'cancelled' },
    { candidateId: 'needs', status: 'needs_input' },
    { candidateId: 'run', status: 'running' },
    { candidateId: 'queued', status: 'queued' },
    { candidateId: 'mystery', status: 'some_new_status' },
  ]
  assert.equal(filterBreakdownHistory(rows, 'all').length, 8, 'all 原样返回')
  // vm 沙箱数组与主 realm 原型不同，统一 Array.from 后断言。
  assert.deepEqual(Array.from(filterBreakdownHistory(rows, 'succeeded'), r => r.candidateId), ['ok'], '成功组只留 ok')
  assert.deepEqual(
    Array.from(filterBreakdownHistory(rows, 'failed'), r => r.candidateId),
    ['err', 'bad-input', 'warn', 'needs'],
    '失败组收 error + warn（未成功终态）',
  )
  assert.deepEqual(
    Array.from(filterBreakdownHistory(rows, 'running'), r => r.candidateId),
    ['run', 'queued', 'mystery'],
    '进行中组收 running 态与未知状态',
  )
  assert.deepEqual(Array.from(filterBreakdownHistory(null, 'all')), [], '非数组入参安全返回空')
})

test('BreakdownHistoryList：状态筛选下拉（toolbar 范式）、过滤渲染、筛选后空态与回调', async () => {
  const { stub } = recordingReact()
  const sandbox = await evalBdModule(stub)
  const BreakdownHistoryList = vm.runInContext('BreakdownHistoryList', sandbox)
  const rows = [
    { candidateId: 'c1', candidateTitle: '标题甲', status: 'succeeded', currentStepLabel: '已完成', updatedAt: null, admin: {} },
    { candidateId: 'c2', candidateTitle: '标题乙', status: 'failed', currentStepLabel: '', updatedAt: null, admin: {} },
  ]
  const changes = []
  const base = {
    history: rows, rules: [], loading: false, errorReason: null,
    hasMore: false, loadingMore: false, onLoadMore: () => {},
    onOpen: () => {}, statusFilter: 'all', onStatusFilterChange: value => changes.push(value), t,
  }
  // 筛选控件复用总览/分析页范式：ydo-ov-toolbar 标题行 + ydo-ov-filter 说明 + FilterSelect 下拉。
  const list = BreakdownHistoryList(base)
  const filterLabel = collectFlat(list).find(node => String(node.props.className || '') === 'ydo-ov-filter')
  assert.ok(filterLabel, '标题行带 ydo-ov-filter 筛选容器')
  const select = collectFlat(list).find(node => node.type === 'filter-select')
  assert.ok(select, '渲染 FilterSelect 下拉（桩）')
  assert.deepEqual(
    Array.from(select.props.options, option => option.value),
    ['all', 'running', 'succeeded', 'failed'],
    '下拉选项 = 全部/进行中/成功/失败',
  )
  select.props.onChange('failed')
  assert.deepEqual(changes, ['failed'], '下拉变更回传筛选值')

  // statusFilter=failed：只渲染失败行。
  const failedOnly = BreakdownHistoryList({ ...base, statusFilter: 'failed' })
  const failedTrs = collectFlat(failedOnly).filter(node => node.type === 'tr' && node.props && node.props.tabIndex === 0)
  assert.equal(failedTrs.length, 1, '失败筛选只渲染失败行')
  assert.ok(collectText(failedOnly).includes('标题乙') && !collectText(failedOnly).includes('标题甲'), '失败行内容正确')

  // 筛选后为空：显示「该状态下暂无」，且不渲染表格。
  const noneSucceeded = BreakdownHistoryList({ ...base, statusFilter: 'running' })
  assert.ok(collectText(noneSucceeded).includes('bdHistoryEmptyFiltered'), '筛选后空态走专用文案')
  assert.ok(!collectFlat(noneSucceeded).some(node => node.type === 'table'), '筛选后空不渲染表格')
  // 全量本来就空：仍走原「还没有拆解记录」引导，不显示筛选空态。
  const emptyAll = BreakdownHistoryList({ ...base, history: [], statusFilter: 'failed' })
  assert.ok(collectText(emptyAll).includes('bdHistoryEmpty'), '全量空保持原引导文案')
})

const fullWorkflow = {
  workflowId: 'wf-1', candidateId: 'cand-1', candidateTitle: '爆款视频标题', candidateAuthor: '作者甲',
  status: 'succeeded', currentStep: 'completed', statusLabel: '已完成', currentStepLabel: '已完成',
  updatedAt: '2026-09-22T08:00:00.000Z', retryAfterSeconds: 0, admin: { workflowId: 'wf-1' },
}
const fullDetail = {
  storyboards: [{
    storyboardId: 'sb-1', candidateId: 'cand-1', status: 'succeeded',
    input: { douyinVideoUrl: 'https://v.douyin.com/x', rewriteRuleId: 'r1', rewriteRulePrompt: '保持 3 秒钩子，口语化改写' },
    storyboard: { items: [], summary: '结构总结' },
    shotScript: {
      status: 'succeeded',
      markdown: '| 序号 | 景别 |\n| --- | --- |\n| 1 | 特写 |',
      shotSizeQuotas: { 特写: 2, 中景: 1 },
    },
    originalVideoAnalysis: {
      summary: '原片以悬念开场',
      segments: [
        { timeRange: '00:00-00:03', role: 'hook', originalVisual: '产品特写', originalSpeech: '你还在…吗' },
        { timeRange: '00:03-00:10', role: 'build', originalVisual: '主演出镜', originalSpeech: '其实只要三步' },
      ],
    },
    rewrittenStoryboard: {
      summary: '改写后更强钩子',
      segments: [
        { timeRange: '00:00-00:03', role: 'hook', rewrittenVisual: '冲突画面', rewrittenSpeech: '别再…了', sourceSegmentIndexes: [1] },
        { timeRange: '00:03-00:12', role: 'cta', rewrittenVisual: '引导关注', rewrittenSpeech: '点关注', sourceSegmentIndexes: [2] },
      ],
    },
    createdAt: '2026-09-22T07:00:00.000Z', updatedAt: '2026-09-22T08:00:00.000Z',
  }],
  analysis: { candidates: [{ candidate_id: 'cand-1', products: { asr: { transcript: '你还在…吗 其实只要三步' } } }] },
  analysisError: null,
}

test('BreakdownDetailPage：完整数据渲染头部/8 步进度/五张折叠卡（默认展开位正确）', async () => {
  const { stub } = recordingReact()
  const sandbox = await evalBdModule(stub)
  const BreakdownDetailPage = vm.runInContext('BreakdownDetailPage', sandbox)
  const page = BreakdownDetailPage({
    workflow: fullWorkflow, detail: fullDetail, loading: false, errorReason: null,
    onBack: () => {}, onRequestRewrite: () => {}, t,
  })
  const flat = collectFlat(page)
  const text = collectText(page)

  // 头部：标题/作者/状态徽标。
  assert.ok(text.includes('爆款视频标题') && text.includes('作者甲'), '标题与作者渲染')
  assert.ok(flat.some(node => String(node.props.className || '').includes('ydo-bd-status-ok')), '成功徽标')

  // 8 步进度条：全部完成态，步骤名走 bdStep_* 文案键。
  const steps = flat.filter(node => String(node.props.className || '').startsWith('ydo-bd-step '))
  assert.equal(steps.length, 8, '8 个步骤节点')
  assert.ok(steps.every(node => String(node.props.className).includes('ydo-bd-step-done')), '终态整条完成')
  assert.ok(text.includes('bdStep_archive_original') && text.includes('bdStep_shot_script'), '步骤名走文案键')

  // 折叠卡：summary/patterns 默认展开（内容可见），dims/recs 默认折叠。
  const cards = flat.filter(node => String(node.props.className || '').includes('ydo-ai-card '))
  assert.equal(cards.length, 5, '五张折叠卡')
  const openCards = cards.filter(node => String(node.props.className).includes('ydo-ai-card-open'))
  assert.equal(openCards.length, 2, '默认只展开原视频拆解与改写分镜')
  assert.ok(String(openCards[0].props.className).includes('ydo-ai-card-summary'), '原视频拆解=summary 色调')
  assert.ok(String(openCards[1].props.className).includes('ydo-ai-card-patterns'), '改写分镜=patterns 色调')

  // 原视频拆解：分段结构（时间/角色/画面/口播）。
  assert.ok(text.includes('00:00-00:03') && text.includes('产品特写') && text.includes('你还在…吗'), '原视频分段渲染')
  assert.ok(text.includes('bdRole_hook') && text.includes('bdRole_build'), '角色标签按语义渲染')

  // 改写分镜：来源段落标注。
  assert.ok(text.includes('bdSourceFrom') && text.includes('#1'), '改写分镜标注来源段落')

  // 拍摄脚本卡折叠态：标题可见即可（内容在展开时渲染）。
  const shotCard = cards.find(node => collectText(node).includes('bdCardShotScript'))
  assert.ok(shotCard, '拍摄脚本卡存在')
})

test('BreakdownDetailPage：展开卡内容完整（引用块/口播全文/脚本表格/规则回显），重新改写成功态可用', async () => {
  const { stub } = recordingReact()
  const sandbox = await evalBdModule(stub)
  const BreakdownDetailPage = vm.runInContext('BreakdownDetailPage', sandbox)
  const page = BreakdownDetailPage({
    workflow: fullWorkflow, detail: fullDetail, loading: false, errorReason: null,
    onBack: () => {}, onRequestRewrite: () => setRewriteOpen(true), t,
  })
  function setRewriteOpen() {}
  const flat = collectFlat(page)
  const text = collectText(page)

  // 原视频拆解（默认展开）里 summary 引用块。
  assert.ok(text.includes('原片以悬念开场'), '原片摘要引用块')

  // 手动展开其余三张卡：toggle 点击 → 直接调用组件无法切换内部 state（stub useState 固定），
  // 改为验证 toggle 按钮的 aria-expanded 与标题存在。
  const toggles = flat.filter(node => String(node.props.className || '').includes('ydo-ai-card-toggle'))
  assert.equal(toggles.length, 5)
  const expandedStates = toggles.map(node => node.props['aria-expanded'])
  assert.deepEqual(expandedStates, [true, false, true, false, false], '默认展开位：原视频/改写分镜开，口播/脚本/规则收起')

  // 重新改写按钮：成功态可用。
  const rewriteButton = flat.filter(node => node.type === 'button').find(node => collectText(node) === 'bdRewriteButton')
  assert.ok(rewriteButton, '重新改写按钮存在')
  assert.equal(rewriteButton.props.disabled, false, '成功态可发起重新改写')
  const backButton = flat.filter(node => node.type === 'button').find(node => collectText(node) === 'bdBackToList')
  assert.ok(backButton, '返回列表按钮存在')
  assert.ok(text.includes('r1'), '规则 id 在规则卡 digest 中可见')
})

test('BreakdownDetailPage：失败/进行中/无数据与错误态，重新改写按钮随运行态禁用', async () => {
  const { stub } = recordingReact()
  const sandbox = await evalBdModule(stub)
  const BreakdownDetailPage = vm.runInContext('BreakdownDetailPage', sandbox)

  // 失败 payload（含小写 errorCode）：err-box 失败文案 + 改写按钮可用（failed 非运行态）。
  const failed = BreakdownDetailPage({
    workflow: { ...fullWorkflow, status: 'failed', currentStep: 'storyboard', admin: { workflowId: 'wf-1', errorCode: 'storyboard_quality' } },
    detail: null, loading: false, errorReason: null, onBack: () => {}, onRequestRewrite: () => {}, t,
  })
  const failedText = collectText(failed)
  assert.ok(failedText.includes('bdErrorRetryable'), 'storyboard_quality 映射可重试文案')
  const errorBox = collectFlat(failed).find(node => String(node.props.className || '').includes('ydo-bd-error-box'))
  assert.ok(errorBox && errorBox.props.role === 'alert', '失败文案在预览稿 err-box 中（role=alert）')
  const failedRewrite = collectFlat(failed).filter(node => node.type === 'button').find(node => collectText(node) === 'bdRewriteButton')
  assert.equal(failedRewrite.props.disabled, false, '失败态允许重新改写')

  // needs_input（warn 色同步失败 payload，needs_product_input）：徽标显示
  // 「待补充信息」而非 warn 默认的「已取消」，失败文案渲染，可换规则重新改写。
  const needsInput = BreakdownDetailPage({
    workflow: { ...fullWorkflow, status: 'needs_input', currentStep: 'storyboard', admin: { workflowId: null, errorCode: 'needs_product_input' } },
    detail: null, loading: false, errorReason: null, onBack: () => {}, onRequestRewrite: () => {}, t,
  })
  const needsText = collectText(needsInput)
  assert.ok(needsText.includes('bdStatusNeedsInput'), 'needs_input 徽标显示待补充信息')
  assert.ok(!needsText.includes('bdStatusCancelled'), 'needs_input 不再误显「已取消」')
  assert.ok(needsText.includes('bdErrorNeedsInput'), 'needs_input 渲染缺少产品信息失败文案')
  const needsRewrite = collectFlat(needsInput).filter(node => node.type === 'button').find(node => collectText(node) === 'bdRewriteButton')
  assert.equal(needsRewrite.props.disabled, false, 'needs_input 允许换规则重新改写')

  // 进行中且无产物：大空态（主文案 bdRunningTitle + 副文案 bdRunningSub），
  // 改写按钮禁用；当前步在 8 段进度条中高亮。
  const running = BreakdownDetailPage({
    workflow: { ...fullWorkflow, status: 'running', currentStep: 'vision' },
    detail: null, loading: false, errorReason: null, onBack: () => {}, onRequestRewrite: () => {}, t,
  })
  const runningText = collectText(running)
  assert.ok(runningText.includes('bdRunningTitle') && runningText.includes('bdRunningSub'), '进行中大空态主副文案可见')
  const emptyState = collectFlat(running).find(node => String(node.props.className || '').includes('ydo-bd-empty'))
  assert.ok(emptyState && emptyState.props.role === 'status', '空态容器 role=status')
  const runningRewrite = collectFlat(running).filter(node => node.type === 'button').find(node => collectText(node) === 'bdRewriteButton')
  assert.equal(runningRewrite.props.disabled, true, '进行中禁用重新改写')
  const activeStep = collectFlat(running).find(node => String(node.props.className || '').includes('ydo-bd-step-active'))
  assert.ok(activeStep && collectText(activeStep).includes('bdStep_vision'), '当前步高亮 vision')

  // detail 为 null + loading：加载态；非 loading 且无 workflow：空态引导。
  const loading = BreakdownDetailPage({ workflow: null, detail: null, loading: true, errorReason: null, onBack: () => {}, onRequestRewrite: () => {}, t })
  assert.ok(collectText(loading).includes('loading'))
  const empty = BreakdownDetailPage({ workflow: null, detail: null, loading: false, errorReason: null, onBack: () => {}, onRequestRewrite: () => {}, t })
  assert.ok(collectText(empty).includes('bdDetailEmpty') && collectText(empty).includes('bdDetailEmptySub'), '空态主副文案')

  // 明细加载失败：错误态 + 返回按钮回传 onBack。
  let backed = false
  const errored = BreakdownDetailPage({ workflow: null, detail: null, loading: false, errorReason: 'operationUnavailable', onBack: () => { backed = true }, onRequestRewrite: () => {}, t })
  assert.ok(collectText(errored).includes('operationUnavailable'))
  collectFlat(errored).find(node => node.type === 'button').props.onClick()
  assert.equal(backed, true)
})

test('BreakdownRewriteModal：关闭渲染 null，打开渲染规则单选，确认回传选中规则（可为 null）', async () => {
  const rules = [
    { rewriteRuleId: 'r1', name: '规则一', description: '描述一' },
    { rewriteRuleId: 'r2', name: '规则二', description: '' },
  ]
  // 可重渲染桩：选中规则 → 重渲染 → 确认回传新值（弹框内 useState 语义）。
  const { stub, beginRender } = rerenderableReact()
  const sandbox = await evalBdModule(stub)
  const BreakdownRewriteModal = vm.runInContext('BreakdownRewriteModal', sandbox)
  const confirmed = []
  const closed = []
  const render = () => {
    beginRender()
    return BreakdownRewriteModal({
      open: true, rules, submitting: false,
      onConfirm: ruleId => confirmed.push(ruleId),
      onClose: () => closed.push(true), t,
    })
  }

  assert.equal(
    BreakdownRewriteModal({ open: false, rules, submitting: false, onConfirm: () => {}, onClose: () => {}, t }),
    null,
    '关闭时不渲染',
  )

  let modal = render()
  assert.equal(modal.props.role, 'dialog', '弹框 role=dialog')
  let radios = collectFlat(modal).filter(node => node.props && node.props.role === 'radio')
  assert.equal(radios.length, 2)
  radios[0].props.onClick()
  modal = render()
  radios = collectFlat(modal).filter(node => node.props && node.props.role === 'radio')
  assert.equal(radios[0].props['aria-checked'], true, '重渲染后选中态成立')
  // 确认按钮回传选中的规则 id。
  let confirmButton = collectFlat(modal).filter(node => node.type === 'button').find(node => collectText(node) === 'bdRewriteStart')
  confirmButton.props.onClick()
  assert.deepEqual(confirmed, ['r1'], '确认回传选中的规则 id')

  // 未选中直接确认：回传 null（默认链路改写）。
  modal = render()
  confirmButton = collectFlat(modal).filter(node => node.type === 'button').find(node => collectText(node) === 'bdRewriteStart')
  confirmButton.props.onClick()
  assert.equal(confirmed[1], null, '未选规则确认 = 默认链路（null）')

  // 取消按钮与关闭图标触发 onClose。
  modal = render()
  const cancelButton = collectFlat(modal).filter(node => node.type === 'button').find(node => collectText(node) === 'confirmNo')
  cancelButton.props.onClick()
  assert.deepEqual(closed, [true])

  // 提交中禁用确认/取消（关闭图标保留逃生口）。
  const { stub: stub2 } = recordingReact()
  const sandbox2 = await evalBdModule(stub2)
  const busy = vm.runInContext('BreakdownRewriteModal', sandbox2)({ open: true, rules, submitting: true, onConfirm: () => {}, onClose: () => {}, t })
  assert.ok(collectFlat(busy).filter(node => node.type === 'button' && !String(node.props.className || '').includes('ydo-ai-modal-close')).every(node => node.props.disabled), '提交中确认/取消禁用（关闭图标保留逃生口）')
})

// ---------------------------------------------------------------------------
// client.js 接线契约（源码级断言，防死接线回归）
// ---------------------------------------------------------------------------

test('client.js 接线：Tab 顺序、body-full、Esc 链、轮询守卫、弹框 overlay 级渲染', async () => {
  const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // Tab 顺序：总览 → 视频数据 → 爆款拆解。
  assert.ok(clientSource.indexOf("t('tabOverview')") < clientSource.indexOf("t('tabVideos')"))
  assert.ok(clientSource.indexOf("t('tabVideos')") < clientSource.indexOf("t('tabBreakdown')"), '爆款拆解是第三个 Tab')
  // 拆解 Tab 与总览共用单列完整宽度内容区。
  assert.match(clientSource, /tab === 'overview' \|\| tab === 'breakdown' \? ' ydo-body-full'/u)
  // Esc 链：改写弹框在 AI 弹框之后、overlay 之前。
  assert.ok(
    clientSource.indexOf("else if (aiModalOpen) setAiModalOpen(false)") < clientSource.indexOf("else if (bdRewriteOpen) setBdRewriteOpen(false)")
    && clientSource.indexOf("else if (bdRewriteOpen) setBdRewriteOpen(false)") < clientSource.indexOf('else closeOverlay()'),
    'Esc 优先级：作品详情 → 爆款抽屉 → AI 弹框 → 改写弹框 → overlay',
  )
  // Esc effect 依赖数组必须包含 bdRewriteOpen（闭包旧值会让 Esc 跳层）。
  assert.match(clientSource, /\}, \[visible, detailWorkId, hotDrawerWork, aiModalOpen, bdRewriteOpen\]\)/u)
  // 轮询与卸载清理：归档/workflow 轮询 ref 在组件卸载时停止。
  assert.match(clientSource, /stopPolling\(bdArchivePollRef\)\n\s*stopPolling\(bdWorkflowPollRef\)/u)
  // workflow 轮询锚点：workflowStart 回执顶层 workflowId，历史投影回退
  // admin.workflowId（服务端列表投影顶层刻意不含 workflowId），取不到不启动
  // 轮询——防止 candidate_id_required 空转、详情进度冻结。
  assert.match(clientSource, /const workflowId = target\.workflowId \|\| target\.admin\?\.workflowId/u)
  assert.match(clientSource, /action: 'breakdown\.workflowStatus', workflowId \}/u)
  // 运行态白名单：needs_input/invalid_input 等同步失败 payload（无 workflowId）不进轮询。
  assert.match(clientSource, /\['queued', 'running', 'waiting'\]\.includes\(workflow\.status\)\) startBdWorkflowPolling/u)
  // 归档完成时用户已在详情页 → 挂起自动启动，返回列表补启动（防顶页/防丢启动）。
  assert.match(clientSource, /bdPendingWorkflowRef\.current = \{ candidateId, rewriteRuleId \}/u)
  assert.match(clientSource, /if \(pending && pending\.candidateId\) startBdWorkflow\(pending\.candidateId, pending\.rewriteRuleId\)/u)
  // 规则加载失败的重试入口接线。
  assert.match(clientSource, /onRetryRules: \(\) => loadBdRules\(\)/u)
  // 归档受理键与 workflow 受理键模板（与 index.js 校验、tools-client 常量一致）。
  assert.match(clientSource, /douyin:vv_archive:\$\{newAiAnalysisRequestUuid\(\)\}/u)
  assert.match(clientSource, /douyin:vv_workflow:\$\{newAiAnalysisRequestUuid\(\)\}/u)
  // 改写弹框 overlay 级渲染并接入 confirmBdRewrite。
  assert.match(clientSource, /bdRewriteOpen\n?\s*\? h\(BreakdownRewriteModal/u)
  assert.match(clientSource, /onConfirm: confirmBdRewrite/u)
  // 明细请求序列号守卫：快速切换历史行时旧响应丢弃。
  assert.match(clientSource, /const requestId = \+\+bdDetailRequestRef\.current/u)
  // 主视图/详情页组件接线齐全。
  assert.match(clientSource, /h\(BreakdownNewPage, \{/u)
  assert.match(clientSource, /h\(BreakdownHistoryList, \{/u)
  assert.match(clientSource, /h\(BreakdownDetailPage, \{/u)
})

test('构建产物内联 breakdown 模块且可加载', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const marker of ['shotScriptTable', 'BreakdownDetailPage', 'bdCardShotScript', 'ydo-bd-radio', 'tabBreakdown']) {
    assert.ok(source.includes(marker), `构建产物包含 ${marker}`)
  }
  // import 已被剥离（不允许残留 ESM 语法）。
  assert.doesNotMatch(source, /^import \{[\s\S]*?\} from '\.\/breakdown\.js'\n/m)
  assert.doesNotMatch(source, /^const React = require\('react'\)\n/m, 'breakdown 段的 React require 已剥离（client.js 顶部唯一声明）')
})
