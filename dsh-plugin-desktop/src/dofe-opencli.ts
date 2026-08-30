/** Built-in, read-only OpenCLI bridge shipped with Yootun-Agent. */
import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { DOFE_ACCESS_SETTINGS_NAMESPACE, DOFE_ACCESS_VALIDATION_VERSION, type DofeAccessSettings } from './dofe-plugins.ts'

export const name = 'dofe-opencli'
export const inject = ['tools', 'settings']

const TIMEOUT_MS = 90_000
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

function runOpenCli(args: string[], signal: AbortSignal): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile('opencli', args, {
      encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES, signal, timeout: TIMEOUT_MS, windowsHide: true,
    }, (error, stdout = '', stderr = '') => resolve({
      ok: error === null,
      stdout,
      stderr: error !== null && stderr.length === 0 ? error.message : stderr,
    }))
  })
}

export function apply(ctx: Context): void | (() => void) {
  const dispose = ctx.tools.register({
    name: 'dofe_opencli',
    description: 'Use the preinstalled DoFe OpenCLI bridge for approved read-only research routes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        args: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 2048 } },
      },
      required: ['args'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { ok: { type: 'boolean' }, stdout: { type: 'string' }, stderr: { type: 'string' } },
        required: ['ok', 'stdout', 'stderr'],
      },
      render: (_args: unknown, value: { ok: boolean; stdout: string; stderr: string }) => [{
        type: 'text', text: `${value.ok ? 'OpenCLI succeeded' : 'OpenCLI failed'}\n${value.stdout || value.stderr || '(no output)'}`,
      }],
    },
    timeoutMs: TIMEOUT_MS,
    isConcurrencySafe: () => false,
    async execute(args: { args?: unknown }, exec: { signal: AbortSignal }) {
      const access = ctx.settings.get(settingsNamespace(DOFE_ACCESS_SETTINGS_NAMESPACE)) as DofeAccessSettings | undefined
      if (access?.setupComplete !== true
        || access.validationVersion !== DOFE_ACCESS_VALIDATION_VERSION
        || !access.enabledPlugins.includes('opencli')) {
        throw new Error('DoFe OpenCLI is not enabled in the startup plugin selection')
      }
      if (!Array.isArray(args.args) || args.args.length === 0 || args.args.some(value => typeof value !== 'string')) {
        throw new Error('dofe_opencli args must be a non-empty string array')
      }
      return runOpenCli(args.args as string[], exec.signal)
    },
  })
  return dispose
}
