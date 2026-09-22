import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

// apply() 在装载时读取环境变量，先于任何用例固定好桩值
process.env.DATASOURCE_TENANT_ID ||= 'tenant-1'
process.env.DATASOURCE_INTERNAL_API_SECRET ||= 'sec'
process.env.DATASOURCE_BASE_URL ||= 'https://ds.local'

// 前缀路由注册名：子路径用例统一从 BASE 拼接，避免散落完整字面量
const BASE = '/api/desktop/sensteed/finance'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** MCP JSON-RPC 应答：把 tools/call 结果包成 content[0].text */
function mcpJson(data) {
  return jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } })
}

/** 宿主 ctx 桩：抓取前缀路由、工具与 systemPrompt 段 */
async function loadHost(overrides = {}) {
  const routes = new Map()
  const tools = new Map()
  const sections = []
  const { apply } = await import('../index.js')
  // 凭据桩：默认仅这两个引用有存储值；overrides.credentialRefs 提供时整体替换（模拟引用缺省场景）
  const credentialRefs = new Map(Object.entries(overrides.credentialRefs ?? {
    DATASOURCE_INTERNAL_API_SECRET: 'cred-secret',
    DATASOURCE_TENANT_ID: 'tenant-1',
  }))
  apply({
    credentials: { async resolve(name) { return credentialRefs.has(name) ? { value: credentialRefs.get(name), source: 'file' } : undefined } },
    effect(factory) { return factory() },
    logger: { warn() {} },
    webServer: { register(value) { routes.set(value.path, value); return () => {} } },
    tools: { register(value) { tools.set(value.name, value); return () => {} } },
    systemPrompt: { section(value) { sections.push(value); return () => {} } },
  }, overrides)
  return { routes, tools, sections }
}

async function invokeRoute(route, method, url, body) {
  let status = 0
  let raw = ''
  const req = { method, url: url || route.path, headers: {}, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)) } }
  const res = {
    writeHead(value) { status = value; return this },
    end(value = '') { raw += value },
  }
  await route.handler(req, res)
  return { status, body: raw ? JSON.parse(raw) : undefined }
}

const ENV = { DATASOURCE_TENANT_ID: 'tenant-1', DATASOURCE_INTERNAL_API_SECRET: 'sec', DATASOURCE_BASE_URL: 'https://ds.local' }

test('manifest wires the MCP client and the web client', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-sensteed-finance')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('registers a prefix route, a bootstrap tool, and finance guidance', async () => {
  const { routes, tools, sections } = await loadHost()
  assert.equal(routes.get(BASE).kind, 'prefix')
  assert.ok(tools.get('sensteed_finance_bootstrap'))
  assert.equal(sections[0].name, 'sensteed:finance-guidance')
  assert.match(sections[0].text, /finance_analysis_brief/u)
  assert.match(sections[0].text, /财务口吻/u)
})

test('GET routes proxy finance reads through the stateless MCP endpoint', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => {
    calls.push({ url: String(url), init })
    const name = JSON.parse(init.body).params.name
    if (name === 'finance_analysis_brief') return mcpJson({ year: 2026, overview: { metrics: [], trend: [], byOrg: [] }, alertsSummary: { total: 0 } })
    if (name === 'finance_get_orgs') return mcpJson({ list: [{ id: 'org-1', name: '主体A' }] })
    return mcpJson({ list: [], total: 0, page: 1, limit: 20 })
  } })
  const route = routes.get(BASE)
  const brief = await invokeRoute(route, 'GET', BASE + '/brief?year=2026')
  assert.equal(brief.status, 200)
  assert.equal(brief.body.ok, true)
  assert.equal(brief.body.data.year, 2026)
  const briefCall = calls.find(item => item.init.body.includes('finance_analysis_brief'))
  assert.match(briefCall.url, /^https:\/\/ds\.local\/mcp$/u, 'MCP endpoint = DATASOURCE_BASE_URL 源 + /mcp')
  assert.equal(briefCall.init.headers.authorization, 'Bearer cred-secret', 'credential-store value must win over process.env')
  assert.ok(JSON.parse(briefCall.init.body).params.arguments.tenantId, 'tenant must be injected')

  const quality = await invokeRoute(route, 'GET', BASE + '/quality')
  assert.equal(quality.status, 200)
  assert.ok(quality.body.quality, 'quality block present')
  assert.ok(quality.body.batches, 'batches block present')

  const missing = await invokeRoute(route, 'GET', BASE + '/nope')
  assert.equal(missing.status, 404)
})

