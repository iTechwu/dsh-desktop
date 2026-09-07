import { z } from 'zod';
import {
  ExtractionSkipReasonSchema,
  ExtractionConflictReasonSchema,
} from './knowledge-extraction.schema';
import { MemoryExtractionDecisionSchema } from './prisma-enums.generated';

/**
 * Phase 3 (docs/0906/01 §18 Phase 3): generation fingerprint and evidence
 * trace for governed extraction runs.
 *
 * The contract is model-agnostic. Today the deterministic extraction policy
 * is its own "model" — the fingerprint is a SHA-256 over the canonical
 * policy fields. When an LLM adapter lands, the only thing that changes is
 * the source of `promptIdentifier` + `promptVersion`; the audit shape stays
 * the same and downstream consumers (RecallTrace, audit dashboard, replay
 * tooling) keep working.
 */

/** Stable identifier of the policy that produced the extraction run. */
export const ExtractionPromptIdentifierSchema = z.enum([
  /** Pure deterministic pipeline (rules + token overlap) — Phase 3 default. */
  'deterministic-v1',
  /** LLM-backed extraction — reserved for the future adapter. */
  'llm-v1',
]);
export type ExtractionPromptIdentifier = z.infer<typeof ExtractionPromptIdentifierSchema>;

export const ExtractionGenerationRefSchema = z.object({
  /** Stable prompt / policy identifier — flips when the model or ruleset changes. */
  promptIdentifier: ExtractionPromptIdentifierSchema,
  /** Version stamp of the policy body. Determined by the implementation; opaque to clients. */
  promptVersion: z.string().trim().min(1).max(120),
  /** SHA-256 over the canonical policy fields; equality ⇒ reproducible run. */
  promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Snapshot of the policy parameters that produced the run (tokenizer, thresholds, scan limits). */
  policySnapshot: z
    .object({
      maxContentChars: z.number().int().positive(),
      conflictOverlapThreshold: z.number().min(0).max(1),
      confirmedScanLimit: z.number().int().positive(),
      tokenizerVersion: z.string().trim().min(1).max(60),
    })
    .strict(),
});
export type ExtractionGenerationRef = z.infer<typeof ExtractionGenerationRefSchema>;

/**
 * Evidence the deterministic policy consulted before reaching a decision.
 * Empty for `store` decisions on fresh facts; populated whenever the run
 * consulted a CONFIRMED memory (skip-duplicate, skip-confirmed, or conflict
 * merge paths). Together with `ExtractionGenerationRef` this satisfies
 * §18 Phase 3 "任何 L2/L3 文本都能回溯 confirmed evidence".
 */
export const ExtractionEvidenceCitationSchema = z.object({
  /** SHA-256 of the consulted CONFIRMED memory's normalized content. */
  confirmedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Confirmed memory row id (UUID). */
  confirmedMemoryId: z.string().uuid(),
  /** Why this confirmed memory was consulted. */
  reason: z.enum(['duplicate-scan', 'conflict-scan']),
});
export type ExtractionEvidenceCitation = z.infer<typeof ExtractionEvidenceCitationSchema>;

/**
 * Wire-shape update for the decision record — adds `generationRef` to the
 * outer run report and `evidence` to each per-candidate decision. Existing
 * Phase 3 §25.3 fields stay intact; consumers that ignore the new keys keep
 * working.
 */
export const ExtractionDecisionRecordWithEvidenceSchema = z.object({
  plan: z.object({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    type: z.string().min(1).max(40),
    scope: z.string().min(1).max(40),
    spaceId: z.string().uuid().nullable(),
    sourceEventSeqStart: z.number().int().min(0),
    sourceEventSeqEnd: z.number().int().min(0),
    captureReason: z.string().trim().min(1).max(120),
  }),
  decision: MemoryExtractionDecisionSchema,
  skipReason: ExtractionSkipReasonSchema.nullable(),
  candidateMemoryId: z.string().uuid().nullable(),
  conflictingMemoryId: z.string().uuid().nullable(),
  conflictId: z.string().uuid().nullable(),
  evidence: z.array(ExtractionEvidenceCitationSchema).max(20),
});
export type ExtractionDecisionRecordWithEvidence = z.infer<
  typeof ExtractionDecisionRecordWithEvidenceSchema
>;

export const ExtractionRunReportWithGenerationSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  tenantId: z.string().uuid(),
  userId: z.string().trim().min(1).max(160),
  externalSessionId: z.string().trim().min(1).max(255),
  checkpointEventId: z.string().uuid().nullable(),
  total: z.number().int().nonnegative(),
  storedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  degradedReasons: z.array(z.string()).default([]),
  decisions: z.array(ExtractionDecisionRecordWithEvidenceSchema).max(20),
  generationRef: ExtractionGenerationRefSchema,
  contractVersion: z.string().default('2026-09-05'),
});
export type ExtractionRunReportWithGeneration = z.infer<
  typeof ExtractionRunReportWithGenerationSchema
>;
