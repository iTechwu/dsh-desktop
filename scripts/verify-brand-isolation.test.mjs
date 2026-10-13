import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countTokens, stripInfrastructureLiterals } from './verify-brand-isolation.mjs'

test('strips complete HTTP URLs including release endpoints and TOS bucket paths', () => {
  const source = [
    `const mirror = 'https://ixicai.cn/api/desktop/downloads/mac'`,
    `const tos = 'https://dofe-public.tos-cn-beijing.volces.com/yootun-agent/releases/beta/2.3.0/darwin/abc/Yootun-Agent-Beta-2.3.0.dmg'`,
    `const legacy = 'https://dshdesktop.cn/api/downloads/windows'`,
  ].join('\n')
  assert.equal(stripInfrastructureLiterals(source), `const mirror = ''\nconst tos = ''\nconst legacy = ''`)
  assert.equal(countTokens(source), 0)
})

test('strips versioned installer artifact filenames outside URLs', () => {
  for (const artifact of [
    'Yootun-Agent-Beta-2.3.0.dmg',
    'Yootun-Agent-Beta-2.0.11-beta.17-arm64.dmg',
    'Yootun-Agent-Beta-2.0.11-beta.17-x64-Setup.exe',
    'Yootun-Agent-Beta-2.0.11-beta.17-x64-Portable.zip',
  ]) {
    assert.equal(countTokens(`saveAs('${artifact}')`), 0, artifact)
  }
})

test('never strips prose, unversioned names, or bare brand copy', () => {
  assert.equal(countTokens('欢迎使用 Yootun 客户端'), 1)
  assert.equal(countTokens('优惠豚运营工具'), 1)
  assert.equal(countTokens('Anywhere Labs 出品'), 1)
  assert.equal(countTokens('productName: "Yootun-Agent Beta"'), 1)
  assert.equal(countTokens('Yootun-Agent（无版本号不是产物名）'), 1)
})

test('copy after a URL on the same line still counts', () => {
  assert.equal(countTokens(`'https://ixicai.cn/x', // Yootun fallback copy`), 1)
})

test('CJK copy after a full-width period following a URL still counts', () => {
  const source = 'brief: \'优惠豚：https://yootun.ixicai.cn。优惠豚面向中国大陆汽车消费者\''
  assert.equal(countTokens(source), 2)
  assert.equal(stripInfrastructureLiterals(source), 'brief: \'优惠豚：。优惠豚面向中国大陆汽车消费者\'')
})
