import assert from 'node:assert/strict'
import { tmpdir as osTmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { collectNotes, mapNote, parsePostedPage, summarizeSnapshot } from '../src/collector.js'

// ---------------------------------------------------------------------------
// mapNote：字段映射（live 校准契约）与缺失不补值
// ---------------------------------------------------------------------------

test('mapNote maps the live-calibrated posted fields', () => {
  const row = mapNote({
    id: '69354b42000000001d03e309',
    display_title: '示例笔记标题一：生活分享 🎀',
    type: 'normal',
    sticky: true,
    visible_time: 1765100400,
    view_count: 2034,
    likes: 12,
    collected_count: 8,
    comments_count: 0,
    shared_count: 10,
    images_list: [{ url: 'https://sns-webpic-qc.xhscdn.com/testimg1' }],
  })
  assert.equal(row.contentId, '69354b42000000001d03e309')
  assert.equal(row.title, '示例笔记标题一：生活分享 🎀')
  assert.equal(row.noteType, 'normal')
  assert.equal(row.sticky, true)
  assert.equal(row.publishedAt, new Date(1765100400 * 1000).toISOString())
  assert.deepEqual(row.metrics, { plays: 2034, likes: 12, collects: 8, comments: 0, shares: 10 })
  assert.equal(row.coverUrl, 'https://sns-webpic-qc.xhscdn.com/testimg1')
})

test('mapNote keeps data gaps instead of filling zeros', () => {
  const row = mapNote({ id: 'n-1', display_title: 't', likes: '1.2万' })
  assert.deepEqual(row.metrics, { likes: 12000 }, '「万」计数归一')
  assert.equal(row.noteType, undefined)
  assert.equal(row.publishedAt, undefined)
  assert.equal(row.coverUrl, undefined)
  assert.equal(mapNote({ display_title: 'no id' }), null)
  assert.equal(mapNote(null), null)
})

// ---------------------------------------------------------------------------
// parsePostedPage：翻页解析与终止
// ---------------------------------------------------------------------------

test('parsePostedPage extracts notes and the next page number', () => {
  const { notes, nextPage } = parsePostedPage({
    code: 0,
    data: { page: 2, notes: [{ id: 'a' }, { id: 'b' }], tags: [] },
  })
  assert.deepEqual(notes.map(note => note.contentId), ['a', 'b'])
  assert.equal(nextPage, 2)
  const last = parsePostedPage({ code: 0, data: { notes: [], page: 5 } })
  assert.equal(last.notes.length, 0)
  assert.equal(last.nextPage, 5)
})

test('parsePostedPage fails loud when data.notes is not an array', () => {
  for (const raw of [
    { code: 0, data: { page: 1, notes: undefined } },
    { code: 0, data: { notes: { id: 'x' } } },
    { code: 0 },
  ]) {
    assert.throws(
      () => parsePostedPage(raw),
      error => error.code === 'COLLECT_FAILED' && /notes/u.test(error.message),
      '结构漂移（code=0 但 notes 非数组）必须显式失败，绝不静默当空页',
    )
  }
})

// ---------------------------------------------------------------------------
// summarizeSnapshot：六项求和 + dataGap 不补零
// ---------------------------------------------------------------------------

test('summarizeSnapshot sums metrics and counts gaps without zero filling', () => {
  const summary = summarizeSnapshot({
    notes: [
      { contentId: 'a', metrics: { plays: 100, likes: 10 } },
      { contentId: 'b', metrics: { plays: 23, likes: 5, collects: 1, comments: 2, shares: 3 } },
      { contentId: 'c' },
    ],
    capturedAt: '2026-09-29T00:00:00.000Z',
  })
  assert.equal(summary.notesCount, 3)
  assert.deepEqual(summary.totals, { plays: 123, likes: 15, collects: 1, comments: 2, shares: 3 })
  assert.deepEqual(summary.gaps, { plays: 1, likes: 1, collects: 2, comments: 2, shares: 2 })
  assert.equal(summary.capturedAt, '2026-09-29T00:00:00.000Z')
})

// ---------------------------------------------------------------------------
// collectNotes：fake page 注入驱动翻页/终止/fail-loud
// ---------------------------------------------------------------------------

function makeFakePage({ responses, hasSign = true, loginUrl = null, captchaVisible = false, signReady = true }) {
  const page = {
    url: () => loginUrl || 'https://creator.xiaohongshu.com/new/note-manager',
    goto: async () => {},
    isVisible: async selector => (selector.includes('login-box') ? Boolean(loginUrl) : captchaVisible),
    waitForFunction: async (_fn, _arg, options) => {
      if (!signReady) throw new Error('timeout')
    },
    evaluate: async (_js, url) => {
      const key = url
      const next = responses.shift()
      if (next === undefined) throw new Error(`unexpected fetch: ${key}`)
      return typeof next === 'string' ? next : JSON.stringify(next)
    },
  }
  page.__hasSign = hasSign
  return page
}

function makeFakeContext(page, { trackClosed = [] } = {}) {
  return {
    pages: () => [page],
    close: async () => { trackClosed.push('closed') },
  }
}

function makeChromeFactory(page) {
  const calls = []
  const chromeFactory = async ({ headless, profileDir }) => {
    calls.push({ headless, profileDir })
    return { context: makeFakeContext(page) }
  }
  chromeFactory.calls = calls
  return chromeFactory
}

const sleepFn = () => Promise.resolve()

test('collectNotes paginates until an empty page and stores a local snapshot', async t => {
  const root = makeRoot(t)
  const page = makeFakePage({
    responses: [
      { code: 0, data: { page: 1, notes: [{ id: 'a', view_count: 5 }] } },
      { code: 0, data: { page: null, notes: [{ id: 'b', likes: 2 }, { id: 'c' }] } },
    ],
  })
  const chromeFactory = makeChromeFactory(page)
  const progress = []
  const result = await collectNotes({
    accountId: 'acc-1',
    root,
    chromeFactory,
    sleepFn,
    onProgress: p => progress.push(p),
  })
  assert.equal(result.pagesDone, 2)
  assert.equal(result.notesTotal, 3)
  assert.deepEqual(progress, [{ pagesDone: 1, notesTotal: 1 }, { pagesDone: 2, notesTotal: 3 }])
  assert.equal(chromeFactory.calls[0].headless, true, '采集为无头（复用 Profile）')
  assert.match(chromeFactory.calls[0].profileDir, /profiles\/acc-1$/u)
  assert.match(result.snapshotPath, /data\/acc-1\/notes-.+\.json$/u)
  assert.equal(result.summary.notesCount, 3)
  // 快照只落设备端本地文件（Q10），并带 live 契约的 schema 标记
  const { readFile } = await import('node:fs/promises')
  const snapshot = JSON.parse(await readFile(result.snapshotPath, 'utf8'))
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.source, 'creator-web')
  assert.equal(snapshot.notes.length, 3)
})

