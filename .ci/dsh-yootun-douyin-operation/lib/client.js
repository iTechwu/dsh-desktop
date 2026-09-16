window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-douyin-operation",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // 作品表格/详情展示的纯逻辑（无 React 依赖，可独立单测）。
    //
    // 展示契约（docs/0909/douyin §5.2/§5.3）：
    // - 列顺序与指标文案固定：2s跳出率 / 5s完播率 / 完播率 / 平均播放时长 / 平均播放占比（+ 粉丝播放占比在详情）；
    // - 粉丝数是账号级指标，只在左侧账号卡展示，不进右侧表格（§5.3）；
    // - 本次未取到的字段显示 `—`（缺口），**绝不回填历史值**；
    // - 前两列（作品名称、作品链接）固定（sticky），其余列横向滚动；
    // - 表头与每行共享同一列轨道模板（tableTemplate），避免滚动末端背景/分割线断线。

    const EMPTY = '—'

    const COLUMNS = [
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
    const DEFAULT_SORT_STATE = { key: null, direction: 'default' }

    /** 三态状态机：default -> desc -> asc -> default；点击另一字段时直接从 default 进入 desc（§6.2）。 */
    function nextSortState(currentState, columnKey) {
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
    function compareNullableNumbers(a, b, direction) {
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
    function sortWorks(works, sortState) {
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

    function trimNumber(value) {
      const num = Number(value)
      if (!Number.isFinite(num)) return ''
      return String(Math.round(num * 100) / 100)
    }

    function formatPercent(value) {
      if (value === null || value === undefined || value === '') return EMPTY
      const num = Number(value)
      if (!Number.isFinite(num)) return EMPTY
      const bounded = Math.max(0, Math.min(100, num))
      return `${Math.round(bounded * 100) / 100}%`
    }

    function formatCount(value) {
      const num = Number(value)
      if (!Number.isFinite(num)) return EMPTY
      if (num >= 10000) return `${(num / 10000).toFixed(1)}万`
      return String(num)
    }

    /** 单元格格式化：缺失一律显示 `—`，不显示历史值也不显示 0。 */
    function formatCell(value, kind, t = key => key) {
      if (value === null || value === undefined || value === '') return EMPTY
      if (kind === 'count') return formatCount(value)
      if (kind === 'pct') return formatPercent(value)
      if (kind === 'seconds') {
        const text = trimNumber(value)
        return text === '' ? EMPTY : `${text}${t('seconds')}`
      }
      return String(value)
    }

    function gapReasonText(reason, t = key => key) {
      if (reason === 'not_exposed') return t('gapNotExposed')
      if (reason === 'below_min_view') return t('gapBelowMinView')
      if (reason === 'request_failed') return t('gapRequestFailed')
      if (reason === 'no_data') return t('gapNoData')
      return t('gapOther')
    }

    /** 非列字段的缺口文案映射（progress_analysis 等内部字段），未知字段一律「其他指标」（§7.3）。 */
    const GAP_FIELD_LABELS = { progress_analysis: 'progressCurve' }

    /** 缺口字段名中文化：列字段复用 COLUMNS 文案，禁止把原始英文 code 展示给业务用户（§7.3）。 */
    function gapFieldLabel(field, t = key => key) {
      const column = COLUMNS.find(item => item.key === field)
      if (column) return t(column.label)
      if (GAP_FIELD_LABELS[field]) return t(GAP_FIELD_LABELS[field])
      return t('gapFieldOther')
    }

    /**
     * 性别按语义 key 映射中文（§7.1）：male/female 是接口枚举，不直接暴露给业务用户；
     * 未知值兜底「其他」。
     */
    function genderLabel(value, t = key => key) {
      if (value === 'male') return t('genderMale')
      if (value === 'female') return t('genderFemale')
      return t('genderOther')
    }

    /** 性别颜色按语义 key 固定（二次优化 §5.2.1）：男=淡蓝、女=柔和红、其他=次要色；绝不用数组下标。 */
    function genderColor(value) {
      if (value === 'male') return 'var(--ydo-gender-male, #91C5EB)'
      if (value === 'female') return 'var(--ydo-gender-female, #E88989)'
      return 'var(--dsw-alias-label-secondary)'
    }

    /**
     * 进度分析状态判定（§7.2）：它不是采集进度，而是观看行为分析。
     * - 请求失败（data_gap 记录 request_failed）优先；
     * - 没有任何点位：字段在但曲线为空 = no_data（接口可达但作品无数据），字段完全缺失 = not_exposed；
     * - 有点位 = ok。
     */
    function progressStatus(progress, work, fieldKey = 'progress_analysis') {
      const gap = work && work.data_gap && work.data_gap[fieldKey]
      if (gap && gap.reason === 'request_failed') return 'request_failed'
      if (!progress || typeof progress !== 'object') return 'not_exposed'
      const hasPoints = ['drag_back_curve', 'drag_forward_curve'].some(key => Array.isArray(progress[key]) && progress[key].length > 0)
      return hasPoints ? 'ok' : 'no_data'
    }

    function progressStatusText(status, t = key => key) {
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
    function safeWorkUrl(value) {
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

    function hasGap(work) {
      return Boolean(work && work.data_gap && Object.keys(work.data_gap).length)
    }

    /** 表头与每行共享的列轨道模板：单一来源是 COLUMNS 的 width，禁止在 CSS 里再写一份。 */
    function tableTemplate(columns = COLUMNS) {
      return columns.map(column => `${column.width || 100}px`).join(' ')
    }

    /** 头像地址只接受 http(s) 绝对地址；空值、相对路径、本地路径或内嵌协议一律返回 null。 */
    function safeAvatarSrc(value) {
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

    function progressText(collect, t = key => key) {
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
    function accountState(account) {
      const rawStatus = (account && account.sessionStatus) || 'unknown'
      const status = rawStatus === 'ok' || rawStatus === 'expired' || rawStatus === 'unknown' ? rawStatus : 'unknown'
      return {
        status,
        collectable: status === 'ok',
        needsRescan: status === 'expired' || status === 'unknown',
      }
    }

    // 年龄分桶 key → 文案键（二次优化 §5.5）：已知区间精确映射，不做正则机械替换。
    const AGE_BUCKET_KEYS = {
      '-18': 'ageUnder18',
      '18-23': 'age18to23',
      '24-30': 'age24to30',
      '31-40': 'age31to40',
      '41-50': 'age41to50',
      '50-': 'ageOver50',
    }

    /**
     * 年龄分桶 key → 中文文案（仅详情页展示层转换；原始 key、数据库字段与接口契约不变）。
     * 未识别的 key 不删除数据，兜底「其他年龄段」，原始 key 由调用方保留供调试。
     */
    function formatAgeBucket(value, t = key => key) {
      const labelKey = typeof value === 'string' ? AGE_BUCKET_KEYS[value.trim()] : null
      return labelKey ? t(labelKey) : t('ageOther')
    }

    // 已知流量来源 key → 文案键（二次优化 §5.4.1）；与 parse.js 的 SOURCE_LABELS 同一清单。
    const SOURCE_KEY_LABELS = {
      homepage_hot: 'srcHomepageHot',
      homepage: 'srcHomepage',
      familiar: 'srcFamiliar',
      follow: 'srcFollow',
      search: 'srcSearch',
      message: 'srcMessage',
      nearby: 'srcNearby',
      other: 'srcKnownOther',
    }

    /** 历史数据曾把未映射 key 原样写入 source_label；纯枚举形态的「标签」不可信。 */
    const RAW_KEY_SHAPE = /^[A-Za-z0-9_.-]+$/

    /**
     * 流量来源展示名（二次优化 §5.4.2/§5.4.3）：label 优先（非空、不等于原始 key、
     * 非裸枚举形态），已知 key 用映射，未知/缺失一律「其他来源」。原始 key 只保留在
     * 数据内部（sourceKey），绝不进入页面文本。
     */
    function trafficSourceLabel(row, t = key => key) {
      const sourceKey = typeof (row && row.source_key) === 'string' ? row.source_key.trim() : ''
      const label = typeof (row && row.source_label) === 'string' ? row.source_label.trim() : ''
      if (label && label !== sourceKey && !RAW_KEY_SHAPE.test(label)) return label.slice(0, 128)
      const mapped = SOURCE_KEY_LABELS[sourceKey]
      return mapped ? t(mapped) : t('sourceOther')
    }

    /**
     * ISO 时间 → 'YYYY-MM-DD HH:mm'（二次优化 §5.6.4，按 Asia/Shanghai 展示）。
     *
     * Asia/Shanghai 是固定 UTC+8（无夏令时），因此用 UTC 毫秒 +8h 后按 UTC 字段取值，
     * 不依赖宿主时区，也不使用会掩盖非法值的 String(value).slice(0, 16)。
     * 非法时间、空字符串和非字符串一律显示 `—`。
     */
    function formatDateTime(value) {
      if (typeof value !== 'string' || !value.trim()) return EMPTY
      const ms = Date.parse(value.trim())
      if (!Number.isFinite(ms)) return EMPTY
      const shifted = new Date(ms + 8 * 60 * 60 * 1000)
      const pad = number => String(number).padStart(2, '0')
      return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
    }

    // 抖音运营客户端：左下角菜单入口 + 整页 overlay（左侧账号管理区 + 右侧作品数据区）。
    //
    // 数据来源：本地同源路由 /api/desktop/yootun/douyin-operation（宿主再经公共网关调 tools）。
    // 展示契约（docs/0909/douyin §5）：
    // - 表格列序固定，指标文案严格为「2s跳出率 / 5s完播率 / 完播率 / 平均播放时长 / 平均播放占比 / 粉丝播放占比」；
    // - 本次未取到的字段显示 `—`（dataGap），**不用历史值冒充当前值**；
    // - 双击行打开子页面（性别/年龄/地域/城市级/流量来源/进度/搜索词/热词）。


    const React = require('react')
    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
    const { IconCloseOutline16, IconDownloadOutline16, IconPlayOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dofe.yootun-douyin-operation'
    const PATH = '/api/desktop/yootun/douyin-operation'
    const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
    const OVERLAY_ID = '@dofe/dsh-yootun-douyin-operation'
    const LOGIN_POLL_INTERVAL_MS = 2000
    const COLLECT_POLL_INTERVAL_MS = 1500

    // 删除账号的客户端生命周期（能力矩阵的写操作状态语义）：
    // idle → awaiting_confirmation（确认框）→ confirmed_pending_adapter（设备清理 + 远端删除进行中）；
    // 任一环节失败 → cleanup_failed，并保留可重试入口，绝不提前显示「已删除」。
    const DELETE_LIFECYCLE = Object.freeze({
      idle: 'idle',
      awaitingConfirmation: 'awaiting_confirmation',
      confirmedPendingAdapter: 'confirmed_pending_adapter',
      cleanupFailed: 'cleanup_failed',
    })

    const copy = {
      zh: {
        open: '抖音运营', title: '抖音运营', subtitle: '扫码登录抖音创作者账号，采集并查看作品经营数据',
        close: '关闭', tabVideos: '视频数据', accounts: '账号管理', data: '数据展示区',
        addAccount: '添加账号', scanning: '等待扫码…', scanHint: '请用抖音 App 扫描弹出的窗口完成登录',
        loginTimeout: '扫码超时，请重试', loginFailed: '登录失败，请重试',
        sessionOk: '登录有效', sessionExpired: '登录已过期，请重新扫码', sessionUnknown: '会话状态未知',
        rescan: '重新扫码', check: '检测会话', checking: '检测中…',
        noChromeTitle: '未检测到 Google Chrome',
        noChromeHint: '本功能需要在你自己的电脑上使用系统 Google Chrome（不使用内置浏览器、不回退 Chromium）。请先安装 Google Chrome 后重试。',
        noDriverTitle: '缺少浏览器驱动',
        noDriverHint: '当前 DSH 运行时未随应用提供 Playwright 驱动（playwright-core），请联系管理员重新安装抖音运营插件。',
        retry: '重新检测', selectAccount: '请选择账号', emptyAccounts: '添加账号后开始采集',
        deleteAccount: '删除账号', deleteConfirm: '确认删除该账号？将清除本机登录状态与远端作品数据，账号记录会保留为墓碑。',
        confirmYes: '确认删除', confirmNo: '取消', deleteBlocked: '删除失败，请重试',
        deletePending: '正在删除…', deleteRetry: '重试删除', deleteFailed: '删除失败',
        runActive: '该账号正在采集中，请先结束采集再删除',
        fanCount: '粉丝', collectAll: '采集本账号全部', refresh: '刷新', collecting: '采集中',
        collectHint: '点击「采集本账号全部」开始', sessionRequiredForCollect: '登录已过期或缺失，请先重新扫码再采集',
        progressCollect: '采集进度', progressIngest: '入库进度', progressDone: '采集完成',
        runCompleted: '采集完成', runPartial: '采集部分完成', runFailed: '采集失败', runCancelled: '采集已取消',
        runRunning: '采集中', lastCollected: '上次采集', workCount: '作品数', none: '暂无数据',
        colTitle: '作品名称', colUrl: '作品链接', colPlay: '播放量', colCollect: '收藏量',
        sortDefault: '取消排序', sortDesc: '倒序', sortAsc: '顺序',
        genderMale: '男', genderFemale: '女', genderOther: '其他', gapFieldOther: '其他指标',
        progressNoData: '该作品暂无进度分析数据', progressNotExposed: '本次接口未提供进度分析数据', progressRequestFailed: '进度分析请求失败，请稍后重试',
        colLike: '点赞量', colComment: '评论量', colBounce2s: '2s跳出率', colCompletion5s: '5s完播率',
        colCompletion: '完播率', colDuration: '平均播放时长', colProportion: '平均播放占比',
        detail: '作品详情', gender: '性别分布', age: '年龄分布', province: '地域分布', cityLevel: '城市级别',
        trafficSource: '流量来源', progressCurve: '进度分析', searchKeywords: '搜索词', hotwords: '评论热词',
        dragBack: '拖回', dragForward: '拖前', engagement: '互动率',
        gapTitle: '数据缺口', gapNotExposed: '本次接口未提供', gapBelowMinView: '播放量低于抖音最小观看门槛',
        gapRequestFailed: '本次请求失败，请稍后重试', gapNoData: '该作品暂无此数据', gapOther: '本次未取到',
        partialBadge: '部分缺失', privateBadge: '已设为私密', trendCount: '该作品已采集 {count} 次',
        publishTime: '发布时间', latestCollected: '最近采集', noRecord: '暂无记录',
        ageUnder18: '小于18岁', age18to23: '18-23岁', age24to30: '24-30岁', age31to40: '31-40岁', age41to50: '41-50岁', ageOver50: '大于50岁', ageOther: '其他年龄段',
        srcHomepageHot: '推荐(首页推荐)', srcHomepage: '个人主页', srcFamiliar: '朋友/熟人', srcFollow: '关注',
        srcSearch: '搜索', srcMessage: '私信/分享', srcNearby: '同城', srcKnownOther: '其他', sourceOther: '其他来源',
        collectFailed: '采集失败，请重试', collectBlocked: '采集未启动', refreshFailed: '刷新失败', probeFailed: '会话检测失败，请重试',
        accountSaveFailed: '登录成功，但账号信息同步到云端失败，采集将不可用；请重启客户端后重新登录',
        accountNotOnCloud: '云端还没有该账号的数据，请先完成一次采集', operationUnavailable: '抖音运营服务暂时不可用，请稍后重试',
        workNotOnCloud: '云端还没有该作品的数据，请先重新采集',
        seconds: '秒', noHotword: '暂无热词', noSearch: '暂无搜索词',
        exportExcel: '导出 Excel', exporting: '导出中…', exportFailed: '导出失败，请稍后重试',
        exportTooLarge: '当前账号数据量过大，暂不支持导出，请联系管理员', exportNoData: '当前账号暂无可导出数据',
      },
      en: {
        open: 'Douyin ops', title: 'Douyin ops', subtitle: 'Scan to sign in to a Douyin creator account, collect and review work metrics',
        close: 'Close', tabVideos: 'Video data', accounts: 'Accounts', data: 'Data',
        addAccount: 'Add account', scanning: 'Waiting for scan…', scanHint: 'Scan the window with the Douyin app to sign in',
        loginTimeout: 'Scan timed out, retry', loginFailed: 'Sign-in failed, retry',
        sessionOk: 'Signed in', sessionExpired: 'Session expired, scan again', sessionUnknown: 'Session unknown',
        rescan: 'Scan again', check: 'Check session', checking: 'Checking…',
        noChromeTitle: 'Google Chrome not found',
        noChromeHint: 'This feature needs the system Google Chrome on your own computer (no bundled browser, no Chromium fallback). Install Google Chrome and retry.',
        noDriverTitle: 'Browser driver missing',
        noDriverHint: 'The DSH runtime does not provide the Playwright driver (playwright-core). Reinstall the plugin.',
        retry: 'Check again', selectAccount: 'Select an account', emptyAccounts: 'Add an account to start collecting',
        deleteAccount: 'Remove account', deleteConfirm: 'Remove this account? Local sign-in state and remote work data are cleared; the account record stays as a tombstone.',
        confirmYes: 'Remove', confirmNo: 'Cancel', deleteBlocked: 'Remove failed, retry',
        deletePending: 'Removing…', deleteRetry: 'Retry removal', deleteFailed: 'Removal failed',
        runActive: 'This account is still collecting — finish or cancel the run first',
        fanCount: 'Followers', collectAll: 'Collect all works', refresh: 'Refresh', collecting: 'Collecting',
        collectHint: 'Press “Collect all works” to start', sessionRequiredForCollect: 'Session expired or missing — scan again before collecting',
        progressCollect: 'Collecting', progressIngest: 'Ingesting', progressDone: 'Done',
        runCompleted: 'Collect finished', runPartial: 'Collect partially finished', runFailed: 'Collect failed', runCancelled: 'Collect cancelled',
        runRunning: 'Collecting', lastCollected: 'Last collect', workCount: 'Works', none: 'No data',
        colTitle: 'Work', colUrl: 'Link', colPlay: 'Plays', colCollect: 'Favorites',
        sortDefault: 'Unsorted', sortDesc: 'Descending', sortAsc: 'Ascending',
        genderMale: 'Male', genderFemale: 'Female', genderOther: 'Other', gapFieldOther: 'Other metrics',
        progressNoData: 'No progress analysis data for this work', progressNotExposed: 'Progress analysis not provided this time', progressRequestFailed: 'Progress analysis request failed, please retry later',
        colLike: 'Likes', colComment: 'Comments', colBounce2s: '2s bounce', colCompletion5s: '5s completion',
        colCompletion: 'Completion', colDuration: 'Avg watch time', colProportion: 'Avg view share',
        detail: 'Work detail', gender: 'Gender', age: 'Age', province: 'Region', cityLevel: 'City tier',
        trafficSource: 'Traffic source', progressCurve: 'Progress', searchKeywords: 'Search keywords', hotwords: 'Comment hotwords',
        dragBack: 'Drag back', dragForward: 'Drag forward', engagement: 'Engagement',
        gapTitle: 'Data gaps', gapNotExposed: 'not returned by this call', gapBelowMinView: 'below Douyin minimum view threshold',
        gapRequestFailed: 'Request failed this time; retry later', gapNoData: 'this work has no such data', gapOther: 'not collected this run',
        partialBadge: 'Partial', privateBadge: 'Private', trendCount: '{count} snapshots of this work',
        publishTime: 'Publish time', latestCollected: 'Last collected', noRecord: 'No record',
        ageUnder18: 'Under 18', age18to23: '18–23', age24to30: '24–30', age31to40: '31–40', age41to50: '41–50', ageOver50: 'Over 50', ageOther: 'Other age',
        srcHomepageHot: 'Recommended (home feed)', srcHomepage: 'Profile page', srcFamiliar: 'Friends', srcFollow: 'Following',
        srcSearch: 'Search', srcMessage: 'Messages/shares', srcNearby: 'Nearby', srcKnownOther: 'Other', sourceOther: 'Other sources',
        collectFailed: 'Collect failed, retry', collectBlocked: 'Collect did not start', refreshFailed: 'Refresh failed', probeFailed: 'Session check failed, retry',
        accountSaveFailed: 'Signed in, but syncing the account to the cloud failed — collecting will not work; restart the client and sign in again',
        accountNotOnCloud: 'No cloud data for this account yet — run a collection first', operationUnavailable: 'The Douyin ops service is temporarily unavailable; retry later',
        workNotOnCloud: 'No cloud data for this work yet — run a collection first',
        seconds: 's', noHotword: 'No hotwords', noSearch: 'No search keywords',
        exportExcel: 'Export Excel', exporting: 'Exporting…', exportFailed: 'Export failed, retry later',
        exportTooLarge: 'Too much data for this account to export — contact the administrator', exportNoData: 'Nothing to export for this account yet',
      },
    }

    let opened = false
    let lastTrigger = null
    const openListeners = new Set()
    const emitOpen = () => openListeners.forEach(listener => listener())
    const setOpened = value => { opened = value; emitOpen() }
    const subscribeOpen = listener => { openListeners.add(listener); return () => openListeners.delete(listener) }
    const snapshotOpen = () => opened

    // 本地同源 host 调用的统一策略：只带同源凭证、拒绝重定向、30 秒硬超时。
    // 页面不接收内部地址、Cookie 或原始传输错误，失败一律收敛为稳定 error code。
    const REQUEST_TIMEOUT_MS = 30000

    // host 侧稳定 reason code → 已登记文案键：页面只显示可读文案，不把原始 code 暴露给用户。
    const ERROR_COPY = Object.freeze({
      refresh_failed: 'refreshFailed',
      probe_failed: 'probeFailed',
      login_timeout: 'loginTimeout',
      login_failed: 'loginFailed',
      // 登录成功但 account_save 失败（本地登录态有效、云端无账号记录）：
      // 不透传原始 code，映射为可读文案提醒用户重启客户端重登。
      account_save_failed: 'accountSaveFailed',
      // 删除前置：该账号仍有进行中的 run（tools 拒绝 RUN_STILL_ACTIVE）。
      // 未登记的 code 会原样渲染成英文大写码，因此这里必须显式映射。
      RUN_STILL_ACTIVE: 'runActive',
      // 登录后作品列表查询命中「云端无账号」：本地已登录但还没成功采集过，
      // 指引用户先采集，而不是甩一个裸错误码。
      ACCOUNT_NOT_FOUND: 'accountNotOnCloud',
      // 作品详情/趋势查询命中「云端无此作品」：通常是新发布作品还没采集过。
      WORK_NOT_FOUND: 'workNotOnCloud',
      // 传输/宿主层兜底码：不透传原文，给可行动的.retry 文案。
      douyin_operation_request_failed: 'operationUnavailable',
      // 导出专属映射（§12）：超限给管理员导向文案，其余失败给可重试文案。
      export_too_large: 'exportTooLarge',
      export_failed: 'exportFailed',
    })

    async function post(body) {
      const response = await fetch(PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error('request_failed')
      return response.json()
    }

    // 把宿主返回的 base64 工作簿转成 Blob 触发浏览器下载（§10.1）。
    // 只消费响应里的文件名/MIME/内容；下载动作不触碰列表状态，排序与滚动位置保持不变。
    function downloadWorkbook(result) {
      const binary = atob(result.content_base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: result.mime_type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.file_name
      document.body.appendChild(link)
      link.click()
      link.remove()
      // 延迟回收：立即 revoke 会打断尚未开始的下载。
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    }


    function Button({ wide, t }) {
      return h(Tooltip, { label: t('open'), disabled: wide },
        h('button', { type: 'button', className: `ydo-button${wide ? ' ydo-wide' : ''}`, 'aria-label': t('open'), onClick: openOverlay },
          h(IconPlayOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null))
    }

    function openOverlay(event) {
      // 记录触发元素（优先用事件目标），关闭后恢复焦点。
      lastTrigger = event?.currentTarget || document.activeElement
      // 互斥事件由共享 overlay 契约提供：其他 Yootun overlay 收到后自行关闭。
      window.dispatchEvent(new CustomEvent(OVERLAY_EVENT))
      setOpened(true)
    }

    function closeOverlay() {
      setOpened(false)
      // 关闭后把焦点还给触发按钮（下一帧写入，等 overlay 卸载完成）。
      requestAnimationFrame(() => lastTrigger?.focus?.())
    }

    function closeOtherOverlay() {
      if (opened) setOpened(false)
    }

    // 头像只作为 <img> 资源展示：src 必须是 http(s) 绝对地址（§8.2/§8.3）；
    // 加载失败只降级一次（卸载 <img>，不循环重试），回退到昵称首字符占位，
    // 固定尺寸避免加载过程撑高账号卡。
    function AccountAvatar({ account }) {
      const [failed, setFailed] = useState(false)
      const src = safeAvatarSrc(account && account.avatar)
      const alt = (account && (account.nickname || account.accountId)) || ''
      if (!src || failed) {
        return h('span', { className: 'ydo-avatar ydo-avatar-fallback', 'aria-hidden': true }, alt.slice(0, 1) || '·')
      }
      return h('img', {
        className: 'ydo-avatar',
        src,
        alt,
        loading: 'lazy',
        // 不向图片源发送宿主页面来源（§8.2）。
        referrerPolicy: 'no-referrer',
        onError: () => setFailed(true),
      })
    }

    function AccountCard({ account, selected, busy, onSelect, onRescan, onProbe, onDelete, t }) {
      const { status, needsRescan } = accountState(account)
      const statusLabel = status === 'ok' ? t('sessionOk') : status === 'expired' ? t('sessionExpired') : t('sessionUnknown')
      return h('article', { className: `ydo-card${selected ? ' ydo-card-active' : ''}` },
        h('button', { type: 'button', className: 'ydo-card-main', onClick: () => onSelect(account.accountId), 'aria-current': selected },
          h(AccountAvatar, { account }),
          h('span', { className: 'ydo-card-text' },
            h('span', { className: 'ydo-card-name' }, account.nickname || account.accountId),
            h('span', { className: 'ydo-card-meta' },
              account.fanCount !== null && account.fanCount !== undefined
                ? `${t('fanCount')} ${formatCount(account.fanCount)}`
                : account.accountId)),
          h('span', { className: `ydo-status ydo-status-${status}` }, statusLabel)),
        h('div', { className: 'ydo-card-actions' },
          needsRescan
            ? h('button', { type: 'button', className: 'ydo-link', disabled: busy, onClick: () => onRescan(account.accountId) }, t('rescan'))
            : h('button', { type: 'button', className: 'ydo-link', disabled: busy, onClick: () => onProbe(account.accountId) }, busy ? t('checking') : t('check')),
          h('button', { type: 'button', className: 'ydo-link ydo-link-danger', disabled: busy, onClick: () => onDelete(account.accountId) }, t('deleteAccount'))))
    }

    // BarList 只负责渲染已经处理过的展示名（§5.4.3）：调用方先完成中文化/兜底，
    // 这里绝不回退到 source_label 等原始字段，避免绕过未知来源兜底。
    // variant="distribution"（二次优化 §5.2.2）：年龄/流量来源/地域/城市级别四类分布
    // 使用淡绿色填充；进度分析不传 variant，保持原主题色，不受影响。
    function BarList({ rows, label, t, unit = '%', variant = null }) {
      if (!rows || !rows.length) return h('p', { className: 'ydo-hint' }, t('none'))
      const valueOf = row => {
        const value = Number(row.pct ?? row.value)
        return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
      }
      const max = rows.reduce((acc, row) => Math.max(acc, valueOf(row) ?? 0), 0) || 1
      const rowKey = row => `${row.sourceKey ?? row.ageKey ?? row.key ?? row.keyword ?? row.word ?? ''}`
      return h('ul', { className: `ydo-bars${variant === 'distribution' ? ' ydo-bars-distribution' : ''}`, 'aria-label': label },
        ...rows.map(row => {
          const value = valueOf(row)
          const display = unit === '%' ? formatPercent(value) : value === null ? EMPTY : `${value}${unit}`
          return h('li', { key: rowKey(row) },
            h('span', { className: 'ydo-bar-label' }, row.key || row.keyword || row.word),
            h('span', { className: 'ydo-bar-track' }, h('span', { className: 'ydo-bar-fill', style: { width: `${value === null ? 0 : Math.min(100, (value / max) * 100)}%` } })),
            h('span', { className: 'ydo-bar-value' }, display))
        }))
    }

    // 性别用圆环（conic-gradient 自绘，不引图表库）：与创作中心「性别分布」一致。
    // 颜色与文案都按语义 key 映射（genderColor/genderLabel），不用数组下标——
    // 接口返回顺序变化时男/女颜色不会互换；圆环、图例共用同一映射（§7.1）。
    function GenderDonut({ rows, t }) {
      if (!rows || !rows.length) return h('p', { className: 'ydo-hint' }, t('none'))
      let acc = 0
      const stops = rows.map(row => {
        const start = acc
        const value = Number(row.pct)
        acc += Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
        return `${genderColor(row.key)} ${start}% ${acc}%`
      })
      const legendText = rows.map(row => `${genderLabel(row.key, t)} ${formatPercent(row.pct)}`).join('，')
      return h('div', { className: 'ydo-donut-wrap' },
        h('div', { className: 'ydo-donut', role: 'img', 'aria-label': `${t('gender')}：${legendText}`, style: { background: `conic-gradient(${stops.join(',')})` } },
          h('span', { className: 'ydo-donut-hole' })),
        h('ul', { className: 'ydo-legend' },
          ...rows.map(row => h('li', { key: row.key },
            h('span', { className: 'ydo-legend-dot', style: { background: genderColor(row.key) }, 'aria-hidden': true }),
            h('span', null, `${genderLabel(row.key, t)} ${formatPercent(row.pct)}`)))))
    }

    function WorkDetailModal({ accountId, workId, detail, trend, loading, onClose, t }) {
      const work = detail && detail.work ? detail.work : null
      const audience = detail && detail.audience ? detail.audience : null
      const gaps = work && work.data_gap ? Object.entries(work.data_gap) : []
      const hotwords = detail && Array.isArray(detail.hotwords) ? detail.hotwords : []
      // 发布时间与作品级最近采集严格分离（二次优化 §5.6.3）：publish_time 只显示为发布
      // 时间；latest_collected_at 只有接口实际返回且通过格式化校验才显示，缺失/非法时
      // 显示「暂无记录」，绝不回退 publish_time，也不把账号级 lastCollectedAt 伪装成
      // 作品级时间。时间格式统一走 formatDateTime（Asia/Shanghai，非法值显示 —）。
      const publishText = formatDateTime(work && work.publish_time)
      const latestText = formatDateTime(work && work.latest_collected_at)
      return h('div', { className: 'ydo-modal-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('detail') },
        h('div', { className: 'ydo-modal' },
          h('header', { className: 'ydo-modal-head' },
            h('div', null,
              h('h3', null, (work && work.title) || workId),
              h('p', { className: 'ydo-modal-meta' },
                `${t('publishTime')} ${publishText}`,
                work && work.visibility === 'not_in_list' ? ` · ${t('privateBadge')}` : null),
              h('p', { className: 'ydo-modal-meta' }, `${t('latestCollected')} ${latestText === EMPTY ? t('noRecord') : latestText}`)),
            h(Tooltip, { label: t('close') },
              h('button', { type: 'button', 'aria-label': t('close'), onClick: onClose }, h(IconCloseOutline16, { size: 16 })))),
          loading
            ? h('div', { className: 'ydo-state', role: 'status' }, h('span', { className: 'ydo-spinner' }), h('p', null, t('collecting')))
            : h('div', { className: 'ydo-modal-body' },
              h('section', { className: 'ydo-panel' }, h('h4', null, t('gender')), h(GenderDonut, { rows: convertDistribution(audience && audience.gender), t })),
              h('section', { className: 'ydo-panel' }, h('h4', null, t('age')), h(BarList, { rows: convertAge(audience && audience.age, t), label: t('age'), t, variant: 'distribution' })),
              h('section', { className: 'ydo-panel' }, h('h4', null, t('trafficSource')), h(BarList, { rows: convertSource(work && work.traffic_source, t), label: t('trafficSource'), t, variant: 'distribution' })),
              h('section', { className: 'ydo-panel' }, h('h4', null, t('progressCurve')),
                // 进度分析是观看行为分析（§7.2）：有点位画图，无数据/未暴露/请求失败各自给中文空态，不渲染空图例。
                progressStatus(work && work.progress_analysis, work) === 'ok'
                  ? h(BarList, { rows: convertProgress(work && work.progress_analysis, t), label: t('progressCurve'), t })
                  : h('p', { className: 'ydo-hint', role: 'status' }, progressStatusText(progressStatus(work && work.progress_analysis, work), t))),
              h('section', { className: 'ydo-panel' }, h('h4', null, t('province')), h(BarList, { rows: convertDistribution(audience && audience.province), label: t('province'), t, variant: 'distribution' })),
              h('section', { className: 'ydo-panel' }, h('h4', null, t('cityLevel')), h(BarList, { rows: convertDistribution(audience && audience.city_level), label: t('cityLevel'), t, variant: 'distribution' })),
              h('section', { className: 'ydo-panel' }, h('h4', null, t('searchKeywords')),
                h('div', { className: 'ydo-tags' },
                  ...(work && Array.isArray(work.search_keywords) && work.search_keywords.length
                    ? work.search_keywords.map(item => h('span', { className: 'ydo-tag', key: item.keyword }, `${item.keyword} ${formatPercent(item.percent)}`))
                    : [h('span', { className: 'ydo-hint', key: 'none' }, t('noSearch'))]))),
              h('section', { className: 'ydo-panel' }, h('h4', null, t('hotwords')),
                h('div', { className: 'ydo-tags' },
                  ...(hotwords.length
                    ? hotwords.map(item => h('span', { className: 'ydo-tag', key: item.word }, item.word))
                    : [h('span', { className: 'ydo-hint', key: 'none' }, t('noHotword'))]))),
              // 缺口卡片条件展示（§7.3）：无缺口不渲染，减少视觉噪音；有缺口列出中文字段名与中文原因。
              gaps.length
                ? h('section', { className: 'ydo-panel ydo-panel-gap' },
                  h('h4', null, t('gapTitle')),
                  h('ul', { className: 'ydo-gap-list' },
                    ...gaps.map(([field, info]) => {
                      const failed = info && info.reason === 'request_failed'
                      return h('li', { key: field, className: failed ? 'ydo-gap-failed' : undefined },
                        `${gapFieldLabel(field, t)} · ${gapReasonText(info && info.reason, t)}`)
                    })))
                : null,
              trend && Number.isFinite(Number(trend.total)) && Number(trend.total) > 0
                ? h('p', { className: 'ydo-hint' }, t('trendCount').replace('{count}', formatCount(trend.total)))
                : null)),
      )
    }

    function convertDistribution(rows) {
      if (!Array.isArray(rows)) return []
      return rows.map(row => ({ key: row.key, pct: row.pct }))
    }

    // 年龄分桶只在展示层转中文（二次优化 §5.5）；原始 key 保留在 ageKey 供调试与去重，
    // 未识别的 key 兜底「其他年龄段」，不删除数据。
    function convertAge(rows, t = key => key) {
      if (!Array.isArray(rows)) return []
      return rows.map(row => ({ key: formatAgeBucket(row && row.key, t), ageKey: row ? row.key : null, pct: row && row.pct }))
    }

    // 流量来源先转成 { key: 中文展示名, sourceKey: 原始 key, pct }（二次优化 §5.4.3）：
    // 已知 key 中文化、未知 key 统一「其他来源」，BarList 只渲染处理后的展示名。
    function convertSource(rows, t = key => key) {
      if (!Array.isArray(rows)) return []
      return rows.map(row => ({ key: trafficSourceLabel(row, t), sourceKey: row ? row.source_key : null, pct: row && row.share_pct }))
    }

    function convertProgress(progress, t = key => key) {
      if (!progress) return []
      const back = Array.isArray(progress.drag_back_curve) ? progress.drag_back_curve : []
      const forward = Array.isArray(progress.drag_forward_curve) ? progress.drag_forward_curve : []
      // 中文业务标签「拖回/拖前」，绝不暴露 drag_back_curve 等内部字段名（§7.2）。
      return [
        ...back.slice(0, 12).map(point => ({ key: `${t('dragBack')} ${point.key}s`, value: point.value })),
        ...forward.slice(0, 12).map(point => ({ key: `${t('dragForward')} ${point.key}s`, value: point.value })),
      ]
    }

    function WorkTable({ works, sort = DEFAULT_SORT_STATE, onSortChange, onOpen, t }) {
      if (!works.length) return h('div', { className: 'ydo-state', role: 'status' }, h('p', null, t('none')))
      // 粉丝数是账号级指标，只在左侧账号卡展示，不按行重复（§5.3）。
      // 列轨道模板由 COLUMNS 单一来源生成：表头与每行共用，避免滚动末端断线（§11.2.3）。
      const template = { gridTemplateColumns: tableTemplate(COLUMNS) }
      const cellProps = column => ({
        key: column.key,
        role: 'cell',
        className: `ydo-cell ydo-cell-${column.kind}${column.sticky !== undefined ? ' ydo-cell-sticky' : ''}`,
        style: column.sticky !== undefined ? { left: `${column.sticky}px` } : undefined,
      })
      const header = h('div', { className: 'ydo-table-head', role: 'row', style: template },
        ...COLUMNS.map(column => {
          const sticky = column.sticky !== undefined
          const cell = {
            key: column.key,
            role: 'columnheader',
            className: `ydo-cell ydo-cell-${column.kind}${sticky ? ' ydo-cell-sticky' : ''}`,
            style: sticky ? { left: `${column.sticky}px` } : undefined,
          }
          // 名称/链接不排序，无按钮也无箭头；可排序列用按钮语义，点击区域覆盖文字与箭头（§6.2）。
          if (column.sortable !== true) return h('div', cell, t(column.label))
          const direction = sort && sort.key === column.key && sort.direction !== 'default' ? sort.direction : 'default'
          cell['aria-sort'] = direction === 'desc' ? 'descending' : direction === 'asc' ? 'ascending' : 'none'
          const arrow = direction === 'desc' ? '↓' : direction === 'asc' ? '↑' : '↕'
          return h('div', cell,
            h('button', {
              type: 'button',
              className: `ydo-sort${direction !== 'default' ? ' ydo-sort-active' : ''}`,
              onClick: () => onSortChange && onSortChange(column.key),
              'aria-label': `${t(column.label)}：${direction === 'desc' ? t('sortDesc') : direction === 'asc' ? t('sortAsc') : t('sortDefault')}`,
            },
            h('span', { className: 'ydo-sort-text' }, t(column.label)),
            h('span', { className: 'ydo-sort-arrow', 'aria-hidden': true }, arrow)))
        }))
      // 默认态严格保持接口顺序；排序输出新数组，不改入参（§6.4）。
      const body = sortWorks(works, sort).map(work => h('div', {
        key: work.work_id,
        role: 'row',
        className: 'ydo-table-row',
        style: template,
        tabIndex: 0,
        // React 的合法事件名是 onDoubleClick；onDblClick 会被忽略、导致双击无响应。
        onDoubleClick: () => onOpen(work.work_id),
        onKeyDown: event => { if (event.key === 'Enter') onOpen(work.work_id) },
      },
      ...COLUMNS.map(column => {
        // 链接先过域名白名单（§9.2）：非 http(s)/非 www.douyin.com 一律按普通文本展示。
        const linkHref = column.kind === 'link' ? safeWorkUrl(work[column.key]) : null
        return h('div', {
          ...cellProps(column),
          title: column.kind === 'text' || column.kind === 'link' ? String(work[column.key] || '') : undefined,
        },
        linkHref
          // `noreferrer` 已隐含 noopener；统一 UX audit 要求新窗口链接使用该 rel 值。
          // 点击/回车/双击都不得冒泡到行，否则会同时打开浏览器和详情（§9.1）。
          ? h('a', {
            href: linkHref,
            target: '_blank',
            rel: 'noreferrer',
            onClick: event => event.stopPropagation(),
            onDoubleClick: event => event.stopPropagation(),
            onKeyDown: event => event.stopPropagation(),
          }, work[column.key])
          : formatCell(work[column.key], column.kind, t))
      })))
      return h('div', { className: 'ydo-table-wrap' },
        h('div', { className: 'ydo-table', role: 'table', 'aria-label': t('data') }, header, ...body))
    }

    function Overlay({ t }) {
      const visible = useSyncExternalStore(subscribeOpen, snapshotOpen, snapshotOpen)
      const shellRef = useRef(null)
      const [browser, setBrowser] = useState(null)
      const [accounts, setAccounts] = useState([])
      const [selected, setSelected] = useState(null)
      const [busy, setBusy] = useState(false)
      const [login, setLogin] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const [deleteTarget, setDeleteTarget] = useState(null)
      const [deleteState, setDeleteState] = useState(DELETE_LIFECYCLE.idle)
      const [error, setError] = useState(null)
      const [works, setWorks] = useState([])
      const [sort, setSort] = useState(DEFAULT_SORT_STATE)
      const [exporting, setExporting] = useState(false)
      const [collect, setCollect] = useState(null)
      const [detail, setDetail] = useState(null)
      const [detailWorkId, setDetailWorkId] = useState(null)
      const [trend, setTrend] = useState(null)
      const loginPollRef = useRef(null)
      const collectPollRef = useRef(null)

      const current = useMemo(() => accounts.find(item => item.accountId === selected) || null, [accounts, selected])

      // 排序是前端当前视图行为（§6.1）：账号切换、刷新、采集完成都会重新拉取 works
      // （数组身份变化），借同一信号清空排序，避免旧数据的排序状态套用到新数据。
      useEffect(() => {
        setSort(DEFAULT_SORT_STATE)
      }, [selected, works])
      const onSortChange = useCallback(columnKey => setSort(currentSort => nextSortState(currentSort, columnKey)), [])

      const loadWorks = useCallback(async accountId => {
        const result = await post({ action: 'works.list', accountId })
        if (result.status === 'ready') setWorks(result.works || [])
        else setError(result.reason || 'refresh_failed')
      }, [])

      const refresh = useCallback(async () => {
        const [status, list] = await Promise.all([post({ action: 'browser.status' }), post({ action: 'accounts.list' })])
        if (status.status === 'ready') setBrowser(status)
        if (list.status === 'ready') {
          setAccounts(list.accounts || [])
          setSelected(currentId => currentId || (list.accounts && list.accounts[0] ? list.accounts[0].accountId : null))
        }
      }, [])

      useEffect(() => {
        if (!visible) return undefined
        refresh().catch(() => setError('refresh_failed'))
        return undefined
      }, [visible, refresh])

      useEffect(() => {
        if (!visible || !selected) return undefined
        loadWorks(selected).catch(() => setError('refresh_failed'))
        return undefined
      }, [visible, selected, loadWorks])

      useEffect(() => {
        if (!visible) return undefined
        // 统一的生命周期契约：Esc 先关子页面，再关 overlay；关闭后焦点回到触发按钮。
        const onKey = event => {
          if (event.key === 'Escape') {
            if (detailWorkId) setDetailWorkId(null)
            else closeOverlay()
          }
        }
        document.addEventListener('keydown', onKey)
        shellRef.current?.focus?.()
        return () => document.removeEventListener('keydown', onKey)
      }, [visible, detailWorkId])

      const stopPolling = useCallback(ref => {
        if (ref.current) { clearInterval(ref.current); ref.current = null }
      }, [])

      useEffect(() => () => { stopPolling(loginPollRef); stopPolling(collectPollRef) }, [stopPolling])

      const beginLogin = useCallback(async accountId => {
        setBusy(true)
        setError(null)
        try {
          const started = await post({ action: 'account.beginLogin', accountId: accountId || undefined })
          if (started.status !== 'ready') { setError(started.reason || 'login_failed'); setBusy(false); return }
          setLogin(started.login)
          const key = started.login.loginKey
          stopPolling(loginPollRef)
          loginPollRef.current = setInterval(async () => {
            const result = await post({ action: 'account.loginStatus', loginKey: key }).catch(() => null)
            if (!result || result.status !== 'ready') return
            setLogin(result.login)
            if (result.login.status === 'waiting') return
            stopPolling(loginPollRef)
            if (result.login.status === 'ok') {
              // 登录成功但 account_save 失败：本地登录态有效而云端无账号记录，
              // 采集会在 run_start 处失败，必须显式提醒而不是静默继续。
              if (result.login.saveError) setError('account_save_failed')
              await refresh()
            } else {
              setError(result.login.status === 'timeout' ? 'login_timeout' : 'login_failed')
            }
            setBusy(false)
          }, LOGIN_POLL_INTERVAL_MS)
        } catch {
          setError('login_failed')
          setBusy(false)
        }
      }, [refresh, stopPolling])

      const probe = useCallback(async accountId => {
        setBusy(true)
        setError(null)
        try {
          const result = await post({ action: 'account.probe', accountId })
          if (result.status !== 'ready') setError(result.reason || 'probe_failed')
          else if (result.promoted && result.accountId) {
            // 占位账号已升级：跟随服务端迁移到真实 sec_uid，列表刷新后旧 ID 不复存在。
            setSelected(current => (current === accountId ? result.accountId : current))
          }
          await refresh()
        } catch {
          setError('probe_failed')
        } finally {
          setBusy(false)
        }
      }, [refresh])

      const removeAccount = useCallback(async accountId => {
        setConfirming(null)
        setDeleteTarget(accountId)
        // 已确认，等待设备清理与远端删除完成（confirmed_pending_adapter）。
        setDeleteState(DELETE_LIFECYCLE.confirmedPendingAdapter)
        setBusy(true)
        setError(null)
        try {
          // 删除状态机：设备端先清本地 Profile/storage_state，再请求远端清理。
          const local = await post({ action: 'account.removeLocal', accountId })
          if (local.status !== 'ready') {
            // 本地清理失败：保留远端业务数据与可重试入口，绝不显示「已删除」。
            setDeleteState(DELETE_LIFECYCLE.cleanupFailed)
            setError('deleteBlocked')
            return
          }
          const remote = await post({ action: 'account.removeRemote', accountId })
          if (remote.status !== 'ready') {
            // 在途 run 会拒绝远端删除：这不是清理失败，而是「先结束采集」的前置条件，
            // 因此给专属文案，但同样保留账号与重试入口（远端数据未被触碰）。
            setDeleteState(DELETE_LIFECYCLE.cleanupFailed)
            setError(remote.reason === 'RUN_STILL_ACTIVE' ? 'RUN_STILL_ACTIVE' : 'deleteBlocked')
            return
          }
          if (selected === accountId) { setSelected(null); setWorks([]) }
          await refresh()
          setDeleteState(DELETE_LIFECYCLE.idle)
          setDeleteTarget(null)
        } catch {
          setDeleteState(DELETE_LIFECYCLE.cleanupFailed)
          setError('deleteBlocked')
        } finally {
          setBusy(false)
        }
      }, [refresh, selected])

      const startCollect = useCallback(async accountId => {
        setBusy(true)
        setError(null)
        try {
          const started = await post({ action: 'collect.start', accountId })
          if (started.status !== 'ready') {
            setError(started.reason === 'session_required' ? 'sessionRequiredForCollect' : (started.reason || 'collectBlocked'))
            setBusy(false)
            return
          }
          setCollect(started.collect)
          stopPolling(collectPollRef)
          collectPollRef.current = setInterval(async () => {
            const result = await post({ action: 'collect.status', accountId }).catch(() => null)
            if (!result || result.status !== 'ready') return
            setCollect(result.collect)
            if (!result.collect || result.collect.status === 'running') return
            stopPolling(collectPollRef)
            setBusy(false)
            if (result.collect.status === 'completed') await loadWorks(accountId).catch(() => {})
            else setError('collectFailed')
            await refresh().catch(() => {})
          }, COLLECT_POLL_INTERVAL_MS)
        } catch {
          setError('collectFailed')
          setBusy(false)
        }
      }, [loadWorks, refresh, stopPolling])

      const openDetail = useCallback(async workId => {
        setDetailWorkId(workId)
        setDetail(null)
        setTrend(null)
        try {
          const [detailResult, trendResult] = await Promise.all([
            post({ action: 'work.get', accountId: selected, workId }),
            post({ action: 'work.trend', accountId: selected, workId }).catch(() => null),
          ])
          if (detailResult.status === 'ready') setDetail(detailResult)
          else setError(detailResult.reason || 'refresh_failed')
          if (trendResult && trendResult.status === 'ready') setTrend({ total: trendResult.total })
        } catch {
          setError('refresh_failed')
        }
      }, [selected])

      // 导出只读（§10.2/§11.2.8）：不改排序/选中/works 状态，导出中禁点防重复下载，
      // 失败只登记可读文案（按钮随即恢复，可重试）。
      const exportExcel = useCallback(async accountId => {
        if (!accountId) return
        setExporting(true)
        setError(null)
        try {
          const result = await post({ action: 'export', accountId })
          if (result.status !== 'ready') { setError(result.reason || 'export_failed'); return }
          downloadWorkbook(result)
        } catch {
          setError('export_failed')
        } finally {
          setExporting(false)
        }
      }, [])

      if (!visible) return null

      const chromeBlocked = browser && browser.chromeAvailable === false
      const driverBlocked = browser && browser.chromeAvailable === true && browser.driverAvailable === false
      const sessionUsable = accountState(current).collectable

      const left = h('aside', { className: 'ydo-accounts', 'aria-label': t('accounts') },
        h('h2', { className: 'ydo-panel-title' }, t('accounts')),
        accounts.length
          ? h('div', { className: 'ydo-account-list' }, ...accounts.map(account => h(AccountCard, {
            key: account.accountId, account, selected: account.accountId === selected, busy,
            onSelect: setSelected,
            onRescan: id => beginLogin(id),
            onProbe: probe,
            onDelete: id => {
              setDeleteTarget(id)
              setDeleteState(DELETE_LIFECYCLE.awaitingConfirmation)
              setConfirming(id)
            },
            t,
          })))
          : h('p', { className: 'ydo-hint' }, t('emptyAccounts')),
        h('button', {
          type: 'button', className: 'ydo-primary', disabled: busy || Boolean(chromeBlocked) || Boolean(driverBlocked),
          'aria-busy': busy && Boolean(login && login.status === 'waiting'),
          onClick: () => beginLogin(null),
        }, busy && login && login.status === 'waiting' ? t('scanning') : t('addAccount')),
        login && login.status === 'waiting'
          ? h('p', { className: 'ydo-hint', role: 'status', 'aria-live': 'polite' }, t('scanHint'))
          : null,
        deleteState === DELETE_LIFECYCLE.confirmedPendingAdapter
          ? h('p', { className: 'ydo-hint', role: 'status', 'aria-live': 'polite' }, t('deletePending'))
          : null,
        deleteState === DELETE_LIFECYCLE.cleanupFailed
          ? h('div', { className: 'ydo-delete-retry', role: 'alert', 'aria-live': 'assertive' },
            h('p', { className: 'ydo-error' }, t('deleteFailed')),
            h('button', {
              type: 'button', className: 'ydo-secondary', disabled: busy,
              'aria-busy': busy,
              onClick: () => removeAccount(deleteTarget),
            }, t('deleteRetry')))
          : null)

      let right
      if (chromeBlocked) {
        right = h('div', { className: 'ydo-state ydo-state-error', role: 'alert' },
          h('p', { className: 'ydo-state-title' }, t('noChromeTitle')),
          h('p', null, t('noChromeHint')),
          h('button', { type: 'button', className: 'ydo-secondary', onClick: () => refresh() }, t('retry')))
      } else if (driverBlocked) {
        right = h('div', { className: 'ydo-state ydo-state-error', role: 'alert' },
          h('p', { className: 'ydo-state-title' }, t('noDriverTitle')),
          h('p', null, t('noDriverHint')))
      } else if (!selected) {
        right = h('div', { className: 'ydo-state', role: 'status' }, h('p', null, accounts.length ? t('selectAccount') : t('emptyAccounts')))
      } else if (!works.length) {
        right = h('div', { className: 'ydo-state', role: 'status' },
          h('p', null, sessionUsable ? t('collectHint') : t('sessionRequiredForCollect')),
          // 账号没有作品时导出固定禁用，这里同步给出原因（§10.1/§12）。
          h('p', { className: 'ydo-hint' }, t('exportNoData')),
          collect && collect.progress ? h('p', { className: 'ydo-hint' }, progressText(collect, t)) : null)
      } else {
        right = h(WorkTable, { works, sort, onSortChange, onOpen: openDetail, t })
      }

      const runStatus = collect && collect.status !== 'running' ? collect.status : null
      const runBanner = runStatus === 'failed'
        ? h('p', { className: 'ydo-error', role: 'alert' }, t('collectFailed'))
        : runStatus === 'completed' && collect.result && collect.result.runStatus === 'partial'
          ? h('p', { className: 'ydo-warn', role: 'status' }, t('runPartial'))
          : runStatus === 'completed'
            ? h('p', { className: 'ydo-ok', role: 'status' }, t('runCompleted'))
            : null

      return h('div', { className: 'ydo-overlay' },
        h('main', { className: 'ydo-shell', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'ydo-title', ref: shellRef, tabIndex: -1, 'aria-busy': busy },
          h('header', { className: 'ydo-header' },
            h('div', null, h('h1', { id: 'ydo-title' }, t('title')), h('p', null, t('subtitle'))),
            h('div', { className: 'ydo-header-buttons' },
              h(Tooltip, { label: t('close') },
                h('button', { type: 'button', 'aria-label': t('close'), onClick: closeOverlay }, h(IconCloseOutline16, { size: 16 }))))),
          h('nav', { className: 'ydo-tabs', 'aria-label': t('data') },
            h('button', { type: 'button', 'aria-current': 'true' }, t('tabVideos'))),
          h('div', { className: 'ydo-body' },
            left,
            h('section', { className: 'ydo-right', 'aria-label': t('data') },
              h('div', { className: 'ydo-toolbar' },
                h('button', {
                  type: 'button', className: 'ydo-primary', disabled: busy || !sessionUsable,
                  onClick: () => startCollect(selected),
                }, collect && collect.status === 'running' ? t('collecting') : t('collectAll')),
                h('button', { type: 'button', className: 'ydo-secondary', disabled: busy, onClick: () => loadWorks(selected).catch(() => setError('refreshFailed')) }, t('refresh')),
                h('button', {
                  type: 'button', className: 'ydo-secondary ydo-export',
                  disabled: busy || exporting || !selected || !works.length,
                  'aria-busy': exporting,
                  title: !selected || !works.length ? t('exportNoData') : undefined,
                  onClick: () => exportExcel(selected),
                },
                h(IconDownloadOutline16, { size: 14 }),
                h('span', null, exporting ? t('exporting') : t('exportExcel'))),
                // 账号顶部「上次采集」= 账号最近一次采集运行完成时间（远端 account.lastCollectedAt），
                // 与作品发布时间/作品级采集时间含义不同；格式统一走 formatDateTime（二次优化 §5.6）。
                current && current.lastCollectedAt ? h('span', { className: 'ydo-hint' }, `${t('lastCollected')} ${formatDateTime(current.lastCollectedAt)}`) : null,
                works.length ? h('span', { className: 'ydo-hint' }, `${t('workCount')} ${works.length}`) : null),
              error ? h('p', { className: 'ydo-error', role: 'alert', 'aria-live': 'assertive' }, t(ERROR_COPY[error] || error) || t('collectFailed')) : null,
              runBanner,
              collect && collect.status === 'running'
                ? h('div', { className: 'ydo-progress', role: 'status', 'aria-live': 'polite', 'aria-busy': true },
                  h('span', { className: 'ydo-spinner' }), h('span', null, progressText(collect, t)))
                : null,
              right))),
        detailWorkId ? h(WorkDetailModal, {
          accountId: selected, workId: detailWorkId, detail, trend, loading: !detail, t,
          onClose: () => { setDetailWorkId(null); setDetail(null); setTrend(null) },
        }) : null,
        confirming
          ? h('div', { className: 'ydo-confirm-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('deleteConfirm') },
            h('div', { className: 'ydo-confirm' },
              h('p', { className: 'ydo-confirm-title' }, t('deleteConfirm')),
              h('div', { className: 'ydo-confirm-actions' },
                h('button', {
                  type: 'button', className: 'ydo-confirm-primary', disabled: busy,
                  'aria-busy': deleteState === DELETE_LIFECYCLE.confirmedPendingAdapter,
                  onClick: () => removeAccount(confirming),
                }, deleteState === DELETE_LIFECYCLE.confirmedPendingAdapter ? t('deletePending') : t('confirmYes')),
                h('button', {
                  type: 'button', className: 'ydo-confirm-secondary', disabled: busy,
                  onClick: () => { setConfirming(null); setDeleteState(DELETE_LIFECYCLE.idle) },
                }, t('confirmNo')))))
          : null)
    }

    const css = `.ydo-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.ydo-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.ydo-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.ydo-wide span{font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-overlay{position:fixed;inset:0;z-index:520;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.ydo-shell{display:grid;grid-template-rows:auto auto 1fr;width:100%;height:100%;overflow:hidden}.ydo-header{display:flex;min-height:72px;align-items:center;justify-content:space-between;gap:24px;padding:16px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-header h1{margin:0;font-size:var(--dsw-font-l-20-font-size,20px);line-height:1.25}.ydo-header p{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-header-buttons button{display:grid;width:36px;height:36px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.ydo-tabs{display:flex;gap:4px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-tabs button{height:44px;padding:0 18px;border:0;border-bottom:3px solid var(--dsw-alias-brand-primary);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:650}.ydo-body{display:grid;grid-template-columns:280px 1fr;min-height:0;overflow:hidden}.ydo-accounts{display:grid;align-content:start;gap:12px;padding:24px 20px;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto}.ydo-panel-title{margin:0;font-size:var(--dsw-font-base-16-font-size,16px)}.ydo-account-list{display:grid;gap:10px}.ydo-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.ydo-card-active{border-color:var(--dsw-alias-brand-primary)}.ydo-card-main{display:flex;align-items:center;gap:10px;width:100%;padding:12px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.ydo-card-text{display:grid;gap:2px;min-width:0;flex:1}.ydo-avatar{width:36px;height:36px;border-radius:8px;object-fit:cover;flex:none;background:var(--dsw-alias-bg-layer-2)}.ydo-avatar-fallback{display:grid;place-items:center;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size,14px);font-weight:600}.ydo-card-name{min-width:0;font-size:var(--dsh-content-font-size,14px);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-card-meta{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-card-actions{display:flex;justify-content:space-between;gap:8px;padding:0 12px 10px}.ydo-status{padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-size:var(--dsh-content-font-size-secondary,13px);flex:none}.ydo-status-ok{color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 50%,var(--dsw-alias-label-primary))}.ydo-status-expired{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary))}.ydo-link{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);cursor:pointer;padding:0}.ydo-link:hover{color:var(--dsw-alias-label-primary)}.ydo-link-danger:hover{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary))}.ydo-link:disabled{opacity:.5;cursor:default}.ydo-primary{min-height:40px;padding:0 16px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;cursor:pointer}.ydo-primary:disabled{opacity:.45;cursor:default}.ydo-secondary{min-height:36px;padding:0 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.ydo-secondary:disabled{opacity:.45;cursor:default}.ydo-export{display:inline-flex;align-items:center;gap:6px}.ydo-right{display:grid;grid-template-rows:auto auto auto 1fr;min-height:0;overflow:hidden;padding:20px 24px 24px;gap:12px}.ydo-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ydo-progress{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-table-wrap{overflow:auto;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}/* 列轨道由 tableTemplate(COLUMNS) 内联到表头与每行，这里不再写死一份（§11.2.3）。 */
    .ydo-table{width:max-content;min-width:100%}.ydo-table-head,.ydo-table-row{display:grid;align-items:center}.ydo-table-head{position:sticky;top:0;z-index:3;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-sort{display:flex;width:100%;align-items:center;gap:4px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.ydo-sort-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-sort-arrow{flex:none;min-width:12px;color:var(--dsw-alias-label-secondary)}.ydo-sort-active{color:var(--dsw-alias-label-primary)}.ydo-sort-active .ydo-sort-arrow{color:var(--dsw-alias-brand-primary)}.ydo-cell{padding:8px 10px;font-size:var(--dsh-content-font-size-secondary,13px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ydo-cell-count,.ydo-cell-pct,.ydo-cell-seconds{text-align:right;font-variant-numeric:tabular-nums}.ydo-cell-sticky{position:sticky;z-index:2;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.ydo-table-head .ydo-cell-sticky{z-index:4;background:var(--dsw-alias-bg-layer-2)}.ydo-table-row{cursor:default;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-table-row:hover .ydo-cell{background:var(--dsw-alias-bg-layer-2)}.ydo-table-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.ydo-cell a{color:var(--dsw-alias-brand-primary);text-decoration:none}.ydo-cell a:hover{text-decoration:underline}.ydo-state{display:grid;min-height:200px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size,14px);text-align:center}.ydo-state p{margin:0;max-width:640px;line-height:1.6}.ydo-state-title{color:var(--dsw-alias-label-primary);font-size:var(--dsw-font-base-16-font-size,16px);font-weight:600}.ydo-state-error .ydo-state-title{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary))}.ydo-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}.ydo-error{margin:0;color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary));font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-warn{margin:0;color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 50%,var(--dsw-alias-label-primary));font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-ok{margin:0;color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 50%,var(--dsw-alias-label-primary));font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-spinner{width:16px;height:16px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:ydo-spin .8s linear infinite}@keyframes ydo-spin{to{transform:rotate(360deg)}}.ydo-modal-overlay{position:fixed;inset:0;z-index:540;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent)}.ydo-modal{width:min(1080px,calc(100vw - 48px));max-height:calc(100vh - 64px);display:grid;grid-template-rows:auto 1fr;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 16px 48px rgba(0,0,0,.24);overflow:hidden}.ydo-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-modal-head h3{margin:0;font-size:var(--dsw-font-base-16-font-size,16px)}.ydo-modal-meta{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-modal-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;padding:20px;overflow:auto}.ydo-panel{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}.ydo-panel h4{margin:0 0 10px;font-size:var(--dsh-content-font-size,14px)}.ydo-panel-gap{border-color:var(--dsw-alias-state-warn-primary,#d29922)}.ydo-gap-list{margin:0;padding-left:18px;display:grid;gap:4px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-gap-list code{font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-primary)}.ydo-gap-list .ydo-gap-failed{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary))}.ydo-bars{margin:0;padding:0;list-style:none;display:grid;gap:6px}.ydo-bars li{display:grid;grid-template-columns:72px 1fr 56px;align-items:center;gap:8px;font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-bar-track{display:block;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}.ydo-bar-fill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary)}.ydo-bar-value{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}.ydo-donut-wrap{display:flex;align-items:center;gap:16px}.ydo-donut{position:relative;width:96px;height:96px;border-radius:50%;flex:none}.ydo-donut-hole{position:absolute;inset:22px;border-radius:50%;background:var(--dsw-alias-bg-base)}.ydo-legend{margin:0;padding:0;list-style:none;display:grid;gap:6px;font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-legend li{display:flex;align-items:center;gap:6px}.ydo-legend-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--dsw-alias-brand-primary)}.ydo-tags{display:flex;flex-wrap:wrap;gap:6px}.ydo-tag{padding:3px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-confirm-overlay{position:fixed;inset:0;z-index:560;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}.ydo-confirm{width:min(420px,calc(100vw - 32px));padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 40px rgba(0,0,0,.18)}.ydo-confirm-title{margin:0 0 20px;font-size:var(--dsw-font-base-16-font-size,15px);line-height:1.6}.ydo-confirm-actions{display:flex;justify-content:flex-end;gap:12px}.ydo-confirm-primary{min-height:36px;padding:0 18px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-weight:600;cursor:pointer}.ydo-confirm-secondary{min-height:36px;padding:0 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.ydo-delete-retry{display:grid;gap:8px;justify-items:start;padding:10px 12px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.ydo-delete-retry .ydo-secondary{min-height:32px}/* 二次优化（§5.2）色彩变量定义在 overlay 作用域，不引入全局污染：性别男=淡蓝/女=柔和红；四类分布（年龄/流量来源/地域/城市级别）条形图淡绿填充，进度分析不受影响。 */
    .ydo-overlay{--ydo-gender-male:#91C5EB;--ydo-gender-female:#E88989;--ydo-distribution-fill:#A6D9B0;--ydo-distribution-fill-hover:#8FC99B}.ydo-bars-distribution .ydo-bar-fill{background:var(--ydo-distribution-fill,#A6D9B0)}.ydo-bars-distribution .ydo-bar-fill:hover{background:var(--ydo-distribution-fill-hover,#8FC99B)}@media(max-width:1120px){.ydo-body{display:block;overflow:auto}.ydo-accounts{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-right{overflow:visible}.ydo-table-wrap{max-height:60vh}}`

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-douyin-operation: dictionaries')
      ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-yootun-douyin-operation: exclusive-overlay')
      ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = OVERLAY_ID; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-douyin-operation: styles')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: OVERLAY_ID, order: 43, inject: () => ({ t }) }, Button))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: OVERLAY_ID, order: 43, inject: () => ({ t }) }, Overlay))
    }

    module.exports = { apply, inject: ['slots', 'locale'], downloadWorkbook, formatCell, formatCount, formatPercent, gapReasonText, hasGap, progressText, WorkTable, WorkDetailModal }
    return module.exports;
  },
});
