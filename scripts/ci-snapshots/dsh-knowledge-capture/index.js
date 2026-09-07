// @dofe/dsh-knowledge-capture
//
// Yootun-Agent host for the Knowledge capture SDK
// (docs/0906/ai-memory §3.1, Phase A first-success-onboarding host).
//
// The plugin wraps createYootunAgentAdapter() from @repo/capture-sdk as a
// Cordis apply module. The host runtime owns the lifecycle surface (which
// `kind` fires when); this module owns the wiring between the verified
// runtime identity and the SDK so the host never hand-rolls headers,
// idempotency keys, or spool backoff.
//
// Identity wiring (single-tenant / single-user desktop install):
//   tenantId = userId = getOrCreateDesktopInstallationId()
//   scopeRoleKey = 'user.agent_runtime' (canonical role key per
//                  docs/0906/ai-memory §3.1 — server re-resolves to spaces)
//   externalSessionId = randomUUID() minted once per Cordis generation
//   authorization = 'Bearer ' + ctx.credentials.resolve('KNOWLEDGE_API_KEY')
//                   with a process.env.KNOWLEDGE_API_KEY fallback for
//                   first-run / dev profiles
//   baseUrl = process.env.KNOWLEDGE_API_BASE_URL
//             || 'https://knowledge.dofe.ai'
//
// Lifecycle emit points (mirrors docs/0906/ai-memory §3.1):
//   session-start  : apply() at Cordis generation start
//   session-end    : dispose effect at generation teardown
//   user-prompt / post-tool-use / pre-compact / post-compaction
//                 : emitted by host code that calls
//                   ctx.yootunAgentCapture.emit({ kind, payload })
//                   (no per-host lifecycle binding here — the host
//                   surfaces events; we provide the emit seam)
//
// Failure modes:
//   - missing or unresolved KNOWLEDGE_API_KEY → apply() no-ops the
//     adapter construction and logs a warning. capture stays offline but
//     the host keeps running (consistent with safe-mode behavior).
//   - flush() / shutdown() never throw to the caller; SDK classifies
//     transport / HTTP errors via CaptureErrorCodeSchema and requeues
//     in the bounded spool.

import { randomUUID } from 'node:crypto'
import { createYootunAgentAdapter } from '@repo/capture-sdk'

export const name = 'yootun-agent-knowledge-capture'

// Required Cordis services provided by dsh-plugin-desktop's Host bundle.
// `desktopRuntime` exposes the per-install installation id; `credentials`
// resolves the Knowledge API bearer from the dofe-access settings namespace
// (mirroring dsh-plugin-desktop/src/dofe-managed.ts:73 and dofe-access-route.ts:59).
export const inject = ['credentials', 'desktopRuntime']

const DEFAULT_BASE_URL = 'https://knowledge.dofe.ai'
const DEFAULT_SCOPE_ROLE_KEY = 'user.agent_runtime'
const SHUTDOWN_DEADLINE_MS = 1500

export async function apply(ctx) {
  const logger = ctx?.logger ?? console
  const runtime = ctx?.desktopRuntime ?? {}
  // getOrCreateDesktopInstallationId is host-provided; dsh-plugin-desktop
  // wires it through ctx.desktopRuntime.installationId at startup. If absent
  // (older host), fall back to a per-generation UUID so the adapter still
  // gets a stable per-session id and capture events stay consistent.
  const installationId =
    typeof runtime.installationId === 'string' && runtime.installationId
      ? runtime.installationId
      : `dev-${randomUUID()}`
  const baseUrl =
    process.env.KNOWLEDGE_API_BASE_URL?.replace(/\/+$/, '') || DEFAULT_BASE_URL
  const authorization = await resolveAuthorization(ctx, logger)

  if (!authorization) {
    logger.warn(
      '[dsh-knowledge-capture] KNOWLEDGE_API_KEY unresolved; capture disabled for this generation',
    )
    // Expose a no-op handle so other code can call ctx.yootunAgentCapture
    // without null checks; emits return a synthetic rejected ack and flush
    // returns empty. The host stays up.
    ctx.yootunAgentCapture = createNoopHandle(installationId)
    return
  }

  const externalSessionId = randomUUID()
  const handle = createYootunAgentAdapter({
    baseUrl,
    tenantId: installationId,
    userId: installationId,
    agentRuntimeId: runtime.agentRuntimeId ?? `yootun-agent@${runtime.version ?? '0.0.0'}`,
    scopeRoleKey: DEFAULT_SCOPE_ROLE_KEY,
    externalSessionId,
    authorization,
  })

  // session-start on Cordis generation start
  handle.emit({ kind: 'session-start' })

  // session-end + flush at generation teardown. Bounded deadline so a
  // hanging flush never blocks app shutdown beyond the desktop shutdown
  // budget (DESKTOP_SHUTDOWN_TIMEOUT_MS = 5_000 in
  // dsh-plugin-desktop/src/shutdown.ts:4).
  ctx.effect(
    () => async () => {
      handle.emit({ kind: 'session-end' })
      await handle.shutdown({ deadlineMs: SHUTDOWN_DEADLINE_MS })
    },
    'dsh-knowledge-capture shutdown',
  )

  ctx.yootunAgentCapture = handle
  logger.info?.(
    `[dsh-knowledge-capture] capture enabled: tenant=${installationId} session=${externalSessionId} base=${baseUrl}`,
  )
}

async function resolveAuthorization(ctx, logger) {
  // Preferred: host credentials namespace (dofe-access settings), same path
  // dofe-managed.ts:73 uses to pull MODELS_API_KEY.
  try {
    const fromCredentials = await ctx?.credentials?.resolve?.('KNOWLEDGE_API_KEY')
    if (typeof fromCredentials === 'string' && fromCredentials) {
      return fromCredentials.startsWith('Bearer ') ? fromCredentials : `Bearer ${fromCredentials}`
    }
  } catch (error) {
    logger.warn?.(
      `[dsh-knowledge-capture] credentials.resolve failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  // Fallback: raw env var. Used by dev / first-run / CI smoke.
  const fromEnv = process.env.KNOWLEDGE_API_KEY?.trim()
  if (fromEnv) {
    return fromEnv.startsWith('Bearer ') ? fromEnv : `Bearer ${fromEnv}`
  }
  return null
}

function createNoopHandle(installationId) {
  return {
    sdkVersion: 'noop',
    pendingCount: () => 0,
    emit: () => ({
      captureEventId: `noop-${randomUUID()}`,
      status: 'rejected',
      detail: `capture disabled (no KNOWLEDGE_API_KEY) for installation ${installationId}`,
      errorCode: 'CAPTURE_UNAUTHORIZED',
    }),
    flush: async () => ({ status: 'empty', detail: 'capture disabled' }),
    shutdown: async () => ({ status: 'empty', detail: 'capture disabled' }),
  }
}
