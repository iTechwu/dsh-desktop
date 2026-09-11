import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { expect, it, vi } from 'vitest'

it('reports real handle-based persistence events without mutating the stored session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-daily-report-'))
  const ctx = new Context()
  try {
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const id = SessionId('daily-report-fixture')
    const time = Date.parse('2026-08-31T01:00:00+08:00')
    const writer = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: time, cwd: root, isSeeded: false })
    try {
      await writer.append([
        { type: 'session/title', seq: SessionSeq(0), time, data: { title: '昨日测试会话', messageSeqs: [], source: { kind: 'user' } } },
        { type: 'turn/start', seq: SessionSeq(1), time: time + 1, data: { turn: 1 } },
        { type: 'turn/end', seq: SessionSeq(2), time: time + 2, data: { turn: 1, reason: { kind: 'completed' } } },
      ])
    } finally {
      await writer.close()
    }
    const before = await ctx.sessionPersistence.stat(id)
    const open = vi.spyOn(ctx.sessionPersistence, 'open')
    const pluginUrl = new URL('../../.ci/dsh-yootun-daily-report/index.js', import.meta.url).href
    const { apply } = await import(pluginUrl)
    let route: { handler(request: unknown, response: unknown): Promise<void> } | undefined
    let tool: { execute(): Promise<{ result: unknown }> } | undefined
    apply({
      effect: (setup: () => unknown) => setup(),
      sessionPersistence: ctx.sessionPersistence,
      tools: { schemas: () => [], register(value: typeof tool) { tool = value; return () => {} } },
      webServer: { register(value: typeof route) { route = value; return () => {} } },
    }, { now: () => new Date('2026-09-01T00:00:00+08:00') })
    let status = 0
    let raw = ''
    await route!.handler({ method: 'GET' }, { writeHead(value: number) { status = value }, end(value: string) { raw = value } })
    const body = JSON.parse(raw)
    expect(status).toBe(200)
    expect(body.activity).toMatchObject({
      status: 'ready',
      totals: { sessions: 1, turns: 1, completed: 1, failed: 0, toolCalls: 0 },
      coverage: { total: 1, loaded: 1, failed: 0, unscanned: 0 },
      sessions: [{ title: '昨日测试会话', turns: 1 }],
    })
    expect((await tool!.execute()).result).toEqual(body)
    expect(open.mock.calls).toEqual([[id, 'read'], [id, 'read']])
    expect(await ctx.sessionPersistence.stat(id)).toEqual(before)
    expect(raw).not.toContain(root)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
