import { randomUUID } from 'node:crypto'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type {
  RecruiterKnowledgePublisher,
} from './yootun-recruiter-route.ts'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function toolName(tools: Pick<ToolRuntime, 'schemas'>, suffix: string): string | undefined {
  return tools.schemas().find(item => item.name === suffix || item.name.endsWith(`__${suffix}`))?.name
}

function memoryId(value: unknown): string | undefined {
  const root = record(value)
  const result = record(root?.result)
  const structured = record(result?.structuredContent) ?? record(root?.structuredContent) ?? result
  const direct = structured?.id ?? structured?.memoryId
  if (typeof direct === 'string') return direct
  const content = Array.isArray(result?.content) ? result.content : []
  for (const block of content) {
    const item = record(block)
    if (item?.type !== 'text' || typeof item.text !== 'string') continue
    try {
      const parsed = record(JSON.parse(item.text))
      const id = parsed?.id ?? parsed?.memoryId
      if (typeof id === 'string') return id
    } catch {}
  }
  return undefined
}

export function createRecruiterKnowledgePublisher(
  tools: Pick<ToolRuntime, 'schemas' | 'execute'> | undefined,
): RecruiterKnowledgePublisher | undefined {
  if (tools === undefined) return undefined
  const remember = toolName(tools, 'knowledge_remember')
  const confirm = toolName(tools, 'knowledge_confirm_memory')
  if (remember === undefined || confirm === undefined) return undefined
  return {
    async publish(request) {
      const signal = AbortSignal.timeout(30_000)
      const created = await tools.execute({
        callId: ToolCallId(`recruiter-knowledge-${randomUUID()}`),
        name: remember,
        arguments: { input: {
          content: request.content,
          type: 'SEMANTIC',
          scope: 'TEAM',
          ...(request.spaceId === undefined ? {} : { spaceId: request.spaceId }),
          captureReason: `hr-workbench:${request.idempotencyKey}`,
        } },
        signal,
      })
      if (created.isError || record(created.value)?.ok !== true) {
        return { status: 'failed', reasonCode: 'knowledge_remember_failed' }
      }
      const id = memoryId(created.value)
      if (id === undefined) return { status: 'failed', reasonCode: 'knowledge_memory_id_missing' }
      const confirmed = await tools.execute({
        callId: ToolCallId(`recruiter-knowledge-confirm-${randomUUID()}`),
        name: confirm,
        arguments: { input: { memoryId: id, reason: 'hr-workbench-user-confirmed', shareWithSpace: true } },
        signal,
      })
      if (confirmed.isError || record(confirmed.value)?.ok !== true) {
        return { status: 'failed', reasonCode: 'knowledge_confirm_failed' }
      }
      return { status: 'succeeded', reasonCode: 'knowledge_confirmed', memoryId: id }
    },
  }
}
