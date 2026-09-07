import { z } from 'zod';
import {
  ProvenanceActorTypeSchema,
  ProvenanceActivityTypeSchema,
  ProvenanceEntityTypeSchema,
  type ProvenanceActorType,
  type ProvenanceActivityType,
  type ProvenanceEntityType,
} from './prisma-enums.generated';

/**
 * Semantica 路线图（docs/0906/02 §4-§7）落地的契约层：
 *
 * - P0-1 Ingestion Pipeline Manifest：把抽取/切分/向量/图投影抽象为带版本、依赖、
 *   幂等键和指标的可重放 step，状态保存在 PostgreSQL authority；
 * - P0-2 Provenance & Derivation：hash chain + 失效 tombstone 的最小审计 envelope，
 *   仅写 hash / locator / refs，不落 query / 敏感正文；
 * - P0-3 Bounded GraphRAG：seed -> 有界多跳 -> PostgreSQL final re-check 的闭集合同，
 *   输出 path / reasonCodes / rankBreakdown；
 * - P0-4 Entity/Fact Quality Gate：实体 / 关系 assertion 的 Zod-first 闭集 schema
 *   + 状态机，便于在 CI 和发布前门禁复用。
 *
 * 设计原则：
 *
 * 1. PostgreSQL 是唯一权威；本文件只定义跨服务的闭集合同和类型，不引入新数据库。
 * 2. 所有 hash 字段为 64 位十六进制字符串（SHA-256）。
 * 3. 所有 enum 是闭集合，扩字段必须经 `addIssue` 拒绝，避免 LLM/抽取漂移。
 * 4. 与 `knowledge.schema.ts` 的现有 `RecallReasonCodeSchema` / `DegradedReasonSchema`
 *    协同工作；reason codes 单源在 `semantica.schema.ts` 中聚合。
 */

// ============================================================================
// P0-1 Ingestion Pipeline Manifest
// ============================================================================

/** Explicit audit reason for a successful extract step with zero candidates. */
export const ExtractorNoCandidateReasonSchema = z.enum(['no-extractable-assertion']);
export type ExtractorNoCandidateReason = z.infer<typeof ExtractorNoCandidateReasonSchema>;

/** Closed set of pipeline step kinds we run today. */
export const PipelineStepKindSchema = z.enum([
  /** 拉取 source / integration object 到本地暂存或外部对象存储。 */
  'source-sync',
  /** 内容审查 / malware 扫描 / MIME sniffing / 主条款解析。 */
  'parse',
  /** 字符归一、日期/数字/语言归一、脱敏标记。 */
  'normalize',
  /** chunk 切分；保持 chunk id 稳定，可幂等。 */
  'split',
  /** 生成 chunk embedding（消费 Qdrant）。 */
  'embed',
  /** 抽取实体 / 关系 / 事件，输出 assertion 候选。 */
  'extract',
  /** 实体消歧、冲突检测、证据校验。 */
  'quality-gate',
  /** 写入 Qdrant / Neo4j / MinIO 投影。 */
  'projection',
]);
export type PipelineStepKind = z.infer<typeof PipelineStepKindSchema>;

/** Pipeline step status: durable, server-derived. */
export const PipelineStepStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTER',
  'SKIPPED',
]);
export type PipelineStepStatus = z.infer<typeof PipelineStepStatusSchema>;

/**
 * Idempotency key + version pair that drives the pipeline step replay contract.
 * `inputHash` is a canonical hash of the inputs that produced this step attempt.
 */
