// 分批入库与失败恢复回归（设备端编排；用契约级假服务端模拟 tools 语义）。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createIngestClient, ingestCollectedWorks,resolveClientStatus } from '../src/ingest.js'
import { getAccount } from '../src/state.js'

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'douyin-ingest-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

class ToolError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

/**
 * 契约级假服务端：
 * - run_start 复用未过期 running run / 回收过期 run；
 * - 账本按 (runId, batchNo) 去重，重投返回既有结果且不重复计数；
 * - list meta 未写入时拒绝结算；
 * - 可注入瞬时失败与确定性失败。
 */
function fakeServer({
  accountId = 'acc-1',
  failBatchTimes = 0,
  failBatches = [],
  deterministicBatchErrors = {},
  runningError = null,
  failListMeta = null,
  worksPerBatchFailure = {},
} = {}) {
  const state = {
    runs: new Map(),
    ledger: new Map(),
    listMeta: new Map(),
    calls: [],
    currentRunId: null,
    batchAttempts: new Map(),
    runStartCount: 0,
  }

  function startRun() {
    state.runStartCount += 1
    if (runningError && state.runStartCount === 1) {
      // 模拟"已有未过期 running run 被复用"
      return { run: state.runs.get(state.currentRunId), reused: true, reclaimedRunId: null }
    }
    const runId = `run-${state.runStartCount}`
    const run = { run_id: runId, account_id: accountId, status: 'running', expected_work_count: null, list_complete: null, ingested_work_count: 0, last_heartbeat_seq: 0 }
    state.runs.set(runId, run)
    state.currentRunId = runId
    return { run, reused: false, reclaimedRunId: null }
  }

  return {
    state,
    async call(name, args) {
      state.calls.push({ name, args })
      const run = state.runs.get(args.runId)
      switch (name) {
        case 'douyin_collect_run_start':
          return startRun()
        case 'douyin_collect_run_set_list_meta': {
          if (failListMeta) throw new ToolError(failListMeta)
          if (!run || run.status !== 'running') throw new ToolError('RUN_NOT_RUNNING')
          run.expected_work_count = args.expectedWorkCount
          run.list_complete = args.listComplete
          state.listMeta.set(run.runId, { ...args })
          return { run: { ...run } }
        }
        case 'douyin_collect_run_heartbeat': {
          if (!run || run.status !== 'running') throw new ToolError('RUN_NOT_RUNNING')
          if (args.heartbeatSeq < run.last_heartbeat_seq) throw new ToolError('HEARTBEAT_SEQ_REGRESSED')
          if (args.heartbeatSeq > run.last_heartbeat_seq) run.last_heartbeat_seq = args.heartbeatSeq
          return { run: { ...run }, applied: true }
        }
        case 'douyin_collect_ingest_batch': {
          if (!run || run.status !== 'running') throw new ToolError('RUN_NOT_RUNNING')
          if (run.account_id !== args.accountId) throw new ToolError('RUN_ACCOUNT_MISMATCH')
          const attempt = (state.batchAttempts.get(args.batchNo) || 0) + 1
          state.batchAttempts.set(args.batchNo, attempt)
          if (failBatches.includes(args.batchNo) || attempt <= failBatchTimes) {
            throw new ToolError('douyin_operation_request_failed')
          }
          if (deterministicBatchErrors[args.batchNo]) throw new ToolError(deterministicBatchErrors[args.batchNo])
          const ledgerKey = `${args.runId}:${args.batchNo}`
          if (state.ledger.has(ledgerKey)) return { run: { ...run }, batch: state.ledger.get(ledgerKey), replayed: true }
          const failedIds = new Set(worksPerBatchFailure[args.batchNo] || [])
          const succeeded = args.works.map(work => work.work_id).filter(id => !failedIds.has(id))
          const failed = [...failedIds]
          const status = failed.length === 0 ? 'completed' : succeeded.length === 0 ? 'failed' : 'partial'
          const batch = { batch_no: args.batchNo, status, succeeded_work_ids: succeeded, failed_work_ids: failed }
          state.ledger.set(ledgerKey, batch)
          run.ingested_work_count = new Set([...state.ledger.entries()].filter(([key]) => key.startsWith(`${args.runId}:`)).flatMap(([, value]) => value.succeeded_work_ids)).size
          return { run: { ...run }, batch, replayed: false }
        }
        case 'douyin_collect_run_finish': {
          if (!run) throw new ToolError('RUN_NOT_FOUND')
          if (run.status !== 'running') {
            return { run: { ...run }, settlement: { succeeded_work_count: run.ingested_work_count }, replayed: true, clientStatusIgnored: true }
          }
          if (run.list_complete === null || run.list_complete === undefined) throw new ToolError('RUN_LIST_META_REQUIRED')
          const succeeded = new Set([...state.ledger.entries()].filter(([key]) => key.startsWith(`${args.runId}:`)).flatMap(([, value]) => value.succeeded_work_ids)).size
          const failedBatches = [...state.ledger.entries()].filter(([key, value]) => key.startsWith(`${args.runId}:`) && value.status === 'failed').length
          const expected = run.expected_work_count || 0
          run.status = run.list_complete && failedBatches === 0 && succeeded === expected ? 'completed'
            : expected > 0 && succeeded === 0 ? 'failed' : 'partial'
          return { run: { ...run }, settlement: { succeeded_work_count: succeeded, failed_batch_count: failedBatches, not_in_list_marked: 0, list_complete: run.list_complete }, replayed: false, clientStatusIgnored: args.clientStatus !== undefined }
        }
        case 'douyin_collect_run_cancel': {
          if (!run) throw new ToolError('RUN_NOT_FOUND')
          const replayed = run.status !== 'running'
          run.status = replayed ? run.status : 'cancelled'
          return { run: { ...run }, replayed }
        }
        default:
          throw new ToolError('DOUYIN_TOOL_UNAVAILABLE')
      }
    },
  }
}

