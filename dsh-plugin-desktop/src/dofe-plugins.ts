/** Built-in DoFe capabilities shipped inside Yootun-Agent. */

export const DOFE_ACCESS_SETTINGS_NAMESPACE = 'dofe-access' as const
export const DOFE_ACCESS_VALIDATION_VERSION = 3 as const

export const DOFE_PLUGIN_CATALOG = [
  {
    id: 'geoflow',
    name: 'GeoFlow',
    description: 'GEO 工作流与草稿自动化',
  },
  {
    id: 'georank',
    name: 'GEORank',
    description: 'GEO 诊断、拓词与内容生成',
  },
  {
    id: 'tools',
    name: 'DoFe Tools',
    description: '优惠豚调研与热点工具集',
  },
  {
    id: 'openmontage',
    name: 'OpenMontage',
    description: '视频生成与素材编排',
  },
  {
    id: 'media',
    name: 'Media 生成',
    description: '单张图片与 5–10 秒单镜头视频直连生成（复杂视频走 OpenMontage）',
  },
  {
    id: 'opencli',
    name: 'OpenCLI Research',
    description: '受控的互联网只读调研',
  },
] as const

export type DofePluginId = typeof DOFE_PLUGIN_CATALOG[number]['id']

export interface DofeAccessSettings {
  /** The user has completed the mandatory DoFe access gate. */
  setupComplete: boolean
  /** Version of the Host-validated model_api_key gate. */
  validationVersion: number
  /** Built-in capabilities selected by the user. */
  enabledPlugins: string[]
  /** Model id selected from the validated DoFe catalog. */
  modelId: string
}

export const DEFAULT_DOFE_PLUGIN_IDS: DofePluginId[] = DOFE_PLUGIN_CATALOG.map(plugin => plugin.id)
