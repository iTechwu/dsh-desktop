// 车衣爆款看板（RQ-2026-003 DEV-06）：状态机与页面组件在 hotboard-ui.js，
// 构建时内联进同一工厂作用域（本 import 行由 scripts/build.mjs 剥离）。
import { createHotboardHub, HotboardPage, hotboardCss } from './hotboard-ui.js'

const React = require('react')
const REQUEST_TIMEOUT_MS = 30000
const { createElement: h, useEffect, useRef, useState, useSyncExternalStore } = React
const { IconCloseOutlineRegular, IconEditOutlineRegular, MarkdownText, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')
const NS = 'dofe.yootun-xhs-operation'
const PATH = '/api/desktop/yootun/xhs-operation'
const UPLOAD_PICK = '/_dsh/uploader/pick-file'
const UPLOAD_START = '/_dsh/uploader/uploadStart'
const UPLOAD_STATUS = '/_dsh/uploader/uploadStatus'
const MEDIA_PATH = '/_dsh/uploader/media'
const OVERLAY_ID = '@dofe/dsh-yootun-xhs-operation'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const DIALOG_ATTRIBUTES = { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'yxh-title' }
const POLL_INTERVAL_MS = 15000
const UPLOAD_POLL_INTERVAL_MS = 350
const MAX_IMAGES = 9

const copy = {
  zh: {
    open: '小红书运营', title: '小红书运营', subtitle: '小红书平台运营，包括内容创作、运营数据汇总与分析等常用功能',
    pageTabRewrite: '爆款仿写', pageTabAccounts: '账号管理',
    close: '关闭', material: '素材区', reference: '对标区', result: '文案内容区',
    tabImages: '图片', tabVideo: '视频', theme: '主题', themePlaceholder: '可选，图片与视频共用',
    direction: '文案方向', directionPlaceholder: '可选，如：突出省油与家庭出行',
    understandVideo: '理解视频内容', understandVideoHintOff: '默认关闭：基于素材基础信息 + 主题 + 文案方向生成，速度更快', understandVideoHintOn: '已开启：将进行语音转写、抽帧与画面理解，耗时较长',
    refNote: '对标笔记', refNotePlaceholder: '可选，笔记链接', refAccount: '对标账号', refAccountPlaceholder: '可选，账号名称',
    addImage: '添加图片', remove: '移除', imageHint: '已选 {count} / 9 张', videoLabel: '视频', videoBadge: '视频',
    submit: '开始生成', submitting: '正在生成…', uploadFailed: '上传失败，请重试',
    uploadingBlock: '当前照片/视频正在上传中，等待上传完成', retrying: '重试中', uploadedBytes: '已传 {written} / {total}',
    empty: '上传素材后点击“开始生成”，生成一篇可编辑文案', processing: '正在生成文案', stepLabel: '当前步骤',
    failedStep: '失败步骤', hintNoFactNoReference: '素材中未提取到车型、价格等有效事实，且未添加对标内容。建议：填写主题或文案方向、更换或补充含明确信息的素材，或添加对标笔记/账号后重新开始',
    stepIngest: '素材下载', stepProbe: '媒体探测', stepAsr: '语音转写', stepCorrectTranscript: '转写校对',
    stepFrames: '关键帧抽取', stepVision: '画面理解', stepImagesVision: '图片理解',
    stepFactCard: '事实提取', stepStylePortrait: '风格画像', stepCopywriting: '文案生成',
    stepQuality: '质量检查', stepFinalize: '完成整理',
    editableBadge: '已生成 · 可编辑',
    titleLabel: '标题', titleCount: '{current}/20', bodyLabel: '正文', bodyModeEdit: '编辑', bodyModePreview: '预览',
    tagsLabel: '标签', tagAddPlaceholder: '输入标签后回车，最多 10 个', tagRemove: '移除标签',
    issuesTitle: '风险提示（建议修改）',
    issueFieldMissingCover: '封面文案缺失，建议补充', issueFieldMissingLead: '评论引导缺失，建议补充',
    issueSimilarityHigh: '与对标笔记相似度偏高，建议改写', issueLeadOverpromise: '评论引导含“自动接待”类承诺，建议调整',
    regenerate: '重新生成', regenerateConfirm: '将放弃当前文案，以当前表单内容重新生成，确定？',
    copyAll: '复制全文', copiedAll: '已复制全文', copyAllFailed: '复制失败，请手动选择文本复制',
    saveEdit: '保存编辑', savedEdit: '已保存',
    coverLabel: '封面文案', leadLabel: '评论引导',
    failed: '生成失败', failedHint: '已保留你的输入与已上传素材，可修改后重新开始', cancelled: '已取消',
    cancelTask: '取消任务', cancelConfirm: '确认取消当前任务？', confirmYes: '是', confirmNo: '否', cancelFailed: '取消失败，请重试',
    createFailed: '创建任务失败，请重试', pollFailed: '查询状态失败，稍后重试', resultFailed: '读取结果失败',
    copyCode: '复制', copiedCode: '已复制', footnotes: '脚注',
    accountsTitle: '账号管理', accountsHint: '添加账号后在弹出的系统 Google Chrome 中扫码登录；会话仅保存在本设备',
    addAccount: '添加账号', relogin: '重新登录', probe: '检测', removeLocal: '移除本地',
    removeConfirm: '将删除本机的登录数据与采集数据，确定移除该账号？',
    statusOk: '正常', statusExpired: '已过期', statusUnknown: '未检测', statusProbing: '检测中…',
    noAccounts: '还没有账号，点击「添加账号」扫码登录',
    loginWaiting: '已打开系统 Chrome，请在弹出的窗口中完成扫码…', loginOk: '登录成功', loginTimeout: '扫码超时，请重试', loginFailed: '登录失败，请重试',
    chromeMissing: '未检测到系统 Google Chrome，请先安装 Google Chrome',
    profileBusy: '该账号有进行中的浏览器任务，请等待完成后再试',
    captchaHint: '出现安全验证，请在弹出的浏览器窗口中人工完成验证后重试',
    sessionExpiredHint: '登录已过期，请重新扫码',
    collectFailedHint: '采集失败，请稍后重试',
    collectTruncated: '已达到单次采集页数上限，结果可能不完整，可稍后再次采集',
    probeFailed: '检测失败，请重试',
    actionFailed: '操作失败，请重试',
    chromeBlockHint: '未检测到系统 Google Chrome，账号扫码与数据采集不可用',
    basicData: '基本数据', accountInfo: '账号信息', nicknameLabel: '昵称', accountIdLabel: '账号 ID', authStatusLabel: '授权状态',
    collectData: '采集数据', refreshData: '刷新', collecting: '采集中…（已 {pages} 页 / {notes} 篇）',
    lastCollectedAt: '上次采集：{time}', neverCollected: '尚未采集，点击「采集数据」获取',
    statNotes: '笔记数', statPlays: '总观看', statLikes: '总点赞', statCollects: '总收藏', statComments: '总评论', statShares: '总分享',
    gapHint: '其中 {count} 篇缺少该数据', notesUnit: '{count} 篇',
    collectDone: '采集完成', removedDone: '已移除本地账号', probeDone: '检测完成',
    listFailed: '账号列表读取失败，请重试',
    publishPanel: '发布到草稿箱', publishAccountLabel: '发布账号',
    publishNoAccount: '暂无可用账号，请先在「账号管理」中扫码登录',
    publishHint: '点击发布后将弹出该账号的 Chrome 窗口自动填写并保存草稿；完成后浏览器保持打开，可在窗口的发布页「草稿箱」中查看',
    publishStart: '发布到草稿箱', publishing: '发布中…',
    publishDone: '已保存到草稿箱，请在弹出的 Chrome 窗口中查看',
    publishStepPrepare: '准备素材', publishStepOpen: '打开发布页', publishStepUpload: '上传素材',
    publishStepFill: '填写内容', publishStepSaveDraft: '保存草稿', publishStepDone: '完成',
    publishFailed: '发布失败，文案已保留，可重试',
    publishUploadTimeout: '素材上传超时，请在浏览器窗口确认后重试',
    publishSaveNoResponse: '未确认到保存结果，请在浏览器窗口人工确认草稿是否已保存',
    publishSelectorMissing: '页面结构变化导致发布中断，请截图反馈',
    publishNeedCopy: '请先生成文案并上传素材后再发布',
    // 车衣爆款看板（RQ-2026-003 DEV-06）
    pageTabHotboard: '车衣爆款看板',
    hbTitle: '车衣爆款看板', hbConfirm: '操作确认',
    hbSubBoard: '案例看板', hbSubKeywords: '关键词与扩词', hbSubTags: '标签与 AI 标记', hbSubRules: '采集与规则',
    hbLoading: '加载中…', hbLoadFailed: '数据读取失败，请重试', hbWriteDone: '操作完成', hbWriteFailed: '操作失败，请重试', hbNoRunYet: '还没有可查看的采集 Run',
    hbFilters: '筛选', hbAll: '全部', hbWindow: '时间窗', hbWindow7d: '近 7 天', hbWindow30d: '近 30 天', hbWindow90d: '近 90 天',
    hbKeywordFilter: '关键词', hbStyle: '风格', hbColor: '色系', hbNoteWord: '笔记高频词', hbCommentWord: '评论高频词',
    hbSort: '排序', hbSortScore: '热度分', hbSortPublishTime: '发布时间', hbSortCollect: '收藏', hbSortLike: '点赞', hbSortComment: '评论', hbSortShare: '分享',
    hbOnlyMain: '仅主案例', hbOnlyTagged: '仅已打标',
    hbKpiCases: '当前筛选下案例数', hbKpiCoverage: '本轮采集覆盖率', hbKpiAiTagged: 'AI 标记完成率', hbKpiDuplicates: '重复素材组数',
    hbKpiLowQuality: '低质过滤数', hbKpiFailedKeywords: '失败关键词数', hbKpiLastCollected: '最近采集时间', hbKpiNextRun: '下次采集时间', hbScheduleDisabled: '定时已停用',
    hbColTitle: '标题', hbColAuthor: '作者', hbColType: '类型', hbColPublishTime: '发布时间', hbColScore: '热度分', hbColInteraction: '互动量', hbColTags: '标签',
    hbTypeVideo: '视频', hbTypeImage: '图文', hbNoCases: '当前筛选下暂无案例', hbPrev: '上一页', hbNext: '下一页', hbTotal: '共',
    hbRunIdle: '当前没有进行中的采集 Run', hbRunHistory: '运行历史', hbRunStatus: 'Run 状态', hbRunStarted: '开始', hbRunFinished: '结束',
    hbRemainingBudget: '剩余搜索额度', hbRunCollected: '采集', hbRunQualified: '入选', hbRunFailedKeywords: '失败词', hbRunDetail: 'Run 详情',
    hbRunType: '类型', hbRunError: '错误码', hbRunKeywords: '启用词', hbRunSuccess: '成功词', hbRunNoResult: '无结果词', hbRunDuplicates: '去重',
    hbRunAiTagged: 'AI 已标记', hbRunAiPending: 'AI 待标记',
    hbPanelKeywords: '正式关键词管理', hbPanelCandidates: 'AI 扩词候选审核', hbPanelProposals: 'AI 候选标签审核', hbPanelLabels: '正式标签库',
    hbPanelCollect: '采集操作', hbPanelSettings: '当前生效配置', hbPanelFailedKeywords: '失败关键词明细', hbPanelKeywordRuns: 'Run 内关键词执行明细',
    hbCategory: '类目', hbCategoryProduct: '产品词', hbCategoryScene: '场景词', hbStatus: '状态', hbSource: '来源',
    hbStatusActive: '启用', hbStatusDisabled: '停用', hbStatusRetired: '已退役',
    hbSourceBuiltIn: '内置', hbSourceManual: '人工', hbSourceAgent: 'Agent',
    hbPending: '待审核', hbAccepted: '已接受', hbRejected: '已拒绝', hbExpired: '已过期',
    hbColKeyword: '关键词', hbColActions: '操作', hbColPick: '选择', hbColScore: '评分', hbColReason: '理由', hbNoKeywords: '暂无关键词', hbNoCandidates: '暂无候选',
    hbPicked: '已选', hbAccept: '接受', hbReject: '拒绝', hbMerge: '合并入现有标签', hbDisable: '停用', hbEnable: '启用', hbEdit: '编辑', hbRetire: '退役', hbSave: '保存',
    hbCreateKeyword: '新增关键词', hbKeywordPlaceholder: '输入关键词（1-128 字）', hbConfirmCreateKeyword: '确认新增关键词「{keyword}」？',
    hbConfirmDisableKeyword: '确认停用关键词「{keyword}」？停用后不再参与采集。', hbConfirmEnableKeyword: '确认启用关键词「{keyword}」？',
    hbConfirmAcceptCandidates: '确认接受选中的 {count} 个扩词候选为正式关键词？', hbConfirmRejectCandidates: '确认拒绝选中的 {count} 个扩词候选？',
    hbProposalStatus: '提案状态', hbProposalAuto: '自动激活', hbProposalMerged: '已合并',
    hbColLabel: '标签', hbColCode: '编码', hbTagType: '维度', hbColConfidence: '置信度', hbColEvidence: '证据数',
    hbStyleType: '风格', hbColorType: '色系', hbNoProposals: '暂无标签提案', hbNoLabels: '暂无标签',
    hbMergeHint: '合并需先在下方选择目标标签；未选择时「合并入现有标签」按钮不会生效。',
    hbMergeTarget: '合并目标标签', hbMergeTargetNone: '请选择目标标签',
    hbConfirmAcceptProposal: '确认接受标签提案「{label}」并激活为正式标签？', hbConfirmRejectProposal: '确认拒绝标签提案「{label}」？',
    hbConfirmMergeProposal: '确认把标签提案「{label}」合并进「{target}」？', hbConfirmRetireLabel: '确认退役标签「{label}」？已分类笔记保留原标签。',
    hbConfirmEnableLabel: '确认重新启用标签「{label}」？', hbConfirmUpdateLabel: '确认保存标签「{label}」的修改？', hbConfirmCreateLabel: '确认新增标签「{label}」？',
    hbCodePlaceholder: '编码（如 jingjisa）', hbNamePlaceholder: '名称（如 竞技风）', hbDefinitionPlaceholder: '判定说明（可选）', hbCancelEdit: '取消',
    hbStartIncrement: '手动增量采集', hbManualHint: '手动增量会按当前启用关键词发起一轮采集，受每日搜索额度限制；进行中会显示在 Run 状态条。',
    hbManualDisabledHint: '当前配置已关闭手动增量采集。', hbConfirmRunStart: '确认发起一轮手动增量采集？将受每日搜索额度限制。',
    hbSetPublishWindowDays: '发布时间窗（天）', hbSetPerKeywordLimit: '单词采集上限', hbSetCommentTopN: '评论 Top N', hbSetCommentMaxPerNote: '单篇评论上限',
    hbSetMinInteraction: '最低互动量', hbSetDedupThreshold: '去重汉明阈值', hbSetMinValidSample: '热度分最小样本', hbSetSearchBudget: '每日搜索额度',
    hbSetCommentBudget: '每日评论额度', hbSetDetailBudget: '单 Run 详情额度', hbSetScheduleEnabled: '定时采集', hbSetManualIncrement: '手动增量',
    hbSetCommentSample: '评论采样', hbSetManualCommentDefault: '手动采集默认含评论', hbSetFullScheduleCron: '全量调度 cron',
    hbConfirmSettings: '确认保存 {count} 项配置修改？', hbSaveSettings: '保存配置', hbRuleVersion: '规则版本',
    hbNoteDetail: '案例详情', hbCloseDrawer: '关闭', hbNoImages: '暂无图片', hbImageBroken: '图片加载失败', hbMetrics: '数据指标',
    hbCurrentTags: '当前标签（选择即纠错）', hbUntagged: '未打标', hbConfirmTagUpdate: '确认把该案例的风格/色系标签改为「{tag}」？',
    hbNoteBody: '正文', hbSimilarNotes: '相似笔记', hbWordStats: '高频词', hbScore7d: '7 天分', hbScore30d: '30 天分', hbScore90d: '90 天分',
    // 宿主错误码经 HB_ERROR_KEYS 映射后的受控文案（review MAJOR-4）；不透出原始错误码。
    hbErrInvalidArgument: '参数不合法，请检查输入后重试', hbErrNotFound: '目标不存在或已被删除', hbErrActiveRunExists: '已有采集 Run 进行中，请等待完成',
    hbErrBudgetExhausted: '当日采集额度已用尽，请明日再试', hbErrKeywordEmpty: '没有启用中的关键词，请先在「关键词与扩词」里启用', hbErrKeywordConflict: '关键词已存在或冲突',
    hbErrEvidenceInsufficient: '标签证据不足，无法完成 AI 标记', hbErrLabelConflict: '标签编码或名称冲突', hbErrAiSchemaInvalid: 'AI 返回格式异常，已按失败处理',
    hbErrProviderFailed: '模型服务暂不可用，请稍后重试', hbErrInternal: '服务内部错误，请稍后重试', hbErrConfirmation: '缺少操作确认，请重新提交', hbErrValidation: '输入校验未通过，请检查后重试',
    hbCandidatesPartial: '批量裁决完成：{failed}/{total} 条失败，其余已生效',
    // 写操作成功提示（runWrite successKey，review 复验 MAJOR-A：此前整组漏注册，
    // 提示条会显示裸键名；hbRunStartDone 刻意区别于状态条时间标签 hbRunStarted）。
    hbTagUpdated: '标签已更新', hbKeywordSaved: '关键词已保存', hbSettingsSaved: '配置已保存',
    hbRunStartDone: '增量采集已发起，进度见 Run 状态条', hbCandidatesReviewed: '候选裁决完成', hbLabelReviewed: '标签提案已裁决', hbLabelSaved: '标签已保存',
    hbCreateLabel: '新增标签', hbDateFrom: '扩词开始日期', hbDateTo: '扩词结束日期',
  },
  en: {
    open: 'XHS operation', title: 'XHS operation', subtitle: 'XHS platform operations: content creation, performance data aggregation and analysis',
    pageTabRewrite: 'Viral rewrite', pageTabAccounts: 'Accounts',
    close: 'Close', material: 'Media', reference: 'References', result: 'Copy',
    tabImages: 'Images', tabVideo: 'Video', theme: 'Theme', themePlaceholder: 'Optional, shared by images and video',
    direction: 'Copy direction', directionPlaceholder: 'Optional, e.g. highlight fuel economy for families',
    understandVideo: 'Understand video', understandVideoHintOff: 'Off by default: generates from basic media info + theme + direction, faster', understandVideoHintOn: 'On: runs transcription, frame extraction and visual understanding — slower',
    refNote: 'Reference note', refNotePlaceholder: 'Optional, note link', refAccount: 'Reference account', refAccountPlaceholder: 'Optional, account name',
    addImage: 'Add image', remove: 'Remove', imageHint: '{count} / 5 selected', videoLabel: 'Video', videoBadge: 'Video',
    submit: 'Start', submitting: 'Generating…', uploadFailed: 'Upload failed, retry',
    uploadingBlock: 'Uploading in progress — wait for the current photo/video to finish uploading.', retrying: 'Retrying', uploadedBytes: '{written} / {total} sent',
    empty: 'Upload media then press “Start” to generate one editable copy', processing: 'Generating copy', stepLabel: 'Current step',
    failedStep: 'Failed step', hintNoFactNoReference: 'No usable facts (model, price, selling points) were extracted from the media, and no references were provided. Fill in the theme or direction, use clearer media, or add a reference note/account, then retry',
    stepIngest: 'Downloading media', stepProbe: 'Probing media', stepAsr: 'Transcribing audio', stepCorrectTranscript: 'Proofreading transcript',
    stepFrames: 'Extracting frames', stepVision: 'Understanding visuals', stepImagesVision: 'Understanding images',
    stepFactCard: 'Extracting facts', stepStylePortrait: 'Profiling style', stepCopywriting: 'Writing copy',
    stepQuality: 'Checking quality', stepFinalize: 'Finalizing',
    editableBadge: 'Generated · editable',
    titleLabel: 'Title', titleCount: '{current}/20', bodyLabel: 'Body', bodyModeEdit: 'Edit', bodyModePreview: 'Preview',
    tagsLabel: 'Tags', tagAddPlaceholder: 'Type a tag and press Enter, up to 10', tagRemove: 'Remove tag',
    issuesTitle: 'Risk hints (suggested fixes)',
    issueFieldMissingCover: 'Cover copy is missing — consider adding it', issueFieldMissingLead: 'Lead guide is missing — consider adding it',
    issueSimilarityHigh: 'Too similar to the reference note — consider rewriting', issueLeadOverpromise: 'Lead guide promises auto-reply — consider adjusting',
    regenerate: 'Regenerate', regenerateConfirm: 'Discard the current copy and regenerate with the current form?',
    copyAll: 'Copy all', copiedAll: 'All copied', copyAllFailed: 'Copy failed — select the text manually',
    saveEdit: 'Save edits', savedEdit: 'Saved',
    coverLabel: 'Cover copy', leadLabel: 'Lead',
    failed: 'Generation failed', failedHint: 'Your input and uploaded media are kept; adjust and retry', cancelled: 'Cancelled',
    cancelTask: 'Cancel', cancelConfirm: 'Cancel the current task?', confirmYes: 'Yes', confirmNo: 'No', cancelFailed: 'Cancel failed, retry',
    createFailed: 'Failed to create the task, retry', pollFailed: 'Failed to query status, retry later', resultFailed: 'Failed to read the result',
    copyCode: 'Copy', copiedCode: 'Copied', footnotes: 'Footnotes',
    accountsTitle: 'Accounts', accountsHint: 'Add an account to sign in by scanning the QR in a popped-up system Google Chrome; the session stays on this device',
    addAccount: 'Add account', relogin: 'Re-login', probe: 'Check', removeLocal: 'Remove',
    removeConfirm: 'This deletes local sign-in data and collected data for the account. Remove it?',
    statusOk: 'Active', statusExpired: 'Expired', statusUnknown: 'Unchecked', statusProbing: 'Checking…',
    noAccounts: 'No accounts yet — click “Add account” to scan and sign in',
    loginWaiting: 'System Chrome opened — scan the QR in the popped-up window…', loginOk: 'Signed in', loginTimeout: 'Scan timed out, retry', loginFailed: 'Sign-in failed, retry',
    chromeMissing: 'System Google Chrome not found — install it first',
    profileBusy: 'This account has a browser task in progress; try again later',
    captchaHint: 'A security check appeared — complete it manually in the popped-up browser, then retry',
    sessionExpiredHint: 'Sign-in expired, scan again',
    collectFailedHint: 'Collection failed, retry later',
    collectTruncated: 'Reached the per-run page limit — results may be incomplete; collect again later',
    probeFailed: 'Check failed, retry',
    actionFailed: 'Action failed, retry',
    chromeBlockHint: 'System Google Chrome not found — account sign-in and data collection are unavailable',
    basicData: 'Basic data', accountInfo: 'Account', nicknameLabel: 'Nickname', accountIdLabel: 'Account ID', authStatusLabel: 'Authorization',
    collectData: 'Collect data', refreshData: 'Refresh', collecting: 'Collecting… ({pages} pages / {notes} notes)',
    lastCollectedAt: 'Last collected: {time}', neverCollected: 'Not collected yet — click “Collect data”',
    statNotes: 'Notes', statPlays: 'Plays', statLikes: 'Likes', statCollects: 'Collects', statComments: 'Comments', statShares: 'Shares',
    gapHint: '{count} notes lack this metric', notesUnit: '{count} notes',
    collectDone: 'Collection finished', removedDone: 'Local account removed', probeDone: 'Check finished',
    listFailed: 'Failed to load accounts, retry',
    publishPanel: 'Publish to drafts', publishAccountLabel: 'Account',
    publishNoAccount: 'No account available — scan and sign in under “Accounts” first',
    publishHint: 'Publishing pops up the account’s Chrome window, fills in and saves the draft automatically; the browser stays open afterwards so you can check the drafts there',
    publishStart: 'Publish to drafts', publishing: 'Publishing…',
    publishDone: 'Saved to drafts — check the popped-up Chrome window',
    publishStepPrepare: 'Preparing media', publishStepOpen: 'Opening publish page', publishStepUpload: 'Uploading media',
    publishStepFill: 'Filling in content', publishStepSaveDraft: 'Saving draft', publishStepDone: 'Done',
    publishFailed: 'Publish failed — the copy is kept, retry',
    publishUploadTimeout: 'Media upload timed out — check the browser window and retry',
    publishSaveNoResponse: 'Save not confirmed — check manually in the browser window whether the draft was saved',
    publishSelectorMissing: 'The page structure changed and publishing stopped — please report with a screenshot',
    publishNeedCopy: 'Generate the copy and upload media first',
    // Hotboard (RQ-2026-003 DEV-06)
    pageTabHotboard: 'Hotboard',
    hbTitle: 'Car-wrap hotboard', hbConfirm: 'Confirm',
    hbSubBoard: 'Cases', hbSubKeywords: 'Keywords & expansion', hbSubTags: 'Tags & AI marking', hbSubRules: 'Collection & rules',
    hbLoading: 'Loading…', hbLoadFailed: 'Failed to load data, retry', hbWriteDone: 'Done', hbWriteFailed: 'Action failed, retry', hbNoRunYet: 'No collection run to show yet',
    hbFilters: 'Filters', hbAll: 'All', hbWindow: 'Window', hbWindow7d: 'Last 7 days', hbWindow30d: 'Last 30 days', hbWindow90d: 'Last 90 days',
    hbKeywordFilter: 'Keyword', hbStyle: 'Style', hbColor: 'Color', hbNoteWord: 'Note word', hbCommentWord: 'Comment word',
    hbSort: 'Sort', hbSortScore: 'Score', hbSortPublishTime: 'Publish time', hbSortCollect: 'Collects', hbSortLike: 'Likes', hbSortComment: 'Comments', hbSortShare: 'Shares',
    hbOnlyMain: 'Main cases only', hbOnlyTagged: 'Tagged only',
    hbKpiCases: 'Cases in filter', hbKpiCoverage: 'Run coverage', hbKpiAiTagged: 'AI tagged', hbKpiDuplicates: 'Duplicate groups',
    hbKpiLowQuality: 'Low quality', hbKpiFailedKeywords: 'Failed keywords', hbKpiLastCollected: 'Last collected', hbKpiNextRun: 'Next run', hbScheduleDisabled: 'Schedule off',
    hbColTitle: 'Title', hbColAuthor: 'Author', hbColType: 'Type', hbColPublishTime: 'Published', hbColScore: 'Score', hbColInteraction: 'Interactions', hbColTags: 'Tags',
    hbTypeVideo: 'Video', hbTypeImage: 'Image', hbNoCases: 'No cases match the current filter', hbPrev: 'Prev', hbNext: 'Next', hbTotal: 'Total',
    hbRunIdle: 'No collection run in progress', hbRunHistory: 'Run history', hbRunStatus: 'Run status', hbRunStarted: 'Started', hbRunFinished: 'Finished',
    hbRemainingBudget: 'Search budget left', hbRunCollected: 'Collected', hbRunQualified: 'Qualified', hbRunFailedKeywords: 'Failed words', hbRunDetail: 'Run detail',
    hbRunType: 'Type', hbRunError: 'Error code', hbRunKeywords: 'Keywords', hbRunSuccess: 'Succeeded', hbRunNoResult: 'No result', hbRunDuplicates: 'Deduped',
    hbRunAiTagged: 'AI tagged', hbRunAiPending: 'AI pending',
    hbPanelKeywords: 'Keywords', hbPanelCandidates: 'AI expansion review', hbPanelProposals: 'AI label proposals', hbPanelLabels: 'Label library',
    hbPanelCollect: 'Collection', hbPanelSettings: 'Current settings', hbPanelFailedKeywords: 'Failed keywords', hbPanelKeywordRuns: 'Keyword runs',
    hbCategory: 'Category', hbCategoryProduct: 'Product', hbCategoryScene: 'Scene', hbStatus: 'Status', hbSource: 'Source',
    hbStatusActive: 'Active', hbStatusDisabled: 'Disabled', hbStatusRetired: 'Retired',
    hbSourceBuiltIn: 'Built-in', hbSourceManual: 'Manual', hbSourceAgent: 'Agent',
    hbPending: 'Pending', hbAccepted: 'Accepted', hbRejected: 'Rejected', hbExpired: 'Expired',
    hbColKeyword: 'Keyword', hbColActions: 'Actions', hbColPick: 'Pick', hbColScore: 'Score', hbColReason: 'Reason', hbNoKeywords: 'No keywords', hbNoCandidates: 'No candidates',
    hbPicked: 'Selected', hbAccept: 'Accept', hbReject: 'Reject', hbMerge: 'Merge into label', hbDisable: 'Disable', hbEnable: 'Enable', hbEdit: 'Edit', hbRetire: 'Retire', hbSave: 'Save',
    hbCreateKeyword: 'Add keyword', hbKeywordPlaceholder: 'Keyword (1-128 chars)', hbConfirmCreateKeyword: 'Add keyword “{keyword}”?',
    hbConfirmDisableKeyword: 'Disable keyword “{keyword}”? It will no longer be collected.', hbConfirmEnableKeyword: 'Enable keyword “{keyword}”?',
    hbConfirmAcceptCandidates: 'Accept {count} selected expansion candidates as keywords?', hbConfirmRejectCandidates: 'Reject {count} selected candidates?',
    hbProposalStatus: 'Proposal', hbProposalAuto: 'Auto-activated', hbProposalMerged: 'Merged',
    hbColLabel: 'Label', hbColCode: 'Code', hbTagType: 'Dimension', hbColConfidence: 'Confidence', hbColEvidence: 'Evidence',
    hbStyleType: 'Style', hbColorType: 'Color', hbNoProposals: 'No proposals', hbNoLabels: 'No labels',
    hbMergeHint: 'Pick a target label below first; merge does nothing without one.',
    hbMergeTarget: 'Merge target', hbMergeTargetNone: 'Pick a target label',
    hbConfirmAcceptProposal: 'Accept proposal “{label}” and activate it?', hbConfirmRejectProposal: 'Reject proposal “{label}”?',
    hbConfirmMergeProposal: 'Merge proposal “{label}” into “{target}”?', hbConfirmRetireLabel: 'Retire label “{label}”? Existing tags are kept.',
    hbConfirmEnableLabel: 'Re-enable label “{label}”?', hbConfirmUpdateLabel: 'Save edits to label “{label}”?', hbConfirmCreateLabel: 'Create label “{label}”?',
    hbCodePlaceholder: 'Code (e.g. jingjisa)', hbNamePlaceholder: 'Name', hbDefinitionPlaceholder: 'Definition (optional)', hbCancelEdit: 'Cancel',
    hbStartIncrement: 'Start incremental run', hbManualHint: 'Starts one incremental run over the active keywords, bounded by the daily search budget; progress shows in the run bar.',
    hbManualDisabledHint: 'Manual incremental runs are disabled in settings.', hbConfirmRunStart: 'Start one manual incremental run? It is bounded by the daily search budget.',
    hbSetPublishWindowDays: 'Publish window (days)', hbSetPerKeywordLimit: 'Per-keyword limit', hbSetCommentTopN: 'Comments top N', hbSetCommentMaxPerNote: 'Comments per note',
    hbSetMinInteraction: 'Min interactions', hbSetDedupThreshold: 'Dedup hamming', hbSetMinValidSample: 'Min valid sample', hbSetSearchBudget: 'Daily search budget',
    hbSetCommentBudget: 'Daily comment budget', hbSetDetailBudget: 'Per-run detail budget', hbSetScheduleEnabled: 'Scheduled run', hbSetManualIncrement: 'Manual incremental',
    hbSetCommentSample: 'Comment sampling', hbSetManualCommentDefault: 'Manual runs include comments', hbSetFullScheduleCron: 'Full-schedule cron',
    hbConfirmSettings: 'Save {count} setting change(s)?', hbSaveSettings: 'Save settings', hbRuleVersion: 'Rule version',
    hbNoteDetail: 'Case detail', hbCloseDrawer: 'Close', hbNoImages: 'No images', hbImageBroken: 'Image failed to load', hbMetrics: 'Metrics',
    hbCurrentTags: 'Current tags (pick to correct)', hbUntagged: 'Untagged', hbConfirmTagUpdate: 'Change this case’s style/color tag to “{tag}”?',
    hbNoteBody: 'Body', hbSimilarNotes: 'Similar notes', hbWordStats: 'Frequent words', hbScore7d: '7d score', hbScore30d: '30d score', hbScore90d: '90d score',
    // Controlled copy for host error codes mapped via HB_ERROR_KEYS; raw codes never surface.
    hbErrInvalidArgument: 'Invalid input — check your entries and retry', hbErrNotFound: 'Target not found or removed', hbErrActiveRunExists: 'A collection run is already active — wait for it to finish',
    hbErrBudgetExhausted: 'Daily collection budget is exhausted — try again tomorrow', hbErrKeywordEmpty: 'No enabled keywords — enable some under Keywords first', hbErrKeywordConflict: 'Keyword already exists or conflicts',
    hbErrEvidenceInsufficient: 'Insufficient label evidence for AI tagging', hbErrLabelConflict: 'Label code or name conflicts', hbErrAiSchemaInvalid: 'AI returned an unexpected format — treated as failed',
    hbErrProviderFailed: 'Model service is unavailable — retry later', hbErrInternal: 'Internal server error — retry later', hbErrConfirmation: 'Missing confirmation — submit again', hbErrValidation: 'Validation failed — check your input',
    hbCandidatesPartial: 'Review finished: {failed}/{total} failed, the rest applied',
    // Success copy for runWrite successKeys (review MAJOR-A: the whole group was
    // missing so notices showed raw keys; hbRunStartDone ≠ run-bar label hbRunStarted).
    hbTagUpdated: 'Tags updated', hbKeywordSaved: 'Keyword saved', hbSettingsSaved: 'Settings saved',
    hbRunStartDone: 'Incremental run started — see the run bar', hbCandidatesReviewed: 'Candidates reviewed', hbLabelReviewed: 'Label proposals reviewed', hbLabelSaved: 'Label saved',
    hbCreateLabel: 'Add label', hbDateFrom: 'Candidates from', hbDateTo: 'Candidates to',
  },
}

let opened = false
let lastTrigger = null
const openListeners = new Set()
const emitOpen = () => openListeners.forEach(listener => listener())
const setOpened = value => { opened = value; emitOpen() }
const subscribeOpen = listener => { openListeners.add(listener); return () => openListeners.delete(listener) }
const snapshotOpen = () => opened

// 同一应用进程内跨开关保留的当前任务（docs/0904/xhs §5.2）：由下方模块级 task machine
// 持有；关闭页面停止轮询但不取消任务，重新打开页面继续查询当前任务。

const openOverlay = event => {
  lastTrigger = event?.currentTarget || document.activeElement
  window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } }))
  setOpened(true)
  requestAnimationFrame(() => {
    const root = document.querySelector('.yxh-overlay')
    for (const [name, value] of Object.entries(DIALOG_ATTRIBUTES)) root?.setAttribute(name, String(value))
  })
}
const closeOverlay = () => { setOpened(false); requestAnimationFrame(() => lastTrigger?.focus?.()) }
const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }

