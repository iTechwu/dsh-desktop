/**
 * Bump the Desktop release version across the whole brand-derived surface.
 *
 * Usage: corepack pnpm brand:version <version>
 *
 * Writes the version into the root and plugin package.json files, re-renders
 * the brand doc regions (artifact paths embed the version), and re-records
 * the bilingual hash records — replacing the previous manual multi-file edit.
 */

import { writeFileSync, readFileSync } from 'node:fs'
import { renderBrandDocs } from './generate-brand-docs.mjs'

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

const requested = process.argv[2]
if (requested === undefined || !VERSION_PATTERN.test(requested)) {
  console.error(`usage: node scripts/bump-version.mjs <version>  (got ${JSON.stringify(requested)})`)
  process.exit(1)
}

for (const manifestPath of ['package.json', 'dsh-plugin-desktop/package.json']) {
  const document = JSON.parse(readFileSync(manifestPath, 'utf8'))
  document.version = requested
  writeFileSync(manifestPath, `${JSON.stringify(document, null, 2)}\n`)
  console.log(`${manifestPath} -> ${requested}`)
}

renderBrandDocs({ write: true })
console.log(`brand doc regions re-rendered for ${requested}.`)
console.log('next: regenerate build inputs if identity changed, then run pnpm check:layout.')
