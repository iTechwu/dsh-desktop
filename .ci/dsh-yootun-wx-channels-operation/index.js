// 视频号工作台 host endpoint：页面只访问本地同源路由 /api/desktop/yootun/wx-channels-operation，
// 宿主负责设备端浏览器（系统 Chrome + Playwright 驱动）、本地会话与 tools MCP 调用。
//
// 凭证边界（开发实施文档 §4.1）：
// - Cookie / storage_state 只留设备端，绝不进入响应体、日志或 tools；
// - tools 只收到 `sessionRef`（vault:// 不透明引用）与设备探测得到的会话状态；
// - 页面不读取 MODELS_API_KEY，不直连公网 MCP，也不接收内部地址或原始传输错误。

import { browserStatus } from './src/chrome.js'
import {
  DEFAULT_MAX_PAGES,
  checkCollectionReadiness,
  createBatchCollectController,
  progressFromEvent,
  runCollection,
} from './src/runner.js'
import {
  isPendingAccountId,
  loginWithQrCode,
  promotePendingAccount,
  refreshSessionState,
  removeLocalAccount,
} from './src/session.js'
import { getAccount, hasStorageState, paths, readAccounts, stateRoot } from './src/state.js'
import {
  accountRemoveIdempotencyKey,
  accountSaveIdempotencyKey,
  callTool,
  safeErrorCode,
  sessionIdempotencyKey,
} from './src/tools-client.js'

export const PATH = '/api/desktop/yootun/wx-channels-operation'
export const inject = ['webServer', 'tools']

const MAX_BODY_BYTES = 64 * 1024
const MAX_ID = 128
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

// 登录是长动作（等人扫码）：状态保存在宿主进程内，页面轮询查询进度（§18.1 状态机）。
const loginRuns = new Map()

