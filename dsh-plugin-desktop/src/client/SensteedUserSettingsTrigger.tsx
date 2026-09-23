import { useMemo, useSyncExternalStore } from 'react'
import { DofeUserAvatar } from './DofeUserAvatar.tsx'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DofeAccessSettings } from '../dofe-plugins.ts'
import { dofeAccessSettingsStore } from './DofeAccessSection.tsx'

type Props = PropsRuntime<'settings.trigger'> & InjectFace<{ settingsScope: SettingsScope<DofeAccessSettings> }>

/** Keep the sidebar identity subscribed to the same account as the login gate. */
export function SensteedUserSettingsTrigger({ wide, settingsScope }: Props) {
  const store = useMemo(() => dofeAccessSettingsStore(settingsScope), [settingsScope])
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const identity = settings.value?.authMode === 'feishu' ? settings.value.identity : undefined
  const name = identity?.name?.trim() || '用户'
  return <span className="dshSensteedUserSettingsTrigger" title={`${name} · 用户设置`}>
    <DofeUserAvatar avatar={identity?.avatar} size={18} />
    {wide && <span className="dshSensteedUserSettingsName">{name}</span>}
  </span>
}
