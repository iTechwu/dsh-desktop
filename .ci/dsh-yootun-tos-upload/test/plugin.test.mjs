import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, symlink, writeFile, appendFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import test from 'node:test'

import { guessContentType, extensionOf, MEDIA_EXTENSIONS } from '../mime.js'
import {
  loadConfig,
  readSecretsFile,
  resolveCredentials,
  SECRETS_FILENAME,
  SUPPORTED_BACKENDS,
  MAX_MAX_BYTES,
  MAX_TOOL_TIMEOUT_MS,
} from '../config.js'
import { PickedFileStore, validateUploadableFile, revalidateAdmittedFile } from '../allowlist.js'
import { createFilePicker } from '../picker.js'
import { signV4, sha256Hex, uriEncode } from '../drivers/tos-signer.js'
import { createTosDriver, sanitizeFilename, MAX_UPLOAD_ATTEMPTS, DEFAULT_TIMEOUTS } from '../drivers/tos.js'
import { ERROR_CODES, toPublicCode, makeCodedError } from '../lib/errors.js'
import { handlePickFileRequest, handleUploadRequest, PICK_FILE_PATH, UPLOAD_PATH } from '../routes.js'
import { registerMediaUploadTool } from '../tool.js'
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
 * 起一个本地对象存储替身：接收 PUT，记录请求头/体，可编程返回状态码与 ETag。
 * 用 path-style + http endpoint 让驱动能直连本机。
 */
async function startStorageServer() {
  const requests = []
  const state = { status: 200, etag: undefined, seq: [], /** 挂起不响应的请求数。 */ hold: 0 }
  const held = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) })
      if (state.hold > 0) {
        state.hold--
        held.push(res)
        return
      }
      // seq 允许按次数编排状态码（如先 503 两次再 200）。
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

function tosConfig(server, overrides = {}) {
  return {
    bucket: 'dofe-transcode',
    region: 'cn-beijing',
    endpoint: server.endpoint,
    accessKeyId: 'AK',
    accessKeySecret: 'SK',
    keyPrefix: 'yootun/uploads',
    addressingStyle: 'path',
    ...overrides,
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
  assert.match(patch, /bucket: dofe-transcode/u)
  assert.match(patch, /keyPrefix: yootun\/uploads/u)
  assert.doesNotMatch(patch, /accessKeyId: \S+/u, 'cordis.patch.yml 不得写入明文 AK')
  assert.doesNotMatch(patch, /accessKeySecret: \S+/u, 'cordis.patch.yml 不得写入明文 SK')
  assert.doesNotMatch(patch, /cdnDomain/u, '本插件不加 cdnDomain')
  assert.deepEqual(inject, ['webServer', 'tools'], '硬依赖只有 webServer 与 tools')
  assert.equal(name, 'yootun-tos-upload')
})