const works = count => Array.from({ length: count }, (_, index) => ({ work_id: `w${index + 1}` }))

function makeClient(server, root, options = {}) {
  return createIngestClient({
    callTool: (name, args) => server.call(name, args),
    accountId: 'acc-1',
    root,
    sleep: async () => {},
    ...options,
  })
}

test('完整流程：run_start → list_meta → 分批入库 → finish（幂等键符合模板）', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const client = makeClient(server, root, { batchSize: 2 })
    const events = []
    const result = await ingestCollectedWorks({
      client,
      works: works(5),
      listComplete: true,
      expectedWorkCount: 5,
      newAttempt: true,
      onProgress: event => events.push(event),
    })
    assert.equal(result.error, null)
    assert.equal(result.finish.run.status, 'completed')
    assert.equal(result.ingest.batches.length, 3)
    assert.equal(result.ingest.succeededWorkIds.length, 5)

    const names = server.state.calls.map(call => call.name)
    assert.deepEqual(names.filter(name => name === 'douyin_collect_ingest_batch').length, 3)
    const keyPatterns = server.state.calls.map(call => call.args.idempotencyKey)
    assert.match(keyPatterns[0], /^douyin:run_start:[0-9a-f-]{36}$/)
    assert.match(keyPatterns[1], /^douyin:list_meta:run-1$/)
    assert.match(keyPatterns[2], /^douyin:ingest:run-1:1$/)
    assert.match(keyPatterns[5], /^douyin:run_finish:run-1$/)
    assert.ok(events.some(event => event.phase === 'batch_done' && event.status === 'completed'))
  })
})

test('runAttemptId：同一"用户点击"内复用，新点击重新生成；重启后仍复用', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const first = makeClient(server, root)
    await first.startRun({ newAttempt: true })
    const persisted = (await getAccount('acc-1', root)).runAttemptId
    assert.ok(persisted)

    // 进程恢复：新实例 + newAttempt=false → 复用同一 UUID
    const recovered = makeClient(server, root)
    await recovered.startRun({ newAttempt: false })
    assert.equal((await getAccount('acc-1', root)).runAttemptId, persisted)

    // 用户再次点击采集 → 必须生成新 UUID（避免幂等层返回历史终态）
    await recovered.startRun({ newAttempt: true })
    assert.notEqual((await getAccount('acc-1', root)).runAttemptId, persisted)
  })
})

test('重复投递相同 batch：服务端账本去重，不重复计数', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const client = makeClient(server, root, { batchSize: 50 })
    await client.startRun({ newAttempt: true })
    await client.publishListMeta({ expectedWorkCount: 2, listComplete: true })
    const batch = works(2)
    const first = await client.ingestAll(batch)
    const second = await client.ingestAll(batch)
    assert.deepEqual(first.succeededWorkIds.sort(), ['w1', 'w2'])
    assert.deepEqual(second.succeededWorkIds.sort(), ['w1', 'w2'])
    assert.equal(second.batches[0].replayed, true)
    assert.equal([...server.state.ledger.values()].length, 1, '同一 (runId, batchNo) 只有一条账本')
  })
})

