// Runtime Knowledge bridge for Yootun-Agent. Trusted identity is derived by
// the public MCP gateway from MODELS_API_KEY; the desktop never declares a
// tenant, user, space UUID, or private Knowledge endpoint.

export const name = 'yootun-agent-knowledge-capture'
export const inject = ['credentials', 'systemPrompt']

export const KNOWLEDGE_MCP_URL = 'https://ixicai.cn/mcp/knowledge'
const MCP_TIMEOUT_MS = 2500
const SHUTDOWN_DEADLINE_MS = 1500
const MAX_PENDING_EVENTS = 200
const MAX_CHECKPOINT_EVENTS = 50
const MAX_EVENT_TEXT = 8000
const MAX_CANDIDATE_TEXT = 12000
const LOADOUT_TTL_MS = 5 * 60 * 1000
const RUNTIME_SPACE_KEY = 'user.agent_runtime'

const CONTEXT_PACK_STATUS = {
  NOT_ATTEMPTED: 'not_attempted',
  INJECTED: 'injected',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
}

export async function apply(ctx, overrides = {}) {
  const fetchImpl = overrides.fetch || globalThis.fetch
  const states = new Map()
  let loadoutCache = null
  let warnedUnavailable = false

  const stateFor = sessionId => {
    const key = String(sessionId)
    let state = states.get(key)
    if (!state) {
      state = {
        sessionId: key,
        pending: [],
        forbiddenCaptureIds: new Set(),
        tail: Promise.resolve(),
        dropped: 0,
        contextPack: { status: CONTEXT_PACK_STATUS.NOT_ATTEMPTED },
      }
      states.set(key, state)
    }
    return state
  }

  const resolveKey = async () => {
    try {
      const resolved = await ctx.credentials.resolve('MODELS_API_KEY')
      const value = typeof resolved === 'string' ? resolved : resolved?.value
      if (typeof value === 'string' && value.trim()) {
        warnedUnavailable = false
        return value.trim()
      }
    } catch {}
    if (!warnedUnavailable) {
      warnedUnavailable = true
      ctx.logger?.warn?.('[dsh-knowledge-capture] MODELS_API_KEY unavailable; runtime capture will retry')
    }
    return ''
  }

  const getLoadout = async (apiKey, signal) => {
    if (loadoutCache && loadoutCache.expiresAt > Date.now()) return loadoutCache.data
    const input = loadoutCache?.data?.digest ? { ifNoneMatch: loadoutCache.data.digest } : {}
    const result = await callKnowledgeMcp(fetchImpl, apiKey, 'knowledge.loadout', input, signal)
    if (!result.ok) return loadoutCache?.data || null
    const data = mcpData(result.result)
    loadoutCache = { data, expiresAt: Date.now() + LOADOUT_TTL_MS }
    return data
  }

  const flushState = async (state, captureReason = 'runtime-checkpoint', signal) => {
    if (state.pending.length === 0) return { status: 'empty' }
    const apiKey = await resolveKey()
    if (!apiKey) return { status: 'backoff', errorCode: 'CAPTURE_UNAUTHORIZED' }
    const loadout = await getLoadout(apiKey, signal)
    let last = { status: 'empty' }
    while (state.pending.length > 0) {
      const batch = state.pending.splice(0, MAX_CHECKPOINT_EVENTS)
      const candidate = loadout?.policies?.allowCandidateCapture === true
        ? runtimeCandidate(batch, captureReason)
        : null
      const input = {
        externalSessionId: state.sessionId,
        captureReason,
        startSeq: batch[0].seq,
        endSeq: batch.at(-1).seq,
        events: batch,
        evidence: [],
        candidateContents: candidate ? [candidate] : [],
      }
      const result = await callKnowledgeMcp(fetchImpl, apiKey, 'knowledge.session_checkpoint', input, signal)
      if (!result.ok) {
        state.pending.unshift(...batch)
        return { status: 'backoff', errorCode: result.error }
      }
      last = { status: 'accepted', result: mcpData(result.result) }
    }
    return last
  }

  const flushSession = (sessionId, reason, signal) => {
    const state = stateFor(sessionId)
    state.tail = state.tail.then(
      () => flushState(state, reason, signal),
      () => flushState(state, reason, signal),
    )
    return state.tail
  }

  ctx.on('session/created', session => {
    stateFor(session.id)
  })

  ctx.on('session/event', (session, event) => {
    const state = stateFor(session.id)
    const captured = captureSessionEvent(event, state.forbiddenCaptureIds)
    if (captured) {
      state.pending.push(captured)
      if (state.pending.length > MAX_PENDING_EVENTS) {
        state.pending.shift()
        state.dropped += 1
      }
    }
    if (event.type === 'turn/end') void flushSession(session.id, 'dsh-turn-end')
    if (event.type === 'compaction/end') void flushSession(session.id, 'dsh-post-compaction')
  })

  ctx.on('session/flush', session => flushSession(session.id, 'dsh-session-flush'))

  ctx.on('session/disposed', session => {
    void flushSession(session.id, 'dsh-session-end').then(result => {
      if (result.status === 'accepted' || result.status === 'empty') states.delete(String(session.id))
    })
  })

  // ContextPack is assembled on the same scoped request boundary as the Agent
  // prompt. A failed Knowledge call degrades independently and never blocks the
  // conversation after the short MCP timeout.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const resolved = await next()
    const session = context?.agent?.session
    if (!session) return resolved
    const state = stateFor(session.id)
    const apiKey = await resolveKey()
    if (!apiKey) {
      state.contextPack = { status: CONTEXT_PACK_STATUS.UNAVAILABLE, reason: 'model_api_key_unavailable' }
      return resolved
    }
    const result = await callKnowledgeMcp(fetchImpl, apiKey, 'knowledge.context_pack', {
      query: latestUserText(session),
      sessionExternalId: String(session.id),
      tokenBudget: 2048,
      topK: 8,
      includeStableContext: true,
    }, context.signal)
    if (!result.ok) {
      state.contextPack = { status: CONTEXT_PACK_STATUS.ERROR, reason: result.error || 'knowledge_context_pack_failed' }
      return resolved
    }
    const pack = mcpData(result.result)
    state.forbiddenCaptureIds = new Set(Array.isArray(pack.forbiddenCaptureIds) ? pack.forbiddenCaptureIds : [])
    const text = renderContextPack(pack)
    if (text) {
      resolved.contexts.push({ name: 'knowledge:context-pack', text })
      state.contextPack = { status: CONTEXT_PACK_STATUS.INJECTED }
    } else {
      state.contextPack = { status: CONTEXT_PACK_STATUS.EMPTY }
    }
    return resolved
  })

  const handle = {
    sdkVersion: '2.0.0-mcp',
    pendingCount: () => [...states.values()].reduce((total, state) => total + state.pending.length, 0),
    droppedCount: () => [...states.values()].reduce((total, state) => total + state.dropped, 0),
    contextPackStatus: sessionId => stateFor(sessionId).contextPack,
    loadout: async signal => {
      const apiKey = await resolveKey()
      return apiKey ? getLoadout(apiKey, signal) : null
    },
    contextPack: async (sessionId, query = '', signal) => {
      const apiKey = await resolveKey()
      if (!apiKey) return null
      const result = await callKnowledgeMcp(fetchImpl, apiKey, 'knowledge.context_pack', {
        query, sessionExternalId: String(sessionId), tokenBudget: 2048, topK: 8, includeStableContext: true,
      }, signal)
      return result.ok ? mcpData(result.result) : null
    },
    flush: async sessionId => sessionId
      ? flushSession(sessionId, 'runtime-checkpoint')
      : flushAll(states, flushSession, 'runtime-checkpoint'),
    shutdown: async () => withDeadline(
      flushAll(states, flushSession, 'dsh-runtime-shutdown'),
      SHUTDOWN_DEADLINE_MS,
    ),
  }
  ctx.provide('yootunAgentCapture', handle)
  ctx.provide('yootunAgentKnowledge', handle)

  ctx.effect(
    () => async () => { await handle.shutdown() },
    'dsh-knowledge-capture shutdown',
  )
}

