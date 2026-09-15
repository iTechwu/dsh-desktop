/** Brand artwork generator contract: shapes, pixel-level determinism, idempotence. */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const script = (name: string): string => join(packageRoot, 'scripts', name)
const buildFile = (name: string): string => join(packageRoot, 'build', name)

/** Generators that must reproduce the committed build images byte-for-byte in pixels. */
const REPRODUCIBLE_SCRIPTS = [
  'generate-brand-assets.mjs',
  'generate-lockup.ts',
  'generate-mac-app-icon.mjs',
  'generate-tray-icons.mjs',
] as const

/** Decoded pixel payloads of the generated masters, compared across runs. */
async function capturePixels(): Promise<Map<string, Buffer>> {
  const captures = new Map<string, Buffer>()
  for (const name of ['app-icon.png', 'brand-logo.png', 'app-icon-mac.png', 'sidebar-brand.png', 'hero-brand.png']) {
    const { data, info } = await sharp(buildFile(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    captures.set(name, Buffer.concat([Buffer.from([info.width, info.height]), data]))
  }
  return captures
}

function runGenerators(): void {
  for (const name of REPRODUCIBLE_SCRIPTS) {
    execFileSync(process.execPath, [script(name)], { stdio: 'pipe' })
  }
}

describe('brand artwork generators', () => {
  it('produces the committed masters with the configured shapes', async () => {
    const brandConfig = JSON.parse(readFileSync(new URL('../../brand/brand.config.json', import.meta.url), 'utf8')) as {
      artwork?: { iconSize?: number; heroSize?: number }
      wordmark?: { lockup?: { width?: number; height?: number } }
    }
    const iconSize = brandConfig.artwork?.iconSize
    const heroSize = brandConfig.artwork?.heroSize
    const lockup = brandConfig.wordmark?.lockup

    const appIcon = await sharp(buildFile('app-icon.png')).metadata()
    expect(appIcon.format).toBe('png')
    expect(appIcon.width).toBe(iconSize)
    expect(appIcon.height).toBe(iconSize)

    const brandLogo = await sharp(buildFile('brand-logo.png')).metadata()
    expect(brandLogo.format).toBe('png')
    expect(brandLogo.width).toBe(iconSize)
    expect(brandLogo.hasAlpha).toBe(true)

    const macIcon = await sharp(buildFile('app-icon-mac.png')).metadata()
    expect(macIcon.width).toBe(iconSize)
    expect(macIcon.height).toBe(iconSize)

    const sidebar = await sharp(buildFile('sidebar-brand.png')).metadata()
    expect(sidebar.width).toBe(lockup?.width)
    expect(sidebar.height).toBe(lockup?.height)
    expect(sidebar.hasAlpha).toBe(true)

    const hero = await sharp(buildFile('hero-brand.png')).metadata()
    expect(hero.width).toBe(heroSize)
    expect(hero.height).toBe(heroSize)

    expect(readFileSync(buildFile('app-icon.ico')).byteLength).toBeGreaterThan(0)
  })

  it('regenerates pixel-identical masters and is idempotent across runs', async () => {
    const committed = await capturePixels()
    runGenerators()
    const firstRun = await capturePixels()
    runGenerators()
    const secondRun = await capturePixels()

    for (const [name, pixels] of committed) {
      const first = firstRun.get(name)
      expect(first?.equals(pixels) ?? false).toBe(true)
      expect(secondRun.get(name)?.equals(first) ?? false).toBe(true)
    }
  })
})
