// 片段 5/7 视图：深度分析入口（预制指令投递当前会话，Agent 调 mcp__finance__* 完成分析）

function sendToAgent(prompt, setNotice, t) {
  // 优先直接投递到当前会话；宿主未暴露 conversation 服务时降级为剪贴板复制。
  try {
    const conversation = globalThis.__sensteed_finance_conversation?.() ?? null
    if (conversation?.send) {
      void conversation.send(prompt).then(() => setNotice(t('sent'))).catch(() => copyFallback(prompt, setNotice, t))
      return
    }
  } catch { /* fallthrough */ }
  copyFallback(prompt, setNotice, t)
}

function copyFallback(prompt, setNotice, t) {
  const done = () => setNotice(t('sendFail'))
  try { navigator.clipboard?.writeText(prompt)?.then?.(done, done) } catch { done() }
}

function AnalyzeView({ ctx, t }) {
  const { year, orgId, orgs } = ctx
  const [notice, setNotice] = useState(null)
  const orgName = (orgs || []).find(org => org.id === orgId)?.name
  return h('div', { className: 'sf-view' },
    h('p', { className: 'sf-note' }, t('analyzeHint')),
    h('div', { className: 'sf-analysis-grid' }, ...ANALYSIS_ENTRIES.map(entry => h('article', { className: 'sf-card sf-analysis-card', key: entry.id },
      h('div', { className: 'sf-analysis-head' }, h(Glyph, { name: entry.icon, size: 15 }), h('h2', null, t(`analysis_${entry.id}`))),
      h('p', null, t(`analysis_${entry.id}_desc`)),
      h('div', null, h(PrimaryButton, { onClick: () => sendToAgent(entry.prompt(year, orgName), setNotice, t) }, h(Glyph, { name: 'send', size: 12 }), t('send')))))),
    notice ? h(Notice, null, notice) : null,
    h('p', { className: 'sf-note' }, t('analyzingNote')))
}
