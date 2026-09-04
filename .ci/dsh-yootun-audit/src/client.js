const React = require('react')
const { createElement: h, useEffect, useReducer, useRef, useSyncExternalStore } = React
const {
  IconChecklistOutline14, IconChevronRightOutline14,
  IconCloseOutline16, IconRefreshOutline16, IconSearchOutline16, IconWarningOutline16, Tooltip,
} = require('@deepseek-ai/dsh-client-ui-primitives')

const NS = 'dofe.yootun-audit'
const PATH = '/api/desktop/yootun/audit'
const OVERLAY_ID = '@dofe/dsh-yootun-audit'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const EMPTY_WORKSPACE = Object.freeze({
  status: 'ready', summary: { today: 0, failed: 0, pendingSync: 0 }, events: [], page: { nextCursor: null },
  scopes: { available: ['self'], isSuperAdmin: false }, sync: { pending: 0, quarantine: 0 }, freshness: { source: 'live' },
})
const EMPTY_FILTERS = Object.freeze({ query: '', pluginId: '', actionCode: '', outcome: '', timeRange: '', end: '' })
const TIME_RANGE_MS = Object.freeze({ '24h': 86400000, '7d': 604800000, '30d': 2592000000 })
const copy = {
  zh: { open: '操作审计', title: '操作审计', subtitle: '追溯成员与插件实际执行的业务操作', close: '关闭操作审计', refresh: '刷新', self: '本人', team: '团队', today: '今日操作', failed: '失败', pendingSync: '待同步', search: '搜索操作、对象或成员', allPlugins: '全部插件', allActions: '全部动作', allResults: '全部结果', allTime: '全部时间', time24h: '最近 24 小时', time7d: '最近 7 天', time30d: '最近 30 天', succeeded: '成功', partial: '部分完成', accepted: '已受理', loading: '正在加载审计记录', empty: '尚无可审计操作', filteredEmpty: '没有符合筛选条件的记录', clear: '清除筛选', retry: '立即重试', cached: '当前显示本机缓存', offline: '远端暂不可用，已保留最近记录', auth: '需要重新连接 Models 账户', localError: '本机审计存储暂不可用', time: '发生时间', actor: '操作者', action: '操作', target: '对象', result: '结果', detail: '记录详情', source: '来源', surface: '入口', occurredAt: '发生时间', receivedAt: '接收时间', changes: '字段变化', effects: '外部结果', errorCode: '错误码', traceId: '追踪 ID', noChanges: '无结构化字段变化', loadMore: '加载更多', chooseTeam: '选择团队后查看记录', searchTeam: '搜索团队', stale: '数据更新于', syncIssue: '条记录尚未同步', quarantine: '条记录需检查', closeDetail: '关闭详情' },
  en: { open: 'Operation audit', title: 'Operation audit', subtitle: 'Trace business operations performed by members and plugins', close: 'Close operation audit', refresh: 'Refresh', self: 'Me', team: 'Team', today: 'Today', failed: 'Failed', pendingSync: 'Pending sync', search: 'Search operation, target, or member', allPlugins: 'All plugins', allActions: 'All actions', allResults: 'All results', allTime: 'All time', time24h: 'Last 24 hours', time7d: 'Last 7 days', time30d: 'Last 30 days', succeeded: 'Succeeded', partial: 'Partial', accepted: 'Accepted', loading: 'Loading audit records', empty: 'No auditable operations yet', filteredEmpty: 'No records match these filters', clear: 'Clear filters', retry: 'Retry now', cached: 'Showing local cache', offline: 'Remote unavailable; recent records retained', auth: 'Reconnect your Models account', localError: 'Local audit storage unavailable', time: 'Time', actor: 'Actor', action: 'Operation', target: 'Target', result: 'Result', detail: 'Record details', source: 'Source', surface: 'Surface', occurredAt: 'Occurred', receivedAt: 'Received', changes: 'Changes', effects: 'External effects', errorCode: 'Error code', traceId: 'Trace ID', noChanges: 'No structured changes', loadMore: 'Load more', chooseTeam: 'Choose a team to view records', searchTeam: 'Search teams', stale: 'Updated', syncIssue: 'records pending sync', quarantine: 'records need review', closeDetail: 'Close details' },
}

