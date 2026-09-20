/** Yootun occupants for the generic sidebar and conversation brand slots. */

import type { CSSProperties } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { heroBrandDataUrl, sidebarBrandDataUrl, sidebarBrandMarkDataUrl } from './generated-brand-assets.ts'
import { BRAND_DISPLAY_NAME, BRAND_MISSION, BRAND_VARIANT, BRAND_WORDMARK_DISPLAY } from '../generated-product-identity.ts'

const DESKTOP_BRAND_PRIORITY = -100
const DESKTOP_BRAND_MISSION_KEY = '__DSH_DESKTOP_BRAND_MISSION__'

const sidebarStyle: CSSProperties = {
  display: 'block',
  width: BRAND_WORDMARK_DISPLAY.width,
  height: BRAND_WORDMARK_DISPLAY.height,
  maxWidth: '100%',
  objectFit: 'contain',
  objectPosition: 'left center',
}

/** Render the complete horizontal Yootun lockup in the expanded sidebar row. */
export function YootunSidebarBrandMark(_props: SidebarBrandMarkOwnerProps) {
  if (BRAND_VARIANT === 'sensteed') {
    return (
      <div className="dshBrandSidebarLockup" data-dsh-sensteed-brand="sidebar" title={BRAND_MISSION.zh}>
        <img alt="" draggable={false} height={36} src={sidebarBrandMarkDataUrl} width={36} />
        <span>{BRAND_DISPLAY_NAME.titlebar}</span>
      </div>
    )
  }
  return (
    <img
      alt=""
      data-dsh-yootun-brand="sidebar"
      draggable={false}
      height={36}
      src={sidebarBrandDataUrl}
      style={sidebarStyle}
      title={BRAND_MISSION.zh}
      width={200}
    />
  )
}

/** The lockup already contains its name artwork, so the independent name seat stays empty. */
export function YootunSidebarBrandName() {
  return null
}

/** Render the supplied Yootun avatar at the hero owner's requested mark size. */
export function YootunHeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return (
    <img
      alt=""
      className={className}
      data-dsh-yootun-brand="hero"
      draggable={false}
      height={size}
      src={heroBrandDataUrl}
      style={{ display: 'block', objectFit: 'contain' }}
      title={BRAND_MISSION.zh}
      width={size}
    />
  )
}

/** Register the Desktop brand as one declaration-aware occupant set. */
export function applyDesktopBrand(ctx: ClientContext): void {
  ctx.effect(() => {
    const target = globalThis as typeof globalThis & { [DESKTOP_BRAND_MISSION_KEY]?: string }
    const previous = target[DESKTOP_BRAND_MISSION_KEY]
    target[DESKTOP_BRAND_MISSION_KEY] = BRAND_MISSION.zh
    return () => {
      if (previous === undefined) delete target[DESKTOP_BRAND_MISSION_KEY]
      else target[DESKTOP_BRAND_MISSION_KEY] = previous
    }
  }, 'dsh-plugin-desktop: brand mission')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-plugin-desktop'
    style.dataset.pluginCss = 'dsh-plugin-desktop/brand-layout'
    style.textContent = [
      'button:has([data-dsh-yootun-brand="sidebar"]) > [aria-hidden="true"] { height: 36px; }',
      '.dshBrandSidebarLockup { display: flex; align-items: center; gap: 8px; height: 36px; min-width: 0; }',
      '.dshBrandSidebarLockup img { display: block; flex: 0 0 36px; object-fit: contain; }',
      '.dshBrandSidebarLockup span { overflow: hidden; color: #0f172a; font-size: 17px; font-weight: 600; line-height: 1; white-space: nowrap; text-overflow: ellipsis; }',
    ].join('\n')
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-plugin-desktop: brand layout styles')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: DESKTOP_BRAND_PRIORITY }, YootunSidebarBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', priority: DESKTOP_BRAND_PRIORITY }, YootunSidebarBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: DESKTOP_BRAND_PRIORITY }, YootunHeroBrandMark)
      })))
}
