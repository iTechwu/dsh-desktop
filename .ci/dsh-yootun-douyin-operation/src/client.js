// 抖音运营客户端：左下角菜单入口 + 整页 overlay（左侧账号管理区 + 右侧作品数据区）。
//
// 数据来源：本地同源路由 /api/desktop/yootun/douyin-operation（宿主再经公共网关调 tools）。
// 展示契约（docs/0909/douyin §5）：
// - 表格列序固定，指标文案严格为「2s跳出率 / 5s完播率 / 完播率 / 平均播放时长 / 平均播放占比 / 粉丝播放占比」；
// - 本次未取到的字段显示 `—`（dataGap），**不用历史值冒充当前值**；
// - 双击行打开子页面（性别/年龄/地域/城市级/流量来源/进度/搜索词/热词）。

import { COLUMNS, DEFAULT_SORT_STATE, EMPTY, accountState, formatAgeBucket, formatCell, formatCount, formatDateTime, formatPercent, gapFieldLabel, gapReasonText, genderColor, genderLabel, hasGap, nextSortState, progressStatus, progressStatusText, progressText, safeAvatarSrc, safeWorkUrl, sortWorks, tableTemplate, trafficSourceLabel } from './ui-format.js'
import { ERROR_REASON_COPY, OverviewPage, buildOverviewFilters, defaultCustomRange, overviewRangeLabel } from './overview-ui.js'
import { ANALYSIS_ERROR_REASON_COPY, AnalysisPage, TREND_METRICS } from './analysis-ui.js'
import {
  BREAKDOWN_ERROR_REASON_COPY,
  BreakdownDetailPage,
  BreakdownHistoryList,
  BreakdownNewPage,
  BreakdownRewriteModal,
  breakdownStatusTone,
} from './breakdown.js'

