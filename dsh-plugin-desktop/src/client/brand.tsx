/** Yootun occupants for the generic sidebar and conversation brand slots. */

import type { CSSProperties } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { heroBrandDataUrl, sidebarBrandDataUrl } from './generated-brand-assets.ts'

const sidebarStyle: CSSProperties = {
  display: 'block',
  width: 200,
  height: 36,
  maxWidth: 'none',
  objectFit: 'contain',
  objectPosition: 'left center',
}

/** Render the complete horizontal Yootun lockup in the expanded sidebar row. */
export function YootunSidebarBrandMark(_props: SidebarBrandMarkOwnerProps) {
  return (
    <img
      alt=""
      data-dsh-yootun-brand="sidebar"
      draggable={false}
      height={36}
      src={sidebarBrandDataUrl}
      style={sidebarStyle}
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
      width={size}
    />
  )
}

/** Register the Desktop brand as one declaration-aware occupant set. */
export function applyDesktopBrand(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-plugin-desktop'
    style.dataset.pluginCss = 'dsh-plugin-desktop/brand-layout'
    style.textContent = 'button:has([data-dsh-yootun-brand="sidebar"]) > [aria-hidden="true"] { height: 36px; }'
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-plugin-desktop: brand layout styles')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, YootunSidebarBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, YootunSidebarBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, YootunHeroBrandMark)
      })))
}
