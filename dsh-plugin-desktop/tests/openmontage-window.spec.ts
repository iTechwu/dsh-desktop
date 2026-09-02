import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: { defaultSession: {} },
}))

import {
  isOpenMontageNavigationAllowed,
  parseOpenMontageSessionCookie,
} from '../src/openmontage-window.ts'

describe('OpenMontage managed session', () => {
  it('extracts only the fixed HttpOnly session cookie', () => {
    expect(parseOpenMontageSessionCookie(
      'openmontage_backlot_session=opaque-value; Path=/montage; Secure; HttpOnly; SameSite=None',
    )).toBe('opaque-value')
    expect(parseOpenMontageSessionCookie('another_cookie=value; Path=/')).toBeUndefined()
    expect(parseOpenMontageSessionCookie(null)).toBeUndefined()
  })

  it('keeps main-frame navigation inside the fixed montage path', () => {
    expect(isOpenMontageNavigationAllowed('https://ixicai.cn/montage/')).toBe(true)
    expect(isOpenMontageNavigationAllowed('https://ixicai.cn/montage/projects/example')).toBe(true)
    expect(isOpenMontageNavigationAllowed('https://ixicai.cn/ai/v1/models')).toBe(false)
    expect(isOpenMontageNavigationAllowed('https://example.com/montage/')).toBe(false)
    expect(isOpenMontageNavigationAllowed('not-a-url')).toBe(false)
  })
})
