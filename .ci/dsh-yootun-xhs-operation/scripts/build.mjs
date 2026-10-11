// 客户端包构建：把 src/client.js 与其纯逻辑依赖 src/hotboard-ui.js（RQ-2026-003
// DEV-06）内联进 DSH 的 __ModuleLoader__ 工厂（该运行时只提供 CommonJS 风格
// require，不做模块解析）。
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const hotboardUiImport = /^import \{[\s\S]*?\} from '\.\/hotboard-ui\.js'\n/m

let source = await readFile(new URL('src/client.js', root), 'utf8')
if (!hotboardUiImport.test(source)) throw new Error('build: hotboard-ui import not found in client.js')
source = source.replace(hotboardUiImport, '')
const strip = text => text.replace(/^export (?=(function|const|let))/gm, '').trimEnd()
// hotboard-ui 顶部的 React require 与解构由构建剥离：内联后同一工厂作用域，
// React / createElement:h 由 client.js 顶部声明提供；hotboard-ui 正文中的
// HotReact.xxx hooks 引用统一重写为 React.xxx，不与 client.js 顶部解构的 const
// 绑定重复声明。
const hotboardUi = strip(
  (await readFile(new URL('src/hotboard-ui.js', root), 'utf8'))
    .replace(/^const HotReact = require\('react'\)\n/m, '')
    .replace(/^const \{ createElement: h \} = HotReact\n/m, '')
    .replace(/HotReact\./g, 'React.'),
)
const body = [hotboardUi, source.trimEnd()].join('\n\n')

await mkdir(new URL('lib/', root), { recursive: true })
await writeFile(new URL('lib/client.js', root), ['window.__ModuleLoader__.load({', '  id: "@dofe/dsh-yootun-xhs-operation",', '  factory: (require) => {', '    var module = { exports: {} };', '    var exports = module.exports;', body.split('\n').map(line => line === '' ? '' : `    ${line}`).join('\n'), '    return module.exports;', '  },', '});', ''].join('\n'))
