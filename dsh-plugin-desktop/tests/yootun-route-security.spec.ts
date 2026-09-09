import { describe, expect, it } from 'vitest'
import { sameYootunOrigin } from '../src/yootun-route-security.ts'

function request(method: string, headers: Record<string, string> = {}, remoteAddress = '127.0.0.1'): any {
  return { method, headers, socket: { remoteAddress } }
}

describe('Yootun route origin contract', () => {
  const origin = 'http://127.0.0.1:43120'

  it('accepts an explicit same-origin request', () => {
    expect(sameYootunOrigin(request('POST', { host: '127.0.0.1:43120', origin }), origin)).toBe(true)
  })

  it('rejects a write without Origin', () => {
    expect(sameYootunOrigin(request('POST', { host: '127.0.0.1:43120' }), origin)).toBe(false)
  })

  it('accepts a browser GET fallback with same-origin fetch metadata and Referer', () => {
    expect(sameYootunOrigin(request('GET', {
      host: '127.0.0.1:43120',
      'sec-fetch-site': 'same-origin',
      referer: `${origin}/?dsh-desktop-mode=advanced`,
    }), origin)).toBe(true)
  })

  it('rejects cross-origin and non-loopback requests', () => {
    expect(sameYootunOrigin(request('GET', { host: '127.0.0.1:43120', origin: 'http://evil.test' }), origin)).toBe(false)
    expect(sameYootunOrigin(request('GET', { host: '127.0.0.1:43120', origin }, '192.168.1.22'), origin)).toBe(false)
  })
})
