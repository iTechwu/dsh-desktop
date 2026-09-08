import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)

test('publishes the browser sales plugin with its bundle patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-sales')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('keeps follow-ups human-confirmed and points only at the Desktop route', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['/api/desktop/yootun/sales', 'intent_search', 'intentPlaceholder', 'awaiting_confirmation', 'item.status', 'confirm_action', 'dismiss_action', '已确认，等待适配器', '适配器已完成', '适配器执行失败', '需要重新登录', 'loadError', 'actionError', "role: 'alert'"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /Unable to load sales workspace/u)
  assert.match(source, /status === 'confirmed_pending_adapter' \|\| status === 'adapter_pending'/u)
  assert.match(source, /current\.dashboard\.pendingConfirmation \?\? current\.dashboard\.pending/u)
  assert.doesNotMatch(source, /contactPhone|password|cookie|聊天正文/iu)
})

test('announces intent and workspace empty states', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /className: 'ys-intent-empty', role: 'status'/u)
  assert.match(source, /className: 'ys-intent-empty', role: 'alert'/u)
  assert.match(source, /className: 'ys-empty', role: 'status'/u)
  assert.match(source, /className: 'ys-intent', 'aria-busy': busy/u)
  assert.match(source, /className: 'ys-content', 'aria-busy': interactionBusy/u)
})

test('labels and locks an active intent search', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /intentSearching: '正在检索…'/u)
  assert.match(source, /intentSearching: 'Searching…'/u)
  assert.match(source, /if \(disabled \|\| busyRef\.current \|\| !query\.trim\(\)\) return/u)
  assert.match(source, /busy \? t\('intentSearching'\) : t\('intentSearch'\)/u)
  assert.doesNotMatch(source, /busy \? '…'/u)
})

test('locks all workspace mutations and disables conflicting controls', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /const loadingRef = useRef\(false\)/u)
  assert.match(source, /if \(loadingRef\.current \|\| busyRef\.current\) return null/u)
  assert.match(source, /const refresh = \(\) => \{[\s\S]+if \(loadingRef\.current \|\| busyRef\.current\) return/u)
  assert.match(source, /const interactionBusy = loading \|\| busy/u)
  assert.match(source, /'aria-busy': interactionBusy/u)
  assert.match(source, /'aria-label': t\('refresh'\), disabled: interactionBusy, onClick: refresh/u)
  assert.match(source, /type: 'button', disabled: busy, onClick: \(\) => void update\(\{ action: 'confirm_action'/u)
  assert.match(source, /\.ys-action-buttons button:disabled\{opacity:\.5;cursor:default\}/u)
  assert.match(source, /\.ys-inline-error button:disabled,.ys-empty button:disabled\{opacity:\.45;cursor:default\}/u)
})

test('builds a syntactically valid browser module', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const temporary = new URL('src/.sales-client-syntax-check.cjs', root)
  await import('node:fs/promises').then(fs => fs.writeFile(temporary, source))
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(process.execPath, ['--check', temporary.pathname], { encoding: 'utf8' })
  await import('node:fs/promises').then(fs => fs.unlink(temporary))
  assert.equal(result.status, 0, result.stderr)
})

test('uses only icons exported by the DSH primitives package', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'), `${name} is not exported by DSH primitives`)
  }
})

test('applies the browser plugin without runtime reference errors', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const module = { exports: {} }
  const styles = []
  const sandbox = {
    CustomEvent: class {},
    document: {
      createElement() { return { dataset: {}, remove() {} } },
      head: { appendChild(style) { styles.push(style) } },
    },
    module,
    require(id) {
      if (id === 'react') return { createElement() {}, useEffect() {}, useState() {}, useSyncExternalStore() {} }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
      throw new Error(`unexpected require: ${id}`)
    },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  }
  vm.runInNewContext(source, sandbox)
  const ctx = {
    effect(factory) { return factory() },
    locale: { register() {}, bind() { return key => key } },
    slots: { inject() {} },
  }

  assert.doesNotThrow(() => module.exports.apply(ctx))
  assert.equal(styles.length, 1)
  assert.match(styles[0].textContent, /\.ys-overlay/u)
  assert.match(styles[0].textContent, /\.ys-inline-error/u)
})
