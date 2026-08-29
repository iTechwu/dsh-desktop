export type DofeAccessKey = 'MODELS_API_KEY'
export const DOFE_ACCESS_KEY: DofeAccessKey = 'MODELS_API_KEY'

export const DOFE_ACCESS_COPY = {
  zh: {
    nav: 'DoFe 访问', title: 'DoFe 访问', intro: '一次输入 Model API Key，统一连接 CI Model Router 和内置 DoFe 插件。', key: 'Model API Key', placeholder: '输入 model_api_key', save: '保存', remove: '移除', configured: '已配置', missing: '未配置', saving: '保存中…', removing: '移除中…', loadError: '暂时无法读取凭据状态。', saveError: '保存失败，请检查 Key 后重试。', removeError: '移除失败，请稍后重试。', onboardingTitle: '连接 DoFe', onboardingIntro: '请输入 model_api_key 后开始使用 Yootun-Agent。此 Key 会启用模型、GEO、Tools 和 OpenMontage。', onboardingHelp: '如需获取 model_api_key，请联系优惠豚 AI 部小伙伴：19996936963。', later: '稍后设置',
  },
  en: {
    nav: 'DoFe Access', title: 'DoFe Access', intro: 'Enter one Model API key to connect the CI Model Router and built-in DoFe plugins.', key: 'Model API key', placeholder: 'Enter model_api_key', save: 'Save', remove: 'Remove', configured: 'Configured', missing: 'Not configured', saving: 'Saving…', removing: 'Removing…', loadError: 'Credential status is temporarily unavailable.', saveError: 'Could not save the key. Check it and try again.', removeError: 'Could not remove the key. Try again shortly.', onboardingTitle: 'Connect DoFe', onboardingIntro: 'Enter model_api_key before using Yootun-Agent. This key enables Models, GEO, Tools, and OpenMontage.', onboardingHelp: 'To get a model_api_key, contact the YouTun AI team at 19996936963.', later: 'Set up later',
  },
} as const

export type DofeAccessLocaleKey = keyof typeof DOFE_ACCESS_COPY.en
