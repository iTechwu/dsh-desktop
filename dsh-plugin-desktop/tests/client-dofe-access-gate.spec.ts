// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { blockDofeApplicationRoot, dofeAccessSettingsStore, installDofeAccessGate, installDofeAccessStyles, mutateDofeAccessSettings, removeDofeAccess } from '../src/client/DofeAccessSection.tsx'
import { DofeOnboardingModal, installDofeModalFocusTrap } from '../src/client/DofeOnboardingModal.tsx'

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

  it('keeps filled controls legible across light and dark themes', () => {
    const dispose = installDofeAccessStyles()
    const css = document.getElementById('dsh-dofe-access-styles')?.textContent ?? ''

    expect(css).toContain('color: var(--dsw-alias-label-primary-foreground, #fff)')
    expect(css).toContain('background: var(--dsw-alias-button-primary-hover, #1d4fc7)')
    expect(css).not.toMatch(/color:\s*#fff;\s*background:\s*var\(--dsw-alias-brand-primary/)

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

  it('keeps keyboard focus inside the standalone activation dialog', () => {
    const modal = document.createElement('section')
    const first = document.createElement('button')
    const last = document.createElement('button')
    const outside = document.createElement('button')
    modal.append(first, last)
    document.body.append(modal, outside)

    const dispose = installDofeModalFocusTrap(modal)
    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(last)
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(first)

    outside.focus()
    expect(document.activeElement).toBe(first)
    dispose()
  })

  it('retries access setting conflicts and reports a final rejection', async () => {
    const revisions = [4, 5]
    const used: number[] = []
    const settingsApi = {
      describe: vi.fn(async () => ({ ok: true, value: { namespaces: [{ ns: 'dofe-access', revision: revisions.shift() }] } })),
      mutate: vi.fn(async (_namespace, _operations, revision) => {
        used.push(revision)
        return used.length === 1
          ? { ok: false, error: { code: 'settings/conflict', message: 'conflict' } }
          : { ok: true, value: {} }
      }),
    }

    await mutateDofeAccessSettings(settingsApi as never, [{ op: 'set', path: ['modelId'], value: 'deepseek-chat' }])
    expect(used).toEqual([4, 5])

    await expect(mutateDofeAccessSettings({
      describe: vi.fn(async () => ({ ok: true, value: { namespaces: [{ ns: 'dofe-access', revision: 6 }] } })),
      mutate: vi.fn(async () => ({ ok: false, error: { code: 'settings/rejected', message: 'rejected' } })),
    } as never, [])).rejects.toThrow('rejected')
  })

  it('revokes access before deleting the key and stops when revocation fails', async () => {
    const calls: string[] = []
    const settingsApi = {
      describe: vi.fn(async () => {
        calls.push('describe')
        return { ok: true, value: { namespaces: [{ ns: 'dofe-access', revision: 7 }] } }
      }),
      mutate: vi.fn(async () => {
        calls.push('revoke')
        return { ok: true, value: {} }
      }),
    }
    const credentials = {
      unset: vi.fn(async () => {
        calls.push('unset')
        return { ok: true, value: undefined }
      }),
    }

    await removeDofeAccess(settingsApi as never, credentials as never)
    expect(calls).toEqual(['describe', 'revoke', 'unset'])

    const unset = vi.fn()
    await expect(removeDofeAccess({
      describe: vi.fn(async () => ({ ok: true, value: { namespaces: [{ ns: 'dofe-access', revision: 8 }] } })),
      mutate: vi.fn(async () => ({ ok: false, error: { code: 'settings/rejected', message: 'rejected' } })),
    } as never, { unset } as never)).rejects.toThrow('rejected')
    expect(unset).not.toHaveBeenCalled()
  })

  it('locks every access form operation while a request is active', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/client/DofeAccessSection.tsx'), 'utf8')

    expect(source).toContain('const loadingRef = useRef(false)')
    expect(source).toContain('const busyRef = useRef(false)')
    expect(source).toContain('if (!key || loadingRef.current || busyRef.current) return')
    expect(source).toContain('if (busyRef.current || loadingRef.current || (!key && !useStoredCredential)')
    expect(source).toContain('if (busyRef.current || loadingRef.current) return')
    expect(source).toContain('aria-busy={interactionBusy}')
    expect(source).toContain('disabled={interactionBusy}')
  })
})
