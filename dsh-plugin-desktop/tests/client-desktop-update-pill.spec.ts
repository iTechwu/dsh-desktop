// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { applyDesktopSettings } from '../src/client/desktop-settings.ts'
import type { DesktopSettingsForm } from '../src/client/settings-bridge.ts'

const disposers: Array<() => void | Promise<void>> = []

function settingsRow(): HTMLElement {
  const foot = document.createElement('div')
  foot.className = 'footArea'
  const row = document.createElement('div')
  const button = document.createElement('button')
  button.setAttribute('aria-haspopup', 'dialog')
  row.append(button)
  foot.append(row)
  document.body.append(foot)
  return row
}

async function mountPill(): Promise<HTMLElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const row = settingsRow()
  const scope = {
    getSnapshot: () => ({ status: 'loading' as const, value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' as const }),
    subscribe: () => () => {},
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
    mutate: vi.fn(async () => true),
  } satisfies DesktopSettingsForm<unknown>
  const ctx = {
    configForms: { get: () => scope },
    locale: {
      bind: () => (key: string) => key,
      register: () => () => {},
    },
    effect: (register: () => (() => void) | undefined) => {
      const dispose = register()
      disposers.push(dispose ?? (() => {}))
    },
    slots: {
      inject: () => () => {},
      register: () => () => {},
    },
  } as unknown as ClientContext

  applyDesktopSettings(ctx, {
    version: '2.0.3',
    mode: 'compatibility',
    platform: 'win32',
    material: 'off',
    micaSupported: false,
  })
  await act(async () => { await Promise.resolve() })

  const host = row.querySelector<HTMLDivElement>('.dshDesktopUpdateBadgeHost')
  if (host === null) throw new Error('update pill host was not mounted into the settings row')
  return row
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  document.querySelectorAll('.footArea').forEach(node => node.remove())
  vi.unstubAllGlobals()
})

describe('sidebar update pill mounting', () => {
  it('mounts the pill beside the Settings control inside the settings row', async () => {
    const row = await mountPill()
    const host = row.querySelector('.dshDesktopUpdateBadgeHost')
    expect(host).not.toBeNull()
    // The pill sits after the Settings trigger inside the same row.
    expect(host!.previousElementSibling?.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('does not register the pill as a sidebar.footer.action slot entry', async () => {
    const inject = vi.fn((_name: string) => () => {})
    const scope = {
      getSnapshot: () => ({ status: 'loading' as const, value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' as const }),
      subscribe: () => () => {},
      set: vi.fn(async () => true),
      unset: vi.fn(async () => true),
      mutate: vi.fn(async () => true),
    } satisfies DesktopSettingsForm<unknown>
    const ctx = {
      configForms: { get: () => scope },
      locale: { bind: () => (key: string) => key, register: () => () => {} },
      effect: () => {},
      slots: { inject, register: () => () => {} },
    } as unknown as ClientContext

    applyDesktopSettings(ctx, {
      version: '2.0.3',
      mode: 'compatibility',
      platform: 'win32',
      material: 'off',
      micaSupported: false,
    })

    expect(inject.mock.calls.map(call => call[0]))
      .toEqual(['settings.section', 'settings.action'])
  })
})
