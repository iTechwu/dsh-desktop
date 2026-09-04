/**
 * Desktop profile 组合测试 + 打包闭包 / 凭证静态扫描。
 *
 * 静态验证本插件在 dsh-desktop 中的最终组合结果（阶段 7.3 / 7.4 / 7.5 / 8）：
 * - Desktop cordis.patch.yml 存在 TOS Loader 行，entry id 唯一，配置非敏感；
 * - 插件包从安装锚点（package.json 依赖 + .ci 快照 + 源码目录）可解析且一致；
 * - TOS 插件不会被误判为普通 Client UI 插件（无 dsh.client、不在 build-dofe-ui 清单）；
 * - profile 重建（prepare-dofe-ui.mjs）后快照仍存在；
 * - 打包闭包：快照与源码一致、无本地路径/CI 私有地址/明文凭证泄漏。
 *
 * 这些断言只读文件，零运行时依赖，可在 node --test 下运行。
 */

import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktopRoot = resolve(root, '../../../dsh-desktop')
const desktopPluginRoot = join(desktopRoot, 'dsh-plugin-desktop')

const PLUGIN_NAME = '@dofe/dsh-yootun-tos-upload'
const ENTRY_ID = 'dofe-yootun-tos-upload'

// 无 sibling dsh-desktop checkout（CI 快照场景）时整组跳过。
const desktopAvailable = existsSync(join(desktopPluginRoot, 'cordis.patch.yml'))
const t = desktopAvailable
  ? test
  : (name, fn) => test(name, { skip: 'sibling dsh-desktop checkout not present' }, fn)

async function readIf(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** 递归收集目录下所有文件（相对路径）。 */
async function collectFiles(dir, base = dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(base, entry.name)
    if (entry.isDirectory()) out.push(...await collectFiles(join(dir, entry.name), full))
    else out.push(full)
  }
  return out
}

// ---------- Desktop Loader 行 ----------

