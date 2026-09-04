import React from 'react'
import { createRoot } from 'react-dom/client'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

const source = await fetch('/__audit_source__').then(response => response.text())
const pluginModule = { exports: {} }
const requirePlugin = (name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`Unexpected browser harness dependency: ${name}`)
}
new Function('require', 'module', 'exports', source)(requirePlugin, pluginModule, pluginModule.exports)

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
    register(spec, component) { components.set(spec.name, component); return () => {} },
  },
}
pluginModule.exports.apply(context)

const Button = components.get('sidebar.footer.action')
const Overlay = components.get('shell.overlay')
const t = key => dictionaries.zh?.[key] ?? key
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Button wide t={t} />
    <Overlay t={t} />
  </React.StrictMode>,
)
