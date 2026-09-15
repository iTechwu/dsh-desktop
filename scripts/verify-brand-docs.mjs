/** Fail when committed brand doc regions drift from brand/brand.config.json. */

import { renderBrandDocs, verifyBrandDocs } from './generate-brand-docs.mjs'

const { drifted } = verifyBrandDocs()
if (drifted.length > 0) {
  console.error('committed brand doc regions are stale:')
  for (const path of drifted) console.error(`  ${path}`)
  console.error('run: corepack pnpm brand:docs')
  process.exitCode = 1
} else {
  console.log('brand doc regions are in sync with brand/brand.config.json.')
}
