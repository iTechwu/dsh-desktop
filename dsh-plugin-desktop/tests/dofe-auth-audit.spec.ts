import { expect, it, vi } from 'vitest'
import { watchDofeAuthAudit } from '../src/dofe-auth-audit.ts'
import type { DofeAuthSnapshot } from '../src/dofe-auth-contract.ts'
import { buildYootunAuditEvent } from '../src/yootun-audit-contract.ts'

it('records login and provisioning without secrets, and records permission changes once', () => {
  let listener!: (snapshot: DofeAuthSnapshot) => void
  const stop = vi.fn()
  const auth = { watchBinding: (watch: typeof listener) => { listener = watch; return stop } }
  const record = vi.fn(async input => { buildYootunAuditEvent(input); return { status: 'stored', clientEventId: 'event' } })
  const dispose = watchDofeAuthAudit(auth as never, { record } as never)
  const bound: DofeAuthSnapshot = {
    status: 'bound', user: { ssoSub: 'user-1', name: 'Private Name', avatar: null },
    entitlements: { plugins: ['media'], allowedProtocols: ['messages'], defaultModel: '' },
  }
  listener(bound)
  listener(bound)
  expect(record.mock.calls.map(call => call[0].actionCode)).toEqual([
    'desktop.login.succeeded', 'desktop.key.provisioned', 'desktop.permissions.updated',
    'desktop.login.succeeded', 'desktop.key.provisioned',
  ])
  expect(JSON.stringify(record.mock.calls)).not.toContain('Private Name')
  dispose()
  expect(stop).toHaveBeenCalledOnce()
})
