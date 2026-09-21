// UI 展示逻辑回归：列序与指标文案（产品契约）、缺失值显示 `—`、缺口与状态文案。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { test } from 'node:test'

import {
  COLUMNS,
  DEFAULT_SORT_STATE,
  EMPTY,
  accountState,
  basisLines,
  compareNullableNumbers,
  formatAgeBucket,
  formatCell,
  formatCount,
  formatDateTime,
  formatPercent,
  gapFieldLabel,
  gapReasonText,
  genderColor,
  genderLabel,
  hasGap,
  nextSortState,
  progressStatus,
  progressStatusText,
  progressText,
  safeAvatarSrc,
  safeWorkUrl,
  sortWorks,
  tableTemplate,
  trafficSourceLabel,
} from '../src/ui-format.js'

test('trend count only renders finite positive values through the shared count formatter', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(source, /Number\.isFinite\(Number\(trend\.total\)\) && Number\(trend\.total\) > 0/u)
  assert.match(source, /replace\('\{count\}', formatCount\(trend\.total\)\)/u)
  assert.doesNotMatch(source, /replace\('\{count\}', String\(trend\.total\)\)/u)
})

// ---------------------------------------------------------------------------
// 源码级模块加载辅助：vm 沙箱按构建脚本同法剥离 ESM import/export 后求值，
// ui-format 纯函数（basisLines/formatDateTime 等）注入真实实现（内联后同作用域）。
// ---------------------------------------------------------------------------
const UI_FORMAT_IMPORT = /^import \{[\s\S]*?\} from '\.\/ui-format\.js'\n/m
const SELECT_UI_IMPORT = /^import \{ FilterSelect \} from '\.\/select-ui\.js'\n/m
function FilterSelect() { return null }

async function evalUiModule(url, sandbox, reactStub) {
  let source = await readFile(url, 'utf8')
  if (!UI_FORMAT_IMPORT.test(source)) throw new Error('test: ui-format import not found')
  source = source.replace(UI_FORMAT_IMPORT, '').replace(SELECT_UI_IMPORT, '').replace(/^export /gm, '')
  // ui-format 全部导出注入真实实现（构建内联后同作用域，标识符直接可见）。
  const uiFormatModule = await import(new URL('../src/ui-format.js', import.meta.url).href)
  const context = {
    console,
    ...uiFormatModule,
    require: name => {
      if (name === 'react') return reactStub || { createElement: () => null }
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconDownloadOutline16: () => null }
      throw new Error(`unexpected require: ${name}`)
    },
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    FilterSelect,
    ...sandbox,
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  return context
}

const labels = {
  colTitle: '作品名称', colUrl: '作品链接', colPlay: '播放量', colCollect: '收藏量',
  colLike: '点赞量', colComment: '评论量', colBounce2s: '2s跳出率', colCompletion5s: '5s完播率',
  colCompletion: '完播率', colDuration: '平均播放时长', colProportion: '平均播放占比',
  genderMale: '男', genderFemale: '女', genderOther: '其他', gapFieldOther: '其他指标',
  progressCurve: '进度分析',
  publishTime: '发布时间', latestCollected: '最近采集', noRecord: '暂无记录',
  ageUnder18: '小于18岁', age18to23: '18-23岁', age24to30: '24-30岁', age31to40: '31-40岁',
  age41to50: '41-50岁', ageOver50: '大于50岁', ageOther: '其他年龄段',
  srcHomepageHot: '推荐(首页推荐)', srcHomepage: '个人主页', srcFamiliar: '朋友/熟人', srcFollow: '关注',
  srcSearch: '搜索', srcMessage: '私信/分享', srcNearby: '同城', srcKnownOther: '其他', sourceOther: '其他来源',
  dragBack: '拖回', dragForward: '拖前',
  progressNoData: '该作品暂无进度分析数据', progressNotExposed: '本次接口未提供进度分析数据',
  progressRequestFailed: '进度分析请求失败，请稍后重试',
  seconds: '秒',
}
const t = key => ({ ...labels, seconds: '秒', not_exposed: '本次接口未提供', below_min_view: '播放量低于抖音最小观看门槛', request_failed: '本次请求失败，请稍后重试', other: '本次未取到', progressCollect: '采集进度', progressIngest: '入库进度', runRunning: '采集中', gapNotExposed: '本次接口未提供', gapBelowMinView: '播放量低于抖音最小观看门槛', gapRequestFailed: '本次请求失败，请稍后重试', gapNoData: '该作品暂无此数据', gapOther: '本次未取到' }[key] || key)

test('表格列序与指标文案严格符合契约（2s跳出率 / 5s完播率 / 完播率 / 平均播放时长 / 平均播放占比），粉丝数不进表', () => {
  assert.deepEqual(
    COLUMNS.map(column => t(column.label)),
    ['作品名称', '作品链接', '播放量', '收藏量', '点赞量', '评论量', '2s跳出率', '5s完播率', '完播率', '平均播放时长', '平均播放占比'],
  )
  assert.ok(COLUMNS.every(column => !column.key.includes('fan')), '粉丝数是账号级指标，只在账号卡展示（§5.3）')
  assert.deepEqual(COLUMNS.slice(0, 2).map(column => column.sticky), [0, 220], '前两列固定')
  assert.equal(COLUMNS[6].key, 'bounce_rate_2s_pct')
  assert.equal(COLUMNS[7].key, 'completion_rate_5s_pct')
  assert.equal(COLUMNS[8].key, 'completion_rate_pct')
})

test('tableTemplate 单一来源生成列轨道：表头与每行共用，sticky 列偏移等于前序宽度之和', () => {
  const template = tableTemplate()
  assert.equal(template, '220px 200px 100px 100px 100px 100px 104px 104px 96px 120px 110px')
  const sticky = COLUMNS.filter(column => column.sticky !== undefined)
  for (const column of sticky) {
    const offset = COLUMNS.slice(0, COLUMNS.indexOf(column)).reduce((sum, item) => sum + (item.width || 100), 0)
    assert.equal(column.sticky, offset, `${column.key} 的 sticky 偏移必须等于前序列宽之和`)
  }
  // 自定义列（例如以后再加列）也要能生成模板，缺宽度回退 100px。
  assert.equal(tableTemplate([{ width: 80 }, { key: 'x' }]), '80px 100px')
})

test('排序元数据：恰好 9 个数值列可排序，名称/链接不可排序', () => {
  const sortable = COLUMNS.filter(column => column.sortable === true)
  assert.equal(sortable.length, 9, '契约：包含且仅包含 9 个可排序列')
  assert.deepEqual(
    COLUMNS.filter(column => column.sortable !== true).map(column => column.key),
    ['title', 'url'],
    '作品名称和作品链接不提供排序（§6.2）',
  )
  assert.ok(sortable.every(column => ['count', 'pct', 'seconds'].includes(column.kind)))
})

test('nextSortState 三态循环：default→desc→asc→default，点其他字段直接 desc，入参不可变', () => {
  assert.deepEqual(nextSortState(DEFAULT_SORT_STATE, 'play_count'), { key: 'play_count', direction: 'desc' })
  assert.deepEqual(nextSortState({ key: 'play_count', direction: 'desc' }, 'play_count'), { key: 'play_count', direction: 'asc' })
  assert.deepEqual(nextSortState({ key: 'play_count', direction: 'asc' }, 'play_count'), { key: null, direction: 'default' }, '第三次点击恢复接口顺序')
  assert.deepEqual(nextSortState({ key: 'play_count', direction: 'desc' }, 'like_count'), { key: 'like_count', direction: 'desc' }, '同一时间只有一个激活字段')
  const state = { key: 'play_count', direction: 'desc' }
  nextSortState(state, 'play_count')
  assert.deepEqual(state, { key: 'play_count', direction: 'desc' }, '状态对象不可被原地修改')
})

test('compareNullableNumbers：按数值比较（非格式化字符串），缺失值恒排最后且与方向无关', () => {
  assert.ok(compareNullableNumbers(2, 10, 'desc') > 0, 'desc 时 10 排在 2 前面')
  assert.ok(compareNullableNumbers(2, 10, 'asc') < 0, 'asc 时 2 排在 10 前面')
  assert.ok(compareNullableNumbers('10847', 9999, 'desc') < 0, '数值比较：10847 > 9999，desc 时排前面（字符串比较会得出相反结论）')
  assert.ok(compareNullableNumbers(2.5, 2.5, 'desc') === 0)
  // 缺失值：null/undefined/非有限数一律最后，desc 与 asc 一致。
  for (const direction of ['desc', 'asc']) {
    assert.ok(compareNullableNumbers(null, 5, direction) > 0)
    assert.ok(compareNullableNumbers(5, null, direction) < 0)
    assert.ok(compareNullableNumbers(undefined, 5, direction) > 0)
    assert.ok(compareNullableNumbers(null, undefined, direction) === 0, '都缺失时相对顺序交给稳定层')
  }
})

