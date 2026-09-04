/** Official publishing pages opened as stable OpenCLI AgentRuntime sessions. */
import { execFile } from 'node:child_process'
import type { ContentPlatformId } from './yootun-content-command-route.ts'

const RULES: Record<Exclude<ContentPlatformId, 'website'>, { host: string; session: string }> = {
  toutiao: { host: 'toutiao.com', session: 'yootun-content-toutiao' },
  baidu: { host: 'baidu.com', session: 'yootun-content-baidu' },
  xiaohongshu: { host: 'xiaohongshu.com', session: 'yootun-content-xiaohongshu' },
  sohu: { host: 'sohu.com', session: 'yootun-content-sohu' },
}

type OpenCliRunner = (args: string[]) => Promise<void>

function runOpenCli(args: string[]): Promise<void> {
  return new Promise((accept, reject) => {
    execFile('opencli', args, { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }, cause => {
      if (cause) reject(cause)
      else accept()
    })
  })
}

export function contentPlatformSession(platform: Exclude<ContentPlatformId, 'website'>): string {
  return RULES[platform].session
}

export function isContentPlatformNavigationAllowed(platform: ContentPlatformId, href: string): boolean {
  if (platform === 'website') return false
  try {
    const target = new URL(href)
    const host = RULES[platform].host
    return target.protocol === 'https:' && (target.hostname === host || target.hostname.endsWith(`.${host}`))
  } catch { return false }
}

export class ContentPlatformWebWindow {
  private disposed = false

  constructor(
    private readonly platform: Exclude<ContentPlatformId, 'website'>,
    private readonly runner: OpenCliRunner = runOpenCli,
  ) {}

  async open(url: string): Promise<void> {
    if (this.disposed) return
    if (!isContentPlatformNavigationAllowed(this.platform, url)) throw new Error('content_platform_url_not_allowed')
    await this.runner(['browser', contentPlatformSession(this.platform), 'open', url, '--window', 'foreground'])
  }

  close(): void {
    if (this.disposed) return
    this.disposed = true
    void this.runner(['browser', contentPlatformSession(this.platform), 'close']).catch(() => {})
  }
}
