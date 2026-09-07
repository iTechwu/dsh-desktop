import { type CaptureProbeReport } from '@repo/contracts';
import { type CaptureSdkConfig } from './config';
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
export declare function runCaptureProbe(config: CaptureSdkConfig, fetchImpl?: typeof fetch): Promise<CaptureProbeReport>;
//# sourceMappingURL=probe.d.ts.map