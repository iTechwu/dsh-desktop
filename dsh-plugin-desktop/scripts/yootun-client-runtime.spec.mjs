import assert from 'node:assert/strict'
import test from 'node:test'

import { smokeYootunClientBundle } from './yootun-client-runtime.mjs'

function bundle(id, applyBody) {
  return `window.__ModuleLoader__.load({
    id: ${JSON.stringify(id)},
    factory: () => ({
      apply(ctx) { ${applyBody} },
      inject: ['slots', 'locale'],
    }),
  })`
}

test('executes client effects and slot registrations', async () => {
  const pluginId = '@dofe/dsh-yootun-fixture'
  const result = await smokeYootunClientBundle({
    pluginId,
    clientPath: '/virtual/yootun-fixture/client.js',
    source: bundle(pluginId, `
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = '.fixture{display:block}'
        document.head.appendChild(style)
        return () => style.remove()
      }, 'fixture styles')
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay' }, () => null))
    `),
  })

  assert.deepEqual(result.effects, ['fixture styles'])
  assert.deepEqual(result.slots, ['shell.overlay'])
  assert.deepEqual(result.styles, ['.fixture{display:block}'])
})

test('reports an undefined value inside an apply effect with plugin context', async () => {
  const pluginId = '@dofe/dsh-yootun-broken'
  await assert.rejects(
    smokeYootunClientBundle({
      pluginId,
      clientPath: '/virtual/yootun-broken/client.js',
      source: bundle(pluginId, `
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = missingCss
          document.head.appendChild(style)
        }, 'broken styles')
      `),
    }),
    new RegExp(`${pluginId}: effect "broken styles" failed: missingCss is not defined`),
  )
})

test('rejects a bundle that registers a different plugin id', async () => {
  await assert.rejects(
    smokeYootunClientBundle({
      pluginId: '@dofe/dsh-yootun-expected',
      clientPath: '/virtual/yootun-wrong/client.js',
      source: bundle('@dofe/dsh-yootun-wrong', ''),
    }),
    /registered unexpected id @dofe\/dsh-yootun-wrong/,
  )
})
