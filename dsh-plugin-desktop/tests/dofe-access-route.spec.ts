import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { DOFE_ACCESS_MODELS_PATH, handleDofeAccessValidationRequest, handleDofeModelCatalogRequest } from '../src/dofe-access-route.ts'

const ORIGIN = 'http://127.0.0.1:43120'

function request(value: unknown, origin = ORIGIN): IncomingMessage {
  const body = JSON.stringify(value)
  const req = Readable.from([body]) as IncomingMessage
  req.method = 'POST'
  req.headers = {
    origin,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json; charset=utf-8',
  }
  Object.defineProperty(req, 'socket', {
    configurable: true,
    value: { remoteAddress: '127.0.0.1' },
  })
  return req
}

function response(): ServerResponse & { body: string } {
  const res = {
    body: '',
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string) => { res.body = body ?? '' }),
  }
  return res as unknown as ServerResponse & typeof res
}

describe('DoFe model_api_key validation route', () => {
  it('validates the key through the managed gateway without returning the secret', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    const res = response()

    await handleDofeAccessValidationRequest(request({ key: 'entered-secret' }), res, ORIGIN, fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      'https://ixicai.cn/api/v1/models?protocol=openai',
      expect.objectContaining({
        headers: { Authorization: 'Bearer entered-secret' },
        redirect: 'error',
      }),
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ valid: true })
    expect(res.body).not.toContain('entered-secret')
  })

  it('rejects cross-origin validation before contacting the gateway', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    const res = response()

    await handleDofeAccessValidationRequest(
      request({ key: 'entered-secret' }, 'https://attacker.example'),
      res,
      ORIGIN,
      fetcher,
    )

    expect(fetcher).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({ valid: false })
  })

  it('returns a closed failure when the gateway rejects the key', async () => {
    const res = response()

    await handleDofeAccessValidationRequest(
      request({ key: 'invalid-secret' }),
      res,
      ORIGIN,
      async () => new Response('{}', { status: 401 }),
    )

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ valid: false })
  })

  it('returns the normalized remote model catalog without returning the key', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'remote-a', name: 'Remote A' }] }), { status: 200 }))
    const res = response()

    await handleDofeModelCatalogRequest(request({ key: 'entered-secret' }), res, ORIGIN, fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      'https://ixicai.cn/api/v1/models?protocol=openai',
      expect.objectContaining({ headers: { Authorization: 'Bearer entered-secret', Accept: 'application/json' } }),
    )
    expect(JSON.parse(res.body)).toEqual({ models: [{ id: 'remote-a', name: 'Remote A' }] })
    expect(res.body).not.toContain('entered-secret')
    expect(DOFE_ACCESS_MODELS_PATH).toBe('/api/desktop/dofe/models')
  })
})
