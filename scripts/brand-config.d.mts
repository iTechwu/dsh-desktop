/** Type surface for the white-label brand configuration loader/renderers. */

export interface BrandChannelIdentity {
  readonly productName: string
  readonly appId: string
  readonly artifactPrefix: string
}

export interface BrandConfig {
  readonly activeChannel: string
  readonly channels: Readonly<Record<'stable' | 'beta', BrandChannelIdentity>>
  readonly packageName: string
  readonly displayName: { readonly titlebar: string; readonly locale: string }
  readonly artwork: {
    readonly appIconSource: string
    readonly sidebarMark: string
    readonly heroMark: string
    readonly whiteThreshold: number
    readonly iconSize: number
    readonly heroSize: number
    readonly macIcon: { readonly canvas: number; readonly artwork: number }
  }
  readonly wordmark: {
    readonly image: string
    readonly text: { readonly zh: string; readonly en: string }
    readonly color: string
    readonly fontFile: string
    readonly lockup: { readonly width: number; readonly height: number }
    readonly display: { readonly width: number; readonly height: number }
  }
  readonly updates: {
    readonly endpoint: string
    readonly versionHeader: string
    readonly channelHeader: string
  }
  readonly docs: {
    readonly siteUrl: string
    readonly downloadBase: string
    readonly repoUrl: string
    readonly communityName: { readonly zh: string; readonly en: string }
    readonly maintainer: { readonly zh: string; readonly en: string }
    readonly noticesHeader: string
  }
  readonly nsis: { readonly shortcutName: string }
}

export declare const DEFAULT_BRAND_CONFIG_PATH: string

export declare function resolveBrandConfigPath(
  environment?: NodeJS.ProcessEnv | undefined,
  root?: string | undefined,
): string

export declare function loadBrandConfig(
  environment?: NodeJS.ProcessEnv | undefined,
  root?: string | undefined,
): BrandConfig

export declare function validateBrandConfig(
  document: unknown,
  sourcePath?: string | undefined,
): readonly string[]

export declare function resolveActiveChannel(config: BrandConfig): BrandChannelIdentity

export declare function renderIdentityModule(config: BrandConfig): string

export declare function renderBuilderConfig(
  config: BrandConfig,
  base: Record<string, unknown>,
): Record<string, unknown>
