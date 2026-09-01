import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  handleYootunSalesRequest,
  YOOTUN_SALES_PATH,
} from '../src/yootun-sales-route.ts'

function request(method: string, body?: string): any {
  const chunks = body === undefined ? [] : [Buffer.from(body)]
  return {
    method,
    headers: {
      host: '127.0.0.1:43120',
      origin: 'http://127.0.0.1:43120',
      'content-type': 'application/json',
      'content-length': body === undefined ? undefined : String(Buffer.byteLength(body)),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { yield* chunks },
  }
}

function response() {
  const headers: Record<string, string | number> = {}
  let raw = ''
  return {
    statusCode: 0,
    headers,
    setHeader(name: string, value: string | number) { headers[name.toLowerCase()] = value },
    end(value = '') { raw += value },
    get status() { return this.statusCode },
    body() { return raw ? JSON.parse(raw) : undefined },
  } as any
}

describe('Yootun sales workspace route', () => {
  it('persists a sanitized lead and queues a human-confirmed follow-up', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-sales-'))
    const statePath = join(root, 'state.json')
    const now = () => new Date('2026-09-01T02:00:00.000Z')
    const save = response()
    await handleYootunSalesRequest(request('POST', JSON.stringify({
      action: 'save_lead', company: '优惠豚', contactLabel: '采购负责人', stage: 'qualified',
      source: 'lead-discovery', nextActionAt: '2026-09-02T02:00:00.000Z',
      note: '关注企业智能化方案', phone: '13800000000',
    })), save, 'http://127.0.0.1:43120', { statePath, now })
    expect(save.status).toBe(200)
    expect(save.body().leads[0]).not.toHaveProperty('phone')
    expect(save.body().leads[0]).toMatchObject({ company: '优惠豚', stage: 'qualified' })

    const leadId = save.body().leads[0].id
    const queued = response()
    const idempotencyKey = 'sales-follow-up-1'
    await handleYootunSalesRequest(request('POST', JSON.stringify({
      action: 'queue_follow_up', leadId, channel: 'email', summary: '发送方案摘要并约 30 分钟沟通', idempotencyKey,
    })), queued, 'http://127.0.0.1:43120', { statePath, now })
    expect(queued.status).toBe(200)
    expect(queued.body().dashboard.pendingConfirmation).toBe(1)
    expect(queued.body().actions[0].status).toBe('awaiting_confirmation')
    const replay = response()
    await handleYootunSalesRequest(request('POST', JSON.stringify({
      action: 'queue_follow_up', leadId, channel: 'email', summary: '发送方案摘要并约 30 分钟沟通', idempotencyKey,
    })), replay, 'http://127.0.0.1:43120', { statePath, now })
    expect(replay.body().actions).toHaveLength(1)
    const conflict = response()
    await handleYootunSalesRequest(request('POST', JSON.stringify({
      action: 'queue_follow_up', leadId, channel: 'phone', summary: '改用电话沟通', idempotencyKey,
    })), conflict, 'http://127.0.0.1:43120', { statePath, now })
    expect(conflict.status).toBe(400)
    expect(conflict.body().error).toBe('idempotency_key_conflict')

    const confirmed = response()
    await handleYootunSalesRequest(request('POST', JSON.stringify({
      action: 'confirm_action', id: queued.body().actions[0].id,
    })), confirmed, 'http://127.0.0.1:43120', { statePath, now })
    expect(confirmed.body().actions[0].status).toBe('confirmed_pending_adapter')
    expect(JSON.parse(await readFile(statePath, 'utf8')).leads[0]).not.toHaveProperty('phone')
  })

  it('returns an empty, explicit snapshot when the state file is corrupt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-sales-corrupt-'))
    const statePath = join(root, 'state.json')
    await import('node:fs/promises').then(fs => fs.writeFile(statePath, '{broken'))
    const result = response()
    await handleYootunSalesRequest(request('GET'), result, 'http://127.0.0.1:43120', {
      statePath, now: () => new Date('2026-09-01T02:00:00.000Z'),
    })
    expect(result.status).toBe(200)
    expect(result.body()).toMatchObject({ dashboard: { leads: 0, pendingConfirmation: 0 }, leads: [], actions: [] })
    expect(YOOTUN_SALES_PATH).toBe('/api/desktop/yootun/sales')
  })

  it('runs natural-language intent discovery through the managed Tools runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-sales-intent-'))
    const result = response()
    const calls: Array<{ name: string, arguments: unknown }> = []
    await handleYootunSalesRequest(request('POST', JSON.stringify({
      action: 'intent_search', query: '找最近一周长沙地区对新能源汽车改装感兴趣的公开讨论',
    })), result, 'http://127.0.0.1:43120', {
      statePath: join(root, 'state.json'),
      now: () => new Date('2026-09-01T02:00:00.000Z'),
      tools: {
        schemas: () => [{ name: 'mcp__tools-lead-discovery__search', description: 'lead discovery' }],
        async execute(input: any): Promise<any> {
          calls.push(input)
          return { structuredContent: { items: [{ platform: 'community', sourceUrl: 'https://example.invalid/post?phone=13800000000', observedAt: '2026-08-31T12:00:00+08:00', intentLevel: 'high', confidence: 0.82, evidence: [{ quote: '想了解改装方案，联系 13800000000', publishedAt: '2026-08-31T11:00:00+08:00' }], phone: '13800000000' }] } }
        },
      },
    })
    expect(result.status).toBe(200)
    expect(result.body().intent.status).toBe('ready')
    expect(result.body().intent.items[0]).toMatchObject({ platform: 'community', confidence: 0.82 })
    expect(result.body().intent.items[0]).not.toHaveProperty('phone')
    expect(result.body().intent.items[0].sourceUrl).toBe('https://example.invalid/post')
    expect(result.body().intent.items[0].evidence[0].quote).not.toContain('13800000000')
    expect(calls[0]).toMatchObject({ name: 'mcp__tools-lead-discovery__search', arguments: { query: expect.any(String) } })
  })
})
