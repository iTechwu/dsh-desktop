import { describe, expect, it } from 'vitest'
import { dofePluginsForBrand, normalizeDofePluginIds } from '../src/dofe-plugins.ts'

describe('DoFe brand capability policy', () => {
  it('keeps GEO capabilities exclusive to Yootun', () => {
    expect(dofePluginsForBrand('yootun').map(plugin => plugin.id)).toContain('geoflow')
    expect(dofePluginsForBrand('yootun').map(plugin => plugin.id)).toContain('georank')
    expect(dofePluginsForBrand('sensteed').map(plugin => plugin.id)).not.toContain('geoflow')
    expect(dofePluginsForBrand('sensteed').map(plugin => plugin.id)).not.toContain('georank')
  })

  it('removes stale cross-brand selections before activation', () => {
    expect(normalizeDofePluginIds(['geoflow', 'georank', 'openmontage', 'openmontage'], 'sensteed'))
      .toEqual(['openmontage'])
  })
})
