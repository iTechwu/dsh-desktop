// UI 展示逻辑回归：列序与指标文案（产品契约）、缺失值显示 `—`、缺口与状态文案。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { test } from 'node:test'

import {
  COLUMNS,
  EMPTY,
  accountState,
  formatCell,
  formatCount,
  gapReasonText,
  hasGap,
  progressText,
} from '../src/ui-format.js'

const labels = {
  colTitle: '作品名称', colUrl: '作品链接', colFans: '粉丝数量', colPlay: '播放量', colCollect: '收藏量',
  colLike: '点赞量', colComment: '评论量', colBounce2s: '2s跳出率', colCompletion5s: '5s完播率',
  colCompletion: '完播率', colDuration: '平均播放时长', colProportion: '平均播放占比',
  seconds: '秒',
}
const t = key => ({ ...labels, seconds: '秒', not_exposed: '本次接口未提供', below_min_view: '播放量低于抖音最小观看门槛', request_failed: '接口请求失败，展示的是上一次成功采集的热词', other: '本次未取到', progressCollect: '采集进度', progressIngest: '入库进度', runRunning: '采集中', gapNotExposed: '本次接口未提供', gapBelowMinView: '播放量低于抖音最小观看门槛', gapRequestFailed: '接口请求失败，展示的是上一次成功采集的热词', gapNoData: '该作品暂无此数据', gapOther: '本次未取到' }[key] || key)

test('表格列序与指标文案严格符合契约（2s跳出率 / 5s完播率 / 完播率 / 平均播放时长 / 平均播放占比）', () => {
  assert.deepEqual(
    COLUMNS.map(column => t(column.label)),
    ['作品名称', '作品链接', '粉丝数量', '播放量', '收藏量', '点赞量', '评论量', '2s跳出率', '5s完播率', '完播率', '平均播放时长', '平均播放占比'],
  )
  assert.deepEqual(COLUMNS.slice(0, 2).map(column => column.sticky), [0, 220], '前两列固定')
  assert.equal(COLUMNS[7].key, 'bounce_rate_2s_pct')
  assert.equal(COLUMNS[8].key, 'completion_rate_5s_pct')
  assert.equal(COLUMNS[9].key, 'completion_rate_pct')
})

test('缺失值显示 —（不显示 0，也不回填历史值）', () => {
  assert.equal(formatCell(null, 'pct', t), EMPTY)
  assert.equal(formatCell(undefined, 'count', t), EMPTY)
  assert.equal(formatCell('', 'text', t), EMPTY)
  assert.equal(formatCell(0, 'pct', t), '0%', '真实的 0 要显示')
  assert.equal(formatCell(3.09, 'pct', t), '3.09%')
  assert.equal(formatCell(13.46, 'seconds', t), '13.46秒')
  assert.equal(formatCell(10847, 'count', t), '1.1万')
  assert.equal(formatCell(290, 'count', t), '290')
})

test('缺口原因映射为可读文案，未知原因收敛为「其他」', () => {
  assert.equal(gapReasonText('not_exposed', t), '本次接口未提供')
  assert.equal(gapReasonText('below_min_view', t), '播放量低于抖音最小观看门槛')
  assert.equal(gapReasonText('request_failed', t), '接口请求失败，展示的是上一次成功采集的热词')
  assert.equal(gapReasonText('no_data', t), '该作品暂无此数据')
  assert.equal(gapReasonText('something_new', t), '本次未取到')
})

test('hasGap 判定：仅当本次确实记录了缺口', () => {
  assert.equal(hasGap({ data_gap: { play_count: { reason: 'not_exposed' } } }), true)
  assert.equal(hasGap({ data_gap: {} }), false)
  assert.equal(hasGap({}), false)
  assert.equal(hasGap(null), false)
})

test('账号状态：仅登录有效时可采集，过期/未知需重新扫码', () => {
  assert.deepEqual(accountState({ sessionStatus: 'ok' }), { status: 'ok', collectable: true, needsRescan: false })
  assert.deepEqual(accountState({ sessionStatus: 'expired' }), { status: 'expired', collectable: false, needsRescan: true })
  assert.deepEqual(accountState({}), { status: 'unknown', collectable: false, needsRescan: true })
})

test('采集进度文案：采集阶段按作品、入库阶段按批次', () => {
  assert.equal(
    progressText({ progress: { phase: 'work', index: 3, total: 25 } }, key => ({ progressCollect: '采集进度' }[key] || key)),
    '采集进度 3/25',
  )
  assert.equal(
    progressText({ progress: { phase: 'batch_done', batchNo: 2, totalBatches: 3, succeeded: 24, expected: 25 } }, key => ({ progressIngest: '入库进度' }[key] || key)),
    '入库进度 2/3 · 24/25',
  )
  assert.equal(progressText(null, key => key), '')
})

