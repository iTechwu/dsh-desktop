/** Remove model credentials superseded by the mandatory MODELS_API_KEY gate. */
import { chmod, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const LEGACY_MODEL_REFS = new Set([
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
])

const AMBIENT_MODEL_CREDENTIALS = [
  'MODELS_API_KEY',
  ...LEGACY_MODEL_REFS,
] as const

/** Require model credentials to come from the mandatory desktop settings flow. */
export function removeModelCredentialEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of AMBIENT_MODEL_CREDENTIALS) delete environment[key]
}

export async function removeLegacyModelCredentials(homeDir: string): Promise<boolean> {
  const path = join(homeDir, '.credentials.yaml')
  let info
  try {
    info = await lstat(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('dsh-plugin-desktop: credentials document must be a regular file')
  }
  const document = parseDocument(await readFile(path, 'utf8'), { prettyErrors: true })
  if (document.errors.length > 0) throw new Error('dsh-plugin-desktop: credentials document is invalid')
  const value = document.toJS() as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const refs = (value as { refs?: unknown }).refs
  if (typeof refs !== 'object' || refs === null || Array.isArray(refs)) return false
  let changed = false
  for (const key of LEGACY_MODEL_REFS) {
    if (Object.prototype.hasOwnProperty.call(refs, key)) {
      document.deleteIn(['refs', key])
      changed = true
    }
  }
  if (!changed) return false
  await writeFileAtomic(path, document.toString(), { mode: 0o600 })
  await chmod(path, 0o600)
  return true
}
