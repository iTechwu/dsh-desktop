import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'

async function invoke(route, method, body) {
  let status = 0
  let raw = ''
  const req = { method, headers: {} }
  if (body) req[Symbol.asyncIterator] = async function* () { yield JSON.stringify(body) }
  const res = { writeHead(value) { status = value; return this }, end(value = '') { raw += value } }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined }
}

function context(execute) {
  let route
  apply({
    effect(factory) { return factory() },
    logger: { warn() {} },
    tools: {
      schemas() { return [
        { name: 'mcp__geoflow__geoflow_articles_list' },
        { name: 'mcp__geoflow__geoflow_articles_get' },
        { name: 'mcp__geoflow__geoflow_analytics_overview' },
        { name: 'mcp__geoflow__geoflow_analytics_goals' },
        { name: 'mcp__georank__georank_diagnostic_history' },
        { name: 'mcp__georank__georank_list_companies' },
      ] },
      execute,
    },
    webServer: { register(value) { route = value; return () => {} } },
  })
  return () => route
}

test('loads generated article bodies and unlocks channels only after review', async () => {
  const executed = []
  const route = context(async input => {
    executed.push(input)
    if (input.name.endsWith('analytics_overview')) return { kpis: { articles: 15, published: 8 }, publication_trend: [{ date: '2026-09-04', created: 2, published: 1 }], content_funnel: { max: 15, stages: [{ key: 'created', label: '已创建', count: 15 }] }, performance: { success_rate: 92 }, task_health: { active_tasks: 2, failed_jobs: 1 }, distribution_summary: { synced: 6, failed: 1, pending: 2 } }
    if (input.name.endsWith('analytics_goals')) return { month: '2026-09', goals: [{ metric: 'published', target: 30, actual: 8, attainment_pct: 26, pace_pct: 13 }] }
    if (input.name.endsWith('diagnostic_history')) return [{ report_id: 'report-1', url: 'https://yootun.ixicai.cn', status: 'completed', overall_score: 76, created_at: '2026-09-04T01:00:00Z' }]
    if (input.name.endsWith('list_companies')) return { items: [{ id: 'company-1', name: '优惠豚', url: 'https://yootun.ixicai.cn', geo_score: 82, is_geo_certified: true }] }
    if (input.name.endsWith('articles_list')) return { content: [{ type: 'text', text: JSON.stringify({ items: [
      { id: 41, title: '改装避坑指南', status: 'draft', review_status: 'pending' },
      { id: 42, title: '新能源评测', status: 'published', review_status: 'approved' },
    ] }) }] }
    return { content: [{ type: 'text', text: JSON.stringify({ id: input.arguments.article_id, content: `# 正文 ${input.arguments.article_id}`, excerpt: '摘要', humanize_status: 'processed', humanize_score: 18, humanize_classification: 'HUMAN_ONLY', humanize_issues: [{ type: 'rhythm', text: '句式重复', suggestion: '调整长短句节奏' }] }) }] }
  })()

  const state = await invoke(route, 'GET')
  assert.equal(state.body.status, 'ready')
  assert.deepEqual(state.body.dashboard, { articles: 2, pendingReview: 1, reviewed: 1, publishReady: 0 })
  assert.equal(state.body.articles[0].content, '# 正文 41')
  assert.deepEqual(state.body.articles[0].humanize, { status: 'processed', score: 18, classification: 'HUMAN_ONLY', issues: ['句式重复 - 调整长短句节奏'], completedAt: null })
  assert.equal(state.body.platforms.length, 5)
  assert.equal(state.body.sources.geoflow.status, 'ready')
  assert.equal(state.body.sources.geoflow.data.goals[0].target, 30)
  assert.equal(state.body.sources.georank.data.score, 82)
  assert.equal(state.body.sources.georank.data.latestReport.reportId, 'report-1')
  assert.deepEqual(executed.find(call => call.name.endsWith('articles_list')).arguments, { page: 1, per_page: 30 })
  assert.ok(executed.every(call => call.signal instanceof AbortSignal))

  const blocked = await invoke(route, 'POST', { action: 'select_platforms', articleId: 41, platforms: ['website'] })
  assert.equal(blocked.status, 409)
  const approved = await invoke(route, 'POST', { action: 'review_article', articleId: 41, decision: 'approved' })
  assert.equal(approved.body.articles[0].reviewStatus, 'approved')
  const selected = await invoke(route, 'POST', { action: 'select_platforms', articleId: 41, platforms: ['website', 'xiaohongshu'] })
  assert.deepEqual(selected.body.articles[0].selectedPlatforms, ['website', 'xiaohongshu'])
  const published = await invoke(route, 'POST', { action: 'publish_selected', articleId: 41, platforms: ['website', 'xiaohongshu'] })
  assert.deepEqual(published.body.articles[0].platformStatus, { website: 'adapter_pending', xiaohongshu: 'requires_user_login' })
})

test('keeps article review available when GEO insight sources fail', async () => {
  const route = context(async input => {
    if (input.name.endsWith('articles_list')) return { items: [{ id: 91, title: '仍可审核', status: 'draft', review_status: 'pending' }] }
    if (input.name.endsWith('articles_get')) return { id: 91, content: '# 正文' }
    throw new Error('insight_unavailable')
  })()
  const state = await invoke(route, 'GET')
  assert.equal(state.body.articles.length, 1)
  assert.equal(state.body.sources.geoflow.status, 'error')
  assert.equal(state.body.sources.georank.status, 'error')
})

test('returns a stable unavailable or error state without leaking tool failures', async () => {
  let missingRoute
  apply({ effect(factory) { return factory() }, logger: { warn() {} }, tools: { schemas() { return [] } }, webServer: { register(value) { missingRoute = value; return () => {} } } })
  assert.equal((await invoke(missingRoute, 'GET')).body.status, 'unavailable')

  const failingRoute = context(async () => { throw new Error('tool_failed') })()
  const state = await invoke(failingRoute, 'GET')
  assert.equal(state.status, 200)
  assert.equal(state.body.status, 'error')
  assert.deepEqual(state.body.articles, [])
})

test('rejects unknown publishing platforms', async () => {
  const route = context(async input => input.name.endsWith('articles_list')
    ? { items: [{ id: 77, title: '文章', status: 'draft', review_status: 'pending' }] }
    : { id: 77, content: '正文' })()
  await invoke(route, 'POST', { action: 'review_article', articleId: 77, decision: 'approved' })
  const response = await invoke(route, 'POST', { action: 'select_platforms', articleId: 77, platforms: ['unknown'] })
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'error')
})
