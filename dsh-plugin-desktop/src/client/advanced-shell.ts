import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from './contracts.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import { AdvancedFrame } from './AdvancedFrame.tsx'
import { DesktopLayoutState } from './layout-state.ts'
import { claimDesktopLayout } from './layout-service.ts'
import { installDesktopOwnedStyles } from './styles.ts'
import { DesktopThemePresenter } from './theme-presenter.ts'

/** Own the enhanced layout and root slot without installing an independent frame. */
export function applyAdvancedShell(ctx: ClientContext, environment: DesktopClientEnvironment): void {
  if (environment.mode !== 'advanced') {
    throw new Error(`dsh-plugin-desktop: advanced shell received mode ${JSON.stringify(environment.mode)}`)
  }

  const desktopLayout = new DesktopLayoutState(id => ctx.slots.entries('main').some(entry => entry.options.key === id))
  const upstreamOwnsLayout = !claimDesktopLayout(ctx, desktopLayout)

  if (upstreamOwnsLayout) {
    // Harness 自带的 dsh-client-ui-layout 赢得所有权时,降级为仅保留模式
    // 标记,避免在同一呈现之上堆叠第二套 frame(#517)。
    ctx.effect(() => {
      document.body.dataset.sensteedAgentMode = 'advanced'
      document.body.dataset.sensteedAgentPlatform = environment.platform
      document.body.dataset.sensteedAgentMaterial = environment.material
      return () => {
        delete document.body.dataset.sensteedAgentMode
        delete document.body.dataset.sensteedAgentPlatform
        delete document.body.dataset.sensteedAgentMaterial
      }
    }, 'desktop: advanced shell markers')
    return
  }

  ctx.effect(() => {
    document.body.dataset.sensteedAgentMode = 'advanced'
    document.body.dataset.sensteedAgentPlatform = environment.platform
    document.body.dataset.sensteedAgentMaterial = environment.material
    const removeStyles = installDesktopOwnedStyles()
    return () => {
      removeStyles()
      delete document.body.dataset.sensteedAgentMode
      delete document.body.dataset.sensteedAgentPlatform
      delete document.body.dataset.sensteedAgentMaterial
    }
  }, 'desktop: advanced shell styles')

  ctx.effect(() => {
    const presenter = new DesktopThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'desktop: theme presenter')

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    children: {
      'sidebar': { kind: 'single', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
      'rightbar': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ layout: desktopLayout, platform: environment.platform }),
  }, AdvancedFrame), 'desktop: advanced root slot')

  // 桌面端赢得 layout 所有权时,harness 的 dsh-client-ui-layout 不在组合里,
  // 无人调用 provideRoot 注册 panelInfo —— 标准 prop usePanelInfo 会是
  // undefined,根插槽一渲染就崩溃(白屏)。这里补上桌面自己的 panelInfo 源。
  ctx.effect(() => ctx.slots.provideRoot({
    hooks: {
      panelInfo: {
        getSnapshot: () => desktopLayout.getPanelInfo(),
        subscribe: listener => desktopLayout.subscribe(listener),
      },
    },
  }), 'desktop: panel info provider')
}
