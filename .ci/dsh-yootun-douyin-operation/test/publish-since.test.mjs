// 1117 方案（作品采集范围收敛）插件端回归：范围过滤、范围上报、部分成果与共用路径。
//
// 覆盖方案 §7.1 插件测试清单：
// 1. 2026-05-31 23:59:59 +08 不采集；2. 2026-06-01 00:00:00 +08 采集；
// 3. 混合新旧作品页只保留范围内作品；4. 6 月前作品不调用任何详情接口；
// 5. 6 月前作品不进入 ingest_batch；6. expectedWorkCount = 范围内作品数；
// 7. 全部作品均在范围外时不产生作品批次；8. publish_time 缺失 → listComplete=false；
// 9. 分页失败时仍 listComplete=false（过滤不破坏既有完整性语义）；
// 10. 会话中断只保留范围内部分成果，且仍以失败态收尾；
// 11. 单账号与批量采集共用同一过滤逻辑。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  MAX_EXPECTED_WORK_COUNT,
  WORK_PUBLISH_SINCE_ISO,
  WORK_PUBLISH_SINCE_REPORT,
  collectAccountWorks,
  filterWorksByPublishSince,
} from '../src/collector.js'
import { createIngestClient, ingestCollectedWorks } from '../src/ingest.js'
import { SessionInvalidError } from '../src/parse.js'
import { createBatchCollectController, createCollectController, finishExpiredSession, runAccountCollection } from '../src/runner.js'
import { paths } from '../src/state.js'

// 边界秒值：cutoff 与其前一秒（均为真实 Unix 秒，含 +08:00 显式偏移解析）。
const CUTOVER_SEC = Date.parse('2026-06-01T00:00:00+08:00') / 1000
const BEFORE_SEC = Date.parse('2026-05-31T23:59:59+08:00') / 1000

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'douyin-since-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function rawWork(id, createSec, overrides = {}) {
  return {
    aweme_id: id,
    desc: `作品 ${id}`,
    create_time: createSec,
    statistics: { play_count: 100, digg_count: 1, comment_count: 1, collect_count: 1, share_count: 1 },
    video: { duration: 30000, cover: { url_list: ['https://example.invalid/c.jpeg'] } },
    status: { is_private: false },
    ...overrides,
  }
}

/**
 * 精简 fake page：work_list 支持多页（按调用序返回）、可注入页级失败与会话失效；
 * 详情接口全部落到兜底空响应（缺口不阻塞）；记录 work-detail 的 goto 作品 ID。
 */