export const PipelineStepIdempotencySchema = z.object({
  /** Stable idempotency key, scoped to definition + tenant + inputHash. */
  idempotencyKey: z.string().min(8).max(128),
  /** Definition version this step conforms to. */
  definitionVersion: z.string().min(1).max(32),
  /** Canonical hash of the inputs (tenant + source/doc + revision + ext). */
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PipelineStepIdempotency = z.infer<typeof PipelineStepIdempotencySchema>;

/**
 * Pipeline step definition (immutable, deployed with the pipeline binary).
 * Mirrors Semantica `PipelineStep` (parallel_safe, dependencies, version chain)
 * but is a closed set contract; runtime state lives in PostgreSQL `IngestionJob`.
 */
export const PipelineStepDefinitionSchema = z.object({
  stepKey: z.string().min(1).max(64),
  stepKind: PipelineStepKindSchema,
  /** Explicit dependency keys within the same definition. */
  dependsOn: z.array(z.string().min(1).max(64)).default([]),
  /** Only steps that mark this flag may run in parallel layers. */
  parallelSafe: z.boolean().default(false),
  /** Config hash so workers can detect definition drift. */
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Closed set of expected artifact types — keeps outputs machine-readable. */
  produces: z
    .array(
      z.enum([
        'raw-object',
        'parsed-document',
        'chunk',
        'embedding',
        'entity-assertion',
        'relation-assertion',
        'projection-payload',
      ]),
    )
    .default([]),
  /** Max attempts before the step is dead-lettered; non-retryable errors short-circuit. */
  maxAttempts: z.number().int().min(1).max(10).default(3),
  /** Wall-clock cap before the step lease is reclaimed; minutes. */
  timeoutMinutes: z.number().int().min(1).max(120).default(15),
});
export type PipelineStepDefinition = z.infer<typeof PipelineStepDefinitionSchema>;

/** Pipeline definition — the deployable artifact. */
export const PipelineDefinitionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(120),
  schemaVersion: z.string().min(1).max(32),
  extractorVersion: z.string().min(1).max(32),
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
  active: z.boolean(),
  steps: z.array(PipelineStepDefinitionSchema).min(1),
});
export type PipelineDefinition = z.infer<typeof PipelineDefinitionSchema>;

/**
 * Runtime step state. Persisted on PostgreSQL `IngestionJob.metadata` (Phase 1)
 * and on a dedicated `pipeline_step_runs` table once we need cross-step retries.
 */
export const PipelineStepRunSchema = z.object({
  runId: z.string().uuid(),
  stepKey: z.string().min(1).max(64),
  status: PipelineStepStatusSchema,
  attempt: z.number().int().min(0).max(10),
  inputRefs: z.array(z.string().uuid()),
  outputRefs: z.array(z.string().uuid()),
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
  workerId: z.string().min(1).max(64).nullable(),
  startedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  metrics: z
    .object({
      latencyMs: z.number().int().nonnegative(),
      inputCount: z.number().int().nonnegative(),
      outputCount: z.number().int().nonnegative(),
      rejectedCount: z.number().int().nonnegative(),
      tokenCost: z.number().int().nonnegative().optional(),
      redactionCount: z.number().int().nonnegative().optional(),
      noCandidateReason: ExtractorNoCandidateReasonSchema.optional(),
    })
    .nullable(),
  errorCode: z.string().min(1).max(120).nullable(),
});
export type PipelineStepRun = z.infer<typeof PipelineStepRunSchema>;

// ============================================================================
// P0-2 Provenance & Derivation
// ============================================================================
//
// 闭集枚举（ProvenanceEntityType / ProvenanceActivityType / ProvenanceActorType）
// 与 PostgreSQL enum 一一对应；直接 re-export 自动生成的 schema 以避免重复
// 定义导致的命名冲突。值使用 SCREAMING_SNAKE_CASE 以匹配 SQL 字面量。
//
// Re-exports keep backwards compatibility for callers importing from
// `@repo/contracts`:
export {
  ProvenanceEntityTypeSchema,
  type ProvenanceEntityType,
  ProvenanceActivityTypeSchema,
  type ProvenanceActivityType,
  ProvenanceActorTypeSchema,
  type ProvenanceActorType,
};

/**
 * Provenance entry — minimal PROV-O inspired envelope. We never persist content
 * payloads here; only refs, hashes, locator hashes and chain pointers.
 */
