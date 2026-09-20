import { useEffect, useRef, useState } from 'react'
import { LogIn, Loader2, X } from 'lucide-react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { DOFE_AUTH_CANCEL_PATH, DOFE_AUTH_SESSION_PATH, DOFE_AUTH_STATUS_PATH, type DofeAuthSnapshot } from '../dofe-auth-contract.ts'

async function request(path: string, signal?: AbortSignal): Promise<DofeAuthSnapshot> {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}',
  })
  if (!response.ok) throw new Error('登录服务暂不可用，请重试')
  return await response.json() as DofeAuthSnapshot
}

export function DofeLoginSection({ disabled, name, onBound }: {
  disabled: boolean
  name?: string | undefined
  onBound: (snapshot: DofeAuthSnapshot) => Promise<void>
}) {
  const pending = useRef<AbortController | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const cancel = () => {
    pending.current?.abort()
    if (pending.current) void request(DOFE_AUTH_CANCEL_PATH).catch(() => {})
    pending.current = undefined
    setBusy(false)
  }
  useEffect(() => () => {
    pending.current?.abort()
    if (pending.current) void request(DOFE_AUTH_CANCEL_PATH).catch(() => {})
  }, [])
  const login = async () => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(undefined)
    try {
      let status = await request(DOFE_AUTH_SESSION_PATH, controller.signal)
      for (let attempt = 0; attempt < 150; attempt += 1) {
        controller.signal.throwIfAborted()
        if (status.status === 'bound') {
          if (!status.user?.ssoSub || !status.entitlements) throw new Error('登录身份不完整，请重试')
          await onBound(status)
          return
        }
        if (status.status === 'error' || status.status === 'cancelled') throw new Error(status.error ?? '登录已取消')
        await new Promise<void>(resolve => setTimeout(resolve, 2_000))
        controller.signal.throwIfAborted()
        status = await request(DOFE_AUTH_STATUS_PATH, controller.signal)
      }
      throw new Error('登录等待超时，请重试')
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '飞书登录失败，请重试')
        await request(DOFE_AUTH_CANCEL_PATH).catch(() => {})
      }
    } finally {
      if (pending.current === controller) {
        pending.current = undefined
        setBusy(false)
      }
    }
  }
  return <div className="dshDofeAccessField">
    {name && <span className="dshDofeAccessLabel">{name}</span>}
    <div className="dshDofeAccessActions">
      <Button className="dshDofeAccessPrimary" disabled={disabled || busy} onClick={() => void login()}>
        {busy ? <Loader2 size={16} className="dshDofeAccessSpin" /> : <LogIn size={16} />}
        {busy ? '等待飞书确认' : '飞书登录'}
      </Button>
      {busy && <Button aria-label="取消登录" title="取消登录" onClick={cancel}><X size={16} /></Button>}
    </div>
    {error && <p className="dshDofeAccessError" role="alert">{error}</p>}
  </div>
}
