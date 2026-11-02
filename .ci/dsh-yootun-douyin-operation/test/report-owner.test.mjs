// 报表账号负责人快照列测试（RQ-2026-009 §6.7）：日报/周报共用 AccountTable，
// 列序与快照语义经 vm 沙箱真实渲染断言（同 report-ui.test.mjs 模式）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

async function evalReportModule() {
  let source = await readFile(new URL('../src/report-ui.js', import.meta.url), 'utf8')
  source = source.replace(/^import [\s\S]*?$/gm, '').replace(/^export /gm, '')
  const sandbox = vm.createContext({
    require: spec => (spec === 'react'
      ? { createElement: (type, props, ...children) => ({ type, props, children }) }
      : {}),
  })
  vm.runInContext(source, sandbox)
  return sandbox
}

const collectCells = (node, tag, acc = []) => {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) return node.reduce((all, item) => collectCells(item, tag, all), acc)
  if (node.type === tag) acc.push(node)
  return collectCells(node.children || [], tag, acc)
}
const cellText = cell => (Array.isArray(cell.children) ? cell.children : [cell.children])
  .map(child => (typeof child === 'string' ? child : '')).join('')

test('AccountTable：负责人列在账号列后，表头与数据行同序（§6.7）', async () => {
  const sandbox = await evalReportModule()
  const AccountTable = vm.runInContext('AccountTable', sandbox)
  const table = AccountTable({
    accounts: [
      { accountId: 'a1', nickname: '燃豚豚', ownerName: '张三', fanCount: 1000, metrics: { plays: 100, netFans: 0, publishes: 2, likes: 10, comments: 1, shares: 0 } },
      { accountId: 'a2', nickname: '车研社', ownerName: null, fanCount: 2000, metrics: { plays: 200, netFans: 5, publishes: 3, likes: 20, comments: 2, shares: 1 } },
    ],
  })
  // 表头顺序：账号 → 账号负责人 → 现有粉丝 → 播放增量 → 净增粉丝 → 发布/点赞/评论/分享。
  const headers = collectCells(table, 'th').map(cellText)
  assert.deepEqual(headers, ['账号', '账号负责人', '现有粉丝', '播放增量', '净增粉丝', '发布', '点赞', '评论', '分享'])
  // 数据行同序：第 2 个数据单元格是负责人快照值。
  const rows = collectCells(table, 'tr')
  const dataRows = rows.filter(row => collectCells(row, 'td').length)
  const firstRowCells = collectCells(dataRows[0], 'td').map(cellText)
  assert.equal(firstRowCells[1], '张三', '负责人值渲染快照行数据')
})

test('快照语义：旧版本缺失 ownerName 显示 -；不读当前账号动态替换（§6.7）', async () => {
  const sandbox = await evalReportModule()
  const AccountTable = vm.runInContext('AccountTable', sandbox)
  const table = AccountTable({
    accounts: [{ accountId: 'a1', nickname: '燃豚豚', ownerName: undefined, fanCount: 1000, metrics: { plays: 100, netFans: 0, publishes: 2, likes: 10, comments: 1, shares: 0 } }],
  })
  const dataRow = collectCells(table, 'tr').filter(row => collectCells(row, 'td').length)[0]
  const cells = collectCells(dataRow, 'td').map(cellText)
  assert.equal(cells[1], '-', '旧版本行缺 ownerName → -（不造值）')
  const source = await readFile(new URL('../src/report-ui.js', import.meta.url), 'utf8')
  // 快照列只读行数据，绝不出现从当前账号列表按 id 回查替换的写法。
  assert.match(source, /h\('td', null, row\.ownerName \|\| '-'\)/u)
  assert.doesNotMatch(source, /accounts\.find\(.*ownerName/u)
})
