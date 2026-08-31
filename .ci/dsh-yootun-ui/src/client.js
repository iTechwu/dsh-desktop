const React = require('react')
const { createElement: h, useEffect, useMemo, useState, useSyncExternalStore } = React
const { createRoot } = require('react-dom/client')

const NS = 'dofe.yootun-ui'
const ACCESS_NS = 'dofe-access'
const ACCESS_KEY = 'MODELS_API_KEY'
const VALIDATION_VERSION = 3
const MODELS_PATH = '/api/desktop/dofe/models'
const VALIDATE_PATH = '/api/desktop/dofe/validate'
const LOGO = 'data:image/png;base64,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'

const PLUGINS = [
  { id: 'geoflow', name: 'GeoFlow', description: 'GEO 工作流与草稿自动化' },
  { id: 'georank', name: 'GEORank', description: 'GEO 诊断、拓词与内容生成' },
  { id: 'tools', name: 'DoFe Tools', description: '优惠豚调研与热点工具集' },
  { id: 'openmontage', name: 'OpenMontage', description: '视频生成与素材编排' },
  { id: 'opencli', name: 'OpenCLI Research', description: '受控的互联网只读调研' },
]
const DEFAULT_PLUGIN_IDS = PLUGINS.map(plugin => plugin.id)

const copy = {
  zh: {
    nav: 'DoFe 访问', eyebrow: 'YOOTUN AGENT', title: '激活 Yootun-Agent',
    intro: '输入 model_api_key，选择默认模型并启用随应用预装的 DoFe 能力。',
    key: 'Model API Key', keyPlaceholder: '输入 model_api_key', load: '获取可用模型', loading: '正在获取…',
    model: '默认模型', modelPlaceholder: '输入 Key 后获取模型列表', plugins: '预装 DoFe 能力',
    selected: '已选择 {count} 项', submit: '验证并进入', saving: '正在验证…', remove: '移除 Key',
    configured: '已配置', missing: '未配置', help: '获取 model_api_key，请联系优惠豚 AI 部小伙伴：19996936963',
    modelError: '无法获取模型列表，请检查 Key 与模型服务。', invalid: 'Key 验证失败，请检查后重试。',
    saveError: '保存失败，请检查配置后重试。', removeError: '移除失败，请稍后重试。',
  },
  en: {
    nav: 'DoFe Access', eyebrow: 'YOOTUN AGENT', title: 'Activate Yootun-Agent',
    intro: 'Enter model_api_key, choose a default model, and enable the DoFe capabilities bundled with the app.',
    key: 'Model API Key', keyPlaceholder: 'Enter model_api_key', load: 'Load available models', loading: 'Loading…',
    model: 'Default model', modelPlaceholder: 'Enter the key to load models', plugins: 'Bundled DoFe capabilities',
    selected: '{count} selected', submit: 'Verify and enter', saving: 'Verifying…', remove: 'Remove key',
    configured: 'Configured', missing: 'Not configured', help: 'For model_api_key, contact the Yootun AI team at 19996936963.',
    modelError: 'Could not load models. Check the key and model service.', invalid: 'The key could not be verified.',
    saveError: 'Could not save the configuration.', removeError: 'Could not remove the key.',
  },
}

const css = `
.yu-brand-mark{display:block;width:32px;height:32px;object-fit:contain}.yu-brand-name{font-weight:700;white-space:nowrap}.yu-hero{display:block;object-fit:contain}.yu-modal{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,transparent);backdrop-filter:blur(10px)}.yu-card{width:min(680px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 24px 72px color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent)}.yu-header{display:grid;grid-template-columns:48px 1fr;gap:14px;padding:24px 26px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}.yu-header img{width:48px;height:48px}.yu-eyebrow{margin:0 0 4px;color:var(--dsw-alias-brand-primary);font-size:11px;font-weight:700}.yu-header h2{margin:0;font-size:24px;line-height:1.25}.yu-header p{margin:7px 0 0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1.5}.yu-form{display:grid;gap:18px;padding:22px 26px 26px}.yu-field{display:grid;gap:8px}.yu-label-row{display:flex;justify-content:space-between;gap:12px;font-size:13px;font-weight:650}.yu-form input,.yu-form select{box-sizing:border-box;width:100%;min-height:40px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}.yu-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.yu-button{min-height:38px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}.yu-button[data-primary=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand)}.yu-button:disabled{opacity:.5;cursor:default}.yu-plugins{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid var(--dsw-alias-border-l1)}.yu-plugin{display:grid;grid-template-columns:20px 1fr;gap:9px;padding:11px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}.yu-plugin input{width:18px;min-height:18px;margin:1px 0}.yu-plugin strong,.yu-plugin span{display:block}.yu-plugin span{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:12px}.yu-help,.yu-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.45}.yu-error{margin:0;padding:9px 11px;border-left:3px solid var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-size:13px}.yu-settings{max-width:680px}.yu-settings .yu-form{padding:0}@media(max-width:640px){.yu-modal{padding:12px}.yu-card{width:calc(100vw - 24px);max-height:calc(100vh - 24px)}.yu-header,.yu-form{padding-left:18px;padding-right:18px}.yu-plugins{grid-template-columns:1fr}}
`

