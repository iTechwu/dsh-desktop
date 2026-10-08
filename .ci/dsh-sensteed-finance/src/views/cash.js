// 片段 5/7 视图：资金（四子视图：资金汇总/排款工作台/调增审批/收入计划；排款/调增/详情 Dialog）

const PRIORITIES = [['HIGH', 'priHigh'], ['MEDIUM', 'priMid'], ['LOW', 'priLow']]

function CashView({ ctx, t, onDrill }) {
  const { year, orgId, departments, revision } = ctx
  const [tab, setTab] = useState('summary')
  const [cash, setCash] = useState(null)
  const [plans, setPlans] = useState(null)
  const [revenues, setRevenues] = useState(null)
  const [filters, setFilters] = useState({ planType: '', departmentId: '', month: '', unassigned: false })
  const [page, setPage] = useState(1)
  const [revenuePage, setRevenuePage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)

  const query = (extra = {}) => {
    const params = new URLSearchParams({ year })
    if (orgId) params.set('orgId', orgId)
    if (filters.planType) params.set('planType', filters.planType)
    if (filters.departmentId) params.set('departmentId', filters.departmentId)
    if (filters.month) params.set('month', filters.month)
    if (filters.unassigned) params.set('unassigned', '1')
    for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== '') params.set(key, value)
    return params.toString()
  }

  const act = async (path, payload, doneMessage) => {
    setBusy(true); setNotice(null)
    try {
      await post(path, payload)
      setNotice(doneMessage ?? t('submitted'))
      setReloadTick(value => value + 1)
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { setBusy(false) }
  }

  useEffect(() => { setNotice(null) }, [revision])
  useEffect(() => {
    let cancelled = false
    if (tab === 'summary') {
      api(`/cash?${query()}`).then(value => { if (!cancelled) setCash(value) }).catch(() => { if (!cancelled) setCash({ error: true }) })
    }
    if (tab === 'plans') {
      api(`/payment-plans?${query({ page, limit: PAGE_SIZE })}`).then(value => { if (!cancelled) setPlans(value) }).catch(() => { if (!cancelled) setPlans({ error: true }) })
    }
    if (tab === 'revenue') {
      api(`/revenue-plans?year=${year}${orgId ? `&orgId=${orgId}` : ''}&page=${revenuePage}&limit=${PAGE_SIZE}`).then(value => { if (!cancelled) setRevenues(value) }).catch(() => { if (!cancelled) setRevenues({ error: true }) })
    }
    return () => { cancelled = true }
  }, [tab, page, revenuePage, year, orgId, filters.planType, filters.departmentId, filters.month, filters.unassigned, revision, reloadTick])

  const filterBar = tab === 'plans' ? h('div', { className: 'sf-filters' },
    h(Select, { value: filters.planType, onChange: value => { setPage(1); setFilters(f => ({ ...f, planType: value })) }, options: PLAN_TYPES, placeholder: t('planType') }),
    h(Select, { value: filters.departmentId, onChange: value => { setPage(1); setFilters(f => ({ ...f, departmentId: value })) }, options: (departments || []).map(d => [d.id, d.name]), placeholder: t('department') }),
    h(Select, { value: filters.month, onChange: value => { setPage(1); setFilters(f => ({ ...f, month: value })) }, options: Array.from({ length: 12 }, (_, index) => [String(index + 1), `${index + 1} 月`]), placeholder: t('monthCol') }),
    h('label', { className: 'sf-row', style: { gap: 6, fontSize: 12, color: 'var(--sf-ink2)' } },
      h('input', { type: 'checkbox', checked: filters.unassigned, onChange: event => { setPage(1); setFilters(f => ({ ...f, unassigned: event.target.checked })) } }), t('unassigned'))) : null

  const planRows = plans?.data?.list || plans?.list || []
  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-row-between' },
      h(PillTabs, { tabs: [['summary', 'cashSummaryV'], ['plans', 'cashPlans'], ['adjustments', 'cashAdjustments'], ['revenue', 'cashRevenue']], value: tab, onChange: id => { setTab(id); setPage(1) }, t }),
      notice ? h(Notice, null, notice) : null),
    filterBar ? h('div', { className: 'sf-row-between' }, filterBar) : null,

    tab === 'summary' ? h(SummaryTab, { cash, t }) : null,
    tab === 'plans' ? h(PlansTab, { rows: planRows, total: plans?.data?.total ?? plans?.total, page, onPage: setPage, t, busy, act, onDialog: setDialog }) : null,
    tab === 'adjustments' ? h(PlanAdjustmentsTab, { t, revision, reloadTick, busy, act, onDialog: setDialog }) : null,
    tab === 'revenue' ? h(RevenueTab, { revenues, page: revenuePage, onPage: setRevenuePage, t, onBackfill: row => setDialog({ kind: 'backfill', row }) }) : null,

    dialog?.kind === 'schedule' ? h(ScheduleDialog, { plan: dialog.plan, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'increase' ? h(IncreaseDialog, { plan: dialog.plan, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'planDetail' ? h(PlanDetailDialog, { plan: dialog.plan, t, onClose: () => setDialog(null) }) : null,
    dialog?.kind === 'backfill' ? h(BackfillDialog, { row: dialog.row, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'reason' ? h(ReasonDialog, { title: dialog.title, required: dialog.required, t, onClose: () => setDialog(null), onSubmit: reason => { setDialog(null); return dialog.run(reason) } }) : null,
    dialog?.kind === 'planAdjDetail' ? h(PlanAdjustDetailDialog, { id: dialog.id, t, onClose: () => setDialog(null) }) : null,
  )
}

function PlanAdjustDetailDialog({ id, t, onClose }) {
  const [detail, setDetail] = useState(null)
  useEffect(() => {
    let cancelled = false
    api(`/plan-adjustments/${id}`).then(value => { if (!cancelled) setDetail(value.data) }).catch(() => { if (!cancelled) setDetail({ error: true }) })
    return () => { cancelled = true }
  }, [id])
  const flow = detail?.flows || detail?.statusLogs || []
  const adjustment = detail?.adjustment ?? detail
  return h(Dialog, { title: `${t('adjustmentOf')} ${adjustment?.code ?? ''}`, onClose },
    h('div', { className: 'sf-stack' },
      adjustment ? h('div', { className: 'sf-row' },
        h(Pill, { tone: ADJ_STATUS_TONES[adjustment.status] ?? 'muted' }, t(ADJ_STATUS_KEYS[adjustment.status] ?? adjustment.status)),
        h('span', { className: 'sf-note' }, `${wan(adjustment.oldAmount) ?? '—'} → ${wan(adjustment.newAmount) ?? '—'} ${t('unitYuan')}`)) : null,
      adjustment?.reason ? h('p', { className: 'sf-note' }, `${t('increaseReason')}：${adjustment.reason}`) : null,
      flow.length ? h('div', null, h('strong', null, t('flow')), h('div', { className: 'sf-timeline' }, ...flow.map((item, index) =>
        h('div', { key: index, className: 'sf-timeline-row' },
          h('span', { className: 'sf-timeline-dot' }),
          h('div', { className: 'sf-timeline-main' }, h('span', null, `${item.action ?? item.toStatus ?? ''} · ${item.operatorName ?? item.operator ?? '—'}`), h('small', null, shortDate(item.at ?? item.createdAt) ?? '')),
          h('span', { className: 'sf-note' }, item.note ?? ''))))) : null))
}

// ---- 汇总：KPI + 矩阵（sticky 首列）+ 平铺表 ----

function SummaryTab({ cash, t }) {
  if (cash?.error) return h(EmptyState, null, t('loadError'))
  const rows = cash?.data?.list || cash?.list || []
  const totals = rows.reduce((acc, row) => {
    acc.plannedIncome += finite(row.plannedIncome) ?? 0
    acc.actualIncome += finite(row.actualIncome) ?? 0
    acc.plannedExpense += finite(row.plannedExpense) ?? 0
    acc.actualExpense += finite(row.actualExpense) ?? 0
    return acc
  }, { plannedIncome: 0, actualIncome: 0, plannedExpense: 0, actualExpense: 0 })
  return h('div', { className: 'sf-stack' },
    h('div', { className: 'sf-kpis' },
      h(KpiCard, { icon: 'sparkle', label: t('kpiRevenueAch'), value: ratio(totals.actualIncome, totals.plannedIncome) ?? '—', hint: `${wan(totals.actualIncome) ?? '—'} / ${wan(totals.plannedIncome) ?? '—'}` }),
      h(KpiCard, { icon: 'goal', label: t('kpiSpendExec'), value: ratio(totals.actualExpense, totals.plannedExpense) ?? '—', hint: `${wan(totals.actualExpense) ?? '—'} / ${wan(totals.plannedExpense) ?? '—'}` }),
      h(KpiCard, { icon: 'data', label: t('kpiNetInflow'), value: wan(totals.actualIncome - totals.actualExpense), negative: totals.actualIncome - totals.actualExpense < 0 })),
    h(Card, { title: t('cashMatrix'), unit: t('unitNote') }, h(CashMatrix, { rows, t })))
}

function CashMatrix({ rows, t }) {
  if (!rows.length) return h(EmptyState, null, t('empty'))
  const groups = new Map()
  for (const row of rows) {
    const key = row.orgName ?? t('unassigned')
    if (!groups.has(key)) groups.set(key, {})
    groups.get(key)[row.month] = row
  }
  return h(Table, {
    minColumns: 1080,
    columns: [
      { label: t('org'), stickyLeft: true },
      ...Array.from({ length: 12 }, (_, index) => ({
        label: `${index + 1}`,
        num: true,
        render: row => {
          const cell = row[index + 1]
          if (!cell) return h('span', { style: { color: 'var(--sf-ink3)' } }, '·')
          const balance = finite(cell.projectedBalance) ?? finite(cell.actualBalance)
          return h('div', { style: { display: 'grid', gap: 1, textAlign: 'right' } },
            h('span', null, `收 ${wan(cell.actualIncome ?? cell.plannedIncome) ?? '—'}`),
            h('span', null, `支 ${wan(cell.actualExpense ?? cell.plannedExpense) ?? '—'}`),
            h('span', { className: balance != null && balance < 0 ? 'sf-neg' : '' }, `余 ${wan(balance) ?? '—'}`))
        },
      })),
    ],
    rows: [...groups.entries()].map(([org, months]) => ({ org, ...months })),
    rowKey: 'org',
    empty: t('empty'),
  })
}

// ---- 排款工作台 ----

function PlansTab({ rows, total, page, onPage, t, busy, act, onDialog }) {
  return h(Card, { title: t('cashPlans'), unit: t('unitNote') },
    h(Table, {
      columns: [
        { label: t('org'), key: 'orgName', stickyLeft: true },
        { label: t('planType'), render: row => t(PLAN_LABELS[row.planType] ?? row.planType) },
        { label: t('description'), key: 'description' },
        { label: t('planMonth'), render: row => mm(row.planMonth ?? row.month), num: true },
        { label: t('planned'), render: row => wan(row.plannedAmount) ?? '—', num: true },
        { label: t('actual'), render: row => { const over = finite(row.actualAmount) !== null && finite(row.plannedAmount) !== null && row.actualAmount > row.plannedAmount; return h('span', { className: over ? 'sf-neg' : '' }, wan(row.actualAmount) ?? '—') }, num: true },
        { label: t('remaining'), render: row => wan(row.remainingAmount) ?? '—', num: true },
        { label: t('scheduleDate'), render: row => shortDate(row.scheduleDate) ?? '—', num: true },
        { label: t('priority'), render: row => row.priority ? h(Pill, { tone: row.priority === 'HIGH' ? 'rose' : row.priority === 'MEDIUM' ? 'amber' : 'muted' }, t(PRIORITIES.find(([id]) => id === row.priority)?.[1] ?? row.priority)) : '—' },
        {
          label: t('actions'),
          render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
            h(LinkButton, { onClick: () => onDialog({ kind: 'planDetail', plan: row }) }, t('actDetail')),
            h(LinkButton, { onClick: () => onDialog({ kind: 'schedule', plan: row }) }, t('schedule')),
            h(LinkButton, { onClick: () => onDialog({ kind: 'increase', plan: row }) }, t('increase'))),
        },
      ],
      rows, empty: t('empty'),
    }),
    h(Pager, { page, total, limit: PAGE_SIZE, onPage }))
}

function ScheduleDialog({ plan, t, onClose, act }) {
  const [scheduleDate, setScheduleDate] = useState(plan.scheduleDate?.slice(0, 10) ?? '')
  const [priority, setPriority] = useState(plan.priority ?? '')
  const [accepts, setAccepts] = useState(Boolean(plan.acceptsAcceptance))
  const [cashAmount, setCashAmount] = useState(plan.plannedCashAmount != null ? String(plan.plannedCashAmount) : '')
  const [acceptanceAmount, setAcceptanceAmount] = useState(plan.plannedAcceptanceAmount != null ? String(plan.plannedAcceptanceAmount) : '')
  const submit = () => {
    act(`/payment-plans/${plan.id}/schedule`, {
      ...(scheduleDate ? { scheduleDate: new Date(`${scheduleDate}T00:00:00`).toISOString() } : {}),
      ...(priority ? { priority } : { priority: null }),
      acceptsAcceptance: accepts,
      ...(cashAmount ? { plannedCashAmount: Number(cashAmount) } : {}),
      ...(acceptanceAmount ? { plannedAcceptanceAmount: Number(acceptanceAmount) } : {}),
    })
    onClose()
  }
  return h(Dialog, { title: `${t('schedule')} · ${plan.description ?? ''}`, onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h(FormRow, { label: t('scheduleDate') }, h(Field, { type: 'date', value: scheduleDate, onChange: setScheduleDate })),
      h(FormRow, { label: t('priority') }, h(Select, { value: priority, onChange: setPriority, options: PRIORITIES, placeholder: '—' })),
      h(FormRow, { label: t('acceptAcceptance') }, h(Switch, { checked: accepts, onChange: setAccepts, label: t('acceptAcceptance') })),
      accepts ? h(FormRow, { label: t('cashAmount') }, h(Field, { type: 'number', min: '0', step: '0.01', value: cashAmount, onChange: setCashAmount })) : null,
      accepts ? h(FormRow, { label: t('acceptanceAmount') }, h(Field, { type: 'number', min: '0', step: '0.01', value: acceptanceAmount, onChange: setAcceptanceAmount })) : null))
}

function IncreaseDialog({ plan, t, onClose, act }) {
  const [newAmount, setNewAmount] = useState('')
  const [reason, setReason] = useState('')
  const invalid = finite(newAmount) === null || Number(newAmount) <= Number(plan.plannedAmount ?? 0) || !reason.trim()
  const submit = () => { if (invalid) return; act('/plan-adjustments', { planId: plan.id, newAmount: Number(newAmount), reason: reason.trim() }); onClose() }
  return h(Dialog, { title: `${t('increase')} · ${plan.description ?? ''}`, onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: invalid, onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h('p', { className: 'sf-note' }, `${t('planned')}：${wan(plan.plannedAmount) ?? '—'} ${t('unitYuan')} · ${t('increaseHint')}`),
      h(FormRow, { label: t('newAmount') }, h(Field, { type: 'number', min: '0.01', step: '0.01', value: newAmount, onChange: setNewAmount })),
      h(FormRow, { label: t('increaseReason'), wide: true }, h(Textarea, { value: reason, onChange: setReason, maxLength: 500 }))))
}

function PlanDetailDialog({ plan, t, onClose }) {
  const fields = [
    [t('org'), plan.orgName], [t('planType'), t(PLAN_LABELS[plan.planType] ?? plan.planType)], [t('description'), plan.description],
    [t('department'), plan.departmentName], [t('costItem'), plan.costItemName], [t('planMonth'), plan.planMonth ? `${plan.planMonth} 月` : '—'],
    [t('planned'), wan(plan.plannedAmount)], [t('actual'), wan(plan.actualAmount)], [t('variance'), wan(plan.varianceAmount)],
    [t('remaining'), wan(plan.remainingAmount)], [t('scheduleDate'), shortDate(plan.scheduleDate)], [t('priority'), plan.priority ? t(PRIORITIES.find(([id]) => id === plan.priority)?.[1] ?? plan.priority) : '—'],
    [t('acceptAcceptance'), plan.acceptsAcceptance ? '✓' : '—'], [t('cashAmount'), wan(plan.plannedCashAmount)], [t('acceptanceAmount'), wan(plan.plannedAcceptanceAmount)],
    [t('payee'), plan.payeeName], [t('statusCol'), plan.status],
  ]
  return h(Dialog, { title: t('planDetail'), onClose },
    h('dl', { className: 'sf-evidence' }, ...fields.map(([label, value], index) =>
      h('div', { key: index, className: 'sf-evidence-item' }, h('small', null, label), h('strong', null, value ?? '—')))))
}

// ---- 调增审批台 ----

function PlanAdjustmentsTab({ t, revision, reloadTick, busy, act, onDialog }) {
  const [status, setStatus] = useState('SUBMITTED')
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  useEffect(() => {
    let cancelled = false
    api(`/plan-adjustments?${status ? `status=${status}&` : ''}page=${page}&limit=${PAGE_SIZE}`)
      .then(value => { if (!cancelled) setData(value) })
      .catch(() => { if (!cancelled) setData({ error: true }) })
    return () => { cancelled = true }
  }, [status, page, revision, reloadTick])
  const rows = data?.adjustments || []
  const deltaOf = row => { const delta = (finite(row.newAmount) ?? 0) - (finite(row.oldAmount) ?? 0); return delta >= 0 ? `+${wan(delta)}` : wan(delta) }
  return h('div', { className: 'sf-stack' },
    h(PillTabs, { tabs: ADJ_STATUSES, value: status, onChange: value => { setStatus(value); setPage(1) }, t }),
    h(Card, { title: t('cashAdjustments'), unit: t('unitNote') },
      h(Table, {
        columns: [
          { label: t('adjustmentOf'), key: 'code' },
          { label: t('amount'), render: row => h('span', null, `${wan(row.oldAmount) ?? '—'} → ${wan(row.newAmount) ?? '—'} `, h('span', { className: 'sf-pos' }, `（${deltaOf(row)}）`)), num: true },
          { label: t('statusCol'), render: row => h(Pill, { tone: ADJ_STATUS_TONES[row.status] ?? 'muted' }, t(ADJ_STATUS_KEYS[row.status] ?? row.status)) },
          { label: t('lastSeen'), render: row => shortDate(row.submittedAt) ?? '—', num: true },
          {
            label: t('actions'),
            render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
              h(LinkButton, { onClick: () => onDialog({ kind: 'planAdjDetail', id: row.id }) }, t('actDetail')),
              row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => act(`/plan-adjustments/${row.id}/approve`, {}) }, t('actApprove')) : null,
              row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => onDialog({ kind: 'reason', title: t('actReject'), required: true, run: reason => act(`/plan-adjustments/${row.id}/reject`, { note: reason }) }) }, t('actReject')) : null,
              row.status === 'APPROVED' ? h(LinkButton, { onClick: () => act(`/plan-adjustments/${row.id}/post`, {}) }, t('actPost')) : null,
              row.status === 'DRAFT' || row.status === 'SUBMITTED' ? h(LinkButton, { onClick: () => onDialog({ kind: 'reason', title: t('actCancel'), required: false, run: reason => act(`/plan-adjustments/${row.id}/cancel`, reason ? { note: reason } : {}) }) }, t('actCancel')) : null),
          },
        ],
        rows, empty: t('empty'),
      }),
      h(Pager, { page, total: data?.total, limit: PAGE_SIZE, onPage })),
    // 驳回理由 Dialog 与详情 Dialog 由外壳层渲染——这里通过 onDialog 请求，但 Dialog 需要在 CashView 层挂载
    null)
}

