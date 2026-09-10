import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from '../../../deepseek-harness/apps/web/node_modules/playwright/index.mjs'

const browserExecutable = process.env.DSH_AUDIT_BROWSER_EXECUTABLE
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const source = await readFile(new URL('../../../.ci/dsh-plugin-console/lib/client.js', import.meta.url), 'utf8')
const css = source.match(/const css = "([\s\S]*?)";/u)?.[1]
const cssOverrides = source.match(/const cssOverrides = "([\s\S]*?)";/u)?.[1]
assert(css && cssOverrides, 'Plugin Console CSS bundle is missing')

const rootVars = ':root{--dsw-alias-label-primary:#182230;--dsw-alias-label-secondary:#526070;--dsw-alias-label-tertiary:#6d7c8d;--dsw-alias-border-l2:#d7dde5;--dsw-alias-bg-base:#f4f7fb;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#eef3f8;--dsw-alias-bg-layer-3:#fff;--dsw-alias-state-business-primary:#2166e5;--dsw-alias-state-success-primary:#12805c;--dsw-alias-state-warn-primary:#a45b00;--dsw-alias-state-error-primary:#c43d46}:root[data-theme="dark"]{color-scheme:dark;--dsw-alias-label-primary:#f1f5f9;--dsw-alias-label-secondary:#aab4c0;--dsw-alias-label-tertiary:#83909e;--dsw-alias-border-l2:#38434f;--dsw-alias-bg-base:#101419;--dsw-alias-bg-layer-1:#171c22;--dsw-alias-bg-layer-2:#1e252d;--dsw-alias-bg-layer-3:#171c22;--dsw-alias-state-business-primary:#76a9ff;--dsw-alias-state-success-primary:#5bd6a2;--dsw-alias-state-warn-primary:#ffc266;--dsw-alias-state-error-primary:#ff8790}'
const fixture = `<style>${rootVars}body{margin:0;background:var(--dsw-alias-bg-base);font:13px system-ui;color:var(--dsw-alias-label-primary)}${css}${cssOverrides}</style><main class="pc_section"><h3>Plugin Console</h3><div class="pc_search"><input aria-label="Search plugins" value="knowledge"><button>Search</button></div><ul class="pc_list"><li class="pc_row"><div class="pc_rowTop"><strong class="pc_name">Knowledge</strong><span class="pc_tag" data-enabled="true">Enabled</span></div><p class="pc_desc">Knowledge plugin</p></li><li class="pc_row"><div class="pc_rowTop"><strong class="pc_name">Daily report</strong><span class="pc_tag">Installed</span></div><p class="pc_desc">Daily report plugin</p></li></ul><div class="pc_detail"><strong>Status</strong><p class="pc_status">Ready</p></div></main>`
const themes = [
  { name: 'light', background: 'rgb(255, 255, 255)', foreground: 'rgb(24, 34, 48)' },
  { name: 'dark', background: 'rgb(23, 28, 34)', foreground: 'rgb(241, 245, 249)' },
]

assert.match(source, /const cssOverrides = /u)
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
    const result = await page.locator('.pc_list').evaluate(list => ({
      columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
      rows: [...list.querySelectorAll('.pc_row')].map(row => ({
        radius: getComputedStyle(row).borderRadius,
        background: getComputedStyle(row).backgroundColor,
        color: getComputedStyle(row).color,
        width: Math.round(row.getBoundingClientRect().width),
        contentFits: row.scrollWidth <= row.clientWidth,
      })),
      scrollWidth: document.documentElement.scrollWidth,
    }))
    assert.equal(result.columns, viewport.width <= 640 ? 1 : 2)
    assert(result.rows.every(row => row.radius === '8px' && row.background === theme.background && row.color === theme.foreground && row.width <= viewport.width && row.contentFits))
    assert(result.scrollWidth <= viewport.width)
    await page.screenshot({ path: `/tmp/plugin-console-${theme.name}-${viewport.width}.png`, fullPage: true })
    await page.close()
  }
}
await browser.close()
console.log('plugin-console-browser: light/dark panel radius and grid contract verified at 320px, 390px, 768px, 1024px, and 1440px')
