import { readdirSync } from 'node:fs'

const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/iu

/** Return whether a package directory ships a conventional license text. */
export function hasLicenseFile(packageDir) {
  return readdirSync(packageDir, { withFileTypes: true })
    .some(entry => entry.isFile() && LICENSE_FILE.test(entry.name))
}
