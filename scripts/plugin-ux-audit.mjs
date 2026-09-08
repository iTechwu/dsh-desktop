import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const ciRoot = new URL('../.ci/', import.meta.url)
const entries = (await readdir(ciRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && entry.name.startsWith('dsh-yootun-'))
  .map(entry => entry.name)
  .sort()

const clientPlugins = []
for (const name of entries) {
  try {
    await stat(new URL(`../.ci/${name}/src/client.js`, import.meta.url))
    clientPlugins.push(name)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const failures = []
const desktopStyles = await readFile(new URL('../dsh-plugin-desktop/src/client/styles.ts', import.meta.url), 'utf8')
if (!desktopStyles.includes('[aria-modal="true"] :is(')) failures.push('dsh-plugin-desktop: modal focus indicator is missing')
if (!desktopStyles.includes('prefers-reduced-motion: reduce') || !desktopStyles.includes('[aria-modal="true"] *')) {
  failures.push('dsh-plugin-desktop: reduced-motion coverage for plugin overlays is missing')
}

for (const name of clientPlugins) {
  const source = await readFile(new URL(`../.ci/${name}/src/client.js`, import.meta.url), 'utf8')
  const manifest = JSON.parse(await readFile(new URL(`../.ci/${name}/package.json`, import.meta.url), 'utf8'))
  const hasDialog = /role:\s*['"]dialog['"]/.test(source)
  const hasAccessibleName = /aria-label/.test(source) || /aria-labelledby/.test(source)
  const hasClientBuild = manifest.exports?.['./client'] === './lib/client.js'
  const hasCheckScript = typeof manifest.scripts?.check === 'string'
  const isMandatoryAccessGate = name === 'dsh-yootun-ui'
  const hasEscapeClose = /event\.key\s*===\s*['"]Escape['"]/.test(source)
  const restoresTriggerFocus = /requestAnimationFrame\(\(\)\s*=>\s*lastTrigger\?\.focus/.test(source)
  const themeAliasCount = (source.match(/var\(--dsw-alias-[^)]+\)/g) || []).length
  const hasThemeAliases = themeAliasCount >= 4
    && /var\(--dsw-alias-bg-base\)/.test(source)
    && /var\(--dsw-alias-label-primary\)/.test(source)
  const fetchCount = (source.match(/\bfetch\s*\(/g) || []).length
  const sameOriginCount = (source.match(/credentials:\s*['"]same-origin['"]/g) || []).length
  const rejectRedirectCount = (source.match(/redirect:\s*['"]error['"]/g) || []).length
  if (!hasDialog) failures.push(`${name}: client overlay has no dialog role`)
  if (!hasAccessibleName) failures.push(`${name}: client surface has no accessible name`)
  if (!hasClientBuild) failures.push(`${name}: client export is not wired to lib/client.js`)
  if (!hasCheckScript) failures.push(`${name}: package check script is missing`)
  if (!isMandatoryAccessGate && !hasEscapeClose) failures.push(`${name}: dismissible overlay has no Escape handler`)
  if (!isMandatoryAccessGate && !restoresTriggerFocus) failures.push(`${name}: dismissible overlay does not restore trigger focus`)
  if (!hasThemeAliases) failures.push(`${name}: client styles do not use desktop theme aliases`)
  if (sameOriginCount !== fetchCount) failures.push(`${name}: every fetch must use same-origin credentials`)
  if (rejectRedirectCount !== fetchCount) failures.push(`${name}: every fetch must reject redirects`)
}

if (failures.length) {
  console.error('Plugin UX audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Plugin UX audit passed for ${clientPlugins.length} Yootun client plugins.`)
}
