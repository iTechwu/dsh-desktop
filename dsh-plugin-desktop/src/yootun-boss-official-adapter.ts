import type {
  RecruiterAdapterRequest,
  RecruiterAdapterResult,
  RecruiterBossAdapter,
  RecruiterBossSyncResult,
} from './yootun-recruiter-route.ts'

/** Boundary implemented only by a BOSS-approved SDK or partner integration. */
export interface BossOfficialClient {
  authorizationStatus: () => Promise<'authorized' | 'requires_user_login' | 'revoked'>
  executeRecruiterAction: (request: RecruiterAdapterRequest) => Promise<RecruiterAdapterResult>
  syncRecruitingData: (request: { cursor?: string; idempotencyKey: string }) => Promise<RecruiterBossSyncResult>
}

export function createBossOfficialAdapter(client: BossOfficialClient | undefined): RecruiterBossAdapter | undefined {
  if (client === undefined) return undefined
  return {
    async execute(request) {
      const status = await client.authorizationStatus()
      if (status !== 'authorized') return { status: 'requires_user_login', reasonCode: `boss_${status}` }
      return client.executeRecruiterAction(request)
    },
    async sync(request) {
      const status = await client.authorizationStatus()
      if (status !== 'authorized') {
        return {
          status: 'requires_user_login', reasonCode: `boss_${status}`,
          imported: 0, updated: 0, skipped: 0,
        }
      }
      return client.syncRecruitingData(request)
    },
  }
}
