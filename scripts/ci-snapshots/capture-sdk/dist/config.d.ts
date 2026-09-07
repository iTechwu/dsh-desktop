import type { ContextRoleKey } from '@repo/contracts';
/**
 * Capture SDK configuration (docs/0906/ai-memory §3.1).
 *
 * The SDK NEVER derives authorization inputs: tenant, user, runtime and role
 * key come from the host agent's verified configuration and are re-checked by
 * the server on every checkpoint. Misconfiguration therefore fails closed at
 * the API boundary instead of silently landing in a default tenant.
 */
export type CaptureSdkConfig = {
    /** Knowledge API origin, e.g. `https://knowledge.dofe.ai`. No trailing slash. */
    baseUrl: string;
    tenantId: string;
    userId: string;
    /** Optional Yootun agent runtime id; enables agent-runtime spaces. */
    agentRuntimeId?: string;
    /** Canonical role key granted to this runtime. Server re-resolves to spaces. */
    scopeRoleKey: ContextRoleKey;
    externalSessionId: string;
    /** Headers attached to every request (Bearer token, MCP gateway secret). */
    authHeaders?: Record<string, string>;
    /** Fixed per network request; the agent hot path never blocks longer. */
    timeoutMs?: number;
    /** Bounded spool capacity; defaults to the contract checkpoint event cap. */
    spoolMaxSize?: number;
    /** Per-event text cap before redaction truncates (contract allows 50_000
     *  per checkpoint event; SDK keeps a tighter default). */
    maxTextChars?: number;
    /** Dot paths removed before spooling, e.g. `env.AWS_SECRET`, `tools.*.token`. */
    denyPaths?: string[];
    /** Key substrings whose values are masked. Merged with the default set. */
    redactKeys?: string[];
    /** ContextPack ids the adapter must keep out of captured input to break the
     *  recall -> capture -> recall pollution cycle (docs/0906/ai-memory §4.1). */
    forbiddenCaptureIds?: string[];
    /** Test seam; defaults to globalThis.fetch. */
    fetchImpl?: typeof fetch;
    /** Test seam for deterministic captureEventId ordering. */
    randomUUID?: () => string;
};
export declare const SDK_VERSION = "0.1.0";
export declare const DEFAULT_TIMEOUT_MS = 2000;
export declare const DEFAULT_SPOOL_MAX_SIZE = 500;
export declare const DEFAULT_MAX_TEXT_CHARS = 20000;
export declare const DEFAULT_REDACT_KEYS: string[];
export type ResolvedCaptureSdkConfig = Required<Pick<CaptureSdkConfig, 'baseUrl' | 'tenantId' | 'userId' | 'scopeRoleKey' | 'externalSessionId'>> & CaptureSdkConfig & {
    timeoutMs: number;
    spoolMaxSize: number;
    maxTextChars: number;
};
export declare function resolveConfig(config: CaptureSdkConfig): ResolvedCaptureSdkConfig;
//# sourceMappingURL=config.d.ts.map