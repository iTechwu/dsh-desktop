import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DesktopActionsService from '../src/desktop-actions.ts'

const processes = vi.hoisted(() => ({ execFile: vi.fn(() => { throw new Error('Plugin must not launch a restart script') }) }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), execFile: processes.execFile,
}))

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  expect(processes.execFile).not.toHaveBeenCalled()
  vi.clearAllMocks()
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
    loader: { entries: () => [{ options: { name: '@deepseek-ai/dsh-host-webserver', config: { port: address.port } } }] },
    webServer: { register: (route: { handler: typeof handler }) => { handler = route.handler; return () => {} } },
  })
  return { events, received: () => received, request: (path = 'restart', init: RequestInit = {}) => fetch(`${origin}/plugin-console/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}', ...init,
  }) }
}

describe('Plugin Console desktop-owned restart route', () => {
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
})
