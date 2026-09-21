// 客户端包构建：把 src/client.js 与其纯逻辑依赖 src/ui-format.js、src/overview-ui.js、
// src/analysis-ui.js 内联进 DSH 的 __ModuleLoader__ 工厂（该运行时只提供 CommonJS 风格
// require，不做模块解析）。
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const uiFormatImport = /^import \{[\s\S]*?\} from '\.\/ui-format\.js'\n/m
const overviewUiImport = /^import \{[\s\S]*?\} from '\.\/overview-ui\.js'\n/m
const analysisUiImport = /^import \{[\s\S]*?\} from '\.\/analysis-ui\.js'\n/m
const selectUiImport = /^import \{ FilterSelect \} from '\.\/select-ui\.js'\n/m

let source = await readFile(new URL('src/client.js', root), 'utf8')
if (!uiFormatImport.test(source)) throw new Error('build: ui-format import not found in client.js')
source = source.replace(uiFormatImport, '')
if (!overviewUiImport.test(source)) throw new Error('build: overview-ui import not found in client.js')
source = source.replace(overviewUiImport, '')
if (!analysisUiImport.test(source)) throw new Error('build: analysis-ui import not found in client.js')
source = source.replace(analysisUiImport, '')
const strip = text => text.replace(/^export (?=(function|const|let))/gm, '').trimEnd()
// overview-ui / analysis-ui 对 ui-format 纯函数（basisLines/formatDateTime 等）的 import
// 同样剥离：ui-format 先内联，内联后同一工厂作用域，标识符直接可见。
const stripUiFormatImport = (text, file) => {
  if (!uiFormatImport.test(text)) throw new Error(`build: ui-format import not found in ${file}`)
  return text.replace(uiFormatImport, '')
}
// overview-ui / analysis-ui 对 UI primitives 的解构 require 同样剥离：图标绑定集中在
// client.js 顶部解构（内联后同一工厂作用域），UI 模块源码里的 require 只作显式依赖
// 声明。新增图标必须同步加进 client.js:15 的解构，否则内联后 ReferenceError。
const stripUiPrimitivesRequire = text =>
  text.replace(/^const \{ [\w, ]+ \} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)\n/m, '')
const uiFormat = strip(await readFile(new URL('src/ui-format.js', root), 'utf8'))
const selectUi = strip(await readFile(new URL('src/select-ui.js', root), 'utf8'))
// overview-ui 里的 React require 与 client.js 重复（内联后同一工厂作用域）：剥离，
// React / createElement:h 由 client.js 顶部的声明提供。
const overviewUi = strip(
  stripUiPrimitivesRequire(
    stripUiFormatImport(await readFile(new URL('src/overview-ui.js', root), 'utf8'), 'overview-ui.js')
      .replace(selectUiImport, '')
      .replace(/^const React = require\('react'\)\n/m, '')
      .replace(/^const \{ createElement: h \} = React\n/m, ''),
  ),
)
// analysis-ui 的 React 获取是惰性 let（不与 client.js 的 const React 冲突），原样内联。
const analysisUi = strip(
  stripUiPrimitivesRequire(
    stripUiFormatImport(await readFile(new URL('src/analysis-ui.js', root), 'utf8'), 'analysis-ui.js').replace(selectUiImport, ''),
  ),
)
const body = [uiFormat, selectUi, overviewUi, analysisUi, source.trimEnd()].join('\n\n')

await mkdir(new URL('lib/', root), { recursive: true })
await writeFile(new URL('lib/client.js', root), ['window.__ModuleLoader__.load({', '  id: "@dofe/dsh-yootun-douyin-operation",', '  factory: (require) => {', '    var module = { exports: {} };', '    var exports = module.exports;', body.split('\n').map(line => line === '' ? '' : `    ${line}`).join('\n'), '    return module.exports;', '  },', '});', ''].join('\n'))
