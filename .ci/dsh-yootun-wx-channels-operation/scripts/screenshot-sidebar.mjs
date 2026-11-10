// 侧栏入口截图：真实 SidebarButton 组件（构建产物）+ 模拟宿主左下角菜单
// （深色侧栏、按 order 排序的入口列表：内容指令 40 / 抖音 43 / 视频号 44 / 日报 50）。
// 输出：docs/1109/wx/screenshots/wx-ui-sidebar-entry.png

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const { resolveSystemChrome } = await import('../src/chrome.js')

const OUT = resolve(argValue('--out', resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/1109/wx/screenshots')))

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

await mkdir(OUT, { recursive: true })

const react = await import('react')
const React = react.default ?? react
const { renderToString } = await import('react-dom/server')
const { createElement: h } = React

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
let factory = null
globalThis.__ModuleLoader__ = { register(name, fn) { factory = fn } }
new Function('globalThis', source)(globalThis)
delete globalThis.__ModuleLoader__
const module_ = { exports: {} }
factory(name => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      IconSparkleRegular: ({ size }) => h('svg', {
        width: size || 18, height: size || 18, viewBox: '0 0 24 24', fill: 'currentColor',
        'aria-hidden': 'true',
      }, h('path', { d: 'M12 2c.3 0 .6.2.7.5l1.6 4.2 4.2 1.6c.6.2.6 1.1 0 1.4l-4.2 1.6-1.6 4.2c-.2.6-1.1.6-1.4 0l-1.6-4.2-4.2-1.6c-.6-.2-.6-1.1 0-1.4l4.2-1.6 1.6-4.2c.1-.3.4-.5.7-.5zm6.5 12c.2 0 .3.1.4.3l.8 2.1 2.1.8c.3.1.3.6 0 .7l-2.1.8-.8 2.1c-.1.3-.6.3-.7 0l-.8-2.1-2.1-.8c-.3-.1-.3-.6 0-.7l2.1-.8.8-2.1c.1-.2.2-.3.4-.3z' })),
      Tooltip: props => props.children,
    }
  }
  throw new Error('unexpected require: ' + name)
}, module_, module_.exports)

