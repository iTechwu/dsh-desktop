import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { handleYootunContentCommandRequest, YOOTUN_CONTENT_COMMAND_PATH } from '../src/yootun-content-command-route.ts'

function request(method: string, body?: string): any { const chunks = body === undefined ? [] : [Buffer.from(body)]; return { method, headers: { origin: 'http://127.0.0.1:43120', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield* chunks } } }
function response() { let raw = ''; return { statusCode: 0, setHeader() {}, end(value = '') { raw += value }, get status() { return this.statusCode }, body() { return raw ? JSON.parse(raw) : undefined } } as any }
function tools(): any { return { schemas: () => [
  { name: 'mcp__geoflow__geoflow_articles_list' },
  { name: 'mcp__geoflow__geoflow_articles_get' },
  { name: 'mcp__geoflow__geoflow_analytics_overview' },
  { name: 'mcp__geoflow__geoflow_analytics_goals' },
  { name: 'mcp__georank__georank_diagnostic_history' },
  { name: 'mcp__georank__georank_list_companies' },
], execute: vi.fn(async (input: any) => {
  if (input.name.endsWith('articles_list')) return { items: [{ id: 42, title: '企业 AI 助手选型指南', status: 'draft', review_status: 'pending', created_at: '2026-09-01T02:00:00.000Z' }] }
  if (input.name.endsWith('articles_get')) return { id: 42, content: '# 正文', excerpt: '摘要', slug: 'ai-guide', humanize_status: 'processed', humanize_score: 18, humanize_classification: 'HUMAN_ONLY', humanize_issues: [{ type: 'rhythm', text: '术语密度偏高', suggestion: '拆分长句' }] }
  if (input.name.endsWith('analytics_overview')) return { kpis: { articles: 15, published: 8 }, publication_trend: [{ date: '2026-09-04', created: 2, published: 1 }], content_funnel: { max: 15, stages: [{ key: 'created', label: '已创建', count: 15 }] }, performance: { success_rate: 92 }, task_health: { active_tasks: 2, failed_jobs: 1 }, distribution_summary: { synced: 6, failed: 1, pending: 2 } }
  if (input.name.endsWith('analytics_goals')) return { month: '2026-09', goals: [{ metric: 'published', target: 30, actual: 8, attainment_pct: 26, pace_pct: 13 }] }
  if (input.name.endsWith('diagnostic_history')) return [{ report_id: 'report-1', url: 'https://yootun.ixicai.cn', status: 'completed', overall_score: 76, created_at: '2026-09-04T01:00:00Z' }]
  return { items: [{ id: 'company-1', name: '优惠豚', url: 'https://yootun.ixicai.cn', geo_score: 82, is_geo_certified: true }] }
}) } }

describe('Yootun content command route', () => {
  it('loads GeoFlow article bodies and persists review/channel decisions only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-content-'))
    const statePath = join(root, 'state.json')
    const source = tools()
    const now = () => new Date('2026-09-01T02:00:00.000Z')
    const loaded = response()
    await handleYootunContentCommandRequest(request('GET'), loaded, 'http://127.0.0.1:43120', { statePath, tools: source, now })
    expect(loaded.body()).toMatchObject({
      dashboard: { articles: 1, pendingReview: 1 },
      articles: [{ articleId: 42, content: '# 正文', reviewStatus: 'pending', humanize: { status: 'processed', score: 18, classification: 'HUMAN_ONLY', issues: ['术语密度偏高 - 拆分长句'] } }],
      sources: {
        geoflow: { status: 'ready', data: { goals: [{ target: 30 }] } },
        georank: { status: 'ready', data: { score: 82, latestReport: { reportId: 'report-1' } } },
      },
    })

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

  it('keeps article review available when analytics and rank reads fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-content-isolation-'))
    const source = tools()
    source.execute.mockImplementation(async (input: any) => {
      if (input.name.endsWith('articles_list')) return { items: [{ id: 42, title: '仍可审核', status: 'draft', review_status: 'pending' }] }
      if (input.name.endsWith('articles_get')) return { id: 42, content: '# 正文' }
      throw new Error('insight_unavailable')
    })
    const result = response()
    await handleYootunContentCommandRequest(request('GET'), result, 'http://127.0.0.1:43120', { statePath: join(root, 'state.json'), tools: source })
    expect(result.body()).toMatchObject({ status: 'ready', articles: [{ articleId: 42 }], sources: { geoflow: { status: 'error' }, georank: { status: 'error' } } })
  })

  it('audits review, platform selection, and publishing without article content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-content-audit-'))
    const statePath = join(root, 'state.json')
    const source = tools()
    const record = vi.fn(async (_input: any): Promise<any> => ({ status: 'stored', clientEventId: 'event-1' }))
    const dependencies = {
      statePath, tools: source, audit: { record },
      publishWebsite: async () => 'https://yootun.ixicai.cn/media/ai-guide',
      openPlatformWeb: async () => {},
    }
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'review_article', articleId: 42, decision: 'approved' })), response(), 'http://127.0.0.1:43120', dependencies)
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'select_platforms', articleId: 42, platforms: ['website', 'xiaohongshu'] })), response(), 'http://127.0.0.1:43120', dependencies)
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'open_platform', articleId: 42, platform: 'xiaohongshu' })), response(), 'http://127.0.0.1:43120', dependencies)
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'publish_selected', articleId: 42, platforms: ['website', 'xiaohongshu'] })), response(), 'http://127.0.0.1:43120', dependencies)
    const rejectedWrite = response()
    await handleYootunContentCommandRequest(request('POST', JSON.stringify({ action: 'select_platforms', articleId: 42, secret: '敏感失败载荷' })), rejectedWrite, 'http://127.0.0.1:43120', dependencies)

    expect(rejectedWrite.status).toBe(400)
    expect(record).toHaveBeenCalledTimes(4)
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ actionCode: 'content.review.updated', target: { type: 'article', id: '42' }, outcome: 'succeeded', changes: [{ field: 'reviewStatus', before: 'pending', after: 'approved' }] }),
      expect.objectContaining({ actionCode: 'content.platforms.updated', target: { type: 'article', id: '42' }, outcome: 'succeeded', changes: [{ field: 'platformCount', before: 0, after: 2 }] }),
      expect.objectContaining({ actionCode: 'content.publish.executed', target: { type: 'article', id: '42' }, outcome: 'partial', effects: [{ target: 'website', outcome: 'succeeded' }, { target: 'xiaohongshu', outcome: 'requires_user_login' }] }),
      expect.objectContaining({ actionCode: 'content.platforms.updated', target: { type: 'article', id: '42' }, outcome: 'failed', errorCode: 'request_fields_invalid' }),
    ])
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/企业 AI 助手选型指南|# 正文|摘要|敏感失败载荷/u)
  })
})
