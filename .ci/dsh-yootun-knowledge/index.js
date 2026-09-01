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
export const inject = ['tools', 'systemPrompt', 'credentials', 'webServer']

const TOOL_DEFINITIONS = {
  knowledge_search: ['knowledge.search', 'Search ACL-scoped enterprise documents with citations.'],
  knowledge_recall: ['knowledge.recall', 'Recall ACL-scoped Memory and evidence.'],
  knowledge_remember: ['knowledge.remember', 'Create a Memory candidate or confirmed Memory.'],
  knowledge_forget: ['knowledge.forget', 'Forget a Memory by id.'],
  knowledge_graph: ['knowledge.graph', 'Read an ACL-scoped knowledge graph around an entity.'],
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
        return callMcp(fetchImpl, credential, remoteName, args?.input || {}, exec?.signal)
      },
    })
    disposers.push(dispose)
  }

  disposers.push(ctx.systemPrompt.section({
    name: 'yootun-knowledge:governance',
    order: 9,
    text: '企业知识、Memory 与知识图谱统一使用 knowledge.dofe.ai 的 MCP 能力，通过 mcp__knowledge__* 工具或 knowledge_search/knowledge_recall 等封装工具访问。所有查询遵循租户与空间 ACL，并保留文档、版本或 Session 引用；没有引用不得把模型推断写成企业事实。remember 默认创建候选，只有用户明确确认才进入 confirmed；forget 立即执行。图谱只作为有证据的关联视图，不能绕过文档权限。涉及优惠豚汽车科技文创园时，优先使用已授权的“优惠豚企业空间”与业务模板。',
  }))

  if (ctx.webServer) {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: '/api/desktop/yootun/knowledge',
      async handler(req, res) {
        const credential = await resolveModelsKey(ctx)
        if (req.method === 'GET') {
          sendJson(res, 200, {
            status: credential ? 'ready' : 'unavailable',
            mcp: { route: MCP_URL, auth: credential ? 'credential-store' : 'missing' },
            capabilities: Object.keys(TOOL_DEFINITIONS),
            templates: COMPANY_TEMPLATES,
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
        const result = await callMcp(fetchImpl, credential, action, body.input || {})
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
  forget: 'knowledge.forget',
  graph: 'knowledge.graph',
}

const COMPANY_TEMPLATES = [
  { id: 'youhuitun-company', name: '优惠豚企业空间', description: '公司介绍、政策依据、合作伙伴、品牌与项目事实', entities: ['长沙优惠豚汽车销售服务有限公司', '浙江山子有谦汽车新零售有限公司', '传化集团', '山子高科', '酷旅传媒'] },
  { id: 'youhuitun-park', name: '汽车科技文创园项目', description: '7500m²园区、首发经济、改装、科技市集与青年创业场景', entities: ['红星BOX1', '智能驾驶', '车载机器人', '科技市集', '青年创业'] },
  { id: 'youhuitun-service', name: '会员与5S服务', description: '会员制用车专家、透明一口价和5S服务标准', entities: ['微笑', '专业', '迅速', '诚恳', '灵巧'] },
]

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
    return { ok: true, result: message?.result || null }
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'knowledge_mcp_timeout' : 'knowledge_mcp_request_failed' }
  } finally {
    clearTimeout(timer)
  }
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
