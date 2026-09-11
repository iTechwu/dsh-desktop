/** Private RunAsNode bootstrap for the packaged DeepSeek Harness CLI. */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
import { assertDesktopProfileName } from './profile-manager.ts'
import { withoutForwardedDesktopPnpmPolicy } from './pnpm-policy.ts'
import { installProfilePackageResolver } from './module-resolution.ts'
import { withAsarModuleResolver } from './asar-module-resolver-state.ts'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const DEFAULT_PROFILE = 'DSH_DESKTOP_DEFAULT_PROFILE'
const DSH_ENTRY_URL = pathToFileURL(
  packagedDependencyPath(import.meta.url, '@deepseek-ai/dsh/lib/bin.js'),
).href

function readDshVersion(): string {
  const manifest = JSON.parse(
    readFileSync(packagedDependencyPath(import.meta.url, '@deepseek-ai/dsh/package.json'), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

export function clearElectronRunAsNode(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === RUN_AS_NODE) delete environment[key]
  }
}

export function withDefaultDesktopProfile(argv: readonly string[], profileName: string): string[] {
  assertDesktopProfileName(profileName)
  if (argv.some(argument => argument === '--profile' || argument.startsWith('--profile='))) return [...argv]
  const first = argv[0]
  if (first === 'web' || first === '--help' || first === '-h' || first === '--version' || first === '-V') {
    return [...argv]
  }
  if (first === 'plugin') return ['plugin', '--profile', profileName, ...argv.slice(1)]
  return ['--profile', profileName, ...argv]
}

function takeDefaultProfile(environment: NodeJS.ProcessEnv): string | undefined {
  let profileName: string | undefined
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() !== DEFAULT_PROFILE) continue
    const value = environment[key]
    if (value !== undefined && profileName !== undefined && value !== profileName) {
      throw new Error('dsh-desktop: conflicting default profile environment values')
    }
    profileName ??= value
    delete environment[key]
  }
  return profileName
}

/** Return the Profile selected by one normalized DSH invocation. */
export function selectedDesktopCliProfile(argv: readonly string[]): string | undefined {
  if (argv[0] === 'web') return 'web'
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--profile') {
      const profile = argv[index + 1]
      if (profile !== undefined && profile.length > 0) return profile
    }
    if (argument?.startsWith('--profile=') === true) {
      const profile = argument.slice('--profile='.length)
      if (profile.length > 0) return profile
    }
  }
  return undefined
}

/** Resolve one CLI Profile through the official home/profile path contract. */
export function desktopCliProfileManifestUrl(
  profileName: string,
  environment: NodeJS.ProcessEnv,
): string {
  const home = resolveDshHome(undefined, environment)
  const profileRoot = join(home, 'profiles')
  const profileDirectory = resolveProfileDir(profileName, home)
  // resolveProfileDir currently rejects separators. Retain this containment
  // check at the Desktop process boundary so an upstream contract regression
  // cannot turn a CLI flag into an arbitrary module-resolution anchor.
  if (dirname(profileDirectory) !== profileRoot) {
    throw new Error(`dsh-desktop: unsafe CLI profile path for ${JSON.stringify(profileName)}`)
  }
  return pathToFileURL(join(profileDirectory, 'package.json')).href
}

/**
 * Enter the packaged DSH CLI without any plugin-install transaction wrapper.
 * Manual plugin commands and Market operations rely on unified checkpoints.
 */
export async function runDesktopDshCli(
  environment: NodeJS.ProcessEnv = process.env,
  load: (url: string) => Promise<{ runCli(): Promise<void> }> = url => import(url),
  argv: string[] = process.argv,
  packagedEntry: boolean = /([\\/])app\.asar\1/u.test(fileURLToPath(DSH_ENTRY_URL)),
): Promise<void> {
  const profileName = takeDefaultProfile(environment)
  clearElectronRunAsNode(environment)
  const selected = profileName === undefined
    ? argv.slice(2)
    : withDefaultDesktopProfile(argv.slice(2), profileName)
  argv.splice(2, argv.length - 2, ...withoutForwardedDesktopPnpmPolicy(selected))
  if (selected.length === 1 && (selected[0] === '--version' || selected[0] === '-V')) {
    process.stdout.write(`${readDshVersion()}\n`)
    return
  }
  const selectedProfile = selectedDesktopCliProfile(argv.slice(2))
  const releaseResolver = selectedProfile !== undefined
    && packagedEntry
    ? installProfilePackageResolver(desktopCliProfileManifestUrl(selectedProfile, environment))
    : undefined
  // The upstream bin only auto-runs when it is the process entry. Desktop
  // imports it from this separate bootstrap after clearing RunAsNode, so it
  // must explicitly dispatch the exported CLI under the same ASAR scope.
  const runDsh = async (): Promise<void> => {
    const cli = await load(DSH_ENTRY_URL)
    await cli.runCli()
  }
  const invokeDsh = (): Promise<void> => packagedEntry
    ? withAsarModuleResolver(runDsh)
    : runDsh()
  // The CLI settles once a long-lived Profile is ready;
  // later HMR and Loader imports still need the same process-wide resolver.
  // Keep it until process exit rather than treating CLI settlement as app
  // shutdown. A packaged CLI process owns exactly one Profile invocation.
  if (releaseResolver === undefined) {
    await invokeDsh()
    return
  }
  const releaseAtExit = (): void => { releaseResolver() }
  process.once('exit', releaseAtExit)
  try {
    await invokeDsh()
  } catch (cause) {
    process.off('exit', releaseAtExit)
    releaseResolver()
    throw cause
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && fileURLToPath(import.meta.url) === entry
}

if (isDirectExecution()) {
  void runDesktopDshCli().catch((cause: unknown) => {
    process.stderr.write(`dsh-desktop: failed to start packaged dsh: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
}
