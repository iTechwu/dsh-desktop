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
    '/_dsh/uploader/uploadStart',
    '/_dsh/uploader/uploadStatus',
    '/_dsh/uploader/media',
    '小红书仿写',
    '开始仿写',
    '正在仿写',
    '上传图片或者视频素材，根据提供的对标笔记或者账号风格，生成爆款小红书文案',
    'coverIndex = 0',
    'versionCount: 3',
    'references',
    'accounts',
    '15000',
    '取消任务',
    '确认取消当前任务',
  ]) assert.match(source, new RegExp(escape(token), 'u'))
  // 互斥与上限：最多 5 张、视频单选、提交只读当前 Tab
  assert.match(source, /const MAX_IMAGES = 5/)
  assert.match(source, /mediaType === 'images'/)
  assert.match(source, /videoUrl/)
  assert.match(source, /\.yxh-tabs button\[aria-current="true"\]/)
  assert.match(source, /grid-template-columns:minmax\(460px,1\.15fr\) minmax\(420px,\.85fr\)/)
  assert.match(source, /yxh-right-title/)
  assert.match(source, /width:min\(360px,calc\(100vw - 32px\)\)/)
  assert.match(source, /max-width:calc\(100vw - 32px\)/)
  // 禁止不安全富文本
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|password|cookie/i)
})

test('upload experience: per-asset state machine, progress overlay and submit interception', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  // per-asset 状态机 + 350ms 轮询；全局 uploading flag 已移除。
  assert.match(source, /function createUploadManager/)
  assert.match(source, /const UPLOAD_POLL_INTERVAL_MS = 350/)
  assert.match(source, /module\.exports = \{ apply, inject: \['slots', 'locale'\], createTaskMachine, createUploadManager \}/)
  assert.doesNotMatch(source, /setUploading|UPLOAD_SEND/)
  // 已选即预览：本地媒体路由 + 视频首帧定格 + 角标。
  assert.match(source, /localPreviewUrl/)
  assert.match(source, /#t=0\.1/)
  assert.match(source, /preload: 'metadata'/)
  assert.match(source, /yxh-video-badge/)
  // 覆盖式进度条 + 百分比 + 重试中提示。
  assert.match(source, /yxh-progress-fill/)
  assert.match(source, /retrying/)
  assert.match(source, /uploadedBytes/)
  // not_found 只在「从未收到 done」时置 failed（P2 客户端兜底）。
  assert.match(source, /receivedDone/)
  // 「开始仿写」拦截：本次提交素材组存在上传中素材 → 提示并阻止（P5）。
  assert.match(source, /hasUploading\(/)
  assert.match(source, /uploadingBlock/)
  assert.match(source, /当前照片\/视频正在上传中，等待上传完成/)
  assert.match(source, /Uploading in progress — wait for the current photo\/video to finish uploading\./)
  // 按钮不再因上传中被硬禁用，改 aria-disabled + 置灰。
  assert.match(source, /'aria-disabled': uploadingInGroup/)
  assert.match(source, /yxh-submit-wait/)
  assert.doesNotMatch(source, /disabled: buttonDisabled \|\| uploadingInGroup/)
  // 添加按钮只受容量约束，不再因上传中禁用（并发上传）。
  assert.doesNotMatch(source, /disabled: uploading \|\| locked/)
})

test('uses only DSH alpha3 exported icons', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'))
  }
})

test('announces the initial copy result empty state', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /className: 'yxh-state', role: 'status'/u)
  assert.match(source, /'aria-busy': busy \|\| uploadingInGroup/u)
})

test('uses adaptive foregrounds for brand actions', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /\.yxh-submit\{[^}]*background:var\(--dsw-alias-brand-primary\);color:var\(--dsw-alias-label-primary-foreground\)/u)
  assert.match(source, /\.yxh-confirm-primary\{[^}]*background:var\(--dsw-alias-brand-primary\);color:var\(--dsw-alias-label-primary-foreground\)/u)
})
