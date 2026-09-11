import React from 'react'
import { createRoot } from 'react-dom/client'
import { installModalOverlayIsolation } from '../../../../deepseek-harness/packages/client/ui-layout/src/client/modal-overlay.ts'

const source = await fetch('/__plugin_console_source__').then(response => response.text())
let plugin
window.__ModuleLoader__ = {
  load(definition) {
    plugin = definition.factory((name) => {
      if (name === 'react') return React
      throw new Error(`Unexpected Plugin Console dependency: ${name}`)
    })
  },
}
new Function(source)()
delete window.__ModuleLoader__

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
plugin.apply(context)
const PluginConsoleTab = components.get('settings.plugins.tab')
const t = key => dictionaries.zh?.[key] ?? key

function ConsoleFrame() {
  const frame = React.useRef(null)
  React.useEffect(() => installModalOverlayIsolation(frame.current), [])
  return <div ref={frame}><PluginConsoleTab t={t} /></div>
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConsoleFrame />
  </React.StrictMode>,
)
