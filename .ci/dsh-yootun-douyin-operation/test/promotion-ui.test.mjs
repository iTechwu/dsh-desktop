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
})

test('PromotionModal：预填服务端值、四个 number input 属性（§6.9.1/§6.9.3）', async () => {
  const { moduleExports, t } = await loadBundle()
  const PromotionModal = moduleExports.PromotionModal
  const modal = {
    accountId: 'a1', workId: 'w1', workTitle: '测试视频', recordId: '7',
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
  assert.equal(inputs.length, 5, '只读视频名 + 4 个 number input')
  assert.equal(inputs[0].props.readOnly, true, '视频名只读')
  assert.equal(inputs[0].props.value, '测试视频')
  const numbers = inputs.slice(1)
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
