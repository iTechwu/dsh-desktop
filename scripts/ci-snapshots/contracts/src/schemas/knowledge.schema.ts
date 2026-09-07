import { z } from 'zod';
import { PaginatedResponseSchema, PaginationQuerySchema } from '../base';
import {
  DocumentPrincipalPermissionSchema,
  DocumentPrincipalTypeSchema,
  DocumentStatusSchema,
  EntityMergeStatusSchema,
  KnowledgeAclPermissionSchema,
  KnowledgeAclResourceTypeSchema,
  KnowledgeApiKeyStatusSchema,
  KnowledgePolicyApprovalStatusSchema,
  KnowledgePrincipalSourceSchema,
  KnowledgePrincipalStatusSchema,
  KnowledgePrincipalTypeSchema,
  KnowledgeReleaseTagStatusSchema,
  KnowledgeSourceStatusSchema,
  KnowledgeSourceTypeSchema,
  KnowledgeSpaceKindSchema,
  MemoryScopeSchema,
  MemoryStatusSchema,
  MemoryStrategyStatusSchema,
  MemoryTypeSchema,
  RecallEndpointSchema,
  HandoffStateSchema,
  MemoryFeedbackKindSchema,
  MemoryConflictSeveritySchema,
  MemoryConflictStateSchema,
  MemoryConflictResolutionTypeSchema,
  CapabilityKindSchema,
  CapabilityTrustClassSchema,
  CapabilityGapStatusSchema,
  CapabilitySensitivityClassSchema,
  CapabilityProposalStatusSchema,
  CapabilityApprovalDecisionSchema,
  CapabilityProposalOriginSchema,
  CapabilityBindingStatusSchema,
  CapabilityTrialOutcomeClassSchema,
  UsageRuleStatusSchema,
  EnvironmentFactStatusSchema,
  MemorySkillStatusSchema,
} from './prisma-enums.generated';

export const KnowledgeListQuerySchema = PaginationQuerySchema;
const QueryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .default(false)
  .transform((value) => value === true || value === 'true');
export const KnowledgeSourceListQuerySchema = PaginationQuerySchema.extend({
  spaceId: z.string().uuid().optional(),
});
export const KnowledgeDocumentListQuerySchema = PaginationQuerySchema.extend({
  spaceId: z.string().uuid().optional(),
  status: DocumentStatusSchema.optional(),
  query: z.string().trim().max(500).optional(),
});
export const MemoryListQuerySchema = PaginationQuerySchema.extend({
  status: MemoryStatusSchema.optional(),
  scope: MemoryScopeSchema.optional(),
  query: z.string().trim().max(500).optional(),
});
export const MemoryStrategyListQuerySchema = PaginationQuerySchema.extend({
  status: MemoryStrategyStatusSchema.optional(),
  query: z.string().trim().max(500).optional(),
});

export const KnowledgeSpaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  kind: KnowledgeSpaceKindSchema,
  documentCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  memoryCount: z.number().int().nonnegative(),
  updatedAt: z.coerce.date(),
});

/** 控制台租户切换器的条目：当前调用方可操作的租户摘要。 */
export const KnowledgeTenantSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(500).nullable(),
});

export const KnowledgeTenantListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(200),
});

export const KnowledgeSourceSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  name: z.string(),
  type: KnowledgeSourceTypeSchema,
  status: KnowledgeSourceStatusSchema,
  documentCount: z.number().int().nonnegative(),
  lastSyncedAt: z.coerce.date().nullable(),
  lastError: z.string().nullable(),
  capabilities: z.record(z.string(), z.unknown()).nullable(),
});

/** 只读检查内容源是否具备发起同步所需的配置；不会触发同步或修改来源状态。 */
export const CheckKnowledgeSourceResultSchema = z.object({
  sourceId: z.string().uuid(),
  status: z.enum(['READY', 'NEEDS_CREDENTIAL', 'DISABLED']),
  checkedAt: z.coerce.date(),
});

export const KnowledgeDocumentSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  sourceId: z.string().uuid(),
  title: z.string(),
  mimeType: z.string().nullable(),
  status: DocumentStatusSchema,
  visibility: z.string(),
  chunkCount: z.number().int().nonnegative(),
  updatedAt: z.coerce.date(),
});

export const DocumentPrincipalSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  principalType: DocumentPrincipalTypeSchema,
  principalId: z.string().trim().min(1).max(255),
  permission: DocumentPrincipalPermissionSchema,
  aclVersion: z.number().int().min(1),
  validFrom: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  revokeReason: z.string().nullable(),
  grantedBy: z.string().uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const DocumentPrincipalListQuerySchema = PaginationQuerySchema.extend({
  includeRevoked: QueryBooleanSchema,
});

export const GrantDocumentPrincipalSchema = z
  .object({
    principalType: DocumentPrincipalTypeSchema,
    principalId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9_.:@-]+$/, 'principal id must be a stable identifier'),
    permission: DocumentPrincipalPermissionSchema.default('READ'),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
  })
  .refine((input) => !input.validFrom || !input.validUntil || input.validFrom < input.validUntil, {
    message: 'validFrom must be earlier than validUntil',
    path: ['validUntil'],
  });

export const RevokeDocumentPrincipalSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// Phase 1（docs/0901/03 §3）：资源级 ACL 授权（KnowledgeAclGrant）。resourceId 为
// 多态 UUID 字符串（DOCUMENT/MEMORY/KNOWLEDGE_REVISION/KNOWLEDGE_SPACE），
// 由 resourceType 消歧；conditions 用 JSON 表达 ipRanges/sourceSystems/
// maxSensitivity，AccessEvaluator 读取时校验。Phase 3（docs/0906/ai-memory §8）
// 追加 pinnedRevisionId：KNOWLEDGE_SPACE 授权可携带 asset version pin，
// Loadout 数据源读取后把空间绑定钉在指定 revision。
export const KnowledgeAclGrantConditionsSchema = z.object({
  ipRanges: z.array(z.string().trim().min(1).max(64)).optional(),
  sourceSystems: z.array(z.string().trim().min(1).max(120)).optional(),
  maxSensitivity: z
    .enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED'])
    .optional(),
  /** Asset version pin：该空间的 Loadout 绑定只服务指定 revision。 */
  pinnedRevisionId: z.string().uuid().optional(),
});

export const KnowledgeAclGrantSchema = z.object({
  id: z.string().uuid(),
  resourceType: KnowledgeAclResourceTypeSchema,
  resourceId: z.string().uuid(),
  principalType: KnowledgePrincipalTypeSchema,
  principalId: z.string().trim().min(1).max(255),
  permission: KnowledgeAclPermissionSchema,
  conditions: KnowledgeAclGrantConditionsSchema.nullable().optional(),
  grantedBy: z.string().uuid(),
  reason: z.string().nullable(),
  aclVersion: z.number().int().min(1),
  validFrom: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  revokeReason: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const KnowledgeAclListQuerySchema = PaginationQuerySchema.extend({
  resourceType: KnowledgeAclResourceTypeSchema.optional(),
  resourceId: z.string().uuid().optional(),
  includeRevoked: QueryBooleanSchema,
});

export const GrantKnowledgeAclSchema = z
  .object({
    resourceType: KnowledgeAclResourceTypeSchema,
    resourceId: z.string().uuid(),
    principalType: KnowledgePrincipalTypeSchema,
    principalId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9_.:@-]+$/, 'principal id must be a stable identifier'),
    permission: KnowledgeAclPermissionSchema,
    conditions: KnowledgeAclGrantConditionsSchema.optional(),
    reason: z.string().trim().max(500).optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
  })
  .refine((input) => !input.validFrom || !input.validUntil || input.validFrom < input.validUntil, {
    message: 'validFrom must be earlier than validUntil',
    path: ['validUntil'],
  });

export const RevokeKnowledgeAclSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// Phase 1（docs/0901/03 §2/§3）：主体注册表（KnowledgePrincipal）。USER/GROUP/
// TEAM/SERVICE/AGENT_RUNTIME 五类主体由上游 SSO/Models/Agents 同步，状态收敛为
// ACTIVE → SUSPENDED → REVOKED（REVOKED 为终态，不允许回退）。
export const KnowledgePrincipalSchema = z.object({
  id: z.string().uuid(),
  type: KnowledgePrincipalTypeSchema,
  externalId: z.string().trim().min(1).max(255),
  displayName: z.string().nullable(),
  source: KnowledgePrincipalSourceSchema,
  status: KnowledgePrincipalStatusSchema,
  lastVerifiedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const KnowledgePrincipalListQuerySchema = PaginationQuerySchema.extend({
  type: KnowledgePrincipalTypeSchema.optional(),
  status: KnowledgePrincipalStatusSchema.optional(),
  source: KnowledgePrincipalSourceSchema.optional(),
});

export const UpdateKnowledgePrincipalStatusSchema = z.object({
  status: KnowledgePrincipalStatusSchema,
  reason: z.string().trim().max(500).optional(),
});

// Model API Key 绑定（credential，不是 Principal）：Models Gateway 解析 Bearer 后
// 收敛到 subjectUserId；scopes 只收窄不放大用户权限。
export const KnowledgeApiKeyBindingSchema = z.object({
  id: z.string().uuid(),
  keyId: z.string().trim().min(1).max(160),
  memberId: z.string().trim().min(1).max(160),
  subjectUserId: z.string().uuid().nullable(),
  groupIds: z.array(z.string().trim().min(1).max(160)).default([]),
  scopes: z.array(z.string().trim().min(1).max(120)).default([]),
  sourceSystem: z.string().trim().min(1).max(120),
  issuedBy: z.string().trim().min(1).max(160),
  keyVersion: z.number().int().min(1),
  status: KnowledgeApiKeyStatusSchema,
  expiresAt: z.coerce.date().nullable(),
  lastSeenAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  revokeReason: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const KnowledgeApiKeyListQuerySchema = PaginationQuerySchema.extend({
  status: KnowledgeApiKeyStatusSchema.optional(),
});

export const GrantApiKeyBindingSchema = z.object({
  keyId: z.string().trim().min(1).max(160),
  memberId: z.string().trim().min(1).max(160),
  subjectUserId: z.string().uuid().optional(),
  groupIds: z.array(z.string().trim().min(1).max(160)).optional(),
  scopes: z.array(z.string().trim().min(1).max(120)).optional(),
  sourceSystem: z.string().trim().min(1).max(120).default('models.dofe.ai'),
  expiresAt: z.coerce.date().optional(),
});

export const RevokeApiKeyBindingSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// 租户级 KnowledgePolicy（docs/0901/03 §3）：adminUserIds 定义注册表/Key 绑定/
// 授权管理资格，其余字段为租户默认策略。
export const KnowledgePolicySchema = z.object({
  id: z.string().uuid(),
  maxSensitivity: z.string().trim().min(1).max(32),
  defaultMemoryScope: MemoryScopeSchema,
  autoCapture: z.boolean(),
  autoPromote: z.boolean(),
  retentionDays: z.number().int().min(1),
  requireApprovalFor: z.array(z.string().trim().min(1).max(120)).default([]),
  allowedPrincipalTypes: z.array(KnowledgePrincipalTypeSchema).default([]),
  adminUserIds: z.array(z.string().trim().min(1).max(160)).default([]),
  // 评审 P1-3 收尾：MCP legacy UUID 迁移门（true=窗口内允许，false=该租户 strict）。
  legacySpaceUuidAllowed: z.boolean().default(true),
  updatedAt: z.coerce.date(),
});

export const UpdateKnowledgePolicySchema = z.object({
  maxSensitivity: z.string().trim().min(1).max(32).optional(),
  defaultMemoryScope: MemoryScopeSchema.optional(),
  autoCapture: z.boolean().optional(),
  autoPromote: z.boolean().optional(),
  retentionDays: z.number().int().min(1).optional(),
  requireApprovalFor: z.array(z.string().trim().min(1).max(120)).optional(),
  allowedPrincipalTypes: z.array(KnowledgePrincipalTypeSchema).optional(),
  adminUserIds: z.array(z.string().trim().min(1).max(160)).optional(),
  legacySpaceUuidAllowed: z.boolean().optional(),
});

// Phase 1（docs/0901/03 §3 requireApprovalFor）：通用审批流。caller 操作被策略
// 拦下时写入 PENDING，由 tenant admin approve/reject 执行原动作或丢弃。
export const KnowledgePolicyApprovalSchema = z.object({
  id: z.string().uuid(),
  action: z.string().trim().min(1).max(80),
  resourceType: z.string().trim().min(1).max(64),
  resourceId: z.string().trim().min(1).max(64),
  callerId: z.string().uuid(),
  status: KnowledgePolicyApprovalStatusSchema,
  decidedBy: z.string().uuid().nullable(),
  decidedAt: z.coerce.date().nullable(),
  decisionNote: z.string().nullable(),
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const KnowledgePolicyApprovalListQuerySchema = PaginationQuerySchema.extend({
  status: KnowledgePolicyApprovalStatusSchema.optional(),
});

export const DecideKnowledgePolicyApprovalSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const MemoryToolMetadataSchema = z.object({
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().max(120).optional(),
  inputHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  outputHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export const MemoryEvidenceCitationSchema = z.object({
  kind: z.enum(['session', 'document', 'chunk']),
  ref: z.string().trim().min(1).max(500),
  revisionId: z.string().uuid().optional(),
  quote: z.string().max(2000).optional(),
  quoteHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export const MemorySchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid().nullable(),
  type: MemoryTypeSchema,
  scope: MemoryScopeSchema,
  status: MemoryStatusSchema,
  content: z.string(),
  confidence: z.number().min(0).max(1),
  sourceSessionId: z.string().nullable(),
  episodeId: z.string().nullable().optional(),
  stepNo: z.number().int().nonnegative().nullable().optional(),
  stateDigest: z.string().nullable().optional(),
  actionDigest: z.string().nullable().optional(),
  observationDigest: z.string().nullable().optional(),
  reflection: z.string().nullable().optional(),
  toolMetadata: MemoryToolMetadataSchema.nullable().optional(),
  terminalReward: z.number().min(-1).max(1).nullable().optional(),
  stepValue: z.number().min(-1).max(1).nullable().optional(),
  reflectionScore: z.number().min(0).max(1).nullable().optional(),
  taskCompleted: z.boolean().nullable().optional(),
  userAccepted: z.boolean().nullable().optional(),
  scorerVersion: z.string().nullable().optional(),
  scoredAt: z.coerce.date().nullable().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  supersedesId: z.string().uuid().nullable().optional(),
  updatedAt: z.coerce.date(),
});

export const KnowledgeCapabilityEndpointSchema = z.object({
  key: z.string(),
  path: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  summary: z.string(),
});

// Phase 1（docs/0901/03 §5 EXPORT）：结构化导出 Memory。高风险只读操作，
// 命中 requireApprovalFor 含 memory.export 且 caller 非 admin 时走审批。
export const MemoryExportQuerySchema = z.object({
  status: MemoryStatusSchema.optional(),
  scope: MemoryScopeSchema.optional(),
  spaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const MemoryExportResultSchema = z.object({
  exportedAt: z.coerce.date(),
  count: z.number().int().nonnegative(),
  list: z.array(MemorySchema),
});

export const KnowledgeCapabilityManifestSchema = z.object({
  pluginBasePath: z.string(),
  retrievalMode: z.enum(['lexical-v1']),
  endpoints: z.array(KnowledgeCapabilityEndpointSchema),
});

export const ProjectionHealthReasonSchema = z.enum([
  'unconfigured',
  'unreachable',
  'unauthorized',
  'forbidden',
  'bucket-not-found',
  'probe-failed',
]);

export const ProjectionHealthDetailSchema = z.object({
  bucket: z.string(),
  reason: ProjectionHealthReasonSchema.nullable(),
  checkedAt: z.coerce.date(),
});

export const DashboardOverviewSchema = z.object({
  totals: z.object({
    spaces: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative(),
  }),
  health: z.object({
    api: z.enum(['healthy', 'degraded']),
    postgres: z.enum(['healthy', 'degraded']),
    minio: z.enum(['healthy', 'degraded', 'unconfigured']),
    qdrant: z.enum(['healthy', 'degraded', 'unconfigured']),
    neo4j: z.enum(['healthy', 'degraded', 'unconfigured']),
  }),
  healthDetails: z
    .object({
      minio: ProjectionHealthDetailSchema,
    })
    .optional(),
  ingestion: z.object({
    queued: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  capabilities: KnowledgeCapabilityManifestSchema,
  recentDocuments: z.array(KnowledgeDocumentSchema),
  recentMemories: z.array(MemorySchema),
});

export const CreateSpaceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  kind: KnowledgeSpaceKindSchema.default('TEAM'),
});

const SourceConfigSchema = z.record(z.string(), z.unknown()).superRefine((config, context) => {
  const allowed = new Set([
    'folderToken',
    'wikiToken',
    'spaceToken',
    'documentIds',
    'includeArchived',
  ]);
  const sensitive =
    /(?:secret|password|credential|private|token|apikey|api|authorization|app[_-]?id|access|refresh)/i;
  for (const key of Object.keys(config)) {
    if (!allowed.has(key) || (sensitive.test(key) && !allowed.has(key))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Use a managed connector credential; arbitrary source configuration is not allowed',
        path: [key],
      });
    }
  }
});

export const KnowledgeConnectorCredentialSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: KnowledgeSourceTypeSchema,
});

export const CreateSourceSchema = z.object({
  spaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  type: KnowledgeSourceTypeSchema,
  externalRef: z.string().trim().max(255).optional(),
  credentialId: z.string().uuid().optional(),
  config: SourceConfigSchema.optional(),
});

export const CreateDocumentSchema = z.object({
  spaceId: z.string().uuid(),
  sourceId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  content: z.string().min(1).max(2_000_000),
  mimeType: z.string().trim().max(160).default('text/markdown'),
  externalDocumentId: z.string().trim().max(500).optional(),
  visibility: z.enum(['space', 'private']).default('space'),
});

/** 控制台原件上传：原件进入私有对象存储，解析由后续 ingestion worker 消费。 */
export const UploadKnowledgeDocumentSchema = z.object({
  spaceId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().min(1).max(160).default('application/octet-stream'),
  dataBase64: z
    .string()
    .min(1)
    .max(7_000_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  visibility: z.enum(['space', 'private']).default('space'),
});

/** Canonical MCP space keys (Phase 0 contract change, docs/0906/01 §16.2/§18).
 *  MCP callers address spaces by role keys; the server resolves them against
 *  the verified tenant/user runtime context. `team.<groupId>` is the only
 *  parameterized form so SSO group identifiers stay bounded. */
export const MCP_SPACE_KEY_PATTERN =
  /^(tenant\.(all|hr|admin)|user\.(personal|agent_runtime)|team\.[a-zA-Z0-9_.-]{1,160})$/;

export const McpSpaceKeySchema = z.string().trim().min(1).max(200).regex(MCP_SPACE_KEY_PATTERN, {
  message:
    'spaceKey must be a canonical key (tenant.all, tenant.hr, tenant.admin, user.personal, user.agent_runtime) or team.<groupId>',
});
export type McpSpaceKey = z.infer<typeof McpSpaceKeySchema>;

/** yootun-agent 文件理解文本入库：文件本体在 TOS，knowledge 只接收解析后的文字与文件链接。 */
export const IngestExternalFileSchema = z
  .object({
    /** 缺省时落入调用方主体自己的 PERSONAL 空间（不存在则自动创建）。 */
    spaceId: z.string().uuid().optional(),
    /** MCP callers should pass a canonical space key (resolved server-side). */
    spaceKey: McpSpaceKeySchema.optional(),
    fileUrl: z.string().trim().url().min(1).max(1000),
    text: z.string().min(1).max(1_000_000),
    title: z.string().trim().min(1).max(500).optional(),
    mimeType: z.string().trim().max(160).optional(),
  })
  .refine((value) => !(value.spaceKey && value.spaceId), {
    message: 'spaceKey and spaceId are mutually exclusive; pass exactly one',
    path: ['spaceKey'],
  });
export type IngestExternalFile = z.infer<typeof IngestExternalFileSchema>;

export const ExternalFileIngestResultSchema = z.object({
  documentId: z.string().uuid(),
  revisionId: z.string().uuid().nullable(),
  sourceId: z.string().uuid(),
  spaceId: z.string().uuid(),
  title: z.string(),
  status: DocumentStatusSchema,
  chunkCount: z.number().int().nonnegative(),
  created: z.boolean(),
  contentUnchanged: z.boolean(),
  updatedAt: z.coerce.date(),
});
export type ExternalFileIngestResult = z.infer<typeof ExternalFileIngestResultSchema>;

export const CreateMemorySchema = z
  .object({
    spaceId: z.string().uuid().optional(),
    type: MemoryTypeSchema,
    scope: MemoryScopeSchema,
    content: z.string().trim().min(1).max(20_000),
    confidence: z.number().min(0).max(1).default(1),
    sourceSessionId: z.string().trim().min(1).max(255).optional(),
    episodeId: z.string().trim().min(1).max(255).optional(),
    stepNo: z.number().int().nonnegative().optional(),
    stateDigest: z.string().trim().max(8000).optional(),
    actionDigest: z.string().trim().max(8000).optional(),
    observationDigest: z.string().trim().max(8000).optional(),
    reflection: z.string().trim().max(8000).optional(),
    toolMetadata: MemoryToolMetadataSchema.optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
    supersedesId: z.string().uuid().optional(),
    evidence: z.array(MemoryEvidenceCitationSchema).default([]),
    confirmed: z.boolean().default(false),
  })
  .refine((value) => !value.validFrom || !value.validUntil || value.validUntil > value.validFrom, {
    message: 'validUntil must be later than validFrom',
    path: ['validUntil'],
  })
  .refine((value) => value.scope !== 'SESSION' || Boolean(value.sourceSessionId), {
    message: 'Session memories require a sourceSessionId',
    path: ['sourceSessionId'],
  })
  .refine((value) => !['TEAM', 'ENTERPRISE'].includes(value.scope) || Boolean(value.spaceId), {
    message: 'Team and enterprise memories require a knowledge space',
    path: ['spaceId'],
  })
  .refine((value) => Boolean(value.episodeId) === (value.stepNo !== undefined), {
    message: 'episodeId and stepNo must be provided together',
    path: ['episodeId'],
  });

export const ScoreMemorySchema = z.object({
  terminalReward: z.number().min(-1).max(1),
  stepValue: z.number().min(-1).max(1),
  reflectionScore: z.number().min(0).max(1).optional(),
  taskCompleted: z.boolean().optional(),
  userAccepted: z.boolean().optional(),
  scorerVersion: z.string().trim().min(1).max(120),
});

export const MemoryStrategyTriggerSchema = z.object({
  intent: z.string().trim().min(1).max(500),
  domain: z.string().trim().max(160).optional(),
  tool: z.string().trim().max(120).optional(),
  errorSignature: z.string().trim().max(500).optional(),
  preconditions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});

export const MemoryStrategyStepSchema = z.object({
  order: z.number().int().nonnegative(),
  action: z.string().trim().min(1).max(2000),
  evidenceId: z.string().uuid(),
});

export const MemoryStrategySchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  name: z.string(),
  trigger: MemoryStrategyTriggerSchema,
  triggerSignature: z.string().regex(/^[a-f0-9]{64}$/),
  steps: z.array(MemoryStrategyStepSchema),
  validation: z.array(z.string()),
  fallback: z.array(z.string()).nullable(),
  boundaries: z.array(z.string()).nullable(),
  allowedTools: z.array(z.string()),
  evidenceIds: z.array(z.string().uuid()),
  supportEpisodeCount: z.number().int().nonnegative(),
  supportEvidenceCount: z.number().int().nonnegative(),
  positiveCount: z.number().int().nonnegative(),
  negativeCount: z.number().int().nonnegative(),
  trialPassCount: z.number().int().nonnegative(),
  trialFailCount: z.number().int().nonnegative(),
  consecutiveFailCount: z.number().int().nonnegative(),
  gain: z.number().min(-2).max(2),
  reliability: z.number().min(0).max(1),
  scorerVersion: z.string().nullable(),
  baselineVersion: z.string().nullable(),
  taskSetHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  status: MemoryStrategyStatusSchema,
  supersedesId: z.string().uuid().nullable(),
  activatedAt: z.coerce.date().nullable(),
  lastValidatedAt: z.coerce.date().nullable(),
  lastReplayAt: z.coerce.date().nullable(),
  retiredAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date(),
});

/**
 * P1（docs/0906/ai-memory §7.2 Strategy/Replay console）：服务端返回的
 * 可用动作闭集，与既有 strategy 端点一一对应；前端不复制状态机，只按
 * 本列表渲染操作按钮。
 */
export const StrategyAvailableActionSchema = z.enum([
  'report_trial',
  'enqueue_replay',
  'create_replay_plan',
  'request_baseline',
  'report_baseline',
  'guard_execution',
]);
export type StrategyAvailableAction = z.infer<typeof StrategyAvailableActionSchema>;

/**
 * §7.2 运营指标 read model：全部从 authority 表读时重算（strategies +
 * replay tasks + trials），不改写任何行。中位等待只统计已有 trial 的
 * strategy（candidate 从未进入 trial 不计入）。
 */
export const StrategyOperationsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(7).max(90).default(30),
});
export type StrategyOperationsQuery = z.infer<typeof StrategyOperationsQuerySchema>;

/**
 * P2（docs/0906/ai-memory §9）：恢复演练 evidence manifest。只读、
 * tenant-scoped；manifestHash 为除 generatedAt 外全部内容的 SHA-256，
 * 恢复前后 hash 相等 ⇔ authority/projection 状态一致。仅 tenant admin
 * 可生成。
 */
export const DrillManifestSchema = z.object({
  schemaVersion: z.string().regex(/^drill-manifest-v\d+$/),
  generatedAt: z.coerce.date(),
  tenantId: z.string().uuid(),
  authority: z.object({
    documents: z.number().int().nonnegative(),
    revisions: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
    confirmedMemories: z.number().int().nonnegative(),
    strategies: z.number().int().nonnegative(),
    feedbacks: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    recallTraces: z.number().int().nonnegative(),
    sessionBindings: z.number().int().nonnegative(),
    sessionCheckpoints: z.number().int().nonnegative(),
    sessionHandoffs: z.number().int().nonnegative(),
  }),
  outbox: z.object({
    pending: z.number().int().nonnegative(),
    earliestPendingAt: z.coerce.date().nullable(),
  }),
  projection: z.object({
    byKindReady: z.object({
      QDRANT: z.number().int().nonnegative(),
      NEO4J: z.number().int().nonnegative(),
      MINIO: z.number().int().nonnegative(),
    }),
  }),
  checks: z.object({
    expiredTracesNotPurged: z.number().int().nonnegative(),
  }),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DrillManifest = z.infer<typeof DrillManifestSchema>;

/**
 * docs/0906/semantica §12 生产指标面：只读 read model，全部从 authority
 * 表读时重算。不落 query 明文 / memory 正文 / 工具原始 payload——指标
 * 只含计数、比率与哈希前缀。仅 tenant admin（policy.adminUserIds）可见。
 */
export const KnowledgeObservabilityQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(7).max(90).default(30),
});
export type KnowledgeObservabilityQuery = z.infer<typeof KnowledgeObservabilityQuerySchema>;

export const KnowledgeObservabilityReportSchema = z.object({
  generatedAt: z.coerce.date(),
  tenantId: z.string().uuid(),
  windowDays: z.number().int().min(7).max(90),
  sampling: z.object({
    rowCap: z.number().int().positive(),
    truncatedSections: z.array(z.enum(['pipeline', 'recall', 'graph', 'conflicts', 'decisions'])),
  }),
  /** Immediately preceding, equally sized window for directional context. */
  comparison: z
    .object({
      from: z.coerce.date(),
      to: z.coerce.date(),
      truncatedSections: z.array(z.enum(['pipeline', 'recall', 'decisions'])),
      pipeline: z.object({
        completed: z.number().int().nonnegative(),
        deadLettered: z.number().int().nonnegative(),
      }),
      recall: z.object({
        traces: z.number().int().nonnegative(),
        degradedRate: z.number().min(0).max(1).nullable(),
      }),
      provenance: z.object({
        chainBrokenEvents: z.number().int().nonnegative(),
      }),
      decisions: z.object({
        outcomes: z.number().int().nonnegative(),
        averageCitationCoverage: z.number().min(0).max(1).nullable(),
      }),
    })
    .optional(),
  /** 每个 pipeline step 的状态分布、滞后与窗口内产出计数。 */
  pipeline: z.object({
    steps: z.object({
      pending: z.number().int().nonnegative(),
      running: z.number().int().nonnegative(),
      succeeded: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      deadLetter: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    }),
    /** 当前最老 PENDING step 的等待时长；无 PENDING 为 null。 */
    oldestPendingLagMs: z.number().int().nonnegative().nullable(),
    window: z.object({
      completed: z.number().int().nonnegative(),
      deadLettered: z.number().int().nonnegative(),
      inputCount: z.number().int().nonnegative(),
      outputCount: z.number().int().nonnegative(),
      rejectedCount: z.number().int().nonnegative(),
    }),
  }),
  /** retrievalMode 分布、各通道候选与 authority/validity/citation 拒绝计数。 */
  recall: z.object({
    traces: z.number().int().nonnegative(),
    byRetrievalMode: z.record(z.string(), z.number().int().nonnegative()),
    channelCandidates: z.object({
      lexical: z.number().int().nonnegative(),
      vector: z.number().int().nonnegative(),
      graph: z.number().int().nonnegative(),
    }),
    rejects: z.object({
      authority: z.number().int().nonnegative(),
      validity: z.number().int().nonnegative(),
      citation: z.number().int().nonnegative(),
    }),
    /** degradedReasons 非空的 trace 占比。 */
    degradedRate: z.number().min(0).max(1).nullable(),
  }),
  /** graph expansion hop 分布（reasonCode graph-hop-N）与平均路径长度。 */
  graph: z.object({
    hopDistribution: z.record(z.string(), z.number().int().nonnegative()),
    averagePathLength: z.number().nonnegative().nullable(),
  }),
  /** provenance hash 链校验失败（断链事件）窗口计数。 */
  provenance: z.object({
    chainBrokenEvents: z.number().int().nonnegative(),
  }),
  /** conflict backlog（OPEN + INVESTIGATING 分列）与窗口内解决方式分布。 */
  conflicts: z.object({
    open: z.number().int().nonnegative(),
    investigating: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
    resolvedInWindow: z.object({
      supersede: z.number().int().nonnegative(),
      retire: z.number().int().nonnegative(),
      addEvidence: z.number().int().nonnegative(),
      dismiss: z.number().int().nonnegative(),
    }),
  }),
  /** decision precedent 使用与纠正信号。 */
  decisions: z.object({
    outcomes: z.number().int().nonnegative(),
    byObservedResult: z.record(z.string(), z.number().int().nonnegative()),
    /** userCorrection 非空的 outcome 占比；无 outcome 为 null。 */
    userCorrectionRate: z.number().min(0).max(1).nullable(),
    averageCitationCoverage: z.number().min(0).max(1).nullable(),
  }),
});
export type KnowledgeObservabilityReport = z.infer<typeof KnowledgeObservabilityReportSchema>;

/**
 * docs/0906/semantica §12 告警接入：cron 周期调用 observability 同源数据
 * 评估阈值，命中后 emit `knowledge.alert.raised` outbox 事件；本 schema
 * 限定 outbox payload 闭集——section/severity/condition 一律枚举，禁止
 * payload 携带 query 明文 / memory 正文 / chunk 原文。
 */
export const KnowledgeAlertSectionSchema = z.enum(['provenance', 'pipeline', 'recall']);
export type KnowledgeAlertSection = z.infer<typeof KnowledgeAlertSectionSchema>;

export const KnowledgeAlertSeveritySchema = z.enum(['warning', 'critical']);
export type KnowledgeAlertSeverity = z.infer<typeof KnowledgeAlertSeveritySchema>;

export const KnowledgeAlertConditionSchema = z.enum([
  'chain-broken',
  'dead-letter',
  'degraded-rate-high',
]);
export type KnowledgeAlertCondition = z.infer<typeof KnowledgeAlertConditionSchema>;

export const KnowledgeAlertEventSchema = z.object({
  section: KnowledgeAlertSectionSchema,
  severity: KnowledgeAlertSeveritySchema,
  condition: KnowledgeAlertConditionSchema,
  template: z.string().min(1).max(120),
  threshold: z.number(),
  observed: z.number(),
  windowDays: z.number().int().min(7).max(90),
  tenantId: z.string().uuid(),
  detectedAt: z.coerce.date(),
});
export type KnowledgeAlertEvent = z.infer<typeof KnowledgeAlertEventSchema>;

/**
 * docs/0906/semantica §12 控制台 alert 订阅：订阅维度严格闭集，禁止
 * 接收 query 明文/memory 正文；订阅者 = userId（actor），匹配键 =
 * {section, severity, condition}，condition 为 null 时订阅该
 * section+severity 下的全部 condition（粗订阅）。
 */
export const KnowledgeAlertSubscriptionChannelSchema = z.enum(['console', 'webhook']);
export type KnowledgeAlertSubscriptionChannel = z.infer<
  typeof KnowledgeAlertSubscriptionChannelSchema
>;

export const KnowledgeAlertSubscriptionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  subscriberUserId: z.string().uuid(),
  section: KnowledgeAlertSectionSchema,
  severity: KnowledgeAlertSeveritySchema,
  condition: KnowledgeAlertConditionSchema.nullable(),
  channel: KnowledgeAlertSubscriptionChannelSchema,
  enabled: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type KnowledgeAlertSubscription = z.infer<typeof KnowledgeAlertSubscriptionSchema>;

export const KnowledgeAlertSubscriptionCreateSchema = z.object({
  section: KnowledgeAlertSectionSchema,
  severity: KnowledgeAlertSeveritySchema,
  condition: KnowledgeAlertConditionSchema.nullable(),
  channel: KnowledgeAlertSubscriptionChannelSchema.optional(),
  enabled: z.boolean().optional(),
});
export type KnowledgeAlertSubscriptionCreate = z.infer<
  typeof KnowledgeAlertSubscriptionCreateSchema
>;

export const KnowledgeAlertSubscriptionUpdateSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type KnowledgeAlertSubscriptionUpdate = z.infer<
  typeof KnowledgeAlertSubscriptionUpdateSchema
>;

export const KnowledgeAlertSubscriptionListResponseSchema = PaginatedResponseSchema(
  KnowledgeAlertSubscriptionSchema,
);
export type KnowledgeAlertSubscriptionListResponse = z.infer<
  typeof KnowledgeAlertSubscriptionListResponseSchema
>;

/**
 * docs/0906/semantica §12 alert 主动通知：租户级 webhook 通道配置。
 * secret 只在写入时接收，读取一律不回传明文，hasSecret 表示是否已设置；
 * webhookUrl 仅允许 https。secret 省略表示保留既有值，null 表示清除。
 */
export const KnowledgeAlertWebhookConfigSchema = z.object({
  tenantId: z.string().uuid(),
  webhookUrl: z.string().url().nullable(),
  enabled: z.boolean(),
  hasSecret: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type KnowledgeAlertWebhookConfig = z.infer<typeof KnowledgeAlertWebhookConfigSchema>;

export const KnowledgeAlertWebhookConfigUpsertSchema = z
  .object({
    webhookUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://'), {
        message: 'webhookUrl 必须使用 https',
      }),
    secret: z.string().min(8).max(128).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type KnowledgeAlertWebhookConfigUpsert = z.infer<
  typeof KnowledgeAlertWebhookConfigUpsertSchema
>;

/**
 * docs/0906/semantica §12 发布版本治理：每个 release tag 是一等概念，
 * 承载 PROMOTED / HOLD / RETIRED 状态机；tenantId + tag 唯一。
 * tag 命名规则：SemVer + 可选渠道后缀，如 v1.0.0-2026-09-06-rc1。
 */
export const KnowledgeReleaseTagNameSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u, {
    message: 'release tag must be SemVer (e.g. v1.0.0 or v1.0.0-2026-09-06-rc1)',
  });

export const KnowledgeReleaseTagSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tag: KnowledgeReleaseTagNameSchema,
  status: KnowledgeReleaseTagStatusSchema,
  notes: z.string().max(500).nullable(),
  managedByUserId: z.string().uuid().nullable(),
  recordedAt: z.coerce.date(),
  changedAt: z.coerce.date().nullable(),
});
export type KnowledgeReleaseTag = z.infer<typeof KnowledgeReleaseTagSchema>;

export const KnowledgeReleaseTagCreateSchema = z.object({
  tag: KnowledgeReleaseTagNameSchema,
  status: KnowledgeReleaseTagStatusSchema.default('PROMOTED'),
  notes: z.string().max(500).optional(),
});
export type KnowledgeReleaseTagCreate = z.infer<typeof KnowledgeReleaseTagCreateSchema>;

export const KnowledgeReleaseTagUpdateSchema = z.object({
  status: KnowledgeReleaseTagStatusSchema,
  notes: z.string().max(500).optional(),
});
export type KnowledgeReleaseTagUpdate = z.infer<typeof KnowledgeReleaseTagUpdateSchema>;

export const KnowledgeReleaseGateHealthSchema = z.object({
  releaseTag: KnowledgeReleaseTagSchema,
  /** 该 release 下所有 QualityGateReport 的最近一次评估聚合。 */
  totalReports: z.number().int().nonnegative(),
  passedReports: z.number().int().nonnegative(),
  failedReports: z.number().int().nonnegative(),
  latestReportAt: z.coerce.date().nullable(),
  latestReportPassed: z.boolean().nullable(),
  /** 该 release 是否可被 CI 放行：仅当 status=PROMOTED 且最近一次 passed=true。 */
  releaseBlocked: z.boolean(),
  blockedReasons: z.array(z.string()).max(8),
});
export type KnowledgeReleaseGateHealth = z.infer<typeof KnowledgeReleaseGateHealthSchema>;

export const StrategyOperationsReportSchema = z.object({
  windowDays: z.number().int().min(7).max(90),
  totalStrategies: z.number().int().nonnegative(),
  byStatus: z.object({
    candidate: z.number().int().nonnegative(),
    trial: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    retired: z.number().int().nonnegative(),
  }),
  /** trialPass / (pass + fail)，无 trial 时为 null。 */
  trialSuccessRate: z.number().min(0).max(1).nullable(),
  /** 非 RETIRED 且 consecutiveFailCount > 0 的 strategy 数（降级观察名单）。 */
  degradedCount: z.number().int().nonnegative(),
  /** sampleCount>0 时的平均 replay gain。 */
  averageGain: z.number().nullable(),
  replayTasks: z.object({
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    deadLetter: z.number().int().nonnegative(),
  }),
  /** candidate → 首次 trial 的中位等待毫秒；无样本为 null。 */
  medianCandidateToTrialWaitMs: z.number().int().nonnegative().nullable(),
  sampleCount: z.number().int().nonnegative(),
});
export type StrategyOperationsReport = z.infer<typeof StrategyOperationsReportSchema>;

export const ReportMemoryStrategyTrialSchema = z
  .object({
    executionId: z.string().trim().min(1).max(255),
    episodeId: z.string().trim().min(1).max(255),
    outcome: z.enum(['PASS', 'FAIL']),
    strategyGain: z.number().min(-1).max(1),
    baselineGain: z.number().min(-1).max(1),
    baselineVersion: z.string().trim().min(1).max(120),
    taskSetHash: z.string().regex(/^[a-f0-9]{64}$/),
    validationEvidence: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
    tokenCount: z.number().int().nonnegative().max(10_000_000).optional(),
    toolCallCount: z.number().int().nonnegative().max(10_000).optional(),
    userCorrection: z.boolean().optional(),
    citationCoverage: z.number().min(0).max(1).optional(),
    failureReason: z.string().trim().min(1).max(2000).optional(),
    boundaryViolation: z.boolean().default(false),
  })
  .refine((value) => value.outcome === 'FAIL' || !value.failureReason, {
    message: 'failureReason is only valid for failed trials',
    path: ['failureReason'],
  })
  .refine((value) => value.outcome !== 'FAIL' || Boolean(value.failureReason), {
    message: 'failureReason is required for failed trials',
    path: ['failureReason'],
  })
  .refine((value) => !value.boundaryViolation || value.outcome === 'FAIL', {
    message: 'boundary violations must be reported as failed trials',
    path: ['boundaryViolation'],
  });

export const EnqueueMemoryStrategyReplaySchema = z.object({
  replayPlanId: z.string().uuid(),
  executionId: z.string().trim().min(1).max(255),
  episodeId: z.string().trim().min(1).max(255),
  baselineVersion: z.string().trim().min(1).max(120),
  taskSetHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const RequestMemoryStrategyBaselineSchema = z.object({
  replayPlanId: z.string().uuid(),
});

export const ReportMemoryStrategyBaselineSchema = z
  .object({
    replayPlanId: z.string().uuid(),
    status: z.enum(['COMPLETED', 'FAILED']),
    baselineScore: z.number().min(-1).max(1).optional(),
    error: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((value) => value.status !== 'FAILED' || Boolean(value.error), {
    message: 'error is required for failed baseline generation',
    path: ['error'],
  })
  .refine((value) => value.status !== 'COMPLETED' || value.baselineScore !== undefined, {
    message: 'baselineScore is required for completed baseline generation',
    path: ['baselineScore'],
  });

export const MemoryReplayPlanTaskSchema = z.object({
  taskId: z.string().trim().min(1).max(255),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedCitationIds: z.array(z.string().uuid()).max(100),
});

export const CreateMemoryReplayPlanSchema = z.object({
  baselineVersion: z.string().trim().min(1).max(120),
  tasks: z.array(MemoryReplayPlanTaskSchema).min(1).max(500),
  baselineSpec: z.object({
    runnerVersion: z.string().trim().min(1).max(120),
    policy: z.string().trim().min(1).max(120),
    temperature: z.number().min(0).max(2).optional(),
  }),
});

export const MemoryReplayPlanSchema = z.object({
  id: z.string().uuid(),
  strategyId: z.string().uuid(),
  baselineVersion: z.string(),
  taskSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  taskCount: z.number().int().positive(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']),
  baselineStatus: z.enum(['NOT_REQUESTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']),
  baselineScore: z.number().min(-1).max(1).nullable(),
  createdAt: z.coerce.date(),
});

/**
 * Zod-first event contract for `knowledge.memory.strategy.replay.requested`.
 * The payload carries the immutable replay plan identity plus the full task
 * descriptor set so consumers never need read access to authoritative tables
 * and can detect plan/task drift before running a replay (review P1-05).
 */
export const MemoryStrategyReplayRequestedEventSchema = z.object({
  replayTaskId: z.string().uuid(),
  replayPlanId: z.string().uuid(),
  strategyId: z.string().uuid(),
  executionId: z.string().trim().min(1).max(255),
  episodeId: z.string().trim().min(1).max(255),
  baselineVersion: z.string().trim().min(1).max(120),
  taskSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  attempt: z.number().int().positive(),
  tasks: z.array(MemoryReplayPlanTaskSchema).min(1).max(500),
});

export const MemoryStrategyExecutionContextSchema = z.object({
  tool: z.string().trim().min(1).max(120).optional(),
  domain: z.string().trim().max(160).optional(),
  errorSignature: z.string().trim().max(500).optional(),
  citationIds: z.array(z.string().uuid()).max(100),
});

export const MemoryStrategyGuardResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  strategyId: z.string().uuid(),
  citationIds: z.array(z.string().uuid()),
});

export const CreateMemoryStrategySchema = z
  .object({
    spaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    trigger: MemoryStrategyTriggerSchema,
    steps: z.array(MemoryStrategyStepSchema).min(1).max(100),
    validation: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
    fallback: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
    boundaries: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
    allowedTools: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    evidenceIds: z.array(z.string().uuid()).min(3).max(50),
    gain: z.number().min(-1).max(1).default(0),
    scorerVersion: z.string().trim().min(1).max(120),
  })
  .refine((value) => new Set(value.evidenceIds).size === value.evidenceIds.length, {
    message: 'evidenceIds must be unique',
    path: ['evidenceIds'],
  })
  .refine((value) => new Set(value.steps.map((step) => step.order)).size === value.steps.length, {
    message: 'strategy step order values must be unique',
    path: ['steps'],
  })
  .refine((value) => !value.trigger.tool || value.allowedTools.includes(value.trigger.tool), {
    message: 'allowedTools must include the trigger tool',
    path: ['allowedTools'],
  });

export const UpdateMemoryStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'FORGOTTEN']),
});

export const SessionCheckpointEventSchema = z.object({
  seq: z.number().int().min(0),
  type: z.string().min(1).max(120),
  text: z.string().max(50_000).optional(),
  time: z.coerce.date().optional(),
});

export const SessionCheckpointEvidenceSchema = z.object({
  kind: z.string().min(1).max(80),
  ref: z.string().trim().min(1).max(500),
  excerpt: z.string().max(2_000).optional(),
});

export const SessionCheckpointCandidateContentSchema = z.object({
  content: z.string().min(1).max(20_000),
  type: MemoryTypeSchema.default('SEMANTIC'),
  scope: MemoryScopeSchema.default('SESSION'),
  spaceKey: McpSpaceKeySchema.optional(),
  spaceId: z.string().uuid().optional(),
  evidence: z.array(MemoryEvidenceCitationSchema).max(20).default([]),
  captureReason: z.string().trim().min(1).max(120).default('runtime-checkpoint'),
});

export const SessionCheckpointSchema = z
  .object({
    externalSessionId: z.string().trim().min(1).max(255),
    deviceId: z.string().trim().max(255).optional(),
    workspacePathHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    firstSeq: z.number().int().min(0),
    lastSeq: z.number().int().min(0),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    summary: z.string().max(50_000).optional(),
    events: z.array(SessionCheckpointEventSchema).max(500).default([]),
    evidence: z.array(SessionCheckpointEvidenceSchema).max(50).default([]),
    candidateContents: z.array(SessionCheckpointCandidateContentSchema).max(20).default([]),
  })
  .refine((value) => value.lastSeq >= value.firstSeq, {
    message: 'lastSeq must be greater than or equal to firstSeq',
    path: ['lastSeq'],
  });

/**
 * Retrieval mode closed set (Phase 1, docs/0906/01 §18).
 *
 * - `lexical-v1`: PostgreSQL-authoritative mode; always available because
 *   lexical search needs no projection. Default and the only mode that runs
 *   when Qdrant/embedding is unconfigured or degraded.
 * - `hybrid-vector-v1`: pure dense retrieval from Qdrant, fused with the
 *   lexical channel via Reciprocal Rank Fusion. Requires a healthy Qdrant
 *   projection and an embedding credential.
 * - `hybrid-rrf-v1`: dense + sparse fused at the source where the projection
 *   supports it; falls back to `hybrid-vector-v1` otherwise. Reserved for
 *   future sparse-native projections (TCVDB, OpenSearch BM25).
 *
 * Callers opt in via `KnowledgeSearchSchema.retrievalMode`. The server never
 * silently downgrades a hybrid opt-in to lexical; it returns
 * `degradedReasons` and the trace records the actual mode used so the
 * operations console can replay the decision.
 */
export const RetrievalModeSchema = z.enum(['lexical-v1', 'hybrid-vector-v1', 'hybrid-rrf-v1']);

export const KnowledgeSearchSchema = z.object({
  query: z.string().trim().min(1).max(4000),
  spaceIds: z.array(z.string().uuid()).max(20).optional(),
  topK: z.number().int().min(1).max(50).default(8),
  includeMemories: z.boolean().default(true),
  includeDocuments: z.boolean().default(true),
  /**
   * Phase 1 (docs/0906/01 §18): caller opt-in to hybrid retrieval. Server
   * never silently downgrades a hybrid request — when Qdrant/embedding is
   * unavailable the response records `degradedReasons` and the trace carries
   * the actual retrieval mode used.
   */
  retrievalMode: RetrievalModeSchema.default('lexical-v1'),
  /**
   * Phase 2 (P0-3): when `retrievalMode` is `hybrid-rrf-v1`, callers can
   * pre-compute the lexical candidates and graph seeds (e.g. from an external
   * entity extractor) to feed into the RRF fusion. Server never trusts the
   * payload for authorization — final recheck against PostgreSQL ACL is
   * mandatory. Empty / missing → graph channel is skipped.
   */
  graphSeeds: z
    .array(
      z.object({
        candidateId: z.string().min(1).max(200),
        canonicalKey: z
          .string()
          .regex(/^[A-Za-z0-9_./:@-]+$/)
          .min(1)
          .max(200),
      }),
    )
    .max(50)
    .optional(),
});
/**
 * Why a hit was returned / how it was ranked. Emitted by the domain search
 * pipeline and persisted on recall trace results; unknown codes are rejected
 * at the contract boundary so traces stay machine-auditable.
 */
export const RecallReasonCodeSchema = z.enum([
  'lexical-text-match',
  'space-member-access',
  'owner-access',
  'document-grant-access',
  'ready-revision',
  'confirmed-memory',
  'validity-current',
  'citation-verified',
  /** Graph channel resolved a canonical entity to a PG-backed citation. */
  'entity-canonical-resolved',
  // Phase 1 (docs/0906/01 §18): hybrid retrieval hit the dense channel via
  // Qdrant and was merged with the lexical channel by Reciprocal Rank Fusion.
  'qdrant-vector-hit',
  'rrf-fused',
]);

/**
 * Explicit degradation surfaced to callers. `trace-persistence-degraded` means
 * the answer is complete but its audit trace could not be persisted; the other
 * codes are reserved for projection-backed retrieval modes.
 */
export const DegradedReasonSchema = z.enum([
  'trace-persistence-degraded',
  'projection-unavailable',
  'partial-results',
  /**
   * Phase 1 (docs/0906/01 §18): caller asked for a hybrid retrieval mode but
   * Qdrant or embedding credentials were unavailable; the response fell back
   * to `lexical-v1`. The trace records the actual mode used.
   */
  'hybrid-fallback-lexical',
  /**
   * Phase 1: vector candidates survived oversampling but failed the
   * PostgreSQL ACL / current-revision / confirmed / citation recheck. The
   * trace records the rejection count and the lexical-only path still
   * returns the answers it found.
   */
  'hybrid-vector-acl-degraded',
  /**
   * Phase 2 (P0-3, docs/0906/semantica/02 §6.3): the bounded graph channel
   * failed or its expansion budget was exhausted; the lexical+vector fusion
   * still ran. Never silently dropped — the trace records the reason.
   */
  'graph-channel-degraded',
  'graph-truncated',
]);

/** Health of the citation attached to a hit or trace result. */
export const CitationHealthSchema = z.enum(['verified', 'missing', 'stale', 'rejected']);

export const KnowledgeSearchHitSchema = z.object({
  kind: z.enum(['document', 'memory']),
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  score: z.number(),
  /** Retrieval mode that produced this hit. `lexical-v1` is the PostgreSQL-authoritative mode. */
  retrievalMode: RetrievalModeSchema.default('lexical-v1'),
  /** Why this hit passed each pipeline stage (Sprint 2; additive/optional for old servers). */
  reasonCodes: z.array(RecallReasonCodeSchema).optional(),
  /** Per-stage ranking signals; never contains content, only numbers. */
  rankBreakdown: z.record(z.string(), z.number()).optional(),
  citationHealth: CitationHealthSchema.optional(),
  citation: z.object({
    documentId: z.string().uuid().optional(),
    revisionId: z.string().uuid().optional(),
    chunkId: z.string().uuid().optional(),
    source: z.string(),
    locator: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});

/**
 * Search/recall response: the paginated hit list plus additive trace metadata.
 * Old clients reading only list/total/page/limit are unaffected.
 */
export const KnowledgeSearchResponseSchema = PaginatedResponseSchema(
  KnowledgeSearchHitSchema,
).extend({
  /** Server-side recall trace id for explainability; absent on old servers. */
  traceId: z.string().uuid().optional(),
  retrievalMode: RetrievalModeSchema.optional(),
  degradedReasons: z.array(DegradedReasonSchema).optional(),
});

/** Recall trace endpoint closed set: `RecallEndpointSchema` from prisma-enums.generated. */

export const RecallTraceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  endpoint: RecallEndpointSchema.optional(),
  requestId: z.string().trim().min(1).max(64).optional(),
});

/**
 * Recall audit trace (docs/0831/07 §6.2). Never carries query plaintext,
 * result content or identifiers of filtered-out objects: `queryHash` is a
 * tenant-scoped keyed hash and results list only final authorized objects.
 */
export const RecallTraceSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid(),
  requestId: z.string(),
  endpoint: RecallEndpointSchema,
  retrievalMode: RetrievalModeSchema,
  queryHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestedSpaceCount: z.number().int().nonnegative(),
  lexicalCandidateCount: z.number().int().nonnegative(),
  vectorCandidateCount: z.number().int().nonnegative(),
  graphCandidateCount: z.number().int().nonnegative(),
  authorityRejectedCount: z.number().int().nonnegative(),
  validityRejectedCount: z.number().int().nonnegative(),
  citationRejectedCount: z.number().int().nonnegative(),
  returnedCount: z.number().int().nonnegative(),
  degradedReasons: z.array(DegradedReasonSchema),
  latencyMs: z.number().int().nonnegative(),
  contractVersion: z.string(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});

