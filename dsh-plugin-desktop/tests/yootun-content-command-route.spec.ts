import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { handleYootunContentCommandRequest, YOOTUN_CONTENT_COMMAND_PATH } from '../src/yootun-content-command-route.ts'
function request(method: string, body?: string): any { const chunks = body === undefined ? [] : [Buffer.from(body)]; return { method, headers: { origin: 'http://127.0.0.1:43120', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield* chunks } } }
function response() { let raw = ''; return { statusCode: 0, setHeader() {}, end(value = '') { raw += value }, get status() { return this.statusCode }, body() { return raw ? JSON.parse(raw) : undefined } } as any }
describe('Yootun content command route', () => {
  it('persists a brief and keeps publishing explicitly confirmed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-content-')); const statePath = join(root, 'state.json'); const now = () => new Date('2026-09-01T02:00:00.000Z')
    const saved = response(); await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'save_brief', title: '企业 AI 助手选型指南', targetQuery: '企业 AI 助手', funnelStage: 'consideration', status: 'ready', source: 'georank', geoScore: 82, dueAt: '2026-09-01T08:00:00.000Z', rawContent: 'secret' })), saved, 'http://127.0.0.1:43120', { statePath }); expect(saved.status).toBe(400)
    const valid = response(); await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'save_brief', title: '企业 AI 助手选型指南', targetQuery: '企业 AI 助手', funnelStage: 'consideration', status: 'ready', source: 'georank', geoScore: 82, dueAt: '2026-09-01T08:00:00.000Z' })), valid, 'http://127.0.0.1:43120', { statePath }); expect(valid.status).toBe(200); expect(valid.body().dashboard).toMatchObject({ briefs: 1, ready: 1, dueToday: 1 }); const briefId = valid.body().briefs[0].id
    const queued = response(); await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'queue_publish', briefId, summary: '确认 GEO 内容后再交给发布适配器' })), queued, 'http://127.0.0.1:43120', { statePath }); expect(queued.body().dashboard.pendingConfirmation).toBe(1)
    const confirmed = response(); await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'confirm_action', id: queued.body().actions[0].id })), confirmed, 'http://127.0.0.1:43120', { statePath }); expect(confirmed.body().actions[0].status).toBe('confirmed_pending_adapter'); expect(JSON.parse(await readFile(statePath, 'utf8')).briefs[0]).not.toHaveProperty('rawContent')
  })
  it('degrades corrupt state to an explicit empty snapshot', async () => { const root = await mkdtemp(join(tmpdir(), 'yootun-content-corrupt-')); const statePath = join(root, 'state.json'); await import('node:fs/promises').then(fs => fs.writeFile(statePath, '{broken')); const result = response(); await handleYootunContentCommandRequest(request('GET'), result, 'http://127.0.0.1:43120', { statePath }); expect(result.status).toBe(200); expect(result.body()).toMatchObject({ dashboard: { briefs: 0 }, briefs: [], actions: [] }); expect(YOOTUN_CONTENT_COMMAND_PATH).toBe('/api/desktop/yootun/content-command') })
})
