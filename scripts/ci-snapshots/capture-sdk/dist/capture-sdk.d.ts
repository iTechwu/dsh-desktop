import { CaptureAckSchema, type CaptureAck, type CaptureErrorCode, type CaptureEventKind } from '@repo/contracts';
import { SDK_VERSION, type CaptureSdkConfig } from './config';
export type CapturePayload = {
    /** Human/agent-readable text; truncated to maxTextChars after redaction. */
    text?: string;
    /** Tool name for post-tool-use events. */
    toolName?: string;
    /** Arbitrary structured data, redacted via deny paths + key masking. */
    data?: unknown;
};
export type CaptureInput = {
    kind: CaptureEventKind;
    payload?: CapturePayload;
    /** Stable client event id; defaults to a random UUID. The idempotency key
     *  is derived from the verified identity tuple + this id. */
    eventId?: string;
    time?: Date;
};
export type FlushResult = {
    status: 'accepted' | 'duplicate' | 'backoff' | 'empty';
    lastSequence?: number;
    errorCode?: CaptureErrorCode;
    detail?: string;
};
/**
 * Capture SDK main entry (docs/0906/ai-memory Phase A, §3 + §10 Phase A).
 *
 * Guarantees:
 * - `capture()` is synchronous, never performs IO and never throws: a broken
 *   network degrades capture, not the agent.
 * - Every event carries the `(tenant, user, agentRuntime, session, eventId)`
 *   idempotency key; retries never duplicate authority rows.
 * - Redaction runs before spooling (earliest drop).
 * - `flush()` uses a short timeout and exponential backoff on 429/5xx; events
 *   stay in the spool until the server accepts them.
 */
export declare class CaptureSdk {
    private readonly config;
    private readonly spool;
    private nextSeq;
    private nextAttemptAt;
    private attempt;
    private readonly fetchImpl;
    private readonly randomUUID;
    constructor(config: CaptureSdkConfig);
    get pendingCount(): number;
    get evictedCount(): number;
    get retryInMs(): number;
    /**
     * Adapt one agent lifecycle event into the bounded spool. Returns a
     * contract `CaptureAck`: `accepted` once queued, `rejected` when redaction
     * dropped the content (forbidden capture id present).
     */
    capture(input: CaptureInput): CaptureAck;
    /**
     * Submit all pending events as one idempotent checkpoint. Short timeout,
     * exponential backoff on 429/5xx/network errors; drained events are
     * requeued in order on any failure.
     */
    flush(): Promise<FlushResult>;
    /** Test seam. */
    protected now(): number;
    private scheduleBackoff;
    private request;
}
export { CaptureAckSchema, SDK_VERSION };
//# sourceMappingURL=capture-sdk.d.ts.map