function fakePage({ pages, failPageNo = 0, listStatusCode = 0, profileAccountId = 'sec-1' } = {}) {
  const detailGoto = []
  const page = {
    async goto(url) {
      const m = url.match(/work-detail\/([^/?#]+)/)
      if (m) detailGoto.push(m[1])
      return { status: 200 }
    },
    on() {},
    off() {},
    async waitForTimeout() {},
    async evaluate(_fn, arg) {
      const url = typeof arg === 'string' ? arg : arg && arg.url
      const reply = value => ({ status: 200, text: JSON.stringify(value) })
      if (url.includes('work_list')) {
        const pageNo = page.workListCalls + 1
        page.workListCalls += 1
        if (listStatusCode !== 0) return reply({ status_code: listStatusCode, status_msg: '示例：用户未登录' })
        if (pageNo === failPageNo) return { status: 500, text: '' }
        const current = (pages || [])[pageNo - 1] || { works: [], hasMore: false, cursor: 1 }
        return reply({ status_code: 0, aweme_list: current.works, has_more: current.hasMore, max_cursor: current.cursor ?? 1 })
      }
      if (url.includes('user/info')) {
        return reply({ user: { sec_uid: profileAccountId, nickname: '示例账号', follower_count: 290 } })
      }
      // 其余接口（item_analysis 三连 / 详情直取 / dashboard 三连 / wordCloud）给
      // 最小空响应：解析为 null/空并记缺口，绝不阻塞作品载荷与结算。
      return reply({ status_code: 0 })
    },
  }
  page.workListCalls = 0
  return { page, detailGoto }
}

test('范围常量：上海语义 cutoff 与服务端受理字面量是同一时刻', () => {
  assert.equal(Date.parse(WORK_PUBLISH_SINCE_ISO), Date.parse(WORK_PUBLISH_SINCE_REPORT))
  assert.ok(WORK_PUBLISH_SINCE_ISO.includes('+08:00'))
})

test('过滤函数：边界前一秒不保留、恰为 cutoff 保留、缺失计数（§7.1-1/2/8）', () => {
  const works = [
    { work_id: 'a', publish_time: new Date(BEFORE_SEC * 1000).toISOString() },
    { work_id: 'b', publish_time: new Date(CUTOVER_SEC * 1000).toISOString() },
    { work_id: 'c', publish_time: null },
    { work_id: 'd', publish_time: undefined },
  ]
  const scoped = filterWorksByPublishSince(works)
  assert.deepEqual(scoped.works.map(work => work.work_id), ['b'])
  assert.equal(scoped.skippedBeforePublishSince, 1)
  assert.equal(scoped.publishTimeMissing, 2)
})

test('混合新旧作品页：只保留范围内作品，6 月前不进详情与 ingest（§7.1-1~6）', async () => {
  const { page, detailGoto } = fakePage({
    pages: [{ works: [rawWork('before-1', BEFORE_SEC), rawWork('at-1', CUTOVER_SEC)], hasMore: false, cursor: 1 }],
  })
  const result = await collectAccountWorks(page, { observedAt: '2026-11-17T00:00:00Z' })
  // §7.1-3/6：只保留范围内作品，expectedWorkCount = 范围内数量。
  assert.deepEqual(result.works.map(work => work.work_id), ['at-1'])
  assert.equal(result.expectedWorkCount, 1)
  assert.equal(result.skippedBeforePublishSince, 1)
  assert.equal(result.publishSince, WORK_PUBLISH_SINCE_REPORT)
  assert.equal(result.listComplete, true)
  // §7.1-4：6 月前作品不打开任何详情页。
  assert.ok(!detailGoto.includes('before-1'))
  assert.deepEqual(detailGoto, ['at-1'])
  // §7.1-5：入库载荷不含范围外作品（ingest_batch 输入即 result.works）。
  const batchInputIds = result.works.map(work => work.work_id)
  assert.ok(!batchInputIds.includes('before-1'))
})

test('全部作品均在范围外：不产生作品批次与详情调用（§7.1-7）', async () => {
  await withRoot(async root => {
    const { page, detailGoto } = fakePage({
      pages: [{ works: [rawWork('old-1', BEFORE_SEC), rawWork('old-2', BEFORE_SEC - 86400)], hasMore: false, cursor: 1 }],
    })
    const result = await collectAccountWorks(page, { observedAt: '2026-11-17T00:00:00Z' })
    assert.deepEqual(result.works, [])
    assert.equal(result.expectedWorkCount, 0)
    assert.equal(result.skippedBeforePublishSince, 2)
    assert.deepEqual(detailGoto, [])
    // ingest 层：0 作品不产生批次（ingestCollectedWorks 的空分支）。
    const calls = []
    const client = createIngestClient({
      callTool: async (name, args) => {
        calls.push({ name, args })
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-x', last_heartbeat_seq: 0 }, reused: false, reclaimedRunId: null }
        if (name === 'douyin_collect_run_set_list_meta') return { run: {} }
        if (name === 'douyin_collect_run_finish') return { run: { status: 'completed' }, settlement: {}, replayed: false }
        return {}
      },
      accountId: 'acc-1',
      root,
      sleep: async () => {},
    })
    const ingested = await ingestCollectedWorks({
      client,
      works: result.works,
      listComplete: result.listComplete,
      expectedWorkCount: result.expectedWorkCount,
      publishSince: result.publishSince,
      newAttempt: true,
    })
    assert.equal(ingested.error, null)
    assert.equal(calls.filter(call => call.name === 'douyin_collect_ingest_batch').length, 0)
    // 断言客户端上报的失败语义（finish.run.status 是服务端 mock 回显，不可作依据）。
    const finish = calls.find(call => call.name === 'douyin_collect_run_finish')
    assert.equal(finish.args.clientStatus, 'completed')
    assert.equal(finish.args.expectedWorkCount ?? finish.args.clientCounts?.expectedWorkCount, 0)
  })
})

test('publish_time 缺失：不入库且本轮 listComplete=false（§7.1-8）', async () => {
  const { page } = fakePage({
    pages: [{ works: [rawWork('at-1', CUTOVER_SEC), rawWork('no-time', null, { create_time: undefined })], hasMore: false, cursor: 1 }],
  })
  const result = await collectAccountWorks(page, { observedAt: '2026-11-17T00:00:00Z' })
  assert.deepEqual(result.works.map(work => work.work_id), ['at-1'])
  assert.equal(result.listComplete, false)
  assert.equal(result.listReason, 'publish_time_missing')
})

test('分页中途失败：范围内部分作品保留，listComplete 仍为 false（§7.1-9）', async () => {
  const { page } = fakePage({
    pages: [
      { works: [rawWork('at-1', CUTOVER_SEC), rawWork('before-1', BEFORE_SEC)], hasMore: true, cursor: 10 },
      { works: [], hasMore: false, cursor: 20 },
    ],
    failPageNo: 2,
  })
  const result = await collectAccountWorks(page, {
    observedAt: '2026-11-17T00:00:00Z',
    // 关闭页级重试退避（真实 sleep 会拖慢测试），一次失败即收敛 listComplete=false。
    workListOptions: { retries: 0 },
  })
  assert.deepEqual(result.works.map(work => work.work_id), ['at-1'])
  assert.equal(result.listComplete, false)
  assert.equal(result.expectedWorkCount, 1)
})

test('列表阶段即会话失效：无任何作品成果，不构造 partialCollected（复审 P2-9 改名）', async () => {
  const { page } = fakePage({
    pages: [
      { works: [rawWork('at-1', CUTOVER_SEC), rawWork('before-1', BEFORE_SEC)], hasMore: true, cursor: 10 },
    ],
    listStatusCode: 8,
  })
  await assert.rejects(
    () => collectAccountWorks(page, { observedAt: '2026-11-17T00:00:00Z' }),
    error => {
      assert.ok(error instanceof SessionInvalidError)
      // 列表首请求即过期：无任何作品成果，不构造 partialCollected。
      assert.equal(error.partialCollected, undefined)
      return true
    },
  )
})

test('会话中断：详情阶段过期时部分成果只含范围内作品（§7.1-10）', async () => {
  // 第一页正常（新旧混合），详情采集阶段 user/info 返回 status_code=8 → 会话失效。
  const { page } = fakePage({
    pages: [{ works: [rawWork('at-1', CUTOVER_SEC), rawWork('before-1', BEFORE_SEC)], hasMore: false, cursor: 1 }],
    profileAccountId: 'sec-1',
  })
  const originalEvaluate = page.evaluate.bind(page)
  page.evaluate = async (fn, arg) => {
    const url = typeof arg === 'string' ? arg : arg && arg.url
    if (url && url.includes('user/info')) {
      return { status: 200, text: JSON.stringify({ status_code: 8, status_msg: '示例：用户未登录' }) }
    }
    return originalEvaluate(fn, arg)
  }
  await assert.rejects(
    () => collectAccountWorks(page, { observedAt: '2026-11-17T00:00:00Z' }),
    error => {
      assert.ok(error instanceof SessionInvalidError)
      const partial = error.partialCollected
      assert.ok(partial && Array.isArray(partial.works))
      assert.deepEqual(partial.works.map(work => work.work_id), ['at-1'])
      assert.equal(partial.expectedWorkCount, 1)
      assert.equal(partial.publishSince, WORK_PUBLISH_SINCE_REPORT)
      return true
    },
  )
})

test('会话失效收尾：publishListMeta 带范围内声明且 listComplete=false（§7.1-10 runner 层）', async () => {
  await withRoot(async root => {
    const calls = []
    const callTool = async (name, args) => {
      calls.push({ name, args })
      if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-exp', last_heartbeat_seq: 0 }, reused: false, reclaimedRunId: null }
      if (name === 'douyin_collect_run_set_list_meta') return { run: {} }
      if (name === 'douyin_collect_ingest_batch') return { batch: { status: 'completed', succeeded_work_ids: args.works.map(work => work.work_id), failed_work_ids: [] }, replayed: false }
      if (name === 'douyin_collect_run_finish') return { run: { status: 'partial' }, settlement: {}, replayed: false }
      if (name === 'douyin_session_status_report') return { applied: true }
      return {}
    }
    const client = createIngestClient({ callTool, accountId: 'acc-1', root, sleep: async () => {} })
    const events = []
    const outcome = await finishExpiredSession({
      accountId: 'acc-1',
      callTool,
      client,
      collected: {
        works: [{ work_id: 'at-1', title: 'x', url: 'u', publish_time: new Date(CUTOVER_SEC * 1000).toISOString(), dataGap: null, is_private: false }],
        listComplete: false,
        expectedWorkCount: 1,
        publishSince: WORK_PUBLISH_SINCE_REPORT,
      },
      root,
      emit: event => events.push(event),
    })
    assert.equal(outcome.status, 'session_expired')
    assert.equal(outcome.publishSince, WORK_PUBLISH_SINCE_REPORT)
    const listMeta = calls.find(call => call.name === 'douyin_collect_run_set_list_meta')
    assert.ok(listMeta, '必须写入列表元信息')
    assert.equal(listMeta.args.publishSince, WORK_PUBLISH_SINCE_REPORT)
    assert.equal(listMeta.args.listComplete, false)
    assert.equal(listMeta.args.expectedWorkCount, 1)
    const finish = calls.find(call => call.name === 'douyin_collect_run_finish')
    assert.equal(finish.args.clientStatus, 'failed')
  })
})

test('publishListMeta 携带 publishSince 且恢复重发同值（幂等收据兼容）', async () => {
  await withRoot(async root => {
    const metaArgs = []
    let runSeq = 0
    const client = createIngestClient({
      callTool: async (name, args) => {
        if (name === 'douyin_collect_run_start') {
          runSeq += 1
          return { run: { run_id: `run-r${runSeq}`, last_heartbeat_seq: 0 }, reused: false, reclaimedRunId: null }
        }
        if (name === 'douyin_collect_run_set_list_meta') {
          metaArgs.push({ ...args })
          return { run: {} }
        }
        return {}
      },
      accountId: 'acc-1',
      root,
      sleep: async () => {},
    })
    await client.startRun({ newAttempt: true })
    await client.publishListMeta({ expectedWorkCount: 3, listComplete: true, publishSince: WORK_PUBLISH_SINCE_REPORT })
    // 模拟租约过期恢复：recoverRun 重建 run 并重发列表元信息，必须携带同值
    // （同键命中服务端幂等收据的前提，缺值会被 IDEMPOTENCY_CONFLICT 拒绝）。
    await client.recoverRun()
    assert.equal(metaArgs.length, 2)
    assert.equal(metaArgs[0].publishSince, WORK_PUBLISH_SINCE_REPORT)
    assert.equal(metaArgs[1].publishSince, WORK_PUBLISH_SINCE_REPORT)
    assert.equal(metaArgs[1].runId, 'run-r2')
  })
})

test('publishListMeta 缺省时 payload 不含 publishSince 键（复审 P2-1）', async () => {
  await withRoot(async root => {
    const metaArgs = []
    const client = createIngestClient({
      callTool: async (name, args) => {
        if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-p0', last_heartbeat_seq: 0 }, reused: false, reclaimedRunId: null }
        if (name === 'douyin_collect_run_set_list_meta') {
          metaArgs.push({ ...args })
          return { run: {} }
        }
        return {}
      },
      accountId: 'acc-1',
      root,
      sleep: async () => {},
    })
    await client.startRun({ newAttempt: true })
    // 旧语义调用形态（不带 publishSince）：payload 绝不能出现该键（哪怕 null），
    // 否则服务端 schema（非空字符串）或宿主 snapshot 校验会整调用拒绝。
    await client.publishListMeta({ expectedWorkCount: 1, listComplete: false })
    assert.equal(metaArgs.length, 1)
    assert.ok(!('publishSince' in metaArgs[0]), '缺省调用不得携带 publishSince 键')
  })
})

test('单账号与批量采集共用同一过滤路径（§7.1-11，投影透传面）', async () => {
  await withRoot(async () => {
    // runCollection 注入 mock：批量与单账号都经由 collect.start → runCollection；
    // 断言两者拿到同一 runCollection 结果投影（publishSince 字段存在即共用路径）。
    const runCollection = async () => ({
      status: 'ready',
      runId: 'run-shared',
      runStatus: 'completed',
      listComplete: true,
      expectedWorkCount: 1,
      publishSince: WORK_PUBLISH_SINCE_REPORT,
      skippedBeforePublishSince: 1,
      succeededWorkCount: 1,
      failedWorkCount: 0,
    })
    const collect = createCollectController({ runCollection })
    const single = await collect.start({ accountId: 'acc-a' })
    assert.equal(single.status, 'ready')
    const singleDone = await collect.wait('acc-a')
    assert.equal(singleDone.result.publishSince, WORK_PUBLISH_SINCE_REPORT)
    assert.equal(singleDone.result.skippedBeforePublishSince, 1)

    const batch = createBatchCollectController({ collect })
    const started = batch.start({
      accounts: [{ accountId: 'acc-b' }, { accountId: 'acc-c' }],
    })
    assert.equal(started.status, 'ready')
    const done = await batch.wait()
    assert.equal(done.status, 'completed')
    for (const item of done.items) {
      assert.equal(item.collect.result.publishSince, WORK_PUBLISH_SINCE_REPORT)
    }
  })
})

test('批量采集走真实采集链路：范围内过滤与范围声明贯通（§7.1-11 集成面，复审 P2-4）', async () => {
  await withRoot(async root => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    const storageStatePath = paths(root).storageStatePath('acc-batch')
    await writeFile(storageStatePath, '{"cookies":[],"origins":[]}')
    const calls = []
    const callTool = async (name, args) => {
      calls.push({ name, args })
      if (name === 'douyin_account_save') return { account: {} }
      if (name === 'douyin_collect_run_start') return { run: { run_id: 'run-b1', last_heartbeat_seq: 0 }, reused: false, reclaimedRunId: null }
      if (name === 'douyin_collect_run_set_list_meta') return { run: {} }
      if (name === 'douyin_collect_ingest_batch') return { batch: { status: 'completed', succeeded_work_ids: args.works.map(work => work.work_id), failed_work_ids: [] }, replayed: false }
      if (name === 'douyin_collect_run_finish') return { run: { status: 'completed' }, settlement: { notInListMarked: 0 }, replayed: false }
      if (name === 'douyin_account_list') return { accounts: [{ account_id: 'acc-batch', session_status: 'ok', session_seq: 0 }] }
      if (name === 'douyin_session_status_report') return { applied: true }
      return {}
    }
    const sessionFactory = async () => {
      const { page } = fakePage({
        pages: [{ works: [rawWork('before-9', BEFORE_SEC), rawWork('at-9', CUTOVER_SEC)], hasMore: false, cursor: 1 }],
      })
      return { browser: { close: async () => {} }, context: { newPage: async () => page, close: async () => {} } }
    }
    const collect = createCollectController({
      runCollection: options => runAccountCollection({
        ...options,
        callTool,
        sessionFactory,
        storageStatePath,
        saveAvatar: async () => ({ updated: false, reason: 'avatar_exists' }),
      }),
    })
    const batch = createBatchCollectController({ collect })
    const started = batch.start({ accounts: [{ accountId: 'acc-batch' }] })
    assert.equal(started.status, 'ready')
    const done = await batch.wait()
    assert.equal(done.status, 'completed')
    const item = done.items[0]
    assert.equal(item.collect.result.publishSince, WORK_PUBLISH_SINCE_REPORT)
    assert.equal(item.collect.result.skippedBeforePublishSince, 1)
    assert.equal(item.collect.result.expectedWorkCount, 1)
    // 入库载荷只含范围内作品。
    const ingests = calls.filter(call => call.name === 'douyin_collect_ingest_batch')
    assert.deepEqual(ingests.flatMap(call => call.args.works.map(work => work.work_id)), ['at-9'])
    const listMeta = calls.find(call => call.name === 'douyin_collect_run_set_list_meta')
    assert.ok(listMeta, '批量路径必须写入列表元信息')
    assert.equal(listMeta.args.publishSince, WORK_PUBLISH_SINCE_REPORT)
  })
})

test('游标不前进：范围内作品保留且 listComplete 仍为 false（§7.1-9，复审 P2-3）', async () => {
  const { page } = fakePage({
    pages: [
      { works: [rawWork('at-1', CUTOVER_SEC), rawWork('before-1', BEFORE_SEC)], hasMore: true, cursor: 10 },
      { works: [], hasMore: true, cursor: 10 },
    ],
  })
  const result = await collectAccountWorks(page, { observedAt: '2026-11-17T00:00:00Z' })
  assert.deepEqual(result.works.map(work => work.work_id), ['at-1'])
  assert.equal(result.listComplete, false)
  assert.equal(result.expectedWorkCount, 1)
})

test('列表超上限但范围内未超：不中止（MAX 检查后移的正例，复审 P2-5）', async () => {
  // 全量列表 10001 条（全部范围外）+ 1 条范围内：检查后移后不再被全量数量误杀。
  const outOfRange = Array.from({ length: MAX_EXPECTED_WORK_COUNT }, (_, index) => rawWork(`old-${index}`, BEFORE_SEC - index))
  const { page } = fakePage({
    pages: [{ works: [...outOfRange, rawWork('at-1', CUTOVER_SEC)], hasMore: false, cursor: 1 }],
  })
  const result = await collectAccountWorks(page, { observedAt: '2026-11-17T00:00:00Z' })
  assert.deepEqual(result.works.map(work => work.work_id), ['at-1'])
  assert.equal(result.expectedWorkCount, 1)
  assert.equal(result.skippedBeforePublishSince, MAX_EXPECTED_WORK_COUNT)
})
