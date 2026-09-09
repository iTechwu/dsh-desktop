const React = require('react')
const { createElement: h, useEffect, useRef, useState, useSyncExternalStore } = React
const {
  IconCloseOutline16,
  IconDataOutline16,
  IconDatabaseOutline16,
  IconLinkOutline16,
  IconLoadingOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  Tooltip,
} = require('@deepseek-ai/dsh-client-ui-primitives')

const NS = 'dofe.yootun-retrofit'
const PATH = '/api/desktop/yootun/retrofit'
const OVERLAY_ID = '@dofe/dsh-yootun-retrofit'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const PLATFORMS = ['xiaohongshu-v2', 'douyin', 'kuaishou', 'bilibili', 'weibo', 'toutiao', 'lemon8', 'youtube']
const copy = {
  zh: {
        open: '改装方案库', title: '车辆改装方案库', subtitle: '案例来自定时入库数据，公开检索仅作临时参考', close: '关闭改装方案库', search: '筛选方案库', refresh: '刷新公开来源', refreshing: '正在检索', placeholder: '输入车型、改装项目或使用场景', allPlatforms: '全部平台', platform: '内容平台', sourceSaved: '定时入库数据', sourceExternal: '即时公开检索', sourceLabel: '数据来源', updated: '数据时间', privacy: '列表、统计和详情只读取数据库；“刷新公开来源”不会写入案例库。执行改装前请人工核验方案与配件信息。', total: '方案总量', returned: '当前结果', coverage: '平台覆盖', engagement: '互动数据完整', records: '条', platforms: '个平台', listTitle: '改装内容', listHint: '按发布时间优先展示，标题、正文与互动来自公开页面。', emptyTitle: '方案库正在积累', emptyBody: '定时任务会持续采集并写入公开改装内容，当前不会自动发起外部检索。', noMatchesTitle: '方案库中暂无匹配结果', noMatchesBody: '可调整筛选条件；需要临时参考时，请点击“刷新公开来源”。', unavailableTitle: '改装数据暂不可用', unavailableBody: '数据库读取没有成功，未自动发起外部检索。', errorTitle: '查询失败', errorBody: '当前结果未更新，请稍后重试。', externalTitle: '公开来源参考', externalBody: '这些内容来自即时检索，尚未进入定时方案库，也不会计入案例统计。', comments: '评论', shares: '互动', openSource: '查看原文', untitled: '未命名改装内容', noText: '暂无正文摘要', queryExamples: '常用筛选', example1: '新能源车改装', example2: '二手车整备', example3: 'SUV 灯光升级', rawExternal: '检索结果', platformXhs: '小红书', platformDouyin: '抖音', platformKuaishou: '快手', platformBilibili: '哔哩哔哩', platformWeibo: '微博', platformToutiao: '今日头条', platformLemon8: 'Lemon8', platformYoutube: 'YouTube',
  },
  en: {
        open: 'Retrofit library', title: 'Vehicle retrofit library', subtitle: 'Cases come from scheduled storage; public search is temporary reference only', close: 'Close retrofit library', search: 'Filter library', refresh: 'Refresh public sources', refreshing: 'Searching', placeholder: 'Enter a vehicle, retrofit project, or use case', allPlatforms: 'All platforms', platform: 'Platform', sourceSaved: 'Scheduled stored data', sourceExternal: 'Live public search', sourceLabel: 'Data source', updated: 'Data time', privacy: 'Lists, metrics, and details always read from the database. “Refresh public sources” does not write to the case library. Verify plans and parts before work.', total: 'Total plans', returned: 'Current results', coverage: 'Platform coverage', engagement: 'Engagement complete', records: 'items', platforms: 'platforms', listTitle: 'Retrofit content', listHint: 'Newest public content first, with title, summary, and engagement when available.', emptyTitle: 'The library is being built', emptyBody: 'Scheduled collection will keep adding public retrofit content. No external search starts automatically.', noMatchesTitle: 'No saved result matches', noMatchesBody: 'Adjust the filters or use “Refresh public sources” for temporary references.', unavailableTitle: 'Retrofit data unavailable', unavailableBody: 'The database read failed, so no public search was started automatically.', errorTitle: 'Query failed', errorBody: 'Current results were not updated. Try again later.', externalTitle: 'Public-source references', externalBody: 'These results came from a live search, are not stored, and are excluded from case metrics.', comments: 'Comments', shares: 'Engagement', openSource: 'Open source', untitled: 'Untitled retrofit content', noText: 'No summary available', queryExamples: 'Common filters', example1: 'EV retrofit', example2: 'Used-car reconditioning', example3: 'SUV lighting upgrade', rawExternal: 'Search result', platformXhs: 'Xiaohongshu', platformDouyin: 'Douyin', platformKuaishou: 'Kuaishou', platformBilibili: 'Bilibili', platformWeibo: 'Weibo', platformToutiao: 'Toutiao', platformLemon8: 'Lemon8', platformYoutube: 'YouTube',
  },
}
const PLATFORM_LABELS = { 'xiaohongshu-v2': 'platformXhs', douyin: 'platformDouyin', kuaishou: 'platformKuaishou', bilibili: 'platformBilibili', weibo: 'platformWeibo', toutiao: 'platformToutiao', lemon8: 'platformLemon8', youtube: 'platformYoutube' }

