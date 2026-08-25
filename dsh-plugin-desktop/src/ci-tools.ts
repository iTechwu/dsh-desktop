/**
 * Cordis Host plugin registering the `ci_validate` and `ci_run` tools for the
 * DSH agent. They define, validate, and execute a local CI pipeline described in
 * a small YAML file (default `.dsh/ci.yml`), running each step through the
 * shell executor exactly like the agent's bash tool does.
 *
 * The pipeline format is deliberately minimal:
 * ```yaml
 * name: test
 * steps:
 *   - name: install
 *     run: pnpm install --frozen-lockfile
 *   - name: typecheck
 *     run: pnpm typecheck
 *     timeoutMs: 120000
 * ```
 *
 * This module owns the schema, parsing, validation, bounded execution, and result
 * formatting. It never invents a second CI engine; the shell executor runs each
 * step as a foreground command and the tool reports the per-step outcome.
 * @module dsh-plugin-desktop/ci-tools
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { parse } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'

/** Stable Cordis plugin name used by loader diagnostics. */
export const name = 'desktop-ci-tools'

/** Services required by the CI tool suite. */
export const inject = ['tools', 'shell', 'systemPrompt']

/** Default pipeline file path used when the caller omits one. */
export const DEFAULT_PIPELINE_FILE = '.dsh/ci.yml'

/** Default per-step cooperative timeout budget (ms). */
export const DEFAULT_CI_TIMEOUT_MS = 120_000

/** Upper bound on a pipeline file size (bytes). */
export const MAX_PIPELINE_BYTES = 256 * 1024

/** Upper bound on the number of steps in a pipeline. */
export const MAX_PIPELINE_STEPS = 64

/** Plugin config: default pipeline path and the per-step timeout budget. */
export interface Config {
  /** Default pipeline file path. Defaults to {@link DEFAULT_PIPELINE_FILE}. */
  pipelineFile?: string
  /** Cooperative timeout budget (ms) for one step. Defaults to {@link DEFAULT_CI_TIMEOUT_MS}. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  pipelineFile: z.string().default(DEFAULT_PIPELINE_FILE),
  timeoutMs: z.number().default(DEFAULT_CI_TIMEOUT_MS),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** One validated pipeline step. */
export interface CiStep {
  name: string
  run: string
  timeoutMs?: number
  continueOnError?: boolean
  workdir?: string
}

/** A validated pipeline. */
export interface CiPipeline {
  name: string
  steps: CiStep[]
}

/** Canonical `ci_validate` result value. */
export interface CiValidateValue {
  ok: boolean
  pipeline?: string
  errors: string[]
  steps: number
}

/** Canonical one-step `ci_run` result value. */
export interface CiStepResultValue {
  name: string
  command: string
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
  output?: string
}

/** Canonical `ci_run` result value. */
export interface CiRunValue {
  ok: boolean
  pipeline: string
  steps: CiStepResultValue[]
  passed: number
  failed: number
}

/** Errors discovered while parsing and validating a pipeline. */
export interface PipelineLoad {
  pipeline?: CiPipeline
  errors: string[]
}

/**
 * Resolve a pipeline path relative to the current working directory.
 * @param path - caller-supplied path.
 * @param fallback - configured default path.
 * @returns an absolute path.
 */
function resolvePipelinePath(path: string | undefined, fallback: string): string {
  const target = path ?? fallback
  return isAbsolute(target) ? target : resolve(process.cwd(), target)
}

/**
 * Validate one raw step object into a {@link CiStep}, appending errors.
 * @param raw - the parsed step value.
 * @param index - the step's position for error messages.
 * @param errors - cumulative error list.
 * @returns the validated step, or undefined when invalid.
 */
function validateStep(raw: unknown, index: number, errors: string[]): CiStep | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`steps[${index}] must be an object`)
    return undefined
  }
  const step = raw as Record<string, unknown>
  const name = step.name
  const run = step.run
  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push(`steps[${index}].name must be a non-empty string`)
  }
  if (typeof run !== 'string' || run.trim().length === 0) {
    errors.push(`steps[${index}].run must be a non-empty string`)
  }
  if (step.timeoutMs !== undefined && (typeof step.timeoutMs !== 'number' || !Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0)) {
    errors.push(`steps[${index}].timeoutMs must be a positive number`)
  }
  if (step.continueOnError !== undefined && typeof step.continueOnError !== 'boolean') {
    errors.push(`steps[${index}].continueOnError must be a boolean`)
  }
  if (step.workdir !== undefined && (typeof step.workdir !== 'string' || step.workdir.length === 0)) {
    errors.push(`steps[${index}].workdir must be a non-empty string`)
  }
  if (errors.length > 0 && (typeof name !== 'string' || typeof run !== 'string')) return undefined
  return {
    name: name as string,
    run: run as string,
    ...typeof step.timeoutMs === 'number' ? { timeoutMs: step.timeoutMs } : {},
    ...typeof step.continueOnError === 'boolean' ? { continueOnError: step.continueOnError } : {},
    ...typeof step.workdir === 'string' ? { workdir: step.workdir } : {},
  }
}

