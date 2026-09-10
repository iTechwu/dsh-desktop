// 抖音运营 host endpoint：页面只访问本地同源路由 /api/desktop/yootun/douyin-operation，
// 宿主负责设备端浏览器（系统 Chrome + Playwright 驱动）、本地会话与 tools MCP 调用。
//
// 凭证边界（docs/0909/douyin §6/§13）：
// - Cookie / storage_state 只留设备端，绝不进入响应体、日志或 tools；
// - tools 只收到 `sessionRef`（vault:// 不透明引用）与设备探测得到的会话状态；
// - 页面不读取 MODELS_API_KEY，不直连公网 MCP，也不接收内部地址或原始传输错误。

import { browserStatus } from './src/chrome.js'
import {
  DEFAULT_MAX_PAGES,
  checkCollectionReadiness,
  createCollectController,
} from './src/runner.js'
import { refreshSessionState, removeLocalAccount } from './src/session.js'
import { getAccount, paths, readAccounts, stateRoot } from './src/state.js'
import {
  accountRemoveIdempotencyKey,
  accountSaveIdempotencyKey,
  callTool,
  safeErrorCode,
  sessionIdempotencyKey,
} from './src/tools-client.js'

export const PATH = '/api/desktop/yootun/douyin-operation'
export const inject = ['webServer', 'tools']

const MAX_BODY_BYTES = 64 * 1024
const MAX_ID = 128

// 登录是长动作（等人扫码）：状态保存在宿主进程内，页面轮询查询进度。
const loginRuns = new Map()

export function apply(ctx, overrides = {}) {
  const deps = {
    root: overrides.root || stateRoot(),
    browserStatus: overrides.browserStatus || browserStatus,
    login: overrides.login || null, // 由 src/session.js 的 loginWithQrCode 注入（默认惰性加载）
    refreshSessionState: overrides.refreshSessionState || refreshSessionState,
    removeLocalAccount: overrides.removeLocalAccount || removeLocalAccount,
    readAccounts: overrides.readAccounts || readAccounts,
    getAccount: overrides.getAccount || getAccount,
    tools: overrides.tools || null,
    collectController: overrides.collectController || createCollectController({ logger: ctx.logger }),
    runCollection: overrides.runCollection || null,
    maxPages: overrides.maxPages || DEFAULT_MAX_PAGES,
  }
  return ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: PATH,
      async handler(req, res) {
        if (req.method !== 'POST') return send(res, 405, { status: 'error', reason: 'method_not_allowed' })
        try {
          const body = await readBody(req)
          const action = cleanString(body.action, 64)
          const toolCtx = deps.tools || ctx
          switch (action) {
            case 'browser.status':
              return send(res, 200, await handleBrowserStatus(deps))
            case 'accounts.list':
              return send(res, 200, await handleAccountsList(deps, toolCtx))
            case 'account.beginLogin':
              return send(res, 200, await handleBeginLogin(ctx, deps, body))
            case 'account.loginStatus':
              return send(res, 200, handleLoginStatus(deps, body))
            case 'account.probe':
              return send(res, 200, await handleProbe(deps, toolCtx, body))
            case 'account.removeLocal':
              return send(res, 200, await handleRemoveLocal(deps, toolCtx, body))
            case 'account.removeRemote':
              return send(res, 200, await handleRemoveRemote(deps, toolCtx, body))
            case 'collect.start':
              return send(res, 200, await handleCollectStart(ctx, deps, body))
            case 'collect.status':
              return send(res, 200, handleCollectStatus(deps, body))
            case 'works.list':
              return send(res, 200, await handleWorksList(deps, toolCtx, body))
            case 'work.get':
              return send(res, 200, await handleWorkGet(deps, toolCtx, body))
            case 'work.trend':
              return send(res, 200, await handleWorkTrend(deps, toolCtx, body))
            case 'run.get':
              return send(res, 200, await handleRunGet(deps, toolCtx, body))
            default:
              return send(res, 400, { status: 'error', reason: 'unknown_action' })
          }
        } catch (error) {
          const reason = safeErrorCode(error)
          ctx.logger?.warn?.('yootun douyin operation failed: %s', reason)
          return send(res, 200, { status: 'error', reason })
        }
      },
    })
    return () => {
      dispose?.()
      loginRuns.clear()
    }
  })
}

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

