// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { dofeAccessSettingsStore, installDofeAccessGate } from '../src/client/DofeAccessSection.tsx'

describe('mandatory DoFe access gate', () => {
  it('preserves the SettingsScope receiver for subscriptions and snapshots', () => {
    const snapshot = { value: undefined }
    const scope = {
      snapshot,
      subscribe(this: { snapshot: typeof snapshot }, listener: () => void) {
        expect(this).toBe(scope)
        listener()
        return () => {}
      },
      getSnapshot(this: { snapshot: typeof snapshot }) {
        expect(this).toBe(scope)
        return this.snapshot
      },
    }

    const store = dofeAccessSettingsStore(scope as never)

    expect(store.getSnapshot()).toBe(snapshot)
    expect(store.subscribe(() => {})).toBeTypeOf('function')
  })

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
