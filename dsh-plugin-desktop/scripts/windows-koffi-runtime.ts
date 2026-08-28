/** Restore Windows Koffi platform packages omitted by Electron Builder's npm collector. */

import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'

export interface PackagedWindowsKoffiHydrationOptions {
  /** Desktop package root containing the complete installed dependency tree. */
  readonly desktopRoot: string
  /** Physical app.asar.unpacked root produced by Electron Builder. */
  readonly unpackedRoot: string
}

function copyPackage(source: string, target: string): void {
  if (!existsSync(source)) {
    throw new Error(`cannot find installed Windows Koffi package at ${source}`)
  }
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, force: true, dereference: true })
}

function findPackagedKoffiPackages(nodeModulesRoot: string): string[] {
  const found: string[] = []
  const pending = [nodeModulesRoot]
  while (pending.length > 0) {
    const directory = pending.pop()!
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = join(directory, entry.name)
      if (entry.name === 'koffi' && directory.endsWith(`${sep}node_modules`)) {
        found.push(child)
        continue
      }
      pending.push(child)
    }
  }
  return found
}

function packageVersion(packageRoot: string): string {
  return (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    readonly version: string
  }).version
}

function resolveInstalledKoffi(
  desktopRoot: string,
  unpackedRoot: string,
  packagedKoffi: string,
): string {
  const packagedVersion = packageVersion(packagedKoffi)
  const matchesPackagedVersion = (candidate: string): boolean =>
    existsSync(candidate) && packageVersion(candidate) === packagedVersion

  const packageRelativePath = relative(unpackedRoot, packagedKoffi)
  const directCandidate = join(desktopRoot, packageRelativePath)
  if (matchesPackagedVersion(directCandidate)) return realpathSync(directCandidate)

  const marker = `${sep}node_modules${sep}koffi`
  const markerIndex = packageRelativePath.lastIndexOf(marker)
  if (markerIndex >= 0) {
    const consumerRoot = join(desktopRoot, packageRelativePath.slice(0, markerIndex))
    try {
      const resolvedCandidate = dirname(createRequire(join(consumerRoot, 'package.json')).resolve('koffi'))
      if (matchesPackagedVersion(resolvedCandidate)) return realpathSync(resolvedCandidate)
    } catch {
      // The versioned pnpm store lookup below is the authoritative fallback.
    }
  }

  const workspaceRoot = dirname(desktopRoot)
  const storeCandidates = [
    join(workspaceRoot, 'node_modules', '.pnpm', `koffi@${packagedVersion}`, 'node_modules', 'koffi'),
    join(
      workspaceRoot,
      'deepseek-harness',
      'node_modules',
      '.pnpm',
      `koffi@${packagedVersion}`,
      'node_modules',
      'koffi',
    ),
  ]
  const versionedCandidate = storeCandidates.find(matchesPackagedVersion)
  if (versionedCandidate !== undefined) return realpathSync(versionedCandidate)

  throw new Error(`cannot resolve installed Koffi ${packagedVersion} source for ${packagedKoffi}`)
}

function resolveInstalledWindowsNative(desktopRoot: string, installedKoffi: string): string {
  const packageName = 'koffi-win32-x64'
  const adjacent = join(dirname(installedKoffi), '@koromix', packageName)
  if (existsSync(adjacent)) return adjacent

  const version = packageVersion(installedKoffi)
  const alias = join(desktopRoot, 'node_modules', `${packageName}-${version.replaceAll('.', '-')}`)
  if (existsSync(alias)) return alias

  throw new Error(`cannot resolve installed ${packageName} ${version} source`)
}

/** Materialize the matching win32-x64 native package beside every packaged Koffi version. */
export function hydratePackagedWindowsKoffiRuntime(
  options: PackagedWindowsKoffiHydrationOptions,
): void {
  const desktopRoot = resolve(options.desktopRoot)
  const unpackedRoot = resolve(options.unpackedRoot)
  const packagedModules = join(unpackedRoot, 'node_modules')

  for (const packagedKoffi of findPackagedKoffiPackages(packagedModules)) {
    const installedKoffi = resolveInstalledKoffi(desktopRoot, unpackedRoot, packagedKoffi)
    copyPackage(
      resolveInstalledWindowsNative(desktopRoot, installedKoffi),
      join(dirname(packagedKoffi), '@koromix', 'koffi-win32-x64'),
    )
  }
}
