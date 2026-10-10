// 车衣爆款看板 UI 模块（RQ-2026-003 DEV-06，实施文档 §13.3）。
//
// 职责边界：本模块只做展示与编排——筛选草稿、二级页状态、轮询与写操作确认，
// 口径全部直接渲染接口字段（数据缺失显示 —，不显示真实互动率，无 V7/蒲公英入口）。
// 构建脚本把本模块内联进 lib/client.js（同 ui-format/overview-ui 模式），顶部
// CommonJS require 由构建剥离（内联后同一工厂作用域，React/h 用 client.js 顶部
// 声明）；hooks 全部走 React.xxx 形式，避免与 client.js 顶部解构的 const 重复声明。
//
// 状态机 createHotboardHub 是纯逻辑（无 React 依赖），可被 test/hotboard-ui.test.mjs
// 直接驱动；UI 状态要求（§13.3）落实：二级页切换保留筛选草稿（草稿在 hub）、顶级
// Tab 切换保留二级页状态（sub 在 hub）、Overlay 关闭停止轮询（stop 只停定时器不清
// 数据）、active run 轮询 run_get、写操作进行中禁用重复提交（pending 计数）、操作
// 完成后刷新待办数（refreshTodos）。
const HotReact = require('react')
const { createElement: h } = HotReact

// run 活跃状态（tools hotboard_constants.ACTIVE_RUN_STATUSES 同口径）；终态
// succeeded/failed/cancelled 停止轮询。
const ACTIVE_RUN_STATUSES = new Set(['queued', 'collecting', 'deduplicating', 'scoring', 'tagging'])
const RUN_POLL_INTERVAL_MS = 2000
const HB_REQUEST_TIMEOUT_MS = 30000

// 写操作幂等键：与 client.js newIdempotencyKey 同逻辑（本模块独立可测，不引用 client.js）。
function hbIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `xhs-hb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// --- 展示格式化（缺失一律 —，绝不格式化成 0） ---

function hbText(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function hbCount(value) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString('en-US')
}

function hbPct(value) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${(num * 100).toFixed(1)}%`
}

function hbTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function hbScore(value) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toFixed(1)
}

// 带参文案（对齐 client.js 的 t(key).replace('{n}', v) 模式，集中成 helper）。
function tf(t, key, params) {
  let text = t(key)
  for (const [name, value] of Object.entries(params || {})) text = text.replace(`{${name}}`, String(value))
  return text
}

// 错误码只映射为受控中文文案（对齐 client.js 的 ACCOUNT_ERROR_KEYS 模式）；
// 白名单外一律落通用失败文案，不透出原始错误码（review MAJOR-4）。
const HB_ERROR_KEYS = {
  XHS_HOTBOARD_INVALID_ARGUMENT: 'hbErrInvalidArgument',
  XHS_HOTBOARD_NOT_FOUND: 'hbErrNotFound',
  XHS_HOTBOARD_ACTIVE_RUN_EXISTS: 'hbErrActiveRunExists',
  XHS_HOTBOARD_BUDGET_EXHAUSTED: 'hbErrBudgetExhausted',
  XHS_HOTBOARD_KEYWORD_EMPTY: 'hbErrKeywordEmpty',
  XHS_HOTBOARD_KEYWORD_CONFLICT: 'hbErrKeywordConflict',
  XHS_HOTBOARD_EVIDENCE_INSUFFICIENT: 'hbErrEvidenceInsufficient',
  XHS_HOTBOARD_LABEL_CONFLICT: 'hbErrLabelConflict',
  XHS_HOTBOARD_AI_SCHEMA_INVALID: 'hbErrAiSchemaInvalid',
  XHS_HOTBOARD_PROVIDER_FAILED: 'hbErrProviderFailed',
  XHS_HOTBOARD_INTERNAL_ERROR: 'hbErrInternal',
  CONFIRMATION_REQUIRED: 'hbErrConfirmation',
  VALIDATION_ERROR: 'hbErrValidation',
}
const hbErrorKey = reason => HB_ERROR_KEYS[reason] || 'hbWriteFailed'

// ---------------------------------------------------------------------------
// 状态机（纯逻辑）
// ---------------------------------------------------------------------------

// 筛选草稿（二级页切换与顶级 Tab 切换都保留）。
// 默认窗口 90d（OPEN-11 B1，2026-10-10 用户裁决）：当前搜索召回偏热门存量笔记，
// 30d 窗口常为空（OPEN-11 ①）；90d 已验证有数据，用户仍可手动切 7d/30d。
function defaultFilters() {
  return {
    board: { window: '90d', keyword: '', style: '', color: '', noteWord: '', commentWord: '', scoreMin: '', scoreMax: '', sort: 'score', onlyMain: true, onlyTagged: false },
    keywords: { category: '', status: '', source: '', keyword: '' },
    candidates: { status: 'pending', category: '', dateFrom: '', dateTo: '' },
    labels: { tagType: '', status: '', source: '', keyword: '', proposalStatus: 'pending' },
  }
}

function defaultPage() {
  return { board: 1, keywords: 1, candidates: 1, labels: 1 }
}

