/** Typed façade over the generated brand identity (brand/brand.config.json). */

import {
  BRAND_ACTIVE_CHANNEL,
  BRAND_ARTIFACT_PREFIX,
  BRAND_RELEASE_IDENTITIES,
} from './generated-product-identity.ts'

/** Stable and Beta identities used to locate each edition's private app data. */
export const DESKTOP_RELEASE_IDENTITIES = BRAND_RELEASE_IDENTITIES

export type DesktopProductIdentity = typeof DESKTOP_RELEASE_IDENTITIES[keyof typeof DESKTOP_RELEASE_IDENTITIES]

/** Identity selected by brand.config.json activeChannel; stays aligned with electron-builder.json. */
export const DESKTOP_PRODUCT_IDENTITY = DESKTOP_RELEASE_IDENTITIES[BRAND_ACTIVE_CHANNEL]
export const OTHER_DESKTOP_PRODUCT_IDENTITY = BRAND_RELEASE_IDENTITIES.stable
export const DESKTOP_PACKAGE_NAME = DESKTOP_PRODUCT_IDENTITY.packageName
export const DESKTOP_PRODUCT_NAME = DESKTOP_PRODUCT_IDENTITY.productName
export const DESKTOP_APP_ID = DESKTOP_PRODUCT_IDENTITY.appId
export const DESKTOP_RELEASE_CHANNEL = DESKTOP_PRODUCT_IDENTITY.releaseChannel

/**
 * Artifact filename prefix of the active channel, e.g. "Yootun-Agent-Beta" —
 * the stem of the Portable/Setup/DMG artifact names.
 */
export const DESKTOP_ARTIFACT_PREFIX = BRAND_ARTIFACT_PREFIX

/**
 * Historical alias: this checkout currently labels the second edition "beta",
 * while both workspace identities share one package name.
 */
export const BETA_DESKTOP_PACKAGE_NAME = OTHER_DESKTOP_PRODUCT_IDENTITY.packageName

/** Both Desktop package identities are launcher-owned, never Profile plugins. */
export const DESKTOP_PACKAGE_NAMES: ReadonlySet<string> = new Set([
  DESKTOP_PACKAGE_NAME,
  BETA_DESKTOP_PACKAGE_NAME,
])