export const ProvenanceEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityType: ProvenanceEntityTypeSchema,
  entityId: z.string().uuid(),
  activityType: ProvenanceActivityTypeSchema,
  activityVersion: z.string().min(1).max(32),
  runId: z.string().uuid().nullable(),
  stepRunId: z.string().uuid().nullable(),
  actorId: z.string().min(1).max(128),
  actorType: ProvenanceActorTypeSchema,
  sourceSystem: z.string().min(1).max(64).nullable(),
  sourceDocumentId: z.string().uuid().nullable(),
  sourceRevisionId: z.string().uuid().nullable(),
  sourceChunkId: z.string().uuid().nullable(),
  locatorHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  inputRefs: z.array(z.string().uuid()).default([]),
  outputRefs: z.array(z.string().uuid()).default([]),
  derivedFromId: z.string().uuid().nullable(),
  previousVersionId: z.string().uuid().nullable(),
  validFrom: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  recordedAt: z.coerce.date(),
  confidence: z.number().min(0).max(1).nullable(),
  sourceCredibility: z.number().min(0).max(1).nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sequenceNo: z.number().int().nonnegative(),
  previousChainHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  invalidatedAt: z.coerce.date().nullable(),
  invalidatedBy: z.string().min(1).max(128).nullable(),
  invalidationReason: z.string().max(500).nullable(),
});
export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;

/**
 * Compact derivation record — what an entity was derived from, what produced
 * it, and which outputs it feeds. Used by Explain API and graph projections.
 */
export const DerivationRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityType: ProvenanceEntityTypeSchema,
  entityId: z.string().uuid(),
  activityType: ProvenanceActivityTypeSchema,
  derivedFrom: z.array(z.string().uuid()).default([]),
  producedOutputs: z.array(z.string().uuid()).default([]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.coerce.date(),
});
export type DerivationRecord = z.infer<typeof DerivationRecordSchema>;

// ============================================================================
// P0-3 Bounded GraphRAG Retrieval Contract
// ============================================================================

/**
 * Retrieval mode closed set. Adding a mode requires bumping the contract version
 * and adding explicit ReasonCode / DegradedReason mappings.
 */
export const SemanticRetrievalModeSchema = z.enum([
  'lexical-v1',
  'hybrid-vector-v1',
  'hybrid-rrf-v1',
  'graphrag-bounded-v1',
]);
export type SemanticRetrievalMode = z.infer<typeof SemanticRetrievalModeSchema>;

/** Closed set of bounded graph expansion options. */
export const GraphExpansionBudgetSchema = z.object({
  maxHops: z.number().int().min(1).max(4).default(2),
  maxNodes: z.number().int().min(1).max(500).default(64),
  maxEdges: z.number().int().min(1).max(500).default(128),
  timeoutMs: z.number().int().min(100).max(10000).default(1500),
  /** Whitelist of relation predicates the caller is allowed to traverse. */
  relationAllowList: z.array(z.string().min(1).max(80)).max(50).default([]),
});
export type GraphExpansionBudget = z.infer<typeof GraphExpansionBudgetSchema>;

/** Single step in a GraphRAG path: subject -> predicate -> object. */
export const GraphPathStepSchema = z.object({
  hop: z.number().int().min(1).max(4),
  subjectEntityId: z.string().uuid(),
  predicate: z.string().min(1).max(80),
  objectEntityId: z.string().uuid(),
  /** Confidence propagated by the relation assertion. */
  confidence: z.number().min(0).max(1),
  /** Why this step survives PostgreSQL ACL / validity recheck. */
  reasonCodes: z.array(z.string().min(1).max(64)),
});
export type GraphPathStep = z.infer<typeof GraphPathStepSchema>;

/** Compact GraphRAG path explanation, never includes content. */
export const GraphPathExplanationSchema = z.object({
  seedCandidateId: z.string().uuid(),
  steps: z.array(GraphPathStepSchema).max(20),
  truncated: z.boolean(),
  totalHops: z.number().int().nonnegative(),
});
export type GraphPathExplanation = z.infer<typeof GraphPathExplanationSchema>;

// ============================================================================
// P0-4 Entity / Fact / Conflict Quality Gate
// ============================================================================

/** Entity status — closed state machine (see docs/0906/02 §7.2). */
export const EntityAssertionStatusSchema = z.enum([
  'EXTRACTED',
  'VALIDATED',
  'CANDIDATE',
  'CANONICAL',
  'CONFLICTED',
  'REJECTED',
  'SUPERSEDED',
  'MERGED',
]);
export type EntityAssertionStatus = z.infer<typeof EntityAssertionStatusSchema>;

