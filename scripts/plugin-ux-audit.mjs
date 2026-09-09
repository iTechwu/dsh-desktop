import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const ciRoot = new URL('../.ci/', import.meta.url)
const ciEntries = (await readdir(ciRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()
const entries = ciEntries.filter(name => name.startsWith('dsh-yootun-'))

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
const desktopSettingsStyles = await readFile(new URL('../dsh-plugin-desktop/src/client/desktop-settings-styles.ts', import.meta.url), 'utf8')
const dofeAccessSource = await readFile(new URL('../dsh-plugin-desktop/src/client/DofeAccessSection.tsx', import.meta.url), 'utf8')
const themeSource = await readFile(new URL('../deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css', import.meta.url), 'utf8')
const definedThemeAliases = new Set(themeSource.match(/--dsw-alias-[a-z0-9-]+(?=\s*:)/g) || [])

function findUndefinedThemeAliases(source) {
  const usedAliases = new Set(source.match(/(?<=var\()--dsw-alias-[a-z0-9-]+/g) || [])
  return [...usedAliases].filter(alias => !definedThemeAliases.has(alias)).sort()
}

function findFixedWhiteOnAdaptiveFill(source) {
  return (source.match(/[^{}]+\{[^{}]*\}/g) || [])
    .filter(rule => /background\s*:\s*var\(--dsw-alias-(?:brand-primary|button-primary-fill|state-(?:error|success|warn)-primary)/.test(rule))
    .filter(rule => /color\s*:\s*(?:#fff(?:fff)?|white)\b/.test(rule))
    .map(rule => rule.slice(0, rule.indexOf('{')).trim())
}

function findNonAdaptiveForegroundOnAdaptiveFill(source) {
  return (source.match(/[^{}]+\{[^{}]*\}/g) || [])
    .filter(rule => /background\s*:\s*var\(--dsw-alias-(?:brand-primary|button-primary-fill|state-(?:error|success|warn)-primary)/.test(rule))
    .filter(rule => /color\s*:\s*var\(--dsw-alias-(?:bg-base|label-primary)(?=[,)])/.test(rule))
    .map(rule => rule.slice(0, rule.indexOf('{')).trim())
}

function findLegacySemanticColors(source) {
  return [...new Set(source.match(/#(?:22c55e|ef4444|f59e0b|31a46c|d9902f)\b/giu) || [])]
}

function findHardcodedStateColors(source) {
  const stateCss = source.match(/const stateCss\s*=\s*`([^`]*)`/u)?.[1]
  return [...new Set(stateCss?.match(/#[0-9a-f]{3,8}\b/giu) || [])]
}

function hasCanonicalHeader(source) {
  return /\.[a-z0-9-]*header\{[^}]*min-height:72px/u.test(source)
}

function hasCanonicalIconButton(source) {
  return /\.[a-z0-9-]*(?:icon-button|header-buttons button|header-actions button|actions button|icon)\{[^}]*width:36px;height:36px/u.test(source)
}

const actionLifecyclePlugins = new Set([
  'dsh-yootun-content-command',
  'dsh-yootun-recruiter',
  'dsh-yootun-sales',
  'dsh-yootun-supply-watch',
  'dsh-yootun-xhs-operation',
])

const pluginClassPrefixes = {
  'dsh-yootun-audit': 'ya-',
  'dsh-yootun-content-command': 'ycc-',
  'dsh-yootun-daily-report': 'ydr-',
  'dsh-yootun-dashboard': 'yd-',
  'dsh-yootun-finops': 'yf-',
  'dsh-yootun-knowledge': 'yk-',
  'dsh-yootun-lead-discovery': 'yl-',
  'dsh-yootun-recruiter': 'yr-',
  'dsh-yootun-retrofit': 'yro-',
  'dsh-yootun-sales': 'ys-',
  'dsh-yootun-supply-watch': 'ysw-',
  'dsh-yootun-ui': 'yu-',
  'dsh-yootun-xhs-operation': 'yxh-',
}

if (!desktopStyles.includes('[aria-modal="true"] :is(')) failures.push('dsh-plugin-desktop: modal focus indicator is missing')
if (!desktopStyles.includes('prefers-reduced-motion: reduce') || !desktopStyles.includes('[aria-modal="true"] *')) {
  failures.push('dsh-plugin-desktop: reduced-motion coverage for plugin overlays is missing')
}
const desktopClientStyles = `${desktopStyles}\n${desktopSettingsStyles}\n${dofeAccessSource}`
for (const alias of findUndefinedThemeAliases(desktopClientStyles)) {
  failures.push(`dsh-plugin-desktop: client styles use undefined theme alias ${alias}`)
}
for (const selector of findFixedWhiteOnAdaptiveFill(desktopClientStyles)) {
  failures.push(`dsh-plugin-desktop: ${selector} fixes white text on an adaptive theme fill`)
}
for (const selector of findNonAdaptiveForegroundOnAdaptiveFill(desktopClientStyles)) {
  failures.push(`dsh-plugin-desktop: ${selector} uses a non-adaptive foreground on an adaptive theme fill`)
}
if (!dofeAccessSource.includes('const loadingRef = useRef(false)') || !dofeAccessSource.includes('const busyRef = useRef(false)')) {
  failures.push('dsh-plugin-desktop: native access form has no synchronous request locks')
}
if (!dofeAccessSource.includes('aria-busy={interactionBusy}')) {
  failures.push('dsh-plugin-desktop: native access form does not expose its combined busy state')
}
const defaultModelWrite = dofeAccessSource.indexOf("const defaultModel = descriptor.find(item => item.ns === 'agent-default-model')")
const authorizationWrite = dofeAccessSource.indexOf('await mutateDofeAccessSettings(settingsApi', defaultModelWrite)
if (defaultModelWrite < 0 || authorizationWrite < defaultModelWrite) {
  failures.push('dsh-plugin-desktop: native access form must commit authorization after default model configuration')
}
const accessRemoval = dofeAccessSource.indexOf('export async function removeDofeAccess')
const authorizationRemoval = dofeAccessSource.indexOf('await mutateDofeAccessSettings(settingsApi', accessRemoval)
const credentialRemoval = dofeAccessSource.indexOf('await credentials.unset(DOFE_ACCESS_KEY)', accessRemoval)
if (accessRemoval < 0 || authorizationRemoval < accessRemoval || credentialRemoval < authorizationRemoval) {
  failures.push('dsh-plugin-desktop: native access removal must revoke authorization before deleting the credential')
}

for (const name of ciEntries) {
  for (const relativePath of ['src/client.js', 'lib/client.js']) {
    try {
      const clientArtifact = await readFile(new URL(`../.ci/${name}/${relativePath}`, import.meta.url), 'utf8')
      for (const alias of findUndefinedThemeAliases(clientArtifact)) {
        failures.push(`${name}/${relativePath}: uses undefined theme alias ${alias}`)
      }
      for (const selector of findFixedWhiteOnAdaptiveFill(clientArtifact)) {
        failures.push(`${name}/${relativePath}: ${selector} fixes white text on an adaptive theme fill`)
      }
      for (const selector of findNonAdaptiveForegroundOnAdaptiveFill(clientArtifact)) {
        failures.push(`${name}/${relativePath}: ${selector} uses a non-adaptive foreground on an adaptive theme fill`)
      }
      for (const color of findLegacySemanticColors(clientArtifact)) {
        failures.push(`${name}/${relativePath}: ${color} bypasses the shared semantic theme aliases`)
      }
      if (name === 'dsh-yootun-knowledge') {
        for (const color of findHardcodedStateColors(clientArtifact)) {
          failures.push(`${name}/${relativePath}: ${color} hardcodes a knowledge state supplement color`)
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
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
  const hasDynamicStatus = /aria-live/.test(source) || /role:\s*[^}\n]*['"](?:status|alert)['"]/.test(source)
  const hasAsyncUiState = /set(?:Loading|Busy)\(/.test(source)
  const exposesAsyncUiState = /aria-busy/.test(source)
  const hasCanonicalShell = name === 'dsh-yootun-ui' || (hasCanonicalHeader(source) && hasCanonicalIconButton(source))
  const hasActionLifecycle = /awaiting_confirmation|confirmed_pending_adapter|adapter_pending/.test(source)
    || (name === 'dsh-yootun-xhs-operation' && /cancelConfirm|confirmYes|confirmNo/.test(source))
  const usesRevisionReload = /\bsetRevision\s*\(/.test(source)
  const hasSynchronousReloadLock = /loadingRef\.current/.test(source)
  const hasDirectRevisionHandler = /onClick\s*:\s*\(\s*\)\s*=>\s*(?:\{[^}\n]*)?setRevision\s*\(/.test(source)
  const newWindowLinkCount = (source.match(/target:\s*['"]_blank['"]/g) || []).length
  const noreferrerLinkCount = (source.match(/rel:\s*['"]noreferrer['"]/g) || []).length
  if (!hasDialog) failures.push(`${name}: client overlay has no dialog role`)
  if (!hasAccessibleName) failures.push(`${name}: client surface has no accessible name`)
  if (!hasClientBuild) failures.push(`${name}: client export is not wired to lib/client.js`)
  if (!hasCheckScript) failures.push(`${name}: package check script is missing`)
  if (!isMandatoryAccessGate && !hasEscapeClose) failures.push(`${name}: dismissible overlay has no Escape handler`)
  if (!isMandatoryAccessGate && !restoresTriggerFocus) failures.push(`${name}: dismissible overlay does not restore trigger focus`)
  if (!hasThemeAliases) failures.push(`${name}: client styles do not use desktop theme aliases`)
  if (sameOriginCount !== fetchCount) failures.push(`${name}: every fetch must use same-origin credentials`)
  if (rejectRedirectCount !== fetchCount) failures.push(`${name}: every fetch must reject redirects`)
  if (!hasDynamicStatus) failures.push(`${name}: client has no announced loading, empty, or error state`)
  if (hasAsyncUiState && !exposesAsyncUiState) failures.push(`${name}: asynchronous UI state is not exposed with aria-busy`)
  if (!hasCanonicalShell) failures.push(`${name}: shell header and icon buttons do not follow the 72px/36px baseline`)
  if (actionLifecyclePlugins.has(name) && !hasActionLifecycle) failures.push(`${name}: action lifecycle is missing confirmation or adapter-pending state`)
  if (usesRevisionReload && !hasSynchronousReloadLock) failures.push(`${name}: revision-triggered reload has no synchronous request lock`)
  if (hasDirectRevisionHandler) failures.push(`${name}: reload control bypasses its guarded refresh handler`)
  if (newWindowLinkCount !== noreferrerLinkCount) failures.push(`${name}: every new-window link must use noreferrer`)
  const expectedPrefix = pluginClassPrefixes[name]
  if (expectedPrefix) {
    for (const [otherName, otherPrefix] of Object.entries(pluginClassPrefixes)) {
      if (otherName !== name && source.includes(`.${otherPrefix}`)) {
        failures.push(`${name}: client styles leak ${otherPrefix} classes from ${otherName}`)
      }
    }
    if (!source.includes(`.${expectedPrefix}`)) failures.push(`${name}: client styles do not expose their own ${expectedPrefix} namespace`)
  }
}

if (failures.length) {
  console.error('Plugin UX audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Plugin UX audit passed for ${clientPlugins.length} Yootun client plugins and the native access surface.`)
}
