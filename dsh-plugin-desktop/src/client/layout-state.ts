/** Advanced-shell panel state shared by the root slot and layout-service adapter. */
export interface DesktopLayoutSnapshot {
  /** Selected global panel; null displays the current conversation. */
  activePanelId: string | null
  /** Preferred sidebar width; zero means the compact rail. */
  sidebar: number
  /** Preferred details width; zero means closed. */
  details: number
  /** Preferred rightbar width; zero means no saved preference yet. */
  rightbar: number
  /** Whether the current session rightbar is shown. */
  rightbarShown: boolean
  /** Whether the rightbar reserves a normal grid track. */
  rightbarTrack: boolean
  /** Whether the rightbar is presented fullscreen. */
  rightbarFullscreen: boolean
  /** Whether the current viewport is below the automatic-collapse breakpoint. */
  narrow: boolean
  /** Manual narrow-screen override that temporarily expands the rail. */
  narrowExpanded: boolean
}

/** Column geometry after preserving the center surface. */
export interface DesktopColumns {
  /** Rendered sidebar width. */
  sidebar: number
  /** Rendered center width. */
  center: number
  /** Rendered details width. */
  details: number
}

/** Four-column geometry used by the Desktop shell (sidebar | center | rightbar | details). */
export interface DesktopColumnsWithRightbar {
  sidebar: number
  center: number
  rightbar: number
  details: number
}

/** Default compact rail used by the upstream sidebar. */
export const SIDEBAR_COLLAPSED = 56
/** Wider compact rail reserved only for the enhanced macOS presentation. */
export const MACOS_SIDEBAR_COLLAPSED = 90
export const SIDEBAR_DEFAULT = 280
export const SIDEBAR_MIN = 264
export const SIDEBAR_MAX = 420
export const SIDEBAR_AUTO_COLLAPSE = 1024
export const DETAILS_DEFAULT = 360
export const DETAILS_MIN = 300
export const DETAILS_MAX = 520
export const RIGHTBAR_DEFAULT_RATIO = 0.45
export const RIGHTBAR_MIN = 300
export const RIGHTBAR_MAX = 720
export const CENTER_MIN = 640

/** Keep the wider macOS rail private to enhanced mode; extended uses upstream geometry. */
export function collapsedSidebarWidth(
  mode: 'extended' | 'advanced',
  platform: 'darwin' | 'win32' | 'linux',
): number {
  return mode === 'advanced' && platform === 'darwin'
    ? MACOS_SIDEBAR_COLLAPSED
    : SIDEBAR_COLLAPSED
}

/**
 * Resolve three desktop columns without allowing details to squeeze the conversation below its floor.
 * @param viewport - available frame width.
 * @param sidebar - sidebar preference, where zero selects the compact rail.
 * @param details - details preference, where zero closes the panel.
 * @returns rendered column widths.
 */