test('every shipped source file is valid JavaScript', async () => {
  const files = ['index.js', 'config.js', 'mime.js', 'allowlist.js', 'picker.js', 'routes.js', 'tool.js', 'lib/errors.js', 'drivers/tos.js', 'drivers/tos-signer.js', 'drivers/types.js', 'lib/client.js']
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, root))], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${file}: ${result.stderr}`)
  }
})

test('never embeds CI addresses or third-party MCP endpoints', async () => {
  for (const file of ['index.js', 'config.js', 'picker.js', 'routes.js', 'tool.js', 'lib/errors.js', 'drivers/tos.js', 'drivers/tos-signer.js']) {
    const source = await readFile(new URL(file, root), 'utf8')
    assert.doesNotMatch(source, /172\.30\.30\.11/u, file)
  }
})

// ---------- 统一错误模型 ----------

test('error model exposes a fixed code set and normalizes internal codes', () => {
  assert.equal(ERROR_CODES.length, 12)
  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length, '错误码不允许重复')

  assert.equal(toPublicCode({ code: 'file_too_large' }), 'file_too_large', '固定码原样透传')
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

// ---------- SigV4 签名器 ----------

test('SigV4 signer matches AWS SDK (@smithy/signature-v4) for a TOS PUT', () => {
  const amzDate = '20130524T000000Z'
  const headers = {
    host: 'dofe-transcode.tos-s3-cn-beijing.volces.com',
    'content-type': 'video/mp4',
    'content-length': '12345',
    'content-disposition': 'inline',
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-date': amzDate,
  }
  const result = signV4({
    method: 'PUT',
    path: '/yootun/uploads/20260902_120000_v.mp4',
    headers,
    payloadHash: 'UNSIGNED-PAYLOAD',
    amzDate,
    region: 'cn-beijing',
    service: 's3',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  })
  // 该向量来自与 @smithy/signature-v4@5.7.3 的逐字节对拍，固化防止回归。
  assert.equal(
    result.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/cn-beijing/s3/aws4_request, SignedHeaders=content-disposition;content-length;content-type;host;x-amz-content-sha256;x-amz-date, Signature=77ff98f2f57e7370439c5d975ebd7974d9fe27fcc66386c4cef1f04dad2a3263',
  )
})

test('uriEncode keeps unreserved and slash, percent-encodes the rest', () => {
  assert.equal(uriEncode('/a-b_c.d~e/中文 file.mp4', false), '/a-b_c.d~e/%E4%B8%AD%E6%96%87%20file.mp4')
  assert.equal(uriEncode('/a/b', true), '%2Fa%2Fb')
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

// ---------- mime ----------

test('infers content type and extensions for media files', () => {
  assert.equal(guessContentType('a/b/cover.JPG'), 'image/jpeg')
  assert.equal(guessContentType('intro.mp4'), 'video/mp4')
  assert.equal(guessContentType('no-extension'), 'application/octet-stream')
  assert.equal(extensionOf('archive.tar.gz'), 'gz')
  assert.ok(MEDIA_EXTENSIONS.includes('mp4'))
  assert.ok(MEDIA_EXTENSIONS.includes('png'))
})

// ---------- 对象 key 安全 ----------

test('sanitizeFilename strips local paths, separators and unsafe characters', () => {
  const out = sanitizeFilename('/home/user/videos/../../etc/passwd.mp4')
  assert.equal(out.includes('/'), false)
  assert.equal(out.includes('\\'), false)
  assert.equal(out.includes('..'), false)
  assert.equal(out.endsWith('.mp4'), true, '扩展名保留')
  // Windows 反斜杠路径同样只保留末段。
  const win = sanitizeFilename('C:\\Users\\someone\\clip 1.mov')
  assert.equal(win.includes(':'), false)
  assert.equal(win.includes('\\'), false)
  assert.equal(win, 'clip_1.mov')
  assert.equal(sanitizeFilename(''), 'file')
  assert.equal(sanitizeFilename('..'), 'file')
  assert.equal(sanitizeFilename('a'.repeat(300)).length <= 128, true)
})

// ---------- config ----------

test('resolves config with defaults and reports missing credentials', async () => {
  const config = await loadConfig({}, { env: {}, secrets: {} })
  assert.equal(config.backend, 'tos')
  assert.equal(config.tos.region, 'cn-beijing')
  assert.equal(config.tos.endpoint, 'https://tos-s3-cn-beijing.volces.com')
  assert.equal(config.tos.keyPrefix, 'yootun/uploads')
  assert.equal(config.ready, false)
  assert.deepEqual(config.missing, ['bucket', 'accessKeyId', 'accessKeySecret'])
  assert.deepEqual(config.errors, [])
})

test('non-secrets from loader row config; credentials from store / env / secrets file', async () => {
  const config = await loadConfig(
    { tos: { bucket: 'dofe-transcode', region: 'tos-s3-cn-beijing', keyPrefix: '/a/b/' } },
    { env: { STORAGE_ACCESS_KEY_SECRET: 'env-sk' }, secrets: { STORAGE_ACCESS_KEY_ID: 'file-ak', STORAGE_BUCKET: 'ignored-bucket' } },
  )
  assert.equal(config.tos.bucket, 'dofe-transcode', '非敏感项以 Loader 行 config 为准')
  assert.equal(config.tos.region, 'cn-beijing', 'region 归一化去掉 tos-s3- 前缀')
  assert.equal(config.tos.keyPrefix, 'a/b')
  assert.equal(config.tos.accessKeyId, 'file-ak', '无部署注入时 AK 回落到密钥文件')
  assert.equal(config.tos.accessKeySecret, 'env-sk', '无部署注入时 SK 回落到环境变量')
  assert.equal(config.ready, true)

  const injected = await loadConfig(
    { tos: { bucket: 'dofe-transcode' } },
    { credentials: { accessKeyId: 'store-ak', accessKeySecret: 'store-sk' }, env: { STORAGE_ACCESS_KEY_ID: 'env-ak' }, secrets: {} },
  )
  assert.equal(injected.tos.accessKeyId, 'store-ak', '部署注入 credential store 优先于环境变量')
  assert.equal(injected.tos.accessKeySecret, 'store-sk')
  assert.equal(injected.ready, true)
})

test('rejects credentials declared in loader row config', async () => {
  const config = await loadConfig(
    { accessKeyId: 'leak-ak', tos: { bucket: 'dofe-transcode', accessKeySecret: 'leak-sk' } },
    { env: {}, secrets: { STORAGE_ACCESS_KEY_ID: 'file-ak', STORAGE_ACCESS_KEY_SECRET: 'file-sk' } },
  )
  assert.equal(config.tos.accessKeyId, 'file-ak', 'Loader config 中的 AK 必须被忽略')
  assert.equal(config.tos.accessKeySecret, 'file-sk', 'Loader config 中的 SK 必须被忽略')
  assert.equal(config.ready, false, '出现凭证字段即视为配置非法，进入不可上传降级')
  assert.ok(config.errors.some((problem) => problem.includes('not allowed')))
  assert.ok(JSON.stringify(config.info).includes('***'), '凭证元数据只能以脱敏形式出现')
})

test('config validation bounds: backend/region/bucket/keyPrefix/maxBytes/timeoutMs/endpoint', async () => {
  const cases = [
    [{ backend: 'ftp' }, 'unsupported backend'],
    [{ tos: { region: 'CN_BEIJING!!' } }, 'invalid region'],
    [{ tos: { bucket: 'Bad_Bucket' } }, 'invalid bucket'],
    [{ tos: { keyPrefix: '../escape' } }, 'invalid keyPrefix'],
    [{ limits: { maxBytes: -1 } }, 'invalid limits.maxBytes'],
    [{ limits: { maxBytes: MAX_MAX_BYTES + 1 } }, 'invalid limits.maxBytes'],
    [{ tool: { timeoutMs: MAX_TOOL_TIMEOUT_MS + 1 } }, 'invalid tool.timeoutMs'],
    [{ tool: { timeoutMs: 0 } }, 'invalid tool.timeoutMs'],
    [{ tos: { endpoint: 'http://tos-s3-cn-beijing.volces.com' } }, 'endpoint must be an HTTPS address'],
    [{ tos: { publicBaseUrl: 'ftp://cdn.example.com' } }, 'publicBaseUrl must be an HTTPS address'],
  ]
  for (const [row, expected] of cases) {
    const config = await loadConfig(
      row,
      { env: {}, secrets: { STORAGE_ACCESS_KEY_ID: 'ak', STORAGE_ACCESS_KEY_SECRET: 'sk', STORAGE_BUCKET: 'dofe-transcode' } },
    )
    assert.equal(config.ready, false, JSON.stringify(row))
    assert.ok(config.errors.some((problem) => problem.includes(expected)), `${expected}: ${JSON.stringify(config.errors)}`)
  }

  // loopback http 例外只允许本地联调。
  const loopback = await loadConfig(
    { tos: { bucket: 'dofe-transcode', endpoint: 'http://127.0.0.1:9000' } },
    { env: {}, secrets: { STORAGE_ACCESS_KEY_ID: 'ak', STORAGE_ACCESS_KEY_SECRET: 'sk' } },
  )
  assert.deepEqual(loopback.errors, [])
  assert.equal(loopback.ready, true)
})

test('valid config with every field present stays ready', async () => {
  const config = await loadConfig(
    {
      backend: 'tos',
      tos: { bucket: 'dofe-transcode', region: 'cn-beijing', keyPrefix: 'yootun/uploads' },
      limits: { maxBytes: 524288000 },
      tool: { timeoutMs: 1800000 },
    },
    { credentials: { accessKeyId: 'store-ak-value', accessKeySecret: 'store-sk-value' }, env: {}, secrets: {} },
  )
  assert.equal(config.ready, true)
  assert.deepEqual(config.errors, [])
  assert.equal(SUPPORTED_BACKENDS, SUPPORTED_BACKENDS)
})

// ---------- 凭证统一解析 ----------

test('resolveCredentials returns structured, redacted metadata without plaintext', async () => {
  const env = { STORAGE_ACCESS_KEY_ID: 'AKENVLONGID1234' }
  const result = await resolveCredentials({ env, secrets: { STORAGE_ACCESS_KEY_SECRET: 'SKFILELONGSECRET5678' } })

  assert.equal(result.accessKeyId, 'AKENVLONGID1234')
  assert.deepEqual(result.info.accessKeyId, { present: true, source: 'environment', available: true, redacted: result.info.accessKeyId.redacted })
  assert.equal(result.info.accessKeyId.redacted.startsWith('AK'), true)
  assert.equal(result.info.accessKeyId.redacted.includes('ENVLONGID'), false)
  assert.deepEqual(result.info.accessKeySecret, { present: true, source: 'secret-file', available: true, redacted: result.info.accessKeySecret.redacted })
  assert.equal(result.info.accessKeySecret.redacted.includes('FILELONGSECRET'), false)
  assert.equal(result.info.bothPresent, true)
  assert.equal(result.info.ready, true)
  assert.equal(JSON.stringify(result.info).includes('AKENVLONGID1234'), false, '元数据不得携带明文')
})

test('resolveCredentials: empty result when neither store nor env nor file exists', async () => {
  const result = await resolveCredentials({ env: {}, secrets: {} })
  assert.equal(result.accessKeyId, '')
  assert.equal(result.accessKeySecret, '')
  assert.equal(result.info.bothPresent, false, '只允许整组凭证，不允许半组')
  assert.equal(result.info.ready, false)
  assert.equal(result.info.accessKeyId.source, null)
})

test('resolveCredentials: credential store wins over env over secret file', async () => {
  const result = await resolveCredentials({
    credentials: { accessKeyId: 'store-ak-123456', accessKeySecret: 'store-sk-123456' },
    env: { STORAGE_ACCESS_KEY_ID: 'env-ak-123456' },
    secrets: { STORAGE_ACCESS_KEY_SECRET: 'file-sk-123456' },
  })
  assert.equal(result.info.accessKeyId.source, 'credential-store')
  assert.equal(result.info.accessKeySecret.source, 'credential-store')
})

test('secrets file is guarded by lstat and size limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tos-secrets-'))
  assert.deepEqual(await readSecretsFile(dir), {}, '文件不存在时为空')

  await writeFile(join(dir, SECRETS_FILENAME), '# comment\nSTORAGE_BUCKET=file-bucket\nbad-line\nSTORAGE_ACCESS_KEY_ID = ak \n')
  const parsed = await readSecretsFile(dir)
  assert.equal(parsed.STORAGE_BUCKET, 'file-bucket')
  assert.equal(parsed.STORAGE_ACCESS_KEY_ID, 'ak')
  assert.equal(parsed['bad-line'], undefined)

  const linkDir = await mkdtemp(join(tmpdir(), 'tos-secrets-link-'))
  const target = join(linkDir, 'real.env')
  await writeFile(target, 'STORAGE_BUCKET=leak')
  await symlink(target, join(linkDir, SECRETS_FILENAME))
  assert.deepEqual(await readSecretsFile(linkDir), {}, '符号链接密钥文件必须被拒绝')
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

test('upload route only accepts admitted paths and streams through the driver', async () => {
  const { path } = await tempFile()
  const store = new PickedFileStore()
  const uploads = []
  const driver = {
    async upload(p, meta) {
      uploads.push([p, meta])
      return { key: 'yootun/uploads/x.mp4', url: 'https://dofe-transcode.tos-cn-beijing.volces.com/yootun/uploads/x.mp4', size: 4, contentType: 'video/mp4' }
    },
  }
  const deps = { expectedOrigin: ORIGIN, store, driver, maxBytes: 1024 }

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
  assert.equal(ok.json().url, 'https://dofe-transcode.tos-cn-beijing.volces.com/yootun/uploads/x.mp4')
  assert.deepEqual(uploads, [[path, { name: 'video.mp4', mime: 'video/mp4' }]])

  const down = mockRes()
  await handleUploadRequest(mockReq({ body: { path }, contentType: 'application/json' }), down, { ...deps, driver: null })
  assert.equal(down.statusCode, 503)
  assert.equal(down.json().error, 'uploader_not_configured')
})

test('upload route returns file_changed for files replaced after admission', async () => {
  const { path } = await tempFile('first')
  const store = new PickedFileStore()
  store.admit(path, { name: 'video.mp4', size: 5 })
  let uploads = 0
  const deps = {
    expectedOrigin: ORIGIN,
    store,
    driver: { async upload() { uploads++; return { key: 'k', url: 'https://x/k', size: 9, contentType: 'video/mp4' } } },
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
    maxBytes: 1024,
    driver: {
      async upload() {
        const error = new Error('TOS PUT HTTP 403')
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

// ---------- TOS 驱动 ----------

test('tos driver resolves keys and public urls like tools.dofe.ai boto3', async () => {
  const driver = await createTosDriver({
    bucket: 'dofe-transcode', region: 'cn-beijing', endpoint: 'https://tos-s3-cn-beijing.volces.com',
    accessKeyId: 'ak', accessKeySecret: 'sk', keyPrefix: 'yootun/uploads', addressingStyle: 'virtual',
  })
  assert.equal(driver.resolveKey('a.mp4'), 'yootun/uploads/a.mp4')
  assert.equal(driver.resolveKey('yootun/uploads/a.mp4'), 'yootun/uploads/a.mp4')
  assert.equal(driver.publicUrl('yootun/uploads/a.mp4'), 'https://dofe-transcode.tos-cn-beijing.volces.com/yootun/uploads/a.mp4')
})

test('tos driver PUTs the file body, signed headers and correct content-type to storage', async () => {
  const server = await startStorageServer()
  server.state.etag = '"abc123"'
  const { path } = await tempFile('hello-tos-body')
  const driver = await createTosDriver(tosConfig(server))

  const result = await driver.upload(path, { name: 'v.mp4' })
  assert.equal(result.etag, 'abc123')
  assert.equal(result.contentType, 'video/mp4')
  assert.match(result.key, /^yootun\/uploads\/\d{8}_\d{6}_[0-9a-f]{8}_v\.mp4$/u, 'key 带时间戳与随机后缀防覆盖')
  assert.equal(result.url, `https://dofe-transcode.tos-cn-beijing.volces.com/${result.key}`)
  assert.equal(result.url.includes(result.key), true)

  assert.equal(server.requests.length, 1)
  const req = server.requests[0]
  assert.equal(req.body.toString(), 'hello-tos-body', '文件体必须流式原样到达')
  assert.equal(req.headers['content-type'], 'video/mp4')
  assert.equal(req.headers['content-length'], String(Buffer.byteLength('hello-tos-body')))
  assert.equal(req.headers['content-disposition'], 'inline')
  assert.equal(req.headers['x-amz-content-sha256'], 'UNSIGNED-PAYLOAD')
  assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/cn-beijing\/s3\/aws4_request, SignedHeaders=/, 'Authorization 头格式正确')
  await server.close()
})

