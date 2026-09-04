import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { YOOTUN_AUDIT_ACTIONS } from '../src/yootun-audit-contract.ts'

const packageRoot = resolve(import.meta.dirname, '..')
const workspaceRoot = resolve(packageRoot, '..')
const dockerPluginRoot = resolve(workspaceRoot, '../docker-helm.dofe.ai/plugins')

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.js', '.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

describe('Yootun audit release closure', () => {
  it('packages the audit client and removes the central approval surface', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const patch = readFileSync(join(packageRoot, 'cordis.patch.yml'), 'utf8')

    expect(manifest.dependencies).toHaveProperty('@dofe/dsh-yootun-audit')
    expect(manifest.dependencies).not.toHaveProperty('@dofe/dsh-yootun-approvals')
    expect(patch).toContain("name: '@dofe/dsh-yootun-audit'")
    expect(patch).not.toContain('dsh-yootun-approvals')
    expect(existsSync(join(packageRoot, 'src/yootun-approvals-route.ts'))).toBe(false)
  })

  it('keeps every cataloged write collector connected to an owned host source', () => {
    const roots = [join(packageRoot, 'src'), dockerPluginRoot]
    const allOwnedHostSource = roots.flatMap(sourceFiles)
      .map(path => readFileSync(path, 'utf8'))
      .join('\n')

    for (const actionCode of Object.keys(YOOTUN_AUDIT_ACTIONS)) {
      expect(allOwnedHostSource, actionCode).toContain(actionCode)
    }
    expect(allOwnedHostSource).not.toMatch(/\/api\/desktop\/yootun\/approvals|awaiting_confirmation.*统一审批/u)
  })
})
