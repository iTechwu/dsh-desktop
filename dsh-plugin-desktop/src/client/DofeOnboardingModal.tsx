import { useEffect, useRef, type ReactNode } from 'react'
import { KeyRound } from 'lucide-react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Keep the mandatory dialog keyboard focusable even though it lives outside AppFrame. */
export function installDofeModalFocusTrap(modal: HTMLElement): () => void {
  const focusableItems = (): HTMLElement[] => Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(item => !item.hidden && item.getAttribute('aria-hidden') !== 'true')
  const focusFirst = (): void => {
    const first = focusableItems().at(0)
    if (first !== undefined) first.focus({ preventScroll: true })
    else {
      modal.tabIndex = -1
      modal.focus({ preventScroll: true })
    }
  }
  const trapFocus = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const items = focusableItems()
    const first = items.at(0)
    if (first === undefined) {
      event.preventDefault()
      focusFirst()
      return
    }
    const last = items.at(-1) ?? first
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if ((!event.shiftKey && document.activeElement === last) || !modal.contains(document.activeElement)) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }
  const recoverFocus = (event: FocusEvent): void => {
    if (event.target instanceof Node && modal.contains(event.target)) return
    focusFirst()
  }
  document.addEventListener('keydown', trapFocus, true)
  document.addEventListener('focusin', recoverFocus, true)
  return () => {
    document.removeEventListener('keydown', trapFocus, true)
    document.removeEventListener('focusin', recoverFocus, true)
  }
}

export function DofeOnboardingModal({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}): ReactNode {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])
  useEffect(() => {
    const modal = modalRef.current
    return modal === null ? undefined : installDofeModalFocusTrap(modal)
  }, [])
  return <div className="dshDofeGate">
    <section ref={modalRef} className="dshDofeModal" role="dialog" aria-modal="true" aria-labelledby="dsh-dofe-modal-title" aria-describedby="dsh-dofe-modal-description">
      <header className="dshDofeModalHeader">
        <span className="dshDofeModalMark" aria-hidden="true"><KeyRound size={20} strokeWidth={2} /></span>
        <div>
          <p className="dshDofeModalEyebrow">{eyebrow}</p>
          <h2 id="dsh-dofe-modal-title" ref={titleRef} tabIndex={-1}>{title}</h2>
          <p id="dsh-dofe-modal-description" className="dshDofeModalDescription">{description}</p>
        </div>
      </header>
      <div className="dshDofeModalBody">{children}</div>
    </section>
  </div>
}
