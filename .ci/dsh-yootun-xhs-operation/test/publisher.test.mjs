import assert from 'node:assert/strict'
import { readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  computeSaveDraftClick,
  HUMANIZED_DELAYS,
  publishDraft,
  publishUrl,
  randomInRange,
  resolveMaterials,
  TITLE_MAX_CHARS,
  TAGS_MAX,
} from '../src/publisher.js'

const sleepFnNoop = () => Promise.resolve()

// ---------------------------------------------------------------------------
// fake 注入件：page/context/CDP 全 fake，聚焦状态机、拟人化延时与 fail-loud 路径
// ---------------------------------------------------------------------------

function makeFakeLocator({ visible = true, waitForFails = false, clickLog = null, selector = '' } = {}) {
  const locator = {
    isVisible: async () => visible,
    innerText: async () => '',
    count: async () => 1,
    waitFor: async () => { if (waitForFails) throw new Error('candidate timeout') },
    click: async () => { if (clickLog) clickLog.push(selector) },
    setInputFiles: async () => {},
  }
  locator.first = () => locator
  return locator
}

/**
 * fake page：记录 keyboard/mouse/goto/evaluate 交互。
 * - titleVisible：图片上传就绪信号（标题框可见）
 * - videoDoneVisible：视频完成信号候选可见
 * - captchaVisible：验证码可见（→ CAPTCHA_DETECTED，绝不绕过）
 * - toastsQueue：drain 时依次吐出的 toast 批次
 */
function makeFakePage({
  titleVisible = true,
  videoDoneVisible = false,
  captchaVisible = false,
  captchaAfterN = 0,           // 第 N 次 captcha 探测后才可见（用于定位 CAPTCHA 出现的流程阶段）
  visibilityVisible = true,
  privateVisible = null,       // 「仅自己可见」可见性（默认跟随 visibilityVisible）
  topicCandidateFails = false,
  toastsQueue = [],
} = {}) {
  const page = {
    captchaCalls: 0,
    keyboardLog: [],
    clickLog: [],
    mouseLog: [],
    typedText: '',
    gotoUrls: [],
    setInputCalls: [],
    observersMounted: 0,
    closed: false,
    url: () => 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image',
    goto: async url => { page.gotoUrls.push(url) },
    isVisible: async selector => {
      if (selector.includes('login-box')) return false
      if (selector.includes('redcaptcha') || selector.includes('captcha')) {
        page.captchaCalls = (page.captchaCalls || 0) + 1
        return captchaVisible && page.captchaCalls > captchaAfterN
      }
      // 图片上传就绪信号 = 标题框 visible（page.isVisible 直调路径）
      if (selector.includes('填写标题')) return titleVisible
      return false
    },
    locator(selector) {
      if (selector.includes('填写标题')) return makeFakeLocator({ visible: titleVisible })
      if (selector.includes('输入正文描述')) return makeFakeLocator({ visible: true })
      if (selector.includes('upload-input') || selector.includes('type="file"')) return makeFakeLocator({ visible: true, setInput: true })
      if (selector.includes('creator-editor-topic-container') && selector.includes('.item')) return makeFakeLocator({ visible: !topicCandidateFails, waitForFails: topicCandidateFails })
      if (selector.includes('creator-editor-topic-container')) return makeFakeLocator({ visible: !topicCandidateFails, waitForFails: topicCandidateFails })
      if (selector.includes('公开可见')) return makeFakeLocator({ visible: visibilityVisible, clickLog: page.clickLog, selector })
      if (selector.includes('仅自己可见')) return makeFakeLocator({ visible: privateVisible === null ? visibilityVisible : privateVisible, clickLog: page.clickLog, selector })
      return makeFakeLocator({ visible: videoDoneVisible })
    },
    keyboard: {
      type: async (text, _opts) => {
        page.keyboardLog.push({ kind: 'type', text })
        page.typedText += text
      },
      press: async key => { page.keyboardLog.push({ kind: 'press', key }) },
    },
    mouse: {
      move: async (x, y) => page.mouseLog.push(['move', x, y]),
      down: async () => page.mouseLog.push(['down']),
      up: async () => page.mouseLog.push(['up']),
    },
    evaluate: async js => {
      if (typeof js === 'string' && js.includes('__xhsToasts = []')) { page.observersMounted++; return undefined }
      if (typeof js === 'string' && js.includes('splice(0)')) return toastsQueue.shift() || []
      return undefined
    },
  }
  return page
}