test('构建产物 lib/client.js 可加载，且内联了展示逻辑', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loaded = []
  const sandbox = {
    window: { __ModuleLoader__: { load: definition => loaded.push(definition) } },
    console,
  }
  vm.createContext(sandbox)
  // 工厂函数需要 react / UI primitives：用最小桩替换 require。
  const stubs = {
    react: {
      createElement: () => null,
      useCallback: fn => fn,
      useEffect: () => {},
      useMemo: fn => fn(),
      useRef: value => ({ current: value }),
      useState: value => [value, () => {}],
      useSyncExternalStore: () => false,
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      IconCloseOutline16: () => null,
      IconPlayOutline16: () => null,
      Tooltip: () => null,
    },
  }
  vm.runInContext(source, sandbox)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, '@dofe/dsh-yootun-douyin-operation')
  const moduleExports = loaded[0].factory(name => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`)
    return stubs[name]
  })
  assert.equal(typeof moduleExports.apply, 'function')
  // 跨 realm 数组：展开到本 realm 再比较
  assert.deepEqual([...moduleExports.inject], ['slots', 'locale'])
  assert.equal(moduleExports.formatCell(null, 'pct', t), EMPTY)
  assert.equal(moduleExports.hasGap({ data_gap: { a: {} } }), true)
  assert.equal(typeof moduleExports.progressText, 'function')
  assert.deepEqual(moduleExports.COLUMNS || [], [], 'COLUMNS 为模块内部细节，不对外导出')
})

test('构建产物渲染作品表格：12 列文案正确、NULL 显示 —、前两列固定', async () => {
  const { moduleExports, t } = await loadBundle()
  const opened = []
  const work = {
    work_id: 'w1',
    title: '示例作品',
    url: 'https://www.douyin.com/video/1',
    play_count: 10847,
    collect_count: 76,
    like_count: 49,
    comment_count: 0,
    bounce_rate_2s_pct: 31.73,
    completion_rate_5s_pct: 40.17,
    completion_rate_pct: null,          // 本次未暴露 → 必须显示 —
    avg_watch_duration_s: 13.46,
    avg_view_proportion_pct: 17.61,
    data_gap: { completion_rate_pct: { reason: 'below_min_view' } },
  }
  const tree = moduleExports.WorkTable({ works: [work], fanCount: 290, onOpen: id => opened.push(id), t: tRender })
  const flat = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    flat.push(node)
    walk(node.children)
  }
  walk(tree)

  const textOf = node => node.children.map(child => (child && typeof child === 'object' ? textOf(child) : child === null || child === undefined ? '' : String(child))).join('')
  const cells = flat.filter(node => node.props && node.props.role === 'cell')
  const headers = flat.filter(node => node.props && node.props.role === 'columnheader')
  assert.equal(headers.length, 12, '表格 12 列')
  assert.deepEqual(headers.map(textOf), [
    '作品名称', '作品链接', '粉丝数量', '播放量', '收藏量', '点赞量', '评论量',
    '2s跳出率', '5s完播率', '完播率', '平均播放时长', '平均播放占比',
  ])
  const firstRow = cells.slice(0, 12)
  assert.equal(textOf(firstRow[0]), '示例作品')
  assert.equal(textOf(firstRow[2]), '290', '粉丝数量按账号重复展示')
  assert.equal(textOf(firstRow[3]), '1.1万')
  assert.equal(textOf(firstRow[7]), '31.73%')
  assert.equal(textOf(firstRow[8]), '40.17%')
  assert.equal(textOf(firstRow[9]), EMPTY, '本次未暴露的完播率显示 —')
  assert.equal(textOf(firstRow[10]), '13.46秒')
  assert.equal(textOf(firstRow[11]), '17.61%')
  assert.ok(firstRow[0].props.className.includes('ydo-cell-sticky'))
  assert.ok(firstRow[1].props.className.includes('ydo-cell-sticky'))
  assert.equal(firstRow[0].props.style.left, '0px')
  assert.equal(firstRow[1].props.style.left, '220px')
})

test('构建产物渲染详情子页面：性别圆环/年龄/流量来源/进度/地域/搜索词/热词/缺口', async () => {
  const { moduleExports, t } = await loadBundle()
  const detail = {
    work: {
      title: '示例作品',
      publish_time: '2026-09-08T09:00:00.000Z',
      visibility: 'active',
      traffic_source: [{ source_key: 'homepage_hot', source_label: '推荐(首页推荐)', share_pct: 99.36 }],
      search_keywords: [{ keyword: '示例词', percent: 12.5 }],
      progress_analysis: { drag_back_curve: [{ key: '1', value: 1 }], drag_forward_curve: [] },
      data_gap: { completion_rate_pct: { reason: 'not_exposed' } },
    },
    audience: { gender: [{ key: 'male', pct: 92.66 }, { key: 'female', pct: 7.34 }], age: [{ key: '41-50', pct: 34.44 }], province: [{ key: '广东', pct: 10 }], city_level: [{ key: '三线', pct: 23.38 }] },
    hotwords: [{ word: '路政', rank: 1, rawScore: '2' }, { word: '保险', rank: 2, rawScore: '2' }],
  }
  const tree = moduleExports.WorkDetailModal({ accountId: 'acc-1', workId: 'w1', detail, trend: { total: 3 }, loading: false, onClose: () => {}, t: tRender })
  const text = []
  const walk = node => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node !== 'object') { text.push(String(node)); return }
    walk(node.children)
  }
  walk(tree)
  const joined = text.join('|')
  for (const label of ['性别分布', '年龄分布', '流量来源', '进度分析', '地域分布', '城市级别', '搜索词', '评论热词', '数据缺口']) {
    assert.ok(joined.includes(label), `详情子页面缺少「${label}」`)
  }
  assert.ok(joined.includes('路政'), '热词展示')
  assert.ok(joined.includes('示例词 12.5%'), '搜索词带占比')
  assert.ok(joined.includes('本次接口未提供'), '缺口原因可读')
  assert.ok(joined.includes('3'), '展示历史采集次数')
})

// 渲染测试用的最小字典：与 src/client.js 的中文文案保持一致（断言渲染出的字面量）。
const renderLabels = {
  ...labels,
  gender: '性别分布', age: '年龄分布', trafficSource: '流量来源', progressCurve: '进度分析',
  province: '地域分布', cityLevel: '城市级别', searchKeywords: '搜索词', hotwords: '评论热词',
  gapTitle: '数据缺口', gapNotExposed: '本次接口未提供', gapBelowMinView: '播放量低于抖音最小观看门槛',
  gapRequestFailed: '接口请求失败，展示的是上一次成功采集的热词', gapOther: '本次未取到',
  none: '暂无数据', noSearch: '暂无搜索词', noHotword: '暂无热词', seconds: '秒',
  lastCollected: '上次采集', privateBadge: '已设为私密', detail: '作品详情', close: '关闭',
  trendCount: '历史采集 {count} 次', collectAll: '采集本账号全部', tabVideos: '视频数据',
  data: '数据展示区', accounts: '账号管理', title: '抖音运营', subtitle: '', open: '抖音运营',
}
const tRender = key => renderLabels[key] || key

async function loadBundle() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loaded = []
  const rendered = []
  const sandbox = {
    console,
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    window: { __ModuleLoader__: { load: definition => loaded.push(definition) }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const stubs = {
    react: {
      createElement: (type, props, ...children) => { const node = { type, props: props || {}, children }; rendered.push(node); return node },
      useCallback: fn => fn,
      useEffect: () => {},
      useMemo: fn => fn(),
      useRef: value => ({ current: value }),
      useState: value => [value, () => {}],
      useSyncExternalStore: () => false,
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      IconCloseOutline16: props => ({ type: 'icon-close', props: props || {}, children: null }),
      IconPlayOutline16: props => ({ type: 'icon-play', props: props || {}, children: null }),
      Tooltip: props => ({ type: 'tooltip', props: props || {}, children: props && props.children }),
    },
  }
  const moduleExports = loaded[0].factory(name => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`)
    return stubs[name]
  })
  return { moduleExports, t: tRender }
}