let opened = false
let lastTrigger = null
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
const setOpened = value => { opened = value; emit() }
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => opened
const openOverlay = event => { lastTrigger = event?.currentTarget || document.activeElement; window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } })); setOpened(true) }
const closeOverlay = () => { setOpened(false); requestAnimationFrame(() => lastTrigger?.focus?.()) }
const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }
const closeOnEscape = event => { if (opened && event.key === 'Escape') closeOverlay() }

async function post(body) {
  const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error('retrofit request failed')
  return response.json()
}
function platformName(value, t) { return PLATFORM_LABELS[value] ? t(PLATFORM_LABELS[value]) : (value || '—') }
function displayTime(value) { if (!value) return null; return String(value).replace('T', ' ').replace(/\.\d{3,6}(?=Z|[+-]\d\d:\d\d$)/, '').replace(/Z$/, '') }
function getStoredItems(data) { return Array.isArray(data?.result?.items) ? data.result.items : [] }
function getStats(data) {
  const items = getStoredItems(data)
  const platforms = new Set(items.map(item => item?.platform).filter(Boolean))
  const engagement = items.filter(item => (item?.commentCount !== null && item?.commentCount !== undefined) || (item?.shareCount !== null && item?.shareCount !== undefined)).length
  return { total: Number(data?.result?.total) || 0, returned: Number(data?.result?.returned) || items.length, platforms: platforms.size, engagement }
}
function parseExternalItems(result) {
  const stdout = String(result?.stdout || '').trim()
  if (!stdout) return []
  try {
    const payload = JSON.parse(stdout)
    const values = Array.isArray(payload) ? payload : payload.results || payload.data || payload.items || []
    if (Array.isArray(values)) return values.slice(0, 12).map((item, index) => typeof item === 'string' ? { title: item, text: '', url: '' } : { title: item.title || item.name || `#${index + 1}`, text: item.text || item.snippet || item.description || '', url: item.url || item.link || '' })
  } catch {}
  const urls = stdout.match(/https?:\/\/[^\s)\]}]+/g) || []
  if (urls.length) return [...new Set(urls)].slice(0, 12).map((url, index) => ({ title: `#${index + 1}`, text: '', url }))
  return [{ title: '', text: stdout.slice(0, 12000), url: '' }]
}

