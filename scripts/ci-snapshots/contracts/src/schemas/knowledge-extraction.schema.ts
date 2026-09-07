import { z } from 'zod';
import { DegradedReasonSchema } from './knowledge.schema';
import { MemoryExtractionDecisionSchema } from './prisma-enums.generated';

/**
 * Phase 3 (docs/0906/01 §18 Phase 3): governed extraction from checkpoint
 * outbox events.
 *
 * The extraction pipeline borrows TencentDB's `store/update/merge/skip`
 * decision vocabulary but applies it under a stricter authority model:
 * decisions only ever act on CANDIDATE rows (never directly recallable), a
 * conflict links the candidate to the confirmed memory it competes with via
 * the `MemoryConflict` authority table, and anything the deterministic
 * policy cannot decide stays candidate + conflict → human review. There is
 * no "dedup failed → store all" downgrade path; ambiguity is surfaced, not
 * silently resolved.
 */

export const ExtractionSkipReasonSchema = z.enum([
  /** Empty or whitespace-only content after normalization. */
  'invalid-content',
  /** Content exceeded the governed length bound. */
  'content-too-long',
  /** Byte-identical CANDIDATE already exists for the same session. */
  'duplicate-candidate',
  /** Byte-identical CONFIRMED memory already carries this fact. */
  'duplicate-confirmed',
  /** Candidate referenced a space the actor cannot write. */
  'space-unauthorized',
]);
export type ExtractionSkipReason = z.infer<typeof ExtractionSkipReasonSchema>;

/** Why the deterministic policy routed a candidate into conflict review. */
export const ExtractionConflictReasonSchema = z.enum([
  /** Same normalized keywords as a CONFIRMED memory but different content. */
  'contradicts-confirmed',
  /** Near-duplicate CANDIDATE pair competing for the same fact. */
  'competing-candidates',
]);
export type ExtractionConflictReason = z.infer<typeof ExtractionConflictReasonSchema>;

export const ExtractionCandidatePlanSchema = z.object({
  /** Deterministic content hash (SHA-256) of the normalized candidate text. */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.string().min(1).max(40),
  scope: z.string().min(1).max(40),
  spaceId: z.string().uuid().nullable(),
  /** 1-based span into the checkpoint event list; provenance for review UIs. */
  sourceEventSeqStart: z.number().int().min(0),
  sourceEventSeqEnd: z.number().int().min(0),
  captureReason: z.string().trim().min(1).max(120),
});
export type ExtractionCandidatePlan = z.infer<typeof ExtractionCandidatePlanSchema>;

export const ExtractionDecisionRecordSchema = z.object({
  plan: ExtractionCandidatePlanSchema,
  decision: MemoryExtractionDecisionSchema,
  /** Set when decision === 'skip'. */
  skipReason: ExtractionSkipReasonSchema.nullable(),
  /** Candidate memory row id; set for store / update / merge. */
  candidateMemoryId: z.string().uuid().nullable(),
  /** Confirmed memory the candidate competes with; set for merge. */
  conflictingMemoryId: z.string().uuid().nullable(),
  /** MemoryConflict row id; set when a conflict record was opened. */
  conflictId: z.string().uuid().nullable(),
});
export type ExtractionDecisionRecord = z.infer<typeof ExtractionDecisionRecordSchema>;

export const ExtractionRunReportSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  tenantId: z.string().uuid(),
  userId: z.string().trim().min(1).max(160),
  externalSessionId: z.string().trim().min(1).max(255),
  checkpointEventId: z.string().uuid().nullable(),
  /** Counters — the observable surface for §19 extraction metrics. */
  total: z.number().int().nonnegative(),
  storedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  degradedReasons: z.array(DegradedReasonSchema).default([]),
  decisions: z.array(ExtractionDecisionRecordSchema).max(20),
  contractVersion: z.string().default('2026-09-05'),
});
export type ExtractionRunReport = z.infer<typeof ExtractionRunReportSchema>;
