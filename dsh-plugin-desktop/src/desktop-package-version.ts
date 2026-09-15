/** Resolve the Desktop package version as the single source for runtime stamps. */

import { readFileSync } from 'node:fs'
import { DESKTOP_PACKAGE_NAME } from './product-identity.ts'

const MAX_MANIFEST_BYTES = 1024 * 1024

let cachedVersion: string | undefined

/**
 * Read the Desktop package manifest version. The manifest travels with the
 * module tree (workspace checkout and packaged ASAR alike), so the audit
 * stamps always report the version that is actually running.
 */
export function desktopPackageVersion(moduleUrl: string | URL = import.meta.url): string {
  cachedVersion ??= readDesktopPackageVersion(moduleUrl)
  return cachedVersion
}

function readDesktopPackageVersion(moduleUrl: string | URL): string {
  const manifestPath = new URL('../package.json', moduleUrl)
  const size = readFileSync(manifestPath).byteLength
  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(`${DESKTOP_PACKAGE_NAME}: package manifest is too large`)
  }

  let value: unknown
  try {
    value = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
  } catch (cause) {
    throw new Error(
      `${DESKTOP_PACKAGE_NAME}: cannot read package manifest: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (value as { name?: unknown }).name !== DESKTOP_PACKAGE_NAME) {
    throw new Error(`${DESKTOP_PACKAGE_NAME}: package manifest has an invalid identity`)
  }
  const version = (value as { version?: unknown }).version
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`${DESKTOP_PACKAGE_NAME}: package manifest has no version`)
  }
  return version
}
