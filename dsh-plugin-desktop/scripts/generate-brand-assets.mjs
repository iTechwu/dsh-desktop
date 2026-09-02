/** Generate application and tray masters from the repository-owned Yootun artwork. */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'app-icon-source.jpg')
const appIconPath = join(buildRoot, 'app-icon.png')
const brandLogoPath = join(buildRoot, 'brand-logo.png')
const size = 1024

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
    || (data[offset] >= 235 && data[offset + 1] >= 235 && data[offset + 2] >= 235)
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

const transparentArtwork = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: info.channels },
}).png({ compressionLevel: 9 }).toBuffer()

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
