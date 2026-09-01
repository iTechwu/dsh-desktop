/** Build sibling Yootun/DoFe Client plugins before Desktop packaging. */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const plugins = ['dsh-yootun-ui', 'dsh-yootun-dashboard']
for (const name of plugins) {
  const plugin = resolve(root, `../docker-helm.dofe.ai/plugins/${name}`)
  if (!existsSync(resolve(plugin, 'package.json'))) {
    throw new Error(`build-dofe-ui: sibling plugin is missing at ${plugin}`)
  }
  execFileSync(process.execPath, [resolve(plugin, 'scripts/build.mjs')], {
    cwd: plugin,
    stdio: 'inherit',
  })
}