export function apply(ctx, overrides = {}) {
  const deps = {
    root: overrides.root || stateRoot(),
    browserStatus: overrides.browserStatus || browserStatus,
    login: overrides.login || loginWithQrCode,
    refreshSessionState: overrides.refreshSessionState || refreshSessionState,
    promotePendingAccount: overrides.promotePendingAccount || promotePendingAccount,
    removeLocalAccount: overrides.removeLocalAccount || removeLocalAccount,
    readAccounts: overrides.readAccounts || readAccounts,
    getAccount: overrides.getAccount || getAccount,
    hasStorageState: overrides.hasStorageState || hasStorageState,
    runCollection: overrides.runCollection || runCollection,
    collectBusy: false,
    // 单账号采集受理后的租约位（per-instance，审查 P2-7：模块级全局会在多实例
    // 下互踩）。
    collectLeaseHeld: false,
    // 一键采集全部在异步预留账号列表期间的互斥位（审查 P2-6 TOCTOU）。
    batchReserved: false,
    // 单账号采集状态投影（单槽——互斥保证同时只有一个采集）：collect.status 随
    // busy 一起返回，页面工具栏进度行（对齐抖音）与终态判断共用这一份数据。
    collectRecord: null,
    tools: overrides.tools || null,
  }
  // 批量控制器：collect 注入单账号采集（互斥位由 deps.collectBusy 守卫）。
  const batchController = overrides.batchController || createBatchCollectController({
    probe: async accountId => {
      const state = await deps.refreshSessionState({ accountId, root: deps.root })
      await reportSessionStatus(deps.tools || ctx, deps, accountId, state)
      return { sessionStatus: state.sessionStatus, reason: state.reason || null }
    },
    collect: async ({ accountId, onProgress }) => {
      if (deps.collectBusy) return { status: 'failed', reason: 'collect_busy', runId: null }
      deps.collectBusy = true
      try {
        return await deps.runCollection({
          ctx: deps.tools || ctx,
          accountId,
          root: deps.root,
          onProgress,
          logger: ctx.logger,
        })
      } finally {
        deps.collectBusy = false
      }
    },
    logger: ctx.logger,
  })
  deps.batchController = batchController

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
              return send(res, 200, await handleBeginLogin(ctx, deps, cleanId(body.accountId)))
            case 'account.loginStatus':
              return send(res, 200, handleLoginStatus(cleanId(body.accountId)))
            case 'account.refreshLoginQr':
              return send(res, 200, handleRefreshLoginQr(deps, cleanId(body.accountId)))
            case 'account.probe': {
              const probe = await deps.refreshSessionState({ accountId: cleanId(body.accountId), root: deps.root })
              const reported = await reportSessionStatus(toolCtx, deps, cleanId(body.accountId), probe)
              // 白名单投影：页面只需状态与判定时间，不回显 seq/vaultRef/本地记录（review P3-1）。
              return send(res, 200, {
                status: 'ok',
                sessionStatus: probe.sessionStatus,
                reason: probe.reason || null,
                checkedAt: probe.checkedAt,
                reported: reported.ok,
              })
            }
            // 宿主/调试预留接口：页面（client.js）当前不调用，但保留本地路由面以免
            // 宿主已有调用被静默打断（审查 P3-25⑥：已注册但 UI 不调用的 action）。
            case 'account.promote':
              return send(res, 200, await deps.promotePendingAccount({ accountId: cleanId(body.accountId), root: deps.root }))
            case 'account.removeLocal':
              return send(res, 200, await deps.removeLocalAccount({ accountId: cleanId(body.accountId), root: deps.root }))
            case 'account.removeRemote':
              return send(res, 200, await handleRemoveRemote(deps, toolCtx, cleanId(body.accountId)))
            case 'collect.start':
              return send(res, 200, await handleCollectStart(deps, toolCtx, cleanId(body.accountId), body.newAttempt === true))
            case 'collect.status':
              // collect 为白名单形状投影（accountId/status/startedAt/finishedAt/
              // error/progress/result），无任何凭证或原始错误信息（§9.5）。
              return send(res, 200, { status: 'ok', busy: deps.collectBusy, collect: deps.collectRecord })
            case 'collectAll.start':
              return send(res, 200, await handleCollectAllStart(deps, toolCtx))
            case 'collectAll.status':
              return send(res, 200, { status: 'ok', ...deps.batchController.status })
            // 宿主/调试预留接口（页面当前不调用，见 P3-25⑥）。
            case 'run.get':
              return send(res, 200, await handleRunGet(toolCtx, cleanId(body.runId)))
            case 'works.list':
              return send(res, 200, await callToolCompat(toolCtx, 'wx_channels_work_list', {
                accountId: cleanId(body.accountId),
                ...(body.sort ? { sort: String(body.sort).slice(0, 32) } : {}),
                ...(body.order ? { order: String(body.order).slice(0, 8) } : {}),
              }))
            case 'work.get':
              return send(res, 200, await callToolCompat(toolCtx, 'wx_channels_work_get', {
                accountId: cleanId(body.accountId),
                workId: cleanId(body.workId),
              }))
            // 宿主/调试预留接口（页面当前不调用，见 P3-25⑥）。
            case 'work.trend':
              return send(res, 200, await callToolCompat(toolCtx, 'wx_channels_work_trend', {
                accountId: cleanId(body.accountId),
                workId: cleanId(body.workId),
              }))
            case 'account.overview':
              return send(res, 200, await callToolCompat(toolCtx, 'wx_channels_account_overview', {
                accountId: cleanId(body.accountId),
                ...(body.window ? { window: String(body.window).slice(0, 16) } : {}),
              }))
            case 'fans.profile.get':
              return send(res, 200, await callToolCompat(toolCtx, 'wx_channels_fans_profile_get', {
                accountId: cleanId(body.accountId),
              }))
            default:
              return send(res, 400, { status: 'error', reason: 'unknown_action' })
          }
        } catch (error) {
          // 统一收敛：稳定码白名单外的原始错误不透传（§9.5）。
          return send(res, 200, { status: 'error', reason: safeErrorCode(error) })
        }
      },
    })
    return () => dispose()
  })
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

