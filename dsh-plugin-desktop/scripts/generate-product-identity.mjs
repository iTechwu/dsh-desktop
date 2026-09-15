/** Emit the committed brand-derived build inputs from brand/brand.config.json. */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBrandConfig, renderBuilderConfig, renderIdentityModule } from '../../scripts/brand-config.mjs'
import { ELECTRON_BUILDER_BASE } from './electron-builder-base.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '..')

const outputs = {
  identityModule: resolve(packageRoot, 'src/generated-product-identity.ts'),
  builderConfig: resolve(packageRoot, 'electron-builder.json'),
}

/** Generate the identity module and electron-builder config in memory. */
export function renderBrandBuildInputs(environment = process.env) {
  const config = loadBrandConfig(environment, repositoryRoot)
  return {
    identityModule: renderIdentityModule(config),
    builderConfig: renderBuilderConfig(config, ELECTRON_BUILDER_BASE),
  }
}

/** Write both committed outputs, returning their paths. */
export function writeBrandBuildInputs(environment = process.env) {
  const rendered = renderBrandBuildInputs(environment)
  writeFileSync(outputs.identityModule, rendered.identityModule)
  writeFileSync(outputs.builderConfig, `${JSON.stringify(rendered.builderConfig, null, 2)}\n`)
  return outputs
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const written = writeBrandBuildInputs()
  const version = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version
  console.log(`brand build inputs written for ${JSON.stringify(version)}:`)
  for (const path of Object.values(written)) console.log(`  ${path}`)
}
