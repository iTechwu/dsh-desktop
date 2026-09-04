import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { handleYootunContentCommandRequest, YOOTUN_CONTENT_COMMAND_PATH } from '../src/yootun-content-command-route.ts'

function request(method: string, body?: string): any { const chunks = body === undefined ? [] : [Buffer.from(body)]; return { method, headers: { origin: 'http://127.0.0.1:43120', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield* chunks } } }
function response() { let raw = ''; return { statusCode: 0, setHeader() {}, end(value = '') { raw += value }, get status() { return this.statusCode }, body() { return raw ? JSON.parse(raw) : undefined } } as any }
function tools() { return { schemas: () => [{ name: 'mcp__geoflow__geoflow_articles_list' }, { name: 'mcp__geoflow__geoflow_articles_get' }], execute: vi.fn(async (input: any) => input.name.endsWith('articles_list') ? { items: [{ id: 42, title: '企业 AI 助手选型指南', status: 'draft', review_status: 'pending', created_at: '2026-09-01T02:00:00.000Z' }] } : { id: 42, content: '# 正文', excerpt: '摘要', slug: 'ai-guide' }) } }

describe('Yootun content command route', () => {
  it('loads GeoFlow article bodies and persists review/channel decisions only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-content-'))
    const statePath = join(root, 'state.json')
    const source = tools()
    const now = () => new Date('2026-09-01T02:00:00.000Z')
    const loaded = response()
    await handleYootunContentCommandRequest(request('GET'), loaded, 'http://127.0.0.1:43120', { statePath, tools: source, now })
    expect(loaded.body()).toMatchObject({ dashboard: { articles: 1, pendingReview: 1 }, articles: [{ articleId: 42, content: '# 正文', reviewStatus: 'pending' }] })

    const blocked = response()
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'select_platforms', articleId: 42, platforms: ['website'] })), blocked, 'http://127.0.0.1:43120', { statePath, tools: source, now })
    expect(blocked.status).toBe(409)

    const approved = response()
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'review_article', articleId: 42, decision: 'approved' })), approved, 'http://127.0.0.1:43120', { statePath, tools: source, now })
    expect(approved.body().articles[0].reviewStatus).toBe('approved')
    const selected = response()
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'select_platforms', articleId: 42, platforms: ['website', 'xiaohongshu'] })), selected, 'http://127.0.0.1:43120', { statePath, tools: source, now })
    expect(selected.body().articles[0].selectedPlatforms).toEqual(['website', 'xiaohongshu'])
    const disk = JSON.parse(await readFile(statePath, 'utf8'))
    expect(disk.version).toBe(2)
    expect(JSON.stringify(disk)).not.toContain('# 正文')
  })

  it('opens external official Web UI and publishes website through separate adapters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-content-publish-'))
    const statePath = join(root, 'state.json')
    const source = tools()
    const openPlatformWeb = vi.fn(async () => {})
    const publishWebsite = vi.fn(async () => 'https://yootun.ixicai.cn/media/ai-guide')
    const dependencies = { statePath, tools: source, openPlatformWeb, publishWebsite }
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'review_article', articleId: 42, decision: 'approved' })), response(), 'http://127.0.0.1:43120', dependencies)
    const result = response()
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'publish_selected', articleId: 42, platforms: ['website', 'toutiao'] })), result, 'http://127.0.0.1:43120', dependencies)
    expect(result.status).toBe(200)
    expect(result.body().articles[0].platformStatus).toEqual({ website: 'succeeded', toutiao: 'requires_user_login' })
    expect(publishWebsite).toHaveBeenCalledWith(expect.objectContaining({ articleId: 42, content: '# 正文' }))
    expect(openPlatformWeb).toHaveBeenCalledWith('toutiao', 'https://mp.toutiao.com/')
  })

  it('degrades corrupt state to an explicit empty snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-content-corrupt-'))
    const statePath = join(root, 'state.json')
    await writeFile(statePath, '{broken')
    const result = response()
    await handleYootunContentCommandRequest(request('GET'), result, 'http://127.0.0.1:43120', { statePath })
    expect(result.status).toBe(200)
    expect(result.body()).toMatchObject({ dashboard: { articles: 0 }, articles: [] })
    expect(YOOTUN_CONTENT_COMMAND_PATH).toBe('/api/desktop/yootun/content-command')
  })
})
