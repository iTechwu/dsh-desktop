const MCP_URL = 'https://ixicai.cn/mcp/knowledge'
const REQUEST_TIMEOUT_MS = 30000

const TOOL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      result: { type: 'object', additionalProperties: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

export const name = 'yootun-knowledge-tools'
export const inject = ['tools', 'systemPrompt', 'credentials', 'webServer', 'yootunAudit']

const TOOL_DEFINITIONS = {
  knowledge_search: ['knowledge.search', 'Search ACL-scoped enterprise documents with citations.'],
  knowledge_recall: ['knowledge.recall', 'Recall ACL-scoped Memory and evidence.'],
  knowledge_remember: ['knowledge.remember', 'Create a Memory candidate in a server-resolved role space.'],
  knowledge_confirm_memory: ['knowledge.confirm_memory', 'Confirm a Memory candidate after explicit user approval.'],
  knowledge_forget: ['knowledge.forget', 'Forget a Memory by id.'],
  knowledge_session_checkpoint: ['knowledge.session_checkpoint', 'Checkpoint a bounded runtime session segment and optional Memory candidates.'],
  knowledge_promote: ['knowledge.promote', 'Propose promotion of confirmed Memory into immutable Knowledge.'],
  knowledge_capabilities: ['knowledge.capabilities', 'Read the current Knowledge MCP capability manifest.'],
  knowledge_overview: ['knowledge.overview', 'Read ACL-scoped Knowledge and Memory aggregates.'],
  knowledge_graph: ['knowledge.graph', 'Read an ACL-scoped knowledge graph around an entity.'],
  knowledge_ingest_file: ['knowledge.ingest_file', 'Ingest an external file into a server-resolved Knowledge space.'],
  knowledge_loadout: ['knowledge.loadout', 'Read the verified runtime Loadout and its immutable digest.'],
  knowledge_context_pack: ['knowledge.context_pack', 'Assemble bounded stable and dynamic context for the current runtime session.'],
  knowledge_explain_trace: ['knowledge.explain_trace', 'Explain the evidence and ranking path for a previous retrieval trace.'],
  knowledge_entity_assertions: ['knowledge.entity_assertions', 'Read ACL-scoped canonical entity assertions.'],
  knowledge_relation_assertions: ['knowledge.relation_assertions', 'Read ACL-scoped canonical relation assertions.'],
  knowledge_entity_merges: ['knowledge.entity_merges', 'Read entity merge decisions and provenance.'],
  knowledge_provenance_lineage: ['knowledge.provenance_lineage', 'Read bounded provenance lineage for an entity.'],
}

export function apply(ctx, overrides = {}) {
  const fetchImpl = overrides.fetch || globalThis.fetch
  const disposers = []
  for (const [name, [remoteName, description]] of Object.entries(TOOL_DEFINITIONS)) {
    const dispose = ctx.tools.register({
      name,
      description,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { input: { type: 'object', additionalProperties: true } },
        required: ['input'],
      },
      output: TOOL_OUTPUT,
      timeoutMs: REQUEST_TIMEOUT_MS,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const credential = await resolveModelsKey(ctx)
        if (!credential) return { ok: false, error: 'model_api_key_unavailable' }
        return executeKnowledge(ctx, fetchImpl, credential, remoteName, args?.input || {}, 'agent_tool', exec?.signal)
      },
    })
    disposers.push(dispose)
  }

  disposers.push(ctx.systemPrompt.section({
    name: 'yootun-knowledge:governance',
    order: 9,
    text: '企业 Knowledge、Memory 与知识图谱统一通过 https://ixicai.cn/mcp/knowledge 的公开 MCP 网关访问。运行时先用 knowledge_loadout 获取服务端解析的空间绑定，按需用 knowledge_context_pack 注入稳定规则、已确认 Memory 与会话交接；不要在客户端保存或猜测 space UUID。优惠豚公司资料统一属于 tenant.all 对应的“优惠豚”默认空间，所有优惠豚成员可读；个人资料使用 user.personal，会话与工作记忆使用 user.agent_runtime，团队资料只使用服务端授权的 team.<groupId>。所有事实必须保留文档、版本、Memory 或 Session 引用；remember 只创建候选，明确确认后才可进入 confirmed；forget 立即执行。',
  }))

  if (ctx.webServer) {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/api/desktop/yootun/knowledge',
      async handler(req, res) {
        const credential = await resolveModelsKey(ctx)
        if (req.method === 'GET') {
          const contract = await loadKnowledgeContract(fetchImpl, credential)
          sendJson(res, 200, {
            status: credential ? 'ready' : 'unavailable',
            mcp: { route: MCP_URL, auth: credential ? 'credential-store' : 'missing' },
            capabilities: Object.keys(TOOL_DEFINITIONS),
            templates: COMPANY_TEMPLATES,
            contract,
            // Preserve the 0.1 management-page envelope while sourcing it from MCP.
            overview: contract.overview
              ? { status: contract.status, data: contract.overview }
              : { status: contract.status, reason: contract.reason || contract.errors?.[0] || 'knowledge_contract_unavailable' },
          })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'GET, POST' })
          res.end()
          return
        }
        if (!credential) {
          sendJson(res, 503, { status: 'unavailable', reason: 'model_api_key_unavailable' })
          return
        }
        const body = await readJson(req)
        const action = ACTIONS[body?.action]
        if (!action) {
          sendJson(res, 400, { status: 'error', reason: 'unsupported_action' })
          return
        }
        const result = await executeKnowledge(ctx, fetchImpl, credential, action, body.input || {}, 'human_ui')
        sendJson(res, result.ok ? 200 : 502, result)
      },
    }))
  }

  return () => disposers.reverse().forEach(dispose => dispose?.())
}

