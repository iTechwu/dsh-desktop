// 小红书仿写 host endpoint：浏览器页面只访问本地同源路由，Host 通过 ctx.tools 调用
// dofe-managed 统一创建的 tools-xhs-operation MCP Client（xhs_operation_task_create /
// task_get / result_get），并把 MCP 信封投影为安全结果。页面不读取 MODELS_API_KEY、
// 不直连公网 MCP，也不接收凭据、内部地址或原始传输错误（docs/0904/xhs §6.1）。
// RQ-2026-002（docs/0928/xhs）：create 新增 direction / videoUnderstanding / versionCount=1，
// 结果单版可编辑（1-3 版兼容投影）。

import { createHash, randomUUID } from 'node:crypto'

import { browserStatus as chromeBrowserStatus } from './src/chrome.js'
import { collectNotes, summarizeSnapshot } from './src/collector.js'
import { isAllowedMaterialUrl, publishDraft } from './src/publisher.js'
import {
  acquireProfileLock,
  loginWithQrCode,
  probeSession,
  removeLocalAccount,
} from './src/session.js'
import { latestSnapshot, readAccounts, stateRoot } from './src/state.js'

const PATH = '/api/desktop/yootun/xhs-operation'
const TOOL_CALL_TIMEOUT_MS = 60_000

// 字段上限与 docs/0904/xhs §5.1 客户端调用合同一致，页面只开放 images/video。
const MAX_THEME = 500
const MAX_DIRECTION = 500
const MAX_MEDIA_URL = 2048
const MAX_IMAGE_COUNT = 9
const MAX_REF_URL = 2048
const MAX_REF_TITLE = 200
const MAX_REF_BODY = 5000
const MAX_REF_SOURCE = 16
const MAX_ACCOUNT_NAME = 200
const MAX_IDEMPOTENCY_KEY = 128
const MAX_TASK_ID = 64
const MAX_ACCOUNT_ID = 128

// 设备端浏览器/会话操作的受控错误码（dev-implementation §2.1）；其余一律收敛。
const LOCAL_ERROR_CODES = new Set([
  'GOOGLE_CHROME_MISSING',
  'PLAYWRIGHT_DRIVER_MISSING',
  'SESSION_EXPIRED',
  'LOGIN_TIMEOUT',
  'CAPTCHA_DETECTED',
  'UPLOAD_TIMEOUT',
  'SAVE_DRAFT_NO_RESPONSE',
  'SELECTOR_MISSING',
  'COLLECT_FAILED',
  'PROFILE_BUSY',
  'PUBLISH_FAILED',
  'MATERIAL_SOURCE_REJECTED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'PROBE_FAILED',
  'LOGIN_FAILED',
])

/** 本地浏览器/采集错误 → 受控错误码（error.code 白名单），非受控返回 null。 */
function localErrorCode(error) {
  const code = error && typeof error.code === 'string' ? error.code : ''
  return LOCAL_ERROR_CODES.has(code) ? code : null
}

export const inject = ['webServer', 'tools', 'yootunAudit']

const auditedTerminalTasks = new Set()

// 登录与采集是后台长动作（等人扫码 / 翻页采集）：状态保存在宿主进程内，页面轮询查询。
const loginRuns = new Map()
const collectRuns = new Map()
// 发布同样是后台长动作（有头拟人化录入，分钟级）：run 状态页面 2s 轮询查询。
const publishRuns = new Map()
// 创建型操作幂等（dev-implementation §2.1）：idempotencyKey → collectId/publishId 重放既有 run。
const collectIdempotency = new Map()
const publishIdempotency = new Map()

export function apply(ctx, overrides = {}) {
  const deps = {
    root: overrides.root || stateRoot(),
    browserStatus: overrides.browserStatus || chromeBrowserStatus,
    login: overrides.login || loginWithQrCode,
    probe: overrides.probe || probeSession,
    removeLocal: overrides.removeLocal || removeLocalAccount,
    readAccounts: overrides.readAccounts || readAccounts,
    latestSnapshot: overrides.latestSnapshot || latestSnapshot,
    collect: overrides.collect || collectNotes,
    summarize: overrides.summarize || summarizeSnapshot,
    publish: overrides.publish || publishDraft,
  }
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
          if (action === 'cancel') return await handleCancel(ctx, body, res)
          if (action === 'browser.status') return send(res, 200, await handleBrowserStatus(deps))
          if (action === 'accounts.list') return send(res, 200, await handleAccountsList(deps))
          if (action === 'account.beginLogin') return send(res, 200, await handleBeginLogin(ctx, deps, body))
          if (action === 'account.loginStatus') return send(res, 200, handleLoginStatus(deps, body))
          if (action === 'account.probe') return send(res, 200, await handleProbe(deps, body))
          if (action === 'account.removeLocal') return send(res, 200, await handleRemoveLocal(deps, body))
          if (action === 'collect.start') return send(res, 200, await handleCollectStart(ctx, deps, body))
          if (action === 'collect.status') return send(res, 200, handleCollectStatus(deps, body))
          if (action === 'publish.start') return send(res, 200, await handlePublishStart(ctx, deps, body))
          if (action === 'publish.status') return send(res, 200, handlePublishStatus(deps, body))
          // 车衣爆款看板（RQ-2026-003 DEV-06）：hotboard.* 与 MCP 工具一一映射，
          // 统一走白名单 + 参数清洗 + 错误收敛通道（§13.2）。
          if (action.startsWith('hotboard.')) return await handleHotboard(ctx, body, res, action)
          return send(res, 400, { status: 'error', reason: 'unknown_action' })
        } catch (error) {
          const reason = localErrorCode(error) || safeToolErrorReason(error)
          ctx.logger?.warn?.('yootun xhs operation failed: %s', reason)
          return send(res, 200, { status: 'error', reason })
        }
      },
    })
    return () => {
      dispose?.()
      loginRuns.clear()
      collectRuns.clear()
      publishRuns.clear()
      collectIdempotency.clear()
      publishIdempotency.clear()
    }
  })
}

