import { describe, expect, it } from 'vitest'
import { withAsarModuleResolver } from '../src/asar-module-resolver-state.ts'

const RESOLVER_MARKER = Symbol.for('dsh-plugin-desktop.asar-module-resolver')

describe('ASAR module resolver state', () => {
  it('presents Electron ASAR as a packaged runtime only while healing fallbacks', async () => {
    const packagedProcess = process as NodeJS.Process & { pkg?: unknown }
    const originalDescriptor = Object.getOwnPropertyDescriptor(packagedProcess, 'pkg')
    const originalMarker = (globalThis as Record<PropertyKey, unknown>)[RESOLVER_MARKER]

    expect(originalDescriptor).toBeUndefined()
    expect(originalMarker).toBeUndefined()

    await withAsarModuleResolver(async () => {
      expect(packagedProcess.pkg).toEqual({ runtime: 'electron-asar' })
      expect((globalThis as Record<PropertyKey, unknown>)[RESOLVER_MARKER]).toBe(1)

      await withAsarModuleResolver(async () => {
        expect(packagedProcess.pkg).toEqual({ runtime: 'electron-asar' })
        expect((globalThis as Record<PropertyKey, unknown>)[RESOLVER_MARKER]).toBe(2)
      })

      expect(packagedProcess.pkg).toEqual({ runtime: 'electron-asar' })
      expect((globalThis as Record<PropertyKey, unknown>)[RESOLVER_MARKER]).toBe(1)
    })

    expect(Object.getOwnPropertyDescriptor(packagedProcess, 'pkg')).toEqual(originalDescriptor)
    expect((globalThis as Record<PropertyKey, unknown>)[RESOLVER_MARKER]).toBe(originalMarker)
  })

  it('preserves an existing packaged-runtime marker', async () => {
    const packagedProcess = process as NodeJS.Process & { pkg?: unknown }
    const originalDescriptor = Object.getOwnPropertyDescriptor(packagedProcess, 'pkg')
    const pkg = Object.freeze({ entrypoint: '/snapshot/app.js' })
    Object.defineProperty(packagedProcess, 'pkg', { value: pkg, configurable: true })

    try {
      await withAsarModuleResolver(async () => {
        expect(packagedProcess.pkg).toBe(pkg)
      })
      expect(packagedProcess.pkg).toBe(pkg)
    } finally {
      if (originalDescriptor === undefined) delete packagedProcess.pkg
      else Object.defineProperty(packagedProcess, 'pkg', originalDescriptor)
    }
  })
})
