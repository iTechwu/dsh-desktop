import React from 'react'
import { createRoot } from 'react-dom/client'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

// 这里加载的是随发行链发布的 lib/client.js（__ModuleLoader__ 工厂格式），
// 而不是 src/client.js：可视化验收同时覆盖 bundle entry id 与工厂契约。
const source = await fetch('/__douyin_source__').then(response => response.text())
let spec = null
window.__ModuleLoader__ = { load(value) { spec = value } }
new Function(source)()
if (!spec) throw new Error('bundle must register through window.__ModuleLoader__.load')

const requirePlugin = (name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`Unexpected browser harness dependency: ${name}`)
}
const exports = spec.factory(requirePlugin)
document.body.dataset.bundleId = spec.id

const components = new Map()
let dictionaries = {}
const context = {
  effect(setup) { return setup() },
  locale: {
    register(_namespace, value) { dictionaries = value; return () => {} },
    bind() { return key => dictionaries.zh?.[key] ?? key },
  },
  slots: {
    inject(_name, setup) { return setup() },
    register(registerSpec, component) { components.set(registerSpec.name, component); return () => {} },
  },
}
exports.apply(context)

const Button = components.get('sidebar.footer.action')
const Overlay = components.get('shell.overlay')
const t = key => dictionaries.zh?.[key] ?? key
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Button wide t={t} />
    <Overlay t={t} />
  </React.StrictMode>,
)
