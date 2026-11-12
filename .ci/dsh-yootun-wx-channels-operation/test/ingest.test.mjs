// 入库编排回归：run 状态机、切批投递、段落缺口、finish 段落状态与恢复（mock callTool）。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createIngestClient, ingestCollectedData, resolveClientStatus } from '../src/ingest.js'
import { ToolsCallError } from '../src/tools-client.js'

/** 内存态账号记录（state.js 注入替代）。 */
function memoryRoot() {
  const store = new Map()
  return { store }
}

// state.js 的 getAccount/updateAccount 直接走文件系统——ingest 通过 root 参数读取。
// 这里用模块注入替代：createIngestClient 不直接 import state（无）——它调用
// getAccount/updateAccount。为可测性，测试里 monkeypatch import 不可行（ESM），
// 改用真实临时目录。
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAccount, updateAccount } from '../src/state.js'

async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'wx-ingest-'))
}

function makeCallTool(log) {
  return async (name, args) => {
    log.push({ name, args })
    switch (name) {
      case 'wx_channels_collect_run_start':
        return { run: { run_id: args.runId, status: 'running', heartbeat_seq: 0 }, reused: false, reclaimedRunId: null }
      case 'wx_channels_collect_run_set_list_meta':
        return { run: { run_id: args.runId, list_complete: args.listComplete } }
      case 'wx_channels_collect_ingest_works':
        return {
          run: { run_id: args.runId },
          batch: {
            run_id: args.runId,
            batch_no: args.batchNo,
            batch_type: 'works',
            batch_status: 'succeeded',
            succeeded_objects: args.works.map(work => work.workId),
            failed_objects: [],
          },
          replayed: false,
        }
      case 'wx_channels_collect_ingest_account_metrics':
        return { run: { run_id: args.runId }, batch: { batch_no: 1, batch_status: 'succeeded', succeeded_objects: args.metrics.map(row => row.day) }, replayed: false }
      case 'wx_channels_collect_ingest_fans_trend':
        return { run: { run_id: args.runId }, batch: { batch_no: 2, batch_status: 'succeeded', succeeded_objects: args.daily.map(row => row.day) }, replayed: false }
      case 'wx_channels_collect_ingest_fans_profile':
        return { run: { run_id: args.runId }, batch: { batch_no: 3, batch_status: 'succeeded', succeeded_objects: [args.day] }, replayed: false }
      case 'wx_channels_collect_run_finish':
        return { run: { run_id: args.runId, status: 'completed' }, settlement: {}, replayed: false }
      default:
        throw new ToolsCallError(name, 'UNAUTHORIZED')
    }
  }
}

test('入库编排：start → list_meta → works 分批 → 账号级三类 → finish（段落状态全 completed）', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-1', {}, root)
  const client = createIngestClient({ callTool: makeCallTool(log), accountId: 'acc-1', root })
  const works = Array.from({ length: 45 }, (_, index) => ({
    workId: `w${index}`,
    publishTime: '2026-11-08T10:00:00+08:00',
    dailyMetrics: [{ day: '2026-11-08', daily_play_count: 1 }],
  }))
  const result = await ingestCollectedData({
    client,
    works,
    listComplete: true,
    expectedWorkCount: 45,
    accountLevel: {
      accountMetrics: { startDay: '2026-11-08', endDay: '2026-11-09', rows: [{ day: '2026-11-08', daily_play_count: 10 }] },
      fansTrend: { startDay: '2026-11-08', endDay: '2026-11-09', daily: [{ day: '2026-11-08', follower_net_count: 1 }] },
      fansProfile: { day: '2026-11-08', gender: [{ key: 'male', label: '男', count: 1 }] },
    },
  })
  assert.equal(result.error, null)
  assert.equal(result.finish.run.status, 'completed')
  // 切批：45 作品 × 1 行 → 20/批 → 3 批。
  const worksCalls = log.filter(entry => entry.name === 'wx_channels_collect_ingest_works')
  assert.equal(worksCalls.length, 3)
  assert.deepEqual(worksCalls.map(entry => entry.args.batchNo), [1, 2, 3])
  // finish 携带嵌套 clientCounts 与段落状态（§16.3）。
  const finishCall = log.find(entry => entry.name === 'wx_channels_collect_run_finish')
  assert.deepEqual(finishCall.args.clientCounts, { expectedWorkCount: 45, succeededWorkCount: 45, failedWorkCount: 0 })
  assert.equal(finishCall.args.accountMetricStatus, 'completed')
  assert.equal(finishCall.args.fansTrendStatus, 'completed')
  assert.equal(finishCall.args.fansProfileStatus, 'completed')
})

