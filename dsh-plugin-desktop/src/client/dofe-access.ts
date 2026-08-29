export type DofeAccessKey = 'MODELS_API_KEY'
export const DOFE_ACCESS_KEY: DofeAccessKey = 'MODELS_API_KEY'

export const DOFE_ACCESS_COPY = {
  zh: {
    nav: 'DoFe 访问', title: 'DoFe 访问', intro: '一次输入 Model API Key，统一连接 CI Model Router 和内置 DoFe 插件。', key: 'Model API Key', placeholder: '输入 model_api_key', save: '保存并进入', remove: '移除', configured: '已配置', missing: '未配置', saving: '保存中…', removing: '移除中…', loadError: '暂时无法读取凭据状态。', invalidKey: 'Key 无法通过模型网关验证，请检查后重试。', saveError: '保存失败，请检查 Key 后重试。', removeError: '移除失败，请稍后重试。', onboardingTitle: '连接 DoFe', onboardingIntro: '请输入 model_api_key，并选择要启用的内置插件。完成后才能进入 Yootun-Agent。', onboardingHelp: '如需获取 model_api_key，请联系优惠豚 AI 部小伙伴：19996936963。', pluginsTitle: '选择要启用的 DoFe 插件（至少选择一个）', later: '稍后设置',
  },
  en: {
    nav: 'DoFe Access', title: 'DoFe Access', intro: 'Enter one Model API key to connect the CI Model Router and built-in DoFe plugins.', key: 'Model API key', placeholder: 'Enter model_api_key', save: 'Save and enter', remove: 'Remove', configured: 'Configured', missing: 'Not configured', saving: 'Saving…', removing: 'Removing…', loadError: 'Credential status is temporarily unavailable.', invalidKey: 'The key could not be verified by the model gateway.', saveError: 'Could not save the key and plugin selection. Check it and try again.', removeError: 'Could not remove the key. Try again shortly.', onboardingTitle: 'Connect DoFe', onboardingIntro: 'Enter model_api_key and choose the built-in plugins to enable. You can enter Yootun-Agent after completing this step.', onboardingHelp: 'To get a model_api_key, contact the YouTun AI team at 19996936963.', pluginsTitle: 'Choose DoFe plugins to enable (select at least one)', later: 'Set up later',
  },
} as const

export type DofeAccessLocaleKey = keyof typeof DOFE_ACCESS_COPY.en
