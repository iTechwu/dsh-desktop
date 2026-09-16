// parseToolResult 回归：tools 服务端把错误 envelope 同时写进 content 文本与
// structuredContent（mcp/core/errors.py `tool_error`），三条路径都必须拦截。
// 历史缺陷：只检查 content 文本路径，structuredContent.error 被当成功返回，
// ACCOUNT_NOT_FOUND 因此静默丢失，空 run 被持久化成 runId: null 的脏状态。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ToolsCallError, extractJsonEnvelope, parseToolResult, safeErrorCode, sessionIdempotencyKey, toWireArgs } from '../src/tools-client.js'

const envelope = (code, message = 'business error') => ({ error: { code, message } })

test('structuredContent 携带错误 envelope：必须抛 ToolsCallError 且透出白名单错误码', () => {
  // 服务端真实形态：isError 缺省（宿主 dsh-mcp-client 只在 isError===true 时抛错），
  // 错误同时存在于 structuredContent 与 content 文本。
  const result = {
    content: [{ type: 'text', text: JSON.stringify(envelope('ACCOUNT_NOT_FOUND', 'account not found')) }],
    structuredContent: envelope('ACCOUNT_NOT_FOUND', 'account not found'),
  }
  assert.throws(
    () => parseToolResult(result),
    error => error instanceof ToolsCallError && error.code === 'ACCOUNT_NOT_FOUND',
  )
})

test('isError=true 且 content 文本携带 envelope：解析出错误码', () => {
  const result = {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(envelope('RUN_STILL_ACTIVE')) }],
  }
  assert.throws(
    () => parseToolResult(result),
    error => error instanceof ToolsCallError && error.code === 'RUN_STILL_ACTIVE',
  )
})

test('isError=true 且文本不可解析：收敛为稳定兜底码，不透传原文', () => {
  const result = { isError: true, content: [{ type: 'text', text: 'gateway exploded' }] }
  assert.throws(
    () => parseToolResult(result),
    error => error instanceof ToolsCallError && error.code === 'douyin_operation_request_failed',
  )
})

test('content 文本携带 envelope 且无 structuredContent：同样拦截', () => {
  const result = { content: [{ type: 'text', text: JSON.stringify(envelope('UNAUTHORIZED')) }] }
  assert.throws(
    () => parseToolResult(result),
    error => error instanceof ToolsCallError && error.code === 'UNAUTHORIZED',
  )
})

test('白名单外的错误码收敛为 unknown 兜底码', () => {
  const result = { structuredContent: envelope('SOME_NEW_SERVER_CODE') }
  assert.throws(
    () => parseToolResult(result),
    error => error instanceof ToolsCallError && error.code === 'douyin_operation_request_failed',
  )
})

test('成功结果：structuredContent 原样返回；回退 content 文本 JSON；再回退原对象', () => {
  assert.deepEqual(parseToolResult({ structuredContent: { run: { run_id: 'r1' } } }), { run: { run_id: 'r1' } })
  assert.deepEqual(parseToolResult({ content: [{ type: 'text', text: '{"works":[],"total":0}' }] }), { works: [], total: 0 })
  const passthrough = { status: 'ok' }
  assert.equal(parseToolResult(passthrough), passthrough)
  assert.deepEqual(parseToolResult({}), {})
  // 非错误 JSON 文本原样解析返回，不被误判成 envelope。
  assert.deepEqual(parseToolResult({ content: [{ type: 'text', text: 'not-json' }] }), {})
})

test('safeErrorCode 接受宿主抛出的 JSON 文本错误（dsh-mcp-client 形态）', () => {
  const thrown = new Error(JSON.stringify(envelope('ACCOUNT_NOT_FOUND')))
  assert.equal(safeErrorCode(thrown), 'ACCOUNT_NOT_FOUND')
  assert.equal(safeErrorCode(new Error('plain text failure')), 'douyin_operation_request_failed')
})

// ===== 宿主忠实语义回归（2026-09-11 Windows 实测缺陷） =====
//
// 真实宿主 dsh-tools 的两条行为，本地模拟此前都不忠实，导致「本地全绿、真机必挂」：
// 1) ToolRuntime 对所有 isError 结果统一输出 `Error: ${message}` 前缀文本
//    （toolErrorResult），业务 envelope 到插件手里不是纯 JSON；
// 2) 派发前 snapshotJsonValue 做无损 JSON 校验，undefined 值属性会让**整个调用**
//    在进程内被拒绝（网络层零痕迹），而服务端明明把这些字段声明为可选。