function createHotboardHub({ post, intervalMs = RUN_POLL_INTERVAL_MS, schedule = setTimeout, clearSchedule = clearTimeout }) {
  let snapshot = {
    sub: 'board',
    loading: false,
    error: '',
    filters: defaultFilters(),
    pages: defaultPage(),
    overview: null,
    keywords: null,
    candidates: null,
    labels: null,
    settings: null,
    settingsDirty: {},
    runLive: null,
    runDrawer: null,
    noteDrawer: null,
    pending: 0,
    notice: null,
    confirm: null,
    todos: { candidates: null, proposals: null },
  }
  const listeners = new Set()
  let timer = null
  let runId = null
  let generation = 0
  let stopped = true

  const update = patch => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach(listener => listener())
  }
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
  const get = () => snapshot

  const call = async body => post({ ...body }, HB_REQUEST_TIMEOUT_MS)

  // --- 读取 ---

  async function loadBoard() {
    update({ loading: true, error: '' })
    try {
      const f = snapshot.filters.board
      const args = { action: 'hotboard.overview', window: f.window, page: snapshot.pages.board, pageSize: 20, sort: f.sort, onlyMain: f.onlyMain, onlyTagged: f.onlyTagged }
      for (const key of ['keyword', 'style', 'color', 'noteWord', 'commentWord']) if (f[key]) args[key] = f[key]
      if (f.scoreMin !== '' && f.scoreMin !== null && f.scoreMin !== undefined) args.scoreMin = Number(f.scoreMin)
      if (f.scoreMax !== '' && f.scoreMax !== null && f.scoreMax !== undefined) args.scoreMax = Number(f.scoreMax)
      const res = await call(args)
      if (res.status === 'error') { update({ overview: null, error: res.reason || 'loadFailed', loading: false }); return }
      update({ overview: { data: res.data, meta: res.meta }, loading: false })
      syncRunPoll(res.data?.runStatus || null)
    } catch {
      update({ error: 'loadFailed', loading: false })
    }
  }

  async function loadKeywords() {
    update({ loading: true, error: '' })
    try {
      const f = snapshot.filters.keywords
      const args = { action: 'hotboard.keywords', page: snapshot.pages.keywords, pageSize: 20 }
      for (const key of ['category', 'status', 'source', 'keyword']) if (f[key]) args[key] = f[key]
      const res = await call(args)
      if (res.status === 'error') { update({ keywords: null, error: res.reason || 'loadFailed', loading: false }); return }
      update({ keywords: { data: res.data, meta: res.meta }, loading: false })
    } catch {
      update({ error: 'loadFailed', loading: false })
    }
  }

  async function loadCandidates() {
    update({ loading: true, error: '' })
    try {
      const f = snapshot.filters.candidates
      const args = { action: 'hotboard.candidates', page: snapshot.pages.candidates, pageSize: 20 }
      for (const key of ['status', 'category']) if (f[key]) args[key] = f[key]
      // dateRange 仅在起止都填写时透传（review MINOR-3）；tools 侧过滤 generatedAt。
      if (f.dateFrom && f.dateTo) args.dateRange = [f.dateFrom, f.dateTo]
      const res = await call(args)
      if (res.status === 'error') { update({ candidates: null, error: res.reason || 'loadFailed', loading: false }); return }
      update({ candidates: { data: res.data, meta: res.meta }, loading: false })
    } catch {
      update({ error: 'loadFailed', loading: false })
    }
  }

  async function loadLabels() {
    update({ loading: true, error: '' })
    try {
      const f = snapshot.filters.labels
      const args = { action: 'hotboard.labels', page: snapshot.pages.labels, pageSize: 20 }
      for (const key of ['tagType', 'status', 'source', 'keyword', 'proposalStatus']) if (f[key]) args[key] = f[key]
      const res = await call(args)
      if (res.status === 'error') { update({ labels: null, error: res.reason || 'loadFailed', loading: false }); return }
      update({ labels: { data: res.data, meta: res.meta }, loading: false })
    } catch {
      update({ error: 'loadFailed', loading: false })
    }
  }

  async function loadSettings() {
    try {
      const res = await call({ action: 'hotboard.settings' })
      if (res.status === 'error') return
      update({ settings: res.data, settingsDirty: {} })
    } catch { /* 配置读取失败不阻塞页面；保存时可见报错 */ }
  }

  // 待办数（页签徽标）：pending 候选与 pending 提案的 total（pageSize=1 只取 meta）。
  async function refreshTodos() {
    try {
      const [cand, prop] = await Promise.all([
        call({ action: 'hotboard.candidates', status: 'pending', page: 1, pageSize: 1 }),
        call({ action: 'hotboard.labels', proposalStatus: 'pending', page: 1, pageSize: 1 }),
      ])
      update({ todos: { candidates: cand?.meta?.total ?? null, proposals: prop?.meta?.total ?? null } })
    } catch { /* 徽标失败不打扰主数据 */ }
  }

  // --- run 轮询（active run 时轮询 run_get；Overlay 关闭 stop 停止） ---

  function clearTimer() {
    if (timer) { clearSchedule(timer); timer = null }
  }

  function syncRunPoll(runStatus) {
    const nextId = runStatus && ACTIVE_RUN_STATUSES.has(runStatus.status) ? runStatus.runId : null
    if (!nextId) { runId = null; clearTimer(); return }
    if (runId === nextId && timer) return
    runId = nextId
    clearTimer()
    if (stopped) return
    timer = schedule(pollRun)
  }

  async function pollRun() {
    timer = null
    if (!runId || stopped) return
    const gen = generation
    try {
      const res = await call({ action: 'hotboard.runGet', runId })
      if (gen !== generation || stopped) return
      if (res.status === 'ready') {
        update({ runLive: res.data })
        const status = res.data?.run?.status
        if (status && !ACTIVE_RUN_STATUSES.has(status)) {
          // run 落终态：停轮询并刷新看板 KPI 与待办。
          runId = null
          refresh()
          return
        }
      }
    } catch { /* 单次轮询失败继续下一轮 */ }
    if (runId && !stopped && !timer) timer = schedule(pollRun)
  }

  // --- 生命周期 ---

  function init() {
    stopped = false
    refresh()
    loadSettings()
  }

  function stop() {
    stopped = true
    generation++
    clearTimer()
    timer = null
  }

  async function refresh() {
    refreshTodos()
    const sub = snapshot.sub
    if (sub === 'board') await loadBoard()
    else if (sub === 'keywords') { await Promise.all([loadKeywords(), loadCandidates()]) }
    else if (sub === 'tags') await loadLabels()
    else if (sub === 'rules') await loadSettings()
  }

  function setSub(sub) {
    if (snapshot.sub === sub) return
    update({ sub, notice: null })
    if (stopped) return
    if (sub === 'board') loadBoard()
    else if (sub === 'keywords') { loadKeywords(); loadCandidates() }
    else if (sub === 'tags') loadLabels()
    else if (sub === 'rules') loadSettings()
  }

  // 筛选草稿更新：保留草稿（不重置为默认），重置该组页码并重拉。
  function setFilter(group, key, value) {
    const filters = { ...snapshot.filters, [group]: { ...snapshot.filters[group], [key]: value } }
    const pages = { ...snapshot.pages, [group]: 1 }
    update({ filters, pages })
    if (stopped) return
    if (group === 'board') loadBoard()
    else if (group === 'keywords') loadKeywords()
    else if (group === 'candidates') loadCandidates()
    else if (group === 'labels') loadLabels()
  }

  function setPage(group, page) {
    const pages = { ...snapshot.pages, [group]: page }
    update({ pages })
    if (stopped) return
    if (group === 'board') loadBoard()
    else if (group === 'keywords') loadKeywords()
    else if (group === 'candidates') loadCandidates()
    else if (group === 'labels') loadLabels()
  }

  // --- 抽屉 ---

  async function openNote(noteId) {
    update({ noteDrawer: { noteId, data: null, loading: true, error: '' } })
    try {
      const res = await call({ action: 'hotboard.noteDetail', noteId })
      const drawer = snapshot.noteDrawer
      if (!drawer || drawer.noteId !== noteId) return
      if (res.status === 'error') update({ noteDrawer: { ...drawer, loading: false, error: res.reason || 'loadFailed' } })
      else update({ noteDrawer: { noteId, data: res.data, loading: false, error: '' } })
    } catch {
      const drawer = snapshot.noteDrawer
      if (drawer && drawer.noteId === noteId) update({ noteDrawer: { ...drawer, loading: false, error: 'loadFailed' } })
    }
  }

  function closeNote() { update({ noteDrawer: null }) }

  async function openRun(targetRunId) {
    const id = targetRunId || snapshot.runLive?.run?.runId || snapshot.overview?.data?.runStatus?.runId || null
    if (!id) { update({ notice: { kind: 'error', key: 'hbNoRunYet' } }); return }
    update({ runDrawer: { runId: id, data: null, loading: true, error: '' } })
    try {
      const res = await call({ action: 'hotboard.runGet', runId: id })
      const drawer = snapshot.runDrawer
      if (!drawer || drawer.runId !== id) return
      if (res.status === 'error') update({ runDrawer: { ...drawer, loading: false, error: res.reason || 'loadFailed' } })
      else update({ runDrawer: { runId: id, data: res.data, loading: false, error: '' } })
    } catch {
      const drawer = snapshot.runDrawer
      if (drawer && drawer.runId === id) update({ runDrawer: { ...drawer, loading: false, error: 'loadFailed' } })
    }
  }

  function closeRun() { update({ runDrawer: null }) }

  // --- 写操作（统一 pending 计数 + 成功后刷新待办与当前页） ---

  function notify(kind, key, extra) {
    update({ notice: { kind, key, ...(extra ? { extra } : {}) } })
  }

  async function runWrite(executor, { successKey = 'hbWriteDone', reload } = {}) {
    if (snapshot.pending > 0 || stopped) return false
    update({ pending: snapshot.pending + 1, notice: null })
    try {
      const outcome = await executor()
      if (outcome === false) { update({ pending: Math.max(0, snapshot.pending - 1) }); return false }
      update({ pending: Math.max(0, snapshot.pending - 1) })
      // executor 可用 outcome.successKey 覆盖默认成功文案（如批量裁决的 partial）。
      notify('ok', outcome?.successKey || successKey, outcome?.detail)
      refreshTodos()
      if (reload === 'board') loadBoard()
      else if (reload === 'keywords') { loadKeywords(); loadCandidates() }
      else if (reload === 'labels') loadLabels()
      else if (reload === 'settings') loadSettings()
      return true
    } catch (error) {
      update({ pending: Math.max(0, snapshot.pending - 1) })
      const reason = error && typeof error.reason === 'string' ? error.reason : ''
      notify('error', hbErrorKey(reason))
      return false
    }
  }

  function hotboardError(error) {
    // 宿主把 MCP 错误信封收敛为 { status:'error', reason, message? }；post 抛错时
    // 透出受控 reason 供映射中文文案。
    if (error && typeof error === 'object' && typeof error.reason === 'string') {
      const err = new Error(error.reason)
      err.reason = error.reason
      throw err
    }
    throw error
  }

  function noteTagUpdate(noteId, tagType, labelCode) {
    return runWrite(async () => {
      const res = await call({ action: 'hotboard.noteTagUpdate', noteId, tagType, labelCode, confirm: true, idempotencyKey: hbIdempotencyKey() }).catch(hotboardError)
      if (res.status !== 'ready') hotboardError(res)
      // 当前抽屉里的标签立即反映新值。
      await openNote(noteId)
      return { detail: { tagType, labelCode } }
    }, { successKey: 'hbTagUpdated', reload: 'board' })
  }

  function keywordSave(payload) {
    return runWrite(async () => {
      // payload 的 action（create/update/enable/disable）是子动作，改走 op 字段
      // 传递，避免展开覆盖宿主路由用的 action 键（action 固化必须在其后）。
      const res = await call({ ...payload, action: 'hotboard.keywordSave', op: payload.action, confirm: true, idempotencyKey: hbIdempotencyKey() }).catch(hotboardError)
      if (res.status !== 'ready') hotboardError(res)
      return null
    }, { successKey: 'hbKeywordSaved', reload: 'keywords' })
  }

  function settingsUpdate() {
    return runWrite(async () => {
      const dirty = snapshot.settingsDirty
      if (!Object.keys(dirty).length) return false
      const res = await call({ action: 'hotboard.settingsUpdate', settings: dirty, confirm: true, idempotencyKey: hbIdempotencyKey() }).catch(hotboardError)
      if (res.status !== 'ready') hotboardError(res)
      return { detail: { changed: Array.isArray(res.changed) ? res.changed : [] } }
    }, { successKey: 'hbSettingsSaved', reload: 'settings' })
  }

  function runStart() {
    return runWrite(async () => {
      const res = await call({ action: 'hotboard.runStart', runType: 'incremental', confirm: true, idempotencyKey: hbIdempotencyKey() }).catch(hotboardError)
      if (res.status !== 'ready') hotboardError(res)
      update({ settingsDirty: {} })
      // run 创建即进入活跃轮询。
      if (res.run?.runId) syncRunPoll({ runId: res.run.runId, status: res.run.status || 'queued' })
      return null
    }, { successKey: 'hbRunStartDone', reload: 'board' })
  }

  function candidateReview(action, candidateIds) {
    return runWrite(async () => {
      // 评审动作（accepted/rejected）走 op 字段，避免简写覆盖路由 action。
      const res = await call({ action: 'hotboard.candidateReview', op: action, candidateIds, confirm: true, idempotencyKey: hbIdempotencyKey() }).catch(hotboardError)
      if (res.status !== 'ready') hotboardError(res)
      // 行级失败披露（review MAJOR-3）：宿主逐条放行 candidateId/ok/errorCode，
      // 存在失败时换 partial 文案并带 {failed}/{total} 统计，不再只报整体成功。
      const results = Array.isArray(res.results) ? res.results : []
      const failed = results.filter(item => item && item.ok !== true).length
      if (failed) return { successKey: 'hbCandidatesPartial', detail: { failed, total: results.length } }
      return null
    }, { successKey: 'hbCandidatesReviewed', reload: 'keywords' })
  }

  function labelReview(payload) {
    return runWrite(async () => {
      // payload 的 action（accept/reject/merge/enable/retire）是子动作，改走 op。
      const res = await call({ ...payload, action: 'hotboard.labelReview', op: payload.action, confirm: true, idempotencyKey: hbIdempotencyKey() }).catch(hotboardError)
      if (res.status !== 'ready') hotboardError(res)
      return null
    }, { successKey: 'hbLabelReviewed', reload: 'labels' })
  }

  function labelSave(payload) {
    return runWrite(async () => {
      const res = await call({ action: 'hotboard.labelSave', confirm: true, idempotencyKey: hbIdempotencyKey(), ...payload }).catch(hotboardError)
      if (res.status !== 'ready') hotboardError(res)
      return null
    }, { successKey: 'hbLabelSaved', reload: 'labels' })
  }

  // --- 确认弹窗（所有写操作先确认） ---

  function askConfirm(message, action) {
    update({ confirm: { message, action } })
  }

  function resolveConfirm() {
    const { confirm } = snapshot
    if (!confirm) return
    update({ confirm: null })
    confirm.action()
  }

  function dismissConfirm() { update({ confirm: null }) }

  function dismissNotice() { update({ notice: null }) }

  function setSettingsField(field, value) {
    update({ settingsDirty: { ...snapshot.settingsDirty, [field]: value } })
  }

  function resetSettingsDirty() {
    update({ settingsDirty: {} })
  }

  return {
    subscribe, get, init, stop, refresh,
    setSub, setFilter, setPage,
    openNote, closeNote, openRun, closeRun,
    noteTagUpdate, keywordSave, settingsUpdate, runStart, candidateReview, labelReview, labelSave,
    setSettingsField, resetSettingsDirty, askConfirm, resolveConfirm, dismissConfirm, dismissNotice,
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const SUB_PAGES = [
  { id: 'board', key: 'hbSubBoard' },
  { id: 'keywords', key: 'hbSubKeywords' },
  { id: 'tags', key: 'hbSubTags' },
  { id: 'rules', key: 'hbSubRules' },
]

function Select({ label, value, options, onChange, disabled }) {
  return h('label', { className: 'yxh-hb-filter' },
    h('span', null, label),
    h('select', { value, disabled: disabled === true, onChange: event => onChange(event.target.value) },
      options.map(opt => h('option', { key: opt.value, value: opt.value }, opt.label))))
}

function Pager({ meta, page, onPage, t }) {
  const total = Number(meta?.total) || 0
  const pageSize = Number(meta?.pageSize) || 20
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1 && total === 0) return null
  return h('div', { className: 'yxh-hb-pager' },
    h('button', { type: 'button', disabled: page <= 1, onClick: () => onPage(page - 1) }, t('hbPrev')),
    h('span', null, `${page} / ${pages} · ${t('hbTotal')} ${hbCount(total)}`),
    h('button', { type: 'button', disabled: page >= pages, onClick: () => onPage(page + 1) }, t('hbNext')))
}