function SourceBar({ data, t }) {
  const external = data?.source === 'agent_reach'
  const timestamp = data?.result?.retrievedAt || data?.retrievedAt
  return h('div', { className: `yro-source-bar ${external ? 'is-external' : ''}` }, h('span', { className: 'yro-source-dot', 'aria-hidden': true }), h('span', null, `${t('sourceLabel')}：${t(external ? 'sourceExternal' : 'sourceSaved')}`), timestamp ? h('span', { className: 'yro-source-time' }, `${t('updated')}：${displayTime(timestamp)}`) : null)
}
function safeExternalUrl(value) { if (typeof value !== 'string' || value.length > 2048) return null; try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null } catch { return null } }
function Metrics({ data, t }) {
  const stats = getStats(data)
  const values = [[t('total'), stats.total, t('records')], [t('returned'), stats.returned, t('records')], [t('coverage'), stats.platforms, t('platforms')], [t('engagement'), stats.engagement, t('records')]]
  return h('section', { className: 'yro-metrics', 'aria-label': t('sourceSaved') }, values.map(([label, value, unit]) => h('div', { className: 'yro-metric', key: label }, h('span', null, label), h('strong', null, value), h('small', null, unit))))
}
function ResultItem({ item, t }) {
  const sourceUrl = safeExternalUrl(item.sourceUrl)
  return h('article', { className: 'yro-item' }, h('div', { className: 'yro-item-main' }, h('div', { className: 'yro-item-head' }, h('span', { className: 'yro-platform' }, platformName(item.platform, t)), item.publishedAt ? h('time', null, displayTime(item.publishedAt)) : null), h('h3', null, item.title || item.text || t('untitled')), h('p', null, item.text && item.text !== item.title ? item.text : t('noText'))), h('div', { className: 'yro-item-side' }, h('div', { className: 'yro-counts' }, h('span', null, h('b', null, item.commentCount ?? '—'), t('comments')), h('span', null, h('b', null, item.shareCount ?? '—'), t('shares'))), sourceUrl ? h('a', { href: sourceUrl, target: '_blank', rel: 'noreferrer' }, h(IconLinkOutline16, { size: 14 }), t('openSource')) : null))
}
function EmptyState({ matched, t, onExample }) {
  return h('div', { className: 'yro-empty', role: 'status' }, h('span', { className: 'yro-empty-icon' }, h(IconDatabaseOutline16, { size: 22 })), h('h3', null, t(matched ? 'noMatchesTitle' : 'emptyTitle')), h('p', null, t(matched ? 'noMatchesBody' : 'emptyBody')), h('div', { className: 'yro-examples' }, h('span', null, t('queryExamples')), ['example1', 'example2', 'example3'].map(key => h('button', { type: 'button', key, onClick: () => onExample(t(key)) }, t(key)))))
}
function StoredResults({ data, t, onExample }) {
  const items = getStoredItems(data)
  return h(React.Fragment, null, h(SourceBar, { data, t }), h(Metrics, { data, t }), h('div', { className: 'yro-section-head' }, h('div', null, h('h2', null, t('listTitle')), h('p', null, t('listHint')))), items.length ? h('div', { className: 'yro-list' }, items.map((item, index) => h(ResultItem, { item, t, key: `${item.platform || 'item'}-${item.externalId || index}` }))) : h(EmptyState, { matched: Boolean(data.query), t, onExample }))
}
function ExternalResults({ data, t }) {
  const items = parseExternalItems(data.result)
  const note = h(
    'div',
    { className: 'yro-external-note' },
    h(IconWarningOutline16, { size: 17 }),
    h('div', null, h('h2', null, t('externalTitle')), h('p', null, t('externalBody'))),
  )
  const list = h(
    'div',
    { className: 'yro-list' },
    items.map((item, index) => {
      const sourceUrl = safeExternalUrl(item.url)
      const sourceLink = sourceUrl
        ? h(
          'div',
          { className: 'yro-item-side' },
          h(
            'a',
            { href: sourceUrl, target: '_blank', rel: 'noreferrer' },
            h(IconLinkOutline16, { size: 14 }),
            t('openSource'),
          ),
        )
        : null
      return h(
        'article',
        { className: 'yro-item yro-external-item', key: `${item.url || item.title}-${index}` },
        h(
          'div',
          { className: 'yro-item-main' },
          h(
            'div',
            { className: 'yro-item-head' },
            h('span', { className: 'yro-platform' }, data.platform ? platformName(data.platform, t) : t('rawExternal')),
          ),
          h('h3', null, item.title || t('rawExternal')),
          item.text ? h('p', null, item.text) : null,
        ),
        sourceLink,
      )
    }),
  )
  return h(React.Fragment, null, h(SourceBar, { data, t }), note, list)
}
function StateMessage({ kind, t, onRetry, busy }) {
  const unavailable = kind === 'unavailable'
  return h('div', { className: 'yro-state', role: 'alert' }, h('span', { className: 'yro-state-icon' }, h(IconWarningOutline16, { size: 22 })), h('h2', null, t(unavailable ? 'unavailableTitle' : 'errorTitle')), h('p', null, t(unavailable ? 'unavailableBody' : 'errorBody')), h('button', { type: 'button', disabled: busy, onClick: onRetry }, h(IconRefreshOutline16, { size: 15 }), t('search')))
}
function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
  const shellRef = useRef(null)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('')
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const load = async action => { if (busyRef.current) return null; busyRef.current = true; setBusy(true); try { const next = await post({ action, query, platform: platform || undefined }); setData(next); return next } catch { setData({ status: 'error' }); return null } finally { busyRef.current = false; setBusy(false) } }
  useEffect(() => { if (visible) void load('list') }, [visible])
  useEffect(() => { if (visible) { document.querySelector('.yro-search-input')?.setAttribute('aria-label', t('placeholder')); requestAnimationFrame(() => shellRef.current?.focus?.()) } }, [visible, t])
  if (!visible) return null
  const useExample = value => { setQuery(value); requestAnimationFrame(() => document.querySelector('.yro-search-input')?.focus()) }
  let body = h(EmptyState, { matched: false, t, onExample: useExample })
  if (busy && !data) body = h('div', { className: 'yro-loading', role: 'status' }, h(IconLoadingOutline16, { size: 22 }), t('refreshing'))
  else if (data?.status === 'unavailable') body = h(StateMessage, { kind: 'unavailable', t, busy, onRetry: () => void load('list') })
  else if (data?.status === 'error') body = h(StateMessage, { kind: 'error', t, busy, onRetry: () => void load('list') })
  else if (data?.source === 'agent_reach') body = h(ExternalResults, { data, t })
  else if (data) body = h(StoredResults, { data, t, onExample: useExample })
  return h('div', { className: 'yro-overlay', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'yro-title' }, h('main', { className: 'yro-shell', ref: shellRef, tabIndex: -1 }, h('header', { className: 'yro-header' }, h('div', null, h('div', { className: 'yro-title-row' }, h('h1', { id: 'yro-title' }, t('title')), h('span', { className: 'yro-ready', 'aria-hidden': true })), h('p', null, t('subtitle'))), h(Tooltip, { label: t('close') }, h('button', { type: 'button', className: 'yro-icon-button', 'aria-label': t('close'), onClick: closeOverlay }, h(IconCloseOutline16, { size: 17 })))), h('div', { className: 'yro-toolbar' }, h('label', { className: 'yro-platform-select' }, h('span', null, t('platform')), h('select', { value: platform, disabled: busy, onChange: event => setPlatform(event.target.value), 'aria-label': t('platform') }, h('option', { value: '' }, t('allPlatforms')), PLATFORMS.map(value => h('option', { value, key: value }, platformName(value, t))))), h('div', { className: 'yro-search-box' }, h(IconSearchOutline16, { size: 17 }), h('input', { className: 'yro-search-input', value: query, maxLength: 500, disabled: busy, placeholder: t('placeholder'), onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') void load('list') } })), h('button', { type: 'button', className: 'yro-primary', onClick: () => void load('list'), disabled: busy }, h(IconSearchOutline16, { size: 16 }), t('search')), h('button', { type: 'button', className: 'yro-secondary', onClick: () => void load('refresh'), disabled: busy || !query.trim() }, busy ? h(IconLoadingOutline16, { size: 16 }) : h(IconRefreshOutline16, { size: 16 }), t(busy ? 'refreshing' : 'refresh'))), h('p', { className: 'yro-privacy' }, t('privacy')), h('section', { className: 'yro-content', 'aria-live': 'polite', 'aria-busy': busy }, body)))
}
function Button({ t }) { return h(Tooltip, { label: t('open') }, h('button', { type: 'button', className: 'yro-button', 'aria-label': t('open'), onClick: openOverlay }, h(IconDataOutline16, { size: 18 }))) }

const css = `.yro-button{display:grid;width:36px;height:36px;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.yro-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yro-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yro-shell{display:grid;grid-template-rows:auto auto auto minmax(0,1fr);width:100%;height:100%;overflow:hidden}.yro-header{display:flex;min-height:72px;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yro-title-row{display:flex;align-items:center;gap:10px}.yro-header h1{margin:0;font-size:22px;line-height:1.25;letter-spacing:0}.yro-header p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yro-ready{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent)}.yro-icon-button{display:grid;width:36px;height:36px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yro-toolbar{display:grid;grid-template-columns:minmax(150px,210px) minmax(280px,1fr) auto auto;gap:10px;padding:22px clamp(18px,3vw,42px) 12px}.yro-platform-select,.yro-search-box{height:44px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}.yro-platform-select{position:relative;display:flex;flex-direction:column;justify-content:center;padding:4px 12px}.yro-platform-select span{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1}.yro-platform-select select{width:100%;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:13px}.yro-search-box{display:flex;align-items:center;gap:9px;padding:0 13px;color:var(--dsw-alias-label-tertiary)}.yro-search-box input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px}.yro-primary,.yro-secondary,.yro-state button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;gap:7px;padding:0 16px;border-radius:6px;font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}.yro-primary{border:1px solid transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.yro-secondary,.yro-state button{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.yro-primary:disabled,.yro-secondary:disabled{cursor:not-allowed;opacity:.45}.yro-privacy{margin:0;padding:0 clamp(18px,3vw,42px) 18px;color:var(--dsw-alias-label-tertiary);font-size:12px}.yro-content{overflow:auto;border-top:1px solid var(--dsw-alias-border-l1);padding:0 clamp(18px,3vw,42px) 40px}.yro-source-bar{display:flex;min-height:42px;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}.yro-source-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}.yro-source-bar.is-external .yro-source-dot{background:var(--dsw-alias-state-warn-primary)}.yro-source-time{margin-left:auto;color:var(--dsw-alias-label-tertiary)}.yro-metrics{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));border-block:1px solid var(--dsw-alias-border-l1)}.yro-metric{display:grid;grid-template-columns:1fr auto auto;align-items:baseline;gap:6px;padding:16px 18px;border-right:1px solid var(--dsw-alias-border-l1)}.yro-metric:last-child{border-right:0}.yro-metric span{color:var(--dsw-alias-label-secondary);font-size:12px}.yro-metric strong{font-size:24px;line-height:1;letter-spacing:0}.yro-metric small{color:var(--dsw-alias-label-tertiary);font-size:11px}.yro-section-head{padding:22px 0 12px}.yro-section-head h2,.yro-external-note h2,.yro-state h2{margin:0;font-size:15px;letter-spacing:0}.yro-section-head p,.yro-external-note p,.yro-state p{margin:5px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}.yro-list{border-top:1px solid var(--dsw-alias-border-l1)}.yro-item{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:22px;padding:18px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yro-item-head{display:flex;align-items:center;gap:12px;color:var(--dsw-alias-label-tertiary);font-size:11px}.yro-platform{color:var(--dsw-alias-label-secondary);font-weight:600}.yro-item h3{margin:8px 0 5px;font-size:15px;line-height:1.4;letter-spacing:0}.yro-item p{display:-webkit-box;overflow:hidden;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;-webkit-box-orient:vertical;-webkit-line-clamp:3}.yro-item-side{display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;gap:16px}.yro-counts{display:flex;gap:22px}.yro-counts span{display:flex;flex-direction:column;align-items:flex-end;color:var(--dsw-alias-label-tertiary);font-size:10px}.yro-counts b{color:var(--dsw-alias-label-primary);font-size:16px}.yro-item a{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:12px;text-decoration:none}.yro-item a:hover{text-decoration:underline}.yro-empty,.yro-state,.yro-loading{display:flex;min-height:360px;align-items:center;justify-content:center;flex-direction:column;text-align:center}.yro-empty-icon,.yro-state-icon{display:grid;width:44px;height:44px;place-items:center;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.yro-empty h3{margin:14px 0 4px;font-size:16px}.yro-empty p{max-width:470px;margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}.yro-examples{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:22px;color:var(--dsw-alias-label-tertiary);font-size:12px}.yro-examples button{padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.yro-external-note{display:flex;align-items:flex-start;gap:10px;padding:18px 0;color:var(--dsw-alias-state-warn-primary)}.yro-external-note p{color:var(--dsw-alias-label-secondary)}.yro-external-item{grid-template-columns:minmax(0,1fr) auto}.yro-external-item .yro-item-side{justify-content:center}.yro-state button{min-height:36px;margin-top:18px}.yro-loading{gap:10px;color:var(--dsw-alias-label-secondary)}@media(max-width:900px){.yro-toolbar{grid-template-columns:180px minmax(220px,1fr)}.yro-primary,.yro-secondary{min-height:40px}.yro-metrics{grid-template-columns:repeat(2,1fr)}.yro-metric:nth-child(2){border-right:0}.yro-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}}@media(max-width:620px){.yro-header{padding:15px 16px}.yro-header h1{font-size:19px}.yro-toolbar{grid-template-columns:1fr 1fr;padding:16px}.yro-platform-select,.yro-search-box{grid-column:1/-1}.yro-primary,.yro-secondary{padding:0 10px}.yro-privacy{padding:0 16px 14px}.yro-content{padding:0 16px 28px}.yro-metric{grid-template-columns:1fr auto;padding:13px 10px}.yro-metric small{display:none}.yro-item{grid-template-columns:1fr;gap:12px}.yro-item-side{align-items:flex-start;flex-direction:row}.yro-counts span{align-items:flex-start}.yro-examples{flex-wrap:wrap}.yro-source-bar{align-items:flex-start;flex-direction:column;padding:10px 0}.yro-source-time{margin-left:0}.yro-external-item{grid-template-columns:1fr}}`

const interactionCss = `.yro-platform-select:has(select:disabled),.yro-search-box:has(input:disabled){opacity:.45}.yro-state button:disabled{cursor:not-allowed;opacity:.45}`

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-retrofit: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); window.addEventListener('keydown', closeOnEscape); return () => { window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay); window.removeEventListener('keydown', closeOnEscape) } }, 'dofe-yootun-retrofit: overlay-events')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-retrofit'; style.textContent = css + interactionCss; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-retrofit: styles')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-retrofit', order: 45, inject: () => ({ t }) }, Button))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-retrofit', order: 45, inject: () => ({ t }) }, Overlay))
}
module.exports = { apply, inject: ['slots', 'locale'] }
