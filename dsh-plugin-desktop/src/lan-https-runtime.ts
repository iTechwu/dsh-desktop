/** Generation-scoped owner for the optional Desktop LAN HTTPS edge. */

import type { DesktopLanHttpsCertificate } from './lan-https-certificate.ts'
import {
  LanHttpsIngress,
  type LanHttpsIngressSnapshot,
  type LanHttpsIngressState,
} from './lan-https-ingress.ts'

/** Public CA download path served through the Desktop Web carrier and HTTPS edge. */
export const DESKTOP_LAN_HTTPS_CA_PATH = '/.well-known/dsh-desktop-ca.crt'

/** Renderer-safe state for an available, inactive, or failed LAN HTTPS edge. */
export interface DesktopLanHttpsRuntimeSnapshot {
  readonly state: LanHttpsIngressState
  readonly actualPort: number | null
  readonly addresses: readonly string[]
  readonly caFingerprint: string | null
  readonly errorCode: string | null
}

export interface DesktopLanHttpsRuntimeOptions {
  /** Startup-sampled LAN IPv4 literals, retained even when certificate setup failed. */
  readonly addresses: readonly string[]
  /** Leaf key/chain and installation-local CA, when secure persistence succeeded. */
  readonly certificate?: DesktopLanHttpsCertificate
  /** Prepare TLS material once, only after LAN access is actually requested. */
  readonly prepareCertificate?: () => Promise<{
    readonly certificate?: DesktopLanHttpsCertificate
    readonly failureCode?: string
  }>
  /** Stable certificate bootstrap failure shown only if LAN is requested. */
  readonly failureCode?: string
  /** Public HTTPS port; zero asks the operating system for a free port. */
  readonly requestedPort?: number
}

function frozenSnapshot(
  state: LanHttpsIngressState,
  addresses: readonly string[],
  caFingerprint: string | null,
  errorCode: string | null,
): DesktopLanHttpsRuntimeSnapshot {
  return Object.freeze({
    state,
    actualPort: null,
    addresses,
    caFingerprint,
    errorCode,
  })
}

function projectIngress(snapshot: LanHttpsIngressSnapshot): DesktopLanHttpsRuntimeSnapshot {
  return Object.freeze({
    state: snapshot.state,
    actualPort: snapshot.actualPort,
    addresses: snapshot.addresses,
    caFingerprint: snapshot.caFingerprint,
    errorCode: snapshot.errorCode,
  })
}

/**
 * Keeps TLS material outside Cordis config while letting the Desktop shell
 * attach the HTTPS edge after the upstream loopback port is known.
 */
export class DesktopLanHttpsRuntime {
  private readonly addresses: readonly string[]
  private certificate: DesktopLanHttpsCertificate | undefined
  private readonly prepareCertificate: DesktopLanHttpsRuntimeOptions['prepareCertificate']
  private failureCode: string
  private readonly requestedPort: number
  private ingress: LanHttpsIngress | undefined
  private targetPort: number | undefined
  private preparation: Promise<void> | undefined
  private desiredEnabled = false
  private current: DesktopLanHttpsRuntimeSnapshot

  constructor(options: DesktopLanHttpsRuntimeOptions) {
    this.addresses = Object.freeze([...options.addresses])
    this.certificate = options.certificate
    this.prepareCertificate = options.prepareCertificate
    this.failureCode = options.failureCode ?? 'certificate-unavailable'
    this.requestedPort = options.requestedPort ?? 0
    this.current = frozenSnapshot(
      'inactive',
      this.addresses,
      options.certificate?.caFingerprint ?? null,
      null,
    )
  }

  get caCertificate(): string | null {
    return this.certificate?.caCertificate ?? null
  }

  /** Attach exactly once to the actual loopback WebServer port. */
  attach(targetPort: number): void {
    if (this.targetPort !== undefined) {
      if (this.targetPort === targetPort) return
      throw new Error('dsh-plugin-desktop: LAN HTTPS runtime is already attached to another port')
    }
    this.targetPort = targetPort
    this.createIngress()
  }

  private createIngress(): LanHttpsIngress | undefined {
    if (this.ingress !== undefined) return this.ingress
    const certificate = this.certificate
    const targetPort = this.targetPort
    if (certificate === undefined || targetPort === undefined) return undefined
    this.ingress = new LanHttpsIngress({
      targetPort: targetPort,
      requestedPort: this.requestedPort,
      key: certificate.key,
      cert: certificate.cert,
      caFingerprint: certificate.caFingerprint,
      allowedAddresses: certificate.addresses,
    })
    return this.ingress
  }

  private async prepareIngress(): Promise<LanHttpsIngress | undefined> {
    const currentIngress = this.createIngress()
    if (currentIngress !== undefined) return currentIngress
    const prepareCertificate = this.prepareCertificate
    if (prepareCertificate === undefined) return undefined
    this.preparation ??= (async () => {
      try {
        const prepared = await prepareCertificate()
        this.failureCode = prepared.failureCode ?? this.failureCode
        if (prepared.certificate === undefined) {
          // A resolved response without a certificate is still a failure:
          // clear the cached promise so the next setEnabled(true) retries.
          this.preparation = undefined
          return
        }
        this.certificate = prepared.certificate
        this.createIngress()
      } catch (cause) {
        this.preparation = undefined
        const code = (cause as NodeJS.ErrnoException | null)?.code
        this.failureCode = typeof code === 'string' && code.length > 0
          ? code
          : cause instanceof Error && cause.name.length > 0 && cause.name !== 'Error'
            ? cause.name
            : 'certificate-unavailable'
      }
    })()
    await this.preparation
    return this.createIngress()
  }

  snapshot(): DesktopLanHttpsRuntimeSnapshot {
    const ingress = this.ingress
    return ingress === undefined ? this.current : projectIngress(ingress.snapshot())
  }

  /** Hot-enable or disable the edge without rebuilding the Host generation. */
  async setEnabled(enabled: boolean): Promise<DesktopLanHttpsRuntimeSnapshot> {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('dsh-plugin-desktop: LAN HTTPS enabled state must be a boolean')
    }
    this.desiredEnabled = enabled
    if (!enabled) {
      const ingress = this.ingress
      this.current = ingress === undefined
        ? frozenSnapshot('inactive', this.addresses, this.certificate?.caFingerprint ?? null, null)
        : projectIngress(await ingress.setEnabled(false))
      return this.current
    }
    if (this.ingress === undefined && this.prepareCertificate !== undefined) {
      this.current = frozenSnapshot('starting', this.addresses, null, null)
    }
    const ingress = await this.prepareIngress()
    if (!this.desiredEnabled) return this.current
    if (ingress === undefined) {
      this.current = frozenSnapshot('failed', this.addresses, null, this.failureCode)
      return this.current
    }
    this.current = projectIngress(await ingress.setEnabled(true))
    return this.current
  }

  stop(): Promise<DesktopLanHttpsRuntimeSnapshot> {
    return this.setEnabled(false)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Launcher-owned TLS material and hot LAN HTTPS edge. */
    desktopLanHttps: DesktopLanHttpsRuntime
  }
}

export default DesktopLanHttpsRuntime