test('isError=true 且文本带宿主 `Error: ` 前缀：仍解析出业务错误码', () => {
  const result = {
    isError: true,
    content: [{ type: 'text', text: `Error: ${JSON.stringify(envelope('ACCOUNT_NOT_FOUND', 'account not found'))}` }],
  }
  assert.throws(
    () => parseToolResult(result),
    error => error instanceof ToolsCallError && error.code === 'ACCOUNT_NOT_FOUND',
  )
})

test('safeErrorCode 接受 `Error: ` 前缀包装的 envelope 文本', () => {
  const thrown = new Error(`Error: ${JSON.stringify(envelope('UNAUTHORIZED'))}`)
  assert.equal(safeErrorCode(thrown), 'UNAUTHORIZED')
})

test('extractJsonEnvelope：纯 JSON / 前缀包装 / 嵌入文案三种形态都能还原', () => {
  const raw = JSON.stringify(envelope('RUN_NOT_FOUND'))
  assert.deepEqual(extractJsonEnvelope(raw), envelope('RUN_NOT_FOUND'))
  assert.deepEqual(extractJsonEnvelope(`Error: ${raw}`), envelope('RUN_NOT_FOUND'))
  assert.deepEqual(extractJsonEnvelope(`tool bridge failed: ${raw} (request id=1)`), envelope('RUN_NOT_FOUND'))
  assert.equal(extractJsonEnvelope('no json here'), null)
  assert.equal(extractJsonEnvelope(undefined), null)
})

test('toWireArgs 深度剔除 undefined 属性与非有限数值（宿主 snapshot 校验的硬约束）', () => {
  const original = {
    accountId: 'acc-1',
    nickname: undefined,
    avatar: undefined,
    fanCount: Number.NaN,
    sessionRef: 'vault://douyin/acc-1',
    nested: { keep: 'v', drop: undefined, list: [{ a: 1 }, { b: undefined, c: null }] },
  }
  const wire = toWireArgs(original)
  assert.deepEqual(wire, {
    accountId: 'acc-1',
    sessionRef: 'vault://douyin/acc-1',
    nested: { keep: 'v', list: [{ a: 1 }, { c: null }] },
  })
  // 返回新对象，调用侧原始载荷不被篡改。
  assert.notEqual(wire, original)
  assert.deepEqual(Object.keys(original).sort(), ['accountId', 'avatar', 'fanCount', 'nested', 'nickname', 'sessionRef'])
})

test('toWireArgs 保留 null、false、0、空串等合法 JSON 值；-0 归一化为 0', () => {
  assert.deepEqual(
    toWireArgs({ a: null, b: false, c: 0, d: '', e: [], f: {} }),
    { a: null, b: false, c: 0, d: '', e: [], f: {} },
  )
  const negZero = toWireArgs({ rate: Math.trunc(-0.2) })
  assert.equal(1 / negZero.rate, Infinity, 'rate 必须是 +0（宿主 snapshot 拒绝 -0）')
  assert.equal(1 / toWireArgs([-0])[0], Infinity, '数组元素同样归一化')
})

// ===== session 幂等键：checkedAt 必须参与（2026-09-11 实测冲突） =====
//
// 服务端 mcp_mutations 收据永久保留；客户端重装/换机后 sessionSeq 从 1 重新计数，
// 同键不同载荷（checkedAt 必然不同）会被判 IDEMPOTENCY_CONFLICT，且残留的
// indeterminate 收据永不放行。键内纳入 checkedAt 后「同键 ⇒ 同载荷」。

test('sessionIdempotencyKey：同输入稳定（重试回放），新探测必得新键', () => {
  const checkedAt = '2026-09-11T05:56:43.740Z'
  assert.equal(sessionIdempotencyKey('acc-1', 1, checkedAt), sessionIdempotencyKey('acc-1', 1, checkedAt))
  assert.notEqual(
    sessionIdempotencyKey('acc-1', 1, checkedAt),
    sessionIdempotencyKey('acc-1', 1, '2026-09-11T06:00:00.000Z'),
    '本地重装后 seq 归 1：checkedAt 必须把键区分开',
  )
  assert.notEqual(sessionIdempotencyKey('acc-1', 1, checkedAt), sessionIdempotencyKey('acc-1', 2, checkedAt))
})

test('sessionIdempotencyKey：checkedAt 缺失时退化为确定性后缀而非随机值', () => {
  // 随机后缀会破坏重试幂等；确定性 'na' 保证同一次逻辑上报的重试仍同键。
  assert.equal(sessionIdempotencyKey('acc-1', 1, undefined), sessionIdempotencyKey('acc-1', 1, undefined))
  assert.ok(sessionIdempotencyKey('acc-1', 1, undefined).endsWith(':na'))
})
