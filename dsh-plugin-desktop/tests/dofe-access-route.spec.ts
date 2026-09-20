import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { DOFE_ACCESS_MODELS_PATH, DOFE_AUTH_CONTEXT_URL, handleDofeAccessValidationRequest, handleDofeModelCatalogRequest } from '../src/dofe-access-route.ts'

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
  it('registers both handlers on the Desktop private web surface', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

    expect(source).toContain('[DOFE_ACCESS_MODELS_PATH, handleDofeModelCatalogRequest]')
    expect(source).toContain('[DOFE_ACCESS_VALIDATE_PATH, handleDofeAccessValidationRequest]')
    expect(source).toContain('rejectDesktopRequest(ctx, req, res)')
  })

  it('validates the key through the managed gateway without returning the secret', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tenantSlug: 'yootun' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const res = response()

    await handleDofeAccessValidationRequest(request({ key: 'entered-secret' }), res, ORIGIN, fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      DOFE_AUTH_CONTEXT_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer entered-secret', 'X-Company-Code': 'yootun' }),
        redirect: 'error',
      }),
    )
    expect(fetcher).toHaveBeenCalledWith(
      'https://ixicai.cn/api/v1/models?protocol=openai',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer entered-secret', 'X-Company-Code': 'yootun' }),
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
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ tenantSlug: 'yootun' }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 401 })),
    )

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ valid: false, reason: 'invalid_key' })
  })

  it('rejects a valid key that belongs to another tenant before loading models', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ tenantSlug: 'other-tenant' }), { status: 200 }))
    const res = response()

    await handleDofeAccessValidationRequest(request({ key: 'entered-secret' }), res, ORIGIN, fetcher)

    expect(JSON.parse(res.body)).toEqual({ valid: false, reason: 'tenant_mismatch' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('accepts the current tenant id and rejects another tenant id when the live service omits its slug', async () => {
    const accepted = response()
    await handleDofeAccessValidationRequest(
      request({ key: 'sensteed-secret' }),
      accepted,
      ORIGIN,
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ tenantId: '869856a5-760a-4570-9177-8823ed84da78' }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 })),
    )
    expect(JSON.parse(accepted.body)).toEqual({ valid: true })

    const rejected = response()
    const rejectedFetcher = vi.fn(async () => new Response(JSON.stringify({ tenantId: '7a8866f9-3994-4341-ade6-b9fa942efe99' }), { status: 200 }))
    await handleDofeAccessValidationRequest(request({ key: 'other-secret' }), rejected, ORIGIN, rejectedFetcher)
    expect(JSON.parse(rejected.body)).toEqual({ valid: false, reason: 'tenant_mismatch' })
    expect(rejectedFetcher).toHaveBeenCalledTimes(1)
  })

  it('reads tenant identity from the gateway response envelope', async () => {
    const accepted = response()
    await handleDofeAccessValidationRequest(
      request({ key: 'enveloped-secret' }),
      accepted,
      ORIGIN,
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: { tenant: { id: '869856a5-760a-4570-9177-8823ed84da78' } } }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 })),
    )

    expect(JSON.parse(accepted.body)).toEqual({ valid: true })
  })

  it('returns the normalized remote model catalog without returning the key', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tenantSlug: 'yootun' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'remote-a', name: 'Remote A' }] }), { status: 200 }))
    const res = response()

    await handleDofeModelCatalogRequest(request({ key: 'entered-secret' }), res, ORIGIN, fetcher)

    expect(fetcher).toHaveBeenCalledWith(
      'https://ixicai.cn/api/v1/models?protocol=openai',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer entered-secret', Accept: 'application/json', 'X-Company-Code': 'yootun' }) }),
    )
    expect(JSON.parse(res.body)).toEqual({ models: [{ id: 'remote-a', name: 'Remote A' }] })
    expect(res.body).not.toContain('entered-secret')
    expect(DOFE_ACCESS_MODELS_PATH).toBe('/api/desktop/dofe/models')
  })

  it('uses the selected protocol for validation and model discovery', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tenantSlug: 'yootun' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'claude', protocol: 'anthropic-messages' }] }), { status: 200 }))
    const res = response()

    await handleDofeAccessValidationRequest(request({ key: 'entered-secret', protocol: 'messages' }), res, ORIGIN, fetcher)
    expect(fetcher).toHaveBeenLastCalledWith(
      'https://ixicai.cn/api/v1/models?protocol=anthropic',
      expect.anything(),
    )

    const catalogRes = response()
    const catalogFetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tenantSlug: 'yootun' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'o3', protocol: 'openai_responses' }] }), { status: 200 }))
    await handleDofeModelCatalogRequest(request({ key: 'entered-secret', protocol: 'responses' }), catalogRes, ORIGIN, catalogFetcher)
    expect(catalogFetcher).toHaveBeenLastCalledWith(
      'https://ixicai.cn/api/v1/models?protocol=openai_response',
      expect.anything(),
    )
    expect(JSON.parse(catalogRes.body)).toEqual({ models: [{ id: 'o3', name: 'o3' }] })
  })

  it('rejects the model catalog for another tenant', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ tenantSlug: 'other-tenant' }), { status: 200 }))
    const res = response()

    await handleDofeModelCatalogRequest(request({ key: 'entered-secret' }), res, ORIGIN, fetcher)

    expect(JSON.parse(res.body)).toEqual({ models: [], reason: 'tenant_mismatch' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('resolves the stored credential for useStored catalog requests without echoing it', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tenantSlug: 'yootun' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'remote-a', name: 'Remote A' }] }), { status: 200 }))
    const res = response()

    await handleDofeModelCatalogRequest(
      request({ key: '', protocol: 'messages', useStored: true }),
      res,
      ORIGIN,
      fetcher,
      async () => 'stored-secret',
    )

    expect(fetcher).toHaveBeenCalledWith(
      'https://ixicai.cn/api/v1/models?protocol=anthropic',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer stored-secret', 'X-Company-Code': 'yootun' }) }),
    )
    expect(JSON.parse(res.body)).toEqual({ models: [{ id: 'remote-a', name: 'Remote A' }] })
    expect(res.body).not.toContain('stored-secret')
  })

  it('fails closed when the stored credential is missing or unreadable', async () => {
    const fetcher = vi.fn()
    const missing = response()
    await handleDofeModelCatalogRequest(request({ key: '', useStored: true }), missing, ORIGIN, fetcher, async () => undefined)
    expect(JSON.parse(missing.body)).toEqual({ models: [], reason: 'invalid_key' })

    const throwing = response()
    await handleDofeModelCatalogRequest(request({ key: '', useStored: true }), throwing, ORIGIN, fetcher, async () => { throw new Error('keychain locked') })
    expect(JSON.parse(throwing.body)).toEqual({ models: [], reason: 'invalid_key' })

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails closed when useStored arrives without a host resolver', async () => {
    const fetcher = vi.fn()
    const res = response()

    await handleDofeModelCatalogRequest(request({ key: '', useStored: true }), res, ORIGIN, fetcher)

    expect(fetcher).not.toHaveBeenCalled()
    expect(JSON.parse(res.body)).toEqual({ models: [], reason: 'invalid_key' })
  })

  it('rejects malformed useStored bodies', async () => {
    const fetcher = vi.fn()
    const emptyKeyWithoutStored = response()
    await handleDofeModelCatalogRequest(request({ key: '' }), emptyKeyWithoutStored, ORIGIN, fetcher)
    expect(emptyKeyWithoutStored.statusCode).toBe(400)

    const nonBoolean = response()
    await handleDofeModelCatalogRequest(request({ key: 'k', useStored: 'yes' }), nonBoolean, ORIGIN, fetcher)
    expect(nonBoolean.statusCode).toBe(400)

    const unknownField = response()
    await handleDofeModelCatalogRequest(request({ key: 'k', admin: true }), unknownField, ORIGIN, fetcher)
    expect(unknownField.statusCode).toBe(400)

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects stored-credential validation instead of authorizing without a key', async () => {
    const fetcher = vi.fn()
    const res = response()

    await handleDofeAccessValidationRequest(request({ key: '', useStored: true }), res, ORIGIN, fetcher, async () => 'stored-secret')

    expect(fetcher).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ valid: false })
  })

  it('rejects cross-origin stored-credential catalog requests before resolving anything', async () => {
    const fetcher = vi.fn()
    const resolver = vi.fn(async () => 'stored-secret')
    const res = response()

    await handleDofeModelCatalogRequest(
      request({ key: '', useStored: true }, 'https://attacker.example'),
      res,
      ORIGIN,
      fetcher,
      resolver,
    )

    expect(resolver).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({ models: [] })
  })
})
