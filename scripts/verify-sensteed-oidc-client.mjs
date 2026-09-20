import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const path = resolve('docs/0920/sensteed-desktop-oidc-client.json')
const value = JSON.parse(readFileSync(path, 'utf8'))
const requiredScopes = ['openid', 'profile', 'email', 'tenant', 'offline_access']
const errors = []
if (value.clientId !== 'sensteed-desktop') errors.push('clientId must be sensteed-desktop')
if (value.publicClient !== true) errors.push('publicClient must be true')
if (JSON.stringify(value.grantTypes) !== JSON.stringify(['authorization_code', 'refresh_token'])) errors.push('grantTypes must exclude client_credentials')
if (JSON.stringify(value.scopes) !== JSON.stringify(requiredScopes)) errors.push('scopes do not match the desktop contract')
if (value.redirectUri !== 'http://127.0.0.1:<dynamic-port>/callback') errors.push('redirectUri must use the loopback dynamic-port form')
if (value.pkce !== 'S256') errors.push('pkce must be S256')
if (value.clientSecret !== null) errors.push('public client must not define a clientSecret')
if (value.issuer !== 'https://sso.ixicai.cn/api') errors.push('issuer does not match the SSO discovery issuer')
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log('sensteed-desktop OIDC client contract is valid.')
}