/**
 * Load and validate a pipeline from disk.
 * @param path - absolute pipeline file path.
 * @returns the validated pipeline plus any discovered errors.
 */
export async function loadPipeline(path: string): Promise<PipelineLoad> {
  const errors: string[] = []
  const buffer = await readFile(path)
  if (buffer.length > MAX_PIPELINE_BYTES) {
    return { errors: [`pipeline file exceeds ${MAX_PIPELINE_BYTES} bytes`] }
  }
  const text = buffer.toString('utf8')
  let parsed: unknown
  try {
    parsed = parse(text)
  } catch (error) {
    return { errors: [`cannot parse pipeline YAML: ${error instanceof Error ? error.message : String(error)}`] }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { errors: ['pipeline must be a YAML mapping'] }
  }
  const root = parsed as Record<string, unknown>
  const name = typeof root.name === 'string' && root.name.trim().length > 0
    ? root.name.trim()
    : 'ci'
  const rawSteps = root.steps
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return { errors: ['pipeline must declare a non-empty steps array'] }
  }
  if (rawSteps.length > MAX_PIPELINE_STEPS) {
    return { errors: [`pipeline declares ${rawSteps.length} steps; at most ${MAX_PIPELINE_STEPS} are allowed`] }
  }
  const steps: CiStep[] = []
  for (let index = 0; index < rawSteps.length; index++) {
    const validated = validateStep(rawSteps[index], index, errors)
    if (validated !== undefined) steps.push(validated)
  }
  if (errors.length > 0) return { errors }
  return { pipeline: { name, steps }, errors }
}

/** Format a `ci_validate` result value into model-facing text. */
export function formatCiValidateOutput(value: CiValidateValue): string {
  if (!value.ok) {
    return `CI pipeline validation failed${value.pipeline !== undefined ? ` for ${value.pipeline}` : ''}:
- ${value.errors.join('\n- ')}`
  }
  return `CI pipeline ${value.pipeline ?? 'ci'} is valid (${value.steps} step${value.steps === 1 ? '' : 's'})`
}

/** Format one `ci_run` result value into model-facing text. */
export function formatCiRunOutput(value: CiRunValue): string {
  const lines = [`CI pipeline ${value.pipeline}`]
  for (const step of value.steps) {
    const status = step.ok ? 'ok' : (step.timedOut ? 'timed out' : (step.aborted ? 'aborted' : `failed (exit ${step.exitCode})`))
    lines.push(`  [${status}] ${step.name} (${step.command})`)
    if (!step.ok && step.output !== undefined) lines.push(`    ${step.output}`)
  }
  lines.push(`${value.passed} passed, ${value.failed} failed`)
  return lines.join('\n')
}

/** Project a `ci_run` result into replayable presentation metadata. */
export function ciRunPresentationMeta(value: CiRunValue): JsonValue {
  return {
    pipeline: value.pipeline,
    passed: value.passed,
    failed: value.failed,
  }
}

