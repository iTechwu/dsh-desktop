import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import DesktopActionsService, { type DesktopActionsBootstrap } from '../src/desktop-actions.ts'

async function mount(bootstrap: DesktopActionsBootstrap): Promise<{
  readonly ctx: Context
  readonly service: DesktopActionsService
  dispose(): Promise<unknown>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin(DesktopActionsService, bootstrap)
  await fiber
  return { ctx, service: ctx.desktopActions as DesktopActionsService, dispose: fiber.dispose }
}

describe('desktop actions Host service', () => {
  it('exposes only no-argument terminal and restart operations', async () => {
    const openTerminal = vi.fn<() => void>()
    const requestRestart = vi.fn<() => Promise<void>>(async () => {})
    const mounted = await mount({ openTerminal, requestRestart })

    mounted.service.openTerminal()
    await expect(mounted.service.requestRestart()).resolves.toBeUndefined()

    expect(openTerminal).toHaveBeenCalledWith()
    expect(requestRestart).toHaveBeenCalledWith()
    expect(Object.keys(mounted.service).sort()).not.toContain('runCommand')
  })

  it('coalesces a restart request and rejects retained references after disposal', async () => {
    let finishRestart!: () => void
    const requestRestart = vi.fn(() => new Promise<void>(resolve => { finishRestart = resolve }))
    const mounted = await mount({ openTerminal: vi.fn(), requestRestart })

    const first = mounted.service.requestRestart()
    const second = mounted.service.requestRestart()
    expect(second).toBe(first)
    expect(requestRestart).toHaveBeenCalledOnce()
    await mounted.dispose()
    expect(() => mounted.service.openTerminal()).toThrow(/service disposed/u)
    await expect(mounted.service.requestRestart()).rejects.toThrow(/service disposed/u)

    finishRestart()
    await expect(first).resolves.toBeUndefined()
  })

  it('allows a fresh request after native cancellation or failure', async () => {
    const confirmRestart = vi.fn<NonNullable<DesktopActionsBootstrap['confirmRestart']>>()
      .mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('dialog failed'))
      .mockImplementationOnce(async acknowledge => { await acknowledge(); return true })
    const mounted = await mount({ openTerminal: vi.fn(), requestRestart: vi.fn(), confirmRestart })
    const acknowledge = vi.fn(async () => {})
    await expect(mounted.service.confirmRestart(acknowledge)).resolves.toBe(false)
    await expect(mounted.service.confirmRestart(acknowledge)).rejects.toThrow('dialog failed')
    expect(acknowledge).not.toHaveBeenCalled()
    await expect(mounted.service.confirmRestart(acknowledge)).resolves.toBe(true)
    expect(acknowledge).toHaveBeenCalledOnce()
    await mounted.dispose()
  })

  it('acknowledges concurrent windows once before restarting, tolerating a closed window', async () => {
    const events: string[] = []
    const confirmRestart = vi.fn(async (acknowledge: () => Promise<void>) => {
      events.push('confirm')
      await acknowledge()
      events.push('restart')
      return true
    })
    const mounted = await mount({ openTerminal: vi.fn(), requestRestart: vi.fn(), confirmRestart })
    const first = mounted.service.confirmRestart(async () => { events.push('first response') })
    const second = mounted.service.confirmRestart(async () => { events.push('second response') })
    const closed = mounted.service.confirmRestart(async () => { throw new Error('window closed') })
    expect(second).toBe(first)
    expect(closed).toBe(first)
    await expect(first).resolves.toBe(true)
    expect(events).toEqual(['confirm', 'first response', 'second response', 'restart'])
    expect(confirmRestart).toHaveBeenCalledOnce()
    await mounted.dispose()
  })

  it('does not restart when every requesting window has gone away', async () => {
    const restart = vi.fn()
    const mounted = await mount({ openTerminal: vi.fn(), requestRestart: vi.fn(),
      confirmRestart: async acknowledge => { await acknowledge(); restart(); return true } })
    await expect(mounted.service.confirmRestart(async () => { throw new Error('closed') }))
      .rejects.toThrow('No restart response could be delivered')
    expect(restart).not.toHaveBeenCalled()
    await expect(mounted.service.confirmRestart(async () => {})).resolves.toBe(true)
    expect(restart).toHaveBeenCalledOnce()
    await mounted.dispose()
  })

  it('rejects late callers while responses drain and retained references after disposal', async () => {
    let responseStarted!: () => void
    let finishResponse!: () => void
    const started = new Promise<void>(resolve => { responseStarted = resolve })
    const response = new Promise<void>(resolve => { finishResponse = resolve })
    const mounted = await mount({ openTerminal: vi.fn(), requestRestart: vi.fn(),
      confirmRestart: async acknowledge => { await acknowledge(); return true } })
    const first = mounted.service.confirmRestart(async () => { responseStarted(); await response })
    await started
    await expect(mounted.service.confirmRestart(async () => {})).rejects.toThrow('already pending')
    finishResponse()
    await expect(first).resolves.toBe(true)
    await mounted.dispose()
    await expect(mounted.service.confirmRestart(async () => {})).rejects.toThrow('service disposed')
  })

  it('does not permanently suppress legacy restart requests after cancellation', async () => {
    const requestRestart = vi.fn(async () => {})
    const mounted = await mount({ openTerminal: vi.fn(), requestRestart })
    await mounted.service.requestRestart()
    await mounted.service.requestRestart()
    expect(requestRestart).toHaveBeenCalledTimes(2)
    await mounted.dispose()
  })
})