export const RecallTraceResultSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  objectType: z.enum(['document', 'chunk', 'memory']),
  objectId: z.string().uuid(),
  reasonCodes: z.array(RecallReasonCodeSchema),
  rankBreakdown: z.record(z.string(), z.number()).nullable(),
  citationHealth: CitationHealthSchema,
});

export const RecallTraceDetailSchema = RecallTraceSchema.extend({
  results: z.array(RecallTraceResultSchema),
});

export const KnowledgeGraphNodeTypeSchema = z.enum(['SPACE', 'SOURCE', 'DOCUMENT', 'MEMORY']);
export const KnowledgeGraphEdgeTypeSchema = z.enum([
  'CONTAINS',
  'PUBLISHED_FROM',
  'SUPPORTS',
  'RELATED_TO',
]);
export const KnowledgeGraphProjectionStatusSchema = z.enum([
  'queued',
  'projected',
  'degraded',
  'unconfigured',
]);

export const KnowledgeGraphQuerySchema = z
  .object({
    spaceId: z.string().uuid().optional(),
    /** MCP callers should pass a canonical space key (resolved server-side). */
    spaceKey: McpSpaceKeySchema.optional(),
    query: z.string().trim().max(500).optional(),
    limit: z.coerce.number().int().min(10).max(500).default(200),
  })
  .refine((value) => !(value.spaceKey && value.spaceId), {
    message: 'spaceKey and spaceId are mutually exclusive; pass exactly one',
    path: ['spaceKey'],
  });

