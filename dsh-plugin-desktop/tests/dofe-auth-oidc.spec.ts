import { describe, expect, it } from 'vitest'
import {
  createLoopbackRedirectUri,
  createOidcAuthorizationSession,
  createPkceChallenge,
  parseOidcCallback,
  SENSTEED_SSO_SCOPES,
} from '../src/dofe-auth-oidc.ts'

const discovery = {
  issuer: 'https://sso.ixicai.cn/api',
  authorization_endpoint: 'https://sso.ixicai.cn/api/oauth/authorize',
  token_endpoint: 'https://sso.ixicai.cn/api/oauth/token',
  userinfo_endpoint: 'https://sso.ixicai.cn/api/oauth/userinfo',
}

describe('sensteed OIDC authorization primitives', () => {
  it('uses a loopback callback and public-client PKCE S256 parameters', () => {
    const session = createOidcAuthorizationSession(discovery, 43121)
    const url = new URL(session.authorizationUrl)
    expect(session.redirectUri).toBe('http://127.0.0.1:43121/callback')
    expect(url.searchParams.get('client_id')).toBe('sensteed-desktop')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(session.redirectUri)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(createPkceChallenge(session.verifier))
    expect(url.searchParams.get('scope')).toBe(SENSTEED_SSO_SCOPES.join(' '))
  })

  it('rejects invalid loopback ports before opening a browser', () => {
    expect(() => createLoopbackRedirectUri(0)).toThrow()
    expect(() => createLoopbackRedirectUri(65_536)).toThrow()
    expect(() => createLoopbackRedirectUri(43121.5)).toThrow()
  })

  it('fails closed on callback state, error, and missing code', () => {
    expect(parseOidcCallback('http://127.0.0.1:43121/callback?code=c&state=wrong', 'expected')).toEqual({ ok: false, reason: 'state_mismatch' })
    expect(parseOidcCallback('http://127.0.0.1:43121/callback?error=access_denied&state=expected', 'expected')).toEqual({ ok: false, reason: 'oauth_error' })
    expect(parseOidcCallback('http://127.0.0.1:43121/callback?state=expected', 'expected')).toEqual({ ok: false, reason: 'missing_code' })
  })

  it('returns only the authorization code after matching state', () => {
    expect(parseOidcCallback('http://127.0.0.1:43121/callback?code=abc&state=expected', 'expected')).toEqual({ ok: true, code: 'abc', state: 'expected' })
  })
})

