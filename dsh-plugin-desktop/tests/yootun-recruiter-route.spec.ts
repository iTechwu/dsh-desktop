import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
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
  routeOverrides: {
    adapter?: { execute: (request: any) => Promise<any> }
    bossAdapter?: { execute: (request: any) => Promise<any>; sync: (request: any) => Promise<any> }
    credentials?: { resolve: (ref: unknown) => Promise<{ value: string; source: 'env' } | undefined> }
    knowledgePublisher?: { publish: (request: any) => Promise<any> }
    hrKnowledgeSpaceId?: string
    openBossWeb?: (url?: string) => Promise<void>
    audit?: { record: (input: any) => Promise<any> }
  } = {},
) {
  const res = response()
  await handleYootunRecruiterRequest(request(method, body, overrides), res, ORIGIN, {
    statePath, now: () => NOW,
    credentials: { resolve: async () => ({ value: 'test-only-model-key', source: 'env' }) },
    ...routeOverrides,
  })
  return { status: res.statusCode, value: JSON.parse(res.body) as Record<string, unknown>, res }
}

describe('Yootun recruiter route', () => {
  it('returns an honest empty snapshot with the official login handoff', async () => {
    const result = await call(path(), 'GET')
    expect(result.status).toBe(200)
    expect(result.value).toMatchObject({
      version: 2,
      requirements: [], candidates: [], actions: [],
      dashboard: { openRoles: 0, activeCandidates: 0, pendingConfirmation: 0 },
      boss: { status: 'requires_user_login', adapter: 'not_configured' },
    })
    expect((result.value.boss as { loginUrl: string }).loginUrl).toMatch(/^https:\/\/www\.zhipin\.com\//u)
    expect(result.res.setHeader).toHaveBeenCalledWith('cache-control', 'no-store')
  })

  it('audits recruiter writes while leaving previews and login handoffs unrecorded', async () => {
    const statePath = path()
    const record = vi.fn(async (_input: any): Promise<any> => ({ status: 'stored', clientEventId: 'event-1' }))
    const audit = { record }
    const saved = await call(statePath, 'POST', requirement({ title: '不得进入审计的岗位正文' }), undefined, { audit })
    const requirementId = (saved.value.requirements as Array<{ id: string }>)[0]!.id

    await call(statePath, 'POST', { action: 'sync_preview' }, undefined, { audit })
    await call(statePath, 'POST', { action: 'open_boss_login' }, undefined, { audit, openBossWeb: async () => {} })
    const failed = await call(statePath, 'POST', { action: 'execute_action', id: 'missing-action' }, undefined, { audit })

    expect(failed.status).toBe(400)
    expect(record).toHaveBeenCalledTimes(2)
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ actionCode: 'recruiter.requirement.created', target: { type: 'requirement', id: requirementId }, outcome: 'succeeded', changes: [{ field: 'status', after: 'active' }] }),
      expect.objectContaining({ actionCode: 'recruiter.action.executed', target: { type: 'recruiter_action', id: 'missing-action' }, outcome: 'failed', errorCode: 'action_not_found' }),
    ])
    expect(JSON.stringify(record.mock.calls)).not.toContain('不得进入审计')
  })

  it('classifies concurrent writes from the state serialized with each mutation', async () => {
    const statePath = path()
    const record = vi.fn(async (_input: any): Promise<any> => ({ status: 'stored', clientEventId: 'event-1' }))
    const id = 'concurrent-role'

    await Promise.all([
      call(statePath, 'POST', requirement({ id, status: 'active' }), undefined, { audit: { record } }),
      call(statePath, 'POST', requirement({ id, status: 'paused' }), undefined, { audit: { record } }),
    ])

    expect(record.mock.calls.map(([event]) => event.actionCode).sort()).toEqual([
      'recruiter.requirement.created',
      'recruiter.requirement.updated',
    ])
  })

  it('marks the tenant HR space ready without a client-configured space id', async () => {
    const result = await call(path(), 'GET', undefined, undefined, {
      knowledgePublisher: { publish: async () => ({ status: 'succeeded', reasonCode: 'knowledge_confirmed' }) },
    })
    expect(result.value.knowledge).toMatchObject({ status: 'ready', spaces: 1 })
  })

  it('migrates version 1 state without losing recruitment records', async () => {
    const statePath = path()
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      requirements: [{
        id: 'role-1', title: 'AI 产品经理', department: '产品部', location: '上海',
        employmentType: '全职', headcount: 1, responsibilities: ['负责 AI 产品'],
        requiredSkills: ['产品设计'], preferredSkills: [], status: 'active', updatedAt: NOW.toISOString(),
      }],
      candidates: [], actions: [], updatedAt: NOW.toISOString(),
    }))
    const state = await readRecruiterState(statePath, NOW.toISOString())
    expect(state).toMatchObject({
      version: 2,
      requirements: [{ id: 'role-1' }],
      sync: { provider: 'boss_zhipin', status: 'not_connected' },
      knowledge: { status: 'unavailable' },
      analytics: { status: 'empty' },
    })
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

  it('publishes confirmed, sanitized HR knowledge without client space configuration', async () => {
    const statePath = path()
    const saved = await call(statePath, 'POST', requirement())
    const requirementId = (saved.value.requirements as Array<{ id: string }>)[0]!.id
    await call(statePath, 'POST', {
      action: 'save_candidate_analysis', displayName: '候选人 A', requirementId,
      stage: 'interview', evidence: ['具备企业 AI 产品交付经验'], concerns: [],
      interviewQuestions: ['请复盘一次交付'], feedbackStatus: 'confirmed',
    })
    const queued = await call(statePath, 'POST', { action: 'publish_knowledge', scope: 'hr-recruiting' })
    const id = (queued.value.actions as Array<{ id: string }>)[0]!.id
    expect((queued.value.knowledge as { pending: number }).pending).toBe(1)
    await call(statePath, 'POST', { action: 'confirm_action', id })
    const publications: any[] = []
    const published = await call(statePath, 'POST', { action: 'execute_action', id }, undefined, {
      knowledgePublisher: {
        publish: async request => {
          publications.push(request)
          return { status: 'succeeded', reasonCode: 'knowledge_confirmed', memoryId: 'memory-1' }
        },
      },
    })
    expect(publications[0]).not.toHaveProperty('spaceId')
    expect(publications[0].content).not.toContain('候选人 A')
    expect(published.value.knowledge).toMatchObject({ status: 'ready', memories: 1, pending: 0 })
  })

  it('requires MODELS_API_KEY before knowledge or BOSS data operations', async () => {
    const statePath = path()
    const queued = await call(statePath, 'POST', { action: 'publish_knowledge', scope: 'hr-recruiting' })
    const id = (queued.value.actions as Array<{ id: string }>)[0]!.id
    await call(statePath, 'POST', { action: 'confirm_action', id })
    const missing = await call(statePath, 'POST', { action: 'execute_action', id }, undefined, {
      credentials: { resolve: async () => undefined },
    })
    expect(missing).toMatchObject({ status: 503, value: { error: 'model_api_key_unavailable' } })
    const read = await call(statePath, 'GET', undefined, undefined, {
      credentials: { resolve: async () => undefined },
    })
    expect(read).toMatchObject({ status: 503, value: { error: 'model_api_key_unavailable' } })
  })

  it('syncs only through an injected official BOSS adapter and persists aggregate receipts', async () => {
    const statePath = path()
    const result = await call(statePath, 'POST', { action: 'sync_boss' }, undefined, {
      bossAdapter: {
        execute: async () => ({ status: 'succeeded', reasonCode: 'unused' }),
        sync: async () => ({
          status: 'ready', reasonCode: 'boss_sync_completed', imported: 5, updated: 2, skipped: 1,
          cursor: 'cursor-2', responseRate: 64,
          requirements: [{
            id: 'boss-role-1', title: '数据产品经理', department: '产品部', location: '杭州',
            employmentType: '全职', headcount: 1, responsibilities: ['负责数据产品'],
            requiredSkills: ['数据分析'], preferredSkills: [], status: 'active', updatedAt: NOW.toISOString(),
          }],
          candidates: [{
            id: 'boss-candidate-1', displayName: '候选人 B', requirementId: 'boss-role-1',
            stage: 'screening', evidence: ['具备数据产品经验'], concerns: [], interviewQuestions: [],
            feedbackStatus: 'none', updatedAt: NOW.toISOString(),
          }],
        }),
      },
    })
    expect(result.value).toMatchObject({
      sync: { status: 'ready', imported: 5, updated: 2, skipped: 1, cursor: 'cursor-2', responseRate: 64 },
      boss: { status: 'connected', adapter: 'official' },
      analytics: { status: 'ready', responseRate: 64 },
      dashboard: { responseRate: 64 },
      requirements: [{ id: 'boss-role-1' }],
      candidates: [{ id: 'boss-candidate-1' }],
    })
    expect(readFileSync(statePath, 'utf8')).not.toMatch(/cookie|authorization|test-only-model-key/iu)
  })

  it('keeps healthy local recruitment analytics when the BOSS source fails', async () => {
    const statePath = path()
    await call(statePath, 'POST', requirement())
    const failed = await call(statePath, 'POST', { action: 'sync_boss' }, undefined, {
      bossAdapter: {
        execute: async () => ({ status: 'failed', reasonCode: 'unused' }),
        sync: async () => ({
          status: 'failed', reasonCode: 'boss_upstream_unavailable', imported: 0, updated: 0, skipped: 0,
        }),
      },
    })
    expect(failed.value).toMatchObject({
      sync: { status: 'error', reason: 'boss_upstream_unavailable' },
      dashboard: { openRoles: 1 },
      requirements: [{ title: 'AI 产品经理' }],
    })
  })

  it('previews the sync scope without writing state or touching the adapter', async () => {
    const statePath = path()
    await call(statePath, 'POST', requirement())
    const preview = await call(statePath, 'POST', { action: 'sync_preview' })
    expect(preview.status).toBe(200)
    expect(preview.value.syncPreview).toMatchObject({
      status: 'unavailable', adapter: 'not_configured', increment: 'full',
      scope: { requirements: 1, candidates: 0, hasCursor: false },
      reason: 'boss_official_adapter_unavailable',
    })
    expect((preview.value.syncPreview as { fields: string[] }).fields).toContain('displayName')
    expect(readFileSync(statePath, 'utf8')).not.toContain('syncPreview')
    const configured = await call(statePath, 'POST', { action: 'sync_preview' }, undefined, {
      bossAdapter: {
        execute: async () => ({ status: 'succeeded', reasonCode: 'unused' }),
        sync: async () => ({ status: 'ready', reasonCode: 'unused', imported: 0, updated: 0, skipped: 0 }),
      },
    })
    expect(configured.value.syncPreview).toMatchObject({ status: 'ready', adapter: 'official' })
    expect(configured.value.syncPreview).not.toHaveProperty('reason')
  })

  it('keeps locally confirmed candidate records when a sync returns the same identity', async () => {
    const statePath = path()
    const saved = await call(statePath, 'POST', requirement())
    const requirementId = (saved.value.requirements as Array<{ id: string }>)[0]!.id
    await call(statePath, 'POST', {
      action: 'save_candidate_analysis', id: 'cand-1', displayName: '候选人 A', requirementId,
      stage: 'interview', evidence: ['本地确认证据'], concerns: [], interviewQuestions: [],
      feedbackStatus: 'confirmed',
    })
    const synced = await call(statePath, 'POST', { action: 'sync_boss' }, undefined, {
      bossAdapter: {
        execute: async () => ({ status: 'succeeded', reasonCode: 'unused' }),
        sync: async () => ({
          status: 'ready', reasonCode: 'boss_sync_completed', imported: 2, updated: 0, skipped: 1,
          cursor: 'cursor-3',
          candidates: [
            { id: 'cand-1', displayName: '候选人 A（远端）', requirementId, stage: 'screening', evidence: ['远端证据'], concerns: [], interviewQuestions: [], feedbackStatus: 'none', updatedAt: NOW.toISOString() },
            { id: 'cand-2', displayName: '候选人 B', requirementId, stage: 'sourced', evidence: [], concerns: [], interviewQuestions: [], feedbackStatus: 'none', updatedAt: NOW.toISOString() },
          ],
        }),
      },
    })
    expect(synced.value.sync).toMatchObject({ status: 'ready', conflictsPreserved: 1 })
    const candidates = synced.value.candidates as Array<{ id: string; stage: string; feedbackStatus: string; displayName: string }>
    expect(candidates.find(item => item.id === 'cand-1')).toMatchObject({
      stage: 'interview', feedbackStatus: 'confirmed', displayName: '候选人 A',
    })
    expect(candidates.find(item => item.id === 'cand-2')).toMatchObject({ stage: 'sourced' })
    const persisted = JSON.parse(readFileSync(statePath, 'utf8'))
    expect(persisted.sync.conflictsPreserved).toBe(1)
    expect(persisted.candidates.find((item: { id: string }) => item.id === 'cand-1').evidence)
      .toEqual(['本地确认证据'])
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

  it('opens the in-app BOSS browser only through an injected desktop opener', async () => {
    const statePath = path()
    const absent = await call(statePath, 'POST', { action: 'open_boss_login' })
    expect(absent.status).toBe(503)
    expect(absent.value.error).toBe('boss_web_unavailable')
    expect(((await call(statePath, 'GET')).value.boss as { inAppBrowser: boolean }).inAppBrowser).toBe(false)
    const opens: Array<string | undefined> = []
    const opened = await call(statePath, 'POST', { action: 'open_boss_login' }, undefined, {
      openBossWeb: async url => { opens.push(url) },
    })
    expect(opened.status).toBe(200)
    expect(opens).toEqual([undefined])
    expect((opened.value.boss as { inAppBrowser: boolean }).inAppBrowser).toBe(true)
    expect(existsSync(statePath)).toBe(false)
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
    await handleYootunRecruiterRequest(tooLarge, res, ORIGIN, {
      statePath, now: () => NOW,
      credentials: { resolve: async () => ({ value: 'test-only-model-key', source: 'env' }) },
    })
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
