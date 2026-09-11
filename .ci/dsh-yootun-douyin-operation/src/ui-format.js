// 作品表格/详情展示的纯逻辑（无 React 依赖，可独立单测）。
//
// 展示契约（docs/0909/douyin §5.2/§5.3）：
// - 列顺序与指标文案固定：2s跳出率 / 5s完播率 / 完播率 / 平均播放时长 / 平均播放占比（+ 粉丝播放占比在详情）；
// - 粉丝数是账号级指标，只在左侧账号卡展示，不进右侧表格（§5.3）；
// - 本次未取到的字段显示 `—`（缺口），**绝不回填历史值**；
// - 前两列（作品名称、作品链接）固定（sticky），其余列横向滚动；
// - 表头与每行共享同一列轨道模板（tableTemplate），避免滚动末端背景/分割线断线。

export const EMPTY = '—'

export const COLUMNS = [
  { key: 'title', label: 'colTitle', kind: 'text', width: 220, sticky: 0 },
  { key: 'url', label: 'colUrl', kind: 'link', width: 200, sticky: 220 },
  { key: 'play_count', label: 'colPlay', kind: 'count', width: 100, sortable: true },
  { key: 'collect_count', label: 'colCollect', kind: 'count', width: 100, sortable: true },
  { key: 'like_count', label: 'colLike', kind: 'count', width: 100, sortable: true },
  { key: 'comment_count', label: 'colComment', kind: 'count', width: 100, sortable: true },
  { key: 'bounce_rate_2s_pct', label: 'colBounce2s', kind: 'pct', width: 104, sortable: true },
  { key: 'completion_rate_5s_pct', label: 'colCompletion5s', kind: 'pct', width: 104, sortable: true },
  { key: 'completion_rate_pct', label: 'colCompletion', kind: 'pct', width: 96, sortable: true },
  { key: 'avg_watch_duration_s', label: 'colDuration', kind: 'seconds', width: 120, sortable: true },
  { key: 'avg_view_proportion_pct', label: 'colProportion', kind: 'pct', width: 110, sortable: true },
]

/** 排序是当前视图行为：默认态（key=null）严格保持接口返回顺序（§6.1）。 */
export const DEFAULT_SORT_STATE = { key: null, direction: 'default' }

/** 三态状态机：default -> desc -> asc -> default；点击另一字段时直接从 default 进入 desc（§6.2）。 */
export function nextSortState(currentState, columnKey) {
  if (!currentState || currentState.key !== columnKey || currentState.direction === 'default') {
    return { key: columnKey, direction: 'desc' }
  }
  if (currentState.direction === 'desc') return { key: columnKey, direction: 'asc' }
  return { ...DEFAULT_SORT_STATE }
}

/**
 * 数值比较：数字/百分比/秒数一律按数值（不按「1.2万」这类格式化字符串）；
 * 空值与非有限值始终排最后，且与方向无关；缺失值不能被当作 0（§6.2）。
 */
export function compareNullableNumbers(a, b, direction) {
  const valueA = Number(a)
  const valueB = Number(b)
  // Number(null)/Number('') 都是 0，必须显式视为缺失，否则空值会被当成 0 参与排序。
  const validA = a !== null && a !== undefined && a !== '' && Number.isFinite(valueA)
  const validB = b !== null && b !== undefined && b !== '' && Number.isFinite(valueB)
  if (!validA && !validB) return 0
  if (!validA) return 1
  if (!validB) return -1
  return direction === 'asc' ? valueA - valueB : valueB - valueA
}

/**
 * 排序返回新数组，绝不原地修改 Tools 返回的 works（§6.4）；
 * 同值行保持接口原始相对顺序（显式回退原始下标，不依赖排序实现的稳定性）。
 */
export function sortWorks(works, sortState) {
  if (!Array.isArray(works)) return []
  if (!sortState || !sortState.key || sortState.direction === 'default') return [...works]
  const column = COLUMNS.find(item => item.key === sortState.key)
  if (!column || column.sortable !== true) return [...works]
  const direction = sortState.direction === 'asc' ? 'asc' : 'desc'
  return works
    .map((work, index) => ({ work, index }))
    .sort((left, right) => {
      const diff = compareNullableNumbers(left.work[sortState.key], right.work[sortState.key], direction)
      return diff !== 0 ? diff : left.index - right.index
    })
    .map(entry => entry.work)
}

