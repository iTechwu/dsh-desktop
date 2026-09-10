// 客户端包构建：把 src/client.js 与其纯逻辑依赖 src/ui-format.js 内联进 DSH 的
// __ModuleLoader__ 工厂（该运行时只提供 CommonJS 风格 require，不做模块解析）。
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const uiFormatImport = /^import \{[\s\S]*?\} from '\.\/ui-format\.js'\n/m

let source = await readFile(new URL('src/client.js', root), 'utf8')
if (!uiFormatImport.test(source)) throw new Error('build: ui-format import not found in client.js')
source = source.replace(uiFormatImport, '')
const uiFormat = (await readFile(new URL('src/ui-format.js', root), 'utf8'))
  .replace(/^export (?=(function|const|let))/gm, '')
  .trimEnd()
const body = [uiFormat, source.trimEnd()].join('\n\n')

await mkdir(new URL('lib/', root), { recursive: true })
await writeFile(new URL('lib/client.js', root), ['window.__ModuleLoader__.load({', '  id: "@dofe/dsh-yootun-douyin-operation",', '  factory: (require) => {', '    var module = { exports: {} };', '    var exports = module.exports;', body.split('\n').map(line => line === '' ? '' : `    ${line}`).join('\n'), '    return module.exports;', '  },', '});', ''].join('\n'))
