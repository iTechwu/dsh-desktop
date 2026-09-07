/**
 * Capture-time redaction (docs/0906/ai-memory §3.1): drop sensitive paths,
 * mask sensitive keys and enforce the body cap BEFORE the event enters the
 * spool. The earliest-drop principle means a rejected capture never leaves
 * the agent process.
 */
export type RedactTextResult = {
    text: string;
    /** True when the whole capture must be dropped (forbidden id present). */
    dropped: boolean;
};
/**
 * Strips ContextPack identities from captured text so a recall result fed
 * back through capture cannot re-enter the candidate pipeline
 * (recall -> capture -> recall pollution cycle, docs/0906/ai-memory §14).
 */
export declare function redactText(text: string, opts: {
    maxChars: number;
    forbiddenCaptureIds?: string[];
}): RedactTextResult;
export type RedactValueResult = {
    /** Redacted object plus its bounded JSON serialization. */
    value: unknown;
    text: string;
};
/**
 * Recursively removes deny paths and masks sensitive keys. Deny paths use dot
 * notation with `*` matching any single segment (`env.AWS_SECRET`,
 * `tools.*.token`). Sensitive keys are masked by substring so `apiKey`,
 * `GITHUB_TOKEN` and `credentials.json` all hit. Serialized output beyond
 * `maxChars` truncates; capture content never silently exceeds the budget.
 */
export declare function redactValue(value: unknown, opts: {
    denyPaths?: string[];
    redactKeys: string[];
    maxChars: number;
}): RedactValueResult;
//# sourceMappingURL=redact.d.ts.map