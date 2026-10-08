// 客户端构建：按序拼接 src 片段 → 品牌注入 → 包装为 ModuleLoader 浏览器模块。
// 各片段共享同一模块作用域（顶层 const 不能重名）；新增片段必须登记到 FILES。
import { brandClientSource } from '../../brand/build.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 拼接顺序即依赖顺序：head（依赖/字典/数据面）→ format → components → 样式 → 视图 → 外壳
const FILES = [
  'src/head.js',
  'src/format.js',
  'src/components.js',
  'src/styles.js',
  'src/views/overview.js',
  'src/views/budget.js',
  'src/views/operations.js',
  'src/views/cash.js',
  'src/views/alerts.js',
  'src/views/datacenter.js',
  'src/views/entry.js',
  'src/views/analyze.js',
  'src/shell.js',
]

const chunks = []
for (const file of FILES) chunks.push(await readFile(resolve(root, file), 'utf8'))
const source = brandClientSource(chunks.join('\n'))
await mkdir(resolve(root, 'lib'), { recursive: true })
const indented = source.split('\n').map(line => line ? `    ${line}` : '').join('\n')
await writeFile(resolve(root, 'lib/client.js'), `window.__ModuleLoader__.load({\n  id: "@dofe/dsh-sensteed-finance",\n  factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n${indented}\n    exports.apply = apply; exports.inject = ['slots', 'locale']; return module.exports; },\n});\n`)
