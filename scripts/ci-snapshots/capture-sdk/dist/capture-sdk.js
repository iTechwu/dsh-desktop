import { CaptureAckSchema, } from '@repo/contracts';
import { DEFAULT_REDACT_KEYS, SDK_VERSION, resolveConfig, } from './config';
import { buildCaptureEventId, checkpointPayloadHash, defaultRandomUUID, } from './idempotency';
import { redactText, redactValue } from './redact';
import { BoundedSpool } from './spool';
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30000;
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
export class CaptureSdk {
    constructor(config) {
        var _a, _b;
        this.nextSeq = 0;
        this.nextAttemptAt = 0;
        this.attempt = 0;
        this.config = resolveConfig(config);
        this.spool = new BoundedSpool(this.config.spoolMaxSize);
        this.fetchImpl = (_a = config.fetchImpl) !== null && _a !== void 0 ? _a : ((...args) => fetch(...args));
        this.randomUUID = (_b = config.randomUUID) !== null && _b !== void 0 ? _b : defaultRandomUUID;
    }
    get pendingCount() {
        return this.spool.size;
    }
    get evictedCount() {
        return this.spool.evictedCount;
    }
    get retryInMs() {
        return Math.max(0, this.nextAttemptAt - this.now());
    }
    /**
     * Adapt one agent lifecycle event into the bounded spool. Returns a
     * contract `CaptureAck`: `accepted` once queued, `rejected` when redaction
     * dropped the content (forbidden capture id present).
     */
    capture(input) {
        var _a, _b, _c, _d, _e, _f;
        const eventId = (_a = input.eventId) !== null && _a !== void 0 ? _a : this.randomUUID();
        const captureEventId = buildCaptureEventId({
            tenantId: this.config.tenantId,
            userId: this.config.userId,
            agentRuntimeId: this.config.agentRuntimeId,
            externalSessionId: this.config.externalSessionId,
            eventId,
        });
        const text = (_b = input.payload) === null || _b === void 0 ? void 0 : _b.text;
        let eventText;
        if (typeof text === 'string' && text.length > 0) {
            const redacted = redactText(text, {
                maxChars: this.config.maxTextChars,
                forbiddenCaptureIds: this.config.forbiddenCaptureIds,
            });
            if (redacted.dropped) {
                return {
                    captureEventId,
                    status: 'rejected',
                    errorCode: 'CAPTURE_REDACT_DROPPED',
                    detail: 'captured text contains a ContextPack forbiddenCaptureId',
                };
            }
            eventText = redacted.text;
        }
        let dataText;
        if (((_c = input.payload) === null || _c === void 0 ? void 0 : _c.data) !== undefined) {
            const redacted = redactValue(input.payload.data, {
                denyPaths: this.config.denyPaths,
                redactKeys: [...DEFAULT_REDACT_KEYS, ...((_d = this.config.redactKeys) !== null && _d !== void 0 ? _d : [])],
                maxChars: this.config.maxTextChars,
            });
            dataText = redacted.text;
        }
        const { evicted } = this.spool.push(Object.assign(Object.assign(Object.assign({ captureEventId, kind: input.kind, seq: this.nextSeq, time: ((_e = input.time) !== null && _e !== void 0 ? _e : new Date()).toISOString() }, (eventText ? { text: eventText } : {})), (((_f = input.payload) === null || _f === void 0 ? void 0 : _f.toolName) ? { toolName: input.payload.toolName } : {})), (dataText ? { dataJson: dataText } : {})));
        this.nextSeq += 1;
        return Object.assign({ captureEventId, status: 'accepted' }, (evicted
            ? { detail: 'spool full: oldest event evicted', errorCode: 'CAPTURE_SPOOL_FULL' }
            : {}));
    }
    /**
     * Submit all pending events as one idempotent checkpoint. Short timeout,
     * exponential backoff on 429/5xx/network errors; drained events are
     * requeued in order on any failure.
     */
    async flush() {
        var _a;
        if (this.spool.size === 0)
            return { status: 'empty' };
        const now = this.now();
        if (now < this.nextAttemptAt) {
            return { status: 'backoff', detail: `retry in ${this.nextAttemptAt - now}ms` };
        }
        const events = this.spool.drain();
        const firstSeq = events[0].seq;
        const lastSeq = events[events.length - 1].seq;
        const checkpointEvents = events.map((event) => ({
            seq: event.seq,
            type: event.toolName ? `${event.kind}:${event.toolName}` : event.kind,
            text: [event.text, event.dataJson].filter(Boolean).join('\n') || undefined,
            time: event.time,
        }));
        const payloadHash = checkpointPayloadHash({
            externalSessionId: this.config.externalSessionId,
            firstSeq,
            lastSeq,
            events: checkpointEvents,
            evidence: [],
            candidateContents: [],
        });
        try {
            const response = await this.request('/api/yootun/v1/sessions/checkpoint', {
                externalSessionId: this.config.externalSessionId,
                firstSeq,
                lastSeq,
                payloadHash,
                events: checkpointEvents,
                evidence: [],
                candidateContents: [],
            });
            if (response.ok) {
                const body = (await response.json().catch(() => null));
                if ((body === null || body === void 0 ? void 0 : body.accepted) === false) {
                    // Server already holds this (firstSeq, lastSeq, payloadHash): the
                    // retry semantics collapsed the duplicate, nothing to requeue.
                    this.attempt = 0;
                    return { status: 'duplicate', lastSequence: body.lastSequence };
                }
                this.attempt = 0;
                return { status: 'accepted', lastSequence: (_a = body === null || body === void 0 ? void 0 : body.lastSequence) !== null && _a !== void 0 ? _a : lastSeq };
            }
            this.spool.requeue(events);
            const errorCode = classifyHttpError(response.status);
            this.scheduleBackoff(errorCode);
            return {
                status: 'backoff',
                errorCode,
                detail: `checkpoint POST returned ${response.status}`,
            };
        }
        catch (error) {
            this.spool.requeue(events);
            const errorCode = classifyTransportError(error);
            this.scheduleBackoff(errorCode);
            return { status: 'backoff', errorCode, detail: String(error) };
        }
    }
    /** Test seam. */
    now() {
        return Date.now();
    }
    scheduleBackoff(code) {
        if (code === 'CAPTURE_UNAUTHORIZED') {
            // Auth failures will not heal by waiting longer; keep the retry cadence
            // flat so onboarding diagnostics surface immediately.
            this.nextAttemptAt = this.now() + BACKOFF_BASE_MS;
            return;
        }
        this.attempt += 1;
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (this.attempt - 1), BACKOFF_MAX_MS);
        this.nextAttemptAt = this.now() + delay;
    }
    async request(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            return await this.fetchImpl(`${this.config.baseUrl}${path}`, {
                method: 'POST',
                headers: Object.assign({ 'content-type': 'application/json' }, this.config.authHeaders),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timer);
        }
    }
}
function classifyHttpError(status) {
    if (status === 401 || status === 403)
        return 'CAPTURE_UNAUTHORIZED';
    if (status === 429)
        return 'CAPTURE_HTTP_429';
    if (status >= 500)
        return 'CAPTURE_HTTP_5XX';
    return 'CAPTURE_INVALID_RESPONSE';
}
function classifyTransportError(error) {
    if (error instanceof Error && error.name === 'AbortError')
        return 'CAPTURE_TIMEOUT';
    return 'CAPTURE_NETWORK_ERROR';
}
// Re-export so consumers validate acks at the boundary without another import.
export { CaptureAckSchema, SDK_VERSION };
