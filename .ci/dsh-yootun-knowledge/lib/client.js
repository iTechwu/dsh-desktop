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
      zh: { open: '企业知识', title: '企业知识与记忆', subtitle: '知识库、Memory 与知识图谱', close: '关闭企业知识', refresh: '刷新', search: '知识检索', recall: 'Memory 召回', graph: '知识图谱', templates: '优惠豚业务空间', unavailable: '知识服务暂不可用', empty: '暂无可见内容', route: 'MCP 路由', entities: '核心实体', use: '调用' },
      en: { open: 'Enterprise knowledge', title: 'Enterprise knowledge & memory', subtitle: 'Knowledge, Memory, and graph governance', close: 'Close enterprise knowledge', refresh: 'Refresh', search: 'Knowledge search', recall: 'Memory recall', graph: 'Knowledge graph', templates: 'Youhuitun business spaces', unavailable: 'Knowledge service unavailable', empty: 'No authorized content yet', route: 'MCP route', entities: 'Key entities', use: 'Use' },
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
      useEffect(() => {
        if (!visible) return undefined
        const controller = new AbortController()
        setError(false)
        void load(controller.signal).then(setData).catch(cause => { if (cause?.name !== 'AbortError') setError(true) })
        return () => controller.abort()
      }, [visible, revision])
      useEffect(() => { if (!visible) return undefined; const onKey = event => { if (event.key === 'Escape') setOpened(false) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [visible])
      if (!visible) return null
      const templates = data?.templates || []
      const content = error ? h('div', { role: 'alert', className: 'yk-empty' }, t('unavailable')) : h(React.Fragment, null,
        h('div', { className: 'yk-metrics' }, h(Metric, { label: t('search'), value: data?.capabilities?.includes('knowledge_search') ? 'MCP' : '-' }), h(Metric, { label: t('recall'), value: data?.capabilities?.includes('knowledge_recall') ? 'MCP' : '-' }), h(Metric, { label: t('graph'), value: data?.capabilities?.includes('knowledge_graph') ? 'MCP' : '-' }), h(Metric, { label: t('route'), value: data?.mcp?.auth === 'credential-store' ? 'Ready' : 'Unavailable' })),
        h('section', { className: 'yk-section' }, h('h2', null, t('templates')), templates.length ? templates.map(item => h('article', { className: 'yk-template', key: item.id }, h('strong', null, item.name), h('p', null, item.description), h('small', null, `${t('entities')}: ${item.entities.join(' · ')}`))) : h('div', { className: 'yk-empty' }, t('empty'))),
      )
      return h('div', { className: 'yk-overlay' }, h('main', { className: 'yk-shell', 'aria-labelledby': 'yk-title' }, h('header', { className: 'yk-header' }, h('div', null, h('h1', { id: 'yk-title' }, t('title')), h('p', null, t('subtitle'))), h('div', { className: 'yk-header-buttons' }, h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', 'aria-label': t('refresh'), onClick: () => setRevision(value => value + 1) }, h(IconRefreshOutline16, { size: 16 }))), h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))))), h('div', { className: 'yk-content' }, content)))
    }

    function Button({ wide, t }) { return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `yk-button${wide ? ' yk-wide' : ''}`, 'aria-label': t('open'), onClick: () => setOpened(true) }, h(IconDataOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }
    const css = `.yk-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.yk-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yk-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yk-wide span{font-size:13px}.yk-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yk-shell{display:grid;grid-template-rows:auto 1fr;width:100%;height:100%;overflow:hidden}.yk-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yk-header h1{margin:0;font-size:20px}.yk-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yk-header-buttons{display:flex;gap:6px}.yk-header-buttons button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yk-content{overflow:auto;padding:22px 24px 40px}.yk-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));max-width:1120px;margin:0 auto;border-block:1px solid var(--dsw-alias-border-l1)}.yk-metric{display:grid;min-height:82px;align-content:center;gap:6px;padding:12px 16px;border-right:1px solid var(--dsw-alias-border-l1)}.yk-metric:last-child{border-right:0}.yk-metric span,.yk-template p,.yk-template small{color:var(--dsw-alias-label-secondary);font-size:12px}.yk-metric strong{font-size:18px}.yk-section{display:grid;gap:10px;max-width:1120px;margin:24px auto 0}.yk-section h2{margin:0;font-size:14px}.yk-template{display:grid;gap:6px;padding:14px 16px;border-top:1px solid var(--dsw-alias-border-l1)}.yk-template p{margin:0;line-height:1.45}.yk-template small{line-height:1.4}.yk-empty{display:grid;min-height:150px;place-items:center;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}@media(max-width:800px){.yk-header,.yk-content{padding-left:16px;padding-right:16px}.yk-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yk-metric:nth-child(2){border-right:0}.yk-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}}`
    function apply(ctx) { ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-knowledge: dictionaries'); ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-knowledge'; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-knowledge: styles'); const t = ctx.locale.bind(NS); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-knowledge', order: 45, inject: () => ({ t }) }, Button)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-knowledge', order: 45, inject: () => ({ t }) }, Overlay)) }
    module.exports = { apply, inject: ['slots', 'locale'] }

    return module.exports;
  },
});