export const KnowledgeGraphNodeSchema = z.object({
  id: z.string(),
  entityId: z.string().uuid(),
  type: KnowledgeGraphNodeTypeSchema,
  label: z.string(),
  spaceId: z.string().uuid(),
  status: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const KnowledgeGraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: KnowledgeGraphEdgeTypeSchema,
  weight: z.number().min(0).max(1),
});

export const KnowledgeGraphSchema = z.object({
  nodes: z.array(KnowledgeGraphNodeSchema),
  edges: z.array(KnowledgeGraphEdgeSchema),
  generatedAt: z.coerce.date(),
  projection: z.object({
    status: KnowledgeGraphProjectionStatusSchema,
    projectedAt: z.coerce.date().nullable(),
    message: z.string().nullable(),
  }),
});

export const RebuildKnowledgeGraphSchema = z.object({
  spaceId: z.string().uuid().optional(),
});

export const RebuildKnowledgeGraphResultSchema = z.object({
  status: KnowledgeGraphProjectionStatusSchema,
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  projectedAt: z.coerce.date().nullable(),
  message: z.string().nullable(),
});

const IntegrationKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/)
  .refine(
    (value) => !value.split('/').includes('..'),
    'Object key cannot contain parent traversal',
  );

const Base64PayloadSchema = z
  .string()
  .min(1)
  .max(7_000_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

const IntegrationPropertiesSchema = z
  .record(
    z.string().min(1).max(120),
    z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]),
  )
  .default({});

export const PutIntegrationObjectSchema = z.object({
  spaceId: z.string().uuid(),
  key: IntegrationKeySchema,
  mimeType: z.string().trim().min(1).max(160).default('application/octet-stream'),
  dataBase64: Base64PayloadSchema,
});

export const IntegrationObjectReferenceSchema = z.object({
  spaceId: z.string().uuid(),
  key: IntegrationKeySchema,
});

export const IntegrationObjectMetadataSchema = z.object({
  spaceId: z.string().uuid(),
  key: z.string(),
  mimeType: z.string(),
  /** Content type sniffed from magic bytes; null when the scan is skipped or inconclusive. */
  sniffedMimeType: z.string().nullable().optional(),
  /** `FLAGGED` marks a declared/sniffed mismatch kept for observability in passive mode. */
  scanStatus: z.enum(['SKIPPED', 'PASSED', 'FLAGGED']).nullable().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(),
  updatedAt: z.coerce.date(),
});

export const IntegrationObjectSchema = IntegrationObjectMetadataSchema.extend({
  dataBase64: Base64PayloadSchema,
});

export const DeleteIntegrationObjectResultSchema = z.object({
  deleted: z.boolean(),
});

export const ExternalGraphNodeSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  properties: IntegrationPropertiesSchema,
});

export const ExternalGraphRelationshipSchema = z.object({
  from: z.string().trim().min(1).max(255),
  to: z.string().trim().min(1).max(255),
  type: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Z][A-Z0-9_]*$/),
});

export const PutExternalGraphSnapshotSchema = z.object({
  spaceId: z.string().uuid(),
  externalEntityId: z.string().trim().min(1).max(255),
  properties: IntegrationPropertiesSchema,
  nodes: z.array(ExternalGraphNodeSchema).max(500),
  relationships: z.array(ExternalGraphRelationshipSchema).max(1000),
});

export const ExternalGraphSnapshotReferenceSchema = z.object({
  spaceId: z.string().uuid(),
  externalEntityId: z.string().trim().min(1).max(255),
});

export const ExternalGraphSnapshotSchema = PutExternalGraphSnapshotSchema.extend({
  updatedAt: z.coerce.date(),
  projection: z.object({
    status: KnowledgeGraphProjectionStatusSchema,
    projectedAt: z.coerce.date().nullable(),
    message: z.string().nullable(),
  }),
});

export type CreateSpace = z.infer<typeof CreateSpaceSchema>;
export type CreateSource = z.infer<typeof CreateSourceSchema>;
export type CreateDocument = z.infer<typeof CreateDocumentSchema>;
export type UploadKnowledgeDocument = z.infer<typeof UploadKnowledgeDocumentSchema>;
export type CreateMemory = z.infer<typeof CreateMemorySchema>;
export type ScoreMemory = z.infer<typeof ScoreMemorySchema>;
export type CreateMemoryStrategy = z.infer<typeof CreateMemoryStrategySchema>;
export type ReportMemoryStrategyTrial = z.infer<typeof ReportMemoryStrategyTrialSchema>;
export type EnqueueMemoryStrategyReplay = z.infer<typeof EnqueueMemoryStrategyReplaySchema>;
export type RequestMemoryStrategyBaseline = z.infer<typeof RequestMemoryStrategyBaselineSchema>;
export type ReportMemoryStrategyBaseline = z.infer<typeof ReportMemoryStrategyBaselineSchema>;
export type CreateMemoryReplayPlan = z.infer<typeof CreateMemoryReplayPlanSchema>;
export type MemoryReplayPlan = z.infer<typeof MemoryReplayPlanSchema>;
export type KnowledgeCapabilityManifest = z.infer<typeof KnowledgeCapabilityManifestSchema>;
export type MemoryReplayPlanTask = z.infer<typeof MemoryReplayPlanTaskSchema>;
export type MemoryStrategyReplayRequestedEvent = z.infer<
  typeof MemoryStrategyReplayRequestedEventSchema
>;
export type MemoryStrategyExecutionContext = z.infer<typeof MemoryStrategyExecutionContextSchema>;
export type MemoryStrategyGuardResult = z.infer<typeof MemoryStrategyGuardResultSchema>;
export type MemoryStrategyListQuery = z.input<typeof MemoryStrategyListQuerySchema>;
export type SessionCheckpoint = z.infer<typeof SessionCheckpointSchema>;
export type KnowledgeSearch = z.infer<typeof KnowledgeSearchSchema>;
export type KnowledgeListQuery = z.input<typeof KnowledgeListQuerySchema>;
export type KnowledgeSourceListQuery = z.input<typeof KnowledgeSourceListQuerySchema>;
export type CheckKnowledgeSourceResult = z.infer<typeof CheckKnowledgeSourceResultSchema>;
export type KnowledgeDocumentListQuery = z.input<typeof KnowledgeDocumentListQuerySchema>;
export type DocumentPrincipal = z.infer<typeof DocumentPrincipalSchema>;
export type DocumentPrincipalListQuery = z.output<typeof DocumentPrincipalListQuerySchema>;
export type GrantDocumentPrincipal = z.infer<typeof GrantDocumentPrincipalSchema>;
export type KnowledgeAclGrant = z.infer<typeof KnowledgeAclGrantSchema>;
export type KnowledgeAclListQuery = z.output<typeof KnowledgeAclListQuerySchema>;
export type GrantKnowledgeAcl = z.infer<typeof GrantKnowledgeAclSchema>;
export type RevokeKnowledgeAcl = z.infer<typeof RevokeKnowledgeAclSchema>;
export type KnowledgePrincipal = z.infer<typeof KnowledgePrincipalSchema>;
export type KnowledgePrincipalListQuery = z.output<typeof KnowledgePrincipalListQuerySchema>;
export type UpdateKnowledgePrincipalStatus = z.infer<typeof UpdateKnowledgePrincipalStatusSchema>;
export type KnowledgeApiKeyBinding = z.infer<typeof KnowledgeApiKeyBindingSchema>;
export type KnowledgeApiKeyListQuery = z.output<typeof KnowledgeApiKeyListQuerySchema>;
export type GrantApiKeyBinding = z.infer<typeof GrantApiKeyBindingSchema>;
export type RevokeApiKeyBinding = z.infer<typeof RevokeApiKeyBindingSchema>;
export type KnowledgePolicy = z.infer<typeof KnowledgePolicySchema>;
export type UpdateKnowledgePolicy = z.infer<typeof UpdateKnowledgePolicySchema>;
export type KnowledgePolicyApproval = z.infer<typeof KnowledgePolicyApprovalSchema>;
export type KnowledgePolicyApprovalListQuery = z.output<
  typeof KnowledgePolicyApprovalListQuerySchema
>;
export type DecideKnowledgePolicyApproval = z.infer<typeof DecideKnowledgePolicyApprovalSchema>;
export type MemoryExportQuery = z.input<typeof MemoryExportQuerySchema>;
export type MemoryExportResult = z.infer<typeof MemoryExportResultSchema>;
export type MemoryListQuery = z.input<typeof MemoryListQuerySchema>;
export type KnowledgeGraphQuery = z.input<typeof KnowledgeGraphQuerySchema>;
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;
export type PutIntegrationObject = z.infer<typeof PutIntegrationObjectSchema>;
export type IntegrationObjectReference = z.infer<typeof IntegrationObjectReferenceSchema>;
export type PutExternalGraphSnapshot = z.infer<typeof PutExternalGraphSnapshotSchema>;
export type ExternalGraphSnapshotReference = z.infer<typeof ExternalGraphSnapshotReferenceSchema>;
export type RetrievalMode = z.infer<typeof RetrievalModeSchema>;
export type RecallReasonCode = z.infer<typeof RecallReasonCodeSchema>;
export type DegradedReason = z.infer<typeof DegradedReasonSchema>;
export type CitationHealth = z.infer<typeof CitationHealthSchema>;
export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponseSchema>;
export type RecallTraceListQuery = z.output<typeof RecallTraceListQuerySchema>;
export type RecallTrace = z.infer<typeof RecallTraceSchema>;
export type RecallTraceDetail = z.infer<typeof RecallTraceDetailSchema>;

/**
 * Session handoff / continuation closed sets (docs/0831/07 §6.3, Sprint 4 KNO-Handoff).
 * `HandoffStateSchema` and `HandoffOriginSchema` are the only states/origins
 * accepted from the client so the audit trail stays machine-readable.
 *
 * Evidence citations mirror Memory.evidence: each entry references a session,
 * document or chunk and (for documents/chunks) optionally names a revision so
 * the recursive verifier can reject supersede-by-active-revision drift.
 */
export const HandoffOriginSchema = z.enum(['auto', 'manual']);
export const HandoffEvidenceHealthSchema = z.enum([
  'verified',
  'partial',
  'revoked',
  'unavailable',
]);
export const HandoffEvidenceRefSchema = z.object({
  kind: z.enum(['session', 'document', 'chunk']),
  ref: z.string().trim().min(1).max(255),
  revisionId: z.string().uuid().optional(),
});
export const HandoffSummarySchema = z.object({
  summary: z.string().trim().min(1).max(20_000),
  openQuestions: z.array(z.string().trim().min(1).max(2_000)).max(50).default([]),
  nextSteps: z.array(z.string().trim().min(1).max(2_000)).max(50).default([]),
  filesTouched: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
});

/**
 * `finalize` body: explicit close of the source session and creation of a new
 * OPEN Handoff. Idempotent on `(sourceSessionBindingId, payloadHash, generation)`
 * — repeating the call returns the same Handoff and never spawns duplicates.
 */
export const SessionFinalizeSchema = z.object({
  sourceExternalSessionId: z.string().trim().min(1).max(255),
  spaceId: z.string().uuid().optional(),
  targetAgentKind: z.string().trim().max(64).optional(),
  shared: z.boolean().default(false),
  origin: HandoffOriginSchema.default('auto'),
  generation: z.number().int().min(0).max(1_000_000),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  ttlSeconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600)
    .default(24 * 3600),
  evidenceRefs: z.array(HandoffEvidenceRefSchema).max(100),
  content: HandoffSummarySchema,
});

/**
 * `continuation` body: caller-scoped read of open handoffs owned by the actor
 * (plus `shared=true` handoffs visible to any tenant member) plus a fresh
 * Briefing composed at request time from CONFIRMED Memory, ACTIVE Strategy and
 * authorized document summaries. `requestId` lets retries reuse the same Briefing.
 */
export const SessionContinuationSchema = z.object({
  externalSessionId: z.string().trim().min(1).max(255),
  requestId: z.string().trim().min(1).max(64),
  acceptedHandoffId: z.string().uuid().optional(),
  budgetChars: z.number().int().min(500).max(50_000).default(8_000),
});

/** `accept` body: bind an OPEN Handoff to the receiving session atomically. */
export const HandoffAcceptSchema = z.object({
  targetExternalSessionId: z.string().trim().min(1).max(255),
  requestId: z.string().trim().min(1).max(64),
});