test('账号级失败：段落记 failed，不影响作品链路 clientStatus（§8.4 隔离）', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-2', {}, root)
  const base = makeCallTool(log)
  const callTool = async (name, args) => {
    if (name === 'wx_channels_collect_ingest_fans_trend') throw new ToolsCallError(name, 'RUN_NOT_RUNNING')
    return base(name, args)
  }
  const client = createIngestClient({ callTool, accountId: 'acc-2', root })
  const result = await ingestCollectedData({
    client,
    works: [{ workId: 'w1', publishTime: null, dailyMetrics: [] }],
    listComplete: true,
    expectedWorkCount: 1,
    accountLevel: {
      accountMetrics: null,
      fansTrend: { startDay: '2026-11-08', endDay: '2026-11-09', daily: [{ day: '2026-11-08' }] },
      fansProfile: null,
    },
  })
  assert.equal(result.error, null)
  const finishCall = log.find(entry => entry.name === 'wx_channels_collect_run_finish')
  assert.equal(finishCall.args.fansTrendStatus, 'failed')
  assert.equal(finishCall.args.accountMetricStatus, 'not_collected')
})

test('fans_trend 回填分块上报：35 行乱序 → 30+5 两块（按 day 排序切窗）', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-1', {}, root)
  const client = createIngestClient({ callTool: makeCallTool(log), accountId: 'acc-1', root })
  // 乱序构造 35 天日行（2026-10-01 起），验证按 day 排序后 30+5 切块与块窗口。
  const days = Array.from({ length: 35 }, (_, index) => {
    const d = new Date(Date.UTC(2026, 9, 1) + index * 86400_000)
    return d.toISOString().slice(0, 10)
  })
  const shuffled = [...days].reverse()
  const result = await ingestCollectedData({
    client,
    works: [{ workId: 'w1', publishTime: null, dailyMetrics: [] }],
    listComplete: true,
    expectedWorkCount: 1,
    accountLevel: {
      accountMetrics: null,
      fansTrend: { startDay: days[0], endDay: days[34], daily: shuffled.map(day => ({ day, follower_net_count: 1 })) },
      fansProfile: null,
    },
  })
  assert.equal(result.error, null)
  const trendCalls = log.filter(entry => entry.name === 'wx_channels_collect_ingest_fans_trend')
  assert.equal(trendCalls.length, 2)
  assert.equal(trendCalls[0].args.startDay, days[0])
  assert.equal(trendCalls[0].args.endDay, days[29])
  assert.equal(trendCalls[0].args.daily.length, 30)
  assert.equal(trendCalls[1].args.startDay, days[30])
  assert.equal(trendCalls[1].args.endDay, days[34])
  assert.equal(trendCalls[1].args.daily.length, 5)
  const finishCall = log.find(entry => entry.name === 'wx_channels_collect_run_finish')
  assert.equal(finishCall.args.fansTrendStatus, 'completed')
})

test('fans_trend 分块部分失败：失败块记 gap，后续块继续上报，状态 failed', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-2', {}, root)
  const base = makeCallTool(log)
  let trendCalls = 0
  const callTool = async (name, args) => {
    if (name === 'wx_channels_collect_ingest_fans_trend') {
      trendCalls += 1
      // 确定性错误不经 withRetry 重试/恢复，模拟「该块真实失败」。
      if (trendCalls === 1) throw new ToolsCallError(name, 'INVALID_IDEMPOTENCY_KEY')
    }
    return base(name, args)
  }
  const client = createIngestClient({ callTool, accountId: 'acc-2', root })
  const days = Array.from({ length: 35 }, (_, index) => {
    const d = new Date(Date.UTC(2026, 9, 1) + index * 86400_000)
    return d.toISOString().slice(0, 10)
  })
  const result = await ingestCollectedData({
    client,
    works: [{ workId: 'w1', publishTime: null, dailyMetrics: [] }],
    listComplete: true,
    expectedWorkCount: 1,
    accountLevel: {
      accountMetrics: null,
      fansTrend: { startDay: days[0], endDay: days[34], daily: days.map(day => ({ day })) },
      fansProfile: null,
    },
  })
  assert.equal(result.error, null)
  // 失败块在 stub 记录前抛出（不进 log）；成功进 log 的只有第二块。
  const trendCallsLog = log.filter(entry => entry.name === 'wx_channels_collect_ingest_fans_trend')
  assert.equal(trendCallsLog.length, 1)
  assert.equal(trendCallsLog[0].args.startDay, days[30])
  assert.equal(trendCallsLog[0].args.endDay, days[34])
  const finishCall = log.find(entry => entry.name === 'wx_channels_collect_run_finish')
  assert.equal(finishCall.args.fansTrendStatus, 'failed')
})

