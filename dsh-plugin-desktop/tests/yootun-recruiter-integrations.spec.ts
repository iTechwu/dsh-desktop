import { describe, expect, it, vi } from 'vitest'
import { createBossOfficialAdapter } from '../src/yootun-boss-official-adapter.ts'
import { createRecruiterKnowledgePublisher } from '../src/yootun-recruiter-integrations.ts'

describe('Yootun recruiter integrations', () => {
  it('creates and confirms one ACL-scoped HR memory through registered knowledge tools', async () => {
    const calls: Array<{ name: string; arguments: unknown }> = []
    const publisher = createRecruiterKnowledgePublisher({
      schemas: () => [
        { name: 'knowledge_remember', description: '', parameters: {} },
        { name: 'knowledge_confirm_memory', description: '', parameters: {} },
      ],
      execute: vi.fn(async (input: { name: string; arguments: unknown }) => {
        calls.push(input)
        return input.name === 'knowledge_remember'
          ? { isError: false, value: { ok: true, result: { structuredContent: { id: 'memory-1' } } }, content: [] }
          : { isError: false, value: { ok: true, result: {} }, content: [] }
      }),
    } as any)
    const result = await publisher!.publish({
      spaceId: '20000000-0000-4000-8000-000000000001',
      content: '{"kind":"hr_recruiting_review"}',
      idempotencyKey: 'knowledge-1',
    })
    expect(result).toEqual({ status: 'succeeded', reasonCode: 'knowledge_confirmed', memoryId: 'memory-1' })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ arguments: { input: {
      scope: 'TEAM', spaceId: '20000000-0000-4000-8000-000000000001',
    } } })
    expect(calls[1]).toMatchObject({ arguments: { input: {
      memoryId: 'memory-1', shareWithSpace: true,
    } } })
  })

  it('does not invoke the BOSS official client before authorization', async () => {
    const executeRecruiterAction = vi.fn()
    const syncRecruitingData = vi.fn()
    const adapter = createBossOfficialAdapter({
      authorizationStatus: async () => 'requires_user_login',
      executeRecruiterAction,
      syncRecruitingData,
    })!
    expect(await adapter.sync({ idempotencyKey: 'sync-1' })).toMatchObject({
      status: 'requires_user_login', imported: 0, updated: 0, skipped: 0,
    })
    expect(await adapter.execute({
      actionId: 'action-1', type: 'send_message', idempotencyKey: 'message-1',
      targetLabel: '候选人 A', summary: '邀请面试',
    })).toMatchObject({ status: 'requires_user_login' })
    expect(executeRecruiterAction).not.toHaveBeenCalled()
    expect(syncRecruitingData).not.toHaveBeenCalled()
  })
})
