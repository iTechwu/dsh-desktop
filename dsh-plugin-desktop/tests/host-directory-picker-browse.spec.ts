import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DirectoryPickerBrowseCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { afterEach, describe, expect, it, vi } from 'vitest'

const statState = vi.hoisted(() => ({
  calls: [] as string[],
  failures: new Set<string>(),
  stalls: new Map<string, () => void>(),
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    stat: (path: Parameters<typeof actual.stat>[0]) => {
      const key = String(path)
      statState.calls.push(key)
      if (statState.failures.has(key)) {
        return Promise.reject(Object.assign(new Error(`cannot stat ${key}`), { code: 'EPERM' }))
      }
      const started = statState.stalls.get(key)
      if (started !== undefined) {
        started()
        return new Promise<never>(() => {})
      }
      return actual.stat(path)
    },
  }
})

interface BrowseFixture {
  capability: DirectoryPickerBrowseCapability
  dispose(): Promise<void>
}

async function browseFixture(): Promise<BrowseFixture> {
  vi.resetModules()
  const [{ Context }, { default: BrowseDirectoryPicker }] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-host-directory-picker-browse'),
  ])
  const ctx = new Context()
  const fiber = ctx.plugin(BrowseDirectoryPicker)
  await fiber.await()
  const capability = ctx.get('directoryPicker')?.capability()
  if (capability?.kind !== 'browse') throw new Error('browse directory picker was not installed')
  return { capability, dispose: () => fiber.dispose() }
}

describe('alpha host directory-picker browse patch', () => {
  afterEach(() => {
    statState.calls.length = 0
    statState.failures.clear()
    statState.stalls.clear()
  })

  it('enters real directories from dirents and probes only symlink candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-browse-'))
    const accessible = join(root, 'accessible')
    const blockedDirectory = join(root, 'blocked-directory')
    const linkedTarget = join(root, 'linked-target')
    const blockedLink = join(root, 'blocked-link')
    await Promise.all([
      mkdir(accessible),
      mkdir(blockedDirectory),
      mkdir(linkedTarget),
    ])
    await symlink(linkedTarget, blockedLink, process.platform === 'win32' ? 'junction' : 'dir')
    statState.failures.add(blockedLink)
    const fixture = await browseFixture()

    try {
      const listing = await fixture.capability.list(root)
      // 真实目录由 dirent 直接判定可进入;仅符号链接候选需要一次 stat 探测,
      // 探测失败的链接(损坏或不可读)静默跳过。
      expect(listing.entries.map(entry => entry.name)).toEqual(['accessible', 'blocked-directory', 'linked-target'])
      expect(statState.calls).toEqual([blockedLink])
      expect(statState.calls).not.toContain(accessible)
      expect(statState.calls).not.toContain(blockedDirectory)
    } finally {
      await fixture.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lets an abort interrupt a stalled stat of a symlink candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-browse-abort-'))
    const linkedTarget = join(root, 'linked-target')
    const stalled = join(root, 'stalled')
    await mkdir(linkedTarget)
    await symlink(linkedTarget, stalled, process.platform === 'win32' ? 'junction' : 'dir')
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    statState.stalls.set(stalled, markStarted)
    const fixture = await browseFixture()
    const controller = new AbortController()
    const reason = new Error('caller left during stat')

    try {
      const listing = fixture.capability.list(root, controller.signal)
      await started
      controller.abort(reason)
      await expect(listing).rejects.toBe(reason)
    } finally {
      await fixture.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