async function handleCreate(ctx, body, res, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const mediaType = cleanString(body.mediaType, 16)
  if (mediaType !== 'images' && mediaType !== 'video') return send(res, 400, { status: 'error', reason: 'invalid_media_type' })
  const schema = findTool(ctx, 'xhs_operation_task_create')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })

  const theme = cleanOptional(body.theme, MAX_THEME)
  // 文案方向（RQ-2026-002）：清洗同 theme，空视为未传。
  const direction = cleanOptional(body.direction, MAX_DIRECTION)
  const references = projectReferences(body.references)
  const accounts = projectAccounts(body.accounts)
  // 单版可编辑场景页面固定传 1；1-3 之外（含非法值）回退 1（服务端 schema 兜底 1-3）。
  const versionCount = [1, 2, 3].includes(Number(body.versionCount)) ? Number(body.versionCount) : 1
  // 理解视频内容开关（默认关）：仅 video 生效。
  const videoUnderstanding = mediaType === 'video' && body.videoUnderstanding === true

  // 对标笔记/账号为空时传 []；theme/direction 为空时不传（与 docs/0904/xhs §5.1 一致）。
  const args = { mediaType, confirm: true, references, accounts, versionCount }
  if (theme) args.theme = theme
  if (direction) args.direction = direction
  if (mediaType === 'images') {
    const imageUrls = cleanImageUrls(body.imageUrls)
    if (imageUrls === null) return send(res, 400, { status: 'error', reason: 'image_urls_required' })
    args.imageUrls = imageUrls
    args.coverIndex = 0
  } else {
    const videoUrl = cleanMediaUrl(body.videoUrl)
    if (!videoUrl) return send(res, 400, { status: 'error', reason: 'video_url_required' })
    args.videoUrl = videoUrl
    args.videoUnderstanding = videoUnderstanding
  }
  // 幂等键必填（审查 P2）：创建型/有副作用操作，参数校验全部通过后强制校验。
  const idempotencyKey = cleanString(body.idempotencyKey, MAX_IDEMPOTENCY_KEY)
  if (!idempotencyKey) return send(res, 400, { status: 'error', reason: 'idempotency_key_required' })
  args.idempotencyKey = idempotencyKey

  const result = await ctx.tools.execute({ callId: `yootun-xhs-create-${Date.now()}`, name: schema.name, arguments: args, signal })
  const payload = parseResult(result)
  const taskId = firstString(payload.taskId, payload.task_ref, payload.taskRef)
  if (!taskId) return send(res, 200, { status: 'error', reason: 'create_failed_no_task' })
  await recordCreatedAudit(ctx, taskId, firstString(payload.status) || 'queued', versionCount)
  return send(res, 200, { status: 'created', taskId, idempotencyKey, mediaType, versionCount, taskStatus: firstString(payload.status) || 'queued' })
}

async function handleStatus(ctx, body, res, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const taskId = cleanString(body.taskId, MAX_TASK_ID)
  if (!taskId) return send(res, 400, { status: 'error', reason: 'task_id_required' })
  const schema = findTool(ctx, 'xhs_operation_task_get')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })
  const result = await ctx.tools.execute({ callId: `yootun-xhs-status-${Date.now()}`, name: schema.name, arguments: { taskId }, signal })
  const payload = parseResult(result)
  const taskStatus = firstString(payload.status) || 'unknown'
  // succeeded 的终态审计延迟到 result 读取（versionCount 以实际 versions 长度为准）；
  // failed/cancelled 只能经 status 观测到，versionCount 记 0（未知）。
  if (taskStatus !== 'succeeded') {
    await recordTerminalAudit(ctx, taskId, taskStatus, 0, firstString(payload.errorCode))
  }
  return send(res, 200, {
    status: 'ready',
    taskId,
    taskStatus,
    currentStep: firstString(payload.currentStep),
    nextStep: firstString(payload.nextStep),
    errorCode: firstString(payload.errorCode),
    errorMessage: cleanString(payload.errorMessage, 512),
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
  // 契约（RQ-2026-002 单版可编辑）：succeeded 必须返回 1-3 套文案；越界按读取失败处理，
  // 避免空白或静默异常版本数。期望版本数（1 或 3）由页面按创建时 versionCount 校验。
  if (taskStatus === 'succeeded' && (versions.length < 1 || versions.length > 3)) {
    return send(res, 200, { status: 'error', reason: 'versions_unavailable', taskId, taskStatus })
  }
  await recordTerminalAudit(ctx, taskId, taskStatus, versions.length, firstString(payload.errorCode))
  return send(res, 200, { status: 'ready', taskId, taskStatus, versions })
}

async function handleCancel(ctx, body, res, signal = AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS)) {
  const taskId = cleanString(body.taskId, MAX_TASK_ID)
  if (!taskId) return send(res, 400, { status: 'error', reason: 'task_id_required' })
  const schema = findTool(ctx, 'xhs_operation_task_cancel')
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })
  const idempotencyKey = cleanIdempotencyKey(body.idempotencyKey)
  const result = await ctx.tools.execute({ callId: `yootun-xhs-cancel-${Date.now()}`, name: schema.name, arguments: { taskId, confirm: true, idempotencyKey }, signal })
  const payload = parseResult(result)
  // 服务端取消是“请求取消”：立即返回 projection（status 通常为 cancel_requested），
  // 真正落 cancelled 由 Driver 在安全点推进；此处透传该状态给前端。
  const taskStatus = firstString(payload.status) || 'cancel_requested'
  await recordCancelledAudit(ctx, taskId, taskStatus)
  return send(res, 200, { status: 'ready', taskId, taskStatus })
}

// ---------------------------------------------------------------------------
// 阶段 2（RQ-2026-002）：浏览器能力、账号管理与基本数据采集（设备端本地，Q10 不入库）
// ---------------------------------------------------------------------------

async function handleBrowserStatus(deps) {
  const status = await deps.browserStatus()
  return {
    status: 'ready',
    chromeAvailable: status.chromeAvailable,
    driverAvailable: status.driverAvailable,
    platform: status.platform,
    // 阻断文案由 UI 呈现；此处只给布尔与平台，不回传设备路径细节。
    hint: status.chromeAvailable ? null : 'install_google_chrome',
  }
}

