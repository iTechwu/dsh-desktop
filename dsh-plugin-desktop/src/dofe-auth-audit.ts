import type { DofeAuthService } from './dofe-auth-service.ts'
import type { YootunAuditRecorder, YootunAuditRecordInput } from './yootun-audit-contract.ts'
import { desktopPackageVersion } from './desktop-package-version.ts'

export function watchDofeAuthAudit(auth: DofeAuthService, audit: YootunAuditRecorder): () => void {
  let previousPermissions: string | undefined
  return auth.watchBinding(snapshot => {
    if (!snapshot.user || !snapshot.entitlements) return
    const source = { pluginId: 'dsh-plugin-desktop/auth', pluginVersion: desktopPackageVersion(), surface: 'system' as const }
    const base = { source, target: { type: 'desktop_session', id: snapshot.user.ssoSub }, outcome: 'succeeded' as const }
    const events: YootunAuditRecordInput[] = [
      { ...base, actionCode: 'desktop.login.succeeded', category: 'execute' },
      { ...base, actionCode: 'desktop.key.provisioned', category: 'execute' },
    ]
    const permissions = JSON.stringify([snapshot.user.ssoSub, snapshot.entitlements])
    if (permissions !== previousPermissions) {
      events.push({ ...base, actionCode: 'desktop.permissions.updated', category: 'update', changes: [
        { field: 'pluginCount', after: snapshot.entitlements.plugins.length },
        { field: 'protocolCount', after: snapshot.entitlements.allowedProtocols.length },
      ] })
      previousPermissions = permissions
    }
    for (const event of events) void audit.record(event).catch(() => {})
  })
}
