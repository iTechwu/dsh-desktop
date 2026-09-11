import React from 'react'
import * as ReactDomClient from 'react-dom/client'

const source = await fetch('/__yootun_access_source__').then(response => response.text())
const pluginModule = { exports: {} }
const requirePlugin = name => {
  if (name === 'react') return React
  if (name === 'react-dom/client') return ReactDomClient
  throw new Error(`Unexpected Yootun access dependency: ${name}`)
}
new Function('require', 'module', 'exports', source)(requirePlugin, pluginModule, pluginModule.exports)

let dictionaries = {}
const listeners = new Set()
let accessSnapshot = { value: { setupComplete: false, validationVersion: 0, modelId: '' } }
const publishAccess = operations => {
  const value = { ...accessSnapshot.value }
  for (const operation of operations) value[operation.path[0]] = operation.value
  accessSnapshot = { value }
  for (const listener of listeners) listener()
}
const credentials = {
  async describe() { return { ok: true, value: { MODELS_API_KEY: { configured: false } } } },
  async set() { return { ok: true } },
  async unset() { return { ok: true } },
}
const settings = {
  async describe() {
    return { ok: true, value: { namespaces: ['llm-deepseek', 'agent-default-model', 'dofe-access'].map(ns => ({ ns, revision: 1 })) } }
  },
  async mutate(namespace, operations) {
    if (namespace === 'dofe-access') publishAccess(operations)
    return { ok: true }
  },
}
const context = {
  effect(setup) { return setup() },
  locale: {
    register(_namespace, value) { dictionaries = value; return () => {} },
    bind() { return key => dictionaries.zh?.[key] ?? key },
  },
  remote: { credentials, settings },
  settingsScope: {
    bind() {
      return {
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        getSnapshot() { return accessSnapshot },
      }
    },
  },
  slots: {
    inject(_name, setup) { return setup() },
    register() { return () => {} },
  },
}
pluginModule.exports.apply(context)
