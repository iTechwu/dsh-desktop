import { execFile } from 'node:child_process'

export const name = 'dsh-agent-reach-tools'
export const inject = ['tools', 'systemPrompt', 'credentials']

const TIMEOUT_MS = 90000
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const EXA_MCP_URL = 'https://ixicai.cn/mcp/exa'
const READ_ONLY_COMMANDS = new Map([
  ['autohome', new Set(['brand', 'score'])],
  ['bilibili', new Set(['comments', 'hot', 'ranking', 'search', 'subtitle', 'summary', 'user-videos', 'video'])],
  ['dongchedi', new Set(['koubei', 'models', 'score', 'search', 'series', 'specs'])],
  ['duckduckgo', new Set(['search', 'suggest'])],
  ['exa', new Set(['fetch', 'search'])],
  ['google', new Set(['news', 'search', 'suggest', 'trends'])],
  ['toutiao', new Set(['articles', 'hot', 'recommend'])],
  ['weibo', new Set(['comments', 'hot', 'search', 'user', 'user-posts'])],
  ['xiaohongshu', new Set(['comments', 'feed', 'note', 'search', 'user'])],
  ['zhihu', new Set(['answer-comments', 'answer-detail', 'hot', 'question', 'search', 'user-answers', 'user-articles'])],
])

export function validateReadOnlyArgs(args) {
  if (!Array.isArray(args) || args.length < 2) {
    throw new Error('agent_reach requires a site and a read-only command')
  }
  const [site, command] = args
  if (!READ_ONLY_COMMANDS.get(site)?.has(command)) {
    throw new Error(`agent_reach command is not allowed: ${String(site)} ${String(command)}`)
  }
  if (args.some(value => typeof value !== 'string' || value.length === 0 || value.length > 2048 || value.includes('\0'))) {
    throw new Error('agent_reach arguments must be non-empty strings up to 2048 characters')
  }
  return args
}

export function buildExaToolCall(args) {
  validateReadOnlyArgs(args)
  const [, command, ...rest] = args
  if (command === 'search') {
    const limitIndex = rest.indexOf('--limit')
    const queryParts = limitIndex < 0 ? rest : rest.slice(0, limitIndex)
    const requestedLimit = limitIndex < 0 ? 5 : Number(rest[limitIndex + 1])
    const query = queryParts.join(' ').trim()
    if (!query || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 10) {
      throw new Error('exa search requires a query and --limit between 1 and 10')
    }
    return { name: 'web_search_exa', arguments: { query, numResults: requestedLimit } }
  }

  const urls = rest.filter(value => !value.startsWith('--'))
  if (urls.length === 0 || urls.length > 5 || urls.some(value => {
    try { return new URL(value).protocol !== 'https:' } catch { return true }
  })) {
    throw new Error('exa fetch requires between 1 and 5 HTTPS URLs')
  }
  return { name: 'web_fetch_exa', arguments: { urls, maxCharacters: 6000 } }
}

function exaText(payload) {
  const messages = payload.split('\n').filter(line => line.startsWith('data: '))
  for (const message of messages) {
    const parsed = JSON.parse(message.slice(6))
    if (parsed.error) throw new Error(parsed.error.message || 'Exa MCP returned an error')
    const content = parsed.result?.content
    if (Array.isArray(content)) return content.filter(item => item?.type === 'text').map(item => item.text).join('\n')
  }
  throw new Error('Exa MCP returned no result')
}

async function runExa(args, timeoutMs, signal, apiKey) {
  const call = buildExaToolCall(args)
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  try {
    const response = await fetch(EXA_MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'agent-reach', method: 'tools/call', params: call }),
      signal: combinedSignal,
    })
    if (!response.ok) throw new Error(`Exa MCP returned HTTP ${response.status}`)
    const stdout = exaText(await response.text())
    return { ok: true, exitCode: 0, stdout: stdout.slice(0, MAX_OUTPUT_BYTES), stderr: '' }
  } catch (error) {
    return { ok: false, exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

function runOpenCli(args, timeoutMs, signal) {
  return new Promise((resolve) => {
    execFile('opencli', args, {
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
      signal,
      timeout: timeoutMs,
      windowsHide: true,
    }, (error, stdout = '', stderr = '') => {
      resolve({
        ok: error === null,
        exitCode: Number.isInteger(error?.code) ? error.code : error === null ? 0 : 1,
        stdout,
        stderr: error && stderr.length === 0 ? error.message : stderr,
      })
    })
  })
}

function render(value) {
  const heading = value.ok ? 'agent-reach backend succeeded' : 'agent-reach backend failed'
  return `${heading} (exit ${value.exitCode})\n${value.stdout || value.stderr || '(no output)'}`
}

export function apply(ctx) {
  const disposeTool = ctx.tools.register({
    name: 'agent_reach',
    description: 'Use agent-reach read-only research backends. Prefer ["exa","search",query,"--limit","5"] for unattended web search; use approved OpenCLI site routes for supplemental social research.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        args: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: { type: 'string', minLength: 1, maxLength: 2048 },
          description: 'Route arguments, for example ["exa","search","优惠豚 好车会员店","--limit","5"] or ["xiaohongshu","search","买车优惠","-f","json"].',
        },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
      },
      required: ['args'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          exitCode: { type: 'integer' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
        },
        required: ['ok', 'exitCode', 'stdout', 'stderr'],
      },
      render: (_args, value) => [{ type: 'text', text: render(value) }],
    },
    timeoutMs: TIMEOUT_MS,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const argv = validateReadOnlyArgs(args?.args)
      const timeoutMs = Math.min(Number(args.timeoutMs) || TIMEOUT_MS, 120000)
      if (argv[0] === 'exa') {
        const credential = await ctx.credentials.resolve('MODELS_API_KEY')
        if (!credential?.value) return { ok: false, exitCode: 1, stdout: '', stderr: 'model_api_key is not configured' }
        return runExa(argv, timeoutMs, exec.signal, credential.value)
      }
      return runOpenCli(argv, timeoutMs, exec.signal)
    },
  })

  const disposePrompt = ctx.systemPrompt.section({
    name: 'agent-reach:guidance',
    order: 6,
    text: '互联网调研遵循 agent-reach 路由。无人值守任务先用 agent_reach 的 exa search（格式：["exa","search",查询,"--limit","5"]），必要时用 exa fetch 回读 HTTPS 来源；再按可用性补充 OpenCLI 社交来源。登录态或平台受限时不得绕过限制，改用可用来源并披露覆盖缺口。不得发帖、评论、点赞或执行其他写操作。',
  })
  return () => {
    disposePrompt?.()
    disposeTool?.()
  }
}
