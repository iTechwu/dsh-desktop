/** Independent Desktop frame shared by compatibility and extended modes. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from './contracts.ts'
import { ExtendedFrame } from './ExtendedFrame.tsx'
import type { DesktopSettingsClientControl } from './desktop-settings.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import { installExtendedStyles } from './extended-styles.ts'
import { DesktopLayoutState } from './layout-state.ts'
import { claimDesktopLayout } from './layout-service.ts'
import { installDesktopOwnedStyles } from './styles.ts'
import { DesktopThemePresenter } from './theme-presenter.ts'

/** Own the extended root/sidebar surface without reusing enhanced-mode chrome. */
function applyExtendedOwnedShell(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  const desktopLayout = new DesktopLayoutState(id => ctx.slots.entries('main').some(entry => entry.options.key === id))
  // Harness 自带的 dsh-client-ui-layout 赢得所有权时,放弃本模式的自有呈现,
  // 由调用方决定是否以独立框架继续(#517)。
  if (!claimDesktopLayout(ctx, desktopLayout)) return

  ctx.effect(
    () => installDesktopOwnedStyles(),
    'desktop: extended owned layout styles',
  )

  ctx.effect(() => {
    const presenter = new DesktopThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'desktop: extended theme presenter')

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    children: {
      'sidebar': { kind: 'single', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
      'rightbar': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ layout: desktopLayout, platform: environment.platform }),
  }, ExtendedFrame), 'desktop: extended root slot')

  // 同 advanced-shell:桌面自有布局赢得所有权时,补上 panelInfo root hook,
  // 否则标准 prop usePanelInfo 为 undefined,根插槽渲染即崩溃(白屏)。
  ctx.effect(() => ctx.slots.provideRoot({
    hooks: {
      panelInfo: {
        getSnapshot: () => desktopLayout.getPanelInfo(),
        subscribe: listener => desktopLayout.subscribe(listener),
      },
    },
  }), 'desktop: extended panel info provider')
}

export function applyFramedShell(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
  _settingsControl?: DesktopSettingsClientControl,
): void {
  if (environment.mode !== 'compatibility' && environment.mode !== 'extended') {
    throw new Error(`dsh-plugin-desktop: framed shell received mode ${JSON.stringify(environment.mode)}`)
  }
  ctx.effect(() => {
    const contentViewport = document.getElementById('root')
    if (contentViewport === null) {
      throw new Error('dsh-plugin-desktop: framed shell requires the upstream root')
    }
    document.body.dataset.sensteedAgentMode = environment.mode
    document.body.dataset.sensteedAgentPlatform = environment.platform
    document.body.dataset.sensteedAgentMaterial = environment.material
    contentViewport.dataset.sensteedAgentContentViewport = ''
    const removeStyles = installExtendedStyles()
    return () => {
      removeStyles()
      delete contentViewport.dataset.sensteedAgentContentViewport
      delete document.body.dataset.sensteedAgentMode
      delete document.body.dataset.sensteedAgentPlatform
      delete document.body.dataset.sensteedAgentMaterial
    }
  }, `desktop: independent ${environment.mode} frame styles`)
}

/** Compose the extended-owned layout beneath its independent Desktop frame. */
export function applyExtendedShell(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
  settingsControl?: DesktopSettingsClientControl,
): void {
  if (environment.mode !== 'extended') {
    throw new Error(`dsh-plugin-desktop: extended shell received mode ${JSON.stringify(environment.mode)}`)
  }
  applyExtendedOwnedShell(ctx, environment)
  applyFramedShell(ctx, environment, settingsControl)
}
