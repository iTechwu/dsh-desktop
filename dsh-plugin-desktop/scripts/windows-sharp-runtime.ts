/** Restore and load Windows Sharp platform packages omitted by Electron Builder's npm collector. */

import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'

export interface PackagedWindowsSharpHydrationOptions {
  /** Desktop package root containing the complete installed dependency tree. */
  readonly desktopRoot: string
  /** Physical app.asar.unpacked root produced by Electron Builder. */
  readonly unpackedRoot: string
}

export interface LoadedSharpModule {
  readonly versions?: {
    readonly sharp?: unknown
  }
}

export type PackagedSharpLoader = (sharpRoot: string) => LoadedSharpModule

function packageVersion(packageRoot: string): string {
  return (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    readonly version: string
  }).version
}

function findPackagedSharpPackages(nodeModulesRoot: string): string[] {
  const found: string[] = []
  const pending = [nodeModulesRoot]
  while (pending.length > 0) {
    const directory = pending.pop()!
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = join(directory, entry.name)
      if (entry.name === 'sharp' && directory.endsWith(`${sep}node_modules`)) {
        found.push(child)
        continue
      }
      pending.push(child)
    }
  }
  return found
}

function resolveInstalledWindowsSharp(desktopRoot: string, expectedVersion: string): string {
  const packagePath = join('@img', 'sharp-win32-x64')
  const workspaceRoot = dirname(desktopRoot)
  const candidates = [
    join(desktopRoot, 'node_modules', packagePath),
    join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      `@img+sharp-win32-x64@${expectedVersion}`,
      'node_modules',
      packagePath,
    ),
    join(
      workspaceRoot,
      'deepseek-harness',
      'node_modules',
      '.pnpm',
      `@img+sharp-win32-x64@${expectedVersion}`,
      'node_modules',
      packagePath,
    ),
  ]
  const candidate = candidates.find(path =>
    existsSync(path) && packageVersion(path) === expectedVersion)
  if (candidate !== undefined) return realpathSync(candidate)
  throw new Error(`cannot resolve installed @img/sharp-win32-x64 ${expectedVersion} source`)
}

function copyPackage(source: string, target: string): void {
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, force: true, dereference: true })
}

/** Materialize the matching win32-x64 native package beside every packaged Sharp instance. */
export function hydratePackagedWindowsSharpRuntime(
  options: PackagedWindowsSharpHydrationOptions,
): void {
  const desktopRoot = resolve(options.desktopRoot)
  const unpackedRoot = resolve(options.unpackedRoot)
  for (const packagedSharp of findPackagedSharpPackages(join(unpackedRoot, 'node_modules'))) {
    const version = packageVersion(packagedSharp)
    copyPackage(
      resolveInstalledWindowsSharp(desktopRoot, version),
      join(dirname(packagedSharp), '@img', 'sharp-win32-x64'),
    )
  }
}

function loadPackagedSharp(sharpRoot: string): LoadedSharpModule {
  const require = createRequire(join(sharpRoot, 'package.json'))
  return require('sharp') as LoadedSharpModule
}

/** Load every packaged Windows Sharp instance and verify its native module version. */
export function smokePackagedWindowsSharpRuntime(
  unpackedRoot: string,
  load: PackagedSharpLoader = loadPackagedSharp,
): void {
  for (const sharpRoot of findPackagedSharpPackages(join(unpackedRoot, 'node_modules'))) {
    const expectedVersion = packageVersion(sharpRoot)
    let loaded: LoadedSharpModule
    try {
      loaded = load(sharpRoot)
    } catch (cause) {
      throw new Error(`failed to load packaged Sharp at ${sharpRoot}`, { cause })
    }
    if (loaded.versions?.sharp !== expectedVersion) {
      throw new Error(
        `packaged Sharp at ${sharpRoot} loaded native version ${String(loaded.versions?.sharp)}; expected ${expectedVersion}`,
      )
    }
  }
}
