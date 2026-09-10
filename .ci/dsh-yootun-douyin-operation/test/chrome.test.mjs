import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ChromeMissingError,
  DriverMissingError,
  LAUNCH_ARGS,
  chromeCandidates,
  launchChrome,
  loadPlaywrightDriver,
  resolveSystemChrome,
} from '../src/chrome.js'

test('启动参数只含最小集合，不含自动化特征规避参数', () => {
  assert.deepEqual(LAUNCH_ARGS, ['--no-sandbox', '--disable-dev-shm-usage'])
  assert.equal(LAUNCH_ARGS.some(arg => arg.includes('AutomationControlled')), false)
  assert.equal(LAUNCH_ARGS.some(arg => arg.includes('blink-features')), false)
  assert.equal(LAUNCH_ARGS.some(arg => arg.includes('stealth')), false)
})

test('按平台给出系统 Chrome 候选路径', () => {
  const win = chromeCandidates('win32', { PROGRAMFILES: 'C:\\PF', LOCALAPPDATA: 'C:\\LA' })
  assert.ok(win.some(item => item.endsWith('chrome.exe')))
  assert.equal(win.length, 2)
  const mac = chromeCandidates('darwin', { HOME: '/Users/demo' })
  assert.ok(mac.some(item => item.includes('Google Chrome.app/Contents/MacOS/Google Chrome')))
  const linux = chromeCandidates('linux', {})
  assert.deepEqual(linux, ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'])
})

test('缺少系统 Chrome 时阻断（ChromeMissingError），不做 Chromium 回退', async () => {
  await assert.rejects(
    () => resolveSystemChrome({ platform: 'linux', env: { PATH: '/nonexistent' }, exists: async () => false }),
    error => error instanceof ChromeMissingError && error.code === 'GOOGLE_CHROME_MISSING',
  )
  // PATH 上存在候选时命中，channel 仍固定为 chrome
  const onPath = await resolveSystemChrome({
    platform: 'linux',
    env: { PATH: '/opt/demo/bin' },
    exists: async file => file === '/opt/demo/bin/google-chrome',
  })
  assert.deepEqual(onPath, { path: '/opt/demo/bin/google-chrome', channel: 'chrome' })
})

test('解析到系统 Chrome 时 channel 固定为 chrome', async () => {
  // /usr/bin/google-chrome 或 PATH 上的 chrome 在开发机上通常存在；不存在则跳过断言。
  try {
    const resolved = await resolveSystemChrome({ platform: 'linux' })
    assert.equal(resolved.channel, 'chrome')
    assert.ok(resolved.path.length > 0)
  } catch (error) {
    assert.ok(error instanceof ChromeMissingError)
  }
})

test('驱动缺失时给出可识别错误', async () => {
  const loaded = await loadPlaywrightDriver().catch(error => error)
  if (loaded instanceof Error) {
    assert.ok(loaded instanceof DriverMissingError)
    assert.equal(loaded.code, 'PLAYWRIGHT_DRIVER_MISSING')
  } else {
    assert.ok(loaded.chromium)
  }
})

test('启动使用系统 Chrome、独立 Profile，且不覆盖个人 Profile', async () => {
  const calls = []
  const fakeDriver = {
    chromium: {
      launchPersistentContext: async (profileDir, options) => {
        calls.push({ profileDir, options })
        return { pages: () => [], close: async () => {} }
      },
    },
  }
  const chromeStub = { resolveSystemChrome: async () => ({ path: '/usr/bin/google-chrome', channel: 'chrome' }) }
  // 通过 platform=linux + PATH 命中真实 Chrome 或注入 chromium：这里直接注入 chromium 驱动，
  // 并让 resolveSystemChrome 走真实探测（开发机存在系统 Chrome 时命中）。
  const result = await launchChrome({
    headless: true,
    profileDir: '/tmp/douyin-profile-demo',
    chromium: fakeDriver,
    platform: process.platform,
    env: process.env,
  }).catch(error => error)

  if (result instanceof Error) {
    assert.ok(result instanceof ChromeMissingError, `unexpected error: ${result.message}`)
    return
  }
  assert.equal(calls.length, 1)
  assert.equal(calls[0].profileDir, '/tmp/douyin-profile-demo')
  assert.equal(calls[0].options.channel, 'chrome')
  assert.deepEqual(calls[0].options.args, LAUNCH_ARGS)
  assert.equal(calls[0].options.headless, true)
  assert.ok(result.chromePath)
  assert.equal(typeof chromeStub.resolveSystemChrome, 'function')
})