async function handleBrowserStatus(deps) {
  return { status: 'ok', ...(await deps.browserStatus()) }
}

async function handleAccountsList(deps, toolCtx) {
  const local = await deps.readAccounts(deps.root)
  const locals = Object.values(local.accounts)
  let remote = []
  let remoteOk = true
  try {
    const result = await callTool(toolCtx, 'wx_channels_account_list', {})
    remote = Array.isArray(result && result.accounts) ? result.accounts : []
  } catch {
    remoteOk = false // 远端失败不遮蔽本地账号列表（独立降级）。
  }
  const accounts = []
  for (const record of locals) {
    const row = remote.find(item => item.account_id === record.accountId) || null
    accounts.push({
      accountId: record.accountId,
      nickname: record.nickname || (row && row.nickname) || null,
      avatar: record.avatar || (row && row.avatar) || null,
      // 作品总数（官方 feedsCount）：§9.2 第一张摘要卡数据源（review P0-4）。
      feedCount: record.feedCount ?? (row && row.feed_count) ?? null,
      followerTotalCount: record.followerTotalCount ?? (row && row.follower_total_count) ?? null,
      sessionStatus: record.sessionStatus || 'unknown',
      sessionCheckedAt: record.sessionCheckedAt || null,
      lastCollectedAt: (row && row.last_collected_at) || null,
      deleteState: (row && row.delete_state) || 'none',
      isPending: isPendingAccountId(record.accountId),
      hasStorageState: await deps.hasStorageState(record.accountId, deps.root),
    })
  }
  return { status: 'ok', accounts, remoteOk }
}

/** 开始扫码登录：有头系统 Chrome；状态保存在宿主进程内，页面轮询 account.loginStatus。 */
// 只有「进行中」的登录才复用；ok/timeout/failed 都是终态，必须允许重新发起——
// 否则同一账号扫码超时或会话再次失效后，「重新扫码」会直接返回旧终态，浏览器
// 根本不再打开（2026-11-11 review P0：早退条件写成 state !== 'finished'，而全仓
// 没有任何代码把 state 置为 'finished'）。
const ACTIVE_LOGIN_STATES = new Set(['waiting_qr', 'waiting_confirm'])