// 模拟其他插件的侧栏按钮（对照排序）：内容指令 40 / 抖音 43 / 日报 50。
function FakeButton({ icon, label }) {
  return h('button', { type: 'button', className: 'side-button', 'aria-label': label },
    h(icon, { size: 18 }))
}
const PlayIcon = ({ size }) => h('svg', {
  width: size || 18, height: size || 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.5', 'aria-hidden': 'true',
}, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M10 9l5 3-5 3V9z', fill: 'currentColor', stroke: 'none' }))
const DocIcon = ({ size }) => h('svg', {
  width: size || 18, height: size || 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.5', 'aria-hidden': 'true',
}, h('rect', { x: 5, y: 3, width: 14, height: 18, rx: 2 }), h('path', { d: 'M9 8h6M9 12h6M9 16h4' }))
const ClockIcon = ({ size }) => h('svg', {
  width: size || 18, height: size || 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: '1.5', 'aria-hidden': 'true',
}, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 7v5l3 3' }))

const SidebarButton = module_.exports.SidebarButton || null
// 构建产物可能只导出 apply/renderWxWorkbench——SidebarButton 若未导出，从 Overlay 内部
// 无法直接取用；此处直接以真实组件渲染（若未导出则用产物整体渲染的侧栏元素截取）。
const entries = []
if (SidebarButton) {
  entries.push({ order: 40, label: '内容指令', node: h(FakeButton, { icon: DocIcon, label: '打开内容指令' }) })
  entries.push({ order: 43, label: '抖音工作台', node: h(FakeButton, { icon: PlayIcon, label: '打开抖音工作台' }) })
  entries.push({ order: 44, label: '视频号工作台', node: h(SidebarButton, {}) })
  entries.push({ order: 50, label: '日报工作台', node: h(FakeButton, { icon: ClockIcon, label: '打开日报工作台' }) })
} else {
  throw new Error('构建产物未导出 SidebarButton')
}

const sorted = [...entries].sort((a, b) => a.order - b.order)
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>侧栏入口 · 视觉验证</title>
<style>
  :root {
    --dsw-alias-bg-base: #151517;
    --dsw-alias-bg-layer-1: #232324;
    --dsw-alias-bg-layer-2: #2c2c2e;
    --dsw-alias-label-primary: #fafafa;
    --dsw-alias-label-secondary: #b4b4b4;
    --dsw-alias-border-l1: rgba(255,255,255,.10);
    --ywc-bg: var(--dsw-alias-bg-base);
    --ywc-text: var(--dsw-alias-label-primary);
    --ywc-border: var(--dsw-alias-border-l1);
  }
  body { margin: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
    font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  .layout { display: grid; grid-template-columns: 200px minmax(0,1fr); gap: 40px;
    padding: 40px; align-items: start; }
  .sidebar { width: 200px; min-height: 720px; display: flex; flex-direction: column;
    border-right: 1px solid var(--dsw-alias-border-l1); padding: 16px 12px; gap: 4px; }
  .side-button { display:flex; width:100%; height:36px; align-items:center; gap:10px;
    padding:0 10px; border:0; border-radius:6px; background:transparent;
    color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; cursor:pointer; }
  .side-button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
  .side-button.active { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
  .sidebar h3 { margin: 18px 0 8px; font-size: 12px; font-weight: 400;
    color: var(--dsw-alias-label-secondary); padding: 0 10px; }
  .note { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.8; max-width: 520px; }
  .note b { color: var(--dsw-alias-label-primary); }
</style>
</head>
<body>
<div class="layout">
  <nav class="sidebar" aria-label="模拟宿主左下角菜单">
    <h3>工作台入口（按 order 排序）</h3>
    ${sorted.map(item => `<div data-order="${item.order}" data-label="${item.label}"></div>`).join('')}
    <div id="entries"></div>
    <h3>其他</h3>
    <button class="side-button">设置</button>
  </nav>
  <div>
    <p class="note">
      左下角菜单入口排序预览：视频号工作台（order=44，星芒图标）位于
      <b>抖音工作台（order=43）正下方</b>，与宿主 yootun 系插件侧栏注册机制一致。
      悬停显示 Tooltip「打开视频号工作台」，点击打开整页 overlay。
    </p>
  </div>
</div>
<script>
  // 把 React 渲染好的按钮挂到占位节点（按 order 对齐）。
  const rendered = ${JSON.stringify({}).length ? 'window.__entries' : '[]'}
</script>
</body>
</html>`

// React 渲染四个按钮 + 标注。
const renderedEntries = sorted.map(item => ({ order: item.order, label: item.label, html: renderToString(item.node) }))
const finalHtml = html.replace('<div id="entries"></div>', renderedEntries.map(item =>
  `<div style="display:flex; align-items:center; gap:10px; padding:2px 0" data-order="${item.order}"><div data-entry="${item.label}" style="display:flex; align-items:center">${item.html}</div><span style="font-size:13px">${item.label}</span><span style="margin-left:auto; font-size:11px; color:var(--dsw-alias-label-secondary)">order=${item.order}</span></div>`
).join(''))
const target = `${OUT}/wx-ui-sidebar-entry.html`
await writeFile(target, finalHtml)
console.log(`[shot] html → ${target}`)

const playwright = await import('playwright-core')
const chrome = await resolveSystemChrome()
const browser = await playwright.chromium.launch({
  channel: chrome.channel, executablePath: chrome.path, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({ viewport: { width: 1000, height: 780 }, colorScheme: 'dark' })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(String(error)))
await page.goto(`file://${target}`, { waitUntil: 'load' })
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/wx-ui-sidebar-entry.png`, fullPage: false })
console.log(`[shot] ${OUT}/wx-ui-sidebar-entry.png${errors.length ? ` pageErrors=${errors.length}` : ''}`)
await browser.close()
process.exit(errors.length ? 1 : 0)
