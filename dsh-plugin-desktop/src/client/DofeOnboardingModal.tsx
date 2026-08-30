import { useEffect, useRef, type ReactNode } from 'react'
import { KeyRound } from 'lucide-react'

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
  useEffect(() => { titleRef.current?.focus() }, [])
  return <div className="dshDofeGate">
    <section className="dshDofeModal" role="dialog" aria-modal="true" aria-labelledby="dsh-dofe-modal-title" aria-describedby="dsh-dofe-modal-description">
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
