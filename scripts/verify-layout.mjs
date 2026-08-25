import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const run = (command, args, cwd = root) => execFileSync(command, args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim()
const fail = message => { throw new Error(`verify-layout: ${message}`) }

const workspace = readJson('package.json')
const upstream = readJson('upstream.json')
const plugin = readJson('dsh-plugin-desktop/package.json')
const fabric = readJson('dsh-community-fabric/package.json')
const market = readJson('dsh-community-market/package.json')
// The DeepSeek Harness source is a sibling checkout (not a vendored submodule).
const upstreamDir = resolve(root, upstream.localCheckout)
const upstreamPackage = readJson(resolve(upstreamDir, 'package.json'))

if (workspace.packageManager !== 'pnpm@11.7.0') {
  fail('the product workspace must pin pnpm@11.7.0')
}
const workspaceFile = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')
for (const entry of ['dsh-plugin-desktop', 'dsh-community-fabric', 'dsh-community-market', 'deepseek-harness/packages/**']) {
  if (!workspaceFile.includes(`- ${entry}`)) fail(`pnpm-workspace.yaml must include ${entry}`)
}
for (const [name, manifest] of [
  ['dsh-plugin-desktop', plugin],
  ['dsh-community-fabric', fabric],
  ['dsh-community-market', market],
]) {
  if (manifest.packageManager !== undefined) fail(`${name} must inherit the root pnpm release`)
}
if (fabric.name !== 'dsh-community-fabric') fail('the Fabric workspace must own dsh-community-fabric')
if (market.name !== 'dsh-community-market') fail('the market workspace must own dsh-community-market')
const claudePath = resolve(root, 'CLAUDE.md')
const claudeStat = lstatSync(claudePath)
// Windows checkouts materialize the symlink as a regular file holding the
// target name; accept both forms so the pointer stays verified on every host.
const claudeTarget = claudeStat.isSymbolicLink()
  ? readlinkSync(claudePath)
  : readFileSync(claudePath, 'utf8').trim()
if (claudeTarget !== 'AGENTS.md') {
  fail('CLAUDE.md must link to the outer repository AGENTS.md')
}
if (!existsSync(resolve(root, 'pnpm-lock.yaml'))) fail('pnpm-lock.yaml must exist')
if (typeof upstream.localCheckout !== 'string') {
  fail('upstream.json must declare the sibling localCheckout path')
}
if (typeof upstreamPackage.packageManager !== 'string' || !upstreamPackage.packageManager.startsWith('pnpm@')) {
  fail('the upstream checkout must retain its pnpm package manager')
}
if (!lstatSync(resolve(root, 'deepseek-harness')).isSymbolicLink()) {
  fail('deepseek-harness must be a symlink to the sibling checkout')
}

for (const [owner, manifest] of [
  ['root', workspace],
  ['desktop', plugin],
  ['fabric', fabric],
  ['market', market],
]) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'resolutions']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range !== 'string') continue
      if (name.startsWith('@deepseek-ai/dsh-') || name === '@deepseek-ai/cordis' || name === '@deepseek-ai/schemastery') {
        if (range !== 'workspace:*') fail(`${owner} ${field}.${name} must link the sibling workspace with workspace:*`)
      }
    }
  }
}

if (run('git', ['rev-parse', 'HEAD'], upstreamDir) !== upstream.commit) {
  fail(`checked-out upstream (${upstream.localCheckout}) commit differs from upstream.json`)
}
// A sibling dev checkout may carry local work (e.g. untracked files) or be a
// personal fork; the layout gate checks only the recorded commit and the
// package/pnpm identity, not cleanliness or the origin URL.
if (upstreamPackage.version !== upstream.sourceVersion) {
  fail(`${upstream.localCheckout} package version differs from upstream.json`)
}
process.stdout.write(`verify-layout: pnpm workspace and upstream ${upstream.commit.slice(0, 10)} are consistent\n`)
