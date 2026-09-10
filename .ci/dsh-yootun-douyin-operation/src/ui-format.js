// 作品表格/详情展示的纯逻辑（无 React 依赖，可独立单测）。
//
// 展示契约（docs/0909/douyin §5.2/§5.3）：
// - 列顺序与指标文案固定：2s跳出率 / 5s完播率 / 完播率 / 平均播放时长 / 平均播放占比（+ 粉丝播放占比在详情）；
// - 本次未取到的字段显示 `—`（缺口），**绝不回填历史值**；
// - 前两列（作品名称、作品链接）固定（sticky），其余列横向滚动。

export const EMPTY = '—'

export const COLUMNS = [
  { key: 'title', label: 'colTitle', kind: 'text', width: 220, sticky: 0 },
  { key: 'url', label: 'colUrl', kind: 'link', width: 200, sticky: 220 },
  { key: 'fanCount', label: 'colFans', kind: 'count' },
  { key: 'play_count', label: 'colPlay', kind: 'count' },
  { key: 'collect_count', label: 'colCollect', kind: 'count' },
  { key: 'like_count', label: 'colLike', kind: 'count' },
  { key: 'comment_count', label: 'colComment', kind: 'count' },
  { key: 'bounce_rate_2s_pct', label: 'colBounce2s', kind: 'pct' },
  { key: 'completion_rate_5s_pct', label: 'colCompletion5s', kind: 'pct' },
  { key: 'completion_rate_pct', label: 'colCompletion', kind: 'pct' },
  { key: 'avg_watch_duration_s', label: 'colDuration', kind: 'seconds' },
  { key: 'avg_view_proportion_pct', label: 'colProportion', kind: 'pct' },
]

export function trimNumber(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return ''
  return String(Math.round(num * 100) / 100)
}

export function formatCount(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return EMPTY
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`
  return String(num)
}

/** 单元格格式化：缺失一律显示 `—`，不显示历史值也不显示 0。 */
export function formatCell(value, kind, t = key => key) {
  if (value === null || value === undefined || value === '') return EMPTY
  if (kind === 'count') return formatCount(value)
  if (kind === 'pct') {
    const text = trimNumber(value)
    return text === '' ? EMPTY : `${text}%`
  }
  if (kind === 'seconds') {
    const text = trimNumber(value)
    return text === '' ? EMPTY : `${text}${t('seconds')}`
  }
  return String(value)
}

export function gapReasonText(reason, t = key => key) {
  if (reason === 'not_exposed') return t('gapNotExposed')
  if (reason === 'below_min_view') return t('gapBelowMinView')
  if (reason === 'request_failed') return t('gapRequestFailed')
  if (reason === 'no_data') return t('gapNoData')
  return t('gapOther')
}

export function hasGap(work) {
  return Boolean(work && work.data_gap && Object.keys(work.data_gap).length)
}

export function progressText(collect, t = key => key) {
  if (!collect) return ''
  const progress = collect.progress || {}
  if (progress.phase === 'work') return `${t('progressCollect')} ${progress.index || 0}/${progress.total || 0}`
  if (progress.phase === 'batch_done') {
    return `${t('progressIngest')} ${progress.batchNo || 0}/${progress.totalBatches || 0} · ${progress.succeeded || 0}/${progress.expected || 0}`
  }
  if (progress.phase === 'collected') {
    const expected = collect.result && collect.result.expectedWorkCount
    return `${t('progressCollect')} ${expected || ''}`.trim()
  }
  return t('runRunning')
}

/** 账号卡片状态：ok / expired / unknown 与采集可用性。 */
export function accountState(account) {
  const status = (account && account.sessionStatus) || 'unknown'
  return {
    status,
    collectable: status === 'ok',
    needsRescan: status === 'expired' || status === 'unknown',
  }
}
