/**
 * Load, validate, and render the white-label brand configuration.
 *
 * `brand/brand.config.json` is the single operator-editable source for the
 * product identity, brand artwork, update service, and doc-site strings.
 * Everything else in this module derives from it:
 *
 * - `renderIdentityModule`  → dsh-plugin-desktop/src/generated-product-identity.ts
 * - `renderBuilderConfig`   → dsh-plugin-desktop/electron-builder.json
 * - doc block renderers (Phase 3) → README/PRIVACY/notices fenced regions
 *
 * The loader honours `BRAND_CONFIG=<path>` so tests and multi-brand builds can
 * point at an alternative configuration without touching the committed one.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEFAULT_BRAND_CONFIG_PATH = 'brand/brand.config.json'

const APP_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
const HEADER_NAME_PATTERN = /^X-[A-Za-z0-9-]+$/
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[^\s"']*)?$/

/**
 * Resolve the brand configuration path for the current invocation.
 * @param {NodeJS.ProcessEnv | undefined} environment
 * @param {string | undefined} root repository root for relative resolution.
 * @returns {string} absolute config path.
 */
export function resolveBrandConfigPath(environment = process.env, root = process.cwd()) {
  const override = environment.BRAND_CONFIG
  return resolve(root, override !== undefined && override.length > 0 ? override : DEFAULT_BRAND_CONFIG_PATH)
}

/**
 * Load and validate the brand configuration.
 * @param {NodeJS.ProcessEnv | undefined} [environment]
 * @param {string | undefined} [root]
 * @returns {object} the parsed configuration document.
 */
