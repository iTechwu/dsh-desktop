// Stub build script — this plugin ships only host-side (Electron main process)
// code and has no browser bundle to produce. Kept so `npm run check` in CI can
// still gate on a successful build step (matching the convention in sibling
// dsh-yootun-* plugins). If the plugin later adds a src/client.js, mirror
// plugins/dsh-yootun-audit/scripts/build.mjs to wrap it for the renderer.

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

console.log(`[dsh-knowledge-capture] build: no-op (host-side only) at ${root}`)