test('批内单作品失败：其余作品照常入库，失败作品单独记录', async () => {
  await withRoot(async root => {
    const server = fakeServer({ worksPerBatchFailure: { 1: ['w2'] } })
    const client = makeClient(server, root, { batchSize: 3 })
    await client.startRun({ newAttempt: true })
    await client.publishListMeta({ expectedWorkCount: 3, listComplete: true })
    const ingest = await client.ingestAll(works(3))
    assert.deepEqual(ingest.succeededWorkIds.sort(), ['w1', 'w3'])
    assert.deepEqual(ingest.failedWorkIds, ['w2'])
    assert.equal(ingest.batches[0].status, 'partial')
    const finish = await client.finish({ clientStatus: 'completed' })
    assert.equal(finish.run.status, 'partial', '有失败作品时服务端不判 completed')
  })
})

test('run/account 不匹配属确定性错误：不重试，直接失败', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const originalCall = server.call.bind(server)
    let batchCalls = 0
    server.call = async (name, args) => {
      if (name === 'douyin_collect_ingest_batch') {
        batchCalls += 1
        throw new ToolError('RUN_ACCOUNT_MISMATCH')
      }
      return originalCall(name, args)
    }
    server.batchCalls = () => batchCalls
    const client = makeClient(server, root, { batchSize: 2, retries: 3 })
    await client.startRun({ newAttempt: true })
    await client.publishListMeta({ expectedWorkCount: 2, listComplete: true })
    const ingest = await client.ingestAll(works(2))
    assert.deepEqual(ingest.failedWorkIds.sort(), ['w1', 'w2'])
    assert.equal(ingest.batches[0].error, 'RUN_ACCOUNT_MISMATCH')
    assert.equal(server.batchCalls(), 1, '确定性错误不重试')
  })
})

test('heartbeat 序号回退：确定性错误不重试', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const client = makeClient(server, root)
    await client.startRun({ newAttempt: true })
    await client.heartbeat()
    await client.heartbeat()
    assert.equal((await getAccount('acc-1', root)).heartbeatSeq, 2)
    // 模拟本地序号落后于服务端
    server.state.runs.get(client.runId).last_heartbeat_seq = 99
    await assert.rejects(() => client.heartbeat(), error => error.code === 'HEARTBEAT_SEQ_REGRESSED')
  })
})

test('租约过期/运行被回收：自动重建 run 并重发列表元信息后继续入库', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const client = makeClient(server, root, { batchSize: 2, retries: 2 })
    await client.startRun({ newAttempt: true })
    await client.publishListMeta({ expectedWorkCount: 4, listComplete: true })
    // 第一批后运行被回收（租约过期）
    let expired = false
    const originalCall = server.call.bind(server)
    server.call = async (name, args) => {
      if (name === 'douyin_collect_ingest_batch' && !expired && args.batchNo === 2) {
        expired = true
        server.state.runs.get(args.runId).status = 'failed' // 服务端已回收
      }
      return originalCall(name, args)
    }
    const ingest = await client.ingestAll(works(4))
    assert.equal(expired, true)
    assert.equal(server.state.runStartCount, 2, '回收后新建 run')
    assert.equal(ingest.runId, 'run-2')
    assert.equal(ingest.succeededWorkIds.length, 4)
    const metaCalls = server.state.calls.filter(call => call.name === 'douyin_collect_run_set_list_meta')
    assert.equal(metaCalls.length, 2, '重建后必须重发列表元信息')
  })
})

test('空账号：只建运行 + 写列表元信息 + 结算，服务端判 completed', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const client = makeClient(server, root)
    const result = await ingestCollectedWorks({ client, works: [], listComplete: true, expectedWorkCount: 0 })
    assert.equal(result.finish.run.status, 'completed')
    assert.equal(server.state.calls.filter(call => call.name === 'douyin_collect_ingest_batch').length, 0)
  })
})

test('列表元信息写入失败：流程终止且不结算', async () => {
  await withRoot(async root => {
    const server = fakeServer({ failListMeta: 'VALIDATION_ERROR' })
    const client = makeClient(server, root)
    const result = await ingestCollectedWorks({ client, works: works(1), listComplete: true, expectedWorkCount: 1 })
    assert.equal(result.error, 'VALIDATION_ERROR')
    assert.equal(result.finish, null)
    assert.equal(server.state.calls.some(call => call.name === 'douyin_collect_run_finish'), false)
  })
})

