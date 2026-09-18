/** Generate application and tray masters from the configured brand artwork. */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { loadBrandConfig } from '../../scripts/brand-config.mjs'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = resolve(packageRoot, '..')
const buildRoot = join(packageRoot, 'build')
const brandConfig = loadBrandConfig(undefined, repositoryRoot)
const sourcePath = resolve(repositoryRoot, brandConfig.artwork.appIconSource)
const appIconPath = join(buildRoot, 'app-icon.png')
const brandLogoPath = join(buildRoot, 'brand-logo.png')
const size = brandConfig.artwork.iconSize
const whiteThreshold = brandConfig.artwork.whiteThreshold

const metadata = await sharp(sourcePath).metadata()
if (metadata.format !== 'jpeg' || metadata.width === undefined || metadata.height === undefined) {
  throw new Error('generate-brand-assets: app-icon-source.jpg must be a readable JPEG')
}

const { data, info } = await sharp(sourcePath, { failOn: 'warning' })
  .resize({
    width: size,
    height: size,
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: sharp.kernel.lanczos3,
  })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

// Remove only near-white pixels connected to the canvas edge. The artwork has
// intentional white eye and mask details which a global color key would erase.
const visited = new Uint8Array(info.width * info.height)
const queue = new Uint32Array(info.width * info.height)
let head = 0
let tail = 0
const enqueue = (pixel) => {
  if (visited[pixel] === 1) return
  const offset = pixel * info.channels
  const exterior = data[offset + 3] === 0
    || (data[offset] >= whiteThreshold && data[offset + 1] >= whiteThreshold && data[offset + 2] >= whiteThreshold)
  if (!exterior) return
  visited[pixel] = 1
  queue[tail++] = pixel
}
for (let x = 0; x < info.width; x += 1) {
  enqueue(x)
  enqueue((info.height - 1) * info.width + x)
}
for (let y = 0; y < info.height; y += 1) {
  enqueue(y * info.width)
  enqueue(y * info.width + info.width - 1)
}
while (head < tail) {
  const pixel = queue[head++]
  const x = pixel % info.width
  const y = Math.floor(pixel / info.width)
  if (x > 0) enqueue(pixel - 1)
  if (x + 1 < info.width) enqueue(pixel + 1)
  if (y > 0) enqueue(pixel - info.width)
  if (y + 1 < info.height) enqueue(pixel + info.width)
}
for (let pixel = 0; pixel < visited.length; pixel += 1) {
  if (visited[pixel] !== 1) continue
  const offset = pixel * info.channels
  data[offset] = 0
  data[offset + 1] = 0
  data[offset + 2] = 0
  data[offset + 3] = 0
}

const transparentArtwork = await sharp(centeredCanvas(data, visited, info), {
  raw: { width: info.width, height: info.height, channels: info.channels },
}).png({ compressionLevel: 9 }).toBuffer()

/**
 * Re-center the surviving artwork on the square canvas.
 *
 * Brand sources may carry asymmetric margins; the packaging gates require a
 * symmetric visual inset, so derive the content bounding box from the surviving
 * alpha and shift it to the exact center. Integer flooring keeps the output
 * deterministic; an already-centered source copies through byte-identical.
 * @param {Buffer} source - raw RGBA canvas after the exterior white removal.
 * @param {Uint8Array} visited - exterior pixels already cleared by the flood fill.
 * @param {{ width: number, height: number, channels: number }} info - raw buffer geometry.
 * @returns {Buffer} raw RGBA canvas with the content bounding box centered.
 */
function centeredCanvas(source, visited, info) {
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (visited[y * info.width + x] === 1) continue
      if (source[(y * info.width + x) * info.channels + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) {
    throw new Error('generate-brand-assets: app-icon-source.jpg has no visible artwork after the white-margin removal')
  }
  const contentWidth = maxX - minX + 1
  const contentHeight = maxY - minY + 1
  const shiftX = Math.floor((info.width - contentWidth) / 2) - minX
  const shiftY = Math.floor((info.height - contentHeight) / 2) - minY
  if (shiftX === 0 && shiftY === 0) return source
  const centered = Buffer.alloc(source.length)
  for (let y = minY; y <= maxY; y += 1) {
    const sourceStart = (y * info.width + minX) * info.channels
    const targetStart = ((y + shiftY) * info.width + (minX + shiftX)) * info.channels
    source.copy(centered, targetStart, sourceStart, sourceStart + contentWidth * info.channels)
  }
  return centered
}

await Promise.all([
  sharp(transparentArtwork)
    .toColourspace('rgb16')
    .withIccProfile('srgb')
    .png({
      compressionLevel: 9,
      progressive: false,
      adaptiveFiltering: false,
      palette: false,
    })
    .toFile(appIconPath),
  sharp(transparentArtwork)
    .png({ compressionLevel: 9 })
    .toFile(brandLogoPath),
])
