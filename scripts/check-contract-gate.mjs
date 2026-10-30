/**
 * Local contract gate.
 *
 * GitHub CI catches plugin contract drift (a host tool that is missing from
 * the capability matrix, a stale `.ci/<plugin>` snapshot), but only after the
 * commit is published and a runner has picked it up. Both checks below are
 * dependency-free — plain `node`, no install, no build — and finish in
 * seconds, so they belong in the local loop before a push.
 *
 * Usage:
 *   node scripts/check-contract-gate.mjs
 *   pnpm check:contract
 *
 * Skipped inputs are reported explicitly: the UX audit needs the sibling
 * Harness checkout, and the snapshot check needs the sibling plugin source
 * repository. A skip is never silent.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function run(label, script, requiredPaths) {
  const missing = requiredPaths.filter(path => !existsSync(path))
  if (missing.length > 0) {
    console.log(`[contract-gate] 跳过「${label}」：缺少 ${missing.join('、')}`)
    return true
  }
  console.log(`[contract-gate] 执行「${label}」…`)
  const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`[contract-gate] 「${label}」未通过（退出码 ${result.status ?? 'null'}）。`)
    return false
  }
  return true
}

const checks = [
  run('插件 UX 契约审计', 'scripts/plugin-ux-audit.mjs', [
    resolve(root, 'deepseek-harness/packages/client/ui-theme'),
  ]),
  run('插件快照一致性', 'scripts/sync-dofe-plugin-snapshot.mjs', [
    resolve(root, '../docker-helm.dofe.ai/plugins'),
  ]),
]

if (checks.some(ok => !ok)) {
  console.error('[contract-gate] 本地契约门禁未通过，修复后再推送。')
  process.exit(1)
}
console.log('[contract-gate] 本地契约门禁通过。')
