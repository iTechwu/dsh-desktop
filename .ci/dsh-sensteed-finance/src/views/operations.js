// 片段 5/7 视图：经营（对齐前端 operations-section：3 KPI + 主题框架表 + 费用构成 + 三系列趋势 + 收支净额）

/** 经营分析主题框架（与前端 operations-section 同源的静态规划表） */
const OP_TOPICS = [
  ['预算执行', '预算执行率 / 支付率', '预算汇总 + 付款台账', true],
  ['资金链', '月度余额 / 缺口月份', '资金汇总', true],
  ['收入达成', '计划 vs 实际到账', '收入计划', true],
  ['成本结构', '三类费用占比与漂移', '预算汇总（三类费用）', true],
  ['数据质量', '未分配主体 / 缺失金额', '数据质量清单', true],
  ['项目毛利', '项目维度收入-成本', '项目台账（待导入）', false],
  ['人效', '人均产出 / 部门人力成本', '归属记录 + 薪酬（待导入）', false],
]

function OperationsView({ brief, t, onDrill }) {
  if (!brief) return h(EmptyState, null, t('empty'))
  const data = brief.data || brief
  const overview = data.overview || {}
  const m = overview.metrics || {}
  const trend = overview.trend || []
  const cashList = data.cash?.list || []
  const budgetSummary = data.budget?.list || []
  const budgetTotals = data.budget?.totals

  const exec = execRateOf(m.prSubmittedAmount, m.prEstimatedAmount, m.budgetAmount)
  const payRate = ratio(m.paidAmount, m.prSubmittedAmount)
  const totals = cashList.reduce((acc, row) => {
    acc.actualIncome += finite(row.actualIncome) ?? 0
    acc.actualExpense += finite(row.actualExpense) ?? 0
    return acc
  }, { actualIncome: 0, actualExpense: 0 })
  const netTotal = totals.actualIncome - totals.actualExpense

  // 费用构成：年度合计行按三类费用聚合（无合计行时逐行累加）
  const byType = {}
  for (const row of budgetSummary) {
    const key = row.expenseType || 'OTHER'
    byType[key] = (byType[key] ?? 0) + (finite(row.budgetAmount) ?? 0)
  }
  if (budgetTotals && !budgetSummary.length) {
    for (const key of Object.keys(EXPENSE_LABELS)) byType[key] = finite(budgetTotals[key]) ?? 0
  }
  const shareTones = ['a', 'b', 'c', 'd']
  const shareSegments = Object.entries(byType).map(([key, value], index) => ({
    label: EXPENSE_LABELS[key] ?? key, value, tone: shareTones[index % shareTones.length],
  }))

  const netByMonth = new Map()
  for (const row of cashList) {
    const label = `${row.year}-${String(row.month).padStart(2, '0')}`
    const income = finite(row.actualIncome) ?? finite(row.plannedIncome) ?? 0
    const expense = finite(row.actualExpense) ?? finite(row.plannedExpense) ?? 0
    netByMonth.set(label, (netByMonth.get(label) ?? 0) + income - expense)
  }
  const netData = [...netByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label: label.slice(5), value }))

  const trendData = trend.map(point => ({
    label: String(point.month).padStart(2, '0'),
    prSubmitted: finite(point.prSubmittedAmount),
    prEstimated: finite(point.prEstimatedAmount),
    paid: finite(point.paidAmount),
  }))

  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-kpis' },
      h(KpiCard, { icon: 'data', label: t('kpiExecRate'), value: ratio(exec, 1) ?? '—', hint: `${t('kpiBudget')} ${wan(m.budgetAmount) ?? '—'}`, onClick: () => onDrill('budget') }),
      h(KpiCard, { icon: 'plan', label: t('kpiPayRate'), value: payRate ?? '—', hint: `${t('kpiPrSubmitted')} ${wan(m.prSubmittedAmount) ?? '—'}`, onClick: () => onDrill('budget', { view: 'ledger' }) }),
      h(KpiCard, { icon: 'goal', label: t('kpiNetInflow'), value: wan(netTotal), hint: `↑${wan(totals.actualIncome) ?? '—'} / ↓${wan(totals.actualExpense) ?? '—'}`, hintTone: netTotal >= 0 ? 'up' : 'down', negative: netTotal < 0, onClick: () => onDrill('cash') })),
    h(Card, { title: t('opTheme') }, h(Table, {
      columns: [
        { label: t('theme'), key: '0' },
        { label: t('metric'), key: '1' },
        { label: t('dataSource'), key: '2' },
        { label: t('readiness'), render: row => row[3] ? h(Pill, { tone: 'green' }, t('ready')) : h(Pill, { tone: 'muted' }, t('pending')) },
      ],
      rows: OP_TOPICS, empty: t('empty'),
    })),
    h(Card, { title: t('costMix'), unit: t('unitNote') }, h(StackedShare, { segments: shareSegments })),
    h(Card, { title: t('trendTitle'), unit: t('unitNote') },
      h(GroupedBars, {
        data: trendData,
        series: [
          { key: 'prSubmitted', label: t('kpiPrSubmitted'), tone: 'a' },
          { key: 'prEstimated', label: t('kpiPrEstimated'), tone: 'b' },
          { key: 'paid', label: t('kpiPaid'), tone: 'c' },
        ],
      })),
    h(Card, { title: t('netFlowTitle'), unit: t('unitNote') }, h(NetBars, { data: netData })))
}
