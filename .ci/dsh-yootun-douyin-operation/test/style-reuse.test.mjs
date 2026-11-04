// 样式复用契约测试（RQ-2026-009 §6.10）：负责人/投流弹框与新增展示区块只复用
// 既有类，不新增 CSS 选择器、不写内联样式；本轮唯一允许的样式 diff 是总览排行
// 表轨道加一列（精确值见 overview-owner-column 测试）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const clientSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const overviewSource = await readFile(new URL('../src/overview-ui.js', import.meta.url), 'utf8')
const analysisSource = await readFile(new URL('../src/analysis-ui.js', import.meta.url), 'utf8')
const materialSource = await readFile(new URL('../src/material-ui.js', import.meta.url), 'utf8')

// 本轮新代码允许复用的既有类（素材看板弹框 ydo-mat-* + 通用文本/按钮/指标卡 + 总览表
// + 2026-11-04 UI 优化新增的通用类：加粗 hint / 侧栏标题行 / 详情投流操作区）。
const ALLOWED = new Set([
  'ydo-mat-modal-overlay', 'ydo-mat-modal', 'ydo-mat-form', 'ydo-mat-field',
  'ydo-mat-error', 'ydo-mat-modal-actions', 'ydo-mat-secondary', 'ydo-mat-primary',
  'ydo-hint', 'ydo-tag', 'ydo-secondary',
  'ydo-an-metrics', 'ydo-modal-core-metrics', 'ydo-an-metric-card',
  'ydo-an-metric-label', 'ydo-an-metric-value', 'ydo-modal-sec-title',
  'ydo-panel', 'ydo-modal-panel-full', 'ydo-ov-filter',
  'ydo-hint-strong', 'ydo-side-head', 'ydo-detail-promo-actions',
  'ydo-promo-pill',
])

// 行级提取：只检查本轮新增/修改行（新增代码按整行插入），避免既有区块噪音。
const classNamesInLines = (source, keywords) => source.split('\n')
  .filter(line => keywords.some(keyword => line.includes(keyword)))
  .flatMap(line => [...line.matchAll(/className:\s*'([\w- ]+)'/g)]
    .flatMap(match => match[1].split(' ')))

test('本轮新增行只复用既有类，无内联样式（§6.10）', () => {
  const checks = [
    ['client.js 负责人弹框', clientSource, ['function OwnerModal', 'OWNER_ERROR_COPY', 'ydo-owner-modal-title']],
    ['client.js 投流弹框', clientSource, ['function PromotionModal', 'PROMOTION_ERROR_COPY', 'ydo-promotion-modal-title', 'numericField']],
    ['client.js 投流入口/卡片/保存', clientSource, ['openPromotionModal', 'promotionMetrics', 'promotionBadge', 'secPromotion', 'saveWorkPromotion', 'saveAccountOwner']],
    ['overview-ui.js 负责人筛选/列', overviewSource, ['ownerOptions', 'ownerName', 'colOwner', 'overviewOwnerFilter']],
    ['analysis-ui.js 负责人行', analysisSource, ['accountOwnerLabel']],
  ]
  for (const [name, source, keywords] of checks) {
    const unknown = [...new Set(classNamesInLines(source, keywords))].filter(name => !ALLOWED.has(name))
    assert.deepEqual(unknown, [], `${name} 出现白名单外的 className`)
    for (const line of source.split('\n').filter(line => keywords.some(keyword => line.includes(keyword)))) {
      assert.ok(!/\bstyle:\s*[`'"{]/.test(line), `${name} 无内联 style`)
    }
  }
})

test('CSS 不新增负责人/投流专属选择器；UI 优化通用类已登记（§6.10 + 2026-11-04 UI 优化）', () => {
  const allCss = `${clientSource}${materialSource}`
  // 不新增任何以负责人/投流功能命名的样式选择器（弹框 aria id 如
  // ydo-owner-modal-title 不挂钩样式，不在禁止之列）；2026-11-04 UI 优化的
  // ydo-side-head / ydo-hint-strong / ydo-detail-promo-actions 为通用布局类，
  // 已登记 ALLOWED，不属此禁止范围。
  for (const banned of ['.ydo-owner', '.ydo-promotion', '.owner-modal', '.promotion-modal', '.ydo-ov-owner']) {
    assert.ok(!allCss.includes(banned), `CSS 不新增选择器 ${banned}`)
  }
  // UI 优化新类必须在共享样式表定义（复用主题变量，不写死颜色、深色自适应）。
  for (const added of ['ydo-side-head', 'ydo-hint-strong', 'ydo-detail-promo-actions']) {
    assert.ok(clientSource.includes(`.${added}{`), `.${added} 在共享 CSS 中已定义`)
  }
  // 已投流 pill 与爆款 pill 同款（红底白字写死色值是爆款样式语义，2026-11-04 用户确认）。
  assert.ok(clientSource.includes('.ydo-promo-pill{'), '.ydo-promo-pill 在共享 CSS 中已定义')
  const pillHot = clientSource.match(/\.ydo-promo-pill\{[^}]*\}/u)
  assert.ok(pillHot && pillHot[0].includes('#d83931') && pillHot[0].includes('border-radius:999px'), '已投流 pill 与爆款样式同源（红底白字圆角）')
  // 既有弹框/指标卡类已在 CSS 定义（复用素材看板与指标卡样式，不依赖运行时新注入）。
  for (const reused of ['ydo-mat-modal-overlay', 'ydo-mat-field', 'ydo-mat-primary']) {
    assert.ok(materialSource.includes(`.${reused}`), `.${reused} 在素材看板既有 CSS 中已定义`)
  }
  for (const reused of ['ydo-an-metrics', 'ydo-modal-core-metrics', 'ydo-an-metric-card']) {
    assert.ok(clientSource.includes(`.${reused}`), `.${reused} 在既有 CSS 中已定义`)
  }
  // 唯一允许的样式 diff：排行轨道 9 列 + 紧随其后的是未改动的爆款轨道（证明轨道外无插入）。
  assert.match(clientSource, /repeat\(6,minmax\(72px,\.35fr\)\)\}\/\* RQ-2026-009：\+账号负责人列（§6\.4，唯一允许的样式 diff） \*\/\.ydo-ov-tr-hot\{grid-template-columns:minmax\(220px,2fr\)/u)
})
