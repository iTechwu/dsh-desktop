import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { handleYootunSupplyWatchRequest, YOOTUN_SUPPLY_WATCH_PATH } from '../src/yootun-supply-watch-route.ts'

function request(method: string, body?: string): any {
  const chunks = body === undefined ? [] : [Buffer.from(body)]
  return { method, headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield* chunks } }
}
function response() { const headers: Record<string, string | number> = {}; let raw = ''; return { statusCode: 0, headers, setHeader(name: string, value: string | number) { headers[name.toLowerCase()] = value }, end(value = '') { raw += value }, get status() { return this.statusCode }, body() { return raw ? JSON.parse(raw) : undefined } } as any }

describe('Yootun supply watch route', () => {
  it('persists a risk, queues review, and keeps confirmation explicit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-supply-')); const statePath = join(root, 'state.json'); const now = () => new Date('2026-09-01T02:00:00.000Z')
    const invalid = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'save_risk', title: '交付周期异常', supplierLabel: '供应商 A', category: '交付', severity: 'high', status: 'open', signal: '近三日交付延迟上升', recommendedAction: '复核备选供应商与库存', source: 'supply-chain', bankAccount: '6222000000000000' })), invalid, 'http://127.0.0.1:43120', { statePath, now }); expect(invalid.status).toBe(400)
    const saved = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'save_risk', title: '交付周期异常', supplierLabel: '供应商 A', category: '交付', severity: 'high', status: 'open', signal: '近三日交付延迟上升', recommendedAction: '复核备选供应商与库存', source: 'supply-chain', dueAt: '2026-09-01T08:00:00.000Z' })), saved, 'http://127.0.0.1:43120', { statePath, now }); expect(saved.status).toBe(200); expect(saved.body().dashboard).toMatchObject({ risks: 1, open: 1, dueToday: 1 }); const riskId = saved.body().risks[0].id
    const queued = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'queue_review', riskId, summary: '确认交付恢复计划与替代方案', idempotencyKey: 'supply-review-1' })), queued, 'http://127.0.0.1:43120', { statePath, now }); expect(queued.body().dashboard.pendingConfirmation).toBe(1); expect(queued.body().actions[0].status).toBe('awaiting_confirmation')
    const replay = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'queue_review', riskId, summary: '确认交付恢复计划与替代方案', idempotencyKey: 'supply-review-1' })), replay, 'http://127.0.0.1:43120', { statePath, now }); expect(replay.body().actions).toHaveLength(1)
    const confirmed = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'confirm_action', id: queued.body().actions[0].id })), confirmed, 'http://127.0.0.1:43120', { statePath, now }); expect(confirmed.body().actions[0].status).toBe('confirmed_pending_adapter'); expect(JSON.parse(await readFile(statePath, 'utf8')).risks[0]).not.toHaveProperty('bankAccount')
  })
  it('returns an explicit empty snapshot for corrupt state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-supply-corrupt-')); const statePath = join(root, 'state.json'); await import('node:fs/promises').then(fs => fs.writeFile(statePath, '{broken')); const result = response(); await handleYootunSupplyWatchRequest(request('GET'), result, 'http://127.0.0.1:43120', { statePath, now: () => new Date('2026-09-01T02:00:00.000Z') }); expect(result.status).toBe(200); expect(result.body()).toMatchObject({ dashboard: { risks: 0, pendingConfirmation: 0 }, risks: [], actions: [] }); expect(YOOTUN_SUPPLY_WATCH_PATH).toBe('/api/desktop/yootun/supply-watch')
  })
  it('executes only confirmed reviews through an injected adapter', async () => { const root = await mkdtemp(join(tmpdir(), 'yootun-supply-adapter-')); const statePath = join(root, 'state.json'); const now = () => new Date('2026-09-01T02:00:00.000Z'); const saved = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'save_risk', title: '交付周期异常', supplierLabel: '供应商 A', category: '交付', severity: 'high', status: 'open', signal: '延迟上升', recommendedAction: '复核替代方案', source: 'supply-chain' })), saved, 'http://127.0.0.1:43120', { statePath, now }); const riskId = saved.body().risks[0].id; const queued = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'queue_review', riskId, summary: '确认替代方案', idempotencyKey: 'supply-adapter-1' })), queued, 'http://127.0.0.1:43120', { statePath, now }); const actionId = queued.body().actions[0].id; const confirmed = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'confirm_action', id: actionId })), confirmed, 'http://127.0.0.1:43120', { statePath, now }); let calls = 0; const executed = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'execute_action', id: actionId })), executed, 'http://127.0.0.1:43120', { statePath, now, adapter: { async execute(input) { calls += 1; expect(input).toMatchObject({ actionId, riskId, idempotencyKey: 'supply-adapter-1', targetLabel: '供应商 A' }); return { status: 'succeeded', reasonCode: 'reviewed', remoteRef: 'ticket-9' } } } }); expect(executed.body().actions[0]).toMatchObject({ status: 'succeeded', adapterReceipt: { reasonCode: 'reviewed', remoteRef: 'ticket-9' } }); const replay = response(); await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'execute_action', id: actionId })), replay, 'http://127.0.0.1:43120', { statePath, now, adapter: { async execute() { calls += 1; return { status: 'failed', reasonCode: 'unexpected' } } } }); expect(replay.body().actions[0].status).toBe('succeeded'); expect(calls).toBe(1) })

  it('does not audit a terminal review replay as another execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-supply-replay-audit-'))
    const statePath = join(root, 'state.json')
    const now = () => new Date('2026-09-01T02:00:00.000Z')
    const call = async (payload: object, options: Record<string, unknown> = {}) => {
      const result = response()
      await handleYootunSupplyWatchRequest(request('POST', JSON.stringify(payload)), result, 'http://127.0.0.1:43120', { statePath, now, ...options })
      return result.body()
    }
    const risk = await call({ action: 'save_risk', title: '风险', supplierLabel: '供应商', category: '交付', severity: 'high', status: 'open', signal: '信号', recommendedAction: '复核', source: 'manual' })
    const queued = await call({ action: 'queue_review', riskId: risk.risks[0].id, summary: '复核', idempotencyKey: 'replay-audit' })
    const actionId = queued.actions[0].id
    await call({ action: 'confirm_action', id: actionId })
    const record = vi.fn(async () => ({ status: 'stored' as const, clientEventId: 'event-1' }))
    const options = { audit: { record }, adapter: { async execute() { return { status: 'succeeded' as const, reasonCode: 'reviewed' } } } }

    await call({ action: 'execute_action', id: actionId }, options)
    await call({ action: 'execute_action', id: actionId }, options)

    expect(record).toHaveBeenCalledTimes(1)
  })

  it('records structured supply writes and failed execution attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-supply-audit-'))
    const statePath = join(root, 'state.json')
    const now = () => new Date('2026-09-01T02:00:00.000Z')
    const record = vi.fn(async (_input: any): Promise<any> => ({ status: 'stored', clientEventId: 'event-1' }))
    const audit = { record }
    const created = response()
    await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'save_risk', title: '不得进入审计', supplierLabel: '敏感供应商', category: '交付', severity: 'high', status: 'open', signal: '不得进入审计的风险信号', recommendedAction: '不得进入审计的处置正文', source: 'supply-chain' })), created, 'http://127.0.0.1:43120', { statePath, now, audit })
    const riskId = created.body().risks[0].id
    await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'save_risk', id: riskId, title: '更新', supplierLabel: '供应商', category: '交付', severity: 'critical', status: 'monitoring', signal: '更新', recommendedAction: '更新', source: 'manual' })), response(), 'http://127.0.0.1:43120', { statePath, now, audit })
    const failed = response()
    await handleYootunSupplyWatchRequest(request('POST', JSON.stringify({ action: 'execute_action', id: 'missing-review' })), failed, 'http://127.0.0.1:43120', { statePath, now, audit })
    await handleYootunSupplyWatchRequest(request('GET'), response(), 'http://127.0.0.1:43120', { statePath, now, audit })

    expect(record).toHaveBeenCalledTimes(3)
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ actionCode: 'supply.risk.created', target: { type: 'supply_risk', id: riskId }, outcome: 'succeeded' }),
      expect.objectContaining({ actionCode: 'supply.risk.updated', target: { type: 'supply_risk', id: riskId }, outcome: 'succeeded' }),
      expect.objectContaining({ actionCode: 'supply.review.executed', target: { type: 'supply_review', id: 'missing-review' }, outcome: 'failed', errorCode: 'action_not_found' }),
    ])
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/敏感供应商|风险信号|处置正文/u)
  })

  it('classifies concurrent writes from the state serialized with each mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-supply-concurrent-'))
    const statePath = join(root, 'state.json')
    const now = () => new Date('2026-09-01T02:00:00.000Z')
    const record = vi.fn(async (_input: any): Promise<any> => ({ status: 'stored', clientEventId: 'event-1' }))
    const risk = (severity: 'high' | 'critical') => JSON.stringify({
      action: 'save_risk', id: 'concurrent-risk', title: '并发风险', supplierLabel: '供应商',
      category: '交付', severity, status: 'open', signal: '信号', recommendedAction: '复核', source: 'manual',
    })

    const invoke = (severity: 'high' | 'critical') => handleYootunSupplyWatchRequest(
      request('POST', risk(severity)), response(), 'http://127.0.0.1:43120', { statePath, now, audit: { record } },
    )
    await Promise.all([invoke('high'), invoke('critical')])

    expect(record.mock.calls.map(([event]) => event.actionCode).sort()).toEqual([
      'supply.risk.created',
      'supply.risk.updated',
    ])
  })
})
