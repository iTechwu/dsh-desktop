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

/**
 * 读取 DSH 当前登录用户（SSO 唯一用户源，sensteed 品牌由 dsh-plugin-desktop 提供）：
 * 优先 settings 命名空间 dofe-access（写盘且随登录态更新），兜底 dofeAuth 服务快照。
 * datasource 侧 ensureLocalUserExists 以 ssoSub 建档（本地 id == ssoSub），即财务成员 userId，
 * 因此 ssoSub 可直接作为 MCP 写工具的 operator（审批留痕与角色校验的主体）。
 */
function readSsoIdentity(ctx) {
  try {
    const identity = ctx.settings?.get?.('dofe-access')?.identity
    if (identity?.ssoSub) {
      return { id: String(identity.ssoSub), name: identity.name ? String(identity.name) : undefined }
    }
    const snapshot = ctx.dofeAuth?.getStatus?.() ?? ctx.get?.('dofeAuth')?.getStatus?.()
    if (snapshot?.status === 'bound' && snapshot.user?.ssoSub) {
      return { id: String(snapshot.user.ssoSub), name: snapshot.user.name ? String(snapshot.user.name) : undefined }
    }
  } catch { /* 非 sensteed 品牌/旧版宿主无身份服务：静默走凭据兜底 */ }
  return null
}

