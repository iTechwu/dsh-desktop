// 片段 5/7 视图：预算（八子视图：汇总矩阵/月度/明细行/PR 台账/差异分析/调整审批/PR 分配/版本管理）
// 筛选：费用类别/部门/版本/月份/待分配 + 保存视图；写操作走宿主代理 POST 路由。

const BUDGET_VIEWS = [
  ['matrix', 'viewMatrix'], ['month', 'viewMonth'], ['lines', 'viewLines'], ['ledger', 'viewLedger'],
  ['variance', 'viewVariance'], ['adjustments', 'viewAdjustments'], ['allocations', 'viewAllocations'], ['versions', 'viewVersions'],
]
const ADJ_TYPES = [['NEW_BUDGET', 'typeNew'], ['TRANSFER_SAME_DEPT', 'typeTransferSame'], ['TRANSFER_CROSS_DEPT', 'typeTransferCross'], ['REDUCE', 'typeReduce']]
const ADJ_STATUSES = [
  ['SUBMITTED', 'stSubmitted'], ['APPROVED', 'stApproved'], ['DRAFT', 'stDraft'],
  ['POSTED', 'stPosted'], ['REJECTED', 'stRejected'], ['', 'stAll'],
]

/** 把月度数字（1-12/null）格式化为 MM */
const mm = month => (month == null ? '—' : String(month).padStart(2, '0'))

/** 预算行选择器的行标签 */
const lineLabel = line => [line.orgName, line.departmentName, line.costItemName, line.month != null ? mm(line.month) + '月' : null].filter(Boolean).join(' / ')

