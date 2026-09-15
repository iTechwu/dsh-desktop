/** Composite the brand lockup images from brand/brand.config.json sources. */

import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { loadBrandConfig } from '../../scripts/brand-config.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '..')

/**
 * Render `build/sidebar-brand.png` (mark + wordmark lockup) and
 * `build/hero-brand.png` (hero avatar) from the configured sources.
 *
 * The wordmark is a pre-rendered transparent PNG (`wordmark.image`), so the
 * hot path composites pixels only and runs on any host. Rendering the wordmark
 * from `wordmark.text` requires the configured font file and is a one-time
 * regeneration path, not part of routine builds.
 */
export async function generateLockups(environment = process.env): Promise<void> {
  const config = loadBrandConfig(environment, repositoryRoot)
  const source = (relative: string): string => resolve(repositoryRoot, relative)
  const output = (name: string): string => join(packageRoot, 'build', name)

  const { width: lockupWidth, height: lockupHeight } = config.wordmark.lockup
  const markPath = source(config.artwork.sidebarMark)
  const wordmarkPath = source(config.wordmark.image)
  if (!existsSync(markPath)) throw new Error(`brand sidebar mark is missing: ${markPath}`)
  if (!existsSync(wordmarkPath)) {
    throw new Error(
      `brand wordmark image is missing: ${wordmarkPath}. Render it once from wordmark.text `
      + `(macOS host with the configured font), or point wordmark.image at a transparent PNG.`,
    )
  }

  const mark = sharp(markPath)
  const markMeta = await mark.metadata()
  const markSquare = Math.min(markMeta.width ?? 0, markMeta.height ?? 0)
  if (markSquare < lockupHeight) {
    throw new Error(`brand sidebar mark is smaller than the lockup height: ${markSquare} < ${lockupHeight}`)
  }
  await mark
    .extract({ left: 0, top: 0, width: markSquare, height: markSquare })
    .resize(lockupHeight, lockupHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(output('sidebar-brand.png'))

  const wordmarkWidth = lockupWidth - lockupHeight
  const stagedPath = output('.brand-wordmark-staged.png')
  try {
    await sharp(wordmarkPath)
      .resize(wordmarkWidth, lockupHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(stagedPath)

    await sharp({
      create: { width: lockupWidth, height: lockupHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: output('sidebar-brand.png'), left: 0, top: 0 },
        { input: stagedPath, left: lockupHeight, top: 0 },
      ])
      .png()
      .toFile(output('sidebar-brand.png'))
  } finally {
    rmSync(stagedPath, { force: true })
  }

  const heroPath = source(config.artwork.heroMark)
  if (!existsSync(heroPath)) throw new Error(`brand hero mark is missing: ${heroPath}`)
  await sharp(heroPath).png().toFile(output('hero-brand.png'))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  generateLockups().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  })
}