const isTerminal = status => status === 'succeeded' || status === 'failed' || status === 'cancelled'
function progressPercent(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0
}

async function post(body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(body) })
  if (!response.ok) throw new Error('xhs operation failed')
  return response.json()
}

async function uploadFetch(path, body) {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), body: JSON.stringify(body) })
  if (!response.ok) return null
  return response.json()
}

// 宿主本地媒体路由 URL：webview 无法直读 file:// 路径，预览必须由宿主受守卫路由供流。
function mediaUrl(path) {
  return `${MEDIA_PATH}?path=${encodeURIComponent(path)}`
}

function newIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `xhs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function markdownLabels(t) { return { code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') }, footnotes: t('footnotes') } }

// 小红书仿写任务状态机（纯逻辑，无 React/浏览器依赖，可被 test/task-machine.test.mjs 直接驱动）。
// 职责：创建 → 轮询 → 读结果 → 终态；暂态失败按间隔重试；stop 停止轮询不取消任务；resume 恢复。
// 注入 createTask/queryStatus/queryResult/schedule/clearSchedule，便于单测用假定时器与假 fetch。
function createTaskMachine({ createTask, queryStatus, queryResult, cancelTask, intervalMs = POLL_INTERVAL_MS, schedule = setTimeout, clearSchedule = clearTimeout, onChange }) {
  let snapshot = { task: null, versions: null, error: '', failure: null }
  let timer = null
  let generation = 0
  let submission = 0
  let active = true

  const update = next => { snapshot = next; onChange?.(snapshot) }
  const cancel = () => { generation++; if (timer) { clearSchedule(timer); timer = null } }

  const loadResult = async (taskId, gen) => {
    let versions = null
    let error = ''
    try {
      const result = await queryResult(taskId)
      // 期望版本数以创建时的 versionCount 为准（RQ-2026-002 单版=1；历史任务缺省 3）
      const expected = Number(snapshot.task?.input?.versionCount) || 3
      if (result && Array.isArray(result.versions) && result.versions.length === expected) versions = result.versions
      else error = 'resultFailed'
    } catch {
      error = 'resultFailed'
    }
    if (gen !== generation) return
    update({ ...snapshot, versions, error })
  }

  const poll = async () => {
    const gen = generation
    const task = snapshot.task
    if (!task?.taskId) return
    // 已终态：succeeded 补读结果；failed/cancelled 展示失败/取消提示。
    if (isTerminal(task.taskStatus)) {
      if (task.taskStatus === 'succeeded') {
        if (snapshot.versions === null) await loadResult(task.taskId, gen)
      } else {
        update({ ...snapshot, error: task.taskStatus === 'cancelled' ? 'cancelled' : 'failed' })
      }
      return
    }
    try {
      const status = await queryStatus(task.taskId)
      if (gen !== generation) return
      const next = { ...task, taskStatus: status.taskStatus, currentStep: status.currentStep || status.nextStep || '' }
      update({ ...snapshot, task: next, error: '' })
      if (status.taskStatus === 'succeeded') { await loadResult(task.taskId, gen); return }
      if (status.taskStatus === 'failed' || status.taskStatus === 'cancelled') {
        update({
          ...snapshot,
          task: next,
          error: status.taskStatus === 'cancelled' ? 'cancelled' : 'failed',
          // 失败详情（受控错误码/原因短语 + 失败步骤）供界面映射中文引导
          failure: status.taskStatus === 'failed'
            ? { step: next.currentStep || '', errorCode: status.errorCode || '', errorMessage: status.errorMessage || '' }
            : null,
        })
        return
      }
      timer = schedule(poll, intervalMs)
    } catch {
      if (gen !== generation) return
      update({ ...snapshot, error: 'pollFailed' })
      timer = schedule(poll, intervalMs)
    }
  }

  const submit = async body => {
    const submissionId = ++submission
    cancel()
    update({ task: snapshot.task, versions: null, error: '', failure: null })
    let created
    try {
      created = await createTask(body)
    } catch {
      if (submissionId === submission) update({ ...snapshot, error: 'createFailed' })
      return
    }
    if (submissionId !== submission) return
    // 创建期间允许页面开关：始终保存最新任务，只有页面当前激活时才开始轮询。
    update({ task: { taskId: created.taskId, idempotencyKey: body.idempotencyKey, taskStatus: created.taskStatus || 'queued', mediaType: body.mediaType, input: body }, versions: null, error: '', failure: null })
    if (!active) return
    await poll()
  }

  const resume = async () => { active = true; await poll() }
  const stop = () => { active = false; cancel() }

  // 取消当前任务：先停止轮询，再调取消接口；成功后本地置终态 cancelled。
  // 服务端取消是“请求取消”，真正落 cancelled 由 Driver 推进；前端成功后即停止轮询避免空转。
  const requestCancel = async () => {
    const task = snapshot.task
    if (!task?.taskId || isTerminal(task.taskStatus)) return
    cancel()
    const gen = generation
    if (!cancelTask) { update({ ...snapshot, task: { ...task, taskStatus: 'cancelled' }, error: 'cancelled' }); return }
    try {
      await cancelTask(task.taskId, task.idempotencyKey)
    } catch {
      if (gen !== generation) return
      update({ ...snapshot, error: 'cancelFailed' })
      if (active) timer = schedule(poll, intervalMs)
      return
    }
    if (gen !== generation) return
    update({ ...snapshot, task: { ...task, taskStatus: 'cancelled' }, error: 'cancelled' })
  }

  return { submit, resume, stop, requestCancel, get: () => snapshot }
}

// 素材上传状态机（纯逻辑，无 React/浏览器依赖，可被 test/upload-machine.test.mjs 直接驱动）。
// 职责（docs/0907/xhs）：per-asset 管理「已选即预览 + 进度轮询 + 终态」；
// - start()：登记 uploading 素材（本地预览 URL）→ uploadStart → ~350ms 轮询 uploadStatus；
// - done → uploaded（保留本地预览，写入 CDN url）；failed → failed + error；
// - not_found → 仅当「从未收到过 done」才置 failed（P2 客户端兜底）；
// - remove()/stopAll() 停止对应轮询；resume() 重开面板时恢复 uploading 素材的轮询；
// - hasUploading(kind) 供「开始仿写」拦截本次提交素材组（不跨 tab 拦截）。
// 注入 startUpload/pollStatus/schedule/clearSchedule 便于单测用假定时器与假 fetch。
function createUploadManager({ startUpload, pollStatus, intervalMs = UPLOAD_POLL_INTERVAL_MS, maxPollErrors = 10, schedule = setTimeout, clearSchedule = clearTimeout, onChange, idFactory } = {}) {
  /** @type {Map<string, object>} assetId -> 素材对象 */
  const assets = new Map()
  /** @type {Map<string, *>} assetId -> 轮询定时器 */
  const timers = new Map()
  // 面板关闭（stopAll）后置位：挡住 in-flight 轮询回调把轮询「复活」。
  let suspended = false
  let seq = 0
  const nextId = () => {
    if (typeof idFactory === 'function') return idFactory()
    seq += 1
    return `asset-${seq}-${Math.random().toString(36).slice(2, 8)}`
  }

  const emit = () => onChange?.()
  const get = id => assets.get(id) ?? null
  const list = kind => [...assets.values()].filter(asset => asset.kind === kind)
  const hasUploading = kind => list(kind).some(asset => asset.status === 'uploading')

  function schedulePoll(id, uploadId) {
    if (suspended) return
    const timer = schedule(async () => {
      timers.delete(id)
      const asset = assets.get(id)
      // 已移除/覆盖/终结/换 uploadId：停止本轮轮询。
      if (!asset || asset.uploadId !== uploadId || asset.status !== 'uploading') return
      let status = null
      try {
        status = await pollStatus({ uploadId })
      } catch {
        status = null
      }
      // 面板在请求在途期间被关闭：丢弃本次结果，resume 后会重新轮询取回终态。
      if (suspended) return
      const current = assets.get(id)
      if (!current || current.uploadId !== uploadId || current.status !== 'uploading') return
      if (!status) {
        // 传输层/HTTP 层失败：可能为暂态，连续超限才置 failed，避免永久空转。
        current.pollErrors = (current.pollErrors ?? 0) + 1
        if (current.pollErrors > maxPollErrors) {
          current.status = 'failed'
          current.error = 'uploadFailed'
          emit()
          return
        }
        emit()
        schedulePoll(id, uploadId)
        return
      }
      current.pollErrors = 0
      if (status.status === 'uploading') {
        current.attempt = Number.isFinite(status.attempt) ? status.attempt : 0
        current.bytesWritten = status.bytesWritten ?? 0
        current.bytesTotal = status.bytesTotal ?? current.size ?? 0
        current.progress = progressPercent(status.progress)
        emit()
        schedulePoll(id, uploadId)
        return
      }
      if (status.status === 'done') {
        current.status = 'uploaded'
        current.url = typeof status.url === 'string' ? status.url : null
        current.receivedDone = true
        current.progress = 100
        emit()
        return
      }
      if (status.status === 'failed') {
        current.status = 'failed'
        current.error = 'uploadFailed'
        emit()
        return
      }
      // not_found：仅当从未收到过 done 才置 failed；此前收到过 done 则忽略（P2）。
      if (!current.receivedDone) {
        current.status = 'failed'
        current.error = 'uploadFailed'
        emit()
      }
    }, intervalMs)
    timers.set(id, timer)
  }

  async function start({ kind, path, name, size, mime }) {
    const id = nextId()
    const asset = {
      id,
      kind,
      path,
      name: name ?? '',
      size: size ?? 0,
      mime: mime ?? '',
      status: 'uploading',
      attempt: 0,
      progress: 0,
      bytesWritten: 0,
      bytesTotal: size ?? 0,
      url: null,
      error: '',
      receivedDone: false,
      pollErrors: 0,
      uploadId: null,
      localPreviewUrl: mediaUrl(path),
    }
    assets.set(id, asset)
    emit()
    let started
    try {
      started = await startUpload({ path, kind })
    } catch {
      // 启动请求网络层/解析层异常：与返回 null 同归一置 failed（与 schedulePoll 对
      // pollStatus 的兜底一致），避免素材停在 uploading 却无轮询、异常向上冒泡。
      const failed = assets.get(id)
      if (failed) {
        failed.status = 'failed'
        failed.error = 'uploadFailed'
        emit()
      }
      return asset
    }
    const current = assets.get(id)
    if (!current) return asset
    if (!started || !started.uploadId) {
      // uploadStart 快速失败（校验/授权/未登记）：素材置 failed，可移除重选。
      current.status = 'failed'
      current.error = 'uploadFailed'
      emit()
      return asset
    }
    current.uploadId = started.uploadId
    current.name = started.name || current.name
    current.size = started.size ?? current.size
    current.bytesTotal = current.size
    emit()
    schedulePoll(id, started.uploadId)
    return asset
  }

  function remove(id) {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearSchedule(timer)
      timers.delete(id)
    }
    if (assets.delete(id)) emit()
  }

  /** 关闭面板：停止全部轮询（宿主侧上传继续，重开面板 resume 可追上进度）。 */
  function stopAll() {
    suspended = true
    for (const timer of timers.values()) clearSchedule(timer)
    timers.clear()
  }

  /** 重开面板：为仍在 uploading 且已有 uploadId 的素材恢复轮询。 */
  function resume() {
    suspended = false
    for (const asset of assets.values()) {
      if (asset.status === 'uploading' && asset.uploadId && !timers.has(asset.id)) {
        schedulePoll(asset.id, asset.uploadId)
      }
    }
  }

  return { start, remove, stopAll, resume, get, list, hasUploading, get size() { return assets.size } }
}

// 状态机错误码 → 本地化文案。
function errorText(error, t) {
  switch (error) {
    case 'pollFailed': return t('pollFailed')
    case 'resultFailed': return t('resultFailed')
    case 'createFailed': return t('createFailed')
    case 'failed': return t('failed')
    case 'cancelled': return t('cancelled')
    case 'cancelFailed': return t('cancelFailed')
    default: return ''
  }
}

// 工作流步骤名展示映射：进度与失败行用本地化步骤名（ingest/images_vision 等服务端
// 步骤标识对用户不可读），未登记步骤回退服务端原文。
const STEP_LABEL_KEYS = {
  ingest: 'stepIngest', probe: 'stepProbe', asr: 'stepAsr', correct_transcript: 'stepCorrectTranscript',
  frames: 'stepFrames', vision: 'stepVision', images_vision: 'stepImagesVision',
  fact_card: 'stepFactCard', style_portrait: 'stepStylePortrait', copywriting: 'stepCopywriting',
  quality: 'stepQuality', finalize: 'stepFinalize',
}
function stepLabel(t, step) {
  const key = STEP_LABEL_KEYS[step]
  return key ? t(key) : (step || '')
}

// 失败原因受控短语 → 引导文案键：服务端 errorCode 为稳定错误码，errorMessage 为
// 服务端白名单产出的受控短语（不透传 Provider 原文），此处精确匹配后给出可操作的
// 中文引导；未登记组合返回空，界面只显示通用失败文案。
const FAILURE_HINT_RULES = [
  { code: 'copywriting_failed', message: 'no fact or reference basis for copywriting', key: 'hintNoFactNoReference' },
]
function failureHintKey(errorCode, errorMessage) {
  if (!errorCode) return ''
  for (const rule of FAILURE_HINT_RULES) {
    if (rule.code === errorCode && rule.message === errorMessage) return rule.key
  }
  return ''
}

// 模块级单例：跨 overlay 开关保留任务与轮询进度。
const machineListeners = new Set()
// 小红书正文纯文本化（与 publisher.toXhsPlainText 同口径）：剥离双星粗体/
// 双下划线斜体/行首井号标题/行首短横列表（→ 「· 」）与正文尾部纯文本话题串，
// 保证编辑卡与发布到小红书的正文一致（小红书不渲染 markdown）。
function toXhsPlainText(body) {
  let text = String(body || '').replace(/\r\n/g, '\n')
  text = text.replace(/\*\*([^*]*)\*\*/g, '$1').replace(/__([^_]*)__/g, '$1')
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^[-*]\s+/gm, '· ')
  text = text.replace(/^\s*#\S+(?:\s+#\S+)*\s*$/gm, '')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

const machine = createTaskMachine({
  createTask: async body => {
    const res = await post(body)
    if (!res || res.status !== 'created' || !res.taskId) throw new Error('create_failed')
    return { taskId: res.taskId, taskStatus: res.taskStatus || 'queued', mediaType: body.mediaType }
  },
  queryStatus: async taskId => {
    const res = await post({ action: 'status', taskId })
    if (!res || res.status !== 'ready') throw new Error('status_failed')
    return { taskStatus: res.taskStatus, currentStep: res.currentStep, nextStep: res.nextStep, errorCode: res.errorCode || '', errorMessage: res.errorMessage || '' }
  },
  queryResult: async taskId => {
    const res = await post({ action: 'result', taskId })
    if (!res || res.status !== 'ready') throw new Error('result_failed')
    return { versions: res.versions }
  },
  cancelTask: async (taskId, idempotencyKey) => {
    const res = await post({ action: 'cancel', taskId, idempotencyKey })
    if (!res || res.status !== 'ready') throw new Error('cancel_failed')
    return res
  },
  onChange: () => machineListeners.forEach(listener => listener()),
})
const subscribeMachine = listener => { machineListeners.add(listener); return () => machineListeners.delete(listener) }

function Button({ wide, t }) {
  return h(Tooltip, { label: t('open'), disabled: wide },
    h('button', { type: 'button', className: `yxh-button${wide ? ' yxh-wide' : ''}`, 'aria-label': t('open'), onClick: openOverlay },
      h(IconEditOutlineRegular, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null))
}

function TabBar({ tab, onTab, t, disabled }) {
  return h('nav', { className: 'yxh-tabs', 'aria-label': t('material') },
    h('button', { type: 'button', 'aria-current': tab === 'images', disabled, onClick: () => onTab('images') }, t('tabImages')),
    h('button', { type: 'button', 'aria-current': tab === 'video', disabled, onClick: () => onTab('video') }, t('tabVideo')))
}

// quality issues（软性问题码）→ 提示文案键：未登记码跳过（不猜语义）。
const ISSUE_TEXT_KEYS = {
  'field_missing:coverCopy': 'issueFieldMissingCover',
  'field_missing:leadGuide': 'issueFieldMissingLead',
  similarity_high: 'issueSimilarityHigh',
  lead_guide_overpromise: 'issueLeadOverpromise',
}
function issueTextKeys(issues) {
  if (!Array.isArray(issues)) return []
  return issues.map(issue => ISSUE_TEXT_KEYS[issue]).filter(Boolean)
}

const MAX_TITLE_CHARS = 20
const MAX_TAGS = 10

// 复制全文文本化：标题 + 正文 + 标签（#前缀），空段跳过。
function composeFullText(edited) {
  if (!edited) return ''
  const tags = edited.tags.map(tag => `#${tag}`).join(' ')
  return [edited.title, edited.body, tags].map(part => String(part || '').trim()).filter(Boolean).join('\n\n')
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// 单版可编辑结果卡（RQ-2026-002）：标题（≤20 计数）/ 正文（编辑-预览切换）/ 标签
// （chips 增删 ≤10）可编辑，编辑即生效（保存编辑做确认反馈）；封面文案/评论引导/
// 图文页序只读沿用；issues 渲染软性风险提示条（建议修改，不阻断）。
function EditableResult({ version, edited, onEditedChange, t }) {
  const labels = markdownLabels(t)
  const [bodyMode, setBodyMode] = useState('edit')
  const [tagDraft, setTagDraft] = useState('')
  const issues = issueTextKeys(version.issues)
  const titleLength = [...edited.title].length
  const addTag = () => {
    // 允许用户带 # 输入（话题习惯），入列前剥离前缀，避免复制全文产出「##标签」。
    const tag = tagDraft.trim().replace(/^#+/u, '').trim().slice(0, 50)
    if (!tag || edited.tags.includes(tag) || edited.tags.length >= MAX_TAGS) return
    onEditedChange({ ...edited, tags: [...edited.tags, tag] })
    setTagDraft('')
  }
  const removeTag = tag => onEditedChange({ ...edited, tags: edited.tags.filter(item => item !== tag) })
  return h('article', { className: 'yxh-version yxh-edit' },
    h('header', { className: 'yxh-version-head' },
      h('span', { className: 'yxh-version-badge' }, version.version || 'A'),
      h('span', { className: 'yxh-editable-badge' }, t('editableBadge'))),
    issues.length
      ? h('div', { className: 'yxh-issues', role: 'status' },
        h('p', { className: 'yxh-issues-title' }, t('issuesTitle')),
        h('ul', null, ...issues.map(key => h('li', { key }, t(key)))))
      : null,
    h('div', { className: 'yxh-field' },
      h('span', null, t('titleLabel')),
      h('div', { className: 'yxh-title-row' },
        h('input', { type: 'text', value: edited.title, maxLength: MAX_TITLE_CHARS, 'aria-label': t('titleLabel'), onChange: event => onEditedChange({ ...edited, title: event.target.value }) }),
        h('span', { className: 'yxh-title-count' }, t('titleCount').replace('{current}', String(titleLength))))),
    h('div', { className: 'yxh-field' },
      h('div', { className: 'yxh-body-head' },
        h('span', null, t('bodyLabel')),
        h('div', { className: 'yxh-body-modes' },
          h('button', { type: 'button', 'aria-current': bodyMode === 'edit' || undefined, onClick: () => setBodyMode('edit') }, t('bodyModeEdit')),
          h('button', { type: 'button', 'aria-current': bodyMode === 'preview' || undefined, onClick: () => setBodyMode('preview') }, t('bodyModePreview')))),
      bodyMode === 'edit'
        ? h('textarea', { className: 'yxh-body-input', value: edited.body, rows: 10, 'aria-label': t('bodyLabel'), onChange: event => onEditedChange({ ...edited, body: event.target.value }) })
        : h('div', { className: 'yxh-version-body' }, h(MarkdownText, { text: edited.body, labels }))),
    h('div', { className: 'yxh-field' },
      h('span', null, t('tagsLabel')),
      edited.tags.length
        ? h('div', { className: 'yxh-tags', 'aria-label': t('tagsLabel') },
          ...edited.tags.map(tag => h('span', { className: 'yxh-tag', key: tag },
            tag,
            h('button', { type: 'button', className: 'yxh-tag-remove', 'aria-label': `${t('tagRemove')}：${tag}`, onClick: () => removeTag(tag) }, '×'))))
        : null,
      h('input', { type: 'text', value: tagDraft, maxLength: 50, placeholder: t('tagAddPlaceholder'), 'aria-label': t('tagsLabel'), disabled: edited.tags.length >= MAX_TAGS, onChange: event => setTagDraft(event.target.value), onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); addTag() } } })),
    version.coverCopy ? h('div', { className: 'yxh-extra' }, h('span', { className: 'yxh-extra-label' }, t('coverLabel')), h('div', { className: 'yxh-extra-body' }, h(MarkdownText, { text: version.coverCopy, labels }))) : null,
    version.pages && version.pages.length ? h('ol', { className: 'yxh-pages' }, ...version.pages.map(page => h('li', { key: page.pageIndex }, h('span', { className: 'yxh-page-index' }, String(page.pageIndex + 1)), h('div', { className: 'yxh-page-copy' }, h(MarkdownText, { text: page.copy, labels }))))) : null,
    version.leadGuide ? h('div', { className: 'yxh-extra' }, h('span', { className: 'yxh-extra-label' }, t('leadLabel')), h('div', { className: 'yxh-extra-body' }, h(MarkdownText, { text: version.leadGuide, labels }))) : null)
}

