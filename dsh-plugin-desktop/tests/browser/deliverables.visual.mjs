import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'

const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const moduleCss = await readFile(new URL('../../../deepseek-harness/packages/client/ui-deliverables/src/client/Deliverables.module.css', import.meta.url), 'utf8')
const themeCss = await readFile(new URL('../../../deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css', import.meta.url), 'utf8')
// Retain local class names but unwrap the CSS Modules global body selector.
const css = moduleCss.replaceAll(':global(body[data-ds-dark-theme])', 'body[data-ds-dark-theme]')
const fixture = `<style>${themeCss}body{margin:0;background:var(--dsw-alias-bg-base);font:13px system-ui;color:var(--dsw-alias-label-primary)}${css}</style><main class="root"><div class="hostStatus">Ready to present files</div><div class="presented"><article class="file"><button class="cardPreview" aria-label="Open report"></button><span class="fileIcon">PDF</span><div class="fileBody"><div class="details"><strong class="fileName">Quarterly report.pdf</strong><span class="description">Ready for preview</span></div><div class="split"><button class="open">Open</button><button class="chevron" aria-label="More actions">&#x2304;</button></div></div></article><article class="file"><button class="cardPreview" aria-label="Open brief"></button><span class="fileIcon">DOC</span><div class="fileBody"><div class="details"><strong class="fileName">Product brief.docx</strong><span class="description">Ready for preview</span></div><div class="split"><button class="open">Open</button><button class="chevron" aria-label="More actions">&#x2304;</button></div></div></article></div><button class="toggle">Show fewer files</button></main>`
const themes = [
  { name: 'light', background: 'rgb(250, 250, 250)', foreground: 'rgb(15, 17, 21)' },
  { name: 'dark', background: 'rgb(33, 33, 35)', foreground: 'rgb(249, 250, 251)' },
]

const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
try {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 720 },
    { width: 1024, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport })
    await page.setContent(fixture)
    for (const theme of [...themes, themes[0]]) {
      await page.evaluate(name => {
        document.body.toggleAttribute('data-ds-dark-theme', name === 'dark')
        document.documentElement.style.colorScheme = name
      }, theme.name)
      // Wait for the actual background transition, including the return to light.
      await page.waitForFunction(background => [...document.querySelectorAll('.file')]
        .every(card => getComputedStyle(card).backgroundColor === background), theme.background)
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
        scrollWidth: document.documentElement.scrollWidth,
      }))
      assert.equal(result.columns, viewport.width <= 620 ? 1 : 2)
      assert.equal(result.cards.length, 2)
      assert(
        result.cards.every(card => card.radius === '18px' && card.iconRadius === '10px' && card.splitRadius === '10px' && card.background === theme.background && card.color === theme.foreground && card.width <= viewport.width),
        `delivery card theme/layout mismatch: ${JSON.stringify({ theme, viewport, result })}`,
      )
      assert(result.scrollWidth <= viewport.width)
      await page.screenshot({ path: `/tmp/dsh-deliverables-${theme.name}-${viewport.width}.png`, fullPage: true })
    }
    await page.close()
  }
} finally {
  await browser.close()
}
console.log('deliverables-browser: upstream 18px cards, 10px controls, and live light/dark/light theme switching verified at 320px, 390px, 768px, 1024px, and 1440px')