function handleBeginLogin(ctx, deps, accountId) {
  const key = accountId || `pending-${Date.now()}`
  const existing = loginRuns.get(key)
  if (existing && ACTIVE_LOGIN_STATES.has(existing.state)) {
    return { status: 'ok', loginKey: key, state: existing.state }
  }
  // 终态记录不复用；「重新扫码」复用同一 key 时顺带释放旧记录。注意：「添加账号」
  // 走 pending-<ts> 每次都是新 key，其终态记录仍会留在 loginRuns 里（数量很小，
  // 无 TTL；若后续出现频繁添加场景再补容量上限）。
  if (existing) loginRuns.delete(key)
  // 终态记录 TTL 清理（审查 P3-25）：避免频繁「添加账号」把 Map 无限撑大。
  const nowMs = Date.now()
  for (const [runKey, entry] of loginRuns) {
    if (
      !ACTIVE_LOGIN_STATES.has(entry.state)
      && nowMs - Date.parse(entry.startedAt || 0) > 30 * 60 * 1000
    ) {
      loginRuns.delete(runKey)
    }
  }
  const attemptId = 0
  const run = {
    state: 'waiting_qr',
    accountId: null,
    profile: null,
    startedAt: new Date().toISOString(),
    updatedAt: null,
    reason: null,
    attemptId,
    page: null,
  }
  loginRuns.set(key, run)
  void deps.login({
    accountId: key,
    root: deps.root,
    timeoutMs: LOGIN_TIMEOUT_MS,
    onPage: async page => {
      if (run.attemptId !== attemptId) return
      run.page = page
      run.state = 'waiting_confirm'
      run.updatedAt = new Date().toISOString()
    },
  }).then(async result => {
    // 已被「刷新二维码」取代的旧流程不得回写状态（审查 P2-12）。
    if (run.attemptId !== attemptId) return
    run.updatedAt = new Date().toISOString()
    if (result.status === 'ok') {
      run.accountId = result.accountId
      run.profile = result.profile || null
      // 登录成功即上报账号资料（upsert；只带 vault:// 引用，不带任何凭证）。
      // 工具上下文与路由层同一兜底（deps.tools 仅测试注入，生产恒为 null）：这里曾
      // 写成 `deps.tools || null` + 静默 return，生产环境每次登录的 account_save 都被
      // 跳过——云端永无账号行，后续 run_start 必然 ACCOUNT_NOT_FOUND（表象：采集
      // N/N 完成后失败，服务端 account_list 为空、save 零调用）。
      // 顺序对齐抖音 reportAccountSave：先完成 save 再把状态翻 ok——页面在首个非
      // waiting 轮询即停，若先翻 ok，save 失败原因永远来不及出现在 loginStatus 里。
      try {
        const toolCtx = deps.tools || ctx
        const profile = result.profile || {}
        await callTool(toolCtx, 'wx_channels_account_save', {
          accountId: result.accountId,
          ...(profile.nickname ? { nickname: profile.nickname } : {}),
          ...(profile.avatar ? { avatar: profile.avatar } : {}),
          ...(Number.isFinite(profile.fansCount) ? { followerTotalCount: profile.fansCount } : {}),
          ...(Number.isFinite(profile.feedsCount) ? { feedCount: profile.feedsCount } : {}),
          ...(profile.isMasterFinder !== null && profile.isMasterFinder !== undefined
            ? { isMasterFinder: profile.isMasterFinder }
            : {}),
          sessionRef: paths(deps.root).vaultRef(result.accountId),
          idempotencyKey: accountSaveIdempotencyKey(result.accountId),
        })
        const seq = Number((await deps.getAccount(result.accountId, deps.root))?.sessionSeq || 0)
        if (seq > 0) {
          await callTool(toolCtx, 'wx_channels_session_status_report', {
            accountId: result.accountId,
            sessionStatus: 'ok',
            sessionSeq: seq,
            checkedAt: new Date().toISOString(),
            sessionRef: paths(deps.root).vaultRef(result.accountId),
            idempotencyKey: sessionIdempotencyKey(result.accountId, seq),
          })
        }
        run.reason = null
      } catch (error) {
        // save 失败不回滚本地登录（本地登录态已有效），但必须记录并透出：
        // 静默吞掉会让「本地已登录、远端无账号」的漂移既无法察觉也无法诊断
        // （采集前 ensureRemoteAccount 仍会补一次 upsert 自愈）。
        run.reason = safeErrorCode(error)
      }
      run.state = 'ok'
    } else if (result.status === 'timeout') {
      run.state = 'timeout'
      run.reason = 'login_timeout'
    } else {
      run.state = 'failed'
      run.reason = result.reason || 'login_failed'
    }
  }).catch(error => {
    if (run.attemptId !== attemptId) return
    run.state = 'failed'
    run.reason = safeErrorCode(error)
  })
  return { status: 'ok', loginKey: key, state: run.state }
}

function handleLoginStatus(accountId) {
  const run = loginRuns.get(accountId)
  if (!run) return { status: 'ok', state: 'idle' }
  return {
    status: 'ok',
    state: run.state,
    accountId: run.accountId,
    profile: run.profile
      ? { nickname: run.profile.nickname, avatar: run.profile.avatar, feedsCount: run.profile.feedsCount }
      : null,
    reason: run.reason,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  }
}

/** 二维码刷新（§18.2）：重启真实登录流程，并**关闭旧上下文**、作废旧流程回写。
 *
 * 旧实现只改状态就再起一个登录，旧扫码页滞留且旧 promise 仍会回写 run.state
 * （审查 P2-12）。现在用 attemptId 区分代次：旧流程的 onPage/then/catch 全部
 * 因代次不匹配而直接返回。
 */
