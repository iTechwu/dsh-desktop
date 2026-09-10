import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'

const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const css = await readFile(new URL('../../../deepseek-harness/packages/client/ui-deliverables/src/client/Deliverables.module.css', import.meta.url), 'utf8')
const rootVars = ':root{--dsw-alias-label-primary:#182230;--dsw-alias-label-secondary:#526070;--dsw-alias-label-tertiary:#6d7c8d;--dsw-alias-label-dimmed:#9aa6b2;--dsw-alias-border-l1:#d7dde5;--dsw-alias-border-l2:#e4e9ef;--dsw-alias-border-l3:#d7dde5;--dsw-alias-bg-base:#f4f7fb;--dsw-alias-bg-layer-2:#eef3f8;--dsw-alias-state-error-primary:#c43d46;--dsw-alias-link:#2166e5;--dsw-alias-button-floating-fill:#fff;--dsw-alias-interactive-bg-hover:#e3eaf2;--dsw-alias-brand-primary:#2166e5}:root[data-theme="dark"]{color-scheme:dark;--dsw-alias-label-primary:#f1f5f9;--dsw-alias-label-secondary:#aab4c0;--dsw-alias-label-tertiary:#83909e;--dsw-alias-label-dimmed:#66717e;--dsw-alias-border-l1:#38434f;--dsw-alias-border-l2:#303a45;--dsw-alias-border-l3:#44505d;--dsw-alias-bg-base:#101419;--dsw-alias-bg-layer-2:#1e252d;--dsw-alias-state-error-primary:#ff8790;--dsw-alias-link:#76a9ff;--dsw-alias-button-floating-fill:#252d36;--dsw-alias-interactive-bg-hover:#29333e;--dsw-alias-brand-primary:#76a9ff}'
const fixture = `<style>${rootVars}body{margin:0;background:var(--dsw-alias-bg-base);font:13px system-ui;color:var(--dsw-alias-label-primary)}${css}</style><main class="root"><div class="hostStatus">Ready to present files</div><div class="presented"><article class="file"><button class="cardPreview" aria-label="Open report"></button><span class="fileIcon">PDF</span><div class="fileBody"><div class="details"><strong class="fileName">Quarterly report.pdf</strong><span class="description">Ready for preview</span></div><div class="split"><button class="open">Open</button><button class="chevron" aria-label="More actions">&#x2304;</button></div></div></article><article class="file"><button class="cardPreview" aria-label="Open brief"></button><span class="fileIcon">DOC</span><div class="fileBody"><div class="details"><strong class="fileName">Product brief.docx</strong><span class="description">Ready for preview</span></div><div class="split"><button class="open">Open</button><button class="chevron" aria-label="More actions">&#x2304;</button></div></div></article></div><button class="toggle">Show fewer files</button></main>`
const themes = [
  { name: 'light', background: 'rgb(238, 243, 248)', foreground: 'rgb(24, 34, 48)' },
  { name: 'dark', background: 'rgb(30, 37, 45)', foreground: 'rgb(241, 245, 249)' },
]

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
for (const viewport of [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 720 },
  { width: 1024, height: 720 },
  { width: 1440, height: 900 },
]) {
  for (const theme of themes) {
    const page = await browser.newPage({ viewport })
    await page.setContent(fixture)
    await page.evaluate(name => { document.documentElement.dataset.theme = name }, theme.name)
    await page.waitForTimeout(150)
    const result = await page.locator('.presented').evaluate(list => ({
      columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
      cards: [...list.querySelectorAll('.file')].map(card => ({
        radius: getComputedStyle(card).borderRadius,
        iconRadius: getComputedStyle(card.querySelector('.fileIcon')).borderRadius,
        splitRadius: getComputedStyle(card.querySelector('.split')).borderRadius,
        background: getComputedStyle(card).backgroundColor,
        color: getComputedStyle(card).color,
        width: Math.round(card.getBoundingClientRect().width),
      })),
      tokens: {
        documentLayer: getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-layer-2').trim(),
        componentLayer: getComputedStyle(list.closest('.root')).getPropertyValue('--dsw-alias-bg-layer-2').trim(),
        componentFill: getComputedStyle(list.closest('.root')).getPropertyValue('--deliverable-fill').trim(),
      },
      scrollWidth: document.documentElement.scrollWidth,
    }))
    assert.equal(result.columns, viewport.width <= 620 ? 1 : 2)
    assert(
      result.cards.every(card => card.radius === '8px' && card.iconRadius === '8px' && card.splitRadius === '8px' && card.background === theme.background && card.color === theme.foreground && card.width <= viewport.width),
      `delivery card theme/layout mismatch: ${JSON.stringify({ theme, viewport, result })}`,
    )
    assert(result.scrollWidth <= viewport.width)
    await page.screenshot({ path: `/tmp/dsh-deliverables-${theme.name}-${viewport.width}.png`, fullPage: true })
    await page.close()
  }
}
await browser.close()
console.log('deliverables-browser: light/dark delivery cards and shared 8px surface contract verified at 320px, 390px, 768px, 1024px, and 1440px')
