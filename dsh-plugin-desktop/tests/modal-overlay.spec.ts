// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { installModalOverlayIsolation } from '../src/client/modal-overlay.ts'

afterEach(() => {
  document.body.replaceChildren()
})

describe('desktop modal overlay isolation', () => {
  it('isolates the background, traps focus, and restores the trigger', async () => {
    const frame = document.createElement('div')
    const background = document.createElement('main')
    const trigger = document.createElement('button')
    trigger.textContent = 'Open report'
    background.append(trigger)
    const overlay = document.createElement('div')
    frame.append(background, overlay)
    document.body.append(frame)
    trigger.focus()

    const dispose = installModalOverlayIsolation(frame, overlay)
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const close = document.createElement('button')
    close.textContent = 'Close report'
    const refresh = document.createElement('button')
    refresh.textContent = 'Refresh report'
    dialog.append(close, refresh)
    overlay.append(dialog)
    await Promise.resolve()
    await Promise.resolve()

    expect(background.inert).toBe(true)
    expect(document.activeElement).toBe(close)

    refresh.focus()
    refresh.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(close)
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(refresh)

    dialog.remove()
    await Promise.resolve()
    await Promise.resolve()
    expect(background.inert).not.toBe(true)
    expect(document.activeElement).toBe(trigger)
    dispose()
  })
})
