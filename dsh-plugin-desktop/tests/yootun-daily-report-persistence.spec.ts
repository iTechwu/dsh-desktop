import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { expect, it, vi } from 'vitest'

it.each([
  { plugin: 'daily-report', endpoint: 'daily-report', toolName: 'yootun_daily_report', method: 'GET', days: undefined },
  { plugin: 'dashboard', endpoint: 'yesterday', toolName: 'yootun_dashboard_overview', method: 'POST', days: undefined },
  { plugin: 'dashboard', endpoint: 'series', toolName: 'yootun_dashboard_series', method: 'POST', days: 7 },
  { plugin: 'dashboard', endpoint: 'series', toolName: 'yootun_dashboard_series', method: 'POST', days: 30 },
])('$plugin $endpoint ($days) reports real persistence events without mutating the session', async ({ plugin, endpoint, toolName, method, days }) => {
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
    const pluginUrl = new URL(`../../.ci/dsh-yootun-${plugin}/index.js`, import.meta.url).href
    const { apply } = await import(pluginUrl)
    let route: { path: string; handler(request: unknown, response: unknown): Promise<void> } | undefined
    let tool: { name: string; execute(args: { days: number | undefined }): Promise<{ result: unknown }> } | undefined
    apply({
      effect: (setup: () => unknown) => setup(),
      credentials: { resolve: async () => null },
      sessionPersistence: ctx.sessionPersistence,
      tools: { schemas: () => [], register(value: typeof tool) { if (value?.name === toolName) tool = value; return () => {} } },
      webServer: { register(value: typeof route) { if (value?.path.endsWith(`/${endpoint}`)) route = value; return () => {} } },
    }, { now: () => new Date('2026-09-01T00:00:00+08:00') })
    let status = 0
    let raw = ''
    await route!.handler({ method, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ days })) } }, { writeHead(value: number) { status = value }, end(value: string) { raw = value } })
    const body = JSON.parse(raw)
    expect(status).toBe(200)
    expect(body.activity).toMatchObject({
      status: 'ready',
      coverage: { total: 1, loaded: 1, failed: 0, unscanned: 0 },
    })
    const activity = plugin === 'daily-report' ? body.activity : body.activity.data
    expect(activity.totals).toMatchObject({ sessions: 1, turns: 1, toolCalls: 0 })
    expect(activity.totals[plugin === 'daily-report' ? 'completed' : 'completedTurns']).toBe(1)
    if (days) {
      expect(activity.days).toHaveLength(days)
      expect(activity.days.at(-1)).toMatchObject({ date: '2026-08-31', turns: 1 })
    } else {
      expect(activity.sessions).toMatchObject([{ title: '昨日测试会话', turns: 1 }])
    }
    expect((await tool!.execute({ days })).result).toEqual(body)
    expect(open.mock.calls).toEqual([[id, 'read'], [id, 'read']])
    expect(await ctx.sessionPersistence.stat(id)).toEqual(before)
    expect(raw).not.toContain(root)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
