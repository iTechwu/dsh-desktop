import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../', import.meta.url)

describe('OpenMontage workflow guard composition', () => {
  it('mounts the shared Host policy in the Desktop profile', async () => {
    const patch = readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')
    const manifest = JSON.parse(
      readFileSync(new URL('package.json', packageRoot), 'utf8'),
    ) as { dependencies?: Record<string, string> }

    expect(patch).toMatch(
      /id: openmontage-guidance\n\s+name: '@dofe\/dsh-openmontage-mcp'\n\s+config:\n\s+stalledOutcomeThreshold: 3/u,
    )
    expect(manifest.dependencies?.['@dofe/dsh-openmontage-mcp']).toBe('workspace:*')
  })

  it('contributes the complete workflow guidance to the final system prompt', async () => {
    const OpenMontage = await import(
      new URL('../../deepseek-harness/plugins/dsh-openmontage-mcp/index.js', import.meta.url).href
    )
    const ctx = new Context()

    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(OpenMontage, { stalledOutcomeThreshold: 3 })

      const prompt = (await ctx.systemPrompt.assemble()).sections
        .map(section => section.text)
        .join('\n')
      expect(prompt).toContain('prepare_reference_clone')
      expect(prompt).toContain('read_project_file')
      expect(prompt).toContain('submit_video_job')
      expect(prompt).toContain('stageContract 为本次执行的权威契约')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
