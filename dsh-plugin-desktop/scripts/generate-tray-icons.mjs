/** Generate native tray bitmaps from the repository-owned brand logo PNG. */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'brand-logo.png')

const metadata = await sharp(sourcePath).metadata()
if (metadata.format !== 'png' || metadata.hasAlpha !== true) {
  throw new Error('generate-tray-icons: brand-logo.png must be a PNG with an alpha channel')
}

// 模板变体与蓝色变体共用同一母版:macOS 模板图只取 alpha 通道由系统着色,
// Windows/Linux 直接显示多彩 logo 本体。
const variants = [
  ['tray-iconTemplate.png', 16],
  ['tray-iconTemplate@2x.png', 32],
  ['tray-icon-blue.png', 16],
  ['tray-icon-blue@1.25x.png', 20],
  ['tray-icon-blue@1.5x.png', 24],
  ['tray-icon-blue@2x.png', 32],
]

await Promise.all(variants.map(async ([filename, size]) => {
  await sharp(sourcePath)
    .resize({
      width: size,
      height: size,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(join(buildRoot, filename))
}))
