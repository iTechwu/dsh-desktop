export const SDK_VERSION = '0.1.0';
export const DEFAULT_TIMEOUT_MS = 2000;
export const DEFAULT_SPOOL_MAX_SIZE = 500;
export const DEFAULT_MAX_TEXT_CHARS = 20000;
export const DEFAULT_REDACT_KEYS = [
    'password',
    'secret',
    'token',
    'apikey',
    'api_key',
    'authorization',
    'cookie',
    'credential',
    'private_key',
    'privatekey',
];
export function resolveConfig(config) {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (!baseUrl)
        throw new Error('CaptureSdkConfig.baseUrl is required');
    if (!config.tenantId)
        throw new Error('CaptureSdkConfig.tenantId is required');
    if (!config.userId)
        throw new Error('CaptureSdkConfig.userId is required');
    if (!config.externalSessionId)
        throw new Error('CaptureSdkConfig.externalSessionId is required');
    return Object.assign(Object.assign({ timeoutMs: DEFAULT_TIMEOUT_MS, spoolMaxSize: DEFAULT_SPOOL_MAX_SIZE, maxTextChars: DEFAULT_MAX_TEXT_CHARS }, config), { baseUrl });
}
