window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-sales",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react')
    const { createElement: h, useEffect, useState, useSyncExternalStore } = React
    const { IconCheckOutline16, IconCloseOutline16, IconDataOutline16, IconRefreshOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dofe.yootun-sales'
    const PATH = '/api/desktop/yootun/sales'
    const copy = {
      zh: { open: '销售协同', title: '销售协同', subtitle: '公开意向发现、线索跟进与确认动作', close: '关闭销售协同', refresh: '刷新', loading: '正在读取销售工作区…', retry: '重新加载', leads: '线索', qualified: '合格线索', dueToday: '今日待跟进', pending: '待确认', empty: '还没有销售线索', actions: '跟进动作', approve: '确认', dismiss: '撤销', adapter: '已确认，等待适配器', succeeded: '适配器已完成', failed: '适配器执行失败', requiresLogin: '需要重新登录', source: '来源', intent: '意向发现', intentPlaceholder: '一句话描述要找的公开意向，例如：长沙新能源汽车改装讨论', intentSearch: '开始检索', intentEmpty: '输入需求后查找公开讨论', intentUnavailable: 'Tools 意向检索暂不可用', intentError: '意向检索失败', confidence: '置信度' },
      en: { open: 'Sales workspace', title: 'Sales workspace', subtitle: 'Public intent discovery, follow-ups, and approvals', close: 'Close sales workspace', refresh: 'Refresh', loading: 'Loading sales workspace…', retry: 'Try again', leads: 'Leads', qualified: 'Qualified', dueToday: 'Due today', pending: 'Awaiting approval', empty: 'No sales leads yet', actions: 'Follow-up actions', approve: 'Approve', dismiss: 'Dismiss', adapter: 'Approved, adapter pending', succeeded: 'Adapter completed', failed: 'Adapter failed', requiresLogin: 'Login required', source: 'Source', intent: 'Intent discovery', intentPlaceholder: 'Describe the public intent to find in one sentence', intentSearch: 'Search', intentEmpty: 'Enter a requirement to find public discussions', intentUnavailable: 'Tools intent discovery is unavailable', intentError: 'Intent search failed', confidence: 'Confidence' },
    }
    let opened = false
    const listeners = new Set()
    const emit = () => listeners.forEach(listener => listener())
    const setOpened = value => { opened = value; emit() }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    const snapshot = () => opened
    async function load(signal) { const response = await fetch(PATH, { credentials: 'same-origin', signal, headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error('sales request failed'); return response.json() }
    async function mutate(body) { const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error('sales mutation failed'); return response.json() }
    function Metric({ label, value }) { return h('div', { className: 'ys-metric' }, h('span', null, label), h('strong', null, String(value ?? 0))) }
    function IntentSearch({ t, current, update }) {
      const [query, setQuery] = useState('')
      const [busy, setBusy] = useState(false)
      const run = async () => { if (!query.trim()) return; setBusy(true); try { await update({ action: 'intent_search', query: query.trim() }) } finally { setBusy(false) } }
      const intent = current.intent
      return h('section', { className: 'ys-intent' }, h('div', { className: 'ys-section-heading' }, h('h2', null, t('intent'))), h('div', { className: 'ys-intent-form' }, h('input', { value: query, maxLength: 500, placeholder: t('intentPlaceholder'), onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') run() } }), h('button', { type: 'button', disabled: busy || !query.trim(), onClick: run }, h(IconDataOutline16, { size: 14 }), busy ? '…' : t('intentSearch'))), !intent ? h('div', { className: 'ys-intent-empty' }, t('intentEmpty')) : intent.status === 'unavailable' ? h('div', { className: 'ys-intent-empty' }, t('intentUnavailable')) : intent.status === 'error' ? h('div', { className: 'ys-intent-empty' }, t('intentError')) : intent.items?.length ? intent.items.slice(0, 10).map((item, index) => h('article', { className: 'ys-intent-row', key: `${item.sourceUrl || item.topic || 'result'}-${index}` }, h('div', null, h('strong', null, item.topic || item.platform || t('source')), h('span', null, item.sourceUrl || ''), item.intentSignals?.length ? h('small', null, item.intentSignals.join(' · ')) : null), h('b', null, item.confidence === undefined ? '' : `${t('confidence')} ${Math.round(Number(item.confidence) * 100)}%`))) : h('div', { className: 'ys-intent-empty' }, t('intentEmpty')))
    }
    function statusText(status, t) { return status === 'awaiting_confirmation' ? t('pending') : status === 'confirmed_pending_adapter' ? t('adapter') : status === 'succeeded' ? t('succeeded') : status === 'failed' ? t('failed') : status === 'requires_user_login' ? t('requiresLogin') : t('dismiss') }
    function Action({ item, t, update }) { return h('article', { className: `ys-action ys-action-${item.status}`, 'data-status': item.status }, h('div', { className: 'ys-action-main' }, h('strong', null, item.summary), h('span', null, item.channel), h('small', null, statusText(item.status, t))), item.status === 'awaiting_confirmation' ? h('div', { className: 'ys-action-buttons' }, h('button', { type: 'button', onClick: () => update({ action: 'confirm_action', id: item.id }) }, h(IconCheckOutline16, { size: 14 }), t('approve')), h('button', { type: 'button', onClick: () => update({ action: 'dismiss_action', id: item.id }) }, h(IconCloseOutline16, { size: 14 }), t('dismiss'))) : null) }
    function Overlay({ t }) {
      const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
      const [data, setData] = useState(null)
      const [error, setError] = useState(false)
      const [loading, setLoading] = useState(false)
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        if (!visible) return undefined
        const controller = new AbortController()
        setError(false)
        setLoading(true)
        void load(controller.signal).then(value => { setData(value); setError(false) }).catch(cause => {
          if (cause?.name !== 'AbortError') setError(true)
        }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
      }, [visible, revision])
      useEffect(() => {
        if (!visible) return undefined
        const onKey = event => { if (event.key === 'Escape') setOpened(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [visible])
      if (!visible) return null
      const current = data || { dashboard: {}, leads: [], actions: [] }
      const update = async body => {
        try { setData(await mutate(body)) } catch { setError(true) }
      }
      const intent = h(IntentSearch, { t, current, update })
      const metrics = h('div', { className: 'ys-metrics' },
        h(Metric, { label: t('leads'), value: current.dashboard.leads }),
        h(Metric, { label: t('qualified'), value: current.dashboard.qualified }),
        h(Metric, { label: t('dueToday'), value: current.dashboard.dueToday }),
        h(Metric, { label: t('pending'), value: current.dashboard.pendingConfirmation }),
      )
      const actions = h('section', { className: 'ys-section' },
        h('h2', null, t('actions')),
        current.actions.map(item => h(Action, { key: item.id, item, t, update })),
      )
      const leads = h('section', { className: 'ys-section' },
        h('h2', null, t('leads')),
        current.leads.length
          ? current.leads.slice(0, 20).map(lead => h('article', { className: 'ys-lead', key: lead.id },
            h('strong', null, lead.company), h('span', null, `${lead.stage} · ${lead.source}`), lead.note ? h('p', null, lead.note) : null,
          ))
          : h('div', { className: 'ys-empty' }, t('empty')),
      )
      const content = loading && !data
        ? h('div', { role: 'status', className: 'ys-empty ys-loading' }, h('span', { className: 'ys-spinner', 'aria-hidden': true }), t('loading'))
        : error && !data
        ? h('div', { role: 'alert', className: 'ys-empty ys-error' }, h('strong', null, 'Unable to load sales workspace'), h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, t('retry')))
        : h(React.Fragment, null, intent, metrics, actions, leads)
      return h('div', { className: 'ys-overlay' },
        h('main', { className: 'ys-shell', 'aria-labelledby': 'ys-title' },
          h('header', { className: 'ys-header' },
            h('div', null, h('h1', { id: 'ys-title' }, t('title')), h('p', null, t('subtitle'))),
            h('div', { className: 'ys-header-buttons' },
              h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', 'aria-label': t('refresh'), disabled: loading, onClick: () => setRevision(value => value + 1) }, h(IconRefreshOutline16, { size: 16 }))),
              h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))),
            ),
          ),
          h('div', { className: 'ys-content' }, content),
        ),
      )
    }
    function Button({ wide, t }) { return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `ys-button${wide ? ' ys-wide' : ''}`, 'aria-label': t('open'), onClick: () => setOpened(true) }, h(IconDataOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }
    const css = `.ys-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.ys-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.ys-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.ys-wide span{font-size:13px}.ys-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.ys-shell{display:grid;grid-template-rows:auto minmax(0,1fr);width:100%;height:100%;overflow:hidden}.ys-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ys-header h1{margin:0;font-size:20px}.ys-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.ys-header-buttons{display:flex;gap:6px}.ys-header-buttons button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.ys-header-buttons button:disabled{opacity:.45;cursor:default}.ys-content{min-height:0;overflow:auto;padding:22px 24px 40px}.ys-intent,.ys-section{display:grid;gap:10px;max-width:1120px;margin:0 auto 24px}.ys-section{margin-top:24px}.ys-section-heading h2{margin:0;font-size:14px}.ys-intent-form{display:flex;gap:8px}.ys-intent-form input{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.ys-intent-form button{display:inline-flex;align-items:center;gap:6px;padding:0 14px;border:0;border-radius:6px;background:var(--dsw-alias-control-fill-brand);color:#fff;font:inherit;cursor:pointer}.ys-intent-form button:disabled{opacity:.5}.ys-intent-empty{padding:18px 0;color:var(--dsw-alias-label-secondary);font-size:13px}.ys-intent-row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1)}.ys-intent-row div{display:grid;gap:4px;min-width:0}.ys-intent-row span,.ys-intent-row small{color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ys-intent-row b{flex:none;font-size:12px}.ys-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));max-width:1120px;margin:0 auto;border-block:1px solid var(--dsw-alias-border-l1)}.ys-metric{display:grid;min-height:82px;align-content:center;gap:6px;padding:12px 16px;border-right:1px solid var(--dsw-alias-border-l1)}.ys-metric:last-child{border-right:0}.ys-metric span,.ys-lead span,.ys-lead p,.ys-action span,.ys-action small{color:var(--dsw-alias-label-secondary);font-size:12px}.ys-metric strong{font-size:24px}.ys-lead,.ys-action{display:grid;gap:6px;padding:14px 16px;border-top:1px solid var(--dsw-alias-border-l1)}.ys-action{display:flex;align-items:center;justify-content:space-between;gap:14px}.ys-action-main{display:grid;gap:4px;min-width:0}.ys-action-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ys-action-buttons{display:flex;gap:6px;flex:none}.ys-action-buttons button,.ys-empty button{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.ys-empty{display:grid;min-height:150px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}.ys-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:ys-spin .8s linear infinite}@keyframes ys-spin{to{transform:rotate(360deg)}}@media(max-width:800px){.ys-header,.ys-content{padding-left:16px;padding-right:16px}.ys-intent-form{flex-direction:column}.ys-intent-form button{min-height:36px;justify-content:center}.ys-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.ys-metric:nth-child(2){border-right:0}.ys-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.ys-action{align-items:flex-start;flex-direction:column}.ys-action-buttons{width:100%}.ys-action-buttons button{flex:1;justify-content:center}}`
    function apply(ctx) { ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-sales: dictionaries'); ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-sales'; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-sales: styles'); const t = ctx.locale.bind(NS); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-sales', order: 30, inject: () => ({ t }) }, Button)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-sales', order: 30, inject: () => ({ t }) }, Overlay)) }
    module.exports = { apply, inject: ['slots', 'locale'] }

    return module.exports;
  },
});