// 头像 URL 白名单化：仅放行 http(s) 绝对地址（与登录侧同一约束），超长与
// javascript:/data: 等危险协议一律置 null。这是宿主侧最终防御，永不删除。
function projectAvatar(value) {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  if (!/^https?:\/\//i.test(candidate)) return null
  return candidate.slice(0, 2048)
}

/** 最新采集快照的本地聚合投影（不入库，页面直读，Q10）；无快照不落字段。 */
async function projectSnapshotSummary(deps, accountId) {
  try {
    const snapshot = await deps.latestSnapshot(accountId, deps.root)
    if (!snapshot) return null
    const summary = deps.summarize(snapshot)
    return {
      notesCount: summary.notesCount,
      totals: summary.totals,
      gaps: summary.gaps,
      capturedAt: summary.capturedAt,
    }
  } catch {
    return null
  }
}

async function handleAccountsList(deps) {
  const local = await deps.readAccounts(deps.root)
  const accounts = []
  for (const record of Object.values(local.accounts || {})) {
    if (!record || !record.accountId) continue
    const entry = {
      accountId: String(record.accountId).slice(0, MAX_ACCOUNT_ID),
      nickname: typeof record.nickname === 'string' && record.nickname ? record.nickname.slice(0, 256) : null,
      avatar: projectAvatar(record.avatar),
      sessionStatus: record.sessionStatus || 'unknown',
      sessionCheckedAt: record.sessionCheckedAt || null,
      lastCollectedAt: record.lastCollectedAt || null,
    }
    const summary = await projectSnapshotSummary(deps, entry.accountId)
    if (summary) entry.summary = summary
    accounts.push(entry)
  }
  accounts.sort((a, b) => a.accountId.localeCompare(b.accountId))
  return { status: 'ready', accounts }
}

async function handleBeginLogin(ctx, deps, body) {
  const requested = cleanString(body.accountId, MAX_ACCOUNT_ID)
  // 重复调用返回既有 waiting run（幂等；页面刷新重试不重复弹窗）：
  // 显式账号按 accountId 匹配；新增账号（无 accountId）全进程同时只开一个扫码 run。
  for (const run of loginRuns.values()) {
    if (run.status !== 'waiting') continue
    if (requested ? run.key === requested : run.key.startsWith('pending-')) {
      return { status: 'ready', login: projectLogin(run) }
    }
  }
  const runKey = requested || `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  // Profile 互斥（dev-implementation §2.1）：重新登录锁显式账号；新增账号锁 pending 键。
  const release = acquireProfileLock(runKey)
  if (!release) return { status: 'error', reason: 'PROFILE_BUSY' }
  const run = { key: runKey, status: 'waiting', accountId: null, nickname: null, avatar: null, error: null, release }
  loginRuns.set(runKey, run)
  // 登录是有头长动作：立即返回 waiting，后台完成后写回 run（页面轮询 loginStatus）。
  deps.login({ accountId: requested || undefined, root: deps.root })
    .then(async result => {
      if (result.status === 'ok') {
        run.status = 'ok'
        run.accountId = result.accountId
        run.nickname = result.profile ? result.profile.nickname : null
        run.avatar = result.profile ? result.profile.avatar : null
        if (runKey !== run.accountId) {
          // pending run 以 resolvedId 补映射供 loginStatus 查询；若该账号已有
          // 进行中的显式登录 run，绝不覆盖（登录页按 loginId 各查各的）。
          const existing = loginRuns.get(run.accountId)
          if (!existing || existing.status !== 'waiting') loginRuns.set(run.accountId, run)
        }
        await recordAudit(ctx, {
          clientEventId: eventUuid(`xhs:login:${run.accountId}:ok`), traceId: `xhs:account:${run.accountId}`,
          actionCode: 'xhs.account.login', category: 'execute',
          source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
          target: { type: 'xhs_account', id: run.accountId }, outcome: 'succeeded', changes: [], effects: [],
        })
      } else {
        run.status = result.status === 'timeout' ? 'timeout' : 'failed'
        // 错误码收敛到受控白名单（审查 P2）：不透出原始异常名。
        run.error = result.reason === 'CAPTCHA_DETECTED'
          ? 'CAPTCHA_DETECTED'
          : result.status === 'timeout'
            ? 'LOGIN_TIMEOUT'
            : LOCAL_ERROR_CODES.has(String(result.reason || '')) ? result.reason : 'LOGIN_FAILED'
        await recordAudit(ctx, {
          clientEventId: eventUuid(`xhs:login:${runKey}:${run.status}`), traceId: `xhs:account:${requested || runKey}`,
          actionCode: 'xhs.account.login', category: 'execute',
          source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
          target: { type: 'xhs_account', id: requested || runKey }, outcome: 'failed',
          changes: [], effects: [], errorCode: String(run.error).toLowerCase().slice(0, 80),
        })
      }
    })
    .catch(error => {
      run.status = 'failed'
      run.error = localErrorCode(error) || 'LOGIN_FAILED'
    })
    .finally(() => {
      release()
      // 终态 run 保留供 loginStatus 查询一次，读取后即清理。
    })
  return { status: 'ready', login: projectLogin(run) }
}

function handleLoginStatus(deps, body) {
  const key = cleanString(body.loginId, MAX_ACCOUNT_ID) || cleanString(body.accountId, MAX_ACCOUNT_ID)
  const run = key ? loginRuns.get(key) : null
  if (!run) {
    // 无进行中登录：返回 idle（页面刷新后直接查账号列表即可）。
    return { status: 'ready', login: { status: 'idle', loginId: key || null } }
  }
  if (run.status !== 'waiting') {
    loginRuns.delete(run.key)
    if (run.accountId && run.accountId !== run.key) loginRuns.delete(run.accountId)
  }
  return { status: 'ready', login: projectLogin(run) }
}

function projectLogin(run) {
  return {
    loginId: run.key,
    status: run.status,
    accountId: run.accountId,
    nickname: run.nickname,
    avatar: run.avatar,
    reason: run.error || null,
  }
}

async function handleProbe(deps, body) {
  const accountId = cleanString(body.accountId, MAX_ACCOUNT_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  // Profile 互斥：probe（无头复用 Profile）与其他浏览器操作互斥（dev-implementation §2.1）。
  const release = acquireProfileLock(accountId)
  if (!release) return { status: 'error', reason: 'PROFILE_BUSY' }
  try {
    const result = await deps.probe({ accountId, root: deps.root })
    if (result.status === 'ok' || result.status === 'expired') {
      return { status: 'ready', accountId, sessionStatus: result.status }
    }
    // unknown（浏览器/驱动异常）→ 受控 PROBE_FAILED，不透出原始异常名（审查 P2）。
    return { status: 'error', reason: LOCAL_ERROR_CODES.has(String(result.reason || '')) ? result.reason : 'PROBE_FAILED' }
  } finally {
    release()
  }
}

async function handleRemoveLocal(deps, body) {
  const accountId = cleanString(body.accountId, MAX_ACCOUNT_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  // 移除会递归删除该账号的 Profile/storage_state/快照：与登录/probe/采集互斥，
  // 否则运行中的浏览器操作会在被删目录上继续写、完成回调还会把记录写回（僵尸账号）。
  const release = acquireProfileLock(accountId)
  if (!release) return { status: 'error', reason: 'PROFILE_BUSY' }
  try {
    const result = await deps.removeLocal({ accountId, root: deps.root })
    // 幂等删除：源不存在也视为已清除（removed 布尔仅反映删除动作执行成功）。
    return { status: 'ready', accountId, removed: { profile: result.cleared.profile !== false, storageState: result.cleared.storageState !== false } }
  } finally {
    release()
  }
}

async function handleCollectStart(ctx, deps, body) {
  const accountId = cleanString(body.accountId, MAX_ACCOUNT_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  const idempotencyKey = cleanString(body.idempotencyKey, MAX_IDEMPOTENCY_KEY)
  // 幂等键必填（审查 P2）：采集是有副作用操作（写本地快照）。
  if (!idempotencyKey) return { status: 'error', reason: 'idempotency_key_required' }
  if (idempotencyKey && collectIdempotency.has(idempotencyKey)) {
    // 幂等重放：返回既有 run 的当前状态（不重复创建采集任务）。
    const run = collectRuns.get(collectIdempotency.get(idempotencyKey))
    if (run) return { status: 'started', collectId: run.collectId, collect: projectCollect(run) }
  }
  // Profile 互斥：采集（无头复用 Profile）与其他浏览器操作互斥（dev-implementation §2.1）。
  const release = acquireProfileLock(accountId)
  if (!release) return { status: 'error', reason: 'PROFILE_BUSY' }
  const collectId = `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const run = { collectId, accountId, status: 'running', pagesDone: 0, notesTotal: 0, truncated: false, summary: null, error: null, release }
  collectRuns.set(collectId, run)
  if (idempotencyKey) collectIdempotency.set(idempotencyKey, collectId)
  await recordAudit(ctx, {
    clientEventId: eventUuid(`xhs:collect:${collectId}:started`), traceId: `xhs:collect:${accountId}`,
    actionCode: 'xhs.collect.started', category: 'create',
    source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'xhs_collect_run', id: collectId }, outcome: 'accepted', changes: [], effects: [],
  })
  // 采集是后台长动作：立即返回 started，结果落设备端快照（不入库，Q10）。
  deps.collect({ accountId, root: deps.root, onProgress: progress => {
    if (collectRuns.get(collectId) !== run) return
    run.pagesDone = Number(progress && progress.pagesDone) || run.pagesDone
    run.notesTotal = Number(progress && progress.notesTotal) || run.notesTotal
  } })
    .then(async result => {
      run.status = 'completed'
      run.pagesDone = result.pagesDone
      run.notesTotal = result.notesTotal
      run.summary = result.summary
      run.truncated = result.truncated === true
      await recordAudit(ctx, {
        clientEventId: eventUuid(`xhs:collect:${collectId}:completed`), traceId: `xhs:collect:${accountId}`,
        actionCode: 'xhs.collect.run', category: 'execute',
        source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
        target: { type: 'xhs_collect_run', id: collectId }, outcome: 'succeeded',
        changes: [{ field: 'notesTotal', after: result.notesTotal }, ...(run.truncated ? [{ field: 'truncated', after: true }] : [])], effects: [],
      })
    })
    .catch(async error => {
      run.status = 'failed'
      run.error = localErrorCode(error) || 'COLLECT_FAILED'
      await recordAudit(ctx, {
        clientEventId: eventUuid(`xhs:collect:${collectId}:failed`), traceId: `xhs:collect:${accountId}`,
        actionCode: 'xhs.collect.run', category: 'execute',
        source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
        target: { type: 'xhs_collect_run', id: collectId }, outcome: 'failed',
        changes: [], effects: [], errorCode: String(run.error).toLowerCase().slice(0, 80),
      })
    })
    .finally(() => release())
  return { status: 'started', collectId, collect: projectCollect(run) }
}

