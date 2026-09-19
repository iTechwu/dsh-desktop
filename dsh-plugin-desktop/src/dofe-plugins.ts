/** Built-in DoFe capabilities shipped by each white-label product. */

export const DOFE_ACCESS_SETTINGS_NAMESPACE = 'dofe-access' as const
// Tenant ownership is now part of authorization; previously accepted keys
// must re-enter the gate so they can be checked against the current brand.
export const DOFE_ACCESS_VALIDATION_VERSION = 4 as const
export type DofeBrandVariant = 'yootun' | 'sensteed'

export const DOFE_PLUGIN_CATALOG = [
  {
    id: 'geoflow',
    name: 'GeoFlow',
    description: 'GEO 工作流与草稿自动化',
    variants: ['yootun'],
  },
  {
    id: 'georank',
    name: 'GEORank',
    description: 'GEO 诊断、拓词与内容生成',
    variants: ['yootun'],
  },
  {
    id: 'tools',
    name: 'DoFe Tools',
    description: '商业调研与热点工具集',
    variants: ['yootun', 'sensteed'],
  },
  {
    id: 'openmontage',
    name: 'OpenMontage',
    description: '视频生成与素材编排',
    variants: ['yootun', 'sensteed'],
  },
  {
    id: 'media',
    name: 'Media 生成',
    description: '单张图片与 5–10 秒单镜头视频直连生成（复杂视频走 OpenMontage）',
    variants: ['yootun', 'sensteed'],
  },
  {
    id: 'opencli',
    name: 'OpenCLI Research',
    description: '受控的互联网只读调研',
    variants: ['yootun', 'sensteed'],
  },
  {
    id: 'knowledge',
    name: '企业知识与 Memory',
    description: '知识库、Memory 与知识图谱治理',
    variants: ['yootun', 'sensteed'],
  },
] as const

export type DofePluginId = typeof DOFE_PLUGIN_CATALOG[number]['id']

export function dofePluginsForBrand(variant: DofeBrandVariant): typeof DOFE_PLUGIN_CATALOG[number][] {
  return DOFE_PLUGIN_CATALOG.filter(plugin => (plugin.variants as readonly DofeBrandVariant[]).includes(variant))
}

/** Remove stale or cross-brand capability ids before they reach settings or MCP. */
export function normalizeDofePluginIds(ids: readonly string[] | undefined, variant: DofeBrandVariant): DofePluginId[] {
  const available = new Set<string>(dofePluginsForBrand(variant).map(plugin => plugin.id))
  return [...new Set((ids ?? []).filter((id): id is DofePluginId => available.has(id)))]
}

export interface DofeAccessSettings {
  /** The user has completed the mandatory DoFe access gate. */
  setupComplete: boolean
  /** Version of the Host-validated model_api_key gate. */
  validationVersion: number
  /** Built-in capabilities selected by the user. */
  enabledPlugins: string[]
  /** Model id selected from the validated DoFe catalog. */
  modelId: string
  /** Wire protocol used by the selected DoFe model route. */
  protocol: 'chat-completions' | 'messages' | 'responses'
}

export const DEFAULT_DOFE_PLUGIN_IDS: DofePluginId[] = DOFE_PLUGIN_CATALOG.map(plugin => plugin.id)
