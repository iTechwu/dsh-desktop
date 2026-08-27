export const GENERATED_CSS_MODULE_PATCH = 'dsh-client-ui-directory-picker-browse@0.1.1-rc.2.patch'

const DIALOG_CLASS_PATTERN = /"dialog": "(_[A-Za-z0-9_-]+)_dialog"/u
const NATIVE_PICKER_CLASS_PATTERN = /"nativePickerButton": "(_[A-Za-z0-9_-]+)_nativePickerButton"/u

export function specializeGeneratedCssModulePatch(patchText, targetText) {
  const patchPrefix = patchText.match(NATIVE_PICKER_CLASS_PATTERN)?.[1]
  const targetPrefix = targetText.match(DIALOG_CLASS_PATTERN)?.[1]
  if (patchPrefix === undefined || targetPrefix === undefined) {
    throw new Error('cannot resolve generated CSS Modules class prefixes')
  }
  return patchText.replaceAll(patchPrefix, targetPrefix)
}
