#!/usr/bin/env node
/**
 * 按 upstream.json 的 sourceCommit 拉取固定版本的上游 sibling checkout。
 *
 * CI 使用本脚本替代「拉 dev 分支 HEAD」的旧行为，保证 upstream.json 的
 * 版本 pin 真正生效：上游 fork 再发布新版本也不会悄悄改变 CI 输入。
 * 拉取后立即校验 package.json 版本与 sourceVersion 一致，防止两个字段失配。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'))
const fail = message => { throw new Error(`fetch-upstream: ${message}`) }

// Windows 上 PATH 里的 GNU tar 会把 `C:\...` 解释成远程主机（host:file 语法），
// 报 `Cannot connect to C:`；System32 自带的 bsdtar 原生理解盘符路径。
const windowsTar = 'C:\\Windows\\System32\\tar.exe'
const tarExecutable = process.platform === 'win32' && existsSync(windowsTar)
  ? windowsTar
  : 'tar'

if (typeof upstream.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(upstream.sourceCommit)) {
  fail('upstream.json sourceCommit must be a full 40-character commit SHA')
}
if (typeof upstream.sourceVersion !== 'string' || upstream.sourceVersion.length === 0) {
  fail('upstream.json sourceVersion must be a non-empty string')
}

// git@github.com:owner/repo.git 与 https://github.com/owner/repo.git 都归一为
// GitHub HTTPS 归档端点，避免 CI 依赖 SSH 凭据。
const sshMatch = /^git@github\.com:(.+?)(?:\.git)?$/u.exec(upstream.repository ?? '')
const httpsMatch = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/u.exec(upstream.repository ?? '')
const repoPath = sshMatch?.[1] ?? httpsMatch?.[1]
if (repoPath === undefined) fail('upstream.json repository must point at a GitHub repository')

const upstreamDir = resolve(root, upstream.localCheckout)
const stageDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-upstream-'))

try {
  mkdirSync(upstreamDir, { recursive: true })
  // 拒绝在非空目录上叠加解压：本地开发者误把脚本指向真实 sibling checkout
  // 时应立刻失败，而不是混入两份源码。
  if (readdirSync(upstreamDir).length > 0) {
    fail(`${upstream.localCheckout} is not empty; refusing to overlay an existing checkout`)
  }
  const archivePath = join(stageDir, 'source.tar.gz')
  execFileSync('curl', [
    '--fail', '--location', '--retry', '3',
    '--output', archivePath,
    `https://github.com/${repoPath}/archive/${upstream.sourceCommit}.tar.gz`,
  ], { stdio: 'inherit' })
  execFileSync(tarExecutable, ['-xzf', archivePath, '--strip-components=1', '-C', upstreamDir], { stdio: 'inherit' })
  const fetchedPackage = JSON.parse(readFileSync(join(upstreamDir, 'package.json'), 'utf8'))
  if (fetchedPackage.version !== upstream.sourceVersion) {
    fail(`commit ${upstream.sourceCommit} reports version ${fetchedPackage.version}, but upstream.json pins ${upstream.sourceVersion}`)
  }
} finally {
  rmSync(stageDir, { recursive: true, force: true })
}

// 与既有 CI 步骤保持一致：部分校验脚本要求 sibling 是一个 git 仓库。
execFileSync('git', ['-C', upstreamDir, 'init', '--quiet'], { stdio: 'inherit' })
execFileSync('git', [
  '-C', upstreamDir,
  '-c', 'user.name=CI', '-c', 'user.email=ci@localhost',
  'commit', '--allow-empty', '--quiet', '-m', `CI source archive ${upstream.sourceCommit}`,
], { stdio: 'inherit' })

console.log(`fetch-upstream: ${repoPath}@${upstream.sourceCommit} (version ${upstream.sourceVersion}) is ready at ${upstreamDir}`)
