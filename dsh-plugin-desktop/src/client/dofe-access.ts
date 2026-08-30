export type DofeAccessKey = 'MODELS_API_KEY'
export const DOFE_ACCESS_KEY: DofeAccessKey = 'MODELS_API_KEY'

export const DOFE_ACCESS_COPY = {
  zh: {
    nav: 'DoFe 访问', title: 'DoFe 访问', intro: '一次输入 Model API Key，统一连接 CI Model Router 和内置 DoFe 插件。', key: 'Model API Key', placeholder: '输入 model_api_key', save: '验证并进入', remove: '移除', configured: '已配置', missing: '未配置', saving: '正在验证…', removing: '移除中…', loadError: '暂时无法读取凭据状态。', invalidKey: 'Key 无法通过模型网关验证，请检查后重试。', saveError: '保存失败，请检查 Key 后重试。', removeError: '移除失败，请稍后重试。', onboardingEyebrow: 'YOOTUN AGENT', onboardingTitle: '激活 Yootun-Agent', onboardingIntro: '验证访问凭据并选择需要的 DoFe 能力，完成后即可进入工作区。', onboardingHelp: '获取 model_api_key，请联系优惠豚 AI 部小伙伴：19996936963', credentialHint: '验证通过后保存到系统凭据存储', pluginsTitle: '启用内置能力', selectedCount: '已选择 {count} 项', showKey: '显示 Key', hideKey: '隐藏 Key', later: '稍后设置',
  },
  en: {
    nav: 'DoFe Access', title: 'DoFe Access', intro: 'Enter one Model API key to connect the CI Model Router and built-in DoFe plugins.', key: 'Model API key', placeholder: 'Enter model_api_key', save: 'Verify and enter', remove: 'Remove', configured: 'Configured', missing: 'Not configured', saving: 'Verifying…', removing: 'Removing…', loadError: 'Credential status is temporarily unavailable.', invalidKey: 'The key could not be verified by the model gateway.', saveError: 'Could not save the key and plugin selection. Check it and try again.', removeError: 'Could not remove the key. Try again shortly.', onboardingEyebrow: 'YOOTUN AGENT', onboardingTitle: 'Activate Yootun-Agent', onboardingIntro: 'Verify your access credential and choose the DoFe capabilities you need to enter the workspace.', onboardingHelp: 'For a model_api_key, contact the YouTun AI team at 19996936963.', credentialHint: 'Saved to the system credential store after verification', pluginsTitle: 'Enable built-in capabilities', selectedCount: '{count} selected', showKey: 'Show key', hideKey: 'Hide key', later: 'Set up later',
  },
} as const

export type DofeAccessLocaleKey = keyof typeof DOFE_ACCESS_COPY.en
