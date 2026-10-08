// 片段 5/7 视图：数据中心（数据源配置控制台 + 同步批次 + 数据集规模 + 质量清单 + 导入批次）

function DataCenterView({ ctx, t }) {
  const { revision } = ctx
  const [configs, setConfigs] = useState(null)
  const [runs, setRuns] = useState(null)
  const [quality, setQuality] = useState(null)
  const [batches, setBatches] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = () => {
    api('/data-source-configs').then(value => setConfigs(value.data ?? { list: [] })).catch(() => setConfigs({ list: [] }))
    api('/data-source-runs?limit=20').then(value => setRuns(value.data ?? { list: [] })).catch(() => setRuns({ list: [] }))
    api('/quality').then(value => setQuality(value)).catch(() => setQuality({ error: true }))
  }
  useEffect(() => { load() }, [revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async config => {
    setBusy(true); setNotice(null)
    try {
      await post(`/data-source-configs/${config.id}/active`, { active: !config.active })
      setNotice(t('saved'))
      load()
    } catch (error) { setNotice(`${t('opFailed')}: ${error.message}`) } finally { setBusy(false) }
  }

  const issues = quality?.quality?.issues || []
  const batchList = quality?.batches?.list || []
  const runList = runs?.list || []
  const runTone = run => run.status === 'SUCCESS' ? 'green' : run.status === 'FAILED' ? 'rose' : 'amber'

  return h('div', { className: 'sf-view' },
    notice ? h(Notice, null, notice) : null,
    h(Card, { title: t('dsConfigs') }, h(Table, {
      columns: [
        { label: t('dsScope'), render: row => row.scope === 'HEADQUARTERS' ? t('scopeHq') : t('scopeHezhong') },
        { label: t('dsKind'), render: row => row.kind === 'DSS' ? t('kindDss') : t('kindFeishu') },
        { label: t('dataset'), key: 'displayName' },
        { label: t('dsEndpoint'), render: row => row.endpoint ?? '—' },
        { label: t('statusCol'), render: row => h(Pill, { tone: row.active ? 'green' : 'muted' }, row.active ? t('dsEnabled') : t('dsDisable')) },
        { label: t('actions'), render: row => h(LinkButton, { onClick: () => toggle(row) }, row.active ? t('dsDisable') : t('dsEnable')) },
      ],
      rows: configs?.list || [], empty: t('empty'), rowKey: 'id',
    })),
    h('div', { className: 'sf-two-col' },
      h(Card, { title: t('dsRuns') }, h('div', { className: 'sf-timeline' },
        runList.length ? runList.map((run, index) => h('div', { key: run.id ?? index, className: 'sf-timeline-row' },
          h('span', { className: `sf-timeline-dot is-${runTone(run)}` }),
          h('div', { className: 'sf-timeline-main' },
            h('span', null, `${run.bizSystem ?? '—'} · ${run.scope ?? ''}`),
            h('small', null, `${shortDate(run.runAt ?? run.startedAt) ?? ''}${run.fallbackReason ? ` · ${t('dsFallback')}: ${run.fallbackReason}` : ''}`)),
          h(Pill, { tone: runTone(run) }, run.status ?? '—'))) : h(EmptyState, null, t('empty')))),
      h(Card, { title: t('qualityTitle') }, h(Table, {
        columns: [
          { label: t('dataset'), key: 'dataset' },
          { label: t('issue'), key: 'label' },
          { label: t('count'), key: 'count', num: true },
          { label: t('severity'), render: row => h(SeverityBadge, { severity: row.severity === 'CRITICAL' ? 'CRITICAL' : row.severity === 'WARN' ? 'WARN' : 'INFO', t }) },
        ],
        rows: issues, empty: t('empty'),
      }))),
    h(Card, { title: t('batchesTitle') }, h(Table, {
      columns: [
        { label: t('bizType'), key: 'bizType' },
        { label: t('sourceFile'), key: 'sourceFile' },
        { label: t('rows'), key: 'totalRows', num: true },
        { label: t('successRows'), key: 'successRows', num: true },
        { label: t('failedRows'), key: 'failedRows', num: true },
        { label: t('batchStatus'), key: 'status' },
        { label: t('startedAt'), render: row => shortDate(row.startedAt) ?? '—', num: true },
      ],
      rows: batchList, empty: t('empty'),
    })))
}
