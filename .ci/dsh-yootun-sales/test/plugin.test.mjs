import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('publishes the browser sales plugin with its bundle patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-sales')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('keeps follow-ups human-confirmed and points only at the Desktop route', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['/api/desktop/yootun/sales', 'intent_search', 'intentPlaceholder', 'awaiting_confirmation', 'item.status', 'confirm_action', 'dismiss_action', '已确认，等待适配器', '适配器已完成', '适配器执行失败', '需要重新登录']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.match(source, /aria-label': t\('intentPlaceholder'\)/u)
  assert.doesNotMatch(source, /contactPhone|password|cookie|聊天正文/iu)
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

test('announces intent search failures to assistive technology', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /intent\.status === 'error'.*role: 'alert'/u)
})

test('locks intent criteria without mislabeling unrelated sales actions', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of [
    'function IntentSearch({ t, current, update, busy, active })',
    "return h('section', { className: 'ys-intent', 'aria-busy': active }",
    "h('input', { value: query, disabled: busy",
    "active ? '…' : t('intentSearch')",
    'active: pendingActionId === \'intent_search\'',
  ]) assert.ok(source.includes(token), `missing intent interaction state: ${token}`)
})

test('blocks duplicate sales mutations and exposes localized action errors', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['useRef', 'if (actionBusyRef.current) return', 'actionBusyRef.current = true', 'setPendingActionId(body.id || body.action)', 'disabled: busy', 'disabled: loading || busy', "'aria-busy': active", "role: 'alert'", "t('actionError')", "t('loadError')"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /Unable to load sales workspace/u)
})

test('announces sales workspace reads as busy', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /'aria-busy': loading \|\| busy/u)
})

test('shows a retryable alert when refreshing existing sales data fails', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /const errorLabel = error === 'load' \? t\('loadError'\) : t\('actionError'\)/u)
  assert.match(source, /error \? h\('div', \{ role: 'alert', className: 'ys-error-banner' \}, errorLabel/u)
  assert.match(source, /error === 'load' \? h\('button', \{ type: 'button', onClick: \(\) => setRevision/u)
})

test('moves focus into sales workspace and restores its opener', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['document.activeElement', 'shellRef.current?.focus()', 'target.focus()', 'ref: shellRef', 'tabIndex: -1', 'closeOverlay()']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.match(source, /event\.key === 'Escape'\) closeOverlay\(\)/u)
  assert.match(source, /onClick: closeOverlay/u)
})
test('keeps keyboard focus inside sales workspace', async () => { const source = await readFile(new URL('src/client.js', root), 'utf8'); for (const token of ["event.key !== 'Tab'", 'querySelectorAll', 'event.shiftKey', 'last.focus()', 'first.focus()', 'onKeyDown: keepFocus']) assert.ok(source.includes(token), `missing focus trap token: ${token}`) })

test('uses only icons exported by the DSH primitives package', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'), `${name} is not exported by DSH primitives`)
  }
})
