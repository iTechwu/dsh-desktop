// 渲染冒烟回归：构建产物工厂在真 React 下执行 apply，并用 react-dom/server
// 真实渲染 shell.overlay 组件（Overlay 主视图）。
//
// 背景：2026-09-23 真机故障——「爆款拆解 Tab 进入」useEffect 的依赖数组在
// 渲染期求值，前向引用了其后才声明的 loadBdRules/loadBdHistory（const 无
// 提升，TDZ ReferenceError），整个 Overlay 渲染即崩、插件页打不开。既有的
// 源码正则断言与 vm 求值测试都不真正渲染 React 树，抓不到这类错误；本测试
// 用真实 renderToString 兜住「渲染期崩溃」整类问题。
//
// TDZ 特性保证了关闭态渲染同样覆盖崩点：useEffect 依赖数组无条件求值，
// 与 overlay 是否可见、当前处于哪个 Tab 无关。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('built client factory renders the overlay with real React without throwing', async () => {
  const react = await import('react')
  const React = react.default ?? react
  const { renderToString } = await import('react-dom/server')

  // 宿主全局最小 stub：模块顶层与 apply 的 effect 回调只触及其中的事件与存储面。
  const listeners = new Map()
  globalThis.window = {
    __ModuleLoader__: { load(mod) { globalThis.__renderSmokeModule = mod } },
    addEventListener: (type, fn) => { listeners.set(type, fn) },
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type) },
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1' },
    navigator: { language: 'zh-CN' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  }
  globalThis.CustomEvent = class CustomEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts) } }
  globalThis.document = {
    createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, textContent: '' }),
    body: { appendChild() {}, removeChild() {} },
    head: { appendChild() {} },
  }
  globalThis.fetch = async () => ({ ok: false, status: 0, json: async () => ({}) })

  try {
    const built = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
    new Function(built)()
    const mod = globalThis.__renderSmokeModule
    assert.ok(mod, '构建产物应注册 __ModuleLoader__ 模块')

    const anyComp = () => null
    const lazyStub = () => new Proxy(function () {}, {
      get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : anyComp),
      apply: () => null,
    })
    const fakeRequire = id => (id === 'react' ? React : lazyStub())
    const plugin = mod.factory(fakeRequire)

    let overlay = null
    const ctx = {
      locale: Object.assign(key => 'zh-CN', { bind: () => key => key, register: () => {} }),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      effect: fn => { const dispose = fn(); return typeof dispose === 'function' ? dispose : undefined },
      webServer: { register: () => {} },
      slots: {
        inject: (_slot, register) => { register() },
        register: (entry, component) => { if (entry.name === 'shell.overlay') overlay = component },
      },
    }
    plugin.apply(ctx)
    assert.equal(typeof overlay, 'function', 'apply 应向 shell.overlay 槽位注册 Overlay 组件')

    // 不抛错即通过：渲染输出长度不作为断言（overlay 初始为关闭态，输出可为空）。
    renderToString(React.createElement(overlay, { t: key => key }))
  } finally {
    delete globalThis.__renderSmokeModule
    delete globalThis.window
    delete globalThis.CustomEvent
    delete globalThis.document
    delete globalThis.fetch
  }
})
