import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const PLUGIN_PREFIX = '@dofe/dsh-yootun-'

function createElement(tagName, elementsById) {
  const element = {
    tagName: String(tagName).toUpperCase(),
    dataset: {},
    style: {},
    children: [],
    appendChild(child) { this.children.push(child); return child },
    remove() {
      if (this.id) elementsById.delete(this.id)
    },
    setAttribute() {},
  }
  let id = ''
  Object.defineProperty(element, 'id', {
    get() { return id },
    set(value) {
      if (id) elementsById.delete(id)
      id = String(value)
      if (id) elementsById.set(id, element)
    },
  })
  return element
}

function createBrowserHarness(pluginId) {
  const registrations = []
  const effects = []
  const slots = []
  const styles = []
  const elementsById = new Map()
  const listeners = new Map()
  const head = createElement('head', elementsById)
  const body = createElement('body', elementsById)
  head.appendChild = (element) => { head.children.push(element); styles.push(element); return element }

  const document = {
    activeElement: null,
    body,
    head,
    createElement: tagName => createElement(tagName, elementsById),
    getElementById: id => elementsById.get(id) ?? null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  }
  const window = {
    __ModuleLoader__: {
      load(registration) { registrations.push(registration) },
    },
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set()
      current.add(listener)
      listeners.set(type, current)
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    dispatchEvent() { return true },
    confirm() { return false },
    localStorage: {
      getItem() { return null },
      setItem() {},
      removeItem() {},
    },
  }
  window.window = window
  window.document = document

  const noopComponent = () => null
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useEffect() {},
    useMemo(factory) { return factory() },
    useReducer(_reducer, initial) { return [initial, () => {}] },
    useRef(value) { return { current: value } },
    useState(value) { return [typeof value === 'function' ? value() : value, () => {}] },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
  }
  const primitives = new Proxy({}, { get: () => noopComponent })
  const require = (name) => {
    if (name === 'react') return React
    if (name === 'react-dom/client') {
      return { createRoot: () => ({ render() {}, unmount() {} }) }
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`${pluginId}: unexpected client dependency ${name}`)
  }

  const access = {
    getSnapshot: () => ({ value: { setupComplete: true, validationVersion: 3 } }),
    subscribe: () => () => {},
    mutate: async () => ({ ok: true }),
  }
  const ctx = {
    effect(callback, label = 'unnamed effect') {
      try {
        const dispose = callback()
        effects.push({ label, dispose })
        return dispose
      } catch (cause) {
        throw new Error(`${pluginId}: effect "${label}" failed: ${cause?.message ?? cause}`, { cause })
      }
    },
    locale: {
      register() { return () => {} },
      bind() { return key => key },
    },
    remote: {
      credentials: {
        async describe() { return { ok: true, value: {} } },
        async set() { return { ok: true } },
        async unset() { return { ok: true } },
      },
      settings: {
        async describe() { return { ok: true, value: { namespaces: [] } } },
        async mutate() { return { ok: true } },
      },
    },
    settingsScope: { bind: () => access },
    slots: {
      inject(name, callback) {
        try {
          const dispose = callback()
          slots.push({ name, dispose })
          return dispose
        } catch (cause) {
          throw new Error(`${pluginId}: slot "${name}" failed: ${cause?.message ?? cause}`, { cause })
        }
      },
      register(definition, component) { return { definition, component } },
    },
  }
  const context = vm.createContext({
    AbortController,
    Blob,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail } },
    Date,
    Error,
    JSON,
    Map,
    Math,
    Promise,
    Set,
    URL,
    URLSearchParams,
    clearInterval,
    clearTimeout,
    console,
    document,
    fetch: async () => { throw new Error(`${pluginId}: apply smoke must not fetch`) },
    requestAnimationFrame: callback => { callback(0); return 1 },
    setInterval,
    setTimeout,
    window,
  })
  return { context, ctx, effects, registrations, require, slots, styles }
}

export async function smokeYootunClientBundle({ pluginId, clientPath, source }) {
  const harness = createBrowserHarness(pluginId)
  const clientSource = source ?? await readFile(clientPath, 'utf8')
  let plugin

  if (clientSource.includes('window.__ModuleLoader__.load')) {
    vm.runInContext(clientSource, harness.context, { filename: clientPath, timeout: 5_000 })
    if (harness.registrations.length !== 1) {
      throw new Error(`${pluginId}: expected one client module registration, received ${harness.registrations.length}`)
    }
    const [registration] = harness.registrations
    if (registration.id !== pluginId) {
      throw new Error(`${pluginId}: client bundle registered unexpected id ${String(registration.id)}`)
    }
    plugin = registration.factory(harness.require)
  } else {
    plugin = await import(`${pathToFileURL(clientPath).href}?runtime-smoke=${Date.now()}`)
  }

  if (typeof plugin?.apply !== 'function') throw new Error(`${pluginId}: client export is missing apply()`)
  try {
    await plugin.apply(harness.ctx)
  } catch (cause) {
    if (cause?.message?.startsWith(`${pluginId}:`)) throw cause
    throw new Error(`${pluginId}: apply() failed: ${cause?.message ?? cause}`, { cause })
  }

  for (const effect of [...harness.effects].reverse()) {
    if (typeof effect.dispose === 'function') effect.dispose()
  }
  return {
    effects: harness.effects.map(effect => effect.label),
    slots: harness.slots.map(slot => slot.name),
    styles: harness.styles.map(style => style.textContent ?? ''),
  }
}

export async function smokeInstalledYootunClients(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const pluginIds = Object.keys(manifest.dependencies ?? {})
    .filter(name => name.startsWith(PLUGIN_PREFIX))
    .sort()
  if (pluginIds.length === 0) throw new Error('desktop manifest does not declare any built-in Yootun plugins')

  const require = createRequire(manifestPath)
  const results = []
  for (const pluginId of pluginIds) {
    const packagePath = require.resolve(`${pluginId}/package.json`)
    const pluginManifest = JSON.parse(await readFile(packagePath, 'utf8'))
    const clientExport = pluginManifest.exports?.['./client']
    const relativeClientPath = typeof clientExport === 'string' ? clientExport : clientExport?.default
    if (!relativeClientPath) throw new Error(`${pluginId}: package does not export ./client`)
    const clientPath = resolve(dirname(packagePath), relativeClientPath)
    results.push({ pluginId, clientPath, ...(await smokeYootunClientBundle({ pluginId, clientPath })) })
  }
  return results
}
