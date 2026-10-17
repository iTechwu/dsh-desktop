import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectionRequestRejection,
  ConnectionTrustRequest,
} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopNotification,
  DesktopRuntime,
  DesktopTrayItem,
} from '../src/runtime.ts'
import {
  DESKTOP_RELEASE_CHANNEL_HEADER,
  type UpdateCheckResult,
} from '../src/update-checker.ts'
import { apply, Config, inject, type Config as UpdateConfig } from '../src/updates.ts'
import {
  DESKTOP_UPDATE_CHECK_PATH,
  DESKTOP_UPDATE_DOWNLOAD_PATH,
  DESKTOP_UPDATE_INSTALL_PATH,
  DESKTOP_UPDATE_STATE_PATH,
} from '../src/desktop-settings-contract.ts'

function routeFor(harness: Harness, path: string): WebRoute {
  const route = harness.routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`Update route ${path} was not registered.`)
  return route
}

async function readUpdateState(harness: Harness): Promise<Record<string, unknown>> {
  const req = {
    method: 'GET',
    headers: {
      host: '127.0.0.1:43120',
      referer: 'http://127.0.0.1:43120/',
      'sec-fetch-site': 'same-origin',
    },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage
  let body = ''
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((value?: string) => { body = value ?? '' }),
  } as unknown as ServerResponse
  await routeFor(harness, DESKTOP_UPDATE_STATE_PATH).handler(req, res)
  return JSON.parse(body) as Record<string, unknown>
}