/** Relation status — same state machine as entity. */
export const RelationAssertionStatusSchema = z.enum([
  'EXTRACTED',
  'VALIDATED',
  'CANDIDATE',
  'CONFIRMED',
  'CONFLICTED',
  'SUPERSEDED',
  'REJECTED',
]);
export type RelationAssertionStatus = z.infer<typeof RelationAssertionStatusSchema>;

/**
 * Canonical keys must be deterministic (lowercase, trimmed). Identifiers that
 * are canonical-by-external-id (CVE, unified social credit code, document external
 * id) take precedence in merge resolution.
 */
export const CanonicalKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_./:@-]+$/, 'canonical key must be a stable identifier');

/** Locator hash + selector for evidence attached to an assertion. */
export const AssertionLocatorSchema = z.object({
  /** Nullable: evidence-less candidates are legal input and the quality
   *  gate flags them as `missing-evidence` rather than schema violations. */
  sourceRevisionId: z.string().uuid().nullable(),
  sourceChunkId: z.string().uuid().nullable(),
  locator: z.record(z.string(), z.unknown()).nullable(),
  locatorHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Extractor version that produced this assertion. */
  extractorVersion: z.string().min(1).max(32),
});
export type AssertionLocator = z.infer<typeof AssertionLocatorSchema>;