test('sortWorks：新数组不改入参、同值保持原始相对顺序、空值最后、非法字段恢复原序', () => {
  const input = [
    { work_id: 'a', play_count: 100 },
    { work_id: 'b', play_count: null },
    { work_id: 'c', play_count: 300 },
    { work_id: 'd', play_count: 100 },
    { work_id: 'e', play_count: 200 },
  ]
  const desc = sortWorks(input, { key: 'play_count', direction: 'desc' })
  assert.deepEqual(desc.map(work => work.work_id), ['c', 'e', 'a', 'd', 'b'], '倒序，缺失值最后')
  assert.deepEqual(sortWorks(input, { key: 'play_count', direction: 'asc' }).map(work => work.work_id), ['a', 'd', 'e', 'c', 'b'], '顺序，缺失值同样最后')
  assert.ok(desc.every(work => input.includes(work)), '行对象引用保持不变（只重排，不重建）')
  assert.deepEqual(input.map(work => work.work_id), ['a', 'b', 'c', 'd', 'e'], 'Tools 返回的数组绝不被原地修改')
  const sameValue = sortWorks(input.slice(), { key: 'play_count', direction: 'desc' })
  assert.equal(sameValue[2].work_id, 'a')
  assert.equal(sameValue[3].work_id, 'd', '排序值相同的行保持接口原始相对顺序')
  const restored = sortWorks(input, { key: 'play_count', direction: 'default' })
  assert.notEqual(restored, input, '默认态也返回新数组')
  assert.deepEqual(restored.map(work => work.work_id), ['a', 'b', 'c', 'd', 'e'], '默认态严格保持接口顺序')
  assert.deepEqual(sortWorks(input, { key: 'title', direction: 'desc' }).map(work => work.work_id), ['a', 'b', 'c', 'd', 'e'], '不可排序字段不生效')
  assert.deepEqual(sortWorks(input, null).map(work => work.work_id), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(sortWorks([{ work_id: 'x' }, { work_id: 'y', play_count: 1 }], { key: 'play_count', direction: 'asc' }).map(work => work.work_id), ['y', 'x'], '缺失字段等价缺失值')
  assert.deepEqual(sortWorks('nope', DEFAULT_SORT_STATE), [])
})

test('safeAvatarSrc 只放行 http(s) 绝对地址，其余全部置空', () => {
  assert.equal(safeAvatarSrc('https://p3.douyinpic.com/a.jpeg'), 'https://p3.douyinpic.com/a.jpeg')
  assert.equal(safeAvatarSrc('http://p3.douyinpic.com/a.jpeg'), 'http://p3.douyinpic.com/a.jpeg')
  assert.equal(safeAvatarSrc('https://p3.douyinpic.com/a.jpeg '.trim()), 'https://p3.douyinpic.com/a.jpeg', '首尾空白被裁剪')
  assert.equal(safeAvatarSrc('javascript:alert(1)'), null)
  assert.equal(safeAvatarSrc('data:image/png;base64,AAAA'), null)
  assert.equal(safeAvatarSrc('/local/a.jpeg'), null)
  assert.equal(safeAvatarSrc('file:///etc/passwd'), null)
  assert.equal(safeAvatarSrc(''), null)
  assert.equal(safeAvatarSrc('   '), null)
  assert.equal(safeAvatarSrc(null), null)
  assert.equal(safeAvatarSrc(123), null)
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

test('百分比格式化：缺失/非法统一为 —，真实 0 保留，数值限制在 0–100', () => {
  assert.equal(formatPercent(null), EMPTY)
  assert.equal(formatPercent(undefined), EMPTY)
  assert.equal(formatPercent(Number.NaN), EMPTY)
  assert.equal(formatPercent(0), '0%')
  assert.equal(formatPercent(3.09), '3.09%')
  assert.equal(formatPercent(140), '100%')
  assert.equal(formatPercent(-2), '0%')
})

test('缺口原因映射为可读文案，未知原因收敛为「其他」', () => {
  assert.equal(gapReasonText('not_exposed', t), '本次接口未提供')
  assert.equal(gapReasonText('below_min_view', t), '播放量低于抖音最小观看门槛')
  assert.equal(gapReasonText('request_failed', t), '本次请求失败，请稍后重试')
  assert.equal(gapReasonText('no_data', t), '该作品暂无此数据')
  assert.equal(gapReasonText('something_new', t), '本次未取到')
})

test('hasGap 判定：仅当本次确实记录了缺口', () => {
  assert.equal(hasGap({ data_gap: { play_count: { reason: 'not_exposed' } } }), true)
  assert.equal(hasGap({ data_gap: {} }), false)
  assert.equal(hasGap({}), false)
  assert.equal(hasGap(null), false)
})

test('性别语义映射：接口枚举转中文，颜色按语义 key 固定而非数组下标', () => {
  assert.equal(genderLabel('male', t), '男')
  assert.equal(genderLabel('female', t), '女')
  assert.equal(genderLabel('other', t), '其他')
  assert.equal(genderLabel('unknown_new_enum', t), '其他', '未知枚举兜底「其他」')
  assert.equal(genderColor('male'), 'var(--ydo-gender-male, #91C5EB)', '男=淡蓝色')
  assert.equal(genderColor('female'), 'var(--ydo-gender-female, #E88989)', '女=柔和红')
  assert.equal(genderColor('other'), 'var(--dsw-alias-label-secondary)')
  assert.notEqual(genderColor('male'), genderColor('female'), '男/女颜色永不互换')
  assert.notEqual(genderColor('female'), genderColor('other'))
})

test('年龄分桶中文化：已知区间精确映射（非正则机械替换），未知兜底「其他年龄段」', () => {
  assert.equal(formatAgeBucket('-18', t), '小于18岁')
  assert.equal(formatAgeBucket('18-23', t), '18-23岁')
  assert.equal(formatAgeBucket('24-30', t), '24-30岁')
  assert.equal(formatAgeBucket('31-40', t), '31-40岁')
  assert.equal(formatAgeBucket('41-50', t), '41-50岁')
  assert.equal(formatAgeBucket('50-', t), '大于50岁')
  assert.equal(formatAgeBucket(' 24-30 ', t), '24-30岁', '首尾空白容忍')
  for (const value of ['fresh', '0-18', '', '   ', null, undefined, 18, {}]) {
    assert.equal(formatAgeBucket(value, t), '其他年龄段', `未识别 key ${JSON.stringify(value) ?? String(value)} 兜底「其他年龄段」`)
  }
})

test('流量来源展示名：已知 key 中文化、未知/裸枚举一律「其他来源」，原始 key 不进页面', () => {
  assert.equal(trafficSourceLabel({ source_key: 'homepage_hot', source_label: null }, t), '推荐(首页推荐)')
  assert.equal(trafficSourceLabel({ source_key: 'search' }, t), '搜索')
  assert.equal(trafficSourceLabel({ source_key: 'other' }, t), '其他')
  assert.equal(trafficSourceLabel({ source_key: 'follow', source_label: '关注' }, t), '关注', '中文 label 与映射一致时正常展示')
  assert.equal(trafficSourceLabel({ source_key: 'homepage_hot', source_label: '运营自定义来源' }, t), '运营自定义来源', '非空中文 label 优先')
  assert.equal(trafficSourceLabel({ source_key: 'fresh', source_label: 'fresh' }, t), '其他来源', '历史脏数据：label 等于原始 key 时不可信')
  assert.equal(trafficSourceLabel({ source_key: 'homepage_hot', source_label: 'homepage_hot' }, t), '推荐(首页推荐)', 'label=sourceKey 回退映射')
  assert.equal(trafficSourceLabel({ source_key: 'unknown_key', source_label: 'Some.Key-9' }, t), '其他来源', '裸枚举形态的 label 不展示，未知 key 兜底')
  for (const row of [{ source_key: 'fresh', source_label: null }, { source_key: 'x.y-z_9' }, {}, null]) {
    assert.equal(trafficSourceLabel(row, t), '其他来源', '未知/缺失来源一律「其他来源」')
  }
  assert.equal(trafficSourceLabel({ source_key: 'search', source_label: `${'长'.repeat(200)}` }, t), '长'.repeat(128), '超长 label 截断到 128')
})

test('时间统一按 Asia/Shanghai 展示「YYYY-MM-DD HH:mm」，非法/缺失一律 —（不用 String.slice）', () => {
  assert.equal(formatDateTime('2026-09-08T09:00:00.000Z'), '2026-09-08 17:00', 'UTC 输入 +8h（含跨小时进位）')
  assert.equal(formatDateTime('2026-09-08T17:30:00+08:00'), '2026-09-08 17:30', '带时区偏移的输入换算到上海')
  assert.equal(formatDateTime('2026-01-01T16:30:00Z'), '2026-01-02 00:30', '跨日进位')
  assert.equal(formatDateTime('2026-09-08T01:23:45.678Z'), '2026-09-08 09:23', '秒/毫秒不进位到分钟（截断显示）')
  assert.equal(formatDateTime('1970-01-01T00:00:00Z'), '1970-01-01 08:00', '纪元边界')
  for (const value of ['not-a-date', '2026-13-45T99:00:00Z', '', '   ', null, undefined, 1725776400000, new Date('2026-09-08T09:00:00Z')]) {
    assert.equal(formatDateTime(value), EMPTY, `非法/非字符串 ${String(value)} 显示 —`)
  }
})

test('进度分析状态判定：有点位=ok、空曲线=no_data、缺字段=not_exposed、请求失败优先', () => {
  assert.equal(progressStatus({ drag_back_curve: [{ key: '1', value: 2 }], drag_forward_curve: [] }, {}), 'ok')
  assert.equal(progressStatus({ drag_back_curve: [], drag_forward_curve: [] }, {}), 'no_data', '字段在但曲线为空=作品确实无数据')
  assert.equal(progressStatus(null, {}), 'not_exposed', '字段完全缺失=本次接口未暴露')
  assert.equal(progressStatus({ drag_back_curve: [] }, { data_gap: { progress_analysis: { reason: 'no_data' } } }), 'no_data')
  assert.equal(
    progressStatus({ drag_back_curve: [{ key: '1', value: 2 }] }, { data_gap: { progress_analysis: { reason: 'request_failed' } } }),
    'request_failed',
    '请求失败优先于点位展示',
  )
  assert.equal(progressStatusText('no_data', t), '该作品暂无进度分析数据')
  assert.equal(progressStatusText('not_exposed', t), '本次接口未提供进度分析数据')
  assert.equal(progressStatusText('request_failed', t), '进度分析请求失败，请稍后重试')
  assert.equal(progressStatusText('ok', t), '')
})

test('缺口字段名中文化：列字段复用列文案，内部字段映射，未知收敛「其他指标」', () => {
  assert.equal(gapFieldLabel('completion_rate_pct', t), '完播率')
  assert.equal(gapFieldLabel('avg_view_proportion_pct', t), '平均播放占比')
  assert.equal(gapFieldLabel('play_count', t), '播放量')
  assert.equal(gapFieldLabel('progress_analysis', t), '进度分析')
  assert.equal(gapFieldLabel('some_future_field', t), '其他指标', '未知字段禁止显示原始英文 code')
})

test('作品链接白名单：仅 http(s) + www.douyin.com，其余回退普通文本', () => {
  assert.equal(safeWorkUrl('https://www.douyin.com/video/7412'), 'https://www.douyin.com/video/7412')
  assert.equal(safeWorkUrl('http://www.douyin.com/video/7412'), 'http://www.douyin.com/video/7412')
  assert.equal(safeWorkUrl('https://www.douyin.com/video/7412 '), 'https://www.douyin.com/video/7412', '首尾空白被裁剪')
  assert.equal(safeWorkUrl('https://evil.example.com/video/1'), null, '其他域名拒绝')
  assert.equal(safeWorkUrl('https://www.douyin.com.evil.com/video/1'), null, '子串伪装域名拒绝')
  assert.equal(safeWorkUrl('javascript:alert(1)'), null)
  assert.equal(safeWorkUrl('data:text/html,hi'), null)
  assert.equal(safeWorkUrl('file:///etc/passwd'), null)
  assert.equal(safeWorkUrl('ftp://www.douyin.com/x'), null)
  assert.equal(safeWorkUrl('mailto:a@b.com'), null, 'mailto 虽然宿主协议级放行，renderer 必须先拒绝')
  assert.equal(safeWorkUrl('not a url'), null)
  assert.equal(safeWorkUrl(''), null)
  assert.equal(safeWorkUrl(null), null)
})

test('账号状态：仅登录有效时可采集，过期/未知需重新扫码', () => {
  assert.deepEqual(accountState({ sessionStatus: 'ok' }), { status: 'ok', collectable: true, needsRescan: false })
  assert.deepEqual(accountState({ sessionStatus: 'expired' }), { status: 'expired', collectable: false, needsRescan: true })
  assert.deepEqual(accountState({}), { status: 'unknown', collectable: false, needsRescan: true })
  assert.equal(accountState({ sessionStatus: 'unexpected' }).status, 'unknown')
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
      IconDownloadOutline16: () => null,
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
  assert.equal(moduleExports.formatPercent(Number.NaN), EMPTY)
  assert.equal(moduleExports.hasGap({ data_gap: { a: {} } }), true)
  assert.equal(typeof moduleExports.progressText, 'function')
  assert.deepEqual(moduleExports.COLUMNS || [], [], 'COLUMNS 为模块内部细节，不对外导出')
})

test('构建产物渲染作品表格：11 列文案正确、NULL 显示 —、前两列固定、列轨道内联共享', async () => {
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
  const tree = moduleExports.WorkTable({ works: [work], onOpen: id => opened.push(id), t: tRender })
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
  const rows = flat.filter(node => node.props && node.props.role === 'row' && node.props.className === 'ydo-table-row')
  assert.equal(headers.length, 11, '表格 11 列')
  // 名称/链接不可排序：纯文本表头；其余 9 列渲染排序按钮，默认态带「取消排序」标签与弱化箭头。
  assert.deepEqual(headers.slice(0, 2).map(textOf), ['作品名称', '作品链接'])
  assert.deepEqual(headers.slice(2).map(node => findSortButton(node).props['aria-label']), [
    '播放量：取消排序', '收藏量：取消排序', '点赞量：取消排序', '评论量：取消排序',
    '2s跳出率：取消排序', '5s完播率：取消排序', '完播率：取消排序', '平均播放时长：取消排序', '平均播放占比：取消排序',
  ])
  assert.deepEqual(headers.slice(2).map(node => node.props['aria-sort']), Array(9).fill('none'))
  const firstRow = cells.slice(0, 11)
  assert.equal(textOf(firstRow[0]), '示例作品')
  assert.equal(textOf(firstRow[2]), '1.1万')
  assert.equal(textOf(firstRow[6]), '31.73%')
  assert.equal(textOf(firstRow[7]), '40.17%')
  assert.equal(textOf(firstRow[8]), EMPTY, '本次未暴露的完播率显示 —')
  assert.equal(textOf(firstRow[9]), '13.46秒')
  assert.equal(textOf(firstRow[10]), '17.61%')
  assert.ok(firstRow[0].props.className.includes('ydo-cell-sticky'))
  assert.ok(firstRow[1].props.className.includes('ydo-cell-sticky'))
  assert.equal(firstRow[0].props.style.left, '0px')
  assert.equal(firstRow[1].props.style.left, '220px')
  // 列轨道模板内联到表头与每行，单一来源是 COLUMNS（§11.2.3 修复滚动末端断线）。
  const expectedTemplate = '220px 200px 100px 100px 100px 100px 104px 104px 96px 120px 110px'
  const headNode = flat.find(node => node.props && node.props.className === 'ydo-table-head')
  assert.equal(headNode.props.style.gridTemplateColumns, expectedTemplate, '表头内联列轨道')
  assert.equal(rows[0].props.style.gridTemplateColumns, expectedTemplate, '数据行内联同一列轨道')
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
  walk(renderNode(tree))
  const joined = text.join('|')
  for (const label of ['性别分布', '年龄分布', '流量来源', '进度分析', '地域分布', '城市级别', '搜索词', '评论热词', '数据缺口']) {
    assert.ok(joined.includes(label), `详情子页面缺少「${label}」`)
  }
  assert.ok(joined.includes('路政'), '热词展示')
  assert.ok(joined.includes('示例词'), '搜索词仅显示关键词')
  assert.ok(!joined.includes('12.5%'), '搜索词不显示百分比（v2 §6.1：percent 只入库与导出）')
  assert.ok(joined.includes('完播率 · 本次接口未提供'), '缺口条目为中文字段名+中文原因')
  assert.ok(!joined.includes('completion_rate_pct'), '缺口卡片禁止暴露原始英文 code')
  assert.ok(joined.includes('拖回'), '进度曲线使用中文「拖回」标签')
  assert.ok(!joined.includes('drag_back_curve'), '不暴露 drag_back_curve 内部字段名')
  assert.ok(joined.includes('男 92.66%'), '性别图例中文化（male→男）')
  assert.ok(joined.includes('女 7.34%'), '性别图例中文化（female→女）')
  assert.ok(joined.includes('该作品已采集 3 次'), '采集次数是作品级语义（非“历史采集”）')
  assert.ok(joined.includes('发布时间 2026-09-08 17:00'), 'publish_time 显示为发布时间（Asia/Shanghai）')
  assert.ok(joined.includes('最近采集 暂无记录'), '接口未返回 latest_collected_at 时显示暂无记录')
  assert.ok(!joined.includes('上次采集'), '账号级“上次采集”不得伪装成作品级时间')
  assert.ok(joined.includes('推荐(首页推荐)') && joined.includes('99.36%'), '流量来源展示中文名')
  assert.ok(!joined.includes('homepage_hot'), '原始来源 key 不进页面文本')
  assert.ok(joined.includes('41-50岁') && joined.includes('34.44%'), '年龄分桶展示中文区间')
  assert.ok(!joined.includes('publish_time') && !joined.includes('latest_collected_at'), '内部字段名不进页面文本')
})

test('构建产物详情非法百分比：文本回退 —，图表宽度和圆环不产生 NaN', async () => {
  const { moduleExports } = await loadBundle()
  const detail = {
    work: {
      title: '异常数据',
      search_keywords: [{ keyword: '缺失词', percent: Number.NaN }],
      traffic_source: [{ source_label: '未知来源', share_pct: Number.NaN }],
    },
    audience: { gender: [{ key: 'male', pct: Number.NaN }, { key: 'female', pct: 140 }], age: [{ key: '未知年龄', pct: null }] },
  }
  const tree = renderNode(moduleExports.WorkDetailModal({ accountId: 'acc-1', workId: 'w1', detail, trend: null, loading: false, onClose: () => {}, t: tRender }))
  const flat = collectFlat(tree)
  const text = flat.flatMap(node => {
    const children = Array.isArray(node.children) ? node.children : [node.children]
    return children.filter(child => child !== null && child !== undefined && typeof child !== 'object').map(String)
  }).join('|')
  assert.ok(text.includes('缺失词'), '搜索词仅显示关键词（百分比非法也不回退拼接展示）')
  assert.ok(text.includes('未知来源'), '非法流量来源仍保留标签')
  assert.ok(text.includes('男 —'), '性别非法百分比回退 —')
  assert.ok(text.includes('女 100%'), '性别越界百分比限制到 100%')
  const fills = flat.filter(node => node.props && node.props.className === 'ydo-bar-fill')
  assert.ok(fills.length > 0 && fills.every(node => !String(node.props.style.width).includes('NaN')), '柱状图宽度始终是有限 CSS 百分比')
  const donut = flat.find(node => node.props && node.props.className === 'ydo-donut')
  assert.ok(donut && !String(donut.props.style.background).includes('NaN'), '圆环背景始终不含 NaN')
})

test('构建产物详情未知来源/年龄兜底与时间语义：不漏原始 key，最近采集缺失/非法显示暂无记录', async () => {
  const { moduleExports } = await loadBundle()
  const detail = {
    work: {
      title: '未知来源与时间语义',
      publish_time: 'not-a-date',
      latest_collected_at: '2026-09-09T02:05:00.000Z',
      visibility: 'active',
      traffic_source: [
        { source_key: 'fresh', source_label: 'fresh', share_pct: 60 },
        { source_key: 'follow', share_pct: 40 },
      ],
      progress_analysis: { drag_back_curve: [{ key: '1', value: 1 }], drag_forward_curve: [] },
    },
    audience: {
      gender: [{ key: 'male', pct: 50 }],
      age: [{ key: '-18', pct: 20 }, { key: '50-', pct: 30 }, { key: 'unknown_bucket', pct: 50 }],
      province: [{ key: '广东', pct: 10 }],
      city_level: [{ key: '三线', pct: 23.38 }],
    },
  }
  const tree = renderNode(moduleExports.WorkDetailModal({ accountId: 'acc-1', workId: 'w1', detail, trend: null, loading: false, onClose: () => {}, t: tRender }))
  const flat = collectFlat(tree)
  const text = flat.flatMap(node => {
    const children = Array.isArray(node.children) ? node.children : [node.children]
    return children.filter(child => child !== null && child !== undefined && typeof child !== 'object').map(String)
  }).join('|')
  assert.ok(text.includes('发布时间 —'), '非法 publish_time 显示 —，绝不回退成采集时间')
  assert.ok(text.includes('最近采集 2026-09-09 10:05'), '接口实际返回的 latest_collected_at 按上海时间展示')
  assert.ok(text.includes('其他来源') && text.includes('60%'), '未知来源 key（fresh）显示「其他来源」')
  assert.ok(!text.includes('fresh'), '原始来源 key 绝不进页面文本')
  assert.ok(text.includes('关注') && text.includes('40%'), '已知来源正常中文化')
  assert.ok(text.includes('小于18岁') && text.includes('大于50岁') && text.includes('20%') && text.includes('30%'), '-18/50- 分桶显示中文区间')
  assert.ok(text.includes('其他年龄段') && text.includes('50%'), '未识别年龄分桶兜底「其他年龄段」')
  assert.ok(!text.includes('unknown_bucket'), '未识别年龄分桶的原始 key 不进页面文本')
  // 分布类（年龄/流量来源/地域/城市级别）走淡绿 variant；进度分析保持原主题色。
  const bars = flat.filter(node => node.props && typeof node.props.className === 'string' && node.props.className.startsWith('ydo-bars'))
  const distribution = bars.filter(node => node.props.className.includes('ydo-bars-distribution'))
  const plain = bars.filter(node => node.props.className === 'ydo-bars')
  assert.equal(distribution.length, 4, '年龄/流量来源/地域/城市级别 四类分布使用淡绿 variant')
  assert.equal(plain.length, 1, '进度分析不使用 variant，保持原主题色')
  // latest_collected_at 非法时同样收敛为「暂无记录」，不显示 — 也不伪装。
  const badTime = { ...detail, work: { ...detail.work, latest_collected_at: 'garbage' } }
  const badText = collectFlat(renderNode(moduleExports.WorkDetailModal({ accountId: 'acc-1', workId: 'w1', detail: badTime, trend: null, loading: false, onClose: () => {}, t: tRender })))
    .flatMap(node => {
      const children = Array.isArray(node.children) ? node.children : [node.children]
      return children.filter(child => typeof child === 'string').map(String)
    }).join('|')
  assert.ok(badText.includes('最近采集 暂无记录'), '非法 latest_collected_at 显示暂无记录')
})

test('构建产物详情采集次数守卫：total 缺失/非有限/≤0 时不渲染该行（运行时）', async () => {
  const { moduleExports } = await loadBundle()
  const detail = { work: { title: '守卫' }, audience: {} }
  for (const trend of [null, undefined, {}, { total: 0 }, { total: -3 }, { total: 'x' }, { total: Number.NaN }]) {
    const text = collectFlat(renderNode(moduleExports.WorkDetailModal({ accountId: 'acc-1', workId: 'w1', detail, trend, loading: false, onClose: () => {}, t: tRender })))
      .flatMap(node => {
        const children = Array.isArray(node.children) ? node.children : [node.children]
        return children.filter(child => typeof child === 'string').map(String)
      }).join('|')
    assert.ok(!text.includes('该作品已采集'), `trend=${JSON.stringify(trend) ?? String(trend)} 不得渲染采集次数提示`)
  }
  const okText = collectFlat(renderNode(moduleExports.WorkDetailModal({ accountId: 'acc-1', workId: 'w1', detail, trend: { total: 2 }, loading: false, onClose: () => {}, t: tRender })))
    .flatMap(node => {
      const children = Array.isArray(node.children) ? node.children : [node.children]
      return children.filter(child => typeof child === 'string').map(String)
    }).join('|')
  assert.ok(okText.includes('该作品已采集 2 次'), '合法 total 正常渲染')
})

test('构建产物渲染链接单元格：白名单内为锚点并隔离冒泡，白名单外为纯文本', async () => {
  const { moduleExports } = await loadBundle()
  const works = [
    { work_id: 'a', title: '甲', url: 'https://www.douyin.com/video/1' },
    { work_id: 'b', title: '乙', url: 'javascript:alert(1)' },
    { work_id: 'c', title: '丙', url: 'https://evil.example.com/x' },
    { work_id: 'd', title: '丁', url: 'https://www.douyin.com.evil.com/x' },
  ]
  const tree = moduleExports.WorkTable({ works, onOpen: () => {}, t: tRender })
  const anchors = collectFlat(tree).filter(node => node.type === 'a')
  assert.equal(anchors.length, 1, '只有白名单内 URL 渲染为链接，其余纯文本')
  assert.equal(anchors[0].props.href, 'https://www.douyin.com/video/1')
  assert.equal(anchors[0].props.target, '_blank')
  assert.equal(anchors[0].props.rel, 'noreferrer')
  assert.equal(typeof anchors[0].props.onClick, 'function')
  assert.equal(typeof anchors[0].props.onKeyDown, 'function')
  assert.equal(typeof anchors[0].props.onDoubleClick, 'function')
  // 三个事件都调用 stopPropagation：链接的点击/回车/双击不会触发行打开详情（§9.1）。
  for (const eventName of ['onClick', 'onKeyDown', 'onDoubleClick']) {
    let stopped = false
    anchors[0].props[eventName]({ stopPropagation: () => { stopped = true }, key: 'Enter' })
    assert.equal(stopped, true, `${eventName} 阻止冒泡`)
  }
})

// 渲染测试用的最小字典：与 src/client.js 的中文文案保持一致（断言渲染出的字面量）。
const renderLabels = {
  ...labels,
  gender: '性别分布', age: '年龄分布', trafficSource: '流量来源', progressCurve: '进度分析',
  province: '地域分布', cityLevel: '城市级别', searchKeywords: '搜索词', hotwords: '评论热词',
  gapTitle: '数据缺口', gapNotExposed: '本次接口未提供', gapBelowMinView: '播放量低于抖音最小观看门槛',
  gapRequestFailed: '本次请求失败，请稍后重试', gapOther: '本次未取到',
  none: '暂无数据', noSearch: '暂无搜索词', noHotword: '暂无热词', seconds: '秒',
  lastCollected: '上次采集', privateBadge: '已设为私密', detail: '作品详情', close: '关闭',
  trendCount: '该作品已采集 {count} 次', collectAll: '采集本账号全部', tabVideos: '视频数据',
  data: '数据展示区', accounts: '账号管理', title: '抖音运营', subtitle: '', open: '抖音运营',
  sortDefault: '取消排序', sortDesc: '倒序', sortAsc: '顺序',
}
const tRender = key => renderLabels[key] || key

/** 在渲染树中找排序按钮（.ydo-sort 主按钮，而非其 ydo-sort-text/-arrow 子元素）。 */
const findSortButton = node => {
  if (!node || typeof node !== 'object') return null
  if (node.props && String(node.props.className || '').split(' ')[0] === 'ydo-sort') return node
  const children = Array.isArray(node.children) ? node.children : node.children ? [node.children] : []
  for (const child of children) {
    const hit = findSortButton(child)
    if (hit) return hit
  }
  return null
}

const collectFlat = tree => {
  const flat = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    flat.push(node)
    walk(node.children)
  }
  walk(tree)
  return flat
}

/**
 * 迷你渲染器：桩 createElement 不调用函数组件，BarList/GenderDonut 等子组件
 * 需要在这里显式展开，才能对它们渲染的文本做断言。
 */
const renderNode = node => {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderNode)
  if (typeof node.type === 'function') {
    return renderNode(node.type({ ...(node.props || {}), children: node.children }))
  }
  return {
    type: node.type,
    props: node.props,
    children: node.children === undefined ? undefined : (Array.isArray(node.children) ? node.children.map(renderNode) : renderNode(node.children)),
  }
}

test('构建产物渲染排序态：aria-sort 与箭头随状态切换、行序按排序输出、点击回传列键', async () => {
  const { moduleExports } = await loadBundle()
  const works = [
    { work_id: 'a', title: '甲', play_count: 100 },
    { work_id: 'b', title: '乙', play_count: 300 },
    { work_id: 'c', title: '丙', play_count: 200 },
  ]
  const textOf = node => node.children.map(child => (child && typeof child === 'object' ? textOf(child) : child === null || child === undefined ? '' : String(child))).join('')
  const clicks = []
  const tree = moduleExports.WorkTable({
    works,
    sort: { key: 'play_count', direction: 'desc' },
    onSortChange: key => clicks.push(key),
    onOpen: () => {},
    t: tRender,
  })
  const flat = collectFlat(tree)
  const headers = flat.filter(node => node.props && node.props.role === 'columnheader')
  const playHeader = headers.find(node => { const button = findSortButton(node); return button && button.props['aria-label'].startsWith('播放量') })
  assert.equal(playHeader.props['aria-sort'], 'descending', 'desc → aria-sort=descending')
  const playButton = findSortButton(playHeader)
  assert.equal(playButton.props.className, 'ydo-sort ydo-sort-active', '激活态样式类')
  assert.equal(playButton.children[1].children.join(''), '↓', 'desc 显示向下箭头')
  playButton.props.onClick()
  assert.deepEqual(clicks, ['play_count'], '点击排序按钮回传列键')
  const rows = flat.filter(node => node.props && node.props.role === 'row' && node.props.className === 'ydo-table-row')
  assert.deepEqual(rows.map(row => textOf(row.children[0])), ['乙', '丙', '甲'], '数据行按播放量倒序输出')
  const ascTree = moduleExports.WorkTable({ works, sort: { key: 'play_count', direction: 'asc' }, onSortChange: () => {}, onOpen: () => {}, t: tRender })
  const ascHeader = collectFlat(ascTree).filter(node => node.props && node.props.role === 'columnheader')
    .find(node => { const button = findSortButton(node); return button && button.props['aria-label'].startsWith('播放量') })
  assert.equal(ascHeader.props['aria-sort'], 'ascending')
  assert.equal(findSortButton(ascHeader).children[1].children.join(''), '↑', 'asc 显示向上箭头')
})

async function loadBundle() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loaded = []
  const rendered = []
  const sandbox = {
    console,
    // URL：safeWorkUrl/safeAvatarSrc 依赖宿主全局 URL 做白名单解析，vm 上下文不会自动继承。
    URL,
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
      IconDownloadOutline16: props => ({ type: 'icon-download', props: props || {}, children: null }),
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

test('构建产物导出下载：base64→Uint8Array→Blob→锚点触发下载并延迟回收', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loaded = []
  const blobCalls = []
  const createdUrls = []
  const revokedUrls = []
  let anchor = null
  const sandbox = {
    console,
    URL,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    Blob: class { constructor(parts, options) { blobCalls.push({ parts, options }) } },
    document: {
      createElement: tag => {
        assert.equal(tag, 'a')
        anchor = {
          href: null, download: null, removed: false,
          click() { anchor.clicked = true },
          remove() { anchor.removed = true },
        }
        return anchor
      },
      body: { appendChild() {}, },
      head: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    window: {
      __ModuleLoader__: { load: definition => loaded.push(definition) },
      setTimeout: (fn, ms) => { revokedUrls.push(ms); fn() },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
    },
  }
  sandbox.URL = class extends URL {
    static createObjectURL(blob) { createdUrls.push(blob); return `blob:mock-${createdUrls.length}` }
    static revokeObjectURL(url) { revokedUrls.push(url) }
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const stubs = {
    react: { createElement: () => null, useCallback: fn => fn, useEffect: () => {}, useMemo: fn => fn(), useRef: value => ({ current: value }), useState: value => [value, () => {}], useSyncExternalStore: () => false },
    '@deepseek-ai/dsh-client-ui-primitives': { IconCloseOutline16: () => null, IconDownloadOutline16: () => null, IconPlayOutline16: () => null, Tooltip: () => null },
  }
  const moduleExports = loaded[0].factory(name => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`)
    return stubs[name]
  })
  assert.equal(typeof moduleExports.downloadWorkbook, 'function', 'downloadWorkbook 可从构建产物导出')
  // 「你好」UTF-8 = 6 字节；校验字节级保真（atob 的 binary 串逐字符回填）。
  const base64 = Buffer.from('你好', 'utf8').toString('base64')
  moduleExports.downloadWorkbook({
    file_name: 'douyin-示例-20260911-103000.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content_base64: base64,
  })
  assert.equal(blobCalls.length, 1, '创建了一个 Blob')
  const bytes = blobCalls[0].parts[0]
  assert.ok(bytes instanceof Uint8Array || bytes.constructor.name === 'Uint8Array', '内容是 Uint8Array')
  assert.equal(Buffer.from(bytes).toString('utf8'), '你好', '字节与 base64 原文一致')
  assert.equal(blobCalls[0].options.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'MIME 来自响应')
  assert.equal(anchor.download, 'douyin-示例-20260911-103000.xlsx', '下载文件名来自响应')
  assert.ok(String(anchor.href).startsWith('blob:mock-'), 'href 是 objectURL')
  assert.equal(anchor.clicked, true, '锚点被点击触发下载')
  assert.equal(anchor.removed, true, '下载后锚点从 DOM 移除')
  assert.ok(createdUrls.length === 1 && revokedUrls.includes('blob:mock-1'), 'objectURL 被回收')
})

test('构建产物注册导出文案：导出 Excel/导出中/失败/超限/无数据 中英齐备', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loaded = []
  const dictionaries = []
  const sandbox = {
    console,
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    window: { __ModuleLoader__: { load: definition => loaded.push(definition) }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const stubs = {
    react: { createElement: () => null, useCallback: fn => fn, useEffect: () => {}, useMemo: fn => fn(), useRef: value => ({ current: value }), useState: value => [value, () => {}], useSyncExternalStore: () => false },
    '@deepseek-ai/dsh-client-ui-primitives': { IconCloseOutline16: () => null, IconDownloadOutline16: () => null, IconPlayOutline16: () => null, Tooltip: () => null },
  }
  const moduleExports = loaded[0].factory(name => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`)
    return stubs[name]
  })
  const ctx = {
    effect: fn => fn(),
    locale: { register: (ns, dict) => dictionaries.push(dict), bind: () => key => key },
    slots: { inject: (slot, installer) => installer(), register: () => {} },
  }
  moduleExports.apply(ctx)
  assert.equal(dictionaries.length, 1)
  const [dict] = dictionaries
  for (const key of ['exportExcel', 'exporting', 'exportFailed', 'exportTooLarge', 'exportNoData']) {
    assert.ok(dict.zh[key] && dict.en[key], `文案键 ${key} 中英齐备`)
  }
  assert.equal(dict.zh.exportExcel, '导出 Excel')
  assert.equal(dict.zh.exportTooLarge, '当前账号数据量过大，暂不支持导出，请联系管理员')
  assert.equal(dict.zh.exportNoData, '当前账号暂无可导出数据')
  // 宿主 reason code → 文案键的映射必须显式登记，否则页面会渲染裸错误码。
  assert.ok(source.includes('export_too_large'))
  assert.ok(source.includes('export_failed'))
})

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

// ---------------------------------------------------------------------------
// 会话失效文案（HTTP 200 + status_code=8，0914 方案 §3.6）：绝不显示"采集完成"
// ---------------------------------------------------------------------------

test('采集会话过期：专属文案"会话已过期，请重新扫码"，失败横幅与轮询分支均不回落"采集完成"', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // zh/en 文案已登记。
  assert.match(source, /collectSessionExpired: '会话已过期，请重新扫码'/u)
  assert.match(source, /collectSessionExpired: 'Session expired — scan again'/u)
  // runner 的稳定 reason → 文案键映射。
  assert.match(source, /session_invalid: 'collectSessionExpired'/u)
  // 轮询失败分支：error === 'session_invalid' 时用专属文案。
  assert.match(source, /result\.collect\.error === 'session_invalid' \? 'collectSessionExpired' : 'collectFailed'/u)
  // runBanner 失败横幅同样按 error 区分，不复用"采集完成"文案。
  assert.match(source, /collect && collect\.error === 'session_invalid' \? 'collectSessionExpired' : 'collectFailed'/u)
})