// Run 状态条：活跃 run 简况（overview.runStatus）+ 轮询明细（runLive）。
function RunStatusBar({ state, hub, t }) {
  const runStatus = state.overview?.data?.runStatus || null
  const live = state.runLive
  if (!runStatus && !live) {
    return h('div', { className: 'yxh-hb-runbar yxh-hb-runbar-idle' },
      h('span', null, t('hbRunIdle')),
      h('button', { type: 'button', className: 'yxh-hb-link', onClick: () => hub.openRun(null) }, t('hbRunHistory')))
  }
  const status = live?.run?.status || runStatus?.status || '—'
  const active = ACTIVE_RUN_STATUSES.has(status)
  return h('div', { className: `yxh-hb-runbar${active ? ' yxh-hb-runbar-active' : ''}`, role: 'status' },
    active ? h('span', { className: 'yxh-spinner', 'aria-hidden': true }) : null,
    h('span', { className: 'yxh-hb-runbar-status' }, `${t('hbRunStatus')} · ${hbText(status)}`),
    h('span', null, `${t('hbRunStarted')} ${hbTime(live?.run?.startedAt || runStatus?.startedAt)}`),
    live?.remainingSearchBudget !== null && live?.remainingSearchBudget !== undefined
      ? h('span', null, `${t('hbRemainingBudget')} ${hbCount(live.remainingSearchBudget)}`)
      : null,
    live ? h('span', null, `${t('hbRunCollected')} ${hbCount(live.run?.collectedNoteCount)} · ${t('hbRunQualified')} ${hbCount(live.run?.qualifiedNoteCount)} · ${t('hbRunFailedKeywords')} ${hbCount(live.run?.failedKeywordCount)}`) : null,
    h('button', { type: 'button', className: 'yxh-hb-link', onClick: () => hub.openRun(runStatus?.runId || null) }, t('hbRunDetail')))
}

function BoardPage({ state, hub, t }) {
  const data = state.overview?.data || null
  const meta = state.overview?.meta || null
  const f = state.filters.board
  const page = state.pages.board
  const options = data?.filterOptions || null
  const kpis = data?.kpis || null
  const disabled = state.loading || state.pending > 0
  return h('div', { className: 'yxh-hb-board' },
    h('div', { className: 'yxh-hb-filters', 'aria-label': t('hbFilters') },
      h(Select, { label: t('hbWindow'), value: f.window, disabled, onChange: v => hub.setFilter('board', 'window', v), options: [
        { value: '7d', label: t('hbWindow7d') }, { value: '30d', label: t('hbWindow30d') }, { value: '90d', label: t('hbWindow90d') },
      ] }),
      h(Select, { label: t('hbKeywordFilter'), value: f.keyword, disabled, onChange: v => hub.setFilter('board', 'keyword', v), options: [{ value: '', label: t('hbAll') }, ...(options?.keywords || []).map(item => ({ value: item.keyword, label: item.keyword }))] }),
      h(Select, { label: t('hbStyle'), value: f.style, disabled, onChange: v => hub.setFilter('board', 'style', v), options: [{ value: '', label: t('hbAll') }, ...(options?.styles || []).map(item => ({ value: item.code, label: item.name }))] }),
      h(Select, { label: t('hbColor'), value: f.color, disabled, onChange: v => hub.setFilter('board', 'color', v), options: [{ value: '', label: t('hbAll') }, ...(options?.colors || []).map(item => ({ value: item.code, label: item.name }))] }),
      h(Select, { label: t('hbNoteWord'), value: f.noteWord, disabled, onChange: v => hub.setFilter('board', 'noteWord', v), options: [{ value: '', label: t('hbAll') }, ...(options?.noteWords || []).map(w => ({ value: w, label: w }))] }),
      h(Select, { label: t('hbCommentWord'), value: f.commentWord, disabled, onChange: v => hub.setFilter('board', 'commentWord', v), options: [{ value: '', label: t('hbAll') }, ...(options?.commentWords || []).map(w => ({ value: w, label: w }))] }),
      h(Select, { label: t('hbSort'), value: f.sort, disabled, onChange: v => hub.setFilter('board', 'sort', v), options: [
        { value: 'score', label: t('hbSortScore') }, { value: 'publishTime', label: t('hbSortPublishTime') },
        { value: 'collect', label: t('hbSortCollect') }, { value: 'like', label: t('hbSortLike') },
        { value: 'comment', label: t('hbSortComment') }, { value: 'share', label: t('hbSortShare') },
      ] }),
      h('label', { className: 'yxh-hb-check' },
        h('input', { type: 'checkbox', checked: f.onlyMain === true, disabled, onChange: e => hub.setFilter('board', 'onlyMain', e.target.checked) }),
        h('span', null, t('hbOnlyMain'))),
      h('label', { className: 'yxh-hb-check' },
        h('input', { type: 'checkbox', checked: f.onlyTagged === true, disabled, onChange: e => hub.setFilter('board', 'onlyTagged', e.target.checked) }),
        h('span', null, t('hbOnlyTagged')))),
    h('div', { className: 'yxh-hb-kpis' },
      h('div', { className: 'yxh-hb-kpi' }, h('span', { className: 'yxh-hb-kpi-label' }, t('hbKpiCases')), h('span', { className: 'yxh-hb-kpi-value' }, hbCount(kpis?.totalCases))),
      h('div', { className: 'yxh-hb-kpi' }, h('span', { className: 'yxh-hb-kpi-label' }, t('hbKpiCoverage')), h('span', { className: 'yxh-hb-kpi-value' }, hbPct(kpis?.coverageRate))),
      h('div', { className: 'yxh-hb-kpi' }, h('span', { className: 'yxh-hb-kpi-label' }, t('hbKpiAiTagged')), h('span', { className: 'yxh-hb-kpi-value' }, hbPct(kpis?.aiTaggedRate))),
      h('div', { className: 'yxh-hb-kpi' }, h('span', { className: 'yxh-hb-kpi-label' }, t('hbKpiDuplicates')), h('span', { className: 'yxh-hb-kpi-value' }, hbCount(kpis?.duplicateGroupCount))),
      h('div', { className: 'yxh-hb-kpi' }, h('span', { className: 'yxh-hb-kpi-label' }, t('hbKpiLowQuality')), h('span', { className: 'yxh-hb-kpi-value' }, hbCount(kpis?.lowQualityCount))),
      h('div', { className: 'yxh-hb-kpi' }, h('span', { className: 'yxh-hb-kpi-label' }, t('hbKpiFailedKeywords')), h('span', { className: 'yxh-hb-kpi-value' }, hbCount(kpis?.failedKeywordCount))),
      h('div', { className: 'yxh-hb-kpi' }, h('span', { className: 'yxh-hb-kpi-label' }, t('hbKpiLastCollected')), h('span', { className: 'yxh-hb-kpi-value' }, hbTime(kpis?.lastCollectedAt))),
      h('div', { className: 'yxh-hb-kpi' }, h('span', { className: 'yxh-hb-kpi-label' }, t('hbKpiNextRun')), h('span', { className: 'yxh-hb-kpi-value' }, kpis?.nextRun?.scheduleEnabled ? hbText(kpis.nextRun.cron) : t('hbScheduleDisabled')))),
    h('div', { className: 'yxh-hb-table-wrap' },
      h('table', { className: 'yxh-hb-table' },
        h('thead', null, h('tr', null,
          [t('hbColTitle'), t('hbColAuthor'), t('hbColType'), t('hbColPublishTime'), t('hbColScore'), t('hbColInteraction'), t('hbColTags')].map(label => h('th', { key: label }, label)))),
        h('tbody', null,
          (data?.notes || []).map(note => h('tr', { key: note.noteId, className: 'yxh-hb-row', onClick: () => hub.openNote(note.noteId) },
            h('td', { className: 'yxh-hb-cell-title' }, hbText(note.title)),
            h('td', null, hbText(note.authorName)),
            h('td', null, note.noteType === 'video' ? t('hbTypeVideo') : t('hbTypeImage')),
            h('td', null, hbTime(note.publishTime)),
            h('td', null, hbScore(note.score)),
            h('td', null, hbCount(note.interactionTotal)),
            h('td', null, [note.styleTag?.name, note.colorTag?.name].filter(Boolean).join(' / ') || '—')))),
        !data?.notes?.length && !state.loading
          ? h('tfoot', null, h('tr', null, h('td', { colSpan: 7, className: 'yxh-hb-empty' }, t('hbNoCases'))))
          : null)),
    h(Pager, { meta, page, onPage: p => hub.setPage('board', p), t }))
}

