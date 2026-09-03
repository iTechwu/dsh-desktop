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

test('keeps BOSS actions human-confirmed and does not accept raw PII', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['/api/desktop/yootun/recruiter', 'awaiting_confirmation', 'confirmed_pending_adapter', 'succeeded', 'failed', 'requires_user_login', 'zhipin.com', 'confirm_action', 'execute_action', 'loadError', 'yr-status-succeeded', 'HR 知识库', '招聘漏斗', 'sync_boss', 'publish_knowledge', "data.boss?.adapter === 'official'"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /resumeText|password|cookie|二维码内容|聊天正文/iu)
  assert.doesNotMatch(source, /MODELS_API_KEY|Authorization\s*:/u)
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
