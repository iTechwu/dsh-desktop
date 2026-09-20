import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  DOFE_AUTH_CANCEL_PATH,
  DOFE_AUTH_COMPLETE_PATH,
  DOFE_AUTH_SESSION_PATH,
  DOFE_AUTH_STATUS_PATH,
  DofeAuthService,
  writeDofeAuthJson,
} from './dofe-auth-service.ts'

export const DOFE_AUTH_PATHS = [DOFE_AUTH_SESSION_PATH, DOFE_AUTH_STATUS_PATH, DOFE_AUTH_COMPLETE_PATH, DOFE_AUTH_CANCEL_PATH] as const

function permitted(req: IncomingMessage, expectedOrigin: string): boolean {
  const address = req.socket.remoteAddress ?? ''
  const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
  return loopback
    && req.headers.origin === expectedOrigin
    && (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin')
    && req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

export async function handleDofeAuthRequest(
  path: typeof DOFE_AUTH_PATHS[number],
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  service: DofeAuthService,
): Promise<void> {
  if (req.method !== 'POST') return writeDofeAuthJson(res, 405, { status: 'error' })
  if (!permitted(req, expectedOrigin)) return writeDofeAuthJson(res, 403, { status: 'error' })
  if (path === DOFE_AUTH_SESSION_PATH) return writeDofeAuthJson(res, 200, await service.start())
  if (path === DOFE_AUTH_CANCEL_PATH) return writeDofeAuthJson(res, 200, await service.cancel())
  if (path === DOFE_AUTH_STATUS_PATH || path === DOFE_AUTH_COMPLETE_PATH) return writeDofeAuthJson(res, 200, service.getStatus())
  writeDofeAuthJson(res, 404, { status: 'error' })
}
