import { useEffect, useState, type FormEvent } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { Eye, EyeOff } from 'lucide-react'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'

export const DEEPSEEK_SEARCH_API_KEY_REF = 'DEEPSEEK_API_KEY'

type SearchCredentials = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>
type Translate = (key: DesktopSettingsLocaleKey) => string

export interface DeepSeekSearchSettingsProps {
  readonly credentials: SearchCredentials
  readonly t: Translate
}

/** Persist the Search API Key under the reference resolved by the DeepSeek Search provider. */
export async function saveDeepSeekSearchApiKey(
  credentials: Pick<SearchCredentials, 'set'>,
  rawValue: string,
): Promise<void> {
  const value = rawValue.trim()
  if (value.length === 0) throw new Error('DeepSeek Search API key is empty')
  const result = await credentials.set(DEEPSEEK_SEARCH_API_KEY_REF, value)
  if (!result.ok) throw new Error(result.error.message)
}

/** Configure the credential consumed by DeepSeek Search without ever reading its value back. */
export function DeepSeekSearchSettings({ credentials, t }: DeepSeekSearchSettingsProps) {
  const [configured, setConfigured] = useState<boolean>()
  const [writable, setWritable] = useState(true)
  const [draft, setDraft] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState<'save' | 'remove'>()
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string }>()

  useEffect(() => {
    let active = true
    void credentials.describe([DEEPSEEK_SEARCH_API_KEY_REF]).then((result) => {
      if (!active) return
      if (!result.ok) {
        setMessage({ kind: 'error', text: t('searchLoadError') })
        return
      }
      const credential = result.value[DEEPSEEK_SEARCH_API_KEY_REF]
      setConfigured(credential?.configured ?? false)
      setWritable(credential?.writable ?? true)
    }).catch(() => {
      if (active) setMessage({ kind: 'error', text: t('searchLoadError') })
    })
    return () => { active = false }
  }, [credentials, t])

  const save = (event: FormEvent): void => {
    event.preventDefault()
    const value = draft.trim()
    if (value.length === 0 || !writable) return
    setBusy('save')
    setMessage(undefined)
    void saveDeepSeekSearchApiKey(credentials, value).then(() => {
      setDraft('')
      setConfigured(true)
      setMessage({ kind: 'success', text: t('searchSaved') })
    }).catch(() => {
      setMessage({ kind: 'error', text: t('searchSaveError') })
    }).finally(() => { setBusy(undefined) })
  }

  const remove = (): void => {
    if (!writable || configured !== true) return
    setBusy('remove')
    setMessage(undefined)
    void credentials.unset(DEEPSEEK_SEARCH_API_KEY_REF).then((result) => {
      if (!result.ok) throw new Error(result.error.message)
      setConfigured(false)
      setDraft('')
    }).catch(() => {
      setMessage({ kind: 'error', text: t('searchRemoveError') })
    }).finally(() => { setBusy(undefined) })
  }

  const status = configured === true
    ? t('searchConfigured')
    : configured === false ? t('searchMissing') : ''

  return (
    <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-search-title">
      <div>
        <h3 id="dsh-desktop-search-title">{t('searchTitle')}</h3>
        <p className="dshDesktopSettingsGroupIntro">{t('searchIntro')}</p>
      </div>
      <form className="dshDesktopSettingsCredentialForm" onSubmit={save}>
        <label className="dshDesktopSettingsField" htmlFor="dsh-deepseek-search-api-key">
          <span className="dshDesktopSettingsFieldHeader">
            <span>{t('searchKeyLabel')}</span>
            <span className="dshDesktopSettingsCredentialStatus" role="status">{status}</span>
          </span>
          <span className="dshDesktopSettingsSecretInput">
            <input
              id="dsh-deepseek-search-api-key"
              name="deepseek-search-api-key"
              className="dshDesktopSettingsInput"
              type={revealed ? 'text' : 'password'}
              autoComplete="off"
              value={draft}
              placeholder={configured === true ? t('searchConfigured') : t('searchKeyPlaceholder')}
              disabled={!writable || busy !== undefined}
              onChange={event => { setDraft(event.currentTarget.value) }}
            />
            <button
              type="button"
              className="dshDesktopSettingsSecretReveal"
              title={revealed ? t('hideSearchKey') : t('showSearchKey')}
              aria-label={revealed ? t('hideSearchKey') : t('showSearchKey')}
              disabled={!writable || busy !== undefined}
              onClick={() => { setRevealed(current => !current) }}
            >
              {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </span>
          <span>{t('searchKeyHint')}</span>
        </label>
        <div className="dshDesktopSettingsCredentialActions">
          <button
            type="submit"
            className="dshDesktopSettingsButton"
            disabled={!writable || busy !== undefined || draft.trim().length === 0}
          >
            {busy === 'save' ? t('searchSaving') : t('searchSave')}
          </button>
          <button
            type="button"
            className="dshDesktopSettingsButton dshDesktopSettingsButtonDanger"
            disabled={!writable || busy !== undefined || configured !== true}
            onClick={remove}
          >
            {busy === 'remove' ? t('searchRemoving') : t('searchRemove')}
          </button>
        </div>
      </form>
      {message !== undefined && (
        <p
          className={message.kind === 'success' ? 'dshDesktopSettingsSuccess' : 'dshDesktopSettingsError'}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
