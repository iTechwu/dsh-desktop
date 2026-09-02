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

test('uses only icons exported by the DSH primitives package', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8')
  const imports = source.match(/const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)?.[1] || ''
  const exported = await readFile(new URL('../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx', root), 'utf8')
  for (const name of imports.split(',').map(token => token.trim()).filter(token => token.startsWith('Icon'))) {
    assert.match(exported, new RegExp(`export const ${name}\\b`, 'u'), `${name} is not exported by DSH primitives`)
  }
})
