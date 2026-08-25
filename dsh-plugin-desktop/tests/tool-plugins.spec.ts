import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildBrowserCommand,
  browserPresentationMeta,
  formatBrowserOutput,
} from '../src/browser-tools.ts'
import {
  formatCiRunOutput,
  formatCiValidateOutput,
  loadPipeline,
} from '../src/ci-tools.ts'

describe('browser-tools command construction', () => {
  it('builds a navigate command with a safe url', () => {
    expect(buildBrowserCommand('opencli', { action: 'navigate', url: 'https://example.com' }))
      .toBe('opencli browser navigate --url https://example.com')
  })

  it('quotes a url containing shell characters', () => {
    const cmd = buildBrowserCommand('opencli', { action: 'navigate', url: "https://example.com/a b" })
    expect(cmd).toBe("opencli browser navigate --url 'https://example.com/a b'")
  })

  it('builds a search command with a query and selector', () => {
    const cmd = buildBrowserCommand('opencli', { action: 'search', query: 'dsh desktop', selector: '.result' })
    expect(cmd).toBe("opencli browser search --query 'dsh desktop' --selector .result")
  })
})

describe('browser-tools formatting', () => {
  it('renders a successful result with content and url', () => {
    const value = { ok: true, action: 'navigate' as const, url: 'https://a', content: 'hello', exitCode: 0 }
    expect(formatBrowserOutput(value)).toContain('succeeded')
    expect(formatBrowserOutput(value)).toContain('hello')
  })

  it('renders a failed result with the error message', () => {
    const value = { ok: false, action: 'click' as const, error: 'selector not found', exitCode: 1 }
    expect(formatBrowserOutput(value)).toBe('Browser click failed: selector not found')
  })

  it('projects replayable presentation metadata', () => {
    const value = { ok: true, action: 'extract' as const, content: 'text', exitCode: 0 }
    expect(browserPresentationMeta(value)).toEqual({ action: 'extract', content: 'text' })
  })
})

describe('ci-tools formatting', () => {
  it('renders a valid pipeline', () => {
    expect(formatCiValidateOutput({ ok: true, pipeline: 'test', errors: [], steps: 2 }))
      .toBe('CI pipeline test is valid (2 steps)')
  })

  it('renders validation errors', () => {
    const out = formatCiValidateOutput({ ok: false, errors: ['steps must be an array'], steps: 0 })
    expect(out).toContain('CI pipeline validation failed')
    expect(out).toContain('steps must be an array')
  })

  it('renders a run summary', () => {
    const value = {
      ok: false,
      pipeline: 'test',
      steps: [
        { name: 'typecheck', command: 'pnpm typecheck', ok: false, exitCode: 1, timedOut: false, aborted: false, output: 'error text' },
      ],
      passed: 0,
      failed: 1,
    }
    const out = formatCiRunOutput(value)
    expect(out).toContain('[failed (exit 1)] typecheck')
    expect(out).toContain('error text')
    expect(out).toContain('0 passed, 1 failed')
  })
})

describe('ci-tools pipeline loading', () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('loads a valid pipeline from disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ci-tools-'))
    const file = join(dir, 'ci.yml')
    await writeFile(file, 'name: build\nsteps:\n  - name: install\n    run: pnpm install\n  - name: typecheck\n    run: pnpm typecheck\n')
    const load = await loadPipeline(file)
    expect(load.errors).toEqual([])
    expect(load.pipeline?.name).toBe('build')
    expect(load.pipeline?.steps).toHaveLength(2)
  })

  it('rejects a pipeline without steps', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ci-tools-'))
    const file = join(dir, 'ci.yml')
    await writeFile(file, 'name: build\n')
    const load = await loadPipeline(file)
    expect(load.pipeline).toBeUndefined()
    expect(load.errors).toContain('pipeline must declare a non-empty steps array')
  })

  it('rejects a malformed step', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ci-tools-'))
    const file = join(dir, 'ci.yml')
    await writeFile(file, 'name: build\nsteps:\n  - name: install\n')
    const load = await loadPipeline(file)
    expect(load.errors).toContain('steps[0].run must be a non-empty string')
  })
})