function handleRefreshLoginQr(deps, accountId) {
  const run = loginRuns.get(accountId)
  if (!run || run.state === 'ok') {
    return { status: 'error', reason: 'refresh_not_allowed', state: run ? run.state : 'idle' }
  }
  const attemptId = (run.attemptId || 0) + 1
  run.attemptId = attemptId
  run.state = 'waiting_qr'
  run.reason = null
  run.updatedAt = new Date().toISOString()
  // 关闭旧扫码上下文（§18.2）：旧 promise 随之失败，但代次守卫会忽略其回写。
  const oldPage = run.page
  run.page = null
  if (oldPage) {
    void Promise.resolve()
      .then(() => oldPage.context())
      .then(context => context && context.close && context.close())
      .catch(() => {})
  }
  void deps.login({
    accountId,
    root: deps.root,
    timeoutMs: LOGIN_TIMEOUT_MS,
    onPage: async page => {
      if (run.attemptId !== attemptId) return
      run.page = page
      run.state = 'waiting_confirm'
      run.updatedAt = new Date().toISOString()
    },
  }).then(result => {
    if (run.attemptId !== attemptId) return
    run.updatedAt = new Date().toISOString()
    if (result.status === 'ok') {
      run.state = 'ok'
      run.accountId = result.accountId
      run.profile = result.profile || null
    } else if (result.status === 'timeout') {
      run.state = 'timeout'
      run.reason = 'login_timeout'
    } else {
      run.state = 'failed'
      run.reason = result.reason || 'login_failed'
    }
  }).catch(error => {
    if (run.attemptId !== attemptId) return
    run.state = 'failed'
    run.reason = safeErrorCode(error)
  })
  return { status: 'ok', loginKey: accountId, state: run.state }
}

/** 删除流程第 2 步（§16.2）：本地清理成功后才允许远端删除；宿主先验证本地凭证
 *  确已清理（storage_state 仍存在 → 拒绝，防止页面跳步把远端数据清掉而本地残留）。 */
async function handleRemoveRemote(deps, toolCtx, accountId) {
  if (await deps.hasStorageState(accountId, deps.root)) {
    return { status: 'error', reason: 'LOCAL_CLEARED_REQUIRED' }
  }
  const result = await callTool(toolCtx, 'wx_channels_account_remove', {
    accountId,
    confirm: true,
    localCleared: true,
    idempotencyKey: accountRemoveIdempotencyKey(accountId),
  })
  return { status: 'ok', ...result }
}

async function handleCollectStart(deps, toolCtx, accountId, newAttempt) {
  // 互斥（§8.5 生命周期 3）：与一键采集全部互斥；检查与置位在同一段同步代码内
  // 完成前的并发请求由 collectBusy 同步守卫拒绝（TOCTOU 缺口修复，review P1-2）。
  if (deps.collectBusy || deps.batchController.running || deps.batchReserved) {
    return { status: 'ok', started: false, reason: 'collect_busy' }
  }
  deps.collectBusy = true
  try {
    return await startCollectLocked(deps, toolCtx, accountId, newAttempt)
  } finally {
    if (!deps.collectLeaseHeld) deps.collectBusy = false
  }
}

