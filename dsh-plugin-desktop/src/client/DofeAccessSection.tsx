import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArrowRight, Check, Eye, EyeOff, Phone, ShieldCheck } from 'lucide-react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DofeOnboardingModal } from './DofeOnboardingModal.tsx'
import { DOFE_ACCESS_KEY, type DofeAccessLocaleKey } from './dofe-access.ts'
import { DOFE_PLUGIN_CATALOG, DOFE_ACCESS_VALIDATION_VERSION, type DofeAccessSettings, type DofePluginId, DEFAULT_DOFE_PLUGIN_IDS } from '../dofe-plugins.ts'
import { DOFE_ACCESS_VALIDATE_PATH } from '../dofe-access-route.ts'

const STYLE_ID = 'dsh-dofe-access-styles'
const CSS = `
#dsh-dofe-access-gate { position: fixed; inset: 0; z-index: 2147483000; }
.dshDofeGate { position: fixed; inset: 0; display: grid; place-items: center; padding: 32px; background: rgba(14, 18, 24, .58); backdrop-filter: blur(10px) saturate(.8); }
.dshDofeModal { width: min(680px, calc(100vw - 64px)); max-height: calc(100vh - 64px); display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; color: var(--dsw-alias-label-primary, #172033); background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #d9dee8); border-radius: 8px; box-shadow: 0 24px 72px rgba(5, 10, 18, .28), 0 2px 8px rgba(5, 10, 18, .12); }
.dshDofeModalHeader { display: grid; grid-template-columns: 44px 1fr; gap: 16px; padding: 26px 28px 22px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e2e6ed); }
.dshDofeModalMark { width: 44px; height: 44px; display: grid; place-items: center; color: #fff; background: var(--dsw-alias-brand-primary, #245eea); border-radius: 8px; }
.dshDofeModalEyebrow { margin: 0 0 5px; color: var(--dsw-alias-brand-primary, #245eea); font-size: 11px; font-weight: 700; letter-spacing: 0; }
.dshDofeModalHeader h2 { margin: 0; color: var(--dsw-alias-label-primary, #172033); font-size: 24px; line-height: 1.25; letter-spacing: 0; outline: none; }
.dshDofeModalDescription { margin: 7px 0 0; max-width: 540px; color: var(--dsw-alias-label-secondary, #667085); font-size: 14px; line-height: 1.55; }
.dshDofeModalBody { min-height: 0; overflow: auto; padding: 22px 28px 26px; }
.dshDofeAccess { display: grid; gap: 20px; max-width: 640px; }
.dshDofeAccessIntro { color: var(--dsw-alias-label-secondary, #667085); line-height: 1.5; margin: 0; }
.dshDofeAccessHelp { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary, #667085); background: var(--dsw-alias-bg-layer-2, #f5f7fa); border-left: 3px solid var(--dsw-alias-brand-primary, #245eea); padding: 10px 12px; margin: 0; font-size: 13px; line-height: 1.45; }
.dshDofeAccessHelp svg { flex: 0 0 auto; color: var(--dsw-alias-brand-primary, #245eea); }
.dshDofeAccessField { display: grid; gap: 9px; }
.dshDofeAccessFieldHeader { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.dshDofeAccessLabel { color: var(--dsw-alias-label-primary, #172033); font-size: 14px; font-weight: 650; }
.dshDofeAccessHint, .dshDofeAccessCount { color: var(--dsw-alias-label-secondary, #667085); font-size: 12px; }
.dshDofeAccessInputWrap { position: relative; }
.dshDofeAccessInputWrap input { width: 100%; padding-right: 42px; }
.dshDofeAccessReveal { position: absolute; top: 50%; right: 6px; width: 32px; height: 32px; display: grid; place-items: center; transform: translateY(-50%); color: var(--dsw-alias-label-secondary, #667085); background: transparent; border: 0; border-radius: 6px; cursor: pointer; }
.dshDofeAccessReveal:hover { color: var(--dsw-alias-label-primary, #172033); background: var(--dsw-alias-interactive-bg-hover, #edf1f7); }
.dshDofeAccessReveal:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #245eea); outline-offset: 1px; }
.dshDofeAccessActions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.dshDofeAccessActionsOnboarding { justify-content: space-between; padding-top: 2px; }
.dshDofeAccessPrimary { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding-inline: 18px; }
.dshDofeAccessStatus { color: var(--dsw-alias-label-secondary, #667085); font-size: 13px; }
.dshDofeAccessError { color: var(--dsw-alias-state-error-primary, #c93636); background: rgba(201, 54, 54, .08); border-left: 3px solid var(--dsw-alias-state-error-primary, #c93636); padding: 10px 12px; margin: 0; font-size: 13px; line-height: 1.45; }
.dshDofeAccessPlugins { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--dsw-alias-border-l1, #e2e6ed); }
.dshDofeAccessPlugin { position: relative; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; min-height: 66px; align-items: center; padding: 11px 12px 11px 4px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e2e6ed); cursor: pointer; }
.dshDofeAccessPlugin:nth-child(odd) { padding-right: 18px; border-right: 1px solid var(--dsw-alias-border-l1, #e2e6ed); }
.dshDofeAccessPlugin:nth-child(even) { padding-left: 18px; }
.dshDofeAccessPlugin:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f5f9); }
.dshDofeAccessPlugin input { position: absolute; opacity: 0; pointer-events: none; }
.dshDofeAccessPluginCheck { width: 20px; height: 20px; display: grid; place-items: center; color: transparent; background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l2, #c7ced9); border-radius: 5px; }
.dshDofeAccessPluginSelected .dshDofeAccessPluginCheck { color: #fff; background: var(--dsw-alias-brand-primary, #245eea); border-color: var(--dsw-alias-brand-primary, #245eea); }
.dshDofeAccessPlugin:has(input:focus-visible) .dshDofeAccessPluginCheck { outline: 2px solid var(--dsw-alias-brand-primary, #245eea); outline-offset: 2px; }
.dshDofeAccessPluginName { display: block; color: var(--dsw-alias-label-primary, #172033); font-size: 14px; font-weight: 650; line-height: 1.35; }
.dshDofeAccessPluginDescription { display: block; color: var(--dsw-alias-label-secondary, #667085); font-size: 12px; line-height: 1.4; margin-top: 2px; }
@media (max-width: 720px) {
  .dshDofeGate { padding: 16px; }
  .dshDofeModal { width: calc(100vw - 32px); max-height: calc(100vh - 32px); }
  .dshDofeModalHeader { padding: 22px 20px 18px; }
  .dshDofeModalBody { padding: 18px 20px 22px; }
  .dshDofeAccessFieldHeader { align-items: flex-start; flex-direction: column; gap: 3px; }
  .dshDofeAccessPlugins { grid-template-columns: 1fr; }
  .dshDofeAccessPlugin:nth-child(n) { padding: 11px 4px; border-right: 0; }
}
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
type DofeAccessRoot = Pick<Root, 'render' | 'unmount'>
type DofeAccessRootFactory = (container: Element | DocumentFragment) => DofeAccessRoot

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'dofe.access': DofeAccessLocaleKey } }

/** Adapt receiver-dependent SettingsScope methods for React's callback contract. */
export function dofeAccessSettingsStore(settingsScope: SettingsScope<DofeAccessSettings>) {
  return {
    subscribe: (listener: () => void) => settingsScope.subscribe(listener),
    getSnapshot: () => settingsScope.getSnapshot(),
  }
}

function AccessForm({ credentials, settingsScope, t, onboarding, onDone }: DofeAccessInjected & { onboarding?: boolean; onDone?: () => void }): ReactNode {
  const [configured, setConfigured] = useState<boolean | undefined>()
  const [draft, setDraft] = useState('')
  const [revealKey, setRevealKey] = useState(false)
  const settingsStore = useMemo(() => dofeAccessSettingsStore(settingsScope), [settingsScope])
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot, settingsStore.getSnapshot)
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
  return <div className={`dshDofeAccess${onboarding ? ' dshDofeAccessOnboarding' : ''}`}>
    {!onboarding && <h2>{t('title')}</h2>}
    {!onboarding && <p className="dshDofeAccessIntro">{t('intro')}</p>}
    <div className="dshDofeAccessField">
      <div className="dshDofeAccessFieldHeader"><label className="dshDofeAccessLabel" htmlFor="dofe-model-api-key">{t('key')}</label>{onboarding && <span className="dshDofeAccessHint"><ShieldCheck size={13} aria-hidden="true" /> {t('credentialHint')}</span>}</div>
      <div className="dshDofeAccessInputWrap"><Input id="dofe-model-api-key" type={revealKey ? 'text' : 'password'} autoComplete="off" value={draft} placeholder={onboarding ? t('placeholder') : configured ? t('configured') : t('placeholder')} onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void save() }} /><button type="button" className="dshDofeAccessReveal" title={revealKey ? t('hideKey') : t('showKey')} aria-label={revealKey ? t('hideKey') : t('showKey')} onClick={() => setRevealKey(current => !current)}>{revealKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
    </div>
    {onboarding && <p className="dshDofeAccessHelp"><Phone size={15} aria-hidden="true" /><span>{t('onboardingHelp')}</span></p>}
    {onboarding && <div className="dshDofeAccessField"><div className="dshDofeAccessFieldHeader"><span className="dshDofeAccessLabel">{t('pluginsTitle')}</span><span className="dshDofeAccessCount">{t('selectedCount').replace('{count}', String(enabledPlugins.length))}</span></div><div className="dshDofeAccessPlugins">{DOFE_PLUGIN_CATALOG.map(plugin => { const selected = enabledPlugins.includes(plugin.id); return <label className={`dshDofeAccessPlugin${selected ? ' dshDofeAccessPluginSelected' : ''}`} key={plugin.id}><input type="checkbox" checked={selected} onChange={event => setEnabledPlugins(current => event.currentTarget.checked ? [...new Set([...current, plugin.id])] : current.filter(id => id !== plugin.id))} /><span className="dshDofeAccessPluginCheck" aria-hidden="true"><Check size={14} strokeWidth={2.5} /></span><span><span className="dshDofeAccessPluginName">{plugin.name}</span><span className="dshDofeAccessPluginDescription">{plugin.description}</span></span></label> })}</div></div>}
    {error !== undefined && <p className="dshDofeAccessError" role="alert">{error}</p>}
    <div className={`dshDofeAccessActions${onboarding ? ' dshDofeAccessActionsOnboarding' : ''}`}><Button className="dshDofeAccessPrimary" variant="primary" disabled={busy || !draft.trim() || (onboarding && enabledPlugins.length === 0)} onClick={() => void save()}>{busy ? t('saving') : t('save')}{!busy && <ArrowRight size={16} aria-hidden="true" />}</Button>{!onboarding && <Button disabled={busy || configured !== true} onClick={() => void remove()}>{busy ? t('removing') : t('remove')}</Button>}{!onboarding && <span className="dshDofeAccessStatus" role="status">{configured === true ? t('configured') : configured === false ? t('missing') : ''}</span>}</div>
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
export function DofeAccessGate({ credentials, settingsScope, t }: DofeAccessInjected): ReactNode {
  const settingsStore = useMemo(() => dofeAccessSettingsStore(settingsScope), [settingsScope])
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot, settingsStore.getSnapshot)
  const [credentialConfigured, setCredentialConfigured] = useState(false)
  useEffect(() => {
    void credentials.describe([DOFE_ACCESS_KEY]).then(result => {
      setCredentialConfigured(result.ok && result.value[DOFE_ACCESS_KEY]?.configured === true)
    })
  }, [credentials, settings.value?.setupComplete, settings.value?.validationVersion])
  if (credentialConfigured
    && settings.value?.setupComplete === true
    && settings.value.validationVersion === DOFE_ACCESS_VALIDATION_VERSION) return null
  return <DofeOnboardingModal eyebrow={t('onboardingEyebrow')} title={t('onboardingTitle')} description={t('onboardingIntro')}><AccessForm credentials={credentials} settingsScope={settingsScope} t={t} onboarding onDone={() => setCredentialConfigured(true)} /></DofeOnboardingModal>
}

/** Mount the mandatory credential gate independently of upstream session onboarding. */
export function installDofeAccessGate(
  props: DofeAccessInjected,
  rootFactory: DofeAccessRootFactory = container => createRoot(container),
): () => void {
  document.getElementById('dsh-dofe-access-gate')?.remove()
  const host = document.createElement('div')
  host.id = 'dsh-dofe-access-gate'
  document.body.appendChild(host)
  const root = rootFactory(host)
  root.render(<DofeAccessGate {...props} />)
  return () => {
    root.unmount()
    host.remove()
  }
}