function KeywordsPage({ state, hub, t }) {
  const kwData = state.keywords?.data || null
  const kwMeta = state.keywords?.meta || null
  const candData = state.candidates?.data || null
  const candMeta = state.candidates?.meta || null
  const kf = state.filters.keywords
  const cf = state.filters.candidates
  const disabled = state.loading || state.pending > 0

  const kwRows = kwData?.keywords || []
  const pendingCandidates = (candData?.candidates || []).filter(item => item.status === 'pending')
  const [picked, setPicked] = HotReact.useState(() => new Set())
  const togglePick = id => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return h('div', { className: 'yxh-hb-keywords' },
    h('section', { className: 'yxh-hb-panel' },
      h('h2', { className: 'yxh-hb-panel-title' }, t('hbPanelKeywords')),
      h('div', { className: 'yxh-hb-filters' },
        h(Select, { label: t('hbCategory'), value: kf.category, disabled, onChange: v => hub.setFilter('keywords', 'category', v), options: [{ value: '', label: t('hbAll') }, { value: 'product', label: t('hbCategoryProduct') }, { value: 'scene', label: t('hbCategoryScene') }] }),
        h(Select, { label: t('hbStatus'), value: kf.status, disabled, onChange: v => hub.setFilter('keywords', 'status', v), options: [{ value: '', label: t('hbAll') }, { value: 'active', label: t('hbStatusActive') }, { value: 'disabled', label: t('hbStatusDisabled') }] }),
        h(Select, { label: t('hbSource'), value: kf.source, disabled, onChange: v => hub.setFilter('keywords', 'source', v), options: [{ value: '', label: t('hbAll') }, { value: 'built_in', label: t('hbSourceBuiltIn') }, { value: 'manual', label: t('hbSourceManual') }, { value: 'agent', label: t('hbSourceAgent') }] })),
      h(KeywordEditor, { hub, t, disabled }),
      h('div', { className: 'yxh-hb-table-wrap' },
        h('table', { className: 'yxh-hb-table compact' },
          h('thead', null, h('tr', null, [t('hbColKeyword'), t('hbCategory'), t('hbStatus'), t('hbSource'), t('hbColActions')].map(label => h('th', { key: label }, label)))),
          h('tbody', null, kwRows.map(row => h('tr', { key: row.keywordId },
            h('td', null, hbText(row.keyword)),
            h('td', null, row.category === 'product' ? t('hbCategoryProduct') : row.category === 'scene' ? t('hbCategoryScene') : hbText(row.category)),
            h('td', null, h('span', { className: `yxh-hb-badge ${row.status === 'active' ? 'yxh-hb-badge-ok' : 'yxh-hb-badge-muted'}` }, row.status === 'active' ? t('hbStatusActive') : t('hbStatusDisabled'))),
            h('td', null, hbText(row.source)),
            h('td', null,
              h('button', { type: 'button', className: 'yxh-hb-mini', disabled: disabled || !row.keywordId, onClick: () => hub.askConfirm(
                tf(t, row.status === 'active' ? 'hbConfirmDisableKeyword' : 'hbConfirmEnableKeyword', { keyword: row.keyword }),
                () => hub.keywordSave({ action: row.status === 'active' ? 'disable' : 'enable', keywordId: row.keywordId })) },
                row.status === 'active' ? t('hbDisable') : t('hbEnable')))))),
          !kwRows.length && !state.loading ? h('tfoot', null, h('tr', null, h('td', { colSpan: 5, className: 'yxh-hb-empty' }, t('hbNoKeywords')))) : null)),
      h(Pager, { meta: kwMeta, page: state.pages.keywords, onPage: p => hub.setPage('keywords', p), t })),
    h('section', { className: 'yxh-hb-panel' },
      h('h2', { className: 'yxh-hb-panel-title' }, t('hbPanelCandidates')),
      h('div', { className: 'yxh-hb-filters' },
        h(Select, { label: t('hbStatus'), value: cf.status, disabled, onChange: v => hub.setFilter('candidates', 'status', v), options: [
          { value: 'pending', label: t('hbPending') }, { value: 'accepted', label: t('hbAccepted') },
          { value: 'rejected', label: t('hbRejected') }, { value: 'expired', label: t('hbExpired') }, { value: '', label: t('hbAll') },
        ] }),
        h(Select, { label: t('hbCategory'), value: cf.category, disabled, onChange: v => hub.setFilter('candidates', 'category', v), options: [{ value: '', label: t('hbAll') }, { value: 'product', label: t('hbCategoryProduct') }, { value: 'scene', label: t('hbCategoryScene') }] }),
        // 扩词时间区间（generatedAt）：起止都填写才透传 dateRange。
        h('label', { className: 'yxh-hb-filter' }, t('hbDateFrom'),
          h('input', { className: 'yxh-hb-input', type: 'date', value: cf.dateFrom, disabled,
            onChange: e => hub.setFilter('candidates', 'dateFrom', e.target.value) })),
        h('label', { className: 'yxh-hb-filter' }, t('hbDateTo'),
          h('input', { className: 'yxh-hb-input', type: 'date', value: cf.dateTo, disabled,
            onChange: e => hub.setFilter('candidates', 'dateTo', e.target.value) }))),
      pendingCandidates.length
        ? h('div', { className: 'yxh-hb-bulk' },
          h('span', null, `${t('hbPicked')} ${picked.size}`),
          h('button', { type: 'button', className: 'yxh-hb-mini', disabled: disabled || !picked.size,
            onClick: () => hub.askConfirm(tf(t, 'hbConfirmAcceptCandidates', { count: picked.size }),
              () => { const ids = [...picked]; setPicked(new Set()); return hub.candidateReview('accepted', ids) }) }, t('hbAccept')),
          h('button', { type: 'button', className: 'yxh-hb-mini yxh-hb-mini-danger', disabled: disabled || !picked.size,
            onClick: () => hub.askConfirm(tf(t, 'hbConfirmRejectCandidates', { count: picked.size }),
              () => { const ids = [...picked]; setPicked(new Set()); return hub.candidateReview('rejected', ids) }) }, t('hbReject')))
        : null,
      h('div', { className: 'yxh-hb-table-wrap' },
        h('table', { className: 'yxh-hb-table compact' },
          h('thead', null, h('tr', null, [t('hbColPick'), t('hbColKeyword'), t('hbCategory'), t('hbColScore'), t('hbColReason'), t('hbStatus')].map(label => h('th', { key: label }, label)))),
          h('tbody', null, (candData?.candidates || []).map(row => h('tr', { key: row.candidateId },
            h('td', null, row.status === 'pending'
              ? h('input', { type: 'checkbox', 'aria-label': t('hbColPick'), checked: picked.has(row.candidateId), disabled, onChange: () => togglePick(row.candidateId) })
              : null),
            h('td', null, hbText(row.keyword)),
            h('td', null, row.category === 'product' ? t('hbCategoryProduct') : row.category === 'scene' ? t('hbCategoryScene') : hbText(row.category)),
            h('td', null, hbScore(row.score)),
            h('td', { className: 'yxh-hb-cell-reason' }, hbText(row.reason)),
            h('td', null, hbText(row.status))))),
          !(candData?.candidates || []).length && !state.loading ? h('tfoot', null, h('tr', null, h('td', { colSpan: 6, className: 'yxh-hb-empty' }, t('hbNoCandidates')))) : null)),
      h(Pager, { meta: candMeta, page: state.pages.candidates, onPage: p => hub.setPage('candidates', p), t })))
}

