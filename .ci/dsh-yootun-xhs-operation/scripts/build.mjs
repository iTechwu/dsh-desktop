import { mkdir, readFile, writeFile } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const source = await readFile(new URL('src/client.js', root), 'utf8')
await mkdir(new URL('lib/', root), { recursive: true })
await writeFile(new URL('lib/client.js', root), ['window.__ModuleLoader__.load({','  id: "@dofe/dsh-yootun-xhs-operation",','  factory: (require) => {','    var module = { exports: {} };','    var exports = module.exports;',source.split('\n').map(line => line === '' ? '' : `    ${line}`).join('\n'),'    return module.exports;','  },','});',''].join('\n'))
