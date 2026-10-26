// 客户端包构建：把 src/client.js 与其纯逻辑依赖 src/ui-format.js、src/overview-ui.js、
// src/analysis-ui.js、src/breakdown.js 内联进 DSH 的 __ModuleLoader__ 工厂（该运行时
// 只提供 CommonJS 风格 require，不做模块解析）。
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const uiFormatImport = /^import \{[\s\S]*?\} from '\.\/ui-format\.js'\n/m
const overviewUiImport = /^import \{[\s\S]*?\} from '\.\/overview-ui\.js'\n/m
const analysisUiImport = /^import \{[\s\S]*?\} from '\.\/analysis-ui\.js'\n/m
const breakdownUiImport = /^import \{[\s\S]*?\} from '\.\/breakdown\.js'\n/m
// RQ-2026-006：report-ui（AI 报表 Tab）同法内联（先于引用它的 client.js）。
const reportUiImport = /^import \{[\s\S]*?\} from '\.\/report-ui\.js'\n/m
// 1015 阶段 3：trend-chart 共享模块（作品详情弹框与 analysis-ui 复用同一趋势绘制），
// 与 ui-format 同法内联（先于引用它的 analysis-ui / client.js）。
const trendChartImport = /^import \{[^}]*\} from '\.\/trend-chart\.js'\n/m
const selectUiImport = /^import \{ FilterSelect \} from '\.\/select-ui\.js'\n/m

let source = await readFile(new URL('src/client.js', root), 'utf8')
if (!uiFormatImport.test(source)) throw new Error('build: ui-format import not found in client.js')
source = source.replace(uiFormatImport, '')
if (!overviewUiImport.test(source)) throw new Error('build: overview-ui import not found in client.js')
source = source.replace(overviewUiImport, '')
if (!analysisUiImport.test(source)) throw new Error('build: analysis-ui import not found in client.js')
source = source.replace(analysisUiImport, '')
if (!breakdownUiImport.test(source)) throw new Error('build: breakdown import not found in client.js')
source = source.replace(breakdownUiImport, '')
if (!reportUiImport.test(source)) throw new Error('build: report-ui import not found in client.js')
source = source.replace(reportUiImport, '')
if (!trendChartImport.test(source)) throw new Error('build: trend-chart import not found in client.js')
source = source.replace(trendChartImport, '')
const strip = text => text.replace(/^export (?=(function|const|let))/gm, '').trimEnd()
// overview-ui / analysis-ui / breakdown 对 ui-format 纯函数（basisLines/formatDateTime 等）
// 的 import 同样剥离：ui-format 先内联，内联后同一工厂作用域，标识符直接可见。
const stripUiFormatImport = (text, file) => {
  if (!uiFormatImport.test(text)) throw new Error(`build: ui-format import not found in ${file}`)
  return text.replace(uiFormatImport, '')
}
// overview-ui / analysis-ui / breakdown 对 UI primitives 的解构 require 同样剥离：
// 图标绑定集中在 client.js 顶部解构（内联后同一工厂作用域），UI 模块源码里的
// require 只作显式依赖声明。新增图标必须同步加进 client.js 的解构，否则内联后
// ReferenceError。
const stripUiPrimitivesRequire = text =>
  text.replace(/^const \{ [\w, ]+ \} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)\n/m, '')
const uiFormat = strip(await readFile(new URL('src/ui-format.js', root), 'utf8'))
const selectUi = strip(await readFile(new URL('src/select-ui.js', root), 'utf8'))
// overview-ui / breakdown 里的 React require 与 client.js 重复（内联后同一工厂作用域）：
// 剥离，React / createElement:h 由 client.js 顶部的声明提供；breakdown 的 hooks 以
// React.xxx 形式使用，不与 client.js 顶部解构的 const 绑定重复声明。
const stripOverviewStyleReact = text =>
  text
    .replace(/^const React = require\('react'\)\n/m, '')
    .replace(/^const \{ createElement: h \} = React\n/m, '')
const overviewUi = strip(
  stripUiPrimitivesRequire(
    stripOverviewStyleReact(
      stripUiFormatImport(await readFile(new URL('src/overview-ui.js', root), 'utf8'), 'overview-ui.js')
        .replace(selectUiImport, ''),
    ),
  ),
)
// analysis-ui 的 React 获取是惰性 let（不与 client.js 的 const React 冲突），原样内联。
const analysisUi = strip(
  stripUiPrimitivesRequire(
    stripUiFormatImport(await readFile(new URL('src/analysis-ui.js', root), 'utf8'), 'analysis-ui.js').replace(selectUiImport, '')
      .replace(trendChartImport, ''),
  ),
)
// breakdown 与 overview-ui 同法（顶部 const React + 解构 h，hooks 走 React.xxx）。
const breakdownUi = strip(
  stripUiPrimitivesRequire(
    stripOverviewStyleReact(
      stripUiFormatImport(await readFile(new URL('src/breakdown.js', root), 'utf8'), 'breakdown.js')
        .replace(selectUiImport, ''),
    ),
  ),
)
const trendChart = strip(await readFile(new URL('src/trend-chart.js', root), 'utf8'))
// report-ui 与 overview-ui 同法（顶部 const React + 解构 h；无 ui-format 依赖——
// 报表的格式化函数自包含在 report-ui.js，避免与 ui-format 同名导出混淆）。
const reportUi = strip(
  stripUiPrimitivesRequire(
    stripOverviewStyleReact(
      await readFile(new URL('src/report-ui.js', root), 'utf8'),
    ),
  ),
)
const body = [uiFormat, selectUi, trendChart, overviewUi, analysisUi, breakdownUi, reportUi, source.trimEnd()].join('\n\n')

await mkdir(new URL('lib/', root), { recursive: true })
await writeFile(new URL('lib/client.js', root), ['window.__ModuleLoader__.load({', '  id: "@dofe/dsh-yootun-douyin-operation",', '  factory: (require) => {', '    var module = { exports: {} };', '    var exports = module.exports;', body.split('\n').map(line => line === '' ? '' : `    ${line}`).join('\n'), '    return module.exports;', '  },', '});', ''].join('\n'))