const React = require('react')
const { createElement: h, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
const { IconCloseOutline16, IconDownloadOutline16, IconPlayOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

const NS = 'dofe.yootun-douyin-operation'
const PATH = '/api/desktop/yootun/douyin-operation'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const OVERLAY_ID = '@dofe/dsh-yootun-douyin-operation'
const LOGIN_POLL_INTERVAL_MS = 2000
const COLLECT_POLL_INTERVAL_MS = 1500
// AI 分析轮询间隔：优先后 get 响应内 pollIntervalSeconds（服务端 TOML 下发），
// 缺失退回 3s（0916 方案 §5.2/§3.1 poll_interval_seconds 默认值）。
const AI_POLL_FALLBACK_INTERVAL_MS = 3000
// 受理幂等键：每次点击新生成（重试复用同一次点击的键），键不嵌账号（0916 方案 §5.1）。
const newAiAnalysisRequestUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
const aiAnalysisIdempotencyKey = () => `douyin:ai_analysis:${newAiAnalysisRequestUuid()}`
// 爆款拆解受理键（0922 方案）：与 P2 index.js 的键前缀校验、tools-client.js 的
// viralVideo*IdempotencyKey 模板一致；每次点击生成全新 UUID，页面内不跨点击复用。
const bdArchiveIdempotencyKey = () => `douyin:vv_archive:${newAiAnalysisRequestUuid()}`
const bdWorkflowIdempotencyKey = () => `douyin:vv_workflow:${newAiAnalysisRequestUuid()}`
// 归档轮询固定 3s；workflow 轮询优先后端 retryAfterSeconds（缺失退回 5s），
// 实际间隔 = max(5s, retryAfterSeconds)。
const BD_ARCHIVE_POLL_INTERVAL_MS = 3000
const BD_WORKFLOW_POLL_INTERVAL_MS = 5000
// workflow 轮询连续失败上限：25s（5 次 × 5s 间隔）内持续不可用即终止轮询。
const BD_WORKFLOW_POLL_MAX_FAILURES = 5

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
    retry: '重新检测', selectAccount: '请选择账号', emptyAccounts: '添加账号后开始采集', addAccountHint: '添加账号后开始分析',
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
    colLike: '点赞量', colComment: '评论量', colShare: '分享量', colBounce2s: '2s跳出率', colCompletion5s: '5s完播率',
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
    // 采集链路识别抖音 status_code=8（会话失效）后的专属文案（0914 方案 §3.6）：
    // 绝不显示"采集完成"，与普通采集失败区分，指引重新扫码。
    collectSessionExpired: '会话已过期，请重新扫码',
    accountSaveFailed: '登录成功，但账号信息同步到云端失败，采集将不可用；请重启客户端后重新登录',
    accountNotOnCloud: '云端还没有该账号的数据，请先完成一次采集', operationUnavailable: '抖音运营服务暂时不可用，请稍后重试',
    workNotOnCloud: '云端还没有该作品的数据，请先重新采集',
    seconds: '秒', noHotword: '暂无热词', noSearch: '暂无搜索词',
    exportExcel: '导出 Excel', exporting: '导出中…', exportFailed: '导出失败，请稍后重试',
    exportTooLarge: '当前账号数据量过大，暂不支持导出，请联系管理员', exportNoData: '当前账号暂无可导出数据',
    // 账号总览 Tab（0914 方案 §5，阶段 1）
    tabOverview: '账号总览',
    collectFirstHint: '请先采集作品数据',
    sessionStale: '状态待检测', sessionCheckValid: '最近检测有效',
    suspiciousEmptyCollect: '可疑空采集/请检测会话',
    insufficientSample: '样本不足',
    alertSessionExpired: '会话已过期，请重新扫码', alertSuspiciousEmpty: '可疑空采集，请检测会话',
    alertStaleCollect: '最近 7 天没有成功的采集，数据可能过旧',
    overviewAccountFilter: '账号：', overviewWindow: '发布时间：', overviewSort: '排序：',
    allAccounts: '全部账号', colAccount: '账号', colVideo: '视频',
    window_7d: '近7天', window_30d: '近30天', window_90d: '近90天', window_custom: '自定义',
    customRangeStart: '开始日期', customRangeEnd: '截止日期',
    customRangeEmpty: '当前发布时间范围内暂无作品，可调整开始/截止日期后重新查询',
    sort_hot_count: '按爆款数排序', sort_hot_rate: '按爆款率排序', sort_median_play: '按中位播放排序',
    sort_total_play: '按总播放排序', sort_engagement_rate: '按互动率排序',
    kpiAccounts: '管理账号', kpiWorks: '作品总数', kpiTotalPlay: '累计播放量',
    kpiHotWorks: '爆款视频', kpiCurrentCumulative: '当前累计值',
    accountRanking: '账号表现排行', rankCol: '排名', colMedianPlay: '中位播放',
    hotRateCol: '爆款率', hotOwnerAccount: '所属账号',
    hotDistribution: '爆款账号分布', overviewAlerts: '运营提醒', noAlerts: '暂无提醒',
    hotWorksTitle: '爆款视频', hotBasis: '爆款依据', noHotWorks: '当前筛选内暂无爆款视频',
    loading: '加载中…',
    exportOverview: '导出总览', hotDrawerTitle: '爆款视频详情',
    openFullWorkAnalysis: '查看完整作品分析',
    accountNotAccessible: '部分账号不在当前部署范围内，无法查看总览',
    overviewTooManyAccounts: '一次最多筛选 200 个账号',
    ruleVersionMismatch: '总览规则版本已更新，请刷新后重试',
    // 单账号分析页（0914 方案 §6，阶段 2；UI 优化方案 §5）
    backToOverview: '← 返回账号总览', exportAnalysis: '导出账号分析报告',
    accountTitle: '账号：{name}',
    colHighestPlay: '最高播放量', trendTitle: '数据趋势', trendMetric: '指标',
    metric_play: '累计播放量', metric_like: '累计点赞量', metric_comment: '累计评论量',
    metric_collect: '累计收藏量', metric_share: '累计分享量', metric_fans: '粉丝数',
    trendCaption: '采集最近30天数据，缺采集日期以虚线连接，不补零',
    noCollectGap: '无采集', counterRevised: '平台修正', noTrend: '暂无趋势',
    trendSingleHint: '暂无足够趋势数据（窗口内仅 1 个采集点）',
    contentMetrics: '内容指标',
    cmEngagement: '综合互动率', cmLikeRate: '点赞率', cmCommentRate: '评论率',
    cmCollectRate: '收藏率', cmShareRate: '分享率', cmCompletion5s: '5秒完播率',
    cmAvgViewShare: '平均播放占比', cmAvgWatchDuration: '平均播放时长',
    mainGender: '主要性别', mainAge: '主要年龄', mainRegion: '主要地域', mainTrafficSource: '主要流量来源',
    audienceTraffic: '观众与流量', audienceNotOpen: '暂未开放',
    accountHotWorks: '本账号爆款视频',
    contractVersionMismatch: '趋势契约版本已更新，请刷新后重试',
    trendRangeTooLarge: '查询跨度超过服务端上限，请缩小范围',
    // 观众与流量开放 + 内容类提醒 + 潜力标签（阶段 3）
    dataInsufficient: '数据不足', dataPartial: '部分数据',
    hotwordStale: '热词已过期，非本轮实时', hotwordStaleBadge: '过期',
    collectedAt: '采集时间',
    labelAbsolute: '绝对爆款', labelAccountRelative: '账号内爆款', labelPotential: '潜力作品',
    // 未知枚举兜底（验收 P2）：未登记的标签/规则 ID 不透出原始值。
    labelOther: '其他标签', alertRuleOther: '其他规则提醒',
    // UI 优化方案 v2（2026-09-16）：账号目录一致性、作品数范围口径、加权说明。
    accountCatalogSyncing: '账号列表与统计正在同步', accountCatalogUnavailable: '账号列表暂不可用',
    noWorks: '暂无可统计作品', workCountAllTime: '全部时间作品数',
    // 二审（2026-09-16）：排行受 top_n 截断属正常展示语义，明确区分完整账号数与展示数。
    rankingScopeHint: '共 {total} 个账号 · 排行展示 {shown} 个',
    // AI 账号表现分析（0916 方案 §9）
    aiTitle: 'AI 账号表现分析',
    aiStatusNotAnalyzed: '状态：未分析', aiStatusRunning: '状态：分析中',
    aiStatusSucceeded: '状态：已完成', aiStatusInsufficient: '状态：数据不足', aiStatusFailed: '状态：失败',
    aiStartButton: 'AI 分析账号表现', aiStartButtonFirst: '开始分析', aiRerunButton: '重新分析', aiRunningButton: '分析中…',
    aiEntryButton: 'AI 分析',
    aiExpand: '展开', aiCollapse: '收起',
    aiSummaryTitle: '结论摘要', aiDimensionsTitle: '表现诊断', aiPatternsTitle: '爆款规律',
    aiRisksTitle: '风险与机会', aiRecommendationsTitle: '执行建议',
    aiAssessmentLabel: '整体判定',
    aiAssessmentStable: '稳定', aiAssessmentGrowing: '增长', aiAssessmentVolatile: '波动',
    aiLevelStrong: '强', aiLevelMedium: '中', aiLevelWeak: '弱', aiLevelInsufficient: '数据不足',
    aiGradeHigh: '高', aiGradeMedium: '中', aiGradeLow: '低',
    aiExpectedSignal: '观察信号',
    aiMetaRange: '最近 30 天', aiMetaGeneratedAt: '分析时间', aiMetaSample: '样本作品数',
    aiMetaPrompt: '提示词版本', aiMetaModel: '模型',
    aiEvidenceWorks: '证据作品',
    aiDataLimitations: '数据限制', aiDisclaimer: '免责声明',
    aiConfirmTitle: '重新分析？',
    aiConfirmBody: '将忽略缓存重新运行 AI 分析，预计需要 1–3 分钟，可能产生模型调用费用。',
    aiConfirmYes: '重新分析', aiConfirmNo: '取消',
    aiErrorRetained: 'AI 分析暂时失败，请稍后重试；已保留上次分析结果',
    aiErrorRunning: '已有进行中的分析任务，请等待完成', aiErrorBusy: '当前分析任务较多，请稍后重试',
    aiErrorInsufficient: '有效作品样本不足，暂无法生成 AI 分析', aiErrorRetryable: 'AI 分析暂时失败，请稍后重试',
    aiErrorTimeout: '分析超时，请稍后重试', aiErrorEnqueue: '分析任务提交失败，请重新发起',
    aiErrorUnavailable: 'AI 分析服务暂不可用，请联系管理员', aiErrorNotFound: '分析记录不存在',
    aiErrorConflict: '请求与历史记录不一致，请刷新后重试',
    // 卡片折叠布局（2026-09-17 验收稿）
    aiDimShortContent: '内容', aiDimShortInteraction: '互动', aiDimShortRetention: '留存',
    aiDimShortAudience: '受众', aiDimShortStability: '稳定',
    aiDimDetail: '证据与明细', aiLimitsTitle: '数据限制与免责',
    aiDigestLimits: '{n} 项',
    // 爆款拆解 Tab（0922 方案 §4.1）
    tabBreakdown: '爆款拆解',
    bdNewTitle: '新建拆解',
    bdShareLabel: '抖音分享链接', bdSharePlaceholder: '粘贴抖音视频分享链接',
    bdStartButton: '开始拆解', bdSubmitting: '提交中…',
    bdArchivePending: '正在下载并归档视频，通常需要十几秒…',
    bdRulesHint: '仿写规则可选：不选则按默认链路改写；拆解历史团队共享。',
    bdRulesLabel: '仿写规则', bdRulesEmpty: '暂无可用仿写规则，将按默认链路改写', bdRulesRetry: '重新加载规则',
    bdHistoryLabel: '拆解历史', bdHistoryEmpty: '还没有拆解记录，粘贴分享链接开始第一次拆解',
    bdStatusSucceeded: '已完成', bdStatusFailed: '失败', bdStatusCancelled: '已取消', bdStatusRunning: '进行中',
    bdStatusNeedsInput: '待补充信息',
    bdProgressLabel: '拆解进度',
    bdStep_archive_original: '归档', bdStep_transcode_audio: '转码', bdStep_asr: '语音识别',
    bdStep_extract_frames: '抽帧', bdStep_vision: '画面理解', bdStep_breakdown: '结构拆解',
    bdStep_storyboard: '改写分镜', bdStep_shot_script: '拍摄脚本',
    bdRole_hook: '钩子', bdRole_build: '铺垫', bdRole_turn: '转折', bdRole_cta: '引导', bdRole_other: '其他',
    bdSourceFrom: '来源段落',
    bdCardOriginal: '原视频拆解', bdCardTranscript: '口播全文', bdCardStoryboard: '改写分镜',
    bdCardShotScript: '拍摄脚本', bdCardRule: '使用的仿写规则',
    bdSegmentUnit: '段', bdSectionPending: '本段内容尚未生成', bdDetailEmpty: '暂无拆解内容',
    bdShotQuotas: '景别配额', bdRuleNone: '本次拆解未使用仿写规则（默认链路改写）',
    bdBackToList: '← 返回列表', bdRewriteButton: '重新改写',
    bdRewriteTitle: '重新改写这条视频', bdRewriteHint: '选择仿写规则后将以新规则版本重新生成分镜与脚本；原拆解记录保留。',
    bdRewriteStart: '开始改写', bdRunningHint: '拆解进行中，页面会自动刷新进度…',
    bdErrorInvalidKey: '请求参数不合法，请刷新后重试', bdErrorRunNotFound: '任务不存在或已过期，请重新发起',
    bdErrorUnknownRule: '所选仿写规则不存在或已下线，请刷新规则列表', bdErrorConflict: '请求与历史记录不一致，请刷新后重试',
    bdErrorCandidateNotFound: '原视频记录不存在，请重新发起拆解', bdErrorInvalidInput: '请求参数不合法，请检查后重试',
    bdErrorNeedsInput: '该视频缺少必要信息，暂不支持拆解', bdErrorRetryable: '拆解暂时失败（可能是视频过长或服务繁忙），请稍后重新改写',
    bdErrorFailed: '拆解失败，请重新发起', bdErrorArchiveFailed: '视频下载或归档失败，请确认链接后重试',
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
    retry: 'Check again', selectAccount: 'Select an account', emptyAccounts: 'Add an account to start collecting', addAccountHint: 'Add an account to start analyzing',
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
    colLike: 'Likes', colComment: 'Comments', colShare: 'Shares', colBounce2s: '2s bounce', colCompletion5s: '5s completion',
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
    collectSessionExpired: 'Session expired — scan again',
    accountSaveFailed: 'Signed in, but syncing the account to the cloud failed — collecting will not work; restart the client and sign in again',
    accountNotOnCloud: 'No cloud data for this account yet — run a collection first', operationUnavailable: 'The Douyin ops service is temporarily unavailable; retry later',
    workNotOnCloud: 'No cloud data for this work yet — run a collection first',
    seconds: 's', noHotword: 'No hotwords', noSearch: 'No search keywords',
    exportExcel: 'Export Excel', exporting: 'Exporting…', exportFailed: 'Export failed, retry later',
    exportTooLarge: 'Too much data for this account to export — contact the administrator', exportNoData: 'Nothing to export for this account yet',
    tabOverview: 'Account overview',
    collectFirstHint: 'Collect work data first',
    sessionStale: 'Not verified recently', sessionCheckValid: 'Verified recently',
    suspiciousEmptyCollect: 'Suspicious empty collect — check the session',
    insufficientSample: 'Insufficient sample',
    alertSessionExpired: 'Session expired — scan again', alertSuspiciousEmpty: 'Suspicious empty collect — check the session',
    alertStaleCollect: 'No successful collection in the last 7 days; data may be stale',
    overviewAccountFilter: 'Accounts:', overviewWindow: 'Publish window:', overviewSort: 'Sort:',
    allAccounts: 'All accounts', colAccount: 'Account', colVideo: 'Video',
    window_7d: 'Last 7 days', window_30d: 'Last 30 days', window_90d: 'Last 90 days', window_custom: 'Custom',
    customRangeStart: 'Start date', customRangeEnd: 'End date',
    customRangeEmpty: 'No works in the selected publish range; adjust the start/end dates and query again',
    sort_hot_count: 'By hot works', sort_hot_rate: 'By hot rate', sort_median_play: 'By median plays',
    sort_total_play: 'By total plays', sort_engagement_rate: 'By engagement',
    kpiAccounts: 'Accounts', kpiWorks: 'Works', kpiTotalPlay: 'Total plays',
    kpiHotWorks: 'Hot works', kpiCurrentCumulative: 'cumulative',
    accountRanking: 'Account ranking', rankCol: 'Rank', colMedianPlay: 'Median plays',
    hotRateCol: 'Hot rate', hotOwnerAccount: 'Account',
    hotDistribution: 'Hot works by account', overviewAlerts: 'Alerts', noAlerts: 'No alerts',
    hotWorksTitle: 'Hot works', hotBasis: 'Basis', noHotWorks: 'No hot works in the current filter',
    loading: 'Loading…',
    exportOverview: 'Export overview', hotDrawerTitle: 'Hot work detail',
    openFullWorkAnalysis: 'Open full work analysis',
    accountNotAccessible: 'Some accounts are outside this deployment; the overview is unavailable',
    overviewTooManyAccounts: 'Filter at most 200 accounts at once',
    ruleVersionMismatch: 'The overview rule version changed — refresh and retry',
    backToOverview: '← Back to overview', exportAnalysis: 'Export account analysis',
    accountTitle: 'Account: {name}',
    colHighestPlay: 'Max plays', trendTitle: 'Data trend', trendMetric: 'Metric',
    metric_play: 'Plays', metric_like: 'Likes', metric_comment: 'Comments',
    metric_collect: 'Favorites', metric_share: 'Shares', metric_fans: 'Followers',
    trendCaption: 'Collected data over the last 30 days; missing days are dashed, not zero-filled',
    noCollectGap: 'No collect', counterRevised: 'Revised', noTrend: 'No trend yet',
    trendSingleHint: 'Not enough trend data (only one point in window)',
    contentMetrics: 'Content metrics',
    cmEngagement: 'Engagement', cmLikeRate: 'Like rate', cmCommentRate: 'Comment rate',
    cmCollectRate: 'Favorite rate', cmShareRate: 'Share rate', cmCompletion5s: '5s completion',
    cmAvgViewShare: 'Avg view share', cmAvgWatchDuration: 'Avg watch time',
    mainGender: 'Main gender', mainAge: 'Main age', mainRegion: 'Main region', mainTrafficSource: 'Main traffic source',
    audienceTraffic: 'Audience & traffic', audienceNotOpen: 'Not available yet',
    accountHotWorks: 'Hot works of this account',
    contractVersionMismatch: 'The trend contract version changed — refresh and retry',
    trendRangeTooLarge: 'Range exceeds the server limit — narrow it',
    dataInsufficient: 'Insufficient data', dataPartial: 'Partial data',
    hotwordStale: 'Stale hotwords, not from this round', hotwordStaleBadge: 'stale',
    collectedAt: 'Collected at',
    labelAbsolute: 'Absolute', labelAccountRelative: 'In-account', labelPotential: 'Potential',
    labelOther: 'Other label', alertRuleOther: 'Other rule alert',
    accountCatalogSyncing: 'Account list and stats are syncing', accountCatalogUnavailable: 'Account list unavailable',
    noWorks: 'No statistically usable works', workCountAllTime: 'All-time works',
    rankingScopeHint: '{total} accounts in total · ranking shows {shown}',
    // AI performance analysis (0916 plan §9)
    aiTitle: 'AI performance analysis',
    aiStatusNotAnalyzed: 'Status: not analyzed', aiStatusRunning: 'Status: analyzing',
    aiStatusSucceeded: 'Status: done', aiStatusInsufficient: 'Status: insufficient data', aiStatusFailed: 'Status: failed',
    aiStartButton: 'Analyze with AI', aiStartButtonFirst: 'Start analysis', aiRerunButton: 'Re-run analysis', aiRunningButton: 'Analyzing…',
    aiEntryButton: 'AI analysis',
    aiExpand: 'Expand', aiCollapse: 'Collapse',
    aiSummaryTitle: 'Summary', aiDimensionsTitle: 'Diagnosis', aiPatternsTitle: 'Viral patterns',
    aiRisksTitle: 'Risks & opportunities', aiRecommendationsTitle: 'Actions',
    aiAssessmentLabel: 'Overall',
    aiAssessmentStable: 'Stable', aiAssessmentGrowing: 'Growing', aiAssessmentVolatile: 'Volatile',
    aiLevelStrong: 'Strong', aiLevelMedium: 'Medium', aiLevelWeak: 'Weak', aiLevelInsufficient: 'Insufficient data',
    aiGradeHigh: 'High', aiGradeMedium: 'Medium', aiGradeLow: 'Low',
    aiExpectedSignal: 'Signal to watch',
    aiMetaRange: 'Last 30 days', aiMetaGeneratedAt: 'Generated at', aiMetaSample: 'Sample works',
    aiMetaPrompt: 'Prompt version', aiMetaModel: 'Model',
    aiEvidenceWorks: 'Evidence works',
    aiDataLimitations: 'Data limitations', aiDisclaimer: 'Disclaimer',
    aiConfirmTitle: 'Re-run analysis?',
    aiConfirmBody: 'This re-runs the AI analysis bypassing the cache. It may take 1–3 minutes and could incur model usage charges.',
    aiConfirmYes: 'Re-run', aiConfirmNo: 'Cancel',
    aiErrorRetained: 'AI analysis failed temporarily; the previous result is kept',
    aiErrorRunning: 'An analysis is already running', aiErrorBusy: 'Too many analyses are running; try again later',
    aiErrorInsufficient: 'Not enough valid works to generate an AI analysis', aiErrorRetryable: 'AI analysis failed temporarily; try again later',
    aiErrorTimeout: 'The analysis timed out; try again later', aiErrorEnqueue: 'The analysis could not be submitted; start it again',
    aiErrorUnavailable: 'The AI analysis service is unavailable; contact your admin', aiErrorNotFound: 'Analysis record not found',
    aiErrorConflict: 'The request conflicts with a previous one; refresh and retry',
    aiDimShortContent: 'Content', aiDimShortInteraction: 'Interaction', aiDimShortRetention: 'Retention',
    aiDimShortAudience: 'Audience', aiDimShortStability: 'Stability',
    aiDimDetail: 'Evidence & details', aiLimitsTitle: 'Data limits & disclaimer',
    aiDigestLimits: '{n}',
    // Viral breakdown tab (0922 plan §4.1)
    tabBreakdown: 'Viral breakdown',
    bdNewTitle: 'New breakdown',
    bdShareLabel: 'Douyin share link', bdSharePlaceholder: 'Paste a Douyin video share link',
    bdStartButton: 'Start breakdown', bdSubmitting: 'Submitting…',
    bdArchivePending: 'Downloading and archiving the video, usually takes a while…',
    bdRulesHint: 'Rewrite rules are optional; without one the default pipeline applies. Breakdown history is shared with the team.',
    bdRulesLabel: 'Rewrite rules', bdRulesEmpty: 'No rewrite rules available; the default pipeline will be used', bdRulesRetry: 'Reload rules',
    bdHistoryLabel: 'Breakdown history', bdHistoryEmpty: 'No breakdowns yet — paste a share link to start the first one',
    bdStatusSucceeded: 'Done', bdStatusFailed: 'Failed', bdStatusCancelled: 'Cancelled', bdStatusRunning: 'Running',
    bdStatusNeedsInput: 'Needs input',
    bdProgressLabel: 'Breakdown progress',
    bdStep_archive_original: 'Archive', bdStep_transcode_audio: 'Transcode', bdStep_asr: 'Speech-to-text',
    bdStep_extract_frames: 'Frames', bdStep_vision: 'Vision', bdStep_breakdown: 'Breakdown',
    bdStep_storyboard: 'Storyboard', bdStep_shot_script: 'Shot script',
    bdRole_hook: 'Hook', bdRole_build: 'Build-up', bdRole_turn: 'Turn', bdRole_cta: 'CTA', bdRole_other: 'Other',
    bdSourceFrom: 'Source segments',
    bdCardOriginal: 'Original breakdown', bdCardTranscript: 'Transcript', bdCardStoryboard: 'Rewritten storyboard',
    bdCardShotScript: 'Shot script', bdCardRule: 'Rewrite rule used',
    bdSegmentUnit: ' segments', bdSectionPending: 'Not generated yet', bdDetailEmpty: 'No breakdown content yet',
    bdShotQuotas: 'Shot-size quotas', bdRuleNone: 'No rewrite rule was used (default pipeline)',
    bdBackToList: '← Back to list', bdRewriteButton: 'Rewrite',
    bdRewriteTitle: 'Rewrite this video', bdRewriteHint: 'Picking a rule regenerates the storyboard and shot script as a new rule version; the original breakdown is kept.',
    bdRewriteStart: 'Start rewrite', bdRunningHint: 'Breakdown in progress — this page refreshes automatically…',
    bdErrorInvalidKey: 'Invalid request — refresh and retry', bdErrorRunNotFound: 'Task not found or expired — start again',
    bdErrorUnknownRule: 'The selected rewrite rule does not exist or is retired — refresh the rule list', bdErrorConflict: 'The request conflicts with a previous one — refresh and retry',
    bdErrorCandidateNotFound: 'The original video record is missing — start the breakdown again', bdErrorInvalidInput: 'Invalid request — check the input and retry',
    bdErrorNeedsInput: 'This video lacks required information and cannot be broken down', bdErrorRetryable: 'Breakdown failed temporarily (video may be too long or the service busy) — retry later',
    bdErrorFailed: 'Breakdown failed — start again', bdErrorArchiveFailed: 'Video download or archive failed — check the link and retry',
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
  // 采集运行结果里的会话失效 reason（runner session_expired）：专属文案，不是普通失败。
  session_invalid: 'collectSessionExpired',
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
            // 搜索词只显示关键词文本（UI 优化方案 v2 §6.1）：接口的 percent 继续入库
            // 与导出，客户端详情不读取也不拼接百分比。
            h('div', { className: 'ydo-tags' },
              ...(work && Array.isArray(work.search_keywords) && work.search_keywords.length
                ? work.search_keywords.map(item => h('span', { className: 'ydo-tag', key: item.keyword }, item.keyword))
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

// 爆款详情抽屉宿主（§4 右侧浮层）：数据用 hotWorks 行内字段，不重复请求；
// "查看完整作品分析"由父层复用现有作品详情（work.get），不新增 MCP 工具。
function WorkDrawerHost({ work, onClose, onOpenFull, t }) {
  return h(WorkDrawerContainer, { work, detail: null, detailLoading: false, onClose, onOpenFull, t })
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
  // 账号总览 Tab（0914 方案阶段 1）：Tab 状态、总览数据、筛选与抽屉。
  const [tab, setTab] = useState('overview')
  const [overview, setOverview] = useState(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState(null)
  // 总览筛选存 UI 形态（window/sort/accountIds + 自定义范围 customFrom/customTo）：
  // 自定义范围初值 = 截止今天、开始往前推一个自然月（defaultCustomRange），切到
  // 「自定义」直接使用；请求字段（publishFrom/publishTo）统一在发请求时经
  // buildOverviewFilters 归一派生（自定义截止含当天 → 服务端排他终点 = 截止+1；
  // UI 优化方案 §4.1；验收建议 2——筛选不残留跨窗口的日期）。
  const [overviewFilters, setOverviewFilters] = useState(() => ({
    window: '30d', sort: 'hot_count', accountIds: [], ...defaultCustomRange(),
  }))
  // 请求序列号（验收 P1 竞态防护）：快速切换筛选/账号时只接受最新一次请求的结果，
  // 过期响应的数据、错误与 loading 复位一律丢弃。
  const overviewRequestRef = useRef(0)
  // 「切到自定义」跳过一次筛选联动查询的标记（用户反馈 2026-09-21）：由
  // changeOverviewFilters 置位、查询 effect 消费复位，仅此一处语义。
  const skipOverviewQueryRef = useRef(false)
  const analysisRequestRef = useRef(0)
  const [overviewExporting, setOverviewExporting] = useState(false)
  const [hotDrawerWork, setHotDrawerWork] = useState(null)
  // 单账号分析页（阶段 2）：accountId 非空时总览 Tab 内容切换为分析页。
  const [analysisAccountId, setAnalysisAccountId] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)
  const [accountTrend, setAccountTrend] = useState(null)
  const [trendError, setTrendError] = useState(null)
  const [trendMetric, setTrendMetric] = useState('play')
  const [analysisExporting, setAnalysisExporting] = useState(false)
  // AI 账号表现分析（0916 方案 §9）：aiAnalysis 是 get 的 analysis 投影；
  // aiBusy 只约束「受理」按钮（分析中禁用），轮询期间不阻塞其他只读指标浏览。
  const [aiAnalysis, setAiAnalysis] = useState(null)
  // aiStatus 是外层运行态（服务端 get 取最新一条记录）：重跑期间=running、
  // 失败/数据不足对状态行可见；aiAnalysis 正文取当前结果（旧结果保留展示）。
  const [aiStatus, setAiStatus] = useState('not_analyzed')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState(null)
  const [aiConfirming, setAiConfirming] = useState(false)
  // AI 分析弹框开关（需求 2）：由 client.js 持有以接入统一 Esc 链；
  // 弹框内容与原内嵌 AI 卡一致，AI 轮询不随弹框开关停止。
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const loginPollRef = useRef(null)
  const collectPollRef = useRef(null)
  const aiPollRef = useRef(null)
  // 当前分析页账号（轮询/预取响应的归属守卫，防止切账号后旧响应覆盖新页面）
  const aiAccountRef = useRef(null)
  // 爆款拆解 Tab（0922 方案 §4）：主视图（新建+历史）与详情页共用一组状态。
  // bdDetailWorkflow 非空 = 详情页（轮询目标，含 workflowId）；空 = 主视图。
  const [bdRules, setBdRules] = useState([])
  const [bdRulesError, setBdRulesError] = useState(null)
  const [bdHistory, setBdHistory] = useState([])
  const [bdHistoryLoading, setBdHistoryLoading] = useState(false)
  const [bdHistoryError, setBdHistoryError] = useState(null)
  const [bdSubmitting, setBdSubmitting] = useState(false)
  // 主视图「新建拆解」的提交/归档失败文案（与详情页错误独立）。
  const [bdStartError, setBdStartError] = useState(null)
  // bdArchiveTask = 归档过渡态（archiveStart 回执）；轮询 completed 后清除。
  const [bdArchiveTask, setBdArchiveTask] = useState(null)
  const [bdDetailWorkflow, setBdDetailWorkflow] = useState(null)
  const [bdDetail, setBdDetail] = useState(null)
  const [bdDetailLoading, setBdDetailLoading] = useState(false)
  const [bdDetailError, setBdDetailError] = useState(null)
  const [bdRewriteOpen, setBdRewriteOpen] = useState(false)
  const [bdRewriting, setBdRewriting] = useState(false)
  const bdArchivePollRef = useRef(null)
  const bdWorkflowPollRef = useRef(null)
  // 详情请求序列号（与 overviewRequestRef 同法）：快速点不同历史行时旧响应丢弃。
  const bdDetailRequestRef = useRef(0)
  // 归档/workflow 轮询的归属守卫：响应与当前目标不符时丢弃（防串台）。
  const bdArchiveRunRef = useRef(null)
  const bdWorkflowIdRef = useRef(null)
  // 归档完成时用户若已进入其他详情页，自动启动的 workflow 挂起于此，
  // 返回列表时补启动（防顶页，也防新候选的拆解静默丢失）。
  const bdPendingWorkflowRef = useRef(null)
  // bdDetailWorkflow 的 latest 镜像：归档轮询回调是长存 interval 闭包，直接读
  // state 会拿到创建时刻的旧值，经 ref 读最新值判断用户是否已进入详情页。
  // 写入侧在 setState 处同步维护（消除 setState→effect flush 之间的竞态窗口），
  // useEffect 仅作兜底同步。
  const bdDetailWorkflowRef = useRef(null)
  useEffect(() => {
    bdDetailWorkflowRef.current = bdDetailWorkflow
  }, [bdDetailWorkflow])

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
    // 统一的生命周期契约：Esc 先关子页面（作品详情 → 爆款抽屉 → AI 分析弹框 →
    // 重新改写弹框），再关 overlay；关闭后焦点回到触发按钮。hotDrawerWork/
    // aiModalOpen/bdRewriteOpen 必须在依赖里，否则闭包捕获旧值、Esc 会跳过弹层
    // 直接关掉整个 overlay（审查修复补充）。
    const onKey = event => {
      if (event.key === 'Escape') {
        if (detailWorkId) setDetailWorkId(null)
        else if (hotDrawerWork) setHotDrawerWork(null)
        else if (aiModalOpen) setAiModalOpen(false)
        else if (bdRewriteOpen) setBdRewriteOpen(false)
        else closeOverlay()
      }
    }
    document.addEventListener('keydown', onKey)
    shellRef.current?.focus?.()
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, detailWorkId, hotDrawerWork, aiModalOpen, bdRewriteOpen])

  const stopPolling = useCallback(ref => {
    if (ref.current) { clearInterval(ref.current); ref.current = null }
  }, [])

  useEffect(() => () => {
    stopPolling(loginPollRef)
    stopPolling(collectPollRef)
    stopPolling(aiPollRef)
    stopPolling(bdArchivePollRef)
    stopPolling(bdWorkflowPollRef)
  }, [stopPolling])

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
        if (result.collect.status === 'completed') {
          await loadWorks(accountId).catch(() => {})
          // 总览 Tab 正在展示时同步刷新（只读查询，不触发采集）。
          if (tab === 'overview') loadOverview().catch(() => {})
        }
        // 会话失效（status_code=8）给专属文案指引重新扫码，其余失败给通用文案。
        else setError(result.collect.error === 'session_invalid' ? 'collectSessionExpired' : 'collectFailed')
        await refresh().catch(() => {})
      }, COLLECT_POLL_INTERVAL_MS)
    } catch {
      setError('collectFailed')
      setBusy(false)
    }
  }, [loadWorks, refresh, stopPolling])

  const loadOverview = useCallback(async (filters = overviewFilters) => {
    const requestId = ++overviewRequestRef.current
    setOverviewLoading(true)
    setOverviewError(null)
    try {
      // UI 形态 → 请求形态在此单点归一（window=all 不带日期，近 N 天带排他终点）。
      const result = await post({ action: 'overview.get', ...buildOverviewFilters(filters) })
      if (requestId !== overviewRequestRef.current) return
      if (result.status === 'ready') setOverview(result.overview || null)
      // 失败收敛为稳定 reason（overview-ui 的 ERROR_REASON_COPY 映射文案），绝不置 0。
      else setOverviewError(result.reason || 'douyin_operation_request_failed')
    } catch {
      if (requestId !== overviewRequestRef.current) return
      setOverviewError('douyin_operation_request_failed')
    } finally {
      // loading 只由最新一次请求复位，避免旧请求提前结束新请求的加载态。
      if (requestId === overviewRequestRef.current) setOverviewLoading(false)
    }
  }, [overviewFilters])

  useEffect(() => {
    if (!visible || tab !== 'overview') return undefined
    // 切到「自定义」的那一次筛选变更不触发查询（用户反馈 2026-09-21）：选中
    // 「自定义」只是展开日期范围 UI，默认范围与刚离开的预设窗口几乎重合，此刻
    // 的查询是噪音；真正的查询由随后任一日期框变更（或显式刷新/导出）发起。
    // 标记只消费一次，不影响其他筛选变更与 Tab 重入的常规查询。
    if (skipOverviewQueryRef.current) {
      skipOverviewQueryRef.current = false
      return undefined
    }
    loadOverview().catch(() => setOverviewError('douyin_operation_request_failed'))
    return undefined
  }, [visible, tab, loadOverview])

  // 爆款拆解 Tab 进入：拉规则清单（纯配置只读）与拆解历史（团队共享，只读）。
  useEffect(() => {
    if (!visible || tab !== 'breakdown') return undefined
    loadBdRules().catch(() => {})
    loadBdHistory().catch(() => {})
    return undefined
  }, [visible, tab, loadBdRules, loadBdHistory])

  const exportOverview = useCallback(async () => {
    setOverviewExporting(true)
    try {
      const result = await post({ action: 'overview.export', ...buildOverviewFilters(overviewFilters) })
      if (result.status !== 'ready') {
        setError(ERROR_REASON_COPY[result.reason] || 'exportFailed')
        return
      }
      downloadWorkbook(result)
    } catch {
      setError('exportFailed')
    } finally {
      setOverviewExporting(false)
    }
  }, [overviewFilters])

  const changeOverviewFilters = useCallback(filters => {
    // 筛选即查询（只读刷新，不触发任何采集）：setOverviewFilters 改变 loadOverview
    // 身份 → 上方 [visible, tab, loadOverview] effect 恰好发起一次查询；
    // 不在此显式调用 loadOverview，避免同一条件重复请求（验收建议 3）。
    // 例外：从预设窗口切到「自定义」且日期仍是切走前的值 → 打一次跳过标记
    //（effect 消费；日期改动/刷新/导出走各自入口，不受影响）。
    skipOverviewQueryRef.current = overviewFilters.window !== 'custom'
      && filters.window === 'custom'
      && overviewFilters.customFrom === filters.customFrom
      && overviewFilters.customTo === filters.customTo
    setOverviewFilters(filters)
  }, [overviewFilters])

  const loadAnalysis = useCallback(async (accountId, metric = trendMetric) => {
    if (!accountId) return
    // 序列号守卫（验收 P1）：analysis 与 trend 属同一次下钻，共用一个 requestId；
    // 快速切换账号/趋势指标时旧响应的数据、错误与 loading 复位一律丢弃。
    const requestId = ++analysisRequestRef.current
    setAnalysisLoading(true)
    setAnalysisError(null)
    try {
      // 分析页沿用总览当前发布窗口（UI 形态 → 请求形态归一）。
      const { publishFrom, publishTo } = buildOverviewFilters(overviewFilters)
      const result = await post({
        action: 'account.analysis', accountId, publishFrom, publishTo,
      })
      if (requestId !== analysisRequestRef.current) return
      if (result.status !== 'ready') {
        setAnalysisError(result.reason || 'douyin_operation_request_failed')
        return
      }
      setAnalysis(result.analysis || null)
      // 趋势窗口固定最近 30 个自然日：toDay=今天、fromDay=今天-29
      //（服务端半开区间，toDay 晚于今天会被 clamp；横轴按自然日定位，缺口不补零）。
      const pad = value => String(value).padStart(2, '0')
      const today = new Date()
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)
      const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      const trendResult = await post({
        action: 'account.trend', accountId,
        metric: TREND_METRICS.includes(metric) ? metric : 'play',
        fromDay: iso(from), toDay: iso(today),
      })
      if (requestId !== analysisRequestRef.current) return
      if (trendResult.status !== 'ready') {
        // 趋势业务错误（契约版本不匹配/跨度超限等）显式呈现，绝不吞成"暂无趋势"
        //（审查 S12；ANALYSIS_ERROR_REASON_COPY 已登记对应文案键）。
        setTrendError(trendResult.reason || 'douyin_operation_request_failed')
        setAccountTrend(null)
        return
      }
      setTrendError(null)
      setAccountTrend(trendResult.trend || null)
    } catch {
      if (requestId !== analysisRequestRef.current) return
      setAnalysisError('douyin_operation_request_failed')
    } finally {
      if (requestId === analysisRequestRef.current) setAnalysisLoading(false)
    }
  }, [overviewFilters, trendMetric])

  const exportAnalysis = useCallback(async () => {
    if (!analysisAccountId) return
    setAnalysisExporting(true)
    try {
      const { publishFrom, publishTo } = buildOverviewFilters(overviewFilters)
      const result = await post({
        action: 'accountAnalysis.export', accountId: analysisAccountId, publishFrom, publishTo,
      })
      if (result.status !== 'ready') {
        setError(ANALYSIS_ERROR_REASON_COPY[result.reason] || 'exportFailed')
        return
      }
      downloadWorkbook(result)
    } catch {
      setError('exportFailed')
    } finally {
      setAnalysisExporting(false)
    }
  }, [analysisAccountId, overviewFilters])

  // ---------------------------------------------------------------------------
  // AI 账号表现分析（0916 方案 §9.3）：受理 + 轮询 + 二次确认。
  // 切换页面/Tab 不自动重新调用模型：进入分析页只 get 一次现状（只读），
  // 只有用户点「分析/重新分析」才 start；轮询仅在接受受理后进行。
  // ---------------------------------------------------------------------------

  const stopAiPolling = useCallback(() => stopPolling(aiPollRef), [stopPolling])

  const loadAiAnalysis = useCallback(async (accountId, { silent = false } = {}) => {
    if (!accountId) return null
    let payload = null
    try {
      const result = await post({ action: 'aiAnalysis.get', accountId })
      // 归属守卫：响应回来时若已切走账号（或离开分析页），丢弃不覆盖新页面
      if (aiAccountRef.current !== accountId) return null
      if (result.status !== 'ready') {
        setAiError(result.reason || 'douyin_operation_request_failed')
        return null
      }
      payload = { aiStatus: result.aiStatus || 'not_analyzed', analysis: result.analysis || null }
      setAiAnalysis(payload.analysis)
      setAiStatus(payload.aiStatus)
      setAiError(null)
    } catch {
      // 轮询中的单次网络失败不刷整体错误（silent），由轮询计数兜底收敛
      if (!silent && aiAccountRef.current === accountId) {
        setAiError('douyin_operation_request_failed')
      }
    }
    return payload
  }, [])

  const startAiAnalysis = useCallback(async accountId => {
    if (!accountId || aiBusy) return
    stopAiPolling()
    aiAccountRef.current = accountId
    setAiBusy(true)
    setAiError(null)
    try {
      // 受理（幂等受理响应可能是 running+pending，服务端 after_commit 投递）。
      const result = await post({
        action: 'aiAnalysis.start',
        accountId,
        idempotencyKey: aiAnalysisIdempotencyKey(),
      })
      if (result.status !== 'ready') {
        setAiError(result.reason || 'douyin_operation_request_failed')
        return
      }
      // 重跑场景：正文仍是旧 current，轮询判断必须看外层运行态 aiStatus（§9.3.2）。
      const payload = await loadAiAnalysis(accountId)
      if (payload && payload.aiStatus === 'running') {
        const interval = Math.max(1, Number(payload.pollIntervalSeconds) || 3) * 1000
        stopPolling(aiPollRef)
        let failures = 0
        aiPollRef.current = setInterval(() => {
          loadAiAnalysis(accountId, { silent: true }).then(latest => {
            if (!latest) {
              // 网络失败静默重试；连续 5 次失败停轮询并给出错误提示
              failures += 1
              if (failures >= 5) {
                stopAiPolling()
                setAiError('douyin_operation_request_failed')
              }
              return
            }
            failures = 0
            if (latest.aiStatus !== 'running') stopAiPolling()
          }).catch(() => {})
        }, interval)
      }
    } catch {
      setAiError('douyin_operation_request_failed')
    } finally {
      setAiBusy(false)
    }
  }, [aiBusy, loadAiAnalysis, stopAiPolling, stopPolling])

  // 重新分析二次确认（§9.3.4）：确认后以全新幂等键受理（绕过缓存直接重跑）。
  const confirmAiRerun = useCallback(() => {
    setAiConfirming(false)
    startAiAnalysis(analysisAccountId)
  }, [analysisAccountId, startAiAnalysis])

  // ---------------------------------------------------------------------------
  // 爆款拆解（0922 方案 §4.2/§5）：归档受理 → 3s 轮询 → 自动 workflow 受理 →
  // 5s（或 retryAfterSeconds）轮询 → 详情双源拉取。轮询都带归属守卫（runId/
  // workflowId 不匹配的响应丢弃）与离开清理；错误一律收敛为
  // BREAKDOWN_ERROR_REASON_COPY 登记的文案键，未登记码兜底 operationUnavailable。
  // 注意 workflow_start 的规则错误（unknown_rewrite_rule 等）是「成功 envelope 内」
  // 的 failed payload，不是 isError：走 result.workflow.status==='failed' 分支，
  // 详情页按 WORKFLOW_ERROR_COPY（组件内）显示失败文案。
  // ---------------------------------------------------------------------------

  const bdErrorKey = useCallback(reason => BREAKDOWN_ERROR_REASON_COPY[reason] || 'operationUnavailable', [])

  const loadBdRules = useCallback(async () => {
    try {
      const result = await post({ action: 'breakdown.rewriteRules' })
      if (result.status !== 'ready') { setBdRulesError(bdErrorKey(result.reason)); return }
      setBdRules(Array.isArray(result.rules) ? result.rules : [])
      setBdRulesError(null)
    } catch {
      setBdRulesError('operationUnavailable')
    }
  }, [bdErrorKey])

  const loadBdHistory = useCallback(async () => {
    setBdHistoryLoading(true)
    setBdHistoryError(null)
    try {
      // 服务端无游标，total 是本页计数；首屏 limit=20，方案 §4.2 不做「加载更多」。
      const result = await post({ action: 'breakdown.history', limit: 20 })
      if (result.status !== 'ready') { setBdHistoryError(bdErrorKey(result.reason)); return }
      setBdHistory(Array.isArray(result.history) ? result.history : [])
    } catch {
      setBdHistoryError('operationUnavailable')
    } finally {
      setBdHistoryLoading(false)
    }
  }, [bdErrorKey])

  const loadBdDetail = useCallback(async candidateId => {
    // 序列号守卫：快速点不同历史行时，旧候选的明细响应整体丢弃。
    const requestId = ++bdDetailRequestRef.current
    setBdDetailLoading(true)
    setBdDetailError(null)
    try {
      const result = await post({ action: 'breakdown.detail', candidateId })
      if (requestId !== bdDetailRequestRef.current) return
      if (result.status !== 'ready') {
        setBdDetail(null)
        setBdDetailError(bdErrorKey(result.reason))
        return
      }
      setBdDetail({ storyboards: Array.isArray(result.storyboards) ? result.storyboards : [], analysis: result.analysis || null })
    } catch {
      if (requestId !== bdDetailRequestRef.current) return
      setBdDetailError('operationUnavailable')
    } finally {
      if (requestId === bdDetailRequestRef.current) setBdDetailLoading(false)
    }
  }, [bdErrorKey])

  const stopBdWorkflowPolling = useCallback(() => stopPolling(bdWorkflowPollRef), [stopPolling])

  // 详情页 workflow 轮询：优先 workflowId 精确定位（R2 约定——同候选多规则版本
  // 并存时 candidateId 的「最新一条」不保证是本次受理目标）。workflowStart 回执
  // 顶层带 workflowId；历史列表投影顶层不带（只在 admin.workflowId，服务端投影
  // 刻意裁剪），所以锚点两处都取，取不到就不启动轮询（详情保留进入时快照）。
  // 终态停轮询，succeeded 再拉双源明细；间隔优先后端 retryAfterSeconds，变化时
  // 重启 interval。连续失败达上限停轮询：分钟级长轮询若服务端/链路持续不可用，
  // 静默空转只会白白打请求；进度冻结用户可返回列表重进恢复。归档轮询不加此
  // 上限——窗口只有归档耗时十几秒且用户在主视图等待，误导性报错弊大于利。
  const startBdWorkflowPolling = useCallback(target => {
    const workflowId = target.workflowId || target.admin?.workflowId
    if (!workflowId) return
    stopPolling(bdWorkflowPollRef)
    bdWorkflowIdRef.current = workflowId
    let interval = Math.max(BD_WORKFLOW_POLL_INTERVAL_MS, (Number(target.retryAfterSeconds) || 0) * 1000)
    let failures = 0
    const tick = async () => {
      try {
        const result = await post({ action: 'breakdown.workflowStatus', workflowId })
        if (bdWorkflowIdRef.current !== workflowId) return
        if (result.status !== 'ready') {
          failures += 1
          if (failures >= BD_WORKFLOW_POLL_MAX_FAILURES) stopBdWorkflowPolling()
          return // 单次失败静默，下个周期重试
        }
        failures = 0
        const latest = Array.isArray(result.workflows) ? result.workflows[0] : null
        if (!latest) return
        setBdDetailWorkflow(latest)
        const next = Math.max(BD_WORKFLOW_POLL_INTERVAL_MS, (Number(latest.retryAfterSeconds) || 0) * 1000)
        if (next !== interval && bdWorkflowPollRef.current) {
          clearInterval(bdWorkflowPollRef.current)
          interval = next
          bdWorkflowPollRef.current = setInterval(tick, interval)
        }
        if (latest.status === 'succeeded' || latest.status === 'failed' || latest.status === 'cancelled') {
          stopBdWorkflowPolling()
          bdWorkflowIdRef.current = null
          if (latest.status === 'succeeded') loadBdDetail(latest.candidateId)
        }
      } catch {
        // 单次网络失败静默，下个周期重试（与 AI 轮询同策略；拆解是分钟级任务，
        // 短暂网络抖动不构成整体失败）；连续失败由 failures 上限终止。
        failures += 1
        if (failures >= BD_WORKFLOW_POLL_MAX_FAILURES) stopBdWorkflowPolling()
      }
    }
    bdWorkflowPollRef.current = setInterval(tick, interval)
  }, [loadBdDetail, stopBdWorkflowPolling, stopPolling])

  // workflow 受理：succeeded（幂等重放/秒回）直接拉明细；运行态白名单
  // （queued/running/waiting）启动轮询；failed / needs_input / invalid_input /
  // idempotency_conflict 是同步失败 payload（无 workflowId），交详情页失败文案，
  // 不进轮询。
  const startBdWorkflow = useCallback(async (candidateId, rewriteRuleId) => {
    setBdDetail(null)
    setBdDetailError(null)
    try {
      const body = { action: 'breakdown.workflowStart', candidateId, idempotencyKey: bdWorkflowIdempotencyKey() }
      if (rewriteRuleId) body.rewriteRuleId = rewriteRuleId
      const result = await post(body)
      if (result.status !== 'ready') {
        setBdDetailError(bdErrorKey(result.reason))
        return
      }
      const workflow = result.workflow || null
      setBdDetailWorkflow(workflow)
      bdDetailWorkflowRef.current = workflow
      if (!workflow) return
      if (workflow.status === 'succeeded') loadBdDetail(workflow.candidateId)
      else if (['queued', 'running', 'waiting'].includes(workflow.status)) startBdWorkflowPolling(workflow)
    } catch {
      setBdDetailError('operationUnavailable')
    }
  }, [bdErrorKey, loadBdDetail, startBdWorkflowPolling])

  // 主视图受理：归档 → 轮询 completed → 刷新历史 → 自动以（可选）所选规则发起
  // 拆解工作流。归档失败统一给「下载或归档失败」文案（失败码集合不稳定，不逐一映射）。
  const startBreakdown = useCallback(async (shareUrl, rewriteRuleId) => {
    if (bdSubmitting) return
    setBdSubmitting(true)
    setBdStartError(null)
    try {
      const result = await post({
        action: 'breakdown.archiveStart',
        shareUrl,
        idempotencyKey: bdArchiveIdempotencyKey(),
      })
      if (result.status !== 'ready') {
        setBdStartError(bdErrorKey(result.reason))
        return
      }
      const archive = result.archive || null
      if (!archive || !archive.runId) {
        setBdStartError('operationUnavailable')
        return
      }
      setBdArchiveTask(archive)
      bdArchiveRunRef.current = archive.runId
      stopPolling(bdArchivePollRef)
      bdArchivePollRef.current = setInterval(async () => {
        try {
          const poll = await post({ action: 'breakdown.archiveStatus', runId: bdArchiveRunRef.current })
          if (bdArchiveRunRef.current !== archive.runId) return
          if (poll.status !== 'ready') return
          const latest = poll.archive || null
          if (!latest) return
          if (latest.runStatus === 'completed') {
            stopPolling(bdArchivePollRef)
            bdArchiveRunRef.current = null
            setBdArchiveTask(null)
            loadBdHistory().catch(() => {})
            const candidateId = latest.result && latest.result.candidateId
            if (candidateId && bdDetailWorkflowRef.current) {
              // 用户已在查看其他详情页：不顶页，挂起自动启动，返回列表时补启动。
              bdPendingWorkflowRef.current = { candidateId, rewriteRuleId }
            } else if (candidateId) {
              startBdWorkflow(candidateId, rewriteRuleId)
            } else {
              setBdStartError('bdErrorArchiveFailed')
            }
          } else if (latest.runStatus === 'failed' || latest.runStatus === 'cancelled' || latest.runStatus === 'partial_failed') {
            stopPolling(bdArchivePollRef)
            bdArchiveRunRef.current = null
            setBdArchiveTask(null)
            setBdStartError('bdErrorArchiveFailed')
          }
        } catch {
          // 归档轮询单次失败静默：任务本身仍在服务端推进，下个周期重试。
        }
      }, BD_ARCHIVE_POLL_INTERVAL_MS)
    } catch {
      setBdStartError('operationUnavailable')
    } finally {
      setBdSubmitting(false)
    }
  }, [bdErrorKey, bdSubmitting, loadBdHistory, startBdWorkflow, stopPolling])

  // 历史行进入详情：立即拉明细；仍在运行态的记录同时启动 workflow 轮询。
  const openBdDetail = useCallback(workflow => {
    if (!workflow || !workflow.candidateId) return
    setBdDetail(null)
    setBdDetailError(null)
    setBdDetailWorkflow(workflow)
    bdDetailWorkflowRef.current = workflow
    loadBdDetail(workflow.candidateId)
    if (breakdownStatusTone(workflow.status) === 'running') startBdWorkflowPolling(workflow)
  }, [loadBdDetail, startBdWorkflowPolling])

  // 返回列表：停全部拆解轮询、失效在途明细请求、复位详情态并刷新历史。
  // 若归档完成时因本详情页挂起了新候选的自动启动，此处补启动（进入新拆解详情，
  // 与归档完成即自动开始的主流程体验一致）。
  const backToBdList = useCallback(() => {
    stopPolling(bdWorkflowPollRef)
    bdWorkflowIdRef.current = null
    stopPolling(bdArchivePollRef)
    bdArchiveRunRef.current = null
    bdDetailRequestRef.current += 1
    const pending = bdPendingWorkflowRef.current
    bdPendingWorkflowRef.current = null
    setBdArchiveTask(null)
    setBdDetailWorkflow(null)
    bdDetailWorkflowRef.current = null
    setBdDetail(null)
    setBdDetailError(null)
    setBdRewriteOpen(false)
    loadBdHistory().catch(() => {})
    if (pending && pending.candidateId) startBdWorkflow(pending.candidateId, pending.rewriteRuleId)
  }, [loadBdHistory, startBdWorkflow, stopPolling])

  // 重新改写确认（弹框回调）：以选中规则（可为 null = 默认链路）发起新 workflow；
  // 每次点击新幂等键，新规则版本 = 新记录，原拆解保留。
  const confirmBdRewrite = useCallback(ruleId => {
    setBdRewriteOpen(false)
    const candidateId = bdDetailWorkflow && bdDetailWorkflow.candidateId
    if (!candidateId) return
    setBdRewriting(true)
    Promise.resolve(startBdWorkflow(candidateId, ruleId)).finally(() => setBdRewriting(false))
  }, [bdDetailWorkflow, startBdWorkflow])

  const openDetail = useCallback(async (workId, accountIdOverride = null) => {
    // 跨账号爆款下钻用作品所属账号（审查 O4），默认仍是当前选中账号。
    const targetAccount = accountIdOverride || selected
    setDetailWorkId(workId)
    setDetail(null)
    setTrend(null)
    try {
      const [detailResult, trendResult] = await Promise.all([
        post({ action: 'work.get', accountId: targetAccount, workId }),
        post({ action: 'work.trend', accountId: targetAccount, workId }).catch(() => null),
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
  // 会话失效的 run 横幅同样走专属文案（0914 方案 §3.6）：绝不显示"采集完成"。
  const runBanner = runStatus === 'failed'
    ? h('p', { className: 'ydo-error', role: 'alert' },
      t(collect && collect.error === 'session_invalid' ? 'collectSessionExpired' : 'collectFailed'))
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
        h('button', { type: 'button', 'aria-current': tab === 'overview' || undefined, onClick: () => setTab('overview') }, t('tabOverview')),
        h('button', {
          type: 'button', 'aria-current': tab === 'videos' || undefined,
          // 分析页随 overview Tab 渲染（review P2-1）：切走时清 AI 弹框开关，
          // 避免切回总览时弹框「自动重开」与本 Tab 下 Esc 空按。
          onClick: () => { setTab('videos'); setAiModalOpen(false) },
        }, t('tabVideos')),
        h('button', {
          type: 'button', 'aria-current': tab === 'breakdown' || undefined,
          // 进入拆解 Tab 同样收起 AI 弹框（跨 Tab 不残留弹层）；拆解轮询不随
          // Tab 切换停止——服务端任务继续推进，切回 Tab 仍能看到最新进度。
          onClick: () => { setTab('breakdown'); setAiModalOpen(false) },
        }, t('tabBreakdown'))),
      // 左侧账号管理栏只在「视频数据」Tab 显示（UI 优化方案 §3.1）；
      // 账号总览/单账号分析与爆款拆解使用完整宽度内容区（ydo-body-full 单列）。
      h('div', { className: `ydo-body${tab === 'overview' || tab === 'breakdown' ? ' ydo-body-full' : ''}` },
        tab === 'videos' ? left : null,
        tab === 'overview' && analysisAccountId
          ? h('section', { className: 'ydo-right', 'aria-label': t('accountHotWorks') },
            h(AnalysisPage, {
              analysis,
              trend: accountTrend,
              trendMetric,
              trendErrorReason: trendError,
              loading: analysisLoading,
              errorReason: analysisError,
              exporting: analysisExporting,
              // 作品数范围文案与总览 KPI 同源（overviewRangeLabel 统一口径标识）。
              rangeLabel: overviewRangeLabel(overviewFilters, t),
              onBack: () => {
                // 返回总览保留筛选条件（方案 §15.2）；离开分析页停 AI 轮询与归属。
                stopAiPolling()
                aiAccountRef.current = null
                setAiModalOpen(false)
                setAnalysisAccountId(null)
                loadOverview().catch(() => {})
              },
              onMetricChange: metric => {
                setTrendMetric(metric)
                loadAnalysis(analysisAccountId, metric)
              },
              onExport: exportAnalysis,
              aiAnalysis,
              aiStatus,
              aiBusy,
              aiError,
              aiConfirming,
              onAiStart: () => startAiAnalysis(analysisAccountId),
              onAiRequestRerun: () => setAiConfirming(true),
              onAiConfirmRerun: confirmAiRerun,
              onAiCancelConfirm: () => setAiConfirming(false),
              aiModalOpen,
              onAiModalOpen: () => setAiModalOpen(true),
              onAiModalClose: () => setAiModalOpen(false),
              // 弹框内点证据作品（需求 2 确认稿）：保留分析页与 AI 轮询，仅叠加
              // 作品详情层（Esc/关闭详情后回到分析页 + 弹框）。AI 证据 chip 的
              // work 只有 {workId,title}（review P1 2026-09-20），爆款表行才有
              // accountId；分析页是单账号页，回退 analysisAccountId，不依赖
              // 视频 Tab 的 selected（与本批状态解耦一致）。
              onOpenWork: work =>
                openDetail(work.workId, work.accountId || analysisAccountId),
              t,
            }))
          : tab === 'overview'
          ? h('section', { className: 'ydo-right', 'aria-label': t('tabOverview') },
            h(OverviewPage, {
              overview,
              loading: overviewLoading,
              errorReason: overviewError,
              filters: overviewFilters,
              accounts,
              collecting: Boolean(collect && collect.status === 'running'),
              exporting: overviewExporting,
              onFilterChange: changeOverviewFilters,
              onRefresh: () => loadOverview().catch(() => setOverviewError('douyin_operation_request_failed')),
              onExport: exportOverview,
              onOpenWork: work => setHotDrawerWork(work),
              // 账号行下钻：阶段 2 打开单账号分析页；阶段 1 先切到视频数据 Tab 并选中该账号。
              // 账号行下钻：打开单账号分析页并携带当前筛选（方案 §15.2）。
              onOpenAccount: accountId => {
                // 不再 setSelected（用户反馈 2026-09-20 bug 3）：总览聚合账号
                // （如矩阵内未本地登录的账号）一旦写进 selected，切到视频数据 Tab
                // 会出现「列表无高亮 + loadWorks 拉取非选中账号作品」的错位。
                // 视频数据 Tab 的选中态（selected）与单账号分析页（analysisAccountId）
                // 各自独立；分析页内作品/爆款抽屉下钻均显式携带 accountId，不依赖 selected。
                setAnalysisAccountId(accountId)
                loadAnalysis(accountId)
                // 切账号：停掉上一账号的 AI 轮询、清投影，再做只读预取
                //（§9.1 有结果默认展开；get 不触发模型）。
                stopAiPolling()
                aiAccountRef.current = accountId
                setAiAnalysis(null)
                setAiStatus('not_analyzed')
                setAiError(null)
                setAiModalOpen(false)
                loadAiAnalysis(accountId).catch(() => {})
              },
              // 无账号空态的"添加账号"入口：复用左栏既有扫码登录链路。
              onAddAccount: () => beginLogin(null),
              t,
            }),
            hotDrawerWork
              ? h(WorkDrawerHost, {
                work: hotDrawerWork,
                onClose: () => setHotDrawerWork(null),
                // 跨账号爆款：用作品所属账号查询详情（审查 O4）。
                onOpenFull: work => {
                  setHotDrawerWork(null)
                  openDetail(work.workId, work.accountId)
                },
                t,
              })
              : null)
          : tab === 'breakdown'
          ? h('section', { className: 'ydo-right ydo-bd-body', 'aria-label': t('tabBreakdown') },
            bdDetailWorkflow
              ? h(BreakdownDetailPage, {
                workflow: bdDetailWorkflow,
                detail: bdDetail,
                loading: bdDetailLoading,
                errorReason: bdDetailError,
                onBack: backToBdList,
                onRequestRewrite: () => setBdRewriteOpen(true),
                t,
              })
              : h('div', { className: 'ydo-bd-main' },
                h(BreakdownNewPage, {
                  rules: bdRules,
                  rulesError: bdRulesError,
                  onRetryRules: () => loadBdRules().catch(() => {}),
                  submitting: bdSubmitting,
                  archiveTask: bdArchiveTask,
                  startError: bdStartError,
                  onStart: startBreakdown,
                  t,
                }),
                h(BreakdownHistoryList, {
                  history: bdHistory,
                  loading: bdHistoryLoading,
                  errorReason: bdHistoryError,
                  onOpen: openBdDetail,
                  t,
                })))
          : h('section', { className: 'ydo-right', 'aria-label': t('data') },
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
            // 视频数据明细是账号全量作品（不随总览时间窗裁剪）：标签明确写「全部时间
            // 作品数」，不与总览「近 30 天作品数」并列为同名指标（UI 优化方案 v2 §3.2）。
            works.length ? h('span', { className: 'ydo-hint' }, `${t('workCountAllTime')} ${works.length}`) : null),
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
    // 重新改写弹框（0922 方案 §4.1）：overlay 级渲染，接入统一 Esc 链（bdRewriteOpen）。
    bdRewriteOpen
      ? h(BreakdownRewriteModal, {
        open: true,
        rules: bdRules,
        submitting: bdRewriting,
        onConfirm: confirmBdRewrite,
        onClose: () => setBdRewriteOpen(false),
        t,
      })
      : null,
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

const css = `.ydo-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.ydo-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.ydo-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.ydo-wide span{font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-overlay{position:fixed;inset:0;z-index:520;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.ydo-shell{display:grid;grid-template-rows:auto auto 1fr;width:100%;height:100%;overflow:hidden}.ydo-header{display:flex;min-height:72px;align-items:center;justify-content:space-between;gap:24px;padding:16px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-header h1{margin:0;font-size:var(--dsw-font-l-20-font-size,20px);line-height:1.25}.ydo-header p{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-header-buttons button{display:grid;width:36px;height:36px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.ydo-tabs{display:flex;gap:4px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-tabs button{height:44px;padding:0 18px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:650;cursor:pointer}.ydo-tabs button:hover{color:var(--dsw-alias-label-primary)}/* Tab 激活态（UI 优化方案 §3.1）：只有当前 Tab 有底部指示线，非当前 Tab 不显示下划线。 */
.ydo-tabs button[aria-current]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}.ydo-body{display:grid;grid-template-columns:280px 1fr;min-height:0;overflow:hidden}.ydo-body-full{grid-template-columns:1fr}.ydo-accounts{display:grid;align-content:start;gap:12px;padding:24px 20px;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto}.ydo-panel-title{margin:0;font-size:var(--dsw-font-base-16-font-size,16px)}.ydo-account-list{display:grid;gap:10px}.ydo-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.ydo-card-active{border-color:var(--dsw-alias-brand-primary)}.ydo-card-main{display:flex;align-items:center;gap:10px;width:100%;padding:12px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.ydo-card-text{display:grid;gap:2px;min-width:0;flex:1}.ydo-avatar{width:36px;height:36px;border-radius:8px;object-fit:cover;flex:none;background:var(--dsw-alias-bg-layer-2)}.ydo-avatar-fallback{display:grid;place-items:center;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size,14px);font-weight:600}.ydo-card-name{min-width:0;font-size:var(--dsh-content-font-size,14px);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-card-meta{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-card-actions{display:flex;justify-content:space-between;gap:8px;padding:0 12px 10px}.ydo-status{padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-size:var(--dsh-content-font-size-secondary,13px);flex:none}.ydo-status-ok{color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 50%,var(--dsw-alias-label-primary))}.ydo-status-expired{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary))}.ydo-link{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);cursor:pointer;padding:0}.ydo-link:hover{color:var(--dsw-alias-label-primary)}.ydo-link-danger:hover{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary))}.ydo-link:disabled{opacity:.5;cursor:default}.ydo-primary{min-height:40px;padding:0 16px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:600;cursor:pointer}.ydo-primary:disabled{opacity:.45;cursor:default}.ydo-secondary{min-height:36px;padding:0 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.ydo-secondary:disabled{opacity:.45;cursor:default}.ydo-export{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}/* 导出按钮文案不换行、导出中只换加载态文字不改布局（v2 §4.1）。 */.ydo-right{display:grid;grid-template-rows:auto auto auto 1fr;min-height:0;overflow:hidden;padding:20px 24px 24px;gap:12px}.ydo-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ydo-progress{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-table-wrap{overflow:auto;min-height:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}/* 列轨道由 tableTemplate(COLUMNS) 内联到表头与每行，这里不再写死一份（§11.2.3）。 */
.ydo-table{width:max-content;min-width:100%}.ydo-table-head,.ydo-table-row{display:grid;align-items:center}.ydo-table-head{position:sticky;top:0;z-index:3;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-sort{display:flex;width:100%;align-items:center;gap:4px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.ydo-sort-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-sort-arrow{flex:none;min-width:12px;color:var(--dsw-alias-label-secondary)}.ydo-sort-active{color:var(--dsw-alias-label-primary)}.ydo-sort-active .ydo-sort-arrow{color:var(--dsw-alias-brand-primary)}.ydo-cell{padding:8px 10px;font-size:var(--dsh-content-font-size-secondary,13px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ydo-cell-count,.ydo-cell-pct,.ydo-cell-seconds{text-align:right;font-variant-numeric:tabular-nums}.ydo-cell-sticky{position:sticky;z-index:2;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.ydo-table-head .ydo-cell-sticky{z-index:4;background:var(--dsw-alias-bg-layer-2)}.ydo-table-row{cursor:default;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-table-row:hover .ydo-cell{background:var(--dsw-alias-bg-layer-2)}.ydo-table-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.ydo-cell a{color:var(--dsw-alias-brand-primary);text-decoration:none}.ydo-cell a:hover{text-decoration:underline}.ydo-state{display:grid;min-height:200px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size,14px);text-align:center}.ydo-state p{margin:0;max-width:640px;line-height:1.6}.ydo-state-title{color:var(--dsw-alias-label-primary);font-size:var(--dsw-font-base-16-font-size,16px);font-weight:600}.ydo-state-error .ydo-state-title{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary))}.ydo-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}.ydo-error{margin:0;color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary));font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-warn{margin:0;color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 50%,var(--dsw-alias-label-primary));font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-ok{margin:0;color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 50%,var(--dsw-alias-label-primary));font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-spinner{width:16px;height:16px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:ydo-spin .8s linear infinite}@keyframes ydo-spin{to{transform:rotate(360deg)}}.ydo-modal-overlay{position:fixed;inset:0;z-index:540;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent)}.ydo-modal{width:min(1080px,calc(100vw - 48px));max-height:calc(100vh - 64px);display:grid;grid-template-rows:auto 1fr;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 16px 48px rgba(0,0,0,.24);overflow:hidden}.ydo-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-modal-head h3{margin:0;font-size:var(--dsw-font-base-16-font-size,16px)}.ydo-modal-meta{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-modal-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;padding:20px;overflow:auto}.ydo-panel{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}.ydo-panel h4{margin:0 0 10px;font-size:var(--dsh-content-font-size,14px)}.ydo-panel-gap{border-color:var(--dsw-alias-state-warn-primary,#d29922)}.ydo-gap-list{margin:0;padding-left:18px;display:grid;gap:4px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-gap-list code{font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-primary)}.ydo-gap-list .ydo-gap-failed{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary))}.ydo-bars{margin:0;padding:0;list-style:none;display:grid;gap:6px}.ydo-bars li{display:grid;grid-template-columns:72px 1fr 56px;align-items:center;gap:8px;font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-bar-track{display:block;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}.ydo-bar-fill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary)}.ydo-bar-value{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}.ydo-donut-wrap{display:flex;align-items:center;gap:16px}.ydo-donut{position:relative;width:96px;height:96px;border-radius:50%;flex:none}.ydo-donut-hole{position:absolute;inset:22px;border-radius:50%;background:var(--dsw-alias-bg-base)}.ydo-legend{margin:0;padding:0;list-style:none;display:grid;gap:6px;font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-legend li{display:flex;align-items:center;gap:6px}.ydo-legend-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--dsw-alias-brand-primary)}.ydo-tags{display:flex;flex-wrap:wrap;gap:6px}.ydo-tag{padding:3px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-confirm-overlay{position:fixed;inset:0;z-index:560;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}.ydo-confirm{width:min(420px,calc(100vw - 32px));padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 40px rgba(0,0,0,.18)}.ydo-confirm-title{margin:0 0 20px;font-size:var(--dsw-font-base-16-font-size,15px);line-height:1.6}.ydo-confirm-actions{display:flex;justify-content:flex-end;gap:12px}.ydo-confirm-primary{min-height:36px;padding:0 18px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-weight:600;cursor:pointer}.ydo-confirm-secondary{min-height:36px;padding:0 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}.ydo-delete-retry{display:grid;gap:8px;justify-items:start;padding:10px 12px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.ydo-delete-retry .ydo-secondary{min-height:32px}/* 二次优化（§5.2）色彩变量定义在 overlay 作用域，不引入全局污染：性别男=淡蓝/女=柔和红；四类分布（年龄/流量来源/地域/城市级别）条形图淡绿填充，进度分析不受影响。 */
.ydo-overlay{--ydo-gender-male:#91C5EB;--ydo-gender-female:#E88989;--ydo-distribution-fill:#A6D9B0;--ydo-distribution-fill-hover:#8FC99B}.ydo-bars-distribution .ydo-bar-fill{background:var(--ydo-distribution-fill,#A6D9B0)}.ydo-bars-distribution .ydo-bar-fill:hover{background:var(--ydo-distribution-fill-hover,#8FC99B)}.ydo-ov-page{display:grid;gap:12px;align-content:start;overflow:auto;min-height:0}/* 工具栏（UI 优化方案 v2 §4.1）：grid 两列 minmax(0,1fr) auto——筛选项在左列内部换行，操作区固定行尾。 */
.ydo-ov-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px}.ydo-ov-filters{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0}/* 筛选控件带可见说明文字、高度统一 36px；取消浏览器黑 outline，仅 :focus-visible 显品牌色外环（v2 §4.1/§7）。 */
.ydo-filter-option:hover{background:var(--dsw-alias-bg-layer-2)}.ydo-ov-filter{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);white-space:nowrap}/* 自定义日期范围（2026-09-21 需求）：与筛选下拉同规格（36px/边框/圆角）；color-scheme 跟随宿主主题，日历图标明暗自适应。 */
.ydo-custom-range{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.ydo-custom-range-dash{color:var(--dsw-alias-label-secondary)}.ydo-date-input{height:36px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);color-scheme:light dark}.ydo-date-input:focus{outline:0}.ydo-date-input:focus-visible{border-color:#3B82F6;box-shadow:0 0 0 2px color-mix(in srgb,#3B82F6 28%,transparent)}.ydo-filter-select{display:inline-flex;position:relative;min-width:0}.ydo-filter-trigger{display:flex;align-items:center;justify-content:space-between;gap:10px;height:36px;min-width:90px;max-width:220px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);cursor:pointer}.ydo-filter-trigger:focus{outline:0}.ydo-filter-trigger:focus-visible{border-color:#3B82F6;box-shadow:0 0 0 2px color-mix(in srgb,#3B82F6 28%,transparent)}.ydo-filter-trigger:disabled{opacity:.55;cursor:default}.ydo-filter-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-filter-chevron{width:6px;height:6px;flex:none;margin:-4px 2px 0 0;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg)}.ydo-filter-menu{position:fixed;z-index:560;box-sizing:border-box;overflow-y:auto;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.16)}.ydo-filter-option{display:flex;align-items:center;box-sizing:border-box;height:36px;padding:0 10px;border-radius:4px;color:var(--dsw-alias-label-primary);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-filter-option-active{background:var(--dsw-alias-bg-layer-2)}.ydo-filter-option[aria-selected=true]{color:var(--dsw-alias-brand-primary);font-weight:600}.ydo-filter-option[aria-disabled=true]{opacity:.5;cursor:default}.ydo-ov-actions{display:flex;align-items:center;gap:8px;margin-left:auto}.ydo-ov-loading{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-ov-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.ydo-ov-kpi-label{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-ov-kpi{display:grid;gap:4px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.ydo-ov-kpi-value{font-size:20px;font-weight:650}.ydo-ov-kpi-hint{color:var(--dsw-alias-label-secondary);font-size:12px}.ydo-ov-panel{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);container-type:inline-size;container-name:ydo-panel}/* 面板即容器：窄屏表格重排按面板实际宽度触发（容器查询），不受宿主侧栏/窗口差异影响（二审 P2）。 */.ydo-ov-panel h3{margin:0 0 10px;font-size:var(--dsh-content-font-size,14px)}.ydo-ov-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.ydo-ov-table{display:grid;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow-x:hidden;overflow-y:auto;max-height:420px}/* 总览表格列轨道按表分组固定（v2 §3.3/§4.2/§4.4）：数值列窄定宽，长文本只由标题/依据列伸缩；表头与数据行共用同一模板；容器禁横向滚动，纵向超限只纵向滚。 */
.ydo-ov-tr{display:grid;box-sizing:border-box;padding:8px 10px;align-items:center;gap:8px;font-size:var(--dsh-content-font-size-secondary,13px);border-bottom:1px solid var(--dsw-alias-border-l1);min-width:100%}.ydo-ov-tr-rank{grid-template-columns:48px minmax(90px,.8fr) repeat(6,minmax(72px,.35fr))}.ydo-ov-tr-hot{grid-template-columns:minmax(220px,2fr) minmax(110px,1fr) 124px 84px 76px minmax(220px,1.7fr)}/* 分析页爆款表列序不同（排名居首，方案 §5.5），用专属轨道避免排名落进宽轨（验收建议 1）；发布时间/播放量/互动率固定窄列（v2 §5.4）。 */
.ydo-ov-tr-hot-rank{grid-template-columns:minmax(56px,.5fr) minmax(200px,2fr) 124px 84px 76px minmax(220px,1.7fr)}.ydo-ov-tr:last-child{border-bottom:0}.ydo-ov-head{background:var(--dsw-alias-bg-layer-2);font-weight:600}.ydo-ov-num{text-align:right;font-variant-numeric:tabular-nums}.ydo-ov-hot-basis-head{text-align:center;padding-inline:12px}.ydo-ov-rankcell{text-align:center;font-variant-numeric:tabular-nums}.ydo-ov-flag{margin-left:8px;padding:2px 6px;border-radius:4px;font-size:12px}.ydo-ov-flag-suspicious{background:var(--dsw-alias-bg-layer-2);color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 70%,var(--dsw-alias-label-primary))}.ydo-ov-flag-expired{background:var(--dsw-alias-bg-layer-2);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary))}/* 状态过旧用语义色（橙），正常数据颜色不变（UI 优化方案 §4.3/§7）。 */
.ydo-ov-session-stale{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 70%,var(--dsw-alias-label-primary))}.ydo-ov-dist{margin:0;padding:0;list-style:none;display:grid;gap:6px}.ydo-ov-dist li{display:grid;grid-template-columns:20px minmax(96px,140px) 1fr 44px;align-items:center;gap:8px;font-size:var(--dsh-content-font-size-secondary,13px)}/* 爆款分布前三名固定语义色（v2 §4.3）：1 橙 / 2 蓝 / 3 紫，第 4 名起中性品牌色；名次同时用排名数字表达。 */
.ydo-ov-dist-rank{text-align:center;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}.ydo-ov-dist-top1 .ydo-bar-fill{background:#E8833A}.ydo-ov-dist-top1 .ydo-ov-dist-rank{color:#E8833A;font-weight:650}.ydo-ov-dist-top2 .ydo-bar-fill{background:#3B82F6}.ydo-ov-dist-top2 .ydo-ov-dist-rank{color:#3B82F6;font-weight:650}.ydo-ov-dist-top3 .ydo-bar-fill{background:#8B5CF6}.ydo-ov-dist-top3 .ydo-ov-dist-rank{color:#8B5CF6;font-weight:650}.ydo-ov-alerts{margin:0;padding-left:18px;display:grid;gap:6px;font-size:var(--dsh-content-font-size-secondary,13px);color:var(--dsw-alias-label-secondary)}.ydo-ov-drawer-overlay{position:fixed;inset:0;z-index:560;display:flex;justify-content:flex-end;background:color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}/* 抽屉（UI 优化方案 v2 §6.2）：宽度 min(720px,72vw)、高度 min(860px,84vh) 且不低于视口 75%；纵向 flex——内容不足时操作按钮沉底，超出时随滚动区排布。 */
.ydo-ov-drawer{width:min(720px,72vw);height:min(860px,84vh);min-height:75vh;display:flex;flex-direction:column;gap:12px;padding:20px;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);overflow:auto}.ydo-ov-drawer header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.ydo-ov-drawer h3{margin:0;font-size:var(--dsw-font-base-16-font-size,16px)}/* 关闭按钮 40×40、::after 外扩 2px 保证 ≥44px 点击区域（v2 §6.2）；焦点态同全局 :focus-visible 约定。 */
.ydo-ov-drawer-close{position:relative;display:grid;width:40px;height:40px;flex:none;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font-size:18px;cursor:pointer}.ydo-ov-drawer-close::after{content:"";position:absolute;inset:-2px}.ydo-ov-drawer-close:focus{outline:none}.ydo-ov-drawer-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.ydo-ov-drawer-action{margin-top:auto}.ydo-ov-basis-head{margin:0;padding:10px;display:grid;gap:4px;border:1px solid var(--dsw-alias-state-warn-primary,#d29922);border-radius:8px;font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-ov-drawer-meta{margin:0;display:grid;gap:8px}.ydo-ov-drawer-meta>div{display:flex;justify-content:space-between;gap:12px;font-size:var(--dsh-content-font-size-secondary,13px)}.ydo-ov-drawer-meta dt{color:var(--dsw-alias-label-secondary)}.ydo-ov-drawer-meta dd{margin:0}.ydo-ov-work-link{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);cursor:pointer;padding:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px}.ydo-ov-tr span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ydo-ov-account-row{cursor:pointer}.ydo-ov-account-row:hover{background:var(--dsw-alias-bg-layer-2)}/* 爆款依据列允许多行显示，不把长依据挤成单行（UI 优化方案 §4.4/§6.1）。 */
.ydo-ov-basis{display:grid;gap:2px;min-width:0;white-space:normal;line-height:1.5}.ydo-ov-basis div{overflow-wrap:anywhere}.ydo-an-kpi{display:grid;gap:4px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.ydo-an-page{display:grid;gap:12px;align-content:start;overflow:auto;min-height:0}.ydo-an-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ydo-an-head{display:grid;gap:6px}/* 趋势图 SVG（2026-09-17：30 天固定窗口、黑色折线、缺口虚线、浅灰网格） */
/* height:168px 与 analysis-ui.js 的 TREND_VIEW_HEIGHT=168（viewBox 高）联动，单改一处会变形 */
.ydo-an-trend-svg{display:block;width:100%;height:168px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ydo-an-seg{stroke:var(--dsw-alias-label-primary);stroke-width:2;stroke-linecap:round}
.ydo-an-seg-dashed{stroke-dasharray:6 5;opacity:.75}
.ydo-an-dot-circle{fill:var(--dsw-alias-label-primary)}
.ydo-an-dot-circle:hover{fill:var(--dsw-alias-brand-primary)}
.ydo-an-trend-area{fill:var(--dsw-alias-label-primary);opacity:.06}
.ydo-an-grid-line{stroke:var(--dsw-alias-border-l1);stroke-width:1}
.ydo-an-axis-text{fill:var(--dsw-alias-label-tertiary,#737d8c);font-size:11px}
.ydo-an-axis-label{fill:var(--dsw-alias-label-tertiary,#737d8c);font-size:11px;text-anchor:middle}
.ydo-an-axis-start{text-anchor:start}
.ydo-ai-axis-end,.ydo-an-axis-end{text-anchor:end}
.ydo-an-axis-minor{display:none}
@container ydo-panel (min-width:640px){.ydo-an-axis-minor{display:block}}
.ydo-an-gap-text{fill:var(--dsw-alias-label-tertiary,#737d8c);font-size:10px;text-anchor:middle}
.ydo-an-revised-text{fill:var(--dsw-alias-state-warn-primary,#9a6700);font-size:10px;text-anchor:start}/* 内容指标（UI 优化方案 v2 §5.2）：指标名、主值、状态三段结构，指标卡两列标签布局、数值列对齐；观众与流量四块 2×2 网格（v2 §5.3）。 */
.ydo-an-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ydo-an-metric-card{display:flex;flex-direction:column;gap:6px;min-width:0;padding:12px 14px;border-radius:8px;background:var(--dsw-alias-bg-base)}.ydo-an-metric-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.ydo-an-metric-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}.ydo-an-metric-note{flex:none;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px}.ydo-an-metric-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;line-height:1.2;font-weight:700;font-variant-numeric:tabular-nums}.ydo-an-audience{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ydo-an-audience-block{display:grid;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base)}.ydo-an-audience-block h4{margin:0;font-size:var(--dsh-content-font-size,14px)}@media(max-width:720px){.ydo-an-metrics{grid-template-columns:1fr}.ydo-an-audience{grid-template-columns:1fr}}/* 窄屏表格重排（二审 P2）：面板内容宽度不足以容纳固定列轨道（<940px）时，隐藏表头、行改「字段名 + 值」卡片，内容完整可读——不是仅隐藏横向溢出。字段名来自各单元格的 data-label；文本类单元格（账号名/标题/爆款依据）保持块流，避免多子节点被二维网格错误排位。 */
@container ydo-panel (max-width:940px){.ydo-ov-table{overflow:visible;max-height:none}.ydo-ov-tr.ydo-ov-head{display:none}.ydo-ov-tr{display:block;min-width:0;padding:10px 0}.ydo-ov-tr>[role=cell]{display:grid;grid-template-columns:minmax(76px,auto) 1fr;gap:2px 12px;align-items:baseline;padding:2px 0}.ydo-ov-tr>[role=cell]::before{content:attr(data-label);color:var(--dsw-alias-label-secondary);font-size:12px}.ydo-ov-tr>[role=cell].ydo-ov-num{text-align:right}.ydo-ov-tr>.ydo-ov-account-name,.ydo-ov-tr>.ydo-ov-hot-title,.ydo-ov-tr>.ydo-ov-basis{display:block}.ydo-ov-tr>.ydo-ov-account-name::before,.ydo-ov-tr>.ydo-ov-hot-title::before,.ydo-ov-tr>.ydo-ov-basis::before{display:block;margin-bottom:4px}}@media(max-width:1120px){.ydo-body{display:block;overflow:auto}.ydo-accounts{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.ydo-right{overflow:visible}.ydo-table-wrap{max-height:60vh}}
/* AI 账号表现分析·卡片折叠布局（0916 方案 §9；2026-09-17 验收稿）：
   左边框 3px 语义色区分类别（蓝=结论/红=风险/绿=建议/紫=规律/灰=诊断与限制），
   收起态头部暴露一行 digest；色值映射 dsw 主题变量。 */
.ydo-an-ai .ydo-ov-toolbar{grid-template-columns:minmax(0,1fr) auto}
/* AI 分析弹框（需求 2）：宽 min(880px, vw-48px)；z-index 530 介于主 overlay(520)
   与作品详情(540)之间——弹框内点证据作品时详情叠加其上；关闭按钮 40×40、
   ::after 扩 ≥44px 命中区（与爆款抽屉关闭按钮同一规格）。 */
.ydo-ai-modal-overlay{position:fixed;inset:0;z-index:530;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent)}
.ydo-ai-modal{position:relative;width:min(880px,calc(100vw - 48px));max-height:calc(100vh - 64px);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 16px 48px rgba(0,0,0,.24);overflow:hidden}
.ydo-ai-modal-body{flex:1;min-height:0;overflow:auto;padding:16px}
.ydo-ai-modal-close{position:absolute;top:10px;right:10px;z-index:1;display:grid;width:40px;height:40px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:16px;cursor:pointer}
.ydo-ai-modal-close::after{content:"";position:absolute;inset:-2px}
.ydo-ai-modal-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.ydo-ai-modal .ydo-an-ai{border:0;border-radius:0;background:transparent;padding:0}
.ydo-ai-modal .ydo-an-ai-controls{margin-right:44px}
.ydo-an-ai-controls{display:flex;align-items:center;gap:10px}
.ydo-an-ai-status{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}
.ydo-an-ai-status-succeeded{color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 55%,var(--dsw-alias-label-primary))}
.ydo-an-ai-status-running{color:var(--dsw-alias-brand-primary)}
.ydo-an-ai-status-failed{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary))}
.ydo-ai-cards{display:grid;gap:10px;margin-top:12px}
.ydo-ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@container ydo-panel (max-width:720px){.ydo-ai-grid{grid-template-columns:1fr}}
.ydo-ai-card{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-left-width:3px;border-radius:8px;overflow:hidden}
.ydo-ai-card-summary{border-left-color:var(--dsw-alias-brand-primary)}
.ydo-ai-card-risks{border-left-color:var(--dsw-alias-state-error-primary)}
.ydo-ai-card-recs{border-left-color:var(--dsw-alias-state-success-primary,#1a7f37)}
.ydo-ai-card-patterns{border-left-color:#7c5cff}
.ydo-ai-card-dims{border-left-color:var(--dsw-alias-border-l1)}
.ydo-ai-card-limits{border-left-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.ydo-ai-card-toggle{width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;border:0;background:transparent;cursor:pointer;font:inherit;color:inherit;text-align:left}
.ydo-ai-card-toggle:hover{background:var(--dsw-alias-bg-layer-2)}
.ydo-ai-card-toggle h4{margin:0;font-size:13.5px;flex:none}
.ydo-ai-card-open>.ydo-ai-card-toggle{border-bottom:1px solid var(--dsw-alias-border-l1)}
.ydo-ai-card-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.ydo-ai-arrow{flex:none;color:var(--dsw-alias-label-secondary);font-size:10px;transition:transform .15s}
.ydo-ai-card-open .ydo-ai-arrow{transform:rotate(90deg)}
.ydo-ai-digest{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}
.ydo-ai-count{flex:none;font-size:11px;font-weight:600;padding:1px 8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.ydo-ai-card-risks .ydo-ai-count{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.ydo-ai-card-recs .ydo-ai-count{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}
.ydo-ai-card-body{padding:12px 14px 14px}
.ydo-ai-summary-text{margin:0;font-size:14px;font-weight:600;line-height:1.7}
.ydo-ai-summary-meta{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px;color:var(--dsw-alias-label-secondary);font-size:12px}
.ydo-ai-digest-levels{flex:1;min-width:0;display:flex;gap:6px;overflow:hidden}
.ydo-ai-dl{flex:none;font-size:11px;padding:1px 8px;border-radius:10px;white-space:nowrap}
.ydo-ai-dl-strong{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}
.ydo-ai-dl-medium{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}
.ydo-ai-dl-weak{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary,#d97706)}
.ydo-ai-dl-insufficient{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.ydo-ai-dims{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@container ydo-panel (max-width:720px){.ydo-ai-dims{grid-template-columns:1fr}}
.ydo-ai-dim{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:10px 12px}
.ydo-ai-dim-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.ydo-ai-dim-head b{font-size:13px}
.ydo-ai-level{flex:none;font-size:11px;font-weight:700;padding:1px 9px;border-radius:10px}
.ydo-ai-level-strong{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary,#1a7f37)}
.ydo-ai-level-medium{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}
.ydo-ai-level-weak{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary,#d97706)}
.ydo-ai-level-insufficient{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.ydo-ai-dim-fact{margin:0 0 4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.ydo-ai-dim-insight{margin:0;font-size:12px}
.ydo-ai-dim-detail{margin-top:6px;font-size:12px}
.ydo-ai-dim-detail summary{cursor:pointer;color:var(--dsw-alias-brand-primary);list-style:none}
.ydo-ai-dim-detail summary::before{content:"▸ "}
.ydo-ai-dim-detail[open] summary::before{content:"▾ "}
.ydo-ai-dim-detail:focus-visible summary{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ydo-ai-dim-limit{margin:6px 0 0;color:var(--dsw-alias-label-secondary)}
.ydo-ai-item{padding:9px 11px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);margin-bottom:8px}
.ydo-ai-item:last-child{margin-bottom:0}
.ydo-ai-item-head{display:flex;align-items:baseline;gap:8px}
/* 条目标题对齐卡片标题字号（13.5px），正文比标题小一档（13px）——此前无 font-size
   继承面板默认大字，风险/建议/规律三类条目视觉过大（用户反馈 2026-09-18）。 */
.ydo-ai-item-title{font-weight:600;font-size:13.5px}
.ydo-ai-item-reason{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}
.ydo-ai-pri{flex:none;font-size:11px;font-weight:700;padding:0 7px;border-radius:4px}
/* 高/中/低三色为风险、建议、规律置信度徽章与收起态计数共用（用户反馈 2026-09-18 需求 2）。 */
.ydo-ai-pri-high,.ydo-ai-conf-high{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.ydo-ai-pri-medium,.ydo-ai-conf-medium{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary,#d97706)}
.ydo-ai-pri-low,.ydo-ai-conf-low{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.ydo-ai-signal{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-state-success-primary,#1a7f37)}
.ydo-ai-signal-label{color:var(--dsw-alias-label-secondary)}
.ydo-ai-conf{flex:none;font-size:11px;font-weight:700;padding:1px 8px;border-radius:4px}
/* 收起态「高N 中N 低N」计数徽章（风险/建议/规律三卡共用，配色即 .ydo-ai-pri-*）。 */
.ydo-ai-digest-counts{flex:none;display:flex;gap:4px}
.ydo-ai-digest-counts .ydo-ai-pri{padding:1px 7px}
/* 证据作品（用户反馈 2026-09-18）：标签固定左列、chips 右列流式换行左对齐；
   chip 用 11px 小字（二次反馈：13px 仍显突兀，缩小 2px；font 简写在前保证字体族
   继承正文、显式字号在后生效），品牌色弱底高亮，与普通说明文字区分。 */
.ydo-ai-evidence{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 8px;margin-top:7px;align-items:start}
.ydo-ai-evidence-label{font-size:11px;color:var(--dsw-alias-label-secondary);padding-top:3px}
.ydo-ai-evidence-list{display:flex;flex-wrap:wrap;gap:5px}
.ydo-ai-chip{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;font-size:11px;padding:1px 8px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent);color:var(--dsw-alias-brand-primary);cursor:pointer}
.ydo-ai-chip:hover{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.ydo-ai-limits{margin:0;padding-left:16px;display:grid;gap:4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.ydo-ai-disclaimer{margin:10px 0 0;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* 爆款拆解 Tab（0922 方案 §4.1）：单列纵向滚动页；主视图两块（新建+历史），详情页复用 AI 卡折叠结构。 */
.ydo-bd-body{grid-template-rows:1fr;overflow:auto}
.ydo-bd-main{display:grid;gap:16px;align-content:start;min-width:0}
.ydo-bd-page{display:grid;gap:12px;align-content:start;min-width:0}
.ydo-bd-new{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ydo-bd-input{flex:1;min-width:260px;max-width:560px}
.ydo-bd-rules{display:flex;flex-wrap:wrap;gap:10px}
.ydo-bd-radio{display:grid;gap:4px;min-width:200px;max-width:320px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:left;cursor:pointer}
.ydo-bd-radio:hover{background:var(--dsw-alias-bg-layer-2)}
.ydo-bd-radio:disabled{opacity:.55;cursor:default}
.ydo-bd-radio-active{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.ydo-bd-radio:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ydo-bd-radio-name{font-size:var(--dsh-content-font-size,14px);font-weight:600}
.ydo-bd-radio-desc{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}
.ydo-bd-history{display:grid;gap:8px}
.ydo-bd-row{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(90px,auto) auto;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:left;cursor:pointer}
.ydo-bd-row:hover{background:var(--dsw-alias-bg-layer-2)}
.ydo-bd-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.ydo-bd-row-main{display:grid;gap:2px;min-width:0}
.ydo-bd-row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size,14px);font-weight:600}
.ydo-bd-row-author{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}
.ydo-bd-row-step{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);white-space:nowrap}
.ydo-bd-row-time{color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);white-space:nowrap;font-variant-numeric:tabular-nums}
.ydo-bd-status{padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-size:var(--dsh-content-font-size-secondary,13px);white-space:nowrap;flex:none}
.ydo-bd-status-ok{color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 60%,var(--dsw-alias-label-primary))}
.ydo-bd-status-error{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary))}
.ydo-bd-status-warn{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 60%,var(--dsw-alias-label-primary))}
.ydo-bd-status-running{color:var(--dsw-alias-brand-primary)}
.ydo-bd-head-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ydo-bd-head-row h3{margin:0;font-size:var(--dsw-font-base-16-font-size,16px)}
.ydo-bd-steps{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.ydo-bd-step{padding:3px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.ydo-bd-step-done{color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 60%,var(--dsw-alias-label-primary));border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 35%,transparent)}
.ydo-bd-step-active{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);font-weight:600}
.ydo-bd-cards{display:grid;gap:12px;min-width:0}
.ydo-bd-quote{margin:0 0 10px;padding:10px 12px;border-left:3px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:0 6px 6px 0;white-space:pre-wrap;word-break:break-word;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6}
.ydo-bd-seg-list{display:grid;gap:10px}
.ydo-bd-seg{display:grid;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}
.ydo-bd-seg-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ydo-bd-seg-time{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px)}
.ydo-bd-seg p{margin:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6;word-break:break-word}
.ydo-bd-seg-visual{color:var(--dsw-alias-label-secondary)}
.ydo-bd-seg-speech{color:var(--dsw-alias-label-primary)}
.ydo-bd-seg-copy{color:var(--dsw-alias-label-primary);font-weight:550}
.ydo-bd-seg-source{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:12px}
.ydo-bd-role{padding:1px 8px;border-radius:4px;font-size:11px;white-space:nowrap}
.ydo-bd-role-hook{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}
.ydo-bd-role-build{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 12%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1a7f37) 70%,var(--dsw-alias-label-primary))}
.ydo-bd-role-turn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 14%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d29922) 70%,var(--dsw-alias-label-primary))}
.ydo-bd-role-cta{background:color-mix(in srgb,#7c5cff 12%,transparent);color:#7c5cff}
.ydo-bd-role-other{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.ydo-bd-shot-wrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.ydo-bd-shot-table{border-collapse:collapse;min-width:100%;font-size:12px;line-height:1.5}
.ydo-bd-shot-table th,.ydo-bd-shot-table td{padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:top;white-space:pre-wrap;word-break:break-word}
.ydo-bd-shot-table th{background:var(--dsw-alias-bg-layer-2);font-weight:600;white-space:nowrap}
.ydo-bd-shot-note{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.6;white-space:pre-wrap;word-break:break-word}
.ydo-bd-rule-used{display:grid;gap:8px;justify-items:start}
.ydo-bd-modal-actions{display:flex;justify-content:flex-end;gap:12px;padding:14px 16px;border-top:1px solid var(--dsw-alias-border-l1)}
`;
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-douyin-operation: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-yootun-douyin-operation: exclusive-overlay')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = OVERLAY_ID; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-douyin-operation: styles')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: OVERLAY_ID, order: 43, inject: () => ({ t }) }, Button))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: OVERLAY_ID, order: 43, inject: () => ({ t }) }, Overlay))
}

module.exports = { apply, inject: ['slots', 'locale'], downloadWorkbook, formatCell, formatCount, formatPercent, gapReasonText, hasGap, progressText, WorkTable, WorkDetailModal }
