import { useEffect, useState, type ReactNode } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { DofeOnboardingModal } from './DofeOnboardingModal.tsx'
import { DOFE_ACCESS_KEY, type DofeAccessLocaleKey } from './dofe-access.ts'

const STYLE_ID = 'dsh-dofe-access-styles'
const CSS = `
.dshDofeAccess { display: grid; gap: 16px; max-width: 640px; }
.dshDofeAccessIntro { color: var(--dsw-alias-text-secondary); line-height: 1.5; margin: 0; }
.dshDofeAccessHelp { color: var(--dsw-alias-text-secondary); line-height: 1.5; margin: -8px 0 0; }
.dshDofeAccessField { display: grid; gap: 8px; }
.dshDofeAccessLabel { color: var(--dsw-alias-text-primary); font-weight: 600; }
.dshDofeAccessActions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dshDofeAccessStatus { color: var(--dsw-alias-text-secondary); font-size: 13px; }
.dshDofeAccessError { color: var(--dsw-alias-text-danger); margin: 0; }
`

type Credentials = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>
export interface DofeAccessInjected { credentials: Credentials; t: (key: DofeAccessLocaleKey) => string }
export type DofeAccessSectionProps = PropsRuntime<'settings.section'> & InjectFace<DofeAccessInjected>
export type DofeAccessOnboardingProps = PropsRuntime<'settings.onboarding'> & InjectFace<DofeAccessInjected>

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'dofe.access': DofeAccessLocaleKey } }

function AccessForm({ credentials, t, onboarding, onDone }: DofeAccessInjected & { onboarding?: boolean; onDone?: () => void }): ReactNode {
  const [configured, setConfigured] = useState<boolean | undefined>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => { void credentials.describe([DOFE_ACCESS_KEY]).then(result => { if (result.ok) setConfigured(result.value[DOFE_ACCESS_KEY]?.configured === true); else setError(t('loadError')) }) }, [credentials, t])
  const save = async (): Promise<void> => { if (!draft.trim()) return; setBusy(true); setError(undefined); const result = await credentials.set(DOFE_ACCESS_KEY, draft.trim()); setBusy(false); if (!result.ok) { setError(t('saveError')); return }; setDraft(''); setConfigured(true); onDone?.() }
  const remove = async (): Promise<void> => { setBusy(true); setError(undefined); const result = await credentials.unset(DOFE_ACCESS_KEY); setBusy(false); if (!result.ok) { setError(t('removeError')); return }; setConfigured(false) }
  return <div className="dshDofeAccess">
    {!onboarding && <h2>{t('title')}</h2>}
    <p className="dshDofeAccessIntro">{onboarding ? t('onboardingIntro') : t('intro')}</p>
    {onboarding && <p className="dshDofeAccessHelp">{t('onboardingHelp')}</p>}
    <div className="dshDofeAccessField"><label className="dshDofeAccessLabel" htmlFor="dofe-model-api-key">{t('key')}</label><Input id="dofe-model-api-key" type="password" autoComplete="off" value={draft} placeholder={configured ? t('configured') : t('placeholder')} onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void save() }} /></div>
    {error !== undefined && <p className="dshDofeAccessError" role="alert">{error}</p>}
    <div className="dshDofeAccessActions"><Button variant="primary" disabled={busy || !draft.trim()} onClick={() => void save()}>{busy ? t('saving') : t('save')}</Button>{!onboarding && <Button disabled={busy || configured !== true} onClick={() => void remove()}>{busy ? t('removing') : t('remove')}</Button>}<span className="dshDofeAccessStatus" role="status">{configured === true ? t('configured') : configured === false ? t('missing') : ''}</span></div>
  </div>
}

export function installDofeAccessStyles(): () => void {
  document.getElementById(STYLE_ID)?.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

export function DofeAccessSection(props: DofeAccessSectionProps): ReactNode { if (props.credentials === undefined || props.t === undefined) return null; return <AccessForm credentials={props.credentials} t={props.t} /> }
export function DofeAccessOnboarding(props: DofeAccessOnboardingProps): ReactNode {
  const { credentials, t, complete } = props
  if (credentials === undefined || t === undefined) return null
  return <DofeAccessOnboardingReady credentials={credentials} t={t} complete={complete} />
}

function DofeAccessOnboardingReady({ credentials, t, complete }: DofeAccessInjected & { complete: () => void }): ReactNode {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void credentials.describe([DOFE_ACCESS_KEY]).then(result => {
      if (result.ok && result.value[DOFE_ACCESS_KEY]?.configured === true) complete()
      else setReady(true)
    })
  }, [complete, credentials])
  if (!ready) return null
  return <DofeOnboardingModal title={t('onboardingTitle')}><AccessForm credentials={credentials} t={t} onboarding onDone={complete} /><Button onClick={complete}>{t('later')}</Button></DofeOnboardingModal>
}
