import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: { defaultSession: {}, fromPartition: () => ({ setPermissionRequestHandler: () => {} }) },
}))

import { BOSS_LOGIN_URL, isBossNavigationAllowed } from '../src/yootun-boss-web-window.ts'

describe('in-app BOSS web window', () => {
  it('keeps navigation on official zhipin.com origins only', () => {
    expect(isBossNavigationAllowed('https://www.zhipin.com/web/user/?ka=header-login')).toBe(true)
    expect(isBossNavigationAllowed('https://zhipin.com/')).toBe(true)
    expect(isBossNavigationAllowed('https://edu.zhipin.com/course')).toBe(true)
    expect(isBossNavigationAllowed('http://www.zhipin.com/')).toBe(false)
    expect(isBossNavigationAllowed('https://evil.example/zhipin.com')).toBe(false)
    expect(isBossNavigationAllowed('https://zhipin.com.evil.example/')).toBe(false)
    expect(isBossNavigationAllowed('not-a-url')).toBe(false)
  })

  it('points the login handoff at the official login page', () => {
    expect(BOSS_LOGIN_URL).toMatch(/^https:\/\/www\.zhipin\.com\//u)
  })
})
