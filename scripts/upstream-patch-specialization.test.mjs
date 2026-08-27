import assert from 'node:assert/strict'
import test from 'node:test'
import { specializeGeneratedCssModulePatch } from './upstream-patch-specialization.mjs'

test('specializes every generated CSS Modules class to the target build prefix', () => {
  const patch = [
    '+"nativePickerButton": "_3Crdra_nativePickerButton"',
    '+className: _3Crdra_nativePickerButton',
  ].join('\n')
  const target = '"dialog": "_Qx9-Z_dialog"'

  assert.equal(
    specializeGeneratedCssModulePatch(patch, target),
    [
      '+"nativePickerButton": "_Qx9-Z_nativePickerButton"',
      '+className: _Qx9-Z_nativePickerButton',
    ].join('\n'),
  )
})

test('rejects inputs without both generated class prefixes', () => {
  assert.throws(
    () => specializeGeneratedCssModulePatch('+unrelated patch', '"dialog": "_Qx9-Z_dialog"'),
    /cannot resolve generated CSS Modules class prefixes/u,
  )
})
