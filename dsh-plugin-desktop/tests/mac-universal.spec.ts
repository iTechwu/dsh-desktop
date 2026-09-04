import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  hydratePackagedMacRuntime,
  hydratePackagedMacCloudflaredRuntime,
  hydratePackagedMacCpuFeaturesRuntime,
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
  prepareInstalledMacUniversalRuntime,
  prepareMacUniversalRuntime,
  disablePackagedMacSshCryptoRuntime,
} from '../scripts/mac-universal.ts'

describe('universal macOS native runtime preparation', () => {
  it.each([
    [1, 'x86_64'],
    [3, 'arm64'],
  ] as const)('hydrates cloudflared for Electron Builder arch %s', (electronBuilderArch, arch) => {
    const calls: string[] = []
    hydratePackagedMacCloudflaredRuntime({
      unpackedRoot: '/package',
      electronBuilderArch,
      exists: () => true,
      copy: (source, target) => calls.push(`copy:${source}:${target}`),
      chmod: (path, mode) => calls.push(`chmod:${path}:${mode.toString(8)}`),
      versionOf: binary => {
        calls.push(`version:${binary}`)
        return '2026.8.3'
      },
      ensureBinary: (version, requestedArch) => {
        calls.push(`ensure:${version}:${requestedArch}`)
        return `/cache/${requestedArch}/cloudflared`
      },
      verifyArch: (binary, requestedArch) => calls.push(`verify:${binary}:${requestedArch}`),
    })

    const target = join('/package', 'node_modules/cloudflared/bin/cloudflared')
    expect(calls).toEqual([
      `version:${target}`,
      `ensure:2026.8.3:${arch}`,
      `verify:/cache/${arch}/cloudflared:${arch}`,
      `copy:/cache/${arch}/cloudflared:${target}`,
      `chmod:${target}:755`,
      `verify:${target}:${arch}`,
    ])
  })

  it('verifies both cloudflared slices after universal assembly', () => {
    const verified: string[] = []
    hydratePackagedMacCloudflaredRuntime({
      unpackedRoot: '/package',
      electronBuilderArch: 4,
      exists: () => true,
      copy: vi.fn(),
      chmod: vi.fn(),
      versionOf: vi.fn(() => '2026.8.3'),
      ensureBinary: vi.fn(() => '/unused'),
      verifyArch: (binary, arch) => verified.push(`${binary}:${arch}`),
    })

    const target = join('/package', 'node_modules/cloudflared/bin/cloudflared')
    expect(verified).toEqual([`${target}:x86_64`, `${target}:arm64`])
  })

  it.each([
    [1, 'x86_64'],
    [3, 'arm64'],
  ] as const)('hydrates cpu-features for Electron Builder arch %s', (electronBuilderArch, arch) => {
    const calls: string[] = []
    hydratePackagedMacCpuFeaturesRuntime({
      unpackedRoot: '/package',
      electronBuilderArch,
      exists: () => true,
      copy: (source, target) => calls.push(`copy:${source}:${target}`),
      chmod: (path, mode) => calls.push(`chmod:${path}:${mode.toString(8)}`),
      versionOf: root => {
        calls.push(`version:${root}`)
        return '0.0.10'
      },
      ensureBinary: (version, requestedArch) => {
        calls.push(`ensure:${version}:${requestedArch}`)
        return `/cache/${requestedArch}/cpufeatures.node`
      },
      verifyArch: (binary, requestedArch) => calls.push(`verify:${binary}:${requestedArch}`),
    })

    const target = join(
      '/package',
      'node_modules/cpu-features/build/Release/cpufeatures.node',
    )
    expect(calls).toEqual([
      'version:/package',
      `ensure:0.0.10:${arch}`,
      `verify:/cache/${arch}/cpufeatures.node:${arch}`,
      `copy:/cache/${arch}/cpufeatures.node:${target}`,
      `chmod:${target}:755`,
      `verify:${target}:${arch}`,
    ])
  })

  it('verifies both cpu-features slices after universal assembly', () => {
    const verified: string[] = []
    hydratePackagedMacCpuFeaturesRuntime({
      unpackedRoot: '/package',
      electronBuilderArch: 4,
      exists: () => true,
      copy: vi.fn(),
      chmod: vi.fn(),
      versionOf: vi.fn(() => '0.0.10'),
      ensureBinary: vi.fn(() => '/unused'),
      verifyArch: (binary, arch) => verified.push(`${binary}:${arch}`),
    })

    const target = join(
      '/package',
      'node_modules/cpu-features/build/Release/cpufeatures.node',
    )
    expect(verified).toEqual([`${target}:x86_64`, `${target}:arm64`])
  })

  it('disables the SSH2 Node/OpenSSL accelerator in macOS packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-mac-sshcrypto-'))
    const binary = join(
      root,
      'node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node',
    )
    try {
      mkdirSync(dirname(binary), { recursive: true })
      writeFileSync(binary, 'host-native')

      disablePackagedMacSshCryptoRuntime(root)

      expect(existsSync(binary)).toBe(true)
      expect(readFileSync(binary)).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prepares every native file from the installed desktop deploy root', () => {
    const desktopRoot = fileURLToPath(new URL('../', import.meta.url))

    expect(() => prepareInstalledMacUniversalRuntime(desktopRoot)).not.toThrow()
  })

  it('requires every CPU-specific file and repairs both node-pty helpers', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')

    prepareMacUniversalRuntime({ desktopRoot, exists: () => true, chmod })

    expect(chmod.mock.calls).toEqual([
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755],
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'), 0o755],
    ])
  })

  it('fails before changing permissions when one architecture is incomplete', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')
    const missing = MACOS_UNIVERSAL_NATIVE_ENTRIES.at(-1)!.path

    expect(() => prepareMacUniversalRuntime({
      desktopRoot,
      exists: path => path !== join(desktopRoot, missing),
      chmod,
    })).toThrow(join(desktopRoot, missing))
    expect(chmod).not.toHaveBeenCalled()
  })

  it('hydrates arm64 native packages and version-matched nested Koffi packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-mac-runtime-'))
    const desktopRoot = join(root, 'desktop')
    const unpackedRoot = join(root, 'app.asar.unpacked')
    const installedModules = join(desktopRoot, 'node_modules')
    const packagedModules = join(unpackedRoot, 'node_modules')
    const installedKoffi = join(installedModules, 'koffi')
    const packagedKoffi = join(packagedModules, '@deepseek-ai', 'consumer', 'node_modules', 'koffi')
    const installedKoffiNative = join(
      installedModules,
      '@koromix',
      'koffi-darwin-arm64',
      'darwin_arm64',
    )
    const versionedKoffi = join(
      root,
      'node_modules',
      '.pnpm',
      'koffi@3.1.1',
      'node_modules',
      'koffi',
    )
    const versionedKoffiNative = join(
      dirname(versionedKoffi),
      '@koromix',
      'koffi-darwin-arm64',
      'darwin_arm64',
    )
    const aliasedKoffiX64 = join(installedModules, 'koffi-darwin-x64-3-1-1')
    const aliasedKoffiX64Native = join(aliasedKoffiX64, 'darwin_x64')
    const sharpNative = join(installedModules, '@img', 'sharp-darwin-arm64', 'lib')

    try {
      mkdirSync(installedKoffi, { recursive: true })
      mkdirSync(join(installedModules, '@deepseek-ai', 'consumer'), { recursive: true })
      mkdirSync(packagedKoffi, { recursive: true })
      mkdirSync(installedKoffiNative, { recursive: true })
      mkdirSync(versionedKoffi, { recursive: true })
      mkdirSync(versionedKoffiNative, { recursive: true })
      mkdirSync(aliasedKoffiX64Native, { recursive: true })
      mkdirSync(sharpNative, { recursive: true })
      writeFileSync(
        join(installedKoffi, 'package.json'),
        '{"name":"koffi","version":"3.1.5","exports":{".":"./index.js"}}',
      )
      writeFileSync(join(installedKoffi, 'index.js'), 'export default {}')
      writeFileSync(
        join(installedModules, '@deepseek-ai', 'consumer', 'package.json'),
        '{"name":"@deepseek-ai/consumer"}',
      )
      writeFileSync(join(packagedKoffi, 'package.json'), '{"name":"koffi","version":"3.1.1"}')
      writeFileSync(join(installedKoffiNative, 'koffi.node'), 'koffi-3.1.5-arm64')
      writeFileSync(join(versionedKoffi, 'package.json'), '{"name":"koffi","version":"3.1.1"}')
      writeFileSync(join(versionedKoffiNative, 'koffi.node'), 'koffi-3.1.1-arm64')
      writeFileSync(
        join(aliasedKoffiX64, 'package.json'),
        '{"name":"@koromix/koffi-darwin-x64","version":"3.1.1"}',
      )
      writeFileSync(join(aliasedKoffiX64Native, 'koffi.node'), 'koffi-3.1.1-x64')
      writeFileSync(join(sharpNative, 'sharp.node'), 'sharp-arm64')
      mkdirSync(join(packagedModules, '@img'), { recursive: true })
      symlinkSync(
        join(installedModules, '@img', 'sharp-darwin-arm64'),
        join(packagedModules, '@img', 'sharp-darwin-arm64'),
      )

      hydratePackagedMacRuntime({ desktopRoot, unpackedRoot, arches: ['arm64', 'x86_64'] })

      expect(existsSync(join(
        packagedModules,
        '@img',
        'sharp-darwin-arm64',
        'lib',
        'sharp.node',
      ))).toBe(true)
      expect(readFileSync(join(
        packagedModules,
        '@deepseek-ai',
        'consumer',
        'node_modules',
        '@koromix',
        'koffi-darwin-arm64',
        'darwin_arm64',
        'koffi.node',
      ), 'utf8')).toBe('koffi-3.1.1-arm64')
      expect(readFileSync(join(
        packagedModules,
        '@deepseek-ai',
        'consumer',
        'node_modules',
        '@koromix',
        'koffi-darwin-x64',
        'darwin_x64',
        'koffi.node',
      ), 'utf8')).toBe('koffi-3.1.1-x64')
      expect(lstatSync(join(packagedModules, '@img', 'sharp-darwin-arm64')).isSymbolicLink())
        .toBe(false)
      expect(existsSync(join(
        packagedModules,
        '@deepseek-ai',
        'consumer',
        'node_modules',
        '@koromix',
        'koffi-darwin-arm64',
        'darwin_arm64',
        'koffi.node',
      ))).toBe(true)
      expect(existsSync(join(packagedModules, '@img', 'sharp-darwin-x64'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
