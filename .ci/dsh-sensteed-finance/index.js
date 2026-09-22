// Sensteed 财务看板宿主端。浏览器只访问同源 /api/desktop/sensteed/finance* 路由；
// 所有 datasource.dofe.ai 数据请求都由这里持 INTERNAL_API_SECRET 转发：
// 统计/录入走本插件的 MCP 代理（与 Agent 的 mcp__finance__* 同一数据面），口径完全一致。
// 凭据解析顺序：ctx.credentials（进程环境 > .credentials.yaml > 项目/家目录 .env）> process.env。

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROUTE_PREFIX = '/api/desktop/sensteed/finance'
// 统一走本地 nginx 入口（https://datasource.local.dofe.ai/api），不直连回环地址；
// mkcert 自签证书由下方 ensureNodeExtraCaCerts() 引导 Node 信任。
// 特殊部署可用凭据 DATASOURCE_BASE_URL 或环境变量覆盖。
const DEFAULT_BASE_URL = 'https://datasource.local.dofe.ai/api'

/**
 * mkcert CA 信任引导：datasource 本地入口用 mkcert 签发证书，Node 默认不信任。
 * 在首次 HTTPS 请求前把 mkcert rootCA.pem 挂到 NODE_EXTRA_CA_CERTS（仅本进程生效，
 * 优先级低于外部显式设置）。找不到证书文件时静默跳过——可自行设置该环境变量。
 */
function ensureNodeExtraCaCerts() {
  if (process.env.NODE_EXTRA_CA_CERTS) return
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'mkcert', 'rootCA.pem'),
    join(homedir(), '.local', 'share', 'mkcert', 'rootCA.pem'),
    join(homedir(), '.mkcert', 'rootCA.pem'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      process.env.NODE_EXTRA_CA_CERTS = candidate
      return
    }
  }
}
ensureNodeExtraCaCerts()
const REQUEST_TIMEOUT_MS = 30000
const MAX_BODY_BYTES = 32 * 1024

export const inject = ['webServer', 'credentials', 'tools', 'systemPrompt']

/** 从凭据服务读一个引用，失败或未配置时返回空串 */
async function credential(ctx, name) {
  try {
    const resolved = await ctx.credentials?.resolve?.(name)
    return resolved?.value || ''
  } catch { return '' }
}

/** 每次请求时解析运行配置：凭据层可被 .credentials.yaml / 家目录 .env 热更新 */
async function resolveConfig(ctx) {
  const [secretNamed, secretLegacy, tenant, baseUrl] = await Promise.all([
    credential(ctx, 'DATASOURCE_INTERNAL_API_SECRET'),
    credential(ctx, 'INTERNAL_API_SECRET'),
    credential(ctx, 'DATASOURCE_TENANT_ID'),
    credential(ctx, 'DATASOURCE_BASE_URL'),
  ])
  return {
    baseUrl: (baseUrl || process.env.DATASOURCE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    secret: secretNamed || secretLegacy || process.env.DATASOURCE_INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET || '',
    tenantId: (tenant || process.env.DATASOURCE_TENANT_ID || '').trim(),
  }
}

export function apply(ctx, overrides = {}) {
  if (overrides.registerHostRoute === false) return undefined
  const fetchImpl = overrides.fetch || globalThis.fetch
  const now = overrides.now || (() => new Date())

  const disposers = []

  if (ctx.tools?.register) {
    disposers.push(ctx.tools.register({
      name: 'sensteed_finance_bootstrap',
      description: '获取财务分析上下文：当前租户 ID、财务主体列表与可用的 mcp__finance__* 工具说明。做任何财务分析前先调用本工具。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => true,
      async execute() {
        const config = await resolveConfig(ctx)
        if (!config.tenantId) {
          return { ok: false, error: '缺少 DATASOURCE_TENANT_ID：请在凭据服务或家目录 .env（~/.dsh/.env）中配置后重试。' }
        }
        const orgs = await mcpCall(fetchImpl, config, 'finance_get_orgs', {}, now(), ctx.logger)
        if (!orgs.ok) return orgs
        return {
          ok: true,
          result: {
            tenantId: config.tenantId,
            orgs: orgs.data.orgs || [],
            usage: 'tenantId 用于所有 mcp__finance__* 工具入参；金额单位一律为元；分析首选 mcp__finance__finance_analysis_brief 建立口径基线。',
          },
        }
      },
    }))
  }

  // 统一数据面：一个前缀路由内部分发（webServer 只有 exact/prefix 两种匹配）。
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    async handler(req, res) {
      const config = await resolveConfig(ctx)
      const pathname = safePathname(req.url)
      const sub = pathname.slice(ROUTE_PREFIX.length) || '/'
      if (req.method === 'GET') return dispatchGet(fetchImpl, config, sub, req.url, res, ctx.logger)
      if (req.method === 'POST') return dispatchPost(fetchImpl, config, sub, req, res, ctx.logger)
      res.writeHead(405, { Allow: 'GET, POST', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end()
    },
  }))

  if (ctx.systemPrompt?.section) {
    disposers.push(ctx.systemPrompt.section({
      name: 'sensteed:finance-guidance',
      order: 8,
      text: FINANCE_GUIDANCE,
    }))
  }

  return () => disposers.reverse().forEach(dispose => dispose?.())
}