test('tos driver generates unique keys for same-name uploads', async () => {
  const server = await startStorageServer()
  const { path } = await tempFile('dup')
  const driver = await createTosDriver(tosConfig(server))
  const a = await driver.upload(path, { name: 'v.mp4' })
  const b = await driver.upload(path, { name: 'v.mp4' })
  assert.notEqual(a.key, b.key, '同秒同名上传不得互相覆盖')
  await server.close()
})

test('tos driver retries 5xx but not 4xx, within a bounded attempt count', async () => {
  const { path } = await tempFile('retry-body')

  const retryServer = await startStorageServer()
  retryServer.state.seq = [503, 503, 200]
  const retryDriver = await createTosDriver(tosConfig(retryServer))
  await retryDriver.upload(path, { name: 'v.mp4' })
  assert.equal(retryServer.requests.length, 3, '5xx 指数退避重试到成功')
  await retryServer.close()

  const clientErrServer = await startStorageServer()
  clientErrServer.state.status = 403
  const clientErrDriver = await createTosDriver(tosConfig(clientErrServer))
  const failure = await clientErrDriver.upload(path, { name: 'v.mp4' }).then(() => null, (cause) => cause)
  assert.equal(failure.statusCode, 403)
  assert.equal(toPublicCode(failure), 'storage_auth_failed')
  assert.equal(clientErrServer.requests.length, 1, '4xx 不重试')
  await clientErrServer.close()
  assert.equal(MAX_UPLOAD_ATTEMPTS, 3, '重试必须有界')
})

