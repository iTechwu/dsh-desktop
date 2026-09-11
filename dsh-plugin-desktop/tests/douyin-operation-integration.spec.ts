// 抖音运营接入的联动登记：Desktop manifest、cordis patch、CI snapshot、
// managed MCP client、host route 与能力矩阵必须同时到位，任何一处漏登记都要失败。
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const workspaceRoot = resolve(packageRoot, '..')
const pluginName = 'dsh-yootun-douyin-operation'
const packageName = `@dofe/${pluginName}`
const snapshotRoot = join(workspaceRoot, `.ci/${pluginName}`)
const read = (path: string) => readFileSync(path, 'utf8')

describe('Douyin operation Desktop integration', () => {
  it('declares the plugin as a production file dependency', () => {
    const manifest = JSON.parse(read(join(packageRoot, 'package.json'))) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.[packageName])
      .toBe(`file:../../docker-helm.dofe.ai/plugins/${pluginName}`)
  })

  it('registers the plugin tree entry with the bundle id', () => {
    const patch = read(join(packageRoot, 'cordis.patch.yml'))
    expect(patch).toContain('id: dofe-yootun-douyin-operation')
    expect(patch).toContain(`name: '${packageName}'`)
    const pluginPatch = read(join(snapshotRoot, 'cordis.patch.yml'))
    expect(pluginPatch).toContain('id: dofe-yootun-douyin-operation')
    expect(pluginPatch).toContain(`name: '${packageName}'`)
  })

  it('ships a snapshot that matches the tracked source and stays dependency-free', () => {
    const manifest = JSON.parse(read(join(snapshotRoot, 'package.json'))) as {
      name: string
      main: string
      dependencies?: Record<string, string>
    }
    expect(manifest.name).toBe(packageName)
    expect(manifest.main).toBe('./index.js')
    for (const file of ['index.js', 'src/client.js', 'lib/client.js', 'cordis.patch.yml']) {
      expect(existsSync(join(snapshotRoot, file)), `snapshot 缺少 ${file}`).toBe(true)
    }
    expect(existsSync(join(snapshotRoot, 'node_modules'))).toBe(false)
    // 生产依赖必须由 dsh-desktop 自己的 lockfile 解析，而不是依赖快照里的本地安装。
    expect(manifest.dependencies?.['playwright-core']).toMatch(/^\^1\.6\d/u)

    const verification = spawnSync(
      process.execPath,
      ['scripts/sync-dofe-plugin-snapshot.mjs', pluginName],
      { cwd: workspaceRoot, encoding: 'utf8' },
    )
    expect(verification.status, `${verification.stdout}\n${verification.stderr}`).toBe(0)
    expect(verification.stdout).toContain('matches source')
  })

  it('runs the snapshot client compatibility suite', () => {
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-reporter=tap', join(snapshotRoot, 'test/desktop-compat.test.mjs'), join(snapshotRoot, 'test/plugin.test.mjs'), join(snapshotRoot, 'test/ui.test.mjs')],
      { cwd: packageRoot, encoding: 'utf8' },
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('# fail 0')
  })

  it('registers the managed MCP client against the public gateway route', () => {
    const managed = read(join(packageRoot, 'src/dofe-managed.ts'))
    expect(managed).toContain("'douyin-operation',")
    expect(managed).toContain('path: `tools/${path}`')
    expect(managed).toContain("export const DOFE_MCP_BASE_URL = 'https://ixicai.cn/mcp'")
    // 只允许通过公共网关访问，不得把 CI 地址或第三方端点写进客户端。
    expect(managed).not.toMatch(/172\.30\.30\.11|localhost|127\.0\.0\.1/u)
  })

  it('keeps the host route and capability matrix row in sync', () => {
    const matrix = read(resolve(workspaceRoot, 'docs/superpowers/specs/2026-09-09-mcp-api-capability-matrix.md'))
    expect(matrix).toContain('/api/desktop/yootun/douyin-operation')
    expect(matrix).toContain('| `tools-douyin-operation` | `/mcp/tools/douyin-operation` | 60s | tools |')
    expect(matrix).toMatch(/douyin-operation.*awaiting_confirmation、confirmed_pending_adapter、cleanup_failed/u)

    const client = read(join(snapshotRoot, 'src/client.js'))
    expect(client).toContain("const PATH = '/api/desktop/yootun/douyin-operation'")
    expect(client).not.toMatch(/https?:\/\/(?!www\.douyin\.com)/u)
    expect(client).not.toMatch(/MODELS_API_KEY|storage_state\s*[:=]|vault:\/\//u)
  })

  it('keeps the build, preinstall and UX audit registrations wired', () => {
    expect(read(join(workspaceRoot, 'scripts/prepare-dofe-ui.mjs'))).toContain(`'${pluginName}',`)
    expect(read(join(workspaceRoot, 'scripts/build-dofe-ui.mjs'))).toContain(`'${pluginName}',`)

    const audit = read(join(workspaceRoot, 'scripts/plugin-ux-audit.mjs'))
    const lifecycleBlock = audit.slice(audit.indexOf('actionLifecyclePlugins'), audit.indexOf('actionLifecyclePlugins') + 400)
    expect(lifecycleBlock).toContain(`'${pluginName}'`)
    expect(audit).toContain(`${pluginName}': 'ydo-'`)

    const entries = readdirSync(snapshotRoot)
    expect(entries).not.toContain('node_modules')
  })
})
