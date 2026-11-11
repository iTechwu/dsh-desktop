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

test('fans_trend 全量回填分块上报：35 行乱序 → 30+5 两块（按 day 排序切窗）', async () => {
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
  assert.equal(ingest.failedWorkIds.length, 20)
  assert.equal(ingest.succeededWorkIds.length, 20)
})

test('resolveClientStatus：列表不完整 → partial；全失败 → failed', () => {
  assert.equal(resolveClientStatus({ listComplete: false, expected: 3, ingest: { succeededWorkIds: ['a'], failedWorkIds: [] } }), 'partial')
  assert.equal(resolveClientStatus({ listComplete: true, expected: 2, ingest: { succeededWorkIds: [], failedWorkIds: ['a', 'b'] } }), 'failed')
  assert.equal(resolveClientStatus({ listComplete: true, expected: 2, ingest: { succeededWorkIds: ['a'], failedWorkIds: [] } }), 'partial')
  assert.equal(resolveClientStatus({ listComplete: true, expected: 0, ingest: { succeededWorkIds: [], failedWorkIds: [] } }), 'completed')
})