test('RUN_NOT_RUNNING 恢复：重建 run 并重发 list_meta 后续采', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-3', {}, root)
  const base = makeCallTool(log)
  let recovering = false
  const callTool = async (name, args) => {
    if (name === 'wx_channels_collect_ingest_works' && !recovering && args.batchNo === 1) {
      recovering = true
      throw new ToolsCallError(name, 'RUN_NOT_RUNNING')
    }
    return base(name, args)
  }
  const client = createIngestClient({ callTool, accountId: 'acc-3', root })
  const result = await ingestCollectedData({
    client,
    works: [{ workId: 'w1', publishTime: null, dailyMetrics: [] }],
    listComplete: true,
    expectedWorkCount: 1,
  })
  assert.equal(result.error, null)
  const starts = log.filter(entry => entry.name === 'wx_channels_collect_run_start')
  assert.ok(starts.length >= 2) // 初始 + 恢复
  const metas = log.filter(entry => entry.name === 'wx_channels_collect_run_set_list_meta')
  assert.ok(metas.length >= 2) // 恢复后重发列表元信息
})

test('确定性错误不重试：PAYLOAD_TOO_LARGE 直接失败该批并继续下一批', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-4', {}, root)
  const base = makeCallTool(log)
  const callTool = async (name, args) => {
    if (name === 'wx_channels_collect_ingest_works' && args.batchNo === 1) {
      throw new ToolsCallError(name, 'PAYLOAD_TOO_LARGE')
    }
    return base(name, args)
  }
  const client = createIngestClient({ callTool, accountId: 'acc-4', root })
  await client.startRun({ newAttempt: true })
  const works = Array.from({ length: 40 }, (_, index) => ({ workId: `w${index}`, publishTime: null, dailyMetrics: [] }))
  const ingest = await client.ingestAll(works)
  const attempts = log.filter(entry => entry.name === 'wx_channels_collect_ingest_works')
  // batch1 抛错不进 mock base 的 log（确定性错误零重试）；batch2 正常调用一次。
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].args.batchNo, 2)
  // 传输失败批次在服务端没有账本行：客户端不得把它计入 failed，否则 finish 的
  // clientCounts 与账本不一致 → RUN_COUNT_MISMATCH → run 永远卡 running（P1-4）。
  assert.equal(ingest.failedWorkIds.length, 0)
  assert.equal(ingest.succeededWorkIds.length, 20)
  assert.equal(ingest.batches.find(entry => entry.batchNo === 1).status, 'failed')
})

test('resolveClientStatus：列表不完整 → partial；全失败 → failed', () => {
  assert.equal(resolveClientStatus({ listComplete: false, expected: 3, ingest: { succeededWorkIds: ['a'], failedWorkIds: [] } }), 'partial')
  assert.equal(resolveClientStatus({ listComplete: true, expected: 2, ingest: { succeededWorkIds: [], failedWorkIds: ['a', 'b'] } }), 'failed')
  assert.equal(resolveClientStatus({ listComplete: true, expected: 2, ingest: { succeededWorkIds: ['a'], failedWorkIds: [] } }), 'partial')
  assert.equal(resolveClientStatus({ listComplete: true, expected: 0, ingest: { succeededWorkIds: [], failedWorkIds: [] } }), 'completed')
})


