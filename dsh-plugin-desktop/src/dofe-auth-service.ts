import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { DesktopLogger } from './desktop-logger.ts'
import { formatDesktopErrorDetails } from './desktop-logger.ts'
import type { DesktopRuntime } from './runtime.ts'
import type { DofeAuthSnapshot } from './dofe-auth-contract.ts'
export * from './dofe-auth-contract.ts'
import {
  createOidcAuthorizationSession,
  parseOidcCallback,
  SENSTEED_SSO_CLIENT_ID,
  SENSTEED_SSO_DISCOVERY_URL,
  type OidcDiscovery,
} from './dofe-auth-oidc.ts'

export const DOFE_AUTH_GRANT_KEY = credentialKey('dsh-plugin-desktop', 'sensteed-auth')
const MODELS_API_KEY_REF = credentialRef('MODELS_API_KEY')
const MODELS_PROVISION_URL = 'https://ixicai.cn/api/auth/desktop/provision-key'
const SESSION_TIMEOUT_MS = 5 * 60_000

interface TokenResponse { access_token?: unknown; refresh_token?: unknown; error?: unknown }
interface ProvisionResponse {
  groups?: unknown
  groupNames?: unknown
  key?: unknown
  user?: { ssoSub?: unknown; name?: unknown; avatar?: unknown }
  tenant?: { tenantId?: unknown; ssoTeamId?: unknown; tenantSlug?: unknown }
  entitlements?: { plugins?: unknown; defaultModel?: unknown; allowedProtocols?: unknown }
}