function makeFakeContext(page, { trackClosed } = {}) {
  const context = {
    pages: () => [page],
    newPage: async () => page,
    newCDPSession: async () => makeFakeCdp(),
    storageState: async ({ path }) => {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, JSON.stringify({ cookies: [], origins: [] }), 'utf8')
    },
    close: async () => { trackClosed.push('closed') },
  }
  return context
}

/** fake CDP：「暂存离开」host 盒模型（stage0 真机形状：x935 y100 w864 h50）。 */
function makeFakeCdp({ resultCount = 1 } = {}) {
  return {
    sends: [],
    async send(method, params) {
      this.sends.push({ method, params })
      if (method === 'DOM.performSearch') return { searchId: 's1', resultCount }
      if (method === 'DOM.getSearchResults') return { nodeIds: [11] }
      if (method === 'DOM.describeNode') return { node: { nodeType: 1 } }
      if (method === 'DOM.getBoxModel') return { model: { content: [935, 100, 1799, 100, 1799, 150, 935, 150] } }
      return {}
    },
  }
}

function makeFixture(overrides = {}) {
  const trackClosed = []
  const page = overrides.page || makeFakePage(overrides.pageOpts)
  const context = makeFakeContext(page, { trackClosed })
  const chromeCalls = []
  const chromeFactory = async options => {
    chromeCalls.push(options)
    return { context }
  }
  const probeCalls = []
  const probeFn = async options => {
    probeCalls.push(options)
    return overrides.probeResult || { status: 'ok' }
  }
  const sleeps = []
  const sleepFn = async ms => { sleeps.push(ms) }
  const downloads = []
  const downloadFn = async (url, destPath) => {
    downloads.push(url)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(destPath, 'material-bytes', 'utf8')
    return destPath
  }
  const steps = []
  const root = overrides.root || join(tmpdir(), `xhs-pub-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const workDir = join(tmpdir(), `xhs-pub-work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const options = {
    accountId: 'acc-1',
    title: '测试标题',
    body: '正文内容。',
    tags: ['本地生活'],
    imageUrls: ['https://cdn.example/a.jpg'],
    root,
    chromeFactory,
    probeFn,
    sleepFn,
    randomFn: () => 0,
    downloadFn,
    workDir,
    onStep: step => steps.push(step),
    ...overrides.options,
  }
  return { options, page, trackClosed, chromeCalls, probeCalls, sleeps, downloads, steps, workDir, root }
}

// ---------------------------------------------------------------------------
// randomInRange / publishUrl / computeSaveDraftClick：纯函数
// ---------------------------------------------------------------------------

test('randomInRange honors both bounds with an injected random', () => {
  assert.equal(randomInRange([80, 160], () => 0), 80)
  assert.equal(randomInRange([80, 160], () => 1), 160)
  assert.equal(randomInRange([80, 160], () => 0.5), 120)
  // 倒序区间也收敛到同一界
  assert.equal(randomInRange([160, 80], () => 0), 80)
})

test('publishUrl switches target between image and video', () => {
  assert.equal(publishUrl('image'), 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image')
  assert.equal(publishUrl('video'), 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video')
  assert.equal(publishUrl('other'), 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image')
})

test('computeSaveDraftClick lands on the left button at 0.40 of the host box', () => {
  // stage0 真机标定：host x935 w864 → 暂存离开中心 ≈ x+0.40w，垂直居中
  const click = computeSaveDraftClick({ x: 935, y: 100, w: 864, h: 50 })
  assert.equal(click.x, 935 + Math.round(864 * 0.40))
  assert.equal(click.y, 125)
})

// ---------------------------------------------------------------------------
// 拟人化延时表：全随机区间、常量表完整（README §5.3）
// ---------------------------------------------------------------------------

test('HUMANIZED_DELAYS covers every transition with randomized ranges', () => {
  for (const [key, [min, max]] of Object.entries(HUMANIZED_DELAYS)) {
    assert.ok(Number.isFinite(min) && Number.isFinite(max), `${key} must be a range`)
    assert.ok(min > 0 && max > min, `${key} must be a positive random range, never fixed`)
  }
  // 重点缓冲：素材上传完成 → 聚焦标题 2–4s（README §5.3 加粗行）
  assert.deepEqual(HUMANIZED_DELAYS.uploadToTitle, [2000, 4000])
  assert.deepEqual(HUMANIZED_DELAYS.openToUpload, [1500, 3000])
  assert.deepEqual(HUMANIZED_DELAYS.beforeSaveDraft, [2000, 4000])
  assert.equal(TAGS_MAX, 10)
  assert.equal(TITLE_MAX_CHARS, 20)
})

// ---------------------------------------------------------------------------
// publishDraft：成功主流程（图片）
// ---------------------------------------------------------------------------

test('publishDraft completes the full image flow and keeps the browser open', async t => {
  const fx = makeFixture({
    pageOpts: { toastsQueue: [[{ cls: 'd-toast', text: '保存成功' }]] },
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  const result = await publishDraft(fx.options)
  assert.equal(result.status, 'completed')
  assert.match(result.toast, /成功/u)
  // 步骤序列（dev-implementation §2.3）
  assert.deepEqual(fx.steps, ['prepare', 'open', 'upload', 'fill', 'saveDraft', 'done'])
  // 有头 + 该账号 Profile；浏览器保持打开（README §5.3：由用户关闭）
  assert.equal(fx.chromeCalls[0].headless, false)
  assert.match(fx.chromeCalls[0].profileDir, /profiles\/acc-1$/u)
  assert.deepEqual(fx.trackClosed, [], '浏览器保持打开，绝不自动关闭')
  // 打开发布页 target=image；toast 观察器已挂载；storage_state 已回写
  assert.match(fx.page.gotoUrls[0], /target=image/u)
  assert.equal(fx.page.observersMounted, 1)
  const { paths } = await import('../src/state.js')
  const backup = JSON.parse(await readFile(paths(fx.root).storageStatePath('acc-1'), 'utf8'))
  assert.deepEqual(backup, { cookies: [], origins: [] })
  // 素材下载 1 张 + tmp 清理
  assert.deepEqual(fx.downloads, ['https://cdn.example/a.jpg'])
  await assert.rejects(stat(fx.workDir))
})

test('publishDraft follows the humanized delay table at the lower bounds', async t => {
  const fx = makeFixture({ pageOpts: { toastsQueue: [[{ text: '保存成功' }]] } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await publishDraft(fx.options)
  // randomFn=() => 0 → 全部取下界：抽关键点位断言（README §5.3 表）
  assert.equal(fx.sleeps[0], 1500, '打开发布页 → 上传素材 1.5–3s 下界')
  const uploadToTitleIndex = fx.sleeps.indexOf(2000)
  assert.notEqual(uploadToTitleIndex, -1, '上传完成 → 聚焦标题 2–4s 下界（重点缓冲）')
  const beforeSaveIndex = fx.sleeps.lastIndexOf(2000)
  assert.ok(beforeSaveIndex > uploadToTitleIndex, '填写完成 → 暂存离开 2–4s 下界（模拟检查）')
  // 标题逐字 80ms/字符（下界）
  assert.ok(fx.sleeps.includes(80), '标题逐字 80–160ms')
  // 句号后额外停顿 300ms（正文以「。」结尾，下界）
  assert.ok(fx.sleeps.includes(300), '句号/换行后额外停顿 300–800ms')
  // 话题候选出现 → 点击 500ms；话题间 1000ms
  assert.ok(fx.sleeps.includes(500))
  assert.ok(fx.sleeps.includes(1000))
  // CDP 点击前的 hover/mouse 节奏（真机校准：move → 400ms → down → 80ms → up）
  assert.deepEqual(fx.page.mouseLog.at(-3), ['move', 1281, 125])
  assert.deepEqual(fx.page.mouseLog.slice(-2), [['down'], ['up']])
})

test('publishDraft clips the title to 20 chars and clears the body with triple stroke', async t => {
  const fx = makeFixture({
    options: { title: '一二三四五六七八九十一二三四五六七八九十一二三四五', body: '新正文' },
    pageOpts: { toastsQueue: [[{ text: '保存成功' }]] },
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await publishDraft(fx.options)
  // 标题逐字录入是每字符一条 type 记录：前 20 条恰为截断后的标题，第 21 条已是正文。
  const typeTexts = fx.page.keyboardLog.filter(entry => entry.kind === 'type').map(entry => entry.text)
  assert.equal(typeTexts.slice(0, TITLE_MAX_CHARS).join(''), '一二三四五六七八九十一二三四五六七八九十', '标题 20 字截断（README §5.3）')
  assert.notEqual(typeTexts[TITLE_MAX_CHARS], '一', '第 21 字符不再属于标题（截断生效）')
  // 正文清空三连（Backspace / Ctrl+A / Delete）出现在正文录入前
  const pressKeys = fx.page.keyboardLog.filter(entry => entry.kind === 'press').map(entry => entry.key)
  const clearIndex = pressKeys.indexOf('Backspace')
  assert.notEqual(clearIndex, -1)
  assert.deepEqual(pressKeys.slice(clearIndex, clearIndex + 3), ['Backspace', 'Control+a', 'Delete'])
})

test('publishDraft sets private visibility before saving the draft', async t => {
  const fx = makeFixture({ pageOpts: { toastsQueue: [[{ text: '保存成功' }]] } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await publishDraft(fx.options)
  // 防误发布保险（dev-implementation §2.4）：先点「公开可见」展开菜单，再点「仅自己可见」。
  const clicks = fx.page.clickLog
  const publicIndex = clicks.indexOf('text=公开可见')
  const privateIndex = clicks.indexOf('text=仅自己可见')
  assert.ok(publicIndex !== -1, '先点击当前可见性控件展开菜单')
  assert.ok(privateIndex !== -1, '再点击「仅自己可见」')
  assert.ok(privateIndex > publicIndex, '可见性设置顺序：展开 → 选仅自己可见')
})

// ---------------------------------------------------------------------------
// publishDraft：fail-loud 路径（浏览器全部保持打开）
// ---------------------------------------------------------------------------

test('publishDraft detects captcha during fill (after upload passed)', async t => {
  // captcha 探测第 2 次起可见：upload 轮询第 1 次通过，fill 阶段抛 CAPTCHA_DETECTED。
  const fx = makeFixture({ pageOpts: { captchaVisible: true, captchaAfterN: 1, toastsQueue: [[{ text: '保存成功' }]] } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'CAPTCHA_DETECTED',
    '审查 P1：fill 阶段验证码同样失败（红线全流程覆盖）',
  )
  assert.ok(!fx.steps.includes('saveDraft'), 'fill 阶段失败不得推进到 saveDraft')
  assert.deepEqual(fx.trackClosed, [])
})

test('publishDraft detects captcha before save draft', async t => {
  // captcha 探测第 3 次起可见：upload/fill 各通过 1 次，saveDraft 前抛。
  const fx = makeFixture({ pageOpts: { captchaVisible: true, captchaAfterN: 2, toastsQueue: [[{ text: '保存成功' }]] } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'CAPTCHA_DETECTED',
    '审查 P1：saveDraft 前验证码同样失败',
  )
  assert.deepEqual(fx.trackClosed, [])
})

test('publishDraft only treats save-success toasts as saved (not upload success)', async t => {
  const fx = makeFixture({ pageOpts: { toastsQueue: [[{ cls: 'd-toast', text: '上传成功' }]] } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'SAVE_DRAFT_NO_RESPONSE',
    '审查 P2：非「保存成功」toast 不得误判为草稿保存成功',
  )
  assert.deepEqual(fx.trackClosed, [])
})

test('publishDraft is idempotent when visibility is already private', async t => {
  const fx = makeFixture({ pageOpts: { visibilityVisible: false, privateVisible: true, toastsQueue: [[{ text: '保存成功' }]] } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  const result = await publishDraft(fx.options)
  assert.equal(result.status, 'completed', '审查 P2：已默认私密时幂等通过，不再 SELECTOR_MISSING')
  assert.ok(!fx.page.clickLog.includes('text=公开可见'), '无需重复展开可见性菜单')
})

test('publishDraft fails with CAPTCHA_DETECTED and never closes the browser', async t => {
  const fx = makeFixture({ pageOpts: { captchaVisible: true } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'CAPTCHA_DETECTED',
    '验证码出现即失败，绝不自动绕过（红线）',
  )
  assert.deepEqual(fx.trackClosed, [], '验证码场景浏览器保持打开供人工处理')
})

test('publishDraft reports SESSION_EXPIRED without opening the publish browser', async t => {
  const fx = makeFixture({ probeResult: { status: 'expired' } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'SESSION_EXPIRED',
  )
  assert.deepEqual(fx.chromeCalls, [], 'probe 不过关时不打开有头浏览器')
  assert.deepEqual(fx.steps, ['prepare'])
})

test('publishDraft reports SAVE_DRAFT_NO_RESPONSE when the toast is not captured', async t => {
  const fx = makeFixture({ pageOpts: { toastsQueue: [] } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'SAVE_DRAFT_NO_RESPONSE',
    '15s 未捕获「保存成功」toast → 受控失败，浏览器保持打开供人工确认',
  )
  assert.deepEqual(fx.trackClosed, [])
})

test('publishDraft times out image upload when the title never appears', async t => {
  const fx = makeFixture({
    pageOpts: { titleVisible: false },
    options: { now: (() => { let value = 0; return () => (value += 2000) })() },
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'UPLOAD_TIMEOUT',
  )
  assert.deepEqual(fx.trackClosed, [], '上传超时浏览器保持打开，素材与文案不丢')
})

test('publishDraft requires the visibility control (forced private)', async t => {
  const fx = makeFixture({ pageOpts: { visibilityVisible: false, toastsQueue: [[{ text: '保存成功' }]] } })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'SELECTOR_MISSING',
    '找不到可见性控件即中断：绝不带着公开可见状态点击保存区按钮',
  )
  assert.deepEqual(fx.trackClosed, [])
})

// ---------------------------------------------------------------------------
// publishDraft：话题、视频与素材解析
// ---------------------------------------------------------------------------

test('publishDraft skips a topic whose suggestion candidates never show up', async t => {
  const fx = makeFixture({
    options: { tags: ['本地生活', '周末去哪'] },
    pageOpts: { topicCandidateFails: true, toastsQueue: [[{ text: '保存成功' }]] },
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  const result = await publishDraft(fx.options)
  assert.equal(result.status, 'completed', '候选失败仅跳过该话题，不中断发布')
  // 每个失败话题键入后按等长 Backspace 清除（正文清空三连另含 1 个 Backspace，扣除）
  const backspaces = fx.page.keyboardLog.filter(entry => entry.kind === 'press' && entry.key === 'Backspace').length - 1
  assert.equal(backspaces, '#本地生活'.length + '#周末去哪'.length)
})

test('publishDraft caps topics at ten', async t => {
  const fx = makeFixture({
    options: { tags: Array.from({ length: 12 }, (_v, i) => `话题${i + 1}`) },
    pageOpts: { toastsQueue: [[{ text: '保存成功' }]] },
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await publishDraft(fx.options)
  const typedTags = fx.page.keyboardLog.filter(entry => entry.kind === 'type' && entry.text.startsWith('#'))
  assert.equal(typedTags.length, 10, '话题 ≤10（README §5.3）')
})

test('publishDraft opens the video publish page and waits for the video-done signal', async t => {
  const fx = makeFixture({
    options: { imageUrls: [], videoUrl: 'https://cdn.example/b.mp4' },
    pageOpts: { videoDoneVisible: true, toastsQueue: [[{ text: '保存成功' }]] },
  })
  fx.page.url = () => 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video'
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  const result = await publishDraft(fx.options)
  assert.equal(result.status, 'completed')
  assert.match(fx.page.gotoUrls[0], /target=video/u)
  assert.deepEqual(fx.downloads, ['https://cdn.example/b.mp4'])
})

test('resolveMaterials prefers local paths and downloads http urls into a 0700 dir', async t => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const workDir = join(tmpdir(), `xhs-pub-resolve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const localFile = join(workDir, 'local.png')
  await mkdir(workDir, { recursive: true })
  await writeFile(localFile, 'local-bytes')
  t.after(() => rm(workDir, { recursive: true, force: true }).catch(() => {}))
  const downloads = []
  const { paths, cleanup } = await resolveMaterials({
    imageUrls: [localFile, 'https://cdn.example/2.jpg'],
    workDir,
    downloadFn: async (url, dest) => { downloads.push(url); const { writeFile: w } = await import('node:fs/promises'); await w(dest, 'dl') },
  })
  assert.equal(paths[0], localFile, '本地路径直用，不下载')
  assert.equal(downloads.length, 1, '仅 http URL 下载')
  await cleanup()
  await assert.rejects(stat(paths[1]), undefined, 'cleanup 删除下载的临时素材')
})

test('resolveMaterials accepts {path,url} entries with local-first and url fallback', async t => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const workDir = join(tmpdir(), `xhs-pub-obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const localFile = join(workDir, 'picked.png')
  await mkdir(workDir, { recursive: true })
  await writeFile(localFile, 'picked-bytes')
  const downloads = []
  const { paths, cleanup } = await resolveMaterials({
    imageUrls: [
      // path 存在 → 直用本地文件，不下载
      { path: localFile, url: 'https://cdn.example/1.jpg' },
      // path 不存在（文件已被清理）→ 回退 URL 下载兜底
      { path: join(workDir, 'missing.png'), url: 'https://cdn.example/2.jpg' },
    ],
    workDir: join(workDir, 'materials'),
    downloadFn: async (url, dest) => {
      downloads.push(url)
      const { writeFile: w } = await import('node:fs/promises')
      await w(dest, 'dl')
      return dest
    },
  })
  assert.equal(paths[0], localFile, '对象形态 path 存在时本地优先（review M1）')
  assert.deepEqual(downloads, ['https://cdn.example/2.jpg'], 'path 不可用回退 URL 下载')
  await cleanup()
})

test('resolveMaterials treats windows drive paths as local and fails loud when missing', async t => {
  const workDir = join(tmpdir(), `xhs-pub-win-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  t.after(() => rm(workDir, { recursive: true, force: true }).catch(() => {}))
  // Windows 盘符路径（chrome.js 支持 win32）：按本地路径处理——不存在时报 not found 而非「既非路径也非 URL」。
  await assert.rejects(
    resolveMaterials({
      imageUrls: [{ path: 'C:\\Users\\demo\\picked.png', url: null }],
      workDir,
      downloadFn: async () => { throw new Error('must not download') },
    }),
    error => /material not found/u.test(error.message),
    '盘符路径识别为本地文件（review M1 win32 兼容）',
  )
})

test('resolveMaterials cleans up downloaded files when a later entry fails', async t => {
  const workDir = join(tmpdir(), `xhs-pub-clean-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  t.after(() => rm(workDir, { recursive: true, force: true }).catch(() => {}))
  const downloads = []
  await assert.rejects(
    resolveMaterials({
      imageUrls: ['https://cdn.example/ok.jpg', 'https://cdn.example/broken.jpg'],
      workDir,
      downloadFn: async (url, dest) => {
        if (url.includes('broken')) throw new Error('download failed')
        downloads.push(url)
        const { writeFile } = await import('node:fs/promises')
        await writeFile(dest, 'dl')
        return dest
      },
    }),
    /download failed/u,
    '第二个素材下载失败整体失败',
  )
  // 解析失败自清（review MINOR-3）：已下载的前序素材不残留在 tmp。
  await assert.rejects(stat(workDir))
})

test('publishDraft times out video upload when no done signal appears', async t => {
  const fx = makeFixture({
    options: { imageUrls: [], videoUrl: 'https://cdn.example/b.mp4' },
    pageOpts: { videoDoneVisible: false },
  })
  fx.page.url = () => 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video'
  // now 注入快进：轮询期间时钟推进 2s/次 → 8 分钟视频上限到期（review MINOR-5）。
  fx.options.now = (() => { let value = 0; return () => (value += 2000) })()
  t.after(() => rm(fx.root, { recursive: true, force: true }).catch(() => {}))
  await assert.rejects(
    publishDraft(fx.options),
    error => error.code === 'UPLOAD_TIMEOUT',
    '视频完成信号永不出现 → UPLOAD_TIMEOUT，绝不提前暂存',
  )
  assert.deepEqual(fx.trackClosed, [], '视频上传超时浏览器保持打开')
})