test('失败对象批次：同 batchNo 换 :retry{n} 键重投，重投后全成功（P1-3）', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-retry', {}, root)
  const base = makeCallTool(log)
  let workCalls = 0
  const callTool = async (name, args) => {
    if (name !== 'wx_channels_collect_ingest_works') return base(name, args)
    workCalls += 1
    const result = await base(name, args)
    if (workCalls === 1) {
      // 首投：模拟服务端单作品失败（账本行带 failed_objects）。
      return { ...result, batch: { ...result.batch, succeeded_objects: ['w0'], failed_objects: ['w1'] } }
    }
    return result
  }
  const client = createIngestClient({ callTool, accountId: 'acc-retry', root })
  await client.startRun({ newAttempt: true })
  const ingest = await client.ingestAll([
    { workId: 'w0', publishTime: null, dailyMetrics: [] },
    { workId: 'w1', publishTime: null, dailyMetrics: [] },
  ])
  const workLog = log.filter(entry => entry.name === 'wx_channels_collect_ingest_works')
  assert.equal(workLog.length, 2, '应恰好重投一次')
  assert.equal(workLog[0].args.batchNo, 1)
  assert.equal(workLog[1].args.batchNo, 1, '重投必须复用同一 batchNo')
  assert.match(workLog[1].args.idempotencyKey, /:retry1$/)
  // 重投也必须带 observedCount，否则该批次审计行 observed_count 记 0（审查 P3-31 补）。
  assert.equal(workLog[1].args.observedCount, 2)
  assert.deepEqual(ingest.failedWorkIds, [])
  assert.equal(ingest.succeededWorkIds.length, 2)
})

test('异常兜底：编排抛错时调用 run_cancel，避免 run 停在 running（P2-14）', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-cancel', {}, root)
  const base = makeCallTool(log)
  const callTool = async (name, args) => {
    // finish 失败（如 RUN_COUNT_MISMATCH）会让编排抛出，是 run_cancel 兜底的典型路径。
    if (name === 'wx_channels_collect_run_finish') throw new ToolsCallError(name, 'RUN_COUNT_MISMATCH')
    return base(name, args)
  }
  const client = createIngestClient({ callTool, accountId: 'acc-cancel', root })
  await assert.rejects(
    () => ingestCollectedData({
      client,
      works: [{ workId: 'w0', publishTime: null, dailyMetrics: [] }],
      listComplete: true,
      expectedWorkCount: 1,
    }),
  )
  const cancels = log.filter(entry => entry.name === 'wx_channels_collect_run_cancel')
  assert.equal(cancels.length, 1, '异常路径应调用一次 run_cancel')
})

test('stableErrorCode：采集侧 `throw new Error(CODE)` 必须还原稳定码（P2-1）', async () => {
  const { stableErrorCode } = await import('../src/tools-client.js')
  assert.equal(stableErrorCode(new Error('TIME_SERIES_LENGTH_MISMATCH')), 'TIME_SERIES_LENGTH_MISMATCH')
  assert.equal(stableErrorCode(Object.assign(new Error('x'), { code: 'PAYLOAD_TOO_LARGE' })), 'PAYLOAD_TOO_LARGE')
  assert.equal(stableErrorCode(new Error('identity_check_failed:timeout')), 'identity_check_failed:timeout')
  assert.equal(stableErrorCode(new Error('disk full')), null)
  assert.equal(stableErrorCode(null), null)
})

test('账号级来源趋势与 trafficSource 随行入库（P2-2 / P2-28）', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-src', {}, root)
  const client = createIngestClient({ callTool: makeCallTool(log), accountId: 'acc-src', root })
  await client.startRun({ newAttempt: true })
  await client.ingestFansTrend({
    startDay: '2026-11-08',
    endDay: '2026-11-09',
    rows: [
      { day: '2026-11-08', follower_add_count: 1 },
      { day: '2026-11-09', follower_add_count: 2 },
    ],
    sourceTrend: { rows: [
      { sourceType: 20, sourceKey: 'homepage', name: '主页', daily: [{ day: '2026-11-09', add: 2 }] },
    ] },
  })
  const trendCall = log.find(entry => entry.name === 'wx_channels_collect_ingest_fans_trend')
  assert.deepEqual(trendCall.args.daily[1].sourceTrend, {
    rows: [{ sourceType: 20, sourceKey: 'homepage', name: '主页', add: 2 }],
  })
  assert.equal(trendCall.args.daily[0].sourceTrend, undefined, '无该日来源点位时不写')

  await client.ingestAccountMetrics({
    startDay: '2026-11-08',
    endDay: '2026-11-09',
    rows: [{ day: '2026-11-08', daily_play_count: 10 }, { day: '2026-11-09', daily_play_count: 20 }],
    trafficSource: { window: { startDay: '2026-11-08', endDay: '2026-11-09' }, rows: [{ sourceType: 4, playCount: 30 }] },
  })
  const metricCall = log.find(entry => entry.name === 'wx_channels_collect_ingest_account_metrics')
  assert.ok(metricCall.args.metrics.at(-1).trafficSource, '窗口聚合来源挂在末日行')
  assert.equal(metricCall.args.metrics[0].trafficSource, undefined, '其余日为 NULL')
})

