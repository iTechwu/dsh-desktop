// 财务专业看板客户端 · 片段 1/7：依赖、常量、文案字典、数据面
// 本文件与其余 src/**.js 由 scripts/build.mjs 按序拼接为单文件浏览器模块，
// 各片段共享同一模块作用域，顶层标识符不能重名。
const React = require('react')
const PLUGIN_BRAND = globalThis.__DSH_PLUGIN_BRAND__ || { tenant: 'sensteed', company: '山子' }
const REQUEST_TIMEOUT_MS = 30000
const { createElement: h, useEffect, useState, useRef, useCallback, useMemo, useSyncExternalStore } = React
const {
  IconAlarmClockOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCloseOutlineRegular,
  IconDataOutlineRegular,
  IconDatabaseOutlineRegular,
  IconGoalOutlineRegular,
  IconLoadingOutlineRegular,
  IconPlanOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconSearchOutlineRegular,
  IconSendOutlineRegular,
  IconShieldOutlineRegular,
  IconSparkleRegular,
  IconTrashOutlineRegular,
  IconUserOutlineRegular,
  IconWarningOutlineRegular,
  Tooltip,
} = require('@deepseek-ai/dsh-client-ui-primitives')

const NS = 'dofe.sensteed-finance'
const OVERLAY_ID = '@dofe/dsh-sensteed-finance'
const OVERLAY_EVENT = 'dofe:yootun-overlay:open'
const BASE = '/api/desktop/sensteed/finance'

// 版块（tab）结构对齐 datasource 前端财务工作台 sections
const TABS = [
  ['overview', 'tabOverview'], ['budget', 'tabBudget'], ['operations', 'tabOperations'],
  ['cash', 'tabCash'], ['alerts', 'tabAlerts'], ['datacenter', 'tabDatacenter'],
  ['entry', 'tabEntry'], ['analyze', 'tabAnalyze'],
]
const EXPENSE_TYPES = [
  ['PROJECT_OPERATION', 'expenseProject'], ['FIXED_OPERATION', 'expenseFixed'],
  ['MODEL_SPECIFIC', 'expenseModel'], ['NON_PROJECT', 'expenseNonProject'],
]
const EXPENSE_LABELS = Object.fromEntries(EXPENSE_TYPES)
const PLAN_TYPES = [
  ['PURCHASE', 'planPurchase'], ['OTHER', 'planOther'], ['NEW_RETAIL', 'planNewRetail'],
  ['PR_PAYMENT', 'planPrPayment'], ['DIRECT_PARTS', 'planDirectParts'],
]
const PLAN_LABELS = Object.fromEntries(PLAN_TYPES)
const LEDGER_LIMIT = 100
const BUDGET_LINE_LIMIT = 200
const PAGE_SIZE = 20

