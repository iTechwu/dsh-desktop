import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, symlink, writeFile, appendFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import test from 'node:test'

import { guessContentType, extensionOf, MEDIA_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../mime.js'
import { loadConfig, DEFAULT_MAX_BYTES, DEFAULT_TOOL_TIMEOUT_MS, MAX_MAX_BYTES, MAX_TOOL_TIMEOUT_MS } from '../config.js'
import { PickedFileStore, validateUploadableFile, revalidateAdmittedFile } from '../allowlist.js'
import { createFilePicker } from '../picker.js'
import { createTosDriver, MAX_UPLOAD_ATTEMPTS, DEFAULT_TIMEOUTS } from '../drivers/tos.js'
import { ERROR_CODES, toPublicCode, makeCodedError } from '../lib/errors.js'
import {
  handlePickFileRequest,
  handleUploadRequest,
  handleUploadStartRequest,
  handleUploadStatusRequest,
  handleMediaRequest,
  PICK_FILE_PATH,
  UPLOAD_PATH,
  UPLOAD_START_PATH,
  UPLOAD_STATUS_PATH,
  MEDIA_PATH,
} from '../routes.js'
import { createUploadRegistry } from '../uploads.js'
import { registerMediaUploadTool } from '../tool.js'
import {
  AUTHORIZE_PUBLIC_NAME,
  findAuthorizeToolName,
  validateAuthorizationResponse,
  authorizeUpload,
  isForbiddenPublicHost,
} from '../authorize.js'
import { apply, inject, name } from '../index.js'

const root = new URL('../', import.meta.url)
const ORIGIN = 'http://127.0.0.1:3000'

// ---------- 测试工具 ----------

function mockReq({ method = 'POST', origin = ORIGIN, body, contentType, remoteAddress = '127.0.0.1', secFetchSite } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const req = Readable.from(chunks)
  req.method = method
  req.headers = { origin }
  if (contentType !== undefined) req.headers['content-type'] = contentType
  if (secFetchSite !== undefined) req.headers['sec-fetch-site'] = secFetchSite
  req.socket = { remoteAddress }
  return req
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key] = value },
    end(payload) { this.body = payload ?? '' },
    json() { return JSON.parse(this.body) },
  }
}

async function tempFile(content = 'demo') {
  const dir = await mkdtemp(join(tmpdir(), 'tos-upload-test-'))
  const path = join(dir, 'video.mp4')
  await writeFile(path, content)
  return { dir, path }
}

/**
 * 起一个本地对象存储替身：接收 PUT，记录请求头/体/方法/URL，可编程返回状态码与 ETag。
 */
async function startStorageServer() {
  const requests = []
  const state = { status: 200, etag: undefined, seq: [], hold: 0 }
  const held = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      requests.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks) })
      if (state.hold > 0) {
        state.hold--
        held.push(res)
        return
      }
      const status = state.seq.length > 0 ? (state.seq.shift() ?? 200) : state.status
      res.writeHead(status, state.etag ? { etag: state.etag } : undefined)
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    requests,
    state,
    held,
    endpoint: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => { for (const res of held) res.end(); server.close(resolve) }),
  }
}

/** 预签名 PUT 直传 target（driver 唯一入参形状）。 */
function uploadTarget(server, overrides = {}) {
  return {
    url: `${server.endpoint}/yootun/uploads/x.mp4`,
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    ...overrides,
  }
}

/** 一份结构合法的授权响应（expiresAt 动态、其余固定）。 */
function validAuth(overrides = {}) {
  return {
    method: 'PUT',
    url: 'https://tos-s3-cn-beijing.volces.com/dofe-transcode/yootun/uploads/uuid.mp4?X-Amz-Signature=abc',
    headers: { 'Content-Type': 'video/mp4' },
    objectKey: 'yootun/uploads/t-abc/2026/09/uuid.mp4',
    publicUrl: 'https://cdn.example.com/media/uuid.mp4',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    maxBytes: 524288000,
    ...overrides,
  }
}

/** 授权工具替身（schemas + execute），缺省返回合法授权。 */
function okTools(overrides = {}) {
  return {
    schemas: () => overrides.schemas ?? [{ name: AUTHORIZE_PUBLIC_NAME }],
    execute: async (input) => {
      if (overrides.execute) return overrides.execute(input)
      return { isError: false, value: { content: [{ type: 'text', text: JSON.stringify(validAuth()) }] } }
    },
  }
}

function okDriver() {
  return {
    destroyed: 0,
    async upload() { return {} },
    destroy() { this.destroyed++ },
  }
}

// ---------- 清单与结构 ----------

test('publishes a host-only plugin manifest without client declaration or runtime deps', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-tos-upload')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client, undefined)
  assert.equal(manifest.dependencies, undefined, '纯宿主插件必须零运行时依赖')
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /name: '@dofe\/dsh-yootun-tos-upload'/u)
  assert.doesNotMatch(patch, /backend/u, '不再配置 backend')
  assert.doesNotMatch(patch, /bucket/u, '不再配置桶')
  assert.doesNotMatch(patch, /region/u, '不再配置地域')
  assert.doesNotMatch(patch, /keyPrefix/u, '不再配置 key 前缀')
  assert.doesNotMatch(patch, /accessKeyId: \S+/u, 'cordis.patch.yml 不得写入明文 AK')
  assert.doesNotMatch(patch, /accessKeySecret: \S+/u, 'cordis.patch.yml 不得写入明文 SK')
  assert.deepEqual(inject, ['webServer', 'tools', 'yootunAudit'], '硬依赖包含审计服务')
  assert.equal(name, 'yootun-tos-upload')
})