function handleCollectStatus(deps, body) {
  const collectId = cleanString(body.collectId, MAX_ACCOUNT_ID)
  const run = collectId ? collectRuns.get(collectId) : null
  if (!run) return { status: 'error', reason: 'collect_id_required' }
  return { status: 'ready', collect: projectCollect(run) }
}

function projectCollect(run) {
  return {
    collectId: run.collectId,
    accountId: run.accountId,
    collectStatus: run.status,
    pagesDone: run.pagesDone,
    notesTotal: run.notesTotal,
    truncated: run.truncated === true,
    summary: run.summary,
    error: run.error,
  }
}

// 发布入参上限：标题/正文按 publisher 内 20 字截断与编辑器上限留余量，这里只挡超大输入。
const MAX_PUBLISH_TEXT = 5000
const MAX_TAG = 50

function cleanTags(value) {
  // tags 非必填（纯正文无话题也可发布）：未传 → 空数组；显式传非数组 → 拒绝。
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  return value.map(item => cleanString(item, MAX_TAG)).filter(Boolean).slice(0, 10)
}

async function handlePublishStart(ctx, deps, body) {
  const accountId = cleanString(body.accountId, MAX_ACCOUNT_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  const title = cleanString(body.title, MAX_PUBLISH_TEXT)
  if (!title) return { status: 'error', reason: 'title_required' }
  const content = cleanString(body.body, MAX_PUBLISH_TEXT)
  if (!content) return { status: 'error', reason: 'body_required' }
  const tags = cleanTags(body.tags)
  if (tags === null) return { status: 'error', reason: 'invalid_tags' }
  // visibility 契约固定 'private'（dev-implementation §2.1）：显式传入其他值即拒绝，
  // 本流程只保存草稿，不存在公开发布路径。
  if (body.visibility !== undefined && body.visibility !== 'private') {
    return { status: 'error', reason: 'invalid_visibility' }
  }
  const idempotencyKey = cleanString(body.idempotencyKey, MAX_IDEMPOTENCY_KEY)
  // 幂等键必填（审查 P2）：发布是重副作用操作（开浏览器/写草稿）。
  if (!idempotencyKey) return { status: 'error', reason: 'idempotency_key_required' }
  if (idempotencyKey && publishIdempotency.has(idempotencyKey)) {
    // 幂等重放：返回既有 run 的当前状态（不重复打开浏览器/重复录入）。
    const run = publishRuns.get(publishIdempotency.get(idempotencyKey))
    if (run) return { status: 'started', publishId: run.publishId, publish: projectPublish(run) }
  }
  const videoEntry = cleanMaterialEntry(body.videoUrl)
  const isVideo = Boolean(videoEntry)
  const imageUrls = cleanMaterialList(body.imageUrls) || []
  if (!isVideo && !imageUrls.length) return { status: 'error', reason: 'material_required' }
  if (isVideo && imageUrls.length) return { status: 'error', reason: 'material_conflict' }
  // SSRF 防护（审查 P2）：内网/明文 URL 在 host 层即拒绝（浏览器保持打开之前）。
  if (videoEntry === 'rejected' || imageUrls === 'rejected') {
    return { status: 'error', reason: 'MATERIAL_SOURCE_REJECTED' }
  }
  // Profile 互斥：发布（有头）与登录/probe/采集互斥（dev-implementation §2.1）。
  const release = acquireProfileLock(accountId)
  if (!release) return { status: 'error', reason: 'PROFILE_BUSY' }
  const publishId = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const run = { publishId, accountId, status: 'running', step: 'prepare', toast: null, error: null, release }
  publishRuns.set(publishId, run)
  if (idempotencyKey) publishIdempotency.set(idempotencyKey, publishId)
  await recordAudit(ctx, {
    clientEventId: eventUuid(`xhs:publish:${publishId}:started`), traceId: `xhs:publish:${accountId}`,
    actionCode: 'xhs.publish.started', category: 'create',
    source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'xhs_publish_run', id: publishId }, outcome: 'accepted', changes: [], effects: [],
  })
  // 发布是后台长动作：立即返回 started。完成后浏览器保持打开（README §5.3）——
  // 互斥锁随浏览器窗口生命周期：onContext 挂钩后由 context close 释放；
  // 早期失败（context 未创建）由 finally 释放（审查 P1）。
  let releaseProfile = release
  let contextHooked = false
  deps.publish({
    accountId,
    title,
    body: content,
    tags,
    ...(isVideo ? { videoUrl: videoEntry } : { imageUrls }),
    root: deps.root,
    onStep: step => {
      if (publishRuns.get(publishId) !== run) return
      run.step = step
    },
    // 浏览器生命周期钩子（审查 P1）：run 终态后 Chrome 仍保持打开并占用 Profile，
    // 互斥锁必须随之保持；用户关闭窗口（context close）时才真正释放。
    onContext: context => {
      contextHooked = true
      context.once('close', () => releaseProfile())
    },
  })
    .then(async result => {
      run.status = 'completed'
      run.step = 'done'
      run.toast = String(result && result.toast ? result.toast : '').slice(0, 60) || null
      await recordAudit(ctx, {
        clientEventId: eventUuid(`xhs:publish:${publishId}:completed`), traceId: `xhs:publish:${accountId}`,
        actionCode: 'xhs.publish.run', category: 'execute',
        source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
        target: { type: 'xhs_publish_run', id: publishId }, outcome: 'succeeded',
        changes: [{ field: 'step', after: 'done' }], effects: [],
      })
    })
    .catch(async error => {
      run.status = 'failed'
      run.error = localErrorCode(error) || 'PUBLISH_FAILED'
      await recordAudit(ctx, {
        clientEventId: eventUuid(`xhs:publish:${publishId}:failed`), traceId: `xhs:publish:${accountId}`,
        actionCode: 'xhs.publish.run', category: 'execute',
        source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
        target: { type: 'xhs_publish_run', id: publishId }, outcome: 'failed',
        changes: [], effects: [], errorCode: String(run.error).toLowerCase().slice(0, 80),
      })
    })
    .finally(() => { if (!contextHooked) releaseProfile() })
  return { status: 'started', publishId, publish: projectPublish(run) }
}