// 素材缩略图（图片 & 视频统一）：104×104 本地预览 + 覆盖式进度条 + 右上角移除。
// 图片直接 <img> 本地媒体路由；视频 <video> 定格首帧（#t=0.1），预览失败回退「文件名 + 大小」。
function MediaThumb({ asset, t, locked, broken, onPreviewError, onRemove }) {
  const isVideo = asset.kind === 'video'
  const uploading = asset.status === 'uploading'
  const failed = asset.status === 'failed'
  // 预览加载失败（文件被移除/编码不支持）：回退「文件名 + 大小」占位。
  const showFallback = Boolean(broken)
  const uploadedBytesLabel = uploading && asset.bytesTotal > 0
    ? t('uploadedBytes').replace('{written}', formatBytes(asset.bytesWritten) || '0 B').replace('{total}', formatBytes(asset.bytesTotal) || '')
    : ''
  return h('figure', { className: 'yxh-thumb' },
    showFallback
      ? h('div', { className: 'yxh-preview-fallback' },
        h('span', { className: 'yxh-video-name' }, asset.name),
        asset.size ? h('span', { className: 'yxh-video-meta' }, formatBytes(asset.size)) : null)
      : isVideo
        ? h('video', { src: `${asset.localPreviewUrl}#t=0.1`, preload: 'metadata', muted: true, playsInline: true, onError: onPreviewError })
        : h('img', { src: asset.localPreviewUrl, alt: asset.name, onError: onPreviewError }),
    isVideo && !showFallback ? h('span', { className: 'yxh-video-badge' }, t('videoBadge')) : null,
    failed ? h('div', { className: 'yxh-thumb-error', role: 'alert' }, t('uploadFailed')) : null,
    uploading
      ? h('div', { className: 'yxh-progress' },
        h('span', { className: 'yxh-progress-text' },
          h('span', null, `${asset.progress}%${asset.attempt > 0 ? ` · ${t('retrying')}` : ''}`),
          uploadedBytesLabel ? h('span', null, uploadedBytesLabel) : null),
        h('span', { className: 'yxh-progress-track' },
          h('span', { className: 'yxh-progress-fill', style: { width: `${asset.progress}%` } })))
      : null,
    h('button', { type: 'button', className: 'yxh-thumb-remove', 'aria-label': t('remove'), disabled: locked, onClick: onRemove }, '×'))
}

