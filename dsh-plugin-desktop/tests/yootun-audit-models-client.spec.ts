import { describe, expect, it, vi } from 'vitest'
import { buildYootunAuditEvent } from '../src/yootun-audit-contract.ts'
import {
  YOOTUN_AUDIT_MODELS_BASE_URL,
  YootunAuditModelsClient,
} from '../src/yootun-audit-models-client.ts'

const EVENT_ID = '018f47a2-4f10-4abc-8def-1234567890ab'
const event = buildYootunAuditEvent({
  clientEventId: EVENT_ID,
  source: {
    pluginId: '@dofe/dsh-yootun-sales',
    pluginVersion: '0.1.0',
    surface: 'human_ui',
  },
  actionCode: 'sales.lead.created',
  category: 'create',
  target: { type: 'lead', id: 'lead-1' },
  outcome: 'succeeded',
  changes: [{ field: 'stage', after: 'new' }],
}, { now: () => new Date('2026-09-05T08:00:00.000Z') })

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, msg: 'ok', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('YootunAuditModelsClient', () => {
  it('posts a bounded batch without following redirects or exposing its API key', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({
      accepted: [{ clientEventId: EVENT_ID, id: EVENT_ID, receivedAt: '2026-09-05T08:00:01.000Z' }],
    }))
    const client = new YootunAuditModelsClient({ fetcher })

    await expect(client.batch([event], 'secret-key')).resolves.toEqual({
      accepted: [{ clientEventId: EVENT_ID, id: EVENT_ID, receivedAt: '2026-09-05T08:00:01.000Z' }],
    })
    expect(fetcher).toHaveBeenCalledWith(
      `${YOOTUN_AUDIT_MODELS_BASE_URL}/batch`,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-key',
        }),
      }),
    )
    expect(JSON.stringify(client.health())).not.toContain('secret-key')
  })

  it.each([401, 403] as const)('classifies status %s as an auth failure', async (status) => {
    const client = new YootunAuditModelsClient({
      fetcher: vi.fn().mockResolvedValue(new Response('{}', { status })),
    })
    await expect(client.batch([event], 'secret-key')).rejects.toMatchObject({ kind: 'auth', status })
  })

  it('classifies rate limits with a bounded Retry-After delay', async () => {
    const client = new YootunAuditModelsClient({
      fetcher: vi.fn().mockResolvedValue(new Response('{}', {
        status: 429,
        headers: { 'retry-after': '12' },
      })),
    })
    await expect(client.batch([event], 'secret-key')).rejects.toMatchObject({
      kind: 'retryable',
      status: 429,
      retryAfterMs: 12_000,
    })
  })

  it.each([500, 503])('classifies status %s as retryable', async (status) => {
    const client = new YootunAuditModelsClient({
      fetcher: vi.fn().mockResolvedValue(new Response('{}', { status })),
    })
    await expect(client.batch([event], 'secret-key')).rejects.toMatchObject({ kind: 'retryable', status })
  })

  it.each([400, 413, 422])('classifies permanent batch rejection %s without retrying forever', async (status) => {
    const client = new YootunAuditModelsClient({
      fetcher: vi.fn().mockResolvedValue(new Response('{}', { status })),
    })
    await expect(client.batch([event], 'secret-key')).rejects.toMatchObject({ kind: 'permanent', status })
  })

  it('classifies network failures as retryable and malformed success as invalid', async () => {
    const offline = new YootunAuditModelsClient({
      fetcher: vi.fn().mockRejectedValue(new Error('socket includes secret-key')),
    })
    await expect(offline.batch([event], 'secret-key')).rejects.toMatchObject({ kind: 'retryable' })
    expect(JSON.stringify(offline.health())).not.toContain('secret-key')

    const malformed = new YootunAuditModelsClient({
      fetcher: vi.fn().mockResolvedValue(ok({ accepted: [{ clientEventId: 'bad' }] })),
    })
    await expect(malformed.batch([event], 'secret-key')).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('issues validated list, summary, scope and team reads', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok({ events: [], nextCursor: null }))
      .mockResolvedValueOnce(ok({ today: 3, failed: 1 }))
      .mockResolvedValueOnce(ok({ available: ['self'], isSuperAdmin: false }))
      .mockResolvedValueOnce(ok({ teams: [], nextCursor: null }))
    const client = new YootunAuditModelsClient({ fetcher })

    await expect(client.list({ scope: 'self', limit: 50 }, 'key')).resolves.toEqual({ events: [], nextCursor: null })
    await expect(client.summary({ scope: 'self', limit: 50 }, 'key')).resolves.toEqual({ today: 3, failed: 1 })
    await expect(client.scopes('key')).resolves.toEqual({ available: ['self'], isSuperAdmin: false })
    await expect(client.teams({ query: '设计', limit: 20 }, 'key')).resolves.toEqual({ teams: [], nextCursor: null })
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([
      `${YOOTUN_AUDIT_MODELS_BASE_URL}?scope=self&limit=50`,
      `${YOOTUN_AUDIT_MODELS_BASE_URL}/summary?scope=self&limit=50`,
      `${YOOTUN_AUDIT_MODELS_BASE_URL}/scopes`,
      `${YOOTUN_AUDIT_MODELS_BASE_URL}/teams?query=%E8%AE%BE%E8%AE%A1&limit=20`,
    ])
  })
})