function handlePublishStatus(deps, body) {
  const publishId = cleanString(body.publishId, MAX_ACCOUNT_ID)
  const run = publishId ? publishRuns.get(publishId) : null
  if (!run) return { status: 'error', reason: 'publish_id_required' }
  return { status: 'ready', publish: projectPublish(run) }
}

function projectPublish(run) {
  return {
    publishId: run.publishId,
    accountId: run.accountId,
    publishStatus: run.status,
    step: run.step,
    toast: run.toast,
    error: run.error,
  }
}

// ---------------------------------------------------------------------------
// 车衣爆款看板（RQ-2026-003 DEV-06）：hotboard.* action 与 MCP 工具一一映射。
// Host 必须做（实施文档 §13.2）：action 白名单、body 大小限制（readBody 32KB）、
// 枚举与分页校验、confirm 校验、UUID/字符串长度校验、错误转换、响应投影、审计
// 事件。页面不直连 MCP，也不接收凭据、内部地址或 Provider 原文错误。
// ---------------------------------------------------------------------------

// action → MCP 工具映射（与 server.py 注册名一致）与写操作审计 target。
const HOTBOARD_ACTIONS = {
  'hotboard.overview': { tool: 'xhs_operation_hotboard_overview' },
  'hotboard.noteDetail': { tool: 'xhs_operation_hotboard_note_detail' },
  'hotboard.noteTagUpdate': { tool: 'xhs_operation_hotboard_note_tag_update', write: true, target: 'note_tag', op: 'note_tag_update' },
  'hotboard.keywords': { tool: 'xhs_operation_hotboard_keywords_list' },
  'hotboard.keywordSave': { tool: 'xhs_operation_hotboard_keyword_save', write: true, target: 'keyword', op: 'keyword_save' },
  'hotboard.settings': { tool: 'xhs_operation_hotboard_settings_get' },
  'hotboard.settingsUpdate': { tool: 'xhs_operation_hotboard_settings_update', write: true, target: 'settings', op: 'settings_update' },
  'hotboard.runStart': { tool: 'xhs_operation_hotboard_run_start', write: true, target: 'run', op: 'run_start', category: 'create' },
  'hotboard.runGet': { tool: 'xhs_operation_hotboard_run_get' },
  'hotboard.candidates': { tool: 'xhs_operation_hotboard_candidates_list' },
  'hotboard.candidateReview': { tool: 'xhs_operation_hotboard_candidate_review', write: true, target: 'candidate', op: 'candidate_review' },
  'hotboard.labels': { tool: 'xhs_operation_hotboard_labels_list' },
  'hotboard.labelReview': { tool: 'xhs_operation_hotboard_label_review', write: true, target: 'label', op: 'label_review' },
  'hotboard.labelSave': { tool: 'xhs_operation_hotboard_label_save', write: true, target: 'label', op: 'label_save' },
}

// MCP 对外稳定错误码白名单（实施文档 §12.4 + 通用确认/校验码）；其余收敛 INTERNAL。
const HOTBOARD_ERROR_CODES = new Set([
  'XHS_HOTBOARD_INVALID_ARGUMENT',
  'XHS_HOTBOARD_NOT_FOUND',
  'XHS_HOTBOARD_ACTIVE_RUN_EXISTS',
  'XHS_HOTBOARD_BUDGET_EXHAUSTED',
  'XHS_HOTBOARD_KEYWORD_EMPTY',
  'XHS_HOTBOARD_KEYWORD_CONFLICT',
  'XHS_HOTBOARD_EVIDENCE_INSUFFICIENT',
  'XHS_HOTBOARD_LABEL_CONFLICT',
  'XHS_HOTBOARD_AI_SCHEMA_INVALID',
  'XHS_HOTBOARD_PROVIDER_FAILED',
  'XHS_HOTBOARD_INTERNAL_ERROR',
  'CONFIRMATION_REQUIRED',
  'VALIDATION_ERROR',
])

// 枚举白名单（与 server.py Literal 一致）。
const HOTBOARD_ENUMS = {
  window: new Set(['7d', '30d', '90d']),
  sort: new Set(['score', 'publishTime', 'collect', 'like', 'comment', 'share']),
  keywordCategory: new Set(['product', 'scene']),
  keywordStatus: new Set(['active', 'disabled']),
  keywordSource: new Set(['built_in', 'manual', 'agent']),
  candidateStatus: new Set(['pending', 'accepted', 'rejected', 'expired']),
  labelStatus: new Set(['active', 'retired']),
  labelSource: new Set(['business_seed', 'ai', 'manual']),
  proposalStatus: new Set(['pending', 'auto_activated', 'accepted', 'rejected', 'merged', 'expired']),
  tagType: new Set(['style', 'color']),
  keywordAction: new Set(['create', 'update', 'enable', 'disable']),
  candidateAction: new Set(['accepted', 'rejected']),
  labelReviewAction: new Set(['accept', 'reject', 'merge', 'enable', 'retire']),
  runType: new Set(['incremental']),
}

