import { describe, expect, it, vi } from 'vitest'
import { DesktopLanHttpsRuntime } from '../src/lan-https-runtime.ts'

describe('Desktop LAN HTTPS runtime', () => {
  it('fails closed only when an unavailable edge is requested', async () => {
    const runtime = new DesktopLanHttpsRuntime({
      addresses: ['192.168.1.20'],
      failureCode: 'certificate-unavailable',
    })
    runtime.attach(43_120)

    expect(runtime.snapshot()).toEqual({
      state: 'inactive',
      actualPort: null,
      addresses: ['192.168.1.20'],
      caFingerprint: null,
      errorCode: null,
    })
    await expect(runtime.setEnabled(true)).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'certificate-unavailable',
    })
    await expect(runtime.setEnabled(false)).resolves.toMatchObject({
      state: 'inactive',
      errorCode: null,
    })
  })

  it('keeps same-port attachment idempotent and rejects another target', () => {
    const runtime = new DesktopLanHttpsRuntime({ addresses: [] })
    runtime.attach(43_120)
    expect(() => runtime.attach(43_120)).not.toThrow()
    expect(() => runtime.attach(43_121)).toThrow('another port')
  })

  it('rejects non-boolean transitions', async () => {
    const runtime = new DesktopLanHttpsRuntime({ addresses: [] })
    runtime.attach(43_120)
    await expect(runtime.setEnabled('yes' as never)).rejects.toThrow('must be a boolean')
  })

  it('defers certificate preparation until LAN access is requested', async () => {
    const prepareCertificate = vi.fn(async () => ({
      failureCode: 'certificate-unavailable',
    }))
    const runtime = new DesktopLanHttpsRuntime({
      addresses: ['192.168.1.20'],
      prepareCertificate,
    })
    runtime.attach(43_120)

    expect(prepareCertificate).not.toHaveBeenCalled()
    await expect(runtime.setEnabled(false)).resolves.toMatchObject({ state: 'inactive' })
    expect(prepareCertificate).not.toHaveBeenCalled()

    await expect(runtime.setEnabled(true)).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'certificate-unavailable',
    })
    expect(prepareCertificate).toHaveBeenCalledOnce()
  })

  it('does not surface a deferred certificate failure after LAN access is cancelled', async () => {
    let finishPreparation: ((result: { failureCode: string }) => void) | undefined
    const prepareCertificate = vi.fn(() => new Promise<{ failureCode: string }>((resolve) => {
      finishPreparation = resolve
    }))
    const runtime = new DesktopLanHttpsRuntime({
      addresses: ['192.168.1.20'],
      prepareCertificate,
    })
    runtime.attach(43_120)

    const enabling = runtime.setEnabled(true)
    expect(runtime.snapshot().state).toBe('starting')
    await expect(runtime.setEnabled(false)).resolves.toMatchObject({ state: 'inactive' })
    finishPreparation?.({ failureCode: 'certificate-unavailable' })

    await expect(enabling).resolves.toMatchObject({ state: 'inactive', errorCode: null })
    expect(prepareCertificate).toHaveBeenCalledOnce()
  })
})
