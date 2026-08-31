import { describe, expect, it } from 'vitest'
import { parseDofeModelCatalog } from '../src/dofe-models.ts'

describe('DoFe model catalog parsing', () => {
  it('accepts OpenAI-compatible data responses and removes invalid duplicates', () => {
    expect(parseDofeModelCatalog({ data: [
      { id: 'alpha', name: 'Alpha', context_window: 128000 },
      { id: 'alpha', name: 'ignored' },
      { id: 'vision', input_modalities: ['text', 'image', 'audio'] },
      { id: '' },
      null,
    ] })).toEqual([
      { id: 'alpha', name: 'Alpha', contextWindow: 128000 },
      { id: 'vision', name: 'vision', inputModalities: ['text', 'image'] },
    ])
  })

  it('returns an empty catalog for malformed payloads', () => {
    expect(parseDofeModelCatalog({ object: 'list', data: 'bad' })).toEqual([])
    expect(parseDofeModelCatalog(undefined)).toEqual([])
  })

  it('filters non-chat and non-OpenAI protocol models from a shared gateway catalog', () => {
    expect(parseDofeModelCatalog({ data: [
      { id: 'minimax-voice-clone' },
      { id: 'seedance-2.0-mini' },
      { id: 'text-embedding-3-large', type: 'embedding' },
      { id: 'vendor-chat', protocol: 'vendor-native' },
      { id: 'qwen-chat', protocol: 'openai-compatible' },
      { id: 'deepseek-v4-flash-vision-exp', input_modalities: ['text', 'image'] },
    ] })).toEqual([
      { id: 'qwen-chat', name: 'qwen-chat' },
      { id: 'deepseek-v4-flash-vision-exp', name: 'deepseek-v4-flash-vision-exp', inputModalities: ['text', 'image'] },
    ])
  })
})
