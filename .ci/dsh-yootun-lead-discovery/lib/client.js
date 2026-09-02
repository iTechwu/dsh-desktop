window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-lead-discovery",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react')
    const { createElement: h, useState, useSyncExternalStore } = React
    const { IconCloseOutline16, IconDataOutline16, IconSearchOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')
    const NS = 'dofe.yootun-lead-discovery'
    const PATH = '/api/desktop/yootun/lead-discovery'
    const copy = {
      zh: {
        open: '购车线索发现', title: '购车线索发现', subtitle: '只读检索公开购车意向线索', close: '关闭购车线索发现',
        search: '检索', placeholder: '例如：长沙 想买新能源 SUV', platform: '平台', platformXhs: '小红书', platformDouyin: '抖音',
        empty: '输入关键词后开始检索', noLeads: '未找到匹配的公开购车线索', unavailable: '线索工具暂不可用', error: '检索失败', loading: '检索中…',
        intent: '意向分', city: '城市', budget: '预算', timing: '购买时机', action: '建议动作', source: '打开来源',
        leads: '线索', candidates: '已存候选', loadMore: '加载更多', privacy: '结果仅供线索筛选，联系前需人工确认。',
      },
      en: {
        open: 'Car-lead discovery', title: 'Car-lead discovery', subtitle: 'Read-only discovery of public car-purchase intent', close: 'Close car-lead discovery',
        search: 'Search', placeholder: 'e.g. Changsha wanting an EV SUV', platform: 'Platform', platformXhs: 'Xiaohongshu', platformDouyin: 'Douyin',
        empty: 'Enter a keyword to search', noLeads: 'No matching public car-purchase signals', unavailable: 'Lead tool unavailable', error: 'Search failed', loading: 'Searching…',
        intent: 'Intent', city: 'City', budget: 'Budget', timing: 'Timing', action: 'Next step', source: 'Open source',
        leads: 'Leads', candidates: 'Stored candidates', loadMore: 'Load more', privacy: 'Results are for lead screening only; confirm before contacting.',
      },
    }
    let opened = false
    const listeners = new Set()
    const emit = () => listeners.forEach(listener => listener())
    const setOpened = value => { opened = value; emit() }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    const snapshot = () => opened
    async function post(body) { const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }); return response.json() }
    function platformName(value, t) { return value === 'douyin' ? t('platformDouyin') : value === 'xiaohongshu-v2' ? t('platformXhs') : (value || '') }
    function LeadCard({ item, t }) {
      return h('article', { className: 'yl-card' },
        h('div', { className: 'yl-card-head' },
          h('strong', { className: `yl-level yl-level-${String(item.leadLevel || '').toLowerCase()}` }, String(item.leadLevel || '')),
          h('span', { className: 'yl-meta' }, platformName(item.platform, t)),
          item.intentScore === undefined ? null : h('b', { className: 'yl-score' }, `${t('intent')} ${item.intentScore}`),
        ),
        item.aiSummary ? h('p', { className: 'yl-summary' }, item.aiSummary) : null,
        h('div', { className: 'yl-tags' },
          item.city ? h('span', null, `${t('city')} ${item.city}`) : null,
          (item.budgetMin !== undefined || item.budgetMax !== undefined) ? h('span', null, `${t('budget')} ${item.budgetMin ?? '?'}–${item.budgetMax ?? '?'}`) : null,
          item.purchaseTiming ? h('span', null, `${t('timing')} ${item.purchaseTiming}`) : null,
        ),
        item.recommendedAction ? h('p', { className: 'yl-action' }, `${t('action')}：${item.recommendedAction}`) : null,
        item.sourceUrl ? h('a', { className: 'yl-link', href: item.sourceUrl, target: '_blank', rel: 'noreferrer' }, t('source')) : null,
      )
    }
    function Overlay({ t }) {
      const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
      const [query, setQuery] = useState('')
      const [platform, setPlatform] = useState('xiaohongshu-v2')
      const [busy, setBusy] = useState(false)
      const [loadingMore, setLoadingMore] = useState(false)
      const [data, setData] = useState(null)
      const [items, setItems] = useState([])
      const [candidates, setCandidates] = useState(null)
      const [showCandidates, setShowCandidates] = useState(false)
      if (!visible) return null
      const run = async () => { if (!query.trim() || busy) return; setBusy(true); try { const response = await post({ action: 'discover', keyword: query.trim(), platform }); setData(response); setItems(response.items || []); setCandidates(null); setShowCandidates(false) } catch { setData({ status: 'error' }) } finally { setBusy(false) } }
      const loadMore = async () => { if (loadingMore || !data?.resultRef || !data?.hasMore) return; setLoadingMore(true); try { const response = await post({ action: 'page', resultRef: data.resultRef, cursor: data.nextCursor }); setData(prev => ({ ...prev, nextCursor: response.nextCursor, hasMore: response.hasMore })); setItems(prev => prev.concat(response.items || [])) } catch { setData(prev => ({ ...prev, status: 'error' })) } finally { setLoadingMore(false) } }
      const loadCandidates = async () => { setShowCandidates(true); try { setCandidates(await post({ action: 'candidates' })) } catch { setCandidates({ status: 'error' }) } }
      const status = data?.status
      let resultBlock
      if (busy) resultBlock = h('p', { className: 'yl-hint' }, t('loading'))
      else if (!data) resultBlock = h('p', { className: 'yl-hint' }, t('empty'))
      else if (status === 'unavailable') resultBlock = h('p', { className: 'yl-hint' }, t('unavailable'))
      else if (status === 'error') resultBlock = h('p', { className: 'yl-hint' }, t('error'))
      else if (!items.length) resultBlock = h('p', { className: 'yl-hint' }, t('noLeads'))
      else resultBlock = h('div', { className: 'yl-list' }, items.map((item, index) => h(LeadCard, { key: `${item.sourceUrl || item.aiSummary || 'lead'}-${index}`, item, t })))
      let candidatesBlock = null
      if (showCandidates) {
        candidatesBlock = !candidates
          ? h('p', { className: 'yl-hint' }, t('loading'))
          : candidates.status === 'error' ? h('p', { className: 'yl-hint' }, t('error'))
            : candidates.status === 'unavailable' ? h('p', { className: 'yl-hint' }, t('unavailable'))
              : !candidates.items?.length ? h('p', { className: 'yl-hint' }, t('noLeads'))
                : h('div', { className: 'yl-list' }, candidates.items.map((item, index) => h(LeadCard, { key: `candidate-${index}`, item, t })))
      }
      return h('div', { className: 'yl-overlay' },
        h('main', { className: 'yl-shell' },
          h('header', { className: 'yl-header' },
            h('div', null, h('h1', null, t('title')), h('p', null, t('subtitle'))),
            h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))),
          ),
          h('div', { className: 'yl-content' },
            h('div', { className: 'yl-search' },
              h('select', { value: platform, 'aria-label': t('platform'), onChange: event => setPlatform(event.target.value) },
                h('option', { value: 'xiaohongshu-v2' }, t('platformXhs')),
                h('option', { value: 'douyin' }, t('platformDouyin')),
              ),
              h('input', { value: query, maxLength: 500, placeholder: t('placeholder'), onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') run() } }),
              h('button', { type: 'button', onClick: run, disabled: busy || !query.trim() }, h(IconSearchOutline16, { size: 16 }), busy ? '…' : t('search')),
            ),
            h('p', { className: 'yl-privacy' }, t('privacy')),
            h('section', { className: 'yl-result' },
              h('div', { className: 'yl-heading' }, h('h2', null, t('leads')), h('button', { type: 'button', className: 'yl-subtle', onClick: loadCandidates }, h(IconDataOutline16, { size: 14 }), t('candidates'))),
              resultBlock,
              data?.hasMore ? h('div', { className: 'yl-more' }, h('button', { type: 'button', onClick: loadMore, disabled: loadingMore }, loadingMore ? '…' : t('loadMore'))) : null,
            ),
            candidatesBlock,
          ),
        ),
      )
    }
    function Button({ wide, t }) { return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `yl-button${wide ? ' yl-wide' : ''}`, 'aria-label': t('open'), onClick: () => setOpened(true) }, h(IconSearchOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }
    const css = `.yl-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.yl-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yl-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yl-wide span{font-size:13px}.yl-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yl-shell{display:grid;grid-template-rows:auto 1fr;width:100%;height:100%;overflow:hidden}.yl-header{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yl-header h1{margin:0;font-size:20px}.yl-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yl-header button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yl-content{width:min(900px,100%);margin:0 auto;padding:28px 24px;overflow:auto}.yl-search{display:flex;gap:8px}.yl-search select{padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.yl-search input{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.yl-search button{display:inline-flex;align-items:center;gap:6px;padding:0 14px;border:0;border-radius:6px;background:var(--dsw-alias-control-fill-brand);color:white;font:inherit;cursor:pointer}.yl-search button:disabled{opacity:.5}.yl-privacy{color:var(--dsw-alias-label-secondary);font-size:12px}.yl-result{min-height:220px;margin-top:20px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1)}.yl-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.yl-heading h2{margin:0;font-size:14px}.yl-subtle{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px;cursor:pointer}.yl-hint{padding:18px 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yl-list{display:grid;gap:0}.yl-card{display:grid;gap:8px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l1)}.yl-card:first-child{border-top:0}.yl-card-head{display:flex;align-items:center;gap:10px}.yl-level{display:inline-flex;min-width:22px;height:22px;align-items:center;justify-content:center;padding:0 5px;border-radius:5px;font-size:12px;font-weight:650}.yl-level-a{background:var(--dsw-alias-state-success-primary);color:#fff}.yl-level-b{background:var(--dsw-alias-brand-primary);color:#fff}.yl-level-c,.yl-level-d{background:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-inverse)}.yl-meta{color:var(--dsw-alias-label-secondary);font-size:12px}.yl-score{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary)}.yl-summary{margin:0;font-size:14px;line-height:1.6}.yl-tags{display:flex;flex-wrap:wrap;gap:6px}.yl-tags span{padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yl-action{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.yl-link{justify-self:start;font-size:13px;color:var(--dsw-alias-brand-primary);text-decoration:none}.yl-link:hover{text-decoration:underline}.yl-more{display:flex;justify-content:center;padding:12px 0}.yl-more button{min-height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.yl-more button:disabled{opacity:.5}@media(max-width:600px){.yl-header,.yl-content{padding-left:16px;padding-right:16px}.yl-search{flex-direction:column}.yl-search button{min-height:36px;justify-content:center}}`
    function apply(ctx) { ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-lead-discovery: dictionaries'); ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-lead-discovery'; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-lead-discovery: styles'); const t = ctx.locale.bind(NS); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-lead-discovery', order: 35, inject: () => ({ t }) }, Button)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-lead-discovery', order: 35, inject: () => ({ t }) }, Overlay)) }
    module.exports = { apply, inject: ['slots', 'locale'] }

    return module.exports;
  },
});
