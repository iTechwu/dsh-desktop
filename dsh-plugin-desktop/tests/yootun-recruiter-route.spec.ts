import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  handleYootunRecruiterRequest,
  readRecruiterState,
  yootunRecruiterLimits,
} from '../src/yootun-recruiter-route.ts'

const ORIGIN = 'http://127.0.0.1:43120'
const NOW = new Date('2026-09-01T02:00:00.000Z')

function request(method: string, body?: unknown, overrides: Record<string, unknown> = {}): IncomingMessage {
  const stream = new EventEmitter() as IncomingMessage
  const text = body === undefined ? '' : JSON.stringify(body)
  Object.assign(stream, {
    method,
    headers: {
      host: '127.0.0.1:43120',
      origin: method === 'POST' ? ORIGIN : undefined,
      referer: method === 'GET' ? `${ORIGIN}/` : undefined,
      'sec-fetch-site': 'same-origin',
      ...(method === 'POST' ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } : {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (text.length > 0) yield Buffer.from(text) },
    ...overrides,
  })
  return stream
}

function response(): ServerResponse & { body: string } {
  const result = {
    statusCode: 0, body: '',
    setHeader: vi.fn(),
    end(value?: string) { result.body = value ?? '' },
  }
  return result as unknown as ServerResponse & { body: string }
}

function path(): string {
  const directory = join(mkdtempSync(join(tmpdir(), 'yootun-recruiter-')), 'private')
  mkdirSync(directory, { mode: 0o700 })
  return join(directory, 'state.json')
}

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    action: 'save_requirement', title: 'AI 产品经理', department: '产品部', location: '上海',
    employmentType: '全职', headcount: 2, salaryMin: 25000, salaryMax: 40000,
    responsibilities: ['负责企业 AI 产品'], requiredSkills: ['产品设计'], preferredSkills: ['招聘系统经验'],
    status: 'active', ...overrides,
  }
}

async function call(
  statePath: string,
  method: string,
  body?: unknown,
  overrides?: Record<string, unknown>,
  routeOverrides: { adapter?: { execute: (request: any) => Promise<any> } } = {},
) {
  const res = response()
  await handleYootunRecruiterRequest(request(method, body, overrides), res, ORIGIN, {
    statePath, now: () => NOW, ...routeOverrides,
  })
  return { status: res.statusCode, value: JSON.parse(res.body) as Record<string, unknown>, res }
}

