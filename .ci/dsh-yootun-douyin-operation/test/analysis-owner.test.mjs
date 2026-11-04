// 单账号分析页负责人展示测试（RQ-2026-009 §6.6）：标题下只读负责人行、
// 未设置不渲染。分析页数据来自 douyin_account_analysis（无 ownerName 入参），
// 负责人来自宿主 accounts 投影——纯展示，不影响请求参数（§4.6 白名单口径）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const analysisSource = await readFile(new URL('../src/analysis-ui.js', import.meta.url), 'utf8')
const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const hostSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')

test('分析页标题下负责人行：有值渲染 ydo-hint、无值不渲染（§6.6）', () => {
  // 位置：账号标题 h3 之后、粉丝/作品数 hint 之前。
  const titleAt = analysisSource.indexOf("t('accountTitle').replace('{name}'")
  const ownerAt = analysisSource.indexOf('account.ownerName ?')
  const fanHintAt = analysisSource.indexOf('`${t(\'fanCount\')} ${count(account.fanCount)}')
  assert.ok(titleAt > 0 && ownerAt > titleAt && fanHintAt > ownerAt, '负责人行紧跟标题、在粉丝 hint 前')
  // 复用工具栏同款文案键 accountOwnerLabel；2026-11-04 UI 优化改 ydo-hint-strong
  //（加粗，样式仍集中在 client.js，不新增文件级样式）。
  assert.match(analysisSource, /account\.ownerName \? h2\('p', \{ className: 'ydo-hint-strong' \}, `\$\{t\('accountOwnerLabel'\)\}\$\{account\.ownerName\}`\) : null/u)
  assert.match(clientSource, /\.ydo-hint-strong\{[^}]*font-weight:600\}/u, '加粗样式登记于共享样式表')
})

test('account.analysis 请求与宿主 handler 均不携带 ownerName（§4.6 字段白名单）', () => {
  // client.js 的 account.analysis 沿用总览窗口派生日期；ownerName 只进 overview.get/export。
  const analysisCall = clientSource.match(/action: 'account\.analysis', [\s\S]{0,120}/u)
  assert.ok(analysisCall, 'account.analysis 调用存在')
  assert.ok(!analysisCall[0].includes('ownerName'), 'account.analysis 请求不带 ownerName')
  // 宿主 handler 显式字段白名单——handleAccountAnalysis 不透传 ownerName。
  const handler = hostSource.match(/async function handleAccountAnalysis\([\s\S]*?\n\}/u)
  assert.ok(handler, 'handleAccountAnalysis 存在')
  assert.ok(!handler[0].includes('ownerName'), 'analysis handler 不透传 ownerName')
})
