/** Materialize the pinned sibling checkout on ephemeral CI runners. */

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const root = resolve(dirname(script), '..')
const upstream = JSON.parse(readFileSync(resolve(root, 'upstream.json'), 'utf8'))
const checkout = resolve(root, upstream.localCheckout)
const workspaceLink = resolve(root, 'deepseek-harness')

if (
  upstream.localCheckout !== '../deepseek-harness'
  || upstream.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git'
  || !/^[0-9a-f]{40}$/u.test(upstream.commit)
) {
  throw new Error('checkout-pinned-upstream: upstream.json contains an unsupported checkout target')
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`checkout-pinned-upstream: git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

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
      throw new Error(`checkout-pinned-upstream: refusing to replace unexpected file at ${link}`)
    }
  } else if (entry && !entry.isSymbolicLink()) {
    throw new Error(`checkout-pinned-upstream: refusing to replace non-link directory at ${link}`)
  }

  if (entry) unlinkSync(link)
  symlinkSync(target, link, 'junction')
  return true
}

export function main() {
  if (existsSync(checkout)) {
    const current = git(['-C', checkout, 'rev-parse', 'HEAD'])
    if (current !== upstream.commit) {
      throw new Error(`checkout-pinned-upstream: existing checkout is ${current}, expected ${upstream.commit}`)
    }
  } else {
    git(['clone', '--filter=blob:none', '--no-checkout', upstream.repository, checkout])
    git(['-C', checkout, 'checkout', '--detach', upstream.commit])
  }

  materializeWindowsWorkspaceLink()

  console.log(`checkout-pinned-upstream: ready at ${upstream.commit.slice(0, 10)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === script) main()