async function handleAccountsList(deps, ctx) {
  const local = await deps.readAccounts(deps.root)
  let remote = null
  let remoteError = null
  try {
    const payload = await callTool(ctx, 'douyin_account_list', {})
    remote = Array.isArray(payload.accounts) ? payload.accounts : []
  } catch (error) {
    remoteError = safeErrorCode(error)
  }
  return {
    status: 'ready',
    accounts: projectAccounts(local.accounts, remote),
    remoteError,
  }
}

// 本地账号（设备端 Profile/会话）与远端账号（tools 记录）按 accountId 合并；
// 会话状态以**本地**为准（tools 只保存设备上报值）。
function projectAccounts(localAccounts, remoteAccounts) {
  const merged = new Map()
  for (const item of Object.values(localAccounts || {})) {
    merged.set(item.accountId, {
      accountId: item.accountId,
      nickname: item.nickname || null,
      fanCount: Number.isFinite(Number(item.fanCount)) ? Number(item.fanCount) : null,
      sessionStatus: item.sessionStatus || 'unknown',
      sessionCheckedAt: item.sessionCheckedAt || null,
      lastCollectedAt: null,
      deleteState: 'none',
      local: true,
    })
  }
  for (const item of remoteAccounts || []) {
    const accountId = cleanString(item?.accountId, MAX_ID)
    if (!accountId) continue
    const existing = merged.get(accountId)
    merged.set(accountId, {
      accountId,
      nickname: existing?.nickname || cleanString(item.nickname, 256) || null,
      fanCount: existing?.fanCount ?? (Number.isFinite(Number(item.fanCount)) ? Number(item.fanCount) : null),
      sessionStatus: existing?.sessionStatus || cleanString(item.sessionStatus, 16) || 'unknown',
      sessionCheckedAt: existing?.sessionCheckedAt || item.sessionCheckedAt || null,
      lastCollectedAt: item.lastCollectedAt || null,
      deleteState: cleanString(item.deleteState, 24) || 'none',
      local: Boolean(existing),
    })
  }
  return [...merged.values()].sort((a, b) => String(a.accountId).localeCompare(String(b.accountId)))
}

async function handleBeginLogin(ctx, deps, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  if (accountId && loginRuns.get(accountId)?.status === 'waiting') {
    return { status: 'ready', login: projectLogin(loginRuns.get(accountId)) }
  }
  if (!deps.login) {
    const { loginWithQrCode } = await import('./src/session.js')
    deps.login = loginWithQrCode
  }
  const runKey = accountId || `pending-${Date.now()}`
  const run = { key: runKey, status: 'waiting', accountId: accountId || null, error: null, startedAt: new Date().toISOString() }
  loginRuns.set(runKey, run)
  // 登录是有头长动作：立即返回 waiting，后台完成后写回 run 状态（页面轮询 loginStatus）。
  deps.login({ accountId: accountId || undefined, root: deps.root })
    .then(async result => {
      if (result.status === 'ok') {
        run.status = 'ok'
        run.accountId = result.accountId
        await reportAccountSave(ctx, deps, result)
        await reportSessionStatus(ctx, deps, result.accountId, { status: 'ok' })
      } else {
        run.status = result.status === 'timeout' ? 'timeout' : 'failed'
        run.error = result.reason || result.status
      }
    })
    .catch(error => {
      run.status = 'failed'
      run.error = safeErrorCode(error)
    })
  return { status: 'ready', login: projectLogin(run) }
}

function handleLoginStatus(deps, body) {
  const key = cleanString(body.accountId, MAX_ID) || cleanString(body.loginKey, MAX_ID)
  const run = key ? loginRuns.get(key) : null
  if (!run) {
    // 直接查（页面刷新后）：本地有账号即视为已登录（会话是否有效由 probe 决定）。
    return { status: 'ready', login: { status: 'idle', accountId: key || null } }
  }
  if (run.status !== 'waiting') loginRuns.delete(run.key)
  return { status: 'ready', login: projectLogin(run) }
}

function projectLogin(run) {
  return {
    loginKey: run.key,
    status: run.status,
    accountId: run.accountId,
    error: run.error || null,
  }
}

async function handleProbe(deps, ctx, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  const state = await deps.refreshSessionState({ accountId, root: deps.root })
  const reported = await reportSessionStatus(ctx, deps, accountId, state)
  return {
    status: 'ready',
    accountId,
    sessionStatus: state.sessionStatus,
    sessionCheckedAt: state.checkedAt,
    sessionSeq: state.sessionSeq,
    reported: reported.ok,
    reportError: reported.error,
  }
}

async function handleRemoveLocal(deps, ctx, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  // 删除状态机第 2 步：设备先清本地 Profile/storage_state，成功后才允许请求远端删除。
  const result = await deps.removeLocalAccount({ accountId, root: deps.root })
  return { status: 'ready', accountId, localCleared: true, cleared: result.cleared }
}