// ---------------------------------------------------------------------------
// 账号总览 Tab（0914 方案阶段 1，实施说明 §5.1）
// ---------------------------------------------------------------------------

test('overview-ui 纯函数：万单位格式化、运营提醒派生', async () => {
  const exports = await evalUiModule(new URL('../src/overview-ui.js', import.meta.url), {})
  assert.equal(exports.formatWan(28463000), '2846万')  // ≥100万 整数位
  assert.equal(exports.formatWan(18000), '1.8万')
  assert.equal(exports.formatWan(287), '287')
  assert.equal(exports.formatWan(null), null)

  const now = Date.parse('2026-09-15T12:00:00Z')
  const alerts = exports.deriveOverviewAlerts({
    accounts: [
      { accountId: 'a1', nickname: '过期号', sessionStatus: 'expired', lastCollectedAt: '2026-09-15T10:00:00Z' },
      { accountId: 'a2', nickname: '可疑号', suspiciousEmptyCollect: true, sessionStatus: 'ok', lastCollectedAt: '2026-09-15T10:00:00Z' },
      { accountId: 'a3', nickname: '过旧号', sessionStatus: 'ok', lastCollectedAt: '2026-09-01T10:00:00Z' },
      { accountId: 'a4', nickname: '健康号', sessionStatus: 'ok', lastCollectedAt: '2026-09-15T10:00:00Z' },
    ],
  }, key => key, { now })
  assert.equal(alerts.length, 3)
  assert.deepEqual([...alerts.map(alert => alert.accountId)], ['a1', 'a2', 'a3'])
})

test('Tab 结构：账号总览在视频数据左，"导出总览"只在总览局部工具栏', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // Tab 顺序：tabOverview 的按钮先于 tabVideos。
  assert.ok(source.indexOf("t('tabOverview')") < source.indexOf("t('tabVideos')"), '账号总览 Tab 置于视频数据左')
  // 默认 Tab 是总览（方案 §4 页面级 Tab 顺序）。
  assert.match(source, /useState\('overview'\)/)
  // "导出总览"按钮渲染在 overview-ui 的总览工具栏内；client.js 只接数据流（onExport）。
  const overviewBranch = source.slice(source.indexOf("tab === 'overview'"), source.indexOf("'aria-label': t('data') },\n          h('div', { className: 'ydo-toolbar' },"))
  assert.match(overviewBranch, /onExport: exportOverview/)
  const overviewUiSource = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
  assert.match(overviewUiSource, /t\('exportOverview'\)/)
  // 视频数据工具栏保留既有"导出 Excel"（douyin_export 语义不变，§10.1）。
  const videosBranch = source.slice(source.indexOf("'aria-label': t('data') },\n          h('div', { className: 'ydo-toolbar' },"))
  assert.match(videosBranch, /t\('exportExcel'\)/)
  // 会话过期/可疑空采集文案按设计内口径，不写"采集失败"。
  assert.match(source, /可疑空采集\/请检测会话/u)
  assert.doesNotMatch(source, /可疑空采集[^\n]*采集失败/u)
})

test('总览错误映射：未登记 reason 不透传原文，映射为已登记文案键', async () => {
  const source = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
  assert.match(source, /ACCOUNT_NOT_ACCESSIBLE: 'accountNotAccessible'/u)
  assert.match(source, /RULE_VERSION_MISMATCH: 'ruleVersionMismatch'/u)
  assert.match(source, /overview_too_many_accounts: 'overviewTooManyAccounts'/u)
  const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // 零口径计算：总览组件从接口取数渲染，客户端不本地算爆款/比率。
  assert.doesNotMatch(clientSource, /hotWorkCount\s*=\s*Math|hotRatePct\s*=/u)
})

test('overview-ui 行为：账号行点击触发下钻、无账号空态渲染添加引导（F4/F6 回归）', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
  }
  const sandbox = await evalUiModule(new URL('../src/overview-ui.js', import.meta.url), {}, reactStub)
  const AccountRow = vm.runInContext('AccountRow', sandbox)

  // F4 回归：账号行点击必须触发 onOpenAccount（此前 onOpenAccount 死接线，点击无效果）。
  const clicked = []
  const row = AccountRow({
    account: { accountId: 'acc-1', nickname: '燃豚豚', sessionStatus: 'ok', fanCount: 287 },
    onOpenAccount: id => clicked.push(id),
    t: key => key,
  })
  assert.equal(typeof row.props.onClick, 'function', '账号行必须绑定点击')
  row.props.onClick()
  assert.deepEqual([...clicked], ['acc-1'])

  // F6 回归：无账号（accountCount=0）必须渲染添加引导与添加入口，而不是 0 值 KPI 页。
  const OverviewPage = vm.runInContext('OverviewPage', sandbox)
  hLog.length = 0
  const emptyPage = OverviewPage({
    overview: { summary: { accountCount: 0, workCount: 0 }, accounts: [], hotWorks: [] },
    loading: false,
    errorReason: null,
    filters: {},
    accounts: [],
    collecting: false,
    exporting: false,
    onAddAccount: () => {},
    t: key => key,
  })
  const pageText = JSON.stringify(emptyPage)
  assert.match(pageText, /addAccountHint/u, '无账号必须显示添加引导')
  assert.match(pageText, /addAccount"/u, '必须提供添加入口')
  // F6-R 回归：宿主必须把 onAddAccount 接进 OverviewPage（组件测试自行传桩会掩盖死接线）。
  const clientSource2 = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(clientSource2, /onAddAccount: \(\) => beginLogin\(null\)/u)
  assert.doesNotMatch(pageText, /kpiAccounts/u, '无账号不渲染 0 值 KPI')

  // F3 回归：近 N 天窗口必须带 publishFrom 与 publishTo（排他终点=明天，含今天）。
  const buildOverviewFilters = vm.runInContext('buildOverviewFilters', sandbox)
  const fixed = Date.parse('2026-09-15T04:00:00Z')
  const filters = buildOverviewFilters({ window: '30d', now: fixed })
  assert.equal(filters.publishFrom, '2026-08-17', '近 30 天起点 = 今天-29')
  assert.equal(filters.publishTo, '2026-09-16', '半开排他终点 = 明天，服务端 [from, to) 含今天')
  const allFilters = buildOverviewFilters({ window: 'all', now: fixed })
  assert.equal(allFilters.publishFrom, undefined)
  assert.equal(allFilters.publishTo, undefined)
})

// ---------------------------------------------------------------------------
// 单账号分析页（0914 方案 §6，阶段 2，实施说明 §7.4）
// ---------------------------------------------------------------------------

