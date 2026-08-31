import { basename } from 'node:path'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

const MAX_PROJECTION_FILES = 2_000
const MAX_PROJECTION_BYTES = 256 * 1024
const MAX_SESSIONS = 50
const MAX_LOG_BYTES = 64 * 1024 * 1024
const MAX_EVENTS_PER_SESSION = 100_000
const MAX_LABEL_LENGTH = 160

type JsonRecord = Record<string, unknown>

export interface DashboardPeriod {
  start: string
  end: string
  date: string
  timeZone: string
}

export interface ActivityModelSummary {
  provider: string
  model: string
  messages: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ActivityToolSummary {
  name: string
  calls: number
}

export interface ActivitySessionSummary {
  title: string
  workspace: string
  turns: number
  completedTurns: number
  failedTurns: number
  toolCalls: number
}

export interface LocalActivitySummary {
  sessions: ActivitySessionSummary[]
  totals: {
    sessions: number
    turns: number
    completedTurns: number
    failedTurns: number
    toolCalls: number
  }
  models: ActivityModelSummary[]
  tools: ActivityToolSummary[]
  skippedSessions: number
}

interface ProjectionCandidate {
  id: string
  cwd?: string
  createdAt: number
  lastPromptAt: number
  title: string
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function finite(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, MAX_LABEL_LENGTH)
    : fallback
}

function rowValue(rows: JsonRecord | undefined, key: string): unknown {
  return record(rows?.[key])?.val
}

function parseProjection(filename: string, value: unknown): ProjectionCandidate | undefined {
  const root = record(value)
  const projection = record(root?.record)
  const identity = record(projection?.identity)
  const rows = record(projection?.rows)
  const metadata = record(rowValue(rows, 'sessionListMetadata'))
  const id = filename.endsWith('.json') ? filename.slice(0, -5) : ''
  const createdAt = finite(identity?.createdAt)
  const lastPromptAt = finite(metadata?.lastPromptAt)
  if (!/^[A-Za-z0-9._~-]{1,200}$/.test(id) || id === '.' || id === '..' || createdAt === 0) {
    return undefined
  }
  return {
    id,
    createdAt,
    lastPromptAt,
    ...(typeof identity?.cwd === 'string' ? { cwd: identity.cwd } : {}),
    title: text(rowValue(rows, 'title'), '未命名会话'),
  }
}

async function projectionCandidates(
  directory: string,
  startMs: number,
  endMs: number,
): Promise<ProjectionCandidate[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const candidates: ProjectionCandidate[] = []
  for (const entry of entries.slice(0, MAX_PROJECTION_FILES)) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
    const path = `${directory}/${entry.name}`
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PROJECTION_BYTES) continue
      const parsed = parseProjection(entry.name, JSON.parse(await readFile(path, 'utf8')))
      if (parsed === undefined) continue
      // Include a session continued today when it was already alive yesterday.
      if (parsed.createdAt < endMs && parsed.lastPromptAt >= startMs) candidates.push(parsed)
    } catch {
      // A corrupt cache row is isolated to that session.
    }
  }
  return candidates
    .sort((left, right) => right.lastPromptAt - left.lastPromptAt)
    .slice(0, MAX_SESSIONS)
}

async function logWithinLimit(
  persistence: Pick<SessionPersistence, 'locate'>,
  candidate: ProjectionCandidate,
): Promise<boolean> {
  try {
    const location = persistence.locate({
      id: SessionId(candidate.id),
      cwd: candidate.cwd,
      createdAt: candidate.createdAt,
    } as never)
    if (location === undefined) return true
    const info = await lstat(location.path)
    return info.isFile() && !info.isSymbolicLink() && info.size <= MAX_LOG_BYTES
  } catch {
    return false
  }
}

function eventRecord(event: SessionEvent): JsonRecord {
  return event as unknown as JsonRecord
}

function inPeriod(event: SessionEvent, startMs: number, endMs: number): boolean {
  const time = finite(eventRecord(event).time)
  return time >= startMs && time < endMs
}

