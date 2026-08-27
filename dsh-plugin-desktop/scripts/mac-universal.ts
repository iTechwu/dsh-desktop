/** Shared preparation and verification inventory for universal macOS packages. */

import {
  chmodSync,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'

export type MacUniversalArch = 'arm64' | 'x86_64'

/** Thin native files that must be present for each CPU inside app.asar.unpacked. */
export const MACOS_UNIVERSAL_NATIVE_ENTRIES = [
  {
    arch: 'arm64',
    path: 'node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.3.node',
  },
  {
    arch: 'arm64',
    path: 'node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.3.dylib',
  },
  {
    arch: 'arm64',
    path: 'node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node',
  },
  {
    arch: 'arm64',
    path: 'node_modules/@vscode/ripgrep-darwin-arm64/bin/rg',
  },
  {
    arch: 'arm64',
    path: 'node_modules/node-addon-require-builtin-darwin-arm64/prebuilt/darwin-arm64-napi-v9.node',
  },
  {
    arch: 'arm64',
    path: 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
  },
  {
    arch: 'arm64',
    path: 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
  },
  {
    arch: 'x86_64',
    path: 'node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64-0.35.3.node',
  },
  {
    arch: 'x86_64',
    path: 'node_modules/@img/sharp-libvips-darwin-x64/lib/libvips-cpp.8.18.3.dylib',
  },
  {
    arch: 'x86_64',
    path: 'node_modules/@koromix/koffi-darwin-x64/darwin_x64/koffi.node',
  },
  {
    arch: 'x86_64',
    path: 'node_modules/@vscode/ripgrep-darwin-x64/bin/rg',
  },
  {
    arch: 'x86_64',
    path: 'node_modules/node-addon-require-builtin-darwin-x64/prebuilt/darwin-x64-napi-v9.node',
  },
  {
    arch: 'x86_64',
    path: 'node_modules/node-pty/prebuilds/darwin-x64/pty.node',
  },
  {
    arch: 'x86_64',
    path: 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
  },
] as const satisfies readonly { readonly arch: MacUniversalArch; readonly path: string }[]

/** Generated host-architecture files that must never shadow the prebuilt pair. */
export const FORBIDDEN_MACOS_UNIVERSAL_ENTRIES = [
  'node_modules/node-pty/build/Release/pty.node',
  'node_modules/node-pty/build/Release/spawn-helper',
] as const

/** Injectable filesystem seam for source-runtime preparation. */
export interface MacUniversalPreparationOptions {
  readonly desktopRoot: string
  readonly exists: (path: string) => boolean
  readonly chmod: (path: string, mode: number) => void
}

export interface PackagedMacRuntimeHydrationOptions {
  /** Desktop package root containing the complete installed dependency tree. */
  readonly desktopRoot: string
  /** Physical app.asar.unpacked root produced by Electron Builder. */
  readonly unpackedRoot: string
  /** macOS CPU trees that must be materialized in the packaged runtime. */
  readonly arches: readonly MacUniversalArch[]
}

const ROOT_MACOS_NATIVE_PACKAGES = [
  '@img/sharp-darwin-{arch}',
  '@img/sharp-libvips-darwin-{arch}',
  '@koromix/koffi-darwin-{arch}',
  '@vscode/ripgrep-darwin-{arch}',
  'node-addon-require-builtin-darwin-{arch}',
] as const

function packageArch(arch: MacUniversalArch): 'arm64' | 'x64' {
  return arch === 'x86_64' ? 'x64' : arch
}

function copyPackage(source: string, target: string): void {
  if (!existsSync(source)) return
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, force: true, dereference: true })
}

