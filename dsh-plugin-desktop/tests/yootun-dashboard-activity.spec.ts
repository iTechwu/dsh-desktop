import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { collectLocalActivity, yesterdayPeriod } from '../src/yootun-dashboard-activity.ts'

function projection(createdAt: number, lastPromptAt: number) {
  return {
    version: 4,
    record: {
      identity: { createdAt, cwd: '/work/acme' },
      rows: {
        title: { val: '整理昨日 GEO 结果' },
        sessionListMetadata: { val: { blank: false, lastPromptAt } },
      },
    },
  }
}

describe('Yootun dashboard local activity', () => {
  it('uses local calendar boundaries across a daylight-saving transition', () => {
    const period = yesterdayPeriod(new Date(2026, 2, 9, 12))
    expect(new Date(period.end).getTime() - new Date(period.start).getTime()).toBeGreaterThan(0)
    expect(period.date).toMatch(/^2026-03-0[78]$/)
  })

  it('aggregates only yesterday events without returning message content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-activity-'))
    const projections = join(root, 'projections')
    await mkdir(projections)
    const start = new Date('2026-08-30T16:00:00.000Z').getTime()
    const end = new Date('2026-08-31T16:00:00.000Z').getTime()
    await writeFile(join(projections, 'session-1.json'), JSON.stringify(projection(start - 1_000, start + 1_000)))
    const inspect = vi.fn(async () => ({
      meta: {},
      events: [
        { type: 'turn/start', time: start + 10, data: { turn: 1 } },
        { type: 'user/message', time: start + 20, data: { message: { content: 'private prompt' } } },
        { type: 'tool/call', time: start + 30, data: { name: 'mcp__geoflow__overview', arguments: { secret: true } } },
        { type: 'assistant/message', time: start + 40, data: { message: {
          content: 'private answer',
          source: { kind: 'model', provider: 'deepseek-official', model: 'model-a' },
          usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 },
        } } },
        { type: 'turn/end', time: start + 50, data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'turn/start', time: end + 10, data: { turn: 2 } },
      ],
    }))
    const result = await collectLocalActivity(projections, {
      inspect,
      locate: () => undefined,
    } as never, {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      date: '2026-08-31',
      timeZone: 'Asia/Shanghai',
    })

    expect(result).toMatchObject({
      totals: { sessions: 1, turns: 1, completedTurns: 1, failedTurns: 0, toolCalls: 1 },
      models: [{ provider: 'deepseek-official', model: 'model-a', inputTokens: 10, outputTokens: 4 }],
      tools: [{ name: 'mcp__geoflow__overview', calls: 1 }],
      sessions: [{ title: '整理昨日 GEO 结果', workspace: 'acme' }],
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('private prompt')
    expect(serialized).not.toContain('private answer')
    expect(serialized).not.toContain('secret')
  })

  it('isolates corrupt projection rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-corrupt-'))
    await writeFile(join(root, 'broken.json'), '{')
    const result = await collectLocalActivity(root, {
      inspect: vi.fn(),
      locate: () => undefined,
    } as never, {
      start: '2026-08-30T16:00:00.000Z',
      end: '2026-08-31T16:00:00.000Z',
      date: '2026-08-31',
      timeZone: 'Asia/Shanghai',
    })
    expect(result.totals.sessions).toBe(0)
  })
})
