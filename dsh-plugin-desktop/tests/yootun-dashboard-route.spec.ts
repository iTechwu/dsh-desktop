import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  buildYootunDashboard,
  handleYootunDashboardRequest,
  YOOTUN_DASHBOARD_YESTERDAY_PATH,
  YOOTUN_USAGE_URL,
} from '../src/yootun-dashboard-route.ts'

const ORIGIN = 'http://127.0.0.1:43120'

function request(origin = ORIGIN): IncomingMessage {
  const req = Readable.from(['{}']) as IncomingMessage
  req.method = 'POST'
  req.headers = {
    origin,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'content-length': '2',
  }
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '127.0.0.1' } })
  return req
}

function response(): ServerResponse & { body: string } {
  const result = {
    body: '', statusCode: 200, setHeader: vi.fn(),
    end: vi.fn((body?: string) => { result.body = body ?? '' }),
  }
  return result as unknown as ServerResponse & typeof result
}

describe('Yootun dashboard route', () => {
  it('returns independent source states and never returns model_api_key', async () => {
    const execute = vi.fn(async () => ({
      isError: false,
      value: { content: [] },
      content: [{ type: 'text', text: JSON.stringify({ data: { kpis: { articles: 3 } } }) }],
    }))
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      object: 'yootun.usage_range',
      currency: 'CNY',
      period: {},
      summary: { requests: 2, cost: 0.4, unexpectedSecret: 'upstream-secret' },
      byModel: [{ model: 'model-a', requests: 2, cost: 0.4, providerKey: 'provider-secret' }],
    }), { status: 200 }))
    const result = await buildYootunDashboard({
      credentials: { resolve: vi.fn(async () => ({ value: 'secret-key', source: 'file' })) },
      tools: {
        schemas: () => [{ name: 'mcp__geoflow__geoflow_analytics_overview_hash' }],
        execute,
      } as never,
      fetcher,
      now: () => new Date('2026-09-01T04:00:00.000Z'),
    })

    expect(result.geo).toEqual({ status: 'ready', data: { kpis: { articles: 3 } } })
    expect(result.usage).toMatchObject({ status: 'ready', data: { currency: 'CNY' } })
    expect(result.activity).toEqual({ status: 'unavailable', reason: 'local_session_service_unavailable' })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ arguments: { preset: 'yesterday' } }))
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ origin: new URL(YOOTUN_USAGE_URL).origin }),
      expect.objectContaining({ headers: { Authorization: 'Bearer secret-key', Accept: 'application/json' } }),
    )
    expect(JSON.stringify(result)).not.toContain('secret-key')
    expect(JSON.stringify(result)).not.toContain('upstream-secret')
    expect(JSON.stringify(result)).not.toContain('provider-secret')
  })

  it('keeps the whole dashboard available when every source is unavailable', async () => {
    const result = await buildYootunDashboard({
      credentials: { resolve: vi.fn(async () => undefined) },
      tools: { schemas: () => [], execute: vi.fn() } as never,
      now: () => new Date('2026-09-01T04:00:00.000Z'),
    })
    expect(result.geo.status).toBe('unavailable')
    expect(result.usage).toEqual({ status: 'unavailable', reason: 'model_api_key_missing' })
    expect(result.activity.status).toBe('unavailable')
  })

  it('rejects a cross-origin request before collecting data', async () => {
    const res = response()
    const resolve = vi.fn()
    await handleYootunDashboardRequest(
      request('https://attacker.example'),
      res,
      ORIGIN,
      { credentials: { resolve } },
    )
    expect(res.statusCode).toBe(403)
    expect(resolve).not.toHaveBeenCalled()
    expect(YOOTUN_DASHBOARD_YESTERDAY_PATH).toBe('/api/desktop/yootun/dashboard/yesterday')
  })
})
