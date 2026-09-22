import { describe, expect, it } from 'vitest'
import { dofePluginsForBrand, normalizeDofePluginIds } from '../src/dofe-plugins.ts'

describe('DoFe brand capability policy', () => {
  it('keeps GEO capabilities exclusive to their owning brand', () => {
    expect(dofePluginsForBrand('yootun').map(plugin => plugin.id)).toContain('geoflow')
    expect(dofePluginsForBrand('yootun').map(plugin => plugin.id)).toContain('georank')
    expect(dofePluginsForBrand('sensteed').map(plugin => plugin.id)).not.toContain('geoflow')
    expect(dofePluginsForBrand('sensteed').map(plugin => plugin.id)).not.toContain('georank')
  })

  it('keeps the sensteed datasource bundles exclusive to sensteed and marks them built-in', () => {
    const sensteed = dofePluginsForBrand('sensteed')
    const finance = sensteed.find(plugin => plugin.id === 'finance')
    const supplier = sensteed.find(plugin => plugin.id === 'supplier-intelligence')
    expect(finance?.builtIn).toBe(true)
    expect(supplier?.builtIn).toBe(true)
    expect(dofePluginsForBrand('yootun').map(plugin => plugin.id))
      .toEqual(expect.not.arrayContaining(['finance', 'supplier-intelligence']))
  })

  it('removes stale cross-brand selections before activation', () => {
    expect(normalizeDofePluginIds(['geoflow', 'georank', 'openmontage', 'openmontage'], 'sensteed'))
      .toEqual(['openmontage'])
  })
})
