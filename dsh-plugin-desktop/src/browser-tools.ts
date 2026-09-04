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
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Stable Cordis plugin name used by loader diagnostics. */
export const name = 'desktop-browser-tools'

/** Services required by the browser tool suite. */
export const inject = ['tools', 'shell', 'systemPrompt']

/** Default cooperative timeout budget (ms) for a single browser command. */
export const DEFAULT_BROWSER_TIMEOUT_MS = 30_000

/** Model-facing `browser` actions the driver understands. */
export const BROWSER_ACTIONS = ['navigate', 'state', 'extract', 'click', 'type', 'fill', 'select', 'upload', 'keys', 'get_value', 'back'] as const

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
  session?: string
  url?: string
  target?: string
  text?: string
  selector?: string
  files?: string[]
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
  const required = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`browser ${args.action} requires ${name}`)
    return shellQuote(value)
  }
  const parts = [opencliCommand, 'browser', shellQuote(args.session ?? 'yootun-agent')]
  if (args.action === 'navigate') parts.push('open', required(args.url, 'url'), '--window', 'foreground')
  else if (args.action === 'state' || args.action === 'back') parts.push(args.action)
  else if (args.action === 'extract') {
    parts.push('extract')
    if (args.selector) parts.push('--selector', shellQuote(args.selector))
  } else if (args.action === 'click') parts.push('click', required(args.target, 'target'))
  else if (args.action === 'type' || args.action === 'fill' || args.action === 'select') parts.push(args.action, required(args.target, 'target'), required(args.text, 'text'))
  else if (args.action === 'upload') {
    if (!args.files?.length) throw new Error('browser upload requires files')
    parts.push('upload', required(args.target, 'target'), ...args.files.map(shellQuote))
  } else if (args.action === 'keys') parts.push('keys', required(args.text, 'text'))
  else if (args.action === 'get_value') parts.push('get', 'value', required(args.target, 'target'))
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
driver. The required action is one of ${BROWSER_ACTIONS.join(', ')}. Use one stable
session for a multi-step flow. Always run state before click/type/fill/select/upload,
use the current numeric ref as target, and verify important writes with get_value.
Never type login credentials: ask the user to sign in in the foreground window.
Do not click a platform's final publish control without explicit user approval.`,
  })

  ctx.tools.register(defineTool({
    name: 'browser',
    description: `Operate a real browser via OpenCLI. Actions: ${BROWSER_ACTIONS.join(', ')}. Supports stable sessions, page inspection, verified form input, uploads, and clicks.`,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: [...BROWSER_ACTIONS],
        description: 'The browser action to perform.',
      },
      session: { type: 'string', description: 'Stable session name. Reuse it throughout one publishing flow.' },
      url: { type: 'string', description: 'Target URL for navigate.' },
      target: { type: 'string', description: 'Numeric ref from state, or an unambiguous CSS selector.' },
      text: { type: 'string', description: 'Text, select option, or key chord required by the action.' },
      selector: { type: 'string', description: 'Optional extraction scope CSS selector.' },
      files: { type: 'array', items: { type: 'string' }, description: 'Local file paths for upload.' },
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