test('write routes map to MCP write tools with path ids', async () => {
  const calls = []
  const { routes } = await loadHost({ fetch: async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return mcpJson({ created: { id: 'row-1' } }) } })
  const route = routes.get(BASE)
  const created = await invokeRoute(route, 'POST', BASE + '/payment-plans', { orgId: 'org-1', planType: 'PURCHASE', year: 2026, description: '测试', plannedAmount: 100 })
  assert.equal(created.status, 200)
  assert.equal(calls[0].body.params.name, 'finance_create_payment_plan')
  assert.equal(calls[0].body.params.arguments.tenantId, 'tenant-1')

  const patched = await invokeRoute(route, 'POST', BASE + '/revenue-plans/row-9/actuals', { actualAmount: 50 })
  assert.equal(patched.status, 200)
  assert.equal(calls[1].body.params.name, 'finance_patch_revenue_plan_actuals')
  assert.equal(calls[1].body.params.arguments.id, 'row-9')

  const rung = await invokeRoute(route, 'POST', BASE + '/alerts/run', { year: 2026 })
  assert.equal(rung.status, 200)
  assert.equal(calls[2].body.params.name, 'finance_run_alert_engine')

  const bad = await invokeRoute(route, 'POST', BASE + '/nope', {})
  assert.equal(bad.status, 404)
})

test('bootstrap tool reports tenant and orgs', async () => {
  const { tools } = await loadHost({ fetch: async () => mcpJson({ orgs: [{ id: 'org-1', name: '主体A' }] }) })
  const result = await tools.get('sensteed_finance_bootstrap').execute({})
  assert.equal(result.ok, true)
  assert.equal(result.result.tenantId, 'tenant-1')
  assert.equal(result.result.orgs[0].name, '主体A')
})

test('rejects tenant-dependent reads without a configured tenant while /quality stays available', async () => {
  const previous = process.env.DATASOURCE_TENANT_ID
  delete process.env.DATASOURCE_TENANT_ID
  try {
    const { routes } = await loadHost({
      credentialRefs: {},
      fetch: async () => mcpJson({ issues: [], list: [] }),
    })
    const route = routes.get(BASE)
    const brief = await invokeRoute(route, 'GET', BASE + '/brief')
    assert.equal(brief.status, 400)
    assert.match(brief.body.error, /DATASOURCE_TENANT_ID/u)
    const quality = await invokeRoute(route, 'GET', BASE + '/quality')
    assert.equal(quality.status, 200, 'quality reads need no tenant')
  } finally {
    if (previous !== undefined) process.env.DATASOURCE_TENANT_ID = previous
  }
})

test('keeps the secret out of URLs and never fabricates upstream data', async () => {
  const { routes } = await loadHost({ fetch: async () => new Response('denied', { status: 403 }) })
  const route = routes.get(BASE)
  const response = await invokeRoute(route, 'GET', BASE + '/brief')
  assert.equal(response.status, 502)
  assert.equal(response.body.ok, false)
  assert.equal(response.body.error, 'auth_unavailable')
  const source = await readFile(new URL('index.js', root), 'utf8')
  assert.doesNotMatch(source, /api_key|MODELS_API_KEY/u)
})

test('falls back to the legacy INTERNAL_API_SECRET ref when the named one is absent', async () => {
  const calls = []
  const { routes } = await loadHost({
    credentialRefs: { INTERNAL_API_SECRET: 'legacy-secret' },
    fetch: async (url, init) => { calls.push({ init }); return mcpJson({ list: [] }) },
  })
  const route = routes.get(BASE)
  await invokeRoute(route, 'GET', BASE + '/brief')
  assert.equal(calls[0].init.headers.authorization, 'Bearer legacy-secret')
})

