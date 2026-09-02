import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const source = await readFile(resolve(root, 'src/client.js'), 'utf8'); await mkdir(resolve(root, 'lib'), { recursive: true }); await writeFile(resolve(root, 'lib/client.js'), `window.__ModuleLoader__.load({\n  id: "@dofe/dsh-yootun-finops",\n  factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n${source.split('\n').map(line => `    ${line}`).join('\n')}\n    exports.apply = apply; exports.inject = ['slots', 'locale']; return module.exports; },\n});\n`)
