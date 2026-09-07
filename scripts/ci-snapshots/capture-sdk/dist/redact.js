/**
 * Capture-time redaction (docs/0906/ai-memory §3.1): drop sensitive paths,
 * mask sensitive keys and enforce the body cap BEFORE the event enters the
 * spool. The earliest-drop principle means a rejected capture never leaves
 * the agent process.
 */
/**
 * Strips ContextPack identities from captured text so a recall result fed
 * back through capture cannot re-enter the candidate pipeline
 * (recall -> capture -> recall pollution cycle, docs/0906/ai-memory §14).
 */
export function redactText(text, opts) {
    var _a;
    for (const id of (_a = opts.forbiddenCaptureIds) !== null && _a !== void 0 ? _a : []) {
        if (id && text.includes(id)) {
            return { text: '', dropped: true };
        }
    }
    if (text.length > opts.maxChars) {
        return { text: text.slice(0, opts.maxChars), dropped: false };
    }
    return { text, dropped: false };
}
/**
 * Recursively removes deny paths and masks sensitive keys. Deny paths use dot
 * notation with `*` matching any single segment (`env.AWS_SECRET`,
 * `tools.*.token`). Sensitive keys are masked by substring so `apiKey`,
 * `GITHUB_TOKEN` and `credentials.json` all hit. Serialized output beyond
 * `maxChars` truncates; capture content never silently exceeds the budget.
 */
export function redactValue(value, opts) {
    var _a, _b;
    const denyPatterns = ((_a = opts.denyPaths) !== null && _a !== void 0 ? _a : []).filter(Boolean).map((path) => path.split('.'));
    const masked = maskDeep(value, denyPatterns, opts.redactKeys, []);
    const text = ((_b = JSON.stringify(masked)) !== null && _b !== void 0 ? _b : 'null').slice(0, opts.maxChars);
    return { value: masked, text };
}
function maskDeep(value, denyPatterns, redactKeys, path) {
    if (Array.isArray(value)) {
        return value.map((entry, index) => maskDeep(entry, denyPatterns, redactKeys, [...path, String(index)]));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            const childPath = [...path, key];
            if (isDenied(childPath, denyPatterns))
                continue;
            out[key] = isSensitiveKey(key, redactKeys)
                ? '[REDACTED]'
                : maskDeep(entry, denyPatterns, redactKeys, childPath);
        }
        return out;
    }
    return value;
}
function isDenied(path, denyPatterns) {
    return denyPatterns.some((pattern) => pattern.length === path.length &&
        pattern.every((segment, index) => segment === '*' || segment === path[index]));
}
function isSensitiveKey(key, redactKeys) {
    const normalized = key.toLowerCase();
    return redactKeys.some((needle) => normalized.includes(needle));
}