test('every shipped source file is valid JavaScript', async () => {
  const files = ['index.js', 'config.js', 'mime.js', 'allowlist.js', 'picker.js', 'routes.js', 'tool.js', 'authorize.js', 'uploads.js', 'lib/errors.js', 'drivers/tos.js', 'drivers/types.js', 'lib/client.js']
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, root))], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${file}: ${result.stderr}`)
  }
})

test('never embeds CI addresses or third-party MCP endpoints', async () => {
  for (const file of ['index.js', 'config.js', 'mime.js', 'picker.js', 'routes.js', 'tool.js', 'authorize.js', 'lib/errors.js', 'drivers/tos.js']) {
    const source = await readFile(new URL(file, root), 'utf8')
    assert.doesNotMatch(source, /172\.30\.30\.11/u, file)
  }
})

// ---------- 统一错误模型 ----------

test('error model exposes a fixed code set and normalizes internal codes', () => {
  assert.equal(ERROR_CODES.length, 13)
  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length, '错误码不允许重复')

  assert.equal(toPublicCode({ code: 'file_too_large' }), 'file_too_large', '固定码原样透传')
  assert.equal(toPublicCode({ code: 'upload_authorization_invalid' }), 'upload_authorization_invalid', '授权非法码原样透传')
  assert.equal(toPublicCode({ name: 'AbortError' }), 'upload_cancelled')
  assert.equal(toPublicCode({ code: 'ABORT_ERR' }), 'upload_cancelled')
  assert.equal(toPublicCode({ isTimeout: true }), 'upload_timeout')
  assert.equal(toPublicCode({ code: 'symlink_rejected' }), 'file_not_found', '安全拒绝码不外泄细节')
  assert.equal(toPublicCode({ code: 'not_a_regular_file' }), 'file_not_found')
  assert.equal(toPublicCode({ code: 'path_not_admitted' }), 'file_not_found')
  assert.equal(toPublicCode({ code: 'ENOENT' }), 'file_not_found')
  assert.equal(toPublicCode({ statusCode: 403 }), 'storage_auth_failed')
  assert.equal(toPublicCode({ statusCode: 503 }), 'storage_unavailable')
  assert.equal(toPublicCode({ statusCode: 429 }), 'storage_unavailable')
  assert.equal(toPublicCode({ isStorageNetwork: true }), 'storage_unavailable')
  assert.equal(toPublicCode({ statusCode: 400 }), 'upload_failed')
  assert.equal(toPublicCode(new TypeError('x')), 'upload_failed')
  assert.equal(toPublicCode({ code: 'upload_failed' }), 'upload_failed')
})

// ---------- mime ----------

test('infers content type and extensions for the server allowlist only', () => {
  assert.equal(guessContentType('a/b/cover.JPG'), 'image/jpeg')
  assert.equal(guessContentType('intro.mp4'), 'video/mp4')
  assert.equal(guessContentType('clip.mov'), 'video/quicktime')
  assert.equal(guessContentType('no-extension'), 'application/octet-stream')
  assert.equal(extensionOf('archive.tar.gz'), 'gz')
  assert.ok(MEDIA_EXTENSIONS.includes('mp4'))
  assert.ok(MEDIA_EXTENSIONS.includes('png'))
  assert.ok(MEDIA_EXTENSIONS.includes('mov'))
  assert.equal(MEDIA_EXTENSIONS.includes('webm'), false, 'webm 不在服务端 allowlist')
  assert.equal(MEDIA_EXTENSIONS.includes('gif'), false, 'gif 不在服务端 allowlist')
  assert.equal(MEDIA_EXTENSIONS.includes('mkv'), false, 'mkv 不在服务端 allowlist')
  assert.deepEqual(IMAGE_EXTENSIONS, ['jpg', 'jpeg', 'png', 'webp'])
  assert.deepEqual(VIDEO_EXTENSIONS, ['mp4', 'mov'])
})

// ---------- config ----------

test('loadConfig returns limits/tool defaults and is ready', () => {
  const config = loadConfig({})
  assert.equal(config.ready, true)
  assert.deepEqual(config.errors, [])
  assert.equal(config.limits.maxBytes, DEFAULT_MAX_BYTES)
  assert.equal(config.tool.timeoutMs, DEFAULT_TOOL_TIMEOUT_MS)
})

test('loadConfig honors loader row config and rejects invalid values', () => {
  const config = loadConfig({ limits: { maxBytes: 524288000 }, tool: { timeoutMs: 1800000 } })
  assert.equal(config.ready, true)
  assert.deepEqual(config.errors, [])
  assert.equal(config.limits.maxBytes, 524288000)
  assert.equal(config.tool.timeoutMs, 1800000)

  const cases = [
    [{ limits: { maxBytes: -1 } }, 'invalid limits.maxBytes'],
    [{ limits: { maxBytes: MAX_MAX_BYTES + 1 } }, 'invalid limits.maxBytes'],
    [{ tool: { timeoutMs: 0 } }, 'invalid tool.timeoutMs'],
    [{ tool: { timeoutMs: MAX_TOOL_TIMEOUT_MS + 1 } }, 'invalid tool.timeoutMs'],
  ]
  for (const [row, expected] of cases) {
    const c = loadConfig(row)
    assert.equal(c.ready, false, JSON.stringify(row))
    assert.ok(c.errors.some((problem) => problem.includes(expected)), `${expected}: ${JSON.stringify(c.errors)}`)
  }
})

test('loadConfig ignores legacy backend/credential/tos fields entirely', () => {
  const config = loadConfig({
    backend: 'tos',
    tos: { bucket: 'dofe-transcode', region: 'cn-beijing', endpoint: 'https://x', keyPrefix: 'a', accessKeyId: 'ak', accessKeySecret: 'sk' },
    accessKeyId: 'leak',
  })
  assert.equal(config.ready, true)
  assert.deepEqual(config.errors, [], '遗留字段既不报错也不生效')
  assert.equal(config.backend, undefined)
  assert.equal(config.tos, undefined)
})

// ---------- 授权校验 ----------

test('validateAuthorizationResponse accepts a well-formed PUT authorization', () => {
  const auth = validAuth()
  const out = validateAuthorizationResponse(auth, { contentType: 'video/mp4', size: 1000 })
  assert.equal(out.method, 'PUT')
  assert.equal(out.url, auth.url)
  assert.equal(out.publicUrl, auth.publicUrl)
  assert.equal(out.maxBytes, 524288000)
})

test('validateAuthorizationResponse rejects method/url/expiry/size/mime violations', () => {
  const base = validAuth()
  const meta = { contentType: 'video/mp4', size: 1000 }
  const cases = [
    [{ method: 'POST' }, 'method'],
    [{ url: 'http://insecure.example.com/x' }, '非 HTTPS'],
    [{ url: 'http://127.0.0.1:9000/x' }, 'loopback'],
    [{ url: 'https://192.168.1.10/x' }, '私网'],
    [{ url: 'https://100.64.0.1/x' }, 'CGNAT'],
    [{ publicUrl: 'http://insecure.example.com/x' }, 'publicUrl 非 HTTPS'],
    [{ expiresAt: new Date(Date.now() - 1000).toISOString() }, '已过期'],
    [{ expiresAt: 'not-a-date' }, '非法日期'],
    [{ maxBytes: 0 }, 'maxBytes 非法'],
    [{ maxBytes: 10 }, 'size 超 maxBytes'],
    [{ headers: { 'Content-Type': 'image/png' } }, 'MIME 不一致'],
  ]
  for (const [patch, label] of cases) {
    assert.throws(
      () => validateAuthorizationResponse({ ...base, ...patch }, meta),
      (err) => err.code === 'upload_authorization_invalid',
      label,
    )
  }
})

test('isForbiddenPublicHost rejects loopback/private/link-local/CGNAT', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '172.30.30.11', '192.168.1.1', '169.254.1.1', '100.64.0.1', 'fe80::1', 'fd00::1']) {
    assert.equal(isForbiddenPublicHost(host), true, host)
  }
  for (const host of ['tos-s3-cn-beijing.volces.com', 'cdn.example.com', 'media.example.cn', '52.1.2.3', '8.8.8.8']) {
    assert.equal(isForbiddenPublicHost(host), false, host)
  }
})

test('findAuthorizeToolName locates exact name and falls back to suffix', () => {
  const exact = { schemas: () => [{ name: 'mcp__other__x' }, { name: AUTHORIZE_PUBLIC_NAME }] }
  assert.equal(findAuthorizeToolName(exact), AUTHORIZE_PUBLIC_NAME)

  const suffix = { schemas: () => [{ name: 'mcp__custom-server__tos_upload_authorize' }] }
  assert.equal(findAuthorizeToolName(suffix), 'mcp__custom-server__tos_upload_authorize')

  assert.equal(findAuthorizeToolName({ schemas: () => [] }), null)
  assert.equal(findAuthorizeToolName({}), null)
})

test('authorizeUpload sends only file metadata and returns the validated auth', async () => {
  const auth = validAuth()
  const calls = []
  const tools = {
    schemas: () => [{ name: AUTHORIZE_PUBLIC_NAME }],
    execute: async (input) => { calls.push(input); return { isError: false, value: { content: [{ type: 'text', text: JSON.stringify(auth) }] } } },
  }
  const result = await authorizeUpload(tools, { filename: 'demo.mp4', contentType: 'video/mp4', size: 1000 })
  assert.equal(result.publicUrl, auth.publicUrl)
  assert.equal(result.url, auth.url)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, AUTHORIZE_PUBLIC_NAME)
  assert.deepEqual(calls[0].arguments, { filename: 'demo.mp4', contentType: 'video/mp4', size: 1000 })
  assert.equal('bucket' in calls[0].arguments, false)
  assert.equal('region' in calls[0].arguments, false)
  assert.equal('tenantId' in calls[0].arguments, false)
})

test('authorizeUpload parses structuredContent when present', async () => {
  const auth = validAuth()
  const tools = {
    schemas: () => [{ name: AUTHORIZE_PUBLIC_NAME }],
    execute: async () => ({ isError: false, value: { content: [], structuredContent: auth } }),
  }
  const result = await authorizeUpload(tools, { filename: 'a.mp4', contentType: 'video/mp4', size: 1 })
  assert.equal(result.publicUrl, auth.publicUrl)
})

test('authorizeUpload maps server error codes and falls back to upload_authorization_invalid', async () => {
  for (const [serverCode, publicCode] of [
    ['UPLOAD_SIZE_EXCEEDED', 'file_too_large'],
    ['UPLOAD_TYPE_NOT_ALLOWED', 'extension_not_allowed'],
    ['UNAUTHORIZED', 'storage_auth_failed'],
    ['STORAGE_AUTH_FAILED', 'storage_auth_failed'],
    ['STORAGE_UNAVAILABLE', 'storage_unavailable'],
    ['VALIDATION_ERROR', 'upload_failed'],
  ]) {
    const tools = {
      schemas: () => [{ name: AUTHORIZE_PUBLIC_NAME }],
      execute: async () => ({ isError: true, error: { message: `boom ${serverCode}` }, content: [{ type: 'text', text: `{"error":{"code":"${serverCode}"}}` }] }),
    }
    const err = await authorizeUpload(tools, { filename: 'a.mp4', contentType: 'video/mp4', size: 1 }).then(() => null, (e) => e)
    assert.equal(err.code, publicCode, serverCode)
  }

  const unknown = { schemas: () => [{ name: AUTHORIZE_PUBLIC_NAME }], execute: async () => ({ isError: true, error: { message: 'weird' } }) }
  const err = await authorizeUpload(unknown, { filename: 'a.mp4', contentType: 'video/mp4', size: 1 }).then(() => null, (e) => e)
  assert.equal(err.code, 'upload_authorization_invalid')
})

test('authorizeUpload reports uploader_not_configured when the tool is absent', async () => {
  const err = await authorizeUpload({ schemas: () => [] }, { filename: 'a.mp4', contentType: 'video/mp4', size: 1 }).then(() => null, (e) => e)
  assert.equal(err.code, 'uploader_not_configured')
})

test('authorizeUpload maps transport failures to storage_unavailable', async () => {
  const tools = {
    schemas: () => [{ name: AUTHORIZE_PUBLIC_NAME }],
    execute: async () => { throw new Error('ECONNREFUSED') },
  }
  const err = await authorizeUpload(tools, { filename: 'a.mp4', contentType: 'video/mp4', size: 1 }).then(() => null, (e) => e)
  assert.equal(err.code, 'storage_unavailable')
})

// ---------- 允许清单 ----------

test('store admits and looks up picked files', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  const entry = store.admit(path, { name: 'video.mp4', size: 4 })
  assert.equal(entry.mime, 'video/mp4')
  assert.equal(store.get(path)?.name, 'video.mp4')
  assert.equal(store.get('/etc/passwd'), null)
  store.clear()
  assert.equal(store.get(path), null)
})

test('validateUploadableFile rejects symlink, directory and oversize files', async () => {
  const { dir, path } = await tempFile('12345')
  assert.deepEqual(await validateUploadableFile(path, { maxBytes: 10 }), { ok: true, size: 5 })
  assert.equal((await validateUploadableFile(path, { maxBytes: 4 })).error, 'file_too_large')
  assert.equal((await validateUploadableFile(dir)).error, 'not_a_regular_file')
  assert.equal((await validateUploadableFile(join(dir, 'missing.mp4'))).error, 'file_not_found')
  const link = join(dir, 'link.mp4')
  await symlink(path, link)
  assert.equal((await validateUploadableFile(link)).error, 'symlink_rejected')
})

test('revalidateAdmittedFile detects files replaced after admission (TOCTOU)', async () => {
  const { dir, path } = await tempFile('12345')
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 5 })

  assert.equal((await revalidateAdmittedFile(store, path, { maxBytes: 100 })).ok, true, '未变化时通过')

  await appendFile(path, 'X')
  assert.equal((await revalidateAdmittedFile(store, path, { maxBytes: 100 })).error, 'file_changed', '内容被追加必须判 file_changed')

  await writeFile(path, '1')
  assert.equal((await revalidateAdmittedFile(store, path, { maxBytes: 100 })).error, 'file_changed', '文件被截断也判 file_changed')

  const link = join(dir, 'replaced.mp4')
  await symlink(path, link)
  store.admit(link, { name: 'replaced.mp4', size: 1 })
  await symlink(path, join(dir, 'other'))
  await writeFile(join(dir, 'other'), '99')
  const result = await revalidateAdmittedFile(store, link, { maxBytes: 100 })
  assert.equal(['file_changed', 'symlink_rejected'].includes(result.error ?? ''), true)

  assert.equal((await revalidateAdmittedFile(store, '/nonexistent/x.mp4')).error, 'file_not_found')
  assert.equal((await revalidateAdmittedFile(store, join(dir, 'never-picked.mp4'))).error, 'file_not_found', '未登记路径与不存在同等对待')

  await writeFile(path, '12345')
  const oversize = await revalidateAdmittedFile(store, path, { maxBytes: 3 })
  assert.equal(oversize.error, 'file_too_large')
})

// ---------- picker ----------

function fakeDialog(filePaths, canceled = false) {
  const calls = []
  return {
    calls,
    async showOpenDialog(options) {
      calls.push(options)
      return { canceled, filePaths }
    },
  }
}

test('pickFile admits user selection and coalesces concurrent dialogs', async () => {
  const { path } = await tempFile()
  const dialog = fakeDialog([path])
  const picker = createFilePicker({ dialog })
  assert.equal(picker.available, true)

  const [a, b] = await Promise.all([picker.pickFile(), picker.pickFile()])
  assert.equal(dialog.calls.length, 1, '并发请求合并为一次原生弹窗')
  assert.equal(a.path, path)
  assert.equal(b.path, path)
  assert.equal(a.mime, 'video/mp4')
  assert.equal(picker.store.get(path)?.path, path)

  const options = dialog.calls[0]
  assert.ok(options.properties.includes('openFile'))
  assert.ok(options.filters.length > 0, '必须带扩展名过滤器')
})

test('pickFile returns null on cancel and rejects disallowed extensions', async () => {
  const cancelled = createFilePicker({ dialog: fakeDialog([], true) })
  assert.equal(await cancelled.pickFile(), null)

  const { path } = await tempFile()
  const wrongKind = createFilePicker({ dialog: fakeDialog([path]) })
  await assert.rejects(() => wrongKind.pickFile({ kind: 'image' }), /extension is not allowed/u)

  const unavailable = createFilePicker({ dialog: null })
  assert.equal(unavailable.available, false)
  await assert.rejects(() => unavailable.pickFile(), /unavailable/u)
  assert.equal(toPublicCode({ code: 'picker_unavailable' }), 'picker_unavailable')
})

// ---------- routes ----------

test('pick-file route enforces method, origin and sec-fetch-site', async () => {
  const { path } = await tempFile()
  const picker = createFilePicker({ dialog: fakeDialog([path]) })
  const deps = { expectedOrigin: ORIGIN, pickFile: (req) => picker.pickFile(req) }

  for (const [desc, req, status] of [
    ['GET 拒绝', mockReq({ method: 'GET' }), 405],
    ['Origin 不匹配拒绝', mockReq({ origin: 'http://evil.example' }), 403],
    ['跨站请求拒绝', mockReq({ secFetchSite: 'cross-site' }), 403],
    ['非 loopback 拒绝', mockReq({ remoteAddress: '192.168.1.10' }), 403],
  ]) {
    const res = mockRes()
    await handlePickFileRequest(req, res, deps)
    assert.equal(res.statusCode, status, desc)
  }

  const res = mockRes()
  await handlePickFileRequest(mockReq(), res, deps)
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.picked, true)
  assert.equal(body.path, path)
  assert.equal(body.mime, 'video/mp4')
})

test('pick-file route reports cancel and picker_unavailable', async () => {
  const res1 = mockRes()
  await handlePickFileRequest(mockReq(), res1, {
    expectedOrigin: ORIGIN,
    pickFile: () => createFilePicker({ dialog: fakeDialog([], true) }).pickFile(),
  })
  assert.deepEqual(res1.json(), { picked: false })

  const res2 = mockRes()
  await handlePickFileRequest(mockReq(), res2, {
    expectedOrigin: ORIGIN,
    pickFile: () => createFilePicker({ dialog: null }).pickFile(),
  })
  assert.equal(res2.statusCode, 503)
  assert.equal(res2.json().error, 'picker_unavailable')
})

test('upload route authorizes then streams through the driver and returns the public url', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  const uploads = []
  const driver = { async upload(p, target) { uploads.push([p, target]); return {} } }
  const tools = okTools()
  const auditEvents = []
  const deps = { expectedOrigin: ORIGIN, store, driver, tools, maxBytes: 1024, audit: { async record(event) { auditEvents.push(event) } } }

  const denied = mockRes()
  await handleUploadRequest(mockReq({ body: { path }, contentType: 'application/json' }), denied, deps)
  assert.equal(denied.statusCode, 400)
  assert.equal(denied.json().error, 'file_not_found', '未登记路径不解释允许清单语义')
  assert.equal(uploads.length, 0)
  assert.equal(denied.json().path === undefined, true, '错误响应不得回传本地绝对路径')

  const noType = mockRes()
  await handleUploadRequest(mockReq({ body: { path } }), noType, deps)
  assert.equal(noType.statusCode, 415)

  store.admit(path, { name: 'video.mp4', size: 4 })
  const ok = mockRes()
  await handleUploadRequest(mockReq({ body: { path }, contentType: 'application/json' }), ok, deps)
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().url, 'https://cdn.example.com/media/uuid.mp4')
  assert.equal(ok.json().name, 'video.mp4')
  assert.equal(ok.json().contentType, 'video/mp4')
  assert.equal(ok.json().key, undefined, '不得返回 object key')
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0][1].url, validAuth().url, '直传用授权下发的预签名 URL')
  assert.equal(uploads[0][1].method, 'PUT')
  assert.equal(auditEvents.length, 1)
  assert.deepEqual(auditEvents[0].source, { pluginId: '@dofe/dsh-yootun-tos-upload', pluginVersion: '0.1.0', surface: 'human_ui' })
  assert.equal(auditEvents[0].actionCode, 'media.upload.completed')
  assert.deepEqual(auditEvents[0].changes, [{ field: 'sizeBucket', after: 'under_1mb' }, { field: 'mimeFamily', after: 'video' }])
  assert.doesNotMatch(JSON.stringify(auditEvents), /video\.mp4|X-Amz-Signature|cdn\.example\.com|\/var\//u)

  const down = mockRes()
  await handleUploadRequest(mockReq({ body: { path }, contentType: 'application/json' }), down, { ...deps, driver: null })
  assert.equal(down.statusCode, 503)
  assert.equal(down.json().error, 'uploader_not_configured')
})

test('upload route maps authorize rejection to fixed error codes', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 4 })
  const tools = okTools({ execute: async () => ({ isError: true, error: { message: 'UPLOAD_SIZE_EXCEEDED' } }) })
  let uploaded = 0
  const driver = { async upload() { uploaded++ } }
  const res = mockRes()
  await handleUploadRequest(mockReq({ body: { path }, contentType: 'application/json' }), res, { expectedOrigin: ORIGIN, store, driver, tools, maxBytes: 1024 })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'file_too_large')
  assert.equal(uploaded, 0, '授权被拒后不得直传')
})

test('upload route returns file_changed for files replaced after admission', async () => {
  const { path } = await tempFile('first')
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 5 })
  let uploads = 0
  const deps = {
    expectedOrigin: ORIGIN,
    store,
    driver: { async upload() { uploads++ } },
    tools: okTools(),
    maxBytes: 1024,
  }

  await writeFile(path, 'second-size')
  const res = mockRes()
  await handleUploadRequest(mockReq({ body: { path }, contentType: 'application/json' }), res, deps)
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'file_changed')
  assert.equal(uploads, 0, '文件被替换后禁止继续上传')
})

test('upload route maps driver failures to fixed error codes without leaking paths', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 4 })
  const deps = {
    expectedOrigin: ORIGIN,
    store,
    tools: okTools(),
    maxBytes: 1024,
    driver: {
      async upload() {
        const error = new Error('storage PUT HTTP 403')
        error.statusCode = 403
        throw error
      },
    },
  }
  const res = mockRes()
  await handleUploadRequest(mockReq({ body: { path }, contentType: 'application/json' }), res, deps)
  assert.equal(res.statusCode, 502)
  assert.equal(res.json().error, 'storage_auth_failed')
  assert.equal(JSON.stringify(res.json()).includes(path), false)
})

// ---------- 预签名 PUT 驱动 ----------

test('driver PUTs the file body to the presigned URL with provided headers and content-length', async () => {
  const server = await startStorageServer()
  server.state.etag = '"abc123"'
  const { path } = await tempFile('hello-tos-body')
  const driver = await createTosDriver()

  const result = await driver.upload(path, uploadTarget(server))
  assert.equal(result.etag, 'abc123')

  assert.equal(server.requests.length, 1)
  const req = server.requests[0]
  assert.equal(req.body.toString(), 'hello-tos-body', '文件体必须流式原样到达')
  assert.equal(req.headers['content-type'], 'video/mp4')
  assert.equal(req.headers['content-length'], String(Buffer.byteLength('hello-tos-body')))
  assert.equal(req.method, 'PUT')
  assert.equal(req.url, '/yootun/uploads/x.mp4')
  assert.equal(req.headers.authorization, undefined, '预签名直传不再自行签名')
  await server.close()
})

test('driver preserves the presigned query string on the request path', async () => {
  const server = await startStorageServer()
  const { path } = await tempFile('query')
  const driver = await createTosDriver()
  await driver.upload(path, uploadTarget(server, { url: `${server.endpoint}/yootun/uploads/x.mp4?X-Amz-Signature=abc123&X-Amz-Expires=1800` }))
  assert.equal(server.requests[0].url, '/yootun/uploads/x.mp4?X-Amz-Signature=abc123&X-Amz-Expires=1800')
  await server.close()
})

test('driver retries 5xx but not 4xx, within a bounded attempt count', async () => {
  const { path } = await tempFile('retry-body')

  const retryServer = await startStorageServer()
  retryServer.state.seq = [503, 503, 200]
  const retryDriver = await createTosDriver()
  await retryDriver.upload(path, uploadTarget(retryServer))
  assert.equal(retryServer.requests.length, 3, '5xx 指数退避重试到成功')
  await retryServer.close()

  const clientErrServer = await startStorageServer()
  clientErrServer.state.status = 403
  const clientErrDriver = await createTosDriver()
  const failure = await clientErrDriver.upload(path, uploadTarget(clientErrServer)).then(() => null, (cause) => cause)
  assert.equal(failure.statusCode, 403)
  assert.equal(toPublicCode(failure), 'storage_auth_failed')
  assert.equal(clientErrServer.requests.length, 1, '403（含签名过期）不重试')
  await clientErrServer.close()
  assert.equal(MAX_UPLOAD_ATTEMPTS, 3, '重试必须有界')
})

test('driver surfaces header timeout as upload_timeout and closes the file stream', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('timeout-body')
  const driver = await createTosDriver({
    timeouts: { connectMs: 1000, headersMs: 120, overallMs: DEFAULT_TIMEOUTS.overallMs },
  })
  const failure = await driver.upload(path, uploadTarget(server)).then(() => null, (cause) => cause)
  assert.notEqual(failure, null, '必须以失败终结')
  assert.equal(failure.isTimeout, true)
  assert.equal(toPublicCode(failure), 'upload_timeout')
  assert.equal(server.requests.length, 1)
  assert.equal(driver.pendingCount, 0, '请求失败后不得悬挂未完成请求')
  await server.close()
})

test('driver surfaces overall timeout as upload_timeout', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('overall-body')
  const driver = await createTosDriver({
    timeouts: { connectMs: 60_000, headersMs: 60_000, overallMs: 100 },
  })
  const failure = await driver.upload(path, uploadTarget(server)).then(() => null, (cause) => cause)
  assert.equal(failure?.isTimeout, true)
  assert.equal(toPublicCode(failure), 'upload_timeout')
  await server.close()
})

test('driver does not fire headers timeout while the body is still uploading', async () => {
  const server = await startStorageServer()
  const SIZE = 256 * 1024
  const { path } = await tempFile('x'.repeat(SIZE))
  let sent = 0
  let pushing = false
  const slowStream = new Readable({
    read() {
      if (pushing) return
      if (sent >= SIZE) {
        this.push(null)
        return
      }
      pushing = true
      setTimeout(() => {
        pushing = false
        const chunk = Math.min(8192, SIZE - sent)
        this.push(Buffer.alloc(chunk, 0x78))
        sent += chunk
      }, 50)
    },
  })
  const driver = await createTosDriver({
    timeouts: { connectMs: 1000, headersMs: 300, overallMs: 30_000 },
    createReadStream: () => slowStream,
  })
  const result = await driver.upload(path, uploadTarget(server))

  assert.ok(result, '慢速请求体不应被误判为响应头超时，上传必须成功')
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0].body.length, SIZE, '请求体必须完整到达')
  await server.close()
})

test('driver fires connect timeout even if the body finished before connecting', async () => {
  const { path } = await tempFile('tiny')
  const neverConnectingTransport = {
    request(options, cb) {
      const req = new Writable({ write(chunk, enc, next) { next() } })
      process.nextTick(() => req.emit('socket', { connecting: true, once() {} }))
      return req
    },
  }
  const driver = await createTosDriver({
    timeouts: { connectMs: 120, headersMs: 60_000, overallMs: 60_000 },
    transport: neverConnectingTransport,
  })
  const failure = await driver.upload(path, uploadTarget({ endpoint: 'http://unused' })).then(() => null, (cause) => cause)
  assert.notEqual(failure, null, '连接无法建立时必须失败')
  assert.equal(failure?.isTimeout, true)
  assert.match(failure?.message, /establishing connection/, '必须由 connect 超时触发')
  assert.equal(toPublicCode(failure), 'upload_timeout')
})

test('driver still returns upload_timeout after body completes and no response headers arrive', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('after-finish-body')
  const driver = await createTosDriver({
    timeouts: { connectMs: 1000, headersMs: 150, overallMs: DEFAULT_TIMEOUTS.overallMs },
  })
  const failure = await driver.upload(path, uploadTarget(server)).then(() => null, (cause) => cause)
  assert.equal(failure?.isTimeout, true)
  assert.equal(toPublicCode(failure), 'upload_timeout')
  await server.close()
})

test('driver destroy() cancels in-flight uploads (plugin unload path)', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('cancel-body')
  const driver = await createTosDriver()
  const pending = driver.upload(path, uploadTarget(server))
  for (let i = 0; i < 100 && server.requests.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(server.requests.length, 1)
  driver.destroy()
  const failure = await Promise.race([
    pending.then(() => null, (cause) => cause),
    new Promise((resolve) => setTimeout(() => resolve('not-cancelled'), 2000)),
  ])
  assert.notEqual(failure, null, 'destroy 必须取消未完成上传')
  assert.equal(toPublicCode(failure), 'upload_cancelled')
  assert.equal(driver.pendingCount, 0)
  await server.close()
})

test('driver maps abort signal cancellation to upload_cancelled', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('signal-body')
  const driver = await createTosDriver()
  const controller = new AbortController()
  const pending = driver.upload(path, uploadTarget(server), controller.signal)
  setTimeout(() => controller.abort(), 50)
  const failure = await pending.then(() => null, (cause) => cause)
  assert.equal(toPublicCode(failure), 'upload_cancelled')
  assert.equal(driver.pendingCount, 0)
  await server.close()
})

// ---------- 宿主装配（agent 工具 + 路由注册） ----------

function mockCtx(overrides = {}) {
  const registered = { routes: new Map(), tools: new Map(), sections: [] }
  const systemPromptService = overrides.systemPromptService === undefined
    ? {
        section(section) {
          registered.sections.push(section)
          return () => {
            const index = registered.sections.indexOf(section)
            if (index >= 0) registered.sections.splice(index, 1)
          }
        },
      }
    : overrides.systemPromptService
  const ctx = {
    yootunAudit: { async record(event) { overrides.auditEvents?.push(event) } },
    get(service) {
      if (service === 'systemPrompt') return systemPromptService
      return undefined
    },
    webServer: overrides.webServer === null
      ? undefined
      : {
          port: 3000,
          register(route) {
            registered.routes.set(route.path, route.handler)
            return () => registered.routes.delete(route.path)
          },
        },
    tools: {
      register(tool) {
        if (overrides.toolRegisterThrows) throw new Error('boom from tools.register')
        registered.tools.set(tool.name, tool)
        return () => registered.tools.delete(tool.name)
      },
      schemas: () => overrides.toolSchemas ?? [{ name: AUTHORIZE_PUBLIC_NAME }],
      execute: async (input) => {
        if (overrides.toolExecute) return overrides.toolExecute(input)
        return { isError: false, value: { content: [{ type: 'text', text: JSON.stringify(validAuth()) }] } }
      },
    },
    logger: {
      warnings: [],
      errors: [],
      warn(...args) { this.warnings.push(args.join(' ')) },
      error(...args) { this.errors.push(args.join(' ')) },
    },
  }
  return { ctx, registered }
}

test('apply registers both routes and the media_upload tool, and uploads via authorize + driver', async () => {
  const { path } = await tempFile()
  const auditEvents = []
  const { ctx, registered } = mockCtx({ auditEvents })
  const calls = []
  const driver = {
    destroyed: 0,
    async upload(p, target) { calls.push([p, target]); return {} },
    destroy() { this.destroyed++ },
  }
  const dispose = await apply(ctx, { tool: { timeoutMs: 12345 } }, { dialog: fakeDialog([path]), driver })

  assert.ok(registered.routes.has(PICK_FILE_PATH))
  assert.ok(registered.routes.has(UPLOAD_PATH))
  const tool = registered.tools.get('media_upload')
  assert.ok(tool, 'media_upload 工具必须注册')
  assert.deepEqual(Object.keys(tool.parameters.properties), ['kind'])
  assert.equal(tool.parameters.additionalProperties, false)
  assert.equal(tool.timeoutMs, 12345, 'Loader 行 config.tool.timeoutMs 必须生效')

  const result = await tool.execute({ kind: 'video' }, {})
  assert.equal(result.ok, true)
  assert.equal(result.url, 'https://cdn.example.com/media/uuid.mp4')
  assert.equal(result.contentType, 'video/mp4')
  assert.equal(result.name, 'video.mp4')
  assert.equal(result.key, undefined, '工具结果不得暴露 object key')
  assert.equal(JSON.stringify(result).includes(path), false, '工具结果不得泄露本地路径')
  assert.equal(JSON.stringify(result).includes('X-Amz-Signature'), false, '工具结果不得泄露预签名 URL')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].method, 'PUT')
  assert.equal(auditEvents.length, 1)
  assert.equal(auditEvents[0].source.surface, 'agent_tool')
  assert.doesNotMatch(JSON.stringify(auditEvents), /video\.mp4|X-Amz-Signature|cdn\.example\.com|\/var\//u)

  const dispose2 = await apply(ctx, {}, { dialog: fakeDialog([], true), driver })
  const cancelled = await registered.tools.get('media_upload').execute({}, {})
  assert.deepEqual(cancelled, { ok: false, error: 'user_cancelled' })

  dispose()
  dispose2()
  assert.equal(registered.routes.size, 0, 'dispose 后路由必须注销')
})

test('apply never reads ctx.config (Cordis would throw without inject)', async () => {
  const { ctx } = mockCtx()
  Object.defineProperty(ctx, 'config', {
    get() { throw new Error('cannot get property "config" without inject') },
  })
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([], true), driver: okDriver() })
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('apply degrades cleanly on invalid loader config', async () => {
  const { ctx, registered } = mockCtx()
  const dispose = await apply(ctx, { limits: { maxBytes: -1 } }, { dialog: fakeDialog([], true) })
  const result = await registered.tools.get('media_upload').execute({}, {})
  assert.deepEqual(result, { ok: false, error: 'uploader_not_configured' })
  dispose()
})

test('apply loads without a system prompt service', async () => {
  const { ctx, registered } = mockCtx({ systemPromptService: null })
  assert.equal(registered.sections.length, 0)
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([], true), driver: okDriver() })
  const tool = registered.tools.get('media_upload')
  assert.ok(tool, '没有 system prompt 时工具仍必须注册')
  dispose()
})

test('apply degrades to uploader_not_configured when the authorize tool is absent', async () => {
  const { path } = await tempFile()
  const { ctx, registered } = mockCtx({ toolSchemas: [] })
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([path]), driver: okDriver() })
  const result = await registered.tools.get('media_upload').execute({}, {})
  assert.deepEqual(result, { ok: false, error: 'uploader_not_configured' })
  dispose()
})

test('apply rolls back all registrations when a registration step throws', async () => {
  const { ctx, registered } = mockCtx({ toolRegisterThrows: true })
  const driver = okDriver()
  await assert.rejects(() => apply(ctx, {}, { driver }))
  assert.equal(registered.routes.size, 0, '工具注册失败时路由必须全部回滚')
  assert.equal(driver.destroyed, 1, '回滚必须释放驱动')
})

test('apply leaves no duplicate tools or routes across reloads', async () => {
  const { ctx, registered } = mockCtx()
  const driver = okDriver()
  const dispose1 = await apply(ctx, {}, { dialog: fakeDialog([], true), driver })
  const firstTool = registered.tools.get('media_upload')
  const dispose2 = await apply(ctx, {}, { dialog: fakeDialog([], true), driver })
  const secondTool = registered.tools.get('media_upload')

  assert.notEqual(firstTool, secondTool, '重载后必须替换为新工具实例')
  assert.equal(registered.tools.size, 1, '同名工具只允许存在一个')
  assert.equal(registered.routes.size, 5, '同路径路由只允许一组（pick-file/upload/uploadStart/uploadStatus/media）')
  assert.equal(registered.sections.filter((section) => section.name === 'tool:media-upload').length, 2, '重载期新旧 prompt 区块共存')

  dispose1()
  assert.equal(registered.tools.size, 0, '旧工具注销后宿主里没有 media_upload')
  assert.equal(registered.routes.size, 0)
  assert.equal(registered.sections.length, 1, '旧实例的 prompt 区块注销，新实例的保留')
  dispose2()
  assert.equal(registered.sections.length, 0)
  assert.equal(driver.destroyed, 2)
})

test('tool returns structured fixed codes for picker and storage failures', async () => {
  const { ctx, registered } = mockCtx()
  const driver = {
    async upload() {
      const error = new Error('storage PUT HTTP 403')
      error.statusCode = 403
      throw error
    },
  }
  const { path } = await tempFile('tool-403')
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([path]), driver })
  const tool = registered.tools.get('media_upload')
  const result = await tool.execute({}, {})
  assert.deepEqual(result, { ok: false, error: 'storage_auth_failed' })
  assert.equal(JSON.stringify(result).includes(path), false, '工具结果不得携带本地路径')
  dispose()

  const { ctx: ctx2, registered: registered2 } = mockCtx()
  const dispose2 = await apply(ctx2, {}, { dialog: null, driver: okDriver() })
  const result2 = await registered2.tools.get('media_upload').execute({}, {})
  assert.deepEqual(result2, { ok: false, error: 'picker_unavailable' })
  dispose2()
})

test('tool reports file_changed when the picked file is swapped before upload', async () => {
  const { path } = await tempFile('original')
  const store = new PickedFileStore()
  const realAdmit = store.admit.bind(store)
  store.admit = (admitPath, meta) => realAdmit(admitPath, { ...meta, size: (meta?.size ?? 0) + 1 })

  const tools = new Map()
  registerMediaUploadTool(
    { tools: { register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } },
    {
      picker: createFilePicker({ dialog: fakeDialog([path]), store }),
      driver: okDriver(),
      tools: okTools(),
      store,
      maxBytes: 1024 * 1024,
      timeoutMs: 60_000,
      logger: { warn() {}, error() {} },
    },
  )
  const result = await tools.get('media_upload').execute({}, {})
  assert.deepEqual(result, { ok: false, error: 'file_changed' })
})

test('tool maps an authorize failure to the server-derived code', async () => {
  const { path } = await tempFile('ok-body')
  const { ctx, registered } = mockCtx({
    toolExecute: async () => ({ isError: true, error: { message: 'UPLOAD_TYPE_NOT_ALLOWED' } }),
  })
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([path]), driver: okDriver() })
  const result = await registered.tools.get('media_upload').execute({}, {})
  assert.deepEqual(result, { ok: false, error: 'extension_not_allowed' })
  dispose()
})

// ---------- 进度与重试回调（docs/0907/xhs 测试计划锚点 3） ----------

test('driver reports throttled progress during upload and finishes at total bytes', async () => {
  const server = await startStorageServer()
  const SIZE = 64 * 1024
  const { path } = await tempFile('y'.repeat(SIZE))
  let sent = 0
  const slowStream = new Readable({
    read() {
      if (sent >= SIZE) {
        this.push(null)
        return
      }
      setTimeout(() => {
        const chunk = Math.min(8192, SIZE - sent)
        this.push(Buffer.alloc(chunk, 0x79))
        sent += chunk
      }, 30)
    },
  })
  const driver = await createTosDriver({ createReadStream: () => slowStream })
  const events = []
  await driver.upload(path, uploadTarget(server), undefined, {
    onProgress: (progress) => events.push({ ...progress }),
  })

  assert.ok(events.length >= 2, `进度回调必须至少出现首帧与终帧两次（实际 ${events.length}）`)
  for (const event of events) {
    assert.equal(event.bytesTotal, SIZE, '每次回调都带 bytesTotal')
  }
  const written = events.map((event) => event.bytesWritten)
  for (let i = 1; i < written.length; i++) {
    assert.ok(written[i] >= written[i - 1], 'bytesWritten 单调不减')
  }
  assert.equal(written[0], 0, '首个进度从 0 开始')
  assert.equal(written[written.length - 1], SIZE, '终帧进度等于文件总字节')
  assert.equal(server.requests[0].body.length, SIZE, '文件体仍必须完整到达')
  await server.close()
})

test('driver reports attempt increments and resets progress on retry', async () => {
  const server = await startStorageServer()
  server.state.seq = [503, 200]
  const { path } = await tempFile('retry-progress')
  const driver = await createTosDriver()
  const attempts = []
  const progress = []
  await driver.upload(path, uploadTarget(server), undefined, {
    onAttempt: (attempt) => attempts.push(attempt),
    onProgress: (event) => progress.push({ ...event }),
  })
  assert.deepEqual(attempts, [0, 1], '重试时 attempt 递增')
  // 第二次尝试开始时进度必须归零（客户端可显示「重试中」）。
  const firstRetryProgress = progress.find((event) => event.bytesWritten === 0 && progress.indexOf(event) > 0)
  assert.ok(firstRetryProgress, '重试开始时必须存在 bytesWritten=0 的归零回调')
  assert.equal(server.requests.length, 2)
  await server.close()
})

// ---------- uploadStart / uploadStatus 路由契约 ----------

function controlledDriver() {
  const state = { resolve: null, reject: null }
  const uploads = []
  const driver = {
    destroyed: 0,
    upload(path, target, signal, handlers) {
      uploads.push({ path, target, signal, handlers })
      handlers?.onAttempt?.(0)
      handlers?.onProgress?.({ bytesWritten: 0, bytesTotal: 100 })
      return new Promise((resolve, reject) => {
        state.resolve = resolve
        state.reject = reject
      })
    },
    destroy() { this.destroyed++ },
  }
  return {
    driver,
    uploads,
    succeed() { state.resolve({ etag: 'ok' }) },
    fail(cause) { state.reject(cause ?? new Error('boom')) },
  }
}

async function flushAsync(times = 4) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve))
}

function startDeps(overrides = {}) {
  const controlled = overrides.driver ? null : controlledDriver()
  const auditEvents = []
  const registry = overrides.registry ?? createUploadRegistry({
    driver: overrides.driver ?? controlled.driver,
    doneTtlMs: overrides.doneTtlMs ?? 60_000,
    orphanMs: overrides.orphanMs ?? 30 * 60_000,
    sweepMs: 0,
    now: overrides.now,
    audit: { async record(event) { auditEvents.push(event) } },
    logger: { warn() {}, error() {} },
  })
  return {
    controlled,
    auditEvents,
    registry,
    deps: {
      expectedOrigin: ORIGIN,
      store: overrides.store,
      driver: overrides.driver ?? controlled.driver,
      tools: overrides.tools ?? okTools(),
      maxBytes: 1024,
      registry,
      audit: { async record(event) { auditEvents.push(event) } },
      logger: { warn() {}, error() {} },
    },
  }
}

test('uploadStart authorizes, launches in background and returns uploadId immediately', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 4 })
  const { controlled, deps, registry } = startDeps({ store })

  const res = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json' }), res, deps)
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(typeof body.uploadId, 'string')
  assert.ok(body.uploadId.length > 0)
  assert.equal(body.name, 'video.mp4')
  assert.equal(body.size, 4)
  assert.equal(body.mime, 'video/mp4')
  assert.equal(JSON.stringify(body).includes(path), false, '响应不得回传本地绝对路径')
  assert.equal(controlled.uploads.length, 1, '后台上传已启动')
  assert.equal(controlled.uploads[0].target.method, 'PUT')

  // 轮询：uploading -> done（含公网 URL，且不泄漏预签名 URL/路径）。
  const polling = mockRes()
  await handleUploadStatusRequest(mockReq({ body: { uploadId: body.uploadId }, contentType: 'application/json' }), polling, { expectedOrigin: ORIGIN, registry })
  assert.equal(polling.json().status, 'uploading')
  assert.equal(polling.json().attempt, 0)
  assert.equal(typeof polling.json().progress, 'number')

  controlled.succeed()
  await flushAsync()
  const doneRes = mockRes()
  await handleUploadStatusRequest(mockReq({ body: { uploadId: body.uploadId }, contentType: 'application/json' }), doneRes, { expectedOrigin: ORIGIN, registry })
  const done = doneRes.json()
  assert.equal(done.status, 'done')
  assert.equal(done.progress, 100)
  assert.equal(done.url, 'https://cdn.example.com/media/uuid.mp4')
  assert.equal(done.name, 'video.mp4')
  assert.equal(JSON.stringify(done).includes('X-Amz-Signature'), false, 'done 响应不得泄漏预签名 URL')
  registry.destroy()
})

test('uploadStart fails fast on unadmitted path, driverless host and authorize rejection', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  const { deps } = startDeps({ store })

  const unadmitted = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json' }), unadmitted, deps)
  assert.equal(unadmitted.statusCode, 400)
  assert.equal(unadmitted.json().error, 'file_not_found', '未登记路径不解释允许清单语义')

  store.admit(path, { name: 'video.mp4', size: 4 })
  const noDriver = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json' }), noDriver, { ...deps, driver: null })
  assert.equal(noDriver.statusCode, 503)
  assert.equal(noDriver.json().error, 'uploader_not_configured')

  const rejectedTools = okTools({ execute: async () => ({ isError: true, error: { message: 'UPLOAD_SIZE_EXCEEDED' } }) })
  const rejected = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json' }), rejected, { ...deps, tools: rejectedTools })
  assert.equal(rejected.statusCode, 400)
  assert.equal(rejected.json().error, 'file_too_large')

  const badBody = mockRes()
  await handleUploadStartRequest(mockReq({ body: {}, contentType: 'application/json' }), badBody, deps)
  assert.equal(badBody.statusCode, 400)
})

test('uploadStatus maps background failure to fixed error code and records audit', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 4 })
  const { controlled, auditEvents, deps, registry } = startDeps({ store })

  const started = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json' }), started, deps)
  const { uploadId } = started.json()

  controlled.fail(Object.assign(new Error('storage PUT HTTP 503'), { statusCode: 503, isStorageNetwork: true }))
  await flushAsync()
  const res = mockRes()
  await handleUploadStatusRequest(mockReq({ body: { uploadId }, contentType: 'application/json' }), res, { expectedOrigin: ORIGIN, registry })
  const body = res.json()
  assert.equal(body.status, 'failed')
  assert.equal(body.error, 'storage_unavailable')
  assert.equal(JSON.stringify(body).includes(path), false)

  await flushAsync()
  assert.ok(auditEvents.some((event) => event.outcome === 'failed' && event.source.surface === 'human_ui'), '后台上传失败必须落审计（P7）')
  assert.doesNotMatch(JSON.stringify(auditEvents), /video\.mp4|X-Amz-Signature/u, '审计不得带本地路径/签名')
  registry.destroy()
})

test('uploadStatus returns not_found for unknown ids and rejects invalid bodies', async () => {
  const { deps, registry } = startDeps({ store: new PickedFileStore() })
  const missing = mockRes()
  await handleUploadStatusRequest(mockReq({ body: { uploadId: 'nope' }, contentType: 'application/json' }), missing, { expectedOrigin: ORIGIN, registry })
  assert.equal(missing.statusCode, 200)
  assert.deepEqual(missing.json(), { status: 'not_found' })

  const invalid = mockRes()
  await handleUploadStatusRequest(mockReq({ body: {}, contentType: 'application/json' }), invalid, { expectedOrigin: ORIGIN, registry })
  assert.equal(invalid.statusCode, 400)

  const wrongMethod = mockReq({ method: 'GET', body: { uploadId: 'x' }, contentType: 'application/json' })
  const wrongMethodRes = mockRes()
  await handleUploadStatusRequest(wrongMethod, wrongMethodRes, { expectedOrigin: ORIGIN, registry })
  assert.equal(wrongMethodRes.statusCode, 405)
  registry.destroy()
})

test('uploadStart rejects cross-site and non-loopback like the v1 upload route', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 4 })
  const { deps } = startDeps({ store })
  const crossSite = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json', secFetchSite: 'cross-site' }), crossSite, deps)
  assert.equal(crossSite.statusCode, 403)
  const external = mockRes({ remoteAddress: '192.168.1.10' })
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json', remoteAddress: '192.168.1.10' }), external, deps)
  assert.equal(external.statusCode, 403)
})

test('uploadStart validates the kind contract and ignores it when absent', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 4 })
  const { deps, registry } = startDeps({ store })

  // 合法 kind（media/image/video）都能正常启动。
  for (const kind of ['media', 'image', 'video']) {
    const ok = mockRes()
    await handleUploadStartRequest(mockReq({ body: { path, kind }, contentType: 'application/json' }), ok, deps)
    assert.equal(ok.statusCode, 200, `kind=${kind} 应被接受`)
    assert.equal(typeof ok.json().uploadId, 'string')
  }
  // 缺省 kind 同样按 media 处理。
  const absent = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json' }), absent, deps)
  assert.equal(absent.statusCode, 200)
  // 非法 kind 按请求错误拒绝（契约防漂移）。
  const bad = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path, kind: 'text' }, contentType: 'application/json' }), bad, deps)
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.json().error, 'invalid_request')
  registry.destroy()
})

test('uploadStatus never leaks path or internal controller through registry.get', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 4 })
  const { deps, registry } = startDeps({ store })

  const started = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json' }), started, deps)
  const { uploadId } = started.json()
  const status = mockRes()
  await handleUploadStatusRequest(mockReq({ body: { uploadId }, contentType: 'application/json' }), status, { expectedOrigin: ORIGIN, registry })
  const payload = status.json()
  assert.equal(payload.status, 'uploading')
  assert.equal('path' in payload, false, 'uploadStatus 响应不得含本地路径')
  assert.equal('controller' in payload, false, 'uploadStatus 响应不得含内部 controller')
  assert.equal(JSON.stringify(payload).includes(path), false, '响应不得序列化出本地路径')
  registry.destroy()
})

// ---------- 注册表 TTL / 孤儿 / destroy（docs/0907/xhs 测试计划锚点 2） ----------

test('registry keeps done results queryable within TTL and returns not_found after', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 4 })
  let clock = 1_000_000
  const controlled = controlledDriver()
  const registry = createUploadRegistry({
    driver: controlled.driver,
    doneTtlMs: 60_000,
    sweepMs: 0,
    now: () => clock,
  })
  const deps = { expectedOrigin: ORIGIN, store, driver: controlled.driver, tools: okTools(), maxBytes: 1024, registry }

  const started = mockRes()
  await handleUploadStartRequest(mockReq({ body: { path }, contentType: 'application/json' }), started, deps)
  const { uploadId } = started.json()
  controlled.succeed()
  await flushAsync()

  const inTtl = mockRes()
  await handleUploadStatusRequest(mockReq({ body: { uploadId }, contentType: 'application/json' }), inTtl, { expectedOrigin: ORIGIN, registry })
  assert.equal(inTtl.json().status, 'done', 'TTL 内 done 可重复查询（P2 竞态兜底）')

  clock += 61_000
  const afterTtl = mockRes()
  await handleUploadStatusRequest(mockReq({ body: { uploadId }, contentType: 'application/json' }), afterTtl, { expectedOrigin: ORIGIN, registry })
  assert.deepEqual(afterTtl.json(), { status: 'not_found' }, 'TTL 过后返回 not_found')
  registry.destroy()
})

test('registry aborts orphaned uploads past orphanMs and marks them failed', async () => {
  let clock = 5_000_000
  const controlled = controlledDriver()
  const registry = createUploadRegistry({
    driver: controlled.driver,
    orphanMs: 1_000,
    sweepMs: 0,
    now: () => clock,
  })
  const { id } = registry.launch({ path: '/tmp/x.mp4', entry: { name: 'x.mp4', mime: 'video/mp4' }, size: 10, auth: validAuth() })
  assert.equal(registry.get(id).status, 'uploading', '启动初期仍是 uploading')
  clock += 2_000
  const item = registry.get(id)
  assert.equal(item.status, 'failed', '超 orphanMs 的孤儿上传被中止并置 failed')
  assert.equal(item.error, 'upload_cancelled')
  registry.destroy()
})

test('registry destroy aborts in-flight uploads and afterwards everything is not_found', async () => {
  let clock = 7_000_000
  const controlled = controlledDriver()
  const registry = createUploadRegistry({ driver: controlled.driver, sweepMs: 0, now: () => clock })
  const { id } = registry.launch({ path: '/tmp/x.mp4', entry: { name: 'x.mp4', mime: 'video/mp4' }, size: 10, auth: validAuth() })
  assert.equal(registry.get(id).status, 'uploading')
  registry.destroy()
  assert.equal(registry.get(id), null, 'destroy 后 uploadStatus 一律 not_found')
  assert.equal(controlled.driver.destroyed, 0, '注册表 destroy 不代替驱动 destroy')
})

// ---------- media 本地媒体路由（docs/0907/xhs 测试计划锚点 1 + P9） ----------

function mockMediaReq({ url, origin, secFetchSite, range, remoteAddress = '127.0.0.1' } = {}) {
  const req = Readable.from([])
  req.method = 'GET'
  req.url = url
  req.headers = {}
  if (origin !== undefined) req.headers.origin = origin
  if (secFetchSite !== undefined) req.headers['sec-fetch-site'] = secFetchSite
  if (range !== undefined) req.headers.range = range
  req.socket = { remoteAddress }
  return req
}

function mockMediaRes() {
  const chunks = []
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() },
  })
  res.statusCode = 0
  res.headers = {}
  res.setHeader = (key, value) => { res.headers[key] = value }
  return { res, body: () => Buffer.concat(chunks) }
}

test('media serves admitted files to loopback GETs without an Origin header (P1)', async () => {
  const { path } = await tempFile('media-body-123')
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 14 })
  const deps = { expectedOrigin: ORIGIN, store, maxBytes: 1024 }

  const { res, body } = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}` }), res, deps)
  assert.equal(res.statusCode, 200)
  assert.equal(body().toString(), 'media-body-123')
  assert.equal(res.headers['content-length'], 14)
  assert.equal(res.headers['content-type'], 'video/mp4')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.headers['accept-ranges'], 'bytes')
})