// ---------------------------------------------------------------------------
// 账号管理页（阶段 2，RQ-2026-002）：本地账号列表 + 扫码登录 + 会话检测 +
// 基本数据汇总采集。数据全部来自宿主本地投影（accounts.list / login / probe /
// collect），采集数据只落设备端快照并在页面聚合展示（Q10），不经 MCP 上报。
// ---------------------------------------------------------------------------

const ACCOUNTS_POLL_INTERVAL_MS = 2000

// 宿主受控错误码 → 文案 key：页面只见中文提示，绝不暴露内部错误码与细节。
const ACCOUNT_ERROR_KEYS = {
  PROFILE_BUSY: 'profileBusy',
  GOOGLE_CHROME_MISSING: 'chromeMissing',
  PLAYWRIGHT_DRIVER_MISSING: 'chromeMissing',
  SESSION_EXPIRED: 'sessionExpiredHint',
  CAPTCHA_DETECTED: 'captchaHint',
  LOGIN_TIMEOUT: 'loginTimeout',
  COLLECT_FAILED: 'collectFailedHint',
  UPLOAD_TIMEOUT: 'publishUploadTimeout',
  SAVE_DRAFT_NO_RESPONSE: 'publishSaveNoResponse',
  SELECTOR_MISSING: 'publishSelectorMissing',
  PUBLISH_FAILED: 'publishFailed',
}