async function startCollectLocked(deps, toolCtx, accountId, newAttempt) {
  const readiness = await checkCollectionReadiness({ accountId, root: deps.root, busy: false })
  if (!readiness.ready) {
    return { status: 'ok', started: false, reason: readiness.reason }
  }
  // 会话先实测并上报（失败/过期不启动采集）。
  const session = await deps.refreshSessionState({ accountId, root: deps.root })
  await reportSessionStatus(toolCtx, deps, accountId, session)
  if (session.sessionStatus !== 'ok') {
    return { status: 'ok', started: false, reason: session.sessionStatus === 'expired' ? 'session_required' : 'probe_failed' }
  }
  // 异步执行：页面轮询 collect.status 读进度投影（对齐抖音 collect 投影，§8.5）；
  // 互斥位由 finally 释放。
  deps.collectLeaseHeld = true
  const record = {
    accountId,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    progress: { phase: 'probing' },
    result: null,
  }
  deps.collectRecord = record
  void deps.runCollection({
    ctx: toolCtx,
    accountId,
    root: deps.root,
    newAttempt: newAttempt !== false,
    onProgress: event => {
      // 作品级进度（details_progress / batch_done 等关键事件）；非关键事件保持上一进度。
      const progress = progressFromEvent(event)
      if (progress) record.progress = progress
    },
    logger: null,
  }).then(result => {
    record.status = result.status === 'completed' || result.status === 'partial' ? result.status : 'failed'
    record.error = record.status === 'failed' ? (result.reason || 'collect_failed') : null
    record.result = { runId: result.runId || null, works: result.works || 0 }
    record.finishedAt = new Date().toISOString()
  }).catch(error => {
    record.status = 'failed'
    record.error = safeErrorCode(error)
    record.finishedAt = new Date().toISOString()
  }).finally(() => {
    deps.collectBusy = false
    deps.collectLeaseHeld = false
  })
  return { status: 'ok', started: true }
}

async function handleCollectAllStart(deps, toolCtx) {
  // 与单账号采集互斥（review P1-2 反向缺口）。
  if (deps.batchController.running || deps.collectBusy || deps.batchReserved) {
    return { status: 'ok', started: false, reason: 'collect_busy' }
  }
  // 先同步预留互斥位，再读账号列表：否则 await 期间单账号采集可置 collectBusy，
  // 批量虽被受理但每个账号都以 collect_busy 失败（审查 P2-6 TOCTOU）。
  deps.batchReserved = true
  let started = null
  try {
    const local = await deps.readAccounts(deps.root)
    const accountIds = Object.values(local.accounts)
      .filter(record => !isPendingAccountId(record.accountId))
      .map(record => record.accountId)
    started = await deps.batchController.start({ accountIds })
  } finally {
    // 批量进入 running 后由 batchController.running 守卫；预留位随即释放。
    deps.batchReserved = false
  }
  if (!started.started) return { status: 'ok', started: false, reason: started.reason }
  // 立即回批量投影（对齐抖音 started.batch）：页面 setBatch 后左栏批量面板即时
  // 显示「正在检查会话…」，不必等下一轮 collectAll.status 轮询。
  return {
    status: 'ok',
    started: true,
    batchId: started.batchId,
    accounts: started.accounts,
    batch: deps.batchController.status,
  }
}

async function handleRunGet(toolCtx, runId) {
  const result = await callTool(toolCtx, 'wx_channels_collect_run_get', { runId })
  return { status: 'ok', ...result }
}

/** 远端查询兼容包装：ToolsCallError → { status:'error', reason: 稳定码 }。 */
async function callToolCompat(toolCtx, name, args) {
  try {
    const result = await callTool(toolCtx, name, args)
    return { status: 'ok', ...result }
  } catch (error) {
    return { status: 'error', reason: safeErrorCode(error) }
  }
}

// ---------------------------------------------------------------------------
// 会话上报 + 传输工具
// ---------------------------------------------------------------------------

async function reportSessionStatus(toolCtx, deps, accountId, state) {
  try {
    await callTool(toolCtx, 'wx_channels_session_status_report', {
      accountId,
      sessionStatus: state.sessionStatus,
      sessionSeq: state.sessionSeq,
      checkedAt: state.checkedAt,
      sessionRef: state.vaultRef,
      idempotencyKey: sessionIdempotencyKey(accountId, state.sessionSeq),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: safeErrorCode(error) }
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('payload_too_large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return {}
  }
}

function cleanString(value, max) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return text.slice(0, max)
}

function cleanId(value) {
  return cleanString(value, MAX_ID)
}

function send(res, code, payload) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}
