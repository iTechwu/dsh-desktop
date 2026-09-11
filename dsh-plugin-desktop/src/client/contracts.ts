import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** Sidebar geometry passed by the desktop root slot. */
export interface DesktopSidebarOwnerProps {
  /** Whether the sidebar is showing its compact rail. */
  collapsed: boolean
  /** Current rendered sidebar width. */
  width: number
}

/** Rightbar geometry supplied by the Desktop-owned root frame. */
export interface DesktopRightbarOwnerProps {
  width: number
  viewportWidth: number
  canShow: boolean
}

/** Public panel transitions consumed by conversation and sidebar plugins. */
export interface DesktopLayoutService {
  /** Select a global main panel, or null for the current conversation. */
  selectPanel(panelId: string | null): void
  /** Start a cancellable navigation operation. */
  beginNavigation(): AbortSignal
  /** Toggle the sidebar between wide and compact presentation. */
  toggleSidebar(): void
  /** Open the current session's details panel. */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Open the current session's rightbar using upstream presentation flags. */
  openRightbar(track: boolean, fullscreen: boolean): void
  /** Close the current session's rightbar. */
  closeRightbar(): void
}

/** Insets reserved by Desktop-owned native chrome in CSS pixels. */
export interface DesktopWindowInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** Native caption hit-region geometry in CSS pixels. */
export interface DesktopWindowDragRegion {
  /** Height of the continuous top drag band. */
  readonly height: number
  /** Non-draggable native controls reserved on the left. */
  readonly leftInset: number
  /** Non-draggable native controls reserved on the right. */
  readonly rightInset: number
}

/** Generation-stable native window geometry exposed to Desktop client plugins. */
export interface DesktopWindowService {
  /** Installed Desktop product version for this renderer generation. */
  readonly version: string
  readonly mode: 'compatibility' | 'extended' | 'advanced'
  readonly platform: 'darwin' | 'win32' | 'linux'
  /** Capability-gated native material active behind this renderer. */
  readonly material: 'off' | 'transparent' | 'mica'
  /** Windows Mica capability after the operating-system build gate. */
  readonly micaSupported: boolean
  /** Materials available on the active platform and operating-system build. */
  readonly availableMaterials: readonly ('off' | 'transparent' | 'mica')[]
  /** Content insets owned by the active Desktop presentation. */
  readonly safeAreaInsets: DesktopWindowInsets
  /** Top caption geometry; interactive children must opt out of app dragging. */
  readonly dragRegion: DesktopWindowDragRegion
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Native window geometry for the current Desktop renderer generation. */
    desktopWindow: DesktopWindowService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Upstream sidebar occupant hosted by the Desktop-owned frame. */
    'sidebar': { kind: 'single'; scope: 'root'; owner: DesktopSidebarOwnerProps }
    /** Root-scoped keyed main surface; the conversation uses the reserved conversation key. */
    'main': { kind: 'keyed'; scope: 'root' }
    /** Unchanged upstream details surface. */
    'details': { kind: 'single'; scope: 'session'; owner: Record<never, never> }
    /** Upstream right sidebar occupant hosted by the Desktop-owned frame. */
    'rightbar': { kind: 'single'; scope: 'root'; owner: DesktopRightbarOwnerProps }
    /** Frame-wide additive overlays. */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}
