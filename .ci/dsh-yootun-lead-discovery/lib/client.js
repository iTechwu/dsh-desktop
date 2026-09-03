window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-lead-discovery",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react')
    const { createElement: h, useEffect, useState, useSyncExternalStore } = React
    const { IconCloseOutline16, IconDataOutline16, IconLinkOutline16, IconLoadingOutline16, IconRefreshOutline16, IconSearchOutline16, IconWarningOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dofe.yootun-lead-discovery'
    const OVERLAY_ID = '@dofe/dsh-yootun-lead-discovery'
    const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
    const PATH = '/api/desktop/yootun/lead-discovery'
    const LEVELS = ['A', 'B', 'C', 'D']
    const copy = {
      zh: {
        open: '购车线索发现', title: '购车线索发现', subtitle: '从公开内容中识别有明确购车意向的用户', close: '关闭购车线索发现', refresh: '刷新当前结果',
        discover: '发现线索', saved: '已存候选', search: '开始检索', searching: '正在检索', placeholder: '输入城市、车型或购车意向，例如：长沙 想买新能源 SUV', platform: '内容平台', platformXhs: '小红书', platformDouyin: '抖音', searchHeading: '把购车意向变成可跟进名单', searchBody: '从公开内容中找到正在比较车型、预算明确或近期准备购车的用户。',
        privacy: '仅展示公开内容中的线索信号，联系前请人工确认并遵守平台规则。', emptyTitle: '从一个购车意向开始', emptyBody: '输入城市、车型或购买时机，系统会按意向强度整理公开线索。', examples: '试试这些关键词', example1: '长沙 新能源 SUV', example2: '深圳 预算 20 万', example3: '抖音 近期买车',
        total: '当前结果', highIntent: 'A 级高意向', avgIntent: '平均意向分', cities: '覆盖城市', sample: '条样本', currentSample: '当前结果样本', totalAvailable: '可用总量',
        distribution: '线索分布', levelDistribution: '意向级别', platformDistribution: '来源平台', cityDistribution: '重点城市', insight: '跟进提示', insightText: 'A 级线索优先处理，先确认车型、预算与购车时机。', topCity: '线索最多城市', noCity: '暂无城市信息',
        filter: '筛选级别', allLevels: '全部', sort: '排序', sortIntent: '意向分优先', sortRecent: '来源顺序', leads: '线索列表', noLeads: '没有匹配的公开购车线索', noFilteredLeads: '当前筛选条件下暂无线索', loadMore: '加载更多', source: '查看原文',
        intent: '意向分', city: '城市', budget: '预算', timing: '购车时机', action: '建议动作', noSummary: '暂无摘要', noAction: '暂无建议动作', unavailable: '线索工具暂不可用', error: '读取失败，请稍后重试', storeUnavailable: '候选存储暂不可用，请稍后重试', loadMoreError: '更多线索加载失败，当前结果已保留。', loading: '正在读取…', retry: '重新检索', retryLoadMore: '重试加载',
        candidatesEmpty: '还没有已存候选', candidatesBody: '完成检索后，符合条件的线索会沉淀到候选列表。', storedCount: '已存候选', updated: '抓取时间',
      },
      en: {
        open: 'Car-lead discovery', title: 'Car-lead discovery', subtitle: 'Identify clear purchase intent from public content', close: 'Close car-lead discovery', refresh: 'Refresh current result',
        discover: 'Discover leads', saved: 'Saved candidates', search: 'Search', searching: 'Searching', placeholder: 'Enter a city, model, or intent, e.g. Changsha EV SUV', platform: 'Platform', platformXhs: 'Xiaohongshu', platformDouyin: 'Douyin', searchHeading: 'Turn purchase intent into a follow-up list', searchBody: 'Find people comparing models, naming a budget, or preparing to buy soon from public content.',
        privacy: 'Only public intent signals are shown. Confirm before contact and follow platform rules.', emptyTitle: 'Start with a purchase intent', emptyBody: 'Enter a city, model, or buying window to organize public leads by intent strength.', examples: 'Try a keyword', example1: 'Changsha electric SUV', example2: 'Shenzhen budget 200k', example3: 'Douyin buying soon',
        total: 'Current results', highIntent: 'A-level high intent', avgIntent: 'Average intent', cities: 'Cities covered', sample: 'samples', currentSample: 'Current sample', totalAvailable: 'Available total',
        distribution: 'Lead distribution', levelDistribution: 'Intent level', platformDistribution: 'Source platform', cityDistribution: 'Top cities', insight: 'Follow-up note', insightText: 'Prioritize A-level leads and confirm model, budget, and timing first.', topCity: 'Top city', noCity: 'No city data',
        filter: 'Filter level', allLevels: 'All', sort: 'Sort', sortIntent: 'Intent first', sortRecent: 'Source order', leads: 'Lead list', noLeads: 'No matching public car-purchase signals', noFilteredLeads: 'No leads match this filter', loadMore: 'Load more', source: 'Open source',
        intent: 'Intent', city: 'City', budget: 'Budget', timing: 'Buying window', action: 'Next step', noSummary: 'No summary', noAction: 'No suggested action', unavailable: 'Lead tool unavailable', error: 'Could not load results. Try again.', storeUnavailable: 'Candidate storage is temporarily unavailable. Try again.', loadMoreError: 'More leads could not be loaded. Current results are preserved.', loading: 'Loading…', retry: 'Try again', retryLoadMore: 'Retry loading',
        candidatesEmpty: 'No saved candidates yet', candidatesBody: 'Leads that meet your criteria can be kept in the candidate list after discovery.', storedCount: 'Saved candidates', updated: 'Retrieved',
      },
    }

    let opened = false
    const listeners = new Set()
    const emit = () => listeners.forEach(listener => listener())
    const setOpened = value => { opened = value; emit() }
    const openOverlay = () => { window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } })); setOpened(true) }
    const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    const snapshot = () => opened

    async function post(body) {
      const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('lead discovery request failed')
      return response.json()
    }

    function number(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback }
    function platformName(value, t) { return value === 'douyin' ? t('platformDouyin') : value === 'xiaohongshu-v2' ? t('platformXhs') : (value || '—') }
    function formatBudget(min, max) {
      const format = value => value === undefined || value === null || value === '' ? '?' : Number.isFinite(Number(value)) ? `¥${Math.round(Number(value) / 10000 * 10) / 10}万` : String(value)
      return `${format(min)}–${format(max)}`
    }
    function levelName(level) { return ['A', 'B', 'C', 'D'].includes(level) ? level : '—' }
    function deriveStats(items, provided) {
      const values = Array.isArray(items) ? items : []
      const levels = { A: 0, B: 0, C: 0, D: 0 }
      const platforms = new Map()
      const cities = new Map()
      let scoreTotal = 0
      let scoreCount = 0
      let withAction = 0
      values.forEach(item => {
        const level = String(item?.leadLevel || '').toUpperCase()
        if (Object.prototype.hasOwnProperty.call(levels, level)) levels[level] += 1
        if (item?.platform) platforms.set(String(item.platform), (platforms.get(String(item.platform)) || 0) + 1)
        if (item?.city) cities.set(String(item.city), (cities.get(String(item.city)) || 0) + 1)
        if (Number.isFinite(Number(item?.intentScore))) { scoreTotal += Number(item.intentScore); scoreCount += 1 }
        if (item?.recommendedAction) withAction += 1
      })
      const rank = entries => entries.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 6)
      const local = { total: values.length, highIntent: levels.A, avgIntent: scoreCount ? Math.round(scoreTotal / scoreCount) : null, withAction, platformCount: platforms.size, cityCount: cities.size, levels, platforms: rank([...platforms].map(([key, count]) => ({ key, count }))), cities: rank([...cities].map(([key, count]) => ({ key, count }))) }
      if (!provided) return local
      // 文本标注：列表会在分页后累加，动态统计必须以当前已展示样本为准；仅保留服务端提供的可用总量。
      return { ...provided, ...local, total: values.length, totalAvailable: provided.totalAvailable ?? null }
    }

    function SourceBadge({ item, t }) { return h('span', { className: 'yl-source-badge' }, platformName(item.platform, t)) }
    function Metric({ label, value, tone }) { return h('div', { className: `yl-metric yl-metric-${tone || 'neutral'}` }, h('span', null, label), h('strong', null, value === null || value === undefined ? '—' : String(value))) }
    function StatusMessage({ kind, title, body, action, onAction }) {
      const Icon = kind === 'loading' ? IconLoadingOutline16 : kind === 'error' || kind === 'unavailable' ? IconWarningOutline16 : IconDataOutline16
      return h('div', { className: `yl-status-message yl-status-${kind}`, role: kind === 'error' ? 'alert' : undefined }, h('div', { className: 'yl-status-icon' }, h(Icon, { size: 20 })), h('div', null, h('strong', null, title), body ? h('p', null, body) : null, action ? h('button', { type: 'button', onClick: onAction }, action) : null))
    }
    function StatsGrid({ stats, t }) {
      const cityCount = stats.cityCount ?? (Array.isArray(stats.cities) ? stats.cities.length : 0)
      return h('div', { className: 'yl-metrics' }, h(Metric, { label: t('total'), value: stats.total, tone: 'brand' }), h(Metric, { label: t('highIntent'), value: stats.highIntent, tone: 'success' }), h(Metric, { label: t('avgIntent'), value: stats.avgIntent, tone: 'warning' }), h(Metric, { label: t('cities'), value: cityCount, tone: 'neutral' }))
    }
    function Distribution({ stats, t }) {
      const maxLevel = Math.max(1, ...LEVELS.map(level => number(stats.levels?.[level])))
      const maxPlatform = Math.max(1, ...(stats.platforms || []).map(item => number(item.count)))
      const maxCity = Math.max(1, ...(stats.cities || []).map(item => number(item.count)))
      const topCity = stats.cities?.[0]
      return h('div', { className: 'yl-analysis-grid' },
        h('section', { className: 'yl-panel' },
          h('div', { className: 'yl-panel-heading' }, h('h2', null, t('levelDistribution')), h('span', { className: 'yl-panel-meta' }, `${stats.total} ${t('sample')}`)),
          h('div', { className: 'yl-bars' }, LEVELS.map(level => h('div', { className: 'yl-bar-row', key: level },
            h('span', { className: `yl-level yl-level-${level.toLowerCase()}` }, levelName(level)),
            h('div', { className: 'yl-bar-track' }, h('span', { className: `yl-bar yl-bar-${level.toLowerCase()}`, style: { width: `${Math.max(stats.levels?.[level] ? 6 : 0, number(stats.levels?.[level]) / maxLevel * 100)}%` } })),
            h('strong', null, String(number(stats.levels?.[level]))),
            h('small', null, stats.total ? `${Math.round(number(stats.levels?.[level]) / stats.total * 100)}%` : '0%'),
          ))),
          h('div', { className: 'yl-insight' }, h('span', null, t('insight')), h('p', null, stats.highIntent ? `${t('insightText')} ${stats.highIntent} ${t('sample')}` : t('noLeads'))),
        ),
        h('section', { className: 'yl-panel' },
          h('div', { className: 'yl-panel-heading' }, h('h2', null, t('platformDistribution')), h('span', { className: 'yl-panel-meta' }, topCity ? `${t('topCity')} ${topCity.key}` : t('noCity'))),
          (stats.platforms || []).length ? h('div', { className: 'yl-bars' }, stats.platforms.map(item => h('div', { className: 'yl-bar-row yl-platform-row', key: item.key },
            h('span', null, platformName(item.key, t)),
            h('div', { className: 'yl-bar-track' }, h('span', { className: 'yl-bar yl-bar-platform', style: { width: `${Math.max(6, number(item.count) / maxPlatform * 100)}%` } })),
            h('strong', null, String(number(item.count))),
            h('small', null, stats.total ? `${Math.round(number(item.count) / stats.total * 100)}%` : '0%'),
          ))) : h('p', { className: 'yl-muted-block' }, t('noLeads')),
          h('div', { className: 'yl-subsection-heading' }, h('span', null, t('cityDistribution'))),
          (stats.cities || []).length ? h('div', { className: 'yl-bars' }, stats.cities.slice(0, 4).map(item => h('div', { className: 'yl-bar-row yl-platform-row', key: `city-${item.key}` },
            h('span', null, item.key),
            h('div', { className: 'yl-bar-track' }, h('span', { className: 'yl-bar yl-bar-city', style: { width: `${Math.max(6, number(item.count) / maxCity * 100)}%` } })),
            h('strong', null, String(number(item.count))),
            h('small', null, stats.total ? `${Math.round(number(item.count) / stats.total * 100)}%` : '0%'),
          ))) : h('p', { className: 'yl-muted-block' }, t('noCity')),
        ),
      )
    }
    function LeadCard({ item, t }) {
      const score = Number.isFinite(Number(item.intentScore)) ? Math.max(0, Math.min(100, Number(item.intentScore))) : null
      return h('article', { className: 'yl-card' },
        h('div', { className: 'yl-card-head' }, h('div', { className: 'yl-card-title' }, h('span', { className: `yl-level yl-level-${String(item.leadLevel || '').toLowerCase()}` }, levelName(String(item.leadLevel || '').toUpperCase())), h(SourceBadge, { item, t })), score === null ? null : h('div', { className: 'yl-score-wrap' }, h('span', null, `${t('intent')} ${score}`), h('div', { className: 'yl-score-track' }, h('span', { style: { width: `${score}%` } })))),
        h('p', { className: `yl-summary${item.aiSummary ? '' : ' yl-summary-empty'}` }, item.aiSummary || t('noSummary')),
        h('div', { className: 'yl-tags' }, item.city ? h('span', null, `${t('city')} ${item.city}`) : null, (item.budgetMin !== undefined || item.budgetMax !== undefined) ? h('span', null, `${t('budget')} ${formatBudget(item.budgetMin, item.budgetMax)}`) : null, item.purchaseTiming ? h('span', null, `${t('timing')} ${item.purchaseTiming}`) : null),
        h('div', { className: 'yl-card-foot' }, h('p', { className: item.recommendedAction ? 'yl-action' : 'yl-action yl-action-empty' }, `${t('action')}：${item.recommendedAction || t('noAction')}`), item.sourceUrl ? h('a', { className: 'yl-link', href: item.sourceUrl, target: '_blank', rel: 'noreferrer' }, h(IconLinkOutline16, { size: 14 }), t('source')) : null),
      )
    }
    function LeadList({ items, stats, t }) {
      const [level, setLevel] = useState('all')
      const [sort, setSort] = useState('intent')
      const filtered = items.filter(item => level === 'all' || String(item.leadLevel || '').toUpperCase() === level).slice().sort((a, b) => sort === 'intent' ? number(b.intentScore, -1) - number(a.intentScore, -1) : 0)
      const availableLabel = stats.totalAvailable && stats.totalAvailable > stats.total ? ` · ${t('totalAvailable')} ${stats.totalAvailable}` : ''
      return h('section', { className: 'yl-list-section' }, h('div', { className: 'yl-list-heading' }, h('div', null, h('h2', null, t('leads')), h('span', { className: 'yl-panel-meta' }, `${filtered.length} / ${stats.total} ${t('sample')}${availableLabel}`)), h('div', { className: 'yl-list-controls' }, h('div', { className: 'yl-segmented', role: 'group', 'aria-label': t('filter') }, h('button', { type: 'button', 'aria-pressed': level === 'all', className: level === 'all' ? 'is-active' : '', onClick: () => setLevel('all') }, t('allLevels')), LEVELS.map(item => h('button', { type: 'button', key: item, 'aria-pressed': level === item, className: level === item ? 'is-active' : '', onClick: () => setLevel(item) }, item))), h('label', { className: 'yl-sort' }, h('span', null, t('sort')), h('select', { value: sort, onChange: event => setSort(event.target.value), 'aria-label': t('sort') }, h('option', { value: 'intent' }, t('sortIntent')), h('option', { value: 'recent' }, t('sortRecent')))))), filtered.length ? h('div', { className: 'yl-list' }, filtered.map((item, index) => h(LeadCard, { key: `${item.sourceUrl || item.aiSummary || 'lead'}-${index}`, item, t }))) : h('div', { className: 'yl-empty-list' }, h(IconDataOutline16, { size: 22 }), h('p', null, items.length ? t('noFilteredLeads') : t('noLeads'))))
    }
    function SearchPanelRedesigned({ query, setQuery, platform, setPlatform, busy, onRun, t, hasResult }) {
      const examples = [t('example1'), t('example2'), t('example3')]
      return h('section', { className: `yl-search-panel${hasResult ? ' yl-search-compact' : ''}` },
        h('div', { className: 'yl-search-intro' }, h('div', { className: 'yl-search-eyebrow' }, h('span', { className: 'yl-eyebrow-line' }), t('discover')), h('h2', null, t('searchHeading')), h('p', null, t('searchBody'))),
        h('div', { className: 'yl-search-row' },
          h('div', { className: 'yl-platform-picker' }, h('span', { className: 'yl-field-label' }, t('platform')), h('div', { className: 'yl-platform-options', role: 'group', 'aria-label': t('platform') }, [['xiaohongshu-v2', t('platformXhs')], ['douyin', t('platformDouyin')]].map(([value, label]) => h('button', { type: 'button', key: value, className: platform === value ? 'is-active' : '', 'aria-pressed': platform === value, onClick: () => setPlatform(value) }, label)))),
          h('div', { className: 'yl-query-wrap' }, h('input', { value: query, maxLength: 500, placeholder: t('placeholder'), onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') onRun() }, 'aria-label': t('placeholder') }), h('button', { type: 'button', className: 'yl-primary', onClick: onRun, disabled: busy || !query.trim() }, h(IconSearchOutline16, { size: 16 }), busy ? t('searching') : t('search')))),
        h('p', { className: 'yl-privacy' }, t('privacy')),
        !query ? h('div', { className: 'yl-examples' }, h('span', null, t('examples')), examples.map(example => h('button', { type: 'button', key: example, onClick: () => setQuery(example) }, example))) : null)
    }

    function EmptyStateRedesigned({ t, onExample }) {
      return h('section', { className: 'yl-empty-state' },
        h('div', { className: 'yl-empty-copy' }, h('div', { className: 'yl-empty-mark' }, h(IconSearchOutline16, { size: 24 })), h('h2', null, t('emptyTitle')), h('p', null, t('emptyBody')), h('button', { type: 'button', onClick: onExample }, t('example1'))),
        h('div', { className: 'yl-start-steps' }, [['01', t('discover'), t('platform')], ['02', t('distribution'), t('levelDistribution')], ['03', t('insight'), t('action')]].map(([number, title, body]) => h('div', { className: 'yl-start-step', key: number }, h('strong', null, number), h('div', null, h('span', null, title), h('small', null, body)))))
      )
    }

    function Overlay({ t }) {
      const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
      const [tab, setTab] = useState('discover')
      const [query, setQuery] = useState('')
      const [platform, setPlatform] = useState('xiaohongshu-v2')
      const [busy, setBusy] = useState(false)
      const [loadingMore, setLoadingMore] = useState(false)
      const [loadMoreError, setLoadMoreError] = useState(false)
      const [data, setData] = useState(null)
      const [items, setItems] = useState([])
      const [candidates, setCandidates] = useState(null)
      const [candidateItems, setCandidateItems] = useState([])
      const [candidateBusy, setCandidateBusy] = useState(false)
      useEffect(() => {
        if (!visible) return undefined
        const onKeyDown = event => { if (event.key === 'Escape') setOpened(false) }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [visible])
      if (!visible) return null
      const run = async () => { if (!query.trim() || busy) return; setBusy(true); setLoadMoreError(false); setTab('discover'); try { const response = await post({ action: 'discover', keyword: query.trim(), platform }); setData(response); setItems(Array.isArray(response.items) ? response.items : []) } catch { setData({ status: 'error' }); setItems([]) } finally { setBusy(false) } }
      const loadMore = async () => { if (loadingMore || !data?.resultRef || !data?.hasMore) return; setLoadingMore(true); setLoadMoreError(false); try { const response = await post({ action: 'page', resultRef: data.resultRef, cursor: data.nextCursor }); if (response.status !== 'ready') throw new Error(response.reason || 'lead discovery page unavailable'); setData(prev => ({ ...prev, nextCursor: response.nextCursor, hasMore: response.hasMore, stats: { totalAvailable: prev.totalAvailable ?? prev.stats?.totalAvailable ?? null } })); setItems(prev => prev.concat(response.items || [])) } catch { setLoadMoreError(true) } finally { setLoadingMore(false) } }
      const loadCandidates = async (force = false) => { setTab('saved'); if (candidates && !force) return; setCandidateBusy(true); try { const response = await post({ action: 'candidates' }); setCandidates(response); setCandidateItems(Array.isArray(response.items) ? response.items : []) } catch { setCandidates({ status: 'error' }); setCandidateItems([]) } finally { setCandidateBusy(false) } }
      const refresh = () => tab === 'saved' ? loadCandidates(true) : run()
      const stats = deriveStats(tab === 'saved' ? candidateItems : items, tab === 'saved' ? candidates?.stats : data?.stats)
      const state = tab === 'saved' ? candidates?.status : data?.status
      let body
      if (tab === 'saved' && candidateBusy) body = h(StatusMessage, { kind: 'loading', title: t('loading') })
      else if (tab === 'saved' && state === 'error') body = h(StatusMessage, { kind: 'error', title: candidates?.reason === 'RESULT_STORE_UNAVAILABLE' || candidates?.reason === 'INTERNAL_ERROR' ? t('storeUnavailable') : t('error'), action: t('retry'), onAction: () => loadCandidates(true) })
      else if (tab === 'saved' && state === 'unavailable') body = h(StatusMessage, { kind: 'unavailable', title: t('unavailable') })
      else if (tab === 'saved' && !candidateItems.length) body = h(StatusMessage, { kind: 'empty', title: t('candidatesEmpty'), body: t('candidatesBody') })
      else if (tab === 'discover' && busy) body = h(StatusMessage, { kind: 'loading', title: t('searching') })
      else if (tab === 'discover' && !data) body = h(EmptyStateRedesigned, { t, onExample: () => { setQuery(t('example1')) } })
      else if (tab === 'discover' && state === 'error') body = h(StatusMessage, { kind: 'error', title: t('error'), action: t('retry'), onAction: run })
      else if (tab === 'discover' && state === 'unavailable') body = h(StatusMessage, { kind: 'unavailable', title: t('unavailable') })
      else if (!items.length && tab === 'discover') body = h(StatusMessage, { kind: 'empty', title: t('noLeads') })
      else body = h(React.Fragment, null, h(StatsGrid, { stats, t }), h(Distribution, { stats, t }), h(LeadList, { items: tab === 'saved' ? candidateItems : items, stats, t }), tab === 'discover' && data?.hasMore ? h('div', { className: 'yl-more' }, loadMoreError ? h('span', { role: 'alert' }, t('loadMoreError')) : null, h('button', { type: 'button', onClick: loadMore, disabled: loadingMore }, loadingMore ? t('loading') : loadMoreError ? t('retryLoadMore') : t('loadMore'))) : null)
      const refreshDisabled = busy || candidateBusy || (tab === 'discover' && !query.trim())
      return h('div', { className: 'yl-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'yl-title' }, h('main', { className: 'yl-shell' }, h('header', { className: 'yl-header' }, h('div', null, h('div', { className: 'yl-title-row' }, h('h1', { id: 'yl-title' }, t('title')), state === 'ready' ? h('span', { className: 'yl-ready-dot', 'aria-hidden': true }, '●') : null), h('p', null, t('subtitle'))), h('div', { className: 'yl-header-actions' }, h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', 'aria-label': t('refresh'), onClick: refresh, disabled: refreshDisabled }, h(IconRefreshOutline16, { size: 17 }))), h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 17 }))))), h('nav', { className: 'yl-tabs', role: 'tablist', 'aria-label': t('title') }, h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'discover', className: tab === 'discover' ? 'is-active' : '', onClick: () => setTab('discover') }, h(IconSearchOutline16, { size: 15 }), t('discover')), h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'saved', className: tab === 'saved' ? 'is-active' : '', onClick: () => loadCandidates() }, h(IconDataOutline16, { size: 15 }), t('saved'), candidates?.count !== null && candidates?.count !== undefined ? h('span', { className: 'yl-tab-count' }, String(candidates.count)) : null)), h('div', { className: 'yl-content' }, tab === 'discover' ? h(SearchPanelRedesigned, { query, setQuery, platform, setPlatform, busy, onRun: run, t, hasResult: Boolean(data) }) : null, body, tab === 'discover' && data?.retrievedAt ? h('p', { className: 'yl-updated' }, `${t('updated')}: ${data.retrievedAt}`) : null)))
    }

    function Button({ wide, t }) { return h(Tooltip, { label: t('open'), disabled: wide }, h('button', { type: 'button', className: `yl-button${wide ? ' yl-wide' : ''}`, 'aria-label': t('open'), onClick: openOverlay }, h(IconSearchOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }

    // 文本标注：CSS 与视图同处一文件，构建脚本会将源码原样注入客户端。
    const css = `.yl-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.yl-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yl-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yl-wide span{font-size:13px}.yl-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yl-shell{display:grid;grid-template-rows:auto auto minmax(0,1fr);width:100%;height:100%;overflow:hidden}.yl-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px max(24px,calc((100vw - 1200px)/2));border-bottom:1px solid var(--dsw-alias-border-l1)}.yl-header h1{margin:0;font-size:22px;letter-spacing:0}.yl-title-row{display:flex;align-items:center;gap:8px}.yl-header p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yl-ready-dot{color:var(--dsw-alias-state-success-primary);font-size:11px}.yl-header-actions{display:flex;gap:8px}.yl-header-actions button{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yl-header-actions button:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.yl-header-actions button:disabled{opacity:.45;cursor:default}.yl-tabs{display:flex;gap:4px;padding:0 max(24px,calc((100vw - 1200px)/2));border-bottom:1px solid var(--dsw-alias-border-l1)}.yl-tabs button{display:inline-flex;align-items:center;gap:7px;height:44px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}.yl-tabs button.is-active{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yl-tab-count{display:inline-grid;min-width:18px;height:18px;place-items:center;padding:0 5px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);font-size:11px}.yl-content{width:min(1200px,100%);margin:0 auto;padding:24px max(24px,calc((100vw - 1200px)/2)) 44px;overflow:auto}.yl-search-panel{display:grid;gap:10px;margin-bottom:22px}.yl-search-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px}.yl-platform,.yl-query-wrap{display:flex;min-width:0}.yl-platform{position:relative}.yl-platform span{position:absolute;top:6px;left:12px;color:var(--dsw-alias-label-tertiary);font-size:10px;pointer-events:none}.yl-platform select{width:100%;padding:17px 11px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.yl-query-wrap{gap:8px}.yl-query-wrap input{flex:1;min-width:0;padding:0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.yl-query-wrap input:focus,.yl-platform select:focus{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 32%,transparent);outline-offset:1px}.yl-primary{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:106px;padding:0 16px;border:0;border-radius:7px;background:var(--dsw-alias-control-fill-brand);color:#fff;font:inherit;cursor:pointer}.yl-primary:disabled{opacity:.5;cursor:default}.yl-privacy,.yl-updated{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.yl-examples{display:flex;align-items:center;flex-wrap:wrap;gap:7px;color:var(--dsw-alias-label-tertiary);font-size:12px}.yl-examples button{padding:5px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.yl-examples button:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.yl-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.yl-metric{display:grid;gap:6px;min-height:92px;align-content:center;padding:15px 18px;border-right:1px solid var(--dsw-alias-border-l1);border-top:3px solid transparent}.yl-metric:last-child{border-right:0}.yl-metric span{color:var(--dsw-alias-label-secondary);font-size:12px}.yl-metric strong{font-size:26px;font-variant-numeric:tabular-nums;line-height:1}.yl-metric-brand{border-top-color:var(--dsw-alias-brand-primary)}.yl-metric-brand strong{color:var(--dsw-alias-brand-primary)}.yl-metric-success{border-top-color:var(--dsw-alias-state-success-primary)}.yl-metric-success strong{color:var(--dsw-alias-state-success-primary)}.yl-metric-warning{border-top-color:var(--dsw-alias-state-warning-primary)}.yl-metric-warning strong{color:var(--dsw-alias-state-warning-primary)}.yl-analysis-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.yl-panel{display:grid;align-content:start;gap:14px;padding:17px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yl-panel-heading,.yl-list-heading,.yl-card-head,.yl-card-foot{display:flex;align-items:center;justify-content:space-between;gap:12px}.yl-panel-heading h2,.yl-list-heading h2{margin:0;font-size:14px;letter-spacing:0}.yl-panel-meta{color:var(--dsw-alias-label-tertiary);font-size:11px}.yl-bars{display:grid;gap:11px}.yl-bar-row{display:grid;grid-template-columns:26px minmax(0,1fr) 28px;align-items:center;gap:9px;font-size:12px}.yl-platform-row{grid-template-columns:92px minmax(0,1fr) 28px}.yl-bar-row>span:not(.yl-level){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}.yl-bar-track,.yl-score-track{height:8px;overflow:hidden;border-radius:99px;background:var(--dsw-alias-bg-layer-3)}.yl-bar{display:block;height:100%;min-width:0;border-radius:99px;background:var(--dsw-alias-brand-primary)}.yl-bar-a{background:var(--dsw-alias-state-success-primary)}.yl-bar-b{background:var(--dsw-alias-brand-primary)}.yl-bar-c{background:var(--dsw-alias-state-warning-primary)}.yl-bar-d{background:var(--dsw-alias-label-tertiary)}.yl-bar-platform{background:var(--dsw-alias-brand-primary)}.yl-level{display:inline-flex;min-width:24px;height:24px;align-items:center;justify-content:center;padding:0 6px;border-radius:5px;font-size:12px;font-weight:700}.yl-level-a{background:var(--dsw-alias-state-success-primary);color:#fff}.yl-level-b{background:var(--dsw-alias-brand-primary);color:#fff}.yl-level-c{background:var(--dsw-alias-state-warning-primary);color:#fff}.yl-level-d{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}.yl-insight{display:grid;gap:4px;padding:10px 11px;border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}.yl-insight span{color:var(--dsw-alias-label-secondary);font-size:11px}.yl-insight p{margin:0;font-size:12px;line-height:1.55}.yl-muted-block{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}.yl-list-section{display:grid;gap:13px;margin-top:22px}.yl-list-heading{align-items:flex-start}.yl-list-heading>div:first-child{display:grid;gap:4px}.yl-list-controls{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:10px}.yl-segmented{display:flex;gap:2px;padding:2px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}.yl-segmented button{min-width:34px;height:27px;padding:0 8px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.yl-segmented button.is-active{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);color:var(--dsw-alias-label-primary);font-weight:650}.yl-sort{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px}.yl-sort select{padding:5px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit}.yl-list{display:grid;gap:10px}.yl-card{display:grid;gap:11px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yl-card:hover{border-color:var(--dsw-alias-border-l2)}.yl-card-title{display:flex;align-items:center;gap:9px}.yl-source-badge{padding:4px 7px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}.yl-score-wrap{display:grid;grid-template-columns:auto 90px;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}.yl-score-track{height:5px}.yl-score-track span{display:block;height:100%;border-radius:99px;background:var(--dsw-alias-brand-primary)}.yl-summary{margin:0;font-size:14px;line-height:1.6}.yl-summary-empty,.yl-action-empty{color:var(--dsw-alias-label-tertiary)!important}.yl-tags{display:flex;flex-wrap:wrap;gap:7px}.yl-tags span{padding:4px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yl-card-foot{align-items:flex-end}.yl-action{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.yl-link{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;color:var(--dsw-alias-brand-primary);font-size:12px;text-decoration:none}.yl-link:hover{text-decoration:underline}.yl-more{display:flex;justify-content:center;padding:14px 0}.yl-more button{min-height:34px;padding:0 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.yl-more button:disabled{opacity:.5;cursor:default}.yl-status-message,.yl-empty-state{display:flex;align-items:flex-start;gap:13px;min-height:220px;justify-content:center;flex-direction:column;padding:48px 12px;color:var(--dsw-alias-label-secondary)}.yl-status-message>div:last-child,.yl-empty-state>div:last-child{display:grid;gap:7px}.yl-status-message strong,.yl-empty-state h2{color:var(--dsw-alias-label-primary);font-size:16px}.yl-status-message p,.yl-empty-state p{margin:0;max-width:480px;font-size:13px;line-height:1.6}.yl-status-icon,.yl-empty-mark{display:grid;width:38px;height:38px;place-items:center;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}.yl-status-loading .yl-status-icon{animation:yl-pulse 1.2s ease-in-out infinite}.yl-status-error .yl-status-icon{color:var(--dsw-alias-state-error-primary)}.yl-status-message button,.yl-empty-state button{justify-self:start;min-height:32px;padding:0 12px;border:1px solid var(--dsw-alias-brand-primary);border-radius:6px;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;cursor:pointer}.yl-empty-state{align-items:center;text-align:center}.yl-empty-state h2{margin:0}.yl-empty-state button{margin-top:4px}.yl-empty-list{display:grid;min-height:140px;place-items:center;align-content:center;gap:7px;color:var(--dsw-alias-label-tertiary);text-align:center}.yl-empty-list p{margin:0;font-size:13px}.yl-updated{margin-top:16px;text-align:right}@keyframes yl-pulse{50%{opacity:.45}}@media(max-width:900px){.yl-header{padding-left:20px;padding-right:20px}.yl-tabs{padding-left:20px;padding-right:20px}.yl-content{padding-left:20px;padding-right:20px}.yl-analysis-grid{grid-template-columns:1fr}}@media(max-width:680px){.yl-header{padding:16px}.yl-header h1{font-size:18px}.yl-header p{display:none}.yl-content{padding:16px 16px 32px}.yl-tabs{padding:0 16px}.yl-search-row{grid-template-columns:1fr}.yl-platform select{padding-top:17px}.yl-query-wrap{flex-direction:column}.yl-query-wrap input{min-height:40px;padding:0 11px}.yl-primary{min-height:38px}.yl-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yl-metric{min-height:76px;padding:12px}.yl-metric:nth-child(2){border-right:0}.yl-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.yl-metric strong{font-size:21px}.yl-list-heading{display:grid}.yl-list-controls{justify-content:flex-start}.yl-card-head{align-items:flex-start}.yl-score-wrap{grid-template-columns:auto 72px}.yl-card-foot{align-items:flex-start;flex-direction:column}.yl-link{min-height:28px}.yl-updated{text-align:left}}`

    const distributionLayoutCss = `.yl-bar-row{grid-template-columns:26px minmax(0,1fr) 28px 38px}.yl-platform-row{grid-template-columns:92px minmax(0,1fr) 28px 38px}.yl-bar-row small{color:var(--dsw-alias-label-tertiary);font-size:10px;text-align:right}.yl-subsection-heading{padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px}.yl-bar-city{background:var(--dsw-alias-state-success-primary)}.yl-more{flex-wrap:wrap;align-items:center;gap:10px}.yl-more span{color:var(--dsw-alias-state-error-primary);font-size:12px}.yl-search-intro{display:grid;gap:7px;max-width:680px}.yl-search-intro h2{margin:0;font-size:24px;letter-spacing:0}.yl-search-intro p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55}.yl-search-eyebrow{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-brand-primary);font-size:11px;font-weight:650;text-transform:uppercase}.yl-eyebrow-line{width:18px;height:2px;background:var(--dsw-alias-brand-primary)}.yl-search-compact .yl-search-intro{display:none}.yl-platform-picker{display:grid;align-content:center;gap:6px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1)}.yl-field-label{color:var(--dsw-alias-label-tertiary);font-size:10px}.yl-platform-options{display:flex;gap:4px}.yl-platform-options button{min-height:25px;padding:0 8px;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.yl-platform-options button.is-active{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-label-primary);font-weight:650}.yl-empty-state{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,1fr);align-items:center;gap:40px;min-height:300px;padding:36px 8px}.yl-empty-copy{display:grid;gap:10px;max-width:480px}.yl-empty-copy .yl-empty-mark{margin-bottom:2px}.yl-empty-copy h2{margin:0;font-size:22px}.yl-empty-copy p{margin:0;max-width:420px}.yl-empty-copy button{justify-self:start}.yl-start-steps{display:grid;gap:10px;padding-left:22px;border-left:1px solid var(--dsw-alias-border-l1)}.yl-start-step{display:grid;grid-template-columns:32px 1fr;align-items:start;gap:10px;padding:10px 0}.yl-start-step strong{color:var(--dsw-alias-brand-primary);font-size:12px;font-variant-numeric:tabular-nums}.yl-start-step div{display:grid;gap:3px}.yl-start-step span{font-size:13px;color:var(--dsw-alias-label-primary)}.yl-start-step small{color:var(--dsw-alias-label-tertiary);font-size:11px}.yl-panel,.yl-metrics,.yl-card{box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}@media(max-width:680px){.yl-search-intro h2{font-size:20px}.yl-empty-state{grid-template-columns:1fr;gap:24px;min-height:0;padding:28px 8px}.yl-start-steps{padding:14px 0 0;border-top:1px solid var(--dsw-alias-border-l1);border-left:0}.yl-platform-picker{padding:10px 12px}.yl-platform-options{flex-wrap:wrap}}`
    function apply(ctx) { ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-lead-discovery: dictionaries'); ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-yootun-lead-discovery: exclusive-overlay'); ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-lead-discovery'; style.textContent = css + distributionLayoutCss; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-lead-discovery: styles'); const t = ctx.locale.bind(NS); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-lead-discovery', order: 35, inject: () => ({ t }) }, Button)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-lead-discovery', order: 35, inject: () => ({ t }) }, Overlay)) }
    module.exports = { apply, inject: ['slots', 'locale'] }

    return module.exports;
  },
});