// settings 受控字段白名单（hotboard_mcp._SETTING_COLUMN_BY_FIELD 同口径）；
// host 只做键白名单与值类型粗校验，值域/cron 深校验在 tools 侧。
const HOTBOARD_SETTINGS_BOOL = new Set(['scheduleEnabled', 'manualIncrementEnabled', 'commentSampleEnabled', 'manualCommentDefaultEnabled'])
const HOTBOARD_SETTINGS_NUMBER = new Set(['publishWindowDays', 'perKeywordLimit', 'commentTopN', 'commentMaxPerNote', 'minInteractionTotal', 'dedupHammingThreshold', 'minValidSample', 'searchMaxCallsPerDay', 'commentMaxCallsPerDay', 'detailMaxCallsPerRun'])
const HOTBOARD_SETTINGS_KEYS = new Set([...HOTBOARD_SETTINGS_BOOL, ...HOTBOARD_SETTINGS_NUMBER, 'fullScheduleCron'])

// ID 宽松校验：长度 + 字符集（完整 UUID 语义由 tools 侧兜底）。noteId 是平台
// 笔记 id（非 UUID），单独走 noteId 通道。
function cleanHotboardId(value, max = 64) {
  const id = cleanString(value, max)
  if (!id || !/^[0-9a-f][0-9a-f-]*$/i.test(id)) return null
  return id
}

function hotboardPage(body, key) {
  if (body[key] === undefined || body[key] === null) return undefined
  const num = Number(body[key])
  if (!Number.isInteger(num) || num < 1 || num > 100) return null
  return num
}

// 分页/枚举/字符串参数清洗：返回 args 或 null（null = 校验失败，400 invalid_argument）。
function hotboardArgs(action, body) {
  const args = {}
  const page = hotboardPage(body, 'page')
  if (page === null) return null
  if (page !== undefined) args.page = page
  const pageSize = hotboardPage(body, 'pageSize')
  if (pageSize === null) return null
  if (pageSize !== undefined) args.pageSize = pageSize
  const enumOr = (key, set) => {
    if (body[key] === undefined || body[key] === null || body[key] === '') return undefined
    const value = cleanString(body[key], 64)
    return set.has(value) ? value : null
  }
  const strOr = (key, max) => {
    if (body[key] === undefined || body[key] === null) return undefined
    const value = cleanString(body[key], max)
    if (!value) return null
    args[key] = value
    return value
  }
  switch (action) {
    case 'hotboard.overview': {
      const window = enumOr('window', HOTBOARD_ENUMS.window)
      if (window === null) return null
      args.window = window || '30d'
      const sort = enumOr('sort', HOTBOARD_ENUMS.sort)
      if (sort === null) return null
      if (sort) args.sort = sort
      const style = strOr('style', 64)
      if (style === null) return null
      const color = strOr('color', 64)
      if (color === null) return null
      if (strOr('noteWord', 64) === null) return null
      if (strOr('commentWord', 64) === null) return null
      if (strOr('keyword', 128) === null) return null
      for (const key of ['scoreMin', 'scoreMax']) {
        if (body[key] === undefined || body[key] === null || body[key] === '') continue
        const num = Number(body[key])
        if (!Number.isFinite(num) || num < 0 || num > 100) return null
        args[key] = num
      }
      if (body.onlyMain !== undefined) args.onlyMain = body.onlyMain === true
      if (body.onlyTagged !== undefined) args.onlyTagged = body.onlyTagged === true
      return args
    }
    case 'hotboard.noteDetail': {
      const noteId = cleanString(body.noteId, 128)
      if (!noteId) return null
      args.noteId = noteId
      return args
    }
    case 'hotboard.noteTagUpdate': {
      const noteId = cleanString(body.noteId, 128)
      if (!noteId) return null
      args.noteId = noteId
      const tagType = enumOr('tagType', HOTBOARD_ENUMS.tagType)
      if (!tagType) return null
      args.tagType = tagType
      const labelCode = cleanString(body.labelCode, 64)
      if (!labelCode) return null
      args.labelCode = labelCode
      return args
    }
    case 'hotboard.keywords': {
      const category = enumOr('category', HOTBOARD_ENUMS.keywordCategory)
      if (category === null) return null
      if (category) args.category = category
      const status = enumOr('status', HOTBOARD_ENUMS.keywordStatus)
      if (status === null) return null
      if (status) args.status = status
      const source = enumOr('source', HOTBOARD_ENUMS.keywordSource)
      if (source === null) return null
      if (source) args.source = source
      if (strOr('keyword', 128) === null) return null
      return args
    }
    case 'hotboard.keywordSave': {
      // 子动作走 op 字段（body.action 是宿主路由名，不能复用）。
      const act = enumOr('op', HOTBOARD_ENUMS.keywordAction)
      if (!act) return null
      args.action = act
      if (body.keywordId !== undefined && body.keywordId !== null) {
        const keywordId = cleanHotboardId(body.keywordId)
        if (!keywordId) return null
        args.keywordId = keywordId
      }
      if (body.keyword !== undefined && body.keyword !== null) {
        const keyword = cleanString(body.keyword, 128)
        if (!keyword) return null
        args.keyword = keyword
      }
      const category = enumOr('category', HOTBOARD_ENUMS.keywordCategory)
      if (category === null) return null
      if (category) args.category = category
      return args
    }
    case 'hotboard.settings': {
      // 规则配置只读（OPEN-12 修复）：tools 侧零参工具，空 args 直达（此前缺 case
      // 走 default 返 null，规则页加载稳定报 XHS_HOTBOARD_INVALID_ARGUMENT）。
      return args
    }
    case 'hotboard.settingsUpdate': {
      const settings = body.settings
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
      const keys = Object.keys(settings)
      if (!keys.length || keys.length > HOTBOARD_SETTINGS_KEYS.size) return null
      for (const key of keys) {
        if (!HOTBOARD_SETTINGS_KEYS.has(key)) return null
        const value = settings[key]
        if (key === 'fullScheduleCron') {
          if (typeof value !== 'string' || !value.trim() || value.length > 64) return null
        } else if (HOTBOARD_SETTINGS_BOOL.has(key)) {
          if (typeof value !== 'boolean') return null
        } else if (!Number.isFinite(Number(value)) || typeof value === 'boolean') return null
      }
      args.settings = settings
      return args
    }
    case 'hotboard.runStart': {
      const runType = enumOr('runType', HOTBOARD_ENUMS.runType)
      if (runType === null) return null
      args.runType = runType || 'incremental'
      if (body.includeComments !== undefined) args.includeComments = body.includeComments === true
      return args
    }
    case 'hotboard.runGet': {
      if (body.runId !== undefined && body.runId !== null) {
        const runId = cleanHotboardId(body.runId)
        if (!runId) return null
        args.runId = runId
      }
      return args
    }
    case 'hotboard.candidates': {
      const status = enumOr('status', HOTBOARD_ENUMS.candidateStatus)
      if (status === null) return null
      if (status) args.status = status
      const category = enumOr('category', HOTBOARD_ENUMS.keywordCategory)
      if (category === null) return null
      if (category) args.category = category
      if (strOr('keyword', 128) === null) return null
      // dateRange=[from,to]（YYYY-MM-DD）透传，对应 tools 侧 generatedAt 过滤
      // （review MINOR-3）；格式收窄为纯日期，完整 ISO 时间不放行。
      if (body.dateRange !== undefined) {
        const range = Array.isArray(body.dateRange) && body.dateRange.length === 2
          ? body.dateRange.map(item => String(item ?? ''))
          : null
        if (!range || range.some(item => !/^\d{4}-\d{2}-\d{2}$/.test(item))) return null
        args.dateRange = range
      }
      return args
    }
    case 'hotboard.candidateReview': {
      // 子动作走 op 字段（body.action 是宿主路由名，不能复用）。
      const act = enumOr('op', HOTBOARD_ENUMS.candidateAction)
      if (!act) return null
      args.action = act
      if (!Array.isArray(body.candidateIds) || !body.candidateIds.length || body.candidateIds.length > 50) return null
      const ids = body.candidateIds.map(item => cleanHotboardId(item))
      if (ids.some(id => !id)) return null
      args.candidateIds = ids
      return args
    }
    case 'hotboard.labels': {
      const tagType = enumOr('tagType', HOTBOARD_ENUMS.tagType)
      if (tagType === null) return null
      if (tagType) args.tagType = tagType
      const status = enumOr('status', HOTBOARD_ENUMS.labelStatus)
      if (status === null) return null
      if (status) args.status = status
      const source = enumOr('source', HOTBOARD_ENUMS.labelSource)
      if (source === null) return null
      if (source) args.source = source
      const proposalStatus = enumOr('proposalStatus', HOTBOARD_ENUMS.proposalStatus)
      if (proposalStatus === null) return null
      if (proposalStatus) args.proposalStatus = proposalStatus
      if (strOr('keyword', 128) === null) return null
      return args
    }
    case 'hotboard.labelReview': {
      // 子动作走 op 字段（body.action 是宿主路由名，不能复用）。
      const act = enumOr('op', HOTBOARD_ENUMS.labelReviewAction)
      if (!act) return null
      args.action = act
      for (const key of ['proposalId', 'labelId', 'targetLabelId']) {
        if (body[key] === undefined || body[key] === null || body[key] === '') continue
        const id = cleanHotboardId(body[key])
        if (!id) return null
        args[key] = id
      }
      return args
    }
    case 'hotboard.labelSave': {
      if (body.labelId !== undefined && body.labelId !== null) {
        const labelId = cleanHotboardId(body.labelId)
        if (!labelId) return null
        args.labelId = labelId
      }
      const tagType = enumOr('tagType', HOTBOARD_ENUMS.tagType)
      if (tagType === null) return null
      if (tagType) args.tagType = tagType
      if (body.code !== undefined && body.code !== null) {
        const code = cleanString(body.code, 64)
        if (!code) return null
        args.code = code
      }
      if (body.name !== undefined && body.name !== null) {
        const name = cleanString(body.name, 128)
        if (!name) return null
        args.name = name
      }
      if (body.aliases !== undefined && body.aliases !== null) {
        if (!Array.isArray(body.aliases) || body.aliases.length > 20) return null
        const aliases = body.aliases.map(item => cleanString(item, 128)).filter(Boolean)
        if (aliases.length !== body.aliases.length) return null
        args.aliases = aliases
      }
      if (body.definition !== undefined && body.definition !== null) {
        const definition = cleanString(body.definition, 2000)
        if (!definition) return null
        args.definition = definition
      }
      return args
    }
    default:
      return null
  }
}

