import { readFile } from 'node:fs/promises'

export async function readCiPackageManifests(ciRoot, directoryNames) {
  const packages = []
  for (const name of directoryNames) {
    try {
      const source = await readFile(new URL(`${name}/package.json`, ciRoot), 'utf8')
      packages.push({ name, manifest: JSON.parse(source) })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
  }
  return packages
}
