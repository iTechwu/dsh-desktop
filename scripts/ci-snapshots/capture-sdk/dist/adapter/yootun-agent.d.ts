/**
 * Reference adapter for the Yootun Agent runtime
 * (docs/0906/ai-memory §3.1, "Capture SDK 接入真实 Agent adapter").
 *
 * Intentionally tiny: the value is the configuration shape, the lifecycle
 * helpers, and a single `run()` seam that produces a first-success-onboarding
 * signal. Real agent hosts (Claude Code hook, yootun-agent) call these
 * helpers from their own lifecycle surface — this module owns the wiring.
 */
export type YootunAgentAdapterConfig = {
    baseUrl: string;
    tenantId: string;
    userId: string;
    agentRuntimeId: string;
    scopeRoleKey: 'user.agent_runtime';
    /** Yootun agent session id. The adapter MUST NOT generate its own. */
    externalSessionId: string;
    /** Bearer or MCP gateway secret; never persisted by the SDK. */
    authorization: string;
    /** Optional: only override in tests. */
    fetchImpl?: typeof fetch;
    /** Optional: bypass the default 2s timeout for batched shutdown flushes. */
    flushTimeoutMs?: number;
    /** Optional: forbid any memory id the SDK sees on capture. */
    forbiddenCaptureIds?: string[];
};
/**
 * Translate one agent lifecycle event into a captured payload + toolName. The
 * hook surface decides the `kind`; this module decides the canonical shape.
 */
export type LifecycleEvent = {
    kind: 'session-start';
    payload?: {
        text?: string;
    };
} | {
    kind: 'user-prompt';
    payload: {
        text: string;
    };
} | {
    kind: 'post-tool-use';
    payload: {
        toolName: string;
        text?: string;
    };
} | {
    kind: 'pre-compact';
    payload?: {
        text?: string;
    };
} | {
    kind: 'post-compaction';
    payload?: {
        text?: string;
    };
} | {
    kind: 'session-end';
    payload: {
        text?: string;
    };
};
export type CaptureAckLike = {
    captureEventId: string;
    status: 'accepted' | 'rejected' | 'duplicate' | 'degraded';
    detail?: string;
};
export type AdapterHandle = {
    /** SDK version the adapter shipped with — surfaces in diagnostic probe output. */
    readonly sdkVersion: string;
    /** Number of spooled events waiting to flush. */
    pendingCount(): number;
    /** Push one lifecycle event into the bounded spool (synchronous, no IO). */
    emit(event: LifecycleEvent, options?: {
        eventId?: string;
    }): CaptureAckLike;
    /** Submit the spooled events to /sessions/checkpoint. */
    flush(): Promise<{
        status: 'accepted' | 'duplicate' | 'backoff' | 'empty';
        lastSequence?: number;
        detail?: string;
        errorCode?: string;
    }>;
    /** Best-effort shutdown: flush once with a hard deadline. */
    shutdown(options?: {
        deadlineMs?: number;
    }): Promise<{
        status: 'accepted' | 'duplicate' | 'backoff' | 'empty';
        detail?: string;
    }>;
};
/**
 * Build the Yootun Agent adapter. The runtime owns the lifecycle surface
 * (Claude Code hook, yootun-agent runtime); this builder only owns the wiring
 * between verified identity and the SDK so the host never hand-rolls headers
 * or role-key mapping.
 */
export declare function createYootunAgentAdapter(config: YootunAgentAdapterConfig): AdapterHandle;
//# sourceMappingURL=yootun-agent.d.ts.map