describe('Yootun recruiter route', () => {
  it('returns an honest empty snapshot with the official login handoff', async () => {
    const result = await call(path(), 'GET')
    expect(result.status).toBe(200)
    expect(result.value).toMatchObject({
      version: 1,
      requirements: [], candidates: [], actions: [],
      dashboard: { openRoles: 0, activeCandidates: 0, pendingConfirmation: 0 },
      boss: { status: 'requires_user_login', adapter: 'not_configured' },
    })
    expect((result.value.boss as { loginUrl: string }).loginUrl).toMatch(/^https:\/\/www\.zhipin\.com\//u)
    expect(result.res.setHeader).toHaveBeenCalledWith('cache-control', 'no-store')
  })

  it('persists requirements, candidate evidence, and derived funnel counts', async () => {
    const statePath = path()
    const saved = await call(statePath, 'POST', requirement())
    const requirementId = (saved.value.requirements as Array<{ id: string }>)[0]!.id
    const candidate = await call(statePath, 'POST', {
      action: 'save_candidate_analysis', displayName: '候选人 A', requirementId,
      stage: 'interview', matchScore: 82, evidence: ['有 3 年企业 AI 产品经验'],
      concerns: ['需核实跨团队交付范围'], interviewQuestions: ['请说明一次上线复盘'], feedbackStatus: 'draft',
    })
    expect(candidate.status).toBe(200)
    expect(candidate.value.dashboard).toMatchObject({ openRoles: 1, activeCandidates: 1, pendingFeedback: 1 })
    expect((candidate.value.dashboard as { funnel: Array<{ stage: string; count: number }> }).funnel)
      .toContainEqual({ stage: 'interview', count: 1 })
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).not.toHaveProperty('resume')
    if (process.platform !== 'win32') expect(statSync(statePath).mode & 0o777).toBe(0o600)
  })

  it('keeps every external write pending until explicit confirmation without claiming execution', async () => {
    const statePath = path()
    const queued = await call(statePath, 'POST', {
      action: 'queue_action', type: 'send_message', targetLabel: '候选人 A', summary: '邀请参加产品面试',
    })
    const action = (queued.value.actions as Array<{ id: string; status: string; idempotencyKey: string }>)[0]!
    expect(action.status).toBe('awaiting_confirmation')
    expect(action.idempotencyKey).toBeTruthy()
    expect(queued.value.dashboard).toMatchObject({ pendingReplies: 1, pendingConfirmation: 1 })

    const confirmed = await call(statePath, 'POST', { action: 'confirm_action', id: action.id })
    expect((confirmed.value.actions as Array<{ status: string }>)[0]!.status).toBe('confirmed_pending_adapter')
    expect(confirmed.value.dashboard).toMatchObject({ pendingReplies: 0, pendingConfirmation: 0 })
    expect(JSON.stringify(confirmed.value)).not.toMatch(/succeeded|sent/iu)
  })

  it('deduplicates retries with the same idempotency key and rejects a second confirmation', async () => {
    const statePath = path()
    const payload = {
      action: 'queue_action', type: 'publish_jd', targetLabel: 'AI 产品经理', summary: '发布职位草稿',
      idempotencyKey: 'recruiter-jd-20260901-001',
    }
    const first = await call(statePath, 'POST', payload)
    const retry = await call(statePath, 'POST', payload)
    expect((first.value.actions as unknown[]).length).toBe(1)
    expect((retry.value.actions as unknown[]).length).toBe(1)
    const id = (first.value.actions as Array<{ id: string }>)[0]!.id
    expect((await call(statePath, 'POST', { action: 'confirm_action', id })).status).toBe(200)
    expect((await call(statePath, 'POST', { action: 'confirm_action', id })).status).toBe(400)
  })

  it('executes only confirmed actions through an injected adapter and persists a minimal receipt', async () => {
    const statePath = path()
    const queued = await call(statePath, 'POST', {
      action: 'queue_action', type: 'send_message', targetLabel: '候选人 A', summary: '邀请参加产品面试',
      idempotencyKey: 'recruiter-adapter-001',
    })
    const id = (queued.value.actions as Array<{ id: string }>)[0]!.id
    await call(statePath, 'POST', { action: 'confirm_action', id })
    const requests: any[] = []
    const executed = await call(statePath, 'POST', { action: 'execute_action', id }, undefined, {
      adapter: { execute: async request => { requests.push(request); return { status: 'succeeded', reasonCode: 'remote_accepted', remoteRef: 'boss-msg-1' } } },
    })
    const action = (executed.value.actions as Array<{ status: string; adapterReceipt: Record<string, unknown> }>)[0]!
    expect(requests).toEqual([{
      actionId: id, type: 'send_message', idempotencyKey: 'recruiter-adapter-001',
      targetLabel: '候选人 A', summary: '邀请参加产品面试',
    }])
    expect(action.status).toBe('succeeded')
    expect(action.adapterReceipt).toMatchObject({ status: 'succeeded', reasonCode: 'remote_accepted', remoteRef: 'boss-msg-1' })
    expect(JSON.parse(readFileSync(statePath, 'utf8')).actions[0].adapterReceipt).not.toHaveProperty('cookie')
    const retry = await call(statePath, 'POST', { action: 'execute_action', id }, undefined, {
      adapter: { execute: async () => { throw new Error('must not execute twice') } },
    })
    expect((retry.value.actions as Array<{ status: string }>)[0]!.status).toBe('succeeded')
  })

  it('keeps adapter-unavailable actions pending and supports explicit login retry with the same key', async () => {
    const statePath = path()
    const queued = await call(statePath, 'POST', {
      action: 'queue_action', type: 'publish_jd', targetLabel: 'AI 产品经理', summary: '发布职位草稿',
      idempotencyKey: 'recruiter-adapter-002',
    })
    const id = (queued.value.actions as Array<{ id: string }>)[0]!.id
    await call(statePath, 'POST', { action: 'confirm_action', id })
    const unavailable = await call(statePath, 'POST', { action: 'execute_action', id })
    expect(unavailable.status).toBe(503)
    expect(((await call(statePath, 'GET')).value.actions as Array<{ status: string }>)[0]!.status)
      .toBe('confirmed_pending_adapter')
    const login = await call(statePath, 'POST', { action: 'execute_action', id }, undefined, {
      adapter: { execute: async () => ({ status: 'requires_user_login', reasonCode: 'login_required' }) },
    })
    expect((login.value.actions as Array<{ status: string }>)[0]!.status).toBe('requires_user_login')
    const completed = await call(statePath, 'POST', { action: 'execute_action', id }, undefined, {
      adapter: { execute: async request => ({ status: 'succeeded', reasonCode: 'remote_accepted', remoteRef: request.idempotencyKey }) },
    })
    expect((completed.value.actions as Array<{ status: string }>)[0]!.status).toBe('succeeded')
  })

  it('rejects a conflicting payload that reuses an idempotency key', async () => {
    const statePath = path()
    const payload = {
      action: 'queue_action', type: 'publish_jd', targetLabel: 'AI 产品经理', summary: '发布职位草稿',
      idempotencyKey: 'recruiter-jd-20260901-002',
    }
    expect((await call(statePath, 'POST', payload)).status).toBe(200)
    const conflict = await call(statePath, 'POST', { ...payload, summary: '发布已修改职位' })
    expect(conflict.status).toBe(400)
    expect(conflict.value.error).toBe('idempotency_conflict')
  })

  it.each([
    ['protected candidate field', async (statePath: string) => {
      const saved = await call(statePath, 'POST', requirement())
      const requirementId = (saved.value.requirements as Array<{ id: string }>)[0]!.id
      return call(statePath, 'POST', {
        action: 'save_candidate_analysis', displayName: '候选人 B', requirementId, stage: 'screening',
        evidence: [], concerns: [], interviewQuestions: [], feedbackStatus: 'none', gender: 'female',
      })
    }],
    ['raw resume field', async (statePath: string) => {
      const saved = await call(statePath, 'POST', requirement())
      const requirementId = (saved.value.requirements as Array<{ id: string }>)[0]!.id
      return call(statePath, 'POST', {
        action: 'save_candidate_analysis', displayName: '候选人 C', requirementId, stage: 'screening',
        evidence: [], concerns: [], interviewQuestions: [], feedbackStatus: 'none', resume: 'raw text',
      })
    }],
    ['protected screening signal', async (statePath: string) => {
      const saved = await call(statePath, 'POST', requirement())
      const requirementId = (saved.value.requirements as Array<{ id: string }>)[0]!.id
      return call(statePath, 'POST', {
        action: 'save_candidate_analysis', displayName: '候选人 D', requirementId, stage: 'screening',
        evidence: ['女性候选人'], concerns: [], interviewQuestions: [], feedbackStatus: 'none',
      })
    }],
    ['extended protected screening signal', async (statePath: string) => {
      const saved = await call(statePath, 'POST', requirement())
      const requirementId = (saved.value.requirements as Array<{ id: string }>)[0]!.id
      return call(statePath, 'POST', {
        action: 'save_candidate_analysis', displayName: '候选人 E', requirementId, stage: 'screening',
        evidence: ['身高 180cm，国籍符合'], concerns: [], interviewQuestions: [], feedbackStatus: 'none',
      })
    }],
    ['unknown action', (statePath: string) => call(statePath, 'POST', { action: 'publish_now' })],
  ])('rejects %s', async (_label, operation) => {
    expect((await operation(path())).status).toBe(400)
  })

  it.each([
    ['cross-origin POST', 'POST', requirement(), { headers: { host: '127.0.0.1:43120', origin: 'https://example.com', 'content-type': 'application/json' } }],
    ['cross-site GET', 'GET', undefined, { headers: { host: '127.0.0.1:43120', referer: 'https://example.com/', 'sec-fetch-site': 'cross-site' } }],
    ['remote socket', 'GET', undefined, { socket: { remoteAddress: '192.0.2.1' } }],
  ])('rejects %s', async (_label, method, body, overrides) => {
    expect((await call(path(), method, body, overrides)).status).toBe(403)
  })

  it('bounds request and stored state sizes and ignores unsafe state targets', async () => {
    const statePath = path()
    const tooLarge = request('POST', requirement())
    tooLarge.headers['content-length'] = String(yootunRecruiterLimits.bodyBytes + 1)
    const res = response()
    await handleYootunRecruiterRequest(tooLarge, res, ORIGIN, { statePath, now: () => NOW })
    expect(res.statusCode).toBe(413)

    const oversizedPath = path()
    writeFileSync(oversizedPath, Buffer.alloc(yootunRecruiterLimits.stateBytes + 1))
    expect((await readRecruiterState(oversizedPath, NOW.toISOString())).requirements).toEqual([])
    const target = path()
    writeFileSync(target, '{}')
    const link = `${target}-link`
    symlinkSync(target, link)
    expect((await readRecruiterState(link, NOW.toISOString())).requirements).toEqual([])
  })
})