// MCP 错误信封 → 受控 reason（白名单外一律收敛 INTERNAL，不透传原文）。
function hotboardErrorReason(payload) {
  const err = payload && typeof payload === 'object' ? payload.error : null
  if (!err || typeof err !== 'object') return null
  const code = typeof err.code === 'string' ? err.code : ''
  return HOTBOARD_ERROR_CODES.has(code) ? code : 'XHS_HOTBOARD_INTERNAL_ERROR'
}

async function handleHotboard(ctx, body, res, action) {
  const spec = HOTBOARD_ACTIONS[action]
  if (!spec) return send(res, 400, { status: 'error', reason: 'unknown_action' })
  const schema = findTool(ctx, spec.tool)
  if (!schema) return send(res, 200, { status: 'unavailable', reason: 'xhs_operation_tool_unavailable' })
  // 写操作：confirm 必须显式 true，幂等键必填（确定性校验前置，失败不烧键）。
  let args = null
  let idempotencyKey = null
  if (spec.write) {
    if (body.confirm !== true) return send(res, 400, { status: 'error', reason: 'confirmation_required' })
    idempotencyKey = cleanString(body.idempotencyKey, MAX_IDEMPOTENCY_KEY)
    if (!idempotencyKey) return send(res, 400, { status: 'error', reason: 'idempotency_key_required' })
  }
  args = hotboardArgs(action, body)
  if (args === null) return send(res, 200, { status: 'error', reason: 'XHS_HOTBOARD_INVALID_ARGUMENT' })
  if (spec.write) { args.confirm = true; args.idempotencyKey = idempotencyKey }

  let result
  try {
    result = await ctx.tools.execute({ callId: `yootun-xhs-${action}-${Date.now()}`, name: schema.name, arguments: args, signal: AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS) })
  } catch (error) {
    const reason = safeHotboardToolError(error)
    ctx.logger?.warn?.('yootun xhs hotboard failed: %s', reason)
    await recordHotboardAudit(ctx, spec, action, idempotencyKey, 'failed', reason, null)
    return send(res, 200, { status: 'error', reason })
  }
  const payload = parseResult(result)
  const errorReason = hotboardErrorReason(payload)
  if (errorReason) {
    await recordHotboardAudit(ctx, spec, action, idempotencyKey, 'failed', errorReason, null)
    return send(res, 200, { status: 'error', reason: errorReason })
  }
  if (spec.write) {
    // 写投影：顶层 {ok, updatedCount, idempotentReplay, changed?/run?...} 原样平铺，
    // 页面只读这些受控字段（§12.5 写契约）。
    const runId = payload?.run?.runId ? String(payload.run.runId).slice(0, 64) : null
    await recordHotboardAudit(ctx, spec, action, idempotencyKey, 'succeeded', null, runId, payload)
    return send(res, 200, { status: 'ready', ...projectHotboardWrite(payload) })
  }
  // 读投影：{data, meta} 白名单透传；无信封时按原对象兜底（settings_get 等）。
  const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
  const meta = payload && typeof payload === 'object' && 'meta' in payload ? payload.meta : null
  return send(res, 200, { status: 'ready', data, meta })
}

