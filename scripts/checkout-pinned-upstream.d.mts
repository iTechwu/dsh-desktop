export interface WindowsWorkspaceLinkOptions {
  readonly platform?: NodeJS.Platform
  readonly link?: string
  readonly target?: string
}

export function materializeWindowsWorkspaceLink(
  options?: WindowsWorkspaceLinkOptions,
): boolean

export function main(): void