const ACTIONS = {
  search: 'knowledge.search',
  recall: 'knowledge.recall',
  remember: 'knowledge.remember',
  confirm_memory: 'knowledge.confirm_memory',
  forget: 'knowledge.forget',
  session_checkpoint: 'knowledge.session_checkpoint',
  promote: 'knowledge.promote',
  capabilities: 'knowledge.capabilities',
  overview: 'knowledge.overview',
  graph: 'knowledge.graph',
  ingest_file: 'knowledge.ingest_file',
  loadout: 'knowledge.loadout',
  context_pack: 'knowledge.context_pack',
  explain_trace: 'knowledge.explain_trace',
  entity_assertions: 'knowledge.entity_assertions',
  relation_assertions: 'knowledge.relation_assertions',
  entity_merges: 'knowledge.entity_merges',
  provenance_lineage: 'knowledge.provenance_lineage',
}

const COMPANY_TEMPLATES = [
  { id: 'tenant.all', spaceKey: 'tenant.all', name: '优惠豚', description: '优惠豚默认企业知识空间；公司、项目、会员与服务资料统一归档，所有优惠豚成员可读', entities: ['优惠豚', '长沙优惠豚汽车销售服务有限公司', '汽车科技文创园', '会员与5S服务'] },
]

async function loadKnowledgeContract(fetchImpl, apiKey) {
  if (!apiKey) return { status: 'unavailable', reason: 'model_api_key_unavailable' }
  const [overview, capabilities] = await Promise.all([
    callMcp(fetchImpl, apiKey, 'knowledge.overview', {}),
    callMcp(fetchImpl, apiKey, 'knowledge.capabilities', {}),
  ])
  if (!overview.ok && !capabilities.ok) {
    return { status: 'error', reason: overview.error || capabilities.error || 'knowledge_contract_unavailable' }
  }
  return {
    status: overview.ok && capabilities.ok ? 'ready' : 'degraded',
    overview: overview.ok ? normalizeOverview(mcpData(overview.result)) : null,
    capabilities: capabilities.ok ? mcpData(capabilities.result) : null,
    errors: [overview.ok ? null : overview.error, capabilities.ok ? null : capabilities.error].filter(Boolean),
  }
}

function mcpData(result) {
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent
  const text = result?.content?.find?.(item => item?.type === 'text')?.text
  if (typeof text === 'string') {
    try { return JSON.parse(text) } catch {}
  }
  return result && typeof result === 'object' ? result : {}
}

function normalizeOverview(data) {
  const countOf = (...values) => {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const total = value.total ?? value.total_count ?? value.count
        if (typeof total === 'number' && Number.isFinite(total) && total >= 0) return total
      }
    }
    return null
  }
  const recentOf = (...values) => {
    for (const value of values) {
      if (!Array.isArray(value)) continue
      return value.slice(0, 8).map(item => {
        const row = item && typeof item === 'object' ? item : {}
        const title = row.title ?? row.name ?? row.content
        return {
          id: row.id != null ? String(row.id) : '',
          title: typeof title === 'string' || typeof title === 'number' ? String(title) : '',
          content: typeof row.content === 'string' ? row.content : '',
          status: typeof row.status === 'string' ? row.status : '',
          type: typeof row.type === 'string' ? row.type : '',
          scope: typeof row.scope === 'string' ? row.scope : '',
          sourceType: typeof row.sourceType === 'string' ? row.sourceType : typeof row.source_type === 'string' ? row.source_type : '',
          updatedAt: String(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? ''),
          ...(typeof row.confidence === 'number' ? { confidence: row.confidence } : {}),
          ...(typeof row.sourceSessionId === 'string' ? { sourceSessionId: row.sourceSessionId } : {}),
          ...(row.toolMetadata && typeof row.toolMetadata === 'object' ? { toolMetadata: row.toolMetadata } : {}),
        }
      })
    }
    return []
  }
  return {
    spaces: countOf(data.totals?.spaces, data.spaces, data.space_count, data.spaceCount),
    documents: countOf(data.totals?.documents, data.documents, data.document_count, data.documentCount),
    memories: countOf(data.totals?.memories, data.memories, data.memory_count, data.memoryCount),
    pendingImports: countOf(data.imports?.pending, data.pending_imports, data.pendingImports, data.import_queue?.pending, data.ingestion?.queued),
    recentDocuments: recentOf(data.recent_documents, data.recentDocuments, data.documents?.recent),
    recentMemories: recentOf(data.recent_memories, data.recentMemories, data.memories?.recent),
    ingestion: {
      queued: countOf(data.ingestion?.queued, data.import_queue?.queued),
      processing: countOf(data.ingestion?.processing, data.import_queue?.processing),
      failed: countOf(data.ingestion?.failed, data.import_queue?.failed),
    },
    health: typeof data.health === 'string' ? data.health : data.health && typeof data.health === 'object' ? {
      api: String(data.health.api ?? ''),
      postgres: String(data.health.postgres ?? ''),
      minio: String(data.health.minio ?? ''),
      qdrant: String(data.health.qdrant ?? ''),
      neo4j: String(data.health.neo4j ?? ''),
    } : {},
  }
}

