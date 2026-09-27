/** Profile-relative package resolution for Electron's restricted Node runtime. */

import Module, { createRequire, registerHooks } from 'node:module'
import {
  ModuleLoader,
  type ModuleLoader as ModuleLoaderType,
  type ModuleRequest,
} from '@deepseek-ai/cordis-plugin-loader'
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  findOverlayPackage,
  packageNameFromSpecifier,
  resolveOverlayPackage,
  type PackageOverlaySource,
} from './package-overlay.ts'

const LOADER_ENTRY_URL = import.meta.resolve('@deepseek-ai/cordis-plugin-loader')
const DESKTOP_ENTRY_URL = pathToFileURL(
  fileURLToPath(new URL('../lib/index.js', import.meta.url)),
).href
const DESKTOP_PACKAGE_URL = pathToFileURL(
  fileURLToPath(new URL('../package.json', import.meta.url)),
).href

function internalModuleLoader(): ModuleLoaderType | undefined {
  if (process.execArgv.includes('--expose-internals')) {
    try {
      const require = createRequire(import.meta.url)
      const raw = require('internal/modules/esm/loader')?.getOrInitializeCascadedLoader() as ModuleLoaderType | undefined
      if (raw !== undefined && typeof (raw as { getOrCreateModuleJob?: unknown }).getOrCreateModuleJob === 'function') {
        return Object.assign(raw, { version: 'v2' as const })
      }
    } catch {
      // Fall through to the portable loader helper.
    }
  }
  return ModuleLoader.fromInternal()
}

interface CommonJsModuleResolver {
  _resolveFilename(
    request: string,
    parent: { filename?: string } | null | undefined,
    isMain: boolean | undefined,
    options?: unknown,
  ): string
}

function packageNameFromManifestSpecifier(specifier: string): string | undefined {
  const suffix = '/package.json'
  if (!specifier.endsWith(suffix)) return undefined
  const packageName = specifier.slice(0, -suffix.length)
  return packageNameFromSpecifier(packageName) === packageName ? packageName : undefined
}

/** Return whether a Loader request needs Node package resolution. */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !URL.canParse(specifier)
}

function isMissingModule(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | null)?.code
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
}

function canonicalFilename(filename: string): string {
  try {
    return realpathSync(filename)
  } catch {
    return resolve(filename)
  }
}

function isInsideDirectory(filename: string, directory: string): boolean {
  const path = relative(canonicalFilename(directory), canonicalFilename(filename))
  return path !== '' && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !isAbsolute(path)
}

/**
 * Resolve Cordis Loader bare imports from the selected persistent profile.
 * @param profileBaseUrl - file URL inside the profile that owns plugin dependencies.
 * @returns an idempotent hook disposer.
 */