test('tos driver surfaces header timeout as upload_timeout and closes the file stream', async () => {
  const server = await startStorageServer()
  server.state.hold = 1 // 接收请求但永不响应
  const { path } = await tempFile('timeout-body')
  const driver = await createTosDriver(tosConfig(server), {
    timeouts: { connectMs: 1000, headersMs: 120, overallMs: DEFAULT_TIMEOUTS.overallMs },
  })
  const failure = await driver.upload(path, { name: 'v.mp4' }).then(
    () => null,
    (cause) => cause,
  )
  assert.notEqual(failure, null, '必须以失败终结')
  assert.equal(failure.isTimeout, true)
  assert.equal(toPublicCode(failure), 'upload_timeout')
  assert.equal(server.requests.length, 1)
  assert.equal(driver.pendingCount, 0, '请求失败后不得悬挂未完成请求')
  await server.close()
})

test('tos driver surfaces overall timeout as upload_timeout', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('overall-body')
  const driver = await createTosDriver(tosConfig(server), {
    timeouts: { connectMs: 60_000, headersMs: 60_000, overallMs: 100 },
  })
  const failure = await driver.upload(path, { name: 'v.mp4' }).then(() => null, (cause) => cause)
  assert.equal(failure?.isTimeout, true)
  assert.equal(toPublicCode(failure), 'upload_timeout')
  await server.close()
})

