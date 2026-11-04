// 负责人维护 UI 测试（RQ-2026-009 §6.2/§6.3）：工具栏入口状态、弹框结构与校验、
// 保存刷新链路、宿主 action 契约。渲染细节由 render-smoke.test.mjs 真实 React 渲染
// 兜底；这里以源码契约断言为主（同 report-ui TF-02/TF-11 先例）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import * as uiFormat from '../src/ui-format.js'

const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const overviewSource = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const toolsClientSource = await readFile(new URL('../src/tools-client.js', import.meta.url), 'utf8')

// vm 加载 overview-ui.js 纯函数（同 overview-owner-column.test.mjs evalOverviewModule 模式）：
// 剥离 import/export 语句后以 CommonJS require stub 执行，导出挂 sandbox。
async function evalOverviewModule() {
  let source = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
  source = source.replace(/^import [\s\S]*?$/gm, '').replace(/^export /gm, '')
  const requireStub = spec => {
    if (spec === 'react') return { createElement: () => null }
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

test('工具栏负责人入口：位置在「采集本账号全部」后、「刷新」前，文本加粗（§6.2，2026-11-04 UI 优化）', () => {
  // 入口前移至工具栏「采集本账号全部」右侧（原一键采集全部位置——该入口已移入
  // 左栏账号管理标题行），仍在「刷新」按钮之前。
  const collectAt = clientSource.indexOf("t('collectAll')")
  const entryAt = clientSource.indexOf("t('accountOwnerLabel')", collectAt + 1)
  const refreshAt = clientSource.indexOf("t('refresh')", entryAt)
  assert.ok(collectAt > 0, '存在采集本账号全部按钮')
  assert.ok(entryAt > collectAt, '负责人入口在「采集本账号全部」之后')
  assert.ok(refreshAt > entryAt, '负责人入口在「刷新」之前')
  // 未设置 → 「未设置 + 新增」；已设置 → 「{负责人} + 编辑」。
  assert.match(clientSource, /current\.ownerName \|\| t\('ownerNotSet'\)/u)
  assert.match(clientSource, /t\('ownerEdit'\) : t\('ownerAdd'\)/u)
  // 文本加粗（ydo-hint-strong，2026-11-04 UI 优化）、按钮 ydo-secondary（既有类复用）。
  assert.match(clientSource, /className: 'ydo-hint-strong' \}, `\$\{t\('accountOwnerLabel'\)\}/u)
  assert.ok(!clientSource.includes("t('batchCollectAll')"), '一键采集全部入口已撤出工具栏（文案键定义保留）')
})

test('一键采集入口移入左栏账号管理标题行：标题左 + 黑底白字按钮右（2026-11-04 UI 优化）', () => {
  // side-head 容器内：标题在前、按钮在后；按钮沿用 ydo-primary（黑底白字，
  // alias 主题变量深色自适应），文案用侧栏短版「采集全部」，运行中切「采集中」，
  // 禁用条件与原工具栏按钮一致（含无可采集账号 title 提示）。
  const headAt = clientSource.indexOf("className: 'ydo-side-head'")
  assert.ok(headAt > 0, '存在 side-head 标题行容器')
  const headBlock = clientSource.slice(headAt, headAt + 700)
  assert.ok(headBlock.indexOf("t('accounts')") > -1, '标题行含账号管理标题')
  assert.ok(headBlock.indexOf("t('batchCollectShort')") > headBlock.indexOf("t('accounts')"), '批量按钮在标题右侧')
  assert.match(headBlock, /className: 'ydo-primary'/u, '批量按钮黑底白字（ydo-primary）')
  assert.match(headBlock, /batchRunning \? t\('collecting'\) : t\('batchCollectShort'\)/u, '运行中切短文案「采集中」')
  assert.match(headBlock, /!hasCollectableAccount,\n        title: !hasCollectableAccount \? t\('noEligibleAccount'\) : undefined,/u, '无可采集账号禁用并提示')
  assert.match(clientSource, /\.ydo-side-head\{display:flex;align-items:center;justify-content:space-between;gap:8px\}/u, '标题行 flex 布局样式')
})

test('批量进度面板移入左栏：标题行下方、账号列表上方；过程文案同步「采集全部」口径（2026-11-04 UI 优化）', () => {
  // 面板位置契约：BatchPanel 挂在 side-head 之后、账号列表（ydo-account-list）之前。
  const headAt = clientSource.indexOf("className: 'ydo-side-head'")
  const panelAt = clientSource.indexOf('batch ? h(BatchPanel')
  const listAt = clientSource.indexOf("className: 'ydo-account-list'")
  assert.ok(headAt > 0 && panelAt > headAt && listAt > panelAt, '面板在标题行之后、账号列表之前')
  assert.ok(!clientSource.slice(clientSource.indexOf("className: 'ydo-toolbar'")).includes('h(BatchPanel'), '工具栏不再渲染批量面板')
  // 过程/终态文案与入口「采集全部」同口径（batchCollecting 仅作面板兜底文本；
  // 按钮运行中复用单账号的「采集中」短文案）。
  assert.match(clientSource, /batchCollecting: '正在采集全部账号'/u)
  assert.match(clientSource, /batchCompleted: '采集全部完成：成功 \{ok\} 个'/u)
  assert.match(clientSource, /batchFailed: '采集全部未完成：成功 \{ok\} · 失败 \{bad\} · 跳过 \{skip\}'/u)
  // 窄栏适配：面板卡片样式去除工具栏 flex-basis 契约，min-width:0 防明细溢出。
  assert.match(clientSource, /ydo-batch-panel\{display:grid;gap:4px;padding:10px 12px;border:1px solid var\(--dsw-alias-border-l1\);border-radius:8px;background:var\(--dsw-alias-bg-layer-1\);min-width:0\}/u)
})

test('负责人弹框：结构与校验（§6.3）', () => {
  // 复用 ydo-mat-* 类；只读账号名 + 必填负责人输入（maxlength 128）。
  assert.match(clientSource, /function OwnerModal\(\{ modal, saving, t, onConfirm, onClose \}\)/u)
  assert.match(clientSource, /className: 'ydo-mat-modal-overlay'/u)
  assert.match(clientSource, /'ydo-mat-modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'ydo-owner-modal-title'/u)
  assert.match(clientSource, /value: modal\.accountName \|\| '', readOnly: true/u)
  assert.match(clientSource, /maxLength: 128,\n          required: true,/u)
  // 保存前再次 trim；空值显示「请输入账号负责人」（OWNER_NAME_REQUIRED → ownerRequired）。
  assert.match(clientSource, /const trimmed = ownerName\.trim\(\)\n    if \(!trimmed\) \{ setErrorReason\('OWNER_NAME_REQUIRED'\); return \}/u)
  assert.match(clientSource, /OWNER_NAME_REQUIRED: 'ownerRequired'/u)
  // 错误经 role=alert 展示。
  assert.match(clientSource, /className: 'ydo-mat-error', role: 'alert' \}, t\(OWNER_ERROR_COPY\[errorReason\] \|\| 'ownerSaveFailed'\)/u)
  // 焦点管理：打开进负责人输入，卸载返回触发按钮（§6.3.3）。
  assert.match(clientSource, /inputRef\.current\?\.focus\?\.\(\)/u)
  assert.match(clientSource, /if \(trigger && typeof trigger\.focus === 'function'\) trigger\.focus\(\)/u)
})

test('保存负责人：本地投影更新 + 先校准后唯一一次查询 + 竞态守卫与错误隔离（§6.2/§6.5，审查 P1-3/P2-1/P2-6）', () => {
  // 幂等键由页面生成（模板与 tools 侧一致）。
  assert.match(clientSource, /action: 'account\.owner\.set', accountId, ownerName,\n        idempotencyKey: accountOwnerSetIdempotencyKey\(\),/u)
  // 成功后更新 accounts 当前账号 ownerName 并关弹框（§6.2.6）。
  assert.match(clientSource, /setAccounts\(list => list\.map\(item =>\n        item\.accountId === accountId \? \{ \.\.\.item, ownerName: savedName \|\| null \} : item\)\)\n      setOwnerModal\(null\)/u)
  // P1-3：查询前先基于「旧目录 + 本次保存结果」校准 filters（不能先按旧筛选
  // 查询再校准——旧 ownerName 失效会拿到空排行）；重拉请求用校准后的 next。
  // 校准逻辑抽为 overview-ui.js 导出纯函数（二轮复审 P1-RES-01 行为级可测）。
  assert.match(clientSource, /const next = calibrateOverviewFiltersAfterOwnerSave\(overview, overviewFilters, accountId, savedName, t\)/u)
  assert.match(overviewSource, /export function calibrateOverviewFiltersAfterOwnerSave\(overview, overviewFilters, accountId, savedName, t\)/u)
  assert.match(clientSource, /const refreshed = await post\(\{ action: 'overview\.get', \.\.\.buildOverviewFilters\(next\) \}\)/u)
  // 校准三段：ownerName 不在新候选 → 重置全部；选中账号不在新目录或不再属于
  // 当前负责人 → 重置全部账号。
  assert.match(overviewSource, /if \(next\.ownerName && !ownerValues\.includes\(next\.ownerName\)\) next\.ownerName = ''/u)
  assert.match(overviewSource, /if \(!pickedItem \|\| !inOwnerScope\) next\.accountIds = \[\]/u)
  // P2-1：手动重拉纳入 overviewRequestRef 序列号守卫（请求前后一致才落状态）。
  assert.match(clientSource, /const requestId = \+\+overviewRequestRef\.current\n        setOverviewLoading\(true\)/u)
  assert.match(clientSource, /if \(requestId === overviewRequestRef\.current\) \{\n            if \(refreshed\.status === 'ready'/u)
  // P2-6：刷新失败保留旧总览（保存仍返回 ok）；校准失败也应用、不置 skip，
  // 让筛选 effect 自然重查自愈。
  assert.match(clientSource, /if \(requestId === overviewRequestRef\.current && filtersChanged\) \{\n          skipOverviewQueryRef\.current = refreshedOk\n          setOverviewFilters\(next\)\n        \}/u)
  assert.match(clientSource, /return \{ ok: true \}\n    \} catch \{\n      return \{ ok: false, reason: 'owner_save_failed' \}\n    \} finally \{\n      setOwnerSaving\(false\)/u)
})

test('P1-RES-01 行为级：负责人仍在但已选账号已不属其名下 → 清空账号选择', async () => {
  const sandbox = await evalOverviewModule()
  const calibrate = vm.runInContext('calibrateOverviewFiltersAfterOwnerSave', sandbox)
  const buildOverviewFilters = vm.runInContext('buildOverviewFilters', sandbox)
  const t = key => key
  // 复审场景：张三名下 A、B，李四名下 C；筛选「张三 + 账号 A」，把 A 改到李四。
  const overview = {
    accountOptions: [
      { accountId: 'A', nickname: '账号A', workCount: 3, ownerName: '张三' },
      { accountId: 'B', nickname: '账号B', workCount: 2, ownerName: '张三' },
      { accountId: 'C', nickname: '账号C', workCount: 1, ownerName: '李四' },
    ],
  }
  const filters = { window: '7d', sort: 'hot_count', accountIds: ['A'], ownerName: '张三' }
  const next = calibrate(overview, filters, 'A', '李四', t)
  assert.equal(next.ownerName, '张三', '张三因账号 B 仍在候选 → 负责人筛选保留')
  // vm realm 数组先展开成宿主数组再比较（原型不同的 deepStrictEqual 会失败）。
  assert.deepEqual([...next.accountIds], [], '账号 A 已不属张三名下 → 清空账号选择（旧实现滞留 A）')
  // 重拉请求按校准后 filters 构建：负责人=张三、不携带 accountIds（查张三名下全部，即 B）。
  const built = buildOverviewFilters(next)
  assert.equal(built.ownerName, '张三')
  assert.deepEqual([...built.accountIds], [], '请求不再携带滞留的账号 A')
  // 对照 1：负责人重置「全部」时已选账号仍属完整目录 → 保留（不做负责人范围检查）。
  const resetOwner = calibrate(overview, { ...filters, ownerName: '李四', accountIds: ['C'] }, 'C', '王五', t)
  assert.equal(resetOwner.ownerName, '', '李四改名王五 → 李四从候选消失，负责人重置「全部」')
  assert.deepEqual([...resetOwner.accountIds], ['C'], '账号 C 仍在目录 → 保留已选账号')
  // 对照 2：负责人不变、账号仍在范围内 → 双双保留（正常保存不受影响）。
  const untouched = calibrate(overview, filters, 'B', '张三', t)
  assert.equal(untouched.ownerName, '张三')
  assert.deepEqual([...untouched.accountIds], ['A'], '保存 B 的负责人未改变 A 的归属 → 筛选原样保留')
  // 对照 3：负责人候选 trim 口径一致——目录值带空白时仍按 trim 后匹配。
  const trimmedCatalog = {
    accountOptions: [
      { accountId: 'A', nickname: '账号A', workCount: 3, ownerName: ' 张三 ' },
      { accountId: 'B', nickname: '账号B', workCount: 2, ownerName: ' 张三 ' },
    ],
  }
  const kept = calibrate(trimmedCatalog, { ...filters, accountIds: ['A'] }, 'B', '张三', t)
  assert.deepEqual([...kept.accountIds], ['A'], '目录 ownerName 带空白 → trim 后与筛选值一致，账号保留')
})

test('Esc 链：负责人/投流弹框在最上层且保存中不关闭（§6.3.2）', () => {
  assert.match(clientSource, /if \(promotionModal\) \{ if \(!promotionSaving\) setPromotionModal\(null\) \}\n        else if \(ownerModal\) \{ if \(!ownerSaving\) setOwnerModal\(null\) \}\n        else if \(detailWorkId\)/u)
  // 弹层状态必须在 Esc effect 依赖里（闭包捕获旧值会穿透关页——审查修复先例）。
  assert.match(clientSource, /\[visible, promotionModal, promotionSaving, ownerModal, ownerSaving, detailWorkId,/u)
})

test('宿主 action 契约：account.owner.set（§5.1）', () => {
  // 路由注册 + 入参清洗 + 键模板校验（与 tools 服务端 common 前缀一致）。
  assert.match(indexSource, /case 'account\.owner\.set':\n              return send\(res, 200, await handleAccountOwnerSet\(deps, toolCtx, body\)\)/u)
  assert.match(indexSource, /const OWNER_SET_KEY_PATTERN = \/\^douyin:account_owner_set:\.\+\$\//u)
  // P2-7：超长 trim 后 >128 显式 OWNER_NAME_INVALID（不 cleanString 静默截断）。
  assert.match(indexSource, /if \(!trimmedOwnerName\) return \{ status: 'error', reason: 'OWNER_NAME_REQUIRED' \}\n  if \(trimmedOwnerName\.length > 128\) return \{ status: 'error', reason: 'OWNER_NAME_INVALID' \}/u)
  assert.match(indexSource, /if \(!OWNER_SET_KEY_PATTERN\.test\(idempotencyKey\)\) \{\n    return \{ status: 'error', reason: 'INVALID_IDEMPOTENCY_KEY' \}\n  \}/u)
  assert.match(indexSource, /callTool\(ctx, 'douyin_account_owner_set', \{ accountId, ownerName, idempotencyKey \}\)/u)
  // tools-client 登记幂等键生成器（模板单一登记点）。
  assert.match(toolsClientSource, /accountOwnerSetIdempotencyKey = requestUuid => `douyin:account_owner_set:\$\{requestUuid\}`/u)
  // 错误码白名单登记（§4.6）。
  for (const code of ['OWNER_NAME_REQUIRED', 'OWNER_NAME_INVALID', 'PROMOTION_ALREADY_EXISTS', 'PROMOTION_NOT_FOUND', 'PROMOTION_FIELD_REQUIRED', 'PROMOTION_VALUE_INVALID']) {
    assert.ok(toolsClientSource.includes(`'${code}'`), `ALLOWED_ERROR_CODES 登记 ${code}`)
  }
})

test('宿主投影：accounts.list 透传 owner_name → ownerName（camelCase 投影层）', () => {
  assert.match(indexSource, /ownerName: null,\n      deleteState: 'none',\n      local: true,/u)
  assert.match(indexSource, /ownerName: existing\?\.ownerName \?\? \(cleanString\(item\.owner_name, 128\) \|\| null\),/u)
})
