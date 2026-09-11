/** Build the fork's stable Node-API lock binding for macOS package targets. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

export type MacSystemArch = 'arm64' | 'x64'

/** Resolve platform payloads through their actual session-persistence consumer. */
export function installedMacSystemPackage(desktopRoot: string, arch: MacSystemArch): string {
  const desktop = createRequire(join(resolve(desktopRoot), 'package.json'))
  const consumer = desktop.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json')
  const entry = createRequire(consumer).resolve('@deepseek-ai/node-addon-system/package.json')
  return dirname(createRequire(entry).resolve(`@deepseek-ai/node-addon-system-darwin-${arch}/package.json`))
}

/**
 * Compile into an isolated directory and atomically publish the completed payload.
 * Node-API v8 works in both Node and Electron without replacing an ABI-specific binding.
 */
export function buildMacSystemRuntime(options: {
  readonly desktopRoot: string
  readonly arches: readonly MacSystemArch[]
  /** Isolated output for artifact rehearsals; normal builds use platform package roots. */
  readonly outputRoot?: string
}): void {
  if (process.platform !== 'darwin') throw new Error('macOS system bindings must be built on macOS')
  const desktop = createRequire(join(resolve(options.desktopRoot), 'package.json'))
  const consumer = desktop.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json')
  const entry = dirname(createRequire(consumer).resolve('@deepseek-ai/node-addon-system/package.json'))
  const source = join(entry, 'src/flock.c')
  const headers = resolve(dirname(process.execPath), '../include/node')
  if (!existsSync(join(headers, 'node_api.h'))) throw new Error(`Node-API headers missing: ${headers}`)
  for (const arch of options.arches) {
    if (arch !== 'arm64' && arch !== 'x64') throw new Error(`unsupported macOS system architecture: ${String(arch)}`)
    const platformRoot = installedMacSystemPackage(options.desktopRoot, arch)
    const metadata = JSON.parse(readFileSync(join(platformRoot, 'prebuilds.json'), 'utf8')) as {
      platform?: string
      binaries?: Array<{ tool?: string; kind?: string; napi?: number; path?: string }>
    }
    const binary = metadata.binaries?.find(value => value.tool === 'flock')
    if (metadata.platform !== `darwin-${arch}` || binary?.kind !== 'node-api'
      || binary.napi !== 8 || binary.path !== 'bin/system.node') {
      throw new Error(`unsupported macOS system payload declaration: ${platformRoot}`)
    }
    const destination = options.outputRoot === undefined ? platformRoot : join(options.outputRoot, arch)
    const output = join(destination, binary.path)
    mkdirSync(dirname(output), { recursive: true })
    const temporary = mkdtempSync(join(dirname(output), '.system-build-'))
    const pending = join(temporary, 'system.node')
    const target = arch === 'x64' ? 'x86_64' : arch
    try {
      for (const [command, args] of [
        ['cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-fvisibility=hidden',
          '-DNAPI_VERSION=8', '-I', headers, '-bundle', '-undefined', 'dynamic_lookup',
          '-mmacosx-version-min=11.0', '-arch', target, '-o', pending, source]],
        ['lipo', [pending, '-verify_arch', target]],
      ] as const) {
        const result = spawnSync(command, args, { encoding: 'utf8' })
        if (result.error) throw result.error
        if (result.status !== 0) throw new Error(`${command} failed for darwin-${arch}: ${result.stderr}`)
      }
      renameSync(pending, output)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}

/** Prepare native payloads before Electron Builder collects the dependency tree. */
export function beforePack(context: {
  readonly electronPlatformName: string
  readonly arch?: number
  readonly packager: { readonly projectDir: string }
}, build = buildMacSystemRuntime): void {
  if (context.electronPlatformName !== 'darwin') return
  const arches: readonly MacSystemArch[] = context.arch === 1 ? ['x64']
    : context.arch === 3 ? ['arm64'] : context.arch === 4 ? ['arm64', 'x64'] : []
  if (arches.length === 0) throw new Error(`unsupported macOS package architecture: ${String(context.arch)}`)
  build({ desktopRoot: context.packager.projectDir, arches })
}

export default beforePack
