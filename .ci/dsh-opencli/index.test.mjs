import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, buildExaToolCall, validateReadOnlyArgs } from './index.js'

test('allows bounded read-only research commands', () => {
  assert.deepEqual(
    validateReadOnlyArgs(['xiaohongshu', 'search', '优惠豚', '-f', 'json']),
    ['xiaohongshu', 'search', '优惠豚', '-f', 'json'],
  )
  assert.deepEqual(validateReadOnlyArgs(['dongchedi', 'search', '购车补贴']), ['dongchedi', 'search', '购车补贴'])
  assert.deepEqual(validateReadOnlyArgs(['exa', 'search', '优惠豚', '--limit', '5']), ['exa', 'search', '优惠豚', '--limit', '5'])
  for (const site of ['kuaishou', 'lemon8', 'youtube']) {
    assert.deepEqual(validateReadOnlyArgs([site, 'search', '汽车改装']), [site, 'search', '汽车改装'])
  }
})

test('maps the agent-reach Exa route to bounded MCP calls', () => {
  assert.deepEqual(buildExaToolCall(['exa', 'search', '优惠豚 好车会员店', '--limit', '5']), {
    name: 'web_search_exa',
    arguments: { query: '优惠豚 好车会员店', numResults: 5 },
  })
  assert.deepEqual(buildExaToolCall(['exa', 'fetch', 'https://example.com/a']), {
    name: 'web_fetch_exa',
    arguments: { urls: ['https://example.com/a'], maxCharacters: 6000 },
  })
  assert.throws(() => buildExaToolCall(['exa', 'fetch', 'file:///etc/passwd']), /HTTPS URL/)
})

test('rejects write-capable and arbitrary commands', () => {
  assert.throws(() => validateReadOnlyArgs(['xiaohongshu', 'publish', 'payload']), /not allowed/)
  assert.throws(() => validateReadOnlyArgs(['weibo', 'delete', '123']), /not allowed/)
  assert.throws(() => validateReadOnlyArgs(['browser', 'eval', '1 + 1']), /not allowed/)
})

test('rejects malformed arguments', () => {
  assert.throws(() => validateReadOnlyArgs(['xiaohongshu']), /site and a read-only command/)
  assert.throws(() => validateReadOnlyArgs(['google', 'search', '']), /non-empty strings/)
  assert.throws(() => validateReadOnlyArgs(['google', 'search', 'x\0y']), /non-empty strings/)
})

test('sends Exa MCP requests without following redirects or caching responses', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return new Response('data: {"jsonrpc":"2.0","id":"agent-reach","result":{"content":[{"type":"text","text":"ok"}]}}\n', { status: 200 })
  }
  let tool
  const dispose = apply({
    credentials: { async resolve() { return { value: 'test-key' } } },
    systemPrompt: { section() { return () => {} } },
    tools: { register(value) { tool = value; return () => {} } },
  })
  try {
    const result = await tool.execute({ args: ['exa', 'search', '优惠豚', '--limit', '2'] }, { signal: new AbortController().signal })
    assert.equal(result.ok, true)
    assert.equal(request.url, 'https://ixicai.cn/mcp/exa')
    assert.equal(request.init.redirect, 'error')
    assert.equal(request.init.cache, 'no-store')
    assert.equal(request.init.headers.Authorization, 'Bearer test-key')
  } finally {
    dispose()
    globalThis.fetch = originalFetch
  }
})