test('analysis-ui：趋势布局 30 天固定窗口、自然日定位、缺口虚线、单点与同值（2026-09-17）', async () => {
  const sandbox = await evalUiModule(new URL('../src/analysis-ui.js', import.meta.url), {})
  const trendLayout = vm.runInContext('trendLayout', sandbox)
  // 注入固定「今天」：2026-09-17 → 窗口 [2026-08-19, 2026-09-17]
  const opts = { now: '2026-09-17T12:00:00' }

  // 空数据：不可渲染
  assert.equal(trendLayout([], opts).renderable, false)

  // 单点：renderable 但 single=true（页面显示点 + 「暂无足够趋势数据」提示）
  const single = trendLayout([{ day: '2026-09-10', value: 100 }], opts)
  assert.equal(single.renderable, true)
  assert.equal(single.single, true)
  assert.equal(single.nodes.length, 1)

  // 30 天固定窗口 + 自然日定位：9/2 在窗口内（8/19+14 天处），
  // 9/17（今天）应位于最右端 x=600；间隔不受已有点数量压缩。
  const layout = trendLayout([
    { day: '2026-09-02', value: 100, elapsedSeconds: null, counterRevised: false },
    { day: '2026-09-05', value: 260, elapsedSeconds: 259200, counterRevised: false },
    { day: '2026-09-06', value: 250, elapsedSeconds: 86400, counterRevised: true },
    { day: '2026-09-17', value: 400, elapsedSeconds: null, counterRevised: false },
  ], opts)
  assert.equal(layout.renderable, true)
  assert.equal(layout.single, false)
  assert.equal(layout.fromDay, '2026-08-19')
  assert.equal(layout.toDay, '2026-09-17')
  // x = 6 + (day - fromDay) / 29 * (600 - 12)：左右各 6px 安全边距（2026-09-20
  // 需求 2）——起止日的点（半径 3px）不再被 viewBox 裁掉半个。9/2=14 天 → 289.86；
  // 9/17=29 天 → 594（窗口最右端仍在绘图区内完整可见）。
  assert.equal(layout.nodes[0].x, 289.86)
  assert.equal(layout.nodes[3].x, 594)
  assert.ok(layout.nodes[0].x >= 6 && layout.nodes[3].x <= 594, '全部数据点落在左右安全边距内')
  // 轴刻度与数据点共用同一 pad 公式：末刻度（offset 29）与窗口末日的点 x 相同。
  assert.equal(layout.axisLabels[layout.axisLabels.length - 1].x, 594)

  // gap 断点与 counter_revised 保留：09-03/04 无采集 → gap 2 天；9/6 负 delta 标记
  assert.deepEqual(Array.from(layout.nodes.map(node => node.gapDaysBefore)), [0, 2, 0, 10])
  assert.equal(layout.nodes[2].counterRevised, true, '负 delta 显示平台修正角标')

  // 缺口虚线：9/2→9/5（gap 2 天）与 9/6→9/17（gap 10 天）两段为虚线，9/5→9/6 实线
  assert.deepEqual(Array.from(layout.segments.map(segment => segment.dashed)), [true, false, true])

  // 纵轴 min/max ±10% 边距 + yPct 保留小数：min=100/max=400 → pad=30 → [70,430]
  // yPct 语义（用户反馈 2026-09-18 修复）：值大 yPct 大（渲染层再翻转为像素 y）
  assert.equal(layout.yMin, 100)
  assert.equal(layout.yMax, 400)
  const y100 = ((100 - 70) / 360) * 100
  const y400 = ((400 - 70) / 360) * 100
  assert.equal(layout.nodes[0].yPct, Math.round(y100 * 100) / 100)
  assert.equal(layout.nodes[3].yPct, Math.round(y400 * 100) / 100)
  assert.ok(layout.nodes[3].yPct > layout.nodes[0].yPct, '值大的点 yPct 更大（视觉上方）')

  // 同值：纵轴固定居中（yPct=50），不再拉伸
  const same = trendLayout([
    { day: '2026-09-10', value: 500 },
    { day: '2026-09-12', value: 500 },
  ], opts)
  assert.deepEqual(Array.from(same.nodes.map(node => node.yPct)), [50, 50])
  assert.equal(same.sameValue, true)

  // 横轴日期标签：5 个刻度位（0/7/14/21/29 天处），首尾对齐方向不同
  assert.equal(layout.axisLabels.length, 5)
  assert.equal(layout.axisLabels[0].day, '2026-08-19')
  assert.equal(layout.axisLabels[4].day, '2026-09-17')
  assert.equal(layout.axisLabels[0].pos, 'start')
  assert.equal(layout.axisLabels[4].pos, 'end')

  // 需求 5b：width 参数驱动 x 缩放（容器实测宽传入后 viewBox 与实际等宽，不再拉伸）
  const wide = trendLayout([
    { day: '2026-09-02', value: 100 },
    { day: '2026-09-17', value: 400 },
  ], { ...opts, width: 900 })
  assert.equal(wide.nodes[0].x, Math.round((6 + (14 / 29) * 888) * 100) / 100)
  assert.equal(wide.nodes[1].x, 894)
  assert.equal(wide.width, 900)

  // 需求 5a：y 轴专用格式化——≥1万固定 1 位小数万单位，<1万千分位，非有限数 null
  const axisValueText = vm.runInContext('axisValueText', sandbox)
  assert.equal(axisValueText(1651000), '165.1万')
  assert.equal(axisValueText(999900), '100.0万', '四舍五入进位到 100.0万（不切回取整口径）')
  assert.equal(axisValueText(9999), '9,999')
  assert.equal(axisValueText(0), '0')
  assert.equal(axisValueText(null), null)
  // 缺失/非法值守卫：null/undefined/空串/NaN 都是「缺失」返回 null（Number(null)===0 绝不放行）
  assert.equal(axisValueText(undefined), null)
  assert.equal(axisValueText(''), null)
  assert.equal(axisValueText(Number.NaN), null)
  // 数字字符串正常格式化（服务端数值理论上为 number，防御不炸）
  assert.equal(axisValueText('800'), '800')
  assert.equal(axisValueText('1651000'), '165.1万')

  // AnalysisPage 渲染 SVG 趋势图（缺口虚线段 + 数据点 circle + 轴标签）
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    // 阶段 4：AnalysisPage 趋势测宽 hook（沙箱无 ResizeObserver，hook 内部自动降级 600 宽）
    useRef: value => ({ current: value === undefined ? null : value }),
    useEffect: () => {},
  }
  const sandbox2 = await evalUiModule(new URL('../src/analysis-ui.js', import.meta.url), {}, reactStub)
  const AnalysisPage = vm.runInContext('AnalysisPage', sandbox2)
  const t = key => key
  AnalysisPage({
    analysis: {
      account: { accountId: 'a1', nickname: '燃豚豚', fanCount: 1, lastCollectedAt: null },
      summary: { workCount: 1 }, kpi: {}, interaction: {}, hotWorks: [],
    },
    trend: { points: [
      { day: '2026-09-02', value: 1651000 },
      { day: '2026-09-05', value: 1659000 },
      { day: '2026-09-06', value: 1650000 },
    ] },
    trendMetric: 'play', trendErrorReason: null, loading: false, errorReason: null,
    exporting: false, onBack: () => {}, onMetricChange: () => {}, onExport: () => {},
    onOpenWork: () => {}, t,
    aiAnalysis: null, aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  const text = JSON.stringify(hLog)
  assert.ok(text.includes('ydo-an-trend-svg'), '趋势图渲染为 SVG')
  assert.ok(text.includes('ydo-an-seg-dashed'), '缺口段渲染虚线')
  assert.ok(text.includes('ydo-an-dot-circle'), '数据点渲染 circle')
  assert.ok(text.includes('ydo-an-axis-label'), '横轴日期标签渲染')
  // 需求 5a：y 轴 min/max 用专用格式化（1 位小数万单位），不再同显「165万」
  assert.ok(text.includes('165.9万') && text.includes('165.0万'), 'y 轴两端保留 1 位小数万单位')
  assert.ok(!text.includes('165万'), 'y 轴不再退化为取整万单位（165万 同文）')
  // 悬浮提示与 y 轴同口径（axisValueText），不走 formatWan 取整口径
  assert.ok(text.includes('2026-09-05 165.9万'), '数据点悬浮提示用 1 位小数万单位口径')
  // 渲染方向（用户反馈 2026-09-18）：SVG y 轴向下，值大的点 cy 必须更小（视觉上方）。
  // 此前布局/渲染两层各反一次互相抵消成「值大画在下面」，递增数据显示成下降，
  // 且旧断言只查 yPct 数值不查 cy，未抓住颠倒。
  const dayValue = { '2026-09-02': 1651000, '2026-09-05': 1659000, '2026-09-06': 1650000 }
  const dots = hLog
    .filter(entry => entry.props && entry.props.className === 'ydo-an-dot-circle')
    .map(entry => ({ day: entry.children[0].children[0].split(' ')[0], cy: entry.props.cy }))
  assert.equal(dots.length, 3, '三个数据点 circle')
  for (let i = 0; i < dots.length; i += 1) {
    for (let j = i + 1; j < dots.length; j += 1) {
      const va = dayValue[dots[i].day]
      const vb = dayValue[dots[j].day]
      assert.equal(
        (va > vb) === (dots[i].cy < dots[j].cy), true,
        `值大的点 cy 更小（${dots[i].day}=${va} cy=${dots[i].cy} vs ${dots[j].day}=${vb} cy=${dots[j].cy}）`)
    }
  }
})

// review P2-2（2026-09-18）：y 轴 min/max 格式化同文时退千分位完整数字的分支
// 此前零覆盖；另加 Rules of Hooks 守卫——useMeasuredWidth 必须在 AnalysisPage
// 任何早退 return 之前调用（errorReason 早退渲染的 hook 调用数与完整渲染一致）。
test('analysis-ui：趋势 y 轴同文退避千分位 + hooks 在早退分支前调用（2026-09-18）', async () => {
  const t = key => key
  const baseAnalysis = {
    account: { accountId: 'a1', nickname: '燃豚豚', fanCount: 1, lastCollectedAt: null },
    summary: { workCount: 1 }, kpi: {}, interaction: {}, hotWorks: [],
  }
  const baseTrend = { points: [
    // 两值仅差 400：axisValueText(1650000)=axisValueText(1650400)='165.0万' 同文
    // → 触发千分位退避，两端 '1,650,000'/'1,650,400' 可区分。
    { day: '2026-09-10', value: 1650000 },
    { day: '2026-09-17', value: 1650400 },
  ] }
  const baseProps = {
    analysis: baseAnalysis, trend: baseTrend,
    trendMetric: 'play', trendErrorReason: null, loading: false, errorReason: null,
    exporting: false, onBack: () => {}, onMetricChange: () => {}, onExport: () => {},
    onOpenWork: () => {}, t,
    aiAnalysis: null, aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
  }
  const renderWithStub = async hookCalls => {
    const hLog = []
    const reactStub = {
      createElement: (type, props, ...children) => {
        hLog.push({ type, props, children })
        return { type, props, children }
      },
      useState: value => {
        hookCalls.push('useState')
        return [typeof value === 'function' ? value() : value, () => {}]
      },
      useRef: value => ({ current: value === undefined ? null : value }),
      useEffect: () => { hookCalls.push('useEffect') },
    }
    const sandbox = await evalUiModule(new URL('../src/analysis-ui.js', import.meta.url), {}, reactStub)
    const AnalysisPage = vm.runInContext('AnalysisPage', sandbox)
    AnalysisPage(baseProps)
    for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
    return { text: JSON.stringify(hLog), hLog }
  }

  // 同文退避：y 轴两端渲染千分位完整数字（不走 formatWan——其 ≥100万取整口径
  // 正是同文根因，退避再走会回到同文）。结构化断言锁定 ydo-an-axis-text 节点
  // 文本（趋势布局返回原始 min/max，不带 ±10% 边距值）。
  const { text, hLog } = await renderWithStub([])
  assert.ok(text.includes('1,650,000') && text.includes('1,650,400'),
    'y 轴同文时退千分位完整数字，两端可区分')
  const axisTexts = hLog
    .filter(entry => entry.props && entry.props.className === 'ydo-an-axis-text')
    .map(entry => entry.children[0])
  assert.deepEqual(axisTexts, ['1,650,400', '1,650,000'],
    'y 轴节点精确渲染千分位退避文本（max/max 顺序）')

  // hooks 守卫：errorReason 早退渲染与完整渲染的 hook 调用序列一致
  //（useMeasuredWidth 位于所有早退 return 之前，否则违反 Rules of Hooks）
  const fullCalls = []
  await renderWithStub(fullCalls)
  const earlyCalls = []
  const hLogEarly = []
  const earlyStub = {
    createElement: (type, props, ...children) => {
      hLogEarly.push({ type, props, children })
      return { type, props, children }
    },
    useState: value => {
      earlyCalls.push('useState')
      return [typeof value === 'function' ? value() : value, () => {}]
    },
    useRef: value => ({ current: value === undefined ? null : value }),
    useEffect: () => { earlyCalls.push('useEffect') },
  }
  const sandboxEarly = await evalUiModule(new URL('../src/analysis-ui.js', import.meta.url), {}, earlyStub)
  const AnalysisPageEarly = vm.runInContext('AnalysisPage', sandboxEarly)
  AnalysisPageEarly({ ...baseProps, errorReason: 'operationUnavailable' })
  assert.ok(earlyCalls.length > 0, '早退渲染也调用 hooks（hook 位于早退 return 之前）')
  assert.deepEqual(earlyCalls, fullCalls, '早退与完整渲染的 hook 调用序列一致')
})

test('分析页源契约：返回总览保留筛选、观众与流量开放（阶段 3）、导出按钮只在分析页局部', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // 返回总览保留筛选条件（方案 §15.2）：退出分析页后重新拉取总览（沿用同一 filters）。
  assert.match(source, /setAnalysisAccountId\(null\)\s*\n\s*loadOverview\(\)/u)
  const analysisSource = await readFile(new URL('../src/analysis-ui.js', import.meta.url), 'utf8')
  // 阶段 3 开放：画像/流量/热词/规则提醒渲染接口字段，但页面不展示加权口径脚注。
  assert.doesNotMatch(analysisSource, /weightedSample|weightedNote/u, '分析页不再显示按播放量加权说明')
  assert.match(analysisSource, /dataInsufficient/u, '无画像数据时显示"数据不足"而非 0%')
  assert.match(analysisSource, /ydo-an-audience/u, '观众与流量使用统一卡片网格（v2 §5.3）')
  // v2 §5.3：分析页不再渲染评论热词（hotwordStaleBadge 只属于作品详情弹窗）。
  assert.doesNotMatch(analysisSource, /hotwordsBlock|hotwordStaleBadge/u, '分析页不再渲染评论热词')
  assert.match(analysisSource, /labelPotential/u, 'potential 标签渲染')
  // F 修复回归：potential 标签渲染必须在真实路径（overview-ui 的 HotWorkRow/抽屉），
  // 不能是 analysis-ui 里的死代码。
  const overviewUiSource = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
  assert.match(overviewUiSource, /labelPotential/u, 'overview-ui 爆款行/抽屉使用中文映射渲染 potential')
  assert.match(overviewUiSource, /hotLabelText\(work\.labels, t\)/u, 'HotWorkRow 走 hotLabelText 映射')
  assert.match(analysisSource, /t\('exportAnalysis'\)/u, '"导出账号分析报告"只在分析页局部工具栏')
  assert.match(analysisSource, /暂无趋势/u)
  assert.match(analysisSource, /counterRevised/u)
  // UI 优化方案（2026-09-16）§5：页面不显示规则版本、参与样本与底部数据质量说明。
  assert.doesNotMatch(analysisSource, /t\('ruleVersion'\)/u)
  assert.doesNotMatch(analysisSource, /ruleSampleSize/u, '规则提醒不再携带样本量')
  assert.doesNotMatch(analysisSource, /dataQualityLine/u)
  assert.match(analysisSource, /accountTitle/u, '标题统一「账号：{名称}」')
})

// ---------------------------------------------------------------------------
// UI 优化改造（2026-09-16 方案）：Tab 激活态 / 左栏显示条件 / 单选筛选 / 列轨道 /
// 文案回归（colShare、规则版本、参与样本数、数据源不进页面）
// ---------------------------------------------------------------------------

test('basisLines：按「 · 」把判定依据拆成纵向行，缺失返回空数组', () => {
  assert.deepEqual(
    basisLines('账号内 Top 6% · 播放量为账号中位数 2238.7 倍 · 播放量达到绝对爆款阈值 100000'),
    ['账号内 Top 6%', '播放量为账号中位数 2238.7 倍', '播放量达到绝对爆款阈值 100000'],
  )
  assert.deepEqual(basisLines('播放量达到绝对爆款阈值 100000'), ['播放量达到绝对爆款阈值 100000'])
  assert.deepEqual(basisLines('  账号内 Top 6%  ·  播放量为账号中位数 8.4 倍 '), ['账号内 Top 6%', '播放量为账号中位数 8.4 倍'], '首尾空白被清理')
  assert.deepEqual(basisLines(''), [])
  assert.deepEqual(basisLines(null), [])
  assert.deepEqual(basisLines(undefined), [])
})

test('formatWan：万单位与千分位展示（构建内联后 analysis-ui 依赖的同名函数）', async () => {
  const sandbox = await evalUiModule(new URL('../src/overview-ui.js', import.meta.url), {})
  const formatWan = vm.runInContext('formatWan', sandbox)
  assert.equal(formatWan(5930000), '593万', '≥100万 不带小数')
  assert.equal(formatWan(12345), '1.2万', '≥1万 保留 1 位小数')
  assert.equal(formatWan(123456), '12.3万')
  assert.equal(formatWan(9999), '9,999', '万以下千分位')
  assert.equal(formatWan(287), '287')
  assert.equal(formatWan(0), '0', '真实的 0 格式化为 0 而非缺失')
  assert.equal(formatWan(null), null, '缺失返回 null（上层显示 —）')
  assert.equal(formatWan('abc'), null, '非数值返回 null')
})

test('筛选流契约：UI 形态状态、请求时归一、筛选变更不重复请求（验收建议 2/3）', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // 初始状态为 UI 形态（含 window 键），不带日期字段。
  assert.match(source, /useState\(\(\) => \(\{ window: '30d', sort: 'hot_count', accountIds: \[\] \}\)\)/u)
  // overview.get / overview.export 请求前统一经 buildOverviewFilters 归一（「全部」不带日期）。
  assert.match(source, /action: 'overview\.get', \.\.\.buildOverviewFilters\(filters\)/u)
  assert.match(source, /action: 'overview\.export', \.\.\.buildOverviewFilters\(overviewFilters\)/u)
  // 分析页与其导出沿用总览窗口：从 UI 形态派生日期，而不是读状态里的旧字段。
  assert.match(source, /const \{ publishFrom, publishTo \} = buildOverviewFilters\(overviewFilters\)/u)
  // 筛选变更只 setOverviewFilters：查询由 loadOverview 身份变化触发一次，不显式重复调用。
  const changeBody = source.match(/const changeOverviewFilters = useCallback\(filters => \{([\s\S]*?)\}, \[\]\)/u)
  assert.ok(changeBody, 'changeOverviewFilters 存在')
  assert.ok(!changeBody[1].includes('loadOverview('), '筛选变更不显式重复发起查询')
  // 请求序列号守卫（验收 P1）：过期响应的数据/错误/复位一律丢弃，loading 只由最新请求结束。
  const loadOverviewBody = source.match(/const loadOverview = useCallback\(async \(filters = overviewFilters\) => \{([\s\S]*?)\}, \[overviewFilters\]\)/u)
  assert.ok(loadOverviewBody, 'loadOverview 存在')
  assert.match(loadOverviewBody[1], /const requestId = \+\+overviewRequestRef\.current/u)
  assert.match(loadOverviewBody[1], /if \(requestId !== overviewRequestRef\.current\) return/u)
  assert.match(loadOverviewBody[1], /if \(requestId === overviewRequestRef\.current\) setOverviewLoading\(false\)/u)
  const loadAnalysisBody = source.match(/const loadAnalysis = useCallback\(async \(accountId, metric = trendMetric\) => \{([\s\S]*?)\}, \[overviewFilters, trendMetric\]\)/u)
  assert.ok(loadAnalysisBody, 'loadAnalysis 存在')
  assert.match(loadAnalysisBody[1], /const requestId = \+\+analysisRequestRef\.current/u)
  assert.match(loadAnalysisBody[1], /if \(requestId !== analysisRequestRef\.current\) return/u)
  assert.match(loadAnalysisBody[1], /if \(requestId === analysisRequestRef\.current\) setAnalysisLoading\(false\)/u)
})

test('Tab 激活态：只有当前 Tab 有底部指示线；左侧账号栏只在视频数据 Tab 渲染', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // 基础 Tab 样式不含品牌色下划线（透明占位保持高度稳定），激活态由 aria-current 驱动。
  const baseTab = source.match(/\.ydo-tabs button\{[^}]*\}/u)
  assert.ok(baseTab, '存在 Tab 基础样式')
  assert.ok(!baseTab[0].includes('var(--dsw-alias-brand-primary)'), '非激活 Tab 不显示品牌色下划线')
  const activeTab = source.match(/\.ydo-tabs button\[aria-current\]\{[^}]*\}/u)
  assert.ok(activeTab, '存在激活态样式')
  assert.match(activeTab[0], /border-bottom-color:var\(--dsw-alias-brand-primary\)/u)
  // 两个 Tab 的下划线互斥：aria-current 由 tab 状态单点决定（React 属性不存在同元素双值）。
  assert.ok(source.indexOf("'aria-current': tab === 'overview' || undefined") < source.indexOf("'aria-current': tab === 'videos' || undefined"))
  // 左侧账号管理栏只在视频数据 Tab 渲染；总览上下文占满整行。
  assert.match(source, /tab === 'videos' \? left : null/u)
  assert.match(source, /className: `ydo-body\$\{tab === 'overview' \? ' ydo-body-full' : ''\}`/u)
  const css = source.match(/const css = `[\s\S]*`/u)[0]
  assert.match(css, /\.ydo-body-full\{grid-template-columns:1fr\}/u)
})

