import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { repairDofeVisionModelSettings } from '../src/dofe-model-capability-migration.ts'

const homes: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-model-capabilities-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('DoFe model capability migration', () => {
  it('repairs persisted vision models while preserving text-only models and unrelated settings', async () => {
    const home = temporaryHome()
    mkdirSync(home, { recursive: true })
    const path = join(home, 'settings.yaml')
    writeFileSync(path, [
      '# user settings',
      'agent-default-model:',
      '  provider: deepseek-official',
      '  model: deepseek-v4-flash-vision',
      'llm-deepseek:',
      '  models:',
      '    - id: deepseek-v4-flash-vision',
      '      name: Vision',
      '      inputModalities: [text]',
      '    - id: deepseek-v4-flash-vision-exp',
      '      inputModalities: [text]',
      '    - id: deepseek-v4-pro',
      '      inputModalities: [text]',
      'dsh-desktop:',
      '  mode: advanced',
      '',
    ].join('\n'))

    expect(await repairDofeVisionModelSettings(home)).toBe(true)
    const value = parse(readFileSync(path, 'utf8')) as {
      'llm-deepseek': { models: Array<{ id: string, inputModalities: string[] }> }
      'dsh-desktop': { mode: string }
    }
    expect(value['llm-deepseek'].models).toEqual([
      { id: 'deepseek-v4-flash-vision', name: 'Vision', inputModalities: ['text', 'image'] },
      { id: 'deepseek-v4-flash-vision-exp', inputModalities: ['text', 'image'] },
      { id: 'deepseek-v4-pro', inputModalities: ['text'] },
    ])
    expect(value['dsh-desktop']).toEqual({ mode: 'advanced' })
    expect(readFileSync(path, 'utf8')).toContain('# user settings')
    expect(await repairDofeVisionModelSettings(home)).toBe(false)
  })

  it('does nothing when settings or model entries are absent', async () => {
    const home = temporaryHome()
    expect(await repairDofeVisionModelSettings(home)).toBe(false)
    writeFileSync(join(home, 'settings.yaml'), 'dsh-desktop:\n  mode: compatibility\n')
    expect(await repairDofeVisionModelSettings(home)).toBe(false)
  })

  it('does not create the DSH home on a fresh installation', async () => {
    const home = join(temporaryHome(), 'missing-home')
    expect(await repairDofeVisionModelSettings(home)).toBe(false)
  })
})