export function installProfilePackageResolver(profileBaseUrl: string): () => void {
  const profileManifestPath = fileURLToPath(profileBaseUrl)
  const profileDirectory = canonicalFilename(dirname(profileManifestPath))
  const profileDirectoryUrl = new URL('./', profileBaseUrl).href
  const obsoleteSharedModulesDirectory = join(dirname(profileDirectory), 'node_modules')

  const isObsoleteSharedFallback = (url: string): boolean => {
    try {
      return isInsideDirectory(fileURLToPath(url), obsoleteSharedModulesDirectory)
    } catch {
      return false
    }
  }

  const canUseLinkedProfileDependency = (
    url: string,
    source: PackageOverlaySource | undefined,
    ownerParentURL: string | undefined,
  ): boolean => {
    if (source !== 'profile' || ownerParentURL === undefined || !isObsoleteSharedFallback(url)) return false
    try {
      return !isInsideDirectory(fileURLToPath(ownerParentURL), profileDirectory)
    } catch {
      return false
    }
  }

  // ClientModuleRegistry intentionally uses createRequire(ctx.baseUrl) to
  // resolve each browser bundle from the config tree. Node's ESM resolve hook
  // does not observe that CommonJS manifest lookup, so without this narrow
  // bridge the Loader can activate the Desktop copy while the browser receives
  // an older Profile copy of the same package. Intercept only exact package
  // manifests requested from this Profile anchor; every other CJS resolution
  // remains untouched.
  const commonJsModule = Module as unknown as CommonJsModuleResolver
  const previousResolveFilename = commonJsModule._resolveFilename
  const commonJsModuleSources = new Map<string, PackageOverlaySource>()
  const profileResolve = createRequire(profileBaseUrl).resolve
  const installResolve = createRequire(DESKTOP_PACKAGE_URL).resolve
  const overlayResolveFilename: CommonJsModuleResolver['_resolveFilename'] = function (
    this: CommonJsModuleResolver,
    request,
    parent,
    isMain,
    options,
  ) {
    // ClientModuleRegistry creates its resolver from the active config-tree
    // anchor (normally cordis.yml), while other profile consumers use the
    // package.json anchor. Keep the bridge scoped to direct files in the exact
    // active Profile directory so both faces select the same overlay without
    // exposing Desktop packages to unrelated CommonJS modules.
    const parentFilename = parent?.filename
    const fromProfileAnchor = parentFilename !== undefined
      && canonicalFilename(dirname(parentFilename)) === profileDirectory
    const packageName = fromProfileAnchor ? packageNameFromSpecifier(request) : undefined
    if (packageName !== undefined) {
      const overlay = findOverlayPackage(packageName, {
        installPackageUrl: DESKTOP_PACKAGE_URL,
        profilePackageUrl: profileBaseUrl,
      })
      if (overlay !== undefined) {
        if (packageNameFromManifestSpecifier(request) === packageName) {
          return overlay.selected.manifestPath
        }
        const resolved = overlay.selected.source === 'install'
          ? installResolve(request)
          : previousResolveFilename.call(this, request, parent, isMain, options)
        commonJsModuleSources.set(canonicalFilename(resolved), overlay.selected.source)
        return resolved
      }
    }
    const parentSource = parentFilename === undefined
      ? undefined
      : commonJsModuleSources.get(canonicalFilename(parentFilename))
    if (parentSource === undefined) {
      return previousResolveFilename.call(this, request, parent, isMain, options)
    }
    if (!isBareSpecifier(request)) {
      const resolved = previousResolveFilename.call(this, request, parent, isMain, options)
      if (request.startsWith('.')) commonJsModuleSources.set(canonicalFilename(resolved), parentSource)
      return resolved
    }
    let lastCause: unknown = new Error(
      `dsh-plugin-desktop: ignored obsolete shared Profile fallback for ${JSON.stringify(request)}`,
    )
    try {
      const resolved = previousResolveFilename.call(this, request, parent, isMain, options)
      if (!isInsideDirectory(resolved, obsoleteSharedModulesDirectory)) {
        commonJsModuleSources.set(canonicalFilename(resolved), parentSource)
        return resolved
      }
    } catch (cause) {
      if (!isMissingModule(cause)) throw cause
      lastCause = cause
    }
    for (const resolvePackage of [profileResolve, installResolve]) {
      try {
        const resolved = resolvePackage(request)
        if (isInsideDirectory(resolved, obsoleteSharedModulesDirectory)) continue
        commonJsModuleSources.set(canonicalFilename(resolved), parentSource)
        return resolved
      } catch (fallbackCause) {
        if (!isMissingModule(fallbackCause)) throw fallbackCause
        lastCause = fallbackCause
      }
    }
    throw lastCause
  }
  commonJsModule._resolveFilename = overlayResolveFilename

  // Track the module graph rooted at every overlay-selected Loader package.
  const overlayModuleUrls = new Set<string>()
  const overlayModuleSources = new Map<string, PackageOverlaySource>()
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      // Cordis' internal ModuleLoader deliberately performs top-level imports
      // with the config tree's base URL as their parent. Keep the Loader entry
      // URL for the native dynamic-import fallback, and recognize the Profile
      // manifest anchor used by Electron's internal loader as the same boundary.
      const fromLoader = context.parentURL === LOADER_ENTRY_URL
        || context.parentURL === profileBaseUrl
        || context.parentURL === profileDirectoryUrl
      const packageName = fromLoader ? packageNameFromSpecifier(specifier) : undefined
      if (packageName !== undefined) {
        const overlay = resolveOverlayPackage(packageName, {
          installPackageUrl: DESKTOP_PACKAGE_URL,
          profilePackageUrl: profileBaseUrl,
        })
        const resolved = nextResolve(specifier, {
          ...context,
          parentURL: overlay.selected.source === 'profile' ? profileBaseUrl : DESKTOP_ENTRY_URL,
        })
        overlayModuleUrls.add(resolved.url)
        overlayModuleSources.set(resolved.url, overlay.selected.source)
        return resolved
      }
      if (context.parentURL === undefined || !overlayModuleUrls.has(context.parentURL)) {
        return nextResolve(specifier, context)
      }
      if (!isBareSpecifier(specifier)) {
        const resolved = nextResolve(specifier, context)
        if (specifier.startsWith('.')) overlayModuleUrls.add(resolved.url)
        return resolved
      }
      const source = overlayModuleSources.get(context.parentURL)
      const ownerParentURL = context.parentURL
      let lastCause: unknown = new Error(
        `dsh-plugin-desktop: ignored obsolete shared Profile fallback for ${JSON.stringify(specifier)}`,
      )
      try {
        const resolved = nextResolve(specifier, context)
        if (!isObsoleteSharedFallback(resolved.url)
          || canUseLinkedProfileDependency(resolved.url, source, ownerParentURL)) {
          overlayModuleUrls.add(resolved.url)
          if (source !== undefined) overlayModuleSources.set(resolved.url, source)
          return resolved
        }
      } catch (cause) {
        if (!isMissingModule(cause)) throw cause
        lastCause = cause
      }
      // Profile plugins commonly declare DSH packages as peers. Their private
      // node_modules may contain only the plugin itself, so use the installed
      // Desktop graph as the final fallback after excluding legacy shared links.
      for (const parentURL of [profileBaseUrl, DESKTOP_ENTRY_URL]) {
        try {
          const resolved = nextResolve(specifier, { ...context, parentURL })
          if (isObsoleteSharedFallback(resolved.url)
            && !canUseLinkedProfileDependency(resolved.url, source, ownerParentURL)) continue
          overlayModuleUrls.add(resolved.url)
          if (source !== undefined) overlayModuleSources.set(resolved.url, source)
          return resolved
        } catch (fallbackCause) {
          if (!isMissingModule(fallbackCause)) throw fallbackCause
          lastCause = fallbackCause
        }
      }
      throw lastCause
    },
  })
  let active = true
  return () => {
    if (!active) return
    active = false
    hooks.deregister()
    if (commonJsModule._resolveFilename === overlayResolveFilename) {
      commonJsModule._resolveFilename = previousResolveFilename
    }
  }
}

/**
 * Give 0.1.7 client-module graph discovery a Desktop resolver. Node internal
 * resolution from an isolated Profile can miss workspace-owned client bundles;
 * fall back once to the installed Desktop graph before classifying a row as
 * non-client.
 */
export function desktopInternalModuleLoader(): ModuleLoaderType | undefined {
  const internal = internalModuleLoader()
  if (internal === undefined) return undefined
  // Node 22 exposes the v1 internal loader. It already has the public API HMR
  // needs; only v2 receives the Desktop-graph resolve fallback below.
  if (internal.version !== 'v2') return internal
  const wrapped = Object.create(internal) as ModuleLoaderType
  return Object.assign(wrapped, {
    version: 'v2' as const,
    import: internal.import.bind(internal),
    register: internal.register.bind(internal),
    getOrCreateModuleJob: internal.getOrCreateModuleJob.bind(internal),
    load: internal.load.bind(internal),
    resolveSync: (parentURL: string, request: ModuleRequest) => {
      try {
        return internal.resolveSync.call(internal, parentURL, request)
      } catch {
        return internal.resolveSync.call(internal, DESKTOP_ENTRY_URL, request)
      }
    },
  })
}