const number = value => Number.isInteger(value) && value >= 0 ? value : 0
function normalizeWorkspace(value) {
  const root = value && typeof value === 'object' ? value : {}
  const summary = root.summary && typeof root.summary === 'object' ? root.summary : {}
  const page = root.page && typeof root.page === 'object' ? root.page : {}
  const scopes = root.scopes && typeof root.scopes === 'object' ? root.scopes : {}
  const sync = root.sync && typeof root.sync === 'object' ? root.sync : {}
  const freshness = root.freshness && typeof root.freshness === 'object' ? root.freshness : {}
  return {
    status: ['ready', 'offline', 'cached', 'auth_required', 'forbidden', 'local_error'].includes(root.status) ? root.status : 'ready',
    summary: { today: number(summary.today), failed: number(summary.failed), pendingSync: number(summary.pendingSync) },
    events: Array.isArray(root.events) ? root.events.filter(event => event && typeof event === 'object' && typeof event.id === 'string') : [],
    page: { nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null },
    scopes: { available: Array.isArray(scopes.available) ? scopes.available.filter(scope => scope === 'self' || scope === 'team') : ['self'], ...(scopes.currentTeam && typeof scopes.currentTeam === 'object' ? { currentTeam: scopes.currentTeam } : {}), isSuperAdmin: scopes.isSuperAdmin === true },
    sync: { pending: number(sync.pending), quarantine: number(sync.quarantine), ...(typeof sync.lastAttemptAt === 'string' ? { lastAttemptAt: sync.lastAttemptAt } : {}), ...(typeof sync.errorCode === 'string' ? { errorCode: sync.errorCode } : {}) },
    freshness: { source: freshness.source === 'cache' ? 'cache' : 'live', ...(typeof freshness.syncedAt === 'string' ? { syncedAt: freshness.syncedAt } : {}) },
  }
}
function buildQuery(state, cursor, now = Date.now()) {
  const params = new URLSearchParams({ view: 'workspace', scope: state.scope === 'team' ? 'team' : 'self', limit: '50' })
  for (const key of ['teamId', 'pluginId', 'actionCode', 'outcome', 'start', 'end', 'query']) {
    const value = typeof state[key] === 'string' ? state[key].trim() : ''
    if (value) params.set(key, value.slice(0, key === 'query' ? 200 : 160))
  }
  const range = TIME_RANGE_MS[state.timeRange]
  if (range) params.set('start', new Date(now - range).toISOString())
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}
function mergePage(existing, incoming) {
  const seen = new Set()
  return [...existing, ...incoming].filter(event => { const key = event.id || event.clientEventId; if (!key || seen.has(key)) return false; seen.add(key); return true })
}
function initialState() { return { visible: false, loading: false, appending: false, error: '', workspace: null, selectedId: null, scope: 'self', teamId: '', teamQuery: '', teams: [], filters: { ...EMPTY_FILTERS }, revision: 0 } }
function reducer(state, action) {
  if (action.type === 'open') return { ...state, visible: true }
  if (action.type === 'close') return { ...state, visible: false, selectedId: null }
  if (action.type === 'loading') return { ...state, loading: !state.workspace, appending: action.append === true, error: '' }
  if (action.type === 'loaded') { const workspace = normalizeWorkspace(action.value); const events = action.append && state.workspace ? mergePage(state.workspace.events, workspace.events) : workspace.events; const merged = { ...workspace, events }; return { ...state, workspace: merged, loading: false, appending: false, error: '', selectedId: state.selectedId && events.some(item => item.id === state.selectedId) ? state.selectedId : null } }
  if (action.type === 'error') return { ...state, loading: false, appending: false, error: action.error || 'unavailable' }
  if (action.type === 'filter') return { ...state, filters: { ...state.filters, [action.name]: action.value }, selectedId: null }
  if (action.type === 'clear') return { ...state, filters: { ...EMPTY_FILTERS }, selectedId: null }
  if (action.type === 'scope') return { ...state, scope: action.value, teamId: '', selectedId: null }
  if (action.type === 'team') return { ...state, teamId: action.value, selectedId: null }
  if (action.type === 'teamQuery') return { ...state, teamQuery: action.value }
  if (action.type === 'teams') return { ...state, teams: Array.isArray(action.value) ? action.value : [] }
  if (action.type === 'select') return { ...state, selectedId: action.id }
  if (action.type === 'refresh') return { ...state, revision: state.revision + 1 }
  return state
}

