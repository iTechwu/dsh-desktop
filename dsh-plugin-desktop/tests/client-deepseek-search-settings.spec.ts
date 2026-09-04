// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  DEEPSEEK_SEARCH_API_KEY_REF,
  DeepSeekSearchSettings,
  saveDeepSeekSearchApiKey,
} from '../src/client/DeepSeekSearchSettings.tsx'
import { zh, type DesktopSettingsLocaleKey } from '../src/client/desktop-settings-locales.ts'

const t = (key: DesktopSettingsLocaleKey): string => zh[key]

describe('DeepSeek Search settings', () => {
  it('renders a masked Search API Key control in Yootun-Agent settings', () => {
    const markup = renderToStaticMarkup(createElement(DeepSeekSearchSettings, {
      credentials: {
        describe: vi.fn(),
        set: vi.fn(),
        unset: vi.fn(),
      },
      t,
    } as never))

    expect(markup).toContain('DeepSeek 搜索')
    expect(markup).toContain('name="deepseek-search-api-key"')
    expect(markup).toContain('type="password"')
    expect(markup).toContain('DEEPSEEK_API_KEY')
  })

  it('stores the trimmed key under the credential reference consumed by DeepSeek Search', async () => {
    const set = vi.fn(async () => ({ ok: true, value: undefined }))

    await saveDeepSeekSearchApiKey({ set } as never, '  search-secret  ')

    expect(DEEPSEEK_SEARCH_API_KEY_REF).toBe('DEEPSEEK_API_KEY')
    expect(set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'search-secret')
  })

  it('rejects a blank value before contacting the credentials service', async () => {
    const set = vi.fn()

    await expect(saveDeepSeekSearchApiKey({ set } as never, '   ')).rejects.toThrow('empty')
    expect(set).not.toHaveBeenCalled()
  })
})
