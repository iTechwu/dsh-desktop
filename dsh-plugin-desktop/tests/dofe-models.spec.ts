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

  it('preserves output limits and supplies the documented GLM-5.3 128K cap', () => {
    expect(parseDofeModelCatalog({ data: [
      { id: 'glm-5.3-flash', context_window: 1048576 },
      { id: 'glm-5.2', max_completion_tokens: 65536 },
    ] })).toEqual([
      { id: 'glm-5.3-flash', name: 'glm-5.3-flash', contextWindow: 1048576, maxTokens: 131072 },
      { id: 'glm-5.2', name: 'glm-5.2', maxTokens: 65536 },
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

  it('restores image input for known DoFe vision models when the OpenAI catalog omits it', () => {
    expect(parseDofeModelCatalog({ data: [
      { id: 'deepseek-v4-flash-vision' },
      { id: 'deepseek-v4-flash-vision-exp', input_modalities: ['text'] },
      { id: 'deepseek-v4-pro' },
    ] })).toEqual([
      {
        id: 'deepseek-v4-flash-vision',
        name: 'deepseek-v4-flash-vision',
        inputModalities: ['text', 'image'],
      },
      {
        id: 'deepseek-v4-flash-vision-exp',
        name: 'deepseek-v4-flash-vision-exp',
        inputModalities: ['text', 'image'],
      },
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
    ])
  })
})
