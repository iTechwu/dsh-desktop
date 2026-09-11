import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { HostRpc } from '../src/host-rpc.ts'
import { bindNativeRuntime, createHostRuntime, runtimeSnapshot } from '../src/host-runtime-bridge.ts'
import type { DesktopRuntime, DesktopShellSpec, DesktopTrayItem } from '../src/runtime.ts'

it('preserves the Web URL and authentication while projecting shell and tray callbacks', async () => {
  const { port1, port2 } = new MessageChannel()
  const [parent, child] = [port1, port2].map(port => new HostRpc({
    send: value => port.postMessage(value),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  })) as [HostRpc, HostRpc]
  let shell!: DesktopShellSpec
  let tray!: DesktopTrayItem
  const disposeShell = vi.fn(async () => {})
  const disposeTray = vi.fn()
  const native = {
    platform: 'win32', windowsBuild: 22631, locale: 'en',
    updates: { isPackaged: true, canDownload: true, currentVersion: '2.0.7-beta.1', statePath: '/tmp/update',
      request: vi.fn(async () => new Response('{"version":"2.0.8-beta.1"}', { headers: { 'x-test': 'yes' } })),
    },
    schedule: (value: DesktopShellSpec) => { shell = value; return disposeShell },
    registerTrayItem: (value: DesktopTrayItem) => { tray = value; return { refresh() {}, dispose: disposeTray } },
  } as unknown as DesktopRuntime
  const release = bindNativeRuntime(parent, native)
  try {
    const runtime = createHostRuntime(child, runtimeSnapshot(native))
    let language: 'zh' | undefined
    const mode = vi.fn(async () => {})
    const invoke = vi.fn(async () => {})
    const spec = { url: 'http://127.0.0.1:1234/?dsh-desktop-mode=advanced',
      authenticationUrl: 'http://127.0.0.1:1234/?token=fixture',
      rendererAccessHeader: { name: 'x-dsh-desktop-renderer', value: 'fixture' },
      readLocalePreference: () => language, readThemeSource: () => 'dark',
      requestQuit() {}, requestModeChange: mode,
    } as unknown as DesktopShellSpec
    spec.readRemoteControl = vi.fn(async () => false)
    spec.enableRemoteControl = vi.fn(async () => {})
    const stopShell = runtime.schedule(spec)
    runtime.registerTrayItem({ group: 'tools', order: 1, label: () => 'Plugin action', invoke,
      submenu: () => [{ label: () => 'Child', invoke }] })
    language = 'zh'
    await runtime.mountScheduled()
    expect(await shell.readRemoteControl?.()).toBe(false)
    await shell.enableRemoteControl?.()
    expect(spec.enableRemoteControl).toHaveBeenCalledTimes(1)
    expect(shell.url).toBe(spec.url)
    expect(shell.authenticationUrl).toBe(spec.authenticationUrl)
    expect(shell.rendererAccessHeader).toEqual(spec.rendererAccessHeader)
    expect(shell.readLocalePreference()).toBe('zh')
    await shell.requestModeChange('extended')
    expect(mode).toHaveBeenCalledWith('extended')
    expect(tray.label()).toBe('Plugin action')
    await tray.submenu?.()[0]?.invoke()
    expect(invoke).toHaveBeenCalledOnce()
    const response = await runtime.updates.request('https://example.invalid', { headers: { accept: 'application/json' } })
    expect(response.headers.get('x-test')).toBe('yes')
    expect(await response.json()).toEqual({ version: '2.0.8-beta.1' })
    await stopShell()
    expect(disposeShell).toHaveBeenCalledOnce()
  } finally { await release(); parent.close(); child.close(); port1.close(); port2.close() }
})

it('carries cancellation and response acknowledgement across the private restart bridge', async () => {
  const { port1, port2 } = new MessageChannel()
  const makeRpc = (port: typeof port1, timeout: number) => new HostRpc({
    send: value => port.postMessage(value),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  }, timeout)
  const parent = makeRpc(port1, 1000)
  const child = makeRpc(port2, 5)
  let decide!: (accepted: boolean) => void
  const events: string[] = []
  const confirmRestart = vi.fn(async (acknowledge: () => Promise<void>) => {
    const accepted = await new Promise<boolean>(resolve => { decide = resolve })
    if (!accepted) return false
    await acknowledge()
    events.push('restart')
    return true
  })
  const native = { platform: 'darwin', locale: 'en', updates: {}, confirmRestart } as unknown as DesktopRuntime
  const release = bindNativeRuntime(parent, native)
  try {
    const runtime = createHostRuntime(child, runtimeSnapshot(native))
    const acknowledge = vi.fn(async () => { events.push('HTTP response finished') })
    const cancelled = runtime.confirmRestart(acknowledge)
    await vi.waitFor(() => expect(confirmRestart).toHaveBeenCalledOnce())
    // Native confirmation is interactive: the ordinary 5ms RPC deadline does not apply.
    await new Promise(resolve => setTimeout(resolve, 20))
    decide(false)
    await expect(cancelled).resolves.toBe(false)
    expect(acknowledge).not.toHaveBeenCalled()
    const accepted = runtime.confirmRestart(acknowledge)
    await vi.waitFor(() => expect(confirmRestart).toHaveBeenCalledTimes(2))
    decide(true)
    await expect(accepted).resolves.toBe(true)
    expect(events).toEqual(['HTTP response finished', 'restart'])
  } finally { await release(); parent.close(); child.close(); port1.close(); port2.close() }
})
