import { describe, expect, it, vi } from 'vitest'
import { DofeAuthService, DOFE_AUTH_REFRESH_TOKEN_REF } from '../src/dofe-auth-service.ts'

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

async function waitForBound(service: DofeAuthService): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (service.getStatus().status === 'bound') return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error(`unexpected auth status: ${service.getStatus().status}`)
}

describe('DofeAuthService', () => {
  it('silently refreshes and provisions without opening an external browser', async () => {
    const values = new Map<string, string>([[DOFE_AUTH_REFRESH_TOKEN_REF, 'refresh-old']])
    const credentials = {
      resolve: vi.fn(async (ref: string) => values.has(ref) ? { value: values.get(ref), source: 'memory' } : undefined),
      set: vi.fn(async (ref: string, value: string) => { values.set(ref, value) }),
      unset: vi.fn(async (ref: string) => { values.delete(ref) }),
    }
    const openExternal = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        issuer: 'https://sso.ixicai.cn/api',
        authorization_endpoint: 'https://sso.ixicai.cn/api/oauth/authorize',
        token_endpoint: 'https://sso.ixicai.cn/api/oauth/token',
      }))
      .mockResolvedValueOnce(response({ access_token: 'access-new', refresh_token: 'refresh-new' }))
      .mockResolvedValueOnce(response({
        key: 'sk-secret',
        user: { ssoSub: 'sub-1', name: 'Alice' },
        tenant: { tenantId: 'tenant-1', ssoTeamId: 'team-1', tenantSlug: 'sensteed' },
        entitlements: { plugins: ['knowledge'], defaultModel: 'model-a', allowedProtocols: ['messages'] },
      }))
    const service = new DofeAuthService({ openExternal } as never, credentials as never, fetcher)

    await service.start()
    await waitForBound(service)

    expect(openExternal).not.toHaveBeenCalled()
    expect(credentials.set).toHaveBeenCalledWith(expect.any(String), 'sk-secret')
    expect(credentials.set).toHaveBeenCalledWith(DOFE_AUTH_REFRESH_TOKEN_REF, 'refresh-new')
    expect(service.getStatus()).toEqual(expect.objectContaining({ status: 'bound', user: { ssoSub: 'sub-1', name: 'Alice', avatar: null } }))
    expect(JSON.stringify(service.getStatus())).not.toContain('sk-secret')
    await service.dispose()
  })

  it('clears an invalid refresh token before falling back to browser login', async () => {
    const values = new Map<string, string>([[DOFE_AUTH_REFRESH_TOKEN_REF, 'refresh-old']])
    const credentials = {
      resolve: vi.fn(async (ref: string) => values.has(ref) ? { value: values.get(ref), source: 'memory' } : undefined),
      set: vi.fn(),
      unset: vi.fn(async (ref: string) => { values.delete(ref) }),
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        issuer: 'https://sso.ixicai.cn/api',
        authorization_endpoint: 'https://sso.ixicai.cn/api/oauth/authorize',
        token_endpoint: 'https://sso.ixicai.cn/api/oauth/token',
      }))
      .mockResolvedValueOnce(response({ error: 'invalid_grant' }, 400))
    const openExternal = vi.fn()
    const service = new DofeAuthService({ openExternal } as never, credentials as never, fetcher)

    await service.start()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(credentials.unset).toHaveBeenCalledWith(DOFE_AUTH_REFRESH_TOKEN_REF)
    expect(openExternal).toHaveBeenCalledOnce()
    expect(service.getStatus().status).toBe('pending')
    await service.dispose()
  })

  it('cancels the pending browser session without converting it into an error', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      issuer: 'https://sso.ixicai.cn/api',
      authorization_endpoint: 'https://sso.ixicai.cn/api/oauth/authorize',
      token_endpoint: 'https://sso.ixicai.cn/api/oauth/token',
    }))
    const service = new DofeAuthService({ openExternal: vi.fn() } as never, {
      resolve: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      unset: vi.fn(),
    } as never, fetcher)

    await service.start()
    await service.cancel()
    expect(service.getStatus()).toEqual({ status: 'cancelled' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(service.getStatus()).toEqual({ status: 'cancelled' })
    await service.dispose()
  })
})
