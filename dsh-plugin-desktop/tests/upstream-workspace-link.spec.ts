import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeWindowsWorkspaceLink } from '../../scripts/upstream-workspace-link.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture(): { root: string; link: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-upstream-link-'))
  temporaryDirectories.push(root)
  const target = join(root, 'deepseek-harness')
  mkdirSync(target)
  return { root, link: join(root, 'desktop', 'deepseek-harness'), target }
}

describe('Windows sibling workspace link', () => {
  it('replaces Git symlink text with a directory link', () => {
    const { root, link, target } = fixture()
    mkdirSync(join(root, 'desktop'))
    writeFileSync(link, '../deepseek-harness')

    expect(materializeWindowsWorkspaceLink({ platform: 'win32', link, target })).toBe(true)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(resolve(join(root, 'desktop'), readlinkSync(link))).toBe(target)
  })

  it('refuses to replace a real directory', () => {
    const { root, link, target } = fixture()
    mkdirSync(link, { recursive: true })

    expect(() => materializeWindowsWorkspaceLink({ platform: 'win32', link, target }))
      .toThrow('refusing to replace non-link directory')
    expect(lstatSync(link).isDirectory()).toBe(true)
    expect(lstatSync(join(root, 'desktop')).isDirectory()).toBe(true)
  })

  it('leaves the workspace untouched on non-Windows hosts', () => {
    const { root, link, target } = fixture()
    mkdirSync(join(root, 'desktop'))
    writeFileSync(link, '../deepseek-harness')

    expect(materializeWindowsWorkspaceLink({ platform: 'darwin', link, target })).toBe(false)
    expect(lstatSync(link).isFile()).toBe(true)
  })
})
