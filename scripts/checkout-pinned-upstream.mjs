/** Materialize the pinned sibling checkout on ephemeral CI runners. */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = JSON.parse(readFileSync(resolve(root, 'upstream.json'), 'utf8'))
const checkout = resolve(root, upstream.localCheckout)

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

if (existsSync(checkout)) {
  const current = git(['-C', checkout, 'rev-parse', 'HEAD'])
  if (current !== upstream.commit) {
    throw new Error(`checkout-pinned-upstream: existing checkout is ${current}, expected ${upstream.commit}`)
  }
} else {
  git(['clone', '--filter=blob:none', '--no-checkout', upstream.repository, checkout])
  git(['-C', checkout, 'checkout', '--detach', upstream.commit])
}

console.log(`checkout-pinned-upstream: ready at ${upstream.commit.slice(0, 10)}`)
