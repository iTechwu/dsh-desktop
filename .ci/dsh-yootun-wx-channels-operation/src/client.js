// 视频号工作台页面侧（视觉与交互基准：docs/1109/wx/ui-demo.html，§9.0）。
// 页面只访问本地同源路由 /api/desktop/yootun/wx-channels-operation（§4.1）：
// 不读取 MODELS_API_KEY、不直连公网 MCP、不接收 Cookie/内部地址/原始传输错误。
// 采集由宿主设备端执行；这里只做编排（登录/采集/批量）与展示。

const React = require('react')
const { createElement: h } = React
const { useState, useEffect, useMemo, useRef, useCallback } = React

import { filterWorksByRange, sortWorks } from './ui-format.js'
import { WorkDetailDialog, WorkSummaryCards, WorkTable, WorkToolbar } from './work-ui.js'
import { AccountList, AccountTab, LoginDialog } from './account-ui.js'

const ROUTE = '/api/desktop/yootun/wx-channels-operation'
const WORKS_PAGE_SIZE = 20
const POLL_INTERVAL_MS = 1200
// 页面端全部 action 都是宿主立即返回的快操作（长动作在宿主异步执行、页面轮询）。
const REQUEST_TIMEOUT_MS = 30000

const STYLES = `
:root {
  /* 主视觉继承宿主 DSW 主题变量（§9.0.6；客户端内宿主必提供，独立 Demo 兜底见 ui-demo.html）。 */
  --ywc-bg: var(--dsw-alias-bg-base);
  --ywc-surface: var(--dsw-alias-bg-layer-1);
  --ywc-surface-2: var(--dsw-alias-bg-layer-2);
  --ywc-text: var(--dsw-alias-label-primary);
  --ywc-muted: var(--dsw-alias-label-secondary);
  --ywc-border: var(--dsw-alias-border-l1);
  --ywc-brand: var(--dsw-alias-brand-primary);
  --ywc-brand-soft: color-mix(in srgb, var(--ywc-brand) 10%, transparent);
  --ywc-brand-line: color-mix(in srgb, var(--ywc-brand) 62%, white);
  --ywc-brand-border: color-mix(in srgb, var(--ywc-brand) 28%, transparent);
  --ywc-brand-text: var(--dsw-alias-label-primary-foreground);
  --ywc-danger: var(--dsw-alias-state-error-primary);
  --ywc-success: var(--dsw-alias-state-success-primary);
}
.ywc-root { height:100vh; color:var(--ywc-text); }
.ywc-shell { height:100vh; display:flex; flex-direction:column; overflow:hidden; }
.ywc-header{min-height:72px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:14px 24px; border-bottom:1px solid var(--ywc-border); background: color-mix(in srgb, var(--ywc-surface) 88%, transparent); backdrop-filter: blur(14px); box-shadow: 0 1px 24px color-mix(in srgb, var(--ywc-text) 7%, transparent); }
.ywc-title { display:flex; align-items:center; gap:12px; min-width:0; }
.ywc-mark{width:36px;height:36px; flex:0 0 auto; display:grid; place-items:center; border-radius:8px; background: color-mix(in srgb, var(--ywc-brand) 16%, transparent); color: var(--ywc-brand); font-weight:800; }
.ywc-title h1 { margin:0; font-size:20px; line-height:1.25; }
.ywc-title p { margin:3px 0 0; color:var(--ywc-muted); font-size:12px; }
.ywc-header-actions { display:flex; align-items:center; gap:8px; }
.ywc-tabs { display:flex; gap:4px; padding:0 24px; background: color-mix(in srgb, var(--ywc-surface) 86%, transparent); backdrop-filter: blur(12px); border-bottom:1px solid var(--ywc-border); overflow-x:auto; }
.ywc-tab { height:44px; padding:0 18px; border:0; border-bottom:3px solid transparent; background:transparent; color:var(--ywc-muted); font-weight:650; white-space:nowrap; }
.ywc-tab:hover { color: var(--ywc-text); }
.ywc-tab[aria-selected="true"] { color:var(--ywc-text); border-bottom-color: var(--ywc-brand-line); background: linear-gradient(180deg, transparent 68%, color-mix(in srgb, var(--ywc-brand) 9%, transparent)); }
.ywc-body { flex:1; min-height:0; display:grid; grid-template-columns:280px minmax(0,1fr); gap:16px; padding:16px 24px 24px;  overflow:hidden; }
.ywc-shell[data-tab="account"] .ywc-body { grid-template-columns: minmax(0,1fr); }
.ywc-shell[data-tab="account"] .ywc-accounts { display:none; }
.ywc-accounts { display:flex; flex-direction:column; gap:10px; min-width:0; }
.ywc-panel { border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 92%, transparent); backdrop-filter: blur(12px); box-shadow: 0 10px 34px color-mix(in srgb, var(--ywc-text) 6%, transparent); }
.ywc-side-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 12px 0; }
.ywc-side-head h2 { margin:0; font-size:14px; }
.ywc-account-list { display:flex; flex-direction:column; gap:8px; padding:10px 12px 12px; }
.ywc-card { border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 94%, transparent); text-align:left; padding:0; overflow:hidden; }
.ywc-card[aria-current="true"] { border-color: color-mix(in srgb, var(--ywc-brand) 60%, var(--ywc-border)); }
.ywc-card[aria-current="true"] .ywc-card-main { background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 8%, transparent), transparent 68%); }
.ywc-card-main { width:100%; display:grid; grid-template-columns:36px minmax(0,1fr); gap:10px; align-items:center; border:0; background:transparent; padding:10px; text-align:left; color:inherit; }
.ywc-card-main:hover { background: var(--ywc-surface-2); }
.ywc-avatar { width:36px; height:36px; display:grid; place-items:center; border-radius:50%; background: color-mix(in srgb, var(--ywc-brand) 18%, var(--ywc-surface-2)); color:var(--ywc-brand); font-weight:700; }
.ywc-card-name { display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; }
.ywc-card-meta { display:block; margin-top:2px; color:var(--ywc-muted); font-size:12px; }
.ywc-state { display:inline-flex; align-items:center; gap:5px; margin-top:5px; font-size:12px; color:var(--ywc-muted); }
.ywc-state::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
.ywc-state[data-state="ok"] { color:var(--ywc-success); }
.ywc-state[data-state="expired"] { color:var(--ywc-danger); }
.ywc-card-actions { display:flex; border-top:1px solid var(--ywc-border); background:var(--ywc-surface); }
.ywc-mini-button { flex:1; min-height:30px; border:0; background:transparent; color:var(--ywc-muted); font-size:12px; }
.ywc-mini-button:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
.ywc-mini-button.danger:hover { color:var(--ywc-danger); }
.ywc-button { min-height:34px; display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:0 12px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-text); white-space:nowrap; }
.ywc-button:hover { background:var(--ywc-surface-2); }
.ywc-button.primary { border-color: color-mix(in srgb, var(--ywc-brand) 72%, white); background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 88%, white), var(--ywc-brand)); color: var(--ywc-brand-text); font-weight:650; box-shadow: 0 6px 18px color-mix(in srgb, var(--ywc-brand) 20%, transparent); }
.ywc-button:disabled { opacity:.45; cursor:default; }
.ywc-primary { min-height:40px; padding:0 16px; border:0; border-radius:6px; background:var(--ywc-brand); color:var(--ywc-brand-text); font-weight:600; }
.ywc-primary:disabled { opacity:.45; cursor:default; }
.ywc-wide { width:100%; }
.ywc-batch-panel { display:grid; gap:4px; padding:10px 12px; border:1px solid var(--ywc-border); border-radius:8px; background:var(--ywc-surface-2); min-width:0; }
.ywc-batch-panel p { margin:0; font-size:12px; color:var(--ywc-text); }
.ywc-hint { margin:0; color:var(--ywc-muted); font-size:12px; line-height:1.5; }
.ywc-ok { margin:0; color:var(--ywc-success); font-size:12px; }
.ywc-error { margin:0; color:var(--ywc-danger); font-size:12px; }
.ywc-warn { margin:0; color:var(--ywc-muted); font-size:12px; }
/* 36px 图标按钮基线（契约审计 canonical icon 基线；弹层关闭/头部图标钮复用）。 */
.ywc-icon{width:36px;height:36px; display:grid; place-items:center; padding:0; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-muted); cursor:pointer; }
.ywc-icon:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
.ywc-right { min-width:0; min-height:0; display:flex; flex-direction:column; gap:12px; overflow:hidden; }
.ywc-right .ywc-work-panel { flex:1; min-height:0; display:flex; flex-direction:column; }
.ywc-right .ywc-work-panel .ywc-table-wrap { flex:1; }
.ywc-right .ywc-account-page { flex:1; min-height:0; overflow:auto; }
.ywc-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:12px; }
.ywc-toolbar-left, .ywc-toolbar-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ywc-field { display:inline-flex; align-items:center; gap:6px; color:var(--ywc-muted); font-size:12px; }
.ywc-input, .ywc-select { min-height:32px; padding:0 8px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-text); }
.ywc-summary-grid, .ywc-kpi-grid { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px; padding:12px; }
.ywc-kpi { min-height:78px; padding:10px; border:1px solid var(--ywc-border); border-radius:8px; position:relative; overflow:hidden; background: linear-gradient(160deg, color-mix(in srgb, var(--ywc-brand) 4%, var(--ywc-surface)), var(--ywc-surface) 62%); }
.ywc-kpi::after { content:""; position:absolute; inset:0 0 auto; height:2px; background: linear-gradient(90deg, transparent, var(--ywc-brand-line), transparent); opacity:.55; }
.ywc-kpi-label { color:var(--ywc-muted); font-size:12px; }
.ywc-kpi-value { margin-top:8px; font-size:20px; font-weight:750; font-variant-numeric: tabular-nums; letter-spacing:-.02em; }
.ywc-kpi-hint { margin-top:3px; color:var(--ywc-muted); font-size:11px; }
.ywc-table-wrap { overflow:auto; min-height:0; border-top:1px solid var(--ywc-border); }
.ywc-table-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-top:1px solid var(--ywc-border); color:var(--ywc-muted); font-size:12px; }
.ywc-table { min-width:1720px; width:100%; border-collapse:collapse; }
.ywc-table th, .ywc-table td { padding:10px; border-bottom:1px solid var(--ywc-border); text-align:left; white-space:nowrap; }
.ywc-table th { position:sticky; top:0; z-index:1; background: color-mix(in srgb, var(--ywc-brand) 5%, var(--ywc-surface-2)); color:var(--ywc-muted); font-size:12px; font-weight:650; }
.ywc-table tbody tr:hover { background: color-mix(in srgb, var(--ywc-brand) 6%, transparent); }
.ywc-work-cell { display:grid; grid-template-columns:54px minmax(220px,320px); gap:10px; align-items:center; }
.ywc-cover { position:relative; width:54px; height:72px; display:grid; place-items:center; border-radius:5px; overflow:hidden; background:var(--ywc-surface-2); color:var(--ywc-muted); font-size:11px; text-align:center; }
.ywc-cover span { position:absolute; right:3px; bottom:3px; padding:1px 4px; border-radius:3px; background:rgba(0,0,0,.65); color:#fff; }
.ywc-work-title { min-width:0; max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; }
.ywc-work-sub { margin-top:3px; color:var(--ywc-muted); font-size:11px; }
.ywc-link { border:0; background:transparent; color:var(--ywc-brand); font-weight:650; padding:0; }
.ywc-empty { color:var(--ywc-muted); }
.ywc-account-page { display:flex; flex-direction:column; gap:12px; }
.ywc-section-title { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 12px 0; }
.ywc-section-title h3 { margin:0; font-size:14px; }
.ywc-window-group { display:inline-flex; border:1px solid var(--ywc-border); border-radius:6px; overflow:hidden; }
.ywc-window-group button { min-height:30px; padding:0 10px; border:0; background:var(--ywc-surface); color:var(--ywc-muted); font-size:12px; }
.ywc-window-group button[aria-selected="true"] { background: color-mix(in srgb, var(--ywc-brand) 12%, var(--ywc-surface)); color:var(--ywc-brand); font-weight:700; box-shadow: inset 0 -2px 0 var(--ywc-brand-line); }
.ywc-two-column { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr); gap:12px; }
.ywc-chart-body { padding:12px; }
.ywc-chart-legend { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:8px; color:var(--ywc-muted); font-size:12px; }
.ywc-chart-legend i { display:inline-block; width:10px; height:3px; margin-right:5px; vertical-align:middle; background:var(--ywc-brand); }
.ywc-svg { display:block; width:100%; height:180px; }
.ywc-bars { display:grid; gap:8px; padding:12px; }
.ywc-bar-row { display:grid; grid-template-columns:84px minmax(0,1fr) 62px; gap:8px; align-items:center; font-size:12px; }
.ywc-bar-track { height:8px; border-radius:4px; background:var(--ywc-surface-2); overflow:hidden; }
.ywc-bar-fill { height:100%; border-radius:4px; background: linear-gradient(90deg, color-mix(in srgb, var(--ywc-brand) 62%, transparent), var(--ywc-brand-line)); box-shadow: 0 0 12px color-mix(in srgb, var(--ywc-brand) 18%, transparent); }
.ywc-bar-value { text-align:right; color:var(--ywc-muted); }
.ywc-profile-tabs { display:flex; gap:4px; padding:10px 12px 0; border-bottom:1px solid var(--ywc-border); overflow-x:auto; }
.ywc-profile-tabs button { border:0; border-bottom:2px solid transparent; padding:8px 9px; background:transparent; color:var(--ywc-muted); font-size:12px; white-space:nowrap; }
.ywc-profile-tabs button[aria-selected="true"] { border-bottom-color:var(--ywc-brand-line); color:var(--ywc-brand); font-weight:650; }
.ywc-modal { position:fixed; inset:0; z-index:20; display:none; place-items:center; padding:24px; background:rgba(31,35,41,.42); backdrop-filter:blur(8px); }
.ywc-modal.open { display:grid; }
.ywc-dialog { width:min(1080px,100%); max-height:calc(100vh - 48px); overflow:auto; border:1px solid var(--ywc-border); border-radius:8px; background:var(--ywc-surface); box-shadow:0 24px 72px rgba(0,0,0,.22); }
.ywc-dialog-header { position:sticky; top:0; z-index:2; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--ywc-border); background:var(--ywc-surface); }
.ywc-dialog-header h2, .ywc-dialog-header h3 { margin:0; }
.ywc-dialog-body { display:grid; gap:12px; padding:14px 16px 18px; }
.ywc-dialog-grid { display:grid; grid-template-columns:150px minmax(0,1fr); gap:14px; }
.ywc-detail-cover { width:150px; height:200px; display:grid; place-items:center; border-radius:7px; background:var(--ywc-surface-2); color:var(--ywc-muted); }
.ywc-metric-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
.ywc-detail-section { border-top:1px dashed var(--ywc-border); padding-top:10px; }
.ywc-detail-section h4 { margin:0 0 8px; font-size:13px; }
.ywc-close { width:32px; height:32px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-muted); }
.ywc-qr { width:210px; height:210px; margin:12px auto; display:grid; place-items:center; border:1px dashed var(--ywc-brand); border-radius:8px; color:var(--ywc-muted); text-align:center; }
.ywc-note { padding:0 16px 16px; color:var(--ywc-muted); font-size:12px; line-height:1.7; }
.ywc-badge { display:inline-flex; align-items:center; min-height:22px; padding:0 7px; border-radius:4px; background:var(--ywc-surface-2); color:var(--ywc-muted); font-size:12px; }
@media (max-width:1080px) { .ywc-body { grid-template-columns:1fr; } .ywc-summary-grid, .ywc-kpi-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .ywc-two-column { grid-template-columns:1fr; } .ywc-dialog-grid { grid-template-columns:1fr; } .ywc-detail-cover { width:100%; height:180px; } }
@media (max-width:680px) { .ywc-header, .ywc-body, .ywc-tabs { padding-left:12px; padding-right:12px; } .ywc-summary-grid, .ywc-kpi-grid, .ywc-metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .ywc-title p { display:none; } }
`