test('patches the cordis entry to authorizationCredential for the packaged desktop', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /authorizationCredential: DATASOURCE_INTERNAL_API_SECRET/u)
  assert.doesNotMatch(patch, /!!js/u)
})

test('client source wires sidebar entry, overlay, and analysis entries', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['sidebar.footer.action', 'shell.overlay', 'sf-overlay', 'ANALYSIS_ENTRIES', 'finance_analysis_brief', 'backfillActual', 'runDone', 'analysis_forecast']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /fetch\(`https?:\/\//u, 'client must only call same-origin routes')
})

test('clicking the sidebar button renders the dashboard without render-time reference errors', async () => {
  // 回归：hook 依赖数组在渲染期求值，引用未声明标识符（曾经的 focusReady）会让
  // 看板首渲染即抛 ReferenceError，shell.overlay slot entry 崩溃，表现为“点击看板无反应”。
  // 桩 React 会真正调用函数组件（仅顶层一层），让渲染期错误在测试里当场抛出。
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} }
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
  globalThis.document = { activeElement: null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }
  globalThis.requestAnimationFrame = () => 0
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const module = { exports: {} }
  let renderDepth = 0
  const createElement = (type, props, ...children) => {
    const merged = { ...props, children }
    if (typeof type === 'function' && renderDepth === 0) {
      renderDepth += 1
      try { return type(merged) } finally { renderDepth -= 1 }
    }
    return { type, props: merged }
  }
  const reactStub = {
    createElement,
    Fragment: 'Fragment',
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: initial => ({ current: initial }),
    useEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  const primitivesStub = new Proxy({}, { get: (_target, key) => key === 'Tooltip' ? props => props.children : () => null })
  const requireStub = name => {
    if (name === 'react') return reactStub
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    throw new Error(`unexpected require: ${name}`)
  }
  new Function('require', 'module', 'exports', `${source}\nmodule.exports = { apply, Button, Overlay }`)(requireStub, module, module.exports)
  const { apply, Button, Overlay } = module.exports

  const registered = {}
  apply({
    effect(factory) { return factory() },
    locale: { register() {}, bind: () => key => key },
    slots: { inject(_key, register) { register() }, register(options, component) { registered[options.name] = component; return () => {} } },
    get: () => undefined,
  })
  assert.equal(registered['shell.overlay'], Overlay, 'shell.overlay must register the Overlay')

  const closed = Overlay({ t: key => key })
  assert.equal(closed, null, 'closed overlay renders nothing')

  // 点侧栏按钮 → openOverlay 置 opened=true（点击链路本身不许出错）
  const button = Button({ wide: true, t: key => key })
  const findClick = node => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findClick(child)
        if (found) return found
      }
      return undefined
    }
    if (!node || typeof node !== 'object') return undefined
    if (node.props?.onClick) return node.props.onClick
    for (const child of [].concat(node.props?.children ?? [])) {
      const found = findClick(child)
      if (found) return found
    }
    return undefined
  }
  const onClick = findClick(button)
  assert.equal(typeof onClick, 'function', 'sidebar button must carry the open handler')
  onClick({ currentTarget: null })

  // 打开状态的首渲染：曾因 focusReady 未定义在这里抛 ReferenceError
  const opened = Overlay({ t: key => key })
  assert.equal(opened?.props?.className, 'sf-overlay', 'opened overlay must render the dashboard shell')
})

test('client field names match the finance contract schemas', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  // 契约字段回归：FinanceMetric/trend 扁平 *Amount、BudgetSummary {list,totals}、PaymentPlan remainingAmount
  for (const token of ['budgetAmount', 'prSubmittedAmount', 'paidAmount', 'summary?.list', 'summary?.totals', 'remainingAmount', 'data?.list']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), token)
  }
  for (const stale of ['taxFreeAmount', "metric.key === 'budgetTotal'", '.rows ||']) {
    assert.doesNotMatch(source, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), stale)
  }
})
