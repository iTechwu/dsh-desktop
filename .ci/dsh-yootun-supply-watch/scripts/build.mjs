import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(resolve(root, 'src/client.js'), 'utf8')
await mkdir(resolve(root, 'lib'), { recursive: true })
const id = '@dofe/dsh-yootun-supply-watch'
const output = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(id)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${source.split('\n').map(line => `    ${line}`).join('\n')}\n    exports.apply = apply\n    exports.inject = ['slots', 'locale']\n    return module.exports;\n  },\n});\n`
await writeFile(resolve(root, 'lib/client.js'), output)