/**
 * Register the `ci_validate` and `ci_run` tools for one generation.
 * Registrations are effect-scoped and unregister on plugin dispose.
 * @param ctx - Host context carrying the tools and shell registries.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  ctx.systemPrompt.section({
    name: 'tool:desktop-ci',
    order: 116,
    text: `Use ci_validate to check a local CI pipeline (default ${DEFAULT_PIPELINE_FILE}) without running it, and ci_run to execute every step in order. Each pipeline declares a name and an ordered steps array where every step has a name and a run command. ci_run stops on the first failing step unless a step sets continueOnError: true.`,
  })

  ctx.tools.register(defineTool({
    name: 'ci_validate',
    description: `Validate a local CI pipeline definition (default ${DEFAULT_PIPELINE_FILE}) without executing any step. Returns the number of steps and any structural errors.`,
    parameters: {
      path: { type: 'string', description: 'Path to the pipeline YAML file. Defaults to .dsh/ci.yml.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          pipeline: { type: 'string' },
          errors: { type: 'array', required: true, items: { type: 'string' } },
          steps: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatCiValidateOutput(value) }],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, _exec) {
      const { path } = args as { path?: string }
      const pipelinePath = resolvePipelinePath(path, resolved.pipelineFile)
      const load = await loadPipeline(pipelinePath)
      if (load.pipeline === undefined) {
        return { ok: false, errors: load.errors, steps: 0 }
      }
      return { ok: true, pipeline: load.pipeline.name, errors: [], steps: load.pipeline.steps.length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ci_run',
    description: `Execute a local CI pipeline definition (default ${DEFAULT_PIPELINE_FILE}) step by step, reporting each step's outcome. Stops on the first failing step unless it sets continueOnError: true.`,
    parameters: {
      path: { type: 'string', description: 'Path to the pipeline YAML file. Defaults to .dsh/ci.yml.' },
      stopOnFirstFailure: { type: 'boolean', description: 'Stop on the first failing step (default true).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          pipeline: { type: 'string', required: true },
          steps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                command: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
                timedOut: { type: 'boolean', required: true },
                aborted: { type: 'boolean', required: true },
                output: { type: 'string' },
              },
            },
          },
          passed: { type: 'integer', required: true },
          failed: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatCiRunOutput(value) }],
      presentationMeta: (_args, value) => ciRunPresentationMeta(value),
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const { path, stopOnFirstFailure } = args as { path?: string; stopOnFirstFailure?: boolean }
      const pipelinePath = resolvePipelinePath(path, resolved.pipelineFile)
      const load = await loadPipeline(pipelinePath)
      if (load.pipeline === undefined) {
        return { ok: false, pipeline: 'ci', steps: [], passed: 0, failed: 0 }
      }
      const pipeline = load.pipeline
      const stopOnFailure = stopOnFirstFailure ?? true
      const stepResults: CiStepResultValue[] = []
      let aborted = false
      for (const step of pipeline.steps) {
        if (exec.signal.aborted) {
          aborted = true
          break
        }
        const command = step.run
        const result = await ctx.shell.run(ctx.shell.resolve({
          command,
          signal: exec.signal,
          timeoutMs: step.timeoutMs ?? resolved.timeoutMs,
          ...step.workdir !== undefined ? { workdir: resolvePipelinePath(step.workdir, process.cwd()) } : {},
        }))
        const ok = result.exitCode === 0 && !result.aborted && !result.timedOut
        stepResults.push({
          name: step.name,
          command,
          ok,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          aborted: result.aborted,
          ...(!ok && (result.stdout.text.length > 0 || result.stderr.text.length > 0))
            ? { output: (result.stdout.text + result.stderr.text).trim().slice(0, 2000) }
            : {},
        })
        if (!ok && stopOnFailure && step.continueOnError !== true) break
      }
      const passed = stepResults.filter(step => step.ok).length
      const failed = stepResults.length - passed
      return {
        ok: failed === 0 && !aborted,
        pipeline: pipeline.name,
        steps: stepResults,
        passed,
        failed,
      }
    },
  }))
}
