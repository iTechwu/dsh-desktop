// 小红书仿写 host endpoint：浏览器页面只访问本地同源路由，Host 通过 ctx.tools 调用
// dofe-managed 统一创建的 tools-xhs-operation MCP Client（xhs_operation_task_create /
// task_get / result_get），并把 MCP 信封投影为安全结果。页面不读取 MODELS_API_KEY、
// 不直连公网 MCP，也不接收凭据、内部地址或原始传输错误（docs/0904/xhs §6.1）。

import { createHash, randomUUID } from 'node:crypto'

const PATH = '/api/desktop/yootun/xhs-operation'
const TOOL_CALL_TIMEOUT_MS = 60_000

// 字段上限与 docs/0904/xhs §5.1 客户端调用合同一致，页面只开放 images/video。
const MAX_THEME = 500
const MAX_MEDIA_URL = 2048
const MAX_IMAGE_COUNT = 5
const MAX_REF_URL = 2048
const MAX_REF_TITLE = 200
const MAX_REF_BODY = 5000
const MAX_REF_SOURCE = 16
const MAX_ACCOUNT_NAME = 200
const MAX_IDEMPOTENCY_KEY = 128
const MAX_TASK_ID = 64

export const inject = ['webServer', 'tools', 'yootunAudit']

const auditedTerminalTasks = new Set()

export function apply(ctx) {
  return ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: PATH,
      async handler(req, res) {
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
        try {
          const body = await readBody(req)
          const action = String(body.action || '')
          if (action === 'create') return await handleCreate(ctx, body, res)
          if (action === 'status') return await handleStatus(ctx, body, res)
          if (action === 'result') return await handleResult(ctx, body, res)
          return send(res, 400, { error: 'unknown_action' })
        } catch (error) {
          const reason = safeToolErrorReason(error)
          ctx.logger?.warn?.('yootun xhs operation failed: %s', reason)
          return send(res, 200, { status: 'error', reason })
        }
      },
    })
    return () => dispose?.()
  })
}

async function handleCreate(ctx, body, res, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const mediaType = cleanString(body.mediaType, 16)
  if (mediaType !== 'images' && mediaType !== 'video') return send(res, 400, { status: 'error', reason: 'invalid_media_type' })
  const schema = findTool(ctx, 'xhs_operation_task_create')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })

  const theme = cleanOptional(body.theme, MAX_THEME)
  const references = projectReferences(body.references)
  const accounts = projectAccounts(body.accounts)
  const idempotencyKey = cleanIdempotencyKey(body.idempotencyKey)

  // 对标笔记/账号为空时传 []；theme 为空时不传（与 docs/0904/xhs §5.1 一致）。
  const args = { mediaType, confirm: true, idempotencyKey, references, accounts, versionCount: 3 }
  if (theme) args.theme = theme
  if (mediaType === 'images') {
    const imageUrls = cleanImageUrls(body.imageUrls)
    if (imageUrls === null) return send(res, 400, { status: 'error', reason: 'image_urls_required' })
    args.imageUrls = imageUrls
    args.coverIndex = 0
  } else {
    const videoUrl = cleanMediaUrl(body.videoUrl)
    if (!videoUrl) return send(res, 400, { status: 'error', reason: 'video_url_required' })
    args.videoUrl = videoUrl
  }

  const result = await ctx.tools.execute({ callId: `yootun-xhs-create-${Date.now()}`, name: schema.name, arguments: args, signal })
  const payload = parseResult(result)
  const taskId = firstString(payload.taskId, payload.task_ref, payload.taskRef)
  if (!taskId) return send(res, 200, { status: 'error', reason: 'create_failed_no_task' })
  await recordCreatedAudit(ctx, taskId, firstString(payload.status) || 'queued')
  return send(res, 200, { status: 'created', taskId, idempotencyKey, mediaType, taskStatus: firstString(payload.status) || 'queued' })
}