// 深度分析入口：预制指令发送到当前会话，由 Agent 调 mcp__finance__* 完成分析
const ANALYSIS_ENTRIES = [
  { id: 'risk', icon: 'warning', prompt: (year, org) => `请对${org || '全部主体'} ${year} 年度财务状况做一次风险预判：先调用 sensteed_finance_bootstrap 获取租户上下文，再用 mcp__finance__finance_analysis_brief 建立口径基线，然后下钻 mcp__finance__finance_get_alerts 与 mcp__finance__finance_get_budget_summary。按预算超支、执行偏慢、资金缺口、数据质量四类逐项给出：影响金额（元）、涉及主体与期间、严重级别、置信度、建议动作。结论先行，财务口吻。` },
  { id: 'cost', icon: 'layers', prompt: (year, org) => `请分析${org || '全部主体'} ${year} 年成本结构：调用 mcp__finance__finance_analysis_brief 与 mcp__finance__finance_get_budget_summary，按三类费用（项目运营/固定运营/模型专项）与主体维度拆解预算与实际付款占比，识别占比异常漂移与单点集中度风险，给出成本优化建议与下季度成本预判（声明外推方法与假设）。金额单位元，财务口吻。` },
  { id: 'cash', icon: 'goal', prompt: (year, org) => `请对${org || '全部主体'} ${year} 年资金链做压力评估：调用 mcp__finance__finance_get_cash_summary 与 mcp__finance__finance_get_payment_plans，梳理各月期初/收入/支出/预计余额，识别预计余额为负或骤降的月份，结合付款计划给出未来 1-3 个月的资金缺口预判与头寸安排建议。金额单位元，财务口吻。` },
  { id: 'budget', icon: 'data', prompt: (year, org) => `请复盘${org || '全部主体'} ${year} 年预算执行：调用 mcp__finance__finance_get_budget_summary 与 mcp__finance__finance_get_budget_lines，计算各主体的执行率（(已打PR+预计PR)/预算）与实际支付率（实际付款/预算），输出执行率排名、偏离原因归类（录入滞后/计划变更/预算虚高），并给出预算调整建议。金额单位元，财务口吻。` },
  { id: 'revenue', icon: 'sparkle', prompt: (year, org) => `请分析${org || '全部主体'} ${year} 年收入达成与差额：调用 mcp__finance__finance_get_revenue_plans 与 mcp__finance__finance_get_cash_summary，逐项比对计划收入与实际到账，归因未达成项（延期/缩水/未回填），评估对全年资金平衡的影响并给出催收与计划修正建议。金额单位元，财务口吻。` },
  { id: 'quality', icon: 'database', prompt: `请评估财务数据中心当前的数据质量对分析口径的影响：调用 mcp__finance__finance_get_data_quality、mcp__finance__finance_get_import_batches 与 mcp__finance__finance_get_alerts（severity=DATA_QUALITY 或按警情类型判断）。列出问题清单、涉及数据集与数量级，说明哪些分析结论会因此失真，并给出补数与修复的优先级建议。财务口吻。` },
  { id: 'forecast', icon: 'clock', prompt: (year, org) => `请对${org || '全部主体'} ${year} 年剩余期间做成本与资金预判：调用 mcp__finance__finance_analysis_brief 后，按近 3 个月实际付款均值与已打 PR 未付款部分，外推未来支出；结合收入计划到账节奏，给出月末资金余额区间预判（声明方法与假设），并标注高置信/低置信结论。金额单位元，财务口吻。` },
  { id: 'version', icon: 'check', prompt: (year, org) => `请为${org || '全部主体'} ${year} 年预算做一次版本健康检查：调用 mcp__finance__finance_get_budget_versions 查看当前主版本与各草稿/已审定版本，用 finance_budget_version_diff 对比主版本与最新调整稿差异（主体×三类费用），识别：未生效的审定版本、超 30 天未推进的草稿、主版本与实际执行（finance_get_budget_summary）的偏离。给出版本推进建议（审定/生效/作废重排）。财务口吻。` },
  { id: 'rules', icon: 'database', prompt: `请检查预警规则集状态：调用 mcp__finance__finance_get_alert_rules 查看 activeVersion 与各版本阈值；若规则集从未确认生效（无 activeVersion），提示「以内置默认阈值确认生效」的必要性并列出默认阈值；若已生效，用 finance_get_alert_summary 抽查近 30 天告警量是否与阈值预期一致。财务口吻。` },
]

