window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-recruiter",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react')
    const { createElement: h, useEffect, useState, useSyncExternalStore } = React
    const { IconFolderOpenOutline16, IconCheckOutline16, IconCloseOutline16, IconLinkOutline16, IconRefreshOutline16, IconUserOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dofe.yootun-recruiter'
    const PATH = '/api/desktop/yootun/recruiter'
    const copy = {
      zh: {
        open: '招聘工作台', title: '招聘工作台', subtitle: '岗位、候选人和待确认动作', close: '关闭工作台', refresh: '刷新',
        overview: '总览', roles: '岗位需求', candidates: '候选人', actions: '待确认', boss: 'BOSS 连接', loadError: '招聘工作台加载失败',
        openRoles: '在招岗位', activeCandidates: '活跃候选人', pendingReplies: '待回复', pendingFeedback: '待反馈',
        pendingConfirmation: '待人工确认', noData: '还没有招聘数据', addRole: '在对话中创建岗位需求',
        loginTitle: '使用官方页面扫码登录', loginBody: '二维码和账号会话由 BOSS 直聘页面处理，Yootun-Agent 不读取或保存它们。', openBoss: '打开 BOSS 直聘',
        loginRequired: '需要用户扫码登录', adapterPending: '适配器未配置', adapterBody: '批准后的动作会停留在“已确认，等待适配器”，不会伪装为已发送。',
        emptyActions: '暂无待确认动作', approve: '确认动作', dismiss: '撤销', target: '目标', actionSummary: '摘要', status: '状态',
        waiting: '等待确认', confirmed: '已确认，等待适配器', succeeded: '适配器已完成', failed: '适配器失败', requiresLogin: '需要重新登录', dismissed: '已撤销', saveHint: '岗位与候选人分析通过 Agent 对话接口保存。',
        stage: '阶段', evidence: '岗位相关证据', concerns: '待核实问题', interview: '面试问题', score: '匹配度',
      },
      en: {
        open: 'Recruiting workspace', title: 'Recruiting workspace', subtitle: 'Roles, candidates, and approvals', close: 'Close workspace', refresh: 'Refresh',
        overview: 'Overview', roles: 'Role requirements', candidates: 'Candidates', actions: 'Approvals', boss: 'BOSS connection', loadError: 'Could not load recruiting workspace',
        openRoles: 'Open roles', activeCandidates: 'Active candidates', pendingReplies: 'Pending replies', pendingFeedback: 'Pending feedback',
        pendingConfirmation: 'Awaiting approval', noData: 'No recruiting data yet', addRole: 'Create a role requirement in chat',
        loginTitle: 'Scan on the official login page', loginBody: 'BOSS handles the QR code and account session. Yootun-Agent does not read or store them.', openBoss: 'Open BOSS Zhipin',
        loginRequired: 'User QR login required', adapterPending: 'Adapter not configured', adapterBody: 'Approved actions remain pending until a reviewed adapter executes them.',
        emptyActions: 'No actions awaiting approval', approve: 'Approve action', dismiss: 'Dismiss', target: 'Target', actionSummary: 'Summary', status: 'Status',
        waiting: 'Awaiting approval', confirmed: 'Approved, adapter pending', succeeded: 'Adapter completed', failed: 'Adapter failed', requiresLogin: 'Login required', dismissed: 'Dismissed', saveHint: 'Save roles and candidate analysis through the Agent conversation interface.',
        stage: 'Stage', evidence: 'Role-related evidence', concerns: 'Open questions', interview: 'Interview questions', score: 'Match score',
      },
    }
    let opened = false
    const listeners = new Set()
    const emit = () => listeners.forEach(listener => listener())
    const setOpened = value => { opened = value; emit() }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    const snapshot = () => opened

    async function load(signal) {
      const response = await fetch(PATH, { credentials: 'same-origin', signal, headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('recruiter request failed')
      return response.json()
    }
    async function mutate(body) {
      const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('recruiter mutation failed')
      return response.json()
    }
    function statusText(status, t) { return status === 'awaiting_confirmation' ? t('waiting') : status === 'confirmed_pending_adapter' ? t('confirmed') : status === 'succeeded' ? t('succeeded') : status === 'failed' ? t('failed') : status === 'requires_user_login' ? t('requiresLogin') : t('dismissed') }
    function Metric({ label, value }) { return h('div', { className: 'yr-metric' }, h('span', null, label), h('strong', null, String(value ?? 0))) }
    function Status({ status, t }) { return h('span', { className: `yr-status yr-status-${status}` }, h('span', { 'aria-hidden': true }), statusText(status, t)) }

    function Overview({ data, t }) {
      const d = data.dashboard || {}
      return h('div', { className: 'yr-page' },
        h('div', { className: 'yr-metrics' }, h(Metric, { label: t('openRoles'), value: d.openRoles }), h(Metric, { label: t('activeCandidates'), value: d.activeCandidates }), h(Metric, { label: t('pendingReplies'), value: d.pendingReplies }), h(Metric, { label: t('pendingFeedback'), value: d.pendingFeedback })),
        h('section', { className: 'yr-section' }, h('div', { className: 'yr-heading' }, h('h2', null, t('pendingConfirmation')), h('strong', { className: 'yr-count' }, String(d.pendingConfirmation || 0))),
          (data.actions || []).filter(item => item.status === 'awaiting_confirmation').slice(0, 8).map(item => h(ActionRow, { key: item.id, item, t }))),
        h('p', { className: 'yr-note' }, t('saveHint')))
    }
    function Roles({ data, t }) { return h('div', { className: 'yr-page' }, h('div', { className: 'yr-heading' }, h('h2', null, t('roles')), h('span', { className: 'yr-muted' }, `${(data.requirements || []).length}`)), (data.requirements || []).length ? data.requirements.map(role => h('article', { className: 'yr-card', key: role.id }, h('div', { className: 'yr-card-head' }, h('strong', null, role.title), h('span', null, role.status)), h('span', null, `${role.department} · ${role.location} · ${role.headcount}`), h('p', null, (role.requiredSkills || []).join(' · ')))) : h('div', { className: 'yr-empty' }, t('noData'), h('span', null, t('addRole')))) }
    function Candidates({ data, t }) { return h('div', { className: 'yr-page' }, h('div', { className: 'yr-heading' }, h('h2', null, t('candidates')), h('span', { className: 'yr-muted' }, `${(data.candidates || []).length}`)), (data.candidates || []).length ? data.candidates.map(candidate => h('article', { className: 'yr-card', key: candidate.id }, h('div', { className: 'yr-card-head' }, h('strong', null, candidate.displayName), h('span', null, `${t('stage')}: ${candidate.stage}`)), candidate.matchScore === undefined ? null : h('div', { className: 'yr-score' }, `${t('score')} ${candidate.matchScore}`), h('p', null, `${t('evidence')}: ${(candidate.evidence || []).join(' · ')}`), h('p', { className: 'yr-muted' }, `${t('concerns')}: ${(candidate.concerns || []).join(' · ')}`))) : h('div', { className: 'yr-empty' }, t('noData')))
    }
    function ActionRow({ item, t, onUpdate }) { return h('article', { className: 'yr-action' }, h('div', { className: 'yr-action-main' }, h('strong', null, item.targetLabel), h('span', null, item.summary), h(Status, { status: item.status, t })), item.status === 'awaiting_confirmation' ? h('div', { className: 'yr-action-buttons' }, h('button', { type: 'button', onClick: () => onUpdate?.({ action: 'confirm_action', id: item.id }) }, h(IconCheckOutline16, { size: 14 }), t('approve')), h('button', { type: 'button', onClick: () => onUpdate?.({ action: 'dismiss_action', id: item.id }) }, h(IconCloseOutline16, { size: 14 }), t('dismiss'))) : null) }
    function Actions({ data, t, onUpdate }) { return h('div', { className: 'yr-page' }, h('div', { className: 'yr-heading' }, h('h2', null, t('actions')), h('span', { className: 'yr-muted' }, `${(data.actions || []).length}`)), (data.actions || []).length ? data.actions.map(item => h(ActionRow, { key: item.id, item, t, onUpdate })) : h('div', { className: 'yr-empty' }, t('emptyActions')))
    }
    function Boss({ data, t }) { return h('div', { className: 'yr-page yr-boss', 'data-boss-status': data.boss?.status || 'requires_user_login', 'data-boss-adapter': data.boss?.adapter || 'not_configured' }, h('div', { className: 'yr-boss-icon' }, h(IconUserOutline16, { size: 20 })), h('h2', null, t('loginTitle')), h('p', null, t('loginBody')), h('a', { className: 'yr-primary', href: data.boss?.loginUrl || 'https://www.zhipin.com/web/user/?ka=header-login', target: '_blank', rel: 'noreferrer' }, h(IconLinkOutline16, { size: 14 }), t('openBoss')), h('div', { className: 'yr-boss-status' }, h('strong', null, t('loginRequired')), h('span', null, `${t('adapterPending')}: ${t('adapterBody')}`))) }
    function Overlay({ t }) {
      const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
      const [tab, setTab] = useState('overview'); const [data, setData] = useState(null); const [error, setError] = useState(false); const [revision, setRevision] = useState(0)
      useEffect(() => { if (!visible) return undefined; const controller = new AbortController(); setError(false); void load(controller.signal).then(setData).catch(e => { if (e?.name !== 'AbortError') setError(true) }); return () => controller.abort() }, [visible, revision])
      useEffect(() => { if (!visible) return undefined; const key = e => { if (e.key === 'Escape') setOpened(false) }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [visible])
      if (!visible) return null
      const tData = data || { dashboard: {}, requirements: [], candidates: [], actions: [], boss: {} }
      const update = async body => { try { setData(await mutate(body)) } catch { setError(true) } }
      const body = error && !data ? h('div', { className: 'yr-empty', role: 'alert' }, t('loadError'), h('button', { type: 'button', onClick: () => setRevision(x => x + 1) }, h(IconRefreshOutline16, { size: 14 }), t('refresh'))) : tab === 'overview' ? h(Overview, { data: tData, t }) : tab === 'roles' ? h(Roles, { data: tData, t }) : tab === 'candidates' ? h(Candidates, { data: tData, t }) : tab === 'actions' ? h(Actions, { data: tData, t, onUpdate: update }) : h(Boss, { data: tData, t })
      return h('div', { className: 'yr-overlay' }, h('main', { className: 'yr-shell', 'aria-labelledby': 'yr-title' }, h('header', { className: 'yr-header' }, h('div', null, h('h1', { id: 'yr-title' }, t('title')), h('p', null, t('subtitle'))), h('div', { className: 'yr-header-buttons' }, h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', className: 'yr-icon', 'aria-label': t('refresh'), onClick: () => setRevision(x => x + 1) }, h(IconRefreshOutline16, { size: 16 }))), h(Tooltip, { label: t('close') }, h('button', { type: 'button', className: 'yr-icon', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))))), h('nav', { className: 'yr-tabs', 'aria-label': t('title') }, [['overview', t('overview')], ['roles', t('roles')], ['candidates', t('candidates')], ['actions', t('actions')], ['boss', t('boss')]].map(([id, label]) => h('button', { type: 'button', key: id, 'data-active': tab === id, onClick: () => setTab(id) }, label))), h('div', { className: 'yr-content' }, body)))
    }
    function SidebarButton({ wide, t }) { return h(Tooltip, { label: t('open'), delayMs: 500, disabled: wide }, h('button', { type: 'button', className: `yr-sidebar-button${wide ? ' yr-sidebar-wide' : ''}`, 'aria-label': t('open'), onClick: () => setOpened(true) }, h(IconFolderOpenOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }
    const css = `.yr-sidebar-button{box-sizing:border-box;display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.yr-sidebar-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yr-sidebar-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yr-sidebar-wide span{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yr-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yr-shell{display:grid;grid-template-rows:auto auto 1fr;width:100%;height:100%;overflow:hidden}.yr-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yr-header h1{margin:0;font-size:20px;letter-spacing:0}.yr-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yr-header-buttons{display:flex;gap:6px}.yr-icon{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yr-tabs{display:flex;gap:2px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto}.yr-tabs button{height:42px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}.yr-tabs button[data-active=true]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yr-content{overflow:auto;padding:22px 24px 40px}.yr-page{display:grid;gap:24px;max-width:1120px;margin:0 auto}.yr-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}.yr-metric{display:grid;min-height:82px;align-content:center;gap:6px;padding:12px 16px;border-right:1px solid var(--dsw-alias-border-l1)}.yr-metric:last-child{border-right:0}.yr-metric span,.yr-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.yr-metric strong{font-size:24px;font-variant-numeric:tabular-nums}.yr-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.yr-heading h2,.yr-section h2{margin:0;font-size:14px;letter-spacing:0}.yr-count{font-size:18px}.yr-section{display:grid;gap:10px}.yr-card,.yr-action{display:grid;gap:8px;padding:14px 16px;border-top:1px solid var(--dsw-alias-border-l1)}.yr-card-head,.yr-action{display:flex;align-items:center;justify-content:space-between;gap:14px}.yr-card p,.yr-action span,.yr-boss p,.yr-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.yr-score{font-weight:650;color:var(--dsw-alias-brand-primary)}.yr-action-main{display:grid;gap:4px;min-width:0}.yr-action-main strong,.yr-action-main span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yr-action-buttons{display:flex;gap:6px;flex:none}.yr-action-buttons button,.yr-empty button{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.yr-status{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:11px}.yr-status>span{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.yr-status-awaiting_confirmation>span{background:var(--dsw-alias-state-warning-primary)}.yr-status-confirmed_pending_adapter>span{background:var(--dsw-alias-state-success-primary)}.yr-empty{display:grid;min-height:180px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}.yr-empty span{font-size:12px}.yr-note{padding-top:4px}.yr-boss{max-width:560px;justify-items:start}.yr-boss-icon{display:grid;width:44px;height:44px;place-items:center;border-radius:50%;background:var(--dsw-alias-bg-layer-2)}.yr-boss h2{margin:0;font-size:18px}.yr-boss p{font-size:13px;line-height:1.6}.yr-primary{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 13px;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse);font:inherit;text-decoration:none}.yr-boss-status{display:grid;gap:5px;width:100%;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px}.yr-boss-status span{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}@media(max-width:800px){.yr-header,.yr-tabs{padding-left:16px;padding-right:16px}.yr-content{padding:18px 16px 32px}.yr-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yr-metric:nth-child(2){border-right:0}.yr-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.yr-card-head,.yr-action{align-items:flex-start;flex-direction:column}.yr-action-buttons{width:100%}.yr-action-buttons button{flex:1;justify-content:center}}@media(max-width:480px){.yr-header h1{font-size:17px}.yr-header p{display:none}.yr-metric{min-height:72px;padding:10px}.yr-metric strong{font-size:20px}}`
    const themeFallbackCss = `.yr-primary{color:var(--dsw-alias-label-inverse,#fff)}.yr-status-succeeded{color:var(--dsw-alias-state-success-primary)}.yr-status-failed,.yr-status-requires_user_login{color:var(--dsw-alias-state-error-primary)}.yr-status-dismissed{color:var(--dsw-alias-label-tertiary)}`
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-recruiter: dictionaries')
      ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-recruiter'; style.textContent = css + themeFallbackCss; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-recruiter: styles')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-recruiter', order: 20, inject: () => ({ t }) }, SidebarButton))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-recruiter', order: 20, inject: () => ({ t }) }, Overlay))
    }
    exports.apply = apply
    exports.inject = ['slots', 'locale']

    return module.exports;
  },
});
