import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const root = new URL('../', import.meta.url)

const escape = token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('publishes a web plugin with a bundle patch and client entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-xhs-operation')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.ok(Array.isArray(manifest.dsh.client.inject))
})

test('registers menu at order 41 and renders the three-region overlay', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of [
    'order: 41',
    'sidebar.footer.action',
    'shell.overlay',
    'IconEditOutline16',
    'IconCloseOutline16',
    'MarkdownText',
    '/api/desktop/yootun/xhs-operation',
    '/_dsh/uploader/pick-file',
    '/_dsh/uploader/upload',
    '小红书仿写',
    '开始仿写',
    '正在仿写',
    'coverIndex = 0',
    'versionCount: 3',
    'references',
    'accounts',
    '30000',
  ]) assert.match(source, new RegExp(escape(token), 'u'))
  // 互斥与上限：最多 5 张、视频单选、提交只读当前 Tab
  assert.match(source, /const MAX_IMAGES = 5/)
  assert.match(source, /mediaType === 'images'/)
  assert.match(source, /videoUrl/)
  // 禁止不安全富文本
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|password|cookie/i)
})

test('uses only DSH alpha3 exported icons', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'))
  }
})

test('recovers from transient status failure and surfaces terminal failed/cancelled', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  // 暂态查询失败保留 taskId/idempotencyKey 并按间隔继续重试，不永久卡住
  assert.match(source, /setTaskError\(t\('pollFailed'\)\)/)
  assert.match(source, /setTimeout\(poll, POLL_INTERVAL_MS\)/)
  // 终态 failed/cancelled 展示失败/取消提示（含「创建即终态」分支）
  assert.match(source, /current\.taskStatus === 'cancelled' \? t\('cancelled'\) : t\('failed'\)/)
})
