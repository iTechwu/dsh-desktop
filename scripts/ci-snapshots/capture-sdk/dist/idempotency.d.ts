import type { CaptureEventKind } from '@repo/contracts';
export declare function sha256Hex(value: string): string;
/**
 * Deterministic capture idempotency key over
 * `(tenant, user, agentRuntime, externalSessionId, eventId)` — the same tuple
 * retried by the adapter collapses into one server-side checkpoint event
 * (docs/0906/ai-memory §3.2 acceptance: no duplicate authority rows).
 */
export declare function buildCaptureEventId(input: {
    tenantId: string;
    userId: string;
    agentRuntimeId?: string;
    externalSessionId: string;
    eventId: string;
}): string;
/** A spooled capture event, already redacted and keyed. */
export type SpooledEvent = {
    captureEventId: string;
    kind: CaptureEventKind;
    seq: number;
    time: string;
    text?: string;
    toolName?: string;
    /** Bounded JSON serialization of the redacted structured payload. */
    dataJson?: string;
};
/**
 * Canonical SHA-256 over the deterministic checkpoint payload. Mirrors the
 * server-side MCP ordering (`externalSessionId, captureReason, firstSeq,
 * lastSeq, summary, events, evidence, candidateContents`) so retries with
 * identical content produce the identical hash and the server's
 * (firstSeq, lastSeq, payloadHash) idempotency window detects a true retry
 * instead of double-writing.
 */
export declare function checkpointPayloadHash(canonical: {
    externalSessionId: string;
    firstSeq: number;
    lastSeq: number;
    summary?: string;
    events: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
    candidateContents: Array<Record<string, unknown>>;
}): string;
export declare function defaultRandomUUID(): string;
//# sourceMappingURL=idempotency.d.ts.map