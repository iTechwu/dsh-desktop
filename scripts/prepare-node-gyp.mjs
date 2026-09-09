import { chmodSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const cacheRoot = join(homedir(), '.cache', 'node', 'corepack')
const targetSuffix = join('node-gyp', 'gyp', 'gyp_main.py')

function repairLaunchers(directory, depth = 0) {
  if (depth > 12) return

  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      repairLaunchers(path, depth + 1)
      continue
    }
    if (!path.endsWith(targetSuffix)) continue
    try {
      chmodSync(path, statSync(path).mode | 0o111)
    } catch {
      // A missing or read-only Corepack cache should not block other installs.
    }
  }
}

repairLaunchers(cacheRoot)
