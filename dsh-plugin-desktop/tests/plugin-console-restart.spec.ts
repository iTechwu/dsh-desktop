import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DesktopActionsService from '../src/desktop-actions.ts'

const processes = vi.hoisted(() => ({
  execFile: vi.fn(() => { throw new Error('Plugin must not launch a restart script') }),
  write: vi.fn(() => { throw new Error('Desktop framework routes must not write files') }),
  https: vi.fn(() => { throw new Error('Desktop framework routes must not query npm') }),
}))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), execFile: processes.execFile,
}))
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  writeFileSync: processes.write, mkdirSync: processes.write, copyFileSync: processes.write, rmSync: processes.write,
}))
vi.mock('node:https', async importOriginal => ({
  ...await importOriginal<typeof import('node:https')>(), request: processes.https,
}))

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  expect(processes.execFile).not.toHaveBeenCalled()
  expect(processes.write).not.toHaveBeenCalled()
  expect(processes.https).not.toHaveBeenCalled()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

async function mount(confirmRestart: (acknowledge: () => Promise<void>) => Promise<boolean>, legacy: boolean | 'missing' = false) {
  const ctx = new Context()
  const fiber = ctx.plugin(DesktopActionsService, { openTerminal() {}, requestRestart() {}, confirmRestart })
  await fiber
  cleanup.push(() => fiber.dispose())
  const events: string[] = []
  let handler!: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  let received = 0
  const server = createServer((req, res) => {
    received += 1
    res.once('finish', () => { events.push('response finished') })
    void handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test port')
  const origin = `http://127.0.0.1:${address.port}`
  const plugin = await import(new URL('../../.ci/dsh-plugin-console/lib/index.js', import.meta.url).href)
  plugin.apply({
    effect: (setup: () => unknown) => setup(),
    get: (name: string) => name === 'desktopActions'
      ? (legacy === 'missing' ? undefined : legacy ? { requestRestart() {} } : ctx.desktopActions)
      : name === 'desktopRuntime' ? {} : undefined,
    loader: { entries: () => [
      { id: 'webserver', options: { name: '@deepseek-ai/dsh-host-webserver', config: { port: address.port } } },
      { id: 'plugin-a', options: { name: '@example/plugin-a' } },
    ] },
    webServer: { register: (route: { handler: typeof handler }) => { handler = route.handler; return () => {} } },
  })
  return { events, received: () => received, request: (path = 'restart', init: RequestInit = {}) => fetch(`${origin}/plugin-console/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}', ...init,
  }) }
}

describe('Plugin Console desktop-owned restart route', () => {
  it('keeps desktop state reads free of framework patches and legacy progress files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-console-framework-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    vi.stubEnv('DSH_HOME', root)
    const harness = await mount(async () => false)
    const response = await harness.request('state', { method: 'GET', body: null })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ framework: null, frameworkUpgradeOwner: 'desktop', nativeRestartConfirmation: true })
    expect(await (await harness.request('framework-upgrade-status', { method: 'GET', body: null })).json())
      .toEqual({ ok: true, status: 'idle', message: null, owner: 'desktop' })
    expect(await readdir(root)).toEqual([])
  })

  it('blocks in-place desktop framework upgrades and returns the application owner for version checks', async () => {
    const harness = await mount(async () => false)
    expect((await harness.request('framework-upgrade')).status).toBe(409)
    for (const packageName of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-root', '@deepseek-ai/cordis']) {
      const checked = await harness.request('check-update', { body: JSON.stringify({ packageName }) })
      expect(await checked.json()).toMatchObject({ ok: true, source: 'desktop', managed: true, latest: null })
      expect((await harness.request('install', { body: JSON.stringify({ packageName }) })).status).toBe(409)
    }
  })

  it.each(['restart', 'framework-relaunch'])('delegates %s and flushes acceptance before teardown', async path => {
    let harness!: Awaited<ReturnType<typeof mount>>
    const confirmRestart = vi.fn(async (acknowledge: () => Promise<void>) => {
      await acknowledge()
      expect(harness.events).toEqual(['response finished'])
      harness.events.push('restart')
      return true
    })
    harness = await mount(confirmRestart)
    const response = await harness.request(path)
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, accepted: true, owner: 'desktop' })
    expect(confirmRestart).toHaveBeenCalledOnce()
    expect(harness.events).toEqual(['response finished', 'restart'])
  })

  it('returns cancellation and permits a later confirmed retry', async () => {
    const confirmRestart = vi.fn<(acknowledge: () => Promise<void>) => Promise<boolean>>()
      .mockResolvedValueOnce(false).mockImplementationOnce(async acknowledge => { await acknowledge(); return true })
    const harness = await mount(confirmRestart)
    expect(await (await harness.request()).json()).toEqual({ ok: true, cancelled: true, owner: 'desktop' })
    expect((await harness.request()).status).toBe(202)
    expect(confirmRestart).toHaveBeenCalledTimes(2)
  })

  it('coalesces simultaneous restart and relaunch requests across windows', async () => {
    let decide!: () => void
    const confirmRestart = vi.fn(async (acknowledge: () => Promise<void>) => {
      await new Promise<void>(resolve => { decide = resolve })
      await acknowledge()
      return true
    })
    const harness = await mount(confirmRestart)
    const responses = [harness.request(), harness.request('framework-relaunch')]
    await vi.waitFor(() => expect(harness.received()).toBe(2))
    decide()
    expect(await Promise.all(responses.map(async response => (await response).status))).toEqual([202, 202])
    expect(confirmRestart).toHaveBeenCalledOnce()
    expect(harness.events).toHaveLength(2)
  })

  it('rejects invalid and cross-origin requests before native confirmation', async () => {
    const confirmRestart = vi.fn(async () => false)
    const harness = await mount(confirmRestart)
    for (const body of ['{"command":"ignored"}', '[]', 'null', '{']) {
      expect((await harness.request('restart', { body })).status).toBe(400)
    }
    expect((await harness.request('restart', { method: 'GET', body: null })).status).toBe(405)
    expect((await harness.request('restart', { headers: { origin: 'https://example.invalid' } })).status).toBe(403)
    expect(confirmRestart).not.toHaveBeenCalled()
  })

  it('does not fall back to process killing when the desktop service is older or fails', async () => {
    const confirmRestart = vi.fn(async () => { throw new Error('native channel failed') })
    const failed = await mount(confirmRestart)
    const response = await failed.request()
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('native channel failed')
    const legacy = await mount(confirmRestart, true)
    expect((await legacy.request('framework-relaunch')).status).toBe(503)
    const missing = await mount(confirmRestart, 'missing')
    expect((await missing.request()).status).toBe(503)
    expect(confirmRestart).toHaveBeenCalledOnce()
  })

  it('rejects profile mutations from other windows while an install job is active', async () => {
    processes.execFile.mockImplementation((() => {
      return { on() {} }
    }) as never)
    const harness = await mount(async () => false)
    const install = await harness.request('install', { body: JSON.stringify({ packageName: '@example/active-plugin' }) })
    expect(install.status).toBe(200)
    expect(await install.json()).toMatchObject({ ok: true, status: 'installing' })

    for (const [path, body] of [
      ['toggle', { entryId: 'plugin-a', enabled: false }],
      ['uninstall', { entryId: 'plugin-a' }],
      ['skill-toggle', { name: 'alpha-skill', enabled: false }],
    ] as const) {
      const response = await harness.request(path, { body: JSON.stringify(body) })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('安装任务进行中') })
    }
    expect(processes.execFile).toHaveBeenCalled()
    // Keep the background command suspended so the test proves the active-job branch.
    processes.execFile.mockClear()
  })
})
