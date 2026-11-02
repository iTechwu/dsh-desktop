// 负责人列测试（RQ-2026-009 §6.6）：排行表新增负责人列的位置、空值、窄容器
// data-label 与列轨道。渲染经 vm 沙箱真实执行 OverviewPage（同 ui.test.mjs 模式）。
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

const fixture = {
  summary: { accountCount: 2, workCount: 30, totalPlayCount: 50000, hotWorkCount: 1, hotRatePct: 10 },
  accounts: [
    { accountId: 'a1', nickname: '燃豚豚', sessionStatus: 'ok', fanCount: 287, workCount: 10, medianPlayCount: 1000, hotWorkCount: 2, hotRatePct: 20, engagementRatePct: 6.2, ownerName: '张三' },
    { accountId: 'a2', nickname: '车研社', sessionStatus: 'ok', fanCount: 18000, workCount: 20, medianPlayCount: 2000, hotWorkCount: 1, hotRatePct: 5, engagementRatePct: 5.1, ownerName: null },
  ],
  accountOptions: [
    { accountId: 'a1', nickname: '燃豚豚', workCount: 10, ownerName: '张三' },
    { accountId: 'a2', nickname: '车研社', workCount: 20, ownerName: null },
  ],
  accountTotal: 2,
  hotWorks: [],
}

test('排行表负责人列：账号列后追加、值/空值、data-label（§6.6）', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
  }
  const sandbox = await evalOverviewModule(reactStub)
  const OverviewPage = vm.runInContext('OverviewPage', sandbox)
  OverviewPage({
    overview: fixture, loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [], ownerName: '' },
    accounts: fixture.accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t: key => key,
  })
  // 手动执行函数组件（AccountRow 等），内层 h 才进 hLog。
  for (let index = 0; index < hLog.length; index += 1) {
    const node = hLog[index]
    if (typeof node.type === 'function') node.type(node.props)
  }
  // 行结构：排名/账号/负责人/粉丝/作品数/…。负责人 cell 紧跟账号 cell。
  const rows = hLog.filter(node => String(node.props?.className || '').includes('ydo-ov-account-row'))
  assert.equal(rows.length, 2, '2 个账号行')
  const firstRow = rows[0]
  const cells = firstRow.children.filter(child => child.props?.role === 'cell')
  assert.equal(String(cells[1].props['data-label']), 'colAccount', '第 2 列是账号')
  assert.equal(String(cells[2].props['data-label']), 'colOwner', '第 3 列是负责人（RQ-2026-009）')
  assert.equal(cells[2].children[0], '张三', '负责人值直接渲染接口字段')
  // 空值显示「—」不造值。
  const secondRow = rows[1]
  const secondCells = secondRow.children.filter(child => child.props?.role === 'cell')
  assert.equal(secondCells[2].children[0], '—', '未设置负责人显示 —')
  // 表头同序：colAccount 表头后是 colOwner 表头。
  const head = hLog.find(node => String(node.props?.className || '').includes('ydo-ov-head'))
  const headCells = head.children.filter(child => child.props?.role === 'columnheader')
  assert.equal(String(headCells[1].props['data-label'] || headCells[1].children[0]), 'colAccount')
  assert.equal(String(headCells[2].children[0]), 'colOwner', '表头第 3 列为负责人')
  // 行下钻保持：点击行进单账号分析（Enter 同）。
  assert.equal(typeof firstRow.props.onClick, 'function')
  firstRow.props.onClick()
  assert.ok(firstRow.props['data-account-id'] === 'a1')
})

test('列轨道：ydo-ov-tr-rank 9 列（1015 8 列 + 负责人列），窄容器 data-label 契约不变', async () => {
  const source = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
  const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // 轨道唯一新增：负责人列 minmax(110px,1fr) 插在账号列后（§6.6.3）。
  assert.match(clientSource, /\.ydo-ov-tr-rank\{grid-template-columns:48px minmax\(90px,\.8fr\) minmax\(110px,1fr\) 88px 96px repeat\(6,minmax\(72px,\.35fr\)\)\}/u)
  // 负责人单元格与表头都携带 data-label（窄容器卡片重排复用既有 attr(data-label) 通道）。
  assert.match(source, /'data-label': t\('colOwner'\)/u)
  assert.match(clientSource, /content:attr\(data-label\)/u, '窄容器字段名来自 data-label（契约不变）')
  // 负责人列渲染接口字段原值，不做任何派生计算（展示层边界）。
  assert.match(source, /account\.ownerName \|\| '—'/u)
})
