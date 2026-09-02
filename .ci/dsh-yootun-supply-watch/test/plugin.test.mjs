import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('publishes the browser supply watch plugin with its bundle patch', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.name, '@dofe/dsh-yootun-supply-watch')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('keeps risk reviews human-confirmed and local-only', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  for (const token of ['/api/desktop/yootun/supply-watch', 'awaiting_confirmation', 'confirm_action', 'dismiss_action', '已确认', '适配器已完成', '适配器执行失败', '需要重新登录']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
  assert.match(source, /openRisks/u)
  assert.doesNotMatch(source, /password|cookie|银行卡|供应商联系人手机号/iu)
})

test('uses only icons exported by DSH alpha3 primitives', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'))
  }
})