test('collectNotes surfaces truncated when the page limit stops pagination', async t => {
  const root = makeRoot(t)
  const page = makeFakePage({
    responses: [
      { code: 0, data: { page: 1, notes: [{ id: 'a' }] } },
      { code: 0, data: { page: 2, notes: [{ id: 'b' }] } },
    ],
  })
  const result = await collectNotes({
    accountId: 'acc-6',
    root,
    chromeFactory: makeChromeFactory(page),
    sleepFn,
    maxPages: 2,
  })
  assert.equal(result.pagesDone, 2)
  assert.equal(result.notesTotal, 2)
  assert.equal(result.truncated, true, '触达页数上限且仍有下一页必须透出 truncated，绝不静默截断')
  const { readFile } = await import('node:fs/promises')
  const snapshot = JSON.parse(await readFile(result.snapshotPath, 'utf8'))
  assert.equal(snapshot.truncated, true, '快照同样带 truncated 标记')
})

test('collectNotes fails loud when the page does not expose the sign function', async t => {
  const root = makeRoot(t)
  const page = makeFakePage({ responses: [], signReady: false })
  await assert.rejects(
    collectNotes({ accountId: 'acc-2', root, chromeFactory: makeChromeFactory(page), sleepFn }),
    error => error.code === 'COLLECT_FAILED' && /_webmsxyw/u.test(error.message),
    '签名函数缺失必须 fail-loud，绝不静默当空列表',
  )
})

test('collectNotes fails loud on a business error code from the posted API', async t => {
  const root = makeRoot(t)
  const page = makeFakePage({ responses: [{ code: -1, data: {} }] })
  await assert.rejects(
    collectNotes({ accountId: 'acc-3', root, chromeFactory: makeChromeFactory(page), sleepFn }),
    error => error.code === 'COLLECT_FAILED' && /-1/u.test(error.message),
  )
})

test('collectNotes reports session expiry when redirected to the login page', async t => {
  const root = makeRoot(t)
  const page = makeFakePage({ responses: [], loginUrl: 'https://creator.xiaohongshu.com/login?redirectReason=401' })
  await assert.rejects(
    collectNotes({ accountId: 'acc-4', root, chromeFactory: makeChromeFactory(page), sleepFn }),
    error => error.code === 'SESSION_EXPIRED',
  )
})

test('collectNotes reports captcha instead of bypassing it', async t => {
  const root = makeRoot(t)
  const page = makeFakePage({ responses: [], captchaVisible: true, signReady: false })
  await assert.rejects(
    collectNotes({ accountId: 'acc-5', root, chromeFactory: makeChromeFactory(page), sleepFn }),
    error => error.code === 'CAPTCHA_DETECTED',
    '验证码出现即失败，绝不自动绕过（红线）',
  )
})

function makeRoot(t) {
  const root = join(osTmpdir(), `xhs-collect-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })) })
  return root
}