async function postEmptyUpdateCommand(harness: Harness, path: string, bodyText = '{}'): Promise<ServerResponse> {
  const req = {
    method: 'POST',
    headers: {
      host: '127.0.0.1:43120',
      origin: 'http://127.0.0.1:43120',
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1' },
    async * [Symbol.asyncIterator]() { yield Buffer.from(bodyText) },
  } as unknown as IncomingMessage
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse
  await routeFor(harness, path).handler(req, res)
  return res
}

const testConfig: UpdateConfig = {
  enabled: true,
  initialDelayMs: 10,
  intervalMs: 1000,
  requestTimeoutMs: 1000,
}

function versionResponse(version: unknown): Response {
  return Response.json({ version })
}

interface Harness {
  readonly statePath: string
  readonly tray: DesktopTrayItem
  readonly trays: readonly DesktopTrayItem[]
  readonly notifications: DesktopNotification[]
  readonly warnings: unknown[][]
  readonly confirmDownload: ReturnType<typeof vi.fn>
  readonly showManualCheckResult: ReturnType<typeof vi.fn>
  readonly downloadAndOpen: ReturnType<typeof vi.fn>
  readonly installDownloaded: ReturnType<typeof vi.fn>
  readonly refresh: ReturnType<typeof vi.fn>
  readonly registrationDispose: ReturnType<typeof vi.fn>
  readonly requestRejection: ReturnType<typeof vi.fn<(
    request: ConnectionTrustRequest,
  ) => ConnectionRequestRejection>>
  readonly routes: readonly WebRoute[]
  dispose(): Promise<void>
}

async function createHarness(options: {
  readonly packaged?: boolean
  readonly canDownload?: boolean
  readonly config?: UpdateConfig
  readonly request?: DesktopRuntime['updates']['request']
  readonly releaseChannel?: 'stable' | 'beta'
  readonly currentVersion?: string
  readonly confirmDownload?: (version: string, channel?: 'stable' | 'beta') => Promise<boolean>
  readonly showManualCheckResult?: (result: UpdateCheckResult | null) => Promise<void>
  readonly downloadAndOpen?: (
    version: string,
    signal: AbortSignal,
    channel?: 'stable' | 'beta',
    installerSha256?: Readonly<Partial<Record<'win32' | 'darwin', string>>>,
    onProgress?: (received: number, total: number | undefined) => void,
    silent?: boolean,
  ) => Promise<void>
  readonly installDownloaded?: (
    version: string,
    expectedSha256?: Readonly<Partial<Record<'win32' | 'darwin', string>>>,
  ) => Promise<'exit' | 'manual'>
  readonly notify?: (notification: DesktopNotification) => void
  readonly locale?: DesktopRuntime['locale']
  readonly state?: string
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-updates-'))
  const statePath = join(root, 'private', 'state.json')
  if (options.state !== undefined) {
    await mkdir(join(root, 'private'), { recursive: true })
    await writeFile(statePath, options.state, { mode: 0o600 })
  }
  const notifications: DesktopNotification[] = []
  const warnings: unknown[][] = []
  const refresh = vi.fn()
  const registrationDispose = vi.fn()
  const confirmDownload = vi.fn(options.confirmDownload ?? (async () => false))
  const showManualCheckResult = vi.fn(options.showManualCheckResult ?? (async () => {}))
  const downloadAndOpen = vi.fn(options.downloadAndOpen ?? (async () => {}))
  const installDownloaded = vi.fn(options.installDownloaded ?? (async () => {}))
  const requestRejection = vi.fn<(
    request: ConnectionTrustRequest,
  ) => ConnectionRequestRejection>(() => undefined)
  let tray: DesktopTrayItem | undefined
  const trays: DesktopTrayItem[] = []
  const routes: WebRoute[] = []
  let disposer: (() => void | Promise<void>) | undefined
  const runtime = {
    locale: options.locale ?? 'en',
    updates: {
      isPackaged: options.packaged ?? true,
      currentVersion: options.currentVersion ?? '2.0.0',
      ...(options.releaseChannel === undefined ? {} : { releaseChannel: options.releaseChannel }),
      statePath,
      canDownload: options.canDownload ?? true,
      request: options.request ?? (async () => versionResponse('2.0.0')),
      confirmDownload,
      showManualCheckResult,
      downloadAndOpen,
      installDownloaded,
      notify: options.notify ?? ((notification: DesktopNotification) => { notifications.push(notification) }),
    },
    registerTrayItem: (item: DesktopTrayItem) => {
      tray ??= item
      trays.push(item)
      return { refresh, dispose: registrationDispose }
    },
  } as unknown as DesktopRuntime
  const ctx = {
    desktopRuntime: runtime,
    webServer: {
      port: 43120,
      register: (registered: WebRoute) => {
        routes.push(registered)
        return () => {}
      },
    },
    connection: { requestRejection },
    logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
    effect: (register: () => (() => void | Promise<void>)) => {
      disposer = register()
      return disposer
    },
  } as unknown as Context

  apply(ctx, options.config ?? testConfig)
  if (tray === undefined) throw new Error('Update tray item was not registered.')
  if (routes.length !== 4) throw new Error('Update routes were not registered.')
  return {
    statePath,
    tray,
    trays,
    notifications,
    warnings,
    confirmDownload,
    showManualCheckResult,
    downloadAndOpen,
    installDownloaded,
    refresh,
    registrationDispose,
    requestRejection,
    routes,
    dispose: async () => { await disposer?.() },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop update Host plugin', () => {
  it('checks Beta automatically and installs an older stable release only through the explicit action', async () => {
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      const channel = new Headers(init.headers).get(DESKTOP_RELEASE_CHANNEL_HEADER)
      return Response.json(channel === 'beta'
        ? { version: '2.0.6-beta.1', channel: 'beta' }
        : { version: '2.0.4', channel: 'stable' })
    })
    const harness = await createHarness({
      releaseChannel: 'beta',
      currentVersion: '2.0.6-beta.1',
      request,
      confirmDownload: async () => true,
    })

    expect(harness.trays).toHaveLength(2)
    await harness.tray.invoke()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()

    await harness.trays[1]!.invoke()
    expect(harness.confirmDownload).toHaveBeenCalledWith('2.0.4', 'stable')
    expect(harness.downloadAndOpen).toHaveBeenCalledWith(
      '2.0.4',
      expect.any(AbortSignal),
      'stable',
      undefined,
      expect.any(Function),
      false,
    )
    const channels = request.mock.calls.map(([, init]) => new Headers(init.headers).get(DESKTOP_RELEASE_CHANNEL_HEADER))
    expect(channels).toContain('beta')
    expect(channels).toContain('stable')
    await harness.dispose()
  })

  it('exposes the packaged 60-second and six-hour background policy', () => {
    expect(inject).toEqual(['desktopRuntime', 'webServer', 'connection'])
    expect(Config({} as UpdateConfig)).toEqual({
      enabled: true,
      initialDelayMs: 60_000,
      intervalMs: 21_600_000,
      requestTimeoutMs: 15_000,
    })
    expect(() => Config({ intervalMs: 0 } as UpdateConfig)).toThrow()
    expect(() => Config({ requestTimeoutMs: 0 } as UpdateConfig)).toThrow()
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
  ] as const)('applies the Connection %i rejection before the interactive update route', async (
    status,
    body,
  ) => {
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({ packaged: false, request })
    harness.requestRejection.mockReturnValue(status)
    const req = { headers: {} } as IncomingMessage
    const writeHead = vi.fn()
    const end = vi.fn()
    const res = { writeHead, end } as unknown as ServerResponse

    await routeFor(harness, DESKTOP_UPDATE_CHECK_PATH).handler(req, res)

    expect(harness.requestRejection).toHaveBeenCalledWith(req)
    expect(writeHead).toHaveBeenCalledWith(status)
    expect(end).toHaveBeenCalledWith(body)
    expect(request).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    await harness.dispose()
  })

  it('passes an authenticated interactive update request to the existing route handler', async () => {
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({ packaged: false, request })
    const req = {
      method: 'POST',
      headers: {
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:43120',
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '127.0.0.1' },
      async * [Symbol.asyncIterator]() { yield Buffer.from('{}') },
    } as unknown as IncomingMessage
    let body = ''
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn((value?: string) => { body = value ?? '' }),
    } as unknown as ServerResponse

    await routeFor(harness, DESKTOP_UPDATE_CHECK_PATH).handler(req, res)

    expect(harness.requestRejection).toHaveBeenCalledWith(req)
    expect(request).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'up-to-date',
      currentVersion: '2.0.0',
      latestVersion: '2.0.0',
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body)).toEqual({ accepted: true })
    await harness.dispose()
  })

  it('guards the update badge endpoints', async () => {
    const harness = await createHarness({ packaged: false })

    // The state endpoint is read-only and rejects command methods.
    const wrongMethod = await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_STATE_PATH)
    expect(wrongMethod.statusCode).toBe(405)

    // Command endpoints accept the exact empty request only.
    const richBody = await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH, '{"x":1}')
    expect(richBody.statusCode).toBe(400)
    const richInstallBody = await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_INSTALL_PATH, '{"x":1}')
    expect(richInstallBody.statusCode).toBe(400)

    // The state endpoint serves the loopback renderer origin only.
    const req = {
      method: 'GET',
      headers: {
        host: '127.0.0.1:43120',
        referer: 'http://127.0.0.1:43120/',
        'sec-fetch-site': 'same-origin',
      },
      socket: { remoteAddress: '192.168.1.8' },
    } as unknown as IncomingMessage
    let body = ''
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn((value?: string) => { body = value ?? '' }),
    } as unknown as ServerResponse
    await routeFor(harness, DESKTOP_UPDATE_STATE_PATH).handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(body).toContain('forbidden')

    await harness.dispose()
  })

  it('renders the update tray command in the active native locale', async () => {
    const harness = await createHarness({ packaged: false, locale: 'zh' })

    expect(harness.tray.label()).toBe('检查更新…')

    await harness.dispose()
  })

  it.each([
    { packaged: false, enabled: true },
    { packaged: true, enabled: false },
  ])('reports a manual up-to-date result while automatic polling is disabled: %#', async ({ packaged, enabled }) => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({
      packaged,
      request,
      config: { ...testConfig, enabled },
    })

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    expect(request).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('Check for Updates…')
    await harness.tray.invoke()
    expect(request).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'up-to-date',
      currentVersion: '2.0.0',
      latestVersion: '2.0.0',
    })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
  })

  it('announces a background update once without opening a confirmation dialog', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({ request })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => {
      expect(harness.notifications).toEqual([{
        title: 'Yootun-Agent Update Available',
        body: 'Version 2.1.0 is ready to download. Open Yootun-Agent to continue.',
      }])
    })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('Yootun-Agent 2.1.0 Available')
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 3,
        lastNotifiedVersion: '2.1.0',
      })
    })
    if (process.platform !== 'win32') {
      expect((await stat(harness.statePath)).mode & 0o777).toBe(0o600)
    }

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    await vi.waitFor(() => { expect(request).toHaveBeenCalledTimes(2) })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.notifications).toHaveLength(1)
    expect(harness.warnings).toEqual([])
  })

  it('downloads silently only after the badge action and reports the ready phase', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      downloadAndOpen: async () => download,
    })

    const check = harness.tray.invoke()
    await check
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(await readUpdateState(harness)).toEqual({ phase: 'available', version: '2.1.0' })

    const command = postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    const call = harness.downloadAndOpen.mock.calls[0] as unknown as [
      string,
      AbortSignal,
      unknown,
      unknown,
      unknown,
      boolean,
    ]
    expect(call[0]).toBe('2.1.0')
    expect(call[1]).toBeInstanceOf(AbortSignal)
    expect(call[1].aborted).toBe(false)
    expect(call[5]).toBe(true)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(await readUpdateState(harness)).toEqual({ phase: 'downloading', version: '2.1.0' })
    expect(harness.tray.label()).toBe('Downloading Yootun-Agent 2.1.0…')
    expect(harness.notifications).toEqual([])

    resolveDownload()
    await command
    await vi.waitFor(() => { expect(harness.tray.label()).toBe('Yootun-Agent 2.1.0 Available') })
    expect(await readUpdateState(harness)).toEqual({ phase: 'ready', version: '2.1.0' })
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
  })

  it('reports download progress through the state endpoint', async () => {
    vi.useFakeTimers()
    let reportProgress!: (received: number, total: number | undefined) => void
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      downloadAndOpen: async (_version, _signal, _channel, _digests, onProgress) => {
        reportProgress = onProgress as (received: number, total: number | undefined) => void
        return new Promise<void>(() => {})
      },
    })

    await harness.tray.invoke()
    void postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    reportProgress(256, 1024)
    expect(await readUpdateState(harness)).toEqual({
      phase: 'downloading',
      version: '2.1.0',
      received: 256,
      total: 1024,
    })
  })

  it('starts and confirms the platform install only from the badge flow', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      downloadAndOpen: async () => download,
      installDownloaded: async () => 'exit',
    })

    // Before any update exists both badge commands are accepted no-ops.
    await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_INSTALL_PATH)
    expect(harness.installDownloaded).not.toHaveBeenCalled()

    await harness.tray.invoke()
    void postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    resolveDownload()
    await vi.waitFor(async () => {
      expect(await readUpdateState(harness)).toEqual({ phase: 'ready', version: '2.1.0' })
    })

    await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_INSTALL_PATH)
    expect(harness.installDownloaded).toHaveBeenCalledOnce()
    expect(harness.installDownloaded).toHaveBeenCalledWith('2.1.0', undefined)
    expect(await readUpdateState(harness)).toEqual({ phase: 'restarting', version: '2.1.0' })
  })

  it('hands the rechecked digests to the install action', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      packaged: false,
      request: async () => Response.json({
        version: '2.1.0',
        sha256: { windows: 'c'.repeat(64), mac: 'd'.repeat(64) },
      }),
      downloadAndOpen: async () => download,
      installDownloaded: async () => 'exit',
    })

    await harness.tray.invoke()
    void postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    resolveDownload()
    await vi.waitFor(async () => {
      expect(await readUpdateState(harness)).toEqual({ phase: 'ready', version: '2.1.0' })
    })

    await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_INSTALL_PATH)
    expect(harness.installDownloaded).toHaveBeenCalledWith('2.1.0', {
      win32: 'c'.repeat(64),
      darwin: 'd'.repeat(64),
    })
  })

  it('returns to the ready phase after macOS opens the disk image', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      downloadAndOpen: async () => download,
      installDownloaded: async () => 'manual',
    })

    await harness.tray.invoke()
    void postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    resolveDownload()
    await vi.waitFor(async () => {
      expect(await readUpdateState(harness)).toEqual({ phase: 'ready', version: '2.1.0' })
    })

    await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_INSTALL_PATH)
    await vi.waitFor(async () => {
      expect(await readUpdateState(harness)).toEqual({ phase: 'ready', version: '2.1.0' })
    })
    expect(harness.installDownloaded).toHaveBeenCalledOnce()
  })

  it('falls back to the ready phase when the install fails', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      downloadAndOpen: async () => download,
      installDownloaded: async () => { throw new Error('installer failed to spawn') },
    })

    await harness.tray.invoke()
    void postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    resolveDownload()
    await vi.waitFor(async () => {
      expect(await readUpdateState(harness)).toEqual({ phase: 'ready', version: '2.1.0' })
    })

    await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_INSTALL_PATH)
    await vi.waitFor(async () => {
      expect(await readUpdateState(harness)).toEqual({
        phase: 'ready',
        version: '2.1.0',
        installFailed: true,
      })
    })
    expect(harness.warnings).toEqual([])
  })

  it('exposes a failed silent download with the retry affordance', async () => {
    vi.useFakeTimers()
    let rejectDownload!: (cause: Error) => void
    const download = new Promise<void>((_resolve, reject) => { rejectDownload = reject })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      downloadAndOpen: async () => download,
    })

    await harness.tray.invoke()
    const command = postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    rejectDownload(new Error('offline'))
    await command

    expect(await readUpdateState(harness)).toEqual({
      phase: 'available',
      version: '2.1.0',
      downloadFailed: true,
    })
    expect(harness.tray.label()).toBe('Yootun-Agent 2.1.0 Available')
    expect(harness.warnings).toEqual([])
  })

  it('passes the rechecked installer digests to the silent download adapter', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      packaged: false,
      request: async () => Response.json({
        version: '2.1.0',
        sha256: { windows: 'c'.repeat(64), mac: 'd'.repeat(64) },
      }),
    })

    await harness.tray.invoke()
    const command = postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    const [version, , , installerSha256, , silent] = harness.downloadAndOpen.mock.calls[0] as unknown as [
      string,
      AbortSignal,
      unknown,
      Readonly<Partial<Record<'win32' | 'darwin', string>>> | undefined,
      unknown,
      boolean,
    ]
    expect(version).toBe('2.1.0')
    expect(installerSha256).toEqual({ win32: 'c'.repeat(64), darwin: 'd'.repeat(64) })
    expect(silent).toBe(true)
    await command
  })

  it('uses the digest from the recheck, not the first check', async () => {
    vi.useFakeTimers()
    let call = 0
    const harness = await createHarness({
      packaged: false,
      request: async () => {
        call += 1
        return Response.json({ version: '2.1.0', sha256: { mac: call === 1 ? 'c'.repeat(64) : 'd'.repeat(64) } })
      },
    })

    await harness.tray.invoke()
    const command = postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    expect(harness.downloadAndOpen.mock.calls[0]?.[3]).toEqual({ darwin: 'd'.repeat(64) })
    await command
  })

  it('omits the digest argument when the service publishes none', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
    })

    await harness.tray.invoke()
    const command = postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    const digestArgument = harness.downloadAndOpen.mock.calls[0]?.[3]
    expect(digestArgument).toBeUndefined()
    await command
  })

  it('shares the badge download action when a manual check repeats on the same release', async () => {
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
    })

    await harness.tray.invoke()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('Yootun-Agent 2.1.0 Available')

    const second = harness.tray.invoke()
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    await second
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen.mock.calls[0]?.[5]).toBe(true)
  })

  it('invalidates a stale ready artifact when the release rotates', async () => {
    vi.useFakeTimers()
    let releaseVersion = '2.1.0'
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse(releaseVersion),
      downloadAndOpen: async () => download,
      installDownloaded: async () => 'exit',
    })

    await harness.tray.invoke()
    void postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    resolveDownload()
    await vi.waitFor(async () => {
      expect(await readUpdateState(harness)).toEqual({ phase: 'ready', version: '2.1.0' })
    })

    releaseVersion = '2.2.0'
    await harness.tray.invoke()
    expect(await readUpdateState(harness)).toEqual({ phase: 'available', version: '2.2.0' })
  })

  it('rechecks the version after the badge action and skips a rotated download', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(versionResponse('2.1.0'))
      .mockResolvedValueOnce(versionResponse('2.2.0'))
    const harness = await createHarness({
      packaged: false,
      request,
    })

    await harness.tray.invoke()
    await postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)

    expect(request).toHaveBeenCalledTimes(2)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('Yootun-Agent 2.2.0 Available')
    expect(await readUpdateState(harness)).toEqual({ phase: 'available', version: '2.2.0' })
  })

  it.each([
    ['up-to-date', async () => versionResponse('2.0.0')],
    ['failed', async () => new Response('unavailable', { status: 503 })],
  ] as const)('keeps an automatic %s result silent', async (_case, request) => {
    vi.useFakeTimers()
    const requestSpy = vi.fn(request)
    const harness = await createHarness({ request: requestSpy })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(requestSpy).toHaveBeenCalledOnce() })

    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['same version', async () => versionResponse('2.0.0'), {
      status: 'up-to-date', currentVersion: '2.0.0', latestVersion: '2.0.0',
    }],
    ['older version', async () => versionResponse('1.9.9'), {
      status: 'up-to-date', currentVersion: '2.0.0', latestVersion: '1.9.9',
    }],
    ['invalid version', async () => versionResponse('v2.1.0'), null],
    ['service unavailable', async () => new Response('unavailable', { status: 503 }), null],
    ['network failure', async () => { throw new TypeError('offline') }, null],
  ] as const)('reports a manual %s result without prompting or downloading', async (_case, request, expected) => {
    const harness = await createHarness({ packaged: false, request })

    await harness.tray.invoke()

    expect(harness.showManualCheckResult).toHaveBeenCalledWith(expected)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })

  it('silently resets invalid legacy state before announcing the available version', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      request: async () => versionResponse('2.1.0'),
      state: JSON.stringify({
        version: 1,
        checkedVersion: '2.0.0',
        etag: '"legacy"',
        lastNotifiedVersion: '2.1.0',
        availableRelease: {
          tagName: 'v2.1.0',
          version: '2.1.0',
          htmlUrl: 'https://example.test/legacy',
        },
      }),
    })

    expect(harness.tray.label()).toBe('Check for Updates…')
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.notifications).toHaveLength(1) })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 3,
        lastNotifiedVersion: '2.1.0',
      })
    })
    expect(harness.warnings).toEqual([])
  })

  it('migrates v2 prompt history without repeating the same background announcement', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      request: async () => versionResponse('2.1.0'),
      state: JSON.stringify({ version: 2, lastPromptedVersion: '2.1.0' }),
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 3,
        lastNotifiedVersion: '2.1.0',
      })
    })

    expect(harness.notifications).toEqual([])
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('Yootun-Agent 2.1.0 Available')
  })

  it('does not prompt on a platform without a fixed download entry', async () => {
    const harness = await createHarness({
      packaged: false,
      canDownload: false,
      request: async () => versionResponse('2.1.0'),
    })

    await harness.tray.invoke()

    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'update-available',
      currentVersion: '2.0.0',
      latestVersion: '2.1.0',
    })
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })

  it('shares one pending download and silently restores availability after failure', async () => {
    let rejectDownload!: (cause: Error) => void
    const download = new Promise<void>((_resolve, reject) => { rejectDownload = reject })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      downloadAndOpen: async () => download,
    })

    await harness.tray.invoke()
    const first = postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    const second = postEmptyUpdateCommand(harness, DESKTOP_UPDATE_DOWNLOAD_PATH)
    // Let the second command reach the shared pending download before failing it.
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(harness.downloadAndOpen).toHaveBeenCalledOnce()
    rejectDownload(new Error('offline'))
    await Promise.all([first, second])

    expect(harness.downloadAndOpen).toHaveBeenCalledOnce()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(await readUpdateState(harness)).toEqual({
      phase: 'available',
      version: '2.1.0',
      downloadFailed: true,
    })
    expect(harness.tray.label()).toBe('Yootun-Agent 2.1.0 Available')
  })

  it('aborts checks and downloads and removes the tray item on effect disposal', async () => {
    let checkSignal: AbortSignal | undefined
    const checking = await createHarness({
      packaged: false,
      request: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        checkSignal = init.signal as AbortSignal
        checkSignal.addEventListener('abort', () => {
          reject(new DOMException('disposed', 'AbortError'))
        }, { once: true })
      }),
    })
    const pendingCheck = checking.tray.invoke()
    await vi.waitFor(() => { expect(checkSignal).toBeDefined() })
    await checking.dispose()
    await pendingCheck
    expect(checkSignal?.aborted).toBe(true)
    expect(checking.registrationDispose).toHaveBeenCalledOnce()
    expect(checking.notifications).toEqual([])

    let downloadSignal: AbortSignal | undefined
    const downloading = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      downloadAndOpen: async (_version, signal) => new Promise<void>((_resolve, reject) => {
        downloadSignal = signal
        signal.addEventListener('abort', () => {
          reject(new DOMException('disposed', 'AbortError'))
        }, { once: true })
      }),
    })
    await downloading.tray.invoke()
    const pendingDownload = postEmptyUpdateCommand(downloading, DESKTOP_UPDATE_DOWNLOAD_PATH)
    await vi.waitFor(() => { expect(downloadSignal).toBeDefined() })
    await downloading.dispose()
    await pendingDownload
    expect(downloadSignal?.aborted).toBe(true)
    expect(downloading.registrationDispose).toHaveBeenCalledOnce()
    expect(downloading.notifications).toEqual([])
    expect(downloading.warnings).toEqual([])
  })

  it('releases one update generation once and does not restart background polling', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({ request })

    await harness.dispose()
    await harness.dispose()
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs + testConfig.intervalMs)

    expect(request).not.toHaveBeenCalled()
    expect(harness.registrationDispose).toHaveBeenCalledOnce()
  })

  it('does not wait for an open manual result dialog during disposal', async () => {
    let closeDialog!: () => void
    const dialog = new Promise<void>(resolve => { closeDialog = resolve })
    const harness = await createHarness({
      packaged: false,
      showManualCheckResult: async () => dialog,
    })
    const pending = harness.tray.invoke()
    await vi.waitFor(() => { expect(harness.showManualCheckResult).toHaveBeenCalledOnce() })

    await harness.dispose()
    expect(harness.registrationDispose).toHaveBeenCalledOnce()

    closeDialog()
    await pending
  })

  it('reports a timed-out shared manual request and restores the idle tray label', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal
      signals.push(signal)
      signal.addEventListener('abort', () => {
        reject(new DOMException('cancelled', 'AbortError'))
      }, { once: true })
    }))
    const harness = await createHarness({ packaged: false, request })

    const first = harness.tray.invoke()
    const second = harness.tray.invoke()
    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    expect(harness.tray.label()).toBe('Checking for Updates…')
    await vi.advanceTimersByTimeAsync(testConfig.requestTimeoutMs)
    await Promise.all([first, second])

    expect(signals[0]?.aborted).toBe(true)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith(null)
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })
})
