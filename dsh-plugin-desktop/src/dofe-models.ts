/** Model catalog fetched from the DoFe model router. */

/** OpenAI-compatible chat model catalog used by the desktop model picker. */
export const DOFE_MODEL_CATALOG_URL = 'https://ixicai.cn/api/v1/models?protocol=openai'

export interface DofeModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly contextWindow?: number
  readonly inputModalities?: readonly ('text' | 'image')[]
}

const NON_CHAT_MODEL_PATTERN = /(?:voice|speech|tts|stt|audio|seedance|seedream|embedding|rerank|moderation|music|video-generation|image-generation)/iu
const DOFE_VISION_MODEL_IDS = new Set([
  'deepseek-v4-flash-vision',
  'deepseek-v4-flash-vision-exp',
])

/** Fill capability metadata omitted by the OpenAI-compatible model listing. */
export function dofeModelInputModalities(
  id: string,
  declared?: readonly ('text' | 'image')[],
): readonly ('text' | 'image')[] | undefined {
  if (DOFE_VISION_MODEL_IDS.has(id)) return ['text', 'image']
  return declared
}

/** Return whether a catalog row advertises an OpenAI-compatible chat surface. */
function isOpenAiCompatibleChatRow(entry: Record<string, unknown>): boolean {
  for (const field of ['protocol', 'api_protocol', 'apiProtocol', 'api_type', 'apiType', 'type']) {
    const value = entry[field]
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase()
    if (field === 'type' && ['chat', 'text', 'multimodal'].includes(normalized)) continue
    if (field === 'type' && ['embedding', 'rerank', 'moderation', 'audio', 'image', 'video', 'speech'].includes(normalized)) return false
    if (normalized.includes('openai') || normalized.includes('compatible')) continue
    if (field !== 'type') return false
  }
  const id = typeof entry.id === 'string' ? entry.id : ''
  return !NON_CHAT_MODEL_PATTERN.test(id)
}

/** Convert an OpenAI-compatible model listing into the desktop catalog shape. */
export function parseDofeModelCatalog(value: unknown): DofeModel[] {
  const rows = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : []
  const seen = new Set<string>()
  const models: DofeModel[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
    const entry = row as Record<string, unknown>
    if (typeof entry.id !== 'string' || entry.id.trim().length === 0) continue
    if (!isOpenAiCompatibleChatRow(entry)) continue
    const id = entry.id.trim()
    if (seen.has(id)) continue
    seen.add(id)
    const name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : id
    const description = typeof entry.description === 'string' && entry.description.trim().length > 0
      ? entry.description.trim()
      : undefined
    const contextWindow = typeof entry.context_window === 'number' && Number.isSafeInteger(entry.context_window) && entry.context_window > 0
      ? entry.context_window
      : typeof entry.contextWindow === 'number' && Number.isSafeInteger(entry.contextWindow) && entry.contextWindow > 0
        ? entry.contextWindow
        : undefined
    const modalities = Array.isArray(entry.input_modalities)
      ? entry.input_modalities
      : Array.isArray(entry.inputModalities) ? entry.inputModalities : undefined
    const declaredModalities = modalities?.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
    if (modalities !== undefined && declaredModalities?.length === 0) continue
    const inputModalities = dofeModelInputModalities(
      id,
      declaredModalities === undefined ? undefined : [...new Set(declaredModalities)],
    )
    models.push({
      id,
      name,
      ...(description === undefined ? {} : { description }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(inputModalities === undefined || inputModalities.length === 0 ? {} : { inputModalities }),
    })
  }
  return models
}