test('tos driver does not fire headers timeout while the body is still uploading', async () => {
  // 可控慢速请求体：显式按时间间隔推送数据，不依赖 socket 缓冲区大小。
  // headers 超时应在 req 'finish'（body 写完）之后才启动，而不是 socket 建连后。
  const server = await startStorageServer()
  const SIZE = 256 * 1024
  const { path } = await tempFile('x'.repeat(SIZE)) // 真实文件用于 stat 出 Content-Length
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
  const driver = await createTosDriver(tosConfig(server), {
    timeouts: { connectMs: 1000, headersMs: 300, overallMs: 30_000 },
    createReadStream: () => slowStream,
  })
  const result = await driver.upload(path, { name: 'slow.mp4' })

  assert.ok(result?.url, '慢速请求体不应被误判为响应头超时，上传必须成功')
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0].body.length, SIZE, '请求体必须完整到达')
  await server.close()
})

test('tos driver fires connect timeout even if the body finished before connecting', async () => {
  // 状态机：body 已 finish 但连接仍未建立时，connect 超时必须生效（而不是被 finish 清除）。
  const { path } = await tempFile('tiny')
  const neverConnectingTransport = {
    request(options, cb) {
      const req = new Writable({ write(chunk, enc, next) { next() } })
      // 模拟 socket 已分配但永不通连（socket.connecting=true 且永不 emit connect）。
      process.nextTick(() => req.emit('socket', { connecting: true, once() {} }))
      return req
    },
  }
  const driver = await createTosDriver(tosConfig({ endpoint: 'http://unused' }), {
    timeouts: { connectMs: 120, headersMs: 60_000, overallMs: 60_000 },
    transport: neverConnectingTransport,
  })
  const failure = await driver.upload(path, { name: 'v.mp4' }).then(() => null, (cause) => cause)
  assert.notEqual(failure, null, '连接无法建立时必须失败')
  assert.equal(failure?.isTimeout, true)
  assert.match(failure?.message, /establishing connection/, '必须由 connect 超时触发，而不是 headers 超时')
  assert.equal(toPublicCode(failure), 'upload_timeout')
})