function findNestedKoffiPackages(nodeModulesRoot: string): string[] {
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

function resolveInstalledKoffi(
  desktopRoot: string,
  unpackedRoot: string,
  packagedKoffi: string,
): string {
  const packagedVersion = JSON.parse(
    readFileSync(join(packagedKoffi, 'package.json'), 'utf8'),
  ).version as string
  const matchesPackagedVersion = (candidate: string): boolean => {
    if (!existsSync(candidate)) return false
    const candidateVersion = JSON.parse(
      readFileSync(join(candidate, 'package.json'), 'utf8'),
    ).version as string
    return candidateVersion === packagedVersion
  }

  const packageRelativePath = relative(unpackedRoot, packagedKoffi)
  const directCandidate = join(desktopRoot, packageRelativePath)
  if (matchesPackagedVersion(directCandidate)) return realpathSync(directCandidate)

  const marker = `${sep}node_modules${sep}koffi`
  const markerIndex = packageRelativePath.lastIndexOf(marker)
  if (markerIndex < 0) {
    throw new Error(`cannot resolve installed Koffi source for ${packagedKoffi}`)
  }
  const consumerRoot = join(desktopRoot, packageRelativePath.slice(0, markerIndex))
  const require = createRequire(join(consumerRoot, 'package.json'))
  const resolvedCandidate = dirname(require.resolve('koffi'))
  if (matchesPackagedVersion(resolvedCandidate)) return realpathSync(resolvedCandidate)

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
  if (versionedCandidate) return realpathSync(versionedCandidate)

  throw new Error(
    `cannot resolve installed Koffi ${packagedVersion} source for ${packagedKoffi}`,
  )
}

function resolveInstalledKoffiNative(
  desktopRoot: string,
  installedKoffi: string,
  arch: MacUniversalArch,
): string {
  const packageName = `koffi-darwin-${packageArch(arch)}`
  const adjacent = join(dirname(installedKoffi), '@koromix', packageName)
  if (existsSync(adjacent)) return adjacent

  const version = JSON.parse(readFileSync(join(installedKoffi, 'package.json'), 'utf8')).version as string
  const aliasName = `${packageName}-${version.replaceAll('.', '-')}`
  const alias = join(desktopRoot, 'node_modules', aliasName)
  if (existsSync(alias)) return alias

  throw new Error(`cannot resolve installed ${packageName} ${version} source`)
}

/**
 * Restore optional native packages that Electron Builder's npm dependency
 * collector omits across pnpm workspace and nested-version boundaries.
 */
export function hydratePackagedMacRuntime(
  options: PackagedMacRuntimeHydrationOptions,
): void {
  const desktopRoot = resolve(options.desktopRoot)
  const unpackedRoot = resolve(options.unpackedRoot)
  const installedModules = join(desktopRoot, 'node_modules')
  const packagedModules = join(unpackedRoot, 'node_modules')

  for (const arch of options.arches) {
    const suffix = packageArch(arch)
    for (const packagePattern of ROOT_MACOS_NATIVE_PACKAGES) {
      const packageName = packagePattern.replace('{arch}', suffix)
      copyPackage(join(installedModules, packageName), join(packagedModules, packageName))
    }
  }

  for (const packagedKoffi of findNestedKoffiPackages(packagedModules)) {
    const installedKoffi = resolveInstalledKoffi(desktopRoot, unpackedRoot, packagedKoffi)
    const packagedScope = join(dirname(packagedKoffi), '@koromix')
    for (const arch of options.arches) {
      const packageName = `koffi-darwin-${packageArch(arch)}`
      copyPackage(
        resolveInstalledKoffiNative(desktopRoot, installedKoffi, arch),
        join(packagedScope, packageName),
      )
    }
  }
}

/**
 * Validate both CPU runtime trees and restore node-pty helper execute bits.
 * pnpm intentionally disables lifecycle scripts, so the package step owns this
 * deterministic permission repair for both architectures.
 * @param options - Desktop root and injectable filesystem operations.
 */
export function prepareMacUniversalRuntime(
  options: MacUniversalPreparationOptions,
): void {
  const root = resolve(options.desktopRoot)
  const missing = MACOS_UNIVERSAL_NATIVE_ENTRIES
    .map(entry => join(root, entry.path))
    .filter(path => !options.exists(path))
  if (missing.length > 0) {
    throw new Error(
      `universal macOS runtime is missing ${String(missing.length)} native file(s): ${missing.join(', ')}`,
    )
  }

  for (const entry of MACOS_UNIVERSAL_NATIVE_ENTRIES) {
    if (entry.path.endsWith('/spawn-helper')) {
      options.chmod(join(root, entry.path), 0o755)
    }
  }
}

/** Prepare the installed workspace dependency tree for universal packaging. */
export function prepareInstalledMacUniversalRuntime(desktopRoot: string): void {
  prepareMacUniversalRuntime({ desktopRoot, exists: existsSync, chmod: chmodSync })
}
