import { describe, expect, it, vi } from 'vitest'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { DofeAuthService, DOFE_AUTH_GRANT_KEY } from '../src/dofe-auth-service.ts'

const discovery = {
  issuer: 'https://sso.ixicai.cn/api',
  authorization_endpoint: 'https://sso.ixicai.cn/api/oauth/authorize',
  token_endpoint: 'https://sso.ixicai.cn/api/oauth/token',
  userinfo_endpoint: 'https://sso.ixicai.cn/api/oauth/userinfo',
}
const provisioned = {
  key: 'sk-secret', user: { ssoSub: 'sub-1', name: 'Alice' },
  tenant: { tenantId: 'tenant-1', ssoTeamId: 'team-1', tenantSlug: 'sensteed' },
  entitlements: { plugins: ['knowledge'], defaultModel: 'model-a', allowedProtocols: ['messages'] },
}
const userinfo = { sub: 'sub-1', name: 'Alice', picture: 'https://sso.ixicai.cn/avatar/sub-1.png' }
function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}
function credentialStore(refreshToken?: string) {
  let record: CredentialRecord | undefined = refreshToken ? { kind: 'grant', payload: { refreshToken } } : undefined
  return {
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
    deleteRecord: vi.fn(async () => { record = undefined }),
    readRecord: vi.fn(async () => record),
    modifyRecord: vi.fn(async (_key: string, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      record = await mutate(record) ?? record
      return record
    }),
  }
}

