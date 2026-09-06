import { resolve } from 'node:path'

import { smokeInstalledYootunClients } from './yootun-client-runtime.mjs'

const manifestPath = resolve(import.meta.dirname, '../package.json')
const results = await smokeInstalledYootunClients(manifestPath)

for (const result of results) {
  console.log(`verify-yootun-client-runtime: ${result.pluginId} (${result.effects.length} effects, ${result.slots.length} slots)`)
}
console.log(`verify-yootun-client-runtime: ${results.length} built-in plugins initialized successfully.`)
