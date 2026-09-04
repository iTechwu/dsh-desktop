/** Render the upper-left sidebar brand lockup with the 优惠豚AI wordmark. */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const inputPath = join(packageRoot, 'build', 'sidebar-brand.png')
const outputPath = inputPath
const fontPath = '/System/Library/Fonts/STHeiti Medium.ttc'

const sourceMeta = await sharp(inputPath).metadata()
if (sourceMeta.format !== 'png' || sourceMeta.width === undefined || sourceMeta.height === undefined) {
  throw new Error(`render-sidebar-brand: ${inputPath} must be a readable PNG`)
}

const markWidth = sourceMeta.width
const markHeight = sourceMeta.height
const targetRatio = 5.55
const totalWidth = Math.round(markHeight * targetRatio * 1.6)
const textAreaWidth = totalWidth - markWidth
const fontSize = Math.round(markHeight * 0.62)
const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${textAreaWidth}" height="${markHeight}">
  <text x="0" y="${Math.round(markHeight * 0.78)}"
      font-family="STHeiti" font-size="${fontSize}" font-weight="700"
      fill="#0F172A">优惠豚AI</text>
</svg>`

await sharp({
  create: {
    width: totalWidth,
    height: markHeight,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    { input: inputPath, left: 0, top: 0 },
    { input: Buffer.from(textSvg), left: markWidth, top: 0 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(outputPath)

console.log(`render-sidebar-brand: wrote ${totalWidth}x${markHeight} to ${outputPath}`)