async function handleStatus(ctx, body, res, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const taskId = cleanString(body.taskId, MAX_TASK_ID)
  if (!taskId) return send(res, 400, { status: 'error', reason: 'task_id_required' })
  const schema = findTool(ctx, 'xhs_operation_task_get')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })
  const result = await ctx.tools.execute({ callId: `yootun-xhs-status-${Date.now()}`, name: schema.name, arguments: { taskId }, signal })
  const payload = parseResult(result)
  const taskStatus = firstString(payload.status) || 'unknown'
  await recordTerminalAudit(ctx, taskId, taskStatus, taskStatus === 'succeeded' ? 3 : 0, firstString(payload.errorCode))
  return send(res, 200, {
    status: 'ready',
    taskId,
    taskStatus,
    currentStep: firstString(payload.currentStep),
    nextStep: firstString(payload.nextStep),
    errorCode: firstString(payload.errorCode),
    steps: projectSteps(payload.steps),
  })
}

async function handleResult(ctx, body, res, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const taskId = cleanString(body.taskId, MAX_TASK_ID)
  if (!taskId) return send(res, 400, { status: 'error', reason: 'task_id_required' })
  const schema = findTool(ctx, 'xhs_operation_result_get')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })
  const result = await ctx.tools.execute({ callId: `yootun-xhs-result-${Date.now()}`, name: schema.name, arguments: { taskId }, signal })
  const payload = parseResult(result)
  const taskStatus = firstString(payload.status) || 'unknown'
  const versions = projectVersions(payload.versions)
  // 契约：客户端固定 versionCount=3，succeeded 必须返回三套文案；否则按读取失败处理，避免空白或静默少版本。
  if (taskStatus === 'succeeded' && versions.length !== 3) {
    return send(res, 200, { status: 'error', reason: 'versions_unavailable', taskId, taskStatus })
  }
  await recordTerminalAudit(ctx, taskId, taskStatus, versions.length, firstString(payload.errorCode))
  return send(res, 200, { status: 'ready', taskId, taskStatus, versions })
}

function eventUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

async function recordCreatedAudit(ctx, taskId, status) {
  await recordAudit(ctx, {
    clientEventId: eventUuid(`xhs:create:${taskId}`), traceId: `xhs:${taskId}`,
    actionCode: 'xhs.rewrite.created', category: 'create',
    source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'xhs_rewrite_task', id: taskId }, outcome: 'accepted',
    changes: [{ field: 'status', after: status.slice(0, 160) }, { field: 'versionCount', after: 3 }], effects: [],
  })
}

async function recordTerminalAudit(ctx, taskId, status, versionCount, rawError) {
  if (!['succeeded', 'failed', 'cancelled'].includes(status) || auditedTerminalTasks.has(taskId)) return
  const outcome = status === 'succeeded' ? 'succeeded' : 'failed'
  const errorCode = typeof rawError === 'string' && /^[a-z0-9_:-]{1,80}$/iu.test(rawError) ? rawError.toLowerCase() : 'xhs_rewrite_failed'
  const stored = await recordAudit(ctx, {
    clientEventId: eventUuid(`xhs:terminal:${taskId}:${status}`), traceId: `xhs:${taskId}`,
    actionCode: 'xhs.rewrite.completed', category: 'execute',
    source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'xhs_rewrite_task', id: taskId }, outcome,
    changes: [{ field: 'status', after: status }, { field: 'versionCount', after: versionCount }], effects: [],
    ...(outcome === 'failed' ? { errorCode } : {}),
  })
  if (stored) auditedTerminalTasks.add(taskId)
}

async function recordAudit(ctx, input) {
  if (!ctx.yootunAudit?.record) return false
  try { const result = await ctx.yootunAudit.record(input); return result?.status !== 'failed' } catch { ctx.logger?.warn?.('yootun audit record failed: audit_record_failed'); return false }
}

// 对标笔记：页面只开放 { source, url }，投影为对标笔记对象子集（docs/0904/xhs §5.1）。
function projectReferences(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const url = cleanString(item.url, MAX_REF_URL)
    const title = cleanString(item.title, MAX_REF_TITLE)
    const body = cleanString(item.body, MAX_REF_BODY)
    const source = cleanString(item.source, MAX_REF_SOURCE) || 'manual'
    if (!url && !title && !body) continue
    const ref = { source }
    if (url) ref.url = url
    if (title) ref.title = title
    if (body) ref.body = body
    out.push(ref)
    if (out.length >= 5) break
  }
  return out
}

