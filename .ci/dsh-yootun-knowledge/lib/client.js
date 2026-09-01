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
      zh: { open: '企业知识', title: '企业知识与记忆', subtitle: '知识库、Memory 与知识图谱', close: '关闭企业知识', refresh: '刷新', search: '知识检索', recall: 'Memory 召回', graph: '知识图谱', templates: '优惠豚业务空间', unavailable: '知识服务暂不可用', empty: '暂无可见内容', route: 'MCP 路由', entities: '核心实体', use: '调用', source: '数据源', ready: '已就绪', error: '异常', reason: '原因' },
      en: { open: 'Enterprise knowledge', title: 'Enterprise knowledge & memory', subtitle: 'Knowledge, Memory, and graph governance', close: 'Close enterprise knowledge', refresh: 'Refresh', search: 'Knowledge search', recall: 'Memory recall', graph: 'Knowledge graph', templates: 'Youhuitun business spaces', unavailable: 'Knowledge service unavailable', empty: 'No authorized content yet', route: 'MCP route', entities: 'Key entities', use: 'Use', source: 'Source', ready: 'Ready', error: 'Error', reason: 'Reason' },
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
      const routeStatus = error ? 'error' : data?.status === 'ready' && data?.mcp?.auth === 'credential-store' ? 'ready' : 'unavailable'
      const routeLabel = routeStatus === 'ready' ? t('ready') : routeStatus === 'error' ? t('error') : t('unavailable')
      const content = error ? h('div', { role: 'alert', className: 'yk-empty' }, t('unavailable')) : h(React.Fragment, null,
        h('div', { className: `yk-source yk-source-${routeStatus}`, role: 'status' }, h('span', null, `${t('source')}: ${routeLabel}`), data?.reason ? h('code', null, `${t('reason')}: ${data.reason}`) : null),
        h('div', { className: 'yk-metrics' }, h(Metric, { label: t('search'), value: data?.capabilities?.includes('knowledge_search') ? 'MCP' : '-' }), h(Metric, { label: t('recall'), value: data?.capabilities?.includes('knowledge_recall') ? 'MCP' : '-' }), h(Metric, { label: t('graph'), value: data?.capabilities?.includes('knowledge_graph') ? 'MCP' : '-' }), h(Metric, { label: t('route'), value: routeLabel })),
        h('section', { className: 'yk-section' }, h('h2', null, t('templates')), templates.length ? templates.map(item => h('article', { className: 'yk-template', key: item.id }, h('strong', null, item.name), h('p', null, item.description), h('small', null, `${t('entities')}: ${item.entities.join(' · ')}`))) : h('div', { className: 'yk-empty' }, t('empty'))),
      )
      return h('div', { className: 'yk-overlay' }, h('main', { className: 'yk-shell', 'aria-labelledby': 'yk-title' }, h('header', { className: 'yk-header' }, h('div', null, h('h1', { id: 'yk-title' }, t('title')), h('p', null, t('subtitle'))), h('div', { className: 'yk-header-buttons' }, h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', 'aria-label': t('refresh'), onClick: () => setRevision(value => value + 1) }, h(IconRefreshOutline16, { size: 16 }))), h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))))), h('div', { className: 'yk-content' }, content)))
    }

    function Button({ wide, t }) { return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `yk-button${wide ? ' yk-wide' : ''}`, 'aria-label': t('open'), onClick: () => setOpened(true) }, h(IconDataOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }
    const sourceStateCss = '.yk-source{display:flex;max-width:1120px;margin:0 auto 14px;padding:9px 12px;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;font-size:12px}.yk-source code{max-width:100%;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:11px}.yk-source-ready{color:var(--dsw-alias-state-success-primary)}.yk-source-unavailable,.yk-source-error{color:var(--dsw-alias-state-error-primary)}@media(max-width:800px){.yk-source{align-items:flex-start;flex-direction:column}}'
    function apply(ctx) { ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-knowledge: dictionaries'); ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-knowledge'; style.textContent = `${css}${sourceStateCss}`; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-knowledge: styles'); const t = ctx.locale.bind(NS); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-knowledge', order: 45, inject: () => ({ t }) }, Button)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-knowledge', order: 45, inject: () => ({ t }) }, Overlay)) }
    module.exports = { apply, inject: ['slots', 'locale'] }

    return module.exports;
  },
});
