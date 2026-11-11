// 客户端包构建：把 src/client.js 与其纯逻辑依赖（ui-format / work-ui / account-ui）
// 内联进 DSH 的 __ModuleLoader__ 工厂（该运行时只提供 CommonJS 风格 require，不做
// 模块解析）。模块顺序：ui-format → work-ui → account-ui → client.js（先于引用者）。
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

const stripBlock = (source, pattern, label) => {
  if (!pattern.test(source)) throw new Error(`build: ${label} import not found in client.js`)
  return source.replace(pattern, '')
}

let source = await readFile(new URL('src/client.js', root), 'utf8')
const uiFormatImport = /^import \{[\s\S]*?\} from '\.\/ui-format\.js'\n/m
const workUiImport = /^import \{[\s\S]*?\} from '\.\/work-ui\.js'\n/m
const accountUiImport = /^import \{[\s\S]*?\} from '\.\/account-ui\.js'\n/m
source = stripBlock(source, uiFormatImport, 'ui-format')
source = stripBlock(source, workUiImport, 'work-ui')
source = stripBlock(source, accountUiImport, 'account-ui')

// client.js 本体顶部的 React require 与解构保留（同 xhs 约定）：factory 内
// require('react') 与 require('@deepseek-ai/dsh-client-ui-primitives') 由宿主
// 加载器解析，不剥源码行。

const strip = text => text.replace(/^export (?=(function|const|let))/gm, '').trimEnd()

// 子模块同样剥除 React require 与 react import（内联后同一工厂作用域，h/React 由
// client.js 提供）。
const loadModule = async (file, label) => {
  let text = await readFile(new URL(`src/${file}`, root), 'utf8')
  text = text
    .replace(/^import \{[\s\S]*?\} from '\.\/ui-format\.js'\n/m, '')
    // account-ui 复用 work-ui 的 TrendChart/recentDays（内联顺序 work-ui 在前）。
    .replace(/^import \{[\s\S]*?\} from '\.\/work-ui\.js'\n/m, '')
    .replace(/^import \{[\s\S]*?\} from 'react'\n/m, '')
    .replace(/^const React = require\('react'\)\n/m, '')
    .replace(/^const \{ createElement: h \} = React\n/m, '')
  // @deepseek-ai/dsh-client-ui-primitives 的 require 保留（宿主运行时注入器解析，
  // 与抖音构建约定一致）。
  if (/require\((?!'@deepseek-ai\/dsh-client-ui-primitives')/.test(text)) {
    throw new Error(`build: unexpected require in ${label}`)
  }
  if (/^\s*import\s/m.test(text)) throw new Error(`build: unexpected import in ${label}`)
  return strip(text)
}

const uiFormat = await loadModule('ui-format.js', 'ui-format')
const workUi = await loadModule('work-ui.js', 'work-ui')
const accountUi = await loadModule('account-ui.js', 'account-ui')

// 内联顺序：ui-format → work-ui → account-ui → client.js（先于引用者，
// 同一工厂作用域；React/h 由 client.js 顶部声明提供）。
const body = [uiFormat, workUi, accountUi, strip(source)].join('\n\n')

await mkdir(new URL('lib/', root), { recursive: true })
// 产物 API 对齐当前桌面端加载器（同 xhs/douyin 插件）：__ModuleLoader__.load({ id, factory })，
// id 不带 /client 后缀；factory 内自建 module/exports 兼容 CJS 风格源码，
// return module.exports 即插件导出面。
await writeFile(new URL('lib/client.js', root), [
  'window.__ModuleLoader__.load({',
  '  id: "@dofe/dsh-yootun-wx-channels-operation",',
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  body.split('\n').map(line => line === '' ? '' : `    ${line}`).join('\n'),
  '    return module.exports;',
  '  },',
  '});',
  '',
].join('\n'))
console.log('build: lib/client.js written')
