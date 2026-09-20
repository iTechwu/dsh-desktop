import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { DesktopRuntime } from './runtime.ts'
import {
  createOidcAuthorizationSession,
  parseOidcCallback,
  SENSTEED_SSO_CLIENT_ID,
  SENSTEED_SSO_DISCOVERY_URL,
  type OidcDiscovery,
} from './dofe-auth-oidc.ts'

export const DOFE_AUTH_SESSION_PATH = '/api/desktop/auth/feishu/session'
export const DOFE_AUTH_STATUS_PATH = '/api/desktop/auth/feishu/status'
export const DOFE_AUTH_COMPLETE_PATH = '/api/desktop/auth/feishu/complete'
export const DOFE_AUTH_CANCEL_PATH = '/api/desktop/auth/feishu/cancel'
export const DOFE_AUTH_REFRESH_TOKEN_REF = credentialRef('SENSTEED_SSO_REFRESH_TOKEN')
const MODELS_API_KEY_REF = credentialRef('MODELS_API_KEY')
const MODELS_PROVISION_URL = 'https://ixicai.cn/api/auth/desktop/provision-key'
const SESSION_TIMEOUT_MS = 5 * 60_000

export type DofeAuthStatus = 'idle' | 'pending' | 'issued' | 'bound' | 'error' | 'cancelled'

export interface DofeAuthSnapshot {
  status: DofeAuthStatus
  user?: { ssoSub: string; name: string; avatar: string | null }
  tenant?: { tenantId: string; ssoTeamId: string; tenantSlug: string }
  entitlements?: { plugins: string[]; defaultModel: string; allowedProtocols: string[] }
  error?: string
}

interface TokenResponse { access_token?: unknown; refresh_token?: unknown; error?: unknown }
interface ProvisionResponse {
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

  constructor(
    private readonly runtime: DesktopRuntime,
    private readonly credentials: CredentialProvider,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  getStatus(): DofeAuthSnapshot { return structuredClone(this.snapshot) }

  async start(): Promise<DofeAuthSnapshot> {
    if (this.operation !== undefined) return this.getStatus()
    this.cancelled = false
    this.snapshot = { status: 'pending' }
    this.operation = this.openAuthorization().catch(error => {
      if (!this.cancelled) this.fail(error instanceof Error ? error.message : String(error))
    }).finally(() => { this.operation = undefined })
    return this.getStatus()
  }

  async cancel(): Promise<DofeAuthSnapshot> {
    this.cancelled = true
    this.cancelPending?.()
    this.cancelPending = undefined
    this.closeLoopback()
    this.snapshot = { status: 'cancelled' }
    return this.getStatus()
  }

  async dispose(): Promise<void> { this.closeLoopback() }

  private async openAuthorization(): Promise<void> {
    const discovery = await this.readDiscovery()
    const storedRefreshToken = (await this.credentials.resolve(DOFE_AUTH_REFRESH_TOKEN_REF))?.value
    if (storedRefreshToken !== undefined) {
      try {
        const token = await this.exchangeRefresh(discovery, storedRefreshToken)
        await this.provision(token.accessToken, token.refreshToken)
        return
      } catch (error) {
        if (!(error instanceof DofeAuthTokenError) || error.code !== 'invalid_grant') throw error
        await this.credentials.unset(DOFE_AUTH_REFRESH_TOKEN_REF)
      }
    }
    const port = await this.listen()
    if (this.cancelled) throw new Error('登录已取消')
    const session = createOidcAuthorizationSession(discovery, port, SENSTEED_SSO_CLIENT_ID)
    const callback = new Promise<void>((resolve, reject) => {
      this.cancelPending = () => reject(new Error('登录已取消'))
      this.timer = setTimeout(() => reject(new Error('登录等待超时，请重新扫码')), SESSION_TIMEOUT_MS)
      this.server?.once('dofe-callback', async (url: URL) => {
        try {
          const callback = parseOidcCallback(url, session.state)
          if (!callback.ok) throw new Error(`OIDC 回调无效：${callback.reason}`)
          this.snapshot = { status: 'issued' }
          const token = await this.exchangeCode(discovery, session.redirectUri, session.verifier, callback.code)
          await this.provision(token.accessToken, token.refreshToken)
          resolve()
        } catch (error) { reject(error) }
      })
    })
    try {
      await this.runtime.openExternal(session.authorizationUrl)
      await callback
    } finally {
      this.cancelPending = undefined
      this.closeLoopback()
    }
  }

  private async readDiscovery(): Promise<OidcDiscovery> {
    const response = await this.fetcher(SENSTEED_SSO_DISCOVERY_URL, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`SSO discovery 请求失败（${response.status}）`)
    const value = await response.json() as Partial<OidcDiscovery>
    const issuer = asString(value.issuer)
    const authorizationEndpoint = asString(value.authorization_endpoint)
    const tokenEndpoint = asString(value.token_endpoint)
    if (authorizationEndpoint === undefined || tokenEndpoint === undefined || issuer === undefined) throw new Error('SSO discovery 缺少必要端点')
    return { issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint }
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
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: SENSTEED_SSO_CLIENT_ID, code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
    })
    return this.parseTokenResponse(response, 'SSO token 交换失败')
  }

  private async exchangeRefresh(discovery: OidcDiscovery, refreshToken: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const response = await this.fetcher(discovery.token_endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
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

  private async provision(accessToken: string, refreshToken?: string): Promise<void> {
    const response = await this.fetcher(MODELS_PROVISION_URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${accessToken}`, 'x-company-code': 'sensteed', accept: 'application/json' },
    })
    const value = await response.json() as ProvisionResponse
    const key = asString(value.key)
    const ssoSub = asString(value.user?.ssoSub)
    const tenantId = asString(value.tenant?.tenantId)
    const ssoTeamId = asString(value.tenant?.ssoTeamId)
    const tenantSlug = asString(value.tenant?.tenantSlug)
    if (!response.ok || key === undefined || ssoSub === undefined || tenantId === undefined || ssoTeamId === undefined || tenantSlug !== 'sensteed') throw new Error('models 未返回有效的 Sensteed 身份绑定')
    await this.credentials.set(MODELS_API_KEY_REF, key)
    if (refreshToken !== undefined) await this.credentials.set(DOFE_AUTH_REFRESH_TOKEN_REF, refreshToken)
    const plugins = Array.isArray(value.entitlements?.plugins) ? value.entitlements.plugins.filter((item): item is string => typeof item === 'string') : []
    const allowedProtocols = Array.isArray(value.entitlements?.allowedProtocols) ? value.entitlements.allowedProtocols.filter((item): item is string => typeof item === 'string') : []
    this.snapshot = {
      status: 'bound',
      user: { ssoSub, name: asString(value.user?.name) ?? ssoSub, avatar: asString(value.user?.avatar) ?? null },
      tenant: { tenantId, ssoTeamId, tenantSlug },
      entitlements: { plugins, defaultModel: asString(value.entitlements?.defaultModel) ?? '', allowedProtocols },
    }
  }

  private closeLoopback(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const server = this.server
    this.server = undefined
    server?.close()
  }

  private fail(message: string): void {
    this.closeLoopback()
    this.snapshot = { status: 'error', error: message.slice(0, 240) }
  }
}

export function writeDofeAuthJson(res: ServerResponse, status: number, value: object): void { json(res, status, value) }
