/** Shared preparation and verification inventory for universal macOS packages. */

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
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

const CLOUDFLARED_RELATIVE_PATH = 'node_modules/cloudflared/bin/cloudflared'
const CPU_FEATURES_RELATIVE_PATH = 'node_modules/cpu-features/build/Release/cpufeatures.node'
const SSH_CRYPTO_RELATIVE_PATH = 'node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node'

/** Nested executable that must be merged into a universal binary after thin packaging. */
export const MACOS_UNIVERSAL_CLOUDFLARED_ENTRIES = [
  { arch: 'arm64', path: CLOUDFLARED_RELATIVE_PATH },
  { arch: 'x86_64', path: CLOUDFLARED_RELATIVE_PATH },
] as const satisfies readonly { readonly arch: MacUniversalArch; readonly path: string }[]

/** Nested native addon that must be rebuilt for each thin Electron package. */
export const MACOS_UNIVERSAL_CPU_FEATURES_ENTRIES = [
  { arch: 'arm64', path: CPU_FEATURES_RELATIVE_PATH },
  { arch: 'x86_64', path: CPU_FEATURES_RELATIVE_PATH },
] as const satisfies readonly { readonly arch: MacUniversalArch; readonly path: string }[]

/** Native entries verified in the assembled application, including nested executables. */
export const MACOS_UNIVERSAL_PACKAGED_ENTRIES = [
  ...MACOS_UNIVERSAL_NATIVE_ENTRIES,
  ...MACOS_UNIVERSAL_CLOUDFLARED_ENTRIES,
  ...MACOS_UNIVERSAL_CPU_FEATURES_ENTRIES,
] as const

export interface MacCloudflaredHydrationOptions {
  readonly unpackedRoot: string
  readonly electronBuilderArch: number | undefined
  readonly exists: (path: string) => boolean
  readonly copy: (source: string, target: string) => void
  readonly chmod: (path: string, mode: number) => void
  readonly versionOf: (binary: string) => string
  readonly ensureBinary: (version: string, arch: MacUniversalArch) => string
  readonly verifyArch: (binary: string, arch: MacUniversalArch) => void
}

export interface MacCpuFeaturesHydrationOptions {
  readonly unpackedRoot: string
  readonly electronBuilderArch: number | undefined
  readonly exists: (path: string) => boolean
  readonly copy: (source: string, target: string) => void
  readonly chmod: (path: string, mode: number) => void
  readonly versionOf: (unpackedRoot: string) => string
  readonly ensureBinary: (version: string, arch: MacUniversalArch) => string
  readonly verifyArch: (binary: string, arch: MacUniversalArch) => void
}

function run(command: string, args: readonly string[], cwd?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
  return result.stdout
}

function installedCloudflaredVersion(binary: string): string {
  const output = run(binary, ['--version'])
  const match = /\bversion\s+(\d{4}\.\d+\.\d+)\b/u.exec(output)
  if (match?.[1] === undefined) {
    throw new Error(`cannot determine packaged cloudflared version from ${JSON.stringify(output.trim())}`)
  }
  return match[1]
}

function verifyCloudflaredArch(binary: string, arch: MacUniversalArch): void {
  run('lipo', [binary, '-verify_arch', arch])
}