// ---- 收入计划 ----

function RevenueTab({ revenues, page, onPage, t, onBackfill }) {
  const rows = revenues?.data?.list || revenues?.list || []
  return h(Card, { title: t('revenueVs'), unit: t('unitNote') },
    h(Table, {
      columns: [
        { label: t('org'), key: 'orgName', stickyLeft: true },
        { label: t('itemName'), key: 'itemName' },
        { label: t('payer'), key: 'payerName' },
        { label: t('monthCol'), render: row => mm(row.month), num: true },
        { label: t('planned'), render: row => wan(row.plannedAmount) ?? '—', num: true },
        { label: t('actual'), render: row => wan(row.actualAmount) ?? '—', num: true },
        {
          label: t('variance'), num: true,
          render: row => {
            const value = finite(row.varianceAmount)
            if (value === null) return '—'
            return h('span', { className: value < 0 ? 'sf-neg' : 'sf-pos' }, wan(value))
          },
        },
        { label: t('actions'), render: row => h(LinkButton, { onClick: () => onBackfill(row) }, t('backfill')) },
      ],
      rows, empty: t('empty'),
    }),
    h(Pager, { page, total: revenues?.data?.total ?? revenues?.total, limit: PAGE_SIZE, onPage }))
}

function BackfillDialog({ row, t, onClose, act }) {
  const [amount, setAmount] = useState(row.actualAmount != null ? String(row.actualAmount) : '')
  const [date, setDate] = useState(row.actualPaidAt?.slice(0, 10) ?? '')
  const submit = event => {
    event.preventDefault()
    act(`/revenue-plans/${row.id}/actuals`, {
      actualAmount: Number(amount),
      ...(date ? { actualPaidAt: new Date(`${date}T00:00:00`).toISOString() } : {}),
    })
    onClose()
  }
  return h(Dialog, { title: `${t('backfill')} · ${row.itemName ?? ''}`, width: 'sm', onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', onClick: submit, disabled: finite(amount) === null }, t('submit')),
  ] },
    h('form', { onSubmit: submit, className: 'sf-stack' },
      h(FormRow, { label: t('actualAmountL') }, h(Field, { type: 'number', min: '0', step: '0.01', value: amount, onChange: setAmount, required: true })),
      h(FormRow, { label: t('actualDateL') }, h(Field, { type: 'date', value: date, onChange: setDate }))))
}