test('总览工具栏：单选账号下拉（默认全部账号）、日期/排序带可见说明、刷新不随 loading 禁用', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
  }
  const sandbox = await evalUiModule(new URL('../src/overview-ui.js', import.meta.url), {}, reactStub)
  const OverviewPage = vm.runInContext('OverviewPage', sandbox)

  const fixture = {
    summary: { accountCount: 2, workCount: 30, totalPlayCount: 50000, hotWorkCount: 3, hotRatePct: 10 },
    accounts: [
      { accountId: 'a1', nickname: '燃豚豚', sessionStatus: 'ok', fanCount: 287, workCount: 10, medianPlayCount: 1000, hotWorkCount: 2, hotRatePct: 20, engagementRatePct: 6.2, sessionCheckedAt: '2026-09-15T10:00:00Z' },
      { accountId: 'a2', nickname: '车研社', sessionStatus: 'ok', fanCount: 18000, workCount: 20, medianPlayCount: 2000, hotWorkCount: 1, hotRatePct: 5, engagementRatePct: 5.1, sessionCheckedAt: '2026-09-15T10:00:00Z' },
    ],
    // 目录唯一来源是服务端 accountOptions（二审 P1-4：不回退宿主/排行账号列表）。
    accountOptions: [
      { accountId: 'a1', nickname: '燃豚豚', workCount: 10 },
      { accountId: 'a2', nickname: '车研社', workCount: 20 },
    ],
    accountTotal: 2,
    hotWorks: [],
  }
  const changes = []
  const page = OverviewPage({
    overview: fixture,
    loading: true,
    errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts: fixture.accounts,
    collecting: false,
    exporting: false,
    onFilterChange: filters => changes.push(filters),
    onRefresh: () => {},
    onExport: () => {},
    onAddAccount: () => {},
    t: key => key,
  })

  const selects = hLog.filter(node => node.type === FilterSelect)
  assert.equal(selects.length, 3, '工具栏共 3 个下拉：账号/发布时间/排序')
  // 账号下拉：值 '' 表示全部账号，选项含 allAccounts + 每个账号。
  const accountSelect = selects[0]
  assert.equal(accountSelect.props.value, '', '默认选中全部账号（空 accountIds）')
  const accountOptions = accountSelect.props.options
  assert.equal(accountOptions[0].value, '')
  assert.equal(accountOptions[0].label, 'allAccounts')
  assert.equal(accountOptions.length, 3, '全部账号 + 2 个具体账号')
  // 选择具体账号 → accountIds 只含一个 ID；切回全部账号 → 空数组。
  // （vm 沙箱里创建的数组原型与宿主不同，必须先展开成宿主数组再比较。）
  accountSelect.props.onChange('a2')
  assert.deepEqual([...changes[0].accountIds], ['a2'])
  accountSelect.props.onChange('')
  assert.deepEqual([...changes[1].accountIds], [])
  // 窗口下拉改 UI 形态（window 键）：请求日期由 client.js 发请求时经
  // buildOverviewFilters 归一——切「全部」不会残留旧 publishFrom/publishTo（验收建议 2）。
  const windowSelect = selects[1]
  assert.equal(windowSelect.props.value, '30d')
  windowSelect.props.onChange('all')
  assert.equal(changes[2].window, 'all')
  assert.equal(changes[2].publishFrom, undefined, 'UI 形态筛选不携带日期字段')
  assert.equal(changes[2].publishTo, undefined)
  // 日期与排序下拉前有可见文字说明。
  const labels = hLog.filter(node => node.props?.className === 'ydo-ov-filter')
  assert.ok(labels.some(label => JSON.stringify(label).includes('overviewWindow')), '发布时间下拉带可见文字')
  assert.ok(labels.some(label => JSON.stringify(label).includes('overviewSort')), '排序下拉带可见文字')
  assert.ok(labels.some(label => JSON.stringify(label).includes('overviewAccountFilter')), '账号筛选带说明文字')
  assert.ok(labels.length >= 3)
  // 刷新按钮不因 loading 禁用：筛选自动查询的加载态只出现在列表区域。
  const refresh = hLog.find(node => node.type === 'button' && JSON.stringify(node.children).includes('"refresh"'))
  assert.ok(refresh, '存在刷新按钮')
  assert.notEqual(refresh.props.disabled, true, '筛选自动查询不借刷新按钮的禁用态表达')
  // 列表区域加载态（role=status）在 loading 时渲染。
  const loadingRow = hLog.find(node => String(node.props && node.props.className || '').includes('ydo-ov-loading'))
  assert.ok(loadingRow, '筛选自动查询在列表区域显示加载状态')
  assert.equal(loadingRow.props.role, 'status')
  // 操作按钮组靠右（ydo-ov-actions 承载刷新/导出）。
  const actions = hLog.find(node => String(node.props && node.props.className || '').includes('ydo-ov-actions'))
  assert.ok(actions, '刷新/导出固定靠右的容器存在')
})

test('总览表格：排行/爆款两表各自固定列轨道，数字列右对齐，爆款依据多行', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
  }
  const sandbox = await evalUiModule(new URL('../src/overview-ui.js', import.meta.url), {}, reactStub)
  const OverviewPage = vm.runInContext('OverviewPage', sandbox)

  const fixture = {
    summary: { accountCount: 1, workCount: 10, totalPlayCount: 50000, hotWorkCount: 1, hotRatePct: 10 },
    accounts: [
      { accountId: 'a1', nickname: '燃豚豚', sessionStatus: 'ok', fanCount: 287, workCount: 10, medianPlayCount: 1000, hotWorkCount: 1, hotRatePct: 10, engagementRatePct: 6.2, sessionCheckedAt: '2026-09-15T10:00:00Z' },
    ],
    hotWorks: [
      {
        workId: 'w1', accountId: 'a1', accountNickname: '燃豚豚', title: '路边划线区域停车要不要罚？',
        publishTime: '2026-09-08T09:00:00.000Z', playCount: 5930000, engagementRatePct: 8.7,
        basis: '账号内 Top 2% · 播放量为账号中位数 322 倍 · 播放量达到绝对爆款阈值 100000',
        labels: ['absolute', 'account_relative'],
      },
    ],
  }
  OverviewPage({
    overview: fixture, loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts: fixture.accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {}, onOpenWork: () => {}, onOpenAccount: () => {},
    t: key => key,
  })
  // AccountRow/HotWorkRow 等经 h(Component, props) 惰性创建，stub 只记录元素不执行
  // 组件；这里手动执行函数组件，其内部的 h 调用才会进入 hLog。
  for (let index = 0; index < hLog.length; index += 1) {
    const node = hLog[index]
    if (typeof node.type === 'function') node.type(node.props)
  }
  // 表头与数据行共用同一列轨道类：排行表 ydo-ov-tr-rank、爆款表 ydo-ov-tr-hot。
  const rankRows = hLog.filter(node => String(node.props && node.props.className || '').includes('ydo-ov-tr-rank'))
  const hotRows = hLog.filter(node => String(node.props && node.props.className || '').includes('ydo-ov-tr-hot'))
  assert.equal(rankRows.filter(node => String(node.props.className).includes('ydo-ov-head')).length, 1, '排行表头存在')
  assert.equal(rankRows.length, 2, '排行表头 + 1 数据行共用轨道')
  assert.equal(hotRows.length, 2, '爆款表头 + 1 数据行共用轨道')
  const overviewHotHead = hotRows.find(node => String(node.props.className).includes('ydo-ov-head'))
  assert.equal(overviewHotHead.children.at(-1).props.className, 'ydo-ov-hot-basis-head', '总览爆款依据表头单独居中')
  // 数字/百分比列统一右对齐 + tabular-nums；排名列居中。
  const numCells = hLog.filter(node => String(node.props && node.props.className || '').includes('ydo-ov-num'))
  assert.ok(numCells.length >= 14, '排行 6 列数字 + 爆款率/互动率 + 爆款表播放/互动率均右对齐')
  const rankCells = hLog.filter(node => String(node.props && node.props.className || '').includes('ydo-ov-rankcell'))
  assert.ok(rankCells.length >= 2, '排名列存在且与表头同结构')
  // 爆款依据按「 · 」拆成纵向行：3 条依据渲染 3 个子行。
  const basisCells = hLog.filter(node => String(node.props && node.props.className || '').includes('ydo-ov-basis'))
  assert.equal(basisCells.length, 1)
  assert.equal(basisCells[0].children.filter(child => child && child.type === 'div').length, 3, '爆款依据按判定类别分行')
  // 发布时间是文本列：单元格不右对齐（与表头及分析页一致，验收建议 6）。
  const hotRow = hotRows.find(node => String(node.props.className).includes('ydo-ov-hot-row'))
  const timeCell = hotRow.children.find(cell => Array.isArray(cell.children) && typeof cell.children[0] === 'string' && String(cell.children[0]).startsWith('2026-09-08'))
  assert.ok(timeCell, '发布时间单元格存在')
  assert.equal(timeCell.props.className, undefined, '发布时间列保持文本左对齐')
  // 发布时间走 ui-format 的上海时区格式化（UTC 09:00 → 17:00），不再用 String.slice。
  const publishedAt = JSON.stringify(hLog).includes('2026-09-08 17:00')
  assert.ok(publishedAt, '发布时间按 Asia/Shanghai 展示')
})

test('总览页面文案回归：不出现规则版本/数据来源/参与样本数/colShare/内部样本字样', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
  }
  const sandbox = await evalUiModule(new URL('../src/overview-ui.js', import.meta.url), {}, reactStub)
  const OverviewPage = vm.runInContext('OverviewPage', sandbox)
  const HotWorkDrawer = vm.runInContext('HotWorkDrawer', sandbox)

  const zhCopy = {
    ruleVersion: '规则版本', dataSource: '数据来源', hotSampleSize: '参与样本数',
    colShare: '分享量', colPlay: '播放量', engagement: '互动率', colLike: '点赞量',
    colComment: '评论量', colCollect: '收藏量',
    hotDrawerTitle: '爆款视频详情', hotBasis: '爆款依据', close: '关闭',
    openFullWorkAnalysis: '查看完整作品分析', loading: '加载中…',
    labelAbsolute: '绝对爆款', labelAccountRelative: '账号内爆款', labelOther: '其他标签',
    labelPotential: '潜力作品',
    insufficientSample: '样本不足', rankCol: '排名', colAccount: '账号', fanCount: '粉丝',
    workCount: '作品数', colMedianPlay: '中位播放', kpiHotWorks: '爆款视频', hotRateCol: '爆款率',
    accountRanking: '账号表现排行', hotWorksTitle: '爆款视频',
    hotOwnerAccount: '所属账号', publishTime: '发布时间', noHotWorks: '当前筛选内暂无爆款视频',
    hotDistribution: '爆款账号分布', overviewAlerts: '运营提醒', noAlerts: '暂无提醒',
    kpiAccounts: '管理账号', kpiWorks: '作品总数', kpiTotalPlay: '累计播放量', kpiCurrentCumulative: '当前累计值',
    sessionCheckValid: '最近检测有效', none: '暂无数据',
    // v2 §3.1/§3.2/§4.1：账号目录、时间范围与同步/失败文案。
    allAccounts: '全部账号', overviewAccountFilter: '账号：', overviewWindow: '发布时间：', overviewSort: '排序：',
    window_7d: '近7天', window_30d: '近30天', window_90d: '近90天', window_all: '全部时间',
    rangeAllTime: '全部时间', noWorks: '无作品',
    accountCatalogSyncing: '账号列表与统计正在同步', accountCatalogUnavailable: '账号列表暂不可用',
    rankingScopeHint: '共 {total} 个账号 · 排行展示 {shown} 个',
    refresh: '刷新', exportOverview: '导出总览',
    sessionExpired: '会话已过期', suspiciousEmptyCollect: '可疑空采集/请检测会话',
    alertSessionExpired: '会话已过期，请重新扫码', alertSuspiciousEmpty: '可疑空采集，请检测会话',
    alertStaleCollect: '最近 7 天没有成功的采集，数据可能过旧',
    // 刻意不登记「会话状态」「命中标签」：组件若回归渲染这两处，会退成裸 key，
    // 下面的禁用断言能同时抓住裸 key 与中文两种回归。
  }
  const t = key => zhCopy[key] || key
  const fixture = {
    summary: { accountCount: 1, workCount: 10, totalPlayCount: 50000, hotWorkCount: 1, hotRatePct: 10 },
    accounts: [
      { accountId: 'a1', nickname: '燃豚豚', sessionStatus: 'ok', fanCount: 287, workCount: 10, medianPlayCount: 1000, hotWorkCount: 1, hotRatePct: 10, engagementRatePct: 6.2, sessionCheckedAt: '2026-09-15T10:00:00Z' },
    ],
    accountOptions: [{ accountId: 'a1', nickname: '燃豚豚', workCount: 10 }],
    // accountTotal(5) > 排行行数(1)：top_n 截断的正常语义，页面须标注完整数与展示数。
    accountTotal: 5,
    hotWorks: [],
    ruleVersion: 'hot-v1-potential',
    dataSource: 'douyin_operation_db',
  }
  const pageText = JSON.stringify(OverviewPage({
    overview: fixture, loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts: fixture.accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenWork: () => {}, onOpenAccount: () => {}, onAddAccount: () => {}, t,
  }))
  // 接口返回 ruleVersion/dataSource，但页面不再渲染这两个字段。
  assert.ok(!pageText.includes('规则版本'), '总览页不显示规则版本')
  assert.ok(!pageText.includes('数据来源'), '总览页不显示数据来源')
  assert.ok(!pageText.includes('douyin_operation_db'), '内部数据源标识不进页面')
  assert.ok(!pageText.includes('会话状态'), '总览排行不再有「会话状态」列（v2 §4.2）')
  assert.ok(!pageText.includes('sessionFreshnessCol'), '会话状态列文案键不再被渲染')
  // top_n 截断标注（二审 P1-2）：明确区分完整账号数与当前展示排行数。
  assert.ok(pageText.includes('共 5 个账号 · 排行展示 1 个'), '排行工具栏标注「共 {total} · 展示 {shown}」')

  // 无依据爆款回退命中标签行（HotWorkRow 保留该兜底），未知标签收敛「其他标签」（P2）。
  const HotWorkRow = vm.runInContext('HotWorkRow', sandbox)
  const fallbackText = JSON.stringify(HotWorkRow({
    work: { workId: 'w2', title: '无依据爆款', publishTime: '2026-09-08T09:00:00Z', playCount: 1000, engagementRatePct: 5, labels: ['absolute', 'brand_new_label'] },
    onOpenWork: () => {}, t,
  }))
  assert.ok(fallbackText.includes('绝对爆款 + 其他标签') && !fallbackText.includes('brand_new_label'), '无依据爆款回退命中标签且未知标签收敛「其他标签」')

  const drawerTree = HotWorkDrawer({
    work: {
      workId: 'w1', title: '示例爆款', basis: '账号内 Top 2% · 播放量为账号中位数 322 倍',
      // 未登记标签收敛「其他标签」，原始 key 不进页面（验收 P2）。
      labels: ['absolute', 'brand_new_label'], playCount: 5930000, engagementRatePct: 8.7,
      likeCount: 49000, commentCount: 1200, collectCount: 7600, shareCount: 890,
      ruleVersion: 'hot-v1-potential', sampleSize: 17,
    },
    detail: null, detailLoading: false, onClose: () => {}, onOpenFull: () => {}, t,
  })
  const drawerText = JSON.stringify(drawerTree)
  // 指标卡片化（用户反馈 2026-09-18 需求 4）：标签与数值分节点渲染，「分享量」「890」
  // 不再拼进同一字符串；内部字段名 colShare 仍不进页面。
  assert.ok(drawerText.includes('分享量') && drawerText.includes('890'), '分享量中文化渲染（colShare 文案键）')
  assert.ok(!drawerText.includes('colShare'), '内部字段名 colShare 不进页面')
  assert.ok(!drawerText.includes('规则版本'), '抽屉不显示规则版本')
  assert.ok(!drawerText.includes('参与样本数'), '抽屉不显示参与样本数')
  assert.ok(!drawerText.includes('hot-v1-potential'), '规则版本值不进页面')
  // v2 §6.2：抽屉不再渲染「命中标签」辅助行，原始标签 key 不进页面。
  assert.ok(!drawerText.includes('命中标签') && !drawerText.includes('brand_new_label'), '抽屉不再渲染命中标签辅助行')
  assert.ok(drawerText.includes('账号内 Top 2%') && drawerText.includes('播放量为账号中位数 322 倍'), '爆款依据按类别分行渲染')
  // v2 §6.2 抽屉结构：标题 → 爆款依据 → 指标摘要 → 操作按钮；关闭按钮 40×40 且带 aria-label。
  const drawerFlat = []
  const walkDrawer = node => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walkDrawer); return }
    drawerFlat.push(node)
    walkDrawer(node.children)
  }
  walkDrawer(drawerTree)
  const drawerIndex = name => drawerFlat.findIndex(node => String(node.props && node.props.className || '').includes(name))
  const closeBtn = drawerFlat.find(node => node.props && node.props.className === 'ydo-ov-drawer-close')
  assert.ok(closeBtn && closeBtn.props['aria-label'] === '关闭', '关闭按钮带 aria-label（ydo-ov-drawer-close）')
  const basisIdx = drawerIndex('ydo-ov-basis-head')
  const metricsIdx = drawerIndex('ydo-an-metrics')
  const actionIdx = drawerIndex('ydo-ov-drawer-action')
  assert.ok(basisIdx > -1 && metricsIdx > basisIdx && actionIdx > metricsIdx, '抽屉纵向结构：标题 → 爆款依据 → 指标摘要 → 操作按钮')
  // 指标卡片化（需求 4）：指标摘要复用内容指标卡片（ydo-an-metric-card），不再是
  // 「标签 值」单行文本列表；标签小字在上、数值大字在下。
  const metricsNode = drawerFlat.find(node => node.props && node.props.className === 'ydo-an-metrics')
  assert.ok(metricsNode && Array.isArray(metricsNode.children) && metricsNode.children.length === 6,
    '抽屉指标摘要为 6 张内容指标卡片')
  assert.ok(metricsNode.children.every(card => card.props?.className === 'ydo-an-metric-card'
    && card.children[0]?.props?.className === 'ydo-an-metric-label'
    && card.children[1]?.props?.className === 'ydo-an-metric-value'),
  '指标卡片结构：标签小字在上、数值大字在下')
})

