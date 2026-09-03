const React = require('react')
const { createElement: h, useEffect, useState, useSyncExternalStore } = React
const { IconCloseOutline16, IconRefreshOutline16, IconDataOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')
const NS = 'dofe.yootun-daily-report'; const PATH = '/api/desktop/yootun/daily-report'
const OVERLAY_ID = '@dofe/dsh-yootun-daily-report'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const copy = { zh: { open: '昨日工作', title: '昨日工作日报', subtitle: '汇总本机 Agent 会话与工具调用', close: '关闭昨日工作日报', refresh: '刷新', loading: '正在读取昨日工作…', retry: '重新加载', sessions: '会话', turns: '轮次', completed: '完成', failed: '异常', tools: '工具调用', empty: '昨日没有可汇总的工作记录', unavailable: '本机事件暂不可用', privacy: '仅展示标题、工作区与聚合计数，不展示会话正文。', sources: '数据源状态', local: '本机事件', toolsSource: '工具目录', salesIntent: '销售意向', retrofit: '改装检索', knowledge: '企业知识', sourceReady: '已就绪', sourceEmpty: '无数据', sourceUnavailable: '不可用', sourceError: '异常', reason: '原因' }, en: { open: 'Yesterday', title: 'Yesterday at a glance', subtitle: 'Local Agent sessions and tool calls', close: 'Close yesterday report', refresh: 'Refresh', loading: 'Loading yesterday’s work…', retry: 'Try again', sessions: 'Sessions', turns: 'Turns', completed: 'Completed', failed: 'Failed', tools: 'Tool calls', empty: 'No local work recorded yesterday', unavailable: 'Local events unavailable', privacy: 'Titles, workspaces, and aggregates only; conversation text is excluded.', sources: 'Source status', local: 'Local events', toolsSource: 'Tool catalog', salesIntent: 'Sales intent', retrofit: 'Retrofit', knowledge: 'Knowledge', sourceReady: 'Ready', sourceEmpty: 'No data', sourceUnavailable: 'Unavailable', sourceError: 'Error', reason: 'Reason' } }
let opened = false; const listeners = new Set(); const emit = () => listeners.forEach(listener => listener()); const setOpened = value => { opened = value; emit() }; const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }; const snapshot = () => opened
const openOverlay = () => { window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } })); setOpened(true) }
const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }
const closeOnEscape = event => { if (opened && event.key === 'Escape') setOpened(false) }
function statusLabel(status, t) { return status === 'ready' ? t('sourceReady') : status === 'empty' ? t('sourceEmpty') : status === 'error' ? t('sourceError') : t('sourceUnavailable') }
function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [data, setData] = useState(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!visible) return undefined
    const controller = new AbortController()
    setLoading(true)
    void fetch(PATH, {
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(response => response.json())
      .then(setData)
      .catch(() => setData({ activity: { status: 'unavailable', reason: 'request_failed' } }))
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [visible, revision])

  if (!visible) return null
  const activity = data?.activity
  const totals = activity?.totals || {}
  const metricValue = value => activity?.status === 'unavailable' || activity?.status === 'error'
    ? '不可用'
    : String(value ?? 0)
  const metrics = [
    ['sessions', totals.sessions],
    ['turns', totals.turns],
    ['completed', totals.completed],
    ['failed', totals.failed],
    ['tools', totals.toolCalls],
  ]
  const sourceRows = [
    ['local', data?.sources?.local || activity],
    ['toolsSource', data?.sources?.tools],
    ['salesIntent', data?.sources?.salesIntent],
    ['retrofit', data?.sources?.retrofit],
    ['knowledge', data?.sources?.knowledge],
  ]
  const content = loading && !data
    ? h('div', { className: 'ydr-empty ydr-loading', role: 'status' }, h('span', { className: 'ydr-spinner', 'aria-hidden': true }), t('loading'))
    : activity?.status === 'unavailable' || activity?.status === 'error'
    ? h('div', { className: 'ydr-empty ydr-error', role: 'alert' }, h('strong', null, t('unavailable')), h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, t('retry')))
    : activity?.status === 'empty'
      ? h('div', { className: 'ydr-empty' }, t('empty'))
      : h(
        'section',
        { className: 'ydr-section' },
        (activity?.sessions || []).map(item => h(
          'article',
          { className: 'ydr-row', key: `${item.workspace}-${item.title}` },
          h('strong', null, item.title),
          h('span', null, `${item.workspace} · ${item.turns} ${t('turns')}`),
        )),
      )

  return h(
    'div',
    { className: 'ydr-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'ydr-title' },
    h(
      'main',
      { className: 'ydr-shell' },
      h(
        'header',
        { className: 'ydr-header' },
        h(
          'div',
          null,
          h('h1', { id: 'ydr-title' }, t('title')),
          h('p', null, t('subtitle')),
        ),
        h(
          'div',
          { className: 'ydr-actions' },
          h(
            Tooltip,
            { label: t('refresh') },
            h(
              'button',
              {
                type: 'button',
                'aria-label': t('refresh'),
                disabled: loading,
                onClick: () => setRevision(value => value + 1),
              },
              h(IconRefreshOutline16, { size: 16 }),
            ),
          ),
          h(
            Tooltip,
            { label: t('close') },
            h(
              'button',
              { type: 'button', 'aria-label': t('close'), onClick: () => setOpened(false) },
              h(IconCloseOutline16, { size: 16 }),
            ),
          ),
        ),
      ),
      h(
        'div',
        { className: 'ydr-content' },
        h(
          'div',
          { className: 'ydr-metrics' },
          ...metrics.map(([label, value]) => h(
            'div',
            { className: 'ydr-metric', key: label },
            h('span', null, t(label)),
            h('strong', null, metricValue(value)),
          )),
        ),
        h('p', { className: 'ydr-privacy' }, t('privacy')),
        h(
          'section',
          { className: 'ydr-sources' },
          h('h2', null, t('sources')),
          ...sourceRows.map(([label, source]) => h(
            'div',
            { className: 'ydr-source-row', key: label },
            h('span', null, t(label)),
            h(
              'b',
              { className: `ydr-source-${source?.status || 'unavailable'}` },
              statusLabel(source?.status, t),
            ),
            source?.reason ? h('code', null, `${t('reason')}: ${source.reason}`) : null,
          )),
        ),
        content,
      ),
    ),
  )
}
function Button({ t }) { return h(Tooltip, { label: t('open') }, h('button', { type: 'button', className: 'ydr-button', 'aria-label': t('open'), onClick: openOverlay }, h(IconDataOutline16, { size: 18 }))) }
const css = `.ydr-button{box-sizing:border-box;display:flex;width:36px;height:36px;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.ydr-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.ydr-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.ydr-shell{display:grid;grid-template-rows:auto minmax(0,1fr);width:100%;height:100%;overflow:hidden}.ydr-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydr-header h1{margin:0;font-size:20px;letter-spacing:0}.ydr-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.ydr-actions{display:flex;gap:6px}.ydr-actions button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.ydr-content{min-height:0;overflow:auto;padding:22px 24px 40px}.ydr-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));max-width:1120px;margin:0 auto;border-block:1px solid var(--dsw-alias-border-l1)}.ydr-metric{display:grid;min-height:82px;align-content:center;gap:6px;padding:12px 16px;border-right:1px solid var(--dsw-alias-border-l1)}.ydr-metric:last-child{border-right:0}.ydr-metric span{color:var(--dsw-alias-label-secondary);font-size:12px}.ydr-metric strong{font-size:22px;font-variant-numeric:tabular-nums}.ydr-privacy{max-width:1120px;margin:12px auto 24px;color:var(--dsw-alias-label-secondary);font-size:11px;text-align:right}.ydr-sources,.ydr-section{display:grid;gap:0;max-width:1120px;margin:0 auto 24px}.ydr-sources h2{margin:0 0 10px;font-size:14px;letter-spacing:0}.ydr-source-row{display:flex;min-height:42px;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}.ydr-source-row>span{min-width:120px}.ydr-source-row b{font-size:11px}.ydr-source-row code{max-width:100%;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:11px}.ydr-source-ready{color:var(--dsw-alias-state-success-primary)}.ydr-source-error{color:var(--dsw-alias-state-error-primary)}.ydr-source-unavailable,.ydr-source-empty{color:var(--dsw-alias-label-secondary)}.ydr-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-top:1px solid var(--dsw-alias-border-l1)}.ydr-row strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydr-row span{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px}.ydr-empty{display:grid;min-height:180px;place-items:center;max-width:1120px;margin:0 auto;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}@media(max-width:800px){.ydr-header,.ydr-content{padding-left:16px;padding-right:16px}.ydr-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.ydr-metric{border-bottom:1px solid var(--dsw-alias-border-l1)}.ydr-metric:nth-child(2n){border-right:0}.ydr-metric:last-child{border-bottom:0}.ydr-privacy{text-align:left}.ydr-row{align-items:flex-start;flex-direction:column}.ydr-row span{flex:auto}}@media(max-width:480px){.ydr-header h1{font-size:17px}.ydr-header p{display:none}.ydr-metric{min-height:72px;padding:10px}.ydr-metric strong{font-size:18px}}`
const stateCss = '.ydr-empty{align-content:center;gap:10px}.ydr-empty button{min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.ydr-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:ydr-spin .8s linear infinite}@keyframes ydr-spin{to{transform:rotate(360deg)}}'
function apply(ctx) { ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-daily-report: dictionaries'); ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); window.addEventListener('keydown', closeOnEscape); return () => { window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay); window.removeEventListener('keydown', closeOnEscape) } }, 'dofe-yootun-daily-report: overlay-events'); ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-daily-report'; style.textContent = css + stateCss; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-daily-report: styles'); const t = ctx.locale.bind(NS); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-daily-report', order: 50, inject: () => ({ t }) }, Button)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-daily-report', order: 50, inject: () => ({ t }) }, Overlay)) }
module.exports = { apply, inject: ['slots', 'locale'] }
