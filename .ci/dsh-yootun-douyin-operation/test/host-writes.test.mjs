// 负责人与投流 Host action 行为级测试（RQ-2026-009 §5.1，审查 P2-5）：
// handler 直调 + mock ctx.tools，断言入参清洗、参数透传形状、错误码透传与
// 总览导出参数收敛（审查 P0-2 宿主侧）。源码契约断言见 owner-ui/promotion-ui/
// overview-owner-filter 测试。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  handleAccountOwnerSet,
  handleOverviewExport,
  handleWorkPromotionSave,
} from '../index.js'
import { safeErrorCode } from '../src/tools-client.js'

/** mock ctx：登记工具清单 + 记录 execute 调用并按脚本回放结果/异常。 */
function makeCtx({ result = {}, error = null } = {}) {
  const calls = []
  return {
    calls,
    ctx: {
      tools: {
        schemas: () => [
          { name: 'douyin_account_owner_set' },
          { name: 'douyin_work_promotion_save' },
          { name: 'douyin_overview_export' },
        ],
        execute: async ({ name, arguments: args }) => {
          calls.push({ name, args })
          if (error) throw error
          return result
        },
      },
    },
  }
}

const READY = { structuredContent: { ok: true } }
const OWNER_KEY = 'douyin:account_owner_set:11111111-1111-4111-8111-111111111111'
const PROMO_KEY = 'douyin:work_promotion_save:22222222-2222-4222-8222-222222222222'

// ---------------------------------------------------------------------------
// account.owner.set
// ---------------------------------------------------------------------------

test('account.owner.set：合法入参全量透传', async () => {
  const { ctx, calls } = makeCtx({ result: READY })
  const payload = await handleAccountOwnerSet({}, ctx, {
    accountId: 'acc-1', ownerName: '张三', idempotencyKey: OWNER_KEY,
  })
  assert.equal(payload.status, 'ready')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'douyin_account_owner_set')
  assert.deepEqual(calls[0].args, { accountId: 'acc-1', ownerName: '张三', idempotencyKey: OWNER_KEY })
})

test('account.owner.set：缺参/坏键模板逐一拒绝', async () => {
  const { ctx, calls } = makeCtx({ result: READY })
  assert.equal((await handleAccountOwnerSet({}, ctx, { ownerName: '张三', idempotencyKey: OWNER_KEY })).reason, 'account_id_required')
  assert.equal((await handleAccountOwnerSet({}, ctx, { accountId: 'acc-1', ownerName: '   ', idempotencyKey: OWNER_KEY })).reason, 'OWNER_NAME_REQUIRED')
  assert.equal((await handleAccountOwnerSet({}, ctx, { accountId: 'acc-1', ownerName: '张三' })).reason, 'idempotency_key_required')
  assert.equal((await handleAccountOwnerSet({}, ctx, { accountId: 'acc-1', ownerName: '张三', idempotencyKey: 'other:prefix' })).reason, 'INVALID_IDEMPOTENCY_KEY')
  assert.equal(calls.length, 0, 'Host 拒绝路径不触达 tools')
})

test('account.owner.set：超长 ownerName 显式 OWNER_NAME_INVALID，不静默截断（审查 P2-7）', async () => {
  const { ctx, calls } = makeCtx({ result: READY })
  const longName = '测'.repeat(129)
  assert.equal((await handleAccountOwnerSet({}, ctx, {
    accountId: 'acc-1', ownerName: longName, idempotencyKey: OWNER_KEY,
  })).reason, 'OWNER_NAME_INVALID')
  assert.equal(calls.length, 0, '超长入参在 Host 拒绝，不透传 tools')
  // 边界：128 字合法；带首尾空白的 128 字 trim 后合法。
  assert.equal((await handleAccountOwnerSet({}, ctx, {
    accountId: 'acc-1', ownerName: '测'.repeat(128), idempotencyKey: OWNER_KEY,
  })).status, 'ready')
  assert.equal((await handleAccountOwnerSet({}, ctx, {
    accountId: 'acc-1', ownerName: ` ${'测'.repeat(128)} `, idempotencyKey: OWNER_KEY,
  })).status, 'ready')
})

