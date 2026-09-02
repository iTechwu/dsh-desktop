/** Materialize the sibling DeepSeek Harness checkout link on ephemeral Windows runners. */

import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const root = resolve(dirname(script), '..')
const upstream = JSON.parse(readFileSync(resolve(root, 'upstream.json'), 'utf8'))
const checkout = resolve(root, upstream.localCheckout)
const workspaceLink = resolve(root, 'deepseek-harness')

/** Replace Git's Unix symlink representation with a Windows directory junction. */
export function materializeWindowsWorkspaceLink({
  platform = process.platform,
  link = workspaceLink,
  target = checkout,
} = {}) {
  if (platform !== 'win32') return false

  let entry
  try {
    entry = lstatSync(link)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (entry?.isFile()) {
    const recordedTarget = readFileSync(link, 'utf8').trim()
    if (recordedTarget !== '../deepseek-harness') {
      throw new Error(`upstream-workspace-link: refusing to replace unexpected file at ${link}`)
    }
  } else if (entry && !entry.isSymbolicLink()) {
    throw new Error(`upstream-workspace-link: refusing to replace non-link directory at ${link}`)
  }

  if (entry) unlinkSync(link)
  symlinkSync(target, link, 'junction')
  return true
}

export function main() {
  if (!existsSync(checkout)) {
    throw new Error(`upstream-workspace-link: the sibling checkout ${upstream.localCheckout} does not exist; clone ${upstream.repository} first`)
  }
  const materialized = materializeWindowsWorkspaceLink()
  process.stdout.write(`upstream-workspace-link: ${materialized ? 'materialized Windows junction' : 'symlink already in place'}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === script) {
  main()
}
