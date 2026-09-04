import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  YootunAuditListQuery,
  YootunAuditTeamsQuery,
} from './yootun-audit-models-client.ts'
import type { YootunAuditService } from './yootun-audit-service.ts'

export const YOOTUN_AUDIT_PATH = '/api/desktop/yootun/audit'
const MAX_BODY_BYTES = 4 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const WORKSPACE_FIELDS = new Set([
  'view', 'scope', 'teamId', 'start', 'end', 'pluginId', 'actionCode', 'memberId',
  'targetType', 'outcome', 'query', 'cursor', 'limit',
])
const TEAM_FIELDS = new Set(['view', 'query', 'cursor', 'limit'])

class BodyTooLarge extends Error {}

function finish(res: ServerResponse, status: number, body: object, allow?: string): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(body))
}

function loopback(address: string | undefined): boolean {
  if (address === undefined) return false
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

function sameOrigin(req: IncomingMessage, expectedOrigin: string): boolean {
  try {
    const expected = new URL(expectedOrigin)
    if (expected.origin !== expectedOrigin || expected.protocol !== 'http:' || !loopback(req.socket.remoteAddress)) {
      return false
    }
    if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
    if (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin') return false
    if (req.headers.origin !== undefined) return req.headers.origin === expected.origin
    return req.method === 'GET' && req.headers['sec-fetch-site'] === 'same-origin'
      && req.headers.referer !== undefined
      && new URL(req.headers.referer).origin === expected.origin
  } catch {
    return false
  }
}

function one(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name)
  if (values.length > 1) throw new Error('query_invalid')
  return values[0]
}

function bounded(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined
  if (value.length === 0 || value.length > max || value.trim() !== value) throw new Error('query_invalid')
  return value
}

function integer(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (!/^\d+$/u.test(value)) throw new Error('query_invalid')
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error('query_invalid')
  return parsed
}

function dateTime(value: string | undefined): string | undefined {
  const parsed = bounded(value, 64)
  if (parsed !== undefined && !Number.isFinite(Date.parse(parsed))) throw new Error('query_invalid')
  return parsed
}

function workspaceQuery(params: URLSearchParams): YootunAuditListQuery {
  if ([...params.keys()].some(key => !WORKSPACE_FIELDS.has(key))) throw new Error('query_invalid')
  const scope = one(params, 'scope') ?? 'self'
  if (scope !== 'self' && scope !== 'team') throw new Error('query_invalid')
  const teamId = one(params, 'teamId')
  if (teamId !== undefined && !UUID_PATTERN.test(teamId)) throw new Error('query_invalid')
  const outcome = one(params, 'outcome')
  if (outcome !== undefined && !['succeeded', 'partial', 'failed', 'accepted'].includes(outcome)) {
    throw new Error('query_invalid')
  }
  const start = dateTime(one(params, 'start'))
  const end = dateTime(one(params, 'end'))
  const pluginId = bounded(one(params, 'pluginId'), 160)
  const actionCode = bounded(one(params, 'actionCode'), 120)
  const memberId = bounded(one(params, 'memberId'), 160)
  const targetType = bounded(one(params, 'targetType'), 80)
  const query = bounded(one(params, 'query'), 200)
  const cursor = bounded(one(params, 'cursor'), 512)
  return {
    scope,
    limit: integer(one(params, 'limit'), 50, 100),
    ...(teamId === undefined ? {} : { teamId }),
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
    ...(pluginId === undefined ? {} : { pluginId }),
    ...(actionCode === undefined ? {} : { actionCode }),
    ...(memberId === undefined ? {} : { memberId }),
    ...(targetType === undefined ? {} : { targetType }),
    ...(outcome === undefined ? {} : { outcome: outcome as NonNullable<YootunAuditListQuery['outcome']> }),
    ...(query === undefined ? {} : { query }),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

function teamsQuery(params: URLSearchParams): YootunAuditTeamsQuery {
  if ([...params.keys()].some(key => !TEAM_FIELDS.has(key))) throw new Error('query_invalid')
  const query = bounded(one(params, 'query'), 200)
  const cursor = bounded(one(params, 'cursor'), 512)
  return {
    limit: integer(one(params, 'limit'), 20, 20),
    ...(query === undefined ? {} : { query }),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

function remoteError(cause: unknown): { status: number; error: string } {
  if (typeof cause !== 'object' || cause === null) return { status: 500, error: 'audit_unavailable' }
  const failure = cause as { kind?: unknown; status?: unknown }
  if (failure.kind === 'auth') {
    return failure.status === 403
      ? { status: 403, error: 'forbidden' }
      : { status: 401, error: 'auth_required' }
  }
  if (failure.kind === 'retryable') return { status: 503, error: 'remote_unavailable' }
  if (failure.kind === 'invalid_response') return { status: 502, error: 'remote_response_invalid' }
  return { status: 500, error: 'audit_unavailable' }
}

async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new TypeError('content_type_invalid')
  const declared = req.headers['content-length']
  if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new BodyTooLarge()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += value.byteLength
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge()
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export async function handleYootunAuditRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  service: YootunAuditService,
): Promise<void> {
  if (!sameOrigin(req, expectedOrigin)) return finish(res, 403, { error: 'forbidden' })
  if (req.method === 'GET') {
    let operation: () => Promise<object>
    try {
      const url = new URL(req.url ?? '', expectedOrigin)
      if (url.pathname !== YOOTUN_AUDIT_PATH) throw new Error('query_invalid')
      const view = one(url.searchParams, 'view') ?? 'workspace'
      if (view === 'workspace') {
        const query = workspaceQuery(url.searchParams)
        operation = async () => await service.workspace(query)
      } else if (view === 'teams') {
        const query = teamsQuery(url.searchParams)
        operation = async () => await service.teams(query)
      } else {
        throw new Error('query_invalid')
      }
    } catch {
      return finish(res, 400, { error: 'query_invalid' })
    }
    try {
      return finish(res, 200, await operation())
    } catch (cause) {
      const failure = remoteError(cause)
      return finish(res, failure.status, { error: failure.error })
    }
  }
  if (req.method === 'POST') {
    try {
      const value = await jsonBody(req)
      if (typeof value !== 'object' || value === null || Array.isArray(value)
        || Object.keys(value).length !== 1
        || (value as { action?: unknown }).action !== 'retry_sync') {
        return finish(res, 400, { error: 'request_invalid' })
      }
      await service.retrySync()
      return finish(res, 202, { status: 'scheduled' })
    } catch (cause) {
      if (cause instanceof TypeError) return finish(res, 415, { error: 'content_type_invalid' })
      if (cause instanceof BodyTooLarge) return finish(res, 413, { error: 'body_too_large' })
      return finish(res, 400, { error: 'request_invalid' })
    }
  }
  finish(res, 405, { error: 'method_not_allowed' }, 'GET, POST')
}
