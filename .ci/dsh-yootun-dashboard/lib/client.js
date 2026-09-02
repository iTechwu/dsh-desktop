window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-dashboard",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react')
    const { createElement: h, useEffect, useMemo, useState, useSyncExternalStore } = React
    const {
      IconCloseOutline16,
      IconDataOutline16,
      IconRefreshOutline16,
      Tooltip,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dofe.yootun-dashboard'
    const YOOTUN_DASHBOARD_PATH = '/api/desktop/yootun/dashboard/yesterday'
    const TABS = [
      { id: 'overview', label: 'tabOverview' },
      { id: 'geo', label: 'tabGeo' },
      { id: 'usage', label: 'tabUsage' },
      { id: 'activity', label: 'tabActivity' },
    ]

    const copy = {
      zh: {
        open: '企业看板', title: '企业驾驶舱', subtitle: '昨日 GEO、AI 消费与 Agent 工作',
        refresh: '刷新数据', close: '关闭看板', loading: '正在汇总昨日数据…', retry: '重新加载',
        unavailable: '数据源暂不可用', empty: '昨日暂无数据', error: '数据读取失败',
        sourceReady: '已就绪', sourceEmpty: '无数据', sourceUnavailable: '不可用', sourceError: '异常',
        tabOverview: '总览', tabGeo: 'GEO 效果', tabUsage: '模型与消费', tabActivity: 'Agent 工作',
        geo: 'GEO', usage: '模型消费', activity: 'Agent 工作', sources: '数据状态',
        articles: '生成内容', published: '已发布', views: '总浏览', failedTasks: '失败任务',
        requests: '模型请求', cost: '昨日消费', models: '使用模型', tokens: '总 Token',
        sessions: '工作会话', turns: '执行轮次', completed: '完成轮次', failed: '异常轮次', tools: '工具调用',
        model: '模型', input: '输入 Token', output: '输出 Token', calls: '请求', amount: '费用',
        session: '工作事项', workspace: '工作区', result: '结果', tool: '服务/工具',
        geoFlow: 'GeoFlow 昨日经营数据', billed: '当前 model_api_key 计费记录', local: '本机 DSH 会话事件',
        privacy: '仅展示聚合值、工作标题与结果状态，不展示会话正文或密钥。',
        topContent: 'TOP 内容', untitledContent: '未命名内容',
      },
      en: {
        open: 'Enterprise dashboard', title: 'Enterprise dashboard', subtitle: 'Yesterday’s GEO, AI spend, and Agent work',
        refresh: 'Refresh data', close: 'Close dashboard', loading: 'Summarizing yesterday…', retry: 'Try again',
        unavailable: 'Source unavailable', empty: 'No data yesterday', error: 'Could not load data',
        sourceReady: 'Ready', sourceEmpty: 'No data', sourceUnavailable: 'Unavailable', sourceError: 'Error',
        tabOverview: 'Overview', tabGeo: 'GEO performance', tabUsage: 'Models and spend', tabActivity: 'Agent work',
        geo: 'GEO', usage: 'Model spend', activity: 'Agent work', sources: 'Source status',
        articles: 'Content created', published: 'Published', views: 'Total views', failedTasks: 'Failed tasks',
        requests: 'Model requests', cost: 'Yesterday spend', models: 'Models used', tokens: 'Total tokens',
        sessions: 'Work sessions', turns: 'Turns', completed: 'Completed', failed: 'Failed', tools: 'Tool calls',
        model: 'Model', input: 'Input tokens', output: 'Output tokens', calls: 'Requests', amount: 'Cost',
        session: 'Work item', workspace: 'Workspace', result: 'Result', tool: 'Service/tool',
        geoFlow: 'GeoFlow yesterday metrics', billed: 'Current model_api_key billing records', local: 'Local DSH session events',
        privacy: 'Shows aggregates, work titles, and outcomes only. Conversation content and secrets are excluded.',
        topContent: 'Top content', untitledContent: 'Untitled content',
      },
    }

    let opened = false
    const listeners = new Set()
    function emit() { for (const listener of listeners) listener() }
    function setOpened(value) { opened = value; emit() }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
    function getSnapshot() { return opened }

    async function loadDashboard(signal) {
      const response = await fetch(YOOTUN_DASHBOARD_PATH, {
        method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('dashboard request failed')
      return response.json()
    }

    function number(value) {
      const parsed = Number(value ?? 0)
      return Number.isFinite(parsed) ? parsed : 0
    }

    function formatNumber(value) {
      return new Intl.NumberFormat(undefined, { notation: number(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number(value))
    }

    function formatMoney(value, currency) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'CNY', maximumFractionDigits: 4 }).format(number(value))
      } catch {
        return `${formatNumber(value)} ${currency || 'CNY'}`
      }
    }

    function statusLabel(status, t) {
      if (status === 'ready') return t('sourceReady')
      if (status === 'empty') return t('sourceEmpty')
      if (status === 'error') return t('sourceError')
      return t('sourceUnavailable')
    }

    function SourceState({ source, t, compact = false }) {
      const status = source?.status || 'unavailable'
      return h('span', { className: `yd-source yd-source-${status}${compact ? ' yd-source-compact' : ''}` },
        h('span', { className: 'yd-source-dot', 'aria-hidden': true }),
        statusLabel(status, t))
    }

    function EmptyState({ source, t }) {
      const status = source?.status || 'unavailable'
      const label = status === 'empty' ? t('empty') : status === 'error' ? t('error') : t('unavailable')
      return h('div', { className: 'yd-empty', role: status === 'error' ? 'alert' : undefined },
        h('strong', null, label),
        source?.reason ? h('code', null, source.reason) : null)
    }

    function Metric({ label, value, tone }) {
      return h('div', { className: `yd-metric${tone ? ` yd-metric-${tone}` : ''}` },
        h('span', null, label), h('strong', null, value))
    }

    function SourceBand({ data, t }) {
      const sources = [
        [t('geo'), t('geoFlow'), data?.geo],
        [t('usage'), t('billed'), data?.usage],
        [t('activity'), t('local'), data?.activity],
      ]
      return h('section', { className: 'yd-source-band', 'aria-labelledby': 'yd-source-title' },
        h('div', { className: 'yd-section-heading' }, h('h2', { id: 'yd-source-title' }, t('sources')), h('p', null, t('privacy'))),
        h('div', { className: 'yd-source-list' }, ...sources.map(([name, description, source]) =>
          h('div', { className: 'yd-source-row', key: name },
            h('div', null, h('strong', null, name), h('span', null, description)),
            h(SourceState, { source, t })))))
    }

    function GeoMetrics({ source, t, detailed = false }) {
      if (source?.status !== 'ready') return h(EmptyState, { source, t })
      const data = source.data || {}
      const kpis = data.kpis || {}
      const metrics = [
        [t('articles'), kpis.articles], [t('published'), kpis.published],
        [t('views'), kpis.total_views], [t('failedTasks'), kpis.failed_tasks],
      ]
      const content = Array.isArray(data.top_content) ? data.top_content.slice(0, 8) : []
      return h(React.Fragment, null,
        h('div', { className: 'yd-metrics' }, ...metrics.map(([label, value], index) =>
          h(Metric, { key: label, label, value: formatNumber(value), tone: index === 3 && number(value) > 0 ? 'danger' : undefined }))),
        detailed ? h('section', { className: 'yd-table-section' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, t('topContent')), h(SourceState, { source, t, compact: true })),
          content.length ? h('div', { className: 'yd-list' }, ...content.map((item, index) => {
            const row = item && typeof item === 'object' ? item : {}
            return h('div', { className: 'yd-list-row', key: `${index}-${row.id || ''}` },
              h('span', { className: 'yd-rank' }, String(index + 1)),
              h('strong', null, String(row.title || row.name || row.path || t('untitledContent'))),
              h('span', null, formatNumber(row.views || row.total_views || row.pv)))
          })) : h('p', { className: 'yd-inline-empty' }, t('empty'))) : null)
    }

    function UsageView({ source, t, detailed = false }) {
      if (source?.status !== 'ready' && source?.status !== 'empty') return h(EmptyState, { source, t })
      const data = source.data || {}
      const summary = data.summary || {}
      const models = Array.isArray(data.byModel) ? data.byModel : []
      const metrics = [
        [t('requests'), summary.requests],
        [t('cost'), formatMoney(summary.cost, data.currency)],
        [t('models'), models.length],
        [t('tokens'), summary.totalTokens],
      ]
      return h(React.Fragment, null,
        h('div', { className: 'yd-metrics' }, ...metrics.map(([label, value]) =>
          h(Metric, { key: label, label, value: typeof value === 'string' ? value : formatNumber(value) }))),
        detailed ? h('section', { className: 'yd-table-section' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, t('models')), h(SourceState, { source, t, compact: true })),
          models.length ? h('div', { className: 'yd-table', role: 'table' },
            h('div', { className: 'yd-table-row yd-table-head', role: 'row' },
              h('span', null, t('model')), h('span', null, t('calls')), h('span', null, t('input')), h('span', null, t('output')), h('span', null, t('amount'))),
            ...models.map(model => h('div', { className: 'yd-table-row', role: 'row', key: model.model },
              h('strong', null, model.model), h('span', null, formatNumber(model.requests)),
              h('span', null, formatNumber(model.inputTokens)), h('span', null, formatNumber(model.outputTokens)),
              h('span', null, formatMoney(model.cost, data.currency))))) : h('p', { className: 'yd-inline-empty' }, t('empty'))) : null)
    }

    function ActivityView({ source, t, detailed = false }) {
      if (source?.status !== 'ready' && source?.status !== 'empty') return h(EmptyState, { source, t })
      const data = source.data || {}
      const totals = data.totals || {}
      const sessions = Array.isArray(data.sessions) ? data.sessions : []
      const tools = Array.isArray(data.tools) ? data.tools : []
      const metrics = [
        [t('sessions'), totals.sessions], [t('turns'), totals.turns],
        [t('completed'), totals.completedTurns], [t('tools'), totals.toolCalls],
      ]
      return h(React.Fragment, null,
        h('div', { className: 'yd-metrics' }, ...metrics.map(([label, value]) => h(Metric, { key: label, label, value: formatNumber(value) }))),
        detailed ? h('div', { className: 'yd-activity-grid' },
          h('section', { className: 'yd-table-section' },
            h('div', { className: 'yd-section-heading' }, h('h2', null, t('session')), h(SourceState, { source, t, compact: true })),
            sessions.length ? h('div', { className: 'yd-list' }, ...sessions.map((session, index) =>
              h('div', { className: 'yd-list-row yd-session-row', key: `${session.title}-${index}` },
                h('div', null, h('strong', null, session.title), h('span', null, session.workspace)),
                h('span', { className: session.failedTurns > 0 ? 'yd-text-danger' : '' }, `${session.completedTurns || 0}/${session.turns || 0}`))))
              : h('p', { className: 'yd-inline-empty' }, t('empty'))),
          h('section', { className: 'yd-table-section' },
            h('div', { className: 'yd-section-heading' }, h('h2', null, t('tool'))),
            tools.length ? h('div', { className: 'yd-list' }, ...tools.slice(0, 12).map(tool =>
              h('div', { className: 'yd-list-row', key: tool.name }, h('strong', null, tool.name), h('span', null, formatNumber(tool.calls)))))
              : h('p', { className: 'yd-inline-empty' }, t('empty')))) : null)
    }

    function Overview({ data, t }) {
      return h('div', { className: 'yd-overview' },
        h('section', { className: 'yd-domain' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, t('geo')), h(SourceState, { source: data.geo, t, compact: true })),
          h(GeoMetrics, { source: data.geo, t })),
        h('section', { className: 'yd-domain' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, t('usage')), h(SourceState, { source: data.usage, t, compact: true })),
          h(UsageView, { source: data.usage, t })),
        h('section', { className: 'yd-domain' },
          h('div', { className: 'yd-section-heading' }, h('h2', null, t('activity')), h(SourceState, { source: data.activity, t, compact: true })),
          h(ActivityView, { source: data.activity, t })),
        h(SourceBand, { data, t }))
    }

    function DashboardButton({ wide, t }) {
      return h(Tooltip, { label: t('open'), delayMs: 500, disabled: wide },
        h('button', { type: 'button', className: `yd-sidebar-action${wide ? ' yd-sidebar-wide' : ''}`, onClick: () => setOpened(true), 'aria-label': t('open') },
          h(IconDataOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null))
    }

    function DashboardOverlay({ t }) {
      const visible = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const [tab, setTab] = useState('overview')
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(false)
      const [failed, setFailed] = useState(false)
      const [revision, setRevision] = useState(0)

      useEffect(() => {
        if (!visible) return undefined
        const controller = new AbortController()
        setLoading(true)
        setFailed(false)
        void loadDashboard(controller.signal).then(value => { setData(value); setFailed(false) })
          .catch(error => { if (error?.name !== 'AbortError') setFailed(true) })
          .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
      }, [visible, revision])

      useEffect(() => {
        if (!visible) return undefined
        const onKeyDown = event => { if (event.key === 'Escape') setOpened(false) }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [visible])

      const periodLabel = useMemo(() => data?.period?.date || '', [data?.period?.date])
      if (!visible) return null
      let body
      if (loading && !data) body = h('div', { className: 'yd-loading', role: 'status' }, h('span', { className: 'yd-spinner' }), t('loading'))
      else if (failed && !data) body = h('div', { className: 'yd-fatal', role: 'alert' }, h('strong', null, t('error')), h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, t('retry')))
      else if (data) {
        body = tab === 'overview' ? h(Overview, { data, t })
          : tab === 'geo' ? h(GeoMetrics, { source: data.geo, t, detailed: true })
            : tab === 'usage' ? h(UsageView, { source: data.usage, t, detailed: true })
              : h(ActivityView, { source: data.activity, t, detailed: true })
      }

      return h('div', { className: 'yd-overlay' },
        h('main', { className: 'yd-shell', 'aria-labelledby': 'yd-title' },
          h('header', { className: 'yd-header' },
            h('div', null, h('div', { className: 'yd-title-line' }, h('h1', { id: 'yd-title' }, t('title')), periodLabel ? h('time', null, periodLabel) : null), h('p', null, t('subtitle'))),
            h('div', { className: 'yd-header-actions' },
              h(Tooltip, { label: t('refresh'), side: 'bottom' }, h('button', { type: 'button', className: 'yd-icon-button', disabled: loading, onClick: () => setRevision(value => value + 1), 'aria-label': t('refresh') }, h(IconRefreshOutline16, { size: 16 }))),
              h(Tooltip, { label: t('close'), side: 'bottom' }, h('button', { type: 'button', className: 'yd-icon-button', onClick: () => setOpened(false), 'aria-label': t('close') }, h(IconCloseOutline16, { size: 16 }))))),
          h('nav', { className: 'yd-tabs', 'aria-label': t('title') }, ...TABS.map(item =>
            h('button', { type: 'button', key: item.id, 'data-active': tab === item.id, onClick: () => setTab(item.id) }, t(item.label)))),
          failed && data ? h('div', { className: 'yd-stale', role: 'status' }, t('error')) : null,
          h('div', { className: 'yd-content' }, body)))
    }

    const css = `
    .yd-sidebar-action{box-sizing:border-box;display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.yd-sidebar-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yd-sidebar-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yd-sidebar-wide span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.yd-overlay{pointer-events:auto;position:fixed;inset:0;z-index:500;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yd-shell{display:grid;grid-template-rows:auto auto auto 1fr;width:100%;height:100%;overflow:hidden}.yd-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;gap:20px;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-title-line{display:flex;align-items:baseline;gap:12px}.yd-header h1{margin:0;font-size:20px;line-height:1.3;letter-spacing:0}.yd-header time{color:var(--dsw-alias-label-secondary);font-size:12px}.yd-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yd-header-actions{display:flex;gap:6px}.yd-icon-button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.yd-icon-button:hover{background:var(--dsw-alias-bg-layer-2)}.yd-icon-button:disabled{opacity:.45;cursor:default}.yd-tabs{display:flex;gap:2px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto}.yd-tabs button{height:42px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}.yd-tabs button[data-active=true]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yd-content{overflow:auto;padding:22px 24px 40px}.yd-overview{display:grid;gap:28px;max-width:1440px;margin:0 auto}.yd-domain,.yd-table-section,.yd-source-band{min-width:0}.yd-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:11px}.yd-section-heading h2{margin:0;font-size:14px;line-height:1.4;letter-spacing:0}.yd-section-heading p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.yd-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-metric{display:grid;min-height:82px;align-content:center;gap:6px;padding:12px 16px;border-right:1px solid var(--dsw-alias-border-l1)}.yd-metric:last-child{border-right:0}.yd-metric span{color:var(--dsw-alias-label-secondary);font-size:12px}.yd-metric strong{font-size:24px;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:0;overflow-wrap:anywhere}.yd-metric-danger strong,.yd-text-danger{color:var(--dsw-alias-state-error-primary)}.yd-source{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.yd-source-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.yd-source-ready .yd-source-dot{background:var(--dsw-alias-state-success-primary)}.yd-source-error .yd-source-dot{background:var(--dsw-alias-state-error-primary)}.yd-source-empty .yd-source-dot{background:var(--dsw-alias-state-warning-primary)}.yd-source-list{border-top:1px solid var(--dsw-alias-border-l1)}.yd-source-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:54px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-source-row>div{display:grid;gap:3px}.yd-source-row strong{font-size:13px}.yd-source-row span{color:var(--dsw-alias-label-secondary);font-size:12px}.yd-list,.yd-table{border-top:1px solid var(--dsw-alias-border-l1)}.yd-list-row{display:grid;grid-template-columns:32px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:46px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}.yd-list-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.yd-list-row>span:last-child{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.yd-rank{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}.yd-session-row{grid-template-columns:minmax(0,1fr) auto}.yd-session-row>div{display:grid;gap:3px;min-width:0}.yd-session-row>div span{color:var(--dsw-alias-label-secondary)}.yd-table-row{display:grid;grid-template-columns:minmax(180px,2fr) repeat(4,minmax(90px,1fr));gap:12px;align-items:center;min-height:46px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;font-variant-numeric:tabular-nums}.yd-table-row strong{overflow-wrap:anywhere}.yd-table-head{min-height:34px;color:var(--dsw-alias-label-secondary);font-size:11px}.yd-activity-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:28px;margin-top:28px}.yd-empty,.yd-loading,.yd-fatal{display:grid;min-height:160px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:13px}.yd-empty code{font-size:11px}.yd-fatal button{min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.yd-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:yd-spin .8s linear infinite}.yd-stale{padding:7px 24px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 10%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px}.yd-inline-empty{margin:20px 0;color:var(--dsw-alias-label-secondary);font-size:12px}@keyframes yd-spin{to{transform:rotate(360deg)}}@media(max-width:800px){.yd-header,.yd-tabs{padding-left:16px;padding-right:16px}.yd-content{padding:18px 16px 32px}.yd-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yd-metric:nth-child(2){border-right:0}.yd-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.yd-activity-grid{grid-template-columns:1fr}.yd-table{overflow-x:auto}.yd-table-row{min-width:720px}}@media(max-width:480px){.yd-header{min-height:68px}.yd-header p{display:none}.yd-title-line{display:grid;gap:1px}.yd-header h1{font-size:17px}.yd-metric{min-height:72px;padding:10px}.yd-metric strong{font-size:20px}.yd-source-row{align-items:flex-start;padding:10px 0}.yd-section-heading{align-items:flex-start}.yd-section-heading p{max-width:60%}}
    `

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-dashboard: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = '@dofe/dsh-yootun-dashboard'
        style.textContent = css
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dofe-yootun-dashboard: styles')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action', id: 'dofe-yootun-dashboard', order: 10, inject: () => ({ t }),
      }, DashboardButton))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'dofe-yootun-dashboard', order: 10, inject: () => ({ t }),
      }, DashboardOverlay))
    }

    exports.apply = apply
    exports.inject = inject

    return module.exports;
  },
});
