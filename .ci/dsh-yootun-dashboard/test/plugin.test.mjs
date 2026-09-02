import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)

test('publishes a standalone DSH dashboard client plugin', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-dashboard')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
})

test('renders all requested dashboard domains and explicit source states', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of [
    'YOOTUN_DASHBOARD_PATH', 'sidebar.footer.action', 'shell.overlay',
    "id: 'overview'", "id: 'geo'", "id: 'usage'", "id: 'activity'", 'source?.reason', "tabOverview: 'Overview'",
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(source, /prompt|private answer|providerKey/i)
})

test('loads and registers the sidebar action and global overlay', async () => {
  const bundle = await readFile(new URL('lib/client.js', root), 'utf8')
  let plugin
  const registrations = []
  const document = {
    createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
    head: { appendChild() {} },
  }
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        plugin = factory(specifier => {
          if (specifier === 'react') return {
            createElement() {}, useEffect() {}, useMemo() {}, useState() {}, useSyncExternalStore() {},
          }
          if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {
            IconCloseOutline16() {}, IconDataOutline16() {}, IconRefreshOutline16() {}, Tooltip() {},
          }
          throw new Error(`unexpected module ${specifier}`)
        })
      },
    },
  }
  vm.runInNewContext(bundle, { AbortController, document, fetch() {}, window })
  assert.deepEqual([...plugin.inject], ['slots', 'locale'])
  plugin.apply({
    effect(factory) { factory() },
    locale: { bind: () => key => key, register: () => () => {} },
    slots: {
      inject(_name, factory) { factory() },
      register(options) {
        assert.equal(options.id, 'dofe-yootun-dashboard')
        registrations.push(options.name)
        return () => {}
      },
    },
  })
  assert.deepEqual(registrations, ['sidebar.footer.action', 'shell.overlay'])
})
