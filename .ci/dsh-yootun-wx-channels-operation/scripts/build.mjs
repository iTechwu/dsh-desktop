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

// client.js 顶部宿主注入的 React require 由工厂模板统一提供，源码行剥除。
source = source
  .replace(/^const React = require\('react'\)\n/m, '')
  .replace(/^const \{ createElement: h \} = React\n/m, '')
  .replace(/^const \{ useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore \} = React\n/m, '')

const strip = text => text.replace(/^export (?=(function|const|let))/gm, '').trimEnd()

// 子模块同样剥除 React require 与 react import（内联后同一工厂作用域，h/React 由
// client.js 提供）。
const loadModule = async (file, label) => {
  let text = await readFile(new URL(`src/${file}`, root), 'utf8')
  text = text
    .replace(/^import \{[\s\S]*?\} from '\.\/ui-format\.js'\n/m, '')
    .replace(/^import \{ createElement as h \} from 'react'\n/m, '')
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

const body = strip(source)

const output = `// 构建产物（scripts/build.mjs 生成）：请勿手改。
__ModuleLoader__.register('@dofe/dsh-yootun-wx-channels-operation/client', function (require, module, exports) {
const React = require('react')
const { createElement: h, useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React
${uiFormat}

${workUi}

${accountUi}

${body}
module.exports = { renderWxWorkbench }
})
`

await mkdir(new URL('lib/', root), { recursive: true })
await writeFile(new URL('lib/client.js', root), output, 'utf8')
console.log('build: lib/client.js written')