test('list_complete=false：客户端上报 partial，绝不冒报 completed', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const client = makeClient(server, root)
    const result = await ingestCollectedWorks({ client, works: works(2), listComplete: false, expectedWorkCount: 25 })
    assert.equal(result.finish.run.status, 'partial')
    const finishCall = server.state.calls.find(call => call.name === 'douyin_collect_run_finish')
    assert.equal(finishCall.args.clientStatus, 'partial')
    assert.equal(finishCall.args.clientCounts.expectedWorkCount, 25)
    assert.equal(result.finish.settlement.not_in_list_marked, 0, '列表不完整不做缺失标记')
  })
})

test('run_finish 重复调用：返回既有终态（replayed）', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const client = makeClient(server, root)
    await client.startRun({ newAttempt: true })
    await client.publishListMeta({ expectedWorkCount: 1, listComplete: true })
    await client.ingestAll(works(1))
    const first = await client.finish({ clientStatus: 'completed' })
    const second = await client.finish({ clientStatus: 'failed' })
    assert.equal(first.run.status, 'completed')
    assert.equal(second.replayed, true)
    assert.equal(second.run.status, 'completed', '终态不可被改写')
  })
})

test('批次瞬时失败：指数退避重试后成功', async () => {
  await withRoot(async root => {
    const server = fakeServer({ failBatchTimes: 2 })
    const delays = []
    const client = createIngestClient({
      callTool: (name, args) => server.call(name, args),
      accountId: 'acc-1',
      root,
      batchSize: 50,
      retries: 3,
      sleep: async ms => { delays.push(ms) },
    })
    await client.startRun({ newAttempt: true })
    await client.publishListMeta({ expectedWorkCount: 1, listComplete: true })
    const ingest = await client.ingestAll(works(1))
    assert.deepEqual(ingest.succeededWorkIds, ['w1'])
    assert.deepEqual(delays, [500, 1000], '指数退避')
  })
})

test('批次持续失败：重试耗尽后记入失败，不中断其余批次', async () => {
  await withRoot(async root => {
    const server = fakeServer({ failBatches: [1] })
    const client = makeClient(server, root, { batchSize: 1, retries: 1 })
    await client.startRun({ newAttempt: true })
    await client.publishListMeta({ expectedWorkCount: 2, listComplete: true })
    const ingest = await client.ingestAll(works(2))
    assert.equal(ingest.batches[0].status, 'failed')
    assert.deepEqual(ingest.batches[1].status, 'completed')
    assert.deepEqual(ingest.failedWorkIds, ['w1'])
    assert.deepEqual(ingest.succeededWorkIds, ['w2'])
  })
})

test('batchSize 越界拒绝', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    assert.throws(() => createIngestClient({ callTool: server.call, accountId: 'acc-1', root, batchSize: 51 }), /batch_size_out_of_range/)
    assert.throws(() => createIngestClient({ callTool: server.call, accountId: 'acc-1', root, batchSize: 0 }), /batch_size_out_of_range/)
  })
})

test('取消：幂等终止后可重新开始新运行', async () => {
  await withRoot(async root => {
    const server = fakeServer()
    const client = makeClient(server, root)
    await client.startRun({ newAttempt: true })
    const cancelled = await client.cancel()
    assert.equal(cancelled.run.status, 'cancelled')
    assert.equal((await client.cancel()).replayed, true)
    const restarted = await client.startRun({ newAttempt: true })
    assert.equal(restarted.run.status, 'running')
    assert.notEqual(restarted.run.run_id, cancelled.run.run_id)
  })
})

test('resolveClientStatus：仅完整且成功数等于预期才上报 completed', () => {
  assert.equal(resolveClientStatus({ listComplete: true, expected: 2, ingest: { succeededWorkIds: ['a', 'b'], failedWorkIds: [] } }), 'completed')
  assert.equal(resolveClientStatus({ listComplete: false, expected: 2, ingest: { succeededWorkIds: ['a', 'b'] } }), 'partial')
  assert.equal(resolveClientStatus({ listComplete: true, expected: 3, ingest: { succeededWorkIds: ['a'] } }), 'partial')
  assert.equal(resolveClientStatus({ listComplete: true, expected: 2, ingest: { succeededWorkIds: [] } }), 'failed')
})
