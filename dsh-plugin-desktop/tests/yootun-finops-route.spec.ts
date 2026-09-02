import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { handleYootunFinopsRequest, YOOTUN_FINOPS_PATH, YOOTUN_FINOPS_USAGE_URL } from '../src/yootun-finops-route.ts'

const ORIGIN = 'http://127.0.0.1:43120'
const NOW = new Date('2026-09-01T01:30:00.000Z')

function request(method: string, origin = ORIGIN): any {
  return { method, headers: { origin }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() {} }
}

function response() {
  let raw = ''
  const headers: Record<string, string> = {}
  return {
    statusCode: 0,
    headers,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value },
    end(value = '') { raw += value },
    get status() { return this.statusCode },
    body() { return raw ? JSON.parse(raw) : undefined },
  } as any
}

describe('Yootun FinOps route', () => {
  it('loads Models usage through the credential store for the Shanghai yesterday window', async () => {
    const result = response()
    const requests: Array<{ url: string; init: RequestInit }> = []
    await handleYootunFinopsRequest(request('GET'), result, ORIGIN, {
      credentials: { async resolve(ref) { expect(ref).toEqual(credentialRef('MODELS_API_KEY')); return { value: 'test-model-key', source: 'memory' } } },
      fetcher: async (url, init) => {
        requests.push({ url: String(url), init: init as RequestInit })
        return new Response(JSON.stringify({
          object: 'yootun.usage_range', currency: 'CNY',
          summary: { requests: 4, totalTokens: 1200, cost: 1.25, budget: 10 },
          byModel: [{ model: 'deepseek-chat', requests: 4, inputTokens: 800, outputTokens: 400, cost: 1.25 }],
          alerts: [{ id: 'a-1', title: '消费增长', status: 'open' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
      now: () => NOW,
    })
    expect(result.status).toBe(200)
    expect(result.body()).toMatchObject({
      period: { date: '2026-08-31', start: '2026-08-30T16:00:00.000Z', end: '2026-08-31T16:00:00.000Z' },
      source: { status: 'ready' }, summary: { spend: 1.25, budget: 10, remaining: 8.75, requests: 4, tokens: 1200, alerts: 1 },
    })
    expect(result.body().models[0]).toEqual({ id: 'deepseek-chat', name: 'deepseek-chat', requests: 4, tokens: 1200, cost: 1.25 })
    expect(requests[0]?.url).toContain(YOOTUN_FINOPS_USAGE_URL)
    expect(new URL(requests[0]!.url).searchParams.get('start')).toBe('2026-08-30T16:00:00.000Z')
    expect(requests[0]?.init.headers).toMatchObject({ Authorization: 'Bearer test-model-key' })
  })

  it('returns explicit unavailable and error source states without leaking upstream payloads', async () => {
    const missing = response()
    await handleYootunFinopsRequest(request('GET'), missing, ORIGIN, {
      credentials: { async resolve() { return undefined } }, now: () => NOW,
    })
    expect(missing.status).toBe(200)
    expect(missing.body().source).toEqual({ status: 'unavailable', reason: 'model_api_key_missing' })

    const failed = response()
    await handleYootunFinopsRequest(request('GET'), failed, ORIGIN, {
      credentials: { async resolve() { return { value: 'test-model-key', source: 'memory' } } },
      fetcher: async () => new Response('private upstream response', { status: 502 }),
      now: () => NOW,
    })
    expect(failed.status).toBe(200)
    expect(failed.body().source).toEqual({ status: 'error', reason: 'usage_service_failed' })
    expect(JSON.stringify(failed.body())).not.toContain('private upstream response')
  })

  it('rejects cross-origin access and writes', async () => {
    const crossOrigin = response()
    await handleYootunFinopsRequest(request('GET', 'https://evil.example'), crossOrigin, ORIGIN)
    expect(crossOrigin.status).toBe(403)
    const post = response()
    await handleYootunFinopsRequest(request('POST'), post, ORIGIN)
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET')
    expect(YOOTUN_FINOPS_PATH).toBe('/api/desktop/yootun/finops')
  })
})
