// 投流信息维护 UI 测试（RQ-2026-009 §6.4/§6.9）：详情入口与卡片、表单校验、
// 预填与提交契约、保存刷新、stale-add 提示。组件经 lib/client.js 工厂加载真实
// 渲染（同 ui.test.mjs loadBundle 模式）；保存链路为源码契约断言。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

async function loadBundle() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loaded = []
  const sandbox = { window: { __ModuleLoader__: { load: definition => loaded.push(definition) } }, console }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const stubs = {
    react: {
      createElement: (type, props, ...children) => ({ type, props, children }),
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
  const moduleExports = loaded[0].factory(name => {
    if (!(name in stubs)) throw new Error(`unexpected require: ${name}`)
    return stubs[name]
  })
  return { moduleExports, t: key => key }
}

const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

test('validatePromotionForm：必填缺失与非法分键、合法返回 null（§6.9.2）', async () => {
  const { moduleExports } = await loadBundle()
  const validate = moduleExports.validatePromotionForm
  // 必填缺失（按字段顺序首错返回）。
  assert.equal(validate({}), 'promotionPlayRequired')
  assert.equal(validate({ playCount: '100' }), 'promotionCostRequired')
  assert.equal(validate({ playCount: '100', costAmount: '50' }), 'promotionFansRequired')
  assert.equal(validate({ playCount: '100', costAmount: '50', fansCount: '10' }), 'promotionHoursRequired')
  // 非法值。
  assert.equal(validate({ playCount: '1.5', costAmount: '50', fansCount: '10', durationHours: '2' }), 'promotionPlayInvalid', '播放计数必须整数')
  assert.equal(validate({ playCount: '-1', costAmount: '50', fansCount: '10', durationHours: '2' }), 'promotionPlayInvalid')
  assert.equal(validate({ playCount: '100', costAmount: '50.123', fansCount: '10', durationHours: '2' }), 'promotionCostInvalid', '金额最多 2 位小数')
  assert.equal(validate({ playCount: '100', costAmount: '50', fansCount: 'x', durationHours: '2' }), 'promotionFansInvalid')
  assert.equal(validate({ playCount: '100', costAmount: '50', fansCount: '10', durationHours: '0' }), 'promotionHoursInvalid', '时长必须为正')
  assert.equal(validate({ playCount: '100', costAmount: '50', fansCount: '10', durationHours: '-1' }), 'promotionHoursInvalid')
  // 合法：整数或 1–2 位小数、金额允许 0。
  assert.equal(validate({ playCount: '1200', costAmount: '88.5', fansCount: '40', durationHours: '24' }), null)
  assert.equal(validate({ playCount: '0', costAmount: '0', fansCount: '0', durationHours: '0.5' }), null)
  // 量级上限（审查 P2-3）：与 DB NUMERIC(14,2)/NUMERIC(8,2)、tools DTO le、宿主
  // 常量同一口径——金额整数 12 位、时长 6 位，边界值合法、超限非法。
  assert.equal(validate({ playCount: '1', costAmount: '999999999999.99', fansCount: '1', durationHours: '999999.99' }), null, '上限边界值合法')
  assert.equal(validate({ playCount: '1', costAmount: '1000000000000', fansCount: '1', durationHours: '2' }), 'promotionCostInvalid', '金额超 NUMERIC(14,2) 拒绝')
  assert.equal(validate({ playCount: '1', costAmount: '50', fansCount: '1', durationHours: '1000000' }), 'promotionHoursInvalid', '时长超 NUMERIC(8,2) 拒绝')
})

test('PromotionModal：预填服务端值、四个 number input 属性（§6.9.1/§6.9.3）', async () => {
  const { moduleExports, t } = await loadBundle()
  const PromotionModal = moduleExports.PromotionModal
  const modal = {
    accountId: 'a1', accountName: '测试账号', workId: 'w1', workTitle: '测试视频', recordId: '7',
    playCount: '1200', costAmount: '88.50', fansCount: '40', durationHours: '24',
  }
  const modalNode = PromotionModal({ modal, saving: false, t, onConfirm: () => {}, onClose: () => {} })
  const collect = (node, tag, acc = []) => {
    if (!node || typeof node !== 'object') return acc
    if (Array.isArray(node)) return node.reduce((all, item) => collect(item, tag, all), acc)
    if (node.type === tag) acc.push(node)
    return collect(node.children || [], tag, acc)
  }
  assert.equal(modalNode.props.role, undefined)
  const dialog = collect(modalNode, 'div').find(node => node.props['aria-labelledby'] === 'ydo-promotion-modal-title')
  assert.ok(dialog, 'dialog 挂载且带 aria 标签')
  const inputs = collect(dialog, 'input')
  assert.equal(inputs.length, 6, '只读账号名 + 只读视频名 + 4 个 number input（审查 P1-1）')
  assert.equal(inputs[0].props.readOnly, true, '所属账号只读')
  assert.equal(inputs[0].props.value, '测试账号', '所属账号展示 accountName（跨账号防误存）')
  assert.equal(inputs[1].props.readOnly, true, '视频名只读')
  assert.equal(inputs[1].props.value, '测试视频')
  const numbers = inputs.slice(2)
  assert.deepEqual(numbers.map(node => node.props.value), ['1200', '88.50', '40', '24'], '预填服务端字符串值')
  assert.deepEqual(numbers.map(node => node.props.type), ['number', 'number', 'number', 'number'])
  assert.deepEqual(numbers.map(node => node.props.step), [1, 0.01, 1, 0.01], '计数 step=1、金额/时长 step=0.01')
  assert.ok(numbers[0].props.ref, '第一个可编辑输入挂 firstInputRef（审查 P3-3，对齐 OwnerModal 焦点管理）')
  assert.deepEqual(numbers.map(node => node.props.value), ['1200', '88.50', '40', '24'], '预填服务端字符串值')
  assert.deepEqual(numbers.map(node => node.props.type), ['number', 'number', 'number', 'number'])
  assert.deepEqual(numbers.map(node => node.props.step), [1, 0.01, 1, 0.01], '计数 step=1、金额/时长 step=0.01')
})

test('PromotionModal 提交契约：金额/时长字符串透传、计数转整数（§6.9.4）', async () => {
  const { moduleExports, t } = await loadBundle()
  const PromotionModal = moduleExports.PromotionModal
  const submissions = []
  const modalNode = PromotionModal({
    modal: { accountId: 'a1', workId: 'w1', playCount: '1200', costAmount: '88.5', fansCount: '40', durationHours: '24' },
    saving: false,
    t,
    onConfirm: payload => submissions.push(payload),
    onClose: () => {},
  })
  const collect = (node, tag, acc = []) => {
    if (!node || typeof node !== 'object') return acc
    if (Array.isArray(node)) return node.reduce((all, item) => collect(item, tag, all), acc)
    if (node.type === tag) acc.push(node)
    return collect(node.children || [], tag, acc)
  }
  const save = collect(modalNode, 'button').find(node => String(node.props.className || '').includes('ydo-mat-primary'))
  await save.props.onClick()
  assert.equal(submissions.length, 1, '合法表单提交一次')
  // vm realm 对象先展开成宿主对象再比较（原型不同的 deepStrictEqual 会失败）。
  assert.deepEqual({ ...submissions[0] }, {
    accountId: 'a1', workId: 'w1', recordId: null,
    playCount: 1200, costAmount: '88.5', fansCount: 40, durationHours: '24',
  }, '计数 Number、金额/时长保持字符串（Decimal round-trip）')
})

test('详情投流入口与卡片：已投流 tag + 按钮、核心指标后的投流 section（§6.4）', () => {
  // 入口在头部 meta 操作区：已投流标签 + 维护按钮。
  assert.match(clientSource, /t\('promotionBadge'\)/u)
  assert.match(clientSource, /onClick: openPromotionModal/u)
  // 预填（§6.9.1）：更新时带 recordId 与服务端字符串值；新增时全空。
  assert.match(clientSource, /recordId: promotion \? String\(promotion\.id\) : null/u)
  assert.match(clientSource, /playCount: promotion \? String\(promotion\.playCount\) : ''/u)
  // 投流 section 在核心指标 section 之后，复用 ydo-an-metrics 指标卡结构。
  const detailBody = clientSource.slice(clientSource.indexOf('function WorkDetailModal'), clientSource.indexOf('function OwnerModal'))
  const secAt = detailBody.indexOf("t('secPromotion')")
  const coreAt = detailBody.indexOf("t('secCoreMetrics')")
  assert.ok(coreAt > 0 && secAt > coreAt, '投流 section 在核心指标之后')
  // 只在已投流时渲染；卡片顺序固定：核心指标 → 投流数据 → 播放量趋势。
  assert.match(detailBody, /promotion \? h\('section', \{ className: 'ydo-panel ydo-modal-panel-full' \},\n            h\('h4', \{ className: 'ydo-modal-sec-title' \}, t\('secPromotion'\)\),\n            h\('div', \{ className: 'ydo-an-metrics ydo-modal-core-metrics', role: 'list' \},/u)
  assert.match(detailBody, /const promotionMetrics = promotion \? \[\n    \[t\('promoPlay'\), countText\(promotion\.playCount\)\],\n    \[t\('promoCost'\), promotionMoneyText\(promotion\.costAmount\)\],\n    \[t\('promoFans'\), countText\(promotion\.fansCount\)\],\n    \[t\('promoHours'\), promotionHoursText\(promotion\.durationHours\)\],\n  \] : \[\]/u)
})

test('保存投流：幂等键、成功后关弹框并重开详情刷新（§6.4.5）', () => {
  // 幂等键由页面生成（payload 展开 + 键注入，模板与 tools 侧一致）。
  assert.match(clientSource, /action: 'work\.promotion\.save',\n        \.\.\.payload,\n        idempotencyKey: workPromotionSaveIdempotencyKey\(\),/u)
  // 成功：关弹框 → openDetail 重拉详情（最新投流数据）。
  assert.match(clientSource, /setPromotionModal\(null\)\n      if \(promotionModal\) await openDetail\(promotionModal\.workId, promotionModal\.accountId\)/u)
  // saving 态由 client 持有：请求期间 saving=true（保存中不关弹框、按钮禁用）。
  assert.match(clientSource, /setPromotionSaving\(true\)\n    try \{/u)
  assert.match(clientSource, /finally \{\n      setPromotionSaving\(false\)/u)
})

test('stale-add 提示：PROMOTION_ALREADY_EXISTS 映射专用文案（§6.4.4）', () => {
  assert.match(clientSource, /PROMOTION_ALREADY_EXISTS: 'promotionAlreadyExists'/u)
  // 中英文案与评审定稿一致：已存在投流数据 → 刷新后检查并更新。
  assert.match(clientSource, /promotionAlreadyExists: '该作品已存在投流数据，请刷新后检查并更新'/u)
  assert.match(clientSource, /promotionAlreadyExists: 'This work already has promotion data — refresh and update it'/u)
})

test('stale-add 自动恢复（审查 P1-2 + 复验修复）：重拉回填弹框转更新、提示随数据走', () => {
  // 收到 PROMOTION_ALREADY_EXISTS 不直接抛错：先重拉 work.get，拿到最新投流记录。
  assert.match(clientSource, /if \(result\.reason === 'PROMOTION_ALREADY_EXISTS' && promotionModal\) \{\n          const fresh = await post\(\{\n            action: 'work\.get', accountId: promotionModal\.accountId, workId: promotionModal\.workId,\n          \}\)\.catch\(\(\) => null\)/u)
  // 重拉成功：刷新详情背景 + 回填弹框（recordId 与四值就位），并随新 modal 带
  // staleRecovered 标记——复验教训（review 子代理实验实证）：recordId 变化触发
  // 挂载 key 重挂载，旧实例上的 setState 是 no-op，提示必须随数据走才能存活。
  assert.match(clientSource, /await openDetail\(promotionModal\.workId, promotionModal\.accountId\)\n            setPromotionModal\(\{\n              \.\.\.promotionModal,\n              recordId: String\(promotion\.id\),/u)
  assert.match(clientSource, /staleRecovered: true,\n            \}\)\n            return \{ ok: true \}/u)
  // 重拉失败回退原口径错误文案（手动刷新路径仍在）。
  assert.match(clientSource, /return \{ ok: false, reason: result\.reason \|\| 'promotion_save_failed' \}/u)
  // 弹框挂载 key 随 recordId 变化：强制重挂载后预填 useState 才取到新值。
  assert.match(clientSource, /key: promotionModal\.recordId \? `promotion-\$\{promotionModal\.recordId\}` : 'promotion-new',/u)
  // 提示渲染 modal.staleRecovered（数据驱动，非组件 state；role=status 与错误 alert 区分）。
  assert.match(clientSource, /modal\.staleRecovered\n      \? h\('p', \{ className: 'ydo-mat-error', role: 'status' \}, t\('promotionStaleNotice'\)\)/u)
  assert.ok(!clientSource.includes('noticeKey'), '不得再引用已删除的 noticeKey state（重挂载即丢）')
})

test('详情归属账号与请求守卫（审查 P0-1/P2-2）', () => {
  // P0-1：openDetail 记录真实账号到 detailAccountId，弹框渲染以它为准（不是 selected）。
  assert.match(clientSource, /const \[detailAccountId, setDetailAccountId\] = useState\(null\)/u)
  assert.match(clientSource, /setDetailWorkId\(workId\)\n    setDetailAccountId\(targetAccount\)/u)
  assert.match(clientSource, /accountId: detailAccountId, workId: detailWorkId, detail, trend, loading: !detail, t,/u)
  assert.match(clientSource, /setDetailWorkId\(null\); setDetail\(null\); setDetailAccountId\(null\); setTrend\(null\)/u)
  // 弹框入口补 accountName：从完整账号列表按详情账号取名（跨账号不串名）。
  assert.match(clientSource, /const owner = accounts\.find\(item => item\.accountId === modalData\.accountId\)\n        setPromotionModal\(\{ \.\.\.modalData, accountName: \(owner && owner\.nickname\) \|\| modalData\.accountId \}\)/u)
  // P2-2：详情请求序列号守卫——旧响应在序列号失配时丢弃。
  assert.match(clientSource, /const detailRequestRef = useRef\(0\)/u)
  assert.match(clientSource, /const requestId = \+\+detailRequestRef\.current/u)
  assert.match(clientSource, /if \(requestId !== detailRequestRef\.current\) return\n      if \(detailResult\.status === 'ready'\) setDetail\(detailResult\)/u)
})

test('详情头部投流入口在「最近采集」下方，按钮黑底白字（2026-11-04 UI 优化）', () => {
  // head-text 内纵向排布：最近采集 meta 在上、投流操作区在下（不再与时间同行）；
  // 按钮升级 ydo-primary 黑底白字（alias 主题变量深色自适应）。
  const head = clientSource.slice(clientSource.indexOf("h('div', { className: 'ydo-modal-head-text' }"))
  const latestAt = head.indexOf("t('latestCollected')")
  const promoAt = head.indexOf("className: 'ydo-detail-promo-actions'")
  const entryAt = head.indexOf('openPromotionModal')
  assert.ok(latestAt > 0, '最近采集 meta 行存在')
  assert.ok(promoAt > latestAt, '投流操作区在最近采集下方')
  assert.ok(entryAt > promoAt, '投流按钮在操作区内')
  const promoBlock = head.slice(promoAt, entryAt)
  assert.match(promoBlock, /className: 'ydo-primary'/u, '投流按钮黑底白字（ydo-primary）')
  assert.ok(!head.slice(latestAt, promoAt).includes('ydo-modal-grid-2'), '不再用 grid-2 与时间同行')
  assert.match(clientSource, /\.ydo-detail-promo-actions\{display:flex;align-items:center;gap:8px;margin:0\}/u, '操作区 flex 样式')
  // 弹框所属账号只读字段（P1-1）+ 新文案键登记。
  assert.match(clientSource, /t\('promotionModalAccount'\)/u)
  assert.match(clientSource, /promotionModalAccount: '所属账号'/u)
  assert.match(clientSource, /promotionModalAccount: 'Account'/u)
})

test('stale 恢复提示渲染级断言：modal.staleRecovered 直接可见（复验 P1-2 缺陷回归锚）', async () => {
  // 复验教训：提示曾挂在组件 state（noticeKey）上，recordId 变化→挂载 key 重挂载
  // →旧实例 setState no-op→提示丢失。此处直调真实组件，断言提示由数据驱动渲染：
  // 新实例首帧（modal.staleRecovered=true）即包含中性提示，无任何交互前置。
  const { moduleExports, t } = await loadBundle()
  const PromotionModal = moduleExports.PromotionModal
  const modal = {
    accountId: 'a1', workId: 'w1', workTitle: '测试视频', recordId: '7',
    playCount: '1200', costAmount: '88.50', fansCount: '40', durationHours: '24',
    staleRecovered: true,
  }
  const node = PromotionModal({ modal, saving: false, t, onConfirm: () => {}, onClose: () => {} })
  const collectText = (cur, acc = []) => {
    // 字符串/数字先收集（原始值不是 object，必须放在 object 守卫之前）。
    if (cur === null || cur === undefined) return acc
    if (typeof cur !== 'object') { acc.push(String(cur)); return acc }
    if (Array.isArray(cur)) return cur.reduce((all, item) => collectText(item, acc), acc)
    if (cur.children !== undefined) acc.push(...collectText(cur.children))
    return acc
  }
  const statusText = collectText(node).join('')
  assert.ok(statusText.includes(t('promotionStaleNotice')), '重挂载后的新实例首帧即渲染「已转为更新」中性提示')
  // 对照：无标记时不渲染提示（普通新增/更新路径不出现）。
  const plain = PromotionModal({ modal: { ...modal, staleRecovered: undefined }, saving: false, t, onConfirm: () => {}, onClose: () => {} })
  const plainText = collectText(plain).join('')
  assert.ok(!plainText.includes(t('promotionStaleNotice')), '无 staleRecovered 标记不渲染提示')
})
