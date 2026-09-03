const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Apply modal focus and background isolation to one shell overlay layer. */
export function installModalOverlayIsolation(frame: HTMLElement, overlayLayer: HTMLElement): () => void {
  let activeDialog: HTMLElement | null = null
  let returnFocus: HTMLElement | null = null
  const backgroundState = new Map<HTMLElement, boolean>()

  const setBackgroundInert = (inert: boolean): void => {
    if (inert) {
      for (const child of frame.children) {
        if (!(child instanceof HTMLElement) || child === overlayLayer) continue
        if (!backgroundState.has(child)) backgroundState.set(child, child.inert)
        child.inert = true
      }
      return
    }
    for (const [child, wasInert] of backgroundState) child.inert = wasInert
    backgroundState.clear()
  }

  const focusableItems = (dialog: HTMLElement): HTMLElement[] =>
    Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(item => !item.hidden && item.getAttribute('aria-hidden') !== 'true' && !item.closest('[inert]'))

  const syncModal = (): void => {
    const dialogs = Array.from(overlayLayer.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    const nextDialog = dialogs.at(-1) ?? null
    if (nextDialog !== null) {
      if (activeDialog === null && document.activeElement instanceof HTMLElement) {
        returnFocus = document.activeElement
      }
      setBackgroundInert(true)
      if (nextDialog === activeDialog) return
      activeDialog = nextDialog
      queueMicrotask(() => {
        if (activeDialog !== nextDialog || !nextDialog.isConnected) return
        const first = focusableItems(nextDialog).at(0)
        if (first !== undefined) first.focus({ preventScroll: true })
        else {
          nextDialog.tabIndex = -1
          nextDialog.focus({ preventScroll: true })
        }
      })
      return
    }

    if (activeDialog === null) return
    activeDialog = null
    setBackgroundInert(false)
    const target = returnFocus
    returnFocus = null
    queueMicrotask(() => {
      if (target?.isConnected === true) target.focus({ preventScroll: true })
    })
  }

  const trapFocus = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || activeDialog === null) return
    const items = focusableItems(activeDialog)
    const first = items.at(0)
    if (first === undefined) {
      event.preventDefault()
      activeDialog.focus({ preventScroll: true })
      return
    }
    const last = items.at(-1) ?? first
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if ((!event.shiftKey && document.activeElement === last)
      || !activeDialog.contains(document.activeElement)) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  const observer = new MutationObserver(syncModal)
  observer.observe(overlayLayer, { childList: true, subtree: true })
  document.addEventListener('keydown', trapFocus, true)
  syncModal()

  return () => {
    observer.disconnect()
    document.removeEventListener('keydown', trapFocus, true)
    setBackgroundInert(false)
    if (returnFocus?.isConnected === true) returnFocus.focus({ preventScroll: true })
  }
}