/** 每次请求时解析运行配置：凭据层可被 .credentials.yaml / 家目录 .env 热更新 */
async function resolveConfig(ctx) {
  const [secretNamed, secretLegacy, tenant, baseUrl, operator] = await Promise.all([
    credential(ctx, 'DATASOURCE_INTERNAL_API_SECRET'),
    credential(ctx, 'INTERNAL_API_SECRET'),
    credential(ctx, 'DATASOURCE_TENANT_ID'),
    credential(ctx, 'DATASOURCE_BASE_URL'),
    credential(ctx, 'DATASOURCE_OPERATOR_ID'),
  ])
  return {
    baseUrl: (baseUrl || process.env.DATASOURCE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    secret: secretNamed || secretLegacy || process.env.DATASOURCE_INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET || '',
    tenantId: (tenant || process.env.DATASOURCE_TENANT_ID || '').trim(),
    // 写工具操作者：SSO 登录身份 > 凭据 DATASOURCE_OPERATOR_ID（body 显式传参优先于两者）
    ssoIdentity: readSsoIdentity(ctx),
    operatorId: (operator || process.env.DATASOURCE_OPERATOR_ID || '').trim(),
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
  // 渲染进程同源（官方 dofe-auth-route 同款边界）：代理持 INTERNAL_API_SECRET，
  // 且写路由会自动注入登录操作者，必须挡住本机其他进程与网页的伪造请求。
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const sameOrigin = req => {
    const address = req.socket?.remoteAddress ?? ''
    const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
    if (!loopback) return false
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
    if (req.method !== 'POST') {
      // GET：同源导航/fetch 通常不带 Origin，仅在携带时校验（网页 CSRF 必带且必为跨站）
      return req.headers.origin === undefined || req.headers.origin === rendererOrigin
    }
    // POST：浏览器 fetch 必带 Origin；缺失或不同源一律拒绝
    if (req.headers.origin !== rendererOrigin) return false
    return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
  }

  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    async handler(req, res) {
      if (!sameOrigin(req)) {
        res.writeHead(403, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        res.end()
        return
      }
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

const QUERY_KEYS = [
  'year', 'month', 'page', 'limit', 'severity', 'status', 'orgId', 'expenseType', 'recordType', 'planType',
  'versionId', 'departmentId', 'unassigned', 'operator', 'keyword', 'onlyUnmapped', 'systemUserId',
  'baseVersionId', 'targetVersionId', 'planId', 'type', 'scope', 'kind', 'bizSystem', 'transport',
]

async function dispatchGet(fetchImpl, config, sub, url, res, logger) {
  const query = pickQuery(url)
  const tenant = () => ({ tenantId: config.tenantId })
  // 操作者解析：query 显式优先，其次 SSO 登录身份，再次凭据；都无则省略（工具端报结构化错误）
  const operatorArg = () => {
    const operator = query.operator || config.ssoIdentity?.id || config.operatorId
    return operator ? { operator } : {}
  }
  let calls
  // 路径含 ID 的详情路由（调整单/调增单状态流水）
  const detail = sub.match(/^\/budget-adjustments\/([\w-]+)$/)
  if (detail) {
    calls = [['finance_budget_adjustment_status_query', { ...tenant(), adjustmentId: detail[1] }]]
    return await runGet(calls, res, logger, config, fetchImpl)
  }
  const planDetail = sub.match(/^\/plan-adjustments\/([\w-]+)$/)
  if (planDetail) {
    calls = [['finance_plan_adjustment_status_query', { ...tenant(), adjustmentId: planDetail[1] }]]
    return await runGet(calls, res, logger, config, fetchImpl)
  }
  switch (sub) {
    case '/':
    case '/context':
      // 空租户时省略键，交由 MCP 端返回结构化 tenant_required，而不是 Zod min(1) 校验噪声
      calls = [['finance_get_orgs', config.tenantId ? { tenantId: config.tenantId } : {}]]
      // 部门列表供预算/排款的部门筛选；无租户时省略（渲染端按缺省处理）
      if (config.tenantId) calls.push(['finance_get_departments', { tenantId: config.tenantId }])
      break
    case '/brief':
      calls = [['finance_analysis_brief', { ...tenant(), year: query.year }]]
      break
    case '/budget':
      calls = [
        ['finance_get_budget_summary', { ...tenant(), year: query.year, orgId: query.orgId }],
        ['finance_get_budget_lines', {
          ...tenant(), year: query.year, orgId: query.orgId, versionId: query.versionId,
          departmentId: query.departmentId, unassigned: query.unassigned === '1' ? true : undefined,
          month: query.month, expenseType: query.expenseType, page: query.page, limit: query.limit,
        }],
      ]
      break
    case '/pr':
      calls = [['finance_get_payment_requests', { ...tenant(), year: query.year, orgId: query.orgId, month: query.month, recordType: query.recordType, page: query.page, limit: query.limit }]]
      break
    case '/payment-plans':
      calls = [['finance_get_payment_plans', {
        ...tenant(), year: query.year, orgId: query.orgId, departmentId: query.departmentId,
        unassigned: query.unassigned === '1' ? true : undefined,
        month: query.month, planType: query.planType, page: query.page, limit: query.limit,
      }]]
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
    case '/departments':
      calls = [['finance_get_departments', tenant()]]
      break
    case '/alerts-summary':
      calls = [['finance_get_alert_summary', { ...tenant(), year: query.year }]]
      break
    case '/alert-rules':
      calls = [['finance_get_alert_rules', tenant()]]
      break
    case '/budget-versions':
      calls = [['finance_get_budget_versions', { ...tenant(), year: query.year }]]
      break
    case '/budget-version-diff':
      calls = [['finance_get_budget_version_diff', { ...tenant(), year: query.year, baseVersionId: query.baseVersionId, targetVersionId: query.targetVersionId }]]
      break
    case '/carryover-rules':
      calls = [['finance_get_carryover_rules', tenant()]]
      break
    case '/saved-views':
      calls = [['finance_get_saved_views', { ...tenant(), ...operatorArg() }]]
      break
    case '/members':
      calls = [['finance_get_members', { ...tenant(), ...operatorArg() }]]
      break
    case '/employment-records':
      calls = [['finance_get_employment_records', { ...tenant(), systemUserId: query.systemUserId, departmentId: query.departmentId, page: query.page, limit: query.limit }]]
      break
    case '/contacts':
      calls = [['finance_directory_contacts_query', { ...tenant(), keyword: query.keyword, onlyUnmapped: query.onlyUnmapped, page: query.page, limit: query.limit }]]
      break
    case '/data-source-configs':
      calls = [['finance_get_data_source_configs', { ...tenant(), scope: query.scope, kind: query.kind, page: query.page, limit: query.limit }]]
      break
    case '/data-source-runs':
      calls = [['finance_get_data_source_runs', { ...tenant(), scope: query.scope, status: query.status, bizSystem: query.bizSystem, transport: query.transport, page: query.page, limit: query.limit }]]
      break
    case '/budget-adjustments':
      calls = [['finance_budget_adjustment_list', { ...tenant(), status: query.status, page: query.page, limit: query.limit }]]
      break
    case '/plan-adjustments':
      calls = [['finance_plan_adjustment_list', { ...tenant(), status: query.status, planId: query.planId, page: query.page, limit: query.limit }]]
      break
    case '/allocations-pool':
      calls = [['finance_allocation_pool_query', { ...tenant(), year: query.year }]]
      break
    case '/availability':
      calls = [['finance_budget_availability_query', { ...tenant(), year: query.year, orgId: query.orgId }]]
      break
    case '/filing-tasks':
      calls = [['finance_filing_task_list', { ...tenant(), status: query.status, type: query.type, year: query.year, page: query.page, limit: query.limit }]]
      break
    case '/filing-assignments':
      calls = [['finance_filing_assignments_query', { ...tenant(), ...operatorArg(), departmentId: query.departmentId, status: query.status, year: query.year, page: query.page, limit: query.limit }]]
      break
    default:
      return sendJson(res, 404, { ok: false, error: `unknown path: ${sub}` })
  }
  if (sub !== '/quality' && sub !== '/' && sub !== '/context' && !config.tenantId) {
    return sendJson(res, 400, { ok: false, error: '缺少 DATASOURCE_TENANT_ID：请在凭据服务或家目录 .env（~/.dsh/.env）中配置。' })
  }
  return await runGet(calls, res, logger, config, fetchImpl)
}

/** 执行一组 MCP 调用并按块降级拼装响应（部分失败保留成功块） */
async function runGet(calls, res, logger, config, fetchImpl) {
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

// 写路由表：pattern 捕获组经 map(m) 注入工具入参（id/assignmentId/action 等）；
// needsOperator=false 的工具入参无 operator 字段（数据源/通讯录类自身留痕）。
const WRITE_ROUTES = [
  { pattern: /^\/payment-plans$/, tool: 'finance_create_payment_plan' },
  { pattern: /^\/revenue-plans$/, tool: 'finance_create_revenue_plan' },
  { pattern: /^\/budget-lines$/, tool: 'finance_create_budget_line' },
  { pattern: /^\/payment-plans\/([\w-]+)\/actuals$/, tool: 'finance_patch_payment_plan_actuals', map: m => ({ id: m[1] }) },
  { pattern: /^\/payment-plans\/([\w-]+)\/schedule$/, tool: 'finance_patch_payment_plan_schedule', map: m => ({ id: m[1] }) },
  { pattern: /^\/revenue-plans\/([\w-]+)\/actuals$/, tool: 'finance_patch_revenue_plan_actuals', map: m => ({ id: m[1] }) },
  { pattern: /^\/alerts\/run$/, tool: 'finance_run_alert_engine', needsOperator: false },

  // 预警规则集 / 预算版本 / 递延规则 / 保存视图
  { pattern: /^\/alert-rules\/confirm$/, tool: 'finance_confirm_alert_rules' },
  { pattern: /^\/budget-versions\/([\w-]+)\/action$/, tool: 'finance_budget_version_action', map: m => ({ id: m[1] }) },
  { pattern: /^\/carryover-rules$/, tool: 'finance_carryover_rule_action' },
  { pattern: /^\/saved-views$/, tool: 'finance_save_view' },
  { pattern: /^\/saved-views\/delete$/, tool: 'finance_delete_saved_view' },

  // 成员与角色 / 通讯录 / 归属记录
  { pattern: /^\/members$/, tool: 'finance_upsert_member' },
  { pattern: /^\/members\/([\w-]+)\/remove$/, tool: 'finance_remove_member', map: m => ({ id: m[1] }) },
  { pattern: /^\/contacts\/([\w-]+)\/map-user$/, tool: 'finance_directory_map_user', map: m => ({ contactId: m[1] }), needsOperator: false },
  { pattern: /^\/employment-records$/, tool: 'finance_create_employment_record', needsOperator: false },

  // 填报：任务 / 指派行 / 指派状态
  { pattern: /^\/filing-tasks$/, tool: 'finance_filing_task_create' },
  { pattern: /^\/filing-tasks\/([\w-]+)\/close$/, tool: 'finance_filing_task_close', map: m => ({ id: m[1] }) },
  { pattern: /^\/filing-assignments\/([\w-]+)\/rows$/, tool: 'finance_filing_rows_upsert', map: m => ({ assignmentId: m[1] }) },
  { pattern: /^\/filing-assignments\/([\w-]+)\/(submit|commit|reopen)$/, tool: 'finance_filing_assignment_action', map: m => ({ id: m[1], action: m[2] }) },

  // 预算调整审批流
  { pattern: /^\/budget-adjustments$/, tool: 'finance_budget_adjustment_create' },
  { pattern: /^\/budget-adjustments\/([\w-]+)\/submit$/, tool: 'finance_budget_adjustment_submit', map: m => ({ adjustmentId: m[1] }) },
  { pattern: /^\/budget-adjustments\/([\w-]+)\/(approve|reject)$/, tool: 'finance_budget_adjustment_review', map: m => ({ id: m[1], action: m[2] }) },
  { pattern: /^\/budget-adjustments\/([\w-]+)\/post$/, tool: 'finance_budget_adjustment_post', map: m => ({ id: m[1] }) },
  { pattern: /^\/budget-adjustments\/([\w-]+)\/cancel$/, tool: 'finance_budget_adjustment_cancel', map: m => ({ id: m[1] }) },

  // 付款计划调增审批流（发起即提交）
  { pattern: /^\/plan-adjustments$/, tool: 'finance_payment_plan_increase_request' },
  { pattern: /^\/plan-adjustments\/([\w-]+)\/(approve|reject)$/, tool: 'finance_plan_adjustment_review', map: m => ({ id: m[1], action: m[2] }) },
  { pattern: /^\/plan-adjustments\/([\w-]+)\/post$/, tool: 'finance_plan_adjustment_post', map: m => ({ id: m[1] }) },
  { pattern: /^\/plan-adjustments\/([\w-]+)\/cancel$/, tool: 'finance_plan_adjustment_cancel', map: m => ({ id: m[1] }) },

  // 预算分配 / 数据源控制台
  { pattern: /^\/allocations$/, tool: 'finance_allocation_confirm' },
  { pattern: /^\/allocations\/([\w-]+)\/remove$/, tool: 'finance_allocation_remove', map: m => ({ id: m[1] }) },
  { pattern: /^\/data-source-configs\/([\w-]+)\/active$/, tool: 'finance_toggle_data_source_config', map: m => ({ id: m[1] }), needsOperator: false },
]

async function dispatchPost(fetchImpl, config, sub, req, res, logger) {
  if (!config.tenantId) {
    return sendJson(res, 400, { ok: false, error: '缺少 DATASOURCE_TENANT_ID：请在凭据服务或家目录 .env（~/.dsh/.env）中配置。' })
  }
  const match = WRITE_ROUTES.find(route => route.pattern.test(sub))
  if (!match) return sendJson(res, 404, { ok: false, error: `unknown path: ${sub}` })
  const body = await readJsonBody(req)
  if (body.error) return sendJson(res, 400, { ok: false, error: body.error })
  const captures = sub.match(match.pattern) || []
  const args = {
    ...body.json,
    ...(match.map ? match.map(captures) : {}),
    ...(match.needsOperator === false || match.tool === 'finance_run_alert_engine' ? {} : { tenantId: config.tenantId }),
  }
  // 写工具操作者：body 显式 > SSO 登录身份 > 凭据 DATASOURCE_OPERATOR_ID（审批流留痕）
  if (match.needsOperator !== false && match.tool !== 'finance_run_alert_engine' && !args.operator) {
    const operator = config.ssoIdentity?.id || config.operatorId
    if (!operator) {
      return sendJson(res, 400, { ok: false, error: '缺少操作者：请登录 DSH（SSO），或在凭据服务配置 DATASOURCE_OPERATOR_ID。' })
    }
    args.operator = operator
  }
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

【工作流】1) 先调 sensteed_finance_bootstrap 拿 tenantId 与主体列表；2) 用 mcp__finance__finance_analysis_brief 一次性建立全年口径基线（总览/预算/资金/预警/质量/批次）；3) 按需用 finance_get_budget_summary、finance_get_cash_summary、finance_get_payment_plans、finance_get_revenue_plans、finance_get_budget_lines（支持 departmentId/versionId/unassigned 筛选）、finance_get_payment_requests 下钻到主体×月度×部门；4) 预警细节用 finance_get_alerts 与 finance_get_alert_summary，数据可信度用 finance_get_data_quality 与 finance_get_import_batches；部门口径用 finance_get_departments，人员归属用 finance_get_employment_records。

【风险预判框架】输出必须覆盖四类确定性警情（与规则引擎口径一致）：预算超支（已打PR>预算，超 20% 为重大）、执行偏慢（已到期间执行率<30%）、资金缺口（预计/实际余额<0）、数据质量（未分配主体/缺失金额）。每条风险给出：影响金额（元）、涉及主体与期间、严重级别（重大/关注/提示）、置信度（高/中/低，基于数据完整度）、建议动作（可执行、有责任口）。分析前先看 finance_get_alert_rules：规则集未确认生效时正式告警为空属预期，须在结论中说明并以阈值手工推演。

【成本预判框架】基于月度趋势外推：结构占比（三类费用：项目运营/固定运营/模型专项）、环比变动、单主体集中度。预测须声明方法（如"按近3个月均值外推"）与假设，不虚构精度；数据不足时明确说明并给出补数建议。

【版本与规则纪律（v0.4）】① 预算版本：finance_get_budget_versions 查看主版本与草稿；版本推进链路=审定（confirm）→生效（activate，切主版本）→锁定（lock），用 finance_budget_version_action；对比两版本用 finance_get_budget_version_diff；结转口径用 finance_get_carryover_rules。引用预算数字须说明所属版本与是否主版本。② 预警规则集：finance_get_alert_rules 查看版本与阈值；确认生效用 finance_confirm_alert_rules（仅财务负责人，须复述阈值）。③ 保存视图：finance_save_view / finance_get_saved_views 可沉淀分析口径。

【预算调整与填报】调整审批流与填报是写通道，必须按用户明确指令操作：① 查可用预算用 finance_budget_availability_query（口径=预算-已打PR-已付款），批预算前必查并引用具体 budgetLineId；② 预算新增/调拨/追减用 finance_budget_adjustment_create 建草稿（调拨须调入=调出且调出行带 budgetLineId），复述要素确认后 finance_budget_adjustment_submit 提交；审批（finance_budget_adjustment_review）与过账（finance_budget_adjustment_post）由财务本人执行，Agent 不代批——仅在用户明确指示本人审批时调用；进度用 finance_budget_adjustment_status_query。③ 付款计划调增用 finance_payment_plan_increase_request（创建即提交），审批/过账纪律同上。④ 分配：finance_allocation_pool_query 查待认领池，finance_allocation_confirm 挂账，finance_allocation_remove 撤销。⑤ 填报：finance_filing_task_list/_task_create 管理任务，finance_filing_assignments_query 查部门填报，finance_filing_rows_upsert 代暂存，finance_filing_assignment_action 提交/定稿/重开（重开必须带原因入审计）。

【录入与回填】用户明确要求录入或回填时才可调用写入工具（finance_create_payment_plan / finance_create_revenue_plan / finance_create_budget_line / finance_patch_payment_plan_actuals / finance_patch_revenue_plan_actuals / finance_patch_payment_plan_schedule）；付款计划排款月份必填；调用前必须复述关键金额、期间与主体并等待确认；写入后建议调用 finance_run_alert_engine 刷新警情。

【输出口吻】财务口吻、结论先行、金额精确到元并按万/亿辅助表述；先给结论摘要，再给明细与依据；区分"事实（数据口径）"与"判断（预测/归因）"；最后给出下一步行动清单。数据不可用时说明原因，绝不编造数字。`
