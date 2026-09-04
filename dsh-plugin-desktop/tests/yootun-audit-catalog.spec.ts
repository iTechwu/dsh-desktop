import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { YOOTUN_AUDIT_ACTIONS } from '../src/yootun-audit-contract.ts'

const packageRoot = resolve(import.meta.dirname, '..')
const desktopSourceRoot = join(packageRoot, 'src')
const dockerPluginRoot = resolve(packageRoot, '../../docker-helm.dofe.ai/plugins')

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.js', '.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

describe('Yootun audit action catalog', () => {
  it('registers every literal action code used by Desktop and docker collectors', () => {
    const roots = [desktopSourceRoot, dockerPluginRoot]
    const used = roots.flatMap(sourceFiles).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return [...source.matchAll(/actionCode:\s*['"]([^'"]+)['"]/gu)]
        .flatMap(match => match[1] === undefined ? [] : [{ actionCode: match[1], path }])
    })

    expect(used.length).toBeGreaterThan(0)
    for (const use of used) {
      expect(YOOTUN_AUDIT_ACTIONS, `${use.actionCode} in ${use.path}`).toHaveProperty(use.actionCode)
    }
  })

  it.each([
    ['yootun-sales-route.ts', 'intent_search'],
    ['yootun-recruiter-route.ts', 'sync_preview'],
    ['yootun-recruiter-route.ts', 'open_boss_login'],
    ['yootun-content-command-route.ts', 'open_platform'],
  ])('keeps read-only action %s/%s outside the audit catalog', (_file, action) => {
    expect(Object.keys(YOOTUN_AUDIT_ACTIONS).some(code => code.includes(action))).toBe(false)
  })
})