async function handleRemoveRemote(deps, ctx, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  const payload = await callTool(ctx, 'douyin_account_remove', {
    accountId,
    confirm: true,
    idempotencyKey: accountRemoveIdempotencyKey(accountId),
  })
  return { status: 'ready', accountId, deleteState: payload.deleteState || 'remote_deleted' }
}

async function handleCollectStart(ctx, deps, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  // 采集前必须确认本地会话就绪；有效性由设备端探测（会话失效请用户重新扫码）。
  const readiness = await checkCollectionReadiness({ accountId, root: deps.root })
  if (!readiness.ready) return { status: 'error', reason: readiness.reason }

  const maxPages = clampInt(body.maxPages, 1, DEFAULT_MAX_PAGES, deps.maxPages)
  const result = await deps.collectController.start({
    accountId,
    options: {
      callTool: (name, args) => callTool(ctx, name, args, { callIdPrefix: 'yootun-douyin-collect' }),
      root: deps.root,
      storageStatePath: paths(deps.root).storageStatePath(accountId),
      maxPages,
      newAttempt: true,
      ...(deps.runCollection ? { runCollection: deps.runCollection } : {}),
    },
  })
  return result
}

function handleCollectStatus(deps, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  return deps.collectController.status(accountId)
}

async function handleWorksList(deps, ctx, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  if (!accountId) return { status: 'error', reason: 'account_id_required' }
  const payload = await callTool(ctx, 'douyin_work_list', {
    accountId,
    includeNotInList: body.includeNotInList === true,
  })
  return { status: 'ready', accountId, works: Array.isArray(payload.works) ? payload.works : [], total: payload.total || 0 }
}

async function handleWorkGet(deps, ctx, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  const workId = cleanString(body.workId, MAX_ID)
  if (!accountId || !workId) return { status: 'error', reason: 'work_id_required' }
  const payload = await callTool(ctx, 'douyin_work_get', { accountId, workId })
  return { status: 'ready', ...payload }
}

async function handleWorkTrend(deps, ctx, body) {
  const accountId = cleanString(body.accountId, MAX_ID)
  const workId = cleanString(body.workId, MAX_ID)
  if (!accountId || !workId) return { status: 'error', reason: 'work_id_required' }
  const payload = await callTool(ctx, 'douyin_work_trend', { accountId, workId })
  return { status: 'ready', ...payload }
}

async function handleRunGet(deps, ctx, body) {
  const runId = cleanString(body.runId, MAX_ID)
  if (!runId) return { status: 'error', reason: 'run_id_required' }
  const payload = await callTool(ctx, 'douyin_collect_run_get', { runId })
  return { status: 'ready', ...payload }
}

function clampInt(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const int = Math.trunc(num)
  if (int < min || int > max) return fallback
  return int
}

async function reportAccountSave(ctx, deps, result) {
  const accountId = result.accountId
  const profile = result.profile || {}
  try {
    await callTool(ctx, 'douyin_account_save', {
      accountId,
      nickname: profile.nickname || undefined,
      avatar: profile.avatar || undefined,
      fanCount: Number.isFinite(Number(profile.fanCount)) ? Number(profile.fanCount) : undefined,
      // 只上报不透明引用，不上报任何 Cookie 内容。
      sessionRef: `vault://douyin/${accountId}`,
      idempotencyKey: accountSaveIdempotencyKey(accountId),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: safeErrorCode(error) }
  }
}

async function reportSessionStatus(ctx, deps, accountId, state) {
  const local = state.sessionSeq
    ? state
    : await deps.refreshSessionState({ accountId, root: deps.root })
  try {
    await callTool(ctx, 'douyin_session_status_report', {
      accountId,
      sessionStatus: local.sessionStatus,
      sessionSeq: local.sessionSeq,
      checkedAt: local.checkedAt,
      sessionRef: `vault://douyin/${accountId}`,
      idempotencyKey: sessionIdempotencyKey(accountId, local.sessionSeq),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: safeErrorCode(error) }
  }
}

function cleanString(value, max) {
  if (value === null || value === undefined) return ''
  return String(value).trim().slice(0, max)
}

async function readBody(req) {
  if (typeof req.body === 'object' && req.body) return req.body
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY_BYTES) throw new Error('body_too_large')
  }
  return raw ? JSON.parse(raw) : {}
}

function send(res, status, body) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

export { projectAccounts, projectLogin }
