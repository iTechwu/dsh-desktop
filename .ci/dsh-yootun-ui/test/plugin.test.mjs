import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)

test('publishes a discoverable DSH client plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

  assert.equal(manifest.name, '@dofe/dsh-yootun-ui')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.files.sort(), ['cordis.patch.yml', 'index.js', 'lib'].sort())
})

test('ships all DoFe capabilities enabled by default', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')

  for (const id of ['geoflow', 'georank', 'tools', 'openmontage', 'opencli']) {
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
  assert.doesNotMatch(bundle, /Set up later|稍后设置/u)
  assert.match(source, /const \[configured, setConfigured\] = useState\(false\)/u)
  assert.match(source, /\.catch\(\(\) => \{ if \(active\) setConfigured\(false\) \}\)/u)
  assert.doesNotMatch(source, /configured === undefined/u)
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
