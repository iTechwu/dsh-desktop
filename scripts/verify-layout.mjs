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
// 两个工作区合并为一个依赖图,必须共用同一个 pnpm 发布版。
if (upstreamPackage.packageManager !== workspace.packageManager) {
  fail('the sibling checkout must pin the same pnpm release as the product workspace')
}
const workspaceFile = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')
for (const entry of ['dsh-plugin-desktop', 'dsh-community-fabric', 'dsh-community-market', 'deepseek-harness/packages/**']) {
  if (!workspaceFile.includes(`- ${entry}`)) fail(`pnpm-workspace.yaml must include ${entry}`)
}
// 反 vendored 回归:仓库不再内嵌上游 tarball、不再重写 dsh 依赖解析。
if (existsSync(resolve(root, 'vendor'))) fail('vendor/ must not exist; the runtime comes from the sibling checkout')
if (existsSync(resolve(root, '.pnpmfile.cjs'))) fail('.pnpmfile.cjs must not exist; dependency rewriting is retired')
if (existsSync(resolve(root, '.gitmodules'))) fail('.gitmodules must not exist; the upstream is a sibling, not a submodule')
if (workspaceFile.includes('file:vendor/') || /file:\/Users\//u.test(workspaceFile)) {
  fail('pnpm-workspace.yaml must not pin vendored tarball resolutions')
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
// Yarn 时代遗留物不得回流。
for (const legacy of ['yarn.lock', '.yarnrc.yml']) {
  if (existsSync(resolve(root, legacy))) fail(`${legacy} must not exist; this repository uses pnpm`)
}
for (const member of ['dsh-plugin-desktop', 'dsh-community-fabric', 'dsh-community-market']) {
  for (const legacy of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    if (existsSync(resolve(root, member, legacy))) fail(`${member}/${legacy} must not exist; the root owns the lockfile`)
  }
}
// upstream.json 契约:只描述兄弟 fork 的位置与版本,不钉 commit、不再 vendor。
const expectedUpstreamKeys = ['branch', 'localCheckout', 'repository', 'sourceVersion'].sort()
if (JSON.stringify(Object.keys(upstream).sort()) !== JSON.stringify(expectedUpstreamKeys)) {
  fail(`upstream.json must declare exactly ${expectedUpstreamKeys.join(', ')}`)
}
if (typeof upstream.localCheckout !== 'string' || !upstream.localCheckout.startsWith('../')) {
  fail('upstream.json must declare the sibling localCheckout path outside the repository')
}
if (typeof upstream.branch !== 'string' || upstream.branch.length === 0) {
  fail('upstream.json must declare the tracked sibling branch')
}
if (typeof upstreamPackage.packageManager !== 'string' || !upstreamPackage.packageManager.startsWith('pnpm@')) {
  fail('the upstream checkout must retain its pnpm package manager')
}
if (upstreamPackage.name !== '@deepseek-ai/dsh-root') {
  fail(`${upstream.localCheckout} must be the DeepSeek Harness checkout`)
}
if (upstreamPackage.version !== upstream.sourceVersion) {
  fail(`${upstream.localCheckout} package version differs from upstream.json`)
}
// 链接契约:索引恒为 mode 120000;非 Windows 上再验证真实指向。
const linkMode = run('git', ['ls-files', '--stage', '--', 'deepseek-harness']).split(' ')[0]
if (linkMode !== '120000') fail('deepseek-harness must be recorded as a symlink (mode 120000)')
const linkPath = resolve(root, 'deepseek-harness')
if (process.platform !== 'win32') {
  if (!lstatSync(linkPath).isSymbolicLink()) fail('deepseek-harness must be a symlink to the sibling checkout')
  if (resolve(root, readlinkSync(linkPath)) !== resolve(root, upstream.localCheckout)) {
    fail('deepseek-harness symlink must point at upstream.json localCheckout')
  }
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
      // cordis 家族任何非 workspace 精确版本都会造成双实例,一律禁止。
      if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
        || name === '@deepseek-ai/cordis' || name.startsWith('@deepseek-ai/cordis-plugin-')
        || name === '@deepseek-ai/schemastery' || name === '@deepseek-ai/cosmokit') {
        if (range !== 'workspace:*') fail(`${owner} ${field}.${name} must link the sibling workspace with workspace:*`)
      }
    }
  }
}

process.stdout.write(`verify-layout: pnpm workspace and sibling upstream ${upstream.sourceVersion} are consistent\n`)
