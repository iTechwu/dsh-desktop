import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { hasLicenseFile } from './license-file.mjs'

test('recognizes conventional license files without relying on filesystem case rules', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-license-file-'))
  try {
    writeFileSync(join(directory, 'license'), 'MIT')
    assert.equal(hasLicenseFile(directory), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('does not accept similarly named metadata files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-license-file-'))
  try {
    writeFileSync(join(directory, 'license.json'), '{}')
    assert.equal(hasLicenseFile(directory), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
