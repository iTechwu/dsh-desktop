/** Same-origin Host route for validating model_api_key without browser CORS. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DEFAULT_DOFE_PROTOCOL, dofeModelCatalogUrl, parseDofeModelCatalog, type DofeProtocol } from './dofe-models.ts'
import { BRAND_TENANT, BRAND_TENANT_ID } from './generated-product-identity.ts'

export const DOFE_ACCESS_VALIDATE_PATH = '/api/desktop/dofe/validate'
export const DOFE_ACCESS_MODELS_PATH = '/api/desktop/dofe/models'
export const DOFE_AUTH_CONTEXT_URL = 'https://ixicai.cn/api/internal/auth/context'
const MAX_BODY_BYTES = 16 * 1024
const MODEL_GATEWAY_HEADERS = Object.freeze({ 'X-Company-Code': BRAND_TENANT })

export type DofeAccessFailureReason = 'invalid_key' | 'tenant_mismatch' | 'tenant_unavailable'

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

async function readRequest(req: IncomingMessage): Promise<{ key: string; protocol: DofeProtocol } | undefined> {
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
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as { key?: unknown; protocol?: unknown }
    if (Object.keys(record).some(key => key !== 'key' && key !== 'protocol')) return undefined
    if (typeof record.key !== 'string') return undefined
    const protocol = record.protocol === undefined ? DEFAULT_DOFE_PROTOCOL : record.protocol
    if (protocol !== 'chat-completions' && protocol !== 'messages' && protocol !== 'responses') return undefined
    const key = record.key.trim()
    return key.length > 0 && key.length <= 4096 ? { key, protocol } : undefined
  } catch {
    return undefined
  }
}

async function verifyDofeTenant(
  key: string,
  fetcher: typeof fetch,
): Promise<{ ok: true } | { ok: false; reason: DofeAccessFailureReason }> {
  try {
    const response = await fetcher(DOFE_AUTH_CONTEXT_URL, {
      headers: { ...MODEL_GATEWAY_HEADERS, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { ok: false, reason: 'invalid_key' }
    const value = await response.json() as unknown
    const record = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
    const nestedTenant = record?.tenant && typeof record.tenant === 'object' && !Array.isArray(record.tenant)
      ? record.tenant as Record<string, unknown>
      : undefined
    const tenantSlug = [record?.tenantSlug, record?.tenant_slug, record?.slug, nestedTenant?.tenantSlug, nestedTenant?.slug]
      .find(candidate => typeof candidate === 'string' && candidate.trim().length > 0)
    const tenantId = [record?.tenantId, record?.tenant_id, record?.id, nestedTenant?.tenantId, nestedTenant?.tenant_id, nestedTenant?.id]
      .find(candidate => typeof candidate === 'string' && candidate.trim().length > 0)
    if (typeof tenantId === 'string' && tenantId.trim().length > 0) {
      return tenantId.trim().toLowerCase() === BRAND_TENANT_ID.toLowerCase()
        ? { ok: true }
        : { ok: false, reason: 'tenant_mismatch' }
    }
    if (typeof tenantSlug !== 'string' || tenantSlug.trim().length === 0) return { ok: false, reason: 'tenant_unavailable' }
    return tenantSlug.trim().toLowerCase() === BRAND_TENANT.toLowerCase()
      ? { ok: true }
      : { ok: false, reason: 'tenant_mismatch' }
  } catch {
    return { ok: false, reason: 'tenant_unavailable' }
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
  const request = await readRequest(req)
  if (request === undefined) return finish(res, 400, { valid: false })
  const { key, protocol } = request
  try {
    const tenant = await verifyDofeTenant(key, fetcher)
    if (!tenant.ok) return finish(res, 200, { valid: false, reason: tenant.reason })
    const response = await fetcher(dofeModelCatalogUrl(protocol), {
      headers: { ...MODEL_GATEWAY_HEADERS, Authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    finish(res, 200, response.ok ? { valid: true } : { valid: false, reason: 'invalid_key' })
  } catch {
    finish(res, 200, { valid: false, reason: 'invalid_key' })
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
  const request = await readRequest(req)
  if (request === undefined) return finish(res, 400, { models: [] })
  const { key, protocol } = request
  try {
    const tenant = await verifyDofeTenant(key, fetcher)
    if (!tenant.ok) return finish(res, 200, { models: [], reason: tenant.reason })
    const response = await fetcher(dofeModelCatalogUrl(protocol), {
      headers: { ...MODEL_GATEWAY_HEADERS, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return finish(res, 200, { models: [], reason: 'invalid_key' })
    finish(res, 200, { models: parseDofeModelCatalog(await response.json(), protocol) })
  } catch {
    finish(res, 200, { models: [], reason: 'invalid_key' })
  }
}