// 写响应只保留受控字段（不透传服务端内部诊断字段）。
function projectHotboardWrite(payload) {
  const out = {}
  for (const key of ['ok', 'updatedCount', 'idempotentReplay', 'changed', 'conflictWithActive', 'created']) {
    if (payload && payload[key] !== undefined) out[key] = payload[key]
  }
  // 行级失败披露（批量裁决逐条 results，review MAJOR-3）：只放行
  // candidateId/ok/errorCode 三键，截断 50 条防大响应。
  if (payload && Array.isArray(payload.results) && payload.results.length) {
    out.results = payload.results.slice(0, 50).map(item => ({
      candidateId: cleanString(item?.candidateId, 64) || null,
      ok: item?.ok === true,
      errorCode: cleanString(item?.errorCode, 64) || null,
    }))
  }
  if (payload && payload.run && typeof payload.run === 'object') {
    out.run = { runId: String(payload.run.runId || '').slice(0, 64), status: cleanString(payload.run.status, 32) || null }
  }
  return out
}

async function recordHotboardAudit(ctx, spec, action, idempotencyKey, outcome, errorCode, runId, payload) {
  // 写操作审计（读操作不审计，对齐现有 collect/publish 模式）；target id 用服务端
  // 返回的业务 id（run），否则退化为幂等键（不透明标识，非敏感）。
  if (!spec.write) return
  const changes = []
  if (Array.isArray(payload?.changed)) {
    for (const item of payload.changed.slice(0, 20)) {
      if (item && typeof item.field === 'string') changes.push({ field: item.field.slice(0, 64), after: item.newValue })
    }
  }
  if (typeof payload?.updatedCount === 'number') changes.push({ field: 'updatedCount', after: payload.updatedCount })
  if (typeof payload?.idempotentReplay === 'boolean') changes.push({ field: 'idempotentReplay', after: payload.idempotentReplay })
  await recordAudit(ctx, {
    clientEventId: eventUuid(`xhs:hb:${action}:${idempotencyKey || 'n/a'}:${outcome}`),
    traceId: `xhs:hotboard:${runId || idempotencyKey || action}`,
    actionCode: `xhs.hotboard.${spec.op || action}`,
    category: spec.category || 'execute',
    source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: `xhs_hotboard_${spec.target}`, id: runId || idempotencyKey || action },
    outcome,
    changes: changes.length ? changes : [],
    effects: [],
    ...(errorCode ? { errorCode: errorCode.toLowerCase().slice(0, 80) } : {}),
  })
}

function safeHotboardToolError(error) {
  const message = error && typeof error.message === 'string' ? error.message : ''
  try {
    const payload = JSON.parse(message)
    const reason = hotboardErrorReason(payload)
    if (reason) return reason
  } catch {}
  return HOTBOARD_ERROR_CODES.has(message) ? message : 'XHS_HOTBOARD_INTERNAL_ERROR'
}

async function recordCancelledAudit(ctx, taskId, status) {
  // 取消是独立用户动作，记录独立的 cancelled 审计；不写入 auditedTerminalTasks，
  // 避免抢占后续 Driver 真正落 cancelled 时的 xhs.rewrite.completed 终态审计。
  await recordAudit(ctx, {
    clientEventId: eventUuid(`xhs:cancel:${taskId}`), traceId: `xhs:${taskId}`,
    actionCode: 'xhs.rewrite.cancelled', category: 'execute',
    source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'xhs_rewrite_task', id: taskId }, outcome: 'cancelled',
    changes: [{ field: 'status', after: status.slice(0, 160) }], effects: [],
  })
}

function eventUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

async function recordCreatedAudit(ctx, taskId, status, versionCount) {
  await recordAudit(ctx, {
    clientEventId: eventUuid(`xhs:create:${taskId}`), traceId: `xhs:${taskId}`,
    actionCode: 'xhs.rewrite.created', category: 'create',
    source: { pluginId: '@dofe/dsh-yootun-xhs-operation', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'xhs_rewrite_task', id: taskId }, outcome: 'accepted',
    changes: [{ field: 'status', after: status.slice(0, 160) }, { field: 'versionCount', after: versionCount }], effects: [],
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
  const out = []
  for (const item of list) {
    const step = cleanString(item?.step, 64)
    if (!step) continue
    const entry = { step, status: cleanString(item?.status, 24) }
    // 失败步骤行的受控错误码/原因短语（供客户端映射中文引导）；非失败行不出现
    const errorCode = cleanString(item?.errorCode, 64)
    const errorMessage = cleanString(item?.errorMessage, 512)
    if (errorCode) entry.errorCode = errorCode
    if (errorMessage) entry.errorMessage = errorMessage
    out.push(entry)
  }
  return out
}

// 版本投影：只保留服务端已校验的展示字段，正文 body 交给客户端 MarkdownText 渲染；
// issues（quality 软性问题码）随版本投影，供页面渲染风险提示条。
const SAFE_VERSION_FIELDS = ['version', 'title', 'body', 'tags', 'coverCopy', 'leadGuide']
function projectVersions(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const version = { version: firstString(item.version) || '?', title: firstString(item.title) || '', body: firstString(item.body) || '', tags: Array.isArray(item.tags) ? item.tags.map(value => String(value)).slice(0, 20) : [], coverCopy: firstString(item.coverCopy) || '', leadGuide: firstString(item.leadGuide) || '' }
    if (Array.isArray(item.issues)) {
      const issues = item.issues.map(value => String(value).slice(0, 64)).filter(Boolean).slice(0, 10)
      if (issues.length) version.issues = issues
    }
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
// 发布素材条目（阶段 3，review M1）：{path,url} 对象 = 本地原文件优先、URL 下载兜底；
// 纯字符串（url 或本地路径）保持兼容。仅 publish.start 使用，create 路由仍只收字符串 URL。
function cleanMaterialEntry(value) {
  if (typeof value === 'string') return cleanMediaUrl(value) || null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const path = typeof value.path === 'string' ? value.path.trim().slice(0, MAX_MEDIA_URL) : ''
  const url = typeof value.url === 'string' ? value.url.trim().slice(0, MAX_MEDIA_URL) : ''
  if (!path && !url) return null
  // SSRF 防护（审查 P2）：URL 仅接受 https 公网地址，host 层提前拒绝（不必等 publisher）。
  if (url && !isAllowedMaterialUrl(url)) return 'rejected'
  return { ...(path ? { path } : {}), ...(url ? { url } : {}) }
}
function cleanMaterialList(value) {
  if (!Array.isArray(value)) return null
  const entries = value.map(cleanMaterialEntry)
  if (entries.includes('rejected')) return 'rejected'
  const valid = entries.filter(Boolean).slice(0, MAX_IMAGE_COUNT)
  return valid.length ? valid : null
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
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}
