import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pluginRoot = new URL('../../', import.meta.url)
const overlayPlugins = [
  'dsh-yootun-dashboard',
  'dsh-yootun-recruiter',
  'dsh-yootun-sales',
  'dsh-yootun-supply-watch',
  'dsh-yootun-lead-discovery',
  'dsh-yootun-content-command',
  'dsh-yootun-knowledge',
  'dsh-yootun-retrofit',
  'dsh-yootun-audit',
  'dsh-yootun-daily-report',
  'dsh-yootun-finops',
]

test('every Yootun business overlay participates in the exclusive accessible dialog contract', async () => {
  for (const plugin of overlayPlugins) {
    const source = await readFile(new URL(`${plugin}/src/client.js`, pluginRoot), 'utf8')
    assert.match(source, /const OVERLAY_ID = ['"]@dofe\/dsh-yootun-[^'"]+['"]/u, plugin)
    assert.match(source, /const OVERLAY_EVENT = ['"]dofe:yootun-overlay:open['"]/u, plugin)
    assert.match(source, /window\.dispatchEvent\(new CustomEvent\(OVERLAY_EVENT/u, plugin)
    assert.match(source, /window\.addEventListener\(OVERLAY_EVENT/u, plugin)
    assert.match(source, /window\.removeEventListener\(OVERLAY_EVENT/u, plugin)
    assert.match(source, /role: ['"]dialog['"]/u, plugin)
    assert.match(source, /['"]aria-modal['"]: true/u, plugin)
    assert.match(source, /event\.key === ['"]Escape['"]/u, plugin)
  }
})
