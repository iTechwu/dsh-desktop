import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadBrandConfig,
  renderBuilderConfig,
  renderIdentityModule,
  resolveActiveChannel,
  resolveBrandConfigPath,
  validateBrandConfig,
} from './brand-config.mjs'

/** Minimal valid configuration used as the mutation base in each case. */
const validConfig = {
  activeChannel: 'beta',
  channels: {
    stable: { productName: 'Alpha', appId: 'ai.example.agent', artifactPrefix: 'Alpha' },
    beta: { productName: 'Alpha Beta', appId: 'ai.example.agent.beta', artifactPrefix: 'Alpha-Beta' },
  },
  packageName: 'dsh-plugin-desktop',
  displayName: { titlebar: 'Alpha', locale: 'Alpha' },
  artwork: {
    appIconSource: 'brand/assets/app-icon-source.jpg',
    sidebarMark: 'brand/assets/sidebar-mark.png',
    heroMark: 'brand/assets/hero-mark.png',
    whiteThreshold: 235,
    iconSize: 1024,
    macIcon: { canvas: 1024, artwork: 824 },
  },
  wordmark: {
    image: 'brand/assets/wordmark.png',
    text: { zh: '示例AI', en: 'Example AI' },
    color: '#0F172A',
    fontFile: 'brand/assets/wordmark-font/Example.ttf',
    lockup: { width: 2537, height: 457 },
    display: { width: 200, height: 36 },
  },
  updates: {
    endpoint: 'https://updates.example.com/api/desktop/version',
    versionHeader: 'X-Example-Version',
    channelHeader: 'X-Example-Channel',
  },
  docs: {
    siteUrl: 'https://example.com',
    downloadBase: 'https://example.com/api/downloads',
    repoUrl: 'https://github.com/example/desktop',
    communityName: { zh: '示例桌面', en: 'Example Desktop' },
    maintainer: { zh: '示例维护团队', en: 'Example maintainers' },
    noticesHeader: 'Alpha distributes the following third-party packages.',
  },
  nsis: { shortcutName: 'Alpha Beta' },
}

test('accepts the committed brand configuration', () => {
  assert.deepEqual(validateBrandConfig(validConfig), [])
})

test('collects every violation with the field path', () => {
  const violations = validateBrandConfig({
    ...validConfig,
    activeChannel: 'nightly',
    channels: {
      ...validConfig.channels,
      beta: { ...validConfig.channels.beta, appId: 'not-an-app-id', artifactPrefix: 'a/b' },
    },
    artwork: { ...validConfig.artwork, whiteThreshold: 999 },
    updates: { ...validConfig.updates, versionHeader: 'VERSION', endpoint: 'http://insecure.example.com' },
    wordmark: { ...validConfig.wordmark, color: 'blue' },
  })
  assert.equal(violations.length, 7)
  for (const violation of violations) {
    assert.match(violation, /beta\.|activeChannel|artwork\.|updates\.|wordmark\./)
  }
})

test('rejects a non-object document', () => {
  assert.deepEqual(validateBrandConfig(null), ['brand.config.json: the top level must be an object'])
})

test('resolveActiveChannel returns the selected channel identity', () => {
  assert.equal(resolveActiveChannel(validConfig).appId, 'ai.example.agent.beta')
})

test('BRAND_CONFIG override redirects the loader', () => {
  const path = resolveBrandConfigPath({ BRAND_CONFIG: 'other/brand.json' }, '/repo')
  assert.equal(path, '/repo/other/brand.json')
  assert.match(resolveBrandConfigPath({}), /brand\/brand\.config\.json$/)
})

test('loadBrandConfig reports a missing file with its resolved path', () => {
  assert.throws(() => loadBrandConfig({ BRAND_CONFIG: 'brand/does-not-exist.json' }), /brand config is missing/)
})

test('identity module renders the active channel and frozen tables', () => {
  const module = renderIdentityModule(validConfig)
  assert.match(module, /Do not edit directly/)
  assert.match(module, /BRAND_ACTIVE_CHANNEL = "beta"/)
  assert.match(module, /productName: "Alpha Beta"/)
  assert.match(module, /BRAND_ARTIFACT_PREFIX = "Alpha-Beta"/)
  assert.match(module, /endpoint: "https:\/\/updates\.example\.com\/api\/desktop\/version"/)
  assert.match(module, /versionHeader: "X-Example-Version"/)
})

test('builder config renders brand fields over the static base', () => {
  const base = {
    asar: { smartUnpack: true },
    directories: { output: 'dist' },
    win: { icon: 'build/app-icon.ico', artifactName: 'REMOVED' },
    nsis: { shortcutName: 'REMOVED', artifactName: 'REMOVED', license: 'THIRD_PARTY_NOTICES.md' },
  }
  const rendered = renderBuilderConfig(validConfig, base)
  assert.equal(rendered.appId, 'ai.example.agent.beta')
  assert.equal(rendered.productName, 'Alpha Beta')
  assert.equal(rendered.asar.smartUnpack, true)
  assert.equal(rendered.win.icon, 'build/app-icon.ico')
  assert.equal(rendered.win.artifactName, 'Alpha-Beta-${version}-${arch}-Portable.${ext}')
  assert.equal(rendered.nsis.shortcutName, 'Alpha Beta')
  assert.equal(rendered.nsis.artifactName, 'Alpha-Beta-${version}-${arch}-Setup.${ext}')
  assert.equal(rendered.nsis.license, 'THIRD_PARTY_NOTICES.md')
})

test('switching activeChannel switches the rendered identity only', () => {
  const stableOnly = {
    ...validConfig,
    activeChannel: 'stable',
  }
  assert.equal(resolveActiveChannel(stableOnly).productName, 'Alpha')
  const module = renderIdentityModule(stableOnly)
  assert.match(module, /BRAND_ACTIVE_CHANNEL = "stable"/)
  assert.match(module, /BRAND_ARTIFACT_PREFIX = "Alpha"/)
})