// 关键词新增/编辑行内表单（草稿保留在组件 state，页签切换后重置可接受；
// 筛选草稿在 hub，满足 §13.3 第 1 条）。
function KeywordEditor({ hub, t, disabled }) {
  const [text, setText] = HotReact.useState('')
  const [category, setCategory] = HotReact.useState('product')
  const submit = () => {
    const keyword = text.trim()
    if (!keyword) return
    hub.askConfirm(tf(t, 'hbConfirmCreateKeyword', { keyword }), () => {
      // runWrite 返回 Promise：写成异步续体，仅真失败（false）保留输入。
      hub.keywordSave({ action: 'create', keyword, category }).then(ok => { if (ok !== false) setText('') })
    })
  }
  return h('div', { className: 'yxh-hb-editor' },
    h('input', { className: 'yxh-hb-input', value: text, placeholder: t('hbKeywordPlaceholder'), maxLength: 128, disabled,
      onChange: e => setText(e.target.value), onKeyDown: e => { if (e.key === 'Enter') submit() } }),
    h(Select, { label: t('hbCategory'), value: category, disabled, onChange: setCategory, options: [{ value: 'product', label: t('hbCategoryProduct') }, { value: 'scene', label: t('hbCategoryScene') }] }),
    h('button', { type: 'button', className: 'yxh-hb-action', disabled: disabled || !text.trim(), onClick: submit }, t('hbCreateKeyword')))
}

function TagsPage({ state, hub, t }) {
  const data = state.labels?.data || null
  const meta = state.labels?.meta || null
  const f = state.filters.labels
  const disabled = state.loading || state.pending > 0
  const labels = data?.labels || []
  const proposals = data?.proposals || []
  const pendingProposals = proposals.filter(item => item.status === 'pending')
  const [mergeTarget, setMergeTarget] = HotReact.useState('')
  const [editor, setEditor] = HotReact.useState(null) // {labelId?, tagType, code, name, definition}

  return h('div', { className: 'yxh-hb-tags' },
    h('section', { className: 'yxh-hb-panel' },
      h('h2', { className: 'yxh-hb-panel-title' }, t('hbPanelProposals')),
      h('div', { className: 'yxh-hb-filters' },
        h(Select, { label: t('hbProposalStatus'), value: f.proposalStatus, disabled, onChange: v => hub.setFilter('labels', 'proposalStatus', v), options: [
          { value: 'pending', label: t('hbPending') }, { value: 'auto_activated', label: t('hbProposalAuto') },
          { value: 'accepted', label: t('hbAccepted') }, { value: 'rejected', label: t('hbRejected') },
          { value: 'merged', label: t('hbProposalMerged') }, { value: 'expired', label: t('hbExpired') }, { value: '', label: t('hbAll') },
        ] })),
      pendingProposals.length
        ? h('div', { className: 'yxh-hb-hint-row' }, t('hbMergeHint'))
        : null,
      h('div', { className: 'yxh-hb-table-wrap' },
        h('table', { className: 'yxh-hb-table compact' },
          h('thead', null, h('tr', null, [t('hbColLabel'), t('hbTagType'), t('hbColConfidence'), t('hbColEvidence'), t('hbColActions')].map(label => h('th', { key: label }, label)))),
          h('tbody', null, proposals.map(row => h('tr', { key: row.proposalId },
            h('td', null, hbText(row.proposedLabel)),
            h('td', null, row.tagType === 'style' ? t('hbStyleType') : t('hbColorType')),
            h('td', null, hbPct(row.confidence)),
            h('td', null, hbCount(row.evidenceNoteCount)),
            h('td', null, row.status === 'pending' ? h('div', { className: 'yxh-hb-row-actions' },
              h('button', { type: 'button', className: 'yxh-hb-mini', disabled,
                onClick: () => hub.askConfirm(tf(t, 'hbConfirmAcceptProposal', { label: row.proposedLabel }),
                  () => hub.labelReview({ action: 'accept', proposalId: row.proposalId })) }, t('hbAccept')),
              h('button', { type: 'button', className: 'yxh-hb-mini yxh-hb-mini-danger', disabled,
                onClick: () => hub.askConfirm(tf(t, 'hbConfirmRejectProposal', { label: row.proposedLabel }),
                  () => hub.labelReview({ action: 'reject', proposalId: row.proposalId })) }, t('hbReject')),
              h('button', { type: 'button', className: 'yxh-hb-mini', disabled,
                onClick: () => hub.askConfirm(tf(t, 'hbConfirmMergeProposal', { label: row.proposedLabel, target: mergeTarget || '—' }),
                  () => hub.labelReview({ action: 'merge', proposalId: row.proposalId, targetLabelId: mergeTarget || undefined })) }, t('hbMerge')))
              : h('span', { className: 'yxh-hb-badge yxh-hb-badge-muted' }, hbText(row.status)))))),
          !proposals.length && !state.loading ? h('tfoot', null, h('tr', null, h('td', { colSpan: 5, className: 'yxh-hb-empty' }, t('hbNoProposals')))) : null)),
      pendingProposals.length
        ? h('div', { className: 'yxh-hb-editor' },
          h(Select, { label: t('hbMergeTarget'), value: mergeTarget, disabled, onChange: setMergeTarget,
            options: [{ value: '', label: t('hbMergeTargetNone') }, ...labels.filter(item => item.status === 'active').map(item => ({ value: item.labelId, label: `${item.name} (${item.code})` }))] }))
        : null),
    h('section', { className: 'yxh-hb-panel' },
      h('h2', { className: 'yxh-hb-panel-title' }, t('hbPanelLabels')),
      h('div', { className: 'yxh-hb-filters' },
        h(Select, { label: t('hbTagType'), value: f.tagType, disabled, onChange: v => hub.setFilter('labels', 'tagType', v), options: [{ value: '', label: t('hbAll') }, { value: 'style', label: t('hbStyleType') }, { value: 'color', label: t('hbColorType') }] }),
        h(Select, { label: t('hbStatus'), value: f.status, disabled, onChange: v => hub.setFilter('labels', 'status', v), options: [{ value: '', label: t('hbAll') }, { value: 'active', label: t('hbStatusActive') }, { value: 'retired', label: t('hbStatusRetired') }] }),
        h('button', { type: 'button', className: 'yxh-hb-action', disabled,
          onClick: () => setEditor({ labelId: null, tagType: 'style', code: '', name: '', definition: '' }) }, t('hbCreateLabel'))),
      editor ? h(LabelEditor, { hub, t, disabled, editor, labels, onClose: () => setEditor(null) }) : null,
      h('div', { className: 'yxh-hb-table-wrap' },
        h('table', { className: 'yxh-hb-table compact' },
          h('thead', null, h('tr', null, [t('hbColLabel'), t('hbColCode'), t('hbTagType'), t('hbStatus'), t('hbColActions')].map(label => h('th', { key: label }, label)))),
          h('tbody', null, labels.map(row => h('tr', { key: row.labelId },
            h('td', null, hbText(row.name)),
            h('td', { className: 'yxh-hb-mono' }, hbText(row.code)),
            h('td', null, row.tagType === 'style' ? t('hbStyleType') : t('hbColorType')),
            h('td', null, h('span', { className: `yxh-hb-badge ${row.status === 'active' ? 'yxh-hb-badge-ok' : 'yxh-hb-badge-muted'}` }, row.status === 'active' ? t('hbStatusActive') : t('hbStatusRetired'))),
            h('td', null, h('div', { className: 'yxh-hb-row-actions' },
              h('button', { type: 'button', className: 'yxh-hb-mini', disabled, onClick: () => setEditor({ labelId: row.labelId, tagType: row.tagType, code: row.code, name: row.name, definition: row.definition || '' }) }, t('hbEdit')),
              row.status === 'active'
                ? h('button', { type: 'button', className: 'yxh-hb-mini yxh-hb-mini-danger', disabled,
                  onClick: () => hub.askConfirm(tf(t, 'hbConfirmRetireLabel', { label: row.name }),
                    () => hub.labelReview({ action: 'retire', labelId: row.labelId })) }, t('hbRetire'))
                : h('button', { type: 'button', className: 'yxh-hb-mini', disabled,
                  onClick: () => hub.askConfirm(tf(t, 'hbConfirmEnableLabel', { label: row.name }),
                    () => hub.labelReview({ action: 'enable', labelId: row.labelId })) }, t('hbEnable'))))))),
          !labels.length && !state.loading ? h('tfoot', null, h('tr', null, h('td', { colSpan: 5, className: 'yxh-hb-empty' }, t('hbNoLabels')))) : null)),
      h(Pager, { meta, page: state.pages.labels, onPage: p => hub.setPage('labels', p), t })))
}

