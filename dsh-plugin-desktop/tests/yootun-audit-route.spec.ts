import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  handleYootunAuditRequest,
  YOOTUN_AUDIT_PATH,
} from '../src/yootun-audit-route.ts'
import type { YootunAuditService } from '../src/yootun-audit-service.ts'

const ORIGIN = 'http://127.0.0.1:43120'

function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const bytes = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: {
      host: '127.0.0.1:43120',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    socket: { remoteAddress: '127.0.0.1' },
    async * [Symbol.asyncIterator]() { yield * bytes },
  } as unknown as IncomingMessage
}

function response() {
  let content = ''
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((value?: string) => { content = value ?? '' }),
  } as unknown as ServerResponse
  return { res, body: () => content.length === 0 ? undefined : JSON.parse(content) as unknown }
}

function service() {
  return {
    workspace: vi.fn().mockResolvedValue({
      status: 'ready',
      summary: { today: 0, succeeded: 0, abnormal: 0, pendingSync: 0 },
      events: [],
      page: { nextCursor: null },
      scopes: { available: ['self'], isSuperAdmin: false },
      sync: { pending: 0, quarantine: 0 },
      freshness: { source: 'live' },
    }),
    teams: vi.fn().mockResolvedValue({ teams: [], nextCursor: null }),
    retrySync: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Yootun audit private route', () => {
  it('serves a validated workspace query', async () => {
    const target = service()
    const output = response()
    await handleYootunAuditRequest(
      request('GET', `${YOOTUN_AUDIT_PATH}?view=workspace&scope=self&limit=50&outcome=failed`),
      output.res,
      ORIGIN,
      target as unknown as YootunAuditService,
    )

    expect(output.res.statusCode).toBe(200)
    expect(target.workspace).toHaveBeenCalledWith({ scope: 'self', limit: 50, outcome: 'failed' })
    expect(output.body()).toMatchObject({ status: 'ready' })
  })

  it('requires an explicit team for a super-admin team workspace at the service boundary', async () => {
    const target = service()
    const output = response()
    await handleYootunAuditRequest(
      request('GET', `${YOOTUN_AUDIT_PATH}?view=workspace&scope=team&limit=50`),
      output.res,
      ORIGIN,
      target as unknown as YootunAuditService,
    )
    expect(target.workspace).toHaveBeenCalledWith({ scope: 'team', limit: 50 })
  })

  it.each([
    [{ kind: 'auth', status: 403 }, 403, 'forbidden'],
    [{ kind: 'auth', status: 401 }, 401, 'auth_required'],
    [{ kind: 'retryable', status: 503 }, 503, 'remote_unavailable'],
    [{ kind: 'invalid_response' }, 502, 'remote_response_invalid'],
  ])('preserves remote team-query failure classification', async (failure, status, error) => {
    const target = service()
    target.teams.mockRejectedValueOnce(failure)
    const output = response()

    await handleYootunAuditRequest(
      request('GET', `${YOOTUN_AUDIT_PATH}?view=teams&limit=20`),
      output.res,
      ORIGIN,
      target as unknown as YootunAuditService,
    )

    expect(output.res.statusCode).toBe(status)
    expect(output.body()).toEqual({ error })
  })

  it('supports only the retry_sync mutation with JSON content type', async () => {
    const target = service()
    const success = response()
    await handleYootunAuditRequest(
      request('POST', YOOTUN_AUDIT_PATH, { action: 'retry_sync' }),
      success.res,
      ORIGIN,
      target as unknown as YootunAuditService,
    )
    expect(success.res.statusCode).toBe(202)
    expect(target.retrySync).toHaveBeenCalledOnce()

    const rejected = response()
    await handleYootunAuditRequest(
      request('POST', YOOTUN_AUDIT_PATH, { action: 'approve', id: 'anything' }),
      rejected.res,
      ORIGIN,
      target as unknown as YootunAuditService,
    )
    expect(rejected.res.statusCode).toBe(400)
    expect(target.retrySync).toHaveBeenCalledOnce()

    const wrongType = response()
    await handleYootunAuditRequest(
      request('POST', YOOTUN_AUDIT_PATH, { action: 'retry_sync' }, { 'content-type': 'text/plain' }),
      wrongType.res,
      ORIGIN,
      target as unknown as YootunAuditService,
    )
    expect(wrongType.res.statusCode).toBe(415)
  })

  it.each([
    ['remote socket', { remoteAddress: '10.0.0.5' }, { origin: ORIGIN, host: '127.0.0.1:43120' }],
    ['wrong host', { remoteAddress: '127.0.0.1' }, { origin: ORIGIN, host: 'evil.example' }],
    ['wrong origin', { remoteAddress: '127.0.0.1' }, { origin: 'https://evil.example', host: '127.0.0.1:43120' }],
    ['non-exact origin', { remoteAddress: '127.0.0.1' }, { origin: `${ORIGIN}/forged`, host: '127.0.0.1:43120' }],
  ])('rejects %s before calling the service', async (_label, socket, headers) => {
    const target = service()
    const req = request('GET', `${YOOTUN_AUDIT_PATH}?view=workspace&scope=self&limit=50`)
    Object.assign(req.socket, socket)
    Object.assign(req.headers, headers)
    const output = response()
    await handleYootunAuditRequest(req, output.res, ORIGIN, target as unknown as YootunAuditService)
    expect(output.res.statusCode).toBe(403)
    expect(target.workspace).not.toHaveBeenCalled()
  })

  it('rejects unknown or malformed query fields', async () => {
    const target = service()
    for (const query of ['view=delete_all', 'view=workspace&scope=self&limit=0', 'view=workspace&scope=self&secret=x']) {
      const output = response()
      await handleYootunAuditRequest(
        request('GET', `${YOOTUN_AUDIT_PATH}?${query}`),
        output.res,
        ORIGIN,
        target as unknown as YootunAuditService,
      )
      expect(output.res.statusCode).toBe(400)
    }
    expect(target.workspace).not.toHaveBeenCalled()
  })
})
