import { CaptureProbeReportSchema, } from '@repo/contracts';
import { checkpointPayloadHash, defaultRandomUUID } from './idempotency.js';
import { resolveConfig, SDK_VERSION, } from './config.js';
const MCP_PATH = '/mcp';
const CHECKPOINT_PATH = '/api/yootun/v1/sessions/checkpoint';
const RECALL_PATH = '/api/yootun/v1/memory/recall';
/**
 * Four-step onboarding diagnostic (docs/0906/ai-memory §3.1):
 * `status -> capability probe -> test checkpoint -> test recall`.
 *
 * Every step runs against the live API with the caller's own credentials, so
 * a green report proves this runtime's identity actually flows through
 * authorization — not just that the host is reachable. Steps run in order and
 * stop at the first failure; the report is a contract `CaptureProbeReport`
 * the onboarding console can render with copyable error codes.
 */
export async function runCaptureProbe(config, fetchImpl = (...args) => fetch(...args)) {
    const resolved = resolveConfig(config);
    const steps = [];
    const status = await step(fetchImpl, 'status', () => probeStatus(resolved, fetchImpl));
    steps.push(status);
    if (!status.ok)
        return finish(resolved, steps);
    const capability = await step(fetchImpl, 'capability', () => probeCapability(resolved, fetchImpl));
    steps.push(capability);
    if (!capability.ok)
        return finish(resolved, steps);
    const testCheckpoint = await step(fetchImpl, 'test-checkpoint', () => probeTestCheckpoint(resolved, fetchImpl));
    steps.push(testCheckpoint);
    if (!testCheckpoint.ok)
        return finish(resolved, steps);
    steps.push(await step(fetchImpl, 'test-recall', () => probeTestRecall(resolved, fetchImpl)));
    return finish(resolved, steps);
}
async function step(fetchImpl, name, run) {
    const startedAt = Date.now();
    try {
        const outcome = await run();
        return Object.assign(Object.assign({ step: name, ok: outcome.ok, latencyMs: Date.now() - startedAt }, (outcome.detail ? { detail: outcome.detail } : {})), (outcome.errorCode ? { errorCode: outcome.errorCode } : {}));
    }
    catch (error) {
        return {
            step: name,
            ok: false,
            latencyMs: Date.now() - startedAt,
            errorCode: error instanceof Error && error.name === 'AbortError'
                ? 'CAPTURE_TIMEOUT'
                : 'CAPTURE_NETWORK_ERROR',
            detail: String(error).slice(0, 500),
        };
    }
}
async function postJson(fetchImpl, config, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
        const response = await fetchImpl(`${config.baseUrl}${path}`, {
            method: 'POST',
            headers: Object.assign({ 'content-type': 'application/json' }, config.authHeaders),
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const json = await response.json().catch(() => null);
        return { status: response.status, json };
    }
    finally {
        clearTimeout(timer);
    }
}
async function probeStatus(config, fetchImpl) {
    var _a;
    const { status, json } = await postJson(fetchImpl, config, MCP_PATH, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
    });
    if (status !== 200) {
        return {
            ok: false,
            errorCode: status === 401 || status === 403 ? 'CAPTURE_UNAUTHORIZED' : 'CAPTURE_INVALID_RESPONSE',
            detail: `MCP initialize returned ${status}`,
        };
    }
    const serverInfo = (_a = json === null || json === void 0 ? void 0 : json.result) === null || _a === void 0 ? void 0 : _a.serverInfo;
    return {
        ok: true,
        detail: (serverInfo === null || serverInfo === void 0 ? void 0 : serverInfo.version) ? `server ${serverInfo.version}` : 'MCP reachable',
    };
}
async function probeCapability(config, fetchImpl) {
    var _a, _b;
    const { status, json } = await postJson(fetchImpl, config, MCP_PATH, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
    });
    const names = ((_b = (_a = json === null || json === void 0 ? void 0 : json.result) === null || _a === void 0 ? void 0 : _a.tools) !== null && _b !== void 0 ? _b : [])
        .map((tool) => { var _a; return (_a = tool.name) !== null && _a !== void 0 ? _a : ''; })
        .filter(Boolean);
    if (status !== 200 || names.length === 0) {
        return {
            ok: false,
            errorCode: 'CAPTURE_INVALID_RESPONSE',
            detail: `tools/list returned ${status}`,
        };
    }
    const required = ['knowledge.session_checkpoint', 'knowledge.context_pack'];
    const missing = required.filter((name) => !names.includes(name));
    if (missing.length > 0) {
        return {
            ok: false,
            errorCode: 'CAPTURE_INVALID_RESPONSE',
            detail: `missing tools: ${missing.join(', ')}`,
        };
    }
    return { ok: true, detail: `${names.length} tools; capture tools present` };
}
async function probeTestCheckpoint(config, fetchImpl) {
    // Empty probe session: idempotent, no candidate contents, no events — the
    // server stores one throwaway checkpoint row that proves identity + schema.
    const externalSessionId = `capture-sdk-probe-${defaultRandomUUID()}`;
    const body = {
        externalSessionId,
        firstSeq: 0,
        lastSeq: 0,
        payloadHash: checkpointPayloadHash({
            externalSessionId,
            firstSeq: 0,
            lastSeq: 0,
            events: [],
            evidence: [],
            candidateContents: [],
        }),
        events: [],
        evidence: [],
        candidateContents: [],
    };
    const { status, json } = await postJson(fetchImpl, config, CHECKPOINT_PATH, body);
    if (status !== 200) {
        return {
            ok: false,
            errorCode: status === 401 || status === 403 ? 'CAPTURE_UNAUTHORIZED' : 'CAPTURE_INVALID_RESPONSE',
            detail: `test checkpoint returned ${status}`,
        };
    }
    const accepted = json === null || json === void 0 ? void 0 : json.accepted;
    return accepted
        ? { ok: true, detail: 'checkpoint accepted for this identity' }
        : { ok: false, errorCode: 'CAPTURE_INVALID_RESPONSE', detail: 'checkpoint not accepted' };
}
async function probeTestRecall(config, fetchImpl) {
    const { status } = await postJson(fetchImpl, config, RECALL_PATH, {
        query: 'capture-sdk-probe',
        topK: 1,
        includeMemories: true,
        includeDocuments: true,
        retrievalMode: 'lexical-v1',
    });
    if (status !== 200) {
        return {
            ok: false,
            errorCode: status === 401 || status === 403 ? 'CAPTURE_UNAUTHORIZED' : 'CAPTURE_INVALID_RESPONSE',
            detail: `test recall returned ${status}`,
        };
    }
    return { ok: true, detail: 'authorized recall responded (lexical-v1)' };
}
function finish(config, steps) {
    const report = {
        sdkVersion: SDK_VERSION,
        baseUrl: config.baseUrl,
        ranAt: new Date(),
        steps,
        ok: steps.every((entry) => entry.ok),
    };
    return CaptureProbeReportSchema.parse(report);
}