const copy = {
  zh: {
    open: '财务看板', title: '财务专业看板', subtitle: '总览 · 预算 · 经营 · 资金 · 预警 · 数据中心 · 录入 · 深度分析', close: '关闭财务看板', refresh: '刷新数据', operatorAs: '当前操作者',
    tabOverview: '总览', tabBudget: '预算', tabOperations: '经营', tabCash: '资金', tabAlerts: '预警', tabDatacenter: '数据中心', tabEntry: '录入', tabAnalyze: '深度分析',
    year: '年度', org: '主体', allOrgs: '全部主体（集团）', loading: '正在加载财务数据...', retry: '重新加载', loadError: '数据加载失败', refreshedAt: '更新于', unitWan: '万元', unitYuan: '元', unitNote: '单位：万元', total: '合计',
    kpiBudget: '年度预算', kpiPrSubmitted: '已打 PR', kpiPrEstimated: '预计 PR', kpiPaid: '实际付款', kpiAlerts: '未处理预警', kpiExecRate: '预算执行率', kpiPayRate: 'PR 付款率', kpiNetInflow: '实际净流入', kpiRevenueAch: '收入达成', kpiSpendExec: '支出执行', kpiHealth: '预算健康度',
    trendTitle: 'PR 与付款月度趋势', month: '月份', amount: '金额', empty: '暂无数据', orgSummary: '主体预算执行', alertSummary: '未处理预警 TOP5', orgSummaryFull: '分主体汇总', showFirst: '仅显示前 {n} 条，可缩小范围或翻页', partialLoad: '部分数据块加载失败，当前展示已获取部分；刷新可重试。',
    statusOver: '超预算', statusWatch: '关注', statusNormal: '正常', dash: '—', unknown: '未知',
    incomeAch: '收支达成', drill: '下钻',
    // 预算
    viewMatrix: '汇总矩阵', viewMonth: '月度', viewLines: '明细行', viewLedger: 'PR 台账', viewVariance: '差异分析', viewAdjustments: '调整审批', viewAllocations: 'PR 分配', viewVersions: '版本管理',
    budgetSummaryTitle: '预算汇总', budgetLinesTitle: '预算明细行', expenseType: '费用类别', department: '部门', costItem: '费用科目', version: '预算版本', monthCol: '月份', annualTotal: '年度合计', available: '可用(累计)', unassigned: '待分配', clearFilters: '清除筛选', simulated: '模拟',
    prevMonth: '上一月', nextMonth: '下一月', momVs: '较上月', monthKpiBudget: '月度预算', varianceTitle: '预算 → 实际付款差异瀑布', varianceTop10: '差异率 TOP10', varianceRate: '差异率', savedViews: '已存视图', saveView: '保存视图', applyView: '应用', deleteView: '删除', viewName: '视图名称', saveViewFirst: '先保存当前筛选组合，之后一键应用。',
    heatOver: '超支', heatHealthy: '健康', heatSlow: '偏慢', heatEarly: '早期',
    // 调整审批
    adjCreate: '发起调整', adjType: '调整类型', typeNew: '新增预算', typeTransferSame: '同部门调拨', typeTransferCross: '跨部门调拨', typeReduce: '追减', adjReason: '调整原因', adjLines: '调整明细', lineIn: '调入', lineOut: '调出', adjAmount: '金额（元）', adjLineBudget: '预算行', adjTargetOrg: '调入主体', adjTargetDept: '调入部门', adjTargetMonth: '调入月份', adjGuard: '调拨金额必须守恒（调入合计 = 调出合计）', adjGuardBad: '调入合计 ≠ 调出合计，请核对金额',
    stDraft: '草稿', stSubmitted: '待审批', stApproved: '待过账', stPosted: '已过账', stRejected: '已驳回', stCancelled: '已撤销', stAll: '全部状态',
    actSubmit: '提交审批', actApprove: '批准', actReject: '驳回', actPost: '过账', actCancel: '撤销', actDetail: '详情', rejectReason: '驳回理由（必填）', cancelReason: '撤销原因', flow: '状态流水', adjustmentOf: '调整单', inOut: '方向',
    // 分配
    allocPool: '待认领池', allocPick: '自选预算行', allocOneClick: '一键挂账', allocConfirm: '确认挂账', allocRecent: '最近分配', allocRemove: '撤销分配', suggestion: '建议', score: '分数', pickLine: '选择预算行',
    // 版本
    verName: '版本名称', verType: '类型', verStatus: '状态', verLines: '行数', isPrimary: '主版本', primaryTag: '主', verConfirm: '审定', verActivate: '生效', verLock: '锁定', verClone: '复制为草稿', verDiff: '版本对比', diffBase: '基准版本', diffTarget: '对比版本', diffAmount: '预算差异', vstDraft: '草稿', vstConfirmed: '已审定', vstPublished: '已生效', vstLocked: '已锁定', verActions: '操作',
    // 递延规则
    carryoverRules: '递延规则', carryoverMode: '结转方式', modeFull: '全额结转', modePercent: '比例结转', modeExpire: '过期清零', percent: '比例(%)', expireMonth: '过期月份', ruleEnabled: '启用', ruleDisabled: '停用', ruleAdd: '新增规则', ruleToggle: '启停', ruleRemove: '删除',
    // 经营
    opTheme: '经营分析主题框架', theme: '主题', metric: '指标', dataSource: '数据源', readiness: '就绪度', ready: '就绪', pending: '待接入', costMix: '费用构成', share: '占比', netFlowTitle: '收支净额（按月）', netInflow: '净流入', netOutflow: '净流出',
    // 资金
    cashSummaryV: '资金汇总', cashPlans: '排款工作台', cashAdjustments: '调增审批', cashRevenue: '收入计划', cashMatrix: '资金矩阵（主体 × 月）', prevEndBalance: '上月末余额', plannedIncome: '预计收入', plannedExpense: '预计支出', projectedBalance: '预计余额', actualIncome: '实际收入', actualExpense: '实际支出', actualBalance: '实际余额',
    schedule: '排款', scheduleDate: '排款日期', priority: '优先级', priHigh: '高', priMid: '中', priLow: '低', acceptAcceptance: '接受承兑', cashAmount: '现汇金额（元）', acceptanceAmount: '承兑金额（元）', planDetail: '计划详情', increase: '申请调增', newAmount: '调增后金额（元）', increaseReason: '调增理由（必填）', increaseHint: '调增后金额必须大于当前计划金额', payee: '收款方', planMonth: '排款月份', planMonthRequired: '排款月份必填', statusCol: '状态',
    revenueVs: '计划 vs 实际到账',
    // 预警
    alertsTitle: '预警清单', sevCritical: '重大', sevWarn: '警告', sevInfo: '提示', sevResolved: '已解决', stPending: '待处理', stConfirmed: '已确认', stResolved: '已解决', stIgnored: '已忽略', alertType: '类型', alertTitleCol: '标题', detail: '说明', firstSeen: '首次发现', lastSeen: '最近出现', alertMonth: '月份',
    rulesUnconfirmed: '预警规则集尚未确认生效：当前不生成正式告警。以内置默认阈值确认后规则引擎才开始产出。', rulesConfirmed: '预警规则集 v{v} 已生效（{date} 确认）', confirmDefaultRules: '以内置默认阈值确认生效', confirmRulesTitle: '确认预警规则集', alertDetail: '预警详情', evidence: '证据快照', viewSource: '查看源数据', sourceBudget: '下钻预算', sourceCash: '下钻资金', sourceQuality: '下钻数据质量',
    // 数据中心
    dsConfigs: '数据源配置', dsScope: '范围', scopeHq: '总部', scopeHezhong: '合众', dsKind: '类型', kindDss: 'DSS', kindFeishu: '飞书', dsEndpoint: '端点', dsEnabled: '启用', dsEnable: '启用', dsDisable: '停用', dsRuns: '同步批次', dsFallback: '回退原因', datasetScale: '数据集入库规模', qualityTitle: '数据质量清单', batchesTitle: '导入批次', issue: '问题', dataset: '数据集', count: '数量', sourceFile: '来源文件', rows: '行数', successRows: '成功', failedRows: '失败', batchStatus: '状态', startedAt: '开始时间', runAt: '批次时间', bizType: '业务类型',
    // 录入
    filingTasks: '任务管理（财务）', myFiling: '我的填报（部门）', createTask: '发起任务', taskTitle: '任务名称', taskType: '类型', typeBudget: '预算', typePlan: '排款', taskYear: '年度', taskMonth: '月份', taskDue: '截止时间', taskDepartments: '指派部门（可多选）', taskProgress: '任务进度', closeTask: '关闭任务', taskClosed: '已关闭', departmentCol: '部门', progressCol: '进度', dueCol: '截止', assignmentTitle: '填报明细', rowsEditor: '行编辑（月份 / 说明 / 金额）', addRow: '加一行', saveDraft: '暂存草稿', submitFiling: '提交', commitFiling: '复核定稿', reopenFiling: '重开', reopenReason: '重开原因（必填，并入审计）', overdue: '已超期', assignee: '填报人',
    directory: '飞书通讯录', dirSync: '同步通讯录', dirSearch: '搜索姓名/手机/邮箱', mapUser: '绑定用户', systemUserId: '系统用户 ID', unmappedOnly: '只看未绑定', employmentRecords: '归属记录（调岗切分）', empCreate: '登记归属', empUser: '系统用户', empDept: '归属部门', empStart: '起始日期', membersTitle: '成员与角色', role: '角色', roleNameDEPT_FILLER: '部门填报人', roleNameDEPT_LEADER: '部门负责人', roleNameDEPT_COLLABORATOR: '信息协同人', roleNameBOSS: '老板', roleNameFINANCE_STAFF: '财务专员', roleNameFINANCE_OWNER: '财务负责人', roleNameMANAGEMENT: '管理层', removeMember: '移除', memberUser: '用户', memberDept: '部门', enabledCol: '启用',
    entryTitle: '财务数据录入', entryPaymentPlan: '付款计划', entryRevenuePlan: '收入计划', entryBudgetLine: '预算行', entryBackfill: '回填实际', description: '付款描述', planType: '计划类型', note: '备注', itemName: '收入项目', payer: '付款方', incomeType: '收入类型', recordType: 'PR 类型', prSubmittedL: '已打 PR', prEstimatedL: '预计 PR', selectPlan: '选择计划', actualAmountL: '实际金额（元）', actualDateL: '实际日期（可空）', entryHint: '录入直接写入财务数据中心；提交前请核对金额与期间。提交后建议在预警页触发一次规则引擎。', entryRules: '录入规则', entryRulesList: '金额一律为元；排款月份必填；预算行挂当年主版本；回填实际自动重算差额与剩余。', preCheck: '录入前检查', preCheckOk: '数据质量正常，可以录入', preCheckBad: '存在未分配主体记录 {n} 条，建议先完成分配再录入',
    // 深度分析
    analysis_risk: '月度风险预判', analysis_risk_desc: '按预算超支/执行偏慢/资金缺口/数据质量四类输出风险清单，附影响金额与建议动作。',
    analysis_cost: '成本结构分析', analysis_cost_desc: '三类费用与主体维度拆解成本占比，识别集中度风险并预判下季度成本。',
    analysis_cash: '资金流压力评估', analysis_cash_desc: '梳理各月资金余缺，预判未来 1-3 个月资金缺口与头寸安排。',
    analysis_budget: '预算执行复盘', analysis_budget_desc: '各主体执行率排名与偏离归因，输出预算调整建议。',
    analysis_revenue: '收入达成分析', analysis_revenue_desc: '计划 vs 实际到账逐项比对，归因差额并评估对资金平衡的影响。',
    analysis_quality: '数据质量影响评估', analysis_quality_desc: '列出质量问题清单，说明哪些分析结论会失真及补数优先级。',
    analysis_forecast: '成本与资金预判', analysis_forecast_desc: '按近 3 个月外推未来支出与月末资金余额区间，标注置信度。',
    analysis_version: '版本健康检查', analysis_version_desc: '主版本与调整稿差异、未推进草稿与版本推进建议。',
    analysis_rules: '预警规则核查', analysis_rules_desc: '规则集生效状态、默认阈值与近 30 天告警量核对。',
    analyzeTitle: '深度分析入口', analyzeHint: '以下入口会把预制指令发送到当前会话，由 Agent 调用财务数据中心 MCP（mcp__finance__*）完成深度分析，产出财务口吻的风险与成本预判。', send: '开始分析', sent: '已发送到会话', sendFail: '发送失败，指令已复制到剪贴板', analyzingNote: '分析会读取真实账面数据；录入/回填类操作 Agent 会先与你确认再执行。审批与过账由财务本人执行，Agent 不代批。',
    // 通用动作
    submit: '提交', cancel: '取消', submitted: '已提交', saved: '已保存', deleted: '已删除', confirm: '确认', close: '关闭', actions: '操作', runEngine: '触发预警引擎', running: '执行中', runDone: '已触发：新建 {created} · 更新 {updated} · 关闭 {resolved}', backfill: '回填', backfillActual: '回填实际值', submitConfirm: '确认提交？', opFailed: '操作失败', refreshed: '已刷新', required: '必填',
  },
  en: {
    open: 'Finance', title: 'Finance Workspace', subtitle: 'Overview · Budget · Operations · Cash · Alerts · Data center · Entry · Deep analysis', close: 'Close finance workspace', refresh: 'Refresh', operatorAs: 'Operating as',
    tabOverview: 'Overview', tabBudget: 'Budget', tabOperations: 'Operations', tabCash: 'Cash', tabAlerts: 'Alerts', tabDatacenter: 'Data center', tabEntry: 'Entry', tabAnalyze: 'Deep analysis',
    year: 'Year', org: 'Org', allOrgs: 'All orgs (group)', loading: 'Loading finance data...', retry: 'Retry', loadError: 'Failed to load', refreshedAt: 'Updated', unitWan: '10k CNY', unitYuan: 'CNY', unitNote: 'Unit: 10k CNY', total: 'Total',
    kpiBudget: 'Annual budget', kpiPrSubmitted: 'PR submitted', kpiPrEstimated: 'PR estimated', kpiPaid: 'Paid', kpiAlerts: 'Open alerts', kpiExecRate: 'Execution rate', kpiPayRate: 'PR payment rate', kpiNetInflow: 'Net inflow', kpiRevenueAch: 'Revenue attainment', kpiSpendExec: 'Spend execution', kpiHealth: 'Budget health',
    trendTitle: 'PR & payment monthly trend', month: 'Month', amount: 'Amount', empty: 'No data', orgSummary: 'Budget execution by org', alertSummary: 'Top 5 open alerts', orgSummaryFull: 'By org', showFirst: 'Showing first {n} rows; narrow or paginate', partialLoad: 'Some blocks failed to load; showing what succeeded. Refresh to retry.',
    statusOver: 'Over', statusWatch: 'Watch', statusNormal: 'Normal', dash: '—', unknown: 'Unknown',
    incomeAch: 'Income vs expense', drill: 'Drill down',
    viewMatrix: 'Matrix', viewMonth: 'Monthly', viewLines: 'Lines', viewLedger: 'PR ledger', viewVariance: 'Variance', viewAdjustments: 'Adjustments', viewAllocations: 'Allocations', viewVersions: 'Versions',
    budgetSummaryTitle: 'Budget summary', budgetLinesTitle: 'Budget lines', expenseType: 'Expense type', department: 'Department', costItem: 'Cost item', version: 'Version', monthCol: 'Month', annualTotal: 'Annual total', available: 'Available', unassigned: 'Unassigned', clearFilters: 'Clear filters', simulated: 'Sim',
    prevMonth: 'Prev month', nextMonth: 'Next month', momVs: 'vs prev', monthKpiBudget: 'Monthly budget', varianceTitle: 'Budget → paid waterfall', varianceTop10: 'Top 10 variance', varianceRate: 'Variance rate', savedViews: 'Saved views', saveView: 'Save view', applyView: 'Apply', deleteView: 'Delete', viewName: 'View name', saveViewFirst: 'Save the current filter combo to re-apply it later.',
    heatOver: 'Over', heatHealthy: 'Healthy', heatSlow: 'Slow', heatEarly: 'Early',
    adjCreate: 'New adjustment', adjType: 'Type', typeNew: 'New budget', typeTransferSame: 'Transfer (same dept)', typeTransferCross: 'Transfer (cross dept)', typeReduce: 'Reduce', adjReason: 'Reason', adjLines: 'Lines', lineIn: 'IN', lineOut: 'OUT', adjAmount: 'Amount (CNY)', adjLineBudget: 'Budget line', adjTargetOrg: 'Target org', adjTargetDept: 'Target dept', adjTargetMonth: 'Target month', adjGuard: 'Transfers must conserve amount (IN total = OUT total)', adjGuardBad: 'IN total ≠ OUT total, please check',
    stDraft: 'Draft', stSubmitted: 'Pending approval', stApproved: 'Pending posting', stPosted: 'Posted', stRejected: 'Rejected', stCancelled: 'Cancelled', stAll: 'All',
    actSubmit: 'Submit', actApprove: 'Approve', actReject: 'Reject', actPost: 'Post', actCancel: 'Cancel', actDetail: 'Detail', rejectReason: 'Reject reason (required)', cancelReason: 'Cancel reason', flow: 'Status flow', adjustmentOf: 'Adjustment', inOut: 'Side',
    allocPool: 'Unclaimed pool', allocPick: 'Pick budget line', allocOneClick: 'One-click assign', allocConfirm: 'Confirm assign', allocRecent: 'Recent allocations', allocRemove: 'Remove', suggestion: 'Suggestion', score: 'Score', pickLine: 'Pick a budget line',
    verName: 'Name', verType: 'Type', verStatus: 'Status', verLines: 'Lines', isPrimary: 'Primary', primaryTag: 'P', verConfirm: 'Confirm', verActivate: 'Activate', verLock: 'Lock', verClone: 'Clone as draft', verDiff: 'Compare', diffBase: 'Base', diffTarget: 'Target', diffAmount: 'Budget diff', vstDraft: 'Draft', vstConfirmed: 'Confirmed', vstPublished: 'Active', vstLocked: 'Locked', verActions: 'Actions',
    carryoverRules: 'Carryover rules', carryoverMode: 'Mode', modeFull: 'Full carry', modePercent: 'Percent', modeExpire: 'Expire', percent: 'Percent (%)', expireMonth: 'Expire month', ruleEnabled: 'Enabled', ruleDisabled: 'Disabled', ruleAdd: 'Add rule', ruleToggle: 'Toggle', ruleRemove: 'Remove',
    opTheme: 'Operations topic framework', theme: 'Topic', metric: 'Metric', dataSource: 'Source', readiness: 'Readiness', ready: 'Ready', pending: 'Pending', costMix: 'Cost mix', share: 'Share', netFlowTitle: 'Net flow (monthly)', netInflow: 'Inflow', netOutflow: 'Outflow',
    cashSummaryV: 'Cash summary', cashPlans: 'Payment plans', cashAdjustments: 'Increase approvals', cashRevenue: 'Revenue plans', cashMatrix: 'Cash matrix (org × month)', prevEndBalance: 'Prev end balance', plannedIncome: 'Planned income', plannedExpense: 'Planned expense', projectedBalance: 'Projected balance', actualIncome: 'Actual income', actualExpense: 'Actual expense', actualBalance: 'Actual balance',
    schedule: 'Schedule', scheduleDate: 'Schedule date', priority: 'Priority', priHigh: 'High', priMid: 'Mid', priLow: 'Low', acceptAcceptance: 'Accept acceptance', cashAmount: 'Cash amount (CNY)', acceptanceAmount: 'Acceptance amount (CNY)', planDetail: 'Plan detail', increase: 'Request increase', newAmount: 'New amount (CNY)', increaseReason: 'Reason (required)', increaseHint: 'New amount must exceed the current planned amount', payee: 'Payee', planMonth: 'Plan month', planMonthRequired: 'Plan month is required', statusCol: 'Status',
    revenueVs: 'Planned vs actual',
    alertsTitle: 'Alerts', sevCritical: 'Critical', sevWarn: 'Warn', sevInfo: 'Info', sevResolved: 'Resolved', stPending: 'Open', stConfirmed: 'Confirmed', stResolved: 'Resolved', stIgnored: 'Ignored', alertType: 'Type', alertTitleCol: 'Title', detail: 'Detail', firstSeen: 'First seen', lastSeen: 'Last seen', alertMonth: 'Month',
    rulesUnconfirmed: 'Alert rule set is not confirmed yet: no formal alerts are generated. Confirm with built-in defaults to start the engine.', rulesConfirmed: 'Alert rule set v{v} active (confirmed {date})', confirmDefaultRules: 'Confirm with built-in defaults', confirmRulesTitle: 'Confirm alert rules', alertDetail: 'Alert detail', evidence: 'Evidence', viewSource: 'View source data', sourceBudget: 'Budget', sourceCash: 'Cash', sourceQuality: 'Data quality',
    dsConfigs: 'Data source configs', dsScope: 'Scope', scopeHq: 'HQ', scopeHezhong: 'Hezhong', dsKind: 'Kind', kindDss: 'DSS', kindFeishu: 'Feishu', dsEndpoint: 'Endpoint', dsEnabled: 'Enabled', dsEnable: 'Enable', dsDisable: 'Disable', dsRuns: 'Sync runs', dsFallback: 'Fallback', datasetScale: 'Dataset scale', qualityTitle: 'Data quality', batchesTitle: 'Import batches', issue: 'Issue', dataset: 'Dataset', count: 'Count', sourceFile: 'Source file', rows: 'Rows', successRows: 'OK', failedRows: 'Failed', batchStatus: 'Status', startedAt: 'Started', runAt: 'Run at', bizType: 'Biz type',
    filingTasks: 'Tasks (finance)', myFiling: 'My filing (dept)', createTask: 'New task', taskTitle: 'Title', taskType: 'Type', typeBudget: 'Budget', typePlan: 'Payment plan', taskYear: 'Year', taskMonth: 'Month', taskDue: 'Due', taskDepartments: 'Departments', taskProgress: 'Progress', closeTask: 'Close task', taskClosed: 'Closed', departmentCol: 'Department', progressCol: 'Progress', dueCol: 'Due', assignmentTitle: 'Assignment detail', rowsEditor: 'Rows (month / note / amount)', addRow: 'Add row', saveDraft: 'Save draft', submitFiling: 'Submit', commitFiling: 'Finalize', reopenFiling: 'Reopen', reopenReason: 'Reopen reason (required, audited)', overdue: 'Overdue', assignee: 'Assignee',
    directory: 'Feishu directory', dirSync: 'Sync directory', dirSearch: 'Search name/phone/email', mapUser: 'Map user', systemUserId: 'System user ID', unmappedOnly: 'Unmapped only', employmentRecords: 'Employment records', empCreate: 'Add record', empUser: 'User', empDept: 'Department', empStart: 'Start date', membersTitle: 'Members & roles', role: 'Role', roleNameDEPT_FILLER: 'Dept filler', roleNameDEPT_LEADER: 'Dept leader', roleNameDEPT_COLLABORATOR: 'Collaborator', roleNameBOSS: 'Boss', roleNameFINANCE_STAFF: 'Finance staff', roleNameFINANCE_OWNER: 'Finance owner', roleNameMANAGEMENT: 'Management', removeMember: 'Remove', memberUser: 'User', memberDept: 'Dept', enabledCol: 'Enabled',
    entryTitle: 'Finance data entry', entryPaymentPlan: 'Payment plan', entryRevenuePlan: 'Revenue plan', entryBudgetLine: 'Budget line', entryBackfill: 'Backfill actuals', description: 'Description', planType: 'Plan type', note: 'Note', itemName: 'Item', payer: 'Payer', incomeType: 'Income type', recordType: 'PR type', prSubmittedL: 'Submitted', prEstimatedL: 'Estimated', selectPlan: 'Pick a plan', actualAmountL: 'Actual amount (CNY)', actualDateL: 'Actual date (optional)', entryHint: 'Entries write to the finance data center directly. Verify amounts and periods before submitting; run the alert engine afterwards.', entryRules: 'Entry rules', entryRulesList: 'Amounts in CNY; plan month required; budget lines attach to the primary version; backfill recalculates variance and remaining.', preCheck: 'Pre-check', preCheckOk: 'Data quality OK, safe to enter', preCheckBad: '{n} unassigned-org records; assign them first',
    analysis_risk: 'Risk forecast', analysis_risk_desc: 'Risk list across overrun / slow execution / cash gap / data quality, with impact and actions.',
    analysis_cost: 'Cost structure', analysis_cost_desc: 'Cost mix by expense type and org, concentration risks, next-quarter cost forecast.',
    analysis_cash: 'Cash pressure', analysis_cash_desc: 'Monthly cash surplus/deficit and 1-3 month gap forecast.',
    analysis_budget: 'Budget review', analysis_budget_desc: 'Execution-rate ranking by org with deviation attribution and adjustment advice.',
    analysis_revenue: 'Revenue attainment', analysis_revenue_desc: 'Plan vs actual receipts with variance attribution.',
    analysis_quality: 'Data quality impact', analysis_quality_desc: 'Issue list, which conclusions are distorted, and remediation priorities.',
    analysis_forecast: 'Cost & cash forecast', analysis_forecast_desc: '3-month-average extrapolation with confidence labels.',
    analysis_version: 'Version health', analysis_version_desc: 'Primary vs adjusted diff, stale drafts, and version progression advice.',
    analysis_rules: 'Alert rules check', analysis_rules_desc: 'Rule set status, default thresholds, and 30-day alert volume check.',
    analyzeTitle: 'Deep analysis entries', analyzeHint: 'Each entry sends a prepared instruction to the current conversation; the agent calls finance MCP tools (mcp__finance__*) and returns CFO-tone forecasts.', send: 'Analyze', sent: 'Sent to conversation', sendFail: 'Send failed; copied to clipboard', analyzingNote: 'Analysis reads real ledger data; write actions always require your confirmation first. Approvals and posting are done by finance users, never the agent.',
    submit: 'Submit', cancel: 'Cancel', submitted: 'Submitted', saved: 'Saved', deleted: 'Deleted', confirm: 'Confirm', close: 'Close', actions: 'Actions', runEngine: 'Run alert engine', running: 'Running...', runDone: 'Done: created {created} · updated {updated} · resolved {resolved}', backfill: 'Backfill', backfillActual: 'Backfill actuals', submitConfirm: 'Confirm submit?', opFailed: 'Operation failed', refreshed: 'Refreshed', required: 'required',
  },
}

// ---- 打开/关闭状态（overlay 互斥） ----

let opened = false
let lastTrigger = null
const listeners = new Set()
const emit = () => listeners.forEach(listener => listener())
const setOpened = value => { opened = value; emit() }
const openOverlay = event => { lastTrigger = event?.currentTarget || document.activeElement; window.dispatchEvent(new CustomEvent(OVERLAY_EVENT, { detail: { id: OVERLAY_ID } })); setOpened(true) }
const closeOverlay = () => { setOpened(false); requestAnimationFrame(() => lastTrigger?.focus?.()) }
const closeOtherOverlay = event => { if (event.detail?.id !== OVERLAY_ID) setOpened(false) }
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => opened

async function api(path, options, cancellation) {
  const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(cancellation ? [cancellation] : [])]), ...options })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || body.ok === false) throw new Error(body?.error || `http_${response.status}`)
  return body
}

// 统一写操作入口：POST 代理路由；op 缺省由宿主凭据注入
async function post(path, payload) {
  return api(path, { method: 'POST', body: JSON.stringify(payload || {}) })
}
