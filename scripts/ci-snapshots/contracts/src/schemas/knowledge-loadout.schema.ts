import { z } from 'zod';
import { ContextRoleKeySchema, DegradedReasonSchema, McpSpaceKeySchema } from './knowledge.schema';

/**
 * Phase 3 (docs/0906/01 §18 Phase 3): ContextProfile / Loadout contract.
 *
 * A Loadout is the server-derived, immutable view of "what this verified
 * runtime may carry into a turn": bound spaces, pinned asset versions,
 * injection modes and policy limits. It answers the TencentDB
 * Fixed-Agent-Asset question with a stronger authority model — the client
 * never declares bindings, it only presents the loadout digest back for
 * cache-safe reuse.
 *
 * The `digest` is a server-side SHA-256 over the canonical entry set. Two
 * calls with identical authorization produce identical digests, so the agent
 * adapter can cache the rendered prompt head; any grant/pin/expiry change
 * rotates the digest and forces re-render.
 */

/** How the adapter should inject a bound space's context into the prompt. */
export const InjectionModeSchema = z.enum([
  /** Delivered inside the ContextPack stable channel (system prompt tail). */
  'stable-context',
  /** Registered as an on-demand tool; content is fetched by explicit call. */
  'on-demand-tool',
  /** Digest-only: the entry is announced but content stays behind ACL reads. */
  'reference-only',
]);
export type InjectionMode = z.infer<typeof InjectionModeSchema>;

export const LoadoutEntrySchema = z.object({
  /** Canonical role key that produced this binding (server-resolved). */
  spaceKey: McpSpaceKeySchema,
  /** Resolved space UUID — server-derived, echoed for citation convenience. */
  spaceId: z.string().uuid(),
  /** Ordering hint; higher binds earlier. Server assigns from role priority. */
  priority: z.number().int().min(0).max(1000),
  injectionMode: InjectionModeSchema,
  /** Optional immutable revision pin: the loadout only serves this revision. */
  pinnedRevisionId: z.string().uuid().nullable(),
  /** Loadout validity window; expired entries are dropped before assembly. */
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date().nullable(),
});
export type LoadoutEntry = z.infer<typeof LoadoutEntrySchema>;

export const ContextLoadoutSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  tenantId: z.string().uuid(),
  /** Verified caller subject — server-derived, never client-declared. */
  userId: z.string().trim().min(1).max(160),
  agentRuntimeId: z.string().trim().max(160).nullable(),
  roleKeys: z.array(ContextRoleKeySchema).min(1).max(8),
  entries: z.array(LoadoutEntrySchema).max(50),
  /** Policy limits the adapter must honor when rendering the prompt. */
  policies: z.object({
    /** Hard ceiling for the dynamic recall channel inside the pack. */
    maxRecallTokens: z.number().int().min(64).max(32_000),
    /** Hard ceiling for stable-context tokens. */
    maxStableTokens: z.number().int().min(0).max(32_000),
    /** Whether the runtime may create memory candidates (policy.autoCapture). */
    allowCandidateCapture: z.boolean(),
    /** Whether confirm/forget require admin approval (policy.requireApprovalFor). */
    requireApprovalFor: z
      .array(z.enum(['memory.confirm', 'memory.forget', 'memory.export']))
      .max(3),
  }),
  /** Server-computed SHA-256 over the canonical entry+policies set. */
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.coerce.date(),
  contractVersion: z.string().default('2026-09-05'),
  degradedReasons: z.array(DegradedReasonSchema).default([]),
});
export type ContextLoadout = z.infer<typeof ContextLoadoutSchema>;

/** MCP input: the runtime may only re-request its own loadout. */
export const McpLoadoutSchema = z.object({
  /** Echo a previously issued digest to check it is still valid. */
  ifNoneMatch: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type McpLoadout = z.infer<typeof McpLoadoutSchema>;

export const LoadoutCheckResultSchema = z.object({
  /** True when the presented digest matches the freshly assembled loadout. */
  fresh: z.boolean(),
  presentedDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  currentDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type LoadoutCheckResult = z.infer<typeof LoadoutCheckResultSchema>;
