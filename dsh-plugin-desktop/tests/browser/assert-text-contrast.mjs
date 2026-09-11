import assert from 'node:assert/strict'

/** Measure rendered sRGB text, including color-mix() and translucent surfaces. */
export async function assertTextContrast(page, selector) {
  const readings = await page.locator(selector).evaluateAll(elements => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const parse = color => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const rgba = [...context.getImageData(0, 0, 1, 1).data]
      return [...rgba.slice(0, 3), rgba[3] / 255]
    }
    const blend = (front, back) => [...front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3])), 1]
    const luminance = rgb => rgb.slice(0, 3).map(v => v / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
    return elements.flatMap(element => {
      const style = getComputedStyle(element)
      if (!element.getClientRects().length || style.visibility !== 'visible' || !element.textContent.trim()) return []
      const chain = []
      for (let node = element; node; node = node.parentElement) {
        const current = getComputedStyle(node)
        // Disabled/loading surfaces are checked once the interaction settles.
        if (Number(current.opacity) < 1) return []
        if (current.backgroundImage !== 'none') return [{ text: element.textContent.trim(), unsupportedBackground: current.backgroundImage }]
        chain.unshift(parse(current.backgroundColor))
      }
      const background = chain.reduce((back, front) => blend(front, back), [255, 255, 255, 1])
      const foreground = blend(parse(element instanceof SVGElement ? style.fill : style.color), background)
      const a = luminance(foreground), b = luminance(background)
      return [{
        text: element.textContent.trim().slice(0, 120),
        className: element.className,
        ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
      }]
    })
  })
  const failures = readings.filter(reading => reading.unsupportedBackground || reading.ratio < 4.5)
  assert.deepEqual(failures, [], `rendered text must meet 4.5:1 contrast: ${JSON.stringify(failures)}`)
  return readings
}
