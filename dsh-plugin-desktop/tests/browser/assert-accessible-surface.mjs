import assert from 'node:assert/strict'

export async function assertAccessibleSurface(page, { requireModal = true } = {}) {
  const result = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const accessibleName = element => {
      const direct = element.getAttribute('aria-label')?.trim()
      if (direct) return direct
      const labelledBy = element.getAttribute('aria-labelledby')?.trim().split(/\s+/u)
        .map(id => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean).join(' ')
      if (labelledBy) return labelledBy
      const labels = [...(element.labels || [])].map(label => label.textContent?.trim() || '').filter(Boolean).join(' ')
      if (labels) return labels
      if (element.matches('button,a[href]')) return element.textContent?.trim() || element.getAttribute('title')?.trim() || ''
      if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) return element.value.trim()
      return element.getAttribute('title')?.trim() || ''
    }
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible)
    const scope = dialogs.at(-1) || document
    const controls = [...scope.querySelectorAll('button,input,select,textarea,a[href]')].filter(visible)
    const ids = [...scope.querySelectorAll('[id]')].map(element => element.id).filter(Boolean)
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      modalCount: dialogs.filter(dialog => dialog.getAttribute('aria-modal') === 'true').length,
      unnamedControls: controls.filter(control => !accessibleName(control)).map(control => control.outerHTML.slice(0, 180)),
      unnamedDialogs: dialogs.slice(-1).filter(dialog => !accessibleName(dialog)).map(dialog => dialog.outerHTML.slice(0, 180)),
      duplicateIds,
    }
  })
  assert.equal(result.scrollWidth, result.clientWidth, 'page must not scroll horizontally')
  if (requireModal) assert(result.modalCount > 0, 'overlay must expose modal dialog semantics')
  assert.deepEqual(result.unnamedControls, [], `visible controls must have accessible names: ${JSON.stringify(result.unnamedControls)}`)
  assert.deepEqual(result.unnamedDialogs, [], `dialogs must have accessible names: ${JSON.stringify(result.unnamedDialogs)}`)
  assert.deepEqual(result.duplicateIds, [], `rendered surface must not contain duplicate ids: ${JSON.stringify(result.duplicateIds)}`)
  return result
}