function YootunBrandMark() {
  return h('img', { alt: '', className: 'yu-brand-mark', draggable: false, src: LOGO })
}

function YootunBrandName() {
  return h('span', { className: 'yu-brand-name' }, 'Yootun-Agent')
}

function YootunHeroMark({ size, className }) {
  return h('img', { alt: '', className: `${className || ''} yu-hero`, draggable: false, height: size, src: LOGO, width: size })
}

async function jsonPost(path, body) {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: response.ok, value: await response.json() }
}

function AccessForm({ credentials, settingsApi, useAccess, initialConfigured, onboarding, onConfigured, t }) {
  const access = useAccess(snapshot => snapshot)
  const [configured, setConfigured] = useState(initialConfigured)
  const [key, setKey] = useState('')
  const [models, setModels] = useState([])
  const [modelId, setModelId] = useState(access.value?.modelId || '')
  const [enabled, setEnabled] = useState(access.value?.enabledPlugins || DEFAULT_PLUGIN_IDS)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (access.value?.modelId) setModelId(access.value.modelId)
    if (Array.isArray(access.value?.enabledPlugins)) setEnabled(access.value.enabledPlugins)
  }, [access.value?.modelId, access.value?.enabledPlugins])

  const loadModels = async () => {
    const entered = key.trim()
    if (!entered) return
    setLoading(true)
    setError('')
    try {
      const result = await jsonPost(MODELS_PATH, { key: entered })
      const found = result.ok && Array.isArray(result.value?.models) ? result.value.models : []
      if (found.length === 0) throw new Error('empty catalog')
      setModels(found)
      setModelId(current => found.some(model => model.id === current) ? current : found[0].id)
    } catch {
      setModels([])
      setModelId('')
      setError(t('modelError'))
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    const entered = key.trim()
    if (!entered || !modelId || models.length === 0 || enabled.length === 0) return
    setBusy(true)
    setError('')
    try {
      const validation = await jsonPost(VALIDATE_PATH, { key: entered })
      if (!validation.ok || validation.value?.valid !== true) {
        setError(t('invalid'))
        return
      }
      const described = await settingsApi.describe()
      if (!described.ok) throw new Error('settings unavailable')
      const namespaces = described.value.namespaces
      const modelConfig = models.map(model => ({
        id: model.id, name: model.name, ...(model.description ? { description: model.description } : {}),
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities : ['text'],
      }))
      const llm = namespaces.find(item => item.ns === 'llm-deepseek')
      if (llm) {
        const result = await settingsApi.mutate('llm-deepseek', [{ op: 'set', path: ['models'], value: modelConfig }], llm.revision)
        if (!result.ok) throw new Error('model settings rejected')
      }
      const stored = await credentials.set(ACCESS_KEY, entered)
      if (!stored.ok) throw new Error('credential rejected')
      await access.mutate([
        { op: 'set', path: ['setupComplete'], value: true },
        { op: 'set', path: ['validationVersion'], value: VALIDATION_VERSION },
        { op: 'set', path: ['enabledPlugins'], value: enabled },
        { op: 'set', path: ['modelId'], value: modelId },
      ])
      const defaultModel = namespaces.find(item => item.ns === 'agent-default-model')
      if (defaultModel) {
        const result = await settingsApi.mutate('agent-default-model', [
          { op: 'set', path: ['provider'], value: 'deepseek-official' },
          { op: 'set', path: ['model'], value: modelId },
        ], defaultModel.revision)
        if (!result.ok) throw new Error('default model rejected')
      }
      setConfigured(true)
      setKey('')
      onConfigured?.()
    } catch {
      setError(t('saveError'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await credentials.unset(ACCESS_KEY)
      if (!result.ok) throw new Error('credential removal rejected')
      await access.mutate([
        { op: 'set', path: ['setupComplete'], value: false },
        { op: 'set', path: ['validationVersion'], value: 0 },
        { op: 'set', path: ['modelId'], value: '' },
      ])
      setConfigured(false)
      setModels([])
      setModelId('')
    } catch {
      setError(t('removeError'))
    } finally {
      setBusy(false)
    }
  }

  return h('div', { className: 'yu-form' },
    h('div', { className: 'yu-field' },
      h('div', { className: 'yu-label-row' }, h('label', { htmlFor: 'yu-model-key' }, t('key')), h('span', null, configured ? t('configured') : t('missing'))),
      h('input', { id: 'yu-model-key', type: 'password', autoComplete: 'off', value: key, placeholder: t('keyPlaceholder'), onChange: event => { setKey(event.currentTarget.value); setModels([]); setModelId('') }, onKeyDown: event => { if (event.key === 'Enter') void loadModels() } }),
      h('div', { className: 'yu-actions' }, h('button', { type: 'button', className: 'yu-button', disabled: loading || !key.trim(), onClick: () => { void loadModels() } }, loading ? t('loading') : t('load')))),
    h('div', { className: 'yu-field' },
      h('label', { htmlFor: 'yu-model-select' }, t('model')),
      h('select', { id: 'yu-model-select', disabled: models.length === 0, value: modelId, onChange: event => { setModelId(event.currentTarget.value) } },
        h('option', { value: '' }, t('modelPlaceholder')),
        ...models.map(model => h('option', { key: model.id, value: model.id }, `${model.name} (${model.id})`)))),
    h('div', { className: 'yu-field' },
      h('div', { className: 'yu-label-row' }, h('span', null, t('plugins')), h('span', null, t('selected').replace('{count}', String(enabled.length)))),
      h('div', { className: 'yu-plugins' }, ...PLUGINS.map(plugin => h('label', { className: 'yu-plugin', key: plugin.id },
        h('input', { type: 'checkbox', checked: enabled.includes(plugin.id), onChange: event => { setEnabled(current => event.currentTarget.checked ? [...new Set([...current, plugin.id])] : current.filter(id => id !== plugin.id)) } }),
        h('span', null, h('strong', null, plugin.name), h('span', null, plugin.description))))),
    onboarding ? h('p', { className: 'yu-help' }, t('help')) : null,
    error ? h('p', { className: 'yu-error', role: 'alert' }, error) : null,
    h('div', { className: 'yu-actions' },
      h('button', { type: 'button', className: 'yu-button', 'data-primary': true, disabled: busy || loading || !key.trim() || !modelId || enabled.length === 0, onClick: () => { void save() } }, busy ? t('saving') : t('submit')),
      !onboarding ? h('button', { type: 'button', className: 'yu-button', disabled: busy || !configured, onClick: () => { void remove() } }, t('remove')) : null)))
}

function AccessOnboarding({ complete, credentials, settingsApi, useAccess, t }) {
  const access = useAccess(snapshot => snapshot)
  // Fail closed while the credential service is starting or unavailable.
  const [configured, setConfigured] = useState(false)
  useEffect(() => {
    let active = true
    void credentials.describe([ACCESS_KEY]).then(result => {
      if (active) setConfigured(result.ok && result.value[ACCESS_KEY]?.configured === true)
    }).catch(() => { if (active) setConfigured(false) })
    return () => { active = false }
  }, [credentials])
  const authorized = configured === true && access.value?.setupComplete === true && access.value?.validationVersion === VALIDATION_VERSION
  useEffect(() => { if (authorized) complete() }, [authorized, complete])
  if (authorized) return null
  return h('div', { className: 'yu-modal' }, h('section', { className: 'yu-card', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'yu-title' },
    h('header', { className: 'yu-header' }, h('img', { alt: '', src: LOGO }), h('div', null, h('p', { className: 'yu-eyebrow' }, t('eyebrow')), h('h2', { id: 'yu-title' }, t('title')), h('p', null, t('intro')))),
    h(AccessForm, { credentials, settingsApi, useAccess, initialConfigured: configured, onboarding: true, onConfigured: () => { setConfigured(true) }, t })))
}

function AccessSettings({ credentials, settingsApi, useAccess, t }) {
  const [configured, setConfigured] = useState(false)
  useEffect(() => { void credentials.describe([ACCESS_KEY]).then(result => { setConfigured(result.ok && result.value[ACCESS_KEY]?.configured === true) }) }, [credentials])
  return h('section', { className: 'yu-settings' }, h('h2', null, t('nav')), h('p', { className: 'yu-status' }, t('intro')), h(AccessForm, { credentials, settingsApi, useAccess, initialConfigured: configured, onboarding: false, t }))
}

function installMandatoryGate(props) {
  document.getElementById('yu-mandatory-gate')?.remove()
  const host = document.createElement('div')
  host.id = 'yu-mandatory-gate'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(h(AccessOnboarding, { ...props, complete() {} }))
  return () => {
    root.unmount()
    host.remove()
  }
}

const inject = ['slots', 'locale', 'remote', 'settingsScope', 'remote.credentials', 'remote.settings']

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'dofe-yootun-ui: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@dofe/dsh-yootun-ui'
    style.textContent = css
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dofe-yootun-ui: styles')
  const t = ctx.locale.bind(NS)
  const access = ctx.settingsScope.bind({ namespace: ACCESS_NS })
  const useAccess = selector => selector(useSyncExternalStore(
    access.subscribe.bind(access), access.getSnapshot.bind(access), access.getSnapshot.bind(access),
  ))
  const injected = () => ({
    credentials: ctx.remote.credentials,
    settingsApi: ctx.remote.settings,
    hooks: { access },
    t,
  })
  ctx.effect(() => installMandatoryGate({
    credentials: ctx.remote.credentials,
    settingsApi: ctx.remote.settings,
    useAccess,
    t,
  }), 'dofe-yootun-ui: mandatory model_api_key gate')
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, YootunBrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name' }, YootunBrandName))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, YootunHeroMark))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dofe-access', order: 20, label: () => t('nav'), locale: NS, inject: injected,
  }, AccessSettings))
}

exports.apply = apply
exports.inject = inject
