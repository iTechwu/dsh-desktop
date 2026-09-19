import { readFileSync } from 'node:fs'
export function pluginBrand(environment = process.env) {
  const catalog = JSON.parse(readFileSync(new URL('./defaults.json', import.meta.url), 'utf8'))
  const variant = environment.BRAND || 'yootun'
  if (!Object.hasOwn(catalog, variant)) throw new Error(`Unknown plugin brand: ${variant}`)
  const brand = { ...catalog[variant] }
  if (variant === 'sensteed') brand.logoDataUrl = 'data:image/png;base64,' + readFileSync(new URL('./sensteed.png', import.meta.url)).toString('base64')
  return brand
}
export function brandClientSource(source, environment = process.env) {
  return `const PLUGIN_BRAND = ${JSON.stringify(pluginBrand(environment))};\n${source}`
}
