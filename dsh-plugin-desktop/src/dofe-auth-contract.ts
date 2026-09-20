export const DOFE_AUTH_SESSION_PATH = '/api/desktop/auth/feishu/session'
export const DOFE_AUTH_STATUS_PATH = '/api/desktop/auth/feishu/status'
export const DOFE_AUTH_COMPLETE_PATH = '/api/desktop/auth/feishu/complete'
export const DOFE_AUTH_CANCEL_PATH = '/api/desktop/auth/feishu/cancel'

export interface DofeAuthEntitlements {
  plugins: string[]
  defaultModel: string
  allowedProtocols: string[]
}

export interface DofeAuthSnapshot {
  status: 'idle' | 'pending' | 'issued' | 'bound' | 'error' | 'cancelled'
  user?: { ssoSub: string; name: string; avatar: string | null }
  tenant?: { tenantId: string; ssoTeamId: string; tenantSlug: string }
  entitlements?: DofeAuthEntitlements
  error?: string
}