test('media rejects cross-site, external origins, non-loopback and unadmitted paths (P1/P9)', async () => {
  const { path } = await tempFile('secret')
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 6 })
  const deps = { expectedOrigin: ORIGIN, store, maxBytes: 1024 }

  const cases = [
    ['sec-fetch-site cross-site 拒绝', mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, secFetchSite: 'cross-site' })],
    ['Origin 不匹配拒绝', mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, origin: 'http://evil.example' })],
    ['非 loopback 拒绝', mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, remoteAddress: '192.168.1.10' })],
    ['未登记路径拒绝', mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent('/etc/passwd')}` })],
  ]
  for (const [label, req] of cases) {
    const { res } = mockMediaRes()
    await handleMediaRequest(req, res, deps)
    assert.equal(res.statusCode, 403, label)
  }

  // 缺少 path 参数属于请求格式错误：400。
  const missingPath = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: MEDIA_PATH }), missingPath.res, deps)
  assert.equal(missingPath.res.statusCode, 400)

  // sec-fetch-site: none（地址栏直接访问）与 same-origin 均放行。
  for (const site of ['same-origin', 'none']) {
    const { res, body } = mockMediaRes()
    await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, secFetchSite: site }), res, deps)
    assert.equal(res.statusCode, 200, `sec-fetch-site: ${site} 放行`)
    assert.equal(body().toString(), 'secret')
  }
  // 匹配的 Origin 放行。
  const { res: okRes } = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, origin: ORIGIN }), okRes, deps)
  assert.equal(okRes.statusCode, 200)
})

test('media serves single-part Range requests with 206 and rejects unsatisfiable ranges', async () => {
  const { path } = await tempFile('0123456789')
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 10 })
  const deps = { expectedOrigin: ORIGIN, store, maxBytes: 1024 }

  const partial = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, range: 'bytes=2-5' }), partial.res, deps)
  assert.equal(partial.res.statusCode, 206)
  assert.equal(partial.body().toString(), '2345')
  assert.equal(partial.res.headers['content-range'], 'bytes 2-5/10')
  assert.equal(partial.res.headers['content-length'], 4)

  const openEnded = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, range: 'bytes=7-' }), openEnded.res, deps)
  assert.equal(openEnded.res.statusCode, 206)
  assert.equal(openEnded.body().toString(), '789')

  const suffix = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, range: 'bytes=-3' }), suffix.res, deps)
  assert.equal(suffix.res.statusCode, 206)
  assert.equal(suffix.body().toString(), '789')

  const unsatisfiable = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, range: 'bytes=50-60' }), unsatisfiable.res, deps)
  assert.equal(unsatisfiable.res.statusCode, 416)
  assert.equal(unsatisfiable.res.headers['content-range'], 'bytes */10')

  const malformed = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}`, range: 'bytes=abc' }), malformed.res, deps)
  assert.equal(malformed.res.statusCode, 200, '无法解析的 Range 按全量处理')
})

test('media rejects files swapped after admission (TOCTOU) and non-GET methods', async () => {
  const { path } = await tempFile('original')
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 8 })
  const deps = { expectedOrigin: ORIGIN, store, maxBytes: 1024 }

  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, 'changed-content!')
  const swapped = mockMediaRes()
  await handleMediaRequest(mockMediaReq({ url: `${MEDIA_PATH}?path=${encodeURIComponent(path)}` }), swapped.res, deps)
  assert.equal(swapped.res.statusCode, 403, '文件被替换后拒绝供流（P9 TOCTOU）')

  const post = Readable.from([])
  post.method = 'POST'
  post.url = `${MEDIA_PATH}?path=${encodeURIComponent(path)}`
  post.headers = {}
  post.socket = { remoteAddress: '127.0.0.1' }
  const postRes = mockRes()
  await handleMediaRequest(post, postRes, deps)
  assert.equal(postRes.statusCode, 405)
})
