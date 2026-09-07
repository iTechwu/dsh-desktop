import { CaptureSdk } from '../capture-sdk';
import { SDK_VERSION } from '../config';
/**
 * Build the Yootun Agent adapter. The runtime owns the lifecycle surface
 * (Claude Code hook, yootun-agent runtime); this builder only owns the wiring
 * between verified identity and the SDK so the host never hand-rolls headers
 * or role-key mapping.
 */
export function createYootunAgentAdapter(config) {
    const sdkConfig = Object.assign({ baseUrl: config.baseUrl, tenantId: config.tenantId, userId: config.userId, agentRuntimeId: config.agentRuntimeId, scopeRoleKey: config.scopeRoleKey, externalSessionId: config.externalSessionId, authHeaders: { authorization: config.authorization }, forbiddenCaptureIds: config.forbiddenCaptureIds }, (config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}));
    const sdk = new CaptureSdk(sdkConfig);
    return {
        sdkVersion: SDK_VERSION,
        pendingCount: () => sdk.pendingCount,
        emit(event, options) {
            const ack = sdk.capture(Object.assign(Object.assign({ kind: event.kind }, (event.payload ? { payload: event.payload } : {})), ((options === null || options === void 0 ? void 0 : options.eventId) ? { eventId: options.eventId } : {})));
            return Object.assign({ captureEventId: ack.captureEventId, status: ack.status }, (ack.detail ? { detail: ack.detail } : {}));
        },
        flush: () => sdk.flush(),
        async shutdown(options) {
            if (sdk.pendingCount === 0)
                return { status: 'empty' };
            // Soft deadline: SDK already aborts at `timeoutMs` (2s); a host that
            // needs to exit cleanly can override per-call.
            if ((options === null || options === void 0 ? void 0 : options.deadlineMs) && options.deadlineMs < sdk.retryInMs) {
                return {
                    status: 'backoff',
                    detail: `adapter shutdown skipped flush (retry in ${sdk.retryInMs}ms)`,
                };
            }
            return sdk.flush();
        },
    };
}