test('分析页行为：账号标题、内容指标三段结构、观众与流量口径标签、爆款视频表格', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
    // AiAnalysisSection（0916 方案 §9）使用 useState 管理手动展开态
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    // 阶段 4：AnalysisPage 趋势测宽 hook（沙箱无 ResizeObserver，hook 内部自动降级 600 宽）
    useRef: value => ({ current: value === undefined ? null : value }),
    useEffect: () => {},
  }
  const sandbox = await evalUiModule(new URL('../src/analysis-ui.js', import.meta.url), {}, reactStub)
  const AnalysisPage = vm.runInContext('AnalysisPage', sandbox)

  const zhCopy = {
    accountTitle: '账号：{name}', backToOverview: '← 返回账号总览', exportAnalysis: '导出账号分析报告',
    exporting: '导出中…', fanCount: '粉丝', workCount: '作品数', latestCollected: '最近采集',
    noRecord: '暂无记录', sessionCheckValid: '最近检测有效',
    kpiTotalPlay: '总播放量', colMedianPlay: '中位播放量', colHighestPlay: '最高播放量',
    kpiHotWorks: '爆款数量', hotRateCol: '爆款率', trendTitle: '采集快照累计值变化', trendMetric: '指标',
    metric_play: '累计播放量', metric_like: '累计点赞量', metric_comment: '累计评论量',
    metric_collect: '累计收藏量', metric_share: '累计分享量', metric_fans: '粉丝数',
    trendCaption: '按采集日收盘值展示', noTrend: '暂无趋势', contentMetrics: '内容指标',
    cmEngagement: '综合互动率', cmLikeRate: '点赞率', cmCommentRate: '评论率', cmCollectRate: '收藏率',
    cmShareRate: '分享率', cmCompletion5s: '5秒完播率', cmAvgViewShare: '平均播放占比', cmAvgWatchDuration: '平均播放时长',
    dataInsufficient: '数据不足', dataPartial: '部分数据',
    audienceTraffic: '观众与流量', mainGender: '主要性别', mainAge: '主要年龄', mainRegion: '主要地域',
    cityLevel: '城市级别', mainTrafficSource: '主要流量来源',
    genderMale: '男', genderFemale: '女', genderOther: '其他',
    age24to30: '24-30岁', age31to40: '31-40岁', ageOther: '其他年龄段',
    srcHomepageHot: '推荐(首页推荐)', sourceOther: '其他来源',
    labelOther: '其他标签', alertRuleOther: '其他规则提醒', seconds: '秒',
    accountHotWorks: '本账号爆款视频', rankCol: '排名', colVideo: '视频', publishTime: '发布时间',
    colPlay: '播放量', engagement: '互动率', hotBasis: '爆款依据', noHotWorks: '当前筛选内暂无爆款视频',
    labelAbsolute: '绝对爆款', labelAccountRelative: '账号内爆款',
  }
  const t = key => zhCopy[key] || key
  const analysis = {
    account: { accountId: 'a1', nickname: '燃豚豚', fanCount: 287, lastCollectedAt: '2026-09-08T02:00:00.000Z', sessionCheck: { state: 'verified' } },
    summary: { workCount: 17 },
    kpi: { totalPlayCount: 12486000, medianPlayCount: 18400, maxPlayCount: 5930000, hotWorkCount: 8, hotRatePct: 12.5, engagementRatePct: 6.2 },
    interaction: {
      likeCount: { ratePct: 3.9, coveragePct: 100 },
      commentCount: { ratePct: 0.5, coveragePct: 76.5 },
      collectCount: { ratePct: 1.2, coveragePct: 100 },
      shareCount: { ratePct: 0.6, coveragePct: 0 },
    },
    // 完播/播放行为段（tools `_playback_metrics`）：value 是服务端单点产出的均值。
    completion: { completion5s: { value: 43.2, coveragePct: 100 } },
    playback: {
      avgViewProportion: { value: 38.5, coveragePct: 88.2 },
      avgWatchDuration: { value: 12.6, coveragePct: 88.2 },
    },
    audience: {
      // v2 §5.3：参与作品数集中在卡片底部一行（root 字段），不再重复写在每个分类后。
      sampleWorkCount: 12,
      dimensions: {
        // 接口真实形态是内部枚举（male/24-30），页面必须中文化后展示。
        gender: { distributions: [{ key: 'male', pct: 92.7 }], sampleWorkCount: 12 },
        age: { distributions: [{ key: '24-30', pct: 41.2 }, { key: '31-40', pct: 22.8 }], sampleWorkCount: 12 },
        province: { distributions: [{ key: '广东', pct: 31.5 }], sampleWorkCount: 12 },
        city_level: { distributions: [{ key: '一线', pct: 38.9 }], sampleWorkCount: 12 },
      },
    },
    traffic: { distributions: [{ key: 'homepage_hot', pct: 86.2 }] },
    // 未登记的 ruleId 必须收敛「其他规则提醒」，原始值不进页面（验收 P2）。
    alerts: [{ ruleId: 'mystery_rule', workCount: 3 }],
    hotWorks: [
      {
        workId: 'w1', accountId: 'a1', title: '路边划线区域停车要不要罚？', rank: 1,
        publishTime: '2026-09-08T09:00:00.000Z', playCount: 5930000, engagementRatePct: 8.7,
        basis: '账号内 Top 2% · 播放量为账号中位数 322 倍', labels: ['absolute'],
      },
    ],
  }
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null,
    loading: false, errorReason: null, exporting: false,
    onBack: () => {}, onMetricChange: () => {}, onExport: () => {}, onOpenWork: () => {}, t,
  })
  const metricSelect = hLog.find(node => node.type === FilterSelect)
  assert.equal(metricSelect.props.value, 'play', '分析页沿用自绘筛选器')
  assert.equal(metricSelect.props.options.length, 6, '趋势指标选项保持完整')
  // 先展开 stub 未执行的函数组件（Kpi/AudienceBlock/AudienceBarList），让观众条形
  // 等嵌套内容进入 hLog，再做全量文本/块级断言（展开产生的节点同样入 hLog）。
  for (let index = 0; index < hLog.length; index += 1) {
    const node = hLog[index]
    if (typeof node.type === 'function') node.type(node.props)
  }
  const pageText = JSON.stringify(hLog)
  // 标题「账号：{名称}」；头部无规则版本。
  assert.ok(pageText.includes('账号：燃豚豚'), '标题统一「账号：{名称}」')
  assert.ok(!pageText.includes('规则版本'), '头部不显示规则版本')
  assert.ok(pageText.includes('2026-09-08 10:00'), '最近采集按 Asia/Shanghai 格式化')
  // 内容指标固定清单：8 项全渲染；服务端未返回的段显式「数据不足」。
  for (const label of ['综合互动率', '点赞率', '评论率', '收藏率', '分享率', '5秒完播率', '平均播放占比', '平均播放时长']) {
    assert.ok(pageText.includes(label), `内容指标包含「${label}」`)
  }
  assert.ok(pageText.includes('数据不足'), '未返回段显示数据不足')
  assert.ok(!pageText.includes('部分数据'), '「部分数据」徽标不再显示（用户反馈 2026-09-18）')
  assert.ok(!pageText.includes('覆盖率'), '内容指标不显示覆盖率')
  // 服务端返回完播/播放段时渲染真实均值；平均播放时长单位是秒（验收 P1-4 闭合）。
  assert.ok(pageText.includes('43.2%'), '5秒完播率渲染服务端均值')
  assert.ok(pageText.includes('38.5%'), '平均播放占比渲染服务端均值')
  assert.ok(pageText.includes('12.6秒'), '平均播放时长以秒为单位渲染')
  assert.ok(!pageText.includes('participation'), '无内部字段')
  // 观众与流量口径标签。
  for (const label of ['主要性别', '主要年龄', '主要地域', '城市级别', '主要流量来源']) {
    assert.ok(pageText.includes(label), `观众与流量包含「${label}」`)
  }
  // 内部枚举中文化：male/24-30 不进页面（验收 P1-2）。
  assert.ok(pageText.includes('男') && pageText.includes('92.7%'), '性别枚举经 genderLabel 中文化')
  // v2 §5.3：四块条形列表把「标签/数值」拆成独立节点，不再拼成一句话。
  assert.ok(pageText.includes('24-30岁') && pageText.includes('41.2%'), '年龄分桶经 formatAgeBucket 中文化')
  assert.ok(!pageText.includes('male') && !/['"]24-30 /.test(pageText), '原始枚举 key 不进页面')
  // 流量来源走 trafficSourceLabel 兜底映射（验收 P1-3）。
  assert.ok(pageText.includes('推荐(首页推荐)') && pageText.includes('86.2%'), '流量来源用统一映射展示')
  // 未登记 ruleId 收敛「其他规则提醒」（验收 P2）。ruleId 会作为 React key 存在于
  // props（真实 DOM 不可见），因此只对可见文本断言。
  const textOf = value => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(textOf).join('')
    if (value && typeof value === 'object' && value.children !== undefined) return textOf(value.children)
    return ''
  }
  const visibleText = hLog.map(node => textOf(node)).join('\n')
  assert.ok(visibleText.includes('其他规则提醒（3 条作品）'), '未知规则 ID 收敛兜底文案')
  assert.ok(!visibleText.includes('mystery_rule'), '原始 ruleId 不进可见文本')
  assert.ok(!pageText.includes('按播放量加权'), '观众与流量不显示按播放量加权说明')
  // v2 §5.3：观众与流量的五个维度统一使用相同卡片；评论热词/会话状态未知不出现。
  assert.ok(pageText.includes('主要性别') && pageText.includes('男') && pageText.includes('92.7%'), '性别使用统一卡片展示')
  assert.ok(!pageText.includes('评论热词'), '分析页不显示评论热词（接口字段保留在导出报告）')
  assert.ok(!pageText.includes('会话状态未知'), '头部不再显示会话状态未知')
  assert.ok(!pageText.includes('覆盖率 100'), '覆盖率 100% 不再显示状态文字（v2 §5.2）')
  const audienceBlocks = hLog.filter(node => String(node.props && node.props.className || '').includes('ydo-an-audience-block'))
  assert.equal(audienceBlocks.length, 5, '性别/年龄/地域/城市级别/主要来源五块')
  const blockTitles = audienceBlocks.map(block => block.children[0].children[0])
  assert.deepEqual([...blockTitles], ['主要性别', '主要年龄', '主要地域', '城市级别', '主要流量来源'], '五块顺序与标题')
  for (const block of audienceBlocks) {
    assert.ok(!JSON.stringify(block).includes('按播放量加权'), '每块不带按播放量加权说明')
  }
  // 爆款视频固定六列表格 + 爆款依据分行：列序与总览不同（排名居首），用专属轨道
  // ydo-ov-tr-hot-rank，排名落窄列、视频标题占宽轨（验收建议 1）。
  const hotRows = hLog.filter(node => String(node.props && node.props.className || '').includes('ydo-ov-tr-hot-rank'))
  assert.equal(hotRows.length, 2, '爆款表头 + 数据行共用 ydo-ov-tr-hot-rank 专属轨道')
  const hotDataRow = hotRows.find(node => !String(node.props.className).includes('ydo-ov-head'))
  const analysisHotHead = hotRows.find(node => String(node.props.className).includes('ydo-ov-head'))
  assert.equal(analysisHotHead.children.at(-1).props.className, 'ydo-ov-hot-basis-head', '单账号爆款依据表头单独居中')
  assert.equal(hotDataRow.children[0].props.className, 'ydo-ov-rankcell', '首列是排名（窄列居中）')
  assert.ok(hotDataRow.children[1].props.className.includes('ydo-ov-hot-title'), '第二列是视频标题（宽轨）')
  assert.ok(pageText.includes('账号内 Top 2%') && pageText.includes('播放量为账号中位数 322 倍'), '爆款依据分行渲染')
  // 内容指标固定 8 项；真实的 0 保持 0，缺失显式「数据不足」（验收建议 5）。
  const contentMetricRows = vm.runInContext('contentMetricRows', sandbox)
  const zeroRows = contentMetricRows({ interaction: { likeCount: { ratePct: 0, coveragePct: 100 } }, kpi: {} }, t)
  assert.equal(zeroRows.length, 8, '内容指标固定 8 项')
  const likeRow = zeroRows.find(row => row.key === 'likeCount')
  assert.equal(likeRow.value, '0.0%', '真实的 0 保持 0，不当作缺失')
  assert.equal(likeRow.note, null, '覆盖率 100% 不渲染第三段状态（v2 §5.2）')
  // 数据状态两态（v2 §5.2 + 用户反馈 2026-09-18）：0/缺失 → 数据不足；
  // 部分覆盖不再显示「部分数据」徽标。
  const triRows = contentMetricRows({ interaction: {
    likeCount: { ratePct: 3, coveragePct: 55.5 },
    commentCount: { ratePct: 1, coveragePct: 0 },
  }, kpi: {} }, t)
  assert.equal(triRows.find(row => row.key === 'likeCount').note, null, '部分覆盖不渲染状态徽标')
  assert.equal(triRows.find(row => row.key === 'commentCount').note, '数据不足', '覆盖 0 → 数据不足')
  const engagementRow = zeroRows.find(row => row.key === 'engagement')
  assert.equal(engagementRow.value, '—', '综合互动率缺失显示 —')
  assert.equal(engagementRow.note, '数据不足', '综合互动率缺失显式数据不足（三段完整）')
  // 页面不再出现样本类辅助信息与数据质量行。
  assert.ok(!pageText.includes('数据质量'), '底部数据质量说明已删除')
  assert.ok(!JSON.stringify(hLog).includes('sampleSize'), '样本量字段不进页面')
})

// ---------------------------------------------------------------------------
// UI 优化方案 v2（2026-09-16）：账号目录、爆款分布配色、源码级样式契约
// ---------------------------------------------------------------------------

