/** Build the sibling Yootun/DoFe Client plugin before Desktop packaging. */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const plugin = resolve(root, '../docker-helm.dofe.ai/plugins/dsh-yootun-ui')
if (!existsSync(resolve(plugin, 'package.json'))) {
  throw new Error(`build-dofe-ui: sibling plugin is missing at ${plugin}`)
}
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: plugin,
  stdio: 'inherit',
})