// ---------------------------------------------------------------------------
// 路由分发：GET 统计面 / POST 录入与回填面
// ---------------------------------------------------------------------------

const QUERY_KEYS = ['year', 'month', 'page', 'limit', 'severity', 'status', 'orgId', 'expenseType', 'recordType', 'planType']

async function dispatchGet(fetchImpl, config, sub, url, res, logger) {
  const query = pickQuery(url)
  const tenant = () => ({ tenantId: config.tenantId })
  let calls
  switch (sub) {
    case '/':
    case '/context':
      // 空租户时省略键，交由 MCP 端返回结构化 tenant_required，而不是 Zod min(1) 校验噪声
      calls = [['finance_get_orgs', config.tenantId ? { tenantId: config.tenantId } : {}]]
      break
    case '/brief':
      calls = [['finance_analysis_brief', { ...tenant(), year: query.year }]]
      break
    case '/budget':
      calls = [
        ['finance_get_budget_summary', { ...tenant(), year: query.year, orgId: query.orgId }],
        ['finance_get_budget_lines', { ...tenant(), year: query.year, orgId: query.orgId, month: query.month, expenseType: query.expenseType, page: query.page, limit: query.limit }],
      ]
      break
    case '/pr':
      calls = [['finance_get_payment_requests', { ...tenant(), year: query.year, orgId: query.orgId, month: query.month, recordType: query.recordType, page: query.page, limit: query.limit }]]
      break
    case '/payment-plans':
      calls = [['finance_get_payment_plans', { ...tenant(), year: query.year, orgId: query.orgId, month: query.month, planType: query.planType, page: query.page, limit: query.limit }]]
      break
    case '/revenue-plans':
      calls = [['finance_get_revenue_plans', { ...tenant(), year: query.year, orgId: query.orgId, page: query.page, limit: query.limit }]]
      break
    case '/cash':
      calls = [['finance_get_cash_summary', { ...tenant(), year: query.year, orgId: query.orgId }]]
      break
    case '/alerts':
      calls = [['finance_get_alerts', { ...(config.tenantId ? { tenantId: config.tenantId } : {}), year: query.year, severity: query.severity, status: query.status, page: query.page, limit: query.limit }]]
      break
    case '/quality':
      calls = [['finance_get_data_quality', {}], ['finance_get_import_batches', { page: query.page, limit: query.limit }]]
      break
    default:
      return sendJson(res, 404, { ok: false, error: `unknown path: ${sub}` })
  }
  if (sub !== '/quality' && sub !== '/' && sub !== '/context' && !config.tenantId) {
    return sendJson(res, 400, { ok: false, error: '缺少 DATASOURCE_TENANT_ID：请在凭据服务或家目录 .env（~/.dsh/.env）中配置。' })
  }
  const results = await Promise.all(calls.map(([name, args]) => mcpCall(fetchImpl, config, name, args, new Date(), logger)))
  const okAll = results.every(result => result.ok)
  // 部分失败时保留成功部分：看板按 {ok, data|各命名块} 逐块降级渲染。
  const payload = { ok: okAll }
  if (results.length === 1) {
    payload.data = results[0].ok ? results[0].data : null
  } else {
    for (const [index, [name]] of calls.entries()) {
      payload[streamKey(name)] = results[index].ok ? results[index].data : { error: results[index].error }
    }
  }
  if (!okAll) payload.error = results.find(result => !result.ok).error
  return sendJson(res, results.some(result => result.ok) ? 200 : 502, payload)
}

