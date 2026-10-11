import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PublishError, publishDraft, publishUrl } from '../src/publisher.js'

// ---------------------------------------------------------------------------
// 发布降级主流程（打开创作者中心发布页）：fake context/page + 注入会话判定，
// 聚焦会话失效/验证码 fail-loud 路径与「浏览器保持打开」红线。
// ---------------------------------------------------------------------------

/**
 * fake page：记录 goto 与可见性探测。
 * - captchaVisible：验证码可见（→ CAPTCHA_DETECTED，绝不绕过）
 */
function makeFakePage({ captchaVisible = false } = {}) {
  const page = {
    gotoUrls: [],
    closeCalls: 0,
    closed: false,
    url: () => 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image',
    context: () => page.__context,
    goto: async url => { page.gotoUrls.push(url) },
    isVisible: async selector => {
      if (selector.includes('login-box')) return false
      if (selector.includes('redcaptcha') || selector.includes('captcha')) return captchaVisible
      return false
    },
    close: async () => { page.closeCalls += 1; page.closed = true },
  }
  return page
}

/** fake context：单 page；记录 close（发布流程绝不自动 close）。 */
function makeFakeContext(page) {
  const context = {
    closeCalls: 0,
    pages: () => [page],
    newPage: async () => page,
    close: async () => { context.closeCalls += 1 },
  }
  page.__context = context
  return context
}

function makeChromeFactory(page, { launchError = null, calls = [] } = {}) {
  return async ({ profileDir }) => {
    if (launchError) throw launchError
    calls.push({ profileDir })
    const context = makeFakeContext(page)
    return { context, chromePath: '/usr/bin/google-chrome' }
  }
}

const sessionOk = async () => ({ status: 'ok', profile: { accountId: 'acc-1' } })
const sessionExpired = async () => ({ status: 'expired', reason: 'login_page_detected' })
const sessionUnknown = async () => ({ status: 'unknown', reason: 'user_info_unavailable' })

async function tmpRoot() {
  return mkdtemp(join(tmpdir(), 'xhs-publish-test-'))
}

// ---------------------------------------------------------------------------

test('publishUrl switches target between image and video', () => {
  assert.equal(publishUrl('image'), 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image')
  assert.equal(publishUrl('video'), 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video')
  assert.equal(publishUrl(), 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image')
})

test('publishDraft rejects missing account and invalid target', async t => {
  const rootA = await tmpRoot()
  const rootB = await tmpRoot()
  t.after(() => Promise.all([
    rm(rootA, { recursive: true, force: true }),
    rm(rootB, { recursive: true, force: true }),
  ]))
  const page = makeFakePage()
  const chromeFactory = makeChromeFactory(page)
  await assert.rejects(
    () => publishDraft({ chromeFactory, root: rootA }),
    error => error instanceof PublishError && error.code === 'PUBLISH_FAILED',
  )
  await assert.rejects(
    () => publishDraft({ accountId: 'acc-1', target: 'draft', chromeFactory, root: rootB }),
    error => error instanceof PublishError && error.code === 'PUBLISH_FAILED',
  )
})

test('publishDraft opens the publish page, confirms session and keeps the browser open', async t => {
  const root = await tmpRoot()
  t.after(() => rm(root, { recursive: true, force: true }))
  const page = makeFakePage()
  const launchCalls = []
  const chromeFactory = makeChromeFactory(page, { calls: launchCalls })
  const steps = []
  let hookedContext = null
  const result = await publishDraft({
    accountId: 'acc-1',
    target: 'video',
    root,
    chromeFactory,
    confirmSessionFn: sessionOk,
    onStep: step => steps.push(step),
    onContext: context => { hookedContext = context },
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.context, hookedContext, 'context 通过 onContext 交给宿主（互斥锁随 close 释放）')
  assert.ok(launchCalls[0].profileDir.includes('acc-1'), '使用该账号持久 Profile 目录')
  assert.equal(page.gotoUrls[0], 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video', '直达目标发布页')
  assert.deepEqual(steps, ['prepare', 'open', 'done'])
  assert.equal(page.closeCalls, 0)
  assert.equal(result.context.closeCalls, 0, 'completed 后浏览器保持打开（用户关闭）')
})

test('publishDraft defaults to the image target', async t => {
  const root = await tmpRoot()
  t.after(() => rm(root, { recursive: true, force: true }))
  const page = makeFakePage()
  const result = await publishDraft({
    accountId: 'acc-1',
    root,
    chromeFactory: makeChromeFactory(page),
    confirmSessionFn: sessionOk,
  })
  assert.equal(result.status, 'completed')
  assert.equal(page.gotoUrls[0], 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image')
})

test('publishDraft reports SESSION_EXPIRED and never closes the browser', async t => {
  const root = await tmpRoot()
  t.after(() => rm(root, { recursive: true, force: true }))
  const page = makeFakePage()
  const result = await publishDraft({
    accountId: 'acc-1',
    root,
    chromeFactory: makeChromeFactory(page),
    confirmSessionFn: sessionExpired,
  }).catch(error => error)
  assert.ok(result instanceof PublishError)
  assert.equal(result.code, 'SESSION_EXPIRED')
  assert.equal(page.context().closeCalls, 0, 'failed 后浏览器保持打开（登录页可人工接管）')
})

test('publishDraft fails loud on unknown session (no guessing)', async t => {
  const root = await tmpRoot()
  t.after(() => rm(root, { recursive: true, force: true }))
  const page = makeFakePage()
  const result = await publishDraft({
    accountId: 'acc-1',
    root,
    chromeFactory: makeChromeFactory(page),
    confirmSessionFn: sessionUnknown,
  }).catch(error => error)
  assert.ok(result instanceof PublishError)
  assert.equal(result.code, 'PUBLISH_FAILED')
  assert.match(result.message, /user_info_unavailable/)
  assert.equal(page.context().closeCalls, 0)
})

test('publishDraft detects captcha on the publish page', async t => {
  const root = await tmpRoot()
  t.after(() => rm(root, { recursive: true, force: true }))
  const page = makeFakePage({ captchaVisible: true })
  const result = await publishDraft({
    accountId: 'acc-1',
    root,
    chromeFactory: makeChromeFactory(page),
    confirmSessionFn: sessionOk,
  }).catch(error => error)
  assert.ok(result instanceof PublishError)
  assert.equal(result.code, 'CAPTCHA_DETECTED')
  assert.equal(page.context().closeCalls, 0, '验证码场景浏览器保持打开供人工处理')
})

test('publishDraft propagates chrome launch failures (no browser to keep open)', async t => {
  const root = await tmpRoot()
  t.after(() => rm(root, { recursive: true, force: true }))
  const launchError = Object.assign(new Error('google_chrome_missing'), { code: 'GOOGLE_CHROME_MISSING' })
  let contextHooked = false
  const result = await publishDraft({
    accountId: 'acc-1',
    root,
    chromeFactory: makeChromeFactory(null, { launchError }),
    confirmSessionFn: sessionOk,
    onContext: () => { contextHooked = true },
  }).catch(error => error)
  assert.equal(result.code, 'GOOGLE_CHROME_MISSING', '启动失败原码透传（无 Chrome 可保持）')
  assert.equal(contextHooked, false, 'context 未创建则不触发宿主钩子（finally 释放互斥锁）')
})
