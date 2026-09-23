// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { blockDofeApplicationRoot, dofeAccessSettingsStore, dofeModelsRequestBody, installDofeAccessGate, installDofeAccessStyles, mutateDofeAccessSettings, removeDofeAccess } from '../src/client/DofeAccessSection.tsx'
import { DofeOnboardingModal, installDofeModalFocusTrap } from '../src/client/DofeOnboardingModal.tsx'

// This suite covers manual-key activation; Sensteed SSO has its own suite.
vi.mock('../src/generated-product-identity.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/generated-product-identity.ts')>(),
  BRAND_VARIANT: 'yootun', BRAND_TENANT: 'yootun',
}))

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
    expect((document.getElementById('root') as HTMLElement).inert).toBe(true)

    dispose()

    expect(unmount).toHaveBeenCalledOnce()
    expect(document.getElementById('dsh-dofe-access-gate')).toBeNull()
    expect((document.getElementById('root') as HTMLElement).inert).toBe(false)
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
    expect(source).toContain('if ((!request.key && !request.useStored) || loadingRef.current || busyRef.current) return')
    expect(source).toContain('if (busyRef.current || loadingRef.current || (!key && !useStoredCredential)')
    expect(source).toContain('if (busyRef.current || loadingRef.current) return')
    expect(source).toContain('aria-busy={interactionBusy}')
    expect(source).toContain('disabled={interactionBusy}')
    expect(source).toContain('const checked = event.currentTarget.checked; setEnabledPlugins(current => checked')
    expect(source).not.toContain('setEnabledPlugins(current => event.currentTarget.checked')
  })

  it('surfaces credential read failures in the settings form', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/client/DofeAccessSection.tsx'), 'utf8')

    expect(source).toContain("if (!cancelled) setError(t('loadError'))")
  })

  it('surfaces tenant ownership failures as actionable access errors', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/client/DofeAccessSection.tsx'), 'utf8')

    expect(source).toContain("failureReason === 'tenant_mismatch' ? t('tenantMismatch') : failureReason === 'tenant_unavailable' ? t('tenantUnavailable')")
    expect(source).toContain("validation.reason === 'tenant_mismatch' ? t('tenantMismatch') : validation.reason === 'tenant_unavailable' ? t('tenantUnavailable')")
  })

  it('removes stale protocol routes whenever the selected protocol is saved', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/client/DofeAccessSection.tsx'), 'utf8')

    expect(source).toContain("const route = protocol === 'messages' ? 'dofe-messages' : protocol === 'responses' ? 'dofe-responses' : 'dofe-chat'")
    expect(source).toContain("const api = protocol === 'messages' ? 'anthropic-messages' : protocol === 'responses' ? 'openai-responses' : 'openai-completions'")
    expect(source).toContain("{ op: 'unset', path: ['providers', 'dofe-chat'] }")
    expect(source).toContain("{ op: 'unset', path: ['providers', 'dofe-messages'] }")
    expect(source).toContain("{ op: 'unset', path: ['providers', 'dofe-responses'] }")
    expect(source).toContain("value: protocol === 'responses' ? 'dofe-responses' : protocol === 'messages' ? 'dofe-messages' : 'dofe-chat'")
    expect(source).not.toContain("settingsApi.mutate('llm-deepseek'")
    expect(source).toContain('DOFE_ANTHROPIC_BASE_URL')
    expect(source).not.toContain("'https://ixicai.cn/anthropic'")
  })

  it('renders the protocol picker as a radiogroup above the merged model row', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/client/DofeAccessSection.tsx'), 'utf8')

    expect(source).toContain('role="radiogroup"')
    expect(source).toContain('aria-labelledby="dofe-protocol-label"')
    expect(source).toContain('type="radio"')
    expect(source).toContain('name="dofe-protocol"')
    expect(source).toContain('loadModels({ protocol: p })')
    expect(source).not.toContain('id="dofe-protocol-select"')
    expect(source.indexOf('dshDofeAccessProtocols')).toBeLessThan(source.indexOf('dshDofeAccessModelRow'))
  })

  it('offers only the OpenAI-compatible and Anthropic Messages protocols in the UI', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/client/DofeAccessSection.tsx'), 'utf8')

    expect(source).toContain('{UI_DOFE_PROTOCOLS.map(')
    expect(source).toContain("p === 'messages' ? t('protocolMessages') : t('protocolChat')")
    expect(source).not.toContain('value="responses"')
    expect(source).not.toContain("{t('protocolResponses')}")
    expect(source).toContain('normalizeDofeUiProtocol(settings.value?.protocol)')
  })

  it('asks the host to resolve stored credentials only when no draft key is entered', () => {
    expect(dofeModelsRequestBody('  ', true, 'messages')).toEqual({ key: '', protocol: 'messages', useStored: true })
    expect(dofeModelsRequestBody('  ', undefined, 'messages')).toEqual({ key: '', protocol: 'messages', useStored: false })
    expect(dofeModelsRequestBody(' entered-secret ', true, 'chat-completions')).toEqual({ key: 'entered-secret', protocol: 'chat-completions', useStored: false })
  })

  it('keeps the load-models request free of stored-credential leakage when a draft key exists', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/client/DofeAccessSection.tsx'), 'utf8')

    expect(source).toContain('body: JSON.stringify(request),')
    expect(source).toContain('const request = dofeModelsRequestBody(overrides.key ?? draft, overrides.configured ?? configured, overrides.protocol ?? protocol)')
    expect(source).not.toContain('const key = (keyOverride ?? draft).trim()')
  })

  it('closes the settings panel behind a success toast after a verified save', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/client/DofeAccessSection.tsx'), 'utf8')

    // The banner mounts at section level (body portal) so closing the shell
    // panel cannot unmount it mid-hold.
    expect(source).toContain("{success && <Toast text={props.t('loginSuccess')} icon={<Check size={18} />} onDone={() => setSuccess(false)} />}")
    expect(source).toContain('const onDone = props.close === undefined ? undefined : (): void => { setSuccess(true); props.close() }')
  })
})
