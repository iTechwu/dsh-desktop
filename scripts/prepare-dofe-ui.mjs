/** Materialize privately owned sibling UI plugins for reproducible builds. */
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const preinstalledPlugins = [
  'dsh-geoflow-mcp',
  'dsh-georank-mcp',
  'dsh-opencli',
  'dsh-plugin-console',
  'dsh-tools-mcp',
  'dsh-yootun-ui',
  'dsh-yootun-dashboard',
  'dsh-yootun-recruiter',
  'dsh-yootun-sales',
  'dsh-yootun-supply-watch',
  'dsh-yootun-content-command',
  'dsh-yootun-knowledge',
  'dsh-yootun-approvals',
  'dsh-yootun-finops',
  'dsh-yootun-retrofit',
  'dsh-yootun-daily-report',
  'dsh-yootun-lead-discovery',
  'dsh-yootun-tos-upload',
  'dsh-yootun-xhs-operation',
]
for (const name of preinstalledPlugins) {
  const sibling = resolve(root, `../docker-helm.dofe.ai/plugins/${name}`)
  const snapshot = resolve(root, `.ci/${name}`)
  if (existsSync(resolve(sibling, 'package.json'))) {
    console.log(`dofe-ui: using sibling plugin at ${sibling}`)
  } else {
    await mkdir(dirname(sibling), { recursive: true })
    await rm(sibling, { recursive: true, force: true })
    await cp(snapshot, sibling, { recursive: true })
    console.log(`dofe-ui: materialized build snapshot at ${sibling}`)
  }
}
