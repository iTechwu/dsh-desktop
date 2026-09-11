import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finished } from 'node:stream/promises'
import { describe, expect, it, vi } from 'vitest'
import { beforePack, buildMacSystemRuntime, installedMacSystemPackage } from '../scripts/mac-system-runtime.ts'

describe('macOS system binding package preparation', () => {
  it('runs before native dependency collection for every package entry point', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest.build.beforePack).toBe('./scripts/mac-system-runtime.ts')
  })

  it.each([
    [1, ['x64']], [3, ['arm64']], [4, ['arm64', 'x64']],
  ] as const)('builds the declared target for Electron Builder arch %s', (arch, arches) => {
    const build = vi.fn()
    beforePack({ electronPlatformName: 'darwin', arch, packager: { projectDir: '/desktop' } }, build)
    expect(build).toHaveBeenCalledExactlyOnceWith({ desktopRoot: '/desktop', arches })
  })

  it('rejects unsupported macOS targets without compiling and leaves other platforms alone', () => {
    const build = vi.fn()
    expect(() => beforePack({ electronPlatformName: 'darwin', arch: 0,
      packager: { projectDir: '/desktop' } }, build)).toThrow('unsupported macOS package architecture')
    beforePack({ electronPlatformName: 'win32', arch: 1, packager: { projectDir: '/desktop' } }, build)
    beforePack({ electronPlatformName: 'linux', arch: 3, packager: { projectDir: '/desktop' } }, build)
    expect(build).not.toHaveBeenCalled()
  })

  // Both Mach-O targets need Apple's compiler; Electron loads the host slice headlessly.
  it.skipIf(process.platform !== 'darwin')('loads a freshly compiled lock binding from ASAR in Electron', async () => {
    const desktopRoot = fileURLToPath(new URL('../', import.meta.url))
    const require = createRequire(join(desktopRoot, 'package.json'))
    const root = mkdtempSync(join(tmpdir(), 'dsh-system-asar-'))
    try {
      const outputRoot = join(root, 'build')
      buildMacSystemRuntime({ desktopRoot, arches: ['arm64', 'x64'], outputRoot })
      const consumer = require.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json')
      const entry = dirname(createRequire(consumer).resolve('@deepseek-ai/node-addon-system/package.json'))
      const source = join(root, 'source')
      const packagedEntry = join(source, 'node_modules/@deepseek-ai/node-addon-system')
      mkdirSync(packagedEntry, { recursive: true })
      cpSync(join(entry, 'package.json'), join(packagedEntry, 'package.json'))
      cpSync(join(entry, 'lib'), join(packagedEntry, 'lib'), { recursive: true })
      for (const arch of ['arm64', 'x64'] as const) {
        const platform = join(source, `node_modules/@deepseek-ai/node-addon-system-darwin-${arch}`)
        mkdirSync(platform, { recursive: true })
        cpSync(join(installedMacSystemPackage(desktopRoot, arch), 'package.json'), join(platform, 'package.json'))
        cpSync(join(outputRoot, arch, 'bin'), join(platform, 'bin'), { recursive: true })
      }
      const archive = join(root, 'app.asar')
      const archiveStream = await require('@electron/asar').createPackageWithOptions(source, archive,
        { unpack: '**/*.node' })
      // asar 3 returns out.end(), which can precede the write stream's finish event.
      await finished(archiveStream)
      const script = `
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        const { pathToFileURL } = require('node:url');
        (async () => {
          const { tryLockExclusive } = await import(pathToFileURL(${JSON.stringify(join(archive, 'node_modules/@deepseek-ai/node-addon-system/lib/flock.js'))}).href);
          const file = ${JSON.stringify(join(root, 'lock'))};
          let first = fs.openSync(file, 'w');
          const second = fs.openSync(file, 'r+');
          try {
            await tryLockExclusive(first);
            await assert.rejects(tryLockExclusive(second), { code: 'EAGAIN' });
            fs.closeSync(first); first = undefined;
            await tryLockExclusive(second);
            console.log('ELECTRON_ASAR_SYSTEM_LOCK_OK', process.versions.electron, process.arch);
          } finally {
            if (first !== undefined) fs.closeSync(first);
            fs.closeSync(second);
          }
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `
      const result = spawnSync(require('electron'), ['-e', script], {
        encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('ELECTRON_ASAR_SYSTEM_LOCK_OK')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