/** `cancel` body: actor-owned OPEN Handoff only; shared handoffs are not cancellable. */
export const HandoffCancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const SessionHandoffSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  spaceId: z.string().uuid().nullable(),
  sourceSessionBindingId: z.string().uuid(),
  targetAgentKind: z.string().nullable(),
  summary: z.string(),
  openQuestions: z.array(z.string()),
  nextSteps: z.array(z.string()),
  filesTouched: z.array(z.string()),
  evidenceRefs: z.array(HandoffEvidenceRefSchema),
  evidenceHealth: HandoffEvidenceHealthSchema,
  state: HandoffStateSchema,
  shared: z.boolean(),
  origin: HandoffOriginSchema,
  acceptedBySessionBindingId: z.string().uuid().nullable(),
  acceptedAt: z.coerce.date().nullable(),
  cancelledAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date(),
  generation: z.number().int(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * Briefings are recomposed from authorized sources on every continuation read;
 * they are NOT persisted as new full-text copies, so revoked/forgotten sources
 * disappear on the next call without any projection cleanup.
 */
export const SessionBriefingItemSchema = z.object({
  kind: z.enum(['memory', 'strategy', 'document']),
  id: z.string().uuid(),
  title: z.string(),
  excerpt: z.string().max(2_000),
  reasonCodes: z.array(RecallReasonCodeSchema),
  citationHealth: CitationHealthSchema,
  citation: z.object({
    documentId: z.string().uuid().optional(),
    revisionId: z.string().uuid().optional(),
    chunkId: z.string().uuid().optional(),
    source: z.string(),
    locator: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});

export const SessionContinuationResponseSchema = z.object({
  requestId: z.string(),
  generatedAt: z.coerce.date(),
  budgetChars: z.number().int().nonnegative(),
  openHandoffs: z.array(SessionHandoffSchema),
  briefing: z.array(SessionBriefingItemSchema),
  degradedReasons: z.array(DegradedReasonSchema).default([]),
  /** Result of the latest accept attempt when `acceptedHandoffId` was provided. */
  lastAccept: z
    .object({
      handoffId: z.string().uuid(),
      state: HandoffStateSchema,
      acceptedAt: z.coerce.date().nullable(),
    })
    .nullable()
    .optional(),
});

export const SessionHandoffListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  state: HandoffStateSchema.optional(),
  includeShared: z.coerce.boolean().default(true),
});

export const SessionHandoffAcceptResultSchema = z.object({
  handoffId: z.string().uuid(),
  state: HandoffStateSchema,
  acceptedAt: z.coerce.date().nullable(),
  targetSessionBindingId: z.string().uuid(),
});

export const SessionHandoffCancelResultSchema = z.object({
  handoffId: z.string().uuid(),
  state: HandoffStateSchema,
  cancelledAt: z.coerce.date().nullable(),
});

export type HandoffEvidenceRef = z.infer<typeof HandoffEvidenceRefSchema>;
export type SessionFinalize = z.infer<typeof SessionFinalizeSchema>;
export type SessionContinuation = z.infer<typeof SessionContinuationSchema>;
export type HandoffAccept = z.infer<typeof HandoffAcceptSchema>;
export type HandoffCancel = z.infer<typeof HandoffCancelSchema>;
export type SessionHandoff = z.infer<typeof SessionHandoffSchema>;
export type SessionBriefingItem = z.infer<typeof SessionBriefingItemSchema>;
export type SessionContinuationResponse = z.infer<typeof SessionContinuationResponseSchema>;
export type SessionHandoffListQuery = z.output<typeof SessionHandoffListQuerySchema>;
export type SessionHandoffAcceptResult = z.infer<typeof SessionHandoffAcceptResultSchema>;
export type SessionHandoffCancelResult = z.infer<typeof SessionHandoffCancelResultSchema>;

/**
 * Phase 2 (docs/0906/01 §18 Phase 2): verified runtime identity used to
 * bind a ContextPack to a tenant/user/agent runtime triple. The server
 * resolves every role key to a verified context; the client never supplies
 * UUIDs that bypass authorization.
 */
export const ContextRoleKeySchema = z.enum([
  'tenant.all',
  'tenant.hr',
  'tenant.admin',
  'user.personal',
  'user.agent_runtime',
]);
export type ContextRoleKey = z.infer<typeof ContextRoleKeySchema>;

export const ContextProfileSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  tenantId: z.string().uuid(),
  /** Verified caller subject — server-derived from the access token. */
  userId: z.string().trim().min(1).max(160),
  /** Optional Yootun agent runtime id; presence enables agent-runtime spaces. */
  agentRuntimeId: z.string().trim().max(160).optional(),
  /** Canonical role keys granted by the policy; server resolves to space IDs. */
  roleKeys: z.array(ContextRoleKeySchema).min(1).max(8),
  /** External session id, if the agent already opened one on the client. */
  sessionExternalId: z.string().trim().max(255).optional(),
  /** Scopes granted by the binding; only those marked optional here are user-visible. */
  scopes: z.array(z.string().trim().min(1).max(120)).default([]),
  /** Token budget the server must respect when assembling the pack. */
  tokenBudget: z.number().int().min(64).max(32_000).default(2_048),
  /** Caller-declared topK for the dynamic context channel; bounded server-side. */
  topK: z.number().int().min(1).max(20).default(8),
});
export type ContextProfile = z.infer<typeof ContextProfileSchema>;

export const ContextPackSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  generatedAt: z.coerce.date(),
  profile: ContextProfileSchema,
  stableContext: z.object({
    /** Tenant-wide rules + role-key policies. Always delivered in the system prompt tail. */
    rules: z.array(
      z.object({
        key: z.string().trim().min(1).max(120),
        body: z.string().trim().min(1).max(2_000),
      }),
    ),
    /** Stable environment facts (subject, predicate, object triples). */
    envFacts: z.array(
      z.object({
        id: z.string().uuid(),
        subject: z.string(),
        predicate: z.string(),
        object: z.string(),
        confidence: z.number().min(0).max(1),
        sourceStrategyIds: z.array(z.string()),
        sourceCitationIds: z.array(z.string()),
      }),
    ),
    /** ACTIVE MemorySkill rows. */
    activeSkills: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        trigger: z.record(z.string(), z.unknown()),
        allowedTools: z.array(z.string()),
        validation: z.array(z.string()),
        fallback: z.record(z.string(), z.unknown()).nullable(),
        boundaries: z.record(z.string(), z.unknown()).nullable(),
        version: z.string().nullable(),
      }),
    ),
  }),
  dynamicContext: z.object({
    /** CONFIRMED memories ranked by retrieval pipeline (lexical-v1 by default). */
    memories: z.array(
      z.object({
        id: z.string().uuid(),
        type: z.string(),
        scope: z.string(),
        content: z.string().max(2_000),
        score: z.number().min(0).max(1),
        retrievalMode: RetrievalModeSchema,
        citation: z
          .object({
            source: z.string(),
            locator: z.record(z.string(), z.unknown()).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    ),
    /** Currently ACCEPTED handoff for the session, if any. */
    handoff: SessionHandoffSchema.nullable(),
    /** Citations aggregated across memories + handoff evidence + env-fact sources. */
    citations: z.array(
      z.object({
        kind: z.enum(['memory', 'document', 'handoff', 'env-fact', 'skill']),
        id: z.string(),
        documentId: z.string().uuid().optional(),
        revisionId: z.string().uuid().optional(),
        chunkId: z.string().uuid().optional(),
        source: z.string(),
      }),
    ),
  }),
  budget: z.object({
    tokenBudget: z.number().int().nonnegative(),
    /** Estimated tokens used by the assembled pack, capped at `tokenBudget`. */
    tokensUsed: z.number().int().nonnegative(),
    /** Number of items dropped because they did not fit the budget. */
    droppedCount: z.number().int().nonnegative(),
    /** Number of distinct items after dedup (excluding handoff). */
    distinctCount: z.number().int().nonnegative(),
  }),
  /** Memory / handoff ids that should be stripped from any captured input by
   *  the agent adapter to prevent the recall -> capture -> recall pollution
   *  cycle (docs/0906/01 §14). */
  forbiddenCaptureIds: z.array(z.string().uuid()),
  degradedReasons: z.array(DegradedReasonSchema).default([]),
  contractVersion: z.string().default('2026-09-05'),
});
export type ContextPack = z.infer<typeof ContextPackSchema>;

export const McpContextPackSchema = z.object({
  query: z.string().trim().max(4_000).default(''),
  sessionExternalId: z.string().trim().max(255).optional(),
  tokenBudget: z.number().int().min(64).max(32_000).default(2_048),
  topK: z.number().int().min(1).max(20).default(8),
  /** Include Environment Facts / Memory Skills. Default true so production
   *  agents always see the verified triple store. */
  includeStableContext: z.boolean().default(true),
});
export type McpContextPack = z.infer<typeof McpContextPackSchema>;

/**
 * Capture SDK closed sets (docs/0906/ai-memory §3, Phase A). The SDK adapts
 * agent lifecycle events into `SessionCheckpoint` submissions; these schemas
 * are the shared vocabulary for the client bundle, the diagnostics probe and
 * any future server-side capture acknowledgement.
 *
 * The client NEVER derives authorization: `scopeRoleKey`/`agentRuntimeId` are
 * configuration inputs the server re-verifies on every checkpoint.
 */
export const CaptureEventKindSchema = z.enum([
  'session-start',
  'user-prompt',
  'post-tool-use',
  'pre-compact',
  'post-compaction',
  'session-end',
]);
export type CaptureEventKind = z.infer<typeof CaptureEventKindSchema>;

/**
 * Client-actionable capture error codes. The SDK surfaces one of these on
 * every failed capture/flush so the onboarding console can show a copyable
 * remediation instead of a raw stack trace.
 */
export const CaptureErrorCodeSchema = z.enum([
  'CAPTURE_TIMEOUT',
  'CAPTURE_NETWORK_ERROR',
  'CAPTURE_HTTP_429',
  'CAPTURE_HTTP_5XX',
  'CAPTURE_INVALID_RESPONSE',
  'CAPTURE_UNAUTHORIZED',
  'CAPTURE_REDACT_DROPPED',
  'CAPTURE_SPOOL_FULL',
]);
export type CaptureErrorCode = z.infer<typeof CaptureErrorCodeSchema>;

export const CaptureAckStatusSchema = z.enum(['accepted', 'duplicate', 'rejected', 'degraded']);
export type CaptureAckStatus = z.infer<typeof CaptureAckStatusSchema>;

export const CaptureAckSchema = z.object({
  captureEventId: z.string().trim().min(1).max(160),
  status: CaptureAckStatusSchema,
  errorCode: CaptureErrorCodeSchema.optional(),
  detail: z.string().max(500).optional(),
});
export type CaptureAck = z.infer<typeof CaptureAckSchema>;

/**
 * The four-step onboarding diagnostic (docs/0906/ai-memory §3.1):
 * status -> capability probe -> test checkpoint -> test recall. Each step
 * runs against the live API with the caller's own credentials so a green
 * report proves the agent's identity actually flows through authorization.
 */
export const CaptureProbeStepSchema = z.enum([
  'status',
  'capability',
  'test-checkpoint',
  'test-recall',
]);
export type CaptureProbeStep = z.infer<typeof CaptureProbeStepSchema>;

export const CaptureProbeStepResultSchema = z.object({
  step: CaptureProbeStepSchema,
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  errorCode: CaptureErrorCodeSchema.optional(),
  /** Server-reported fact worth showing in the console (tool count, mode). */
  detail: z.string().max(500).optional(),
});
export type CaptureProbeStepResult = z.infer<typeof CaptureProbeStepResultSchema>;

export const CaptureProbeReportSchema = z.object({
  sdkVersion: z.string().trim().min(1).max(40),
  baseUrl: z.string().trim().min(1).max(500),
  ranAt: z.coerce.date(),
  steps: z.array(CaptureProbeStepResultSchema).min(1).max(4),
  /** True only when every executed step passed; a failed probe stops early. */
  ok: z.boolean(),
});
export type CaptureProbeReport = z.infer<typeof CaptureProbeReportSchema>;

/**
 * Agent onboarding status (docs/0906/ai-memory §3.1): the single read the
 * onboarding console renders to answer "am I bound correctly and is capture
 * actually flowing?". Authority-side facts only — projection health stays in
 * the existing overview endpoint because live probes must not run on the
 * request thread.
 */
export const AgentOnboardingStatusSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  tenantId: z.string().uuid(),
  userId: z.string().trim().min(1).max(160),
  /** Verified scopes of the calling credential. */
  scopes: z.array(z.string().trim().min(1).max(120)),
  /** Conservative role-key mapping derived from the scopes (never client input). */
  scopeRoleKeys: ContextRoleKeySchema.array().min(1).max(8),
  /** Most recent checkpoint across the caller's sessions; null = never captured. */
  latestCheckpoint: z
    .object({
      externalSessionId: z.string().trim().min(1).max(255),
      lastSeq: z.number().int().nonnegative(),
      lastCheckpointAt: z.coerce.date(),
    })
    .nullable(),
  /** Bounded capture activity inside the trailing window. */
  captureWindow: z.object({
    windowHours: z.number().int().min(1).max(168).default(24),
    checkpointCount: z.number().int().nonnegative(),
  }),
  /** Continuation handshake counters for the caller (owner or shared). */
  handoffSummary: z.object({
    openCount: z.number().int().nonnegative(),
    acceptedCount: z.number().int().nonnegative(),
  }),
  contractVersion: z.string().default('2026-09-05'),
});
export type AgentOnboardingStatus = z.infer<typeof AgentOnboardingStatusSchema>;

/**
 * Sprint 5 KNO-Feedback closed sets (docs/0831/07 §6.4 + 08 §9). The
 * `MemoryFeedbackKindSchema` and `MemoryConflictResolutionTypeSchema` enums
 * are the only kinds/resolutions accepted from the client so the audit trail
 * stays machine-readable. Feedback is immutable: clients append new rows or
 * create new Candidates for `USER_CORRECTION` instead of mutating target.
 */
export const MemoryFeedbackSubjectTypeSchema = z.enum(['memory', 'strategy']);

export const RecordMemoryFeedbackSchema = z
  .object({
    subjectType: MemoryFeedbackSubjectTypeSchema,
    memoryId: z.string().uuid().optional(),
    strategyId: z.string().uuid().optional(),
    targetVersion: z.number().int().min(0),
    kind: MemoryFeedbackKindSchema,
    reason: z.string().trim().max(2_000).optional(),
    correctionCandidateId: z.string().uuid().optional(),
    recallTraceId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      (value.subjectType === 'memory' && Boolean(value.memoryId) && !value.strategyId) ||
      (value.subjectType === 'strategy' && Boolean(value.strategyId) && !value.memoryId),
    {
      message: 'subjectType must match the supplied target id',
      path: ['subjectType'],
    },
  )
  .refine((value) => value.kind !== 'USER_CORRECTION' || Boolean(value.correctionCandidateId), {
    message: 'USER_CORRECTION requires correctionCandidateId',
    path: ['correctionCandidateId'],
  });

export const MemoryFeedbackSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid(),
  subjectType: MemoryFeedbackSubjectTypeSchema,
  memoryId: z.string().uuid().nullable(),
  strategyId: z.string().uuid().nullable(),
  targetVersion: z.number().int().nonnegative(),
  kind: MemoryFeedbackKindSchema,
  reason: z.string().nullable(),
  correctionCandidateId: z.string().uuid().nullable(),
  recallTraceId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
});

export const MemoryFeedbackListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  subjectType: MemoryFeedbackSubjectTypeSchema.optional(),
  memoryId: z.string().uuid().optional(),
  strategyId: z.string().uuid().optional(),
  kind: MemoryFeedbackKindSchema.optional(),
});

export const MemoryConflictSubjectTypeSchema = MemoryFeedbackSubjectTypeSchema;

export const MemoryConflictSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  subjectType: MemoryConflictSubjectTypeSchema,
  subjectId: z.string().uuid(),
  subjectVersion: z.number().int().nonnegative(),
  competingMemoryIds: z.array(z.string().uuid()),
  severity: MemoryConflictSeveritySchema,
  state: MemoryConflictStateSchema,
  reasonCodes: z.array(z.string()),
  ownerId: z.string().uuid().nullable(),
  resolutionType: MemoryConflictResolutionTypeSchema.nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const MemoryConflictListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  state: MemoryConflictStateSchema.optional(),
  severity: MemoryConflictSeveritySchema.optional(),
  spaceId: z.string().uuid().optional(),
});

export const ResolveMemoryConflictSchema = z.object({
  resolutionType: MemoryConflictResolutionTypeSchema,
  reason: z.string().trim().max(2_000).optional(),
});

export const MemoryFeedbackAggregateSchema = z.object({
  memoryId: z.string().uuid().nullable(),
  strategyId: z.string().uuid().nullable(),
  helpfulCount: z.number().int().nonnegative(),
  notHelpfulCount: z.number().int().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  wrongCount: z.number().int().nonnegative(),
  correctionCount: z.number().int().nonnegative(),
  openConflictCount: z.number().int().nonnegative(),
  resolvedConflictCount: z.number().int().nonnegative(),
  lastFeedbackAt: z.coerce.date().nullable(),
});

