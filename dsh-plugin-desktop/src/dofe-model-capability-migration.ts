/** Repair DoFe vision-model capability metadata written by older desktop releases. */
import { chmod, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dofeModelInputModalities } from './dofe-models.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Restore image input on known vision models without changing unrelated settings. */
export async function repairDofeVisionModelSettings(homeDir: string): Promise<boolean> {
  const path = join(homeDir, 'settings.yaml')
  try {
    await lstat(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
  return withFileLock(path, async () => {
    let info
    try {
      info = await lstat(path)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw cause
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('dsh-plugin-desktop: settings document must be a regular file')
    }
    const document = parseDocument(await readFile(path, 'utf8'), { prettyErrors: true })
    if (document.errors.length > 0) throw new Error('dsh-plugin-desktop: settings document is invalid')
    const value = document.toJS() as unknown
    if (!isRecord(value)) return false
    const deepseek = value['llm-deepseek']
    if (!isRecord(deepseek) || !Array.isArray(deepseek.models)) return false

    let changed = false
    for (const [index, model] of deepseek.models.entries()) {
      if (!isRecord(model) || typeof model.id !== 'string') continue
      const current = Array.isArray(model.inputModalities)
        ? model.inputModalities.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
        : undefined
      const expected = dofeModelInputModalities(model.id, current)
      if (expected === undefined || expected.every(item => current?.includes(item))) continue
      document.setIn(['llm-deepseek', 'models', index, 'inputModalities'], [...expected])
      changed = true
    }
    if (!changed) return false
    await writeFileAtomic(path, document.toString(), { mode: 0o600, dirMode: 0o700 })
    await chmod(path, 0o600)
    return true
  })
}