// 对标账号：页面只开放 { name }，投影为对标账号对象子集（docs/0904/xhs §5.1）。
function projectAccounts(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const name = cleanString(item.name, MAX_ACCOUNT_NAME)
    if (name) out.push({ name })
    if (out.length >= 5) break
  }
  return out
}

function projectSteps(list) {
  if (!Array.isArray(list)) return []
  return list.map(item => ({ step: cleanString(item?.step, 64), status: cleanString(item?.status, 24) })).filter(item => item.step)
}

// 版本投影：只保留服务端已校验的展示字段，正文 body 交给客户端 MarkdownText 渲染。
const SAFE_VERSION_FIELDS = ['version', 'title', 'body', 'tags', 'coverCopy', 'leadGuide']
function projectVersions(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const version = { version: firstString(item.version) || '?', title: firstString(item.title) || '', body: firstString(item.body) || '', tags: Array.isArray(item.tags) ? item.tags.map(value => String(value)).slice(0, 20) : [], coverCopy: firstString(item.coverCopy) || '', leadGuide: firstString(item.leadGuide) || '' }
    if (Array.isArray(item.pages)) {
      const pages = []
      for (const page of item.pages) {
        const index = numberOrNull(page?.pageIndex)
        if (index === null) continue
        pages.push({ pageIndex: index, copy: firstString(page?.copy) || '' })
        if (pages.length >= 18) break
      }
      if (pages.length) version.pages = pages
    }
    out.push(version)
    if (out.length >= 3) break
  }
  return out
}

function findTool(ctx, name) { return (ctx.tools.schemas?.() || []).find(item => String(item.name || '').includes(name)) }

function parseResult(result) {
  if (!result) return {}
  if (result && typeof result === 'object' && !Array.isArray(result) && result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent
  if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray(result.content)) {
    const text = result.content.filter(item => item?.type === 'text').map(item => String(item.text || '')).join('')
    if (!text) return {}
    try { return JSON.parse(text) } catch { return {} }
  }
  return result
}

function safeToolErrorReason(error) {
  const allowed = new Set(['TASK_NOT_FOUND', 'TASK_STATE_CONFLICT', 'RESULT_NOT_READY', 'CONFIRMATION_REQUIRED', 'VALIDATION_ERROR', 'STEP_INPUT_TOO_LARGE', 'ASSET_NOT_FOUND', 'PROVIDER_ERROR'])
  const message = error && typeof error.message === 'string' ? error.message : ''
  try {
    const payload = JSON.parse(message)
    const code = payload?.error?.code
    if (allowed.has(code)) return code
  } catch {}
  return allowed.has(message) ? message : 'xhs_operation_request_failed'
}

function cleanString(value, max) { if (value === null || value === undefined) return ''; return String(value).trim().slice(0, max) }
function cleanOptional(value, max) { const cleaned = cleanString(value, max); return cleaned || null }
function cleanMediaUrl(value) { return cleanString(value, MAX_MEDIA_URL) }
function cleanIdempotencyKey(value) { const cleaned = cleanString(value, MAX_IDEMPOTENCY_KEY); return cleaned || randomUUID() }
function cleanImageUrls(value) {
  if (!Array.isArray(value)) return null
  const urls = value.map(item => cleanMediaUrl(item)).filter(Boolean).slice(0, MAX_IMAGE_COUNT)
  return urls.length ? urls : null
}
function firstString(...values) { for (const value of values) if (typeof value === 'string' && value) return value; return null }
function numberOrNull(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null }

async function readBody(req) {
  if (typeof req.body === 'object' && req.body) return req.body
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > 32768) throw new Error('body_too_large') }
  return raw ? JSON.parse(raw) : {}
}
function send(res, status, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