// 标签新增/编辑表单：新增带 code/tagType；编辑不改 code/tagType（服务端同约束）。
function LabelEditor({ hub, t, disabled, editor, labels, onClose }) {
  const isEdit = Boolean(editor.labelId)
  const [name, setName] = HotReact.useState(editor.name || '')
  const [code, setCode] = HotReact.useState(editor.code || '')
  const [definition, setDefinition] = HotReact.useState(editor.definition || '')
  const submit = () => {
    const payload = { labelId: editor.labelId, name: name.trim(), definition: definition.trim() || undefined }
    if (!isEdit) { payload.tagType = editor.tagType; payload.code = code.trim() }
    hub.askConfirm(tf(t, isEdit ? 'hbConfirmUpdateLabel' : 'hbConfirmCreateLabel', { label: name.trim() }), () => {
      // runWrite 返回 Promise：写成异步续体，仅真失败（false）保留弹窗。
      hub.labelSave(payload).then(ok => { if (ok !== false) onClose() })
    })
  }
  return h('div', { className: 'yxh-hb-editor yxh-hb-editor-card' },
    h(Select, { label: t('hbTagType'), value: editor.tagType, disabled: disabled || isEdit, onChange: () => {}, options: [{ value: 'style', label: t('hbStyleType') }, { value: 'color', label: t('hbColorType') }] }),
    isEdit ? null : h('input', { className: 'yxh-hb-input', value: code, placeholder: t('hbCodePlaceholder'), maxLength: 64, disabled, onChange: e => setCode(e.target.value) }),
    h('input', { className: 'yxh-hb-input', value: name, placeholder: t('hbNamePlaceholder'), maxLength: 128, disabled, onChange: e => setName(e.target.value) }),
    h('input', { className: 'yxh-hb-input', value: definition, placeholder: t('hbDefinitionPlaceholder'), maxLength: 2000, disabled, onChange: e => setDefinition(e.target.value) }),
    h('div', { className: 'yxh-hb-row-actions' },
      h('button', { type: 'button', className: 'yxh-hb-action', disabled: disabled || !name.trim() || (!isEdit && !code.trim()), onClick: submit }, t('hbSave')),
      h('button', { type: 'button', className: 'yxh-hb-mini', disabled, onClick: onClose }, t('hbCancelEdit'))))
}

// 数值/布尔/cron 配置行；编辑写入 settingsDirty，保存走确认弹窗（本地 diff 文案）。
function RulesPage({ state, hub, t }) {
  const settings = state.settings
  const dirty = state.settingsDirty
  const disabled = state.loading || state.pending > 0
  const current = field => (field in dirty ? dirty[field] : settings?.[field])

  // 数值域对齐 tools 侧 xhs_hotboard_setting 的 CheckConstraint（review MINOR-4）：
  // comment_top_n/comment_max_per_note/comment_max_calls_per_day 均 >=1；
  // min_interaction_total 仅约束 >=0，上限是防误输的前端护栏。
  const numberFields = [
    { field: 'publishWindowDays', label: t('hbSetPublishWindowDays'), min: 1, max: 365 },
    { field: 'perKeywordLimit', label: t('hbSetPerKeywordLimit'), min: 1, max: 20 },
    { field: 'commentTopN', label: t('hbSetCommentTopN'), min: 1, max: 200 },
    { field: 'commentMaxPerNote', label: t('hbSetCommentMaxPerNote'), min: 1, max: 100 },
    { field: 'minInteractionTotal', label: t('hbSetMinInteraction'), min: 0, max: 1000000 },
    { field: 'dedupHammingThreshold', label: t('hbSetDedupThreshold'), min: 0, max: 10 },
    { field: 'minValidSample', label: t('hbSetMinValidSample'), min: 2, max: 1000 },
    { field: 'searchMaxCallsPerDay', label: t('hbSetSearchBudget'), min: 1, max: 10000 },
    { field: 'commentMaxCallsPerDay', label: t('hbSetCommentBudget'), min: 1, max: 10000 },
    { field: 'detailMaxCallsPerRun', label: t('hbSetDetailBudget'), min: 0, max: 10000 },
  ]
  const boolFields = [
    { field: 'scheduleEnabled', label: t('hbSetScheduleEnabled') },
    { field: 'manualIncrementEnabled', label: t('hbSetManualIncrement') },
    { field: 'commentSampleEnabled', label: t('hbSetCommentSample') },
    { field: 'manualCommentDefaultEnabled', label: t('hbSetManualCommentDefault') },
  ]

  const save = () => {
    const changes = Object.keys(dirty).map(field => ({ field, from: settings?.[field], to: dirty[field] }))
    hub.askConfirm(tf(t, 'hbConfirmSettings', { count: changes.length }), () => { hub.settingsUpdate() })
  }
  const startRun = () => hub.askConfirm(t('hbConfirmRunStart'), () => { hub.runStart() })

  return h('div', { className: 'yxh-hb-rules' },
    h('section', { className: 'yxh-hb-panel' },
      h('h2', { className: 'yxh-hb-panel-title' }, t('hbPanelCollect')),
      h('p', { className: 'yxh-hb-hint' }, settings?.manualIncrementEnabled === false ? t('hbManualDisabledHint') : t('hbManualHint')),
      h('div', { className: 'yxh-hb-row-actions' },
        h('button', { type: 'button', className: 'yxh-hb-action', disabled: disabled || settings?.manualIncrementEnabled === false, onClick: startRun }, t('hbStartIncrement')),
        h('button', { type: 'button', className: 'yxh-hb-mini', disabled: state.pending > 0, onClick: () => hub.openRun(null) }, t('hbRunHistory')))),
    h('section', { className: 'yxh-hb-panel' },
      h('h2', { className: 'yxh-hb-panel-title' }, t('hbPanelSettings')),
      settings ? h('div', { className: 'yxh-hb-settings' },
        h('div', { className: 'yxh-hb-settings-grid' },
          numberFields.map(item => h('label', { key: item.field, className: 'yxh-hb-filter' },
            h('span', null, item.label),
            h('input', { className: 'yxh-hb-input', type: 'number', min: item.min, max: item.max, value: current(item.field) ?? '', disabled,
              onChange: e => hub.setSettingsField(item.field, e.target.value === '' ? '' : Number(e.target.value)) })))),
        h('div', { className: 'yxh-hb-settings-grid' },
          boolFields.map(item => h('label', { key: item.field, className: 'yxh-hb-check' },
            h('input', { type: 'checkbox', checked: current(item.field) === true, disabled,
              onChange: e => hub.setSettingsField(item.field, e.target.checked) }),
            h('span', null, item.label))),
          h('label', { className: 'yxh-hb-filter' },
            h('span', null, t('hbSetFullScheduleCron')),
            h('input', { className: 'yxh-hb-input', value: current('fullScheduleCron') ?? '', disabled,
              onChange: e => hub.setSettingsField('fullScheduleCron', e.target.value) }))))
      : h('p', { className: 'yxh-hb-empty' }, t('hbLoading')),
      Object.keys(dirty).length
        ? h('div', { className: 'yxh-hb-dirty' },
          h('div', { className: 'yxh-hb-dirty-list' }, Object.keys(dirty).map(field =>
            h('div', { key: field }, `${field}: ${hbText(settings?.[field])} → ${hbText(dirty[field])}`))),
          h('div', { className: 'yxh-hb-row-actions' },
            h('button', { type: 'button', className: 'yxh-hb-action', disabled, onClick: save }, t('hbSaveSettings')),
            h('button', { type: 'button', className: 'yxh-hb-mini', disabled, onClick: () => hub.resetSettingsDirty() }, t('hbCancelEdit'))))
        : null,
      settings?.ruleVersion ? h('p', { className: 'yxh-hb-hint' }, `${t('hbRuleVersion')} · ${hbText(settings.ruleVersion)}`) : null))
}

