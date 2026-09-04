import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, name } from '../index.js'

test('keeps the required host entry inert', () => {
  const unreachable = () => { throw new Error('audit client host must not register runtime capabilities') }
  assert.equal(name, 'yootun-audit-client-host')
  assert.equal(apply({ webServer: { register: unreachable }, tools: { register: unreachable } }), undefined)
})
