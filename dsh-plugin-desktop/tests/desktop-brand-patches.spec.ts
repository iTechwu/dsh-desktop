import { describe, expect, it } from 'vitest'
import { filterDesktopBrandPatches } from '../src/profile.ts'
import { BRAND_TENANT, BRAND_VARIANT } from '../src/generated-product-identity.ts'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/** One insert patch carrying both brands' private rows plus shared rows. */
function patchFixture(): PatchOptions[] {
  return [{
    insert: [
      { id: 'desktop-shell', name: 'dsh-plugin-desktop' },
      { id: 'dofe-yootun-ui', name: '@dofe/dsh-yootun-ui' },
      { id: 'dofe-yootun-knowledge', name: '@dofe/dsh-yootun-knowledge' },
      { id: 'dofe-yootun-sales', name: '@dofe/dsh-yootun-sales' },
      { id: 'dofe-sensteed-finance', name: '@dofe/dsh-sensteed-finance' },
      { id: 'dofe-sensteed-supplier-intelligence', name: '@dofe/dsh-sensteed-supplier-intelligence' },
    ],
  }]
}

function rowIds(patches: PatchOptions[]): Array<string | undefined> {
  return (patches[0]?.insert as Array<{ id?: string }> ?? []).map(row => row.id)
}

describe('desktop brand patch filtering', () => {
  it('keeps the active brand\'s private datasource rows and drops the other brand\'s', () => {
    const filtered = filterDesktopBrandPatches(patchFixture())
    const ids = rowIds(filtered)
    // The desktop client owns activation and branding in both distributions.
    expect(ids).not.toContain('dofe-yootun-ui')
    expect(ids).toContain('desktop-shell')
    // The shared knowledge row stays in both distributions.
    expect(ids).toContain('dofe-yootun-knowledge')
    // yootun-private rows are dropped everywhere outside the yootun build.
    if (BRAND_VARIANT === 'sensteed') {
      expect(ids).toContain('dofe-sensteed-finance')
      expect(ids).toContain('dofe-sensteed-supplier-intelligence')
      expect(ids).not.toContain('dofe-yootun-sales')
    } else {
      expect(ids).not.toContain('dofe-yootun-sales')
      expect(ids).not.toContain('dofe-sensteed-finance')
      expect(ids).not.toContain('dofe-sensteed-supplier-intelligence')
    }
  })

  it('stamps the shared knowledge row with the build-time tenant', () => {
    const knowledge = (filterDesktopBrandPatches(patchFixture())[0]?.insert ?? []).find(
      entry => (entry as { id?: string }).id === 'dofe-yootun-knowledge',
    ) as { config?: { brand?: { tenant?: string } } } | undefined
    expect(knowledge?.config?.brand?.tenant).toBe(BRAND_TENANT)
  })

  it('leaves patches without insert lists untouched', () => {
    const patches = [{ id: 'llm-deepseek', config: { apiKeyEnv: 'MODELS_API_KEY' } }] as unknown as PatchOptions[]
    expect(filterDesktopBrandPatches(patches)).toEqual(patches)
  })
})
