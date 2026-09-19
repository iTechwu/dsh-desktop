import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { readCiPackageManifests } from './plugin-ux-audit-packages.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-ux-audit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, url: pathToFileURL(`${root}${sep}`) }
}

test('reads package manifests and skips CI resource directories', async t => {
  const { root, url } = await fixture(t)
  await mkdir(join(root, 'brand'))
  await writeFile(join(root, 'brand', 'defaults.json'), '{}')
  await mkdir(join(root, 'dsh-plugin'))
  await writeFile(join(root, 'dsh-plugin', 'package.json'), JSON.stringify({ name: 'dsh-plugin' }))

  assert.deepEqual(await readCiPackageManifests(url, ['brand', 'dsh-plugin']), [
    { name: 'dsh-plugin', manifest: { name: 'dsh-plugin' } },
  ])
})

test('rejects malformed package manifests', async t => {
  const { root, url } = await fixture(t)
  await mkdir(join(root, 'dsh-broken'))
  await writeFile(join(root, 'dsh-broken', 'package.json'), '{')

  await assert.rejects(readCiPackageManifests(url, ['dsh-broken']), SyntaxError)
})
