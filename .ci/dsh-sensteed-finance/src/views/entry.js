// 片段 5/7 视图：录入（填报控制台：任务管理/我的填报 + 通讯录 + 归属记录 + 成员角色 + 录入面板 4 类型）

const FINANCE_ROLES = ['DEPT_FILLER', 'DEPT_LEADER', 'DEPT_COLLABORATOR', 'BOSS', 'FINANCE_STAFF', 'FINANCE_OWNER', 'MANAGEMENT']

function EntryView({ ctx, t }) {
  const { year, orgs, revision } = ctx
  const [section, setSection] = useState('filing')
  const [tasks, setTasks] = useState(null)
  const [assignments, setAssignments] = useState(null)
  const [contacts, setContacts] = useState(null)
  const [employments, setEmployments] = useState(null)
  const [members, setMembers] = useState(null)
  const [quality, setQuality] = useState(null)
  const [keyword, setKeyword] = useState('')
  const [onlyUnmapped, setOnlyUnmapped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)

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
    api('/filing-tasks').then(value => { if (!cancelled) setTasks(value.data ?? { list: [] }) }).catch(() => {})
    api('/filing-assignments').then(value => { if (!cancelled) setAssignments(value.data ?? { list: [] }) }).catch(() => {})
    api(`/contacts?${onlyUnmapped ? 'onlyUnmapped=1&' : ''}${keyword ? `keyword=${encodeURIComponent(keyword)}` : ''}`).then(value => { if (!cancelled) setContacts(value.data ?? { list: [] }) }).catch(() => {})
    api('/employment-records?limit=20').then(value => { if (!cancelled) setEmployments(value.data ?? { list: [] }) }).catch(() => {})
    api('/members').then(value => { if (!cancelled) setMembers(value.data ?? { list: [] }) }).catch(() => { if (!cancelled) setMembers({ list: [], forbidden: true }) })
    api('/quality').then(value => { if (!cancelled) setQuality(value) }).catch(() => {})
    return () => { cancelled = true }
  }, [revision, reloadTick, keyword, onlyUnmapped])

  const unassignedCount = (quality?.quality?.issues || []).find(issue => /unassigned|未分配/i.test(issue.label ?? issue.dataset ?? ''))?.count ?? 0

  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-row-between' },
      h(PillTabs, { tabs: [['filing', 'filingTasks'], ['my', 'myFiling'], ['org', 'directory']], value: section, onChange: setSection, t }),
      notice ? h(Notice, null, notice) : null),

    // 录入前检查（对齐前端录入前检查卡：未分配>0 时告警）
    quality ? h('div', { className: `sf-banner ${unassignedCount > 0 ? 'sf-banner-amber' : 'sf-banner-green'}` },
      h(Glyph, { name: unassignedCount > 0 ? 'warning' : 'check', size: 14 }),
      unassignedCount > 0 ? t('preCheckBad').replace('{n}', String(unassignedCount)) : t('preCheckOk')) : null,

    section === 'filing' ? h(FilingSection, { tasks, busy, t, act, onDialog: setDialog }) : null,
    section === 'my' ? h(MyFilingSection, { assignments, busy, t, act, onDialog: setDialog, onReopen: assignment => { setDialog({ kind: 'reason', title: t('reopenFiling'), required: true, run: reason => act(`/filing-assignments/${assignment.id}/reopen`, { reason }) }) } }) : null,
    section === 'org' ? h('div', { className: 'sf-stack' },
      h(DirectoryCard, { contacts, keyword, setKeyword, onlyUnmapped, setOnlyUnmapped, busy, t, act, onDialog: setDialog }),
      h(EmploymentCard, { employments, busy, t, act, onDialog: setDialog }),
      h(MembersCard, { members, busy, t, act, onDialog: setDialog })) : null,

    // 录入面板常开内嵌（对齐前端 FinanceEntryPanel）
    h(EntryPanel, { year, orgs, t, act }),

    dialog?.kind === 'createTask' ? h(CreateTaskDialog, { year, busy, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'assignment' ? h(AssignmentDialog, { assignment: dialog.assignment, busy, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'reason' ? h(ReasonDialog, { title: dialog.title, required: dialog.required, t, onClose: () => setDialog(null), onSubmit: reason => { setDialog(null); return dialog.run(reason) } }) : null,
    dialog?.kind === 'mapUser' ? h(MapUserDialog, { contact: dialog.contact, t, onClose: () => setDialog(null), act }) : null,
    dialog?.kind === 'employment' ? h(EmploymentDialog, { t, onClose: () => setDialog(null), act }) : null,
  )
}

// ---- 任务管理（财务） ----

function FilingSection({ tasks, busy, t, act, onDialog }) {
  const rows = tasks?.list || []
  return h(Card, { title: t('filingTasks'), actions: [h(PrimaryButton, { key: 'add', busy, onClick: () => onDialog({ kind: 'createTask' }) }, h(Glyph, { name: 'plus', size: 12 }), t('createTask'))] }, h(Table, {
    columns: [
      { label: t('taskTitle'), key: 'title', stickyLeft: true },
      { label: t('taskType'), render: row => row.type === 'BUDGET' ? t('typeBudget') : t('typePlan') },
      { label: t('taskYear'), key: 'year', num: true },
      { label: t('dueCol'), render: row => h('span', { className: isOverdue(row) ? 'sf-neg' : '' }, `${shortDate(row.dueAt) ?? '—'}${isOverdue(row) ? ` · ${t('overdue')}` : ''}`), num: true },
      { label: t('statusCol'), render: row => h(Pill, { tone: row.status === 'CLOSED' ? 'muted' : 'green' }, row.status === 'CLOSED' ? t('taskClosed') : t('stPending')) },
      {
        label: t('actions'),
        render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
          row.status !== 'CLOSED' ? h(LinkButton, { onClick: () => act(`/filing-tasks/${row.id}/close`, {}) }, t('closeTask')) : null),
      },
    ],
    rows, empty: t('empty'), rowKey: 'id',
  }))
}

const isOverdue = task => task.status !== 'CLOSED' && task.dueAt && new Date(task.dueAt) < new Date()

function CreateTaskDialog({ year, busy, t, onClose, act }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('BUDGET')
  const [dueAt, setDueAt] = useState('')
  const submit = () => {
    if (!title.trim() || !dueAt) return
    act('/filing-tasks', { title: title.trim(), type, year: Number(year), dueAt: new Date(`${dueAt}T23:59:59`).toISOString() })
    onClose()
  }
  return h(Dialog, { title: t('createTask'), onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: !title.trim() || !dueAt, busy, onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h(FormRow, { label: t('taskTitle') }, h(Field, { value: title, onChange: setTitle, maxLength: 150 })),
      h(FormRow, { label: t('taskType') }, h(Select, { value: type, onChange: setType, options: [['BUDGET', 'typeBudget'], ['PAYMENT_PLAN', 'typePlan']] })),
      h(FormRow, { label: t('taskDue') }, h(Field, { type: 'date', value: dueAt, onChange: setDueAt }))))
}

// ---- 我的填报（部门） ----

function MyFilingSection({ assignments, busy, t, act, onDialog, onReopen }) {
  const rows = assignments?.list || []
  return h(Card, { title: t('myFiling') }, h(Table, {
    columns: [
      { label: t('taskTitle'), render: row => row.task?.title ?? row.taskTitle ?? '—', stickyLeft: true },
      { label: t('departmentCol'), key: 'departmentName' },
      { label: t('statusCol'), render: row => h(Pill, { tone: row.status === 'LOCKED' ? 'green' : row.status === 'SUBMITTED' ? 'amber' : 'muted' }, row.status === 'LOCKED' ? t('commitFiling') : row.status === 'SUBMITTED' ? t('stSubmitted') : t('stDraft')) },
      { label: t('dueCol'), render: row => h('span', { className: isOverdue(row) ? 'sf-neg' : '' }, shortDate(row.dueAt ?? row.task?.dueAt) ?? '—'), num: true },
      {
        label: t('actions'),
        render: row => h('div', { className: 'sf-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
          h(LinkButton, { onClick: () => onDialog({ kind: 'assignment', assignment: row }) }, t('rowsEditor')),
          row.status === 'LOCKED' ? h(LinkButton, { onClick: () => onReopen(row) }, t('reopenFiling')) : null),
      },
    ],
    rows, empty: t('empty'), rowKey: 'id',
  }))
}

/** 部门行编辑器：月份/说明/金额多行 + 暂存/提交；复核定稿在弹窗内完成，重开走外层 ReasonDialog */
function AssignmentDialog({ assignment, busy, t, onClose, act }) {
  const [rows, setRows] = useState((assignment.rows ?? []).map(row => ({ ...row })))
  const updateRow = (index, patch) => setRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const payloadRows = () => rows
    .filter(row => finite(row.plannedAmount) !== null && Number(row.plannedAmount) > 0)
    .map(row => ({ ...(row.month ? { month: Number(row.month) } : {}), plannedAmount: Number(row.plannedAmount), ...(row.description ? { description: row.description } : {}) }))
  return h(Dialog, { title: `${t('assignmentTitle')} · ${assignment.departmentName ?? ''}`, width: 'lg', onClose, footer: [
    h(GhostButton, { key: 'save', busy, onClick: () => { act(`/filing-assignments/${assignment.id}/rows`, { rows: payloadRows() }, t('saved')); onClose() } }, t('saveDraft')),
    assignment.status === 'DRAFT' ? h(PrimaryButton, { key: 'submit', busy, onClick: () => { act(`/filing-assignments/${assignment.id}/submit`, {}); onClose() } }, t('submitFiling')) : null,
    assignment.status === 'SUBMITTED' ? h(PrimaryButton, { key: 'commit', busy, onClick: () => { act(`/filing-assignments/${assignment.id}/commit`, {}); onClose() } }, t('commitFiling')) : null,
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('close')),
  ] },
    h('div', { className: 'sf-stack' },
      h('div', { className: 'sf-row-between' },
        h('strong', null, t('rowsEditor')),
        h(LinkButton, { onClick: () => setRows(current => [...current, { month: '', description: '', plannedAmount: '' }]) }, h(Glyph, { name: 'plus', size: 12 }), t('addRow'))),
      ...rows.map((row, index) => h('div', { key: index, className: 'sf-inline-form' },
        h('div', { className: 'sf-filters' },
          h(FormRow, { label: t('monthCol') }, h(Field, { type: 'number', min: 1, max: 12, value: row.month ?? '', onChange: value => updateRow(index, { month: value }) })),
          h(FormRow, { label: t('description') }, h(Field, { value: row.description ?? '', onChange: value => updateRow(index, { description: value }), maxLength: 500 })),
          h(FormRow, { label: t('planned') }, h(Field, { type: 'number', min: '0.01', step: '0.01', value: row.plannedAmount ?? '', onChange: value => updateRow(index, { plannedAmount: value }) })),
          h(LinkButton, { onClick: () => setRows(current => current.filter((_, i) => i !== index)) }, h(Glyph, { name: 'trash', size: 13 }))))),
      h('p', { className: 'sf-note' }, t('entryHint'))))
}

// ---- 通讯录 / 归属 / 成员 ----

function DirectoryCard({ contacts, keyword, setKeyword, onlyUnmapped, setOnlyUnmapped, busy, t, act, onDialog }) {
  const rows = contacts?.list || []
  return h(Card, {
    title: t('directory'),
    actions: [
      h(LinkButton, { key: 'sync', onClick: () => post('/contacts-sync', { idempotencyKey: `dir-sync-${Date.now()}` }).catch(() => {}) }, t('dirSync')),
      h('label', { key: 'unmapped', className: 'sf-row', style: { gap: 6, fontSize: 12, color: 'var(--sf-ink2)' } },
        h('input', { type: 'checkbox', checked: onlyUnmapped, onChange: event => setOnlyUnmapped(event.target.checked) }), t('unmappedOnly')),
    ],
  },
    h('div', { className: 'sf-stack' },
      h(FormRow, { label: t('dirSearch') }, h(Field, { value: keyword, onChange: setKeyword, placeholder: t('dirSearch') })),
      h(Table, {
        columns: [
          { label: t('memberUser'), key: 'name', stickyLeft: true },
          { label: 'mobile', key: 'mobile' },
          { label: 'email', key: 'email' },
          { label: t('systemUserId'), render: row => row.systemUserId ? h(Badge, { tone: 'green' }, '✓') : h(Badge, { tone: 'amber' }, t('unmappedOnly')) },
          { label: t('actions'), render: row => h(LinkButton, { onClick: () => onDialog({ kind: 'mapUser', contact: row }) }, t('mapUser')) },
        ],
        rows, empty: t('empty'), rowKey: 'id',
      })))
}

function MapUserDialog({ contact, t, onClose, act }) {
  const [userId, setUserId] = useState(contact.systemUserId ?? '')
  const submit = () => {
    if (!userId.trim()) return
    act(`/contacts/${contact.id}/map-user`, { userId: userId.trim() })
    onClose()
  }
  return h(Dialog, { title: `${t('mapUser')} · ${contact.name ?? ''}`, width: 'sm', onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: !userId.trim(), onClick: submit }, t('confirm')),
  ] },
    h(FormRow, { label: t('systemUserId') }, h(Field, { value: userId, onChange: setUserId })))
}