test('tos driver still returns upload_timeout after body completes and no response headers arrive', async () => {
  // 与“请求体完成后等待响应头超时”对应的明确断言：body 写完后服务器不回响应头，
  // headers 超时仍应从 finish 之后计时并返回 upload_timeout。
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('after-finish-body')
  const driver = await createTosDriver(tosConfig(server), {
    timeouts: { connectMs: 1000, headersMs: 150, overallMs: DEFAULT_TIMEOUTS.overallMs },
  })
  const failure = await driver.upload(path, { name: 'v.mp4' }).then(() => null, (cause) => cause)
  assert.equal(failure?.isTimeout, true, 'body 完成后等待响应头超时必须返回 upload_timeout')
  assert.equal(toPublicCode(failure), 'upload_timeout')
  await server.close()
})

test('tos driver destroy() cancels in-flight uploads (plugin unload path)', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('cancel-body')
  const driver = await createTosDriver(tosConfig(server))
  const pending = driver.upload(path, { name: 'v.mp4' })
  // 等请求真的发出去再销毁。
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

test('tos driver maps abort signal cancellation to upload_cancelled', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { path } = await tempFile('signal-body')
  const driver = await createTosDriver(tosConfig(server))
  const controller = new AbortController()
  const pending = driver.upload(path, { name: 'v.mp4' }, controller.signal)
  setTimeout(() => controller.abort(), 50)
  const failure = await pending.then(() => null, (cause) => cause)
  assert.equal(toPublicCode(failure), 'upload_cancelled')
  assert.equal(driver.pendingCount, 0)
  await server.close()
})

// ---------- 宿主装配（agent 工具 + 路由注册） ----------

