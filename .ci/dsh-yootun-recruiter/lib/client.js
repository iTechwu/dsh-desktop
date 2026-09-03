window.__ModuleLoader__.load({
  id: "@dofe/dsh-yootun-recruiter",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react')
    const { createElement: h, useEffect, useState, useSyncExternalStore } = React
    const { IconFolderOpenOutline16, IconCheckOutline16, IconCloseOutline16, IconDataOutline16, IconLinkOutline16, IconRefreshOutline16, IconUserOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'dofe.yootun-recruiter'
    const PATH = '/api/desktop/yootun/recruiter'
    const STAGES = ['sourced', 'screening', 'interview', 'offer', 'hired', 'archived']
    const copy = {
      zh: {
        open: '招聘工作台', title: 'HR 招聘工作台', subtitle: '从 BOSS 直聘同步人才，让招聘数据沉淀为组织知识', close: '关闭工作台', refresh: '刷新',
        overview: '总览', roles: '岗位', candidates: '人才库', actions: '待办审批', knowledge: 'HR 知识库', analytics: '招聘分析', boss: 'BOSS 同步', loading: '正在读取招聘工作台…', retry: '重新加载', loadError: '招聘工作台加载失败',
        openRoles: '在招岗位', activeCandidates: '活跃候选人', pendingReplies: '待回复', pendingFeedback: '待反馈', pendingConfirmation: '待人工确认', todayTasks: '今日待办', responseRate: '平均响应率',
        noData: '还没有招聘数据', addRole: '在对话中创建岗位需求', funnel: '招聘漏斗', roleHealth: '岗位健康度', needsAction: '需要你处理', recent: '最近更新', source: '数据来源', ready: '已就绪', unavailable: '待连接', error: '异常', empty: '暂无数据', sample: '样本', updated: '更新时间',
        loginTitle: '使用官方页面扫码登录', loginBody: '二维码和账号会话由 BOSS 直聘页面处理，Yootun-Agent 不读取或保存它们。', openBoss: '打开 BOSS 直聘', syncNow: '开始同步', syncHint: '同步岗位、候选人阶段与面试记录；敏感信息不会进入知识库。', lastSync: '最近同步', syncRecords: '同步记录', syncWaiting: '等待用户完成官方登录',
        knowledgeTitle: 'HR 招聘知识库', knowledgeBody: '将岗位画像、面试反馈、招聘复盘和流程规范沉淀为可检索的组织资产。', knowledgeSpaces: '知识空间', knowledgeDocs: '文档', knowledgeMemories: '经验记忆', knowledgePending: '待确认沉淀', knowledgeAction: '沉淀到 HR 知识库', knowledgeOpen: '打开企业知识',
        emptyActions: '暂无待确认动作', approve: '确认动作', execute: '执行动作', dismiss: '撤销', status: '状态', waiting: '等待确认', confirmed: '已确认，等待适配器', succeeded: '适配器已完成', failed: '适配器失败', requiresLogin: '需要重新登录', dismissed: '已撤销', saveHint: '岗位与候选人分析通过 Agent 对话接口保存。',
        stage: '阶段', evidence: '岗位相关证据', concerns: '待核实问题', score: '匹配度', days: '天',
        srcLocal: '本机招聘状态', srcBoss: 'BOSS 直聘', srcKnowledge: 'HR 知识库', bossConnected: 'BOSS 直聘已连接',
        avgScreening: '平均筛选时长', offerConversion: 'Offer 转化', insightFallback: '样本不足时不输出确定性结论。', stale: '天无更新',
        preview: '预览同步范围', previewTitle: '同步预览', previewReady: '官方适配器可用，确认后即可同步', previewUnavailable: '官方适配器未配置，暂不能同步', previewFields: '同步字段', previewIncremental: '增量同步', previewFirst: '首次全量同步', conflictsKept: '本地已确认记录保留',
      },
      en: {
        open: 'Recruiting workspace', title: 'HR recruiting workspace', subtitle: 'Sync talent from BOSS and turn hiring activity into organizational knowledge', close: 'Close workspace', refresh: 'Refresh',
        overview: 'Overview', roles: 'Roles', candidates: 'Talent pool', actions: 'Approvals', knowledge: 'HR knowledge', analytics: 'Analytics', boss: 'BOSS sync', loading: 'Loading recruiting workspace…', retry: 'Try again', loadError: 'Could not load recruiting workspace',
        openRoles: 'Open roles', activeCandidates: 'Active candidates', pendingReplies: 'Pending replies', pendingFeedback: 'Pending feedback', pendingConfirmation: 'Awaiting approval', todayTasks: "Today's tasks", responseRate: 'Avg. response rate',
        noData: 'No recruiting data yet', addRole: 'Create a role requirement in chat', funnel: 'Hiring funnel', roleHealth: 'Role health', needsAction: 'Needs your attention', recent: 'Recently updated', source: 'Data source', ready: 'Ready', unavailable: 'Needs connection', error: 'Error', empty: 'No data', sample: 'Sample', updated: 'Updated',
        loginTitle: 'Scan on the official login page', loginBody: 'BOSS handles the QR code and account session. Yootun-Agent does not read or store them.', openBoss: 'Open BOSS Zhipin', syncNow: 'Start sync', syncHint: 'Sync roles, candidate stages, and interview notes. Sensitive data never enters the knowledge base.', lastSync: 'Last sync', syncRecords: 'Sync records', syncWaiting: 'Complete login on the official page',
        knowledgeTitle: 'HR recruiting knowledge base', knowledgeBody: 'Turn role profiles, interview feedback, hiring retrospectives, and process playbooks into searchable organizational assets.', knowledgeSpaces: 'Knowledge spaces', knowledgeDocs: 'Documents', knowledgeMemories: 'Memories', knowledgePending: 'Pending curation', knowledgeAction: 'Save to HR knowledge', knowledgeOpen: 'Open enterprise knowledge',
        emptyActions: 'No actions awaiting approval', approve: 'Approve action', execute: 'Execute action', dismiss: 'Dismiss', status: 'Status', waiting: 'Awaiting approval', confirmed: 'Approved, adapter pending', succeeded: 'Adapter completed', failed: 'Adapter failed', requiresLogin: 'Login required', dismissed: 'Dismissed', saveHint: 'Save roles and candidate analysis through the Agent conversation interface.',
        stage: 'Stage', evidence: 'Role-related evidence', concerns: 'Open questions', score: 'Match score', days: 'days',
        srcLocal: 'Local recruiting state', srcBoss: 'BOSS Zhipin', srcKnowledge: 'HR knowledge', bossConnected: 'BOSS Zhipin connected',
        avgScreening: 'Avg. screening days', offerConversion: 'Offer conversion', insightFallback: 'No firm conclusion until the sample is sufficient.', stale: 'days without updates',
        preview: 'Preview sync scope', previewTitle: 'Sync preview', previewReady: 'Official adapter ready; confirm to sync', previewUnavailable: 'Official adapter not configured; sync unavailable', previewFields: 'Synced fields', previewIncremental: 'Incremental sync', previewFirst: 'First full sync', conflictsKept: 'locally confirmed kept',
      },
    }

    let opened = false
    const listeners = new Set()
    const emit = () => listeners.forEach(listener => listener())
    const setOpened = value => { opened = value; emit() }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    const snapshot = () => opened
    async function load(signal) { const response = await fetch(PATH, { credentials: 'same-origin', signal, headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error('recruiter request failed'); return response.json() }
    async function mutate(body) { const response = await fetch(PATH, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error('recruiter mutation failed'); return response.json() }
    function number(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback }
    function list(value) { return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 8) : [] }
    function sourceState(value) { return ['ready', 'empty', 'unavailable', 'error'].includes(value) ? value : 'unavailable' }
    function statusText(status, t) { return status === 'awaiting_confirmation' ? t('waiting') : status === 'confirmed_pending_adapter' ? t('confirmed') : status === 'succeeded' ? t('succeeded') : status === 'failed' ? t('failed') : status === 'requires_user_login' ? t('requiresLogin') : t('dismissed') }
    function SourceBadge({ label, state, t }) { const status = sourceState(state); return h('span', { className: `yr-source yr-source-${status}` }, h('i', { 'aria-hidden': true }), `${label} · ${status === 'ready' ? t('ready') : status === 'empty' ? t('empty') : status === 'error' ? t('error') : t('unavailable')}`) }
    function Metric({ label, value }) { return h('div', { className: 'yr-metric' }, h('span', null, label), h('strong', null, String(value ?? 0))) }
    function Status({ status, t }) { return h('span', { className: `yr-status yr-status-${status}` }, h('i', { 'aria-hidden': true }), statusText(status, t)) }
    function Funnel({ data, t }) {
      const rows = Array.isArray(data.dashboard?.funnel)
        ? data.dashboard.funnel
        : STAGES.map(stage => ({ stage, count: (data.candidates || []).filter(item => item.stage === stage).length }))
      const max = Math.max(1, ...rows.map(item => number(item.count)))
      return h('section', { className: 'yr-panel' },
        h('div', { className: 'yr-panel-title' },
          h('h2', null, t('funnel')),
          h('span', { className: 'yr-muted' }, `${rows.reduce((sum, item) => sum + number(item.count), 0)} ${t('sample')}`),
        ),
        h('div', { className: 'yr-funnel' }, rows.map((item, index) =>
          h('div', { className: 'yr-funnel-row', key: item.stage },
            h('span', null, item.stage),
            h('div', { className: 'yr-bar-track' }, h('span', { className: 'yr-bar', style: { width: `${Math.max(4, number(item.count) / max * 100)}%` } })),
            h('strong', null, String(number(item.count))),
            index > 0 && number(rows[index - 1].count) > 0 ? h('small', null, `${Math.round(number(item.count) / number(rows[index - 1].count) * 100)}%`) : null,
          )),
        ),
      )
    }
    function ActionRow({ item, t, onUpdate }) { const executable = ['confirmed_pending_adapter', 'failed', 'requires_user_login'].includes(item.status); return h('article', { className: 'yr-action' }, h('div', { className: 'yr-action-main' }, h('strong', null, item.targetLabel), h('span', null, item.summary), h(Status, { status: item.status, t })), item.status === 'awaiting_confirmation' ? h('div', { className: 'yr-action-buttons' }, h('button', { type: 'button', onClick: () => onUpdate?.({ action: 'confirm_action', id: item.id }) }, h(IconCheckOutline16, { size: 14 }), t('approve')), h('button', { type: 'button', onClick: () => onUpdate?.({ action: 'dismiss_action', id: item.id }) }, h(IconCloseOutline16, { size: 14 }), t('dismiss'))) : executable ? h('div', { className: 'yr-action-buttons' }, h('button', { type: 'button', onClick: () => onUpdate?.({ action: 'execute_action', id: item.id }) }, h(IconRefreshOutline16, { size: 14 }), t('execute'))) : null) }
    function staleDays(role) { const time = Date.parse(role.updatedAt || ''); return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 86400000)) : null }
    function Overview({ data, t, onUpdate }) {
      const d = data.dashboard || {}
      const localState = data.status || (data.dashboard ? 'ready' : 'unavailable')
      const sync = data.sync || {}
      const knowledge = data.knowledge || {}
      const pending = (data.actions || []).filter(item => item.status === 'awaiting_confirmation').slice(0, 5)
      const roles = (data.requirements || []).filter(role => role.status === 'active').slice(0, 4)
      return h('div', { className: 'yr-page' },
        h('div', { className: 'yr-source-row' },
          h(SourceBadge, { label: t('srcLocal'), state: localState, t }),
          h(SourceBadge, { label: t('srcBoss'), state: sync.status === 'connected' || sync.status === 'ready' ? 'ready' : sync.status, t }),
          h(SourceBadge, { label: t('srcKnowledge'), state: knowledge.status, t }),
        ),
        h('div', { className: 'yr-metrics' },
          h(Metric, { label: t('todayTasks'), value: number(d.pendingConfirmation) + number(d.pendingFeedback) }),
          h(Metric, { label: t('openRoles'), value: d.openRoles }),
          h(Metric, { label: t('activeCandidates'), value: d.activeCandidates }),
          h(Metric, { label: t('responseRate'), value: d.responseRate == null ? '—' : `${number(d.responseRate)}%` }),
        ),
        h('div', { className: 'yr-dashboard-grid' },
          h(Funnel, { data, t }),
          h('section', { className: 'yr-panel' },
            h('div', { className: 'yr-panel-title' }, h('h2', null, t('needsAction')), h('strong', { className: 'yr-count' }, String(number(d.pendingConfirmation)))),
            pending.length ? pending.map(item => h(ActionRow, { key: item.id, item, t, onUpdate })) : h('div', { className: 'yr-empty yr-empty-compact' }, t('emptyActions')),
          ),
        ),
        h('div', { className: 'yr-dashboard-grid' },
          h('section', { className: 'yr-panel' },
            h('div', { className: 'yr-panel-title' }, h('h2', null, t('roleHealth')), h('span', { className: 'yr-muted' }, String(roles.length))),
            roles.length ? roles.map(role => { const days = staleDays(role); const stale = days !== null && days >= 14; return h('div', { className: 'yr-health-row', key: role.id }, h('div', null, h('strong', null, role.title), h('span', null, `${role.department} · ${role.location}`)), h('span', { className: stale ? 'yr-health-warn' : 'yr-health-good' }, stale ? `${days} ${t('stale')}` : role.status)) }) : h('div', { className: 'yr-empty yr-empty-compact' }, t('noData')),
          ),
          h('section', { className: 'yr-panel yr-knowledge-teaser' },
            h('div', { className: 'yr-panel-title' }, h('h2', null, t('knowledgeTitle')), h(SourceBadge, { label: 'HR', state: knowledge.status, t })),
            h('p', null, t('knowledgeBody')),
            h('div', { className: 'yr-mini-stats' }, h('span', null, `${number(knowledge.documents)} ${t('knowledgeDocs')}`), h('span', null, `${number(knowledge.memories)} ${t('knowledgeMemories')}`), h('span', null, `${number(knowledge.pending)} ${t('knowledgePending')}`)),
          ),
        ),
        h('p', { className: 'yr-note' }, t('syncHint')),
      )
    }
    function Roles({ data, t }) { const roles = data.requirements || []; return h('div', { className: 'yr-page' }, h('div', { className: 'yr-heading' }, h('div', null, h('h2', null, t('roles')), h('p', { className: 'yr-subheading' }, t('addRole'))), h('span', { className: 'yr-muted' }, String(roles.length))), roles.length ? h('div', { className: 'yr-list' }, roles.map(role => h('article', { className: 'yr-card', key: role.id }, h('div', { className: 'yr-card-head' }, h('div', null, h('strong', null, role.title), h('span', { className: 'yr-muted' }, `${role.department} · ${role.location}`)), h('span', { className: `yr-pill yr-pill-${role.status}` }, role.status)), h('div', { className: 'yr-role-meta' }, h('span', null, `${role.headcount} HC`), h('span', null, role.employmentType), role.salaryMin || role.salaryMax ? h('span', null, `${role.salaryMin || '—'}-${role.salaryMax || '—'}`) : null), h('p', null, list(role.requiredSkills).join(' · ')), h('small', { className: 'yr-muted' }, `${t('updated')}: ${role.updatedAt || '—'}`)))) : h('div', { className: 'yr-empty' }, t('noData'), h('span', null, t('addRole')))) }
    function Candidates({ data, t }) { const candidates = data.candidates || []; return h('div', { className: 'yr-page' }, h('div', { className: 'yr-heading' }, h('div', null, h('h2', null, t('candidates')), h('p', { className: 'yr-subheading' }, t('evidence'))), h('span', { className: 'yr-muted' }, String(candidates.length))), candidates.length ? h('div', { className: 'yr-pipeline' }, STAGES.filter(stage => candidates.some(item => item.stage === stage)).map(stage => h('section', { className: 'yr-stage', key: stage }, h('div', { className: 'yr-stage-title' }, h('strong', null, stage), h('span', null, String(candidates.filter(item => item.stage === stage).length))), candidates.filter(item => item.stage === stage).map(candidate => h('article', { className: 'yr-card yr-candidate', key: candidate.id }, h('div', { className: 'yr-card-head' }, h('strong', null, candidate.displayName), candidate.matchScore === undefined ? null : h('span', { className: 'yr-score' }, `${candidate.matchScore}`)), h('p', null, list(candidate.evidence).join(' · ') || t('empty')), h('p', { className: 'yr-muted' }, `${t('concerns')}: ${list(candidate.concerns).join(' · ') || '—'}`), h('small', { className: 'yr-muted' }, `${t('status')}: ${candidate.feedbackStatus || 'none'}`)))))) : h('div', { className: 'yr-empty' }, t('noData'))) }
    function Actions({ data, t, onUpdate }) { const actions = data.actions || []; return h('div', { className: 'yr-page' }, h('div', { className: 'yr-heading' }, h('div', null, h('h2', null, t('actions')), h('p', { className: 'yr-subheading' }, t('pendingConfirmation'))), h('span', { className: 'yr-muted' }, String(actions.length))), actions.length ? h('div', { className: 'yr-list' }, actions.map(item => h(ActionRow, { key: item.id, item, t, onUpdate }))) : h('div', { className: 'yr-empty' }, t('emptyActions'))) }
    function Knowledge({ data, t, onUpdate }) {
      const knowledge = data.knowledge || {}
      const recent = Array.isArray(knowledge.recent) ? knowledge.recent : []
      return h('div', { className: 'yr-page' },
        h('section', { className: 'yr-hero-panel' },
          h('div', { className: 'yr-hero-icon' }, h(IconFolderOpenOutline16, { size: 20 })),
          h('div', null, h('h2', null, t('knowledgeTitle')), h('p', null, t('knowledgeBody'))),
          h(SourceBadge, { label: 'HR', state: knowledge.status, t }),
        ),
        h('div', { className: 'yr-metrics' },
          h(Metric, { label: t('knowledgeSpaces'), value: knowledge.spaces }), h(Metric, { label: t('knowledgeDocs'), value: knowledge.documents }),
          h(Metric, { label: t('knowledgeMemories'), value: knowledge.memories }), h(Metric, { label: t('knowledgePending'), value: knowledge.pending }),
        ),
        h('section', { className: 'yr-panel' },
          h('div', { className: 'yr-panel-title' }, h('h2', null, t('recent')), h('span', { className: 'yr-muted' }, String(recent.length))),
          recent.length ? recent.map(item => h('div', { className: 'yr-recent-row', key: item.id || item.title }, h('strong', null, item.title), h('span', { className: 'yr-muted' }, item.updatedAt || '—'))) : h('div', { className: 'yr-empty yr-empty-compact' }, t('empty')),
        ),
        h('div', { className: 'yr-knowledge-actions' },
          h('button', { type: 'button', onClick: () => onUpdate?.({ action: 'publish_knowledge', scope: 'hr-recruiting' }), disabled: knowledge.status !== 'ready' }, h(IconCheckOutline16, { size: 14 }), t('knowledgeAction')),
          h('a', { href: 'https://ixicai.cn', target: '_blank', rel: 'noreferrer', className: 'yr-secondary' }, h(IconLinkOutline16, { size: 14 }), t('knowledgeOpen')),
        ),
      )
    }
    function Analytics({ data, t }) { const a = data.analytics || {}; const localState = data.status || (data.dashboard ? 'ready' : 'unavailable'); return h('div', { className: 'yr-page' }, h('div', { className: 'yr-heading' }, h('div', null, h('h2', null, t('analytics')), h('p', { className: 'yr-subheading' }, `${t('updated')}: ${a.updatedAt || data.updatedAt || '—'}`)), h(SourceBadge, { label: t('srcLocal'), state: localState, t })), h('div', { className: 'yr-metrics' }, h(Metric, { label: t('responseRate'), value: a.responseRate == null ? '—' : `${number(a.responseRate)}%` }), h(Metric, { label: t('avgScreening'), value: a.avgScreeningDays == null ? '—' : `${number(a.avgScreeningDays)} ${t('days')}` }), h(Metric, { label: t('offerConversion'), value: a.offerConversion == null ? '—' : `${number(a.offerConversion)}%` }), h(Metric, { label: t('knowledgePending'), value: (data.knowledge || {}).pending })), h(Funnel, { data, t }), h('section', { className: 'yr-panel' }, h('p', { className: 'yr-note' }, a.insight || t('insightFallback')))) }
    function Boss({ data, t, onUpdate }) {
      const sync = data.sync || {}
      const connected = sync.status === 'connected' || sync.status === 'ready'
      const canSync = data.boss?.adapter === 'official'
      const preview = data.syncPreview
      return h('div', { className: 'yr-page' },
        h('section', { className: 'yr-hero-panel yr-boss-panel', 'data-boss-status': data.boss?.status || 'requires_user_login', 'data-boss-adapter': data.boss?.adapter || 'not_configured' },
          h('div', { className: 'yr-hero-icon' }, h(IconUserOutline16, { size: 20 })),
          h('div', null, h('h2', null, connected ? t('bossConnected') : t('loginTitle')), h('p', null, t('loginBody'))),
          h(SourceBadge, { label: t('srcBoss'), state: connected ? 'ready' : 'unavailable', t }),
        ),
        h('div', { className: 'yr-sync-grid' },
          h('div', { className: 'yr-panel' }, h('h2', null, t('syncRecords')), h('div', { className: 'yr-sync-number' }, `${number(sync.imported)} / ${number(sync.updated)}`), h('p', { className: 'yr-muted' }, `${t('lastSync')}: ${sync.lastSuccessAt || '—'}`), number(sync.conflictsPreserved) > 0 ? h('p', { className: 'yr-muted' }, `${number(sync.conflictsPreserved)} ${t('conflictsKept')}`) : null),
          h('div', { className: 'yr-panel' }, h('h2', null, t('syncHint')), h('p', null, sync.reason || t('syncWaiting')), h('div', { className: 'yr-sync-actions' }, h('button', { type: 'button', onClick: () => onUpdate?.({ action: 'sync_preview' }) }, h(IconDataOutline16, { size: 14 }), t('preview')), canSync ? h('button', { type: 'button', onClick: () => onUpdate?.({ action: 'sync_boss' }) }, h(IconRefreshOutline16, { size: 14 }), t('syncNow')) : null, h('a', { className: 'yr-primary', href: data.boss?.loginUrl || 'https://www.zhipin.com/web/user/?ka=header-login', target: '_blank', rel: 'noreferrer' }, h(IconLinkOutline16, { size: 14 }), t('openBoss')))),
        ),
        preview ? h('section', { className: 'yr-panel' },
          h('div', { className: 'yr-panel-title' }, h('h2', null, t('previewTitle')), h('span', { className: 'yr-muted' }, preview.status === 'ready' ? t('previewReady') : t('previewUnavailable'))),
          h('div', { className: 'yr-role-meta' },
            h('span', null, preview.increment === 'cursor' ? t('previewIncremental') : t('previewFirst')),
            h('span', null, `${t('roles')} ${number(preview.scope?.requirements)}`),
            h('span', null, `${t('candidates')} ${number(preview.scope?.candidates)}`),
          ),
          h('p', { className: 'yr-muted' }, `${t('previewFields')}: ${Array.isArray(preview.fields) && preview.fields.length > 0 ? preview.fields.join(' · ') : '—'}`),
        ) : null,
      )
    }
    function Overlay({ t }) {
      const visible = useSyncExternalStore(subscribe, snapshot, snapshot)
      const [tab, setTab] = useState('overview')
      const [data, setData] = useState(null)
      const [error, setError] = useState(false)
      const [loading, setLoading] = useState(false)
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        if (!visible) return undefined
        const controller = new AbortController()
        setError(false)
        setLoading(true)
        void load(controller.signal).then(value => { setData(value); setError(false) }).catch(e => { if (e?.name !== 'AbortError') setError(true) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
      }, [visible, revision])
      useEffect(() => {
        if (!visible) return undefined
        const key = event => { if (event.key === 'Escape') setOpened(false) }
        window.addEventListener('keydown', key)
        return () => window.removeEventListener('keydown', key)
      }, [visible])
      if (!visible) return null
      const tData = data || { status: 'empty', dashboard: {}, requirements: [], candidates: [], actions: [], boss: {}, sync: {}, knowledge: {}, analytics: {} }
      const update = async body => { try { setData(await mutate(body)); setError(false) } catch { setError(true) } }
      let body
      if (loading && !data) body = h('div', { className: 'yr-empty yr-loading', role: 'status' }, h('span', { className: 'yr-spinner', 'aria-hidden': true }), t('loading'))
      else if (error && !data) body = h('div', { className: 'yr-empty', role: 'alert' }, t('loadError'), h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, h(IconRefreshOutline16, { size: 14 }), t('retry')))
      else if (tab === 'overview') body = h(Overview, { data: tData, t, onUpdate: update })
      else if (tab === 'roles') body = h(Roles, { data: tData, t })
      else if (tab === 'candidates') body = h(Candidates, { data: tData, t })
      else if (tab === 'actions') body = h(Actions, { data: tData, t, onUpdate: update })
      else if (tab === 'knowledge') body = h(Knowledge, { data: tData, t, onUpdate: update })
      else if (tab === 'analytics') body = h(Analytics, { data: tData, t })
      else body = h(Boss, { data: tData, t, onUpdate: update })
      const tabs = [['overview', t('overview')], ['roles', t('roles')], ['candidates', t('candidates')], ['actions', t('actions')], ['knowledge', t('knowledge')], ['analytics', t('analytics')], ['boss', t('boss')]]
      return h('div', { className: 'yr-overlay' }, h('main', { className: 'yr-shell', 'aria-labelledby': 'yr-title' },
        h('header', { className: 'yr-header' }, h('div', null, h('h1', { id: 'yr-title' }, t('title')), h('p', null, t('subtitle'))), h('div', { className: 'yr-header-buttons' }, h(Tooltip, { label: t('refresh') }, h('button', { type: 'button', className: 'yr-icon', 'aria-label': t('refresh'), disabled: loading, onClick: () => setRevision(value => value + 1) }, h(IconRefreshOutline16, { size: 16 }))), h(Tooltip, { label: t('close') }, h('button', { type: 'button', className: 'yr-icon', 'aria-label': t('close'), onClick: () => setOpened(false) }, h(IconCloseOutline16, { size: 16 }))))),
        h('nav', { className: 'yr-tabs', 'aria-label': t('title') }, tabs.map(([id, label]) => h('button', { type: 'button', key: id, 'data-active': tab === id, 'aria-current': tab === id ? 'page' : undefined, onClick: () => setTab(id) }, label))),
        h('div', { className: 'yr-content' }, body),
      ))
    }
    function SidebarButton({ wide, t }) { return h(Tooltip, { label: t('open'), delayMs: 500, disabled: wide }, h('button', { type: 'button', className: `yr-sidebar-button${wide ? ' yr-sidebar-wide' : ''}`, 'aria-label': t('open'), onClick: () => setOpened(true) }, h(IconFolderOpenOutline16, { size: wide ? 14 : 18 }), wide ? h('span', null, t('open')) : null)) }
    const css = `.yr-sidebar-button{box-sizing:border-box;display:flex;width:36px;height:36px;align-items:center;justify-content:center;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}.yr-sidebar-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.yr-sidebar-wide{width:100%;height:34px;justify-content:flex-start;padding:0 10px}.yr-sidebar-wide span{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yr-overlay{position:fixed;inset:0;z-index:510;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.yr-shell{display:grid;grid-template-rows:auto auto minmax(0,1fr);width:100%;height:100%;overflow:hidden}.yr-header{display:flex;min-height:74px;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yr-header h1{margin:0;font-size:20px;letter-spacing:0}.yr-header p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}.yr-header-buttons{display:flex;gap:6px}.yr-icon{display:grid;width:34px;height:34px;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer}.yr-tabs{display:flex;gap:2px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto}.yr-tabs button{height:42px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}.yr-tabs button[data-active=true]{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:650}.yr-content{min-height:0;overflow:auto;padding:22px 24px 40px}.yr-page{display:grid;width:100%;max-width:1160px;margin:0 auto;align-content:start;gap:18px}.yr-source-row{display:flex;flex-wrap:wrap;gap:8px}.yr-source{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:11px}.yr-source i,.yr-status i{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}.yr-source-ready{color:var(--dsw-alias-state-success-primary)}.yr-source-ready i{background:var(--dsw-alias-state-success-primary)}.yr-source-error{color:var(--dsw-alias-state-error-primary)}.yr-source-error i{background:var(--dsw-alias-state-error-primary)}.yr-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-block:1px solid var(--dsw-alias-border-l1)}.yr-metric{display:grid;min-height:82px;align-content:center;gap:5px;padding:12px 16px;border-right:1px solid var(--dsw-alias-border-l1)}.yr-metric:last-child{border-right:0}.yr-metric span,.yr-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.yr-metric strong{font-size:24px;font-variant-numeric:tabular-nums}.yr-dashboard-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:18px}.yr-panel,.yr-hero-panel{display:grid;align-content:start;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yr-panel-title,.yr-heading,.yr-card-head,.yr-stage-title,.yr-health-row,.yr-recent-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.yr-panel-title h2,.yr-heading h2,.yr-panel h2{margin:0;font-size:14px;letter-spacing:0}.yr-count{font-size:18px}.yr-funnel{display:grid;gap:11px}.yr-funnel-row{display:grid;grid-template-columns:78px minmax(0,1fr) 34px 40px;align-items:center;gap:8px;font-size:12px}.yr-funnel-row>span{text-transform:capitalize;color:var(--dsw-alias-label-secondary)}.yr-funnel-row small{color:var(--dsw-alias-label-tertiary);text-align:right}.yr-bar-track{height:7px;overflow:hidden;border-radius:99px;background:var(--dsw-alias-bg-layer-3)}.yr-bar{display:block;height:100%;border-radius:99px;background:var(--dsw-alias-brand-primary)}.yr-list{display:grid;gap:0}.yr-action,.yr-card{display:grid;gap:8px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l1)}.yr-action:first-child,.yr-card:first-child{border-top:0}.yr-action-main{display:grid;gap:4px;min-width:0}.yr-action-main strong,.yr-action-main span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yr-action-main span,.yr-card p,.yr-note,.yr-hero-panel p,.yr-knowledge-teaser p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}.yr-action-buttons,.yr-sync-actions,.yr-knowledge-actions{display:flex;flex-wrap:wrap;gap:7px}.yr-action-buttons button,.yr-empty button,.yr-sync-actions button,.yr-knowledge-actions button,.yr-secondary{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-decoration:none;cursor:pointer}.yr-action-buttons button:first-child,.yr-knowledge-actions button{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.yr-action-buttons button:disabled,.yr-knowledge-actions button:disabled{opacity:.45;cursor:default}.yr-status{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:11px}.yr-status-awaiting_confirmation i{background:var(--dsw-alias-state-warning-primary)}.yr-status-confirmed_pending_adapter i,.yr-status-succeeded i{background:var(--dsw-alias-state-success-primary)}.yr-status-failed i,.yr-status-requires_user_login i{background:var(--dsw-alias-state-error-primary)}.yr-status-succeeded{color:var(--dsw-alias-state-success-primary)}.yr-status-failed,.yr-status-requires_user_login{color:var(--dsw-alias-state-error-primary)}.yr-status-dismissed{color:var(--dsw-alias-label-tertiary)}.yr-health-row{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}.yr-health-row:first-of-type{border-top:0}.yr-health-row div{display:grid;gap:3px}.yr-health-row span{color:var(--dsw-alias-label-secondary);font-size:11px}.yr-health-good{color:var(--dsw-alias-state-success-primary)!important}.yr-health-warn{color:var(--dsw-alias-state-warning-primary)!important}.yr-mini-stats{display:flex;flex-wrap:wrap;gap:8px}.yr-mini-stats span{padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;color:var(--dsw-alias-label-secondary);font-size:11px}.yr-empty{display:grid;min-height:180px;place-items:center;align-content:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}.yr-empty-compact{min-height:96px}.yr-empty span,.yr-subheading{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px}.yr-heading{align-items:flex-start}.yr-heading>div{display:grid;gap:4px}.yr-pill{padding:4px 7px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}.yr-pill-active{color:var(--dsw-alias-state-success-primary)}.yr-role-meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11px}.yr-pipeline{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.yr-stage{display:grid;align-content:start;gap:4px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}.yr-stage-title{padding-bottom:7px;color:var(--dsw-alias-label-secondary);font-size:12px}.yr-candidate{padding:12px 0}.yr-score{color:var(--dsw-alias-brand-primary);font-weight:650}.yr-hero-panel{grid-template-columns:auto 1fr auto;align-items:start}.yr-hero-icon{display:grid;width:40px;height:40px;place-items:center;border-radius:7px;background:var(--dsw-alias-bg-layer-2)}.yr-hero-panel h2{font-size:17px}.yr-boss-panel{align-items:center}.yr-sync-grid{display:grid;grid-template-columns:minmax(0,.7fr) minmax(0,1.3fr);gap:18px}.yr-sync-number{font-size:28px;font-weight:650}.yr-knowledge-actions{justify-content:flex-end}.yr-primary{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 13px;border-radius:6px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse,#fff);font:inherit;text-decoration:none}.yr-icon:disabled{opacity:.45;cursor:default}.yr-loading{grid-auto-flow:column;justify-content:center}.yr-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:yr-spin .8s linear infinite}@keyframes yr-spin{to{transform:rotate(360deg)}}@media(max-width:900px){.yr-dashboard-grid,.yr-sync-grid{grid-template-columns:1fr}.yr-pipeline{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:800px){.yr-header,.yr-tabs{padding-left:16px;padding-right:16px}.yr-content{padding:18px 16px 32px}.yr-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.yr-metric:nth-child(2){border-right:0}.yr-metric:nth-child(-n+2){border-bottom:1px solid var(--dsw-alias-border-l1)}.yr-hero-panel{grid-template-columns:auto 1fr}.yr-hero-panel>.yr-source{grid-column:1/-1}.yr-card-head{align-items:flex-start}.yr-action{align-items:flex-start;flex-direction:column}.yr-action-buttons{width:100%}.yr-action-buttons button{flex:1;justify-content:center}}@media(max-width:560px){.yr-header h1{font-size:17px}.yr-header p{display:none}.yr-metric{min-height:72px;padding:10px}.yr-metric strong{font-size:20px}.yr-pipeline{grid-template-columns:1fr}.yr-funnel-row{grid-template-columns:65px minmax(0,1fr) 28px 36px}.yr-hero-panel{grid-template-columns:1fr}.yr-hero-icon{display:none}}`
    function apply(ctx) { ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-recruiter: dictionaries'); ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = '@dofe/dsh-yootun-recruiter'; style.textContent = css; document.head.appendChild(style); return () => style.remove() }, 'dofe-yootun-recruiter: styles'); const t = ctx.locale.bind(NS); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dofe-yootun-recruiter', order: 20, inject: () => ({ t }) }, SidebarButton)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dofe-yootun-recruiter', order: 20, inject: () => ({ t }) }, Overlay)) }
    exports.apply = apply
    exports.inject = ['slots', 'locale']

    return module.exports;
  },
});