export function trimNumber(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return ''
  return String(Math.round(num * 100) / 100)
}

export function formatPercent(value) {
  if (value === null || value === undefined || value === '') return EMPTY
  const num = Number(value)
  if (!Number.isFinite(num)) return EMPTY
  const bounded = Math.max(0, Math.min(100, num))
  return `${Math.round(bounded * 100) / 100}%`
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
  if (kind === 'pct') return formatPercent(value)
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

/** 非列字段的缺口文案映射（progress_analysis 等内部字段），未知字段一律「其他指标」（§7.3）。 */
const GAP_FIELD_LABELS = { progress_analysis: 'progressCurve' }

/** 缺口字段名中文化：列字段复用 COLUMNS 文案，禁止把原始英文 code 展示给业务用户（§7.3）。 */
export function gapFieldLabel(field, t = key => key) {
  const column = COLUMNS.find(item => item.key === field)
  if (column) return t(column.label)
  if (GAP_FIELD_LABELS[field]) return t(GAP_FIELD_LABELS[field])
  return t('gapFieldOther')
}

/**
 * 性别按语义 key 映射中文（§7.1）：male/female 是接口枚举，不直接暴露给业务用户；
 * 未知值兜底「其他」。
 */
export function genderLabel(value, t = key => key) {
  if (value === 'male') return t('genderMale')
  if (value === 'female') return t('genderFemale')
  return t('genderOther')
}

/** 性别颜色按语义 key 固定（§7.1）：男=品牌主色、女=柔和红、其他=次要色；绝不用数组下标。 */
export function genderColor(value) {
  if (value === 'male') return 'var(--dsw-alias-brand-primary)'
  if (value === 'female') return 'var(--ydo-gender-female, #E88989)'
  return 'var(--dsw-alias-label-secondary)'
}

/**
 * 进度分析状态判定（§7.2）：它不是采集进度，而是观看行为分析。
 * - 请求失败（data_gap 记录 request_failed）优先；
 * - 没有任何点位：字段在但曲线为空 = no_data（接口可达但作品无数据），字段完全缺失 = not_exposed；
 * - 有点位 = ok。
 */
export function progressStatus(progress, work, fieldKey = 'progress_analysis') {
  const gap = work && work.data_gap && work.data_gap[fieldKey]
  if (gap && gap.reason === 'request_failed') return 'request_failed'
  if (!progress || typeof progress !== 'object') return 'not_exposed'
  const hasPoints = ['drag_back_curve', 'drag_forward_curve'].some(key => Array.isArray(progress[key]) && progress[key].length > 0)
  return hasPoints ? 'ok' : 'no_data'
}

export function progressStatusText(status, t = key => key) {
  if (status === 'no_data') return t('progressNoData')
  if (status === 'not_exposed') return t('progressNotExposed')
  if (status === 'request_failed') return t('progressRequestFailed')
  return ''
}

/**
 * 作品链接域名白名单（§9.2）：Desktop 宿主只有协议级兜底、没有域名白名单，
 * renderer 必须自行校验：标准 URL 解析 + 仅 http(s) + 主机名固定 www.douyin.com。
 * 不满足时返回 null，链接按普通文本展示，绝不调用外部浏览器。
 */
export function safeWorkUrl(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let url
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname !== 'www.douyin.com') return null
  return trimmed
}

export function hasGap(work) {
  return Boolean(work && work.data_gap && Object.keys(work.data_gap).length)
}

/** 表头与每行共享的列轨道模板：单一来源是 COLUMNS 的 width，禁止在 CSS 里再写一份。 */
export function tableTemplate(columns = COLUMNS) {
  return columns.map(column => `${column.width || 100}px`).join(' ')
}

/** 头像地址只接受 http(s) 绝对地址；空值、相对路径、本地路径或内嵌协议一律返回 null。 */
export function safeAvatarSrc(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
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
  const rawStatus = (account && account.sessionStatus) || 'unknown'
  const status = rawStatus === 'ok' || rawStatus === 'expired' || rawStatus === 'unknown' ? rawStatus : 'unknown'
  return {
    status,
    collectable: status === 'ok',
    needsRescan: status === 'expired' || status === 'unknown',
  }
}