test('nextSessionSeq 并发：同一 root 串行化，序号唯一且单调（P2-8）', async () => {
  const { nextSessionSeq, readAccounts } = await import('../src/state.js')
  const root = await tempRoot()
  const results = await Promise.all(
    Array.from({ length: 10 }, () => nextSessionSeq('acc-seq', root)),
  )
  const seqs = results.sort((a, b) => a - b)
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '并发分配不得重复或回退')
  const state = await readAccounts(root)
  assert.equal(state.accounts['acc-seq'].sessionSeq, 10)
})

test('ingestAll：批次载荷带 observedCount（§16.4，P3-37）', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-obs', {}, root)
  const client = createIngestClient({ callTool: makeCallTool(log), accountId: 'acc-obs', root })
  await client.startRun({ newAttempt: true })
  await client.ingestAll([{ workId: 'w0', publishTime: null, dailyMetrics: [] }], { observedCount: 50 })
  const call = log.find(entry => entry.name === 'wx_channels_collect_ingest_works')
  assert.equal(call.args.observedCount, 50, 'observedCount 必须随批次上报')
})

test('幂等键模板断言：与 tools 服务端 constants.py 一一对应（§16.3）', async () => {
  const {
    ingestWorksIdempotencyKey,
    runStartIdempotencyKey,
    listMetaIdempotencyKey,
    sessionIdempotencyKey,
    ingestAccountMetricsIdempotencyKey,
    ingestFansTrendIdempotencyKey,
    accountSaveIdempotencyKey,
  } = await import('../src/tools-client.js')
  assert.equal(ingestWorksIdempotencyKey('run-1', 3), 'wx_channels:ingest_works:run-1:3')
  assert.equal(runStartIdempotencyKey('run-1'), 'wx_channels:run_start:run-1')
  assert.equal(listMetaIdempotencyKey('run-1'), 'wx_channels:run_meta:run-1')
  assert.equal(sessionIdempotencyKey('acc-1', 7), 'wx_channels:session:acc-1:7')
  assert.equal(
    ingestAccountMetricsIdempotencyKey('run-1', '2026-11-08', '2026-11-09'),
    'wx_channels:ingest_account_metrics:run-1:2026-11-08:2026-11-09',
  )
  assert.equal(
    ingestFansTrendIdempotencyKey('run-1', '2026-11-08', '2026-11-09'),
    'wx_channels:ingest_fans_trend:run-1:2026-11-08:2026-11-09',
  )
  assert.match(accountSaveIdempotencyKey('acc-1', 1700000000000), /^wx_channels:account_save:acc-1:\d+$/)
})

test('stableErrorCode：采集侧小写稳定码必须还原（P2-1）；非本域大写码不得透出（N7）', async () => {
  const { stableErrorCode, isKnownStableCode } = await import('../src/tools-client.js')
  // 采集侧真实抛出的小写码（此前只认全大写，全部退化成 error.name = "Error"）。
  for (const code of [
    'auth_data_http_401',
    'aggregate_http_500',
    'account_metrics_http_403',
    'fans_trend_http_502',
    'fans_portrait_http_500',
    'post_list_err_1001',
    'run_not_started',
    'aggregate_request_failed',
    'fans_trend_window_loop_guard',
    'planFansTrendWindow_endDay_required',
    'invalid_day:2026-13-01',
    'http_404',
  ]) {
    assert.equal(stableErrorCode(new Error(code)), code, `${code} 必须被识别为稳定码`)
  }
  // 白名单外的文本（含无关大写 message）不得当成稳定码透出。
  for (const text of ['SOME_OTHER_MODULE_ERROR', 'Random failure text', 'disk full']) {
    assert.equal(isKnownStableCode(text), false, `${text} 不是本域稳定码`)
    assert.equal(stableErrorCode(new Error(text)), null)
  }
  assert.equal(stableErrorCode(new Error('identity_check_failed:timeout')), 'identity_check_failed:timeout')
  assert.equal(stableErrorCode(null), null)
})