function EmploymentCard({ employments, busy, t, act, onDialog }) {
  const rows = employments?.list || []
  return h(Card, { title: t('employmentRecords'), actions: [h(LinkButton, { key: 'add', onClick: () => onDialog({ kind: 'employment' }) }, h(Glyph, { name: 'plus', size: 12 }), t('empCreate'))] }, h(Table, {
    columns: [
      { label: t('empUser'), key: 'systemUserId', stickyLeft: true },
      { label: t('empDept'), key: 'departmentName' },
      { label: t('empStart'), render: row => shortDate(row.startDate) ?? '—', num: true },
      { label: t('lastSeen'), render: row => shortDate(row.endDate) ?? '—', num: true },
      { label: t('sourceFile'), key: 'sourceRef' },
    ],
    rows, empty: t('empty'), rowKey: 'id',
  }))
}

function EmploymentDialog({ t, onClose, act }) {
  const [systemUserId, setSystemUserId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [startDate, setStartDate] = useState('')
  const submit = () => {
    if (!systemUserId.trim() || !departmentId || !startDate) return
    act('/employment-records', { systemUserId: systemUserId.trim(), departmentId, startDate: new Date(`${startDate}T00:00:00`).toISOString() })
    onClose()
  }
  return h(Dialog, { title: t('empCreate'), onClose, footer: [
    h(GhostButton, { key: 'cancel', onClick: onClose }, t('cancel')),
    h(PrimaryButton, { key: 'ok', disabled: !systemUserId.trim() || !departmentId || !startDate, onClick: submit }, t('submit')),
  ] },
    h('div', { className: 'sf-stack' },
      h(FormRow, { label: t('empUser') }, h(Field, { value: systemUserId, onChange: setSystemUserId })),
      h(FormRow, { label: t('empDept') }, h(Field, { value: departmentId, onChange: setDepartmentId, placeholder: 'departmentId (uuid)' })),
      h(FormRow, { label: t('empStart') }, h(Field, { type: 'date', value: startDate, onChange: setStartDate }))))
}

function MembersCard({ members, busy, t, act, onDialog }) {
  const rows = members?.list || []
  return h(Card, { title: t('membersTitle') }, h(Table, {
    columns: [
      { label: t('memberUser'), render: row => row.name ?? row.userId, stickyLeft: true },
      { label: t('memberDept'), render: row => row.departmentName ?? '—' },
      {
        label: t('role'),
        render: row => h(Select, {
          value: row.role,
          onChange: value => act('/members', { userId: row.userId, role: value, name: row.name ?? undefined, enabled: row.enabled }),
          options: FINANCE_ROLES.map(role => [role, t(`roleName${role}`)]),
        }),
      },
      { label: t('enabledCol'), render: row => h(Pill, { tone: row.enabled ? 'green' : 'muted' }, row.enabled ? '✓' : '—') },
      { label: t('actions'), render: row => h(LinkButton, { onClick: () => act(`/members/${row.id}/remove`, {}) }, t('removeMember')) },
    ],
    rows, empty: members?.forbidden ? t('unknown') : t('empty'), rowKey: 'id',
  }))
}

// ---- 录入面板（4 类型；排款月份必填对齐后端校验） ----

function EntryPanel({ year, orgs, t, act }) {
  const [kind, setKind] = useState('payment')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const orgOptions = (orgs || []).map(org => [org.id, org.name])
  const years = yearOptions()

  const submit = async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const num = key => Number(form.get(key))
    const text = key => { const value = String(form.get(key) || '').trim(); return value || undefined }
    setBusy(true); setNotice(null)
    try {
      let path, payload
      if (kind === 'payment') {
        path = '/payment-plans'
        payload = { orgId: text('orgId'), planType: text('planType'), year: num('year'), description: text('description'), plannedAmount: num('plannedAmount') }
        const planMonth = text('planMonth')
        if (!planMonth) { setNotice(`${t('opFailed')}: ${t('planMonthRequired')}`); setBusy(false); return }
        payload.planMonth = num('planMonth')
        if (text('payeeName')) payload.payeeName = text('payeeName')
        if (text('costItemName')) payload.costItemName = text('costItemName')
      } else if (kind === 'revenue') {
        path = '/revenue-plans'
        payload = { orgId: text('orgId'), year: num('year'), itemName: text('itemName'), plannedAmount: num('plannedAmount') }
        if (text('month')) payload.month = num('month')
        if (text('payerName')) payload.payerName = text('payerName')
      } else if (kind === 'budget') {
        path = '/budget-lines'
        payload = { orgId: text('orgId'), year: num('year'), expenseType: text('expenseType'), budgetAmount: num('budgetAmount') }
        if (text('month')) payload.month = num('month')
        if (text('departmentName')) payload.departmentName = text('departmentName')
        if (text('costItemName')) payload.costItemName = text('costItemName')
        if (text('note')) payload.note = text('note')
      } else {
        path = `/payment-plans/${text('planId')}/actuals`
        payload = { actualAmount: num('actualAmount') }
        if (text('actualPaidAt')) payload.actualPaidAt = new Date(`${text('actualPaidAt')}T00:00:00`).toISOString()
      }
      await post(path, payload)
      setNotice(t('submitted'))
      event.currentTarget.reset()
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { setBusy(false) }
  }

  return h('form', { className: 'sf-card', key: kind, onSubmit: submit },
    h('div', { className: 'sf-card-head' }, h('h2', null, t('entryTitle')), h('span', { className: 'sf-card-unit' }, t('unitYuan'))),
    h('div', { className: 'sf-card-body' }, h('div', { className: 'sf-stack' },
      h('p', { className: 'sf-note' }, t('entryHint')),
      h(PillTabs, { tabs: [['payment', 'entryPaymentPlan'], ['revenue', 'entryRevenuePlan'], ['budget', 'entryBudgetLine'], ['backfill', 'entryBackfill']], value: kind, onChange: setKind, t }),
      h('div', { className: 'sf-form' },
        kind !== 'backfill' ? [
          h(FormRow, { key: 'org', label: t('org') }, h(Select, { name: 'orgId', required: true, options: orgOptions, placeholder: t('org') })),
          h(FormRow, { key: 'year', label: t('year') }, h(Select, { name: 'year', required: true, options: years, placeholder: t('year') })),
        ] : [
          h(FormRow, { key: 'plan', label: t('selectPlan') }, h(Field, { name: 'planId', required: true, placeholder: 'payment plan id (uuid)' })),
        ],
        kind === 'payment' ? [
          h(FormRow, { key: 'pt', label: t('planType') }, h(Select, { name: 'planType', required: true, options: PLAN_TYPES })),
          h(FormRow, { key: 'pd', label: t('description') }, h(Field, { name: 'description', required: true, maxLength: 500 })),
          h(FormRow, { key: 'pm', label: `${t('planMonth')} *` }, h(Field, { name: 'planMonth', type: 'number', min: 1, max: 12, required: true })),
          h(FormRow, { key: 'py', label: t('payee') }, h(Field, { name: 'payeeName', maxLength: 200 })),
          h(FormRow, { key: 'pc', label: t('costItem') }, h(Field, { name: 'costItemName', maxLength: 100 })),
          h(FormRow, { key: 'pa', label: `${t('planned')}（${t('unitYuan')}）` }, h(Field, { name: 'plannedAmount', type: 'number', min: 0.01, step: '0.01', required: true })),
        ] : kind === 'revenue' ? [
          h(FormRow, { key: 'ri', label: t('itemName') }, h(Field, { name: 'itemName', required: true, maxLength: 200 })),
          h(FormRow, { key: 'rm', label: t('month') }, h(Field, { name: 'month', type: 'number', min: 1, max: 12 })),
          h(FormRow, { key: 'rp', label: t('payer') }, h(Field, { name: 'payerName', maxLength: 200 })),
          h(FormRow, { key: 'rt', label: t('incomeType') }, h(Field, { name: 'incomeTypeName', maxLength: 100 })),
          h(FormRow, { key: 'ra', label: `${t('planned')}（${t('unitYuan')}）` }, h(Field, { name: 'plannedAmount', type: 'number', min: 0.01, step: '0.01', required: true })),
        ] : kind === 'budget' ? [
          h(FormRow, { key: 'be', label: t('expenseType') }, h(Select, { name: 'expenseType', required: true, options: EXPENSE_TYPES })),
          h(FormRow, { key: 'bm', label: t('month') }, h(Field, { name: 'month', type: 'number', min: 1, max: 12 })),
          h(FormRow, { key: 'bd', label: t('department') }, h(Field, { name: 'departmentName', maxLength: 100 })),
          h(FormRow, { key: 'bc', label: t('costItem') }, h(Field, { name: 'costItemName', maxLength: 100 })),
          h(FormRow, { key: 'ba', label: `${t('kpiBudget')}（${t('unitYuan')}）` }, h(Field, { name: 'budgetAmount', type: 'number', min: 0.01, step: '0.01', required: true })),
          h(FormRow, { key: 'bn', label: t('note') }, h(Field, { name: 'note', maxLength: 500 })),
        ] : [
          h(FormRow, { key: 'aa', label: t('actualAmountL') }, h(Field, { name: 'actualAmount', type: 'number', min: 0, step: '0.01', required: true })),
          h(FormRow, { key: 'ad', label: t('actualDateL') }, h(Field, { name: 'actualPaidAt', type: 'date' })),
        ],
        h('div', { className: 'sf-form-actions' },
          h(PrimaryButton, { type: 'submit', busy }, busy ? t('running') : t('submit')),
          notice ? h(Notice, null, notice) : null)))))
}

// 通讯录同步走专用路由（宿主端无 /contacts-sync 时静默失败不影响其它能力）