export type RecordMemoryFeedback = z.infer<typeof RecordMemoryFeedbackSchema>;
export type MemoryFeedback = z.infer<typeof MemoryFeedbackSchema>;
export type MemoryFeedbackListQuery = z.output<typeof MemoryFeedbackListQuerySchema>;
export type MemoryConflict = z.infer<typeof MemoryConflictSchema>;
export type MemoryConflictListQuery = z.output<typeof MemoryConflictListQuerySchema>;
export type ResolveMemoryConflict = z.infer<typeof ResolveMemoryConflictSchema>;
export type MemoryFeedbackAggregate = z.infer<typeof MemoryFeedbackAggregateSchema>;

/**
 * P1/P2（docs/0906/ai-memory §8.1 Evidence view）：统一证据视图节点。
 * 把 EntityAssertion / RelationAssertion / ProvenanceEntry / RecallTrace
 * 串成可读节点；正文一律不在节点内返回（按当前 ACL 由调用方拉取，
 * 召回 trace 不存明文）。
 */
export const EvidenceNodeKindSchema = z.enum([
  'entity_assertion',
  'relation_assertion',
  'provenance_entry',
  'recall_trace',
  'memory',
]);
export type EvidenceNodeKind = z.infer<typeof EvidenceNodeKindSchema>;

export const EvidenceNodeSchema = z.object({
  kind: EvidenceNodeKindSchema,
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  spaceId: z.string().uuid().nullable(),
  /** 版本号（memory targetVersion / provenance sequenceNo / trace ordinal）。 */
  version: z.number().int().nonnegative().nullable(),
  /** 活动类型（ProvenanceActivityType 闭集），非 provenance 节点为 null。 */
  activityType: z.string().nullable(),
  /** 触发者（actorId）；非 provenance 节点为 null。 */
  actorId: z.string().nullable(),
  /** 0..1；非数字类型节点为 null（trace/relation 用谓词/位置代理）。 */
  confidence: z.number().min(0).max(1).nullable(),
  /** 引用上游节点 id 列表（输出 → 输入，graph 风格）。 */
  upstreamIds: z.array(z.string().uuid()),
  /** 引用下游节点 id 列表（输入 → 输出）。 */
  downstreamIds: z.array(z.string().uuid()),
  /** 业务有效窗；NULL = 无时态信号。 */
  validFrom: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  /** source revision/chunk locator 哈希；不解 quote，纯校验锚。 */
  locatorHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  /** 只读标签：entity displayName / predicate / trace query。 */
  label: z.string().nullable(),
  /** 节点产生时间（createdAt）。 */
  occurredAt: z.coerce.date(),
});
export type EvidenceNode = z.infer<typeof EvidenceNodeSchema>;

export const EvidenceGraphQuerySchema = z.object({
  /** 起点节点 id；必填，视图围绕一个根展开。 */
  rootId: z.string().uuid(),
  /** `EvidenceNodeKindSchema` 闭集；未指定 → 服务端推断 rootId 的类型。 */
  rootKind: EvidenceNodeKindSchema.optional(),
  /** 上游/下游最大跳数（1..4）；§8.2 同样沿用此上限。 */
  hops: z.coerce.number().int().min(1).max(4).default(2),
  /** 节点上限，超出后丢弃同优先级末端节点；硬上限 100。 */
  maxNodes: z.coerce.number().int().min(1).max(100).default(50),
});
export type EvidenceGraphQuery = z.infer<typeof EvidenceGraphQuerySchema>;

export const EvidenceGraphSchema = z.object({
  rootId: z.string().uuid(),
  nodes: z.array(EvidenceNodeSchema),
  /** 边由上游/下游反查，省显式列表；只展示节点即可重画拓扑。 */
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
import {
  CanonicalKeySchema,
  EntityAssertionStatusSchema,
  GraphPathExplanationSchema,
  RelationAssertionStatusSchema,
  RelationPredicateSchema,
} from './semantica.schema';

export type EvidenceGraph = z.infer<typeof EvidenceGraphSchema>;

/**
 * 图通道候选（§8.2）：path explanation 复用 semantica.schema 的
 * GraphPathExplanationSchema；候选 envelope 在此定义（域内
 * GraphChannelCandidate 接口的合同投影）。
 */
export const GraphChannelCandidateSchema = z.object({
  candidateId: z.string(),
  sourceCandidateId: z.string(),
  canonicalKey: z.string(),
  graphConfidence: z.number().min(0).max(1),
  paths: z.array(GraphPathExplanationSchema).max(20),
  reasonCodes: z.array(z.string()).max(20),
});
export type GraphChannelCandidate = z.infer<typeof GraphChannelCandidateSchema>;

/**
 * P2（docs/0906/ai-memory §8.2 Bounded GraphRAG）：query-time 入口合同。
 * 服务端在 GraphExpansionBudget 上限内做 BFS，并对关系谓词做白名单过滤。
 * 调用方应至少传一个谓词；空白名单视为"全图遍历"，服务侧严格禁止
 * （§8.2 "关系类型 allowlist" 硬性要求，fail-closed）。
 *
 * 候选/path shape 直接复用 semantica.schema 中的 GraphChannelCandidate /
 * GraphPathExplanation / GraphPathStep schemas，避免双定义漂移。
 */
export const GraphChannelQuerySchema = z.object({
  seeds: z
    .array(
      z.object({
        candidateId: z.string().min(1).max(200),
        canonicalKey: z
          .string()
          .regex(/^[A-Za-z0-9_./:@-]+$/)
          .min(1)
          .max(200),
      }),
    )
    .min(1)
    .max(50),
  budget: z
    .object({
      maxHops: z.number().int().min(1).max(4).optional(),
      maxNodes: z.number().int().min(1).max(500).optional(),
      maxEdges: z.number().int().min(1).max(500).optional(),
      timeoutMs: z.number().int().min(100).max(10_000).optional(),
      relationAllowList: z.array(z.string().min(1).max(80)).max(50).optional(),
    })
    .partial()
    .optional(),
});
export type GraphChannelQuery = z.infer<typeof GraphChannelQuerySchema>;

/**
 * §8.2 服务侧响应 envelope：内部 GraphChannelResult（无 stats 标准化）
 * 经 `mapGraphChannelResult` 投射到合同；stats 字段命名对齐 §8.2 验收
 * "节点/边上限与超时"。
 */
export const GraphChannelResponseSchema = z.object({
  candidates: z.array(GraphChannelCandidateSchema).max(500),
  stats: z.object({
    exploredEdges: z.number().int().nonnegative(),
    truncated: z.boolean(),
    elapsedMs: z.number().int().nonnegative(),
    droppedUnresolved: z.number().int().nonnegative(),
  }),
});
export type GraphChannelResponse = z.infer<typeof GraphChannelResponseSchema>;

/**
 * P1（docs/0906/ai-memory §7.1 Salience policy）：按 tenant/space 的 salience
 * read model。分数从不可变 feedback 事件、recall trace 命中和
 * Memory.confidence 重算，不改写 Memory 本体，不作为 active 晋升条件。
 * 权重为 salience-v1 默认闭集（tenant 级覆盖见路线图 §0.1 后续项）；
 * projectionCost 暂无可测量来源，恒为 0 且默认权重 0，保留字段位。
 */
export const SALIENCE_POLICY_VERSION = 'salience-v1';

export const SalienceWeightsSchema = z.object({
  helpful: z.number().min(0).max(10).default(1),
  stale: z.number().min(0).max(10).default(1),
  actorBreadth: z.number().min(0).max(10).default(0.5),
  recentUse: z.number().min(0).max(10).default(0.5),
  evidenceQuality: z.number().min(0).max(10).default(1),
  projectionCost: z.number().min(0).max(10).default(0),
});
export type SalienceWeights = z.infer<typeof SalienceWeightsSchema>;

export const MemorySalienceBreakdownSchema = z.object({
  /** helpful / 全部反馈；无反馈为 0。 */
  helpfulRate: z.number().min(0).max(1),
  /** (stale + wrong) / 全部反馈；无反馈为 0。 */
  staleRate: z.number().min(0).max(1),
  /** 去重反馈者数量（访问者广度）。 */
  distinctActors: z.number().int().nonnegative(),
  /** 窗口内 recall trace 命中次数（recent confirmed use）。 */
  recentUses: z.number().int().nonnegative(),
  /** Memory.confidence 归一化到 0..1。 */
  evidenceQuality: z.number().min(0).max(1),
  /** 投影成本占位：当前不可测量，恒 0。 */
  projectionCost: z.number().min(0).max(1),
});
export type MemorySalienceBreakdown = z.infer<typeof MemorySalienceBreakdownSchema>;

export const MemorySalienceSchema = z.object({
  memoryId: z.string().uuid(),
  spaceId: z.string().uuid().nullable(),
  scope: z.string(),
  sensitivity: z.string(),
  status: z.string(),
  /**
   * 保护标记：共享（TEAM/ENTERPRISE）或高敏感记忆不因低分进入自动清理
   * 候选——§7.1 要求高风险/共享 Memory 不因低访问量自动删除，前端据此
   * 禁用批量操作。
   */
  protected: z.boolean(),
  score: z.number(),
  breakdown: MemorySalienceBreakdownSchema,
});
export type MemorySalience = z.infer<typeof MemorySalienceSchema>;

export const MemorySalienceQuerySchema = z.object({
  spaceId: z.string().uuid().optional(),
  windowDays: z.coerce.number().int().min(7).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MemorySalienceQuery = z.infer<typeof MemorySalienceQuerySchema>;

export const MemorySalienceReportSchema = z.object({
  spaceId: z.string().uuid().nullable(),
  windowDays: z.number().int(),
  policyVersion: z.string(),
  weights: SalienceWeightsSchema,
  /** 按 score 升序：最低分在前，即“最值得复核保留”的操作顺序。 */
  list: z.array(MemorySalienceSchema),
  total: z.number().int().nonnegative(),
});
export type MemorySalienceReport = z.infer<typeof MemorySalienceReportSchema>;

/**
 * Sprint 7 KNO-Capability Learning C1 closed sets (docs/0831/13 §4). The
 * `CapabilityKind`/`CapabilityTrustClass`/`CapabilityGapStatus`/
 * `CapabilitySensitivityClass` enums are the only ones accepted from the
 * client; `CapabilityGap.requestedCapability` is a free-text description of
 * the missing capability, never a reference to a concrete Definition, so the
 * catalog can never silently leak an unreviewed entry into the recall path.
 */
export const CapabilitySourceHealthSchema = z.enum(['healthy', 'degraded', 'unconfigured']);

export const CreateCapabilityDefinitionSchema = z.object({
  kind: CapabilityKindSchema,
  identifier: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2_000).optional(),
  trustClass: CapabilityTrustClassSchema.default('COMMUNITY'),
});

export const PublishCapabilityVersionSchema = z.object({
  version: z.string().trim().min(1).max(80),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  publisher: z.string().trim().min(1).max(255),
  sourceHealth: CapabilitySourceHealthSchema.default('unconfigured'),
  riskFacts: z
    .record(z.string().min(1).max(120), z.union([z.string().max(2_000), z.number(), z.boolean()]))
    .default({}),
  policyFacts: z
    .record(z.string().min(1).max(120), z.union([z.string().max(2_000), z.number(), z.boolean()]))
    .default({}),
});

export const RecordCapabilityGapSchema = z
  .object({
    spaceId: z.string().uuid(),
    requestedCapability: z.string().trim().min(1).max(500),
    sensitivityClass: CapabilitySensitivityClassSchema,
    reason: z.string().trim().max(2_000).optional(),
    definitionId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      value.sensitivityClass !== 'CRITICAL' || Boolean(value.reason && value.reason.length > 0),
    {
      message: 'CRITICAL gaps must include a reason',
      path: ['reason'],
    },
  );

export const CapabilityDefinitionSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid().nullable(),
  kind: CapabilityKindSchema,
  identifier: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  trustClass: CapabilityTrustClassSchema,
  latestVersionId: z.string().uuid().nullable(),
  latestVersion: z.string().nullable(),
  latestDigest: z.string().nullable(),
  sourceHealth: CapabilitySourceHealthSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CapabilityVersionSchema = z.object({
  id: z.string().uuid(),
  definitionId: z.string().uuid(),
  version: z.string(),
  digest: z.string(),
  publisher: z.string(),
  sourceHealth: CapabilitySourceHealthSchema,
  riskFacts: z.record(z.string(), z.unknown()),
  policyFacts: z.record(z.string(), z.unknown()),
  publishedAt: z.coerce.date(),
  supersededAt: z.coerce.date().nullable(),
});

export const CapabilityGapSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  actorId: z.string().uuid(),
  requestedCapability: z.string(),
  sensitivityClass: CapabilitySensitivityClassSchema,
  status: CapabilityGapStatusSchema,
  definitionId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  summaryHash: z.string(),
  observedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});

export const CapabilityCatalogEntrySchema = CapabilityDefinitionSchema.extend({
  latestRiskFacts: z.record(z.string(), z.unknown()),
  latestPolicyFacts: z.record(z.string(), z.unknown()),
});

export const CapabilityGapListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: CapabilityGapStatusSchema.optional(),
  sensitivityClass: CapabilitySensitivityClassSchema.optional(),
  spaceId: z.string().uuid().optional(),
});

export const CapabilityCatalogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  kind: CapabilityKindSchema.optional(),
  trustClass: CapabilityTrustClassSchema.optional(),
});

export type CreateCapabilityDefinition = z.infer<typeof CreateCapabilityDefinitionSchema>;
export type PublishCapabilityVersion = z.infer<typeof PublishCapabilityVersionSchema>;
export type RecordCapabilityGap = z.infer<typeof RecordCapabilityGapSchema>;
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;
export type CapabilityVersion = z.infer<typeof CapabilityVersionSchema>;
export type CapabilityGap = z.infer<typeof CapabilityGapSchema>;
export type CapabilityCatalogEntry = z.infer<typeof CapabilityCatalogEntrySchema>;
export type CapabilityGapListQuery = z.output<typeof CapabilityGapListQuerySchema>;
export type CapabilityCatalogListQuery = z.output<typeof CapabilityCatalogListQuerySchema>;

/**
 * Sprint 7 KNO-Capability Learning C2 closed sets (docs/0831/13 §5.3). Approval
 * rows are append-only: callers never update an existing decision, they
 * supersede it with a fresh row. High-risk proposals require at least the
 * `requiredApprovers` rows from distinct reviewers (four-eye principle).
 */
export const CapabilityRequestedPermissionSchema = z.object({
  scope: z.string().trim().min(1).max(120),
  resource: z.string().trim().min(1).max(255),
});

export const SubmitCapabilityProposalSchema = z.object({
  spaceId: z.string().uuid(),
  capabilityVersionId: z.string().uuid(),
  gapId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1).max(120),
  requestedScope: z.record(z.string().min(1).max(120), z.unknown()),
  requestedPermissions: z.array(CapabilityRequestedPermissionSchema).min(1).max(50),
  trialTtlSeconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600),
  tokenBudget: z.number().int().min(0).max(1_000_000_000).default(0),
  toolCallBudget: z.number().int().min(0).max(1_000_000).default(0),
  origin: CapabilityProposalOriginSchema.default('DIRECT'),
  reason: z.string().trim().max(2_000).optional(),
});

export const CapabilityProposalAvailableActionSchema = z.enum([
  'submit',
  'request_information',
  'approve_trial',
  'reject',
  'revoke',
  'cancel',
  'no_op',
]);

export const CapabilityProposalSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  capabilityVersionId: z.string().uuid(),
  gapId: z.string().uuid().nullable(),
  requesterId: z.string().uuid(),
  requestedScope: z.record(z.string(), z.unknown()),
  requestedPermissions: z.array(CapabilityRequestedPermissionSchema),
  trialTtlSeconds: z.number().int().nonnegative(),
  tokenBudget: z.number().int().nonnegative(),
  toolCallBudget: z.number().int().nonnegative(),
  status: CapabilityProposalStatusSchema,
  origin: CapabilityProposalOriginSchema,
  approvedScope: z.record(z.string(), z.unknown()).nullable(),
  approvedConstraints: z.record(z.string(), z.unknown()).nullable(),
  expiresAt: z.coerce.date().nullable(),
  availableActions: z.array(CapabilityProposalAvailableActionSchema),
  requiredApprovers: z.number().int().nonnegative(),
  collectedApprovals: z.number().int().nonnegative(),
  policyVersion: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CapabilityApprovalSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  decision: CapabilityApprovalDecisionSchema,
  decidedBy: z.string().uuid(),
  decidedAt: z.coerce.date(),
  reasonCode: z.string().nullable(),
  comment: z.string().nullable(),
  approvedScope: z.record(z.string(), z.unknown()).nullable(),
  constraints: z.record(z.string(), z.unknown()).nullable(),
  policyVersion: z.string(),
  supersedesApprovalId: z.string().uuid().nullable(),
});

export const RequestProposalInformationSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const ApproveProposalSchema = z.object({
  approvedScope: z
    .record(z.string().min(1).max(120), z.unknown())
    .refine((value) => Object.keys(value).length > 0, 'approvedScope must not be empty'),
  constraints: z.record(z.string().min(1).max(120), z.unknown()).default({}),
  reasonCode: z.string().trim().min(1).max(120).optional(),
  comment: z.string().trim().max(2_000).optional(),
});

