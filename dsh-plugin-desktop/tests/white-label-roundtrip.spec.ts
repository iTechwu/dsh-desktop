/** End-to-end proof that one brand config yields a rebranded build surface. */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

function spawnIdentityGenerator(configPath: string, outputs: { identityModule: string; builderConfig: string }): void {
  execFileSync(process.execPath, [join(packageRoot, 'scripts', 'generate-product-identity.mjs')], {
    env: {
      ...process.env,
      BRAND_CONFIG: configPath,
      BRAND_OUTPUT_IDENTITY: outputs.identityModule,
      BRAND_OUTPUT_BUILDER: outputs.builderConfig,
    },
    cwd: packageRoot,
    stdio: 'pipe',
  })
}

describe('white-label round trip', () => {
  it('renders a mutated brand config into a full rebranded build surface', () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'white-label-roundtrip-'))
    try {
      const configPath = join(workRoot, 'brand.config.json')
      writeFileSync(configPath, JSON.stringify({
        activeChannel: 'beta',
        tenant: 'acme',
        tenantId: '22222222-2222-4222-8222-222222222222',
        channels: {
          stable: { productName: 'Acme Agent', appId: 'com.acme.agent', artifactPrefix: 'Acme-Agent', homeDirectoryName: '.acme-agent' },
          beta: { productName: 'Acme Agent Beta', appId: 'com.acme.agent.beta', artifactPrefix: 'Acme-Agent-Beta', homeDirectoryName: '.acme-agent-beta' },
        },
        packageName: 'dsh-plugin-desktop',
        displayName: { titlebar: 'Acme Agent', locale: 'Acme Agent' },
        artwork: {
          appIconSource: 'brand/assets/app-icon-source.jpg',
          sidebarMark: 'brand/assets/sidebar-mark.png',
          heroMark: 'brand/assets/hero-mark.png',
          whiteThreshold: 200,
          iconSize: 1024,
          heroSize: 204,
          macIcon: { canvas: 1024, artwork: 824 },
        },
        wordmark: {
          image: 'brand/assets/wordmark.png',
          text: { zh: 'Acme AI', en: 'Acme AI' },
          color: '#112233',
          fontFile: 'brand/assets/wordmark-font/Acme.ttf',
          lockup: { width: 2537, height: 457 },
          display: { width: 200, height: 36 },
        },
        updates: {
          endpoint: 'https://updates.acme.example/api/desktop/version',
          versionHeader: 'X-Acme-Version',
          channelHeader: 'X-Acme-Channel',
        },
        docs: {
          siteUrl: 'https://acme.example',
          downloadBase: 'https://acme.example/api/downloads',
          repoUrl: 'https://github.com/acme/desktop',
          communityName: { zh: 'Acme 桌面', en: 'Acme Desktop' },
          maintainer: { zh: 'Acme 维护团队', en: 'Acme maintainers' },
          noticesHeader: 'Acme Agent distributes the following third-party packages inside its installers.',
        },
        nsis: { shortcutName: 'Acme Agent Beta' },
      }, null, 2))

      const outputs = {
        identityModule: join(workRoot, 'generated-product-identity.ts'),
        builderConfig: join(workRoot, 'electron-builder.json'),
      }
      spawnIdentityGenerator(configPath, outputs)

      const identity = readFileSync(outputs.identityModule, 'utf8')
      expect(identity).toContain('productName: "Acme Agent Beta"')
      expect(identity).toContain('appId: "com.acme.agent.beta"')
      expect(identity).toContain('BRAND_TENANT = "acme"')
      expect(identity).toContain('BRAND_TENANT_ID = "22222222-2222-4222-8222-222222222222"')
      expect(identity).toContain('BRAND_ARTIFACT_PREFIX = "Acme-Agent-Beta"')
      expect(identity).toContain('BRAND_SHORTCUT_NAME = "Acme Agent Beta"')
      expect(identity).toContain('titlebar: "Acme Agent"')
      expect(identity).toContain('endpoint: "https://updates.acme.example/api/desktop/version"')
      expect(identity).toContain('versionHeader: "X-Acme-Version"')
      expect(identity).toContain('channelHeader: "X-Acme-Channel"')
      expect(identity).not.toMatch(/Yootun/)

      const builder = JSON.parse(readFileSync(outputs.builderConfig, 'utf8')) as {
        appId?: string
        productName?: string
        win?: { artifactName?: string; icon?: string }
        nsis?: { shortcutName?: string; artifactName?: string }
      }
      expect(builder.appId).toBe('com.acme.agent.beta')
      expect(builder.productName).toBe('Acme Agent Beta')
      expect(builder.win?.artifactName).toBe('Acme-Agent-Beta-${version}-${arch}-Portable.${ext}')
      expect(builder.nsis?.shortcutName).toBe('Acme Agent Beta')
      expect(builder.nsis?.artifactName).toBe('Acme-Agent-Beta-${version}-${arch}-Setup.${ext}')
      // Non-brand packaging policy survives the rebrand untouched.
      expect(builder.win?.icon).toBe('build/app-icon.ico')
    } finally {
      rmSync(workRoot, { recursive: true, force: true })
    }
  })
})
