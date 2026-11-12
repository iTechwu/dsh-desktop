window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-wx-channels-operation",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // 视频号工作台 UI 纯格式化函数（client.js 构建时内联；无 React/DOM 依赖）。
    // 视觉与交互基准：docs/1109/wx/ui-demo.html（§9.0 Demo 是一期 UI 冻结基准）。

    const EMPTY = '—'

    /** 缺失一律「—」，不显示 0 伪装（§9.2）。 */
    function fmt(value) {
      return value === null || value === undefined || value === '' ? EMPTY : String(value)
    }

    /** 数值列：可空数字 → 千分位或「—」；0 是真实值照常显示。 */
    function fmtCount(value) {
      if (value === null || value === undefined || value === '') return EMPTY
      const num = Number(value)
      return Number.isFinite(num) ? num.toLocaleString('zh-CN') : EMPTY
    }

    /** 比率列：0..100 数字 → 两位小数百分比或「—」。 */
    function fmtPct(value) {
      if (value === null || value === undefined || value === '') return EMPTY
      const num = Number(value)
      return Number.isFinite(num) ? `${num.toFixed(2)}%` : EMPTY
    }

    /** 时长：秒 → 「7.40 秒」或「—」。 */
    function fmtSeconds(value) {
      if (value === null || value === undefined || value === '') return EMPTY
      const num = Number(value)
      return Number.isFinite(num) ? `${num.toFixed(2)} 秒` : EMPTY
    }

    /** ISO 时间 → 本地展示（YYYY-MM-DD HH:mm）。 */
    function fmtDateTime(iso) {
      if (!iso) return EMPTY
      const parsed = new Date(iso)
      if (Number.isNaN(parsed.getTime())) return String(iso)
      const pad = value => String(value).padStart(2, '0')
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
    }

    /** 次数/人数 组合列：uv 缺失只显示次数，双缺失「—」（Demo pair 语义）。 */
    function fmtPair(count, uv) {
      if (count === null || count === undefined) return EMPTY
      if (uv === null || uv === undefined) return String(count)
      return `${count} / ${uv}`
    }

    /**
     * 作品摘要卡：播放量加权完播率（§9.2 口径，规范性）。
     * 仅对 completion 与 play 均非空的作品参与；分母 0 显示「—」。
     */
    function weightedCompletionRate(works) {
      let numerator = 0
      let denominator = 0
      for (const work of Array.isArray(works) ? works : []) {
        // Number(null) === 0 会把缺失伪装成真实零——先显式排除 null/undefined（§9.2）。
        const rate = work && work.completion_rate_pct !== null && work.completion_rate_pct !== undefined
          ? Number(work.completion_rate_pct) : null
        const play = work && work.play_count !== null && work.play_count !== undefined
          ? Number(work.play_count) : null
        if (rate !== null && Number.isFinite(rate) && play !== null && Number.isFinite(play)) {
          numerator += rate * play
          denominator += play
        }
      }
      return denominator > 0 ? Number(((numerator / denominator)).toFixed(2)) : null
    }

    /** 缺口作品数：当前值存在至少一个字段缺口的作品数（§9.2）。 */
    // 详情页与摘要卡共用的「核心缺口」白名单：只统计影响分析的字段缺失，
    // is_original（原创声明）等官方可选字段不计，避免摘要卡说「50 个有缺口」、
    // 详情页却说「无缺口」的自相矛盾（2026-11-11 review P2-3）。
    const CORE_GAP_FIELDS = new Set([
      'traffic_source',
      'retention_trend',
      'daily_metrics',
      'play_count',
      'like_count',
      'favorite_count',
      'comment_count',
      'share_count',
      'forward_count',
      'follow_count',
      'completion_rate_pct',
      'avg_play_duration_s',
      'cover_url',
      'publish_time',
      'duration_s',
    ])

    function hasCoreGap(work) {
      const gap = work && work.data_gap
      if (!gap || typeof gap !== 'object') return false
      return Object.keys(gap).some(field => CORE_GAP_FIELDS.has(field))
    }

    function gapWorkCount(works) {
      return (Array.isArray(works) ? works : []).filter(work => hasCoreGap(work)).length
    }

    /** 表头排序默认态：发布时间降序（进入页面即最近发布在前）。
     * 与抖音 DEFAULT_SORT_STATE（接口原序）不同：视频号现有默认体验是发布时间倒序，保留。 */
    const DEFAULT_SORT_STATE = { key: 'publish_time', direction: 'desc' }

    /** 表头排序三态状态机（对齐抖音 nextSortState）：点击新列 → desc；
     * 同列 desc → asc；asc → 回默认态（发布时间降序）。 */
    function nextSortState(currentState, columnKey) {
      if (!currentState || currentState.key !== columnKey || currentState.direction === 'default') {
        return { key: columnKey, direction: 'desc' }
      }
      if (currentState.direction === 'desc') return { key: columnKey, direction: 'asc' }
      return { ...DEFAULT_SORT_STATE }
    }

    /** 作品排序（表头排序态 {key, direction}；本地排序只查已入库数据）：
     * 缺失值恒沉底且不参与方向翻转；稳定排序保持接口原序。 */
    function sortWorks(works, sortState) {
      const rows = Array.isArray(works) ? [...works] : []
      if (!sortState || !sortState.key || sortState.direction === 'default') return rows
      const { key, direction } = sortState
      const sign = direction === 'asc' ? 1 : -1
      return rows
        .map((work, index) => ({ work, index }))
        .sort((left, right) => {
          const av = left.work ? left.work[key] : undefined
          const bv = right.work ? right.work[key] : undefined
          const aMissing = av === null || av === undefined
          const bMissing = bv === null || bv === undefined
          if (aMissing && bMissing) return left.index - right.index
          if (aMissing) return 1
          if (bMissing) return -1
          if (av === bv) return left.index - right.index
          if (typeof av === 'string' || typeof bv === 'string') {
            return String(av).localeCompare(String(bv)) * sign
          }
          return (av - bv) * sign
        })
        .map(entry => entry.work)
    }

    /** 来源分布行规范化：trafficSource JSON（§17.3）→ [{name, value}]，排除「全部」。
     * 缺失播放量保留 null（渲染「—」），不折算 0。 */
    function normalizeTrafficRows(trafficSource) {
      const rows = trafficSource && Array.isArray(trafficSource.rows) ? trafficSource.rows : []
      return rows
        .filter(row => row && row.sourceType !== 999)
        .map(row => {
          const value = row.playCount
          return {
            name: String(row.name || row.sourceKey),
            value: value === null || value === undefined || !Number.isFinite(Number(value))
              ? null
              : Number(value),
          }
        })
    }

    /** 作品列表「最近采集时间」：取所有行 `latest_collected_at` 的最大值，无有效值返回 null。
     *
     * 2026-11-12 真机反馈：该值原为表格最后一列，现改为工具栏刷新按钮后的单值展示，
     * 表格不再为它保留一列。 */
    function latestCollectedAt(works) {
      let latest = null
      for (const work of Array.isArray(works) ? works : []) {
        const raw = work && work.latest_collected_at
        if (!raw) continue
        const time = Date.parse(raw)
        if (Number.isNaN(time)) continue
        if (latest === null || time > latest.time) latest = { time, raw }
      }
      return latest ? latest.raw : null
    }

    /** 来源分布按播放量从大到小排序（最多的在最上方），缺失值沉底、不折算 0。
     *
     * 2026-11-12 真机反馈：详情页来源分布此前按官方行序展示，需按数值降序。 */
    function sortTrafficRowsByValue(rows) {
      const numeric = row => {
        const raw = row && row.value
        return raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw)
      }
      return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
        const av = numeric(a)
        const bv = numeric(b)
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        return bv - av
      })
    }

    /** 留存行规范化：retention_trend（§17.3）→ [{s, v}]。
     *
     * 键名兼容：`parse.js` 历史产出 `ratePct`，文档 §5.4 口径为 `rate_pct`；服务端
     * `retention_trend` 是原样 JSON 存取（不做 key 转换），两种形状都可能出现在库里。
     * 2026-11-11 review：只读 `rate_pct` 导致真机留存恒 0%。缺失值保留 null 显示「—」。
     */
    function normalizeRetentionPoints(retentionTrend) {
      const points = retentionTrend && Array.isArray(retentionTrend.points) ? retentionTrend.points : []
      return points
        .filter(point => point && Number.isFinite(Number(point.second)))
        .map(point => {
          const raw = point.rate_pct ?? point.ratePct
          const numeric = raw === null || raw === undefined ? null : Number(raw)
          return {
            s: Number(point.second),
            v: numeric === null || !Number.isFinite(numeric) ? null : Math.round(numeric),
          }
        })
    }

    // 画像维度标签映射（真机 dim 驱动，2026-11-10；不臆造官方未暴露语义）。
    // 未知项官方编码为 `unknow`（少一个 w），历史/兼容口径也见过 `unknown`，两者都
    // 显示「未知」，不能让英文编码透出到界面（2026-11-11 真机反馈）。
    const UNKNOWN_LABELS = new Set(['unknow', 'unknown'])
    function isUnknownKey(key) {
      return UNKNOWN_LABELS.has(String(key || '').trim().toLowerCase())
    }

    const PROFILE_LABEL_MAPS = {
      gender: { 1: '男', 2: '女', unknow: '未知', unknown: '未知' },
      age: row => {
        const key = String(row.key || '')
        if (isUnknownKey(key)) return '未知'
        const range = key.replace(/^fage_/, '')
        // `fage_50_+` → `50+'；`fage_01_17` → `1-17岁`（去前导零）。
        if (range.endsWith('_+')) return `${range.slice(0, -2).replace(/^0+/, '')}岁+`
        return `${range.split('_').map(part => part.replace(/^0+(?=\d)/, '')).join('-')}岁`
      },
      // 设备编码按官方后台口径映射（2026-11-11 真机交叉验证：官方 iOS 35.82% /
      // 安卓 59.7% 与本地 dim=1 的 36%、dim=2 的 60% 完全吻合）。未知编码仍显示未知。
      device: row => {
        if (isUnknownKey(row.key)) return '未知'
        const device = String(row.key).trim()
        if (device === '1') return 'iOS'
        if (device === '2') return '安卓'
        return `设备 ${device}`
      },
    }

    /** 画像维度行规范化：[{key,label,count}] → [[label, count]]。
     * `@_all` 是官方"全部"汇总行（count=总数），不属于分布条目，排除；gender 的
     * 1/2 与 age 的 fage_* 按真机编码映射为友好标签；device 仅暴露 1/2 编码，
     * 显示 iOS/安卓（按官方后台比例交叉验证），未知编码统一「未知」；province/city
     * 官方直接给中文名。 */
    function normalizeProfileRows(rows, dimension) {
      const map = dimension ? PROFILE_LABEL_MAPS[dimension] : null
      return (Array.isArray(rows) ? rows : [])
        .filter(row => row && row.key && row.key !== '@_all')
        // 计数缺失/非数字的行直接跳过，不折算 0（「缺失不补 0」口径，审查 P2-16）。
        .filter(row => row.count !== null && row.count !== undefined && Number.isFinite(Number(row.count)))
        .map(row => {
          // 未知编码在任一维度（含 province/city）都必须显示「未知」，不能透出英文。
          if (isUnknownKey(row.key)) return ['未知', Number(row.count)]
          let label = row.label || row.key
          if (typeof map === 'function') label = map(row)
          else if (map && map[String(row.key)] !== undefined) label = map[String(row.key)]
          return [label, Number(row.count)]
        })
    }

    /**
     * ISO 时间戳 → 上海语义日（YYYY-MM-DD）。趋势图判定「发布日之前」用：
     * 直接 slice(0,10) 会按 UTC 截断，跨零点的作品会算早一天。
     */
    function shanghaiDayOf(isoValue) {
      if (typeof isoValue !== 'string' || !isoValue) return null
      const time = Date.parse(isoValue)
      if (!Number.isFinite(time)) return null
      return new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10)
    }

    /**
     * 作品标题口径（2026-11-11 真机反馈）：官方后台列表显示的标题是发布文案
     * （parse 的 description），系统短标题（title，desc.shortTitle）仅部分作品
     * 有值且与后台展示不一致；部分作品两者皆缺 → 「—」。
     */
    function workTitle(work) {
      if (!work || typeof work !== 'object') return null
      const description = typeof work.description === 'string' ? work.description.trim() : ''
      if (description) return description
      const title = typeof work.title === 'string' ? work.title.trim() : ''
      return title || null
    }

    /** 封面/头像 URL 防御：仅 http(s)，解析失败返回 null（对齐抖音 safeAvatarSrc）。 */
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

    /**
     * 作品原始链接域名白名单（对齐抖音 safeWorkUrl）：仅 http(s) + 视频号官方域
     * （channels.weixin.qq.com / weixin.qq.com）。不满足返回 null，标题按纯文本展示。
     * 注意：官方列表接口（statistic/post_list）不提供公开观看 URL，objectId 无法
     * 构造公开页（exportId 是会过期的加密 ID，分享链 weixin.qq.com/sph/* 需官方分享
     * 动作获取）——当前 works.list 无 url 字段，本机制就位，待采集侧补分享链后生效。
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
      if (url.hostname !== 'channels.weixin.qq.com' && url.hostname !== 'weixin.qq.com') return null
      return trimmed
    }

    /** 关注者增长窗口聚合 → 指标卡四项（净增/新增/取消/总数）。 */
    function summarizeFansTrend(fansTrend) {
      const totals = fansTrend && fansTrend.totals ? fansTrend.totals : {}
      return [
        ['净增关注', totals.follower_net_count],
        ['新增关注', totals.follower_add_count],
        ['取消关注', totals.follower_reduce_count],
        // 时点值来自服务端 camelCase 键（tools queries.py followerTotalCount，review P1-1）。
        ['关注者总数', fansTrend ? fansTrend.followerTotalCount : null],
      ]
    }

    /** 全部视频指标窗口求和 → 指标卡（官方口径命名，§9.4）。 */
    function summarizeAccountMetrics(metrics) {
      const totals = metrics && metrics.totals ? metrics.totals : {}
      return [
        ['播放', totals.daily_play_count],
        ['喜欢', totals.daily_like_count],
        ['收藏', totals.daily_favorite_count],
        ['评论', totals.daily_comment_count],
        ['分享', totals.daily_share_count],
        ['转发聊天和朋友圈', totals.daily_forward_count],
        ['关注量', totals.daily_follow_count],
        ['设为铃声', totals.daily_ringset_count],
        ['设为状态', totals.daily_status_ref_count],
        ['设为朋友圈封面', totals.daily_status_cover_count],
      ]
    }

    /** 关注者总数趋势序列（窗口内逐日 total，用于折线图）。 */
    function fansTotalSeries(dailyRows) {
      return (Array.isArray(dailyRows) ? dailyRows : [])
        .filter(row => row && row.follower_total_count !== null && row.follower_total_count !== undefined)
        .map(row => Number(row.follower_total_count))
    }

    /**
     * 采集进度文案（数据形状由宿主 runner.js progressFromEvent 投影，对齐抖音
     * progressText 语义；wx 中文直出无文案字典）：
     * - work → 「采集进度 N/M」；batch_done → 「入库进度 i/j · s/e」；
     * - probing / list / account_level → 阶段提示；空/未知 → 「采集中…」。
     */
    function progressText(progress) {
      if (!progress || typeof progress !== 'object') return '采集中…'
      switch (progress.phase) {
        case 'probing': return '正在检查会话…'
        case 'list':
          return progress.collected
            ? `正在获取作品列表（已收集 ${progress.collected} 个）…`
            : '正在获取作品列表…'
        case 'work': return `采集进度 ${progress.index || 0}/${progress.total || 0}`
        case 'account_level': return '正在采集账号数据…'
        case 'batch_done':
          return `入库进度 ${progress.batchNo || 0}/${progress.totalBatches || 0} · ${progress.succeeded || 0}/${progress.expected || 0}`
        default: return '采集中…'
      }
    }

    /**
     * 批量运行中总进度行（对齐抖音 batchProgress 语义）：
     * probing → 「正在检查会话 i/n」；collecting → 「第 i/n 个账号」；终态返回 null。
     */
    /**
     * 作品/总览异步响应的落屏守卫（2026-11-11 review P1-4）：
     * 1. 请求序号必须最新——同账号并发时后到的旧响应不得覆盖新响应；
     * 2. 响应所属账号必须仍是当前选中账号——采集完成后按「采集账号」刷新，与当前
     *    选中无关，若不比对账号会把旧账号的数据写进新账号视图。
     * 抽成纯函数便于单测（渲染层无法直接覆盖 useEffect 内的时序）。
     */
    function shouldApplyResponse({
      requestId,
      currentRequestId,
      responseAccountId,
      currentAccountId,
    }) {
      if (requestId !== currentRequestId) return false
      return responseAccountId === currentAccountId
    }

    /**
     * 「刷新」结果聚合文案（2026-11-11 review P1-2）：三路查询各自返回成功标志，
     * 全部成功才报「已刷新」，否则明确指出哪几路失败（内部 Promise 吞错，直接
     * await 几乎不会 reject，靠 reject 判断会把失败报成成功）。
     */
    function refreshResultLabel(results = {}) {
      const failed = []
      if (results.works === false) failed.push('作品列表')
      if (results.overview === false) failed.push('账号总览')
      if (results.accounts === false) failed.push('账号列表')
      return failed.length ? `部分刷新失败：${failed.join('、')}` : '已刷新'
    }

    function batchProgressText(batch) {
      if (!batch || !batch.phase || batch.phase === 'finished' || batch.phase === 'ready') return null
      const total = Array.isArray(batch.items) ? batch.items.length : 0
      if (!total) return null
      const index = Math.min(total, (batch.currentAccountIndex || 0) + 1)
      if (batch.phase === 'probing') return `正在检查会话 ${index}/${total}`
      if (batch.phase === 'collecting') return `第 ${index}/${total} 个账号`
      return null
    }

    /**
     * 批量未完成条目稳定原因 → 中文文案（对齐抖音 batchReasonKey 收敛原则：未知
     * 稳定码收敛为通用文案，绝不把原始错误码暴露给业务用户）。
     */
    function batchReasonText(reason) {
      if (!reason) return ''
      if (reason === 'session_required' || reason === 'session_expired') return '会话已过期，请重新扫码'
      // 正则而非字面量：客户端源码/产物不得出现该凭证字段名的连续字面量（凭证卫生契约）。
      if (/^storage.state_missing$/.test(reason)) return '缺少本机登录态，请重新扫码登录'
      // 身份不匹配：同一个微信可绑定多个视频号，官方页面扫码后才有身份选择；当前登录
      // 身份与所选账号不是同一个（2026-11-11 真机串号排查）。
      if (reason === 'account_mismatch') return '当前登录的视频号与所选账号不一致，请重新扫码并在官方页面选择该视频号后重试'
      if (/^identity_check_failed/.test(reason)) return '无法确认当前登录的视频号身份，请重新扫码后重试'
      if (reason === 'identity_not_stable') return '未确认视频号身份（可能还在官方页面选择中），请重新扫码并在官方页面选完后确认'
      if (reason === 'pending_account') return '待升级账号'
      if (reason === 'probe_failed') return '会话检测失败'
      // 探测阶段的具体失效原因（批量跳过不再折叠，审查 P3-25⑤）。
      if (reason === 'no_session_cookie') return '官方页面未返回会话 Cookie，请重新扫码登录'
      if (reason === 'auth_data_unavailable') return '官方账号资料不可读，请重新扫码登录'
      if (reason === 'collect_busy') return '有采集任务进行中，请稍后重试'
      if (reason === 'partial') return '部分作品缺失'
      // 服务端确定性业务错误（2026-11-11 真机链路排查）：给可行动文案而非通用失败。
      if (reason === 'ACCOUNT_NOT_FOUND') return '云端缺少账号记录，请重新扫码登录后重试'
      if (reason === 'WX_TOOL_UNAVAILABLE') return '桌面未接通视频号工具通道，请升级客户端后重试'
      return '采集失败'
    }

    // 作品数据 Tab（视觉与交互基准：docs/1109/wx/ui-demo.html，§9.0/§9.2/§9.3）。
    // 纯展示组件：数据由 client.js 传入；排序/筛选/分页只作用于已入库数据。


    /** 表格列定义（对齐抖音 COLUMNS 单一来源）：sortable 列在表头渲染排序按钮。
     * 2026-11-11 真机反馈：去掉「操作」列（双击整行打开详情），作品列不再显示 ID 副行。 */
    const TABLE_COLUMNS = [
      { label: '作品' },
      { label: '发布时间', key: 'publish_time', sortable: true },
      { label: '完播率', key: 'completion_rate_pct', sortable: true },
      { label: '平均播放时长', key: 'avg_play_duration_s', sortable: true },
      { label: '播放', key: 'play_count', sortable: true },
      { label: '喜欢', key: 'like_count', sortable: true },
      { label: '收藏', key: 'favorite_count', sortable: true },
      { label: '评论', key: 'comment_count', sortable: true },
      { label: '分享', key: 'share_count', sortable: true },
      { label: '转发聊天和朋友圈', key: 'forward_count', sortable: true },
      { label: '关注量', key: 'follow_count', sortable: true },
      { label: '企微链接点击' },
      { label: '添加通讯录' },
    ]

    /** 顶部摘要卡（§9.2 固定 5 张，不随筛选/排序/分页变化）。
     *
     * `summaryOverview` 必须是固定 last_7d 窗口的独立快照（不随账号 Tab 窗口切换
     * 变化，review P0-3）；作品总数取账号行 feedCount（官方 feedsCount，review P0-4）。
     */
    function WorkSummaryCards({ works, summaryOverview, account }) {
      const totals = summaryOverview && summaryOverview.metrics && summaryOverview.metrics.totals
        ? summaryOverview.metrics.totals : {}
      const gapCount = gapWorkCount(works)
      const cells = [
        { label: '作品总数', value: fmtCount(account && account.feedCount), hint: '官方账号作品总数' },
        { label: '近7日播放', value: fmtCount(totals.daily_play_count), hint: '账号级官方聚合' },
        { label: '近7日关注量', value: fmtCount(totals.daily_follow_count), hint: '非净关注' },
        { label: '作品完播率', value: fmtPct(weightedCompletionRate(works)), hint: '按播放加权计算' },
        {
          label: '缺口作品',
          value: fmtCount(gapCount),
          // 计数为 0 时不该挂「至少 1 个字段缺失」的提示（会读成有缺口）。
          hint: gapCount > 0 ? '至少 1 个核心字段缺失' : '核心字段完整',
        },
      ]
      return h('div', { className: 'ywc-summary-grid' },
        cells.map(cell => h('div', { className: 'ywc-kpi', key: cell.label },
          h('div', { className: 'ywc-kpi-label' }, cell.label),
          h('div', { className: 'ywc-kpi-value' }, cell.value),
          h('div', { className: 'ywc-kpi-hint' }, cell.hint),
        )),
      )
    }

    /** 工具栏（采集本账号全部 / 刷新 / 运行中进度行）。筛选与排序在表头完成（对齐抖音工作台）。
     * 进度行布局契约（2026-11-11 真机反馈）：进度行固定在采集按钮**下方**独占一行
     * （工具栏纵向布局：第一行按钮组、第二行进度），绝不放到页面顶部通知条。collect 是
     * 宿主 collect.status 的进度投影（仅当前选中账号的传入）；running 时采集按钮禁用
     * 并显示 spinner + progressText。 */
    function WorkToolbar({
      onCollect, onRefresh, collectDisabled = false, refreshDisabled = false,
      refreshing = false, refreshMessage = null, collect = null, latestCollectedAt = null,
    }) {
      const running = Boolean(collect && collect.status === 'running')
      // 状态行统一在采集按钮下方：采集进度优先，其次是刷新结果提示
      // （2026-11-11 真机反馈：提示就地显示，不要顶部通知条）。
      const statusText = running
        ? progressText(collect && collect.progress)
        : (refreshMessage || null)
      return h('div', { className: 'ywc-toolbar' },
        h('div', { className: 'ywc-toolbar-left' },
          h('button', {
            className: 'ywc-button primary', type: 'button', onClick: onCollect,
            disabled: collectDisabled || running, 'aria-busy': running || undefined,
          }, running ? '采集中…' : '采集本账号全部'),
          // 刷新按钮：执行期间显示「刷新中…」并禁用，避免用户以为点击没生效
          // （2026-11-11 真机反馈）。
          h('button', {
            className: 'ywc-button', type: 'button', onClick: onRefresh,
            disabled: refreshDisabled || refreshing, 'aria-busy': refreshing || undefined,
          }, refreshing ? '刷新中…' : '刷新'),
          // 最近采集时间（2026-11-12 真机反馈）：原为表格最后一列，改为刷新按钮后的
          // 单值展示；无数据时显示「—」，不隐藏以免布局跳动。
          h('span', { className: 'ywc-toolbar-note' }, `最近采集时间：${fmtDateTime(latestCollectedAt)}`),
        ),
        statusText
          ? h('div', {
            className: 'ywc-progress', role: 'status', 'aria-live': 'polite',
            'aria-busy': running || undefined,
          },
          running ? h('span', { className: 'ywc-spinner', 'aria-hidden': true }) : null,
          h('span', null, statusText),
          )
          : null,
      )
    }

    /** 作品表格（对齐抖音 WorkTable 交互）：
     * - 无数据不渲染表格框架，只显示居中空态提示（ydo-state 同款）；
     * - 可排序列表头为按钮：点击 desc → asc → 默认循环，箭头 ↕/↓/↑ + aria-sort；
     * - 全量渲染已入库作品，固定高度区域内部滚动（无「加载更多」分页）；
     * - 2026-11-11 真机反馈：无「操作」列——双击整行（或行内回车）打开详情；
     *   作品列 = 封面缩略图 + 标题（官方发布文案口径），不再显示 ID 副行。 */
    function WorkTable({ rows, sort = DEFAULT_SORT_STATE, onSortChange, onOpenDetail, loading = false }) {
      // 首屏加载中与「确实没有作品」必须区分：两者外观一致时，2-3 秒等待看起来像卡死
      // （2026-11-12 真机反馈）。
      if (!rows.length && loading) {
        return h('div', { className: 'ywc-table-state', role: 'status', 'aria-busy': 'true' },
          h('span', { className: 'ywc-spinner', 'aria-hidden': true }),
          h('p', null, '正在加载作品…'),
        )
      }
      if (!rows.length) {
        return h('div', { className: 'ywc-table-state', role: 'status' },
          h('p', null, '当前账号暂无已入库作品，先执行「采集本账号全部」'),
        )
      }
      const headCells = TABLE_COLUMNS.map(column => {
        if (!column.sortable) return h('th', { key: column.label, scope: 'col' }, column.label)
        const direction = sort && sort.key === column.key && sort.direction !== 'default' ? sort.direction : 'default'
        const arrow = direction === 'desc' ? '↓' : direction === 'asc' ? '↑' : '↕'
        return h('th', {
          key: column.label, scope: 'col',
          'aria-sort': direction === 'desc' ? 'descending' : direction === 'asc' ? 'ascending' : 'none',
        },
          h('button', {
            type: 'button',
            className: `ywc-sort${direction !== 'default' ? ' ywc-sort-active' : ''}`,
            onClick: () => onSortChange && onSortChange(column.key),
            'aria-label': `${column.label}：${direction === 'desc' ? '降序' : direction === 'asc' ? '升序' : '默认排序'}`,
          },
            h('span', { className: 'ywc-sort-text' }, column.label),
            h('span', { className: 'ywc-sort-arrow', 'aria-hidden': true }, arrow),
          ),
        )
      })
      return h('div', { className: 'ywc-table-wrap' },
        h('table', { className: 'ywc-table', 'aria-label': '视频号作品列表' },
          h('thead', null, h('tr', null, headCells)),
          h('tbody', null, rows.map(work => h('tr', {
            key: work.work_id,
            tabIndex: 0,
            title: '双击查看作品详情',
            // 读屏用户无法感知 title 提示：显式 aria-label 说明行内可执行的动作。
            'aria-label': `${workTitle(work) || '未命名作品'}，回车或双击查看详情`,
            // React 的合法事件名是 onDoubleClick；onDblClick 会被忽略、导致双击无响应。
            onDoubleClick: () => onOpenDetail && onOpenDetail(work),
            onKeyDown: event => { if (event.key === 'Enter') onOpenDetail && onOpenDetail(work) },
          }, workRowCells(work)))),
        ),
      )
    }

    /** 作品封面（对齐抖音 WorkCover）：缩略图 + 右下角时长角标；加载失败/缺失 →
     * 占位块（浅灰底 + 居中「封面」小字），不隐藏作品行。coverUrl 为 null 不发请求。
     * size='large'（详情头部 110×146）复用同一结构。URL 只接受 http(s)（safeAvatarSrc 防御）。 */
    function WorkCover({ coverUrl, durationText, size = 'small' }) {
      const [failed, setFailed] = useState(false)
      const safeSrc = safeAvatarSrc(coverUrl)
      const boxClass = `ywc-cover${size === 'large' ? ' ywc-cover-large' : ''}${!safeSrc || failed ? ' ywc-cover-fallback' : ''}`
      return h('span', { className: boxClass },
        safeSrc && !failed
          ? h('img', {
            className: 'ywc-cover-img',
            src: safeSrc,
            alt: '',
            loading: 'lazy',
            referrerPolicy: 'no-referrer',
            onError: () => setFailed(true),
          })
          : h('span', { className: 'ywc-cover-fallback-text', 'aria-hidden': true }, '封面'),
        durationText && !(!safeSrc || failed) ? h('span', { className: 'ywc-cover-duration' }, durationText) : null)
    }

    function workRowCells(work) {
      // 原始链接机制（2026-11-11）：标题带链接需数据源提供 url（官方列表接口不提供，
      // 见 ui-format.safeWorkUrl 注释）——当前 works.list 无该字段，标题按纯文本渲染。
      const linkHref = safeWorkUrl(work.url)
      const title = workTitle(work) || EMPTY
      const cells = [
        h('td', { key: 'work' }, h('div', { className: 'ywc-work-cell' },
          // key 绑定封面地址：同一行/同一弹层的数据刷新后若 URL 变化，强制重挂载，
          // 避免沿用上一次加载失败留下的 failed 态而不再尝试新地址。
          h(WorkCover, {
            key: `cover:${work.work_id}:${work.cover_url || ''}`,
            coverUrl: work.cover_url,
            durationText: work.duration_s ? `${work.duration_s}s` : null,
          }),
          linkHref
            // `noreferrer` 已隐含 noopener；点击/双击不得冒泡到行（否则同时开浏览器+详情）。
            ? h('a', {
              className: 'ywc-work-title',
              href: linkHref, target: '_blank', rel: 'noreferrer',
              title,
              onClick: event => event.stopPropagation(),
              onDoubleClick: event => event.stopPropagation(),
              onKeyDown: event => event.stopPropagation(),
            }, title)
            : h('div', { className: 'ywc-work-title', title }, title),
        )),
        h('td', { key: 'publish' }, fmtDateTime(work.publish_time)),
        h('td', { key: 'completion' }, fmtPct(work.completion_rate_pct)),
        h('td', { key: 'avg' }, fmtSeconds(work.avg_play_duration_s)),
        h('td', { key: 'play' }, fmtCount(work.play_count)),
        h('td', { key: 'like' }, fmtCount(work.like_count)),
        h('td', { key: 'favorite' }, fmtCount(work.favorite_count)),
        h('td', { key: 'comment' }, fmtCount(work.comment_count)),
        h('td', { key: 'share' }, fmtCount(work.share_count)),
        h('td', { key: 'forward' }, fmtCount(work.forward_count)),
        h('td', { key: 'follow' }, fmtCount(work.follow_count)),
        h('td', { key: 'wecom' }, fmtPair(work.wecom_link_click_count, work.wecom_link_click_uv)),
        h('td', { key: 'contact' }, fmtPair(work.wecom_contact_add_count, work.wecom_contact_add_uv)),
      ]
      return cells
    }

    /** 作品详情弹层内容（2026-11-11 真机反馈重排）：
     * 头部一行 = 封面 + 元信息（标题/ID/发布时间/最近采集）→ KPI 卡片横向铺满 →
     * 来源分布与观众留存左右双卡片（对齐抖音单作品详情）→ 按日数据近 7 天多指标
     * 趋势线（播放用主题色，其余参考官方后台配色）→ 数据缺口。 */
    function WorkDetailDialog({ work, detail, dailyMetrics, onClose }) {
      if (!work) return null
      const trafficRows = sortTrafficRowsByValue(
        normalizeTrafficRows(detail && detail.traffic_source || work.traffic_source),
      )
      const retention = normalizeRetentionPoints(detail && detail.retention_trend || work.retention_trend)
      const daily = Array.isArray(dailyMetrics) ? dailyMetrics : []
      const gaps = dataGapEntries(work.data_gap)
      return h('div', { className: 'ywc-modal open', role: 'dialog', 'aria-modal': 'true', onClick: backdropClose(onClose) },
        h('div', { className: 'ywc-dialog', onClick: stopPropagation },
          h('header', { className: 'ywc-dialog-header' },
            h('div', null,
              h('h2', null, workTitle(work) || EMPTY),
              h('p', { className: 'ywc-card-meta' }, '基础信息 · 核心指标 · 来源分布 · 观众留存'),
            ),
            h('button', { className: 'ywc-close', type: 'button', 'aria-label': '关闭作品详情', onClick: onClose }, '×'),
          ),
          h('div', { className: 'ywc-dialog-body' },
            // 头部信息行：封面 + 元信息（2026-11-11：KPI 移出头部、铺满下方整行）。
            h('div', { className: 'ywc-dialog-grid' },
              h(WorkCover, {
                key: `detail-cover:${work.work_id}:${work.cover_url || ''}`,
                coverUrl: work.cover_url, size: 'large',
                durationText: work.duration_s ? `${work.duration_s}s` : null,
              }),
              h('div', { className: 'ywc-dialog-meta' },
                h('p', { className: 'ywc-card-meta' }, `ID：${work.work_id}`),
                h('p', { className: 'ywc-card-meta' }, `发布时间：${fmtDateTime(work.publish_time)}`),
                h('p', { className: 'ywc-card-meta' }, `最近采集：${fmtDateTime(work.latest_collected_at)}`),
              ),
            ),
            h('div', { className: 'ywc-metric-grid' },
              metricCells(work).map(([label, value]) => h('div', { className: 'ywc-kpi', key: label },
                h('div', { className: 'ywc-kpi-label' }, label),
                h('div', { className: 'ywc-kpi-value' }, fmt(value)),
              )),
            ),
            h('div', { className: 'ywc-two-column' },
              section('来源分布（不限）', trafficRows.length
                ? h('div', { className: 'ywc-bars' }, barRows(
                  trafficRows.map(row => [row.name, row.value === null ? EMPTY : row.value]),
                ))
                : h('p', { className: 'ywc-empty' }, '本次接口未提供来源数据')),
              section('观众留存趋势', retention.length
                ? h('div', { className: 'ywc-bars' }, barRows(
                  retention.map(point => [`${point.s}s`, point.v === null ? EMPTY : `${point.v}%`]),
                  row => Number(String(row[1]).replace('%', '')),
                ))
                : h('p', { className: 'ywc-empty' }, '本次接口未提供观众留存数据')),
            ),
            section('按日数据（近 7 天）', daily.length
              ? dailyTrendChart(daily, work.publish_time)
              : h('p', { className: 'ywc-empty' }, '该作品暂无按日数据')),
            section('数据缺口', gaps.length
              ? h('div', { className: 'ywc-bars' }, gaps.map(([name, gap]) => h('span', { className: 'ywc-badge', key: name }, `${name} · ${gapReasonText(gap)}`)))
              : h('span', { className: 'ywc-badge' }, '本次采集无核心字段缺口')),
          ),
        ),
      )
    }

    function metricCells(work) {
      return [
        ['完播率', fmtPct(work.completion_rate_pct)],
        ['平均播放时长', fmtSeconds(work.avg_play_duration_s)],
        ['播放', fmtCount(work.play_count)],
        ['喜欢', fmtCount(work.like_count)],
        ['收藏', fmtCount(work.favorite_count)],
        ['评论', fmtCount(work.comment_count)],
        ['分享', fmtCount(work.share_count)],
        ['转发聊天和朋友圈', fmtCount(work.forward_count)],
        ['关注量', fmtCount(work.follow_count)],
        ['企微链接点击次数', fmtCount(work.wecom_link_click_count)],
        ['企微链接点击人数', fmtCount(work.wecom_link_click_uv)],
        ['添加通讯录次数', fmtCount(work.wecom_contact_add_count)],
        ['添加通讯录人数', fmtCount(work.wecom_contact_add_uv)],
      ]
    }

    /** 按日趋势线指标与配色（2026-11-11 真机反馈）：播放用主题色（用户指定），
     * 其余参考官方后台趋势线配色（喜欢浅蓝/评论红/分享黄/关注绿，紫/橙借官方色系
     * 给收藏/转发，保证 7 条线可分）。 */
    const DAILY_SERIES = [
      { key: 'daily_play_count', label: '播放', color: 'var(--ywc-brand)' },
      { key: 'daily_like_count', label: '喜欢', color: '#4ea6ff' },
      { key: 'daily_favorite_count', label: '收藏', color: '#8b5cf6' },
      { key: 'daily_comment_count', label: '评论', color: '#e0524a' },
      { key: 'daily_share_count', label: '分享', color: '#d9a400' },
      { key: 'daily_forward_count', label: '转发', color: '#f08a3c' },
      { key: 'daily_follow_count', label: '关注量', color: '#2f9e44' },
    ]

    /**
     * 最近 N 个上海语义日（含 endDay，默认「昨天」——当天数据未收盘不入日表）。
     * 2026-11-11 真机反馈：趋势图 x 轴要固定 7 天并从当天往前推，缺数据的日期留空。
     */
    function recentDays(count = 7, endDayIso = null) {
      const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      let base = isDay(endDayIso) ? endDayIso : null
      if (!base) {
        const shanghaiNow = new Date(Date.now() + 8 * 3600 * 1000)
        shanghaiNow.setUTCDate(shanghaiNow.getUTCDate() - 1)
        base = shanghaiNow.toISOString().slice(0, 10)
      }
      const end = Date.parse(`${base}T00:00:00Z`)
      return Array.from({ length: count }, (_, index) =>
        new Date(end - (count - 1 - index) * 86400000).toISOString().slice(0, 10))
    }

    function trendNumber(value) {
      if (value === null || value === undefined) return null
      const numeric = Number(value)
      return Number.isFinite(numeric) ? numeric : null
    }

    /** y 轴标签格式：大数值用万/亿压缩（否则七位数字会超出左侧留白被 SVG 裁掉），
     * 小跨度保留一位小数（否则 63~66 会被四舍五入成重复刻度）。 */
    function fmtAxis(value, span) {
      const numeric = Number(value) || 0
      const abs = Math.abs(numeric)
      if (abs >= 100000000) return `${(numeric / 100000000).toFixed(1).replace(/\.0$/, '')}亿`
      if (abs >= 10000) return `${(numeric / 10000).toFixed(1).replace(/\.0$/, '')}万`
      if (span < 10) return numeric.toFixed(1).replace(/\.0$/, '')
      return fmtCount(Math.round(numeric))
    }

    /** y 轴刻度：把 [min,max] 切成 4 段（5 条网格线），标签取整。 */
    function yAxisTicks(min, max) {
      const span = max - min
      const ticks = []
      for (let index = 0; index <= 4; index += 1) {
        const value = min + (span * index) / 4
        ticks.push({ value, ratio: index / 4 })
      }
      return ticks
    }

    /**
     * 通用趋势图（2026-11-11 真机反馈，对齐官方后台）：
     * - 统一真实 y 轴刻度（所有系列共用），带网格线与数值标签；
     * - x 轴固定 rows 给出的自然日（调用方用 `recentDays(7)` 补齐）；
     * - 缺失值断线（不跨缺口连线、不造 0）；
     * - 鼠标移动时显示浮层，列出该日期下所有系列的值。
     */
    function TrendChart({ rows, series, ariaLabel = '趋势图', height = 210 }) {
      const [hoverIndex, setHoverIndex] = useState(null)
      const days = Array.isArray(rows) ? rows : []
      const lines = Array.isArray(series) ? series : []
      const width = 680
      const padLeft = 46
      const padRight = 16
      const padTop = 12
      const padBottom = 26
      const plotWidth = width - padLeft - padRight
      const plotHeight = height - padTop - padBottom
      const stepX = days.length > 1 ? plotWidth / (days.length - 1) : 0
      const xAt = index => padLeft + index * stepX

      const values = []
      for (const line of lines) {
        for (const row of days) {
          const value = trendNumber(row && row[line.key])
          if (value !== null) values.push(value)
        }
      }
      // 没有任何有效值时不画伪坐标轴（否则会渲染 0/0/1/1/1 这样的空图）。
      if (!values.length) {
        return h('p', { className: 'ywc-empty' }, '暂无可展示的趋势数据')
      }
      const rawMin = Math.min(...values)
      const rawMax = Math.max(...values)
      const yMin = rawMin === rawMax ? Math.max(0, rawMin - 1) : rawMin
      const yMax = rawMin === rawMax ? rawMax + 1 : rawMax
      const yAt = value => padTop + plotHeight - ((Number(value) - yMin) / (yMax - yMin || 1)) * plotHeight
      const ticks = yAxisTicks(yMin, yMax)

      const handleMove = event => {
        if (!days.length) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (!rect || !rect.width) return
        const ratio = (event.clientX - rect.left) / rect.width
        const svgX = ratio * width
        const raw = stepX > 0 ? Math.round((svgX - padLeft) / stepX) : 0
        const index = Math.min(days.length - 1, Math.max(0, raw))
        if (index !== hoverIndex) setHoverIndex(index)
      }

      const grid = [
        ...ticks.map((tick, index) => h('g', { key: `tick-${index}` },
          h('line', {
            x1: padLeft, y1: yAt(tick.value).toFixed(1), x2: width - padRight, y2: yAt(tick.value).toFixed(1),
            style: { stroke: 'var(--ywc-border)', strokeWidth: 1 },
          }),
          h('text', {
            x: padLeft - 8, y: (yAt(tick.value) + 3).toFixed(1), textAnchor: 'end',
            style: { fill: 'var(--ywc-muted)', fontSize: 10 },
          }, fmtAxis(tick.value, yMax - yMin)),
        )),
      ]

      const paths = []
      // 绘制顺序反转：第一条 series（主指标，如播放量）最后画、压在最上层——多条线
      // 在 0 附近重叠时，主指标不能被后画的线盖住看不见（2026-11-11 真机反馈）。
      for (const line of [...lines].reverse()) {
        let d = ''
        let segmentOpen = false
        days.forEach((row, index) => {
          const value = trendNumber(row && row[line.key])
          if (value === null) {
            segmentOpen = false
            return
          }
          d += `${segmentOpen ? 'L' : 'M'}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`
          segmentOpen = true
        })
        if (d) paths.push(h('path', { key: line.key, d, stroke: line.color, strokeWidth: 2, fill: 'none' }))
      }

      const labels = days.map((row, index) => h('text', {
        key: `x-${index}`, x: xAt(index).toFixed(1), y: height - 8,
        textAnchor: 'middle', style: { fill: 'var(--ywc-muted)', fontSize: 10 },
      }, String(row && row.day || '').slice(5)))

      const hoverRow = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < days.length ? days[hoverIndex] : null
      const hoverLeft = hoverRow ? Math.min(88, Math.max(12, (xAt(hoverIndex) / width) * 100)) : 0
      const tooltip = hoverRow ? h('div', {
        className: 'ywc-chart-tooltip',
        style: { left: `${hoverLeft}%` },
      },
      h('div', { className: 'ywc-chart-tooltip-day' }, String(hoverRow.day || '')),
      lines.map(line => {
        const value = trendNumber(hoverRow[line.key])
        return h('div', { className: 'ywc-chart-tooltip-row', key: line.key },
          h('i', { style: { background: line.color } }),
          h('span', { className: 'ywc-chart-tooltip-name' }, line.label),
          h('span', { className: 'ywc-chart-tooltip-value' }, value === null ? EMPTY : fmtCount(value)),
        )
      })) : null

      return h('div', { className: 'ywc-chart-wrap' },
        h('svg', {
          className: 'ywc-svg', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel,
          onMouseMove: handleMove,
          onMouseLeave: () => setHoverIndex(null),
        },
        grid,
        hoverRow ? h('line', {
          className: 'ywc-chart-cursor',
          x1: xAt(hoverIndex).toFixed(1), y1: padTop, x2: xAt(hoverIndex).toFixed(1), y2: padTop + plotHeight,
          style: { stroke: 'var(--ywc-muted)', strokeWidth: 1, strokeDasharray: '3 3' },
        }) : null,
        paths,
        hoverRow ? lines.map(line => {
          const value = trendNumber(hoverRow[line.key])
          if (value === null) return null
          return h('circle', {
            key: `dot-${line.key}`, cx: xAt(hoverIndex).toFixed(1), cy: yAt(value).toFixed(1), r: 3,
            style: { fill: 'var(--ywc-surface)', stroke: line.color, strokeWidth: 2 },
          })
        }) : null,
        h('line', {
          x1: padLeft, y1: padTop + plotHeight, x2: width - padRight, y2: padTop + plotHeight,
          style: { stroke: 'var(--ywc-border)', strokeWidth: 1 },
        }),
        labels),
        tooltip,
      )
    }

    /** 按日数据趋势线（2026-11-11：替代原 7 列明细表，对齐官方后台趋势图）：
     * x 轴固定最近 7 个自然日、统一真实 y 轴刻度；**发布日之前按 0 处理**（作品尚不
     * 存在，确定性为 0），发布日之后的缺失才断线（可能采集中断，不能造 0）。 */
    function dailyTrendChart(daily, publishTime) {
      const byDay = new Map()
      for (const row of Array.isArray(daily) ? daily : []) {
        if (row && row.day) byDay.set(String(row.day), row)
      }
      const publishDay = shanghaiDayOf(publishTime)
      const rows = recentDays(7).map(day => {
        // 发布前的日期：作品还没发，各项指标确定是 0（2026-11-11 真机反馈）。
        // 必须优先于 byDay 判定——官方聚合可能对这些天返回 null 行，若先取 found
        // 就会保留 null 变成断线（实测 11-04~11-06 仍然空白）。
        if (publishDay && day < publishDay) {
          const zeros = {}
          for (const line of DAILY_SERIES) zeros[line.key] = 0
          return { day, ...zeros }
        }
        const found = byDay.get(day)
        return found ? { day, ...found } : { day }
      })
      const hasAny = rows.some(row => DAILY_SERIES.some(line => trendNumber(row[line.key]) !== null))
      if (!hasAny) return h('p', { className: 'ywc-empty' }, '该作品暂无按日数据')
      return h('div', null,
        h('div', { className: 'ywc-chart-legend' },
          DAILY_SERIES.map(line => h('span', { key: line.key },
            h('i', { style: { background: line.color } }), line.label))),
        h(TrendChart, { rows, series: DAILY_SERIES, ariaLabel: '按日数据近 7 天趋势' }),
      )
    }

    function section(title, content) {
      return h('section', { className: 'ywc-detail-section' },
        h('h4', null, title),
        content,
      )
    }

    /** 条形行：rows 统一为 [[label, display]]，valueOf(row) 提取数值用于宽度比例。 */
    function barRows(rows, valueOf = row => Number(row[1])) {
      const max = Math.max(1, ...rows.map(row => Number(valueOf(row)) || 0))
      return rows.map(([name, value]) => h('div', { className: 'ywc-bar-row', key: name },
        h('span', null, name),
        h('div', { className: 'ywc-bar-track' }, h('div', {
          className: 'ywc-bar-fill',
          style: { width: `${Math.round((Number(valueOf([name, value])) || 0) / max * 100)}%` },
        })),
        h('span', { className: 'ywc-bar-value' }, String(value)),
      ))
    }

    // 详情页只展示影响分析的缺口（白名单与摘要卡共用，见 ui-format 的 CORE_GAP_FIELDS）；
    // 原创声明等非核心字段缺失时静默过滤，避免被误读为采集失败（2026-11-11 真机反馈）。
    function dataGapEntries(dataGap) {
      if (!dataGap || typeof dataGap !== 'object') return []
      return Object.entries(dataGap)
        .filter(([field]) => CORE_GAP_FIELDS.has(field))
        .map(([field, gap]) => [FIELD_NAMES[field] || field, gap])
    }

    function gapReasonText(gap) {
      const reason = gap && gap.reason ? String(gap.reason) : ''
      if (reason === 'not_exposed') return '本次接口未提供'
      if (reason === 'FIELD_LENGTH_MISMATCH') return '官方序列长度异常'
      if (reason === 'TIME_SERIES_LENGTH_MISMATCH') return '官方窗口长度异常'
      if (reason === 'unknown_source_type') return '官方新增来源待适配'
      return reason || '本次接口未提供'
    }

    const FIELD_NAMES = {
      cover_url: '作品封面',
      publish_time: '发布时间',
      duration_s: '视频时长',
      play_count: '播放',
      like_count: '喜欢',
      favorite_count: '收藏',
      comment_count: '评论',
      forward_count: '转发聊天和朋友圈',
      share_count: '分享',
      follow_count: '关注量',
      completion_rate_pct: '完播率',
      avg_play_duration_s: '平均播放时长',
      fast_flip_rate_pct: '快速划走率',
      yesterday_play_count: '昨日播放',
      traffic_source: '来源分布',
      retention_trend: '观众留存',
      wecom_link_click_count: '企微链接点击次数',
      wecom_link_click_uv: '企微链接点击人数',
      wecom_contact_add_count: '添加通讯录次数',
      wecom_contact_add_uv: '添加通讯录人数',
      daily_play_count: '按日播放',
      daily_like_count: '按日喜欢',
      daily_favorite_count: '按日收藏',
      daily_comment_count: '按日评论',
      daily_forward_count: '按日转发',
      daily_share_count: '按日分享',
      daily_follow_count: '按日关注量',
      daily_ringset_count: '按日设为铃声',
      daily_status_cover_count: '按日朋友圈封面',
      daily_status_ref_count: '按日设为状态',
      daily_wecom_link_click_count: '按日企微点击',
      daily_wecom_contact_add_count: '按日添加通讯录',
      observed_completion_rate_pct: '按日完播率',
      observed_avg_play_duration_s: '按日平均时长',
      observed_fast_flip_rate_pct: '按日划走率',
    }

    function backdropClose(onClose) {
      return event => { if (event.target === event.currentTarget) onClose() }
    }

    function stopPropagation(event) { event.stopPropagation() }

    // 账号数据 Tab / 账号区 / 登录弹层（视觉基准：docs/1109/wx/ui-demo.html，§9.1/§9.4）。


    const WINDOWS = [['yesterday', '昨日'], ['last_7d', '近7天'], ['last_30d', '近30天']]

    function avatarText(account) {
      const name = account.nickname || account.accountId || '视'
      return name.slice(0, 2)
    }

    function stateLine(account) {
      const map = { ok: '登录有效', expired: '登录已过期', unknown: '状态未知' }
      const label = account.deleteState === 'remote_deleted' ? '已删除（墓碑）' : map[account.sessionStatus] || map.unknown
      return h('span', { className: 'ywc-state', 'data-state': account.sessionStatus }, label)
    }

    /** 左侧账号管理栏（仅作品数据 Tab 显示；对齐抖音 ydo-accounts 结构）：
     * 标题行「账号管理 + 采集全部」→ 批量进度面板（仅批量运行/有结果时渲染；布局契约
     * 对齐抖音 BatchPanel：面板挂在标题行下方、账号列表上方，侧栏 grid 流内自然占一行，
     * 不进右侧工具栏）→ 账号卡列表 → 底部「添加账号」宽主按钮（登录进行中显示扫码提示并禁用）。
     * 运行中：spinner + 总进度（检查会话 / 第 i/n 个账号）+ 当前账号名 · 细粒度进度
     * （batch.currentProgress，宿主随 collectAll.status 投影，无需第二路轮询）+ 实时计数；
     * 终态：三态汇总（部分失败绝不伪装成整体成功）+ 失败/跳过账号逐行稳定原因。 */
    function AccountList({
      accounts, selectedId, onSelect, onProbe, onRemove, onBeginLogin,
      batch, onCollectAll, busy, browserBlocked, loginActive,
    }) {
      const collectable = accounts.some(item => item.deleteState !== 'remote_deleted' && item.sessionStatus === 'ok')
      const running = Boolean(batch && batch.phase && batch.phase !== 'finished')
      const nameOf = accountId => {
        const account = (accounts || []).find(item => item.accountId === accountId)
        return (account && account.nickname) || accountId || ''
      }
      // 未完成明细必须包含 partial（部分作品缺失）——否则汇总显示「成功 N、失败 0」，
      // 部分失败账号却不出现在明细里（审查 P2-15）。
      const unfinished = running || !batch
        ? []
        : (batch.items || []).filter(
          item => item.status === 'failed' || item.status === 'skipped' || item.status === 'partial',
        )
      return h('section', { className: 'ywc-panel' },
        h('div', { className: 'ywc-side-head' },
          h('h2', null, '账号管理'),
          h('button', {
            className: 'ywc-primary', type: 'button',
            disabled: busy || running || browserBlocked || !collectable,
            title: collectable ? undefined : '没有可采集账号（需登录有效）',
            onClick: onCollectAll,
          }, running ? '采集中' : '采集全部'),
        ),
        batch && (running || batch.summary)
          ? h('div', {
            className: 'ywc-batch-panel',
            role: running ? 'status' : undefined,
            'aria-live': running ? 'polite' : undefined,
            'aria-busy': running || undefined,
          },
            running
              ? [
                h('div', { className: 'ywc-progress', key: 'prog' },
                  h('span', { className: 'ywc-spinner', 'aria-hidden': true }),
                  h('span', null, batchProgressText(batch) || '正在采集…'),
                ),
                batch.currentAccountId
                  ? h('p', { className: 'ywc-hint', key: 'cur' },
                    `当前账号 ${nameOf(batch.currentAccountId)}`,
                    batch.currentProgress ? ` · ${progressText(batch.currentProgress)}` : '',
                  )
                  : null,
                h('p', { className: 'ywc-hint', key: 'cnt' },
                  `成功 ${batch.completedCount || 0} · 部分完成 ${batch.partialCount || 0} · `
                  + `失败 ${batch.failedCount || 0} · 跳过 ${batch.skippedCount || 0}`),
              ]
              : [
                h('p', {
                  className: batch.summary.status === 'completed' ? 'ywc-ok' : batch.summary.status === 'failed' ? 'ywc-error' : 'ywc-warn',
                  key: 'sum',
                },
                  `批量结束：成功 ${batch.summary.completed}、部分完成 ${batch.summary.partial || 0}、`
                  + `失败 ${batch.summary.failed}、跳过 ${batch.summary.skipped}`),
                unfinished.length
                  ? h('div', { className: 'ywc-batch-detail', key: 'detail' },
                    ...unfinished.map(item => h('p', { key: item.accountId, className: 'ywc-batch-item' },
                      h('span', { className: 'ywc-batch-item-name' }, nameOf(item.accountId)),
                      h('span', { className: 'ywc-batch-item-reason' }, batchReasonText(item.reason)),
                    )),
                  )
                  : null,
              ],
          )
          : null,
        h('div', { className: 'ywc-account-list' },
          accounts.length === 0
            ? h('p', { className: 'ywc-empty', style: { padding: '0 2px 6px' } }, '还没有账号，点击下方「添加账号」扫码登录')
            : accounts.map(account => h('article', {
              className: 'ywc-card', key: account.accountId,
              'aria-current': account.accountId === selectedId ? 'true' : 'false',
            },
              h('button', { className: 'ywc-card-main', type: 'button', onClick: () => onSelect(account.accountId) },
                h('span', { className: 'ywc-avatar' }, avatarText(account)),
                h('span', null,
                  h('span', { className: 'ywc-card-name' }, account.nickname || account.accountId),
                  h('span', { className: 'ywc-card-meta' }, `关注者 ${fmtCount(account.followerTotalCount)} · 最近同步 ${fmtDateTime(account.lastCollectedAt || account.sessionCheckedAt)}`),
                  stateLine(account),
                ),
              ),
              h('div', { className: 'ywc-card-actions' },
                h('button', {
                  // 登录进行中禁用（否则会在已有浏览器窗口上再开一个，并抢走轮询）；
                  // 墓碑账号（云端已删）不允许重新登录，避免把已删除账号又拉回来。
                  className: 'ywc-mini-button', type: 'button',
                  disabled: busy || running || loginActive || browserBlocked
                    || account.deleteState === 'remote_deleted',
                  // 会话有效 → 只探活；会话已过期 → 直接打开浏览器重新扫码（2026-11-11
                  // 真机反馈：原先两种状态都绑 onProbe，点「重新扫码」没有任何反应）。
                  // 重新扫码不传账号 ID：登录用全新临时 Profile，避免扫码得到另一个视频号
                  // 身份时把本账号的 Profile 目录迁移走（同一微信多视频号场景）。
                  onClick: () => (sessionActionFor(account) === 'probe'
                    ? onProbe(account.accountId)
                    : onBeginLogin()),
                }, sessionActionFor(account) === 'probe' ? '检测会话' : '重新扫码'),
                h('button', {
                  className: 'ywc-mini-button danger', type: 'button', disabled: busy || running,
                  onClick: () => onRemove(account.accountId),
                }, '删除账号'),
              ),
            )),
        ),
        h(LoginStatusButton, { loginActive, browserBlocked, onBeginLogin }),
      )
    }

    /** 账号数据 Tab（§9.4 三段：全部视频指标 / 关注者增长 / 关注者画像）。
     * 全宽独占布局：页内自带账号选择器（对齐抖音总览的账号下拉：有账号即显示，
     * 不因单账号隐藏），切换后三段数据随之刷新。
     * 关注者画像（2026-11-11 真机反馈）：去掉维度 Tab 切换，改为 KPI 卡片组同屏展示——
     * 性别/访问设备=环形图（中心总人数）+图例，年龄分布=柱状图带百分比标签，
     * 省份/城市=横向条形两列卡片（对齐官方后台截图布局）。 */
    function AccountTab({
      window: windowKey, onWindow, overview, profile,
      trendOverview = null,
      accounts, selectedId, onSelectAccount,
    }) {
      const availability = (overview && overview.availability) || {}
      const usable = (Array.isArray(accounts) ? accounts : []).filter(item => item.deleteState !== 'remote_deleted')
      return h('div', { className: 'ywc-account-page' },
        usable.length > 0
          ? h('div', { className: 'ywc-field', style: { justifyContent: 'flex-start', gap: 8 } },
            '当前账号',
            h('select', {
              className: 'ywc-select', value: selectedId || '',
              onChange: event => onSelectAccount(event.target.value), 'aria-label': '切换账号',
              style: { minWidth: 220 },
            },
              usable.map(item => h('option', { value: item.accountId, key: item.accountId },
                item.nickname || item.accountId,
              )),
            ),
          )
          : null,
        h('section', { className: 'ywc-panel' },
          h('div', { className: 'ywc-section-title' },
            h('h3', null, '全部视频指标'),
            windowGroup(WINDOWS, windowKey, onWindow),
          ),
          h('div', { className: 'ywc-kpi-grid' }, metricCards(overview)),
          availability.account_metrics === 'no_data'
            ? h('p', { className: 'ywc-empty', style: { padding: '0 12px 12px' } }, '该窗口暂无已入库的账号聚合数据，先执行采集')
            : null,
        ),
        h('div', { className: 'ywc-two-column' },
          h('section', { className: 'ywc-panel' },
            h('div', { className: 'ywc-section-title' }, h('h3', null, '关注者增长'), h('span', { className: 'ywc-badge' }, '账号级')),
            h('div', { className: 'ywc-chart-body' },
              h('div', { className: 'ywc-chart-legend' }, h('span', null, h('i', null), '关注者总数'), h('span', null, '净增 / 新增 / 取消关注见指标卡')),
              h(TrendChart, {
                // 固定 7 天口径：优先用 last_7d 概览（「昨日」窗口只有 2 天数据）。
                rows: fansTrendRows(trendOverview || overview),
                series: FANS_SERIES,
                ariaLabel: '关注者总数趋势（近 7 天）',
              }),
            ),
          ),
          h('section', { className: 'ywc-panel' },
            h('div', { className: 'ywc-section-title' }, h('h3', null, '关注者增长指标')),
            h('div', { className: 'ywc-kpi-grid' }, fansCards(overview)),
          ),
        ),
        h('section', { className: 'ywc-panel' },
          h('div', { className: 'ywc-section-title' },
            h('h3', null, '关注者画像'),
            h('span', { className: 'ywc-badge' }, profile && profile.day ? `截止 ${profile.day}` : '当前截止昨日'),
          ),
          h('div', { className: 'ywc-profile-grid' },
            profileDonutCard('性别分布', profile, 'gender'),
            profileDonutCard('访问设备分布', profile, 'device'),
            profileAgeCard(profile),
          ),
          h('div', { className: 'ywc-profile-grid ywc-profile-grid-2' },
            profileBarsCard('省份分布', profile, 'province'),
            profileBarsCard('城市分布', profile, 'city'),
          ),
        ),
      )
    }

    function windowGroup(windows, current, onWindow) {
      return h('div', { className: 'ywc-window-group', role: 'tablist', 'aria-label': '时间窗口' },
        windows.map(([key, label]) => h('button', {
          key, type: 'button', 'aria-selected': key === current ? 'true' : 'false',
          onClick: () => onWindow(key),
        }, label)),
      )
    }

    function metricCards(overview) {
      return summarizeAccountMetrics(overview && overview.metrics).map(([label, value]) => h('div', { className: 'ywc-kpi', key: label },
        h('div', { className: 'ywc-kpi-label' }, label),
        h('div', { className: 'ywc-kpi-value' }, fmtCount(value)),
        label === '关注量' ? h('div', { className: 'ywc-kpi-hint' }, '全部视频关注增量，非账号净关注') : null,
      ))
    }

    function fansCards(overview) {
      return summarizeFansTrend(overview && overview.fans_trend).map(([label, value]) => h('div', { className: 'ywc-kpi', key: label },
        h('div', { className: 'ywc-kpi-label' }, label),
        h('div', { className: 'ywc-kpi-value' }, fmtCount(value)),
      ))
    }

    /** 画像卡片组（2026-11-11 真机反馈，对齐官方后台）：
     * 环形图调色板参考官方风格（男蓝/女粉）；「未知」统一灰色；设备编码按官方后台
     * 口径映射（1=iOS、2=安卓，见 ui-format 的 device 映射）。占比一律 count/sum
     * 计算，总数 0 显示「—」。 */
    const DONUT_PALETTE = ['#4ea6ff', '#f47fb0', '#8b5cf6', '#f08a3c', '#2f9e44', '#d9a400', '#e0524a']
    const DONUT_UNKNOWN_COLOR = '#c0c6cf'

    function donutColor(name, index) {
      return name === '未知' ? DONUT_UNKNOWN_COLOR : DONUT_PALETTE[index % DONUT_PALETTE.length]
    }

    function profileDonutCard(title, profile, dimension) {
      const rows = normalizeProfileRows(profile ? profile[dimension] : null, dimension)
      const total = rows.reduce((sum, [, value]) => sum + value, 0)
      let acc = 0
      const stops = rows.map(([name, value], index) => {
        const start = total > 0 ? (acc / total) * 100 : 0
        acc += value
        const end = total > 0 ? (acc / total) * 100 : 0
        return `${donutColor(name, index)} ${start.toFixed(2)}% ${end.toFixed(2)}%`
      })
      const background = total > 0 && stops.length
        ? `conic-gradient(${stops.join(',')})`
        : `conic-gradient(${DONUT_UNKNOWN_COLOR} 0% 100%)`
      return h('div', { className: 'ywc-profile-card' },
        h('div', { className: 'ywc-profile-card-title' }, title),
        rows.length
          ? h('div', { className: 'ywc-donut-row' },
            h('div', {
              className: 'ywc-donut', style: { background },
              role: 'img', 'aria-label': `${title}：共 ${fmtCount(total)} 人`,
            },
              h('span', { className: 'ywc-donut-hole' },
                h('b', null, fmtCount(total)),
                h('i', null, '总人数'),
              )),
            h('ul', { className: 'ywc-donut-legend' },
              rows.map(([name, value], index) => h('li', { key: name },
                h('span', { className: 'ywc-donut-dot', style: { background: donutColor(name, index) }, 'aria-hidden': true }),
                `${name} ${fmtCount(value)}人${total > 0 ? ` · ${Math.round(value / total * 100)}%` : ''}`,
              ))))
          : h('p', { className: 'ywc-empty', style: { padding: '0 4px 4px' } }, '该画像维度本次未提供'),
      )
    }

    function profileAgeCard(profile) {
      const rows = normalizeProfileRows(profile ? profile.age : null, 'age')
      const total = rows.reduce((sum, [, value]) => sum + value, 0)
      const max = Math.max(1, ...rows.map(([, value]) => value))
      return h('div', { className: 'ywc-profile-card' },
        h('div', { className: 'ywc-profile-card-title' }, '年龄分布'),
        rows.length
          ? h('div', { className: 'ywc-col-chart', role: 'img', 'aria-label': `年龄分布：共 ${fmtCount(total)} 人` },
            rows.map(([name, value]) => h('div', { className: 'ywc-col', key: name },
              h('span', { className: 'ywc-col-value' }, total > 0 ? `${Math.round(value / total * 100)}%` : '—'),
              h('div', {
                className: 'ywc-col-bar',
                style: { height: `${Math.max(4, Math.round(value / max * 100))}%` },
                title: `${name} ${fmtCount(value)}人`,
              }),
              h('span', { className: 'ywc-col-label' }, name),
            )))
          : h('p', { className: 'ywc-empty', style: { padding: '0 4px 4px' } }, '该画像维度本次未提供'),
      )
    }

    function profileBarsCard(title, profile, dimension) {
      // 省份/城市为长尾分布（2026-11-11 真机反馈）：按人数从大到小排序后只取前 5，
      // 避免几十条列表把页面撑成滚动地狱；性别/年龄/设备是定长维度，不走这里。
      const rows = normalizeProfileRows(profile ? profile[dimension] : null, dimension)
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, 5)
      const max = Math.max(1, ...rows.map(([, value]) => value))
      return h('div', { className: 'ywc-profile-card' },
        h('div', { className: 'ywc-profile-card-title' }, title),
        rows.length
          ? h('div', { className: 'ywc-bars', style: { padding: '0 4px 4px' } }, rows.map(([name, value]) =>
            h('div', { className: 'ywc-bar-row', key: name },
              h('span', null, name),
              h('div', { className: 'ywc-bar-track' }, h('div', { className: 'ywc-bar-fill', style: { width: `${Math.round(value / max * 100)}%` } })),
              h('span', { className: 'ywc-bar-value' }, fmtCount(value)),
            )))
          : h('p', { className: 'ywc-empty', style: { padding: '0 4px 4px' } }, '该画像维度本次未提供'),
      )
    }

    /**
     * 关注者总数趋势（2026-11-11 真机反馈，对齐官方后台）：x 轴固定最近 7 个自然日，
     * 带 y 轴刻度，鼠标移动显示浮层。
     */
    function fansTrendRows(overview) {
      const daily = overview && overview.fans_trend && Array.isArray(overview.fans_trend.daily)
        ? overview.fans_trend.daily
        : []
      const byDay = new Map()
      for (const row of daily) {
        if (row && row.day) byDay.set(String(row.day), row)
      }
      return recentDays(7).map(day => ({ day, follower_total_count: (byDay.get(day) || {}).follower_total_count ?? null }))
    }

    const FANS_SERIES = [{ key: 'follower_total_count', label: '关注者总数', color: 'var(--ywc-brand)' }]

    /**
     * 账号卡片主按钮的行为判定（2026-11-11 真机反馈「会话过期点重新扫码没反应」）：
     * 会话有效 → `probe`（只探活）；过期/未知 → `relogin`（打开浏览器重新扫码登录）。
     * 抽成纯函数便于回归测试，避免再次退化成两种状态都只探活。
     */
    function sessionActionFor(account) {
      return account && account.sessionStatus === 'ok' ? 'probe' : 'relogin'
    }

    /** 登录交互（对齐抖音）：点击「添加账号」由宿主直接打开系统 Chrome 进入官方
     * 视频号助手扫码，不再渲染二维码占位弹层；进行中状态由左栏按钮文案承载。 */
    function LoginStatusButton({ loginActive, browserBlocked, onBeginLogin }) {
      return h('button', {
        className: 'ywc-primary ywc-wide', type: 'button',
        // 不能直接绑 onBeginLogin：React 会把事件对象当第一个实参传进去，
        // 而 beginLogin(accountId) 会把事件当账号 ID 发给宿主。
        disabled: browserBlocked || loginActive, onClick: () => onBeginLogin(),
      }, loginActive ? '浏览器已打开，请在窗口中扫码…' : '添加账号')
    }

    // 视频号工作台页面侧（视觉与交互基准：docs/1109/wx/ui-demo.html，§9.0）。
    // 页面只访问本地同源路由 /api/desktop/yootun/wx-channels-operation（§4.1）：
    // 不读取 MODELS_API_KEY、不直连公网 MCP、不接收 Cookie/内部地址/原始传输错误。
    // 采集由宿主设备端执行；这里只做编排（登录/采集/批量）与展示。

    const React = require('react')
    const { createElement: h } = React
    const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React
    const { IconCloseOutlineRegular, IconSparkleRegular, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')


    const ROUTE = '/api/desktop/yootun/wx-channels-operation'
    const POLL_INTERVAL_MS = 1200

    // 左下角侧栏入口 + 整页 overlay（对齐抖音 yootun 系插件机制）：
    // OVERLAY_EVENT 为宿主 overlay 共享互斥事件（打开自身时通知其他 overlay 关闭）。
    const OVERLAY_ID = '@dofe/dsh-yootun-wx-channels-operation'
    const OVERLAY_EVENT = 'dofe:yootun-overlay:open'

    let opened = false
    const openListeners = new Set()
    const subscribeOpen = listener => {
      openListeners.add(listener)
      return () => openListeners.delete(listener)
    }
    const snapshotOpen = () => opened
    function setOpened(next) {
      opened = next
      for (const listener of openListeners) listener(next)
    }
    function openOverlay(event) {
      // 记录触发元素，关闭后恢复焦点。
      overlayTrigger = event?.currentTarget || document.activeElement
      window.dispatchEvent(new CustomEvent(OVERLAY_EVENT))
      setOpened(true)
    }
    function closeOtherOverlay() {
      if (opened) setOpened(false)
    }
    let overlayTrigger = null
    // 页面端全部 action 都是宿主立即返回的快操作（长动作在宿主异步执行、页面轮询）。
    const REQUEST_TIMEOUT_MS = 30000

    const STYLES = `
    /* 变量映射挂在插件根节点（.ywc-overlay/.ywc-root），不能放 :root：
       真机宿主把 --dsw-alias-* 定义在应用容器上而非 html，:root 处求值
       拿不到会让全部 --ywc-* 失效（2026-11-10 真机样式散架根因）。
       兜底值与 ui-demo.html 一致（浅色默认 + prefers-color-scheme 深色）。 */
    .ywc-overlay, .ywc-root {
      --ywc-bg: var(--dsw-alias-bg-base, #ffffff);
      --ywc-surface: var(--dsw-alias-bg-layer-1, #f6f7f9);
      --ywc-surface-2: var(--dsw-alias-bg-layer-2, #eceef1);
      --ywc-text: var(--dsw-alias-label-primary, #1f2329);
      --ywc-muted: var(--dsw-alias-label-secondary, #646a73);
      --ywc-border: var(--dsw-alias-border-l1, #e0e3e8);
      --ywc-brand: var(--dsw-alias-brand-primary, #0f1115);
      /* hover 色按主题显式定义：浅色主题 brand 近黑，混黑看不出变化（review P2-2）。 */
      --ywc-brand-hover: color-mix(in srgb, var(--ywc-brand) 82%, white);
      --ywc-brand-soft: color-mix(in srgb, var(--ywc-brand) 10%, transparent);
      --ywc-brand-line: color-mix(in srgb, var(--ywc-brand) 62%, white);
      --ywc-brand-border: color-mix(in srgb, var(--ywc-brand) 28%, transparent);
      --ywc-brand-text: var(--dsw-alias-label-primary-foreground, #ffffff);
      --ywc-danger: var(--dsw-alias-state-error-primary, #d03a3a);
      --ywc-success: var(--dsw-alias-state-success-primary, #1a7f37);
    }
    @media (prefers-color-scheme: dark) {
      .ywc-overlay, .ywc-root {
        --ywc-bg: var(--dsw-alias-bg-base, #151517);
        --ywc-surface: var(--dsw-alias-bg-layer-1, #232324);
        --ywc-surface-2: var(--dsw-alias-bg-layer-2, #2c2c2e);
        --ywc-text: var(--dsw-alias-label-primary, #fafafa);
        --ywc-muted: var(--dsw-alias-label-secondary, #b4b4b4);
        --ywc-border: var(--dsw-alias-border-l1, rgba(255,255,255,.10));
        --ywc-brand: var(--dsw-alias-brand-primary, #e9e9e9);
        /* 深色主题 brand 近白，hover 压暗。 */
        --ywc-brand-hover: color-mix(in srgb, var(--ywc-brand) 88%, black);
        --ywc-brand-text: var(--dsw-alias-label-primary-foreground, #343434);
        --ywc-danger: var(--dsw-alias-state-error-primary, #e0524a);
        --ywc-success: var(--dsw-alias-state-success-primary, #4ade80);
      }
    }
    /* 字体体系对齐抖音工作台：基线 14px / 次级 13px / 页标题 20px / 面板标题 16px，
       一律用宿主字体变量（真机缺失时回退同值字面量），不自行创造字号。 */
    .ywc-root { height:100vh; color:var(--ywc-text); font-size:var(--dsh-content-font-size,14px); }
    .ywc-overlay { position:fixed; inset:0; z-index:520; background:var(--ywc-bg); color:var(--ywc-text); overflow:hidden; font-size:var(--dsh-content-font-size,14px); }
    .ywc-sidebar-button { display:flex; width:36px; height:36px; align-items:center; justify-content:center; gap:8px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; }
    .ywc-sidebar-button:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
    .ywc-shell { height:100vh; display:flex; flex-direction:column; overflow:hidden; }
    .ywc-header{min-height:72px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:14px 24px; border-bottom:1px solid var(--ywc-border); background: color-mix(in srgb, var(--ywc-surface) 88%, transparent); backdrop-filter: blur(14px); box-shadow: 0 1px 24px color-mix(in srgb, var(--ywc-text) 7%, transparent); }
    .ywc-title { display:flex; align-items:center; gap:12px; min-width:0; }
    .ywc-mark{width:36px;height:36px; flex:0 0 auto; display:grid; place-items:center; border-radius:8px; background: color-mix(in srgb, var(--ywc-brand) 16%, transparent); color: var(--ywc-brand); font-weight:800; }
    .ywc-title h1 { margin:0; font-size:var(--dsw-font-l-20-font-size,20px); line-height:1.25; }
    .ywc-title p { margin:6px 0 0; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-header-actions { display:flex; align-items:center; gap:8px; }
    .ywc-tabs { display:flex; gap:4px; padding:0 24px; background: color-mix(in srgb, var(--ywc-surface) 86%, transparent); backdrop-filter: blur(12px); border-bottom:1px solid var(--ywc-border); overflow-x:auto; }
    .ywc-tab { height:44px; padding:0 18px; border:0; border-bottom:3px solid transparent; background:transparent; color:var(--ywc-muted); font:inherit; font-size:var(--dsh-content-font-size,14px); font-weight:650; white-space:nowrap; cursor:pointer; }
    .ywc-tab:hover { color: var(--ywc-text); }
    .ywc-tab[aria-selected="true"] { color:var(--ywc-text); border-bottom-color: var(--ywc-brand-line); background: linear-gradient(180deg, transparent 68%, color-mix(in srgb, var(--ywc-brand) 9%, transparent)); }
    .ywc-body { flex:1; min-height:0; display:grid; grid-template-columns:280px minmax(0,1fr); gap:16px; padding:16px 24px 24px;  overflow:hidden; }
    .ywc-shell[data-tab="account"] .ywc-body { grid-template-columns: minmax(0,1fr); }
    .ywc-shell[data-tab="account"] .ywc-accounts { display:none; }
    .ywc-accounts { display:flex; flex-direction:column; gap:10px; min-width:0; }
    .ywc-panel { border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 92%, transparent); backdrop-filter: blur(12px); box-shadow: 0 10px 34px color-mix(in srgb, var(--ywc-text) 6%, transparent); }
    .ywc-side-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 12px 0; }
    .ywc-side-head h2 { margin:0; font-size:var(--dsw-font-base-16-font-size,16px); }
    .ywc-account-list { display:flex; flex-direction:column; gap:8px; padding:10px 12px 12px; }
    .ywc-card { border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 94%, transparent); text-align:left; padding:0; overflow:hidden; }
    .ywc-card[aria-current="true"] { border-color: color-mix(in srgb, var(--ywc-brand) 60%, var(--ywc-border)); }
    .ywc-card[aria-current="true"] .ywc-card-main { background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 8%, transparent), transparent 68%); }
    .ywc-card-main { width:100%; display:grid; grid-template-columns:36px minmax(0,1fr); gap:10px; align-items:center; border:0; background:transparent; padding:10px; text-align:left; color:inherit; cursor:pointer; }
    .ywc-card-main:hover { background: var(--ywc-surface-2); }
    .ywc-avatar { width:36px; height:36px; display:grid; place-items:center; border-radius:50%; background: color-mix(in srgb, var(--ywc-brand) 18%, var(--ywc-surface-2)); color:var(--ywc-brand); font-weight:700; }
    .ywc-card-name { display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
    .ywc-card-meta { display:block; margin-top:2px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-state { display:inline-flex; align-items:center; gap:5px; margin-top:5px; font-size:var(--dsh-content-font-size-secondary,13px); color:var(--ywc-muted); }
    .ywc-state::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
    .ywc-state[data-state="ok"] { color:var(--ywc-success); }
    .ywc-state[data-state="expired"] { color:var(--ywc-danger); }
    .ywc-card-actions { display:flex; border-top:1px solid var(--ywc-border); background:var(--ywc-surface); }
    .ywc-mini-button { flex:1; min-height:30px; border:0; background:transparent; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); cursor:pointer; }
    .ywc-mini-button:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
    .ywc-mini-button:disabled { opacity:.5; cursor:default; }
    .ywc-mini-button:disabled:hover { background:transparent; color:var(--ywc-muted); }
    .ywc-mini-button.danger:hover { color:var(--ywc-danger); }
    .ywc-mini-button.danger:disabled:hover { color:var(--ywc-muted); }
    .ywc-button { min-height:34px; display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:0 12px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-text); white-space:nowrap; cursor:pointer; }
    .ywc-button:hover { background:var(--ywc-surface-2); }
    .ywc-button.primary { border-color: color-mix(in srgb, var(--ywc-brand) 72%, white); background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 88%, white), var(--ywc-brand)); color: var(--ywc-brand-text); font-weight:650; box-shadow: 0 6px 18px color-mix(in srgb, var(--ywc-brand) 20%, transparent); }
    .ywc-button.primary:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 78%, white), color-mix(in srgb, var(--ywc-brand) 92%, black)); }
    .ywc-button:disabled { opacity:.45; cursor:default; }
    .ywc-button:disabled:hover { background:var(--ywc-surface); }
    .ywc-button.primary:disabled:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--ywc-brand) 88%, white), var(--ywc-brand)); }
    .ywc-primary { min-height:40px; padding:0 16px; border:0; border-radius:6px; background:var(--ywc-brand); color:var(--ywc-brand-text); font-weight:600; cursor:pointer; }
    .ywc-primary:hover { background: var(--ywc-brand-hover); }
    .ywc-primary:disabled { opacity:.45; cursor:default; }
    .ywc-primary:disabled:hover { background:var(--ywc-brand); }
    .ywc-wide { width:100%; }
    .ywc-batch-panel { display:grid; gap:4px; padding:10px 12px; border:1px solid var(--ywc-border); border-radius:8px; background:var(--ywc-surface-2); min-width:0; }
    .ywc-batch-panel p { margin:0; font-size:var(--dsh-content-font-size-secondary,13px); color:var(--ywc-text); }
    .ywc-batch-detail { display:grid; gap:2px; padding-top:4px; border-top:1px solid var(--ywc-border); }
    .ywc-batch-item { display:flex; justify-content:space-between; gap:12px; font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-batch-item-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ywc-batch-item-reason { flex:none; color:var(--ywc-muted); }
    .ywc-progress { display:flex; align-items:center; gap:8px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-spinner { width:16px; height:16px; flex:none; border:2px solid var(--ywc-border); border-top-color:var(--ywc-brand); border-radius:50%; animation:ywc-spin .8s linear infinite; }
    @keyframes ywc-spin { to { transform:rotate(360deg); } }
    .ywc-hint { margin:0; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); line-height:1.5; }
    .ywc-ok { margin:0; color:var(--ywc-success); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-error { margin:0; color:var(--ywc-danger); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-warn { margin:0; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    /* 36px 图标按钮基线（契约审计 canonical icon 基线；弹层关闭/头部关闭钮复用，对齐 ydo-header-buttons）。 */
    .ywc-icon{width:36px;height:36px; display:grid; place-items:center; padding:0; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-muted); cursor:pointer; }
    .ywc-icon:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
    .ywc-right { min-width:0; min-height:0; display:flex; flex-direction:column; gap:12px; overflow:hidden; }
    .ywc-right .ywc-work-panel { flex:1; min-height:0; display:flex; flex-direction:column; }
    .ywc-right .ywc-work-panel .ywc-table-wrap { flex:1; }
    .ywc-right .ywc-account-page { flex:1; min-height:0; overflow:auto; }
    /* 工具栏纵向布局（2026-11-11 真机反馈）：第一行按钮组、第二行采集进度行（按钮下方）。 */
    .ywc-toolbar { display:flex; flex-direction:column; align-items:stretch; gap:8px; padding:12px; }
    .ywc-toolbar-left, .ywc-toolbar-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    /* 最近采集时间（2026-11-12 真机反馈）：刷新按钮后的单值提示，不占表格列。 */
    .ywc-toolbar-note { color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); white-space:nowrap; }
    .ywc-field { display:inline-flex; align-items:center; gap:6px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-input, .ywc-select { min-height:36px; padding:0 10px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-text); font:inherit; font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-select { cursor:pointer; }
    .ywc-input { cursor:text; }
    .ywc-summary-grid, .ywc-kpi-grid { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px; padding:12px; }
    .ywc-kpi { min-height:78px; padding:10px; border:1px solid var(--ywc-border); border-radius:8px; position:relative; overflow:hidden; background: linear-gradient(160deg, color-mix(in srgb, var(--ywc-brand) 4%, var(--ywc-surface)), var(--ywc-surface) 62%); }
    .ywc-kpi::after { content:""; position:absolute; inset:0 0 auto; height:2px; background: linear-gradient(90deg, transparent, var(--ywc-brand-line), transparent); opacity:.55; }
    .ywc-kpi-label { color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-kpi-value { margin-top:8px; font-size:20px; font-weight:650; font-variant-numeric: tabular-nums; letter-spacing:-.02em; }
    .ywc-kpi-hint { margin-top:3px; color:var(--ywc-muted); font-size:12px; }
    .ywc-table-wrap { overflow:auto; min-height:0; border-top:1px solid var(--ywc-border); }
    /* 表头排序按钮（对齐 ydo-sort）：整格可点击，箭头 ↕/↓/↑，激活列高亮。 */
    .ywc-sort { display:flex; width:100%; align-items:center; gap:4px; min-width:0; padding:0; border:0; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
    .ywc-sort-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ywc-sort-arrow { flex:none; min-width:12px; color:var(--ywc-muted); }
    .ywc-sort-active { color:var(--ywc-text); }
    .ywc-sort-active .ywc-sort-arrow { color:var(--ywc-brand); }
    /* 空态（对齐 ydo-state）：无数据时不渲染表格框架，只显示居中提示。 */
    .ywc-table-state { display:grid; min-height:200px; flex:1; place-items:center; align-content:center; gap:10px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size,14px); text-align:center; }
    .ywc-table-state p { margin:0; max-width:640px; line-height:1.6; }
    /* 作品列表（2026-11-11 真机反馈）：无操作列（双击行开详情）、无 ID 副行，列宽收紧
     * 但单元格保持 nowrap 不换行；整行 cursor:pointer 提示可双击。 */
    .ywc-table { min-width:1360px; width:100%; border-collapse:collapse; }
    .ywc-table th, .ywc-table td { padding:9px 10px; border-bottom:1px solid var(--ywc-border); text-align:left; white-space:nowrap; font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-table th { position:sticky; top:0; z-index:1; background: color-mix(in srgb, var(--ywc-brand) 5%, var(--ywc-surface-2)); color:var(--ywc-muted); font-weight:600; }
    .ywc-table tbody tr { cursor:pointer; }
    .ywc-table tbody tr:hover { background: color-mix(in srgb, var(--ywc-brand) 6%, transparent); }
    .ywc-work-cell { display:grid; grid-template-columns:54px minmax(180px,240px); gap:10px; align-items:center; }
    /* 封面（对齐抖音 WorkCover）：img 铺满 + 右下角时长角标；失败/缺失占位「封面」。 */
    .ywc-cover { position:relative; width:54px; height:72px; display:grid; place-items:center; border-radius:5px; overflow:hidden; background:var(--ywc-surface-2); color:var(--ywc-muted); font-size:12px; text-align:center; flex:none; }
    .ywc-cover-large { width:110px; height:146px; border-radius:7px; }
    .ywc-cover-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
    .ywc-cover-fallback-text { padding:0 4px; }
    .ywc-cover-duration { position:absolute; right:3px; bottom:3px; padding:1px 4px; border-radius:3px; background:rgba(0,0,0,.65); color:#fff; font-size:12px; }
    .ywc-work-title { min-width:0; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; color:inherit; text-decoration:none; }
    a.ywc-work-title:hover { text-decoration:underline; color:var(--ywc-brand); }
    .ywc-empty { color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-account-page { display:flex; flex-direction:column; gap:12px; }
    .ywc-section-title { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 12px 0; }
    .ywc-section-title h3 { margin:0; font-size:var(--dsh-content-font-size,14px); }
    .ywc-window-group { display:inline-flex; border:1px solid var(--ywc-border); border-radius:6px; overflow:hidden; }
    .ywc-window-group button { min-height:30px; padding:0 10px; border:0; background:var(--ywc-surface); color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); cursor:pointer; }
    .ywc-window-group button:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
    .ywc-window-group button[aria-selected="true"] { background: color-mix(in srgb, var(--ywc-brand) 12%, var(--ywc-surface)); color:var(--ywc-brand); font-weight:700; box-shadow: inset 0 -2px 0 var(--ywc-brand-line); }
    .ywc-two-column { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr); gap:12px; }
    .ywc-chart-body { padding:12px; }
    .ywc-chart-legend { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px; color:var(--ywc-muted); font-size:12px; }
    .ywc-chart-legend i { display:inline-block; width:10px; height:3px; margin-right:5px; vertical-align:middle; background:var(--ywc-brand); }
    /* 趋势图容器与 hover 浮层（2026-11-11 真机反馈：参考官方后台，鼠标移动显示各指标数值）。 */
    .ywc-chart-wrap { position:relative; }
    .ywc-chart-tooltip { position:absolute; top:8px; transform:translateX(-50%); min-width:132px; padding:8px 10px; border-radius:8px;
      background:var(--ywc-surface); border:1px solid var(--ywc-border); box-shadow:0 6px 20px rgba(15,23,42,.12);
      pointer-events:none; font-size:12px; color:var(--ywc-text); z-index:2; }
    .ywc-chart-tooltip-day { margin-bottom:4px; color:var(--ywc-muted); font-size:11px; }
    .ywc-chart-tooltip-row { display:flex; align-items:center; gap:6px; line-height:18px; }
    .ywc-chart-tooltip-row i { display:inline-block; width:7px; height:7px; border-radius:50%; flex:none; }
    .ywc-chart-tooltip-name { flex:1; }
    .ywc-chart-tooltip-value { font-variant-numeric:tabular-nums; font-weight:600; }
    /* height:auto 让 SVG 按 viewBox 比例自适应：固定 height 会让宽视口下的图形被
       「信箱化」缩小并水平居中（2026-11-11 review）。 */
    .ywc-svg { display:block; width:100%; height:auto; }
    .ywc-bars { display:grid; gap:8px; padding:12px; }
    .ywc-bar-row { display:grid; grid-template-columns:84px minmax(0,1fr) 62px; gap:8px; align-items:center; font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-bar-track { height:8px; border-radius:4px; background:var(--ywc-surface-2); overflow:hidden; }
    .ywc-bar-fill { height:100%; border-radius:4px; background: linear-gradient(90deg, color-mix(in srgb, var(--ywc-brand) 62%, transparent), var(--ywc-brand-line)); box-shadow: 0 0 12px color-mix(in srgb, var(--ywc-brand) 18%, transparent); }
    .ywc-bar-value { text-align:right; color:var(--ywc-muted); }
    /* 关注者画像卡片组（2026-11-11 真机反馈）：去 Tab 切换，同屏卡片布局——
     * 性别/设备环形图（中心总人数）+图例、年龄柱状图（柱顶百分比）、省市横向条形两列卡。 */
    .ywc-profile-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; padding:12px; }
    .ywc-profile-grid-2 { grid-template-columns:repeat(2, minmax(0,1fr)); }
    .ywc-profile-card { min-width:0; padding:12px; border:1px solid var(--ywc-border); border-radius:8px; background: color-mix(in srgb, var(--ywc-surface) 94%, transparent); }
    .ywc-profile-card-title { margin-bottom:10px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    .ywc-donut-row { display:flex; align-items:center; gap:14px; }
    .ywc-donut { position:relative; width:112px; height:112px; flex:none; border-radius:50%; }
    .ywc-donut-hole { position:absolute; inset:20px; display:grid; place-content:center; justify-items:center; gap:1px; border-radius:50%; background:var(--ywc-surface); text-align:center; }
    .ywc-donut-hole b { font-size:16px; font-weight:650; font-variant-numeric: tabular-nums; }
    .ywc-donut-hole i { font-style:normal; color:var(--ywc-muted); font-size:12px; }
    .ywc-donut-legend { display:grid; gap:6px; margin:0; padding:0; list-style:none; color:var(--ywc-text); font-size:var(--dsh-content-font-size-secondary,13px); min-width:0; }
    .ywc-donut-dot { display:inline-block; width:8px; height:8px; margin-right:6px; border-radius:2px; vertical-align:middle; }
    .ywc-col-chart { display:flex; align-items:stretch; gap:8px; height:150px; padding-top:4px; }
    .ywc-col { flex:1; min-width:0; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px; }
    .ywc-col-value { color:var(--ywc-text); font-size:12px; font-variant-numeric:tabular-nums; }
    .ywc-col-bar { width:56%; min-height:4px; border-radius:3px 3px 0 0; background: linear-gradient(180deg, color-mix(in srgb, var(--ywc-brand) 62%, transparent), var(--ywc-brand-line)); }
    .ywc-col-label { color:var(--ywc-muted); font-size:12px; white-space:nowrap; }
    .ywc-modal { position:fixed; inset:0; z-index:20; display:none; place-items:center; padding:24px; background:rgba(31,35,41,.42); backdrop-filter:blur(8px); }
    .ywc-modal.open { display:grid; }
    .ywc-dialog { width:min(1080px,100%); max-height:calc(100vh - 48px); overflow:auto; border:1px solid var(--ywc-border); border-radius:8px; background:var(--ywc-surface); box-shadow:0 24px 72px rgba(0,0,0,.22); }
    .ywc-dialog-header { position:sticky; top:0; z-index:2; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid var(--ywc-border); background:var(--ywc-surface); }
    .ywc-dialog-header h2, .ywc-dialog-header h3 { margin:0; }
    .ywc-dialog-body { display:grid; gap:12px; padding:14px 16px 18px; }
    /* 详情头部（2026-11-11 真机反馈）：封面 + 元信息一行，KPI 卡片移出头部、
     * 以 ywc-metric-grid 铺满整行（左右填满）。 */
    .ywc-dialog-grid { display:grid; grid-template-columns:110px minmax(0,1fr); gap:14px; align-items:center; }
    .ywc-dialog-meta { min-width:0; display:grid; gap:6px; }
    .ywc-dialog-meta p { margin:0; }
    .ywc-metric-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
    .ywc-detail-section { border-top:1px dashed var(--ywc-border); padding-top:10px; }
    .ywc-detail-section h4 { margin:0 0 8px; font-size:var(--dsh-content-font-size,14px); }
    .ywc-close { width:32px; height:32px; border:1px solid var(--ywc-border); border-radius:6px; background:var(--ywc-surface); color:var(--ywc-muted); cursor:pointer; }
    .ywc-close:hover { background:var(--ywc-surface-2); color:var(--ywc-text); }
    .ywc-note { padding:0 16px 16px; color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); line-height:1.7; }
    .ywc-badge { display:inline-flex; align-items:center; min-height:22px; padding:0 7px; border-radius:4px; background:var(--ywc-surface-2); color:var(--ywc-muted); font-size:var(--dsh-content-font-size-secondary,13px); }
    /* 窄屏（对齐抖音 1120 断点行为）：body 纵向滚动，表格区域固定 60vh 内滚。 */
    @media (max-width:1080px) { .ywc-body { display:block; overflow:auto; } .ywc-right { overflow:visible; } .ywc-right .ywc-work-panel .ywc-table-wrap { max-height:60vh; } .ywc-summary-grid, .ywc-kpi-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .ywc-two-column { grid-template-columns:1fr; } .ywc-dialog-grid { grid-template-columns:1fr; } .ywc-profile-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:680px) { .ywc-header, .ywc-body, .ywc-tabs { padding-left:12px; padding-right:12px; } .ywc-summary-grid, .ywc-kpi-grid, .ywc-metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .ywc-profile-grid { grid-template-columns:1fr; } .ywc-title p { display:none; } }
    `

    function useHost() {
      return useCallback(async (action, payload = {}) => {
        const response = await fetch(ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, ...payload }),
        })
        if (!response.ok) throw new Error(`http_${response.status}`)
        const payloadJson = await response.json()
        if (payloadJson && payloadJson.status === 'error') {
          throw new Error(String(payloadJson.reason || 'request_failed'))
        }
        return payloadJson
      }, [])
    }

    /** 侧栏入口按钮（左下角菜单；wide 模式带文字，对齐抖音 Button）。 */
    function SidebarButton({ wide }) {
      return h(Tooltip, { label: '打开视频号工作台', disabled: wide },
        h('button', {
          type: 'button',
          className: `ywc-sidebar-button${wide ? ' ywc-wide' : ''}`,
          'aria-label': '打开视频号工作台',
          onClick: openOverlay,
        },
          h(IconSparkleRegular, { size: wide ? 14 : 18 }),
          wide ? h('span', null, '视频号工作台') : null,
        ))
    }

    /** 整页 overlay：可见时渲染工作台；关闭后恢复触发焦点。 */
    function Overlay() {
      const visible = useSyncExternalStore(subscribeOpen, snapshotOpen, snapshotOpen)
      useEffect(() => {
        if (!visible) return
        const previous = typeof document !== 'undefined' ? document.activeElement : null
        return () => {
          const lastTrigger = overlayTrigger
          if (lastTrigger && typeof lastTrigger.focus === 'function') {
            requestAnimationFrame(() => lastTrigger?.focus?.())
          } else if (previous && typeof previous.focus === 'function') {
            previous?.focus?.()
          }
        }
      }, [visible])
      if (!visible) return null
      return h('div', { className: 'ywc-overlay' }, h(WxWorkbench, { host: null }))
    }

    /** 宿主 client 接线：字典跳过（文案硬编码中文）、样式与侧栏/overlay 槽位注册。 */
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = OVERLAY_ID
        style.textContent = STYLES
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dofe-yootun-wx-channels-operation: styles')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: OVERLAY_ID, order: 44, inject: () => ({}) }, SidebarButton))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: OVERLAY_ID, order: 44, inject: () => ({}) }, Overlay))
      // 共享互斥契约：其他 yootun overlay 打开时关闭自身。
      ctx.effect(() => {
        window.addEventListener(OVERLAY_EVENT, closeOtherOverlay)
        return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay)
      }, 'dofe-yootun-wx-channels-operation: exclusive-overlay')
    }

    /** 渲染工作台。`initial` 供静态渲染/截图/测试注入首屏真实数据
     * （renderToString 不执行 useEffect，宿主运行时不传 initial 走正常加载）。 */
    function renderWxWorkbench({ host, initial }) {
      return h(WxWorkbench, { host, initial })
    }

    function WxWorkbench({ host, initial = null }) {
      const post = host || useHost()
      const [browserReady, setBrowserReady] = useState({ chrome: true, driver: true })
      const [accounts, setAccounts] = useState((initial && initial.accounts) || [])
      const [selectedId, setSelectedId] = useState(
        (initial && initial.selectedId) ||
          ((initial && initial.accounts || []).find(item => item.deleteState !== 'remote_deleted') || {}).accountId ||
          null,
      )
      const [tab, setTab] = useState((initial && initial.tab) || 'work')
      const [works, setWorks] = useState((initial && initial.works) || [])
      const [overview, setOverview] = useState((initial && initial.overview) || null)
      // 摘要卡独立快照：固定 last_7d（§9.2 摘要卡口径不随账号 Tab 窗口切换变化）。
      const [summaryOverview, setSummaryOverview] = useState(
        initial && initial.summaryOverview !== undefined ? initial.summaryOverview : initial ? initial.overview : null,
      )
      const [profile, setProfile] = useState((initial && initial.profile) || null)
      const [windowKey, setWindowKey] = useState((initial && initial.windowKey) || 'last_7d')
      // 表头排序（对齐抖音）：{key, direction} 三态循环，客户端排序只作用于已入库数据。
      const [sort, setSort] = useState(DEFAULT_SORT_STATE)
      const [detail, setDetail] = useState((initial && initial.detail) || null)
      const [detailDaily, setDetailDaily] = useState((initial && initial.detailDaily) || [])
      // 登录进行中状态（不再渲染二维码弹层）：驱动「添加账号」按钮的禁用与文案。
      const [login, setLogin] = useState(null)
      const [batch, setBatch] = useState(null)
      const [notice, setNotice] = useState(null)
      const [confirm, setConfirm] = useState(null)
      // 删除生命周期（对齐抖音 DELETE_LIFECYCLE 语义）：弹确认 = awaiting_confirmation；
      // 确认后远端删除执行中 = confirmed_pending_adapter（§16.2 删除状态机）。
      const [deleteLifecycle, setDeleteLifecycle] = useState(null)
      const [collectBusy, setCollectBusy] = useState(false)
      const [refreshing, setRefreshing] = useState(false)
      // 首屏加载态（2026-11-12 真机反馈）：账号列表与首次作品查询期间显示加载中，
      // 不再用「暂无已入库作品」空态冒充加载中（两者外观一致，用户以为卡住）。
      const [accountsLoading, setAccountsLoading] = useState(false)
      const [worksLoading, setWorksLoading] = useState(false)
      // 刷新提示就地显示在工具栏（采集按钮下方，与进度行同一位置），不进顶部通知条
      // （2026-11-11 真机反馈）。
      const [refreshMessage, setRefreshMessage] = useState(null)
      // 单账号采集状态投影（宿主 collect.status 的 collect 字段）：工具栏进度行数据源
      // （对齐抖音 collect 投影）。单槽——互斥保证同时只有一个采集；渲染时按 accountId
      // 比对，切走账号不显示他人进度。
      const [collect, setCollect] = useState(null)

      const selected = useMemo(
        () => accounts.find(account => account.accountId === selectedId) || null,
        [accounts, selectedId],
      )
      const visibleWorks = useMemo(() => sortWorks(works, sort), [works, sort])

      const noticeTimer = useRef(null)
      const notify = useCallback(message => {
        setNotice(message)
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setNotice(null), 4000)
      }, [])

      const refreshAccounts = useCallback(async () => {
        const result = await post('accounts.list')
        const rows = Array.isArray(result.accounts) ? result.accounts : []
        setAccounts(rows)
        setSelectedId(current => {
          if (current && rows.some(item => item.accountId === current)) return current
          const firstUsable = rows.find(item => item.deleteState !== 'remote_deleted')
          return firstUsable ? firstUsable.accountId : null
        })
        return rows
      }, [post])

      // 会话内作品列表缓存（SWR，对齐抖音 worksCacheRef）：同一账号再次进入先渲染
      // 缓存（秒开），后台刷新覆盖；刷新失败保留旧数据不打断浏览。
      const worksCacheRef = useRef(new Map())
      const worksRequestRef = useRef(0)
      const overviewRequestRef = useRef(0)
      // 当前选中账号快照：响应回来时用它判断「这个账号还是当前账号」。
      // 仅有请求序号不够——采集完成后按采集账号刷新（与当前选中无关），序号最新却属于
      // 旧账号，会把旧账号的作品行写进新账号视图（review P1-4）。
      const selectedIdRef = useRef(selectedId)
      useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

      const refreshWorks = useCallback(async accountId => {
        if (!accountId) { setWorks([]); setWorksLoading(false); return false }
        // 命中缓存先渲染（秒开）；无缓存必须清空，否则切账号瞬间仍显示上一个账号的行
        // （review P1-3）。
        const cached = worksCacheRef.current.get(accountId)
        setWorks(cached || [])
        // 2026-11-12 真机反馈：首次进入有 2-3 秒无作品列表的空窗，而空态文案与真正
        // 「没采集过」完全一致，看起来像卡住。无缓存时置加载态，命中缓存直接渲染不加。
        setWorksLoading(!cached)
        // 请求序号守卫：同账号并发时后到的旧响应不得覆盖新响应。
        const requestId = ++worksRequestRef.current
        try {
          const result = await post('works.list', { accountId })
          const rows = Array.isArray(result.works) ? result.works : []
          // 缓存无条件写：被序号淘汰的响应也是有效数据，写缓存才能让切回时秒开。
          worksCacheRef.current.set(accountId, rows)
          // 守卫：序号最新 + 账号仍是当前选中账号（review P1-4）。
          if (!shouldApplyResponse({
            requestId,
            currentRequestId: worksRequestRef.current,
            responseAccountId: accountId,
            currentAccountId: selectedIdRef.current,
          })) return true
          setWorks(rows)
          setWorksLoading(false)
          return true
        } catch (error) {
          if (requestId !== worksRequestRef.current) return false
          if (selectedIdRef.current !== accountId) return false
          if (!cached) setWorks([])
          setWorksLoading(false)
          notify(`作品列表加载失败：${error.message}`)
          return false
        }
      }, [post, notify])

      const refreshOverview = useCallback(async (accountId, window) => {
        if (!accountId) { setOverview(null); setSummaryOverview(null); setProfile(null); return false }
        // 切账号瞬间清空上一账号的总览/画像，避免新账号下显示旧账号指标（review P1-3）。
        setOverview(null)
        setSummaryOverview(null)
        setProfile(null)
        const requestId = ++overviewRequestRef.current
        let ok = true
        // 摘要卡固定 last_7d 拉取（与账号 Tab 窗口互不影响，review P0-3）。
        // summary 声明提到 try 外：窗口同为 last_7d 时直接复用，避免重复请求。
        let summary = null
        try {
          summary = await post('account.overview', { accountId, window: 'last_7d' })
        } catch {
          ok = false
        }
        let overview = null
        if (window === 'last_7d') {
          overview = summary
        } else {
          try {
            overview = await post('account.overview', { accountId, window })
          } catch {
            ok = false
          }
        }
        let profile = null
        try {
          const profileResult = await post('fans.profile.get', { accountId })
          profile = profileResult.fans_profile
        } catch {
          ok = false
        }
        // 守卫：序号最新 + 账号仍是当前选中账号（review P1-4）。否则旧账号的总览/画像
        // 会被写进当前视图（采集回调按采集账号刷新，与当前选中无关）。
        if (!shouldApplyResponse({
          requestId,
          currentRequestId: overviewRequestRef.current,
          responseAccountId: accountId,
          currentAccountId: selectedIdRef.current,
        })) return ok
        setOverview(overview)
        if (summary) setSummaryOverview(summary)
        setProfile(profile)
        return ok
      }, [post])

      useEffect(() => {
        let cancelled = false
        setAccountsLoading(true)
        void (async () => {
          // 首屏并行：浏览器自检只用于无 Chrome 时的提示条，不该阻塞账号列表
          // （对齐抖音 refresh() 的 Promise.all 编排）。
          const statusPromise = post('browser.status')
            .then(status => {
              if (!cancelled) setBrowserReady({ chrome: status.chromeAvailable, driver: status.driverAvailable })
            })
            .catch(() => { /* 浏览器自检失败不阻断首屏 */ })
          // accounts.list 失败必须被吞掉：`void` 不会吞异常，否则 Electron 渲染进程会打
          // Uncaught (in promise)（review P2-4）。
          await Promise.all([statusPromise, refreshAccounts().catch(() => null)])
          if (!cancelled) setAccountsLoading(false)
        })()
        return () => { cancelled = true }
      }, [post, refreshAccounts])

      // 切换账号 / 窗口变化 → 刷新作品与账号数据（查询只读库，不触发采集）。
      //
      // 首屏顺序（2026-11-12 真机反馈，对齐抖音首屏只拉作品列表）：
      // 原来 works.list 与 account.overview / fans.profile.get 并发发出，而总览内部
      // 还是两个串行请求——同一插件通道被总量更大的账号数据占住，作品列表被挤到
      // 2-3 秒后才出现。现在先等 works.list 落地，总览随后再拉。
      useEffect(() => {
        if (!selectedId) {
          setWorks([])
          setWorksLoading(false)
          setOverview(null)
          setSummaryOverview(null)
          setProfile(null)
          return
        }
        // 切账号瞬间先清空上一账号的账号数据，避免等作品期间显示旧账号指标（review P1-3）。
        setOverview(null)
        setSummaryOverview(null)
        setProfile(null)
        void (async () => {
          await refreshWorks(selectedId)
          // 作品已落地（或已失败）后再拉总览；期间用户若已切走，跳过。
          if (selectedIdRef.current !== selectedId) return
          void refreshOverview(selectedId, windowKey)
        })()
      }, [selectedId, windowKey, refreshWorks, refreshOverview])

      // 批量进度轮询。
      useEffect(() => {
        const timer = setInterval(async () => {
          try {
            const status = await post('collectAll.status')
            if (status && status.phase && status.phase !== 'ready') setBatch(status)
          } catch { /* 轮询失败静默保留旧状态 */ }
        }, POLL_INTERVAL_MS)
        return () => clearInterval(timer)
      }, [post])

      // 添加账号（对齐抖音 onAddAccount）：点击直接由宿主打开系统 Chrome 进入官方
      // 视频号助手扫码；无二维码弹层，进行中状态由左栏按钮文案承载。
      // accountId 可选：会话过期后点「重新扫码」时复用该账号的浏览器 Profile，
      // 而不是另起一个 pending 登录；「添加账号」不传即新建。
      // 登录一律用**新的临时 Profile**（不传 accountId）：
      // 宿主登录流程会用 key 作为 Profile 目录名，登录成功后把该目录迁移到扫码得到的
      // 身份 ID。若这里传已有账号 ID，而扫码得到的是另一个视频号身份（同一微信绑定
      // 多个视频号时很常见），迁移会把**那个已有账号的 Profile 目录搬走**，其登录态
      // 随之丢失（2026-11-11 真机串号排查连带发现）。
      const beginLogin = useCallback(() => {
        void (async () => {
          const result = await post('account.beginLogin', {})
          setLogin({ loginKey: result.loginKey, state: result.state })
          pollLogin(result.loginKey)
        })().catch(error => notify(`登录发起失败：${error.message}`))
      }, [post, notify])

      const loginTimerRef = useRef(null)
      const stopLoginPolling = useCallback(() => {
        if (loginTimerRef.current) clearInterval(loginTimerRef.current)
        loginTimerRef.current = null
      }, [])
      const collectTimerRef = useRef(null)
      const stopCollectPolling = useCallback(() => {
        if (collectTimerRef.current) clearInterval(collectTimerRef.current)
        collectTimerRef.current = null
      }, [])
      // 插件卸载时清空全部轮询（review P1-4）。
      useEffect(() => () => {
        stopLoginPolling()
        stopCollectPolling()
      }, [stopLoginPolling, stopCollectPolling])
      const pollLogin = useCallback(loginKey => {
        stopLoginPolling()
        loginTimerRef.current = setInterval(async () => {
          try {
            const status = await post('account.loginStatus', { accountId: loginKey })
            if (status.state === 'ok') {
              stopLoginPolling()
              setLogin(null)
              // 本地登录成功但远端账号上报失败时透出原因（对齐抖音 saveError 消费）：
              // 采集前 ensureRemoteAccount 会自动补报，这里只提示不阻断。
              notify(status.reason
                ? `登录成功，但云端账号上报失败（采集时会自动补报）：${reasonText(status.reason)}`
                : '登录成功')
              await refreshAccounts()
            } else if (status.state === 'idle') {
              stopLoginPolling()
              setLogin(null)
            } else if (status.state === 'timeout' || status.state === 'failed') {
              // 终态必须停轮询并恢复按钮，否则「添加账号」永远禁用。
              stopLoginPolling()
              setLogin(null)
              notify(status.state === 'timeout' ? '登录未完成，可重试' : '登录失败，可重试')
            } else {
              setLogin({ loginKey, state: status.state, reason: status.reason })
            }
          } catch { /* 轮询失败下轮重试 */ }
        }, POLL_INTERVAL_MS)
      }, [post, notify, refreshAccounts, stopLoginPolling])

      const probeAccount = useCallback(accountId => {
        void (async () => {
          const result = await post('account.probe', { accountId })
          notify(result.sessionStatus === 'ok' ? '会话有效' : result.sessionStatus === 'expired' ? '会话已过期，请重新扫码' : '会话状态未知')
          await refreshAccounts()
        })().catch(error => notify(`检测失败：${error.message}`))
      }, [post, notify, refreshAccounts])

      const removeAccount = useCallback(accountId => {
        // 删除流程（§16.2）：应用内二次确认 → 先本地清理 → 再远端删除 → 刷新列表。
        setConfirm({
          title: '删除账号',
          message: '删除该账号将清理本机登录态并删除远端业务数据（保留审计账本），确定？',
          lifecycle: 'awaiting_confirmation',
          onConfirm: () => {
            setDeleteLifecycle('confirmed_pending_adapter')
            void (async () => {
              const local = await post('account.removeLocal', { accountId })
              if (!local.cleared || !(local.cleared.profile && local.cleared.storageState)) {
                throw new Error('LOCAL_CLEARED_REQUIRED')
              }
              await post('account.removeRemote', { accountId })
              notify('账号已删除（远端保留审计墓碑）')
              await refreshAccounts()
            })().catch(error => notify(`删除失败：${error.message}`))
          },
        })
      }, [post, notify, refreshAccounts])

      const collectAccount = useCallback(accountId => {
        // 乐观投影（2026-11-11 真机反馈）：点击瞬间就进入「采集中… / 正在检查会话…」。
        // 宿主启动链路在返回前同步执行浏览器检查、会话实测与账号自愈（实测 2-3 秒），
        // 等它返回再更新会让用户点完毫无反馈；抖音是点击即置运行态。
        setCollectBusy(true)
        setCollect({ accountId, status: 'running', progress: null })
        void (async () => {
          const result = await post('collect.start', { accountId, newAttempt: true })
          if (!result.started) {
            setCollectBusy(false)
            setCollect(null)
            notify(`采集未启动：${reasonText(result.reason)}`)
            return
          }
          // 工具栏进度行随轮询逐步细化为「采集进度 N/M / 入库进度 i/j · s/e」，
          // 不再用顶部通知条承载采集反馈。
          collectTimerRef.current = setInterval(async () => {
            try {
              const status = await post('collect.status')
              if (status.collect) setCollect(status.collect)
              if (!status.busy) {
                stopCollectPolling()
                setCollectBusy(false)
                const final = status.collect || null
                if (!final) {
                  // 宿主重启/插件重载会丢 collectRecord：busy=false 且无投影时清掉本地
                  // 乐观 running 态，避免「采集中…」spinner 与禁用按钮永不清除（review P2）。
                  setCollect(null)
                  notify('采集状态丢失，可重试')
                } else if (final.status === 'failed') {
                  notify(final.error ? `采集失败：${reasonText(final.error)}` : '采集失败，可重试')
                }
                await refreshWorks(accountId)
                await refreshOverview(accountId, windowKey)
                await refreshAccounts()
              }
            } catch { /* 轮询失败下轮重试 */ }
          }, POLL_INTERVAL_MS)
        })().catch(error => {
          stopCollectPolling()
          setCollectBusy(false)
          setCollect(null)
          notify(`采集失败：${error.message}`)
        })
      }, [post, notify, refreshWorks, refreshOverview, refreshAccounts, windowKey, stopCollectPolling])

      /**
       * 「刷新」按钮（2026-11-11 真机反馈：点击看起来没作用）：
       * 原来只是并发触发两个查询且没有任何反馈，数据没变化时用户完全看不出发生过什么。
       * 现在：刷新期间按钮显示「刷新中…」并禁用，完成后按钮自行恢复——**成功不再弹顶部
       * 提示**（按钮状态变化已是足够反馈，顶部长提示反而多余）；仅失败时提示具体失败项。
       * 同时连带刷新账号列表（账号卡片的「最近同步」时间与会话状态随之更新）。
       *
       * 结果聚合（review P1-2）：refreshWorks/refreshOverview 内部会吞掉错误，三路
       * Promise 几乎不会 reject——若只看 Promise 结果，失败也会被报成成功。改为各自
       * 返回成功标志后聚合，部分失败要明确说出来。
       */
      const refreshAll = useCallback(accountId => {
        if (!accountId) return
        setRefreshing(true)
        setRefreshMessage(null)
        void (async () => {
          try {
            const [worksOk, overviewOk, accountsOk] = await Promise.all([
              refreshWorks(accountId).catch(() => false),
              refreshOverview(accountId, windowKey).catch(() => false),
              refreshAccounts().then(() => true).catch(() => false),
            ])
            // 提示就地显示在刷新按钮旁（2026-11-11 真机反馈：不要顶部通知条）。
            // 成功不提示（按钮由「刷新中…」恢复即足够反馈）；只有失败才说明白。
            if (!worksOk || !overviewOk || !accountsOk) {
              setRefreshMessage(refreshResultLabel({ works: worksOk, overview: overviewOk, accounts: accountsOk }))
            }
          } finally {
            setRefreshing(false)
          }
        })()
      }, [notify, refreshWorks, refreshOverview, refreshAccounts, windowKey])

      const collectAll = useCallback(() => {
        // 与单账号采集同理：点击瞬间先挂最小运行投影，批量面板立刻显示 spinner，
        // 不等宿主逐个账号探测完才反馈（2026-11-11 真机反馈的一致性修复）。
        setBatch({ phase: 'probing', items: [], currentAccountIndex: 0 })
        void (async () => {
          const result = await post('collectAll.start', {})
          if (!result.started) {
            setBatch(null)
            notify(`批量采集未启动：${reasonText(result.reason)}`)
            return
          }
          // 宿主回执带完整批量投影，直接覆盖乐观值；后续随 collectAll.status 轮询细化。
          setBatch(result.batch || null)
        })().catch(error => {
          // 任何异步失败都必须清掉乐观投影，否则面板停在「采集中」且宿主无批量状态
          // 可纠正（client.js 的轮询只认 phase !== 'ready'）。
          setBatch(null)
          notify(`批量采集失败：${error.message}`)
        })
      }, [post, notify])

      // Esc 逐层关闭（对齐抖音 keydown 链）：详情弹层 → 确认弹层 → 工作台 overlay；
      // overlay 关闭时组件卸载，登录/采集轮询由卸载清理统一停止。
      useEffect(() => {
        const onKey = event => {
          if (event.key === 'Escape') {
            if (detail) {
              setDetail(null)
              setDetailDaily([])
            } else if (confirm) {
              setConfirm(null)
            } else {
              setOpened(false)
            }
          }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [detail, confirm])

      // 弹层（详情/确认）关闭后恢复打开前焦点（契约审计可关闭性要求）。
      const lastDialogTriggerRef = useRef(null)
      const dialogOpen = Boolean(detail || confirm)
      useEffect(() => {
        if (!dialogOpen) return
        if (typeof document !== 'undefined') lastDialogTriggerRef.current = document.activeElement
        return () => {
          const trigger = lastDialogTriggerRef.current
          requestAnimationFrame(() => trigger?.focus?.())
        }
      }, [dialogOpen])

      // 批量结束后刷新当前账号数据。
      useEffect(() => {
        if (batch && batch.phase === 'finished' && selectedId) {
          void refreshWorks(selectedId)
          void refreshOverview(selectedId, windowKey)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [batch && batch.phase])

      // 详情请求序号 + 账号双维度守卫（审查 P2-5）：快速点开 A→B→A 时，A 的旧响应
      // 后到不得覆盖 B 的弹层内容。
      const detailRequestRef = useRef(0)
      const openDetail = useCallback(work => {
        setDetail(work)
        setDetailDaily([])
        detailRequestRef.current += 1
        const requestId = detailRequestRef.current
        const accountId = work.account_id || selectedId
        void (async () => {
          try {
            const result = await post('work.get', { accountId, workId: work.work_id })
            if (!shouldApplyResponse({
              requestId,
              currentRequestId: detailRequestRef.current,
              responseAccountId: accountId,
              currentAccountId: selectedId,
            })) return
            setDetail(result.work || work)
            setDetailDaily(Array.isArray(result.daily_metrics) ? result.daily_metrics : [])
          } catch { /* 详情查询失败保留行内数据展示 */ }
        })()
      }, [post, selectedId])

      const browserBlocked = !browserReady.chrome || !browserReady.driver
      const batchRunning = Boolean(batch && batch.phase && batch.phase !== 'finished')

      return h('div', { className: 'ywc-root' },
        h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
        h('div', { className: 'ywc-shell', 'data-tab': tab },
          h('header', { className: 'ywc-header' },
            h('div', { className: 'ywc-title' },
              h('div', { className: 'ywc-mark', 'aria-hidden': 'true' }, '视'),
              h('div', null,
                h('h1', null, '视频号工作台'),
                h('p', null, '扫码登录视频号助手，采集账号全部作品、账号数据与关注者数据'),
              ),
            ),
            // 右上角关闭按钮（对齐抖音 ydo-header-buttons）：关闭整页工作台。
            h('div', { className: 'ywc-header-actions' },
              h(Tooltip, { label: '关闭' },
                h('button', {
                  className: 'ywc-icon', type: 'button',
                  'aria-label': '关闭视频号工作台', onClick: () => setOpened(false),
                }, h(IconCloseOutlineRegular, { size: 16 })),
              ),
            ),
          ),
          notice ? h('div', { className: 'ywc-badge', role: 'status', 'aria-live': 'polite', style: { margin: '10px 24px 0' } }, notice) : null,
          h('nav', { className: 'ywc-tabs', 'aria-label': '工作台模块' },
            h('button', { className: 'ywc-tab', type: 'button', 'aria-selected': tab === 'work' ? 'true' : 'false', onClick: () => setTab('work') }, '作品数据'),
            h('button', { className: 'ywc-tab', type: 'button', 'aria-selected': tab === 'account' ? 'true' : 'false', onClick: () => setTab('account') }, '账号数据'),
          ),
          h('div', { className: 'ywc-body' },
            h('aside', { className: 'ywc-accounts', 'aria-label': '账号管理' },
              h(AccountList, {
                accounts, selectedId, busy: collectBusy,
                browserBlocked,
                batch,
                loginActive: Boolean(login),
                onSelect: accountId => setSelectedId(accountId),
                onProbe: probeAccount,
                onRemove: removeAccount,
                onBeginLogin: beginLogin,
                onCollectAll: collectAll,
              }),
              browserBlocked
                ? h('p', { className: 'ywc-empty', style: { padding: '0 2px' } },
                  `需要系统 Google Chrome${browserReady.chrome ? ' 与 Playwright 驱动' : ''}（当前缺失），采集功能不可用`)
                : null,
              // 登录进行中：同一微信可绑定多个视频号，扫码后官方页面才出现身份选择；
              // 插件会等身份稳定后再建账号（2026-11-11 真机串号根因）。
              login
                ? h('p', { className: 'ywc-hint', style: { padding: '6px 2px 0' }, role: 'status' },
                  '浏览器已打开，请扫码登录；若该微信绑定了多个视频号，请在官方页面选择要采集的那一个，插件会等您选完再建账号。')
                : null,
            ),
            h('main', { className: 'ywc-right' },
              tab === 'work'
                ? h('section', { className: 'ywc-panel ywc-work-panel' },
                  h(WorkToolbar, {
                    onCollect: () => selectedId && collectAccount(selectedId),
                    onRefresh: () => selectedId && refreshAll(selectedId),
                    // 采集按钮：批量运行中一并禁用（宿主互斥会拒绝，提前禁用给稳定反馈）；
                    // 刷新是只读查询，批量运行中保持可用，但单账号采集期间禁用（采集会
                    // 改写同一批数据，同时刷新会读到中间态）。
                    collectDisabled: !selectedId || collectBusy || batchRunning,
                    refreshDisabled: !selectedId || collectBusy || refreshing,
                    refreshing,
                    refreshMessage,
                    // 最近采集时间（2026-11-12 真机反馈）：取已入库作品的最近采集时刻，
                    // 展示在刷新按钮后，不再占用表格一列。
                    latestCollectedAt: latestCollectedAt(works),
                    collect: collect && collect.accountId === selectedId ? collect : null,
                  }),
                  h(WorkSummaryCards, { works, summaryOverview, account: selected }),
                  h(WorkTable, {
                    rows: visibleWorks,
                    // 首屏账号列表未就绪 / 首次作品查询无缓存时显示加载态，
                    // 不用「暂无已入库作品」空态冒充（2026-11-12 真机反馈）。
                    loading: worksLoading || (accountsLoading && !selectedId),
                    sort,
                    onSortChange: columnKey => setSort(currentSort => nextSortState(currentSort, columnKey)),
                    onOpenDetail: openDetail,
                  }),
                )
                : h(AccountTab, {
                  window: windowKey, onWindow: setWindowKey,
                  overview, profile,
                  // 关注者增长趋势图固定用 last_7d（「昨日」窗口只有 2 天数据，
                  // 会把 7 天横轴截断成 2 个点）。
                  trendOverview: summaryOverview,
                  accounts, selectedId,
                  onSelectAccount: accountId => setSelectedId(accountId),
                }),
            ),
          ),
        ),
        h(WorkDetailDialog, {
          work: detail, detail: detail ? {
            traffic_source: detail.traffic_source,
            retention_trend: detail.retention_trend,
          } : null,
          dailyMetrics: detailDaily,
          onClose: () => { setDetail(null); setDetailDaily([]) },
        }),
        confirm ? h('div', { className: 'ywc-modal open', role: 'dialog', 'aria-modal': 'true', onClick: event => { if (event.target === event.currentTarget) setConfirm(null) } },
          h('div', { className: 'ywc-dialog', style: { width: 'min(430px,100%)' } },
            h('header', { className: 'ywc-dialog-header' },
              h('h2', null, confirm.title),
              h('button', { className: 'ywc-close', type: 'button', 'aria-label': '关闭确认弹层', onClick: () => setConfirm(null) }, '×'),
            ),
            h('div', { className: 'ywc-dialog-body' },
              h('p', { className: 'ywc-card-meta' }, confirm.message),
              h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
                h('button', { className: 'ywc-button', type: 'button', onClick: () => setConfirm(null) }, '取消'),
                h('button', {
                  className: 'ywc-button primary', type: 'button',
                  onClick: () => { setConfirm(null); confirm.onConfirm() },
                }, '确认删除'),
              ),
            ),
          ),
        ) : null,
      )
    }

    function reasonText(reason) {
      const map = {
        session_required: '会话失效',
        probe_failed: '探测失败',
        storage_state_missing: '缺登录态',
        pending_account: '待升级账号',
        collect_busy: '采集互斥',
        session_expired: '会话失效',
        // 服务端确定性业务错误（2026-11-11 真机链路排查）：给可行动文案而非「原因未知」。
        ACCOUNT_NOT_FOUND: '云端缺少账号记录，请重新扫码登录后重试',
        WX_TOOL_UNAVAILABLE: '桌面未接通视频号工具通道，请升级客户端后重试',
      }
      // 未知稳定码收敛为通用文案（对齐 batchReasonText），不把原始错误码透给业务用户。
      return map[reason] || '原因未知'
    }

    module.exports = { apply, inject: ['slots'], renderWxWorkbench, SidebarButton, css: STYLES }
    return module.exports;
  },
});