function ensureCloudflaredBinary(version: string, arch: MacUniversalArch): string {
  const assetArch = arch === 'x86_64' ? 'amd64' : 'arm64'
  const cacheDir = join(tmpdir(), 'yootun-agent-cloudflared', version, arch)
  const cachedBinary = join(cacheDir, 'cloudflared')
  if (existsSync(cachedBinary)) {
    verifyCloudflaredArch(cachedBinary, arch)
    return cachedBinary
  }

  const temporary = mkdtempSync(join(tmpdir(), 'yootun-agent-cloudflared-download-'))
  try {
    const archive = join(temporary, 'cloudflared.tgz')
    const url = `https://github.com/cloudflare/cloudflared/releases/download/${version}/cloudflared-darwin-${assetArch}.tgz`
    run('curl', ['--fail', '--location', '--retry', '3', '--output', archive, url])
    run('tar', ['-xzf', archive, '-C', temporary])
    const downloadedBinary = join(temporary, 'cloudflared')
    verifyCloudflaredArch(downloadedBinary, arch)
    mkdirSync(cacheDir, { recursive: true })
    copyFileSync(downloadedBinary, cachedBinary)
    chmodSync(cachedBinary, 0o755)
    return cachedBinary
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function macArchForElectronBuilder(arch: number | undefined): MacUniversalArch | 'universal' {
  if (arch === 1) return 'x86_64'
  if (arch === 3) return 'arm64'
  if (arch === 4) return 'universal'
  throw new Error(`unsupported macOS Electron Builder arch ${String(arch)}`)
}

/** Replace host-architecture cloudflared with the binary required by each thin package. */
export function hydratePackagedMacCloudflaredRuntime(
  options: MacCloudflaredHydrationOptions,
): void {
  const target = join(resolve(options.unpackedRoot), CLOUDFLARED_RELATIVE_PATH)
  if (!options.exists(target)) throw new Error(`packaged cloudflared is missing at ${target}`)

  const arch = macArchForElectronBuilder(options.electronBuilderArch)
  if (arch === 'universal') {
    options.verifyArch(target, 'x86_64')
    options.verifyArch(target, 'arm64')
    return
  }

  const source = options.ensureBinary(options.versionOf(target), arch)
  options.verifyArch(source, arch)
  options.copy(source, target)
  options.chmod(target, 0o755)
  options.verifyArch(target, arch)
}

/** Hydrate cloudflared using the real filesystem and architecture tools. */
export function hydrateInstalledMacCloudflaredRuntime(
  unpackedRoot: string,
  electronBuilderArch: number | undefined,
): void {
  hydratePackagedMacCloudflaredRuntime({
    unpackedRoot,
    electronBuilderArch,
    exists: existsSync,
    copy: copyFileSync,
    chmod: chmodSync,
    versionOf: installedCloudflaredVersion,
    ensureBinary: ensureCloudflaredBinary,
    verifyArch: verifyCloudflaredArch,
  })
}

function packagedCpuFeaturesVersion(unpackedRoot: string): string {
  const manifest = join(resolve(unpackedRoot), 'node_modules/cpu-features/package.json')
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version
}

function ensureCpuFeaturesBinary(
  desktopRoot: string,
  version: string,
  arch: MacUniversalArch,
): string {
  const electronVersion = (JSON.parse(
    readFileSync(join(desktopRoot, 'node_modules/electron/package.json'), 'utf8'),
  ) as { version: string }).version
  const cacheDir = join(
    tmpdir(),
    'yootun-agent-cpu-features',
    version,
    `electron-${electronVersion}`,
    arch,
  )
  const cachedBinary = join(cacheDir, 'cpufeatures.node')
  if (existsSync(cachedBinary)) {
    verifyCloudflaredArch(cachedBinary, arch)
    return cachedBinary
  }

  const workspaceRoot = dirname(desktopRoot)
  const installedModules = join(
    workspaceRoot,
    'node_modules',
    '.pnpm',
    `cpu-features@${version}`,
    'node_modules',
  )
  const sourcePackage = join(installedModules, 'cpu-features')
  if (!existsSync(join(sourcePackage, 'binding.gyp'))) {
    throw new Error(`cannot resolve installed cpu-features ${version} source`)
  }

  const temporary = mkdtempSync(join(tmpdir(), 'yootun-agent-cpu-features-build-'))
  try {
    const temporaryModules = join(temporary, 'node_modules')
    const buildPackage = join(temporaryModules, 'cpu-features')
    mkdirSync(temporaryModules, { recursive: true })
    cpSync(sourcePackage, buildPackage, { recursive: true, force: true, dereference: true })
    rmSync(join(buildPackage, 'build'), { recursive: true, force: true })
    for (const dependency of ['buildcheck', 'nan']) {
      cpSync(join(installedModules, dependency), join(temporaryModules, dependency), {
        recursive: true,
        force: true,
        dereference: true,
      })
    }
    writeFileSync(
      join(buildPackage, 'buildcheck.gypi'),
      run(process.execPath, [join(buildPackage, 'buildcheck.js')], buildPackage),
    )

    const desktopRequire = createRequire(join(desktopRoot, 'package.json'))
    const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'))
    const nodeGyp = builderRequire.resolve('node-gyp/bin/node-gyp.js')
    run(process.execPath, [
      nodeGyp,
      'rebuild',
      `--arch=${arch === 'x86_64' ? 'x64' : 'arm64'}`,
      `--target=${electronVersion}`,
      '--dist-url=https://electronjs.org/headers',
    ], buildPackage)

    const builtBinary = join(buildPackage, 'build/Release/cpufeatures.node')
    verifyCloudflaredArch(builtBinary, arch)
    mkdirSync(cacheDir, { recursive: true })
    copyFileSync(builtBinary, cachedBinary)
    chmodSync(cachedBinary, 0o755)
    return cachedBinary
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/** Replace the host-built cpu-features addon with the thin package's target CPU. */
export function hydratePackagedMacCpuFeaturesRuntime(
  options: MacCpuFeaturesHydrationOptions,
): void {
  const target = join(resolve(options.unpackedRoot), CPU_FEATURES_RELATIVE_PATH)
  if (!options.exists(target)) throw new Error(`packaged cpu-features is missing at ${target}`)

  const arch = macArchForElectronBuilder(options.electronBuilderArch)
  if (arch === 'universal') {
    options.verifyArch(target, 'x86_64')
    options.verifyArch(target, 'arm64')
    return
  }

  const source = options.ensureBinary(options.versionOf(options.unpackedRoot), arch)
  options.verifyArch(source, arch)
  options.copy(source, target)
  options.chmod(target, 0o755)
  options.verifyArch(target, arch)
}

/** Hydrate cpu-features using the installed source and Electron target ABI. */
export function hydrateInstalledMacCpuFeaturesRuntime(
  desktopRoot: string,
  unpackedRoot: string,
  electronBuilderArch: number | undefined,
): void {
  hydratePackagedMacCpuFeaturesRuntime({
    unpackedRoot,
    electronBuilderArch,
    exists: existsSync,
    copy: copyFileSync,
    chmod: chmodSync,
    versionOf: packagedCpuFeaturesVersion,
    ensureBinary: (version, arch) => ensureCpuFeaturesBinary(desktopRoot, version, arch),
    verifyArch: verifyCloudflaredArch,
  })
}

/** Disable SSH2's Node/OpenSSL accelerator; Electron uses the built-in JS crypto fallback. */
export function disablePackagedMacSshCryptoRuntime(unpackedRoot: string): void {
  writeFileSync(join(resolve(unpackedRoot), SSH_CRYPTO_RELATIVE_PATH), '')
}

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