export function computeDesktopColumns(
  viewport: number,
  sidebar: number,
  details: number,
  collapsedWidth: number = SIDEBAR_COLLAPSED,
): DesktopColumns {
  const sidebarWidth = sidebar === 0 ? collapsedWidth : clamp(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const preferredDetails = details === 0 ? 0 : clamp(details, DETAILS_MIN, DETAILS_MAX)
  if (sidebarWidth + preferredDetails + CENTER_MIN <= viewport) {
    return { sidebar: sidebarWidth, center: viewport - sidebarWidth - preferredDetails, details: preferredDetails }
  }
  const reducedDetails = preferredDetails === 0 ? 0 : Math.max(DETAILS_MIN, viewport - sidebarWidth - CENTER_MIN)
  if (sidebarWidth + reducedDetails + CENTER_MIN <= viewport) {
    return { sidebar: sidebarWidth, center: CENTER_MIN, details: reducedDetails }
  }
  return { sidebar: sidebarWidth, center: Math.max(0, viewport - sidebarWidth), details: 0 }
}

/**
 * Resolve the Desktop shell's four columns while protecting the conversation
 * surface. The rightbar gets precedence over the optional details surface so
 * opening the header rightbar button always has a visible destination.
 */
export function computeDesktopColumnsWithRightbar(
  viewport: number,
  sidebar: number,
  rightbar: number,
  details: number,
  collapsedWidth: number = SIDEBAR_COLLAPSED,
): DesktopColumnsWithRightbar {
  const sidebarWidth = sidebar === 0 ? collapsedWidth : clamp(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const available = Math.max(0, viewport - sidebarWidth - CENTER_MIN)
  const preferredRightbar = rightbar <= 0 ? 0 : clamp(rightbar, RIGHTBAR_MIN, RIGHTBAR_MAX)
  const resolvedRightbar = preferredRightbar === 0 || available < RIGHTBAR_MIN
    ? 0
    : Math.min(preferredRightbar, available)
  const afterRightbar = Math.max(0, available - resolvedRightbar)
  const preferredDetails = details === 0 ? 0 : clamp(details, DETAILS_MIN, DETAILS_MAX)
  const resolvedDetails = preferredDetails === 0 ? 0 : Math.min(preferredDetails, afterRightbar)
  if (resolvedRightbar + resolvedDetails > 0) {
    return {
      sidebar: sidebarWidth,
      center: Math.max(CENTER_MIN, viewport - sidebarWidth - resolvedRightbar - resolvedDetails),
      rightbar: resolvedRightbar,
      details: resolvedDetails,
    }
  }
  return {
    sidebar: sidebarWidth,
    center: Math.max(0, viewport - sidebarWidth),
    rightbar: 0,
    details: 0,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Small observable panel controller used by the advanced root registration. */
export class DesktopLayoutState {
  private snapshot: DesktopLayoutSnapshot = Object.freeze({
    activePanelId: null,
    sidebar: SIDEBAR_DEFAULT,
    details: 0,
    rightbar: 0,
    rightbarShown: false,
    rightbarTrack: false,
    rightbarFullscreen: false,
    narrow: false,
    narrowExpanded: false,
  })
  private readonly listeners = new Set<() => void>()
  private navigation = new AbortController()

  constructor(private readonly hasMainPanel: (id: string) => boolean = () => true) {}

  /** @returns the immutable current panel snapshot. */
  getSnapshot(): DesktopLayoutSnapshot {
    return this.snapshot
  }

  /** @param listener - callback notified after a snapshot replacement. @returns its disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Select a registered global panel, or return to the conversation. */
  selectPanel(panelId: string | null): void {
    if (panelId !== null && !this.hasMainPanel(panelId)) {
      throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
    }
    this.navigation.abort()
    if (this.snapshot.activePanelId === panelId) return
    this.publish({ ...this.snapshot, activePanelId: panelId })
  }

  /** Start a navigation operation, superseding the previous one. */
  beginNavigation(): AbortSignal {
    this.navigation.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }

  /** Cancel pending navigation when the layout owner unloads. */
  dispose(): void {
    this.navigation.abort()
  }

  /** Toggle the wide sidebar and the platform-selected compact rail. */
  toggleSidebar(): void {
    if (this.snapshot.narrow) {
      this.publish({ ...this.snapshot, narrowExpanded: !this.snapshot.narrowExpanded })
      return
    }
    this.publish({ ...this.snapshot, sidebar: this.snapshot.sidebar === 0 ? SIDEBAR_DEFAULT : 0 })
  }

  /** @param narrow - whether the frame is below the automatic-collapse breakpoint. */
  setNarrow(narrow: boolean): void {
    if (this.snapshot.narrow === narrow) return
    this.publish({ ...this.snapshot, narrow, narrowExpanded: false })
  }

  /** Open details at its default width. */
  openDetails(): void {
    if (this.snapshot.details === 0) this.publish({ ...this.snapshot, details: DETAILS_DEFAULT })
  }

  /** Close details while keeping its slot mounted. */
  closeDetails(): void {
    if (this.snapshot.details !== 0) this.publish({ ...this.snapshot, details: 0 })
  }

  /** Open the current session's rightbar using the upstream layout contract. */
  openRightbar(track: boolean, fullscreen: boolean): void {
    this.publish({
      ...this.snapshot,
      rightbar: this.snapshot.rightbar === 0 ? 640 : this.snapshot.rightbar,
      rightbarShown: true,
      rightbarTrack: track,
      rightbarFullscreen: fullscreen,
    })
  }

  /** Close the rightbar while keeping its mounted slot and width preference. */
  closeRightbar(): void {
    if (!this.snapshot.rightbarShown && !this.snapshot.rightbarTrack && !this.snapshot.rightbarFullscreen) return
    this.publish({ ...this.snapshot, rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false })
  }

  /** @param width - requested rightbar width from a resize gesture. */
  setRightbar(width: number): void {
    this.publish({ ...this.snapshot, rightbar: clamp(width, RIGHTBAR_MIN, RIGHTBAR_MAX) })
  }

  /** @param width - requested sidebar width from a resize gesture. */
  setSidebar(width: number): void {
    this.publish({ ...this.snapshot, sidebar: clamp(width, SIDEBAR_MIN, SIDEBAR_MAX) })
  }

  /** @param width - requested details width from a resize gesture. */
  setDetails(width: number): void {
    this.publish({ ...this.snapshot, details: clamp(width, DETAILS_MIN, DETAILS_MAX) })
  }

  private publish(next: DesktopLayoutSnapshot): void {
    this.snapshot = Object.freeze(next)
    for (const listener of this.listeners) listener()
  }
}
