import { describe, expect, it, vi } from 'vitest'
import { ContentPlatformWebWindow, contentPlatformSession, isContentPlatformNavigationAllowed } from '../src/yootun-content-platform-window.ts'

describe('content platform Web UI allowlist', () => {
  it.each([
    ['toutiao', 'https://mp.toutiao.com/'],
    ['baidu', 'https://baijiahao.baidu.com/'],
    ['xiaohongshu', 'https://creator.xiaohongshu.com/'],
    ['sohu', 'https://mp.sohu.com/'],
  ] as const)('allows only the official %s origin family', (platform, url) => {
    expect(isContentPlatformNavigationAllowed(platform, url)).toBe(true)
    expect(isContentPlatformNavigationAllowed(platform, 'http://example.com/')).toBe(false)
    expect(isContentPlatformNavigationAllowed(platform, `${url.slice(0, -1)}.evil.example/`)).toBe(false)
  })
  it('never opens the website system channel in a login window', () => { expect(isContentPlatformNavigationAllowed('website', 'https://yootun.ixicai.cn/media')).toBe(false) })

  it('opens and closes a stable AgentRuntime browser session', async () => {
    const runner = vi.fn(async () => {})
    const window = new ContentPlatformWebWindow('xiaohongshu', runner)
    await window.open('https://creator.xiaohongshu.com/')
    window.close()
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    expect(contentPlatformSession('xiaohongshu')).toBe('yootun-content-xiaohongshu')
    expect(runner.mock.calls).toEqual([
      [['browser', 'yootun-content-xiaohongshu', 'open', 'https://creator.xiaohongshu.com/', '--window', 'foreground']],
      [['browser', 'yootun-content-xiaohongshu', 'close']],
    ])
  })
})
