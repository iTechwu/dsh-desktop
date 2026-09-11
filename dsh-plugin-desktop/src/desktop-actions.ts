/** Narrow, generation-scoped native actions available to trusted Host plugins. */

import { type Context, Service } from '@deepseek-ai/cordis'

/** Native actions deliberately exposed without command, path, or launch configuration arguments. */
export interface DesktopActions {
  /** Open the already-configured Yootun-Agent terminal for the active profile. */
  openTerminal(): void
  /** Request one orderly Host-owned application restart. */
  requestRestart(): Promise<void>
  /** Confirm once for concurrent callers; await their responses before restarting. */
  confirmRestart(acknowledge: () => Promise<void>): Promise<boolean>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Narrow native actions safe for optional Host-plugin integration. */
    desktopActions: DesktopActions
  }
}

/** Launcher-owned implementations behind the narrow service boundary. */
export interface DesktopActionsBootstrap {
  openTerminal(): void
  requestRestart(): void | Promise<void>
  confirmRestart?(acknowledge: () => Promise<void>): Promise<boolean>
}

/** Publish only terminal-open and restart operations for one Cordis generation. */
export class DesktopActionsService extends Service implements DesktopActions {
  private disposed = false
  private restartOperation: Promise<void> | undefined
  private confirmation: {
    acknowledging: boolean
    acknowledgements: Set<() => Promise<void>>
    operation: Promise<boolean>
  } | undefined

  constructor(ctx: Context, private readonly bootstrap: DesktopActionsBootstrap) {
    super(ctx, 'desktopActions')
    ctx.effect(
      () => () => { this.disposed = true },
      'dsh-plugin-desktop: desktop actions lifetime',
    )
  }

  openTerminal(): void {
    this.assertActive()
    this.bootstrap.openTerminal()
  }

  requestRestart(): Promise<void> {
    try {
      this.assertActive()
      if (this.confirmation !== undefined) return this.confirmation.operation.then(() => {})
      if (this.restartOperation !== undefined) return this.restartOperation
      const operation = (async () => {
        this.assertActive()
        await this.bootstrap.requestRestart()
      })()
      this.restartOperation = operation
      const release = () => {
        if (this.restartOperation === operation) this.restartOperation = undefined
      }
      void operation.then(release, release)
      return operation
    } catch (cause) {
      return Promise.reject(cause)
    }
  }

  confirmRestart(acknowledge: () => Promise<void>): Promise<boolean> {
    try {
      this.assertActive()
      if (!this.bootstrap.confirmRestart) throw new Error('Desktop restart confirmation is unavailable')
      if (this.restartOperation !== undefined || this.confirmation?.acknowledging) {
        throw new Error('A Desktop restart request is already pending')
      }
      if (this.confirmation !== undefined) {
        this.confirmation.acknowledgements.add(acknowledge)
        return this.confirmation.operation
      }
      const confirmation = {
        acknowledging: false,
        acknowledgements: new Set([acknowledge]),
        operation: Promise.resolve(false),
      }
      this.confirmation = confirmation
      confirmation.operation = Promise.resolve().then(() => {
        this.assertActive()
        return this.bootstrap.confirmRestart!(async () => {
          this.assertActive()
          confirmation.acknowledging = true
          const results = await Promise.allSettled([...confirmation.acknowledgements].map(callback => Promise.resolve().then(callback)))
          // One closed window must not cancel another window's confirmed restart.
          if (!results.some(result => result.status === 'fulfilled')) {
            throw new Error('No restart response could be delivered')
          }
        })
      }).finally(() => {
        if (this.confirmation === confirmation) this.confirmation = undefined
      })
      return confirmation.operation
    } catch (cause) {
      return Promise.reject(cause)
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('dsh-plugin-desktop: desktopActions service disposed')
  }
}

export default DesktopActionsService
