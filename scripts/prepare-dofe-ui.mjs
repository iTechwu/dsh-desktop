/** Materialize the privately owned sibling UI plugin for reproducible builds. */
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sibling = resolve(root, '../docker-helm.dofe.ai/plugins/dsh-yootun-ui')
const snapshot = resolve(root, '.ci/dsh-yootun-ui')

if (existsSync(resolve(sibling, 'package.json'))) {
  console.log(`dofe-ui: using sibling plugin at ${sibling}`)
} else {
  await mkdir(dirname(sibling), { recursive: true })
  await rm(sibling, { recursive: true, force: true })
  await cp(snapshot, sibling, { recursive: true })
  console.log(`dofe-ui: materialized build snapshot at ${sibling}`)
}