async function resolveModelsKey(ctx) {
  try {
    const resolved = await ctx.credentials.resolve('MODELS_API_KEY')
    return resolved?.value || process.env.MODELS_API_KEY || ''
  } catch {
    return process.env.MODELS_API_KEY || ''
  }
}

async function callMcp(fetchImpl, apiKey, tool, input, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const response = await fetchImpl(MCP_URL, {
      method: 'POST',
      signal: combinedSignal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `yootun-knowledge-${Date.now()}`, method: 'tools/call', params: { name: tool, arguments: input } }),
    })
    if (!response.ok) return { ok: false, error: `knowledge_mcp_http_${response.status}` }
    const payload = await response.text()
    const message = parseMcpMessage(payload)
    if (message?.error) return { ok: false, error: message.error.message || 'knowledge_mcp_error' }
    if (message?.result?.isError === true) return { ok: false, error: 'knowledge_mcp_tool_failed' }
    return { ok: true, result: message?.result || null }
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'knowledge_mcp_timeout' : 'knowledge_mcp_request_failed' }
  } finally {
    clearTimeout(timer)
  }
}

const KNOWLEDGE_AUDIT_ACTIONS = {
  'knowledge.remember': ['knowledge.memory.remembered', 'create', 'memory', 'candidate'],
  'knowledge.confirm_memory': ['knowledge.memory.confirmed', 'update', 'memory', 'confirmed'],
  'knowledge.forget': ['knowledge.memory.forgotten', 'delete', 'memory', 'forgotten'],
  'knowledge.ingest_file': ['knowledge.file.imported', 'create', 'knowledge_document', 'accepted'],
  'knowledge.session_checkpoint': ['knowledge.session.checkpointed', 'create', 'knowledge_session', 'accepted'],
  'knowledge.promote': ['knowledge.promotion.proposed', 'create', 'knowledge_promotion', 'proposed'],
}

async function executeKnowledge(ctx, fetchImpl, credential, tool, input, surface, signal) {
  const result = await callMcp(fetchImpl, credential, tool, input, signal)
  const definition = KNOWLEDGE_AUDIT_ACTIONS[tool]
  if (!definition) return result
  const [actionCode, category, targetType, defaultStatus] = definition
  const data = result?.result?.structuredContent || result?.result || {}
  const fallbackId = targetType === 'knowledge_document' ? input?.documentId
    : targetType === 'knowledge_session' ? input?.externalSessionId
      : input?.memoryId
  const rawId = data.id ?? data.memoryId ?? data.documentId ?? data.proposalId ?? fallbackId ?? 'unresolved'
  const id = String(rawId).slice(0, 160) || 'unresolved'
  const rawStatus = typeof data.status === 'string' ? data.status.toLowerCase() : defaultStatus
  const errorCode = typeof result?.error === 'string' && /^[a-z0-9_:-]{1,80}$/u.test(result.error) ? result.error : 'knowledge_write_failed'
  await recordKnowledgeAudit(ctx, {
    actionCode, category,
    source: { pluginId: '@dofe/dsh-yootun-knowledge', pluginVersion: '0.2.0', surface },
    target: { type: targetType, id },
    outcome: result?.ok ? 'succeeded' : 'failed',
    changes: [{ field: 'status', after: result?.ok ? rawStatus.slice(0, 160) : 'failed' }], effects: [],
    ...(result?.ok ? {} : { errorCode }),
  })
  return result
}

async function recordKnowledgeAudit(ctx, input) {
  if (!ctx.yootunAudit?.record) return
  try { await ctx.yootunAudit.record(input) } catch { ctx.logger?.warn?.('yootun audit record failed: audit_record_failed') }
}

function parseMcpMessage(payload) {
  const lines = payload.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6).trim()).filter(Boolean)
  const candidate = lines.at(-1) || payload.trim()
  try { return JSON.parse(candidate) } catch { return null }
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return {} }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(payload)
}

export { ACTIONS, COMPANY_TEMPLATES, MCP_URL, parseMcpMessage }
