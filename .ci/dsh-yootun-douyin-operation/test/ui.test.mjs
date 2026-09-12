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
  assert.ok(joined.includes('示例词 12.5%'), '搜索词带占比')
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
  assert.ok(text.includes('缺失词 —'), '搜索词缺失百分比回退 —')
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