export function loadBrandConfig(environment = process.env, root = process.cwd()) {
  const configPath = resolveBrandConfigPath(environment, root)
  if (!existsSync(configPath)) {
    throw new Error(`brand config is missing: ${configPath}`)
  }
  let document
  try {
    document = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (cause) {
    throw new Error(`brand config is not valid JSON: ${configPath}`, { cause })
  }
  const violations = validateBrandConfig(document, configPath)
  if (violations.length > 0) {
    throw new Error(`brand config is invalid (${configPath}):\n- ${violations.join('\n- ')}`)
  }
  return document
}

/**
 * Validate one parsed brand configuration document.
 * @param {unknown} document
 * @param {string} sourcePath label used in violation messages.
 * @returns {readonly string[]} human-readable violations; empty when valid.
 */
export function validateBrandConfig(document, sourcePath = 'brand.config.json') {
  const violations = []
  const push = message => violations.push(message)
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return [`${sourcePath}: the top level must be an object`]
  }
  const config = /** @type {Record<string, unknown>} */ (document)

  const channels = requireObject(config, 'channels', push)
  if (channels !== undefined) {
    for (const channel of ['stable', 'beta']) {
      const entry = requireObject(channels, channel, push)
      if (entry === undefined) continue
      requireNonEmptyString(entry, 'productName', `${channel}.`, push)
      requirePattern(entry, 'appId', APP_ID_PATTERN, `${channel}.`, push,
        'expected reverse-DNS like "ai.yootun.agent.beta"')
      requirePattern(entry, 'artifactPrefix', /^[A-Za-z0-9.-]+$/, `${channel}.`, push,
        'expected a filename-safe prefix like "Yootun-Agent-Beta"')
    }
  }
  if (!channels?.[config.activeChannel]) {
    push(`${sourcePath}: activeChannel must name one of channels.stable|channels.beta`)
  }
  requireNonEmptyString(config, 'packageName', '', push)

  const displayName = requireObject(config, 'displayName', push)
  displayName !== undefined && requireNonEmptyString(displayName, 'titlebar', 'displayName.', push)
  displayName !== undefined && requireNonEmptyString(displayName, 'locale', 'displayName.', push)

  const artwork = requireObject(config, 'artwork', push)
  if (artwork !== undefined) {
    requireRelativePath(artwork, 'appIconSource', 'artwork.', push)
    requireRelativePath(artwork, 'sidebarMark', 'artwork.', push)
    requireRelativePath(artwork, 'heroMark', 'artwork.', push)
    requireIntegerRange(artwork, 'whiteThreshold', 0, 255, 'artwork.', push)
    requireIntegerRange(artwork, 'iconSize', 256, 4096, 'artwork.', push)
    requireIntegerRange(artwork, 'heroSize', 32, 1024, 'artwork.', push)
    const macIcon = requireObject(artwork, 'macIcon', push)
    if (macIcon !== undefined) {
      requireIntegerRange(macIcon, 'canvas', 256, 4096, 'artwork.macIcon.', push)
      requireIntegerRange(macIcon, 'artwork', 64, 4096, 'artwork.macIcon.', push)
    }
  }

  const wordmark = requireObject(config, 'wordmark', push)
  if (wordmark !== undefined) {
    requireRelativePath(wordmark, 'image', 'wordmark.', push)
    const text = requireObject(wordmark, 'text', push)
    text !== undefined && requireNonEmptyString(text, 'zh', 'wordmark.text.', push)
    text !== undefined && requireNonEmptyString(text, 'en', 'wordmark.text.', push)
    requirePattern(wordmark, 'color', HEX_COLOR_PATTERN, 'wordmark.', push, 'expected #RRGGBB')
    requireRelativePath(wordmark, 'fontFile', 'wordmark.', push)
    const lockup = requireObject(wordmark, 'lockup', push)
    lockup !== undefined && requireIntegerRange(lockup, 'width', 64, 16384, 'wordmark.lockup.', push)
    lockup !== undefined && requireIntegerRange(lockup, 'height', 16, 4096, 'wordmark.lockup.', push)
    const display = requireObject(wordmark, 'display', push)
    display !== undefined && requireIntegerRange(display, 'width', 32, 1024, 'wordmark.display.', push)
    display !== undefined && requireIntegerRange(display, 'height', 8, 512, 'wordmark.display.', push)
  }

  const updates = requireObject(config, 'updates', push)
  if (updates !== undefined) {
    requirePattern(updates, 'endpoint', URL_PATTERN, 'updates.', push, 'expected an https:// URL')
    requirePattern(updates, 'versionHeader', HEADER_NAME_PATTERN, 'updates.', push, 'expected an X-* header name')
    requirePattern(updates, 'channelHeader', HEADER_NAME_PATTERN, 'updates.', push, 'expected an X-* header name')
  }

  const docs = requireObject(config, 'docs', push)
  if (docs !== undefined) {
    requirePattern(docs, 'siteUrl', URL_PATTERN, 'docs.', push, 'expected an https:// URL')
    requirePattern(docs, 'downloadBase', URL_PATTERN, 'docs.', push, 'expected an https:// URL')
    requirePattern(docs, 'repoUrl', URL_PATTERN, 'docs.', push, 'expected an https:// URL')
    const communityName = requireObject(docs, 'communityName', push)
    communityName !== undefined && requireNonEmptyString(communityName, 'zh', 'docs.communityName.', push)
    communityName !== undefined && requireNonEmptyString(communityName, 'en', 'docs.communityName.', push)
    const maintainer = requireObject(docs, 'maintainer', push)
    maintainer !== undefined && requireNonEmptyString(maintainer, 'zh', 'docs.maintainer.', push)
    maintainer !== undefined && requireNonEmptyString(maintainer, 'en', 'docs.maintainer.', push)
    requireNonEmptyString(docs, 'noticesHeader', 'docs.', push)
  }

  const nsis = requireObject(config, 'nsis', push)
  nsis !== undefined && requireNonEmptyString(nsis, 'shortcutName', 'nsis.', push)

  return violations
}

/** Return the identity of the configured active release channel. */
export function resolveActiveChannel(config) {
  return config.channels[config.activeChannel]
}

/**
 * Render `src/generated-product-identity.ts` content.
 * The hand-written `src/product-identity.ts` façade re-exports these values
 * under their historical names, so consumers never import this file directly.
 */