function streamKey(toolName) {
  if (toolName === 'finance_get_budget_summary') return 'summary'
  if (toolName === 'finance_get_budget_lines') return 'lines'
  if (toolName === 'finance_get_data_quality') return 'quality'
  if (toolName === 'finance_get_import_batches') return 'batches'
  return toolName.replace(/^finance_/, '')
}

const WRITE_ROUTES = [
  { pattern: /^\/payment-plans$/, tool: 'finance_create_payment_plan' },
  { pattern: /^\/revenue-plans$/, tool: 'finance_create_revenue_plan' },
  { pattern: /^\/budget-lines$/, tool: 'finance_create_budget_line' },
  { pattern: /^\/payment-plans\/([\w-]+)\/actuals$/, tool: 'finance_patch_payment_plan_actuals' },
  { pattern: /^\/revenue-plans\/([\w-]+)\/actuals$/, tool: 'finance_patch_revenue_plan_actuals' },
  { pattern: /^\/alerts\/run$/, tool: 'finance_run_alert_engine' },
]

async function dispatchPost(fetchImpl, config, sub, req, res, logger) {
  if (!config.tenantId) {
    return sendJson(res, 400, { ok: false, error: '缺少 DATASOURCE_TENANT_ID：请在凭据服务或家目录 .env（~/.dsh/.env）中配置。' })
  }
  const match = WRITE_ROUTES.find(route => route.pattern.test(sub))
  if (!match) return sendJson(res, 404, { ok: false, error: `unknown path: ${sub}` })
  const body = await readJsonBody(req)
  if (body.error) return sendJson(res, 400, { ok: false, error: body.error })
  const id = sub.match(match.pattern)?.[1]
  const args = { ...body.json, ...(id ? { id } : {}), ...(match.tool === 'finance_run_alert_engine' ? {} : { tenantId: config.tenantId }) }
  const result = await mcpCall(fetchImpl, config, match.tool, args, new Date(), logger)
  return sendJson(res, result.ok ? 200 : 502, result)
}

// ---------------------------------------------------------------------------
// 极简 MCP 客户端：datasource 的 MCP 端点为无状态 Streamable HTTP，
// 单个 tools/call POST 即可（会话校验在无会话模式下整体跳过）。
// 端点 = DATASOURCE_BASE_URL（API 源，可含 nginx 前缀如 /api）+ /mcp。
// ---------------------------------------------------------------------------

let rpcSeq = 0

