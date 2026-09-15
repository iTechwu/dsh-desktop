/** Emit the committed brand-derived build inputs from brand/brand.config.json. */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBrandConfig, renderBuilderConfig, renderIdentityModule } from '../../scripts/brand-config.mjs'
import { ELECTRON_BUILDER_BASE } from './electron-builder-base.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '..')

const defaultOutputs = {
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

/**
 * Write both committed outputs, returning their paths.
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv | undefined} [options.environment]
 * @param {{ identityModule?: string, builderConfig?: string }} [options.outputs]
 *   redirect the emitted files (white-label round-trip tests).
 */
export function writeBrandBuildInputs({ environment, outputs } = {}) {
  const targets = { ...defaultOutputs, ...outputs }
  const rendered = renderBrandBuildInputs(environment)
  writeFileSync(targets.identityModule, rendered.identityModule)
  writeFileSync(targets.builderConfig, `${JSON.stringify(rendered.builderConfig, null, 2)}\n`)
  return targets
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const outputs = {
    ...(process.env.BRAND_OUTPUT_IDENTITY !== undefined
      ? { identityModule: resolve(process.env.BRAND_OUTPUT_IDENTITY) }
      : {}),
    ...(process.env.BRAND_OUTPUT_BUILDER !== undefined
      ? { builderConfig: resolve(process.env.BRAND_OUTPUT_BUILDER) }
      : {}),
  }
  const written = writeBrandBuildInputs({ environment: process.env, outputs })
  const version = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version
  console.log(`brand build inputs written for ${JSON.stringify(version)}:`)
  for (const path of Object.values(written)) console.log(`  ${path}`)
}
