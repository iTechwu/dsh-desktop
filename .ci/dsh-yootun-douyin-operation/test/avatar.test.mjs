// 头像图集标准化回归（二次优化 §5.1/§7.1）：字符串、图集对象、危险协议与超长值。
//
// 该函数是 collector（采集）、session（登录）、index.js（宿主投影）共用的唯一实现，
// 三处对同一输入必须得到同一输出；本文件同时直接校验三处接入点的一致性。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeAvatarUrl } from '../src/avatar.js'
import { collectAccountProfile } from '../src/collector.js'
import { readAccountProfile } from '../src/session.js'

const VALID = 'https://p3.douyinpic.com/aweme/100x100/avatar.jpeg'

test('字符串 URL：http(s) 原样返回（仅 trim），不做无法验证的改写', () => {
  assert.equal(normalizeAvatarUrl(VALID), VALID)
  assert.equal(normalizeAvatarUrl(`  ${VALID}  `), VALID, '首尾空白被裁剪')
  assert.equal(normalizeAvatarUrl('http://p3.douyinpic.com/a.jpeg'), 'http://p3.douyinpic.com/a.jpeg', 'http 也放行')
})

test('图集对象：url_list 按原顺序取第一个合法 URL，第一个无效时选第二个', () => {
  assert.equal(normalizeAvatarUrl({ uri: 'xyz', url_list: ['not a url', VALID] }), VALID)
  assert.equal(normalizeAvatarUrl({ url_list: ['javascript:alert(1)', VALID] }), VALID, '危险协议条目被跳过')
  assert.equal(normalizeAvatarUrl({ url_list: [VALID] }), VALID)
})

test('uri 只作为必要兼容候选：url_list 缺失时才使用', () => {
  assert.equal(normalizeAvatarUrl({ uri: VALID }), VALID)
  assert.equal(normalizeAvatarUrl({ uri: VALID, url_list: [] }), VALID, 'url_list 空数组时回退 uri')
  assert.equal(
    normalizeAvatarUrl({ uri: VALID, url_list: 'nope' }),
    VALID,
    'url_list 非数组时回退 uri（必要兼容）',
  )
})

test('空值、非字符串非对象一律 null', () => {
  for (const value of [null, undefined, '', '   ', 123, true, [], ['x']]) {
    assert.equal(normalizeAvatarUrl(value), null, `输入 ${JSON.stringify(value) ?? String(value)} 应为 null`)
  }
})

test('对象缺字段、无数组、数组无合法项 → null', () => {
  assert.equal(normalizeAvatarUrl({}), null)
  assert.equal(normalizeAvatarUrl({ url_list: [] }), null)
  assert.equal(normalizeAvatarUrl({ url_list: ['nope'] }), null)
  assert.equal(normalizeAvatarUrl({ other: VALID }), null)
})

test('危险协议与非法地址：javascript:/data:/file:/协议相对/纯路径 全部 null', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///etc/passwd',
    'vbscript:x',
    '//p3.douyinpic.com/a.jpeg',
    '/local/a.jpeg',
    'ftp://p3.douyinpic.com/a.jpeg',
  ]) {
    assert.equal(normalizeAvatarUrl(value), null, `${value} 应为 null`)
    assert.equal(normalizeAvatarUrl({ url_list: [value] }), null, `对象内 ${value} 应为 null`)
  }
})

test('超过 2048 字符的 URL 返回 null（不截断，截断是无法验证的改写）', () => {
  const long = `https://p3.douyinpic.com/${'a'.repeat(2100)}.jpeg`
  assert.ok(long.length > 2048)
  assert.equal(normalizeAvatarUrl(long), null)
  const atLimit = `https://p3.douyinpic.com/${'a'.repeat(2048 - 'https://p3.douyinpic.com/'.length - '.jpeg'.length)}.jpeg`
  assert.equal(atLimit.length, 2048)
  assert.equal(normalizeAvatarUrl(atLimit), atLimit, '恰好 2048 仍放行')
})

test('collector 与 session 对同一头像输入得到同一字符串结果（登录/采集一致）', async () => {
  const gallery = { uri: 'xyz', url_list: ['invalid', VALID] }
  const collectorProfile = await collectAccountProfile({
    goto: async () => {},
    on() {}, off() {},
    waitForTimeout: async () => {},
    evaluate: async (_fn, request) => {
      assert.ok(request.url.includes('user/info'))
      return { status: 200, text: JSON.stringify({ user: { sec_uid: 'acc-1', nickname: '示例', avatar_uri: gallery, follower_count: 12 } }) }
    },
  })
  const sessionProfile = await readAccountProfile({
    evaluate: async () => ({ status: 200, json: { user: { sec_uid: 'acc-1', nickname: '示例', avatar_uri: gallery } } }),
  })
  assert.equal(collectorProfile.avatar, VALID)
  assert.equal(sessionProfile.avatar, VALID)
  assert.equal(collectorProfile.avatar, sessionProfile.avatar, '登录与采集得到同一类型/同一值的头像')
})

test('对象头像不会被原样透出：collector 返回的 avatar 永远是字符串或 null', async () => {
  const profile = await collectAccountProfile({
    goto: async () => {},
    on() {}, off() {},
    waitForTimeout: async () => {},
    evaluate: async () => ({ status: 200, text: JSON.stringify({ user: { sec_uid: 'acc-1', avatar_uri: { url_list: ['javascript:alert(1)'] } } }) }),
  })
  assert.equal(profile.avatar, null, '全非法候选时收敛为 null，不透出对象')
})