function json(res: ServerResponse, status: number, value: object): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function callbackPage(res: ServerResponse, message: string): void {
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(`<!doctype html><meta charset="utf-8"><title>Sensteed Agent</title><p>${message}</p><script>window.close()</script>`)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

class DofeAuthTokenError extends Error {
  constructor(message: string, readonly code?: string) { super(message) }
}

export class DofeAuthService {
  private snapshot: DofeAuthSnapshot = { status: 'idle' }
  private server: ReturnType<typeof createServer> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private operation: Promise<void> | undefined
  private cancelPending: (() => void) | undefined
  private cancelled = false
  private abort = new AbortController()
  private readonly bindingListeners = new Set<(snapshot: DofeAuthSnapshot) => void>()

  constructor(
    private readonly runtime: DesktopRuntime,
    private readonly credentials: CredentialProvider,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly onBound?: (snapshot: DofeAuthSnapshot) => Promise<void>,
    private readonly logger?: Pick<DesktopLogger, 'error'>,
  ) {}

  getStatus(): DofeAuthSnapshot { return structuredClone(this.snapshot) }

  watchBinding(listener: (snapshot: DofeAuthSnapshot) => void): () => void {
    this.bindingListeners.add(listener)
    if (this.snapshot.status === 'bound') listener(this.getStatus())
    return () => { this.bindingListeners.delete(listener) }
  }

  async restore(): Promise<DofeAuthSnapshot> {
    await this.start(false)
    await this.operation
    return this.getStatus()
  }

  async start(interactive = true): Promise<DofeAuthSnapshot> {
    if (this.operation !== undefined) return this.getStatus()
    this.cancelled = false
    this.abort = new AbortController()
    this.snapshot = { status: 'pending' }
    this.operation = this.openAuthorization(interactive).catch(error => {
      if (!this.cancelled) {
        // The generic dialog copy hides the underlying failure; keep the cause
        // chain in the diagnostic log so network vs provisioning is decidable.
        this.logger?.error(`dsh-plugin-desktop: dofe 登录流程失败: ${formatDesktopErrorDetails(error)}`)
        const invalid = error instanceof DofeAuthTokenError && error.code === 'invalid_grant'
        this.fail(
          invalid ? '登录授权已失效，请重新登录' : '登录未完成，请检查网络或稍后重试',
          invalid ? 'invalid_grant' : undefined,
        )
      }
    }).finally(() => { this.closeLoopback(); this.operation = undefined })
    return this.getStatus()
  }

  async cancel(): Promise<DofeAuthSnapshot> {
    this.cancelled = true
    this.abort.abort()
    this.cancelPending?.()
    this.cancelPending = undefined
    this.closeLoopback()
    this.snapshot = { status: 'cancelled' }
    return this.getStatus()
  }

  async dispose(): Promise<void> { await this.cancel(); await this.operation }

  async logout(): Promise<DofeAuthSnapshot> {
    await this.cancel()
    await this.operation
    await this.credentials.deleteRecord(DOFE_AUTH_GRANT_KEY)
    await this.credentials.unset(MODELS_API_KEY_REF)
    this.snapshot = { status: 'idle' }
    return this.getStatus()
  }

  private async openAuthorization(interactive: boolean): Promise<void> {
    if (!interactive) {
      const record = await this.credentials.readRecord(DOFE_AUTH_GRANT_KEY)
      if (record?.kind !== 'grant' || !asString((record.payload as { refreshToken?: unknown })?.refreshToken)) {
        this.snapshot = { status: 'idle' }
        return
      }
    }
    const discovery = await this.readDiscovery()
    this.abort.signal.throwIfAborted()
    let accessToken: string | undefined
    // Rotate inside the credential provider's cross-process lock, and persist
    // the replacement before provisioning so a Models outage cannot lose it.
    await this.credentials.modifyRecord(DOFE_AUTH_GRANT_KEY, async record => {
      const payload = record?.kind === 'grant' ? record.payload as { refreshToken?: unknown } | null : null
      const refreshToken = asString(payload?.refreshToken)
      if (refreshToken === undefined) return undefined
      try {
        const token = await this.exchangeRefresh(discovery, refreshToken)
        accessToken = token.accessToken
        return { kind: 'grant', payload: { refreshToken: token.refreshToken ?? refreshToken } }
      } catch (error) {
        if (!(error instanceof DofeAuthTokenError) || error.code !== 'invalid_grant') throw error
        return { kind: 'grant', payload: {} }
      }
    })
    this.abort.signal.throwIfAborted()
    if (accessToken !== undefined) {
      await this.provision(discovery, accessToken)
      return
    }
    if (!interactive) throw new DofeAuthTokenError('登录授权已失效', 'invalid_grant')
    const port = await this.listen()
    if (this.cancelled) throw new Error('登录已取消')
    const session = createOidcAuthorizationSession(discovery, port, SENSTEED_SSO_CLIENT_ID)
    const callback = new Promise<string>((resolve, reject) => {
      this.cancelPending = () => reject(new Error('登录已取消'))
      this.timer = setTimeout(() => reject(new Error('登录等待超时，请重新扫码')), SESSION_TIMEOUT_MS)
      this.server?.once('dofe-callback', (url: URL) => {
        try {
          const callback = parseOidcCallback(url, session.state)
          if (!callback.ok) throw new Error(`OIDC 回调无效：${callback.reason}`)
          resolve(callback.code)
        } catch (error) { reject(error) }
      })
    })
    try {
      const [, code] = await Promise.all([this.runtime.openExternal(session.authorizationUrl), callback])
      this.closeLoopback()
      this.abort.signal.throwIfAborted()
      this.snapshot = { status: 'issued' }
      const token = await this.exchangeCode(discovery, session.redirectUri, session.verifier, code)
      this.abort.signal.throwIfAborted()
      if (token.refreshToken !== undefined) {
        await this.credentials.modifyRecord(DOFE_AUTH_GRANT_KEY, async () => ({ kind: 'grant', payload: { refreshToken: token.refreshToken } }))
      }
      await this.provision(discovery, token.accessToken)
    } finally {
      this.cancelPending = undefined
      this.closeLoopback()
    }
  }

  private async readDiscovery(): Promise<OidcDiscovery> {
    const response = await this.fetcher(SENSTEED_SSO_DISCOVERY_URL, { redirect: 'error', signal: this.signal(10_000) })
    if (!response.ok) throw new Error(`SSO discovery 请求失败（${response.status}）`)
    const value = await response.json() as Partial<OidcDiscovery>
    const issuer = asString(value.issuer)
    const authorizationEndpoint = asString(value.authorization_endpoint)
    const tokenEndpoint = asString(value.token_endpoint)
    const userinfoEndpoint = asString(value.userinfo_endpoint)
    if (authorizationEndpoint === undefined || tokenEndpoint === undefined || userinfoEndpoint === undefined || issuer === undefined) {
      throw new Error('SSO discovery 缺少必要端点')
    }
    const expectedIssuer = new URL('.', SENSTEED_SSO_DISCOVERY_URL).origin + '/api'
    if (issuer !== expectedIssuer) throw new Error('SSO issuer 不匹配')
    for (const endpoint of [authorizationEndpoint, tokenEndpoint, userinfoEndpoint]) {
      const parsed = new URL(endpoint)
      if (parsed.origin !== new URL(expectedIssuer).origin || !parsed.pathname.startsWith('/api/') || parsed.username || parsed.password) throw new Error('SSO 端点不受信任')
    }
    return { issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, userinfo_endpoint: userinfoEndpoint }
  }

  private listen(): Promise<number> {
    this.server = createServer((req, res) => this.handleCallback(req, res))
    return new Promise((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, '127.0.0.1', () => {
        const address = this.server?.address()
        if (address === null || typeof address === 'string' || address === undefined) return reject(new Error('无法创建回环登录监听器'))
        resolve(address.port)
      })
    })
  }

  private handleCallback(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET' || req.url === undefined) { callbackPage(res, '请求无效'); return }
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname !== '/callback') { callbackPage(res, '路径无效'); return }
    callbackPage(res, '登录回调已收到，可以返回 Sensteed Agent')
    this.server?.emit('dofe-callback', url)
  }

  private async exchangeCode(discovery: OidcDiscovery, redirectUri: string, verifier: string, code: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const response = await this.fetcher(discovery.token_endpoint, {
      method: 'POST', redirect: 'error', signal: this.signal(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: SENSTEED_SSO_CLIENT_ID, code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
    })
    return this.parseTokenResponse(response, 'SSO token 交换失败')
  }

  private async exchangeRefresh(discovery: OidcDiscovery, refreshToken: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const response = await this.fetcher(discovery.token_endpoint, {
      method: 'POST', redirect: 'error', signal: this.signal(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: SENSTEED_SSO_CLIENT_ID, refresh_token: refreshToken }).toString(),
    })
    return this.parseTokenResponse(response, 'SSO refresh 失败')
  }

  private async parseTokenResponse(response: Response, fallback: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const value = await response.json() as TokenResponse
    const accessToken = asString(value.access_token)
    const errorCode = asString(value.error)
    if (!response.ok || accessToken === undefined) throw new DofeAuthTokenError(errorCode ?? fallback, errorCode)
    const refreshToken = asString(value.refresh_token)
    return { accessToken, ...(refreshToken === undefined ? {} : { refreshToken }) }
  }

  private async provision(discovery: OidcDiscovery, accessToken: string): Promise<void> {
    this.abort.signal.throwIfAborted()
    const response = await this.fetcher(MODELS_PROVISION_URL, {
      method: 'POST', redirect: 'error', signal: this.signal(15_000),
      headers: { authorization: `Bearer ${accessToken}`, 'x-company-code': 'sensteed', accept: 'application/json' },
    })
    const value = await response.json() as ProvisionResponse
    const key = asString(value.key)
    const ssoSub = asString(value.user?.ssoSub)
    const tenantId = asString(value.tenant?.tenantId)
    const ssoTeamId = asString(value.tenant?.ssoTeamId)
    const tenantSlug = asString(value.tenant?.tenantSlug)
    // Keep the response body out of the message: a success payload carries the
    // API key, so only the envelope code/msg is safe to surface.
    if (!response.ok) throw new Error(`models provision 失败（${response.status}）：${asString((value as unknown as { msg?: unknown }).msg) ?? '无错误详情'}`)
    if (key === undefined || ssoSub === undefined || tenantId === undefined || ssoTeamId === undefined || tenantSlug !== 'sensteed') throw new Error('models 未返回有效的 Sensteed 身份绑定')
    this.abort.signal.throwIfAborted()
    await this.credentials.set(MODELS_API_KEY_REF, key)
    this.abort.signal.throwIfAborted()
    const plugins = Array.isArray(value.entitlements?.plugins) ? value.entitlements.plugins.filter((item): item is string => typeof item === 'string') : []
    const allowedProtocols = Array.isArray(value.entitlements?.allowedProtocols) ? value.entitlements.allowedProtocols.filter((item): item is string => typeof item === 'string') : []
    // Read the current SSO profile on every renewal, even when Models still
    // carries a previous name/avatar. A missing picture clears an old avatar;
    // an unavailable profile leaves it unchanged in the persisted identity.
    const profile = await this.readProfile(discovery, accessToken, ssoSub)
    const avatar = profile ? asString(profile.picture) ?? null : asString(value.user?.avatar)
    const snapshot: DofeAuthSnapshot = {
      status: 'bound',
      profileSynced: profile !== undefined,
      user: { ssoSub, name: asString(profile?.name) ?? asString(value.user?.name) ?? ssoSub, ...(avatar === undefined ? {} : { avatar }) },
      tenant: { tenantId, ssoTeamId, tenantSlug },
      entitlements: { plugins, defaultModel: asString(value.entitlements?.defaultModel) ?? '', allowedProtocols },
      groups: Array.isArray(value.groups) ? value.groups.filter((group): group is string => typeof group === 'string') : [],
      groupNames: typeof value.groupNames === 'object' && value.groupNames !== null && !Array.isArray(value.groupNames)
        ? Object.fromEntries(Object.entries(value.groupNames).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {},
    }
    await this.onBound?.(snapshot)
    this.abort.signal.throwIfAborted()
    this.snapshot = snapshot
    for (const listener of this.bindingListeners) {
      try { listener(this.getStatus()) } catch { /* Observers must not change authentication results. */ }
    }
  }

  private async readProfile(discovery: OidcDiscovery, accessToken: string, subject: string): Promise<{ name?: unknown; picture?: unknown } | undefined> {
    try {
      const response = await this.fetcher(discovery.userinfo_endpoint, {
        redirect: 'error', signal: this.signal(10_000),
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      })
      if (!response.ok) return undefined
      const value = await response.json() as { sub?: unknown; name?: unknown; picture?: unknown }
      if (value.sub !== subject) return undefined
      return value
    } catch (error) {
      // An aborted session is handled by the caller's abort checks; everything
      // else only costs this profile refresh, never the binding itself.
      if (!this.abort.signal.aborted) this.logger?.error(`dsh-plugin-desktop: 读取 SSO 用户资料失败: ${formatDesktopErrorDetails(error)}`)
      return undefined
    }
  }

  private closeLoopback(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const server = this.server
    this.server = undefined
    server?.close()
  }

  private signal(timeout: number): AbortSignal {
    return AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeout)])
  }

  private fail(message: string, code?: 'invalid_grant'): void {
    this.closeLoopback()
    this.snapshot = { status: 'error', error: message.slice(0, 240), ...(code === undefined ? {} : { code }) }
  }
}

export function writeDofeAuthJson(res: ServerResponse, status: number, value: object): void { json(res, status, value) }
