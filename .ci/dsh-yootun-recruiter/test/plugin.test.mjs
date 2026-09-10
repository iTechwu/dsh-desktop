import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply, recruiterDataContract } from '../index.js'

const root = new URL('../', import.meta.url)

test('publishes a browser recruiter plugin with a bundle patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-recruiter')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('announces tab-specific empty states', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /className: 'yr-empty yr-empty-compact', role: 'status'/u)
  assert.match(source, /className: 'yr-empty yr-empty-main', role: 'status'/u)
  assert.ok(source.includes("className: 'yr-empty', role: 'status' }, t('emptyActions')"))
  assert.match(source, /className: 'yr-content', 'aria-busy': interactionBusy/u)
})

test('locks recruiter mutations and disables every write surface', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /const loadingRef = useRef\(false\)/u)
  assert.match(source, /if \(loadingRef\.current \|\| busyRef\.current\) return null/u)
  assert.match(source, /const refresh = \(\) => \{ if \(loadingRef\.current \|\| busyRef\.current\) return/u)
  assert.match(source, /const interactionBusy = loading \|\| busy/u)
  assert.match(source, /disabled: busy, onClick: \(\) => void onUpdate\?\.\(\{ action: 'confirm_action'/u)
  assert.match(source, /disabled: busy \|\| knowledge\.status !== 'ready'/u)
  assert.match(source, /disabled: busy \|\| data\.boss\?\.inAppBrowser !== true/u)
  assert.match(source, /className: 'yr-intake-textarea', value: input, disabled: busy/u)
  assert.match(source, /'aria-label': t\('refresh'\), disabled: interactionBusy, onClick: refresh/u)
  assert.match(source, /className: 'yr-inline-error', role: 'alert'/u)
  assert.match(source, /refreshError: '刷新失败，当前仍显示上次数据'/u)
  assert.match(source, /setMessage\(next \? t\('roleGenerated'\) : t\('saveError'\)\)/u)
  assert.match(source, /function SourceBadge\(\{ label, state, t, onClick, disabled \}\)/u)
  assert.match(source, /function Candidates\(\{ data, t, onNavigate, busy \}\)/u)
  assert.match(source, /className: 'yr-filter', value: query, disabled: busy/u)
  assert.match(source, /'data-active': tab === id, 'aria-current': tab === id \? 'page' : undefined, disabled: interactionBusy/u)
  assert.match(source, /\.yr-empty button:disabled,.yr-inline-error button:disabled,.yr-tabs button:disabled,.yr-source-button:disabled,.yr-secondary:disabled,.yr-filter:disabled\{opacity:\.45;cursor:default\}/u)
})

test('uses the shared adaptive foreground for primary actions', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /\.yr-primary\{color:var\(--dsw-alias-label-primary-foreground\)\}/u)
})

test('keeps BOSS actions human-confirmed and does not accept raw PII', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['/api/desktop/yootun/recruiter', 'awaiting_confirmation', 'confirmed_pending_adapter', 'succeeded', 'failed', 'requires_user_login', 'zhipin.com', 'confirm_action', 'loadError', 'yr-status-succeeded', 'HR 知识库', '招聘漏斗', 'sync_boss', 'publish_knowledge', 'yr-source-button', 'importRequirement', 'generateDraft', 'draftFromText', 'yr-intake-grid', 'yr-filter-bar', 'onNavigate', "'aria-label': t('candidates')", "'aria-label': t('stage')", "data.boss?.adapter === 'official'"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /resumeText|password|cookie|二维码内容|聊天正文/iu)
  assert.doesNotMatch(source, /待配置空间|YOOTUN_HR_KNOWLEDGE_SPACE_ID/u)
  assert.doesNotMatch(source, /MODELS_API_KEY|Authorization\s*:/u)
  assert.doesNotMatch(source, /execute_action/u)
})

test('localizes recruiter stages and status enums before rendering them', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['stageSourced', 'stageScreening', 'stageInterview', 'stageOffer', 'stageHired', 'stageArchived', 'roleStatusText', 'employmentText', 'feedbackText']) {
    assert.match(source, new RegExp(token, 'u'))
  }
  assert.match(source, /stageText\(item\.stage, t\)/u)
  assert.match(source, /roleStatusText\(role\.status, t\)/u)
  assert.match(source, /employmentText\(role\.employmentType, t\)/u)
  assert.match(source, /feedbackText\(candidate\.feedbackStatus \|\| 'none', t\)/u)
  assert.match(source, /status === 'confirmed_pending_adapter' \|\| status === 'adapter_pending'/u)
  assert.match(source, /status === 'dismissed' \? t\('dismissed'\) : t\('unknown'\)/u)
  assert.match(source, /\.yr-status-adapter_pending i/u)
  assert.doesNotMatch(source, /h\('strong', null, item\), h\('span'/u)
})

test('labels refresh failures separately from action failures', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /setErrorKind\('refresh'\)/u)
  assert.match(source, /setErrorKind\('action'\)/u)
  assert.match(source, /t\(errorKind === 'refresh' \? 'refreshError' : 'actionError'\)/u)
})

test('declares the Models-authenticated data contract without exposing a client key', async () => {
  assert.deepEqual(recruiterDataContract, {
    auth: 'MODELS_API_KEY',
    syncProvider: 'boss_zhipin',
    knowledgeRoute: 'https://ixicai.cn/mcp/knowledge',
  })
  const source = await readFile(new URL('index.js', root), 'utf8')
  assert.match(source, /credentials\?\.resolve\?\.\('MODELS_API_KEY'\)/u)
  assert.doesNotMatch(source, /172\.30\.30\.11|127\.0\.0\.1|knowledge\.local\.dofe\.ai/u)
})

test('does not query candidate data when the Models credential is unavailable', async () => {
  let route
  let toolCalls = 0
  apply({
    credentials: { async resolve() { return undefined } },
    tools: { schemas() { return [{ name: 'talent_candidates_list' }] }, execute() { toolCalls += 1; throw new Error('must not execute') } },
    webServer: { register(value) { route = value; return () => {} } },
    effect(value) { return value() },
  })
  const response = await invoke(route, 'GET')
  assert.equal(response.status, 503)
  assert.equal(response.body.status, 'unavailable')
  assert.equal(response.body.reason, 'model_api_key_unavailable')
  assert.equal(toolCalls, 0)
})

test('rejects every recruiter mutation before reading its body when the Models credential is unavailable', async () => {
  let route
  apply({
    credentials: { async resolve() { return undefined } },
    tools: { schemas() { return [] } },
    webServer: { register(value) { route = value; return () => {} } },
    effect(value) { return value() },
  })
  const response = await invoke(route, 'POST', { action: 'confirm_action', id: 'action-1' })
  assert.equal(response.status, 503)
  assert.equal(response.body.reason, 'model_api_key_unavailable')
})

async function invoke(route, method, body) {
  let status = 0
  let output = ''
  const req = { method, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) } }
  const res = { writeHead(code) { status = code }, end(value) { output = value || '' } }
  await route.handler(req, res)
  return { status, body: output ? JSON.parse(output) : null }
}