export function renderIdentityModule(config) {
  const stable = config.channels.stable
  const beta = config.channels.beta
  return `/** Generated by scripts/generate-product-identity.mjs from brand/brand.config.json. Do not edit directly. */

/** Raw identity table for both release channels. */
export const BRAND_RELEASE_IDENTITIES = Object.freeze({
  stable: Object.freeze({
    releaseChannel: 'stable' as const,
    packageName: ${JSON.stringify(config.packageName)},
    productName: ${JSON.stringify(stable.productName)},
    appId: ${JSON.stringify(stable.appId)},
  }),
  beta: Object.freeze({
    releaseChannel: 'beta' as const,
    packageName: ${JSON.stringify(config.packageName)},
    productName: ${JSON.stringify(beta.productName)},
    appId: ${JSON.stringify(beta.appId)},
  }),
})

/** Identity selected by brand.config.json activeChannel. */
export const BRAND_ACTIVE_CHANNEL = ${JSON.stringify(config.activeChannel)} as const

/** Artifact filename prefix for the active channel, e.g. "Yootun-Agent-Beta". */
export const BRAND_ARTIFACT_PREFIX = ${JSON.stringify(resolveActiveChannel(config).artifactPrefix)}

/** Electron Builder shortcutName for the active channel. */
export const BRAND_SHORTCUT_NAME = ${JSON.stringify(config.nsis.shortcutName)}

/** Display names shown in chrome that is identical across release channels. */
export const BRAND_DISPLAY_NAME = Object.freeze({
  titlebar: ${JSON.stringify(config.displayName.titlebar)},
  locale: ${JSON.stringify(config.displayName.locale)},
})

/** Update service contract served by the release infrastructure. */
export const BRAND_UPDATE_SERVICE = Object.freeze({
  endpoint: ${JSON.stringify(config.updates.endpoint)},
  versionHeader: ${JSON.stringify(config.updates.versionHeader)},
  channelHeader: ${JSON.stringify(config.updates.channelHeader)},
})

/** Sidebar lockup display box consumed by the client brand slots. */
export const BRAND_WORDMARK_DISPLAY = Object.freeze({
  width: ${Number(config.wordmark.display.width)},
  height: ${Number(config.wordmark.display.height)},
})
`
}

/**
 * Render the brand-dependent electron-builder fields.
 * @param {object} config brand configuration.
 * @param {object} base static non-brand builder settings (the committed template).
 * @returns {object} the complete electron-builder configuration document.
 */
export function renderBuilderConfig(config, base) {
  const active = resolveActiveChannel(config)
  return {
    ...base,
    appId: active.appId,
    productName: active.productName,
    win: {
      ...base.win,
      artifactName: `${active.artifactPrefix}-\${version}-\${arch}-Portable.\${ext}`,
    },
    nsis: {
      ...base.nsis,
      shortcutName: config.nsis.shortcutName,
      artifactName: `${active.artifactPrefix}-\${version}-\${arch}-Setup.\${ext}`,
    },
  }
}

/** Internal validation helpers. */
function requireObject(parent, key, push, label = '') {
  const value = parent[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    push(`${sourceLabel(label, key)} must be an object`)
    return undefined
  }
  return value
}

function requireNonEmptyString(parent, key, label, push) {
  const value = parent[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    push(`${sourceLabel(label, key)} must be a non-empty string`)
  }
}

function requirePattern(parent, key, pattern, label, push, hint) {
  const value = parent[key]
  if (typeof value !== 'string' || !pattern.test(value)) {
    push(`${sourceLabel(label, key)} is invalid (${hint})`)
  }
}

function requireRelativePath(parent, key, label, push) {
  const value = parent[key]
  if (typeof value !== 'string' || value.length === 0
    || value.startsWith('/') || value.includes('..') || value.includes('\\')) {
    push(`${sourceLabel(label, key)} must be a repository-relative POSIX path`)
  }
}

function requireIntegerRange(parent, key, min, max, label, push) {
  const value = parent[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    push(`${sourceLabel(label, key)} must be an integer between ${min} and ${max}`)
  }
}

function sourceLabel(label, key) {
  return `${label}${key}`
}