t('desktop patch carries a unique TOS loader row with non-sensitive config', async () => {
  const patch = await readIf(join(desktopPluginRoot, 'cordis.patch.yml'))
  assert.ok(patch, 'desktop cordis.patch.yml 必须存在')

  assert.ok(patch.includes(`id: ${ENTRY_ID}`), 'TOS Loader 行必须存在')
  assert.ok(patch.includes(`name: '${PLUGIN_NAME}'`), 'Loader 行必须指向插件包名')
  assert.ok(patch.includes('maxBytes: 524288000'))
  assert.ok(patch.includes('timeoutMs: 1800000'))

  // 凭证/拓扑卫生：desktop patch 不得携带 backend / 桶 / 地域 / key 前缀 / AK/SK。
  assert.doesNotMatch(patch, /backend:/u)
  assert.doesNotMatch(patch, /bucket:/u)
  assert.doesNotMatch(patch, /region:/u)
  assert.doesNotMatch(patch, /keyPrefix:/u)
  assert.doesNotMatch(patch, /accessKeyId:\s*\S+/u, 'desktop patch 不得写明文 AK')
  assert.doesNotMatch(patch, /accessKeySecret:\s*\S+/u, 'desktop patch 不得写明文 SK')
  assert.doesNotMatch(patch, /STORAGE_ACCESS_KEY_ID:\s*['"]?[A-Za-z0-9+/=]{8}/u)

  // entry id 全局唯一（insert 列表 + 顶层 id 都在同一命名空间）。
  const ids = [...patch.matchAll(/-\s*id:\s*([A-Za-z0-9._-]+)/g)].map((m) => m[1])
  const seen = new Set()
  for (const id of ids) {
    assert.equal(seen.has(id), false, `desktop patch 出现重复 loader entry id: ${id}`)
    seen.add(id)
  }
  assert.equal(ids.filter((id) => id === ENTRY_ID).length, 1, 'TOS entry id 必须且只能出现一次')
})

// ---------- 安装锚点与 profile 重建 ----------

t('plugin resolves from the desktop install anchor and is consistent', async () => {
  const manifest = JSON.parse(await readIf(join(desktopPluginRoot, 'package.json')))
  const dep = manifest.dependencies?.[PLUGIN_NAME]
  assert.equal(dep, 'file:../../docker-helm.dofe.ai/plugins/dsh-yootun-tos-upload', '依赖锚点必须指向唯一源码目录')

  // .ci 快照存在且 package manifest 与源码一致。
  const snapshot = join(desktopRoot, '.ci', 'dsh-yootun-tos-upload')
  const sourceManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const snapshotManifest = JSON.parse(await readFile(join(snapshot, 'package.json'), 'utf8'))
  assert.equal(snapshotManifest.name, sourceManifest.name)
  assert.equal(snapshotManifest.version, sourceManifest.version)
  assert.equal(snapshotManifest.main, sourceManifest.main)
  assert.equal(snapshotManifest.dsh.bundle.patch, './cordis.patch.yml')

  // 快照 patch 存在且 entry id 与源码一致。
  const snapshotPatch = await readIf(join(snapshot, 'cordis.patch.yml'))
  assert.ok(snapshotPatch?.includes(`id: ${ENTRY_ID}`), '快照 patch 的 entry id 必须与源码一致')
})

t('profile rebuild keeps the TOS plugin in the preinstall list', async () => {
  const prepare = await readIf(join(desktopRoot, 'scripts', 'prepare-dofe-ui.mjs'))
  assert.ok(prepare?.includes("'dsh-yootun-tos-upload'"), 'prepare-dofe-ui.mjs 必须包含 tos-upload')
})

t('TOS plugin is not misjudged as a Client UI plugin', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.dsh?.client, undefined, '纯宿主插件不得声明 dsh.client')

  // build-dofe-ui.mjs 只构建有 scripts/build.mjs 的客户端 UI 插件；tos-upload 不在其中。
  const buildUi = await readIf(join(desktopRoot, 'scripts', 'build-dofe-ui.mjs'))
  assert.ok(buildUi, 'build-dofe-ui.mjs 必须存在')
  assert.equal(buildUi.includes("'dsh-yootun-tos-upload'"), false, 'tos-upload 不属于 Client UI 构建清单')

  // 客户端半是空壳，不参与 web 打包。
  const client = await readIf(join(root, 'lib', 'client.js'))
  assert.ok(client, 'lib/client.js 空壳客户端半必须存在')
  assert.doesNotMatch(client, /window|document|import\(/, '客户端半不得引入 web 运行时')
})

// ---------- 打包闭包与凭证静态扫描 ----------

t('snapshot is a byte-identical copy of the tracked source', async () => {
  const snapshot = join(desktopRoot, '.ci', 'dsh-yootun-tos-upload')
  for (const file of await collectFiles(snapshot)) {
    const relative = file.slice(snapshot.length + 1)
    const sourceFile = join(root, relative)
    assert.ok(existsSync(sourceFile), `快照包含源码没有的文件: ${relative}`)
    const sourceText = await readFile(sourceFile)
    const snapshotText = await readFile(file)
    assert.ok(sourceText.equals(snapshotText), `快照与源码不一致: ${relative}`)
  }
  // 反向：源码里的关键文件必须在快照里。
  for (const file of ['index.js', 'config.js', 'authorize.js', 'lib/errors.js', 'drivers/tos.js', 'cordis.patch.yml', 'package.json']) {
    assert.ok(existsSync(join(snapshot, file)), `快照缺少关键文件: ${file}`)
  }
  // SigV4 签名器已删除，快照里也不得残留。
  assert.equal(existsSync(join(snapshot, 'drivers/tos-signer.js')), false, '快照不得残留已删除的 tos-signer.js')
})

t('shipped files never embed local paths, CI private addresses, or secrets', async () => {
  const shippedDirs = [root, join(desktopRoot, '.ci', 'dsh-yootun-tos-upload')]
  const patterns = [
    [/\b172\.30\.30\.11\b/, 'CI 私有维护地址'],
    [/\/home\/ubuntu\//, '本机绝对路径'],
    [/\/Users\/[a-zA-Z0-9._-]+\//, 'macOS 用户路径'],
    [/C:\\Users\\/, 'Windows 用户路径'],
  ]
  const secretPatterns = [
    [/STORAGE_ACCESS_KEY_ID\s*=\s*['"]?[A-Za-z0-9+/]{16,}/, '明文 AK 值'],
    [/STORAGE_ACCESS_KEY_SECRET\s*=\s*['"]?[A-Za-z0-9+/]{16,}/, '明文 SK 值'],
    [/AKIA[0-9A-Z]{16}/, 'AWS 风格明文 Access Key'],
  ]
  for (const dir of shippedDirs) {
    for (const file of await collectFiles(dir)) {
      if (file.endsWith('.test.mjs') || file.endsWith('.md') || file.endsWith('README.md')) continue
      const text = await readFile(file, 'utf8')
      for (const [pattern, label] of patterns) {
        assert.doesNotMatch(text, pattern, `${file} 泄漏${label}`)
      }
      for (const [pattern, label] of secretPatterns) {
        assert.doesNotMatch(text, pattern, `${file} 泄漏${label}`)
      }
    }
  }
})

t('index.js never accesses ctx.config and uses ctx.get for optional services', async () => {
  const index = await readFile(join(root, 'index.js'), 'utf8')
  assert.doesNotMatch(index, /ctx\.config/, '不得访问 ctx.config（真实 Cordis 会抛 without inject）')
  assert.doesNotMatch(index, /ctx\.credentials\b/, '不得直接访问 ctx.credentials')
  assert.doesNotMatch(index, /ctx\.systemPrompt\b/, '不得直接访问 ctx.systemPrompt')
  assert.doesNotMatch(index, /ctx\.get\?\.\(['"]credentials['"]\)/, '插件不再读取 credential store（凭证在 Tools 服务侧）')
  assert.match(index, /ctx\.get\?\.\(['"]systemPrompt['"]\)/, 'systemPrompt 必须走 ctx.get()')
  assert.match(index, /apply\(ctx, config = \{\}/, 'apply 第二参数是 Loader 行 config')
})
