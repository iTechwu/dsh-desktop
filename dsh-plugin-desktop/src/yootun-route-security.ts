import type { IncomingMessage } from 'node:http'

function loopback(address: string | undefined): boolean {
  return address === '::1'
    || address?.startsWith('127.') === true
    || address?.startsWith('::ffff:127.') === true
}

/** Keep local plugin routes same-origin without requiring Origin on browser GETs. */
export function sameYootunOrigin(req: IncomingMessage, expectedOrigin: string): boolean {
  try {
    const expected = new URL(expectedOrigin)
    if (expected.origin !== expectedOrigin || expected.protocol !== 'http:' || !loopback(req.socket.remoteAddress)) return false
    if (req.headers.host !== undefined && req.headers.host.toLowerCase() !== expected.host.toLowerCase()) return false
    if (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin') return false
    if (req.headers.origin !== undefined) return req.headers.origin === expected.origin
    if (req.method !== 'GET' || req.headers['sec-fetch-site'] !== 'same-origin' || req.headers.referer === undefined) return false
    return new URL(req.headers.referer).origin === expected.origin
  } catch {
    return false
  }
}