describe('DofeAuthService', () => {
  it('removes the saved grant and model key on logout so restart cannot sign in again', async () => {
    const credentials = credentialStore('refresh-old')
    const fetcher = vi.fn()
    const service = new DofeAuthService({ openExternal: vi.fn() } as never, credentials as never, fetcher)
    expect((await service.logout()).status).toBe('idle')
    expect(credentials.deleteRecord).toHaveBeenCalledWith(DOFE_AUTH_GRANT_KEY)
    expect(credentials.unset).toHaveBeenCalledWith('MODELS_API_KEY')
    expect((await service.restore()).status).toBe('idle')
    expect(fetcher).not.toHaveBeenCalled()
    await service.dispose()
  })
  it('restores a saved session without launching a browser and publishes binding before completion', async () => {
    const credentials = credentialStore('refresh-old')
    const openExternal = vi.fn()
    const onBound = vi.fn(async () => { expect(credentials.set).toHaveBeenCalled() })
    const fetcher = vi.fn().mockResolvedValueOnce(response(discovery))
      .mockResolvedValueOnce(response({ access_token: 'access-new', refresh_token: 'refresh-new' }))
      .mockResolvedValueOnce(response(provisioned))
      .mockResolvedValueOnce(response(userinfo))
    const service = new DofeAuthService({ openExternal } as never, credentials as never, fetcher, onBound)
    const snapshot = await service.restore()
    expect(snapshot.status).toBe('bound')
    expect(snapshot.user?.avatar).toBe(userinfo.picture)
    expect(onBound).toHaveBeenCalledOnce()
    expect(openExternal).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('keeps first launch offline and requires an explicit login for an expired grant', async () => {
    const openExternal = vi.fn()
    const fetcher = vi.fn().mockResolvedValueOnce(response(discovery))
      .mockResolvedValueOnce(response({ error: 'invalid_grant' }, 400))
    const first = new DofeAuthService({ openExternal } as never, credentialStore() as never, fetcher)
    expect((await first.restore()).status).toBe('idle')
    expect(fetcher).not.toHaveBeenCalled()
    const expired = new DofeAuthService({ openExternal } as never, credentialStore('expired') as never, fetcher)
    expect((await expired.restore()).status).toBe('error')
    expect(openExternal).not.toHaveBeenCalled()
    await first.dispose()
    await expired.dispose()
  })

  it('rotates its Host grant before provisioning and never returns secrets', async () => {
    const credentials = credentialStore('refresh-old')
    const openExternal = vi.fn()
    const fetcher = vi.fn().mockResolvedValueOnce(response(discovery))
      .mockResolvedValueOnce(response({ access_token: 'access-new', refresh_token: 'refresh-new' }))
      .mockImplementationOnce(async () => {
        expect(await credentials.readRecord()).toEqual({ kind: 'grant', payload: { refreshToken: 'refresh-new' } })
        return response(provisioned)
      })
      .mockResolvedValueOnce(response(userinfo))
    const service = new DofeAuthService({ openExternal } as never, credentials as never, fetcher)
    await service.start()
    await vi.waitFor(() => expect(service.getStatus().status).toBe('bound'))
    expect(openExternal).not.toHaveBeenCalled()
    expect(credentials.set).toHaveBeenCalledWith('MODELS_API_KEY', 'sk-secret')
    expect(credentials.modifyRecord).toHaveBeenCalledWith(DOFE_AUTH_GRANT_KEY, expect.any(Function))
    expect(JSON.stringify(service.getStatus())).not.toMatch(/sk-secret|access-new|refresh-new/)
    await service.dispose()
  })

  it('keeps a provision-supplied avatar without calling userinfo and survives a failed avatar read', async () => {
    const credentials = credentialStore('refresh-old')
    const withAvatar = { ...provisioned, user: { ...provisioned.user, avatar: 'https://cdn.example/a.png' } }
    const fetcher = vi.fn().mockResolvedValueOnce(response(discovery))
      .mockResolvedValueOnce(response({ access_token: 'access-new' }))
      .mockResolvedValueOnce(response(withAvatar))
    const service = new DofeAuthService({ openExternal: vi.fn() } as never, credentials as never, fetcher)
    await service.start()
    await vi.waitFor(() => expect(service.getStatus().status).toBe('bound'))
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(service.getStatus().user?.avatar).toBe(withAvatar.user.avatar)

    const failing = new DofeAuthService({ openExternal: vi.fn() } as never, credentialStore('refresh-old') as never,
      vi.fn().mockResolvedValueOnce(response(discovery))
        .mockResolvedValueOnce(response({ access_token: 'access-new' }))
        .mockResolvedValueOnce(response(provisioned))
        .mockRejectedValueOnce(new Error('userinfo down')))
    await failing.start()
    await vi.waitFor(() => expect(failing.getStatus().status).toBe('bound'))
    const bound = failing.getStatus()
    expect(bound.user?.avatar).toBeNull()
    await service.dispose()
    await failing.dispose()
  })

  it('retains the rotated grant when Models is unavailable', async () => {
    const credentials = credentialStore('refresh-old')
    const fetcher = vi.fn().mockResolvedValueOnce(response(discovery))
      .mockResolvedValueOnce(response({ access_token: 'access-new', refresh_token: 'refresh-new' }))
      .mockResolvedValueOnce(response({ error: 'unavailable' }, 503))
    const service = new DofeAuthService({ openExternal: vi.fn() } as never, credentials as never, fetcher)
    await service.start()
    await vi.waitFor(() => expect(service.getStatus().status).toBe('error'))
    expect(await credentials.readRecord()).toEqual({ kind: 'grant', payload: { refreshToken: 'refresh-new' } })
    expect(credentials.set).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('falls back to loopback PKCE once for invalid_grant', async () => {
    const credentials = credentialStore('refresh-old')
    const fetcher = vi.fn().mockResolvedValueOnce(response(discovery))
      .mockResolvedValueOnce(response({ error: 'invalid_grant' }, 400))
      .mockResolvedValueOnce(response({ access_token: 'access-new', refresh_token: 'refresh-new' }))
      .mockResolvedValueOnce(response(provisioned))
      .mockResolvedValueOnce(response(userinfo))
    const openExternal = vi.fn(async (href: string) => {
      const authorize = new URL(href)
      const callback = new URL(authorize.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', authorize.searchParams.get('state')!)
      callback.searchParams.set('code', 'test-code')
      await fetch(callback)
    })
    const service = new DofeAuthService({ openExternal } as never, credentials as never, fetcher)
    await service.start()
    await vi.waitFor(() => expect(service.getStatus().status).toBe('bound'))
    expect(openExternal).toHaveBeenCalledOnce()
    const body = new URLSearchParams(fetcher.mock.calls[2]![1].body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toHaveLength(43)
    await service.dispose()
  })

  it('does not persist a late provisioning response after cancellation', async () => {
    const credentials = credentialStore('refresh-old')
    let finish!: (response: Response) => void
    const fetcher = vi.fn().mockResolvedValueOnce(response(discovery))
      .mockResolvedValueOnce(response({ access_token: 'access-new', refresh_token: 'refresh-new' }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
    const service = new DofeAuthService({ openExternal: vi.fn() } as never, credentials as never, fetcher)
    await service.start()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    await service.cancel()
    finish(response(provisioned))
    await service.dispose()
    expect(service.getStatus()).toEqual({ status: 'cancelled' })
    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('rejects untrusted discovery endpoints before transmitting a refresh token', async () => {
    const credentials = credentialStore('refresh-old')
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...discovery, token_endpoint: 'https://other.example/token' }))
    const service = new DofeAuthService({ openExternal: vi.fn() } as never, credentials as never, fetcher)
    await service.start()
    await vi.waitFor(() => expect(service.getStatus().status).toBe('error'))
    expect(fetcher).toHaveBeenCalledOnce()
    expect(credentials.modifyRecord).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('releases the pending loopback listener on dispose', async () => {
    const openExternal = vi.fn()
    const service = new DofeAuthService({ openExternal } as never, credentialStore() as never,
      vi.fn().mockResolvedValue(response(discovery)))
    await service.start()
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
    const callback = new URL(openExternal.mock.calls[0]![0] as string).searchParams.get('redirect_uri')!
    await service.dispose()
    await expect(fetch(callback)).rejects.toThrow()
    expect(service.getStatus().status).toBe('cancelled')
  })
})