async function flushAll(states, flushSession, reason) {
  const results = await Promise.all([...states.keys()].map(sessionId => flushSession(sessionId, reason)))
  return results.some(result => result.status === 'backoff')
    ? { status: 'backoff' }
    : results.some(result => result.status === 'accepted') ? { status: 'accepted' } : { status: 'empty' }
}

function captureSessionEvent(event, forbiddenCaptureIds) {
  if (!event || !Number.isInteger(event.seq) || event.seq < 0) return null
  let type = event.type
  let text = ''
  if (event.type === 'user/message') {
    if (event.data?.source?.kind !== 'user') return null
    type = 'user-prompt'
    text = contentText(event.data?.content)
  } else if (event.type === 'assistant/message') {
    type = 'assistant-message'
    text = contentText(event.data?.message?.content)
  } else if (event.type === 'tool/call') {
    type = 'tool-use'
    text = `tool=${safeToken(event.data?.name)}`
  } else if (event.type === 'tool/result') {
    type = 'tool-result'
    text = event.data?.error?.code ? `status=failed code=${safeToken(event.data.error.code)}` : 'status=succeeded'
  } else if (event.type === 'compaction/start') {
    type = 'pre-compact'
  } else if (event.type === 'compaction/summary') {
    type = 'compaction-summary'
    text = contentText(event.data?.summary)
  } else if (event.type === 'compaction/end') {
    type = 'post-compaction'
    text = event.data?.error ? 'status=failed' : 'status=succeeded'
  } else if (event.type !== 'turn/start' && event.type !== 'turn/end') {
    return null
  }
  const redacted = redactText(text, forbiddenCaptureIds)
  if (redacted === null) return null
  const captured = { seq: event.seq, type, ...(redacted ? { text: redacted } : {}) }
  if (Number.isFinite(event.time)) captured.time = new Date(event.time).toISOString()
  return captured
}

