import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'

const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const css = await readFile(new URL('../../../deepseek-harness/packages/client/ui-deliverables/src/client/Deliverables.module.css', import.meta.url), 'utf8')
const rootVars = ':root{--dsw-alias-label-primary:#182230;--dsw-alias-label-secondary:#526070;--dsw-alias-label-tertiary:#6d7c8d;--dsw-alias-label-dimmed:#9aa6b2;--dsw-alias-border-l1:#d7dde5;--dsw-alias-border-l2:#e4e9ef;--dsw-alias-border-l3:#d7dde5;--dsw-alias-bg-base:#f4f7fb;--dsw-alias-bg-layer-2:#eef3f8;--dsw-alias-state-error-primary:#c43d46;--dsw-alias-link:#2166e5;--dsw-alias-button-floating-fill:#fff;--dsw-alias-interactive-bg-hover:#e3eaf2;--dsw-alias-brand-primary:#2166e5}'
const fixture = `<style>${rootVars}body{margin:0;background:var(--dsw-alias-bg-base);font:13px system-ui;color:var(--dsw-alias-label-primary)}${css}</style><main class="root"><div class="hostStatus">Ready to present files</div><div class="presented"><article class="file"><button class="cardPreview" aria-label="Open report"></button><span class="fileIcon">PDF</span><div class="fileBody"><div class="details"><strong class="fileName">Quarterly report.pdf</strong><span class="description">Ready for preview</span></div><div class="split"><button class="open">Open</button><button class="chevron" aria-label="More actions">&#x2304;</button></div></div></article><article class="file"><button class="cardPreview" aria-label="Open brief"></button><span class="fileIcon">DOC</span><div class="fileBody"><div class="details"><strong class="fileName">Product brief.docx</strong><span class="description">Ready for preview</span></div><div class="split"><button class="open">Open</button><button class="chevron" aria-label="More actions">&#x2304;</button></div></div></article></div><button class="toggle">Show fewer files</button></main>`

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
for (const viewport of [
  { width: 320, height: 720 },
  { width: 390, height: 844 },
  { width: 768, height: 720 },
  { width: 1024, height: 720 },
  { width: 1440, height: 900 },
]) {
  const page = await browser.newPage({ viewport })
  await page.setContent(fixture)
  const result = await page.locator('.presented').evaluate(list => ({
    columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
    cards: [...list.querySelectorAll('.file')].map(card => ({
      radius: getComputedStyle(card).borderRadius,
      iconRadius: getComputedStyle(card.querySelector('.fileIcon')).borderRadius,
      splitRadius: getComputedStyle(card.querySelector('.split')).borderRadius,
      width: Math.round(card.getBoundingClientRect().width),
    })),
    scrollWidth: document.documentElement.scrollWidth,
  }))
  assert.equal(result.columns, viewport.width <= 620 ? 1 : 2)
  assert(result.cards.every(card => card.radius === '8px' && card.iconRadius === '8px' && card.splitRadius === '8px' && card.width <= viewport.width))
  assert(result.scrollWidth <= viewport.width)
  await page.screenshot({ path: `/tmp/dsh-deliverables-${viewport.width}.png`, fullPage: true })
  await page.close()
}
await browser.close()
console.log('deliverables-browser: responsive delivery cards and shared 8px surface contract verified at 320px, 390px, 768px, 1024px, and 1440px')
