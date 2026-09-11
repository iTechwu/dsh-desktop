import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('renders missing supply metrics as an unknown dash', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /String\(value \?\? '—'\)/u)
  assert.match(source, /const dashboard = current\.dashboard \|\| \{\}/u)
})

test('publishes the browser supply watch plugin with its bundle patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-supply-watch')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('keeps risk reviews human-confirmed and local-only', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['/api/desktop/yootun/supply-watch', 'awaiting_confirmation', 'confirm_action', 'dismiss_action', '已确认', '适配器已完成', '适配器执行失败', '需要重新登录', 'loading', 'loadError', 'actionError', 'retry', "className: 'ysw-empty', role: 'status'", "role: 'status'", "role: 'alert'"]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.doesNotMatch(source, /Unable to load supply watch/u)
  assert.match(source, /openRisks/u)
  assert.match(source, /dashboard\.openRisks \?\? dashboard\.open/u)
  assert.match(source, /status === 'confirmed_pending_adapter' \|\| status === 'adapter_pending'/u)
  assert.match(source, /item\.targetLabel \|\| t\('supplier'\)/u)
  assert.doesNotMatch(source, /item\.(title|supplierLabel|category|signal|source)/u)
  assert.match(source, /data\?\.status && data\.status !== 'ready'/u)
  assert.match(source, /'aria-busy': interactionBusy/u)
  assert.doesNotMatch(source, /password|cookie|银行卡|供应商联系人手机号/iu)
})

test('locks review mutations and disables conflicting controls', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  assert.match(source, /const loadingRef = useRef\(false\)/u)
  assert.match(source, /if \(loadingRef\.current \|\| busyRef\.current\) return null/u)
  assert.match(source, /const refresh = \(\) => \{ if \(loadingRef\.current \|\| busyRef\.current\) return/u)
  assert.match(source, /const interactionBusy = loading \|\| busy/u)
  assert.match(source, /type: 'button', disabled: busy, onClick: \(\) => void update\(\{ action: 'confirm_action'/u)
  assert.match(source, /'aria-label': t\('refresh'\), disabled: interactionBusy/u)
  assert.match(source, /className: 'ysw-inline-error'[^\n]+disabled: interactionBusy, onClick: refresh/u)
  assert.match(source, /\.ysw-action-buttons button:disabled\{opacity:\.45;cursor:default\}/u)
  assert.match(source, /\.ysw-empty button:disabled,.ysw-inline-error button:disabled\{opacity:\.45;cursor:default\}/u)
})

test('uses only icons exported by DSH alpha3 primitives', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'))
  }
})
