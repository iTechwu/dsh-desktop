/**
 * Cordis Host plugin registering a model-facing `browser` tool for the DSH agent.
 *
 * The tool drives a real browser by delegating to the OpenCLI browser driver
 * (the shared `opencli browser` capability), so the agent can navigate, click,
 * extract content, and search from inside a session. When the browser driver is
 * unavailable the tool fails closed with an actionable message instead of
 * silently doing nothing.
 *
 * This module owns only the model-facing schema, validation, prompt guidance,
 * command construction, and output formatting. It never implements browser
 * automation itself; the OpenCLI driver is the single source of that behavior.
 * @module dsh-plugin-desktop/browser-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Stable Cordis plugin name used by loader diagnostics. */
export const name = 'desktop-browser-tools'

/** Services required by the browser tool suite. */
export const inject = ['tools', 'shell', 'systemPrompt']

/** Default cooperative timeout budget (ms) for a single browser command. */
export const DEFAULT_BROWSER_TIMEOUT_MS = 30_000

/** Model-facing `browser` actions the driver understands. */
export const BROWSER_ACTIONS = ['navigate', 'extract', 'click', 'back', 'search'] as const

export type BrowserAction = (typeof BROWSER_ACTIONS)[number]

/** Plugin config: browser-driver command and the per-command timeout budget. */
export interface Config {
  /** Browser-driver command used to reach the OpenCLI browser capability. Defaults to 'opencli'. */
  opencliCommand?: string
  /** Cooperative timeout budget (ms) for one browser command. Defaults to {@link DEFAULT_BROWSER_TIMEOUT_MS}. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  opencliCommand: z.string().default('opencli'),
  timeoutMs: z.number().default(DEFAULT_BROWSER_TIMEOUT_MS),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** Canonical `browser` tool arguments after schema validation. */
export interface BrowserArgs {
  action: BrowserAction
  url?: string
  selector?: string
  query?: string
}

/** Canonical `browser` tool result value (lossless JSON). */
export interface BrowserResultValue {
  ok: boolean
  action: string
  url?: string
  content?: string
  error?: string
  exitCode: number | null
}

/** Quote a value for safe interpolation into the foreground shell command. */
function shellQuote(value: string): string {
  if (value.length === 0) return "''"
  if (/^[A-Za-z0-9_./:=@-]+$/u.test(value)) return value
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

/**
 * Build the driver command for one browser action.
 * @param opencliCommand - configured driver command.
 * @param args - validated browser arguments.
 * @returns the shell command string to execute.
 */
export function buildBrowserCommand(opencliCommand: string, args: BrowserArgs): string {
  const parts = [opencliCommand, 'browser', args.action]
  if (args.action === 'search') {
    if (args.query !== undefined) parts.push('--query', shellQuote(args.query))
  } else if (args.url !== undefined) {
    parts.push('--url', shellQuote(args.url))
  }
  if (args.selector !== undefined) parts.push('--selector', shellQuote(args.selector))
  return parts.join(' ')
}

/** Map one driver outcome into the canonical result value. */
function toResult(
  action: BrowserAction,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  url: string | undefined,
): BrowserResultValue {
  const ok = exitCode === 0
  const content = ok && stdout.length > 0 ? stdout : undefined
  const message = ok ? undefined : (stderr.trim().length > 0 ? stderr.trim() : undefined)
  return {
    ok,
    action,
    ...url !== undefined ? { url } : {},
    ...content !== undefined ? { content } : {},
    ...message !== undefined ? { error: message } : {},
    exitCode,
  }
}

/** Format a validated `browser` result value into model-facing text. */
export function formatBrowserOutput(value: BrowserResultValue): string {
  if (!value.ok) {
    return `Browser ${value.action} failed${value.error !== undefined ? `: ${value.error}` : ` (exit ${value.exitCode})`}`
  }
  const lines = [`Browser ${value.action} succeeded`]
  if (value.url !== undefined) lines.push(`url: ${value.url}`)
  if (value.content !== undefined) lines.push(value.content)
  return lines.join('\n')
}

/** Project the canonical result into replayable presentation metadata. */
export function browserPresentationMeta(value: BrowserResultValue): JsonValue {
  return {
    action: value.action,
    ...value.url !== undefined ? { url: value.url } : {},
    ...value.content !== undefined ? { content: value.content } : {},
  }
}

/**
 * Register the `browser` tool for one generation. Registrations are
 * effect-scoped and unregister on plugin dispose.
 * @param ctx - Host context carrying the tools and shell registries.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  ctx.systemPrompt.section({
    name: 'tool:desktop-browser',
    order: 115,
    text: `Use the browser tool to operate a real browser through the OpenCLI
driver. The required action is one of ${BROWSER_ACTIONS.join(', ')}. Pass url for
navigate, query for search, and selector for click or extract. A successful call
returns optional page content; pass it back to the model verbatim and cite the
url. When the action fails, read the error and adjust the inputs before retrying.`,
  })

  ctx.tools.register(defineTool({
    name: 'browser',
    description: `Operate a real browser via the OpenCLI driver. Actions: ${BROWSER_ACTIONS.join(', ')}. Use navigate with a url, search with a query, click or extract with a selector, and back to return. Returns page content and the current url.`,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: [...BROWSER_ACTIONS],
        description: 'The browser action to perform.',
      },
      url: { type: 'string', description: 'Target URL for navigate.' },
      query: { type: 'string', description: 'Search query for the search action.' },
      selector: { type: 'string', description: 'CSS selector for click or extract.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string', required: true },
          url: { type: 'string' },
          content: { type: 'string' },
          error: { type: 'string' },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatBrowserOutput(value) }],
      presentationMeta: (_args, value) => browserPresentationMeta(value),
    },
    timeoutMs: resolved.timeoutMs,
    // Browser commands do not mutate parent-agent state.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const browserArgs = args as BrowserArgs
      const command = buildBrowserCommand(resolved.opencliCommand, browserArgs)
      const result = await ctx.shell.run(ctx.shell.resolve({
        command,
        signal: exec.signal,
        timeoutMs: resolved.timeoutMs,
      }))
      return toResult(
        browserArgs.action,
        result.exitCode,
        result.stdout.text,
        result.stderr.text,
        browserArgs.url,
      )
    },
  }))
}
