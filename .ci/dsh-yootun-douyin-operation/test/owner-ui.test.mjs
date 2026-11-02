// 负责人维护 UI 测试（RQ-2026-009 §6.2/§6.3）：工具栏入口状态、弹框结构与校验、
// 保存刷新链路、宿主 action 契约。渲染细节由 render-smoke.test.mjs 真实 React 渲染
// 兜底；这里以源码契约断言为主（同 report-ui TF-02/TF-11 先例）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const toolsClientSource = await readFile(new URL('../src/tools-client.js', import.meta.url), 'utf8')

test('工具栏负责人入口：位置在「全部时间作品数」后、状态切换（§6.2）', () => {
  // 入口紧跟全部时间作品数提示之后、批量进度面板之前（§6.2.1 摆放）。
  const worksHintAt = clientSource.indexOf("t('workCountAllTime')")
  const entryAt = clientSource.indexOf("t('accountOwnerLabel')", worksHintAt + 1)
  const batchAt = clientSource.indexOf('batch ? h(BatchPanel')
  assert.ok(worksHintAt > 0, '存在全部时间作品数提示')
  assert.ok(entryAt > worksHintAt, '负责人入口在「全部时间作品数」提示之后')
  assert.ok(batchAt > entryAt, '负责人入口在批量进度面板之前')
  // 未设置 → 「未设置 + 新增」；已设置 → 「{负责人} + 编辑」。
  assert.match(clientSource, /current\.ownerName \|\| t\('ownerNotSet'\)/u)
  assert.match(clientSource, /t\('ownerEdit'\) : t\('ownerAdd'\)/u)
  // 文本 ydo-hint、按钮 ydo-secondary（既有类复用）。
  assert.match(clientSource, /className: 'ydo-hint' \}, `\$\{t\('accountOwnerLabel'\)\}/u)
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

test('保存负责人：本地投影更新 + 总览失效重拉 + 筛选校准只发一次请求（§6.2/§6.5）', () => {
  // 幂等键由页面生成（模板与 tools 侧一致）。
  assert.match(clientSource, /action: 'account\.owner\.set', accountId, ownerName,\n        idempotencyKey: accountOwnerSetIdempotencyKey\(\),/u)
  // 成功后更新 accounts 当前账号 ownerName 并关弹框（§6.2.6）。
  assert.match(clientSource, /setAccounts\(list => list\.map\(item =>\n        item\.accountId === accountId \? \{ \.\.\.item, ownerName: savedName \|\| null \} : item\)\)\n      setOwnerModal\(null\)/u)
  // 总览已加载过即重拉（负责人入口在视频页，tab 恒为 videos——不能以 tab 为条件，
  // 否则校准分支恒不可达）；重置发生时置 skip 标记避免切 tab 后二次查询。
  assert.match(clientSource, /if \(overview\) \{\n        const refreshed = await post\(\{ action: 'overview\.get'/u)
  assert.match(clientSource, /skipOverviewQueryRef\.current = true\n            setOverviewFilters\(next\)/u)
  // ownerName 不在新候选 → 重置全部；选中账号不在新目录 → 重置全部账号。
  assert.match(clientSource, /if \(next\.ownerName && !ownerValues\.includes\(next\.ownerName\)\) next\.ownerName = ''/u)
  assert.match(clientSource, /if \(picked && !catalog\.some\(item => item\.id === picked\)\) next\.accountIds = \[\]/u)
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
  assert.match(indexSource, /const ownerName = cleanString\(body\.ownerName, 128\)\n  \/\/ cleanString 已 strip：空\/纯空白在此拒绝（服务端 DTO min_length=1 二次兜底）。\n  if \(!ownerName\) return \{ status: 'error', reason: 'OWNER_NAME_REQUIRED' \}/u)
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
