// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { blockDofeApplicationRoot, dofeAccessSettingsStore, installDofeAccessGate, installDofeAccessStyles } from '../src/client/DofeAccessSection.tsx'
import { DofeOnboardingModal } from '../src/client/DofeOnboardingModal.tsx'

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

  it('lets pointer input pass through the empty gate host after activation', () => {
    const dispose = installDofeAccessStyles()
    const css = document.getElementById('dsh-dofe-access-styles')?.textContent ?? ''

    expect(css).toMatch(/#dsh-dofe-access-gate\s*\{[^}]*pointer-events:\s*none/)
    expect(css).toMatch(/\.dshDofeGate\s*\{[^}]*pointer-events:\s*auto/)

    dispose()
  })

  it('restores root and document interaction when the mandatory gate is released', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = document.getElementById('root') as HTMLElement
    root.inert = false
    document.body.style.overflow = 'auto'

    const release = blockDofeApplicationRoot()
    expect(root.inert).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    release()
    expect(root.inert).toBe(false)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('renders a dedicated non-dismissible activation dialog', () => {
    const markup = renderToStaticMarkup(createElement(DofeOnboardingModal, {
      eyebrow: 'Yootun Agent',
      title: '激活 Yootun-Agent',
      description: '验证访问凭据并选择能力。',
      children: createElement('div', null, '表单'),
    }))

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('dshDofeModalHeader')
    expect(markup).toContain('dshDofeModalBody')
    expect(markup).toContain('Yootun Agent')
    expect(markup).toContain('激活 Yootun-Agent')
    expect(markup).not.toContain('aria-label="关闭"')
  })
})
