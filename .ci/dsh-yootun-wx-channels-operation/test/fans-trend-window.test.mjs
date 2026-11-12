// fans_trend 回填窗口集成回归（伪造 page，不触网）：锁定起点 2026-01-01 与分块边界。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collectFansTrendWindowed } from '../src/runner.js'
import { COLLECT_SINCE_DAY } from '../src/collector.js'
import { shanghaiDayStartTs } from '../src/parse.js'

const NOW_MS = Date.parse('2026-11-12T12:00:00+08:00')

/** 伪造 page：记录每次 fans_trend 请求体，按窗口返回合法长度的四指标序列。 */
function fakeFansTrendPage() {
  const calls = []
  return {
    calls,
    async evaluate(_fn, arg) {
      const body = arg.body
      calls.push(body)
      const length = Math.floor((Number(body.endTs) - Number(body.startTs)) / 86400) + 1
      const zeros = () => Array.from({ length }, () => 0)
      const payload = {
        errCode: 0,
        errMsg: 'request successful',
        data: { add: zeros(), reduce: zeros(), netAdd: zeros(), total: zeros() },
      }
      return { status: 200, text: JSON.stringify(payload) }
    },
  }
}

test('collectFansTrendWindowed：起点 2026-01-01、2 块、315 天且相邻不重叠', async () => {
  const page = fakeFansTrendPage()
  const result = await collectFansTrendWindowed(page, { finderId: 'f1', now: () => NOW_MS })

  assert.equal(page.calls.length, 2)
  assert.equal(page.calls[0].startTs, String(shanghaiDayStartTs(COLLECT_SINCE_DAY)))
  assert.equal(page.calls[0].endTs, String(shanghaiDayStartTs('2026-06-29')))
  assert.equal(page.calls[1].startTs, String(shanghaiDayStartTs('2026-06-30')))
  assert.equal(page.calls[1].endTs, String(shanghaiDayStartTs('2026-11-11')))

  assert.equal(result.startDay, COLLECT_SINCE_DAY)
  assert.equal(result.endDay, '2026-11-11')
  assert.equal(result.daily.length, 315)
  assert.equal(result.daily[0].day, '2026-01-01')
  assert.equal(result.daily.at(-1).day, '2026-11-11')
  assert.equal(new Set(result.daily.map(row => row.day)).size, 315)
})