export const RejectProposalSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const RevokeProposalSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const CapabilityProposalListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: CapabilityProposalStatusSchema.optional(),
  spaceId: z.string().uuid().optional(),
});

export const CapabilityProposalDetailSchema = CapabilityProposalSchema.extend({
  approvals: z.array(CapabilityApprovalSchema),
});

export type CapabilityRequestedPermission = z.infer<typeof CapabilityRequestedPermissionSchema>;
export type SubmitCapabilityProposal = z.infer<typeof SubmitCapabilityProposalSchema>;
export type CapabilityProposalAvailableAction = z.infer<
  typeof CapabilityProposalAvailableActionSchema
>;
export type CapabilityProposal = z.infer<typeof CapabilityProposalSchema>;
export type CapabilityApproval = z.infer<typeof CapabilityApprovalSchema>;
export type RequestProposalInformation = z.infer<typeof RequestProposalInformationSchema>;
export type ApproveProposal = z.infer<typeof ApproveProposalSchema>;
export type RejectProposal = z.infer<typeof RejectProposalSchema>;
export type RevokeProposal = z.infer<typeof RevokeProposalSchema>;
export type CapabilityProposalListQuery = z.output<typeof CapabilityProposalListQuerySchema>;
export type CapabilityProposalDetail = z.infer<typeof CapabilityProposalDetailSchema>;

/**
 * Sprint 7 KNO-Capability Learning C3（docs/0831/13 §6）：Agents Bounded Trial。
 * Runtime report 输入只允许 BINDING/READY/FAILED 三个状态——REQUESTED 只能
 * 由 Knowledge 创建，REVOKING/REVOKED 只能由管理端紧急撤销驱动，Agent 侧
 * 永远不能自报终态或撤销态。capabilityDigest 必须与已批准的
 * CapabilityVersion digest 完全一致，scope 不得超出 approvedScope（领域层
 * 做闭集校验）。Secret 一律以 reference 传递，本契约不接受任何凭证字段。
 */
export const ReportRuntimeBindingSchema = z.object({
  proposalId: z.string().uuid(),
  externalBindingRef: z.string().trim().min(1).max(160),
  agentRuntimeId: z.string().trim().min(1).max(160),
  scope: z.record(z.string().min(1).max(120), z.unknown()),
  capabilityDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'capabilityDigest must be a lowercase sha-256 hex'),
  status: z.enum(['BINDING', 'READY', 'FAILED']),
  leaseTtlSeconds: z
    .number()
    .int()
    .min(30)
    .max(24 * 3600)
    .default(3600),
  failureReasonCode: z.string().trim().max(120).optional(),
});

export const RuntimeBindingHeartbeatSchema = z.object({
  leaseTtlSeconds: z
    .number()
    .int()
    .min(30)
    .max(24 * 3600)
    .default(3600),
});

export const ReportTrialOutcomeSchema = z
  .object({
    executionRef: z.string().trim().min(1).max(160),
    idempotencyKey: z.string().trim().min(1).max(120),
    evidenceIds: z.array(z.string().trim().min(1).max(160)).max(200).default([]),
    traceRef: z.string().trim().max(160).optional(),
    outcomeClass: CapabilityTrialOutcomeClassSchema,
    taskSuccess: z.boolean(),
    userCorrection: z.boolean().default(false),
    citationCoverage: z.number().min(0).max(1),
    tokenCount: z.number().int().min(0).max(1_000_000_000).default(0),
    toolCallCount: z.number().int().min(0).max(1_000_000).default(0),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 3600 * 1000)
      .default(0),
    policyViolations: z.number().int().min(0).max(10_000).default(0),
    scorerVersion: z.string().trim().min(1).max(80),
    observedAt: z.coerce.date().optional(),
  })
  .refine(
    (value) => value.outcomeClass !== 'VIOLATION' || value.policyViolations > 0,
    'VIOLATION outcomes must report policyViolations > 0',
  );

export const CapabilityRuntimeBindingSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  externalBindingRef: z.string(),
  agentRuntimeId: z.string(),
  scope: z.record(z.string(), z.unknown()),
  capabilityDigest: z.string(),
  status: CapabilityBindingStatusSchema,
  leaseExpiresAt: z.coerce.date(),
  lastHeartbeatAt: z.coerce.date().nullable(),
  failureReasonCode: z.string().nullable(),
  revokedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CapabilityTrialOutcomeSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  bindingId: z.string().uuid(),
  executionRef: z.string(),
  evidenceIds: z.array(z.string()),
  traceRef: z.string().nullable(),
  outcomeClass: CapabilityTrialOutcomeClassSchema,
  taskSuccess: z.boolean(),
  userCorrection: z.boolean(),
  citationCoverage: z.number(),
  tokenCount: z.number().int(),
  toolCallCount: z.number().int(),
  durationMs: z.number().int(),
  policyViolations: z.number().int(),
  scorerVersion: z.string(),
  idempotencyKey: z.string(),
  observedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export const RevokeRuntimeBindingSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const CapabilityRuntimeBindingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: CapabilityBindingStatusSchema.optional(),
  proposalId: z.string().uuid().optional(),
});

export const CapabilityRuntimeBindingDetailSchema = CapabilityRuntimeBindingSchema.extend({
  outcomes: z.array(CapabilityTrialOutcomeSchema),
});

export type ReportRuntimeBinding = z.infer<typeof ReportRuntimeBindingSchema>;
export type RuntimeBindingHeartbeat = z.infer<typeof RuntimeBindingHeartbeatSchema>;
export type ReportTrialOutcome = z.infer<typeof ReportTrialOutcomeSchema>;
export type CapabilityRuntimeBinding = z.infer<typeof CapabilityRuntimeBindingSchema>;
export type CapabilityTrialOutcome = z.infer<typeof CapabilityTrialOutcomeSchema>;
export type RevokeRuntimeBinding = z.infer<typeof RevokeRuntimeBindingSchema>;
export type CapabilityRuntimeBindingListQuery = z.output<
  typeof CapabilityRuntimeBindingListQuerySchema
>;
export type CapabilityRuntimeBindingDetail = z.infer<typeof CapabilityRuntimeBindingDetailSchema>;

/**
 * Sprint 7 KNO-Capability Learning C4（docs/0831/13 §7）：Usage Rule Replay/Guard。
 * Candidate 默认不可 resolve，trigger/exclusion/parameter template/guard policy/
 * citation requirements 全部版本化。Guard simulator 只模拟决策，不执行工具。
 */
export const UsageRuleTriggerConditionSchema = z.object({
  type: z.enum(['keyword', 'vector_match', 'memory_type', 'intent']),
  value: z.string().trim().min(1).max(500),
  weight: z.number().min(0).max(1).default(1),
});

export const UsageRuleExclusionConditionSchema = z.object({
  type: z.enum(['keyword', 'tag', 'memory_status', 'sensitivity']),
  value: z.string().trim().min(1).max(500),
});

export const UsageRuleParameterTemplateSchema = z.object({
  input: z.string().trim().max(2_000).optional(),
  tools: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  citationsRequired: z.boolean().default(true),
});

export const UsageRuleGuardPolicySchema = z.object({
  requireActiveCapabilityVersion: z.boolean().default(true),
  maxToolCalls: z.number().int().min(1).max(1_000).default(20),
  maxTokens: z.number().int().min(0).max(1_000_000_000).default(10_000),
  forbidTags: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
});

export const UsageRuleCitationRequirementsSchema = z.object({
  minCitations: z.number().int().min(0).max(20).default(1),
  minCoverage: z.number().min(0).max(1).default(0.5),
  requireChunkRef: z.boolean().default(true),
});

export const CreateUsageRuleSchema = z
  .object({
    spaceId: z.string().uuid(),
    capabilityId: z.string().uuid(),
    capabilityVersionId: z.string().uuid(),
    capabilityDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'capabilityDigest must be a lowercase sha-256 hex'),
    triggerSignature: z.string().trim().min(1).max(120),
    scope: z.record(z.string().min(1).max(120), z.unknown()),
    sourceProposalIds: z.array(z.string().uuid()).max(50).default([]),
    evidenceIds: z.array(z.string().trim().min(1).max(160)).max(200).default([]),
    triggerConditions: z.array(UsageRuleTriggerConditionSchema).min(1).max(20),
    exclusionConditions: z.array(UsageRuleExclusionConditionSchema).max(20).default([]),
    parameterTemplate: UsageRuleParameterTemplateSchema,
    requiredPermissions: z
      .array(z.object({ scope: z.string().min(1).max(120), resource: z.string().min(1).max(255) }))
      .min(1)
      .max(50),
    guardPolicy: UsageRuleGuardPolicySchema,
    citationRequirements: UsageRuleCitationRequirementsSchema,
    idempotencyKey: z.string().trim().min(1).max(120),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
  })
  .refine((value) => !value.validFrom || !value.validUntil || value.validFrom < value.validUntil, {
    message: 'validFrom must be earlier than validUntil',
    path: ['validUntil'],
  });

export const ReportUsageRuleEvaluationSchema = z.object({
  usageRuleVersionId: z.string().uuid(),
  replayPlanId: z.string().trim().min(1).max(160),
  taskSetHash: z.string().regex(/^[0-9a-f]{64}$/, 'taskSetHash must be a lowercase sha-256 hex'),
  baselineScore: z.number().min(0).max(1),
  ruleScore: z.number().min(0).max(1),
  costDelta: z.number().int().min(-1_000_000).max(1_000_000),
  safetyViolations: z.number().int().min(0).max(10_000).default(0),
  citationCoverage: z.number().min(0).max(1).default(0),
  sampleCount: z.number().int().min(0).max(10_000).default(1),
  scorerVersion: z.string().trim().min(1).max(80),
  observedAt: z.coerce.date().optional(),
});

export const UsageRuleGuardSimulationSchema = z.object({
  usageRuleId: z.string().uuid(),
  usageRuleVersionId: z.string().uuid().optional(),
  triggerText: z.string().trim().min(1).max(2_000),
  toolCalls: z
    .array(z.object({ name: z.string().min(1).max(120) }))
    .max(100)
    .default([]),
  tokens: z.number().int().min(0).max(1_000_000_000).default(0),
  tagSet: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
});

/**
 * Sprint 7 KNO-Capability Learning C5（docs/0831/13 §8）：Scoped Publish /
 * Operations. UsageRule lifecycle actions are closed sets so the console
 * never invents states server-side. STALE/RETIRED transitions require a
 * reasonCode so the audit trail (Outbox + immutable capability_approvals
 * equivalent) can be reconstructed.
 */
export const UsageRuleAvailableActionSchema = z.enum([
  'submit_for_trial',
  'activate',
  'retire',
  'revoke',
  'no_op',
]);

export const ActivateUsageRuleSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const RetireUsageRuleSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const RevokeUsageRuleSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export type UsageRuleAvailableAction = z.infer<typeof UsageRuleAvailableActionSchema>;
export type ActivateUsageRule = z.infer<typeof ActivateUsageRuleSchema>;
export type RetireUsageRule = z.infer<typeof RetireUsageRuleSchema>;
export type RevokeUsageRule = z.infer<typeof RevokeUsageRuleSchema>;

export const UsageRuleSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  capabilityId: z.string().uuid(),
  capabilityVersionId: z.string().uuid().nullable(),
  capabilityDigest: z.string().nullable(),
  scope: z.record(z.string(), z.unknown()),
  status: UsageRuleStatusSchema,
  currentVersionId: z.string().uuid().nullable(),
  triggerSignature: z.string(),
  sourceProposalIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  validFrom: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  retiredReason: z.string().nullable(),
  availableActions: z.array(UsageRuleAvailableActionSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const UsageRuleVersionSchema = z.object({
  id: z.string().uuid(),
  usageRuleId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  capabilityVersionId: z.string().uuid(),
  capabilityDigest: z.string(),
  triggerConditions: z.array(UsageRuleTriggerConditionSchema),
  exclusionConditions: z.array(UsageRuleExclusionConditionSchema),
  parameterTemplate: UsageRuleParameterTemplateSchema,
  requiredPermissions: z.array(z.object({ scope: z.string(), resource: z.string() })),
  guardPolicy: UsageRuleGuardPolicySchema,
  citationRequirements: UsageRuleCitationRequirementsSchema,
  contentHash: z.string(),
  createdBy: z.string().uuid(),
  createdAt: z.coerce.date(),
});

export const UsageRuleEvaluationSchema = z.object({
  id: z.string().uuid(),
  usageRuleId: z.string().uuid(),
  usageRuleVersionId: z.string().uuid(),
  replayPlanId: z.string(),
  taskSetHash: z.string(),
  baselineScore: z.number(),
  ruleScore: z.number(),
  pairedGain: z.number(),
  costDelta: z.number().int(),
  safetyViolations: z.number().int(),
  citationCoverage: z.number(),
  sampleCount: z.number().int(),
  scorerVersion: z.string(),
  observedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export const UsageRuleGuardDecisionSchema = z.object({
  allow: z.boolean(),
  reasons: z.array(z.string()),
  matchedTriggers: z.array(z.string()),
  violatedExclusions: z.array(z.string()),
  toolCallExcess: z.boolean(),
  tokenExcess: z.boolean(),
  forbiddenTags: z.array(z.string()),
  citationCoverage: z.number(),
});

export const UsageRuleDetailSchema = UsageRuleSchema.extend({
  versions: z.array(UsageRuleVersionSchema),
  evaluations: z.array(UsageRuleEvaluationSchema),
});

export const UsageRuleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: UsageRuleStatusSchema.optional(),
  spaceId: z.string().uuid().optional(),
  capabilityId: z.string().uuid().optional(),
});

export type UsageRuleTriggerCondition = z.infer<typeof UsageRuleTriggerConditionSchema>;
export type UsageRuleExclusionCondition = z.infer<typeof UsageRuleExclusionConditionSchema>;
export type UsageRuleParameterTemplate = z.infer<typeof UsageRuleParameterTemplateSchema>;
export type UsageRuleGuardPolicy = z.infer<typeof UsageRuleGuardPolicySchema>;
export type UsageRuleCitationRequirements = z.infer<typeof UsageRuleCitationRequirementsSchema>;
export type CreateUsageRule = z.infer<typeof CreateUsageRuleSchema>;
export type ReportUsageRuleEvaluation = z.infer<typeof ReportUsageRuleEvaluationSchema>;
export type UsageRuleGuardSimulation = z.infer<typeof UsageRuleGuardSimulationSchema>;
export type UsageRule = z.infer<typeof UsageRuleSchema>;
export type UsageRuleVersion = z.infer<typeof UsageRuleVersionSchema>;
export type UsageRuleEvaluation = z.infer<typeof UsageRuleEvaluationSchema>;
export type UsageRuleGuardDecision = z.infer<typeof UsageRuleGuardDecisionSchema>;
export type UsageRuleDetail = z.infer<typeof UsageRuleDetailSchema>;
export type UsageRuleListQueryInput = z.input<typeof UsageRuleListQuerySchema>;
export type UsageRuleListQuery = z.output<typeof UsageRuleListQuerySchema>;

/**
 * Sprint 7 KNO-Runtime MCP call loop (docs/0901/04 + docs/0901/06 §1, §2):
 * every external runtime (Yootun Agent, dsh, Claude Code…) calls the
 * JSON-RPC MCP surface at `POST /mcp`, which resolves the caller's identity
 * through `KnowledgeAuthContextResolver`. The `/api/yootun/v1/*` route group
 * is a separate ts-rest REST surface (`yootunAgentContract` in
 * knowledge.contract.ts:960) used by yootun-agent itself — it is NOT the MCP
 * endpoint. The MCP context flows into every domain service so recall,
 * capture, promotion, capability trials and ACL decisions share one identity
 * boundary; secrets and tool payloads never cross this surface.
 */
export const McpPrincipalTypeSchema = z.enum([
  'user',
  'group',
  'service',
  'agent_runtime',
  'admin',
]);
export type McpPrincipalType = z.infer<typeof McpPrincipalTypeSchema>;

export const KnowledgeCredentialTypeSchema = z.enum(['model_api_key']);
export type KnowledgeCredentialType = z.infer<typeof KnowledgeCredentialTypeSchema>;

export const KnowledgeMcpScopeSchema = z.enum([
  'knowledge.read',
  'knowledge.memory.write',
  'knowledge.memory.confirm',
  'knowledge.memory.forget',
  'knowledge.document.ingest',
  'knowledge.session.checkpoint',
  'knowledge.promote',
]);
export type KnowledgeMcpScope = z.infer<typeof KnowledgeMcpScopeSchema>;
export const KNOWLEDGE_MCP_SCOPES = KnowledgeMcpScopeSchema.options;
export const KNOWLEDGE_GATEWAY_ROLLOUT_SOURCE = 'models.dofe.ai:gateway-rollout';

export const ModelKeyBindingSchema = z.object({
  keyId: z.string().trim().min(1).max(160),
  // tenantId is the binding-side identifier from models.dofe.ai; we validate it
  // against a real Knowledge tenant on use, so the wire format only needs to be
  // a non-empty opaque id.
  tenantId: z.string().trim().min(1).max(160),
  memberId: z.string().trim().min(1).max(160),
  groupIds: z.array(z.string().trim().min(1).max(160)).default([]),
  subjectUserId: z.string().trim().min(1).max(160).nullable().default(null),
  scopes: z.array(z.string().trim().min(1).max(120)).default([]),
  expiresAt: z.coerce.date().nullable().default(null),
  sourceSystem: z.string().trim().min(1).max(120).default('models.dofe.ai'),
});
export type ModelKeyBinding = z.infer<typeof ModelKeyBindingSchema>;

export const KnowledgeRequestContextSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  tenantId: z.string().uuid(),
  principalId: z.string().trim().min(1).max(160),
  principalType: McpPrincipalTypeSchema,
  credentialType: KnowledgeCredentialTypeSchema.optional(),
  subjectUserId: z.string().trim().min(1).max(160).optional(),
  groupIds: z.array(z.string().trim().min(1).max(160)).default([]),
  // Legacy binding scopes remain visible during migration; dispatch only
  // recognizes the closed canonical vocabulary above.
  scopes: z.array(z.string().trim().min(1).max(120)).default([]),
  keyId: z.string().trim().min(1).max(160).optional(),
  keyBindingId: z.string().trim().min(1).max(160).optional(),
  agentRuntimeId: z.string().trim().min(1).max(160).optional(),
  sourceSystem: z.string().trim().min(1).max(120).default('models.dofe.ai'),
  receivedAt: z.coerce.date(),
});
export type KnowledgeRequestContext = z.infer<typeof KnowledgeRequestContextSchema>;

export const KnowledgeAccessDecisionSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  status: z.enum(['allow', 'deny', 'degraded']),
  availableActions: z.array(z.string().trim().min(1).max(120)).default([]),
  reasonCodes: z.array(z.string().trim().min(1).max(120)).default([]),
  traceId: z.string().trim().min(1).max(160),
  contractVersion: z.string().trim().min(1).max(40).default('2026-09-01'),
  updatedAt: z.coerce.date(),
});
export type KnowledgeAccessDecision = z.infer<typeof KnowledgeAccessDecisionSchema>;

/**
 * MCP call inputs (Phase 0 + Phase 2, docs/0901/06 §2 + docs/0906/01 §16.2).
 * Every schema is the authoritative closed set; legacy `CreateMemorySchema` /
 * `KnowledgeSearchSchema` stay as the deep API surface while MCP uses these
 * thinner wrappers.
 *
 * Phase 0 contract change (2026-09-05):
 *   - MCP inputs now accept `spaceKey(s)` / `targetSpaceKey` as the
 *     authoritative addressing primitive. Servers resolve the key against the
 *     verified tenant/user runtime context and reject UUIDs that are not part
 *     of the caller's accessible space set.
 *   - `spaceId(s)` / `targetSpaceId` remain for backwards compatibility with
 *     adapters still pinning UUIDs; the controller resolves UUIDs only after
 *     re-running ACL against the caller. Both cannot be required at the same
 *     time; mixing them yields a 400 error.
 *
 * `McpSpaceKeySchema` and `MCP_SPACE_KEY_PATTERN` are defined earlier (next to
 * the deep REST schemas) so the schema graph resolves in a single pass.
 */
export const McpMemoryCandidateSchema = z
  .object({
    content: z.string().trim().min(1).max(20_000),
    type: MemoryTypeSchema.default('SEMANTIC'),
    scope: MemoryScopeSchema.default('USER'),
    spaceKey: McpSpaceKeySchema.optional(),
    spaceId: z.string().uuid().optional(),
    sourceSessionId: z.string().trim().min(1).max(255).optional(),
    evidence: z.array(MemoryEvidenceCitationSchema).max(20).default([]),
    captureReason: z.string().trim().min(1).max(120).default('mcp-capture'),
  })
  .refine((value) => !(value.spaceKey && value.spaceId), {
    message: 'spaceKey and spaceId are mutually exclusive; pass exactly one',
    path: ['spaceKey'],
  });
export type McpMemoryCandidate = z.infer<typeof McpMemoryCandidateSchema>;

export const McpMemoryConfirmSchema = z.object({
  reason: z.string().trim().min(1).max(500).default('user-confirmed'),
  shareWithSpace: z.boolean().default(false),
});
export type McpMemoryConfirm = z.infer<typeof McpMemoryConfirmSchema>;

export const McpMemoryForgetSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type McpMemoryForget = z.infer<typeof McpMemoryForgetSchema>;

export const McpRecallSchema = z
  .object({
    query: z.string().trim().min(1).max(4000),
    spaceKeys: z.array(McpSpaceKeySchema).max(20).optional(),
    spaceIds: z.array(z.string().uuid()).max(20).optional(),
    topK: z.number().int().min(1).max(50).default(8),
    includeMemories: z.boolean().default(true),
    includeDocuments: z.boolean().default(true),
    retrievalMode: RetrievalModeSchema.default('lexical-v1'),
  })
  .refine((value) => !(value.spaceKeys && value.spaceIds), {
    message: 'spaceKeys and spaceIds are mutually exclusive; pass exactly one',
    path: ['spaceKeys'],
  });
export type McpRecall = z.infer<typeof McpRecallSchema>;

/**
 * P1-3 (docs/0906/02 §9 + §10): Recall Explain / assertion query tool
 * contracts for the yootun-agent MCP surface. All reads stay ACL-scoped on
 * the server; the payload never carries query plaintext or chunk content.
 */
export const McpExplainTraceSchema = z.object({
  /** RecallTrace id returned by a previous search/recall response. */
  traceId: z.string().uuid(),
});
export type McpExplainTrace = z.infer<typeof McpExplainTraceSchema>;

export const McpEntityAssertionQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  status: EntityAssertionStatusSchema.optional(),
  entityType: z.string().min(1).max(40).optional(),
  canonicalKey: CanonicalKeySchema.max(200).optional(),
});
export type McpEntityAssertionQuery = z.infer<typeof McpEntityAssertionQuerySchema>;

export const McpRelationAssertionQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  status: RelationAssertionStatusSchema.optional(),
  predicate: RelationPredicateSchema.optional(),
  subjectKey: CanonicalKeySchema.max(200).optional(),
  objectKey: CanonicalKeySchema.max(200).optional(),
});
export type McpRelationAssertionQuery = z.infer<typeof McpRelationAssertionQuerySchema>;

export const McpEntityMergeQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  status: EntityMergeStatusSchema.optional(),
  canonicalEntityId: z.string().uuid().optional(),
  sourceEntityId: z.string().uuid().optional(),
});
export type McpEntityMergeQuery = z.infer<typeof McpEntityMergeQuerySchema>;

/**
 * §10.3 Provenance 控制台视图：MCP `knowledge.provenance_lineage` 工具入参。
 * maxDepth 与域服务上限（20）一致；响应形状见 semantica.schema.ts 的
 * ProvenanceLineageResponseSchema。
 */
export const McpProvenanceLineageQuerySchema = z.object({
  entityId: z.string().uuid(),
  maxDepth: z.number().int().min(1).max(20).default(8),
});
export type McpProvenanceLineageQuery = z.infer<typeof McpProvenanceLineageQuerySchema>;

/** Subset of the Prisma row visible to console + MCP (no created/updated prisma noise). */
export const KnowledgeEntityMergeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  canonicalEntityId: z.string().uuid(),
  sourceEntityId: z.string().uuid(),
  score: z.number().min(0).max(1),
  deterministicKey: z.string().max(60).nullable(),
  status: EntityMergeStatusSchema,
  reviewerId: z.string().uuid().nullable(),
  reviewedAt: z.coerce.date().nullable(),
  reversedById: z.string().uuid().nullable(),
  reversedAt: z.coerce.date().nullable(),
});
export type KnowledgeEntityMerge = z.infer<typeof KnowledgeEntityMergeSchema>;

/** Shared body for accept / reject / reverse endpoints. */
export const DecideEntityMergeSchema = z.object({
  reviewNote: z.string().trim().max(500).optional(),
});
export type DecideEntityMerge = z.infer<typeof DecideEntityMergeSchema>;

/** Propose a merge row (PROPOSED). Deterministic-key hits auto-ACCEPTED. */
export const ProposeEntityMergeContractSchema = z.object({
  canonicalEntityId: z.string().uuid(),
  sourceEntityId: z.string().uuid(),
  score: z.number().min(0).max(1),
  deterministicKey: z.string().trim().min(1).max(60).nullable().optional(),
});
export type ProposeEntityMergeContract = z.infer<typeof ProposeEntityMergeContractSchema>;

/**
 * MCP checkpoint contract (P1-4, docs/0906/02): events/evidence are part of
 * the typed wire contract — a typed MCP client can send the full payload
 * without out-of-band fields. Bounds match the server-side enforcement
 * (50 events / 20 evidence) so over-limit payloads are rejected by the schema
 * instead of silently truncated.
 */
export const McpSessionCheckpointSchema = z.object({
  externalSessionId: z.string().trim().min(1).max(255),
  captureReason: z.string().trim().min(1).max(120).default('runtime-checkpoint'),
  startSeq: z.number().int().min(0),
  endSeq: z.number().int().min(0),
  summary: z.string().trim().max(50_000).optional(),
  events: z.array(SessionCheckpointEventSchema).max(50).default([]),
  evidence: z.array(SessionCheckpointEvidenceSchema).max(20).default([]),
  candidateContents: z.array(McpMemoryCandidateSchema).max(20).default([]),
});
export type McpSessionCheckpoint = z.infer<typeof McpSessionCheckpointSchema>;

export const McpKnowledgePromotionSchema = z
  .object({
    sourceMemoryIds: z.array(z.string().uuid()).min(1).max(50),
    targetSpaceKey: McpSpaceKeySchema.optional(),
    targetSpaceId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(280),
    classification: z
      .enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'])
      .default('INTERNAL'),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((value) => Boolean(value.targetSpaceKey) !== Boolean(value.targetSpaceId), {
    message: 'targetSpaceKey and targetSpaceId are mutually exclusive; pass exactly one',
    path: ['targetSpaceKey'],
  });
export type McpKnowledgePromotion = z.infer<typeof McpKnowledgePromotionSchema>;

export const McpCapabilityEntrySchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  surface: z.enum(['mcp', 'http']),
  endpoint: z.string().trim().min(1).max(200),
  requiresAuth: z.boolean().default(true),
});
export type McpCapabilityEntry = z.infer<typeof McpCapabilityEntrySchema>;

export const McpCapabilitiesSchema = z.object({
  contractVersion: z.string().trim().min(1).max(40).default('2026-09-01'),
  retrievalMode: RetrievalModeSchema,
  capabilities: z.array(McpCapabilityEntrySchema),
});
export type McpCapabilities = z.infer<typeof McpCapabilitiesSchema>;

/**
 * Sprint 7 KNO-L3/Skill（docs/0831/01 §4.3 + §5.3）：EnvironmentFact 是
 * 企业环境规律三元组事实（Neo4j 只投影已授权行）；MemorySkill 是从
 * ACTIVE Strategy 提升的可执行技能。Skill 上线展示触发条件/允许工具/
 * 步骤证据/验证规则/fallback/边界/版本/最后验证时间；ACTIVE 非永久，
 * 过期或负向反馈触发降级。
 */
export const CreateEnvironmentFactSchema = z
  .object({
    spaceId: z.string().uuid(),
    subject: z.string().trim().min(1).max(255),
    predicate: z.string().trim().min(1).max(120),
    object: z.string().trim().min(1).max(255),
    confidence: z.number().min(0).max(1).default(0.5),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
    sourceStrategyIds: z.array(z.string().uuid()).max(50).default([]),
    sourceCitationIds: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
    conflictSetId: z.string().trim().max(120).optional(),
  })
  .refine((value) => !value.validFrom || !value.validUntil || value.validFrom < value.validUntil, {
    message: 'validFrom must be earlier than validUntil',
    path: ['validUntil'],
  });

export const RevokeEnvironmentFactSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const EnvironmentFactSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  confidence: z.number(),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date().nullable(),
  sourceStrategyIds: z.array(z.string()),
  sourceCitationIds: z.array(z.string()),
  conflictSetId: z.string().nullable(),
  status: EnvironmentFactStatusSchema,
  revokedReason: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const PromoteSkillSchema = z
  .object({
    spaceId: z.string().uuid(),
    strategyId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    trigger: z.record(z.string(), z.unknown()),
    allowedTools: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    steps: z.array(
      z.object({
        order: z.number().int().min(0),
        action: z.string().trim().min(1).max(2000),
        evidenceId: z.string().uuid(),
      }),
    ),
    validation: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
    fallback: z.record(z.string(), z.unknown()).optional(),
    boundaries: z.record(z.string(), z.unknown()).optional(),
    evidenceIds: z.array(z.string().uuid()).min(1).max(100),
    idempotencyKey: z.string().trim().min(1).max(120),
  })
  .refine((value) => value.allowedTools.length > 0, {
    message: 'a Skill must declare an explicit tool allowlist',
    path: ['allowedTools'],
  });

export const ReportSkillTrialSchema = z
  .object({
    skillId: z.string().uuid(),
    executionId: z.string().trim().min(1).max(160),
    outcome: z.enum(['PASS', 'FAIL']),
    corrected: z.boolean().default(false),
    boundaryViolation: z.boolean().default(false),
    evidenceIds: z.array(z.string().uuid()).max(50).default([]),
    scorerVersion: z.string().trim().min(1).max(80),
    observedAt: z.coerce.date().optional(),
  })
  .refine((value) => value.outcome !== 'PASS' || !value.boundaryViolation, {
    message: 'a PASS outcome cannot claim a boundary violation',
    path: ['boundaryViolation'],
  });

export const MemorySkillSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  strategyId: z.string().uuid(),
  name: z.string(),
  trigger: z.record(z.string(), z.unknown()),
  allowedTools: z.array(z.string()),
  steps: z.array(z.object({ order: z.number().int(), action: z.string(), evidenceId: z.string() })),
  validation: z.array(z.string()),
  fallback: z.record(z.string(), z.unknown()).nullable(),
  boundaries: z.record(z.string(), z.unknown()).nullable(),
  evidenceIds: z.array(z.string()),
  status: MemorySkillStatusSchema,
  version: z.number().int().nonnegative(),
  reliability: z.number(),
  trialCount: z.number().int().nonnegative(),
  passCount: z.number().int().nonnegative(),
  correctionCount: z.number().int().nonnegative(),
  boundaryViolationCount: z.number().int().nonnegative(),
  consecutiveFailCount: z.number().int().nonnegative(),
  lastVerifiedAt: z.coerce.date().nullable(),
  retiredReason: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const SkillActivateSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const SkillRetireSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const SkillRevokeSchema = z.object({
  reasonCode: z.string().trim().min(1).max(120),
  comment: z.string().trim().max(2_000).optional(),
});

export const EnvironmentFactListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: EnvironmentFactStatusSchema.optional(),
  spaceId: z.string().uuid().optional(),
});

export const MemorySkillListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: MemorySkillStatusSchema.optional(),
  spaceId: z.string().uuid().optional(),
});

export const MemorySkillAvailableActionSchema = z.enum([
  'submit_for_trial',
  'activate',
  'retire',
  'revoke',
  'no_op',
]);

export type CreateEnvironmentFact = z.infer<typeof CreateEnvironmentFactSchema>;
export type RevokeEnvironmentFact = z.infer<typeof RevokeEnvironmentFactSchema>;
export type EnvironmentFact = z.infer<typeof EnvironmentFactSchema>;
export type PromoteSkill = z.infer<typeof PromoteSkillSchema>;
export type ReportSkillTrial = z.infer<typeof ReportSkillTrialSchema>;
export type MemorySkill = z.infer<typeof MemorySkillSchema>;
export type SkillActivate = z.infer<typeof SkillActivateSchema>;
export type SkillRetire = z.infer<typeof SkillRetireSchema>;
export type SkillRevoke = z.infer<typeof SkillRevokeSchema>;
export type EnvironmentFactListQueryInput = z.input<typeof EnvironmentFactListQuerySchema>;
export type EnvironmentFactListQuery = z.output<typeof EnvironmentFactListQuerySchema>;
export type MemorySkillListQueryInput = z.input<typeof MemorySkillListQuerySchema>;
export type MemorySkillListQuery = z.output<typeof MemorySkillListQuerySchema>;
export type MemorySkillAvailableAction = z.infer<typeof MemorySkillAvailableActionSchema>;
export type KnowledgeTenantSummary = z.infer<typeof KnowledgeTenantSummarySchema>;
export type KnowledgeTenantListQueryInput = z.input<typeof KnowledgeTenantListQuerySchema>;
export type KnowledgeTenantListQuery = z.output<typeof KnowledgeTenantListQuerySchema>;