test('构建产物注册侧边栏入口与整页 overlay', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loaded = []
  const sandbox = {
    console,
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    window: {
      __ModuleLoader__: { load: definition => loaded.push(definition) },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const stubs = {
    react: {
      createElement: () => null,
      useCallback: fn => fn,
      useEffect: () => {},
      useMemo: fn => fn(),
      useRef: value => ({ current: value }),
      useState: value => [value, () => {}],
      useSyncExternalStore: () => false,
    },
    '@deepseek-ai/dsh-client-ui-primitives': { IconCloseOutline16: () => null, IconPlayOutline16: () => null, Tooltip: () => null },
  }
  const moduleExports = loaded[0].factory(name => stubs[name])
  const registered = []
  const effects = []
  const ctx = {
    effect: fn => { effects.push(fn) },
    locale: { register: () => {}, bind: () => key => key },
    slots: { inject: (slot, installer) => { registered.push(slot); installer() }, register: config => registered.push(`${slotOf(config)}:${config.id}`) },
  }
  function slotOf(config) { return config.name }
  moduleExports.apply(ctx)
  assert.ok(registered.includes('sidebar.footer.action'))
  assert.ok(registered.includes('shell.overlay'))
  assert.equal(effects.length, 3, '字典/样式/互斥 overlay 三个 effect')
})