test('v2 账号目录：accountOptions 驱动下拉、零作品标注、失同步提示与目录为空禁用态', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
  }
  const sandbox = await evalUiModule(new URL('../src/overview-ui.js', import.meta.url), {}, reactStub)

  // 纯函数（v2 §3.1，二审 P1-4）：目录唯一来源 accountOptions，按 accountId 去重、
  // 空昵称回退 ID。数据边界：宿主本地账号列表（设备端/排行）不能代表服务端授权目录，
  // 缺失/为空时目录为空（筛选禁用），绝不回退合并本地列表。
  const buildAccountCatalog = vm.runInContext('buildAccountCatalog', sandbox)
  const fromOptions = buildAccountCatalog({
    accountOptions: [
      { accountId: 'a1', nickname: '燃豚豚', workCount: 19 },
      { accountId: 'a2', nickname: '', workCount: 0 },
      { accountId: 'a1', nickname: '重复项', workCount: 99 },
    ],
    accounts: [{ accountId: 'a1', nickname: '排行版本', workCount: 10 }],
  })
  // vm 沙箱对象原型属于另一 realm，先展开成宿主对象再 deepStrictEqual。
  assert.deepEqual([...fromOptions].map(option => ({ ...option })), [
    { id: 'a1', label: '燃豚豚', workCount: 19 },
    { id: 'a2', label: 'a2', workCount: 0 },
  ], 'accountOptions 去重、空昵称回退账号 ID，排行数据不进目录')
  assert.deepEqual([...buildAccountCatalog({})].map(option => ({ ...option })), [],
    '缺失 accountOptions → 空目录（禁用筛选），不回退设备账号')
  assert.deepEqual(
    [...buildAccountCatalog({ accounts: [{ accountId: 'a3', nickname: '设备账号', workCount: 3 }] })].map(option => ({ ...option })),
    [],
    '只有宿主/排行账号而无 accountOptions → 仍为空目录（数据边界，二审 P1-4）')

  const OverviewPage = vm.runInContext('OverviewPage', sandbox)
  const t = key => key
  const accounts = [
    { accountId: 'a1', nickname: '燃豚豚', sessionStatus: 'ok', fanCount: 287, workCount: 19, medianPlayCount: 1000, hotWorkCount: 1, hotRatePct: 5, engagementRatePct: 6.2 },
  ]
  const baseSummary = { accountCount: 2, workCount: 19, totalPlayCount: 50000, hotWorkCount: 1, hotRatePct: 5 }

  // 零作品账号（a2）出现在下拉且带「无作品」标注。目录数(2) == accountTotal(2) →
  // 目录完整；排行只展示 1 行是 top_n/数据语义，不是失同步（二审 P1-2），
  // 以「共 {total} · 展示 {shown}」标注区分。
  hLog.length = 0
  OverviewPage({
    overview: {
      summary: baseSummary, accounts,
      accountOptions: [
        { accountId: 'a1', nickname: '燃豚豚', workCount: 19 },
        { accountId: 'a2', nickname: '零作品号', workCount: 0 },
      ],
      accountTotal: 2,
      hotWorks: [],
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t,
  })
  const accountSelect = hLog.find(node => node.type === FilterSelect)
  const options = accountSelect.props.options
  assert.equal(options.length, 3, '全部账号 + 目录 2 个账号（含排行里没有的零作品账号）')
  assert.equal(options[2].label, '零作品号（noWorks）', '无可统计作品账号带明确状态标注（§9.1）')
  assert.equal(options[1].label, '燃豚豚', '有作品账号不带无作品标注')
  assert.ok(!JSON.stringify(hLog).includes('accountCatalogSyncing'),
    '目录数与 accountTotal 一致时不显示同步提示（排行展示行数少于目录不属失同步，二审 P1-2）')
  assert.ok(JSON.stringify(hLog).includes('rankingScopeHint'),
    '排行受截断时标注「共 {total} · 展示 {shown}」（二审 P1-2）')

  // 目录数 ≠ accountTotal → 才是真正的「账号列表与统计正在同步」（二审 P1-2）。
  hLog.length = 0
  OverviewPage({
    overview: {
      summary: baseSummary, accounts,
      accountOptions: [
        { accountId: 'a1', nickname: '燃豚豚', workCount: 19 },
        { accountId: 'a2', nickname: '零作品号', workCount: 0 },
      ],
      accountTotal: 3,
      hotWorks: [],
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t,
  })
  assert.ok(hLog.some(node => JSON.stringify(node.children || []).includes('accountCatalogSyncing')),
    '目录数与 accountTotal 不一致时显示「账号列表与统计正在同步」并记录诊断（§3.1）')

  // 选中具体账号后排行按设计只剩被选账号：这是筛选语义而非失同步，
  // 不得显示同步提示，也不显示截断标注（验收 P2——筛选态误报回归）。
  hLog.length = 0
  OverviewPage({
    overview: {
      summary: baseSummary, accounts,
      accountOptions: [
        { accountId: 'a1', nickname: '燃豚豚', workCount: 19 },
        { accountId: 'a2', nickname: '零作品号', workCount: 0 },
      ],
      accountTotal: 2,
      hotWorks: [],
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: ['a1'] },
    accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t,
  })
  assert.ok(!JSON.stringify(hLog).includes('accountCatalogSyncing'), '筛选态不显示同步中提示（排行缩小是筛选结果）')
  assert.ok(!JSON.stringify(hLog).includes('rankingScopeHint'), '筛选态不显示截断标注（行数缩小是筛选语义，二审 P1-2）')
  const filteredSelect = hLog.find(node => node.type === FilterSelect)
  assert.equal(filteredSelect.props.options.length, 3, '筛选后下拉仍保留完整目录、可切回全部账号（§2.2）')
  assert.equal(filteredSelect.props.value, 'a1', '筛选态下拉选中值保持')

  // 目录加载失败（accountOptions 缺失或为空）→ 下拉禁用 + 稳定失败文案，
  // 不退化成只显示当前一个账号，也绝不回退宿主/排行账号列表（§3.1、二审 P1-4）。
  hLog.length = 0
  OverviewPage({
    overview: {
      summary: { accountCount: 1, workCount: 5, totalPlayCount: 10, hotWorkCount: 0, hotRatePct: 0 },
      accounts: [], accountOptions: [], hotWorks: [],
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts: [], collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t,
  })
  const disabledSelect = hLog.find(node => node.type === FilterSelect)
  assert.equal(disabledSelect.props.disabled, true, '目录为空时账号筛选禁用')
  assert.ok(hLog.some(node => JSON.stringify(node.children || []).includes('accountCatalogUnavailable')),
    '目录为空显示稳定的失败文案')

  // 空目录且 accountTotal=0 仍不可用（不能把「无账号」误当成可操作下拉）。
  hLog.length = 0
  OverviewPage({
    overview: {
      summary: { accountCount: 1, workCount: 1, totalPlayCount: 1, hotWorkCount: 0, hotRatePct: 0 },
      accounts: [], accountOptions: [], accountTotal: 0, hotWorks: [],
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts: [], collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t,
  })
  assert.equal(hLog.find(node => node.type === FilterSelect).props.disabled, true, '空目录即使 total=0 也禁用筛选')
  // P1-4 回归：服务端缺 accountOptions 时即使宿主/排行有账号，目录仍为空（禁用）。
  hLog.length = 0
  OverviewPage({
    overview: {
      summary: baseSummary, accounts,
      hotWorks: [],
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t,
  })
  const noFieldSelect = hLog.find(node => node.type === FilterSelect)
  assert.equal(noFieldSelect.props.disabled, true, '服务端缺 accountOptions 时筛选禁用（不回退本地账号列表，二审 P1-4）')
  assert.ok(hLog.some(node => JSON.stringify(node.children || []).includes('accountCatalogUnavailable')),
    '缺 accountOptions 显示稳定失败文案')

  // accountOptions 非空但缺少 accountTotal：目录完整性未知，筛选仍必须禁用。
  hLog.length = 0
  OverviewPage({
    overview: {
      summary: baseSummary, accounts,
      accountOptions: [{ accountId: 'a1', nickname: '燃豚豚', workCount: 19 }],
      hotWorks: [],
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t,
  })
  const missingTotalSelect = hLog.find(node => node.type === FilterSelect)
  assert.equal(missingTotalSelect.props.disabled, true, '缺 accountTotal 时目录筛选禁用')
  assert.ok(hLog.some(node => JSON.stringify(node.children || []).includes('accountCatalogSyncing')),
    '缺 accountTotal 时提示目录正在同步')

  // KPI 作品数辅助文案带明确范围（§3.2/§4.2）：近 N 天 / 全部时间。
  hLog.length = 0
  OverviewPage({
    overview: { summary: baseSummary, accounts, accountOptions: [{ accountId: 'a1', nickname: '燃豚豚', workCount: 19 }], hotWorks: [] },
    loading: false, errorReason: null,
    filters: { window: 'all', sort: 'hot_count', accountIds: [] },
    accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t,
  })
  assert.ok(JSON.stringify(hLog).includes('rangeAllTime'), '全部时间范围下 KPI 辅助文案用 rangeAllTime')
})

test('v2 爆款账号分布：服务端 hotAccountDistribution 驱动、保持服务端顺序、最多 5 个、前三名专属配色类', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
  }
  const sandbox = await evalUiModule(new URL('../src/overview-ui.js', import.meta.url), {}, reactStub)
  const OverviewPage = vm.runInContext('OverviewPage', sandbox)
  const accounts = [
    { accountId: 'a1', nickname: 'w8', hotWorkCount: 8 },
    { accountId: 'a2', nickname: 'b3', hotWorkCount: 3 },
    { accountId: 'a3', nickname: 'a3', hotWorkCount: 3 },
    { accountId: 'a4', nickname: 'e2', hotWorkCount: 2 },
    { accountId: 'a5', nickname: 'd1', hotWorkCount: 1 },
    { accountId: 'a6', nickname: 'f1', hotWorkCount: 1 },
    { accountId: 'a7', nickname: '零爆款', hotWorkCount: 0 },
  ]
  // 服务端在截断前基于全量账号计算并排好序（二审 P1-3）；同数并列给 b3 在前的
  // 服务端顺序——若客户端仍在重排，a3 会反超（localeCompare），断言即失败。
  const distribution = [
    { accountId: 'a1', nickname: 'w8', hotWorkCount: 8 },
    { accountId: 'a2', nickname: 'b3', hotWorkCount: 3 },
    { accountId: 'a3', nickname: 'a3', hotWorkCount: 3 },
    { accountId: 'a4', nickname: 'e2', hotWorkCount: 2 },
    { accountId: 'a5', nickname: 'd1', hotWorkCount: 1 },
    { accountId: 'a6', nickname: 'f1', hotWorkCount: 1 },
  ]
  OverviewPage({
    overview: {
      summary: { accountCount: 7, workCount: 18, totalPlayCount: 90000, hotWorkCount: 18, hotRatePct: 100 },
      accounts, hotWorks: [], hotAccountDistribution: distribution, accountTotal: 7,
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t: key => key,
  })
  // 展开 stub 未执行的 HotDistribution（内部 h 调用此时才进入 hLog）。
  for (let index = 0; index < hLog.length; index += 1) {
    const node = hLog[index]
    if (typeof node.type === 'function') node.type(node.props)
  }
  const distItems = hLog.filter(node => node.type === 'li')
  assert.equal(distItems.length, 5, '最多显示 5 个账号（§4.3）')
  const names = distItems.map(node => node.children[1].children[0])
  assert.deepEqual([...names], ['w8', 'b3', 'a3', 'e2', 'd1'],
    '保持服务端顺序（同数 b3 在前不重排）、客户端只截断第 6 名，零爆款账号不出现')
  const topClasses = distItems.map(node => node.props.className || '')
  assert.deepEqual([...topClasses], ['ydo-ov-dist-top1', 'ydo-ov-dist-top2', 'ydo-ov-dist-top3', '', ''],
    '前三名专属配色类、第四名起中性（§9.2）')
  assert.deepEqual(distItems.map(node => node.props.key), ['a1', 'a2', 'a3', 'a4', 'a5'],
    '爆款账号分布使用 accountId 作为稳定 key，昵称重复也不冲突')
  const ranks = distItems.map(node => node.children[0].children[0])
  assert.deepEqual([...ranks], [1, 2, 3, 4, 5], '名次同时用排名数字表达，不单靠颜色')
  // 排名数字带 aria-hidden（对读屏隐藏，视觉名次由类名/位置承担）+ 进度条宽度按最大值归一。
  const fills = distItems.map(node => node.children[2].children[0])
  assert.equal(fills[0].props.style.width, '100%', '第一名满条')
  assert.ok(fills.every(fill => /^\d+(\.\d+)?%$/.test(fill.props.style.width)), '进度条宽度均为有限百分比')

  // 旧服务端缺 hotAccountDistribution → 整个分布面板隐藏（二审 P1-3），
  // 不用截断后的排行近似出可能失真的前五。
  hLog.length = 0
  OverviewPage({
    overview: {
      summary: { accountCount: 7, workCount: 18, totalPlayCount: 90000, hotWorkCount: 18, hotRatePct: 100 },
      accounts, hotWorks: [],
    },
    loading: false, errorReason: null,
    filters: { window: '30d', sort: 'hot_count', accountIds: [] },
    accounts, collecting: false, exporting: false,
    onFilterChange: () => {}, onRefresh: () => {}, onExport: () => {},
    onOpenAccount: () => {}, onAddAccount: () => {}, t: key => key,
  })
  assert.ok(!hLog.some(node => String(node.props?.className || '').includes('ydo-ov-dist')),
    '缺 hotAccountDistribution 时不渲染分布列表（数据边界）')
})

test('v2 源码样式契约：窄列轨道、分布配色、抽屉尺寸与关闭按钮、分析页布局、搜索词仅关键词', async () => {
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  // §3.3/§4.2/§4.4：总览容器禁横向滚动；排行 8 列固定轨道（48px 排名起，无会话列）；
  // 爆款两表窄列 124px 发布时间 / 84px 播放量 / 76px 互动率。
  assert.match(source, /\.ydo-ov-table\{[^}]*overflow-x:hidden/u)
  assert.match(source, /\.ydo-ov-tr\{[^}]*box-sizing:border-box/u)
  assert.match(source, /\.ydo-ov-tr-rank\{grid-template-columns:48px minmax\(90px,\.8fr\) repeat\(6,minmax\(72px,\.35fr\)\)\}/u)
  assert.match(source, /\.ydo-ov-tr-hot\{[^}]*124px 84px 76px/u)
  assert.match(source, /\.ydo-ov-tr-hot-rank\{[^}]*124px 84px 76px/u)
  // §4.3：前三名固定语义色（1 橙 / 2 蓝 / 3 紫）。
  assert.match(source, /\.ydo-ov-dist-top1 \.ydo-bar-fill\{background:#E8833A\}/u)
  assert.match(source, /\.ydo-ov-dist-top2 \.ydo-bar-fill\{background:#3B82F6\}/u)
  assert.match(source, /\.ydo-ov-dist-top3 \.ydo-bar-fill\{background:#8B5CF6\}/u)
  // §4.1：收起态与展开层均由插件绘制，键盘焦点保留品牌色外环。
  assert.match(source, /\.ydo-filter-trigger\{[^}]*height:36px/u)
  assert.match(source, /\.ydo-filter-trigger:focus-visible\{border-color:#3B82F6;box-shadow:0 0 0 2px/u)
  assert.match(source, /\.ydo-filter-menu\{position:fixed;z-index:560;[^}]*border:1px solid var\(--dsw-alias-border-l1\)/u)
  assert.doesNotMatch(source, /\.ydo-ov-toolbar select/u, '总览工具栏不再依赖原生 select 弹出层')
  assert.match(source, /\.ydo-ov-hot-basis-head\{text-align:center;padding-inline:12px\}/u)
  assert.match(source, /\.ydo-export\{[^}]*white-space:nowrap/u)
  // §6.2：抽屉 min(720px,72vw)×min(860px,84vh) 且 ≥75vh；关闭按钮 40×40、::after 扩 ≥44px 命中区。
  assert.match(source, /\.ydo-ov-drawer\{width:min\(720px,72vw\);height:min\(860px,84vh\);min-height:75vh/u)
  assert.match(source, /\.ydo-ov-drawer-close\{[^}]*width:40px;height:40px/u)
  assert.match(source, /\.ydo-ov-drawer-close::after\{content:"";position:absolute;inset:-2px\}/u)
  assert.match(source, /\.ydo-ov-drawer-action\{margin-top:auto\}/u)
  // 需求 2：AI 分析弹框宽 min(880px, vw-48px)、z-index 530（主 overlay 520 与作品详情 540 之间，
  // 详情可叠加其上）；关闭按钮 40×40 命中区 ≥44px，与抽屉同一规格。
  assert.match(source, /\.ydo-ai-modal\{[^}]*width:min\(880px,calc\(100vw - 48px\)\)/u)
  assert.match(source, /\.ydo-ai-modal-overlay\{position:fixed;inset:0;z-index:530/u)
  assert.match(source, /\.ydo-ai-modal-close\{[^}]*width:40px;height:40px/u)
  // 需求 2：Esc 链插入 AI 弹框层（详情 → 抽屉 → AI 弹框 → overlay），且入依赖数组。
  assert.match(source, /else if \(aiModalOpen\) setAiModalOpen\(false\)/u)
  assert.match(source, /\[visible, detailWorkId, hotDrawerWork, aiModalOpen\]/u)
  // §5.2/§5.3：内容指标 3 列浅灰底圆角卡片（创作中心风格：标签小字在上、数值大字在下）、
  // 观众卡片两列；窄屏均退单列。
  assert.match(source, /\.ydo-an-metrics\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/u)
  assert.match(source, /\.ydo-an-metric-card\{[^}]*border-radius:8px;background:var\(--dsw-alias-bg-base\)/u)
  assert.match(source, /\.ydo-an-metric-value\{[^}]*font-size:20px[^}]*font-weight:700/u)
  // 用户反馈 2026-09-18：AI 风险/建议/规律条目标题 13.5px（对齐卡片标题 h4）、正文 13px，
  // 此前无 font-size 继承面板默认大字导致视觉过大。
  assert.match(source, /\.ydo-ai-item-title\{font-weight:600;font-size:13\.5px\}/u)
  assert.match(source, /\.ydo-ai-item-reason\{[^}]*font-size:13px\}/u)
  // 用户反馈 2026-09-18：证据作品 chip 字号与正文一致 13px（font:inherit 简写会重置
  // font-size、继承面板大字，禁止回归）；品牌色弱底高亮；标签左列 + chips 右列网格对齐。
  assert.match(source, /\.ydo-ai-evidence\{display:grid;grid-template-columns:auto minmax\(0,1fr\)/u)
  assert.match(source, /\.ydo-ai-evidence-list\{display:flex;flex-wrap:wrap;gap:5px\}/u)
  assert.match(source, /\.ydo-ai-chip\{[^}]*font-size:11px/u)
  assert.match(source, /\.ydo-ai-chip\{[^}]*background:color-mix\(in srgb,var\(--dsw-alias-brand-primary\)/u)
  // font 简写若出现在 font-size 之后会重置字号（历史 bug）；正确形态是简写在前、
  // 显式字号在后（同 .ydo-link 惯例），断言按顺序锁定。
  assert.match(source, /\.ydo-ai-chip\{[^}]*font:inherit;font-size:11px/u)
  // 需求 2（2026-09-18）：收起徽章「高N 中N 低N」三色计数与规律置信度徽章共用
  // .ydo-ai-pri-* 配色；旧「高 N · 中 N」纯文本模板与文案键已删除。
  assert.match(source, /\.ydo-ai-digest-counts\{flex:none;display:flex;gap:4px\}/u)
  assert.match(source, /\.ydo-ai-pri-high,\.ydo-ai-conf-high\{/u)
  assert.match(source, /\.ydo-ai-pri-medium,\.ydo-ai-conf-medium\{/u)
  assert.match(source, /\.ydo-ai-pri-low,\.ydo-ai-conf-low\{/u)
  assert.doesNotMatch(source, /aiDigestHigh|aiDigestMedium|aiDigestItems/u)
  // 用户反馈 2026-09-20：趋势图标题/副标题文案改版。
  assert.match(source, /trendTitle: '数据趋势'/u)
  assert.match(source, /trendCaption: '采集最近30天数据，缺采集日期以虚线连接，不补零'/u)
  // bug 3：总览下钻不得写 selected——视频数据 Tab 选中态与单账号分析页解耦，
  // 防止切 Tab 后列表无高亮且 loadWorks 拉取非本地登录账号的作品。
  assert.doesNotMatch(source, /onOpenAccount: accountId => \{[\s\S]{0,120}setSelected\(accountId\)/u)
  // review P1（2026-09-20）：AI 证据 chip 的 work 只有 {workId}（evidenceWorks
  // 契约无 accountId），分析页 onOpenWork 回退 analysisAccountId 打开作品详情，
  // 不依赖视频 Tab 的 selected。
  assert.match(source, /onOpenWork: work =>\s*openDetail\(work\.workId, work\.accountId \|\| analysisAccountId\)/u)
  // 需求 4（2026-09-18）：爆款抽屉指标摘要复用内容指标卡片，旧单行文本列表样式已删除。
  assert.doesNotMatch(source, /ydo-ov-drawer-metrics/u)
  // 需求 5b：趋势 SVG 高度固定 168px（不再 height:auto 随拉伸变形），viewBox 宽由
  // ResizeObserver 实测容器宽驱动（轴文字/点线恢复 1:1 尺寸）。
  assert.match(source, /\.ydo-an-trend-svg\{display:block;width:100%;height:168px/u)
  const analysisSource = await readFile(new URL('../src/analysis-ui.js', import.meta.url), 'utf8')
  assert.match(analysisSource, /typeof ResizeObserver === 'undefined'/u)
  assert.match(analysisSource, /trendLayout\(trend\?\.points \|\| \[\], \{ width: trendWidth \}\)/u)
  assert.match(source, /\.ydo-an-audience\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:12px\}/u)
  const mediaStart = source.indexOf('@media(max-width:720px)')
  assert.ok(mediaStart > -1, '存在窄屏断点')
  const mediaBody = source.slice(mediaStart, source.indexOf('}}', mediaStart) + 2)
  assert.ok(mediaBody.includes('.ydo-an-metrics{grid-template-columns:1fr}') && mediaBody.includes('.ydo-an-audience{grid-template-columns:1fr}'),
    '窄屏下指标与观众块退单列')
  // §4.2/§6.2：会话状态列与命中标签辅助行的文案键已随功能删除（组件回归会退成裸 key 被抓）。
  assert.doesNotMatch(source, /sessionFreshnessCol/u)
  assert.doesNotMatch(source, /hotLabels/u)
  // §6.1：搜索词只渲染关键词，percent 不进渲染层。
  assert.doesNotMatch(source, /item\.percent/u)
  // §3.2：视频数据作品数标注「全部时间作品数」，与总览/分析的范围口径并列不歧义。
  assert.match(source, /workCountAllTime: '全部时间作品数'/u)
  assert.match(source, /t\('workCountAllTime'\)/u)
  // 二审 P1-2：top_n 截断标注（完整账号数 vs 当前展示排行数）。
  assert.match(source, /rankingScopeHint: '共 \{total\} 个账号 · 排行展示 \{shown\} 个'/u)
  // 二审 P2 窄屏表格重排：面板为容器（容器查询按面板实际宽度触发，不受宿主侧栏影响），
  // 窄面板隐藏表头、行改卡片、字段名来自 data-label——不是仅隐藏横向溢出。
  assert.match(source, /container-type:inline-size;container-name:ydo-panel/u)
  assert.match(source, /@container ydo-panel \(max-width:940px\)\{\.ydo-ov-table\{overflow:visible;max-height:none\}\.ydo-ov-tr\.ydo-ov-head\{display:none\}/u)
  assert.match(source, /content:attr\(data-label\)/u)
  // data-label 由行单元格组件携带（总览排行/爆款表 + 分析页爆款表）。
  const overviewSource = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
  const analysisUiSource = await readFile(new URL('../src/analysis-ui.js', import.meta.url), 'utf8')
  assert.match(overviewSource, /t\('rankingScopeHint'\)[\s\S]{0,80}\.replace\('\{total\}'/u,
    '截断标注用 {total}/{shown} 占位组合（二审 P1-2）')
  assert.equal((overviewSource.match(/'data-label': t\(/gu) || []).length, 14,
    '总览两张表 14 个数据单元格都携带 data-label（排行 8 + 爆款 6）')
  assert.equal((analysisUiSource.match(/'data-label': t\(/gu) || []).length, 6,
    '分析页爆款表 6 个数据单元格都携带 data-label')
})

// ---------------------------------------------------------------------------
// AI 账号表现分析（0916 方案 §9）：插入位置、状态流转、结果渲染、二次确认。
// ---------------------------------------------------------------------------

test('AI 表现分析模块：无记录折叠、有结果展开、位置在爆款视频之前', async () => {
  const hLog = []
  const reactStub = {
    createElement: (type, props, ...children) => {
      hLog.push({ type, props, children })
      return { type, props, children }
    },
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    // 阶段 4：AnalysisPage 趋势测宽 hook（沙箱无 ResizeObserver，hook 内部自动降级 600 宽）
    useRef: value => ({ current: value === undefined ? null : value }),
    useEffect: () => {},
  }
  const sandbox = await evalUiModule(new URL('../src/analysis-ui.js', import.meta.url), {}, reactStub)
  const AnalysisPage = vm.runInContext('AnalysisPage', sandbox)

  const zhCopy = {
    accountTitle: '账号：{name}', backToOverview: '← 返回账号总览', exportAnalysis: '导出账号分析报告',
    exporting: '导出中…', fanCount: '粉丝', workCount: '作品数', latestCollected: '最近采集', noRecord: '暂无记录',
    kpiTotalPlay: '总播放量', colMedianPlay: '中位播放量', colHighestPlay: '最高播放量', kpiHotWorks: '爆款数量',
    hotRateCol: '爆款率', trendTitle: '趋势', trendMetric: '指标', metric_play: '播放量', trendCaption: 'x',
    noTrend: '暂无趋势', contentMetrics: '内容指标', cmEngagement: '综合互动率', dataInsufficient: '数据不足',
    audienceTraffic: '观众与流量', mainGender: '主要性别', accountHotWorks: '本账号爆款视频', rankCol: '排名',
    colVideo: '视频', publishTime: '发布时间', colPlay: '播放量', engagement: '互动率', hotBasis: '爆款依据',
    labelAbsolute: '绝对爆款',
    aiTitle: 'AI 账号表现分析', aiStatusNotAnalyzed: '状态：未分析', aiStatusRunning: '状态：分析中',
    aiStatusSucceeded: '状态：已完成', aiStatusInsufficient: '状态：数据不足', aiStatusFailed: '状态：失败',
    aiEntryButton: 'AI 分析', close: '关闭',
    aiStartButton: 'AI 分析账号表现', aiStartButtonFirst: '开始分析', aiRerunButton: '重新分析', aiRunningButton: '分析中…',
    aiExpand: '展开', aiCollapse: '收起',
    aiSummaryTitle: '结论摘要', aiDimensionsTitle: '表现诊断', aiPatternsTitle: '爆款规律',
    aiRisksTitle: '风险与机会', aiRecommendationsTitle: '执行建议', aiAssessmentLabel: '整体判定',
    aiAssessmentStable: '稳定', aiLevelStrong: '强', aiLevelMedium: '中', aiLevelWeak: '弱',
    aiLevelInsufficient: '数据不足', aiGradeHigh: '高', aiGradeMedium: '中', aiGradeLow: '低',
    aiMetaRange: '最近 30 天', aiMetaGeneratedAt: '分析时间', aiMetaSample: '样本作品数',
    aiMetaPrompt: '提示词版本', aiMetaModel: '模型', aiEvidenceWorks: '证据作品',
    aiDataLimitations: '数据限制', aiDisclaimer: '免责声明', aiExpectedSignal: '观察信号',
    aiConfirmTitle: '重新分析？', aiConfirmBody: '将忽略缓存重新运行 AI 分析。',
    aiConfirmYes: '重新分析', aiConfirmNo: '取消',
    aiErrorRetained: 'AI 分析暂时失败，请稍后重试；已保留上次分析结果',
    aiErrorRetryable: 'AI 分析暂时失败，请稍后重试',
    aiErrorBusy: '当前分析任务较多，请稍后重试', aiErrorRunning: '已有进行中的分析任务',
    aiErrorInsufficient: '有效作品样本不足，暂无法生成 AI 分析', aiErrorTimeout: '分析超时，请稍后重试',
    aiErrorEnqueue: '分析任务提交失败，请重新发起', aiErrorUnavailable: 'AI 分析服务暂不可用',
    aiErrorNotFound: '分析记录不存在', aiErrorConflict: '请求与历史记录不一致，请刷新后重试',
    aiDimShortContent: '内容', aiDimShortInteraction: '互动', aiDimShortRetention: '留存',
    aiDimShortAudience: '受众', aiDimShortStability: '稳定',
    aiDimDetail: '证据与明细', aiLimitsTitle: '数据限制与免责',
    aiDigestLimits: '{n} 项',
    aiGradeHigh: '高', aiGradeMedium: '中', aiGradeLow: '低',
  }
  const t = key => zhCopy[key] || key
  const analysis = {
    account: { accountId: 'a1', nickname: '燃豚豚', fanCount: 287, lastCollectedAt: null },
    summary: { workCount: 17 },
    kpi: { totalPlayCount: 100, hotWorkCount: 1, hotRatePct: 5 },
    interaction: {}, hotWorks: [{ workId: 'w1', title: 'T', rank: 1, playCount: 1, engagementRatePct: 1, labels: ['absolute'] }],
  }
  const aiResult = {
    summary: '账号整体稳定', overallAssessment: 'stable',
    dimensions: [
      { key: 'content', title: '内容吸引力', level: 'strong', facts: ['30 天 12 条'], insight: '头部集中', evidenceWorkIds: ['w1'], limitations: [] },
      { key: 'interaction', title: '互动质量', level: 'medium', facts: ['互动率 6%'], insight: null, evidenceWorkIds: [], limitations: [] },
      { key: 'retention', title: '留存', level: 'insufficient', facts: ['覆盖不足'], insight: null, evidenceWorkIds: [], limitations: [] },
      { key: 'audience', title: '受众', level: 'weak', facts: ['来源单一'], insight: null, evidenceWorkIds: [], limitations: [] },
      { key: 'stability', title: '稳定', level: 'medium', facts: ['节奏稳定'], insight: null, evidenceWorkIds: [], limitations: [] },
    ],
    viralPatterns: [{ pattern: '高播放强互动', evidenceWorkIds: ['w1'], confidence: 'high' }],
    risks: [{ title: '头部集中', reason: 'Top1 占比高', priority: 'high' }],
    recommendations: [{ action: '保持节奏', reason: 'stability 中', priority: 'low', expectedSignal: '发布间隔' }],
    dataLimitations: ['留存字段覆盖不足'],
    disclaimer: '辅助分析，不构成官方判定',
  }

  // 0) 弹框默认关闭：页面树无 AI 分析内容，工具栏有「AI 分析」入口按钮（需求 2）
  hLog.length = 0
  let modalOpened = false
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: null, aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    onAiModalOpen: () => { modalOpened = true },
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  const closedText = JSON.stringify(hLog)
  assert.ok(!closedText.includes('AI 账号表现分析'), '弹框默认关闭时页面无 AI 分析内容')
  assert.ok(!closedText.includes('整体判定'), '弹框关闭时六卡不渲染')
  assert.ok(closedText.includes('AI 分析'), '工具栏有 AI 分析入口按钮')
  assert.ok(hLog.some(node => node.props && node.props.className === 'ydo-an-toolbar'), '分析页工具栏渲染')
  // 入口按钮点击 → onAiModalOpen 被调用（review P2-3：开关回调 spy 断言）
  const entryButton = hLog.find(node => node.type === 'button'
    && Array.isArray(node.children) && node.children[0] === 'AI 分析')
  assert.ok(entryButton, '入口按钮节点存在')
  entryButton.props.onClick()
  assert.equal(modalOpened, true, '点「AI 分析」打开弹框')

  // 1) 无记录：折叠（不出现子块），状态未分析，按钮是首次分析入口（弹框打开态）
  hLog.length = 0
  let modalClosed = false
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: null, aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    aiModalOpen: true,
    onAiModalClose: () => { modalClosed = true },
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  let text = JSON.stringify(hLog)
  assert.ok(hLog.some(node => node.props && node.props.role === 'dialog'
    && node.props.className === 'ydo-ai-modal'), 'AI 分析以弹框（role=dialog）渲染')
  // 弹框关闭按钮点击 → onAiModalClose 被调用（review P2-3）
  const closeButton = hLog.find(node => node.props && node.props.className === 'ydo-ai-modal-close')
  assert.ok(closeButton, '弹框关闭按钮存在')
  closeButton.props.onClick()
  assert.equal(modalClosed, true, '点关闭按钮关闭弹框')
  assert.ok(text.includes('状态：未分析'), '无记录状态行')
  assert.ok(text.includes('开始分析'), '未分析时按钮用「开始分析」（需求 4）')
  assert.ok(!text.includes('AI 分析账号表现'), '未分析时不出现 aiStartButton 长文案')
  // 内容指标卡片化（需求 1）：固定 8 项渲染为 ydo-an-metric-card 网格卡片
  const metricCards = hLog.filter(node => node.props && node.props.className === 'ydo-an-metric-card')
  assert.ok(metricCards.length === 8, '内容指标固定 8 张卡片')
  assert.ok(text.includes('综合互动率') && text.includes('数据不足'), '指标缺失时显式「数据不足」')

  // 1b) 首次失败（无保留结果）：按钮保持 aiStartButton 长文案（阶段 2 review P2 补覆盖）
  hLog.length = 0
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: null, aiStatus: 'failed', aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    aiModalOpen: true,
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  assert.ok(JSON.stringify(hLog).includes('AI 分析账号表现'), '首次失败无结果时按钮保持 aiStartButton 长文案')
  // 折叠卡为 hidden 渲染（收起 ≠ 不渲染）：无记录时结论卡 digest 为空判定
  assert.ok(text.includes('整体判定：—'), '无记录结论卡空态 digest')
  assert.ok(!text.includes('账号整体稳定'), '无结果不渲染分析正文')

  // 2) 有结果：默认展开 + 五个子块 + 元数据 + 五维中文等级 + 位置在爆款视频之前
  hLog.length = 0
  let openedFromChip = null
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: {
      analysisId: 'ai-1', status: 'succeeded', result: aiResult, summary: aiResult.summary,
      sampleCount: 12, promptVersion: 'douyin-account-analysis-v2', model: 'minimax-m3',
      generatedAt: '2026-09-16T08:00:00+00:00', error: null,
      evidenceWorks: [{ workId: 'w1', title: '路边划线区域停车要不要罚' }],
    },
    aiStatus: 'succeeded',
    aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    onOpenWork: work => { openedFromChip = work }, t,
    aiModalOpen: true,
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  text = JSON.stringify(hLog)
  assert.ok(text.includes('AI 账号表现分析'), 'AI 模块渲染')
  // 弹框化（需求 2）：AI 区不再内嵌页面，AiAnalysisModal 以 role=dialog 渲染，
  // 页面树仅保留工具栏入口按钮（场景 0 已断言默认关闭）。
  assert.ok(hLog.some(node => node.props && node.props.className === 'ydo-ai-modal'),
    'AI 分析以弹框容器（ydo-ai-modal）渲染')
  assert.ok(hLog.some(node => node.type === 'h3' && node.children && node.children[0] === '本账号爆款视频'),
    '爆款视频区块仍在页面树')
  for (const label of ['结论摘要', '表现诊断', '爆款规律', '风险与机会', '执行建议']) {
    assert.ok(text.includes(label), `子块「${label}」`)
  }
  assert.ok(text.includes('最近 30 天'), '元数据：分析窗口')
  assert.ok(text.includes('整体判定：稳定'), 'overallAssessment 中文')
  assert.ok(text.includes('强') && text.includes('数据不足'), '五维等级中文化（strong/insufficient）')
  assert.ok(text.includes('状态：已完成'), '状态行显示外层运行态 aiStatus')
  assert.ok(text.includes('重新分析') && !text.includes('开始分析'), '已分析时按钮为「重新分析」而非「开始分析」')
  assert.ok(text.includes('账号整体稳定'), '结论摘要渲染')
  // 收起态 digest：诊断卡五维等级徽章行（v2 验收稿交互）
  // 测试数据等级：content=strong / interaction=medium / retention=insufficient / audience=weak / stability=medium
  assert.ok(text.includes('内容 · 强'), '诊断卡收起态五维徽章（内容·强）')
  assert.ok(text.includes('受众 · 弱'), '诊断卡收起态五维徽章（受众·弱）')
  // 风险卡收起态计数徽章（1 条 medium）
  // 收起徽章三色计数（用户反馈 2026-09-18 需求 2）：风险 1 条 high →「高1」；
  // 建议 1 条 low →「低1」；规律 1 条 confidence high →「高1」。
  assert.ok(text.includes('高1'), '风险卡收起态计数「高1」')
  assert.ok(text.includes('低1'), '建议卡收起态计数「低1」')
  assert.ok(!text.includes('高 1 · 中 0') && !text.includes(' 条 · '), '旧格式「高 N · 中 N」「N 条 · 高 N」不再出现')
  assert.ok(text.includes('ydo-ai-digest-counts') && text.includes('ydo-ai-pri-high'),
    '收起徽章为三色计数容器（.ydo-ai-digest-counts + .ydo-ai-pri-*）')
  assert.ok(text.includes('ydo-ai-conf-high'), '规律置信度徽章按高/中/低分级配色')
  // 元数据不再展示提示词/模型（验收反馈 2026-09-17，保留在导出报告）：
  // 断言针对可见文本（props 原始对象含 promptVersion/model，不参与可见文本）。
  const aiVisible = []
  const walkAi = node => {
    if (typeof node === 'string') { aiVisible.push(node); return }
    if (Array.isArray(node)) { node.forEach(walkAi); return }
    if (node && typeof node === 'object' && Array.isArray(node.children)) walkAi(node.children)
  }
  hLog.forEach(walkAi)
  const aiVisibleText = aiVisible.join('\n')
  assert.ok(!aiVisibleText.includes('douyin-account-analysis-v2'), '提示词版本不进可见文本')
  assert.ok(!aiVisibleText.includes('minimax-m3'), '模型标识不进可见文本')
  // 证据作品显示标题而非 ID
  assert.ok(text.includes('路边划线区域停车要不要罚'), '证据作品显示标题')
  assert.ok(text.includes('头部集中') && text.includes('高'), '风险与优先级中文')
  assert.ok(text.includes('观察信号'), '建议含观察信号')
  assert.ok(text.includes('证据作品') && text.includes('w1'), '证据作品可点击')
  // 用户反馈 2026-09-18：证据作品标签与 chips 拆两列网格——evidence 容器恰好两个
  // 子节点（label + list），chips 全部收在 list 内，不再与标签混排同一行流。
  const evidenceNode = hLog.find(node => node.props && node.props.className === 'ydo-ai-evidence')
  assert.ok(evidenceNode, 'ydo-ai-evidence 容器存在')
  assert.ok(evidenceNode.children.length === 2
    && evidenceNode.children[0].props?.className === 'ydo-ai-evidence-label'
    && evidenceNode.children[1].props?.className === 'ydo-ai-evidence-list',
  '证据作品 = 标签 + 列表两个子容器（对齐布局）')
  const chipList = evidenceNode.children[1]
  assert.ok(chipList.children.length >= 1
    && chipList.children.every(chip => chip.props?.className === 'ydo-ai-chip' && chip.type === 'button'),
  'chips 全部为 list 容器内的 button')
  // review P1/P2（2026-09-20）：chip 点击仅转发 {workId}——evidenceWorks 契约无
  // accountId，组件层不伪造；client 层由 onOpenWork 回退 analysisAccountId（源码
  // 契约已锁定），两条断言合起来覆盖完整下钻链。
  assert.ok(typeof chipList.children[0].props.onClick === 'function', 'chip 有点击回调')
  chipList.children[0].props.onClick()
  assert.ok(openedFromChip && openedFromChip.workId === 'w1' && !('accountId' in openedFromChip),
    'chip 点击仅转发 {workId}，不带伪造 accountId')
  assert.ok(text.includes('辅助分析，不构成官方判定'), '免责声明')
  // 原始枚举不进「可见文本」（className 里的样式钩子不算可见文本）：
  // 递归拼接 children 中的字符串字面量再断言。
  const visibleText = []
  const walk = node => {
    if (typeof node === 'string') { visibleText.push(node); return }
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node && typeof node === 'object' && Array.isArray(node.children)) walk(node.children)
  }
  hLog.forEach(walk)
  const visible = visibleText.join('\n')
  assert.ok(!visible.includes('stable') && !visible.includes('strong'), '原始枚举 level/assessment 不进可见文本')

  // 3) running：按钮禁用
  hLog.length = 0
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: null, aiStatus: 'running', aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    t, aiModalOpen: true,
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  text = JSON.stringify(hLog)
  assert.ok(text.includes('"disabled":true'), '分析中按钮禁用')
  assert.ok(text.includes('分析中…'), '运行态按钮文案')
  assert.ok(text.includes('状态：分析中'), '状态行显示分析中（外层 aiStatus 驱动）')

  // 4) 失败但保留旧结果：服务端 retainedError 驱动警示（2026-09-18 语义）；
  // 重跑成功后服务端不再输出该字段 → 不再误报（需求 3）
  hLog.length = 0
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: {
      status: 'succeeded', result: aiResult,
      retainedError: { code: 'AI_ANALYSIS_TIMEOUT', message: 'x', retryable: true },
    },
    aiStatus: 'failed',
    aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    t, aiModalOpen: true,
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  text = JSON.stringify(hLog)
  assert.ok(text.includes('状态：失败'), '状态行可见失败（aiStatus 外层运行态）')
  assert.ok(text.includes('已保留上次分析结果'), '失败保留旧结果警示')

  // 4b) 重跑数据不足：警示文案区分（insufficient 用样本不足文案，retainedError 驱动）
  hLog.length = 0
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: {
      status: 'succeeded', result: aiResult,
      retainedError: { code: 'AI_ANALYSIS_INSUFFICIENT_DATA', message: 'x', retryable: false },
    },
    aiStatus: 'insufficient',
    aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    t, aiModalOpen: true,
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  assert.ok(JSON.stringify(hLog).includes('有效作品样本不足'), '数据不足警示区分于失败文案')

  // 4c) 重跑成功（服务端不再输出 retainedError）：不渲染「已保留上次分析结果」警示
  //（需求 3 回归：此前 error 残留在正文上导致重跑成功仍误报）
  hLog.length = 0
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: { status: 'succeeded', result: aiResult },
    aiStatus: 'succeeded',
    aiBusy: false, aiError: null, aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    t, aiModalOpen: true,
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  text = JSON.stringify(hLog)
  assert.ok(!text.includes('已保留上次分析结果'), '重跑成功后不再显示失败保留警示（需求 3）')
  assert.ok(!text.includes('有效作品样本不足'), '重跑成功后不显示数据不足警示')

  // 5) 二次确认
  hLog.length = 0
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: { status: 'succeeded', result: aiResult }, aiStatus: 'succeeded', aiBusy: false, aiError: null,
    aiConfirming: true,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    t, aiModalOpen: true,
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  const dialog = hLog.find(node => node.props && node.props.role === 'dialog')
  assert.ok(dialog, '二次确认渲染 role=dialog')
  assert.ok(JSON.stringify(hLog).includes('重新分析？'), '确认框标题')

  // 6) 稳定错误码：服务端 AI 错误码收敛为中文提示
  hLog.length = 0
  AnalysisPage({
    analysis, trend: null, trendMetric: 'play', trendErrorReason: null, loading: false,
    errorReason: null, exporting: false, onBack: () => {}, onMetricChange: () => {},
    onExport: () => {}, onOpenWork: () => {}, t,
    aiAnalysis: null, aiBusy: false, aiError: 'AI_ANALYSIS_GLOBAL_CONCURRENCY_LIMIT', aiConfirming: false,
    onAiStart: () => {}, onAiRequestRerun: () => {}, onAiConfirmRerun: () => {}, onAiCancelConfirm: () => {},
    t, aiModalOpen: true,
  })
  for (let i = 0; i < hLog.length; i += 1) if (typeof hLog[i].type === 'function') hLog[i].type(hLog[i].props)
  assert.ok(JSON.stringify(hLog).includes('当前分析任务较多'), '并发上限错误码收敛中文提示')
  assert.ok(hLog.some(node => node.props && node.props.role === 'alert'), '错误以 role=alert 呈现')
})