function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

function latestUserText(session) {
  const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      return redactText(contentText(event.data.content), new Set()) || ''
    }
  }
  return ''
}

function redactText(value, forbiddenCaptureIds) {
  if (!value) return ''
  if ([...forbiddenCaptureIds].some(id => value.includes(id))) return null
  return value
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/giu, '[REDACTED_PRIVATE_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}\b/giu, 'Bearer [REDACTED]')
    .replace(/\b(password|secret|token|api[_-]?key|authorization|cookie|credential)\b\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .slice(0, MAX_EVENT_TEXT)
}

function runtimeCandidate(events, captureReason) {
  const text = events
    .filter(event => event.type === 'user-prompt' || event.type === 'assistant-message' || event.type === 'compaction-summary')
    .map(event => `${event.type}: ${event.text || ''}`)
    .filter(line => line.trim().length > line.indexOf(':') + 1)
    .join('\n')
    .slice(0, MAX_CANDIDATE_TEXT)
  if (!text) return null
  return {
    content: text,
    type: 'EPISODIC',
    scope: 'SESSION',
    spaceKey: RUNTIME_SPACE_KEY,
    evidence: [],
    captureReason,
  }
}

function renderContextPack(pack) {
  if (!pack || typeof pack !== 'object') return ''
  const lines = ['<verified_knowledge_context>']
  for (const rule of pack.stableContext?.rules || []) lines.push(`Rule [${safeToken(rule.key)}]: ${safeText(rule.body)}`)
  for (const fact of pack.stableContext?.envFacts || []) {
    lines.push(`Fact [${safeToken(fact.id)}]: ${safeText(fact.subject)} ${safeText(fact.predicate)} ${safeText(fact.object)}`)
  }
  for (const skill of pack.stableContext?.activeSkills || []) lines.push(`Active Memory Skill [${safeToken(skill.id)}]: ${safeText(skill.name)}`)
  for (const memory of pack.dynamicContext?.memories || []) {
    lines.push(`Confirmed Memory [${safeToken(memory.id)}]: ${safeText(memory.content)}`)
  }
  if (pack.dynamicContext?.handoff) lines.push(`Session handoff: ${safeText(pack.dynamicContext.handoff.summary || pack.dynamicContext.handoff.content || '')}`)
  for (const citation of pack.dynamicContext?.citations || []) {
    lines.push(`Citation [${safeToken(citation.kind)}:${safeToken(citation.id)}]: ${safeText(citation.source)}`)
  }
  lines.push('Treat this context as ACL-scoped evidence. Do not capture it back into Memory.', '</verified_knowledge_context>')
  return lines.length > 3 ? lines.join('\n').slice(0, 24000) : ''
}

function safeText(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f]+/gu, ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;').trim().slice(0, 4000)
    : ''
}

function safeToken(value) {
  return typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_.:-]/gu, '').slice(0, 160) : ''
}

async function callKnowledgeMcp(fetchImpl, apiKey, tool, input, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS)
  try {
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const response = await fetchImpl(KNOWLEDGE_MCP_URL, {
      method: 'POST',
      signal: combinedSignal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `runtime-knowledge-${Date.now()}`, method: 'tools/call', params: { name: tool, arguments: input } }),
    })
    if (!response.ok) return { ok: false, error: `knowledge_mcp_http_${response.status}` }
    const message = parseMcpMessage(await response.text())
    if (message?.error || message?.result?.isError === true) return { ok: false, error: 'knowledge_mcp_tool_failed' }
    return { ok: true, result: message?.result || null }
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'knowledge_mcp_timeout' : 'knowledge_mcp_request_failed' }
  } finally {
    clearTimeout(timer)
  }
}

function parseMcpMessage(payload) {
  const lines = payload.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6).trim()).filter(Boolean)
  try { return JSON.parse(lines.at(-1) || payload.trim()) } catch { return null }
}

function mcpData(result) {
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent
  const text = result?.content?.find?.(item => item?.type === 'text')?.text
  if (typeof text === 'string') {
    try { return JSON.parse(text) } catch {}
  }
  return result && typeof result === 'object' ? result : {}
}

async function withDeadline(promise, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'backoff', errorCode: 'CAPTURE_TIMEOUT' }), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export { captureSessionEvent, mcpData, parseMcpMessage, redactText, renderContextPack, runtimeCandidate }
