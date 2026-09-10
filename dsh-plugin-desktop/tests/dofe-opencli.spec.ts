import { describe, expect, it } from 'vitest'
import { validateDofeOpenCliArgs } from '../src/dofe-opencli.ts'

describe('DoFe OpenCLI route guard', () => {
  it('allows bounded public read-only routes', () => {
    expect(validateDofeOpenCliArgs(['xiaohongshu', 'search', '优惠豚', '-f', 'json']))
      .toEqual(['xiaohongshu', 'search', '优惠豚', '-f', 'json'])
    expect(validateDofeOpenCliArgs(['exa', 'fetch', 'https://example.com']))
      .toEqual(['exa', 'fetch', 'https://example.com'])
  })

  it('rejects write-capable, unknown, and malformed routes', () => {
    expect(() => validateDofeOpenCliArgs(['xiaohongshu', 'publish', 'payload'])).toThrow(/not allowed/)
    expect(() => validateDofeOpenCliArgs(['browser', 'eval', '1 + 1'])).toThrow(/not allowed/)
    expect(() => validateDofeOpenCliArgs(['google'])).toThrow(/bounded string array/)
    expect(() => validateDofeOpenCliArgs(['google', 'search', 'x\0y'])).toThrow(/bounded string array/)
  })
})
