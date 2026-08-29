import { useEffect, useRef, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'

export function DofeOnboardingModal({ title, children }: { title: string; children: ReactNode }): ReactNode {
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const root = document.getElementById('root')
    if (root === null) return
    const previous = root.inert
    root.inert = true
    titleRef.current?.focus()
    return () => { root.inert = previous }
  }, [])
  return <Modal open title={title} onClose={() => {}} headless><h2 ref={titleRef} tabIndex={-1}>{title}</h2>{children}</Modal>
}