/** Read yesterday's local work facts without returning prompt or response content. */
export async function collectLocalActivity(
  projectionDirectory: string,
  persistence: Pick<SessionPersistence, 'inspect' | 'locate'>,
  period: DashboardPeriod,
  signal?: AbortSignal,
): Promise<LocalActivitySummary> {
  const startMs = new Date(period.start).getTime()
  const endMs = new Date(period.end).getTime()
  const candidates = await projectionCandidates(projectionDirectory, startMs, endMs)
  const modelMap = new Map<string, ActivityModelSummary>()
  const toolMap = new Map<string, number>()
  const sessions: ActivitySessionSummary[] = []
  let skippedSessions = 0

  for (const candidate of candidates) {
    signal?.throwIfAborted()
    try {
      if (!await logWithinLimit(persistence, candidate)) {
        skippedSessions++
        continue
      }
      const inspected = await persistence.inspect(SessionId(candidate.id), signal)
      if (inspected.events.length > MAX_EVENTS_PER_SESSION) {
        skippedSessions++
        continue
      }
      let turns = 0
      let completedTurns = 0
      let failedTurns = 0
      let toolCalls = 0
      let relevantEvents = 0
      for (const event of inspected.events) {
        if (!inPeriod(event, startMs, endMs)) continue
        relevantEvents++
        const value = eventRecord(event)
        const data = record(value.data)
        if (value.type === 'turn/start') turns++
        if (value.type === 'turn/end') {
          const reason = record(data?.reason)
          if (reason?.kind === 'completed') completedTurns++
          else failedTurns++
        }
        if (value.type === 'tool/call') {
          const name = text(data?.name, 'unknown')
          toolMap.set(name, (toolMap.get(name) ?? 0) + 1)
          toolCalls++
        }
        if (value.type !== 'assistant/message') continue
        const message = record(data?.message)
        const source = record(message?.source)
        if (source?.kind !== 'model') continue
        const provider = text(source.provider, 'unknown')
        const model = text(source.model, 'unknown')
        const usage = record(message?.usage)
        const key = `${provider}\u0000${model}`
        const current = modelMap.get(key) ?? {
          provider,
          model,
          messages: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }
        current.messages++
        current.inputTokens += finite(usage?.inputTokens)
        current.outputTokens += finite(usage?.outputTokens)
        current.cacheReadTokens += finite(usage?.cacheReadTokens)
        current.cacheWriteTokens += finite(usage?.cacheWriteTokens)
        modelMap.set(key, current)
      }
      if (relevantEvents === 0) continue
      sessions.push({
        title: candidate.title,
        workspace: candidate.cwd ? text(basename(candidate.cwd), '未命名工作区') : '未命名工作区',
        turns,
        completedTurns,
        failedTurns,
        toolCalls,
      })
    } catch {
      skippedSessions++
    }
  }

  const totals = sessions.reduce((result, session) => ({
    sessions: result.sessions + 1,
    turns: result.turns + session.turns,
    completedTurns: result.completedTurns + session.completedTurns,
    failedTurns: result.failedTurns + session.failedTurns,
    toolCalls: result.toolCalls + session.toolCalls,
  }), { sessions: 0, turns: 0, completedTurns: 0, failedTurns: 0, toolCalls: 0 })

  return {
    sessions,
    totals,
    models: [...modelMap.values()].sort((left, right) =>
      right.inputTokens + right.outputTokens - left.inputTokens - left.outputTokens),
    tools: [...toolMap.entries()]
      .map(([name, calls]) => ({ name, calls }))
      .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name)),
    skippedSessions,
  }
}

/** Local-calendar yesterday, represented as exact instants plus the active IANA timezone. */
export function yesterdayPeriod(now = new Date()): DashboardPeriod {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
  const date = [
    start.getFullYear(),
    String(start.getMonth() + 1).padStart(2, '0'),
    String(start.getDate()).padStart(2, '0'),
  ].join('-')
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    date,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  }
}