let opened = false
let lastTrigger = null
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
const setOpened = value => { opened = value; emit() }
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => opened
function openOverlay(event) { lastTrigger = event?.currentTarget || document.activeElement; window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } })); setOpened(true) }
function closeOverlay() { setOpened(false); requestAnimationFrame(() => lastTrigger?.focus?.()) }
const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) closeOverlay() }
async function requestJson(query, signal) { const response = await fetch(`${PATH}?${query}`, { credentials: 'same-origin', signal, headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`audit_${response.status}`); return response.json() }
async function retrySync() { const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ action: 'retry_sync' }) }); if (!response.ok) throw new Error(`audit_${response.status}`) }
const formatTime = value => { if (!value) return '—'; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—' }
const ACTION_LABELS = Object.freeze({
  'recruiter.requirement.created': '创建招聘岗位', 'recruiter.requirement.updated': '更新招聘岗位',
  'recruiter.candidate_analysis.saved': '保存候选分析', 'recruiter.boss_sync.executed': '同步招聘数据',
  'recruiter.action.created': '创建招聘动作', 'recruiter.action.confirmed': '确认招聘动作',
  'recruiter.action.dismissed': '撤销招聘动作', 'recruiter.action.executed': '执行招聘动作',
  'sales.lead.created': '创建销售线索', 'sales.lead.updated': '更新销售线索',
  'sales.follow_up.created': '创建跟进动作', 'sales.follow_up.confirmed': '确认跟进动作',
  'sales.follow_up.dismissed': '撤销跟进动作', 'sales.follow_up.executed': '执行跟进动作',
  'supply.risk.created': '创建供应风险', 'supply.risk.updated': '更新供应风险',
  'supply.review.created': '创建风险复核', 'supply.review.confirmed': '确认风险复核',
  'supply.review.dismissed': '撤销风险复核', 'supply.review.executed': '执行风险复核',
  'content.review.updated': '更新文章审核', 'content.platforms.updated': '更新发布渠道',
  'content.publish.executed': '执行内容发布', 'knowledge.memory.remembered': '保存知识记忆',
  'knowledge.memory.confirmed': '确认知识记忆', 'knowledge.memory.forgotten': '删除知识记忆',
  'knowledge.file.imported': '导入知识文件', 'lead_discovery.discovery.executed': '执行线索发现',
  'retrofit.public_sources.refreshed': '刷新公开来源', 'xhs.rewrite.created': '创建小红书仿写',
  'xhs.rewrite.completed': '完成小红书仿写', 'media.upload.completed': '完成媒体上传',
})
const actionLabel = code => ACTION_LABELS[code] || code || '—'
const surfaceLabel = value => ({ human_ui: '人工界面', agent_tool: 'Agent 工具', system: '系统任务' }[value] || value || '—')
const effectOutcomeLabel = value => ({ succeeded: '成功', failed: '失败', accepted: '已受理', requires_user_login: '需要用户登录' }[value] || value || '—')
function outcomeLabel(value, t) { return value === 'succeeded' ? t('succeeded') : value === 'partial' ? t('partial') : value === 'accepted' ? t('accepted') : t('failed') }
function Metric({ label, value, tone }) { return h('div', { className: `ya-metric${tone ? ` is-${tone}` : ''}` }, h('span', null, label), h('strong', null, String(value))) }
function IconButton({ label, onClick, icon: Icon }) { return h(Tooltip, { label }, h('button', { type: 'button', className: 'ya-icon-button', 'aria-label': label, onClick }, h(Icon, { size: 16 }))) }
function StatusBanner({ workspace, error, t, refresh }) {
  const status = error ? 'offline' : workspace.status
  if (status === 'ready' && workspace.sync.pending === 0 && workspace.sync.quarantine === 0) return null
  const message = status === 'cached' ? t('cached') : status === 'auth_required' ? t('auth') : status === 'local_error' ? t('localError') : status === 'ready' ? '' : t('offline')
  return h('div', { className: 'ya-status', role: status === 'ready' ? 'status' : 'alert' }, h(IconWarningOutline16, { size: 16 }), h('span', null, [message, workspace.freshness.syncedAt ? `${t('stale')} ${formatTime(workspace.freshness.syncedAt)}` : '', workspace.sync.pending ? `${workspace.sync.pending} ${t('syncIssue')}` : '', workspace.sync.quarantine ? `${workspace.sync.quarantine} ${t('quarantine')}` : ''].filter(Boolean).join(' · ')), workspace.sync.pending ? h('button', { type: 'button', onClick: refresh }, t('retry')) : null)
}
function Filters({ state, dispatch, t }) {
  const set = name => event => dispatch({ type: 'filter', name, value: event.target.value })
  return h('div', { className: 'ya-filters', 'aria-label': 'audit filters' },
    h('label', { className: 'ya-search' }, h(IconSearchOutline16, { size: 16 }), h('span', { className: 'ya-sr' }, t('search')), h('input', { type: 'search', value: state.filters.query, placeholder: t('search'), onChange: set('query') })),
    h('select', { value: state.filters.pluginId, onChange: set('pluginId'), 'aria-label': t('allPlugins') }, h('option', { value: '' }, t('allPlugins')), h('option', { value: 'dsh-plugin-desktop/yootun-recruiter' }, '招聘'), h('option', { value: 'dsh-plugin-desktop/yootun-sales' }, '销售'), h('option', { value: 'dsh-plugin-desktop/yootun-supply-watch' }, '供应链'), h('option', { value: 'dsh-plugin-desktop/yootun-content-command' }, '内容运营')),
    h('select', { value: state.filters.actionCode, onChange: set('actionCode'), 'aria-label': t('allActions') }, h('option', { value: '' }, t('allActions')), h('option', { value: 'content.publish.executed' }, '内容发布'), h('option', { value: 'sales.follow_up.executed' }, '销售跟进'), h('option', { value: 'supply.review.executed' }, '风险复核'), h('option', { value: 'recruiter.boss_sync.executed' }, '招聘同步')),
    h('select', { value: state.filters.outcome, onChange: set('outcome'), 'aria-label': t('allResults') }, h('option', { value: '' }, t('allResults')), h('option', { value: 'succeeded' }, t('succeeded')), h('option', { value: 'partial' }, t('partial')), h('option', { value: 'failed' }, t('failed')), h('option', { value: 'accepted' }, t('accepted'))),
    h('select', { value: state.filters.timeRange, onChange: set('timeRange'), 'aria-label': t('allTime') }, h('option', { value: '' }, t('allTime')), h('option', { value: '24h' }, t('time24h')), h('option', { value: '7d' }, t('time7d')), h('option', { value: '30d' }, t('time30d')))
  )
}
function EventTable({ events, selectedId, dispatch, t }) {
  const onKeyDown = event => { const current = Math.max(0, events.findIndex(item => item.id === selectedId)); if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const delta = event.key === 'ArrowDown' ? 1 : -1; dispatch({ type: 'select', id: events[Math.max(0, Math.min(events.length - 1, current + delta))]?.id }) } else if (event.key === 'Enter') dispatch({ type: 'select', id: events[current]?.id }) }
  return h('div', { className: 'ya-table-wrap', tabIndex: 0, onKeyDown, role: 'grid', 'aria-label': t('title') }, h('div', { className: 'ya-table ya-table-head', role: 'row' }, h('span', null, t('time')), h('span', null, t('actor')), h('span', null, t('action')), h('span', null, t('target')), h('span', null, t('result'))), events.map(event => h('button', { type: 'button', role: 'row', key: event.id, className: `ya-table ya-row${selectedId === event.id ? ' is-selected' : ''}`, onClick: () => dispatch({ type: 'select', id: event.id }) }, h('span', null, formatTime(event.occurredAt)), h('span', { title: event.actorDisplayName }, event.actorDisplayName || '—'), h('span', { title: actionLabel(event.actionCode) }, actionLabel(event.actionCode)), h('span', { title: event.target?.label || event.target?.id }, event.target?.label || event.target?.id || '—'), h('span', null, h('b', { className: `ya-outcome is-${event.outcome}` }, outcomeLabel(event.outcome, t))))))
}
function Detail({ event, t, close }) {
  if (!event) return h('aside', { className: 'ya-detail is-empty' }, h('span', null, t('detail')))
  const pair = (label, value) => h('div', { className: 'ya-pair' }, h('dt', null, label), h('dd', null, value || '—'))
  return h('aside', { className: 'ya-detail', 'aria-label': t('detail') }, h('header', null, h('div', null, h('span', null, t('detail')), h('strong', null, actionLabel(event.actionCode))), h('button', { type: 'button', className: 'ya-detail-close', 'aria-label': t('closeDetail'), onClick: close }, h(IconCloseOutline16, { size: 16 }))), h('dl', null, pair(t('actor'), event.actorDisplayName), pair(t('target'), event.target?.label || event.target?.id), pair(t('occurredAt'), formatTime(event.occurredAt)), event.clockSkewed ? pair(t('receivedAt'), formatTime(event.receivedAt)) : null, pair(t('source'), event.source?.pluginId), pair(t('surface'), surfaceLabel(event.source?.surface)), pair(t('result'), outcomeLabel(event.outcome, t)), event.errorCode ? pair(t('errorCode'), event.errorCode) : null, pair(t('traceId'), event.traceId)), h('section', null, h('h3', null, t('changes')), event.changes?.length ? event.changes.map((change, index) => h('div', { className: 'ya-change', key: `${change.field}-${index}` }, h('code', null, change.field), h('span', null, `${change.before ?? '—'} → ${change.after ?? '—'}`))) : h('p', null, t('noChanges'))), event.effects?.length ? h('section', null, h('h3', null, t('effects')), event.effects.map((effect, index) => h('div', { className: 'ya-effect', key: `${effect.target}-${index}` }, h('span', null, effect.target), h('b', null, effectOutcomeLabel(effect.outcome)), effect.code ? h('code', null, effect.code) : null))) : null)
}
function Skeleton({ t }) { return h('div', { className: 'ya-skeletons', 'aria-busy': true, 'aria-label': t('loading') }, Array.from({ length: 7 }, (_, index) => h('div', { key: index }))) }
function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const shellRef = useRef(null)
  useEffect(() => { dispatch({ type: visible ? 'open' : 'close' }); if (visible) requestAnimationFrame(() => shellRef.current?.focus?.()) }, [visible])
  const workspace = state.workspace || EMPTY_WORKSPACE
  const waitingForTeam = state.scope === 'team' && workspace.scopes.isSuperAdmin && !state.teamId
  useEffect(() => { if (!state.visible || waitingForTeam) return undefined; const controller = new AbortController(); dispatch({ type: 'loading' }); const query = buildQuery({ scope: state.scope, teamId: state.teamId, ...state.filters }); void requestJson(query, controller.signal).then(value => dispatch({ type: 'loaded', value })).catch(error => { if (error?.name !== 'AbortError') dispatch({ type: 'error', error: error?.message }) }); return () => controller.abort() }, [state.visible, state.scope, state.teamId, state.filters, state.revision, waitingForTeam])
  useEffect(() => { if (!state.visible || state.scope !== 'team' || !workspace.scopes.isSuperAdmin) return undefined; const controller = new AbortController(); const query = new URLSearchParams({ view: 'teams', limit: '20' }); if (state.teamQuery.trim()) query.set('query', state.teamQuery.trim().slice(0, 200)); void requestJson(query.toString(), controller.signal).then(value => dispatch({ type: 'teams', value: value.teams })).catch(() => dispatch({ type: 'teams', value: [] })); return () => controller.abort() }, [state.visible, state.scope, state.teamQuery, workspace.scopes.isSuperAdmin])
  if (!state.visible) return null
  const selected = workspace.events.find(event => event.id === state.selectedId)
  const filtered = Object.values(state.filters).some(Boolean)
  const reload = async () => { try { await retrySync(); dispatch({ type: 'refresh' }) } catch (error) { dispatch({ type: 'error', error: error?.message }) } }
  const append = async () => { if (!workspace.page.nextCursor) return; dispatch({ type: 'loading', append: true }); try { const value = await requestJson(buildQuery({ scope: state.scope, teamId: state.teamId, ...state.filters }, workspace.page.nextCursor)); dispatch({ type: 'loaded', value, append: true }) } catch (error) { dispatch({ type: 'error', error: error?.message }) } }
  const key = event => { if (event.key === 'Escape') { if (state.selectedId) dispatch({ type: 'select', id: null }); else closeOverlay() } }
  const header = h('header', { className: 'ya-header' }, h('div', null, h('h1', { id: 'ya-title' }, t('title')), h('p', null, t('subtitle'))), h('div', { className: 'ya-header-status' }, h('span', null, workspace.freshness.source === 'cache' ? t('cached') : workspace.freshness.syncedAt ? `${t('stale')} ${formatTime(workspace.freshness.syncedAt)}` : ''), h(IconButton, { label: t('refresh'), onClick: () => dispatch({ type: 'refresh' }), icon: IconRefreshOutline16 }), h(IconButton, { label: t('close'), onClick: closeOverlay, icon: IconCloseOutline16 })))
  const scope = h('div', { className: 'ya-scope' }, h('div', { className: 'ya-segments', role: 'tablist' }, h('button', { type: 'button', role: 'tab', 'aria-selected': state.scope === 'self', onClick: () => dispatch({ type: 'scope', value: 'self' }) }, t('self')), workspace.scopes.available.includes('team') ? h('button', { type: 'button', role: 'tab', 'aria-selected': state.scope === 'team', onClick: () => dispatch({ type: 'scope', value: 'team' }) }, t('team')) : null), state.scope === 'team' && workspace.scopes.isSuperAdmin ? h('div', { className: 'ya-team' }, h('input', { value: state.teamQuery, placeholder: t('searchTeam'), onChange: event => dispatch({ type: 'teamQuery', value: event.target.value }) }), h('select', { value: state.teamId, 'aria-label': t('searchTeam'), onChange: event => dispatch({ type: 'team', value: event.target.value }) }, h('option', { value: '' }, t('chooseTeam')), state.teams.map(team => h('option', { key: team.id, value: team.id }, team.name)))) : workspace.scopes.currentTeam ? h('span', { className: 'ya-team-name' }, workspace.scopes.currentTeam.name) : null)
  let body
  if (state.loading && !state.workspace) body = h(Skeleton, { t })
  else {
    const empty = h('div', { className: 'ya-empty' }, h('span', null, filtered ? t('filteredEmpty') : t('empty')), filtered ? h('button', { type: 'button', onClick: () => dispatch({ type: 'clear' }) }, t('clear')) : null)
    const workspaceBody = waitingForTeam ? h('div', { className: 'ya-empty' }, t('chooseTeam')) : workspace.events.length
      ? h('div', { className: `ya-workspace${selected ? ' has-detail' : ''}` }, h('section', { className: 'ya-events' }, h(EventTable, { events: workspace.events, selectedId: state.selectedId, dispatch, t }), workspace.page.nextCursor ? h('button', { type: 'button', className: 'ya-more', disabled: state.appending, onClick: append }, state.appending ? t('loading') : t('loadMore'), h(IconChevronRightOutline14, { size: 14 })) : null), h(Detail, { event: selected, t, close: () => dispatch({ type: 'select', id: null }) }))
      : empty
    body = h(React.Fragment, null, h('div', { className: 'ya-summary' }, h(Metric, { label: t('today'), value: workspace.summary.today }), h(Metric, { label: t('failed'), value: workspace.summary.failed, tone: workspace.summary.failed ? 'failed' : '' }), h(Metric, { label: t('pendingSync'), value: workspace.summary.pendingSync, tone: workspace.summary.pendingSync ? 'pending' : '' })), h(StatusBanner, { workspace, error: state.error, t, refresh: reload }), h(Filters, { state, dispatch, t }), workspaceBody)
  }
  return h('div', { className: 'ya-overlay' }, h('main', { className: 'ya-shell', ref: shellRef, tabIndex: -1, onKeyDown: key, role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'ya-title' }, header, scope, body))
}
function Button({ wide, t }) { return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `ya-button${wide ? ' ya-wide' : ''}`, 'aria-label': t('open'), onClick: openOverlay }, h(IconChecklistOutline14, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }

const css = `.ya-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.ya-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.ya-button:hover,.ya-icon-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.ya-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.ya-wide span{font-size:13px}.ya-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);letter-spacing:0}.ya-shell{display:grid;grid-template-rows:auto auto auto auto auto minmax(0,1fr);width:100%;height:100%;overflow:hidden;outline:0}.ya-header{display:flex;min-height:72px;align-items:center;justify-content:space-between;gap:16px;padding:12px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ya-header h1{margin:0;font-size:20px;line-height:28px}.ya-header p{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.ya-header-status{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}.ya-icon-button{display:grid;width:36px;height:36px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.ya-scope{display:flex;min-height:48px;align-items:center;gap:16px;padding:6px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ya-segments{display:flex;padding:2px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}.ya-segments button{min-width:64px;height:30px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.ya-segments button[aria-selected=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.ya-team{display:flex;gap:8px}.ya-team input,.ya-team select,.ya-filters input,.ya-filters select{height:34px;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;padding:0 10px;font:inherit}.ya-team-name{font-size:13px}.ya-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid var(--dsw-alias-border-l1)}.ya-metric{display:grid;min-height:72px;align-content:center;gap:4px;padding:10px 24px;border-right:1px solid var(--dsw-alias-border-l1)}.ya-metric:last-child{border-right:0}.ya-metric span{color:var(--dsw-alias-label-secondary);font-size:12px}.ya-metric strong{font-size:22px;line-height:28px}.ya-metric.is-failed strong{color:var(--dsw-alias-state-error-primary)}.ya-metric.is-pending strong{color:var(--dsw-alias-state-warn-primary)}.ya-status{display:flex;min-height:38px;align-items:center;gap:8px;padding:6px 24px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:12px}.ya-status span{flex:1}.ya-status button,.ya-empty button,.ya-more{height:30px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;padding:0 10px;cursor:pointer}.ya-filters{display:grid;grid-template-columns:minmax(220px,1fr) repeat(4,minmax(120px,180px));gap:8px;padding:10px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ya-search{position:relative;display:flex;align-items:center}.ya-search svg{position:absolute;left:10px;color:var(--dsw-alias-label-secondary)}.ya-search input{width:100%;padding-left:34px}.ya-workspace{display:grid;grid-template-columns:minmax(0,1fr) 360px;min-height:0;overflow:hidden}.ya-workspace:not(.has-detail){grid-template-columns:minmax(0,1fr)}.ya-events{min-width:0;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1)}.ya-table-wrap{min-width:760px;outline:0}.ya-table{display:grid;grid-template-columns:132px minmax(110px,.8fr) minmax(180px,1.3fr) minmax(150px,1fr) 96px;align-items:center;gap:12px;min-height:44px;padding:0 16px}.ya-table-head{position:sticky;top:0;z-index:1;min-height:36px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12px}.ya-row{width:100%;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;text-align:left;cursor:pointer}.ya-row:hover,.ya-row.is-selected{background:var(--dsw-alias-bg-layer-2)}.ya-row>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.ya-outcome{display:inline-flex;align-items:center;min-height:22px;padding:0 7px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-size:12px;font-weight:500}.ya-outcome.is-failed{color:var(--dsw-alias-state-error-primary)}.ya-detail{min-width:0;overflow:auto;background:var(--dsw-alias-bg-layer-1)}.ya-detail>header{display:flex;min-height:58px;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ya-detail>header div{display:grid;gap:3px}.ya-detail>header span,.ya-detail dt{color:var(--dsw-alias-label-secondary);font-size:11px}.ya-detail>header strong{font-size:14px}.ya-detail-close{display:none;width:32px;height:32px;place-items:center;border:0;border-radius:6px;background:transparent;color:inherit}.ya-detail dl,.ya-detail section{margin:0;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ya-pair{display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;padding:5px 0}.ya-pair dd{margin:0;overflow-wrap:anywhere;font-size:12px}.ya-detail h3{margin:0 0 10px;font-size:12px}.ya-detail p{color:var(--dsw-alias-label-secondary);font-size:12px}.ya-change,.ya-effect{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:6px 0;font-size:12px}.ya-effect{grid-template-columns:minmax(0,1fr) auto}.ya-effect code{grid-column:1/-1;color:var(--dsw-alias-label-secondary)}.ya-more{display:flex;margin:12px auto;align-items:center;gap:5px}.ya-empty{display:grid;min-height:220px;place-content:center;justify-items:center;gap:12px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}.ya-skeletons{display:grid;gap:1px;padding:8px 24px}.ya-skeletons div{height:44px;background:var(--dsw-alias-bg-layer-2);animation:ya-pulse 1.4s ease-in-out infinite}@keyframes ya-pulse{50%{opacity:.55}}@media(max-width:1023px){.ya-workspace.has-detail{grid-template-columns:minmax(0,1fr) 320px}.ya-filters{grid-template-columns:minmax(220px,1fr) repeat(2,minmax(120px,1fr))}.ya-filters select:nth-last-child(-n+2){display:none}}@media(max-width:767px){.ya-header{padding:10px 16px}.ya-header p,.ya-header-status>span{display:none}.ya-scope,.ya-filters,.ya-status{padding-left:16px;padding-right:16px}.ya-scope{align-items:flex-start;flex-direction:column}.ya-team{width:100%}.ya-team input,.ya-team select{flex:1}.ya-summary{grid-template-columns:repeat(3,minmax(0,1fr))}.ya-metric{min-height:64px;padding:8px 12px}.ya-metric strong{font-size:18px}.ya-filters{grid-template-columns:minmax(0,1fr) 120px}.ya-filters select:nth-of-type(n+2){display:none}.ya-workspace{display:block;position:relative}.ya-events{height:100%;border-right:0}.ya-detail{position:absolute;inset:0;z-index:2}.ya-workspace:not(.has-detail) .ya-detail{display:none}.ya-detail-close{display:grid}.ya-table-wrap{min-width:0}.ya-table-head{display:none}.ya-table{grid-template-columns:76px minmax(0,1fr) 58px;gap:8px;padding:0 12px}.ya-table>span:nth-child(2),.ya-table>span:nth-child(4){display:none}}`
const layoutCss = `.ya-shell{display:flex;flex-direction:column;grid-template-rows:none}.ya-workspace,.ya-empty,.ya-skeletons{flex:1;min-height:0}.ya-workspace:not(.has-detail) .ya-detail{display:none}`
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-audit: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-yootun-audit: exclusive-overlay')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = OVERLAY_ID; style.textContent = `${css}${layoutCss}`; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-audit: styles')
  ctx.effect(() => { window.addEventListener('dofe:yootun-audit:open', openOverlay); return () => window.removeEventListener('dofe:yootun-audit:open', openOverlay) }, 'dofe-yootun-audit: open-event')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-audit', order: 50, inject: () => ({ t }) }, Button))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-audit', order: 50, inject: () => ({ t }) }, Overlay))
}

module.exports = { apply, inject: ['slots', 'locale'], __test: { normalizeWorkspace, buildQuery, mergePage, reducer, actionLabel, surfaceLabel, effectOutcomeLabel } }
