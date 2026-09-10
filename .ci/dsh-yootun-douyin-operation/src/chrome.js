// 系统 Google Chrome 探测与启动（设备端）。
//
// 合规约定（docs/0909/douyin §13）：
// - 只用用户设备上已安装的系统 Google Chrome（Playwright `channel: 'chrome'`）；
// - **不打包、不下载 Chromium**，无系统 Chrome 时阻断并提示「请安装 Google Chrome」；
// - 启动参数只有 `--no-sandbox` / `--disable-dev-shm-usage`；**不使用**
//   `--disable-blink-features=AutomationControlled`，不引入 stealth / patchright 等
//   反检测内核或指纹伪装参数。

import { access, constants } from 'node:fs/promises'
import { platform as osPlatform } from 'node:os'
import { delimiter, join } from 'node:path'

export class ChromeMissingError extends Error {
  constructor() {
    super('google_chrome_missing')
    this.name = 'ChromeMissingError'
    this.code = 'GOOGLE_CHROME_MISSING'
  }
}

export class DriverMissingError extends Error {
  constructor(cause) {
    super('playwright_driver_missing')
    this.name = 'DriverMissingError'
    this.code = 'PLAYWRIGHT_DRIVER_MISSING'
    this.cause = cause
  }
}

// 允许的最小启动参数：不追加任何自动化特征规避或指纹伪装参数。
export const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage']

// 各平台系统 Chrome 常见安装位置（仅用于探测，不下载）。
export function chromeCandidates(platform = osPlatform(), env = process.env) {
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter(Boolean)
    return roots.map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      join(env.HOME || '', 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    ].filter(Boolean)
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome']
}

// PATH 上的命令名（Linux/macOS）。
const COMMAND_CANDIDATES = ['google-chrome', 'google-chrome-stable', 'chrome']

async function isExecutable(file) {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findOnPath(env, exists) {
  const dirs = String(env.PATH || '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const name of COMMAND_CANDIDATES) {
      const candidate = join(dir, name)
      if (await exists(candidate)) return candidate
    }
  }
  return null
}

/**
 * 解析系统 Chrome 可执行文件。
 *
 * @param {{ platform?: string, env?: object, exists?: (file: string) => Promise<boolean> }} [options]
 *   `exists` 仅用于测试注入，默认走文件系统探测。
 * @returns {Promise<{ path: string, channel: string }>} channel 固定为 'chrome'
 * @throws {ChromeMissingError} 设备上没有系统 Chrome（阻断，不做 Chromium 回退）
 */
export async function resolveSystemChrome({ platform = osPlatform(), env = process.env, exists = isExecutable } = {}) {
  for (const candidate of chromeCandidates(platform, env)) {
    if (await exists(candidate)) return { path: candidate, channel: 'chrome' }
  }
  if (platform !== 'win32') {
    const onPath = await findOnPath(env, exists)
    if (onPath) return { path: onPath, channel: 'chrome' }
  }
  throw new ChromeMissingError()
}

/**
 * 加载 Playwright 驱动（`playwright-core`，不含浏览器二进制）。
 *
 * @throws {DriverMissingError} 运行时未随应用打包驱动
 */
export async function loadPlaywrightDriver() {
  try {
    return await import('playwright-core')
  } catch (error) {
    throw new DriverMissingError(error)
  }
}

/**
 * 启动系统 Chrome 的独立 Profile（每账号一个 `--user-data-dir`，绝不触碰个人 Chrome Profile）。
 *
 * @param {{ headless?: boolean, profileDir: string, chromium?: object, platform?: string, env?: object }} options
 */
export async function launchChrome({
  headless = false,
  profileDir,
  chromium = null,
  platform = osPlatform(),
  env = process.env,
} = {}) {
  const driver = chromium || (await loadPlaywrightDriver())
  const chromePath = await resolveSystemChrome({ platform, env })
  // driver 为 playwright-core 模块命名空间：持久化上下文挂在 chromium 上。
  const context = await driver.chromium.launchPersistentContext(profileDir, {
    channel: chromePath.channel,
    executablePath: chromePath.path,
    headless,
    args: [...LAUNCH_ARGS],
    viewport: headless ? { width: 1440, height: 900 } : null,
  })
  return { context, chromePath: chromePath.path }
}

/** 设备端浏览器能力自检：供 UI 在无 Chrome / 无驱动时给出可执行提示。 */
export async function browserStatus({ chromium = null, platform = osPlatform(), env = process.env } = {}) {
  let chrome = null
  try {
    chrome = await resolveSystemChrome({ platform, env })
  } catch (error) {
    if (!(error instanceof ChromeMissingError)) throw error
  }
  let driverAvailable = Boolean(chromium)
  if (!driverAvailable) {
    try {
      await loadPlaywrightDriver()
      driverAvailable = true
    } catch {
      driverAvailable = false
    }
  }
  return {
    chromeAvailable: Boolean(chrome),
    chromePath: chrome ? chrome.path : null,
    driverAvailable,
    platform,
  }
}
