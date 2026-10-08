// 片段 5/7 视图：预警（4 统计卡 + 规则集确认横幅 + 明细筛选分页 + 证据快照 Dialog + 按类型下钻）

const ALERT_TYPES = [
  ['BUDGET_OVERRUN', 'typeNew'], ['SLOW_EXECUTION', 'viewLedger'], ['CASH_GAP', 'cashSummaryV'], ['DATA_QUALITY', 'qualityTitle'],
]
const ALERT_STATUS_OPTIONS = [['OPEN', 'stPending'], ['CONFIRMED', 'stConfirmed'], ['RESOLVED', 'stResolved'], ['IGNORED', 'stIgnored'], ['', 'stAll']]

function AlertsView({ ctx, t, onDrill }) {
  const { year, orgId, revision } = ctx
  const [summary, setSummary] = useState(null)
  const [rules, setRules] = useState(null)
  const [rows, setRows] = useState(null)
  const [filters, setFilters] = useState({ severity: '', alertType: '', month: '', status: 'OPEN' })
  const [activeStat, setActiveStat] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [detail, setDetail] = useState(null)

  const load = () => {
    api('/alerts-summary').then(value => setSummary(value.data ?? {})).catch(() => setSummary({}))
    api('/alert-rules').then(value => setRules(value.data ?? { list: [], activeVersion: null })).catch(() => setRules({ list: [], activeVersion: null }))
    fetchRows()
  }
  const fetchRows = () => {
    const params = new URLSearchParams({ year, page: String(page), limit: String(PAGE_SIZE) })
    if (orgId) params.set('orgId', orgId)
    if (filters.severity) params.set('severity', filters.severity)
    if (filters.status) params.set('status', filters.status)
    api(`/alerts?${params}`).then(value => setRows(value)).catch(() => setRows({ error: true }))
  }
  useEffect(() => { load() }, [year, orgId, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchRows() }, [page, filters.severity, filters.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const runEngine = async () => {
    setBusy(true); setNotice(null)
    try {
      const result = await post('/alerts/run', {})
      const data = result.data || {}
      setNotice(t('runDone').replace('{created}', data.created ?? 0).replace('{updated}', data.updated ?? 0).replace('{resolved}', data.resolved ?? 0))
      load()
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { setBusy(false) }
  }

  const activeRuleSet = (rules?.list || []).find(item => item.status === 'ACTIVE')
  const statCards = [
    ['critical', summary?.critical ?? 0, 'rose', 'sevCritical'],
    ['warn', summary?.warn ?? 0, 'amber', 'sevWarn'],
    ['info', summary?.info ?? 0, 'sky', 'sevInfo'],
    ['resolved', summary?.resolved ?? 0, 'green', 'sevResolved'],
  ]
  const alertRows = rows?.data?.list || rows?.list || []

  const drillTarget = alertType => {
    if (alertType === 'CASH_GAP') return ['cash', {}]
    if (alertType === 'DATA_QUALITY') return ['datacenter', {}]
    return ['budget', {}]
  }

  return h('div', { className: 'sf-view' },
    h('div', { className: 'sf-row-between' },
      h('div', { className: 'sf-stats' },
        ...statCards.map(([key, value, tone, labelKey]) => h(StatCard, {
          key, label: t(labelKey), value, tone,
          active: activeStat === key,
          onClick: () => {
            const severity = key === 'resolved' ? '' : key.toUpperCase()
            setActiveStat(activeStat === key ? '' : key)
            setPage(1)
            setFilters(f => ({ ...f, severity, status: key === 'resolved' ? 'RESOLVED' : 'OPEN' }))
          },
        }))),
      h(PrimaryButton, { busy, onClick: runEngine }, h(Glyph, { name: 'refresh', size: 12 }), busy ? t('running') : t('runEngine'))),
    notice ? h(Notice, null, notice) : null,
    rules ? h('div', { className: `sf-banner ${activeRuleSet ? 'sf-banner-green' : 'sf-banner-amber'}`, role: 'status' },
      h(Glyph, { name: 'shield', size: 14 }),
      activeRuleSet
        ? t('rulesConfirmed').replace('{v}', String(activeRuleSet.version)).replace('{date}', shortDate(activeRuleSet.confirmedAt) ?? '—')
        : t('rulesUnconfirmed'),
      !activeRuleSet ? h(PrimaryButton, { onClick: () => post('/alert-rules/confirm', {}).then(() => api('/alert-rules').then(value => setRules(value.data ?? { list: [], activeVersion: null })).catch(() => {})).catch(error => setNotice(`${t('opFailed')}: ${error.message}`)) }, t('confirmDefaultRules')) : null) : null,
    h('div', { className: 'sf-filters' },
      h(Select, { value: filters.severity, onChange: value => { setPage(1); setFilters(f => ({ ...f, severity: value })) }, options: [['CRITICAL', 'sevCritical'], ['WARN', 'sevWarn'], ['INFO', 'sevInfo']], placeholder: t('severity') }),
      h(Select, { value: filters.status, onChange: value => { setPage(1); setFilters(f => ({ ...f, status: value })) }, options: ALERT_STATUS_OPTIONS.map(([id, key]) => [id, t(key)]), placeholder: t('stAll') })),
    h(Card, { title: t('alertsTitle') }, h(Table, {
      columns: [
        { label: t('severity'), render: row => h(SeverityBadge, { severity: row.severity, t }) },
        { label: t('alertType'), key: 'alertType' },
        { label: t('alertTitleCol'), key: 'title', stickyLeft: false },
        { label: t('detail'), render: row => h('span', { style: { whiteSpace: 'normal', wordBreak: 'break-all', display: 'block', maxWidth: 420, textAlign: 'left' } }, row.detail ?? '—') },
        { label: t('org'), key: 'orgName' },
        { label: t('lastSeen'), render: row => shortDate(row.lastSeenAt) ?? '—', num: true },
      ],
      rows: alertRows, empty: t('empty'),
      onRowClick: row => setDetail(row), rowKey: 'id',
    }), h(Pager, { page, total: rows?.data?.total ?? rows?.total, limit: PAGE_SIZE, onPage })),
    detail ? h(Dialog, { title: t('alertDetail'), onClose: () => setDetail(null) },
      h('div', { className: 'sf-stack' },
        h('div', { className: 'sf-row' }, h(SeverityBadge, { severity: detail.severity, t }), h(Pill, { tone: 'muted' }, detail.alertType ?? '—'), h('span', { className: 'sf-note' }, `${shortDate(detail.firstSeenAt) ?? '—'} → ${shortDate(detail.lastSeenAt) ?? '—'}`)),
        h('p', { className: 'sf-note' }, detail.detail ?? detail.title ?? ''),
        detail.evidence && Object.keys(detail.evidence).length ? h('div', null, h('strong', null, t('evidence')), h('div', { className: 'sf-evidence' }, ...Object.entries(detail.evidence).map(([key, value]) =>
          h('div', { key, className: 'sf-evidence-item' }, h('small', null, key), h('strong', null, typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')))))) : null,
        h('div', { className: 'sf-row' }, h(PrimaryButton, { onClick: () => { const [tab, params] = drillTarget(detail.alertType); setDetail(null); onDrill(tab, params) } }, t('viewSource'))))) : null,
  )
}