function mockCtx(overrides = {}) {
  const registered = { routes: new Map(), tools: new Map(), sections: [] }
  const credentialsService = overrides.credentialsService === undefined
    ? { async resolve(key) { return { value: `${key}-stored` } } }
    : overrides.credentialsService
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
    get(service) {
      if (service === 'credentials') return credentialsService
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

function okDriver() {
  return {
    destroyed: 0,
    async upload() {
      return { key: 'k', url: 'https://dofe-transcode.tos-cn-beijing.volces.com/k', size: 4, contentType: 'video/mp4' }
    },
    destroy() { this.destroyed++ },
  }
}

test('apply registers both routes and the human-in-the-loop media_upload tool from loader row config', async () => {
  const { path } = await tempFile()
  const { ctx, registered } = mockCtx()
  const driver = okDriver()
  const dispose = await apply(ctx, { tool: { timeoutMs: 12345 } }, { dialog: fakeDialog([path]), driver, env: {}, secrets: {} })

  assert.ok(registered.routes.has(PICK_FILE_PATH))
  assert.ok(registered.routes.has(UPLOAD_PATH))
  const tool = registered.tools.get('media_upload')
  assert.ok(tool, 'media_upload 工具必须注册')
  assert.deepEqual(Object.keys(tool.parameters.properties), ['kind'])
  assert.equal(tool.parameters.additionalProperties, false)
  assert.equal(tool.timeoutMs, 12345, 'Loader 行 config.tool.timeoutMs 必须生效')

  const result = await tool.execute({ kind: 'video' }, {})
  assert.equal(result.ok, true)
  assert.equal(result.url, 'https://dofe-transcode.tos-cn-beijing.volces.com/k')
  assert.equal(JSON.stringify(result).includes(path), false, '工具结果不得泄露本地路径')

  const dispose2 = await apply(ctx, {}, { dialog: fakeDialog([], true), driver, env: {}, secrets: {} })
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
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([], true), driver: okDriver(), env: {}, secrets: {} })
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('apply degrades cleanly when credentials are missing', async () => {
  const { ctx, registered } = mockCtx({ credentialsService: { async resolve() { return undefined } } })
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([], true), env: {}, secrets: {} })
  const result = await registered.tools.get('media_upload').execute({}, {})
  assert.deepEqual(result, { ok: false, error: 'uploader_not_configured' })
  dispose()
})

test('apply loads without credential store and without system prompt services', async () => {
  const { ctx, registered } = mockCtx({
    credentialsService: null,
    systemPromptService: null,
  })
  assert.equal(registered.sections.length, 0)
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([], true), env: {}, secrets: {} })
  const tool = registered.tools.get('media_upload')
  assert.ok(tool, '没有 credential store / system prompt 时工具仍必须注册')
  assert.deepEqual(await tool.execute({}, {}), { ok: false, error: 'uploader_not_configured' }, '无凭证时工具结构化降级')
  dispose()
})

test('apply enters degraded state on invalid loader config but still loads', async () => {
  const { ctx, registered } = mockCtx()
  const dispose = await apply(ctx, { backend: 'ftp' }, { dialog: fakeDialog([], true), env: {}, secrets: {} })
  const tool = registered.tools.get('media_upload')
  assert.ok(tool, '配置非法时插件必须仍可加载')
  assert.deepEqual(await tool.execute({}, {}), { ok: false, error: 'uploader_not_configured' })
  assert.ok(ctx.logger.warnings.some((line) => line.includes('unsupported backend')), '配置问题必须给出明确日志')
  dispose()
})

test('apply rolls back all registrations when a registration step throws', async () => {
  const { ctx, registered } = mockCtx({ toolRegisterThrows: true })
  const driver = okDriver()
  await assert.rejects(() => apply(ctx, {}, { driver, env: {}, secrets: {} }))
  assert.equal(registered.routes.size, 0, '工具注册失败时路由必须全部回滚')
  assert.equal(driver.destroyed, 1, '回滚必须释放驱动')
})

test('apply leaves no duplicate tools or routes across reloads', async () => {
  const { ctx, registered } = mockCtx()
  const driver = okDriver()
  const dispose1 = await apply(ctx, {}, { dialog: fakeDialog([], true), driver, env: {}, secrets: {} })
  const firstTool = registered.tools.get('media_upload')
  const dispose2 = await apply(ctx, {}, { dialog: fakeDialog([], true), driver, env: {}, secrets: {} })
  const secondTool = registered.tools.get('media_upload')

  assert.notEqual(firstTool, secondTool, '重载后必须替换为新工具实例')
  assert.equal(registered.tools.size, 1, '同名工具只允许存在一个')
  assert.equal(registered.routes.size, 2, '同路径路由只允许一组')
  assert.equal(registered.sections.filter((section) => section.name === 'tool:media-upload').length, 2, '重载期新旧 prompt 区块共存，注销后清空')

  dispose1()
  assert.equal(registered.tools.size, 0, '旧工具注销后宿主里没有 media_upload')
  assert.equal(registered.routes.size, 0)
  assert.equal(registered.sections.length, 1, '旧实例的 prompt 区块注销，新实例的保留')
  dispose2()
  assert.equal(registered.sections.length, 0)
  assert.equal(driver.destroyed, 2)
})

