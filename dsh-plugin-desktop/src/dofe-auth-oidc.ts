import { createHash, randomBytes } from 'node:crypto'

export const SENSTEED_SSO_DISCOVERY_URL = 'https://sso.ixicai.cn/api/.well-known/openid-configuration'
export const SENSTEED_SSO_CLIENT_ID = 'sensteed-desktop'
export const SENSTEED_SSO_SCOPES = ['openid', 'profile', 'email', 'tenant', 'offline_access'] as const

export interface OidcDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
}

export interface OidcAuthorizationSession {
  state: string
  nonce: string
  verifier: string
  redirectUri: string
  authorizationUrl: string
}

export type OidcCallback =
  | { ok: true; code: string; state: string }
  | { ok: false; reason: 'missing_code' | 'oauth_error' | 'state_mismatch' }

function base64Url(value: Buffer): string {
  return value.toString('base64url')
}

function randomToken(bytes = 32): string {
  return base64Url(randomBytes(bytes))
}

export function createPkceVerifier(): string {
  return randomToken(32)
}

export function createPkceChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier, 'ascii').digest())
}

export function createLoopbackRedirectUri(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('loopback port must be between 1 and 65535')
  return `http://127.0.0.1:${String(port)}/callback`
}

export function createOidcAuthorizationSession(
  discovery: OidcDiscovery,
  port: number,
  clientId = SENSTEED_SSO_CLIENT_ID,
): OidcAuthorizationSession {
  const redirectUri = createLoopbackRedirectUri(port)
  const state = randomToken()
  const nonce = randomToken()
  const verifier = createPkceVerifier()
  const url = new URL(discovery.authorization_endpoint)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', SENSTEED_SSO_SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', createPkceChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  return { state, nonce, verifier, redirectUri, authorizationUrl: url.toString() }
}

export function parseOidcCallback(url: string | URL, expectedState: string): OidcCallback {
  let parsed: URL
  try {
    parsed = typeof url === 'string' ? new URL(url) : url
  } catch {
    return { ok: false, reason: 'missing_code' }
  }
  const error = parsed.searchParams.get('error')
  if (error !== null) return { ok: false, reason: 'oauth_error' }
  const state = parsed.searchParams.get('state')
  if (state === null || state !== expectedState) return { ok: false, reason: 'state_mismatch' }
  const code = parsed.searchParams.get('code')
  if (code === null || code.length === 0) return { ok: false, reason: 'missing_code' }
  return { ok: true, code, state }
}