/** Closed set of entity types — keeps predicate typing and ontology merging stable. */
export const EntityTypeSchema = z.enum([
  'PERSON',
  'ORGANIZATION',
  'PRODUCT',
  'LOCATION',
  'EVENT',
  'CONCEPT',
  'DOCUMENT',
  'REGULATION',
  'OTHER',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

/** Entity assertion — what an extractor (or LLM) produced. */
export const EntityAssertionSchema = z.object({
  entityKey: CanonicalKeySchema,
  entityType: EntityTypeSchema,
  displayName: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  confidence: z.number().min(0).max(1),
  locator: AssertionLocatorSchema,
  validFrom: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
});
export type EntityAssertion = z.infer<typeof EntityAssertionSchema>;

/** Closed set of relation predicates. New predicates must extend this list. */
export const RelationPredicateSchema = z.enum([
  'WORKS_FOR',
  'LOCATED_IN',
  'PART_OF',
  'OWNS',
  'MANAGES',
  'PRODUCES',
  'MENTIONS',
  'REFERENCES',
  'CONTRADICTS',
  'PRECEDENT_FOR',
  'INFLUENCED',
  'CAUSED',
  'SUPERSEDES',
]);
export type RelationPredicate = z.infer<typeof RelationPredicateSchema>;

/** Relation assertion — must reference entities by canonical key, never by name. */
export const RelationAssertionSchema = z.object({
  subjectKey: CanonicalKeySchema,
  predicate: RelationPredicateSchema,
  objectKey: CanonicalKeySchema,
  confidence: z.number().min(0).max(1),
  temporalConfidence: z.number().min(0).max(1).nullable(),
  validFrom: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  locator: AssertionLocatorSchema,
});
export type RelationAssertion = z.infer<typeof RelationAssertionSchema>;

const validateExtractorCandidatePresence = (
  output: { entities: unknown[]; relations: unknown[]; noCandidateReason: string | null },
  context: z.RefinementCtx,
) => {
  const hasCandidates = output.entities.length + output.relations.length > 0;
  if (!hasCandidates && output.noCandidateReason === null) {
    context.addIssue({
      code: 'custom',
      path: ['noCandidateReason'],
      message: 'empty extraction output requires an explicit no-candidate reason',
    });
  }
  if (hasCandidates && output.noCandidateReason !== null) {
    context.addIssue({
      code: 'custom',
      path: ['noCandidateReason'],
      message: 'no-candidate reason is only valid when candidates are empty',
    });
  }
};

/**
 * Untrusted model output deliberately excludes evidence locators. The server
 * attaches the already-authorized source revision/chunk after parsing so a
 * model can never choose or forge authority references.
 */
export const ExtractorModelOutputSchema = z
  .object({
    entities: z
      .array(EntityAssertionSchema.omit({ locator: true }).strict())
      .max(200)
      .default([]),
    relations: z
      .array(RelationAssertionSchema.omit({ locator: true }).strict())
      .max(200)
      .default([]),
    noCandidateReason: ExtractorNoCandidateReasonSchema.nullable().default(null),
  })
  .strict()
  .superRefine(validateExtractorCandidatePresence);
export type ExtractorModelOutput = z.infer<typeof ExtractorModelOutputSchema>;

/**
 * Extractor run descriptor (docs/0906/semantica/02 §7.1)：LLM 或确定性
 * extractor 产出一批 candidate 时的锚定描述。LLM 只产生 candidate，绝不
 * 直接写 CONFIRMED authority；promptHash/configHash 让同一批次可以按
 * prompt 与配置精确重放。
 */
export const ExtractorRunDescriptorSchema = z.object({
  extractorVersion: z.string().min(1).max(32),
  schemaVersion: z.string().min(1).max(32),
  /** 生成批次所用的 prompt 标识；确定性 extractor 为 null。 */
  promptId: z.string().min(1).max(120).nullable(),
  /** prompt 正文的 SHA-256；LLM 批次必填，确定性 extractor 为 null。 */
  promptHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  /** 生成模型标识；确定性 extractor 用固定占位（如 'deterministic'）。 */
  model: z.string().min(1).max(120),
  modelVersion: z.string().min(1).max(120).nullable(),
  /** extractor 配置 canonical JSON 的 SHA-256。 */
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExtractorRunDescriptor = z.infer<typeof ExtractorRunDescriptorSchema>;

/**
 * Extractor candidate batch — pipeline `extract` step 的标准产物。边界处
 * Zod parse；违例即 contract-violation（NON_RETRYABLE），绝不进入门禁。
 */
export const ExtractorCandidateBatchSchema = z
  .object({
    descriptor: ExtractorRunDescriptorSchema,
    entities: z.array(EntityAssertionSchema).max(200).default([]),
    relations: z.array(RelationAssertionSchema).max(200).default([]),
    noCandidateReason: ExtractorNoCandidateReasonSchema.nullable().default(null),
  })
  .superRefine(validateExtractorCandidatePresence);
export type ExtractorCandidateBatch = z.infer<typeof ExtractorCandidateBatchSchema>;

/** Quality gate report — emitted by the validation step before projection. */
export const QualityGateReportSchema = z.object({
  stepRunId: z.string().uuid(),
  entityCount: z.number().int().nonnegative(),
  relationCount: z.number().int().nonnegative(),
  rejectedEntities: z.number().int().nonnegative(),
  rejectedRelations: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  reasons: z.array(
    z.object({
      code: z.enum([
        'missing-evidence',
        'invalid-endpoint',
        'temporal-inversion',
        'unknown-predicate',
        'cross-tenant-leak',
        'invalid-canonical-key',
        'low-confidence',
        'sensitive-field-overshared',
      ]),
      count: z.number().int().nonnegative(),
    }),
  ),
  passed: z.boolean(),
});
export type QualityGateReport = z.infer<typeof QualityGateReportSchema>;

/**
 * Closed set of recall reason codes augmented with bounded GraphRAG semantics.
 * Existing codes (lexical-text-match, qdrant-vector-hit, …) live in
 * `knowledge.schema.ts`; we re-export a combined list here for documentation.
 */
export const GraphRecallReasonCodeSchema = z.enum([
  'graph-seed-entity',
  'graph-hop-1',
  'graph-hop-2',
  'graph-hop-3',
  'graph-hop-4',
  'graph-truncated',
  'entity-canonical-resolved',
  'entity-rejected-by-gate',
  'relation-superseded',
  'relation-conflicted',
]);
export type GraphRecallReasonCode = z.infer<typeof GraphRecallReasonCodeSchema>;

// ============================================================================
// P1-1 Decision Intelligence (minimal contract)
// ============================================================================

/** DecisionRecord is the canonical object recording "why" an agent acted. */
export const DecisionRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  actorId: z.string().min(1).max(128),
  agentRuntimeId: z.string().min(1).max(128).nullable(),
  sessionBindingId: z.string().uuid().nullable(),
  category: z.string().min(1).max(80),
  scenarioHash: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(['ALLOW', 'DENY', 'DEFER', 'OVERRIDE', 'UNKNOWN']),
  reasoningRef: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string().uuid()).default([]),
  policyRefs: z.array(z.string().uuid()).default([]),
  strategyId: z.string().uuid().nullable(),
  strategyVersion: z.number().int().min(1).nullable(),
  causalParentRefs: z.array(z.string().uuid()).default([]),
  validFrom: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  status: z.enum(['CANDIDATE', 'CONFIRMED', 'SUPERSEDED', 'REJECTED']),
  createdAt: z.coerce.date(),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

// ============================================================================
// P1-2 Tenant Ontology (closed contract slice)
// ============================================================================

/** Versioned tenant ontology; warning vs enforce decides gate behaviour. */
export const TenantOntologyVersionSchema = z.object({
  tenantId: z.string().uuid(),
  spaceId: z.string().uuid().nullable(),
  version: z.string().min(1).max(32),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  classes: z.array(z.string().min(1).max(80)),
  predicates: z.array(RelationPredicateSchema),
  constraints: z.array(
    z.object({
      id: z.string().min(1).max(80),
      description: z.string().max(500),
      severity: z.enum(['WARNING', 'ENFORCE']),
    }),
  ),
  status: z.enum(['DRAFT', 'WARNING', 'ENFORCE', 'RETIRED']),
  publishedAt: z.coerce.date().nullable(),
});
export type TenantOntologyVersion = z.infer<typeof TenantOntologyVersionSchema>;

// ============================================================================
// Aggregate Recall Explain Response (P0-3 + P1-3)
// ============================================================================

/**
 * Final explain payload returned by the retrieval pipeline. Aggregates
 * candidate counts, path / reasonCodes / rankBreakdown, and degraded reasons
 * so the operations console can render the full Recall Explain view.
 */
export const RecallExplainResponseSchema = z.object({
  traceId: z.string().uuid(),
  retrievalMode: SemanticRetrievalModeSchema,
  candidates: z.object({
    lexical: z.number().int().nonnegative(),
    vector: z.number().int().nonnegative(),
    graph: z.number().int().nonnegative(),
    authorityRejected: z.number().int().nonnegative(),
  }),
  results: z.array(
    z.object({
      objectRef: z.object({
        type: z.enum(['chunk', 'document', 'memory', 'entity', 'relation']),
        id: z.string().uuid(),
      }),
      reasonCodes: z.array(z.string().min(1).max(64)),
      rankBreakdown: z.record(z.string(), z.number()),
      path: z.array(GraphPathStepSchema).max(20).optional(),
      citations: z.array(
        z.object({
          documentId: z.string().uuid().optional(),
          revisionId: z.string().uuid().optional(),
          chunkId: z.string().uuid().optional(),
        }),
      ),
    }),
  ),
  degradedReasons: z.array(z.string().min(1).max(80)),
  contractVersion: z.string().min(1).max(32),
});
export type RecallExplainResponse = z.infer<typeof RecallExplainResponseSchema>;

/** Bumped when the explain payload gains a field. */
export const RECALL_EXPLAIN_CONTRACT_VERSION = 'recall-explain/v1';

/**
 * §10.3 Provenance 控制台视图读面：单个 entity assertion 的谱系投影。
 * 仅携带 hash 锚点所需的 id / 活动元数据，绝不包含 query 明文或正文
 * （ADR-003 隐私边界）。hops 上限与域服务 maxDepth 上限（20）一致。
 */
export const ProvenanceLineageHopSchema = z.object({
  provenanceId: z.string().uuid(),
  activityType: ProvenanceActivityTypeSchema,
  activityVersion: z.string().min(1).max(32),
  actorType: ProvenanceActorTypeSchema,
  recordedAt: z.coerce.date(),
});
export type ProvenanceLineageHop = z.infer<typeof ProvenanceLineageHopSchema>;

export const ProvenanceLineageResponseSchema = z.object({
  entityId: z.string().uuid(),
  canonicalKey: CanonicalKeySchema.max(200),
  hops: z.array(ProvenanceLineageHopSchema).max(20),
});
export type ProvenanceLineageResponse = z.infer<typeof ProvenanceLineageResponseSchema>;