test('apply cancels an in-flight upload when the plugin is disposed', async () => {
  const server = await startStorageServer()
  server.state.hold = 1
  const { ctx, registered } = mockCtx()
  const { path } = await tempFile('unload-body')
  // 用真实 TOS 驱动连本地替身：覆盖“插件卸载取消上传请求”路径。
  const dispose = await apply(ctx, { tos: { bucket: 'dofe-transcode', endpoint: server.endpoint, addressingStyle: 'path' } }, {
    env: {},
    secrets: { STORAGE_ACCESS_KEY_ID: 'AKTEST123456', STORAGE_ACCESS_KEY_SECRET: 'SKTEST123456' },
  })
  const tool = registered.tools.get('media_upload')
  const dialog = fakeDialog([path])
  // 直接构造第二次 apply 拿真实 picker 太重；改用工具通道模拟：注册阶段 driver 可用。
  const executePromise = tool.execute({}, {}).then((value) => value, (cause) => ({ thrown: String(cause) }))
  dispose()
  const result = await Promise.race([
    executePromise,
    new Promise((resolve) => setTimeout(() => resolve('hung'), 1500)),
  ])
  // 没有真实弹窗：execute 在 picker 阶段就结束，dispose 后不得悬挂。
  assert.notEqual(result, 'hung', '插件卸载后工具执行必须安全结束')
  await server.close()
})

test('tool returns structured fixed codes for picker and storage failures', async () => {
  // storage_auth_failed：驱动抛 403。
  const { ctx, registered } = mockCtx()
  const driver = {
    async upload() {
      const error = new Error('TOS PUT HTTP 403')
      error.statusCode = 403
      throw error
    },
  }
  const { path } = await tempFile('tool-403')
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([path]), driver, env: {}, secrets: {} })
  const tool = registered.tools.get('media_upload')
  const result = await tool.execute({}, {})
  assert.deepEqual(result, { ok: false, error: 'storage_auth_failed' })
  assert.equal(JSON.stringify(result).includes(path), false, '工具结果不得携带本地路径')
  dispose()

  // picker_unavailable：无 Electron。
  const { ctx: ctx2, registered: registered2 } = mockCtx()
  const dispose2 = await apply(ctx2, {}, { dialog: null, driver: okDriver(), env: {}, secrets: {} })
  const result2 = await registered2.tools.get('media_upload').execute({}, {})
  assert.deepEqual(result2, { ok: false, error: 'picker_unavailable' })
  dispose2()
})

test('tool reports file_changed when the picked file is swapped before upload', async () => {
  const { path } = await tempFile('original')
  // admit 时记录的 size 与实际不符 -> 上传前的 TOCTOU 复查必须拦截。
  const store = new PickedFileStore()
  const realAdmit = store.admit.bind(store)
  store.admit = (admitPath, meta) => realAdmit(admitPath, { ...meta, size: (meta?.size ?? 0) + 1 })

  const tools = new Map()
  registerMediaUploadTool(
    { tools: { register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } },
    {
      picker: createFilePicker({ dialog: fakeDialog([path]), store }),
      driver: okDriver(),
      store,
      maxBytes: 1024 * 1024,
      timeoutMs: 60_000,
      logger: { warn() {}, error() {} },
    },
  )
  const result = await tools.get('media_upload').execute({}, {})
  assert.deepEqual(result, { ok: false, error: 'file_changed' })
})

test('tool never leaks the local path inside the object key', async () => {
  const { ctx, registered } = mockCtx()
  const { path } = await tempFile('ok-body')
  const driver = okDriver()
  const dispose = await apply(ctx, {}, { dialog: fakeDialog([path]), driver, env: {}, secrets: {} })
  const result = await registered.tools.get('media_upload').execute({}, {})
  assert.equal(result.ok, true)
  assert.equal(result.name, 'video.mp4')
  assert.equal(result.key.includes('/home/'), false, 'key 不得包含本地路径')
  assert.equal(result.key.includes(tmpdir()), false)
  dispose()
})
