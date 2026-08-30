/** Model catalog fetched from the DoFe model router. */

/** Public model gateway used by the in-network desktop deployment. */
export const DOFE_MODEL_CATALOG_URL = 'https://ixicai.cn/api/v1/models'

export interface DofeModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly contextWindow?: number
  readonly inputModalities?: readonly ('text' | 'image')[]
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
    const inputModalities = modalities?.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
    models.push({
      id,
      name,
      ...(description === undefined ? {} : { description }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(inputModalities === undefined || inputModalities.length === 0 ? {} : { inputModalities: [...new Set(inputModalities)] }),
    })
  }
  return models
}