function BudgetView({ ctx, t }) {
  const { year, orgId, orgs, departments, revision } = ctx
  const [view, setView] = useState('matrix')
  const [filters, setFilters] = useState({ expenseType: '', departmentId: '', versionId: '', month: '', unassigned: false })
  const [page, setPage] = useState(1)
  const [budget, setBudget] = useState(null) // { summary, lines }
  const [pr, setPr] = useState(null)
  const [versions, setVersions] = useState(null) // 筛选条里的版本下拉也用
  const [savedViews, setSavedViews] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null) // {kind, ...payload}
  // 写操作后递增，驱动当前子视图重拉（各子视图把它并入取数依赖）
  const [reloadTick, setReloadTick] = useState(0)

  const query = (extra = {}) => {
    const params = new URLSearchParams({ year })
    if (orgId) params.set('orgId', orgId)
    if (filters.expenseType) params.set('expenseType', filters.expenseType)
    if (filters.departmentId) params.set('departmentId', filters.departmentId)
    if (filters.versionId) params.set('versionId', filters.versionId)
    if (filters.month) params.set('month', filters.month)
    if (filters.unassigned) params.set('unassigned', '1')
    for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== '') params.set(key, value)
    return params.toString()
  }

  // 汇总/月度/明细/差异共用 /budget；台账用 /pr；版本下拉与保存视图独立拉取
  useEffect(() => { setNotice(null) }, [revision])
  useEffect(() => {
    let cancelled = false
    if (view === 'matrix' || view === 'month' || view === 'lines' || view === 'variance') {
      api(`/budget?${query({ page, limit: BUDGET_LINE_LIMIT })}`).then(value => { if (!cancelled) setBudget(value) }).catch(() => { if (!cancelled) setBudget({ error: true }) })
    }
    if (view === 'ledger') {
      api(`/pr?${query({ page, limit: PAGE_SIZE })}`).then(value => { if (!cancelled) setPr(value) }).catch(() => { if (!cancelled) setPr({ error: true }) })
    }
    return () => { cancelled = true }
  }, [view, page, year, orgId, filters.expenseType, filters.departmentId, filters.versionId, filters.month, filters.unassigned, revision, reloadTick])

  useEffect(() => {
    api(`/budget-versions?year=${year}`).then(value => setVersions(value.data ?? { list: [] })).catch(() => setVersions({ list: [] }))
    api('/saved-views').then(value => setSavedViews(value.data ?? { list: [] })).catch(() => setSavedViews({ list: [] }))
  }, [year, revision])

  // 统一写操作：成功后提示 + 递增 reloadTick 让子视图重拉
  const act = async (path, payload, doneMessage) => {
    setBusy(true); setNotice(null)
    try {
      await post(path, payload)
      setNotice(doneMessage ?? t('submitted'))
      setReloadTick(value => value + 1)
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { setBusy(false) }
  }

  const activeCount = ['expenseType', 'departmentId', 'versionId', 'month'].filter(key => filters[key]).length + (filters.unassigned ? 1 : 0)
  const filterBar = h('div', { className: 'sf-filters' },
    h(Select, { value: filters.expenseType, onChange: value => { setPage(1); setFilters(f => ({ ...f, expenseType: value })) }, options: EXPENSE_TYPES, placeholder: t('expenseType') }),
    h(Select, { value: filters.departmentId, onChange: value => { setPage(1); setFilters(f => ({ ...f, departmentId: value })) }, options: (departments || []).map(d => [d.id, d.name]), placeholder: t('department') }),
    h(Select, { value: filters.month, onChange: value => { setPage(1); setFilters(f => ({ ...f, month: value })) }, options: Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1} 月`]), placeholder: t('monthCol') }),
    view === 'matrix' || view === 'lines' ? h(Select, { value: filters.versionId, onChange: value => { setPage(1); setFilters(f => ({ ...f, versionId: value })) }, options: (versions?.list || []).map(v => [v.id, `${v.name}${v.isPrimary ? '（主）' : ''}`]), placeholder: t('version') }) : null,
    view === 'matrix' || view === 'lines' ? h('label', { className: 'sf-row', style: { gap: 6, fontSize: 12, color: 'var(--sf-ink2)' } },
      h('input', { type: 'checkbox', checked: filters.unassigned, onChange: event => { setPage(1); setFilters(f => ({ ...f, unassigned: event.target.checked })) } }), t('unassigned')) : null,
    activeCount > 0 ? h(LinkButton, { onClick: () => { setPage(1); setFilters({ expenseType: '', departmentId: '', versionId: '', month: '', unassigned: false }) } }, `${t('clearFilters')} (${activeCount})`) : null)

  const savedViewsBar = h('div', { className: 'sf-row' },
    ...(savedViews?.list || []).map(item => h('span', { key: item.id, className: 'sf-pill sf-pill-muted' },
      item.name,
      h(LinkButton, { style: { marginLeft: 6 }, onClick: () => {
        const q = item.query || {}
        setFilters({ expenseType: q.expenseType || '', departmentId: q.departmentId || '', versionId: q.versionId || '', month: q.month || '', unassigned: q.unassigned === '1' })
        if (q.view) setView(q.view)
      } }, t('applyView')),
      h(LinkButton, { style: { marginLeft: 4 }, onClick: () => act(`/saved-views/delete`, { id: item.id }, t('deleted')).then(() => api('/saved-views').then(value => setSavedViews(value.data ?? { list: [] })).catch(() => {})) }, '×'))),
    h(LinkButton, { onClick: () => setDialog({ kind: 'saveView' }) }, t('saveView')))

  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-row-between' },
      h(PillTabs, { tabs: BUDGET_VIEWS, value: view, onChange: id => { setView(id); setPage(1) }, t }),
      savedViewsBar),
    h('div', { className: 'sf-row-between' }, filterBar, notice ? h(Notice, null, notice) : null),

    view === 'matrix' ? h(MatrixView, { budget, t, onCell: cell => { setFilters(f => ({ ...f, month: cell.month ? String(cell.month) : '' })); setView('lines') } }) : null,
    view === 'month' ? h(MonthView, { budget, t }) : null,
    view === 'lines' ? h(LinesView, { budget, page, onPage: setPage, t, onDetail: line => setDialog({ kind: 'lineDetail', line }) }) : null,
    view === 'ledger' ? h(LedgerView, { pr, page, onPage: setPage, t }) : null,
    view === 'variance' ? h(VarianceView, { budget, t }) : null,
    view === 'adjustments' ? h(AdjustmentsView, { page, onPage: setPage, t, busy, revision, reloadTick, act, onDialog: setDialog }) : null,
    view === 'allocations' ? h(AllocationsView, { query, page, onPage: setPage, t, revision, reloadTick, act, onDialog: setDialog }) : null,
    view === 'versions' ? h(VersionsView, { versions, year, t, revision, reloadTick, act, onDialog: setDialog }) : null,

    dialog?.kind === 'saveView' ? h(SaveViewDialog, { view, filters, t, onClose: () => setDialog(null), onSaved: value => setSavedViews(value) }) : null,
    dialog?.kind === 'lineDetail' ? h(LineDetailDialog, { line: dialog.line, t, onClose: () => setDialog(null) }) : null,
    dialog?.kind === 'adjCreate' ? h(AdjustCreateDialog, { year, orgs, lines: budget?.lines?.list || [], t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'reason' ? h(ReasonDialog, { title: dialog.title, required: dialog.required, t, onClose: () => setDialog(null), onSubmit: reason => { setDialog(null); return dialog.run(reason) } }) : null,
    dialog?.kind === 'adjDetail' ? h(AdjustDetailDialog, { id: dialog.id, t, onClose: () => setDialog(null) }) : null,
    dialog?.kind === 'allocPick' ? h(AllocPickDialog, { entry: dialog.entry, availability, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'carryover' ? h(CarryoverDialog, { t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'versionDiff' ? h(VersionDiffDialog, { versions, year, t, onClose: () => setDialog(null) }) : null,
  )
}

// ---- 汇总矩阵：主体×费用 为行、月份为列组（预算/已打PR/付款）+ 年度合计 + 执行率热力 ----

function MatrixView({ budget, t, onCell }) {
  const rows = budget?.summary?.list || []
  if (budget?.error) return h(EmptyState, null, t('loadError'))
  if (!rows.length) return h(EmptyState, null, t('empty'))
  const groups = new Map()
  for (const row of rows) {
    const key = `${row.orgName ?? t('unassigned')}|${row.expenseType ?? ''}|${row.departmentName ?? ''}`
    if (!groups.has(key)) groups.set(key, { label: [row.orgName ?? t('unassigned'), EXPENSE_LABELS[row.expenseType] ?? '', row.departmentName].filter(Boolean).join(' / '), months: {}, total: { budget: 0, pr: 0, paid: 0, prEstimated: 0 } })
    const group = groups.get(key)
    const month = row.month ?? 0
    group.months[month] = {
      budget: (group.months[month]?.budget ?? 0) + (finite(row.budgetAmount) ?? 0),
      pr: (group.months[month]?.pr ?? 0) + (finite(row.prSubmittedAmount) ?? 0),
      paid: (group.months[month]?.paid ?? 0) + (finite(row.paidAmount) ?? 0),
    }
    group.total.budget += finite(row.budgetAmount) ?? 0
    group.total.pr += finite(row.prSubmittedAmount) ?? 0
    group.total.prEstimated += finite(row.prEstimatedAmount) ?? 0
    group.total.paid += finite(row.paidAmount) ?? 0
  }
  const data = [...groups.values()]
  const columns = [
    { label: t('org'), stickyLeft: true },
    ...Array.from({ length: 12 }, (_, index) => ({ label: `${index + 1}`, render: row => renderCell(row.months[index + 1], index + 1), num: true })),
    { label: t('annualTotal'), render: row => wan(row.total.budget) ?? '—', num: true },
    { label: t('kpiPrSubmitted'), render: row => wan(row.total.pr) ?? '—', num: true },
    { label: t('kpiPaid'), render: row => wan(row.total.paid) ?? '—', num: true },
    {
      label: t('kpiExecRate'), num: true,
      render: row => {
        const rate = execRateOf(row.total.pr, row.total.prEstimated, row.total.budget)
        if (rate === null) return '—'
        return h('span', { className: `sf-heat sf-heat-${heatLevel(rate)}` }, ratio(rate, 1))
      },
    },
  ]
  function renderCell(cell, month) {
    if (!cell || !cell.budget) return h('span', { style: { color: 'var(--sf-ink3)' } }, '·')
    const rate = execRateOf(cell.pr, 0, cell.budget)
    const level = heatLevel(rate)
    return h('a', {
      href: '#', style: { textDecoration: 'none', color: 'inherit' },
      className: level ? `sf-heat sf-heat-${level}` : '',
      onClick: event => { event.preventDefault(); onCell({ month }) },
    }, wan(cell.pr))
  }
  return h(Card, { title: t('budgetSummaryTitle'), unit: t('unitNote') }, h(Table, { columns, rows: data, minColumns: 1080, empty: t('empty') }))
}

// ---- 月度视图 ----

function MonthView({ budget, t }) {
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const rows = (budget?.summary?.list || []).filter(row => row.month === month)
  const totals = rows.reduce((acc, row) => {
    acc.budget += finite(row.budgetAmount) ?? 0
    acc.pr += finite(row.prSubmittedAmount) ?? 0
    acc.prEstimated += finite(row.prEstimatedAmount) ?? 0
    acc.paid += finite(row.paidAmount) ?? 0
    return acc
  }, { budget: 0, pr: 0, prEstimated: 0, paid: 0 })
  const prevRows = (budget?.summary?.list || []).filter(row => row.month === month - 1)
  const prevPaid = prevRows.reduce((acc, row) => acc + (finite(row.paidAmount) ?? 0), 0)
  const delta = momDelta(totals.paid, prevPaid)
  return h('div', { className: 'sf-stack' },
    h('div', { className: 'sf-row-between' },
      h('div', { className: 'sf-row' },
        h(GhostButton, { onClick: () => setMonth(value => Math.max(1, value - 1)) }, h(Glyph, { name: 'left', size: 12 }), t('prevMonth')),
        h('strong', null, `${month} 月`),
        h(GhostButton, { onClick: () => setMonth(value => Math.min(12, value + 1)) }, t('nextMonth'), h(Glyph, { name: 'right', size: 12 }))),
      delta ? h(Badge, { tone: delta.startsWith('+') ? 'green' : 'rose' }, `${t('momVs')} ${delta}`) : null),
    h('div', { className: 'sf-kpis' },
      h(KpiCard, { icon: 'data', label: t('monthKpiBudget'), value: wan(totals.budget) }),
      h(KpiCard, { icon: 'plan', label: t('kpiPrSubmitted'), value: wan(totals.pr) }),
      h(KpiCard, { icon: 'clock', label: t('kpiPrEstimated'), value: wan(totals.prEstimated) }),
      h(KpiCard, { icon: 'goal', label: t('kpiPaid'), value: wan(totals.paid), hint: delta ? `${t('momVs')} ${delta}` : null, hintTone: delta?.startsWith('+') ? 'up' : 'down' })),
    h(Card, { title: `${month} ${t('monthCol')} · ${t('orgSummaryFull')}`, unit: t('unitNote') }, h(Table, {
      columns: [
        { label: t('org'), render: row => row.orgName ?? t('unassigned'), stickyLeft: true },
        { label: t('expenseType'), render: row => EXPENSE_LABELS[row.expenseType] ?? row.expenseType ?? '—' },
        { label: t('kpiBudget'), render: row => wan(row.budgetAmount) ?? '—', num: true },
        { label: t('kpiPrSubmitted'), render: row => wan(row.prSubmittedAmount) ?? '—', num: true },
        { label: t('kpiPaid'), render: row => wan(row.paidAmount) ?? '—', num: true },
        { label: t('available'), render: row => { const value = (finite(row.budgetAmount) ?? 0) - (finite(row.prSubmittedAmount) ?? 0) - (finite(row.paidAmount) ?? 0); return h('span', { className: value < 0 ? 'sf-neg' : '' }, wan(value) ?? '—') }, num: true },
      ],
      rows, empty: t('empty'),
    })))
}

// ---- 明细行 ----

function LinesView({ budget, page, onPage, t, onDetail }) {
  const lines = budget?.lines
  return h(Card, { title: t('budgetLinesTitle'), unit: t('unitNote') },
    h(Table, {
      columns: [
        { label: t('org'), render: row => row.orgName ?? h(Badge, { tone: 'amber' }, t('unassigned')), stickyLeft: true },
        { label: t('department'), key: 'departmentName' },
        { label: t('costItem'), key: 'costItemName' },
        { label: t('expenseType'), render: row => EXPENSE_LABELS[row.expenseType] ?? row.expenseType ?? '—' },
        { label: t('monthCol'), render: row => mm(row.month), num: true },
        { label: t('kpiBudget'), render: row => wan(row.budgetAmount) ?? '—', num: true },
        { label: t('kpiPrSubmitted'), render: row => wan(row.prSubmittedAmount) ?? '—', num: true },
        { label: t('kpiPaid'), render: row => wan(row.paidAmount) ?? '—', num: true },
      ],
      rows: lines?.list || [], empty: t('empty'), onRowClick: onDetail, rowKey: 'id',
    }),
    h('div', { className: 'sf-row-between' }, h(LimitNote, { rows: lines?.list, limit: BUDGET_LINE_LIMIT, t }), h(Pager, { page, total: lines?.total, limit: PAGE_SIZE, onPage })))
}

function LineDetailDialog({ line, t, onClose }) {
  const occupied = (finite(line.prSubmittedAmount) ?? 0) + (finite(line.paidAmount) ?? 0) + (finite(line.allocatedAmount) ?? 0)
  return h(Dialog, { title: t('budgetLinesTitle'), onClose },
    h('dl', { className: 'sf-evidence' },
      ...[['org', line.orgName ?? t('unassigned')], ['department', line.departmentName ?? '—'], ['costItem', line.costItemName ?? '—'], ['month', mm(line.month)], ['expenseType', EXPENSE_LABELS[line.expenseType] ?? '—']].map(([key, value]) =>
        h('div', { key, className: 'sf-evidence-item' }, h('small', null, t(key)), h('strong', null, value))),
      ...[[t('kpiBudget'), line.budgetAmount], [t('kpiPrSubmitted'), line.prSubmittedAmount], [t('kpiPrEstimated'), line.prEstimatedAmount], [t('kpiPaid'), line.paidAmount], [t('available'), (finite(line.budgetAmount) ?? 0) - occupied]].map(([label, value]) =>
        h('div', { key: label, className: 'sf-evidence-item' }, h('small', null, label), h('strong', null, wan(value) ?? '—')))))
}

// ---- PR 台账 ----

function LedgerView({ pr, page, onPage, t }) {
  const rows = pr?.data?.list || pr?.list || []
  return h(Card, { title: t('viewLedger'), unit: t('unitNote') }, h(Table, {
    columns: [
      { label: t('org'), key: 'orgName', stickyLeft: true },
      { label: 'PR', key: 'prCode' },
      { label: t('recordType'), render: row => row.recordType === 'SUBMITTED' ? t('prSubmittedL') : t('prEstimatedL') },
      { label: t('description'), key: 'description' },
      { label: t('department'), key: 'departmentName' },
      { label: t('monthCol'), render: row => mm(row.month), num: true },
      { label: t('amount'), render: row => wan(row.budgetAmount) ?? '—', num: true },
      { label: t('statusCol'), key: 'status' },
    ],
    rows, empty: t('empty'),
  }), h(Pager, { page, total: pr?.data?.total ?? pr?.total, limit: PAGE_SIZE, onPage }))
}

// ---- 差异分析 ----

function VarianceView({ budget, t }) {
  const rows = budget?.summary?.list || []
  const totals = budget?.summary?.totals
  let agg = totals
  if (!agg) {
    agg = rows.reduce((acc, row) => {
      acc.budgetAmount = (finite(acc.budgetAmount) ?? 0) + (finite(row.budgetAmount) ?? 0)
      acc.prSubmittedAmount = (finite(acc.prSubmittedAmount) ?? 0) + (finite(row.prSubmittedAmount) ?? 0)
      acc.prEstimatedAmount = (finite(acc.prEstimatedAmount) ?? 0) + (finite(row.prEstimatedAmount) ?? 0)
      acc.paidAmount = (finite(acc.paidAmount) ?? 0) + (finite(row.paidAmount) ?? 0)
      return acc
    }, {})
  }
  const budgetValue = finite(agg.budgetAmount) ?? 0
  const prValue = finite(agg.prSubmittedAmount) ?? 0
  const paidValue = finite(agg.paidAmount) ?? 0
  const steps = [
    { label: t('kpiBudget'), value: budgetValue, tone: 'amber' },
    { label: t('kpiPrSubmitted'), value: prValue, tone: '' },
    { label: t('kpiPrEstimated'), value: finite(agg.prEstimatedAmount) ?? 0, tone: '' },
    { label: t('kpiPaid'), value: paidValue, tone: 'green' },
    { label: t('varianceRate'), value: budgetValue - paidValue, tone: budgetValue - paidValue < 0 ? 'rose' : 'amber' },
  ]
  // 差异率 TOP10：按主体聚合执行率与预算差异
  const byOrg = new Map()
  for (const row of rows) {
    const key = row.orgName ?? t('unassigned')
    if (!byOrg.has(key)) byOrg.set(key, { org: key, budget: 0, paid: 0, pr: 0, prEstimated: 0 })
    const item = byOrg.get(key)
    item.budget += finite(row.budgetAmount) ?? 0
    item.paid += finite(row.paidAmount) ?? 0
    item.pr += finite(row.prSubmittedAmount) ?? 0
    item.prEstimated += finite(row.prEstimatedAmount) ?? 0
  }
  const top = [...byOrg.values()]
    .map(item => ({ ...item, rate: item.budget ? (item.paid - item.budget) / item.budget : null }))
    .filter(item => item.rate !== null)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 10)
  return h('div', { className: 'sf-stack' },
    h(Card, { title: t('varianceTitle'), unit: t('unitNote') }, h(Waterfall, { steps })),
    h(Card, { title: t('varianceTop10'), unit: t('unitNote') }, h(Table, {
      columns: [
        { label: t('org'), key: 'org', stickyLeft: true },
        { label: t('kpiBudget'), render: row => wan(row.budget) ?? '—', num: true },
        { label: t('kpiPaid'), render: row => wan(row.paid) ?? '—', num: true },
        { label: t('varianceRate'), render: row => h(Badge, { tone: row.rate > 0.2 ? 'rose' : row.rate < -0.3 ? 'amber' : 'muted' }, `${Math.round(row.rate * 100)}%`) },
      ],
      rows: top, empty: t('empty'),
    })))
}

// ---- 调整审批台（自取数：状态筛选 + 分页由本地状态驱动） ----

function AdjustmentsView({ page, onPage, t, busy, revision, reloadTick, act, onDialog }) {
  const [status, setStatus] = useState('SUBMITTED')
  const [data, setData] = useState(null)
  useEffect(() => {
    let cancelled = false
    api(`/budget-adjustments?${status ? `status=${status}&` : ''}page=${page}&limit=${PAGE_SIZE}`)
      .then(value => { if (!cancelled) setData(value) })
      .catch(() => { if (!cancelled) setData({ error: true }) })
    return () => { cancelled = true }
  }, [status, page, revision, reloadTick])
  const rows = data?.adjustments || []
  const toneOf = state => ADJ_STATUS_TONES[state] ?? 'muted'
  const labelOf = state => t(ADJ_STATUS_KEYS[state] ?? state)
  return h('div', { className: 'sf-stack' },
    h('div', { className: 'sf-row-between' },
      h(PillTabs, { tabs: ADJ_STATUSES, value: status, onChange: value => { setStatus(value); onPage(1) }, t }),
      h(PrimaryButton, { busy, onClick: () => onDialog({ kind: 'adjCreate' }) }, h(Glyph, { name: 'plus', size: 12 }), t('adjCreate'))),
    h(Card, { title: t('viewAdjustments'), unit: t('unitNote') },
      h(Table, {
        columns: [
          { label: t('adjustmentOf'), render: row => `${row.code ?? ''}` },
          { label: t('adjType'), render: row => t(ADJ_TYPES.find(([id]) => id === row.type)?.[1] ?? row.type) },
          { label: t('amount'), render: row => wan(row.totalAmount) ?? '—', num: true },
          { label: t('statusCol'), render: row => h(Pill, { tone: toneOf(row.status) }, labelOf(row.status)) },
          { label: t('lastSeen'), render: row => shortDate(row.submittedAt) ?? '—', num: true },
          {
            label: t('actions'),
            render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
              h(LinkButton, { onClick: () => onDialog({ kind: 'adjDetail', id: row.id }) }, t('actDetail')),
              row.status === 'DRAFT' ? h(LinkButton, { onClick: () => act(`/budget-adjustments/${row.id}/submit`, {}) }, t('actSubmit')) : null,
              row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => act(`/budget-adjustments/${row.id}/approve`, {}) }, t('actApprove')) : null,
              row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => onDialog({ kind: 'reason', title: t('actReject'), required: true, run: reason => act(`/budget-adjustments/${row.id}/reject`, { note: reason }) }) }, t('actReject')) : null,
              row.status === 'APPROVED' ? h(LinkButton, { onClick: () => act(`/budget-adjustments/${row.id}/post`, {}) }, t('actPost')) : null,
              row.status === 'DRAFT' || row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => onDialog({ kind: 'reason', title: t('actCancel'), required: false, run: reason => act(`/budget-adjustments/${row.id}/cancel`, reason ? { note: reason } : {}) }) }, t('actCancel')) : null),
          },
        ],
        rows, empty: t('empty'),
      }),
      h(Pager, { page, total: data?.total, limit: PAGE_SIZE, onPage })))
}

/** 发起调整 Dialog：类型 + 原因 + 多行明细（调拨守恒校验） */
function AdjustCreateDialog({ year, orgs, lines, t, onClose, act }) {
  const [type, setType] = useState('NEW_BUDGET')
  const [reason, setReason] = useState('')
  const [rows, setRows] = useState([
    { side: 'IN', amount: '', budgetLineId: '', targetOrgId: '', targetDepartmentId: '', targetMonth: '' },
    { side: 'OUT', amount: '', budgetLineId: '' },
  ])
  const isTransfer = type === 'TRANSFER_SAME_DEPT' || type === 'TRANSFER_CROSS_DEPT'
  const sumIn = rows.filter(row => row.side === 'IN').reduce((acc, row) => acc + (finite(row.amount) ?? 0), 0)
  const sumOut = rows.filter(row => row.side === 'OUT').reduce((acc, row) => acc + (finite(row.amount) ?? 0), 0)
  const guardBad = isTransfer && sumIn !== sumOut
  const updateRow = (index, patch) => setRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const submit = () => {
    const payloadLines = rows
      .filter(row => finite(row.amount) !== null && Number(row.amount) > 0)
      .map(row => ({
        side: row.side,
        amount: Number(row.amount),
        ...(row.budgetLineId ? { budgetLineId: row.budgetLineId } : {}),
        ...(row.targetOrgId ? { targetOrgId: row.targetOrgId } : {}),
        ...(row.targetDepartmentId ? { targetDepartmentId: row.targetDepartmentId } : {}),
        ...(row.targetMonth ? { targetMonth: Number(row.targetMonth) } : {}),
      }))
    if (!reason.trim() || !payloadLines.length) return
    act('/budget-adjustments', { type, year: Number(year), reason: reason.trim(), lines: payloadLines })
    onClose()
  }
  return h(Dialog, { title: t('adjCreate'), width: 'lg', onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: guardBad || !reason.trim(), onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h('div', { className: 'sf-filters' },
        h(FormRow, { label: t('adjType') }, h(Select, { value: type, onChange: setType, options: ADJ_TYPES })),
        h(FormRow, { label: `${t('year')}` }, h(Field, { value: year, disabled: true }))),
      h(FormRow, { label: t('adjReason'), wide: true }, h(Textarea, { value: reason, onChange: setReason, maxLength: 1000, required: true })),
      h('div', { className: 'sf-stack' },
        h('div', { className: 'sf-row-between' },
          h('strong', null, t('adjLines')),
          h(LinkButton, { onClick: () => setRows(current => [...current, { side: 'IN', amount: '', budgetLineId: '', targetOrgId: '', targetDepartmentId: '', targetMonth: '' }]) }, h(Glyph, { name: 'plus', size: 12 }), t('addRow'))),
        ...rows.map((row, index) => h('div', { key: index, className: 'sf-inline-form' },
          h('div', { className: 'sf-filters' },
            h(PillTabs, { tabs: [['IN', 'lineIn'], ['OUT', 'lineOut']], value: row.side, onChange: value => updateRow(index, { side: value }), t }),
            h(FormRow, { label: t('adjAmount') }, h(Field, { type: 'number', min: '0.01', step: '0.01', value: row.amount, onChange: value => updateRow(index, { amount: value }) })),
            h(FormRow, { label: t('adjLineBudget') }, h(Select, { value: row.budgetLineId, onChange: value => updateRow(index, { budgetLineId: value }), options: lines.map(line => [line.id, lineLabel(line)]), placeholder: row.side === 'OUT' ? t('required') : t('dash') })),
            row.side === 'IN' ? h(FormRow, { label: t('adjTargetOrg') }, h(Select, { value: row.targetOrgId, onChange: value => updateRow(index, { targetOrgId: value }), options: (orgs || []).map(org => [org.id, org.name]), placeholder: t('org') })) : null,
            row.side === 'IN' ? h(FormRow, { label: t('adjTargetDept') }, h(Field, { value: row.targetDepartmentId, onChange: value => updateRow(index, { targetDepartmentId: value }) })) : null,
            row.side === 'IN' ? h(FormRow, { label: t('adjTargetMonth') }, h(Field, { type: 'number', min: 1, max: 12, value: row.targetMonth, onChange: value => updateRow(index, { targetMonth: value }) })) : null,
            h(LinkButton, { onClick: () => setRows(current => current.filter((_, i) => i !== index)) }, h(Glyph, { name: 'trash', size: 13 })))),
        isTransfer ? h(Notice, { tone: guardBad ? 'rose' : null }, guardBad ? `${t('adjGuardBad')}（IN ${wan(sumIn)} ≠ OUT ${wan(sumOut)}）` : `${t('adjGuard')}：IN ${wan(sumIn)} = OUT ${wan(sumOut)}`) : null))))
}

function AdjustDetailDialog({ id, t, onClose }) {
  const [detail, setDetail] = useState(null)
  useEffect(() => {
    let cancelled = false
    api(`/budget-adjustments/${id}`).then(value => { if (!cancelled) setDetail(value.data) }).catch(() => { if (!cancelled) setDetail({ error: true }) })
    return () => { cancelled = true }
  }, [id])
  const rows = detail?.lines || []
  const flow = detail?.flows || detail?.statusLogs || []
  return h(Dialog, { title: `${t('adjustmentOf')} ${detail?.code ?? ''}`, onClose },
    h('div', { className: 'sf-stack' },
      detail ? h('div', { className: 'sf-row' }, h(Pill, { tone: ADJ_STATUS_TONES[detail.status] ?? 'muted' }, t(ADJ_STATUS_KEYS[detail.status] ?? detail.status)), h('span', { className: 'sf-note' }, `${t('adjType')}：${t(ADJ_TYPES.find(([tid]) => tid === detail.type)?.[1] ?? detail.type)}`)) : null,
      h(Table, {
        columns: [
          { label: t('inOut'), render: row => h(Badge, { tone: row.side === 'IN' ? 'green' : 'rose' }, row.side === 'IN' ? t('lineIn') : t('lineOut')) },
          { label: t('amount'), render: row => wan(row.amount) ?? '—', num: true },
          { label: t('adjLineBudget'), render: row => (row.budgetLine ? lineLabel(row.budgetLine) : row.budgetLineId ?? '—') },
          { label: t('note'), key: 'note' },
        ],
        rows, empty: t('empty'),
      }),
      flow.length ? h('div', null, h('strong', null, t('flow')), h('div', { className: 'sf-timeline' }, ...flow.map((item, index) =>
        h('div', { key: index, className: 'sf-timeline-row' },
          h('span', { className: 'sf-timeline-dot' }),
          h('div', { className: 'sf-timeline-main' }, h('span', null, `${item.action ?? item.toStatus ?? ''} · ${item.operatorName ?? item.operator ?? '—'}`), h('small', null, shortDate(item.at ?? item.createdAt) ?? '')),
          h('span', { className: 'sf-note' }, item.note ?? ''))))) : null))
}

// ---- PR 分配（自取数：待认领池 + 可用预算 + 最近分配） ----

function AllocationsView({ query, page, onPage, t, revision, reloadTick, act, onDialog }) {
  const [pool, setPool] = useState(null)
  const [availability, setAvailability] = useState(null)
  const [recent, setRecent] = useState(null)
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      api(`/allocations-pool?${query()}`).catch(() => ({ data: { entries: [] } })),
      api(`/availability?${query()}`).catch(() => ({ data: { sample: [] } })),
      api(`/allocations?page=${page}&limit=${PAGE_SIZE}`).catch(() => ({ data: { list: [] } })),
    ]).then(([poolValue, availabilityValue, recentValue]) => {
      if (cancelled) return
      setPool(poolValue.data); setAvailability(availabilityValue.data); setRecent(recentValue.data)
    })
    return () => { cancelled = true }
  }, [page, revision, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const entries = pool?.entries || []
  const recentList = recent?.list || []
  return h('div', { className: 'sf-stack' },
    h(Card, { title: `${t('allocPool')}（${entries.length}）`, unit: t('unitNote') },
      h(Table, {
        columns: [
          { label: t('dataset'), render: row => row.title ?? row.sourceId, stickyLeft: true },
          { label: t('amount'), render: row => wan(row.amount) ?? '—', num: true },
          { label: t('monthCol'), render: row => mm(row.month), num: true },
          { label: t('suggestion'), render: row => { const top = row.suggestions?.[0]; return top ? `${lineLabel(top)}（${Math.round((top.score ?? 0) * 100)}）` : '—' } },
          {
            label: t('actions'),
            render: row => h('div', { className: 'sf-row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
              row.suggestions?.[0] ? h(LinkButton, { onClick: () => act('/allocations', { sourceType: row.sourceType, sourceId: row.sourceId, budgetLineId: row.suggestions[0].budgetLineId ?? row.suggestions[0].id, amount: row.amount }) }, t('allocOneClick')) : null,
              h(LinkButton, { onClick: () => onDialog({ kind: 'allocPick', entry: row }) }, t('allocPick'))),
          },
        ],
        rows: entries, empty: t('empty'),
      })),
    h(Card, { title: t('allocRecent'), unit: t('unitNote') },
      h(Table, {
        columns: [
          { label: t('dataset'), key: 'sourceType' },
          { label: t('adjLineBudget'), render: row => row.budgetLineName ?? row.budgetLineId ?? '—' },
          { label: t('amount'), render: row => wan(row.amount) ?? '—', num: true },
          { label: t('actions'), render: row => h(LinkButton, { onClick: () => act(`/allocations/${row.id}/remove`, {}) }, t('allocRemove')) },
        ],
        rows: recentList, empty: t('empty'),
      }),
      h(Pager, { page, total: recent?.total, limit: PAGE_SIZE, onPage })))
}

function AllocPickDialog({ entry, availability, t, onClose, act }) {
  const [lineId, setLineId] = useState('')
  const lines = availability?.sample || []
  const submit = () => { if (!lineId) return; act('/allocations', { sourceType: entry.sourceType, sourceId: entry.sourceId, budgetLineId: lineId, amount: entry.amount }); onClose() }
  return h(Dialog, { title: t('allocPick'), onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: !lineId, onClick: submit }, t('allocConfirm')),
  ] },
    h('div', { className: 'sf-stack' },
      h('p', { className: 'sf-note' }, `${entry.title ?? ''} · ${wan(entry.amount) ?? '—'} ${t('unitYuan')}`),
      h(FormRow, { label: t('pickLine') }, h(Select, { value: lineId, onChange: setLineId, options: lines.map(line => [line.budgetLineId ?? line.id, `${lineLabel(line)} · ${t('available')} ${wan(line.available) ?? '—'}`]), placeholder: t('pickLine') }))))
}

// ---- 版本管理（版本表自取数；递延规则卡独立拉取） ----

function VersionsView({ versions, year, t, revision, reloadTick, act, onDialog }) {
  const [list, setList] = useState(versions?.list ?? [])
  useEffect(() => {
    let cancelled = false
    api(`/budget-versions?year=${year}`).then(value => { if (!cancelled) setList(value.data?.list ?? []) }).catch(() => {})
    return () => { cancelled = true }
  }, [year, revision, reloadTick])
  return h('div', { className: 'sf-stack' },
    h(Card, { title: t('viewVersions'), actions: [h(LinkButton, { key: 'diff', onClick: () => onDialog({ kind: 'versionDiff' }) }, t('verDiff'))] }, h(Table, {
      columns: [
        { label: t('verName'), render: row => h('span', null, row.name, ' ', row.isPrimary ? h(Badge, { key: 'p', tone: 'blue' }, t('primaryTag')) : null), stickyLeft: true },
        { label: t('verType'), key: 'type' },
        { label: t('verStatus'), render: row => h(Pill, { tone: VERSION_STATUS_TONES[row.status] ?? 'muted' }, t(VERSION_STATUS_KEYS[row.status] ?? row.status)) },
        { label: t('verLines'), key: 'lineCount', num: true },
        { label: t('kpiBudget'), render: row => wan(row.budgetTotal) ?? '—', num: true },
        { label: t('kpiPrSubmitted'), render: row => wan(row.prSubmittedTotal) ?? '—', num: true },
        { label: t('kpiPaid'), render: row => wan(row.paidTotal) ?? '—', num: true },
        {
          label: t('verActions'),
          render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
            row.status === 'DRAFT' ? h(LinkButton, { onClick: () => act(`/budget-versions/${row.id}/action`, { action: 'confirm' }) }, t('verConfirm')) : null,
            row.status === 'CONFIRMED' ? h(LinkButton, { onClick: () => act(`/budget-versions/${row.id}/action`, { action: 'activate' }) }, t('verActivate')) : null,
            row.status === 'PUBLISHED' && !row.isPrimary ? null : null,
            row.status === 'PUBLISHED' ? h(LinkButton, { onClick: () => act(`/budget-versions/${row.id}/action`, { action: 'lock' }) }, t('verLock')) : null,
            h(LinkButton, { onClick: () => act(`/budget-versions/${row.id}/action`, { action: 'clone' }) }, t('verClone'))),
        },
      ],
      rows: list, empty: t('empty'),
    })),
    h(CarryoverCard, { t, revision, reloadTick, act, onDialog }))
}

function CarryoverCard({ t, revision, reloadTick, act, onDialog }) {
  const [list, setList] = useState([])
  useEffect(() => {
    let cancelled = false
    api('/carryover-rules').then(value => { if (!cancelled) setList(value.data?.list ?? []) }).catch(() => {})
    return () => { cancelled = true }
  }, [revision, reloadTick])
  return h(Card, { title: t('carryoverRules'), actions: [h(LinkButton, { key: 'add', onClick: () => onDialog({ kind: 'carryover' }) }, h(Glyph, { name: 'plus', size: 12 }), t('ruleAdd'))] }, h(Table, {
    columns: [
      { label: t('expenseType'), render: row => row.expenseType ? EXPENSE_LABELS[row.expenseType] ?? row.expenseType : t('all') },
      { label: t('carryoverMode'), render: row => row.mode === 'FULL' ? t('modeFull') : row.mode === 'PERCENT' ? `${t('modePercent')} ${row.percent ?? 100}%` : `${t('modeExpire')} ${t('expireMonth')} ${row.expireMonth ?? '—'}` },
      { label: t('statusCol'), render: row => h(Pill, { tone: row.enabled ? 'green' : 'muted' }, row.enabled ? t('ruleEnabled') : t('ruleDisabled')) },
      { label: t('actions'), render: row => h('div', { className: 'sf-row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
        h(LinkButton, { onClick: () => act('/carryover-rules', { action: 'toggle', id: row.id }) }, t('ruleToggle')),
        h(LinkButton, { onClick: () => act('/carryover-rules', { action: 'remove', id: row.id }) }, t('ruleRemove'))) },
    ],
    rows: list, empty: t('empty'),
  }))
}

function CarryoverDialog({ t, onClose, act }) {
  const [mode, setMode] = useState('FULL')
  const [expenseType, setExpenseType] = useState('')
  const [percent, setPercent] = useState('100')
  const [expireMonth, setExpireMonth] = useState('')
  const submit = () => {
    act('/carryover-rules', {
      action: 'create', mode,
      ...(expenseType ? { expenseType } : {}),
      ...(mode === 'PERCENT' ? { percent: Number(percent) } : {}),
      ...(mode === 'EXPIRE' ? { expireMonth: Number(expireMonth) } : {}),
    })
    onClose()
  }
  return h(Dialog, { title: t('ruleAdd'), onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h(FormRow, { label: t('carryoverMode') }, h(Select, { value: mode, onChange: setMode, options: [['FULL', 'modeFull'], ['PERCENT', 'modePercent'], ['EXPIRE', 'modeExpire']] })),
      h(FormRow, { label: t('expenseType') }, h(Select, { value: expenseType, onChange: setExpenseType, options: EXPENSE_TYPES, placeholder: t('all') })),
      mode === 'PERCENT' ? h(FormRow, { label: t('percent') }, h(Field, { type: 'number', min: 1, max: 100, value: percent, onChange: setPercent })) : null,
      mode === 'EXPIRE' ? h(FormRow, { label: t('expireMonth') }, h(Field, { type: 'number', min: 1, max: 12, value: expireMonth, onChange: setExpireMonth })) : null))
}

function VersionDiffDialog({ versions, year, t, onClose }) {
  const list = versions?.list || []
  const [baseId, setBaseId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [diff, setDiff] = useState(null)
  useEffect(() => {
    if (!baseId || !targetId || baseId === targetId) return undefined
    let cancelled = false
    api(`/budget-version-diff?year=${year}&baseVersionId=${baseId}&targetVersionId=${targetId}`)
      .then(value => { if (!cancelled) setDiff(value.data) }).catch(() => { if (!cancelled) setDiff({ error: true }) })
    return () => { cancelled = true }
  }, [baseId, targetId, year])
  const rows = diff?.rows || []
  return h(Dialog, { title: t('verDiff'), width: 'lg', onClose },
    h('div', { className: 'sf-stack' },
      h('div', { className: 'sf-filters' },
        h(FormRow, { label: t('diffBase') }, h(Select, { value: baseId, onChange: setBaseId, options: list.map(v => [v.id, v.name]) })),
        h(FormRow, { label: t('diffTarget') }, h(Select, { value: targetId, onChange: setTargetId, options: list.map(v => [v.id, v.name]) }))),
      h(Table, {
        columns: [
          { label: t('org'), render: row => row.orgName ?? '—', stickyLeft: true },
          { label: t('expenseType'), render: row => EXPENSE_LABELS[row.expenseType] ?? row.expenseType ?? '—' },
          { label: t('diffAmount'), render: row => { const value = finite(row.diffAmount); return h('span', { className: value < 0 ? 'sf-neg' : 'sf-pos' }, wan(value) ?? '—') }, num: true },
        ],
        rows, empty: t('empty'),
      })))
}

function SaveViewDialog({ view, filters, t, onClose, onSaved }) {
  const [name, setName] = useState('')
  const submit = () => {
    if (!name.trim()) return
    const query = { view }
    for (const [key, value] of Object.entries(filters)) if (value) query[key] = value
    post('/saved-views', { name: name.trim(), query })
      .then(() => api('/saved-views'))
      .then(value => { onSaved(value.data ?? { list: [] }); onClose() })
      .catch(() => onClose())
  }
  return h(Dialog, { title: t('saveView'), width: 'sm', onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: !name.trim(), onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h('p', { className: 'sf-note' }, t('saveViewFirst')),
      h(FormRow, { label: t('viewName') }, h(Field, { value: name, onChange: setName, maxLength: 60, autoFocus: true }))))
}

function ReasonDialog({ title, required, t, onClose, onSubmit }) {
  const [reason, setReason] = useState('')
  return h(Dialog, { title, width: 'sm', onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: required && !reason.trim(), onClick: () => onSubmit(reason.trim()) }, t('confirm')),
  ] },
    h(FormRow, { label: required ? t('rejectReason') : t('cancelReason'), wide: true }, h(Textarea, { value: reason, onChange: setReason, maxLength: 500, autoFocus: true })))
}