function accountErrorKey(reason) {
  return ACCOUNT_ERROR_KEYS[reason] || null
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatCount(value) {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? String(num) : '—'
}

/**
 * 账号管理状态机（纯逻辑，依赖注入便于测试）。
 *
 * 轮询语义：登录 waiting 与采集 running 各自 2s 轮询一次 status；登录终态
 * ok/timeout/failed 与采集 completed/failed 停止轮询并刷新列表。宿主侧终态
 * run 读取一次即清理，轮询返回 idle 视为扫码中断（进程重启/窗口丢失）。
 */
function createAccountsHub({
  listAccounts, beginLogin, loginStatus, probe, removeLocal, startCollect, collectStatus,
  browserStatus = null,
  intervalMs = ACCOUNTS_POLL_INTERVAL_MS,
  schedule = setTimeout, clearSchedule = clearTimeout,
  onChange = () => {},
}) {
  const listeners = new Set()
  const emit = () => { onChange(); listeners.forEach(listener => listener()) }
  let state = {
    loaded: false, loading: false, accounts: [], listError: null,
    selectedId: null,
    login: null, // { loginId, status, accountId, nickname, reason }
    collect: null, // { collectId, accountId, collectStatus, pagesDone, notesTotal, truncated, error }
    probing: new Set(),
    notice: null, // { kind: 'ok'|'warn'|'error', key }
    // null = 未探测；true/false 来自 browser.status（S-08：无 Chrome 阻断提示）。
    chromeAvailable: null,
  }
  let timer = null
  // active = 账号页当前可见（overlay 打开且停留在账号 Tab）。stop 仅停轮询并
  // 丢弃迟到的异步结果，不销毁状态——重新进入页面 init() 即恢复。
  let active = false

  const setState = patch => {
    state = { ...state, ...patch }
    emit()
  }

  const setNotice = (kind, key) => setState({ notice: key ? { kind, key } : null })

  async function refresh({ keepNotice = true } = {}) {
    setState({ loading: state.accounts.length === 0 })
    try {
      const result = await listAccounts()
      if (!active) return
      const accounts = Array.isArray(result?.accounts) ? result.accounts : []
      const current = state.selectedId && accounts.some(item => item.accountId === state.selectedId)
        ? state.selectedId
        : (accounts[0]?.accountId ?? null)
      setState({ loaded: true, loading: false, accounts, listError: null, selectedId: current, ...(keepNotice ? {} : { notice: null }) })
    } catch {
      if (!active) return
      setState({ loaded: true, loading: false, listError: 'listFailed' })
    }
  }

  /** 每次进入账号页都重探 Chrome（安装是环境事实，随时可能变化）。 */
  async function refreshBrowserStatus() {
    if (!browserStatus) return
    try {
      const result = await browserStatus()
      if (!active) return
      setState({ chromeAvailable: result?.chromeAvailable === true })
    } catch {
      if (!active) return
      setState({ chromeAvailable: null })
    }
  }

  function ensurePolling() {
    if (timer || !active) return
    timer = schedule(async () => {
      timer = null
      await pollOnce()
      ensurePolling()
    }, intervalMs)
  }

  function stopPolling() {
    if (timer) { clearSchedule(timer); timer = null }
  }

  async function pollOnce() {
    if (state.login && state.login.status === 'waiting') {
      try {
        const result = await loginStatus({ loginId: state.login.loginId })
        const login = result?.login
        if (!active) return
        if (!login || login.status === 'idle') {
          // 终态 run 已被宿主清理（进程重启）：按失败收敛，刷新列表。
          setState({ login: null })
          setNotice('error', 'loginFailed')
          await refresh()
          return
        }
        if (login.status === 'waiting') { setState({ login }); return }
        setState({ login: null })
        if (login.status === 'ok') {
          setNotice('ok', 'loginOk')
          await refresh()
          if (active && login.accountId) setState({ selectedId: login.accountId })
        } else {
          setNotice('error', accountErrorKey(login.reason) || (login.status === 'timeout' ? 'loginTimeout' : 'loginFailed'))
          await refresh()
        }
      } catch {
        // 单次轮询失败不终止等待：下个周期继续（用户正在扫码，不能打断）。
      }
      return
    }
    if (state.collect && state.collect.collectStatus === 'running') {
      try {
        const result = await collectStatus({ collectId: state.collect.collectId })
        // 宿主重启后 run 丢失（collect_id_required 等）：收敛为失败，不静默清空。
        if (result?.status === 'error') {
          if (!active) return
          setState({ collect: null })
          setNotice('error', 'collectFailedHint')
          return
        }
        const collect = result?.collect
        if (!active) return
        if (!collect) { setState({ collect: null }); return }
        if (collect.collectStatus === 'running') { setState({ collect }); return }
        setState({ collect: null })
        if (collect.collectStatus === 'completed') setNotice(collect.truncated ? 'warn' : 'ok', collect.truncated ? 'collectTruncated' : 'collectDone')
        else setNotice('error', accountErrorKey(collect.error) || 'collectFailedHint')
        await refresh()
      } catch {
        // 同上：采集轮询单次失败不打断，继续下一周期。
      }
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => state,
    /** 首次进入账号页：拉列表/探测 Chrome，并继续未完成的轮询（后台动作仍在跑）。 */
    init() {
      active = true
      if (!state.loaded) void refresh()
      // stop 期间迟到的 probeNow 会跳过 finally 清理（active 已翻转），此处兜底重置。
      if (state.probing.size) setState({ probing: new Set() })
      void refreshBrowserStatus()
      if ((state.login && state.login.status === 'waiting') || (state.collect && state.collect.collectStatus === 'running')) ensurePolling()
    },
    /** 离开账号页/关闭 overlay：停轮询（不丢弃状态，重新进入时恢复）。 */
    stop() {
      active = false
      stopPolling()
    },
    select(accountId) {
      if (accountId !== state.selectedId) setState({ selectedId: accountId, notice: null })
    },
    dismissNotice() {
      if (state.notice) setState({ notice: null })
    },
    /** 浏览器动作前置阻断：无系统 Chrome 时不动浏览器，直接受控提示（S-08）。 */
    chromeBlocked() {
      return state.chromeAvailable === false
    },
    /** 添加账号 / 重新登录：同一 beginLogin 入口（宿主幂等，重复调用复用 waiting run）。 */
    async beginLoginFlow({ accountId = null } = {}) {
      if (state.login && state.login.status === 'waiting') return
      if (this.chromeBlocked()) { setNotice('error', 'chromeMissing'); return }
      setNotice('error', null)
      try {
        const result = await beginLogin(accountId ? { accountId } : {})
        if (!active) return
        const login = result?.login
        if (result?.status === 'error') {
          setNotice('error', accountErrorKey(result.reason) || 'loginFailed')
          return
        }
        if (!login) return
        setState({ login })
        if (login.status === 'waiting') ensurePolling()
        else if (login.status === 'ok') { setNotice('ok', 'loginOk'); await refresh(); if (active && login.accountId) setState({ selectedId: login.accountId }) }
        else setNotice('error', accountErrorKey(login.reason) || (login.status === 'timeout' ? 'loginTimeout' : 'loginFailed'))
      } catch {
        if (active) setNotice('error', 'loginFailed')
      }
    },
    async probeNow(accountId) {
      if (state.probing.has(accountId)) return
      if (this.chromeBlocked()) { setNotice('error', 'chromeMissing'); return }
      setState({ probing: new Set(state.probing).add(accountId) })
      try {
        const result = await probe({ accountId })
        if (result?.status === 'error') setNotice('error', accountErrorKey(result.reason) || 'probeFailed')
        if (active) await refresh()
      } catch {
        if (active) setNotice('error', 'probeFailed')
      } finally {
        // 无条件清理：stop 后残留会让按钮永久卡「检测中」（切页再回来的场景）。
        const next = new Set(state.probing)
        next.delete(accountId)
        setState({ probing: next })
      }
    },
    async removeAccount(accountId) {
      try {
        await removeLocal({ accountId })
        if (!active) return
        setNotice('ok', 'removedDone')
        await refresh()
      } catch {
        if (active) setNotice('error', 'actionFailed')
      }
    },
    /** 采集最新基本数据（无头复用 Profile）；幂等 key 由页面生成防双击重复。 */
    async startCollectFlow(accountId) {
      if (state.collect && state.collect.collectStatus === 'running') return
      if (this.chromeBlocked()) { setNotice('error', 'chromeMissing'); return }
      setNotice('error', null)
      try {
        const result = await startCollect({ accountId, idempotencyKey: newIdempotencyKey() })
        if (!active) return
        if (result?.status === 'error') {
          setNotice('error', accountErrorKey(result.reason) || 'collectFailedHint')
          return
        }
        const collect = result?.collect
        if (!collect) return
        setState({ collect })
        if (collect.collectStatus === 'running') ensurePolling()
        else if (collect.collectStatus === 'completed') {
          setNotice(collect.truncated ? 'warn' : 'ok', collect.truncated ? 'collectTruncated' : 'collectDone')
          await refresh()
        } else setNotice('error', accountErrorKey(collect.error) || 'collectFailedHint')
      } catch {
        if (active) setNotice('error', 'collectFailedHint')
      }
    },
    /** 测试辅助：注入假时钟推进轮询。 */
    async tick() {
      if (timer) { clearSchedule(timer); timer = null; await pollOnce(); ensurePolling() }
    },
  }
}

function AccountStatusBadge({ status, probing, t }) {
  const key = probing ? 'statusProbing' : status === 'ok' ? 'statusOk' : status === 'expired' ? 'statusExpired' : 'statusUnknown'
  const tone = !probing && status === 'ok' ? 'ok' : !probing && status === 'expired' ? 'expired' : 'muted'
  return h('span', { className: `yxh-badge yxh-badge-${tone}` }, t(key))
}

function AccountSummary({ account, t }) {
  const summary = account?.summary || null
  const totals = summary?.totals || {}
  const gaps = summary?.gaps || {}
  const stats = [
    ['statNotes', summary ? formatCount(summary.notesCount) : '—', null],
    ['statPlays', formatCount(totals.plays), gaps.plays],
    ['statLikes', formatCount(totals.likes), gaps.likes],
    ['statCollects', formatCount(totals.collects), gaps.collects],
    ['statComments', formatCount(totals.comments), gaps.comments],
    ['statShares', formatCount(totals.shares), gaps.shares],
  ]
  return h('div', { className: 'yxh-account-detail' },
    h('section', { className: 'yxh-account-card' },
      h('h3', null, t('accountInfo')),
      h('dl', { className: 'yxh-kv' },
        h('div', null, h('dt', null, t('nicknameLabel')), h('dd', null, account?.nickname || '—')),
        h('div', null, h('dt', null, t('accountIdLabel')), h('dd', { className: 'yxh-mono' }, account?.accountId || '—')),
        h('div', null, h('dt', null, t('authStatusLabel')), h('span', null, h(AccountStatusBadge, { status: account?.sessionStatus || 'unknown', probing: false, t }))))),
    h('section', { className: 'yxh-account-card' },
      h('div', { className: 'yxh-account-card-head' },
        h('h3', null, t('basicData')),
        h('p', { className: 'yxh-hint' }, summary?.capturedAt
          ? t('lastCollectedAt').replace('{time}', formatTime(summary.capturedAt))
          : t('neverCollected'))),
      h('div', { className: 'yxh-stats' },
        stats.map(([key, value, gap]) => h('div', { key, className: 'yxh-stat' },
          h('span', { className: 'yxh-stat-label' }, t(key)),
          h('span', { className: 'yxh-stat-value' }, value),
          gap ? h('span', { className: 'yxh-stat-gap', title: t('gapHint').replace('{count}', String(gap)) }, t('gapHint').replace('{count}', String(gap))) : null)))))
}

function AccountsPage({ hub, t }) {
  const state = useSyncExternalStore(hub.subscribe, hub.get, hub.get)
  const selected = state.accounts.find(item => item.accountId === state.selectedId) || null
  const loginWaiting = Boolean(state.login && state.login.status === 'waiting')
  const collectRunning = Boolean(state.collect && state.collect.collectStatus === 'running' && state.collect.accountId === state.selectedId)
  const anyRunning = loginWaiting || Boolean(state.collect && state.collect.collectStatus === 'running') || state.probing.size > 0
  return h('div', { className: 'yxh-accounts' },
    state.chromeAvailable === false
      ? h('p', { className: 'yxh-chrome-block', role: 'alert' }, t('chromeBlockHint'))
      : null,
    h('aside', { className: 'yxh-account-list' },
      h('div', { className: 'yxh-account-list-head' },
        h('h2', null, t('accountsTitle')),
        h('button', {
          type: 'button',
          className: 'yxh-action yxh-action-primary',
          disabled: loginWaiting,
          onClick: () => void hub.beginLoginFlow({}),
        }, t('addAccount'))),
      h('p', { className: 'yxh-hint' }, t('accountsHint')),
      loginWaiting ? h('p', { className: 'yxh-login-waiting', role: 'status' }, h('span', { className: 'yxh-spinner' }), t('loginWaiting')) : null,
      state.listError ? h('p', { className: 'yxh-error', role: 'alert' }, t(state.listError)) : null,
      state.accounts.length === 0
        ? h('p', { className: 'yxh-hint yxh-account-empty' }, state.loading ? '…' : t('noAccounts'))
        : h('ul', null,
          state.accounts.map(account => h('li', { key: account.accountId },
            h('button', {
              type: 'button',
              className: `yxh-account-item${account.accountId === state.selectedId ? ' yxh-account-item-active' : ''}`,
              'aria-current': account.accountId === state.selectedId || undefined,
              onClick: () => hub.select(account.accountId),
            },
            account.avatar
              ? h('img', { className: 'yxh-avatar', src: account.avatar, alt: '' })
              : h('span', { className: 'yxh-avatar yxh-avatar-fallback', 'aria-hidden': true }, (account.nickname || account.accountId || '?').slice(0, 1)),
            h('span', { className: 'yxh-account-meta' },
              h('span', { className: 'yxh-account-name' }, account.nickname || account.accountId),
              h('span', { className: 'yxh-account-id yxh-mono' }, account.accountId)),
            h(AccountStatusBadge, { status: account.sessionStatus || 'unknown', probing: state.probing.has(account.accountId), t })),
            h('div', { className: 'yxh-account-actions' },
              h('button', { type: 'button', className: 'yxh-mini', disabled: state.probing.has(account.accountId) || anyRunning, onClick: () => void hub.probeNow(account.accountId) }, state.probing.has(account.accountId) ? t('statusProbing') : t('probe')),
              h('button', { type: 'button', className: 'yxh-mini', disabled: loginWaiting || anyRunning, onClick: () => void hub.beginLoginFlow({ accountId: account.accountId }) }, t('relogin')),
              h('button', {
                type: 'button',
                className: 'yxh-mini yxh-mini-danger',
                disabled: anyRunning,
                onClick: () => { if (window.confirm(t('removeConfirm'))) void hub.removeAccount(account.accountId) },
              }, t('removeLocal'))))))),
    h('div', { className: 'yxh-account-main' },
      state.notice
        ? h('p', { className: `yxh-notice yxh-notice-${state.notice.kind}`, role: state.notice.kind === 'error' ? 'alert' : 'status' },
          t(state.notice.key),
          h('button', { type: 'button', className: 'yxh-notice-close', 'aria-label': t('close'), onClick: () => hub.dismissNotice() }, '×'))
        : null,
      selected
        ? h('div', { className: 'yxh-account-toolbar' },
          h('button', {
            type: 'button',
            className: 'yxh-action yxh-action-primary',
            disabled: collectRunning || anyRunning,
            onClick: () => void hub.startCollectFlow(selected.accountId),
          }, collectRunning ? t('collecting').replace('{pages}', String(state.collect?.pagesDone ?? 0)).replace('{notes}', String(state.collect?.notesTotal ?? 0)) : t('collectData')),
          h('button', { type: 'button', className: 'yxh-action', disabled: anyRunning, onClick: () => void hub.probeNow(selected.accountId) }, t('refreshData')))
        : null,
      selected
        ? h(AccountSummary, { account: selected, t })
        : h('div', { className: 'yxh-state' }, h('p', null, state.loading ? '…' : t('noAccounts')))))
}

// ---------------------------------------------------------------------------
// 发布面板（阶段 3，RQ-2026-002）：结果区下方把当前文案一键发布到所选账号的
// 草稿箱（有头 Chrome 自动填写，浏览器保持打开）。进度/结果轮询 publish.status，
// 失败一律映射受控中文文案（README §7：不暴露内部错误码）。
// ---------------------------------------------------------------------------

const PUBLISH_POLL_INTERVAL_MS = 2000

// publish.status 的 step → 文案 key（dev-implementation §2.1 状态机步骤）。
const PUBLISH_STEP_KEYS = {
  prepare: 'publishStepPrepare',
  open: 'publishStepOpen',
  upload: 'publishStepUpload',
  fill: 'publishStepFill',
  saveDraft: 'publishStepSaveDraft',
  done: 'publishStepDone',
}

function PublishPanel({ accounts, publish, notice, publishAccount, onAccount, onStart, t }) {
  const available = accounts.filter(account => account.sessionStatus === 'ok')
  const running = publish?.publishStatus === 'running'
  const stepKey = PUBLISH_STEP_KEYS[publish?.step] || null
  return h('section', { className: 'yxh-publish', 'aria-label': t('publishPanel') },
    h('h3', null, t('publishPanel')),
    available.length === 0
      ? h('p', { className: 'yxh-hint' }, t('publishNoAccount'))
      : h('label', { className: 'yxh-publish-row' },
        h('span', null, t('publishAccountLabel')),
        h('select', {
          value: publishAccount || '',
          disabled: running,
          'aria-label': t('publishAccountLabel'),
          onChange: event => onAccount(event.target.value),
        }, available.map(account => h('option', { key: account.accountId, value: account.accountId },
          account.nickname || account.accountId)))),
    h('p', { className: 'yxh-hint' }, t('publishHint')),
    running
      ? h('p', { className: 'yxh-publish-progress', role: 'status' },
        h('span', { className: 'yxh-spinner', 'aria-hidden': true }),
        `${t('publishing')}${stepKey ? ` · ${t(stepKey)}` : ''}`)
      : null,
    publish?.publishStatus === 'completed'
      ? h('p', { className: 'yxh-notice yxh-notice-ok', role: 'status' }, t('publishDone'))
      : null,
    publish?.publishStatus === 'failed' || notice
      ? h('p', { className: 'yxh-notice yxh-notice-error', role: 'alert' },
        // 终态失败优先按受控错误码映射具体原因（上传超时/验证码等），未映射才落到通用文案。
        notice ? t(notice) : t(accountErrorKey(publish?.error) || 'publishFailed'))
      : null,
    available.length > 0
      ? h('button', {
        type: 'button',
        className: 'yxh-action yxh-action-primary',
        disabled: running,
        onClick: onStart,
      }, running ? t('publishing') : t('publishStart'))
      : null)
}

function Overlay({ t }) {
  const visible = useSyncExternalStore(subscribeOpen, snapshotOpen, snapshotOpen)
  const shellRef = useRef(null)
  const [tab, setTab] = useState('images')
  // per-asset 素材状态机（docs/0907/xhs）：每个素材独立 status/进度/轮询，互不阻塞。
  const [, setUploadVersion] = useState(0)
  const managerRef = useRef(null)
  if (managerRef.current === null) {
    managerRef.current = createUploadManager({
      startUpload: body => uploadFetch(UPLOAD_START, body),
      pollStatus: body => uploadFetch(UPLOAD_STATUS, body),
      onChange: () => setUploadVersion(version => version + 1),
    })
  }
  const uploads = managerRef.current
  const [uploadError, setUploadError] = useState('')
  const [picking, setPicking] = useState(false)
  const pickingRef = useRef(false)
  // 视频首帧预览加载失败（编码/损坏）：回退为「文件名 + 大小」。
  const [brokenPreviews, setBrokenPreviews] = useState(() => new Set())
  const [theme, setTheme] = useState('')
  const [direction, setDirection] = useState('')
  const [understandVideo, setUnderstandVideo] = useState(false)
  const [refNote, setRefNote] = useState('')
  const [refAccount, setRefAccount] = useState('')
  const machineState = useSyncExternalStore(subscribeMachine, () => machine.get(), () => machine.get())
  const { task, versions, error, failure } = machineState
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [confirming, setConfirming] = useState(false)
  // 单版编辑态（RQ-2026-002）：{taskId, title, body, tags, saved}，编辑即生效，
  // 保存编辑置 saved 反馈；随任务切换（重新生成）以最新结果重新初始化。
  const [edited, setEdited] = useState(null)
  const [confirmingRegen, setConfirmingRegen] = useState(false)
  const [copyState, setCopyState] = useState('')
  // 顶部功能页（阶段 2）：'rewrite' 爆款仿写工作台 | 'accounts' 账号管理 |
  // 'hotboard' 车衣爆款看板（RQ-2026-003 DEV-06）。
  const [page, setPage] = useState('rewrite')
  // 账号管理状态机与 Overlay 同生命周期：状态跨页面切换与 overlay 开关保留。
  const accountsHubRef = useRef(null)
  if (accountsHubRef.current === null) {
    accountsHubRef.current = createAccountsHub({
      listAccounts: body => post({ action: 'accounts.list', ...body }),
      beginLogin: body => post({ action: 'account.beginLogin', ...body }),
      loginStatus: body => post({ action: 'account.loginStatus', ...body }),
      // probe 同步等浏览器探测（宿主上限 45s），超时须宽于宿主。
      probe: body => post({ action: 'account.probe', ...body }, 60_000),
      removeLocal: body => post({ action: 'account.removeLocal', ...body }),
      startCollect: body => post({ action: 'collect.start', ...body }),
      collectStatus: body => post({ action: 'collect.status', ...body }),
      browserStatus: body => post({ action: 'browser.status', ...body }),
    })
  }
  const accountsHub = accountsHubRef.current
  // 看板状态机同样与 Overlay 同生命周期：筛选草稿与二级页状态跨 Tab/开关保留，
  // stop 只停轮询不清数据（§13.3 UI 状态要求 1/2/3）。
  const hotboardHubRef = useRef(null)
  if (hotboardHubRef.current === null) {
    hotboardHubRef.current = createHotboardHub({ post: body => post({ ...body }) })
  }
  const hotboardHub = hotboardHubRef.current
  const updateEdited = next => setEdited({ ...next, saved: false })
  // 发布面板状态（阶段 3）：发布 run + 受控提示 + 所选账号；账号列表复用账号
  // 管理状态机（同一本地投影，只读 sessionStatus === 'ok' 的账号）。
  const [publish, setPublish] = useState(null)
  const [publishNotice, setPublishNotice] = useState(null)
  const [publishAccount, setPublishAccount] = useState(null)
  const accountsState = useSyncExternalStore(accountsHub.subscribe, accountsHub.get, accountsHub.get)
  const availableAccounts = (accountsState?.accounts || []).filter(account => account.sessionStatus === 'ok')
  const effectivePublishAccount = publishAccount || availableAccounts[0]?.accountId || null
  useEffect(() => {
    if (!versions?.length || !task?.taskId) return
    if (edited && edited.taskId === task.taskId) return
    setEdited({ taskId: task.taskId, title: versions[0].title || '', body: toXhsPlainText(versions[0].body), tags: [...(versions[0].tags || [])], saved: false })
  }, [versions, task, edited])

  const taskStatus = task?.taskStatus || 'idle'
  const processing = Boolean(task?.taskId) && !isTerminal(taskStatus)
  const locked = busy || picking || processing
  const canCancel = Boolean(task?.taskId) && !isTerminal(taskStatus)

  const imageAssets = uploads.list('image')
  const videoAsset = uploads.list('video')[0] ?? null

  useEffect(() => {
    if (!visible) return undefined
    const key = event => { if (event.key === 'Escape') closeOverlay() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [visible])
  useEffect(() => { if (visible) requestAnimationFrame(() => shellRef.current?.focus?.()) }, [visible])

  // 打开/关闭 overlay：恢复或停止轮询（任务与上传都不取消），关闭时重置取消确认框。
  useEffect(() => {
    if (visible) { machine.resume(); uploads.resume() }
    else { machine.stop(); uploads.stopAll(); setConfirming(false) }
  }, [visible])
  // 账号页生命周期：进入时拉列表/恢复轮询，离开或关闭 overlay 时停轮询。
  useEffect(() => {
    if (visible && page === 'accounts') accountsHub.init()
    else accountsHub.stop()
  }, [visible, page, accountsHub])
  // 看板生命周期：进入时刷新当前页数据并恢复 active run 轮询；离开或关闭 overlay
  // 时停止全部轮询（已加载数据保留，重新进入从 hub 快照恢复）。
  useEffect(() => {
    if (visible && page === 'hotboard') hotboardHub.init()
    else hotboardHub.stop()
  }, [visible, page, hotboardHub])

  const pickAndUpload = async kind => {
    if (pickingRef.current || busyRef.current || processing) return
    pickingRef.current = true
    setPicking(true)
    setUploadError('')
    try {
      const picked = await uploadFetch(UPLOAD_PICK, { kind })
      if (!picked) {
        setUploadError(t('uploadFailed'))
        return
      }
      // 用户在原生对话框主动取消时保持安静；畸形的已选结果必须可见地失败。
      if (!picked.picked) return
      if (!picked.path) {
        setUploadError(t('uploadFailed'))
        return
      }
      if (kind === 'image') {
        // 竞态保护：对话框打开期间列表可能已被补满。
        if (uploads.list('image').length >= MAX_IMAGES) return
      } else {
        // 视频重选 = 覆盖同一素材：先停掉旧视频的轮询再启动新上传。
        const previous = uploads.list('video')[0]
        if (previous) uploads.remove(previous.id)
      }
      await uploads.start({
        kind,
        path: picked.path,
        name: picked.name,
        size: picked.size,
        mime: picked.mime,
      })
    } catch {
      setUploadError(t('uploadFailed'))
    } finally {
      pickingRef.current = false
      setPicking(false)
    }
  }

  const removeAsset = asset => {
    if (pickingRef.current || busyRef.current || locked) return
    uploads.remove(asset.id)
    setBrokenPreviews(prev => {
      const next = new Set(prev)
      next.delete(asset.id)
      return next
    })
  }

  const onSubmit = async () => {
    if (busyRef.current || pickingRef.current || processing) return
    // 拦截范围 = 本次提交所用素材组（当前 tab 对应的 images/video），不跨 tab 拦截。
    const groupAssets = tab === 'images' ? imageAssets : (videoAsset ? [videoAsset] : [])
    if (groupAssets.length === 0) return
    if (groupAssets.some(asset => asset.status === 'uploading')) {
      setUploadError(t('uploadingBlock'))
      return
    }
    // url 齐全校验：failed/无 url 的素材不允许进入创建任务。
    if (groupAssets.some(asset => asset.status !== 'uploaded' || !asset.url)) {
      setUploadError(t('uploadFailed'))
      return
    }
    const mediaType = tab
    const input = { mediaType, theme: theme.trim(), direction: direction.trim(), understandVideo, refNote: refNote.trim(), refAccount: refAccount.trim(), imageUrls: tab === 'images' ? groupAssets.map(asset => asset.url) : null, videoUrl: tab === 'video' ? videoAsset.url : null }
    const idempotencyKey = newIdempotencyKey()
    const references = input.refNote ? [{ source: 'manual', url: input.refNote }] : []
    const accounts = input.refAccount ? [{ name: input.refAccount }] : []
    // 单版可编辑（RQ-2026-002）：versionCount 固定 1；理解视频开关默认关，仅 video 传递。
    const body = { action: 'create', mediaType, idempotencyKey, theme: input.theme || null, direction: input.direction || null, references, accounts, versionCount: 1 }
    if (mediaType === 'images') { body.imageUrls = input.imageUrls; body.coverIndex = 0 }
    else { body.videoUrl = input.videoUrl; body.videoUnderstanding = understandVideo === true }
    busyRef.current = true
    setBusy(true)
    try { await machine.submit(body) } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const cancelCurrent = async () => {
    if (busyRef.current || !canCancel) return
    busyRef.current = true
    setConfirming(false)
    setBusy(true)
    try { await machine.requestCancel() } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // 复制全文（RQ-2026-002）：标题+正文+标签 文本化进剪贴板；结果短暂反馈。
  const onCopyAll = async () => {
    if (!edited) return
    const ok = await copyTextToClipboard(composeFullText(edited))
    setCopyState(ok ? 'copied' : 'failed')
    window.setTimeout(() => setCopyState(''), 2000)
  }

  // 一键发布到草稿箱（阶段 3）：以当前编辑卡内容 + 当前 tab 素材发起后台发布 run；
  // 素材未就绪/文案未生成时受控提示，不发起请求。
  const onPublish = async () => {
    if (!edited || publish?.publishStatus === 'running') return
    const groupAssets = tab === 'images' ? imageAssets : (videoAsset ? [videoAsset] : [])
    const ready = groupAssets.length > 0
      && groupAssets.every(asset => asset.status === 'uploaded' && asset.url)
    if (!ready || !effectivePublishAccount || !String(edited.title || '').trim()) {
      setPublishNotice('publishNeedCopy')
      return
    }
    const body = {
      action: 'publish.start',
      accountId: effectivePublishAccount,
      title: edited.title,
      body: edited.body || '',
      tags: [...(edited.tags || [])],
      visibility: 'private',
      idempotencyKey: newIdempotencyKey(),
    }
    // 素材本地原文件路径优先（README §5.3）：path 失效由宿主按 url 下载兜底。
    if (tab === 'images') body.imageUrls = groupAssets.map(asset => ({ path: asset.path || null, url: asset.url }))
    else body.videoUrl = { path: videoAsset.path || null, url: videoAsset.url }
    setPublishNotice(null)
    try {
      const result = await post(body)
      if (result?.status === 'error') {
        setPublishNotice(accountErrorKey(result.reason) || 'publishFailed')
        return
      }
      if (result?.publish) setPublish(result.publish)
    } catch {
      setPublishNotice('publishFailed')
    }
  }

  // 发布进度轮询：running 时 2s 一次 publish.status；终态由依赖变化自动停止。
  useEffect(() => {
    if (!publish || publish.publishStatus !== 'running') return undefined
    const timer = window.setInterval(async () => {
      try {
        const result = await post({ action: 'publish.status', publishId: publish.publishId })
        if (result?.publish) setPublish(result.publish)
      } catch {
        // 单次轮询失败不打断：发布 run 在宿主后台继续，下个周期继续查询。
      }
    }, PUBLISH_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [publish?.publishId, publish?.publishStatus])

  // 重新生成：覆盖前确认（AC-05），以当前表单内容（含修改后文案方向）重新创建任务。
  const onRegenerate = async () => {
    if (busyRef.current || pickingRef.current || processing) return
    setConfirmingRegen(false)
    await onSubmit()
  }

  if (!visible) return null

  const taskErrorText = errorText(error, t)
  const labels = markdownLabels(t)
  const submittingGroup = tab === 'images' ? imageAssets : (videoAsset ? [videoAsset] : [])
  const hasMaterial = submittingGroup.length > 0
  const uploadingInGroup = uploads.hasUploading(tab === 'images' ? 'image' : 'video')
  // P5：buttonDisabled 去掉 uploading 项——存在上传中素材时按钮仍可点击以触发提示；
  // 以 aria-disabled + 置灰作为无障碍提示，不阻断点击。
  const buttonDisabled = locked || !hasMaterial
  const buttonLabel = busy || processing ? t('submitting') : t('submit')

  const left = h('div', { className: 'yxh-left' },
    h('section', { className: 'yxh-section' },
      h('h2', null, t('material')),
      h(TabBar, { tab, onTab: next => {
        if (next !== tab) setDirection('')
        setTab(next)
      }, t, disabled: locked }),
      tab === 'images'
        ? h('div', { className: 'yxh-media' },
          imageAssets.map(asset => h(MediaThumb, {
            key: asset.id,
            asset,
            t,
            locked,
            broken: brokenPreviews.has(asset.id),
            onPreviewError: () => setBrokenPreviews(prev => new Set(prev).add(asset.id)),
            onRemove: () => removeAsset(asset),
          })),
          imageAssets.length < MAX_IMAGES
            ? h('button', { type: 'button', className: 'yxh-add', 'aria-label': t('addImage'), disabled: locked, onClick: () => pickAndUpload('image') }, picking ? '…' : '+')
            : null)
        : h('div', { className: 'yxh-media' },
          videoAsset
            ? h(MediaThumb, {
              key: videoAsset.id,
              asset: videoAsset,
              t,
              locked,
              broken: brokenPreviews.has(videoAsset.id),
              onPreviewError: () => setBrokenPreviews(prev => new Set(prev).add(videoAsset.id)),
              onRemove: () => removeAsset(videoAsset),
            })
            : h('button', { type: 'button', className: 'yxh-add', 'aria-label': t('videoLabel'), disabled: locked, onClick: () => pickAndUpload('video') }, picking ? '…' : '+')),
      h('div', { className: 'yxh-hint' }, tab === 'images' ? t('imageHint').replace('{count}', String(imageAssets.length)) : null),
      uploadError ? h('p', { className: 'yxh-error', role: 'alert' }, uploadError) : null,
      // 理解视频内容开关（RQ-2026-002）：仅视频 Tab 显示，默认关；开启提示耗时。
      tab === 'video'
        ? h('div', { className: 'yxh-switch-field' },
          h('label', { className: 'yxh-switch' },
            h('input', { type: 'checkbox', checked: understandVideo, disabled: locked, 'aria-label': t('understandVideo'), onChange: event => setUnderstandVideo(event.target.checked) }),
            h('span', null, t('understandVideo'))),
          h('p', { className: 'yxh-hint' }, understandVideo ? t('understandVideoHintOn') : t('understandVideoHintOff')))
        : null,
      h('label', { className: 'yxh-field' },
        h('span', null, t('theme')),
        h('input', { type: 'text', value: theme, maxLength: 500, placeholder: t('themePlaceholder'), 'aria-label': t('theme'), disabled: locked, onChange: event => setTheme(event.target.value) })),
      h('label', { className: 'yxh-field' },
        h('span', null, t('direction')),
        h('input', { type: 'text', value: direction, maxLength: 500, placeholder: t('directionPlaceholder'), 'aria-label': t('direction'), disabled: locked, onChange: event => setDirection(event.target.value) }))),
    h('section', { className: 'yxh-section' },
      h('h2', null, t('reference')),
      h('label', { className: 'yxh-field' },
        h('span', null, t('refNote')),
        h('input', { type: 'text', value: refNote, maxLength: 2048, placeholder: t('refNotePlaceholder'), 'aria-label': t('refNote'), disabled: locked, onChange: event => setRefNote(event.target.value) })),
      h('label', { className: 'yxh-field' },
        h('span', null, t('refAccount')),
        h('input', { type: 'text', value: refAccount, maxLength: 200, placeholder: t('refAccountPlaceholder'), 'aria-label': t('refAccount'), disabled: locked, onChange: event => setRefAccount(event.target.value) }))),
    h('div', { className: 'yxh-actions' },
      h('button', {
        type: 'button',
        className: `yxh-submit${uploadingInGroup ? ' yxh-submit-wait' : ''}`,
        disabled: buttonDisabled,
        'aria-disabled': uploadingInGroup || undefined,
        onClick: onSubmit,
      }, buttonLabel),
      h('button', { type: 'button', className: 'yxh-cancel', disabled: !canCancel || busy, onClick: () => setConfirming(true) }, t('cancelTask'))))

  let right
  if (taskStatus === 'succeeded' && Array.isArray(versions) && versions.length && edited) {
    // 单版可编辑结果卡（RQ-2026-002）：编辑 + 风险提示 + 重新生成/复制全文/保存编辑
    // + 发布面板（阶段 3：一键发布到所选账号草稿箱）。
    right = h('div', { className: 'yxh-versions' },
      // key 随任务切换：重新生成后重置编辑卡内部状态（正文模式/标签草稿）。
      h(EditableResult, { key: edited.taskId, version: versions[0], edited, onEditedChange: updateEdited, t }),
      h('div', { className: 'yxh-result-actions' },
        h('button', { type: 'button', className: 'yxh-action', disabled: locked || !hasMaterial || uploadingInGroup, 'aria-disabled': uploadingInGroup || undefined, onClick: () => setConfirmingRegen(true) }, t('regenerate')),
        h('button', { type: 'button', className: 'yxh-action', onClick: onCopyAll }, copyState === 'copied' ? t('copiedAll') : copyState === 'failed' ? t('copyAllFailed') : t('copyAll')),
        h('button', { type: 'button', className: 'yxh-action yxh-action-primary', onClick: () => setEdited({ ...edited, saved: true }) }, edited.saved ? t('savedEdit') : t('saveEdit'))),
      h(PublishPanel, {
        accounts: accountsState?.accounts || [],
        publish,
        notice: publishNotice,
        publishAccount: effectivePublishAccount,
        onAccount: setPublishAccount,
        onStart: () => void onPublish(),
        t,
      }))
  } else if (taskErrorText) {
    const hintKey = taskStatus === 'failed' && failure ? failureHintKey(failure.errorCode, failure.errorMessage) : ''
    right = h('div', { className: 'yxh-state yxh-state-error', role: 'alert' },
      h('p', null, taskErrorText),
      hintKey ? h('p', null, t(hintKey)) : null,
      taskStatus === 'failed' && failure?.step ? h('p', { className: 'yxh-step' }, `${t('failedStep')} · ${stepLabel(t, failure.step)}`) : null,
      h('p', { className: 'yxh-hint' }, t('failedHint')))
  } else if (processing || taskStatus === 'succeeded') {
    right = h('div', { className: 'yxh-state', role: 'status' },
      h('span', { className: 'yxh-spinner' }),
      h('p', null, t('processing')),
      task?.currentStep ? h('p', { className: 'yxh-step' }, `${t('stepLabel')} · ${stepLabel(t, task.currentStep)}`) : null)
  } else {
    right = h('div', { className: 'yxh-state', role: 'status' }, h('p', null, t('empty')))
  }

  return h('div', { className: 'yxh-overlay' },
    h('main', { className: 'yxh-shell', 'aria-labelledby': 'yxh-title', ref: shellRef, tabIndex: -1, 'aria-busy': locked || uploadingInGroup },
      h('header', { className: 'yxh-header' },
        h('div', null, h('h1', { id: 'yxh-title' }, t('title')), h('p', null, t('subtitle'))),
        h('div', { className: 'yxh-header-buttons' },
          h(Tooltip, { label: t('close') }, h('button', { type: 'button', 'aria-label': t('close'), onClick: closeOverlay }, h(IconCloseOutlineRegular, { size: 16 }))))),
      // 顶部功能 Tab（对齐抖音运营页 ydo-tabs）：爆款仿写工作台 + 账号管理 + 车衣爆款看板。
      h('nav', { className: 'yxh-page-tabs', 'aria-label': t('title') },
        h('button', { type: 'button', 'aria-current': page === 'rewrite' || undefined, onClick: () => setPage('rewrite') }, t('pageTabRewrite')),
        h('button', { type: 'button', 'aria-current': page === 'accounts' || undefined, onClick: () => setPage('accounts') }, t('pageTabAccounts')),
        h('button', { type: 'button', 'aria-current': page === 'hotboard' || undefined, onClick: () => setPage('hotboard') }, t('pageTabHotboard'))),
      page === 'accounts'
        ? h(AccountsPage, { hub: accountsHub, t })
        : page === 'hotboard'
          ? h(HotboardPage, { hub: hotboardHub, t })
          : h('div', { className: 'yxh-body' },
            left,
            h('div', { className: 'yxh-right', 'aria-label': t('result') },
              h('h2', { className: 'yxh-right-title' }, t('result')),
              right))),
    confirming ? h('div', { className: 'yxh-confirm-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('cancelConfirm') },
      h('div', { className: 'yxh-confirm' },
        h('p', { className: 'yxh-confirm-title' }, t('cancelConfirm')),
        h('div', { className: 'yxh-confirm-actions' },
          h('button', { type: 'button', className: 'yxh-confirm-primary', onClick: cancelCurrent }, t('confirmYes')),
          h('button', { type: 'button', className: 'yxh-confirm-secondary', onClick: () => setConfirming(false) }, t('confirmNo'))))) : null,
    confirmingRegen ? h('div', { className: 'yxh-confirm-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t('regenerateConfirm') },
      h('div', { className: 'yxh-confirm' },
        h('p', { className: 'yxh-confirm-title' }, t('regenerateConfirm')),
        h('div', { className: 'yxh-confirm-actions' },
          h('button', { type: 'button', className: 'yxh-confirm-primary', onClick: onRegenerate }, t('confirmYes')),
          h('button', { type: 'button', className: 'yxh-confirm-secondary', onClick: () => setConfirmingRegen(false) }, t('confirmNo'))))) : null)
}

function formatBytes(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return ''
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1024 / 1024).toFixed(1)} MB`
}

const css = `.yxh-button{display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.yxh-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yxh-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yxh-wide span{font-size:13px}.yxh-overlay{position:fixed;inset:0;z-index:520;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yxh-shell{display:grid;grid-template-rows:auto auto 1fr;width:100%;height:100%;overflow:hidden}.yxh-header{display:flex;min-height:72px;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--dsw-alias-border-l1);gap:24px}.yxh-header h1{margin:0;font-size: 20px;line-height:1.25}.yxh-header p{max-width:900px;margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.45}.yxh-header-buttons{display:flex;flex:none;gap:6px}.yxh-header-buttons button{display:grid;width:36px;height:36px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yxh-page-tabs{display:flex;gap:4px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-page-tabs button{height:44px;padding:0 18px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;font-weight:650;cursor:pointer}.yxh-page-tabs button:hover{color:var(--dsw-alias-label-primary)}.yxh-page-tabs button[aria-current="true"]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}.yxh-body{display:grid;grid-template-columns:minmax(460px,1.15fr) minmax(420px,.85fr);max-width:1440px;margin:0 auto;width:100%;min-height:0;overflow:hidden}.yxh-left{overflow:auto;padding:28px 32px 36px;border-right:1px solid var(--dsw-alias-border-l1)}.yxh-right{overflow:auto;padding:28px 32px 36px}.yxh-section{display:grid;gap:16px}.yxh-section+.yxh-section{margin-top:30px}.yxh-section h2,.yxh-right-title{margin:0;font-size:18px;line-height:1.35;font-weight:650}.yxh-right-title{margin-bottom:20px}.yxh-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-tabs button{height:44px;padding:0 18px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;cursor:pointer}.yxh-tabs button[aria-current="true"]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yxh-tabs button:disabled{opacity:.45;cursor:default}.yxh-media{display:flex;flex-wrap:wrap;gap:12px}.yxh-thumb{position:relative;margin:0;width:104px;height:104px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.yxh-thumb img{width:100%;height:100%;object-fit:cover}.yxh-thumb video{width:100%;height:100%;object-fit:cover}.yxh-preview-fallback{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:2px;padding:6px;text-align:center}.yxh-video-badge{position:absolute;top:4px;left:4px;padding:1px 6px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 82%,transparent);color:var(--dsw-alias-label-primary);font-size:11px}.yxh-thumb-error{position:absolute;inset:0;display:grid;place-items:center;padding:4px;text-align:center;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary));font-size:11px}.yxh-progress{position:absolute;left:0;right:0;bottom:0;display:grid;gap:3px;padding:3px 4px 4px;background:linear-gradient(transparent,rgba(0,0,0,.55))}.yxh-progress-text{display:flex;justify-content:space-between;gap:4px;color:#fff;font-size:10px;line-height:1.2;text-shadow:0 1px 2px rgba(0,0,0,.6)}.yxh-progress-track{display:block;height:3px;border-radius:2px;background:rgba(255,255,255,.35);overflow:hidden}.yxh-progress-fill{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary,#fff);transition:width .15s linear}.yxh-thumb-remove{position:absolute;top:4px;right:4px;display:grid;width:20px;height:20px;place-items:center;border:0;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 82%,transparent);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1;cursor:pointer}.yxh-thumb-remove:disabled{opacity:.45;cursor:default}.yxh-add{display:grid;width:104px;height:104px;place-items:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:28px;cursor:pointer}.yxh-add:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.yxh-add:disabled{opacity:.45;cursor:default}.yxh-video-name{flex:1;min-width:0;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.yxh-video-meta{color:var(--dsw-alias-label-secondary);font-size:11px}.yxh-hint{color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-error{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary));font-size:12px}.yxh-field{display:grid;gap:8px}.yxh-field span{color:var(--dsw-alias-label-secondary);font-size:14px}.yxh-field input{min-height:40px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:14px}.yxh-field input:disabled{opacity:.6}.yxh-actions{margin-top:28px;display:flex;align-items:center;gap:16px}.yxh-submit{min-height:40px;padding:0 20px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.yxh-submit:disabled{opacity:.45;cursor:default}.yxh-submit-wait{opacity:.55;cursor:not-allowed}.yxh-cancel{min-height:40px;padding:0 20px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.yxh-cancel:hover{background:var(--dsw-alias-bg-layer-2)}.yxh-cancel:disabled{opacity:.45;cursor:default}.yxh-confirm-overlay{position:fixed;inset:0;z-index:560;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 45%,transparent)}.yxh-confirm{min-width:360px;max-width:80vw;padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 40px rgba(0,0,0,.18)}.yxh-confirm-title{margin:0 0 20px;color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.5}.yxh-confirm-actions{display:flex;justify-content:flex-end;gap:12px}.yxh-confirm-primary{min-height:36px;padding:0 18px;border:0;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:14px;font-weight:600;cursor:pointer}.yxh-confirm-secondary{min-height:36px;padding:0 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer}.yxh-switch-field{display:grid;gap:6px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}.yxh-switch{display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer}.yxh-switch input{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}.yxh-switch input:disabled{cursor:default}.yxh-editable-badge{padding:3px 9px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:600}.yxh-issues{display:grid;gap:6px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,var(--dsw-alias-border-l2)) 45%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b7791f) 8%,transparent);font-size:13px;line-height:1.5}.yxh-issues-title{margin:0;font-weight:650}.yxh-issues ul{margin:0;padding-left:18px;display:grid;gap:2px}.yxh-title-row{display:flex;align-items:center;gap:10px}.yxh-title-row input{flex:1;min-height:40px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:14px}.yxh-title-count{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}.yxh-body-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.yxh-body-head>span{color:var(--dsw-alias-label-secondary);font-size:14px}.yxh-body-modes{display:flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px}.yxh-body-modes button{min-height:26px;padding:0 10px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.yxh-body-modes button[aria-current]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yxh-body-input{width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:14px;line-height:1.6;resize:vertical}.yxh-tag-remove{display:inline-grid;width:14px;height:14px;place-items:center;margin-left:4px;border:0;border-radius:3px;background:transparent;color:inherit;font-size:12px;line-height:1;cursor:pointer}.yxh-tag-remove:hover{background:var(--dsw-alias-bg-base)}.yxh-result-actions{display:flex;flex-wrap:wrap;gap:10px}.yxh-action{min-height:36px;padding:0 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;cursor:pointer}.yxh-action:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06))}.yxh-action:disabled{opacity:.45;cursor:default}.yxh-action-primary{border-color:var(--dsw-alias-brand-primary,#3370ff);background:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-label-primary-foreground,#fff)}.yxh-action-primary:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3370ff) 85%,#000)}.yxh-action-primary:disabled{background:var(--dsw-alias-brand-primary,#3370ff)}.yxh-versions{display:grid;gap:16px}.yxh-version{padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yxh-version-head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}.yxh-version-badge{flex:none;padding:3px 9px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-version-head h3{margin:0;font-size:16px}.yxh-version-body{font-size:14px;line-height:1.6}.yxh-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.yxh-tag{padding:2px 8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-extra{display:grid;gap:3px;margin-top:12px}.yxh-extra-label{color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 75%,var(--dsw-alias-label-primary));font-size:12px}.yxh-extra-body{font-size:14px}.yxh-page-copy{font-size:14px}.yxh-pages{margin:12px 0 0;padding-left:20px;display:grid;gap:6px}.yxh-pages li{font-size:14px}.yxh-page-index{margin-right:8px;color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 75%,var(--dsw-alias-label-primary));font-variant-numeric:tabular-nums}.yxh-state{display:grid;min-height:180px;place-items:center;align-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:14px;text-align:center}.yxh-state p{margin:0}.yxh-step{color:color-mix(in srgb,var(--dsw-alias-label-tertiary) 75%,var(--dsw-alias-label-primary));font-size:12px}.yxh-state-error p:first-child{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 50%,var(--dsw-alias-label-primary))}.yxh-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:yxh-spin .8s linear infinite}@keyframes yxh-spin{to{transform:rotate(360deg)}}.yxh-accounts{display:grid;grid-template-columns:300px minmax(0,1fr);max-width:1440px;margin:0 auto;width:100%;min-height:0;overflow:hidden}.yxh-account-list{overflow:auto;padding:24px 20px 32px;border-right:1px solid var(--dsw-alias-border-l1);display:grid;gap:12px;align-content:start}.yxh-account-list-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.yxh-account-list-head h2{margin:0;font-size:18px;line-height:1.35;font-weight:650}.yxh-account-list ul{margin:4px 0 0;padding:0;list-style:none;display:grid;gap:10px}.yxh-account-item{display:flex;width:100%;align-items:center;gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:left;cursor:pointer}.yxh-account-item:hover{background:var(--dsw-alias-bg-layer-2)}.yxh-account-item-active{border-color:var(--dsw-alias-brand-primary)}.yxh-avatar{flex:none;width:36px;height:36px;border-radius:50%;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}.yxh-avatar-fallback{display:grid;place-items:center;color:var(--dsw-alias-label-secondary);font-size:15px;font-weight:650}.yxh-account-meta{flex:1;min-width:0;display:grid;gap:2px}.yxh-account-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}.yxh-account-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}.yxh-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.yxh-badge{flex:none;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}.yxh-badge-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f855a) 16%,transparent);color:var(--dsw-alias-state-success-primary,#2f855a)}.yxh-badge-expired{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary))}.yxh-badge-muted{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.yxh-account-actions{display:flex;gap:6px;padding:0 2px}.yxh-mini{flex:1;min-height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}.yxh-mini:hover{background:var(--dsw-alias-bg-layer-2)}.yxh-mini:disabled{opacity:.45;cursor:default}.yxh-mini-danger{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,var(--dsw-alias-label-primary))}.yxh-login-waiting{display:flex;align-items:center;gap:8px;margin:0;padding:10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);color:var(--dsw-alias-label-primary);font-size:13px}.yxh-account-empty{margin:8px 0 0;font-size:13px}.yxh-account-main{overflow:auto;padding:24px 32px 36px;display:grid;gap:16px;align-content:start}.yxh-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0;padding:10px 14px;border-radius:6px;font-size:13px}.yxh-notice-ok{border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f855a) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f855a) 10%,transparent)}.yxh-notice-warn{border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b7791f) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b7791f) 10%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b7791f) 60%,var(--dsw-alias-label-primary))}.yxh-chrome-block{grid-column:1/-1;margin:0;padding:10px 14px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-label-primary));font-size:13px}.yxh-notice-error{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-label-primary))}.yxh-notice-close{flex:none;border:0;background:transparent;color:inherit;font-size:15px;line-height:1;cursor:pointer}.yxh-account-toolbar{display:flex;flex-wrap:wrap;gap:10px}.yxh-account-card{display:grid;gap:14px;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yxh-account-card h3{margin:0;font-size:15px;font-weight:650}.yxh-account-card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px}.yxh-account-card-head p{margin:0}.yxh-kv{margin:0;display:grid;gap:10px}.yxh-kv>div{display:flex;align-items:center;gap:16px}.yxh-kv dt{flex:none;width:64px;color:var(--dsw-alias-label-secondary);font-size:13px}.yxh-kv dd{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.yxh-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.yxh-stat{display:grid;gap:4px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.yxh-stat-label{color:var(--dsw-alias-label-secondary);font-size:12px}.yxh-stat-value{font-size:22px;line-height:1.2;font-weight:650;font-variant-numeric:tabular-nums}.yxh-stat-gap{color:var(--dsw-alias-label-secondary);font-size:11px}.yxh-publish{display:grid;gap:12px;padding:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yxh-publish h3{margin:0;font-size:15px;font-weight:650}.yxh-publish-row{display:flex;align-items:center;gap:10px;font-size:14px}.yxh-publish-row span{color:var(--dsw-alias-label-secondary)}.yxh-publish-row select{flex:1;min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:14px}.yxh-publish-row select:disabled{opacity:.6}.yxh-publish-progress{display:flex;align-items:center;gap:8px;margin:0;font-size:13px}.yxh-publish .yxh-action-primary{justify-self:start}@media(max-width:900px){.yxh-header,.yxh-page-tabs,.yxh-left,.yxh-right{padding-left:16px;padding-right:16px}.yxh-header{align-items:flex-start}.yxh-header h1{font-size: 20px}.yxh-header p{font-size:13px}.yxh-body{display:block;overflow:auto}.yxh-left{overflow:visible;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-right{overflow:visible;min-height:360px}.yxh-accounts{display:block;overflow:auto}.yxh-account-list{overflow:visible;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}.yxh-account-main{overflow:visible;padding-left:16px;padding-right:16px}.yxh-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}`

const responsiveCss = '.yxh-confirm{min-width:0;width:min(360px,calc(100vw - 32px));max-width:calc(100vw - 32px)}'

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-xhs-operation: dictionaries')
  ctx.effect(() => { window.addEventListener(OVERLAY_EVENT, closeOtherOverlay); return () => window.removeEventListener(OVERLAY_EVENT, closeOtherOverlay) }, 'dofe-yootun-xhs-operation: exclusive-overlay')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-xhs-operation'; style.textContent = css + responsiveCss + hotboardCss; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-xhs-operation: styles')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-xhs-operation', order: 41, inject: () => ({ t }) }, Button))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-xhs-operation', order: 41, inject: () => ({ t }) }, Overlay))
}
module.exports = { apply, inject: ['slots', 'locale'], createTaskMachine, createUploadManager, createAccountsHub, createHotboardHub }