test('account.owner.set：tools 业务错误码经分发层 catch 透传', async () => {
  // handler 不内捕业务错误：callTool 抛 ToolsCallError，由 apply() 分发层
  // `catch + safeErrorCode` 收敛为 { status:'error', reason }——测试按同一语义断言。
  const failure = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'OWNER_NAME_INVALID', message: 'x' } }) }] }
  const { ctx } = makeCtx({ result: failure })
  await assert.rejects(
    () => handleAccountOwnerSet({}, ctx, { accountId: 'acc-1', ownerName: '张三', idempotencyKey: OWNER_KEY }),
    error => {
      assert.equal(safeErrorCode(error), 'OWNER_NAME_INVALID')
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// work.promotion.save
// ---------------------------------------------------------------------------

function promotionBody(overrides = {}) {
  return {
    accountId: 'acc-1', workId: 'w1', recordId: null,
    playCount: 1200, costAmount: '3200.01', fansCount: 40, durationHours: '36.5',
    idempotencyKey: PROMO_KEY,
    ...overrides,
  }
}

test('work.promotion.save：合法入参按 schema 形状透传', async () => {
  const { ctx, calls } = makeCtx({ result: READY })
  const payload = await handleWorkPromotionSave({}, ctx, promotionBody())
  assert.equal(payload.status, 'ready')
  assert.deepEqual(calls[0].args, {
    accountId: 'acc-1', workId: 'w1',
    playCount: 1200, costAmount: '3200.01', fansCount: 40, durationHours: '36.5',
    idempotencyKey: PROMO_KEY,
  }, 'recordId 为空不透传')
})

test('work.promotion.save：更新带 recordId；缺失与非法数值分键拒绝', async () => {
  const { ctx, calls } = makeCtx({ result: READY })
  await handleWorkPromotionSave({}, ctx, promotionBody({ recordId: '7' }))
  assert.equal(calls[0].args.recordId, 7, 'recordId 转整数透传')
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ playCount: '' }))).reason, 'PROMOTION_FIELD_REQUIRED')
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ fansCount: null }))).reason, 'PROMOTION_FIELD_REQUIRED')
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ playCount: 1.5 }))).reason, 'PROMOTION_VALUE_INVALID')
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ costAmount: '12.345' }))).reason, 'PROMOTION_VALUE_INVALID', '金额最多两位小数')
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ durationHours: '0' }))).reason, 'PROMOTION_VALUE_INVALID', '时长必须为正')
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ recordId: '0' }))).reason, 'PROMOTION_VALUE_INVALID')
  assert.equal(calls.length, 1, '拒绝路径不触达 tools')
})

test('work.promotion.save：量级上限（审查 P2-3）——超 DB 列精度上限就地拒绝', async () => {
  const { ctx, calls } = makeCtx({ result: READY })
  // 金额：NUMERIC(14,2) 上限 999999999999.99（整数 12 位）；13 位整数越界。
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ costAmount: '999999999999.99' }))).status, 'ready', '金额上限边界合法')
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ costAmount: '1000000000000' }))).reason, 'PROMOTION_VALUE_INVALID')
  // 时长：NUMERIC(8,2) 上限 999999.99。
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ durationHours: '999999.99' }))).status, 'ready', '时长上限边界合法')
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ durationHours: '1000000' }))).reason, 'PROMOTION_VALUE_INVALID')
  // 小数部分越界（整数部分更小但小数超出两位上限精度）。
  assert.equal((await handleWorkPromotionSave({}, ctx, promotionBody({ costAmount: '999999999999.991' }))).reason, 'PROMOTION_VALUE_INVALID', '三位小数先被格式拒绝')
  assert.ok(calls.every(call => call.name === 'douyin_work_promotion_save'))
})

// ---------------------------------------------------------------------------
// overview.export（审查 P0-2 宿主侧：按 douyin_overview_export schema 重建参数）
// ---------------------------------------------------------------------------

function exportResult() {
  return {
    structuredContent: {
      file_name: 'douyin-overview-export.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content_base64: 'aGVsbG8=', // 5 字节 → base64 8 字符（ceil(5/3)*4=8）
      content_bytes: 5,
      row_counts: null,
    },
  }
}

test('overview.export：schema 外参数安全丢弃（默认三态之一）', async () => {
  const { ctx, calls } = makeCtx({ result: exportResult() })
  const payload = await handleOverviewExport({}, ctx, {
    // 总览查询形态的完整参数：export 只接受四个字段，其余必须剥离而不是透传。
    sort: 'hot_count', ownerName: '张三', topN: 50, limit: 20, cursor: 'x', hotType: 'potential',
    publishFrom: '2026-10-01', publishTo: '2026-10-31',
  })
  assert.equal(payload.status, 'ready')
  assert.deepEqual(calls[0].args, { publishFrom: '2026-10-01', publishTo: '2026-10-31' }, '仅 schema 内字段透传')
})

test('overview.export：accountIds/ruleVersion 透传、超 200 账号拒绝', async () => {
  const { ctx, calls } = makeCtx({ result: exportResult() })
  await handleOverviewExport({}, ctx, { accountIds: ['a', 'b'], ruleVersion: 'hot-v1-potential' })
  assert.deepEqual(calls[0].args, { accountIds: ['a', 'b'], ruleVersion: 'hot-v1-potential' })
  const tooMany = await handleOverviewExport({}, ctx, {
    accountIds: Array.from({ length: 201 }, (_, i) => `acc-${i}`),
  })
  assert.equal(tooMany.reason, 'overview_too_many_accounts')
  assert.equal(calls.length, 1)
})

test('overview.export：tools 业务错误码映射', async () => {
  const envelope = code => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code, message: 'x' } } ) }] })
  assert.equal(
    (await handleOverviewExport({}, makeCtx({ result: envelope('DOUYIN_EXPORT_TOO_LARGE') }).ctx, {})).reason,
    'export_too_large',
  )
  assert.equal(
    (await handleOverviewExport({}, makeCtx({ result: envelope('ACCOUNT_NOT_ACCESSIBLE') }).ctx, {})).reason,
    'ACCOUNT_NOT_ACCESSIBLE',
  )
  assert.equal(
    (await handleOverviewExport({}, makeCtx({ result: envelope('OTHER_CODE') }).ctx, {})).reason,
    'export_failed',
  )
})
