// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { installDofeAccessGate } from '../src/client/DofeAccessSection.tsx'

describe('mandatory DoFe access gate', () => {
  it('mounts outside the session-dependent application root and fully cleans up', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const render = vi.fn()
    const unmount = vi.fn()
    const createRoot = vi.fn(() => ({ render, unmount }))

    const dispose = installDofeAccessGate({} as never, createRoot as never)

    const host = document.getElementById('dsh-dofe-access-gate')
    expect(host).not.toBeNull()
    expect(host?.parentElement).toBe(document.body)
    expect(createRoot).toHaveBeenCalledWith(host)
    expect(render).toHaveBeenCalledOnce()

    dispose()

    expect(unmount).toHaveBeenCalledOnce()
    expect(document.getElementById('dsh-dofe-access-gate')).toBeNull()
  })
})