async function mcpCall(fetchImpl, config, toolName, args, observedAt, logger) {
  if (!config.secret) return { ok: false, error: 'missing_secret', hint: '未配置 DATASOURCE_INTERNAL_API_SECRET / INTERNAL_API_SECRET' }
  try {
    const response = await timedFetch(fetchImpl, `${config.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcSeq, method: 'tools/call', params: { name: toolName, arguments: args } }),
    })
    if (response.status === 401 || response.status === 403) return { ok: false, error: 'auth_unavailable', hint: 'INTERNAL_API_SECRET 与 datasource 不一致' }
    if (!response.ok) return { ok: false, error: `upstream_http_${response.status}` }
    const payload = await response.json()
    if (payload?.error) return { ok: false, error: payload.error?.message || 'mcp_error' }
    const raw = payload?.result?.content?.find(item => item.type === 'text')?.text
    if (raw === undefined) return { ok: false, error: payload?.result?.isError ? 'tool_error' : 'empty_result' }
    return { ok: true, data: JSON.parse(raw), meta: { asOf: observedAt.toISOString() } }
  } catch (error) {
    logger?.warn?.('sensteed finance: mcp call %s failed: %s', toolName, safeError(error))
    return { ok: false, error: error?.name === 'TimeoutError' ? 'upstream_timeout' : 'upstream_unreachable' }
  }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function pickQuery(url) {
  const query = {}
  try {
    const params = new URL(url || ROUTE_PREFIX, 'https://dsh.local').searchParams
    for (const key of QUERY_KEYS) {
      const value = params.get(key)
      if (value !== null && value !== '') query[key] = value
    }
  } catch { /* 空 query 视为全默认 */ }
  return query
}

function safePathname(url) {
  try { return new URL(url || ROUTE_PREFIX, 'https://dsh.local').pathname } catch { return ROUTE_PREFIX }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return { error: 'body too large' }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return { json: {} }
  try {
    const json = JSON.parse(raw)
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { error: 'body must be a JSON object' }
    return { json }
  } catch { return { error: 'invalid JSON body' } }
}

async function timedFetch(fetchImpl, url, init) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' })
}

function safeError(error) { return error instanceof Error ? error.message.slice(0, 200) : 'unknown error' }

function sendJson(res, status, body) {
  const value = JSON.stringify(body)
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(value), 'X-Content-Type-Options': 'nosniff' })
  res.end(value)
}

// ---------------------------------------------------------------------------
// 财务分析 guidance：教 Agent 用 mcp__finance__* 做深度分析并以财务口吻输出
// ---------------------------------------------------------------------------

const FINANCE_GUIDANCE = `你是资深的财务分析师（CFO 视角），可使用 mcp__finance__* 工具读取与写入财务数据中心（datasource.dofe.ai）。分析纪律：

【口径】金额单位一律为元；严格区分四个口径：预算（budgetAmount）、已打 PR（prSubmittedAmount）、预计 PR（prEstimatedAmount）、实际付款（paidAmount）。执行率 =（已打PR+预计PR）/预算，实际支付率 = 实际付款/预算。引用任何数字须说明口径与期间（年度/月度/主体）。

【工作流】1) 先调 sensteed_finance_bootstrap 拿 tenantId 与主体列表；2) 用 mcp__finance__finance_analysis_brief 一次性建立全年口径基线（总览/预算/资金/预警/质量/批次）；3) 按需用 finance_get_budget_summary、finance_get_cash_summary、finance_get_payment_plans、finance_get_revenue_plans、finance_get_budget_lines、finance_get_payment_requests 下钻到主体×月度；4) 预警细节用 finance_get_alerts，数据可信度用 finance_get_data_quality 与 finance_get_import_batches。

【风险预判框架】输出必须覆盖四类确定性警情（与规则引擎口径一致）：预算超支（已打PR>预算，超 20% 为重大）、执行偏慢（已到期间执行率<30%）、资金缺口（预计/实际余额<0）、数据质量（未分配主体/缺失金额）。每条风险给出：影响金额（元）、涉及主体与期间、严重级别（重大/关注/提示）、置信度（高/中/低，基于数据完整度）、建议动作（可执行、有责任口）。

【成本预判框架】基于月度趋势外推：结构占比（三类费用：项目运营/固定运营/模型专项）、环比变动、单主体集中度。预测须声明方法（如"按近3个月均值外推"）与假设，不虚构精度；数据不足时明确说明并给出补数建议。

【预算调整与填报（v0.3）】调整审批流与填报是写通道，必须按用户明确指令操作：① 查可用预算用 finance_budget_availability_query（口径=预算-已打PR-已付款），批预算前必查并引用具体 budgetLineId；② 预算新增/调拨/追减用 finance_budget_adjustment_create 建草稿（调拨须调入=调出且调出行带 budgetLineId），复述要素确认后 finance_budget_adjustment_submit 提交；审批与过账由财务在控制台执行，Agent 不代批；进度用 finance_budget_adjustment_status_query；③ 填报查询用 finance_filing_assignments_query，代部门暂存行用 finance_filing_rows_upsert（提交须部门在界面确认）。

【录入与回填】用户明确要求录入或回填时才可调用写入工具（finance_create_payment_plan / finance_create_revenue_plan / finance_create_budget_line / finance_patch_payment_plan_actuals / finance_patch_revenue_plan_actuals）；调用前必须复述关键金额、期间与主体并等待确认；写入后建议调用 finance_run_alert_engine 刷新警情。

【输出口吻】财务口吻、结论先行、金额精确到元并按万/亿辅助表述；先给结论摘要，再给明细与依据；区分"事实（数据口径）"与"判断（预测/归因）"；最后给出下一步行动清单。数据不可用时说明原因，绝不编造数字。`
