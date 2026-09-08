import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)

async function loadClientTestApi() {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const exports = {}
  vm.runInNewContext(source, {
    exports,
    fetch() {},
    require(specifier) {
      if (specifier === 'react-dom/client') return { createRoot() {} }
      return { createElement() {}, useEffect() {}, useMemo() {}, useRef() {}, useState() {}, useSyncExternalStore() {} }
    },
  })
  return exports.__test
}

test('publishes a discoverable DSH client plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

  assert.equal(manifest.name, '@dofe/dsh-yootun-ui')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.files.sort(), ['cordis.patch.yml', 'index.js', 'lib'].sort())
})

test('ships all DoFe capabilities enabled by default', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')

  for (const id of ['geoflow', 'georank', 'tools', 'openmontage', 'opencli', 'knowledge']) {
    assert.match(source, new RegExp(`id: ['"]${id}['"]`))
  }
  assert.match(source, /const DEFAULT_PLUGIN_IDS = PLUGINS\.map/u)
})

test('bundles Yootun branding, settings, and a mandatory credential gate', async () => {
  const bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  const source = await readFile(new URL('src/client.js', root), 'utf8')

  assert.match(bundle, /window\.__ModuleLoader__\.load/u)
  assert.match(bundle, /sidebar\.brand\.mark/u)
  assert.match(bundle, /conversation\.hero\.brand\.mark/u)
  assert.match(bundle, /settings\.section/u)
  assert.match(bundle, /yu-mandatory-gate/u)
  assert.match(bundle, /mandatory model_api_key gate/u)
  assert.match(bundle, /MODELS_API_KEY/u)
  assert.match(source, /function YootunBrandName\(\) \{\s*return null\s*\}/u)
  assert.doesNotMatch(bundle, /Set up later|稍后设置/u)
  assert.match(source, /const \[configured, setConfigured\] = useState\(false\)/u)
  assert.match(source, /\.catch\(\(\) => \{ if \(active\) setConfigured\(false\) \}\)/u)
  assert.doesNotMatch(source, /configured === undefined/u)
  assert.match(source, /async function mutateCurrentSettings/u)
  assert.match(source, /await mutateCurrentSettings\(settingsApi, 'llm-deepseek'/u)
  assert.match(source, /await mutateCurrentSettings\(settingsApi, 'agent-default-model'/u)
  assert.match(source, /await mutateCurrentSettings\(settingsApi, ACCESS_NS/u)
})

test('guides credential setup and protects credential removal', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')

  assert.match(source, /type: showKey \? 'text' : 'password'/u)
  assert.match(source, /role: 'status'/u)
  assert.match(source, /const \[confirmingRemove, setConfirmingRemove\] = useState\(false\)/u)
  assert.match(source, /setConfigured\(initialConfigured\)[\s\S]*?\[initialConfigured\]/u)
  assert.match(source, /t\('removeWarning'\)/u)
  assert.match(source, /onClick: \(\) => setConfirmingRemove\(true\)/u)
  assert.match(source, /onClick: \(\) => setConfirmingRemove\(false\)/u)
  assert.match(source, /className: 'yu-form', 'aria-busy': interactionBusy/u)
  assert.match(source, /if \(!entered \|\| loadingRef\.current \|\| busyRef\.current\) return/u)
  assert.match(source, /if \(busyRef\.current \|\| loadingRef\.current/u)
  assert.match(source, /disabled: interactionBusy/u)
})

test('re-reads and retries a settings mutation once after a revision conflict', async () => {
  const { mutateCurrentSettings } = await loadClientTestApi()
  const revisions = [4, 5]
  const used = []
  const settingsApi = {
    async describe() {
      return { ok: true, value: { namespaces: [{ ns: 'dofe-access', revision: revisions.shift() }] } }
    },
    async mutate(_namespace, _operations, revision) {
      used.push(revision)
      return used.length === 1
        ? { ok: false, error: { code: 'settings/conflict' } }
        : { ok: true, value: {} }
    },
  }

  await mutateCurrentSettings(settingsApi, 'dofe-access', [{ op: 'set', path: ['modelId'], value: 'deepseek-chat' }])
  assert.deepEqual(used, [4, 5])

  let rejectedCalls = 0
  await assert.rejects(() => mutateCurrentSettings({
    async describe() {
      return { ok: true, value: { namespaces: [{ ns: 'dofe-access', revision: 6 }] } }
    },
    async mutate() {
      rejectedCalls += 1
      return { ok: false, error: { code: 'settings/rejected' } }
    },
  }, 'dofe-access', []), /dofe-access rejected/u)
  assert.equal(rejectedCalls, 1)
})

test('revokes access before removing the credential and stops on settings failure', async () => {
  const { removeAccess } = await loadClientTestApi()
  const calls = []
  const settingsApi = {
    async describe() {
      calls.push('describe')
      return { ok: true, value: { namespaces: [{ ns: 'dofe-access', revision: 7 }] } }
    },
    async mutate(namespace, operations, revision) {
      calls.push(['mutate', namespace, operations, revision])
      return { ok: true, value: {} }
    },
  }
  const credentials = {
    async unset(ref) {
      calls.push(['unset', ref])
      return { ok: true, value: {} }
    },
  }

  await removeAccess(settingsApi, credentials)
  assert.equal(calls[0], 'describe')
  assert.equal(JSON.stringify(calls[1]), JSON.stringify(['mutate', 'dofe-access', [
    { op: 'set', path: ['setupComplete'], value: false },
    { op: 'set', path: ['validationVersion'], value: 0 },
    { op: 'set', path: ['modelId'], value: '' },
  ], 7]))
  assert.deepEqual(calls[2], ['unset', 'MODELS_API_KEY'])

  let unsetCalls = 0
  await assert.rejects(() => removeAccess({
    async describe() {
      return { ok: true, value: { namespaces: [{ ns: 'dofe-access', revision: 8 }] } }
    },
    async mutate() {
      return { ok: false, error: { code: 'settings/rejected' } }
    },
  }, {
    async unset() {
      unsetCalls += 1
      return { ok: true, value: {} }
    },
  }), /dofe-access rejected/u)
  assert.equal(unsetCalls, 0)
})

test('loads the generated module and registers every owned surface', async () => {
  const bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  let plugin
  const registrations = []
  let renderedGate = false
  const document = {
    createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
    getElementById: () => null,
    body: { appendChild() {} },
    head: { appendChild() {} },
  }
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        plugin = factory(specifier => {
          if (specifier === 'react-dom/client') return { createRoot: () => ({ render() { renderedGate = true }, unmount() {} }) }
          assert.equal(specifier, 'react')
          return {
            createElement() {}, useEffect() {}, useMemo() {}, useState() {}, useSyncExternalStore() {},
          }
        })
      },
    },
  }
  vm.runInNewContext(bundle, { document, fetch() {}, window })
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'remote', 'settingsScope', 'remote.credentials', 'remote.settings'])

  plugin.apply({
    effect(factory) { factory() },
    locale: { bind: () => key => key, register: () => () => {} },
    remote: { credentials: {}, settings: {} },
    settingsScope: { bind: () => ({ subscribe() {}, getSnapshot() {} }) },
    slots: {
      inject(_name, factory) { factory() },
      register(options) { registrations.push(options.name); return () => {} },
    },
  })
  assert.deepEqual(registrations, [
    'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark',
    'settings.section',
  ])
  assert.equal(renderedGate, true)
})