function useHost() {
  return useCallback(async (action, payload = {}) => {
    const response = await fetch(ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    if (!response.ok) throw new Error(`http_${response.status}`)
    const payloadJson = await response.json()
    if (payloadJson && payloadJson.status === 'error') {
      throw new Error(String(payloadJson.reason || 'request_failed'))
    }
    return payloadJson
  }, [])
}

/** 渲染工作台。`initial` 供静态渲染/截图/测试注入首屏真实数据
 * （renderToString 不执行 useEffect，宿主运行时不传 initial 走正常加载）。 */
export function renderWxWorkbench({ host, initial }) {
  return h(WxWorkbench, { host, initial })
}

function WxWorkbench({ host, initial = null }) {
  const post = host || useHost()
  const [browserReady, setBrowserReady] = useState({ chrome: true, driver: true })
  const [accounts, setAccounts] = useState((initial && initial.accounts) || [])
  const [selectedId, setSelectedId] = useState(
    (initial && initial.selectedId) ||
      ((initial && initial.accounts || []).find(item => item.deleteState !== 'remote_deleted') || {}).accountId ||
      null,
  )
  const [tab, setTab] = useState((initial && initial.tab) || 'work')
  const [works, setWorks] = useState((initial && initial.works) || [])
  const [overview, setOverview] = useState((initial && initial.overview) || null)
  // 摘要卡独立快照：固定 last_7d（§9.2 摘要卡口径不随账号 Tab 窗口切换变化）。
  const [summaryOverview, setSummaryOverview] = useState(
    initial && initial.summaryOverview !== undefined ? initial.summaryOverview : initial ? initial.overview : null,
  )
  const [profile, setProfile] = useState((initial && initial.profile) || null)
  const [profileKey, setProfileKey] = useState((initial && initial.profileKey) || 'gender')
  const [windowKey, setWindowKey] = useState((initial && initial.windowKey) || 'last_7d')
  const [range, setRange] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [sort, setSort] = useState('publish_time')
  const [order] = useState('desc')
  const [displayCount, setDisplayCount] = useState(WORKS_PAGE_SIZE)
  const [detail, setDetail] = useState((initial && initial.detail) || null)
  const [detailDaily, setDetailDaily] = useState((initial && initial.detailDaily) || [])
  const [login, setLogin] = useState(null)
  const [batch, setBatch] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [collectBusy, setCollectBusy] = useState(false)
  const loginRef = useRef(null)

  const selected = useMemo(
    () => accounts.find(account => account.accountId === selectedId) || null,
    [accounts, selectedId],
  )
  const visibleWorks = useMemo(() => sortWorks(works, sort, order), [works, sort, order])

  const noticeTimer = useRef(null)
  const notify = useCallback(message => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  const refreshAccounts = useCallback(async () => {
    const result = await post('accounts.list')
    const rows = Array.isArray(result.accounts) ? result.accounts : []
    setAccounts(rows)
    setSelectedId(current => {
      if (current && rows.some(item => item.accountId === current)) return current
      const firstUsable = rows.find(item => item.deleteState !== 'remote_deleted')
      return firstUsable ? firstUsable.accountId : null
    })
    return rows
  }, [post])

  const refreshWorks = useCallback(async (accountId, rangeOverride = null, from = null, to = null) => {
    if (!accountId) { setWorks([]); return }
    const activeRange = rangeOverride || range
    const extra = activeRange === 'custom' && from && to
      ? { publishedFrom: from, publishedTo: to }
      : {}
    try {
      const result = await post('works.list', { accountId, ...extra })
      setWorks(Array.isArray(result.works) ? result.works : [])
    } catch (error) {
      setWorks([])
      notify(`作品列表加载失败：${error.message}`)
    }
  }, [post, notify, range])

  const refreshOverview = useCallback(async (accountId, window) => {
    if (!accountId) { setOverview(null); setSummaryOverview(null); setProfile(null); return }
    // 摘要卡固定 last_7d 拉取（与账号 Tab 窗口互不影响，review P0-3）。
    try {
      const summary = await post('account.overview', { accountId, window: 'last_7d' })
      setSummaryOverview(summary)
    } catch {
      setSummaryOverview(null)
    }
    if (window === 'last_7d') {
      setOverview(summary)
    } else {
      try {
        const result = await post('account.overview', { accountId, window })
        setOverview(result)
      } catch {
        setOverview(null)
      }
    }
    try {
      const profileResult = await post('fans.profile.get', { accountId })
      setProfile(profileResult.fans_profile)
    } catch {
      setProfile(null)
    }
  }, [post])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await post('browser.status')
        if (!cancelled) setBrowserReady({ chrome: status.chromeAvailable, driver: status.driverAvailable })
      } catch { /* 浏览器自检失败不阻断首屏 */ }
      if (!cancelled) await refreshAccounts()
    })()
    return () => { cancelled = true }
  }, [post, refreshAccounts])

  // 切换账号 / 排序窗口变化 → 刷新作品与账号数据（排序筛选只查库，不触发采集）。
  useEffect(() => {
    if (selectedId) {
      void refreshWorks(selectedId)
      void refreshOverview(selectedId, windowKey)
    } else {
      setWorks([])
      setOverview(null)
      setSummaryOverview(null)
      setProfile(null)
    }
    setDisplayCount(WORKS_PAGE_SIZE)
  }, [selectedId, windowKey, refreshWorks, refreshOverview])

  // 批量进度轮询。
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const status = await post('collectAll.status')
        if (status && status.phase && status.phase !== 'ready') setBatch(status)
      } catch { /* 轮询失败静默保留旧状态 */ }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [post])

  const beginLogin = useCallback(() => {
    void (async () => {
      const result = await post('account.beginLogin', {})
      loginRef.current = result.loginKey
      setLogin({ loginKey: result.loginKey, state: result.state })
      pollLogin(result.loginKey)
    })().catch(error => notify(`登录发起失败：${error.message}`))
  }, [post, notify])

  const loginTimerRef = useRef(null)
  const stopLoginPolling = useCallback(() => {
    if (loginTimerRef.current) clearInterval(loginTimerRef.current)
    loginTimerRef.current = null
  }, [])
  const collectTimerRef = useRef(null)
  const stopCollectPolling = useCallback(() => {
    if (collectTimerRef.current) clearInterval(collectTimerRef.current)
    collectTimerRef.current = null
  }, [])
  // 插件卸载时清空全部轮询（review P1-4）。
  useEffect(() => () => {
    stopLoginPolling()
    stopCollectPolling()
  }, [stopLoginPolling, stopCollectPolling])
  const pollLogin = useCallback(loginKey => {
    stopLoginPolling()
    loginTimerRef.current = setInterval(async () => {
      try {
        const status = await post('account.loginStatus', { accountId: loginKey })
        if (status.state === 'ok') {
          stopLoginPolling()
          setLogin({ loginKey, state: 'ok' })
          await refreshAccounts()
          setTimeout(() => setLogin(null), 1200)
        } else if (status.state === 'idle') {
          stopLoginPolling()
          setLogin(null)
        } else {
          setLogin({ loginKey, state: status.state, reason: status.reason })
        }
      } catch { /* 轮询失败下轮重试 */ }
    }, POLL_INTERVAL_MS)
  }, [post, refreshAccounts, stopLoginPolling])

  const refreshQr = useCallback(() => {
    const loginKey = loginRef.current
    if (!loginKey) return
    void post('account.refreshLoginQr', { accountId: loginKey })
      .then(status => setLogin({ loginKey, state: status.state }))
      .catch(error => notify(`刷新失败：${error.message}`))
  }, [post, notify])

  const probeAccount = useCallback(accountId => {
    void (async () => {
      const result = await post('account.probe', { accountId })
      notify(result.sessionStatus === 'ok' ? '会话有效' : result.sessionStatus === 'expired' ? '会话已过期，请重新扫码' : '会话状态未知')
      await refreshAccounts()
    })().catch(error => notify(`检测失败：${error.message}`))
  }, [post, notify, refreshAccounts])

  const removeAccount = useCallback(accountId => {
    // 删除流程（§16.2）：应用内二次确认 → 先本地清理 → 再远端删除 → 刷新列表。
    setConfirm({
      title: '删除账号',
      message: '删除该账号将清理本机登录态并删除远端业务数据（保留审计账本），确定？',
      onConfirm: () => {
        void (async () => {
          const local = await post('account.removeLocal', { accountId })
          if (!local.cleared || !(local.cleared.profile && local.cleared.storageState)) {
            throw new Error('LOCAL_CLEARED_REQUIRED')
          }
          await post('account.removeRemote', { accountId })
          notify('账号已删除（远端保留审计墓碑）')
          await refreshAccounts()
        })().catch(error => notify(`删除失败：${error.message}`))
      },
    })
  }, [post, notify, refreshAccounts])

  const confirmRemoval = accountId => {
    // 保留原实现体为内部函数（被 confirm 弹层 onConfirm 引用）。
  }



  const collectAccount = useCallback(accountId => {
    void (async () => {
      const result = await post('collect.start', { accountId, newAttempt: true })
      if (!result.started) {
        notify(`采集未启动：${reasonText(result.reason)}`)
        return
      }
      setCollectBusy(true)
      notify('采集已启动，完成后刷新查看数据')
      // 单账号采集无独立进度端点：轮询 collect.status 直到空闲（ref 持表，卸载清理）。
      collectTimerRef.current = setInterval(async () => {
        try {
          const status = await post('collect.status')
          if (!status.busy) {
            stopCollectPolling()
            setCollectBusy(false)
            await refreshWorks(accountId)
            await refreshOverview(accountId, windowKey)
            await refreshAccounts()
            notify('采集结束')
          }
        } catch { /* 轮询失败下轮重试 */ }
      }, POLL_INTERVAL_MS)
    })().catch(error => {
      stopCollectPolling()
      setCollectBusy(false)
      notify(`采集失败：${error.message}`)
    })
  }, [post, notify, refreshWorks, refreshOverview, refreshAccounts, windowKey, stopCollectPolling])

  const collectAll = useCallback(() => {
    void (async () => {
      const result = await post('collectAll.start', {})
      if (!result.started) {
        notify(`批量采集未启动：${reasonText(result.reason)}`)
        return
      }
      notify(`批量采集已启动（${result.accounts} 个账号，串行执行）`)
    })().catch(error => notify(`批量采集失败：${error.message}`))
  }, [post, notify])

  // 弹层可关闭性（契约审计）：任一弹层打开时监听 Escape 关闭；关闭后用
  // requestAnimationFrame 恢复触发元素焦点。
  const lastTriggerRef = useRef(null)
  const overlayOpen = Boolean(detail || confirm || login)
  useEffect(() => {
    if (!overlayOpen) return
    if (typeof document !== 'undefined') lastTriggerRef.current = document.activeElement
    const onKey = event => {
      if (event.key === 'Escape') {
        if (detail) {
          setDetail(null)
          setDetailDaily([])
        } else if (confirm) {
          setConfirm(null)
        } else if (login) {
          stopLoginPolling()
          loginRef.current = null
          setLogin(null)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const lastTrigger = lastTriggerRef.current
      requestAnimationFrame(() => lastTrigger?.focus())
    }
  }, [overlayOpen, detail, confirm, login, stopLoginPolling])

  // 批量结束后刷新当前账号数据。
  useEffect(() => {
    if (batch && batch.phase === 'finished' && selectedId) {
      void refreshWorks(selectedId)
      void refreshOverview(selectedId, windowKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch && batch.phase])

  const openDetail = useCallback(work => {
    setDetail(work)
    setDetailDaily([])
    void (async () => {
      try {
        const result = await post('work.get', { accountId: work.account_id || selectedId, workId: work.work_id })
        setDetail(result.work || work)
        setDetailDaily(Array.isArray(result.daily_metrics) ? result.daily_metrics : [])
      } catch { /* 详情查询失败保留行内数据展示 */ }
    })()
  }, [post, selectedId])

  const browserBlocked = !browserReady.chrome || !browserReady.driver

  return h('div', { className: 'ywc-root' },
    h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
    h('div', { className: 'ywc-shell', 'data-tab': tab },
      h('header', { className: 'ywc-header' },
        h('div', { className: 'ywc-title' },
          h('div', { className: 'ywc-mark', 'aria-hidden': 'true' }, '视'),
          h('div', null,
            h('h1', null, '视频号工作台'),
            h('p', null, '扫码登录视频号助手，采集账号全部作品、账号数据与关注者数据'),
          ),
        ),
        h('div', { className: 'ywc-header-actions' }),
      ),
      notice ? h('div', { className: 'ywc-badge', role: 'status', 'aria-live': 'polite', style: { margin: '10px 24px 0' } }, notice) : null,
      h('nav', { className: 'ywc-tabs', 'aria-label': '工作台模块' },
        h('button', { className: 'ywc-tab', type: 'button', 'aria-selected': tab === 'work' ? 'true' : 'false', onClick: () => setTab('work') }, '作品数据'),
        h('button', { className: 'ywc-tab', type: 'button', 'aria-selected': tab === 'account' ? 'true' : 'false', onClick: () => setTab('account') }, '账号数据'),
      ),
      h('div', { className: 'ywc-body' },
        h('aside', { className: 'ywc-accounts', 'aria-label': '账号管理' },
          h(AccountList, {
            accounts, selectedId, busy: collectBusy,
            browserBlocked,
            batch,
            onSelect: accountId => { setSelectedId(accountId); setDisplayCount(WORKS_PAGE_SIZE) },
            onProbe: probeAccount,
            onRemove: removeAccount,
            onBeginLogin: beginLogin,
            onCollectAll: collectAll,
          }),
          browserBlocked
            ? h('p', { className: 'ywc-empty', style: { padding: '0 2px' } },
              `需要系统 Google Chrome${browserReady.chrome ? ' 与 Playwright 驱动' : ''}（当前缺失），采集功能不可用`)
            : null,
        ),
        h('main', { className: 'ywc-right' },
          tab === 'work'
            ? h('section', { className: 'ywc-panel' },
              h(WorkToolbar, {
                onCollect: () => selectedId && collectAccount(selectedId),
                onRefresh: () => selectedId && (refreshWorks(selectedId), refreshOverview(selectedId, windowKey)),
                range, onRange: value => {
                  setRange(value)
                  setDisplayCount(WORKS_PAGE_SIZE)
                  // 自定义范围由服务端 publishedFrom/To 过滤（§7.3）；切换非 custom 即重查全量。
                  if (value !== 'custom' && selectedId) void refreshWorks(selectedId, value)
                },
                customFrom, customTo,
                onCustomRange: (from, to) => {
                  setCustomFrom(from)
                  setCustomTo(to)
                  setDisplayCount(WORKS_PAGE_SIZE)
                  if (from && to && selectedId) void refreshWorks(selectedId, 'custom', from, to)
                },
                sort, onSort: value => { setSort(value); setDisplayCount(WORKS_PAGE_SIZE) },
                disabled: !selectedId || collectBusy,
              }),
              h(WorkSummaryCards, { works, summaryOverview, account: selected }),
              h(WorkTable, {
                rows: range === "custom" ? visibleWorks : filterWorksByRange(visibleWorks, range),
                displayCount,
                total: (range === "custom" ? visibleWorks : filterWorksByRange(visibleWorks, range)).length,
                onLoadMore: () => setDisplayCount(count => count + WORKS_PAGE_SIZE),
                onOpenDetail: openDetail,
              }),
            )
            : h(AccountTab, {
              window: windowKey, onWindow: setWindowKey,
              overview, profile, profileKey, onProfileKey: setProfileKey,
              accounts, selectedId,
              onSelectAccount: accountId => { setSelectedId(accountId); setDisplayCount(WORKS_PAGE_SIZE) },
            }),
        ),
      ),
    ),
    h(WorkDetailDialog, {
      work: detail, detail: detail ? {
        traffic_source: detail.traffic_source,
        retention_trend: detail.retention_trend,
      } : null,
      dailyMetrics: detailDaily,
      onClose: () => { setDetail(null); setDetailDaily([]) },
    }),
    confirm ? h('div', { className: 'ywc-modal open', role: 'dialog', 'aria-modal': 'true', onClick: event => { if (event.target === event.currentTarget) setConfirm(null) } },
      h('div', { className: 'ywc-dialog', style: { width: 'min(430px,100%)' } },
        h('header', { className: 'ywc-dialog-header' },
          h('h2', null, confirm.title),
          h('button', { className: 'ywc-close', type: 'button', 'aria-label': '关闭确认弹层', onClick: () => setConfirm(null) }, '×'),
        ),
        h('div', { className: 'ywc-dialog-body' },
          h('p', { className: 'ywc-card-meta' }, confirm.message),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h('button', { className: 'ywc-button', type: 'button', onClick: () => setConfirm(null) }, '取消'),
            h('button', {
              className: 'ywc-button primary', type: 'button',
              onClick: () => { setConfirm(null); confirm.onConfirm() },
            }, '确认删除'),
          ),
        ),
      ),
    ) : null,
    login ? h(LoginDialog, { login, onRefreshQr: refreshQr, onClose: () => {
      stopLoginPolling()
      loginRef.current = null
      setLogin(null)
    } }) : null,
  )
}

function reasonText(reason) {
  const map = {
    session_required: '会话失效',
    probe_failed: '探测失败',
    storage_state_missing: '缺登录态',
    pending_account: '待升级账号',
    collect_busy: '采集互斥',
    session_expired: '会话失效',
  }
  return map[reason] || reason || '未知'
}
