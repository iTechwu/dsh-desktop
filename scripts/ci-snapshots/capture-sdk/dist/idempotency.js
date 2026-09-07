import { createHash, randomUUID } from 'node:crypto';
export function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}
/**
 * Deterministic capture idempotency key over
 * `(tenant, user, agentRuntime, externalSessionId, eventId)` — the same tuple
 * retried by the adapter collapses into one server-side checkpoint event
 * (docs/0906/ai-memory §3.2 acceptance: no duplicate authority rows).
 */
export function buildCaptureEventId(input) {
    var _a;
    return sha256Hex([
        input.tenantId,
        input.userId,
        (_a = input.agentRuntimeId) !== null && _a !== void 0 ? _a : '-',
        input.externalSessionId,
        input.eventId,
    ].join('|'));
}
/**
 * Canonical SHA-256 over the deterministic checkpoint payload. Mirrors the
 * server-side MCP ordering (`externalSessionId, captureReason, firstSeq,
 * lastSeq, summary, events, evidence, candidateContents`) so retries with
 * identical content produce the identical hash and the server's
 * (firstSeq, lastSeq, payloadHash) idempotency window detects a true retry
 * instead of double-writing.
 */
export function checkpointPayloadHash(canonical) {
    var _a;
    return sha256Hex(JSON.stringify({
        externalSessionId: canonical.externalSessionId,
        captureReason: 'capture-sdk',
        firstSeq: canonical.firstSeq,
        lastSeq: canonical.lastSeq,
        summary: (_a = canonical.summary) !== null && _a !== void 0 ? _a : null,
        events: canonical.events,
        evidence: canonical.evidence,
        candidateContents: canonical.candidateContents,
    }));
}
export function defaultRandomUUID() {
    return randomUUID();
}