// 案例详情抽屉：图片（失败占位）+ 指标 + 当前标签纠错 + 相似笔记 + 高频词。
function NoteDrawer({ state, hub, t }) {
  // hooks 必须无条件调用：useState 在条件 return 之前（review MAJOR-2）。
  const [broken, setBroken] = HotReact.useState(() => new Set())
  const drawer = state.noteDrawer
  if (!drawer) return null
  const data = drawer.data
  const markBroken = url => setBroken(prev => {
    const next = new Set(prev)
    next.add(url)
    return next
  })
  const note = data?.note || null
  const metrics = data?.metrics || null
  const styleOptions = (state.overview?.data?.filterOptions?.styles || [])
  const colorOptions = (state.overview?.data?.filterOptions?.colors || [])
  const currentStyle = (data?.currentTags || []).find(tag => tag.tagType === 'style')
  const currentColor = (data?.currentTags || []).find(tag => tag.tagType === 'color')
  const imageUrls = [data?.images?.coverUrl, ...(data?.images?.imageUrls || [])].filter(Boolean)

  return h('div', { className: 'yxh-hb-drawer-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('hbNoteDetail'), onClick: event => { if (event.target === event.currentTarget) hub.closeNote() } },
    h('aside', { className: 'yxh-hb-drawer' },
      h('header', { className: 'yxh-hb-drawer-head' },
        h('h2', null, t('hbNoteDetail')),
        h('button', { type: 'button', className: 'yxh-hb-mini', onClick: () => hub.closeNote() }, t('hbCloseDrawer'))),
      drawer.loading ? h('p', { className: 'yxh-hb-empty' }, t('hbLoading')) : null,
      drawer.error ? h('p', { className: 'yxh-hb-error' }, t('hbLoadFailed')) : null,
      data ? h('div', { className: 'yxh-hb-drawer-body' },
        h('h3', null, hbText(note?.title)),
        h('p', { className: 'yxh-hb-hint' }, `${hbText(note?.authorName)} · ${note?.noteType === 'video' ? t('hbTypeVideo') : t('hbTypeImage')} · ${hbTime(note?.publishTime)}`),
        imageUrls.length
          ? h('div', { className: 'yxh-hb-images' }, imageUrls.map(url => broken.has(url)
            ? h('div', { key: url, className: 'yxh-hb-image yxh-hb-image-broken' }, t('hbImageBroken'))
            : h('img', { key: url, className: 'yxh-hb-image', src: url, alt: '', loading: 'lazy', onError: () => markBroken(url) })))
          : h('p', { className: 'yxh-hb-hint' }, t('hbNoImages')),
        h('h4', null, t('hbMetrics')),
        h('div', { className: 'yxh-hb-metrics' },
          h('span', null, `${t('statLikes')} ${hbCount(metrics?.likeCount)}`),
          h('span', null, `${t('statCollects')} ${hbCount(metrics?.collectCount)}`),
          h('span', null, `${t('statComments')} ${hbCount(metrics?.commentCount)}`),
          h('span', null, `${t('statShares')} ${hbCount(metrics?.shareCount)}`),
          h('span', null, `${t('hbColInteraction')} ${hbCount(metrics?.interactionTotal)}`),
          h('span', null, `${t('hbScore7d')} ${hbScore(metrics?.score7d)}`),
          h('span', null, `${t('hbScore30d')} ${hbScore(metrics?.score30d)}`),
          h('span', null, `${t('hbScore90d')} ${hbScore(metrics?.score90d)}`)),
        h('h4', null, t('hbCurrentTags')),
        h('div', { className: 'yxh-hb-tagedit' },
          h(Select, { label: t('hbStyle'), value: currentStyle?.labelCode || '', disabled: state.pending > 0,
            onChange: code => code && hub.askConfirm(tf(t, 'hbConfirmTagUpdate', { tag: styleOptions.find(item => item.code === code)?.name || code }),
              () => hub.noteTagUpdate(note.noteId, 'style', code)),
            options: [{ value: '', label: currentStyle?.labelName || t('hbUntagged') }, ...styleOptions.map(item => ({ value: item.code, label: item.name }))] }),
          h(Select, { label: t('hbColor'), value: currentColor?.labelCode || '', disabled: state.pending > 0,
            onChange: code => code && hub.askConfirm(tf(t, 'hbConfirmTagUpdate', { tag: colorOptions.find(item => item.code === code)?.name || code }),
              () => hub.noteTagUpdate(note.noteId, 'color', code)),
            options: [{ value: '', label: currentColor?.labelName || t('hbUntagged') }, ...colorOptions.map(item => ({ value: item.code, label: item.name }))] })),
        note?.body ? h('h4', null, t('hbNoteBody')) : null,
        note?.body ? h('p', { className: 'yxh-hb-note-body' }, hbText(note.body)) : null,
        h('h4', null, t('hbSimilarNotes')),
        (data?.similarNotes || []).length
          ? h('ul', { className: 'yxh-hb-similar' }, data.similarNotes.map(item => h('li', { key: item.noteId }, hbText(item.title))))
          : h('p', { className: 'yxh-hb-hint' }, '—'),
        h('h4', null, t('hbWordStats')),
        (data?.wordStats || []).length
          ? h('div', { className: 'yxh-hb-words' }, data.wordStats.map(item => h('span', { key: `${item.wordType}:${item.word}`, className: 'yxh-hb-tag' }, `${item.word} ×${hbCount(item.frequency)}`)))
          : h('p', { className: 'yxh-hb-hint' }, '—')) : null))
}

// Run 详情抽屉：run 负载 + 关键词执行明细 + 失败关键词。
function RunDrawer({ state, hub, t }) {
  const drawer = state.runDrawer
  if (!drawer) return null
  const run = drawer.data?.run || null
  const rows = drawer.data?.keywordRuns || []
  const failed = drawer.data?.failedKeywords || []
  return h('div', { className: 'yxh-hb-drawer-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('hbRunDetail'), onClick: event => { if (event.target === event.currentTarget) hub.closeRun() } },
    h('aside', { className: 'yxh-hb-drawer' },
      h('header', { className: 'yxh-hb-drawer-head' },
        h('h2', null, t('hbRunDetail')),
        h('button', { type: 'button', className: 'yxh-hb-mini', onClick: () => hub.closeRun() }, t('hbCloseDrawer'))),
      drawer.loading ? h('p', { className: 'yxh-hb-empty' }, t('hbLoading')) : null,
      drawer.error ? h('p', { className: 'yxh-hb-error' }, t('hbLoadFailed')) : null,
      drawer.data ? h('div', { className: 'yxh-hb-drawer-body' },
        h('div', { className: 'yxh-hb-metrics' },
          h('span', null, `${t('hbRunStatus')} · ${hbText(run?.status)}`),
          h('span', null, `${t('hbRunType')} · ${hbText(run?.runType)}`),
          h('span', null, `${t('hbRunStarted')} ${hbTime(run?.startedAt)}`),
          h('span', null, `${t('hbRunFinished')} ${hbTime(run?.finishedAt)}`),
          h('span', null, `${t('hbRemainingBudget')} ${hbCount(drawer.data.remainingSearchBudget)}`),
          run?.errorCode ? h('span', { className: 'yxh-hb-error' }, `${t('hbRunError')} · ${hbText(run.errorCode)}`) : null),
        h('div', { className: 'yxh-hb-metrics' },
          h('span', null, `${t('hbRunKeywords')} ${hbCount(run?.activeKeywordCount)}`),
          h('span', null, `${t('hbRunSuccess')} ${hbCount(run?.successKeywordCount)}`),
          h('span', null, `${t('hbRunFailedKeywords')} ${hbCount(run?.failedKeywordCount)}`),
          h('span', null, `${t('hbRunNoResult')} ${hbCount(run?.noResultKeywordCount)}`),
          h('span', null, `${t('hbRunCollected')} ${hbCount(run?.collectedNoteCount)}`),
          h('span', null, `${t('hbRunQualified')} ${hbCount(run?.qualifiedNoteCount)}`),
          h('span', null, `${t('hbRunDuplicates')} ${hbCount(run?.duplicateNoteCount)}`),
          h('span', null, `${t('hbKpiLowQuality')} ${hbCount(run?.lowQualityNoteCount)}`),
          h('span', null, `${t('hbRunAiTagged')} ${hbCount(run?.aiTaggedCount)}`),
          h('span', null, `${t('hbRunAiPending')} ${hbCount(run?.aiPendingCount)}`)),
        failed.length ? h('h4', null, t('hbPanelFailedKeywords')) : null,
        failed.length ? h('ul', { className: 'yxh-hb-similar' }, failed.map(item =>
          h('li', { key: item.keyword }, `${item.keyword} · ${hbText(item.errorCode)}`))) : null,
        h('h4', null, t('hbPanelKeywordRuns')),
        h('div', { className: 'yxh-hb-table-wrap' },
          h('table', { className: 'yxh-hb-table compact' },
            h('thead', null, h('tr', null, [t('hbColKeyword'), t('hbStatus'), t('hbRunCollected'), t('hbRunQualified'), t('hbColActions')].map(label => h('th', { key: label }, label)))),
            h('tbody', null, rows.map(row => h('tr', { key: row.keyword },
              h('td', null, hbText(row.keyword)),
              h('td', null, h('span', { className: `yxh-hb-badge ${row.status === 'success' ? 'yxh-hb-badge-ok' : row.status === 'failed' ? 'yxh-hb-badge-expired' : 'yxh-hb-badge-muted'}` }, hbText(row.status))),
              h('td', null, hbCount(row.collectedCount)),
              h('td', null, hbCount(row.qualifiedCount)),
              h('td', null, row.errorCode ? hbText(row.errorCode) : '—'))))))) : null))
}

function ConfirmDialog({ state, hub, t }) {
  const confirm = state.confirm
  if (!confirm) return null
  return h('div', { className: 'yxh-hb-confirm-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('hbConfirm') },
    h('div', { className: 'yxh-hb-confirm' },
      h('p', { className: 'yxh-hb-confirm-title' }, confirm.message),
      h('div', { className: 'yxh-hb-confirm-actions' },
        h('button', { type: 'button', className: 'yxh-hb-action', onClick: () => hub.resolveConfirm() }, t('confirmYes')),
        h('button', { type: 'button', className: 'yxh-hb-mini', onClick: () => hub.dismissConfirm() }, t('confirmNo')))))
}

export function HotboardPage({ hub, t }) {
  const state = HotReact.useSyncExternalStore(hub.subscribe, hub.get, hub.get)
  const todoBadge = sub => {
    if (sub === 'keywords' && state.todos.candidates !== null && state.todos.candidates > 0) return state.todos.candidates
    if (sub === 'tags' && state.todos.proposals !== null && state.todos.proposals > 0) return state.todos.proposals
    return null
  }
  return h('div', { className: 'yxh-hb' },
    h('nav', { className: 'yxh-tabs', 'aria-label': t('hbTitle') },
      SUB_PAGES.map(item => h('button', { key: item.id, type: 'button', 'aria-current': state.sub === item.id || undefined, onClick: () => hub.setSub(item.id) },
        t(item.key),
        todoBadge(item.id) !== null ? h('span', { className: 'yxh-hb-count' }, String(todoBadge(item.id))) : null))),
    state.notice ? h('div', { className: `yxh-hb-notice yxh-hb-notice-${state.notice.kind}`, role: state.notice.kind === 'error' ? 'alert' : 'status' },
      h('span', null, tf(t, state.notice.kind === 'error' ? (state.notice.key || 'hbWriteFailed') : state.notice.key, state.notice.extra)),
      h('button', { type: 'button', className: 'yxh-hb-notice-close', 'aria-label': t('close'), onClick: () => hub.dismissNotice() }, '×')) : null,
    state.error && !state.loading ? h('div', { className: 'yxh-hb-page-error', role: 'alert' },
      h('span', null, t('hbLoadFailed')),
      h('button', { type: 'button', className: 'yxh-hb-mini', onClick: () => hub.refresh() }, t('refreshData'))) : null,
    state.sub === 'board' ? h(BoardPage, { state, hub, t })
      : state.sub === 'keywords' ? h(KeywordsPage, { state, hub, t })
        : state.sub === 'tags' ? h(TagsPage, { state, hub, t })
          : h(RulesPage, { state, hub, t }),
    h(NoteDrawer, { state, hub, t }),
    h(RunDrawer, { state, hub, t }),
    h(ConfirmDialog, { state, hub, t }))
}

// 样式：前缀 yxh-hb-；全部使用宿主 DSW token 变量（--dsw-alias-*），不复制静态
// 模板中的颜色兜底值（实施文档 §13.3）。
export const hotboardCss = '.yxh-hb{display:grid;gap:0;max-width:1440px;margin:0 auto;width:100%;min-height:0;overflow:auto;padding:20px 32px 40px}.yxh-hb .yxh-tabs{border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-hb-count{margin-left:6px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:11px;font-weight:600;line-height:18px;display:inline-block}.yxh-hb-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0 0;padding:10px 14px;border-radius:6px;font-size:13px}.yxh-hb-notice-ok{border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f855a) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f855a) 10%,transparent)}.yxh-hb-notice-error{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-label-primary))}.yxh-hb-notice-close{border:0;background:transparent;color:inherit;font-size:15px;line-height:1;cursor:pointer}.yxh-hb-page-error{display:flex;align-items:center;gap:12px;margin:10px 0 0;padding:10px 14px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);font-size:13px}.yxh-hb-runbar{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-top:12px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:13px;color:var(--dsw-alias-label-secondary)}.yxh-hb-runbar-active{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent)}.yxh-hb-runbar .yxh-spinner{width:14px;height:14px;border-width:2px}.yxh-hb-runbar-status{font-weight:650;color:var(--dsw-alias-label-primary)}.yxh-hb-link{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:13px;cursor:pointer;padding:0}.yxh-hb-link:hover{text-decoration:underline}.yxh-hb-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:12px 0}.yxh-hb-filter{display:grid;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}.yxh-hb-filter select,.yxh-hb-input{min-height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px}.yxh-hb-filter select:disabled,.yxh-hb-input:disabled{opacity:.55}.yxh-hb-check{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;padding-bottom:8px}.yxh-hb-check input{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}.yxh-hb-check input:disabled{cursor:default}.yxh-hb-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}.yxh-hb-kpi{display:grid;gap:4px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.yxh-hb-kpi-label{color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-hb-kpi-value{font-size:20px;line-height:1.25;font-weight:650;font-variant-numeric:tabular-nums}.yxh-hb-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yxh-hb-table{width:100%;border-collapse:collapse;font-size:13px}.yxh-hb-table th,.yxh-hb-table td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}.yxh-hb-table td{white-space:normal;word-break:break-word}.yxh-hb-table thead th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-weight:600}.yxh-hb-table tbody tr:last-child td{border-bottom:0}.yxh-hb-row{cursor:pointer}.yxh-hb-row:hover{background:var(--dsw-alias-bg-layer-2)}.yxh-hb-cell-title{max-width:340px;font-weight:600}.yxh-hb-cell-reason{max-width:260px;color:var(--dsw-alias-label-secondary)}.yxh-hb-empty{margin:0;padding:18px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}.yxh-hb-pager{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:10px;font-size:13px;color:var(--dsw-alias-label-secondary)}.yxh-hb-pager button{min-height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px;cursor:pointer}.yxh-hb-pager button:disabled{opacity:.45;cursor:default}.yxh-hb-panel{display:grid;gap:10px;margin-top:22px}.yxh-hb-panel-title{margin:0;font-size:17px;line-height:1.35;font-weight:650}.yxh-hb-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}.yxh-hb-badge-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f855a) 16%,transparent);color:var(--dsw-alias-state-success-primary,#2f855a)}.yxh-hb-badge-muted{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.yxh-hb-badge-expired{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary))}.yxh-hb-mini{flex:none;min-height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}.yxh-hb-mini:hover{background:var(--dsw-alias-bg-layer-2)}.yxh-hb-mini:disabled{opacity:.45;cursor:default}.yxh-hb-mini-danger{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary))}.yxh-hb-action{min-height:34px;padding:0 16px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:13px;font-weight:600;cursor:pointer}.yxh-hb-action:disabled{opacity:.45;cursor:default}.yxh-hb-row-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.yxh-hb-bulk{display:flex;align-items:center;gap:10px;margin:8px 0;font-size:13px;color:var(--dsw-alias-label-secondary)}.yxh-hb-editor{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:10px 0}.yxh-hb-editor-card{display:grid;grid-template-columns:160px 1fr;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);align-items:center}.yxh-hb-editor-card .yxh-hb-row-actions{grid-column:1/-1}.yxh-hb-editor .yxh-hb-input{min-width:220px}.yxh-hb-hint-row,.yxh-hb-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-hb-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.yxh-hb-settings{display:grid;gap:14px}.yxh-hb-settings-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.yxh-hb-dirty{display:grid;gap:10px;padding:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent);font-size:13px}.yxh-hb-dirty-list{display:grid;gap:4px;font-variant-numeric:tabular-nums}.yxh-hb-drawer-overlay{position:fixed;inset:0;z-index:540;display:flex;justify-content:flex-end;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent)}.yxh-hb-drawer{width:min(640px,92vw);height:100%;overflow:auto;padding:20px 24px 36px;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:grid;gap:14px;align-content:start}.yxh-hb-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.yxh-hb-drawer-head h2{margin:0;font-size:17px;font-weight:650}.yxh-hb-drawer h3{margin:0;font-size:15px;line-height:1.4}.yxh-hb-drawer h4{margin:6px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary);font-weight:650}.yxh-hb-images{display:flex;flex-wrap:wrap;gap:8px}.yxh-hb-image{width:96px;height:96px;object-fit:cover;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}.yxh-hb-image-broken{display:grid;place-items:center;padding:6px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:11px}.yxh-hb-metrics{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.yxh-hb-error{margin:0;color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-label-primary));font-size:13px}.yxh-hb-tagedit{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.yxh-hb-note-body{margin:0;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}.yxh-hb-similar{margin:0;padding-left:18px;display:grid;gap:4px;font-size:13px}.yxh-hb-words{display:flex;flex-wrap:wrap;gap:6px}.yxh-hb-tag{padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-hb-confirm-overlay{position:fixed;inset:0;z-index:560;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}.yxh-hb-confirm{width:min(420px,calc(100vw - 32px));padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 40px rgba(0,0,0,.18)}.yxh-hb-confirm-title{margin:0 0 20px;font-size:14px;line-height:1.6}.yxh-hb-confirm-actions{display:flex;justify-content:flex-end;gap:12px}@media(max-width:900px){.yxh-hb{padding:16px 16px 40px}.yxh-hb-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.yxh-hb-settings-grid{grid-template-columns:1fr}.yxh-hb-tagedit{grid-template-columns:1fr}.yxh-hb-editor-card{grid-template-columns:1fr}}'
