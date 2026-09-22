/** Check the actual unpacked payload, including runtime-only dependencies, without a GUI. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

interface PackContext { appOutDir: string; electronPlatformName: string }
export function verifyNextPayload(root: string): void {
  for (const path of ['lib/main.js', 'lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-shell.cjs',
    'lib/native-ui/index.html', 'cordis.patch.yml', 'assets/tray-iconTemplate.png', 'assets/tray-icon-blue.png']) {
    if (!existsSync(join(root, path))) throw new Error(`Missing Next payload: ${path}`)
  }
  const queued = [join(root, 'package.json')]; const visited = new Set<string>()
  while (queued.length) {
    const manifest = realpathSync(queued.pop()!)
    if (visited.has(manifest)) continue
    visited.add(manifest)
    const data = JSON.parse(readFileSync(manifest, 'utf8'))
    for (const name of Object.keys(data.dependencies ?? {})) {
      let parent = dirname(manifest)
      let found: string | undefined
      while (!relative(root, parent).startsWith('..')) {
        const candidate = join(parent, 'node_modules', name, 'package.json')
        if (existsSync(candidate)) { found = realpathSync(candidate); break }
        if (parent === root) break
        parent = dirname(parent)
      }
      if (!found) {
        if (Object.hasOwn(data.optionalDependencies ?? {}, name)) continue
        throw new Error(`Missing packaged dependency ${name} required by ${data.name}`)
      }
      if (relative(root, found).startsWith('..')) throw new Error(`Packaged dependency escapes the application: ${name}`)
      queued.push(found)
    }
  }
  const frontend = join(root, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
  if (!existsSync(frontend)) throw new Error('Official Web frontend was not packaged')
}
export default function afterPack(context: PackContext): void {
  const resources = context.electronPlatformName === 'darwin' ? join(context.appOutDir, 'DSH NEXT.app/Contents/Resources') : join(context.appOutDir, 'resources')
  if (existsSync(join(resources, 'app.asar'))) throw new Error('Next must use the same asar:false runtime layout as Stable/Beta')
  verifyNextPayload(join(resources, 'app'))
}
