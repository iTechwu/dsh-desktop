window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-knowledge",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react')
    const { createElement: h, useEffect, useState, useSyncExternalStore } = React
    const { IconCloseOutline16, IconDataOutline16, IconRefreshOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dofe.yootun-knowledge'
    const PATH = '/api/desktop/yootun/knowledge'
    const copy = {
      zh: { open: '企业知识', title: '企业知识与记忆', subtitle: '知识库、Memory 与知识图谱', close: '关闭企业知识', refresh: '刷新', loading: '正在读取企业知识…', retry: '重新加载', search: '知识检索', recall: 'Memory 召回', graph: '知识图谱', templates: '优惠豚业务空间', unavailable: '知识服务暂不可用', empty: '暂无可见内容', route: 'MCP 路由', entities: '核心实体', use: '调用', source: '数据源', ready: '已就绪', error: '异常', reason: '原因' },
      en: { open: 'Enterprise knowledge', title: 'Enterprise knowledge & memory', subtitle: 'Knowledge, Memory, and graph governance', close: 'Close enterprise knowledge', refresh: 'Refresh', loading: 'Loading enterprise knowledge…', retry: 'Try again', search: 'Knowledge search', recall: 'Memory recall', graph: 'Knowledge graph', templates: 'Youhuitun business spaces', unavailable: 'Knowledge service unavailable', empty: 'No authorized content yet', route: 'MCP route', entities: 'Key entities', use: 'Use', source: 'Source', ready: 'Ready', error: 'Error', reason: 'Reason' },
    }
    let opened = false
    const listeners = new Set()
    const emit = () => listeners.forEach(listener => listener())
    const setOpened = value => { opened = value; emit() }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    const snapshot = () => opened

    async function load(signal) {
      const response = await fetch(PATH, { credentials: 'same-origin', signal, headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('knowledge request failed')
      return response.json()
    }

    function Metric({ label, value }) { return h('div', { className: 'yk-metric' }, h('span', null, label), h('strong', null, value)) }
    function Overlay({ t }) {
      const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
      const [revision, setRevision] = useState(0)
      const [data, setData] = useState(null)
      const [error, setError] = useState(false)
      const [loading, setLoading] = useState(false)
      useEffect(() => {
        if (!visible) return undefined
        const controller = new AbortController()
        setError(false)
        setLoading(true)
        void load(controller.signal).then(value => { setData(value); setError(false) }).catch(cause => { if (cause?.name !== 'AbortError') setError(true) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
      }, [visible, revision])
      useEffect(() => { if (!visible) return undefined; const onKey = event => { if (event.key === 'Escape') setOpened(false) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [visible])
      if (!visible) return null
      const templates = data?.templates || []
      const routeStatus = error ? 'error' : data?.status === 'ready' && data?.mcp?.auth === 'credential-store' ? 'ready' : 'unavailable'
      const routeLabel = routeStatus === 'ready' ? t('ready') : routeStatus === 'error' ? t('error') : t('unavailable')
      const content = loading && !data ? h('div', { role: 'status', className: 'yk-empty yk-loading' }, h('span', { className: 'yk-spinner', 'aria-hidden': true }), t('loading')) : error ? h('div', { role: 'alert', className: 'yk-empty yk-error' }, h('strong', null, t('unavailable')), h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, t('retry'))) : h(React.Fragment, null,
        h('div', { className: `yk-source yk-source-${routeStatus}`, role: 'status' }, h('span', null, `${t('source')}: ${routeLabel}`), data?.reason ? h('code', null, `${t('reason')}: ${data.reason}`) : null),
        h('div', { className: 'yk-metrics' }, h(Metric, { label: t('search'), value: data?.capabilities?.includes('knowledge_search') ? 'MCP' : '-' }), h(Metric, { label: t('recall'), value: data?.capabilities?.includes('knowledge_recall') ? 'MCP' : '-' }), h(Metric, { label: t('graph'), value: data?.capabilities?.includes('knowledge_graph') ? 'MCP' : '-' }), h(Metric, { label: t('route'), value: routeLabel })),
        h('section', { className: 'yk-section' }, h('h2', null, t('templates')), templates.length ? templates.map(item => h('article', { className: 'yk-template', key: item.id }, h('strong', null, item.name), h('p', null, item.description), h('small', null, `${t('entities')}: ${item.entities.join(' · ')}`))) : h('div', { className: 'yk-empty' }, t('empty'))),
      )
      return h('div', { className: 'yk-overlay' }, h('main', { className: 'yk-shell', 'aria-labelledby': 'yk-title' }, h('header', { className: 'yk-header' }, h('div', null, h('h1', { id: 'yk-title' }, t('title')), h('p', null, t('subtitle'))), h('div', { className: 'yk-header-buttons' }, h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', 'aria-label': t('refresh'), disabled: loading, onClick: () => setRevision(value => value + 1) }, h(IconRefreshOutline16, { size: 16 }))), h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))))), h('div', { className: 'yk-content' }, content)))
    }

    function Button({ wide, t }) { return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `yk-button${wide ? ' yk-wide' : ''}`, 'aria-label': t('open'), onClick: () => setOpened(true) }, h(IconDataOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }
    const css = `.yk-button{box-sizing:border-box;display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.yk-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yk-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yk-wide span{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yk-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yk-shell{display:grid;grid-template-rows:auto minmax(0,1fr);width:100%;height:100%;overflow:hidden}.yk-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yk-header h1{margin:0;font-size:20px;letter-spacing:0}.yk-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yk-header-buttons{display:flex;gap:6px}.yk-header-buttons button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yk-content{min-height:0;overflow:auto;padding:22px 24px 40px}.yk-source{display:flex;max-width:1120px;margin:0 auto 14px;padding:9px 12px;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-size:12px}.yk-source code{max-width:100%;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:11px}.yk-source-ready{color:var(--dsw-alias-state-success-primary)}.yk-source-unavailable,.yk-source-error{color:var(--dsw-alias-state-error-primary)}.yk-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));max-width:1120px;margin:0 auto;border-block:1px solid var(--dsw-alias-border-l1)}.yk-metric{display:grid;min-height:82px;align-content:center;gap:6px;padding:12px 16px;border-right:1px solid var(--dsw-alias-border-l1)}.yk-metric:last-child{border-right:0}.yk-metric span{color:var(--dsw-alias-label-secondary);font-size:12px}.yk-metric strong{font-size:20px;font-variant-numeric:tabular-nums}.yk-section{display:grid;gap:10px;max-width:1120px;margin:24px auto 0}.yk-section h2{margin:0;font-size:14px;letter-spacing:0}.yk-template{display:grid;gap:6px;padding:14px 16px;border-top:1px solid var(--dsw-alias-border-l1)}.yk-template p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}.yk-template small{color:var(--dsw-alias-label-tertiary);font-size:11px}@media(max-width:800px){.yk-header,.yk-content{padding-left:16px;padding-right:16px}.yk-source{align-items:flex-start;flex-direction:column}.yk-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yk-metric:nth-child(2){border-right:0}.yk-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}}@media(max-width:480px){.yk-header h1{font-size:17px}.yk-header p{display:none}.yk-metric{min-height:72px;padding:10px}.yk-metric strong{font-size:17px}}`
    const stateCss = `.yk-empty{display:grid;min-height:180px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}.yk-empty button{min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.yk-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:yk-spin .8s linear infinite}@keyframes yk-spin{to{transform:rotate(360deg)}}`
    function apply(ctx) { ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-knowledge: dictionaries'); ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-knowledge'; style.textContent = css + stateCss; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-knowledge: styles'); const t = ctx.locale.bind(NS); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-knowledge', order: 45, inject: () => ({ t }) }, Button)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-knowledge', order: 45, inject: () => ({ t }) }, Overlay)) }
    module.exports = { apply, inject: ['slots', 'locale'] }

    return module.exports;
  },
});
