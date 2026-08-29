// 将桌面产品拥有的行为补丁应用到上游兄弟目录的构建产物(lib/)。
// pnpm 的 patchedDependencies 不支持 workspace 链接包,因此这些
// yarn resolutions 时代的补丁由本脚本在上游构建完成后统一应用
// (root package.json 的 upstream:build 已串接本脚本)。
// 幂等:补丁的全部新增行已存在于目标产物时视为已应用并跳过;
// 既未应用又无法干净应用的补丁会令脚本失败。
//
// 实现注意:
// - 必须用 patch(1) 而非 git apply:兄弟目录是 git 仓库,git apply 在其
//   子目录中运行时会把补丁路径按仓库根前缀过滤(直接 "Skipped patch" 且
//   --check 仍退出 0),补丁永远落不了盘。
// - macOS 的 BSD patch 会静默忽略单个补丁文件操作数(exit 0、零改动),
//   补丁内容必须经 stdin 喂入(与 patch-package 的做法一致)。
// - BSD patch 对"已应用"的补丁正/反向 dry-run 都退出 0(反向还会交互
//   提问),退出码不可信,幂等判定改用内容指纹(见 isApplied)。
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const upstream = JSON.parse(readFileSync(resolve(repoRoot, 'upstream.json'), 'utf8'))

// 补丁文件名 → 上游包名。app-builder-lib、dshmarket、open 是注册表依赖,
// 由 pnpm-workspace.yaml 的 patchedDependencies 处理,不在此列。
// 官方 Models 设置面已由 Desktop Profile 禁用，旧的模型编辑器补丁不再应用。
// dsh-web-app 补丁原含的 cordis.patch.yml 段已被上游提交吸收
// (openBrowser: false),该过时段会使 BSD patch 跳过整个补丁并连带
// lib/index.js 段永不落盘,已从补丁中剥离。
const PATCH_MANIFEST = {
  'dsh@0.1.1-rc.2.patch': '@deepseek-ai/dsh',
  'dsh-agent-loop@0.1.1-rc.2.patch': '@deepseek-ai/dsh-agent-loop',
  'dsh-app-boot@0.1.1-rc.2.patch': '@deepseek-ai/dsh-app-boot',
  'dsh-client-ui-attachment@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-ui-attachment',
  'dsh-client-ui-conversation@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-ui-conversation',
  'dsh-client-ui-directory-picker-browse@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  '@deepseek-ai-dsh-client-ui-settings-general-npm-0.1.1-rc.2-ef120ba0cf.patch': '@deepseek-ai/dsh-client-ui-settings-general',
  'dsh-client-ui-workspace@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-ui-workspace',
  'dsh-host-directory-picker-browse@0.1.1-rc.2.patch': '@deepseek-ai/dsh-host-directory-picker-browse',
  'dsh-llm-deepseek@0.1.1-rc.2.patch': '@deepseek-ai/dsh-llm-deepseek',
  'dsh-win32-process@0.1.2-alpha.1.patch': '@deepseek-ai/dsh-win32-process',
  'dsh-subprocess-local@0.1.1-rc.2.patch': '@deepseek-ai/dsh-subprocess-local',
  'dsh-token-meter@0.1.1-rc.2.patch': '@deepseek-ai/dsh-token-meter',
  'dsh-web-app@0.1.1-rc.2.patch': '@deepseek-ai/dsh-web-app',
}

/** 解析补丁中每个目标文件的新增行(去掉前导 +)。 */
function parsePatchAddedLines(patchText) {
  const files = []
  let current = null
  for (const line of patchText.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).split('\t')[0].trim()
      current = target === '/dev/null' ? null : { path: target.replace(/^b\//, ''), added: [] }
      if (current) files.push(current)
    } else if (current !== null && line.startsWith('+')) {
      current.added.push(line.slice(1))
    }
  }
  return files
}

/** 补丁的全部新增行都已出现在目标产物中 → 视为已应用。 */
function isApplied(patchText, packageDir) {
  const files = parsePatchAddedLines(patchText)
  if (files.length === 0) return false
  return files.every((file) => {
    if (file.added.length === 0) return false
    let content
    try {
      content = readFileSync(resolve(packageDir, file.path), 'utf8')
    } catch {
      return false
    }
    return file.added.every((addedLine) => content.includes(addedLine))
  })
}

/** 干跑检查补丁能否干净应用(pristine 产物上)。 */
function checkPatch(patchText, packageDir) {
  const result = spawnSync('patch', ['-p1', '-s', '-f', '-F0', '-V', 'none', '-r', '/dev/null', '--dry-run', '-d', packageDir], {
    input: patchText,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return result.status === 0 && result.stdout.length === 0 && result.stderr.length === 0
}

/** Apply one patch without allowing BSD patch to prompt or leave reject artifacts. */
function applyPatch(patchText, packageDir) {
  const result = spawnSync('patch', ['-p1', '-s', '-f', '-F0', '-V', 'none', '-r', '/dev/null', '-d', packageDir], {
    input: patchText,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return result.status === 0 && result.stdout.length === 0 && result.stderr.length === 0
}

function discoverWorkspacePackages(workspaceRoot) {
  const packages = new Map()
  const pending = [workspaceRoot]
  while (pending.length > 0) {
    const directory = pending.pop()
    const entries = readdirSync(directory, { withFileTypes: true })
    const manifestEntry = entries.find((entry) => entry.isFile() && entry.name === 'package.json')
    if (directory !== workspaceRoot && manifestEntry !== undefined) {
      const manifest = JSON.parse(readFileSync(resolve(directory, manifestEntry.name), 'utf8'))
      if (typeof manifest.name === 'string') packages.set(manifest.name, directory)
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !['.git', 'node_modules', 'lib', 'dist'].includes(entry.name)) {
        pending.push(resolve(directory, entry.name))
      }
    }
  }
  return packages
}

const upstreamRoot = resolve(repoRoot, upstream.localCheckout)
const workspacePackages = discoverWorkspacePackages(upstreamRoot)
let applied = 0
let skipped = 0
const conflicts = []
for (const [file, packageName] of Object.entries(PATCH_MANIFEST)) {
  let patchText = readFileSync(resolve(repoRoot, 'patches', file), 'utf8')
  const packageDir = workspacePackages.get(packageName)
  if (packageDir === undefined) {
    throw new Error(`apply-upstream-patches: cannot find ${packageName} in the pinned upstream checkout`)
  }
  const packageRelativePath = relative(upstreamRoot, packageDir)
  if (packageRelativePath.startsWith('..') || isAbsolute(packageRelativePath)) {
    throw new Error(`apply-upstream-patches: ${packageName} resolved outside ${upstream.localCheckout}: ${packageDir}`)
  }
  if (isApplied(patchText, packageDir)) {
    skipped += 1
    continue
  }
  if (!checkPatch(patchText, packageDir)) {
    conflicts.push(`${file} -> ${packageRelativePath}`)
    continue
  }
  if (!applyPatch(patchText, packageDir)) {
    conflicts.push(`${file} -> ${packageRelativePath}`)
    continue
  }
  applied += 1
}
if (conflicts.length > 0) {
  throw new Error(
    `apply-upstream-patches: ${String(conflicts.length)} patch(es) conflict with the pinned upstream:\n${conflicts.join('\n')}`,
  )
}
console.log(`apply-upstream-patches: ${String(applied)} applied, ${String(skipped)} already applied`)
