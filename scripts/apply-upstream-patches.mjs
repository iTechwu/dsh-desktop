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
import { spawnSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { realpathSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERATED_CSS_MODULE_PATCH,
  specializeGeneratedCssModulePatch,
} from './upstream-patch-specialization.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const upstream = JSON.parse(readFileSync(resolve(repoRoot, 'upstream.json'), 'utf8'))

// 补丁文件名 → 上游包名。app-builder-lib、dshmarket、open 是注册表依赖,
// 由 pnpm-workspace.yaml 的 patchedDependencies 处理,不在此列。
// patches/dsh-client-ui-settings-models@0.1.1-rc.2.patch 已被
// 5348824733 版本补丁取代(候选搜索特性已并入),不再应用。
// dsh-web-app 补丁原含的 cordis.patch.yml 段已被上游提交吸收
// (openBrowser: false),该过时段会使 BSD patch 跳过整个补丁并连带
// lib/index.js 段永不落盘,已从补丁中剥离。
const PATCH_MANIFEST = {
  'dsh@0.1.1-rc.2.patch': '@deepseek-ai/dsh',
  'dsh-agent-loop@0.1.1-rc.2.patch': '@deepseek-ai/dsh-agent-loop',
  'dsh-app-boot@0.1.1-rc.2.patch': '@deepseek-ai/dsh-app-boot',
  'dsh-client-runtime@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-runtime',
  'dsh-client-ui-conversation@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-ui-conversation',
  'dsh-client-ui-directory-picker-browse@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  '@deepseek-ai-dsh-client-ui-settings-general-npm-0.1.1-rc.2-ef120ba0cf.patch': '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai-dsh-client-ui-settings-models-npm-0.1.1-rc.2-5348824733.patch': '@deepseek-ai/dsh-client-ui-settings-models',
  'dsh-client-ui-trajectory@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-ui-trajectory',
  'dsh-client-ui-workspace@0.1.1-rc.2.patch': '@deepseek-ai/dsh-client-ui-workspace',
  'dsh-host-apiproxy-model-modalities@0.1.1-rc.2.patch': '@deepseek-ai/dsh-host-apiproxy',
  'dsh-host-directory-picker-browse@0.1.1-rc.2.patch': '@deepseek-ai/dsh-host-directory-picker-browse',
  'dsh-llm-deepseek@0.1.1-rc.2.patch': '@deepseek-ai/dsh-llm-deepseek',
  'dsh-sandbox-windows-acl@0.1.1-rc.2.patch': '@deepseek-ai/dsh-sandbox-windows-acl',
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
  const result = spawnSync('patch', ['-p1', '-s', '-F0', '--dry-run', '-d', packageDir], {
    input: patchText,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return result.status === 0
}

const require = createRequire(resolve(repoRoot, 'dsh-plugin-desktop/package.json'))
const upstreamRoot = resolve(repoRoot, upstream.localCheckout)
let applied = 0
let skipped = 0
for (const [file, packageName] of Object.entries(PATCH_MANIFEST)) {
  let patchText = readFileSync(resolve(repoRoot, 'patches', file), 'utf8')
  let packageDir
  try {
    packageDir = realpathSync(dirname(require.resolve(`${packageName}/package.json`)))
  } catch {
    throw new Error(`apply-upstream-patches: cannot resolve ${packageName}; run corepack pnpm install first`)
  }
  if (!packageDir.startsWith(`${upstreamRoot}/`)) {
    throw new Error(`apply-upstream-patches: ${packageName} resolved outside ${upstream.localCheckout}: ${packageDir}`)
  }
  if (file === GENERATED_CSS_MODULE_PATCH) {
    const targetText = readFileSync(resolve(packageDir, 'lib/client.js'), 'utf8')
    patchText = specializeGeneratedCssModulePatch(patchText, targetText)
  }
  if (isApplied(patchText, packageDir)) {
    skipped += 1
    continue
  }
  if (!checkPatch(patchText, packageDir)) {
    throw new Error(`apply-upstream-patches: ${file} conflicts with ${packageDir}; the pinned upstream may have absorbed or diverged from this patch`)
  }
  execFileSync('patch', ['-p1', '-s', '-F0', '-d', packageDir], {
    input: patchText,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  applied += 1
}
console.log(`apply-upstream-patches: ${String(applied)} applied, ${String(skipped)} already applied`)
