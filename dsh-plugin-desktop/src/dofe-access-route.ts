/** Same-origin Host route for validating model_api_key without browser CORS. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DOFE_MODEL_CATALOG_URL, parseDofeModelCatalog } from './dofe-models.ts'

export const DOFE_ACCESS_VALIDATE_PATH = '/api/desktop/dofe/validate'
export const DOFE_ACCESS_MODELS_PATH = '/api/desktop/dofe/models'
const MAX_BODY_BYTES = 16 * 1024

function finish(res: ServerResponse, status: number, value: object): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function permitted(req: IncomingMessage, expectedOrigin: string): boolean {
  const address = req.socket.remoteAddress ?? ''
  const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
  return loopback
    && req.headers.origin === expectedOrigin
    && (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin')
    && req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readKey(req: IncomingMessage): Promise<string | undefined> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(bytes)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || Object.keys(value).length !== 1
      || typeof (value as { key?: unknown }).key !== 'string') return undefined
    const key = (value as { key: string }).key.trim()
    return key.length > 0 && key.length <= 4096 ? key : undefined
  } catch {
    return undefined
  }
}

export async function handleDofeAccessValidationRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (req.method !== 'POST') return finish(res, 405, { valid: false })
  if (!permitted(req, expectedOrigin)) return finish(res, 403, { valid: false })
  const key = await readKey(req)
  if (key === undefined) return finish(res, 400, { valid: false })
  try {
    const response = await fetcher(DOFE_MODEL_CATALOG_URL, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    finish(res, 200, { valid: response.ok })
  } catch {
    finish(res, 200, { valid: false })
  }
}

/** Same-origin model catalog route used after a key is entered in onboarding. */
export async function handleDofeModelCatalogRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (req.method !== 'POST') return finish(res, 405, { models: [] })
  if (!permitted(req, expectedOrigin)) return finish(res, 403, { models: [] })
  const key = await readKey(req)
  if (key === undefined) return finish(res, 400, { models: [] })
  try {
    const response = await fetcher(DOFE_MODEL_CATALOG_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return finish(res, 200, { models: [] })
    finish(res, 200, { models: parseDofeModelCatalog(await response.json()) })
  } catch {
    finish(res, 200, { models: [] })
  }
}