test('bumpSessionSeq：定序与 patch 同一次 RMW，序号单调且 patch 不得回退（P2-8）', async () => {
  const { bumpSessionSeq, readAccounts } = await import('../src/state.js')
  const root = await tempRoot()
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) => bumpSessionSeq(
      'acc-bump',
      { sessionStatus: index % 2 ? 'ok' : 'expired' },
      { root },
    )),
  )
  const seqs = results.map(item => item.seq).sort((a, b) => a - b)
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '并发定序不得重复或回退')
  const state = await readAccounts(root)
  assert.equal(state.accounts['acc-bump'].sessionSeq, 10)

  // patch 里夹带的 sessionSeq 必须被忽略（旧实现的回退根因）。
  const { seq, record } = await bumpSessionSeq('acc-bump', { sessionSeq: 3, nickname: 'N' }, { root })
  assert.equal(seq, 11)
  assert.equal(record.sessionSeq, 11)
  assert.equal(record.nickname, 'N')
})

test('bumpSessionSeq：floor 对齐远端下限（另一设备已推高 seq）', async () => {
  const { bumpSessionSeq } = await import('../src/state.js')
  const root = await tempRoot()
  const { seq } = await bumpSessionSeq('acc-floor', {}, { floor: 42, root })
  assert.equal(seq, 43)
})

test('clearLocalCredentials：删除一个账号不得回滚其它账号的并发更新（P2-8）', async () => {
  const { clearLocalCredentials, readAccounts, updateAccount } = await import('../src/state.js')
  const root = await tempRoot()
  await updateAccount('acc-keep', { nickname: 'keep-1' }, root)
  await updateAccount('acc-drop', { nickname: 'drop' }, root)
  await Promise.all([
    clearLocalCredentials('acc-drop', root),
    updateAccount('acc-keep', { nickname: 'keep-2' }, root),
  ])
  const state = await readAccounts(root)
  assert.equal(state.accounts['acc-drop'], undefined)
  assert.equal(state.accounts['acc-keep'].nickname, 'keep-2', '其它账号的更新不得被覆盖')
})

test('moveStorageState：源缺失不得删除目标登录态（P3-24 原子迁移）', async () => {
  const { existsSync } = await import('node:fs')
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { moveStorageState, paths } = await import('../src/state.js')
  const root = await tempRoot()
  await mkdir(paths(root).storageStateDir, { recursive: true })
  const target = paths(root).storageStatePath('acc-target')
  await writeFile(target, '{"cookies":[]}', 'utf8')
  await moveStorageState('acc-missing', 'acc-target', root)
  assert.ok(existsSync(target), '源不存在时目标登录态必须保留（旧实现先 rm 再 rename 会丢掉）')
})

test('ingestCollectedData：列表元信息失败必须取消 run，不留 running（N5）', async () => {
  const events = []
  const client = {
    setProgress() {},
    async startRun() { return { run: { run_id: 'run-n5' } } },
    async publishListMeta() { throw new Error('RUN_LIST_META_REQUIRED') },
    async cancel() { events.push('cancel') },
  }
  const result = await ingestCollectedData({
    client,
    works: [],
    listComplete: true,
    expectedWorkCount: 0,
    onProgress: event => events.push(event.phase),
  })
  assert.equal(result.error, 'RUN_LIST_META_REQUIRED', '稳定码必须保留')
  assert.ok(events.includes('cancel'), '失败分支必须先取消 run')
})


test('finish 的 RUN_COUNT_MISMATCH 是确定性拒绝：只调用一次、不退避重试（P2-18 补）', async () => {
  const log = []
  const root = await tempRoot()
  await updateAccount('acc-deterministic', {}, root)
  const base = makeCallTool(log)
  let finishCalls = 0
  const callTool = async (name, args) => {
    if (name === 'wx_channels_collect_run_finish') {
      finishCalls += 1
      throw new ToolsCallError(name, 'RUN_COUNT_MISMATCH')
    }
    return base(name, args)
  }
  const client = createIngestClient({ callTool, accountId: 'acc-deterministic', root })
  await client.startRun({ newAttempt: true })
  await assert.rejects(
    () => client.finish({ clientStatus: 'completed', clientCounts: {} }),
    /RUN_COUNT_MISMATCH/,
  )
  assert.equal(finishCalls, 1, '确定性拒绝不得重试（此前会退避 4 次）')
})
