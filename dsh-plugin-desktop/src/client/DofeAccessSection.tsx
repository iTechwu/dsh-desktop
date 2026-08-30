import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DofeOnboardingModal } from './DofeOnboardingModal.tsx'
import { DOFE_ACCESS_KEY, type DofeAccessLocaleKey } from './dofe-access.ts'
import { DOFE_PLUGIN_CATALOG, DOFE_ACCESS_VALIDATION_VERSION, type DofeAccessSettings, type DofePluginId, DEFAULT_DOFE_PLUGIN_IDS } from '../dofe-plugins.ts'
import { DOFE_ACCESS_VALIDATE_PATH } from '../dofe-access-route.ts'

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
.dshDofeAccessPlugins { display: grid; gap: 8px; margin-top: 4px; }
.dshDofeAccessPlugin { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-secondary); border-radius: 8px; }
.dshDofeAccessPlugin input { margin-top: 3px; }
.dshDofeAccessPluginName { color: var(--dsw-alias-text-primary); font-weight: 600; }
.dshDofeAccessPluginDescription { color: var(--dsw-alias-text-secondary); font-size: 13px; margin-top: 2px; }
`

async function validateModelApiKey(key: string): Promise<boolean> {
  try {
    const response = await fetch(DOFE_ACCESS_VALIDATE_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key }),
    })
    if (!response.ok) return false
    const value = await response.json() as unknown
    return typeof value === 'object' && value !== null && (value as { valid?: unknown }).valid === true
  } catch {
    return false
  }
}

type Credentials = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>
export interface DofeAccessInjected {
  credentials: Credentials
  settingsScope: SettingsScope<DofeAccessSettings>
  t: (key: DofeAccessLocaleKey) => string
}
export type DofeAccessSectionProps = PropsRuntime<'settings.section'> & InjectFace<DofeAccessInjected>
export type DofeAccessOnboardingProps = PropsRuntime<'settings.onboarding'> & InjectFace<DofeAccessInjected>

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'dofe.access': DofeAccessLocaleKey } }

function AccessForm({ credentials, settingsScope, t, onboarding, onDone }: DofeAccessInjected & { onboarding?: boolean; onDone?: () => void }): ReactNode {
  const [configured, setConfigured] = useState<boolean | undefined>()
  const [draft, setDraft] = useState('')
  const settings = useSyncExternalStore(settingsScope.subscribe, settingsScope.getSnapshot, settingsScope.getSnapshot)
  const [enabledPlugins, setEnabledPlugins] = useState<DofePluginId[]>(() => (settings.value?.enabledPlugins ?? DEFAULT_DOFE_PLUGIN_IDS) as DofePluginId[])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (settings.value?.enabledPlugins !== undefined) setEnabledPlugins(settings.value.enabledPlugins as DofePluginId[])
  }, [settings.value?.enabledPlugins])
  useEffect(() => { void credentials.describe([DOFE_ACCESS_KEY]).then(result => { if (result.ok) setConfigured(result.value[DOFE_ACCESS_KEY]?.configured === true); else setError(t('loadError')) }) }, [credentials, t])
  const save = async (): Promise<void> => {
    if (!draft.trim() || enabledPlugins.length === 0) return
    setBusy(true)
    setError(undefined)
    if (!(await validateModelApiKey(draft.trim()))) {
      setBusy(false)
      setError(t('invalidKey'))
      return
    }
    const result = await credentials.set(DOFE_ACCESS_KEY, draft.trim())
    if (!result.ok) { setBusy(false); setError(t('saveError')); return }
    try {
      await settingsScope.mutate([
        { op: 'set', path: ['setupComplete'], value: true },
        { op: 'set', path: ['validationVersion'], value: DOFE_ACCESS_VALIDATION_VERSION },
        { op: 'set', path: ['enabledPlugins'], value: enabledPlugins },
      ])
    } catch {
      setBusy(false)
      setError(t('saveError'))
      return
    }
    setBusy(false)
    setDraft('')
    setConfigured(true)
    onDone?.()
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const result = await credentials.unset(DOFE_ACCESS_KEY)
    if (!result.ok) { setBusy(false); setError(t('removeError')); return }
    try { await settingsScope.mutate([
      { op: 'set', path: ['setupComplete'], value: false },
      { op: 'set', path: ['validationVersion'], value: 0 },
    ]) } catch { /* key removal still succeeded */ }
    setBusy(false)
    setConfigured(false)
  }
  return <div className="dshDofeAccess">
    {!onboarding && <h2>{t('title')}</h2>}
    <p className="dshDofeAccessIntro">{onboarding ? t('onboardingIntro') : t('intro')}</p>
    {onboarding && <p className="dshDofeAccessHelp">{t('onboardingHelp')}</p>}
    <div className="dshDofeAccessField"><label className="dshDofeAccessLabel" htmlFor="dofe-model-api-key">{t('key')}</label><Input id="dofe-model-api-key" type="password" autoComplete="off" value={draft} placeholder={configured ? t('configured') : t('placeholder')} onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void save() }} /></div>
    {onboarding && <div className="dshDofeAccessField"><span className="dshDofeAccessLabel">{t('pluginsTitle')}</span><div className="dshDofeAccessPlugins">{DOFE_PLUGIN_CATALOG.map(plugin => <label className="dshDofeAccessPlugin" key={plugin.id}><input type="checkbox" checked={enabledPlugins.includes(plugin.id)} onChange={event => setEnabledPlugins(current => event.currentTarget.checked ? [...new Set([...current, plugin.id])] : current.filter(id => id !== plugin.id))} /><span><span className="dshDofeAccessPluginName">{plugin.name}</span><span className="dshDofeAccessPluginDescription">{plugin.description}</span></span></label>)}</div></div>}
    {error !== undefined && <p className="dshDofeAccessError" role="alert">{error}</p>}
    <div className="dshDofeAccessActions"><Button variant="primary" disabled={busy || !draft.trim() || (onboarding && enabledPlugins.length === 0)} onClick={() => void save()}>{busy ? t('saving') : t('save')}</Button>{!onboarding && <Button disabled={busy || configured !== true} onClick={() => void remove()}>{busy ? t('removing') : t('remove')}</Button>}<span className="dshDofeAccessStatus" role="status">{configured === true ? t('configured') : configured === false ? t('missing') : ''}</span></div>
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

export function DofeAccessSection(props: DofeAccessSectionProps): ReactNode { if (props.credentials === undefined || props.settingsScope === undefined || props.t === undefined) return null; return <AccessForm credentials={props.credentials} settingsScope={props.settingsScope} t={props.t} /> }
export function DofeAccessOnboarding(props: DofeAccessOnboardingProps): ReactNode {
  const { credentials, settingsScope, t, complete } = props
  if (credentials === undefined || settingsScope === undefined || t === undefined) return null
  return <DofeAccessOnboardingReady credentials={credentials} settingsScope={settingsScope} t={t} complete={complete} />
}

function DofeAccessOnboardingReady({ credentials, settingsScope, t, complete }: DofeAccessInjected & { complete: () => void }): ReactNode {
  const settings = useSyncExternalStore(settingsScope.subscribe, settingsScope.getSnapshot, settingsScope.getSnapshot)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void credentials.describe([DOFE_ACCESS_KEY]).then(result => {
      if (result.ok
        && result.value[DOFE_ACCESS_KEY]?.configured === true
        && settings.value?.setupComplete === true
        && settings.value.validationVersion === DOFE_ACCESS_VALIDATION_VERSION) complete()
      else setReady(true)
    })
  }, [complete, credentials, settings.value?.setupComplete, settings.value?.validationVersion])
  if (!ready) return null
  return <DofeOnboardingModal title={t('onboardingTitle')}><AccessForm credentials={credentials} settingsScope={settingsScope} t={t} onboarding onDone={complete} /></DofeOnboardingModal>
}
