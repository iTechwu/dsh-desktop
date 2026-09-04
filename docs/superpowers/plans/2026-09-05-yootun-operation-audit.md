# Yootun-Agent 操作审计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将无业务闭环的“统一审批”替换为可靠、只读、可按本人或团队追溯的操作审计能力。

**Architecture:** Models 提供 Zod-first 的集中写入、查询、权限与保留服务；Desktop 提供 Cordis `yootunAudit` 服务、本地逐事件 outbox、补传和同源查询代理；docker 仓库提供审计工作台 UI，并从其拥有的 Host 插件写操作接入同一服务。身份和团队权限由 Models 根据 API Key 与 SSO 派生，客户端永远不能提交身份字段。

**Tech Stack:** TypeScript 6、NestJS 11、Prisma/PostgreSQL、Zod 4、ts-rest、Cordis、Node.js 文件系统、React 19、DSH UI primitives、Vitest/Jest/Node test。

**Spec:** `docs/superpowers/specs/2026-09-04-yootun-operation-audit-design.md`

## Global Constraints

- 本期只审计会改变业务状态或产生外部副作用的操作；读取、搜索、筛选、翻页和刷新 UI 不产生事件。
- 不新增中央批准、拒绝、批量批准、策略拦截或业务执行入口；领域工作台现有确认/撤销/执行流程保持不变。
- `actor`、`tenantId`、`teamId`、`apiKeyId` 等身份归属只能由 Models 从认证上下文派生；客户端携带任何身份字段时整批拒绝。
- 审计字段只能来自明确白名单；不得保存消息正文、简历正文、联系方式、Prompt、Cookie、凭据、原始工具参数或完整第三方响应。
- 单事件不超过 32 KiB；一批最多 50 条且总请求体不超过 512 KiB；`changes` 最多 20 项，`effects` 最多 10 项。
- 业务操作不能因审计写入、同步或查询失败而失败；本地事件先持久化，再异步补传。
- 服务端保留 365 天，本机可信查询缓存保留 30 天，pending/quarantine 在确认处理前不自动删除。
- Models API 使用 `https://ixicai.cn/api/v1/yootun/audit-events`；Renderer 只访问 `/api/desktop/yootun/audit`，不得读取 API Key 或直连 Models。
- Node.js 必须为 `^22.19.0` 或 `>=24.0.0`；Desktop 使用根目录 Corepack pnpm `11.7.0`。
- 三个仓库都先读取各自 `AGENTS.md`，保留用户已有改动；每个任务只提交列出的文件，提交信息使用中文 Conventional Commits，并立即推送至该仓库 `origin` 当前分支。
- Models 测试不得运行无并发限制的根 `pnpm test`；单文件 Jest 使用 `pnpm --filter @repo/api exec jest <file> --runInBand`。
- Models 新代码日志只能注入 `WINSTON_MODULE_PROVIDER` 并使用 Winston logger，不得实例化 Nest `Logger`。
- 不直接修改 CI checkout，不在任何仓库创建 PostgreSQL、Redis 或 RabbitMQ 容器；部署只消费已推送提交。
- 旧 `<dsh-home>/storages/yootun-approvals/state.json` 不迁移、不伪造历史记录、不主动删除。

---

## File Map

### `models.dofe.ai`

- `packages/contracts/src/schemas/yootun-audit.schema.ts`: 客户端事件、查询、响应和权限范围的唯一运行时契约。
- `packages/contracts/src/api/yootun-audit.contract.ts`: 五个 `/v1/yootun/audit-events` ts-rest 端点。
- `packages/contracts/src/{api,schemas}/index.ts`: 导出新契约。
- `apps/api/prisma/schema.prisma`: `YootunAuditEvent` 持久模型、唯一键与查询索引。
- `apps/api/prisma/migrations/20260905090000_add_yootun_audit_events/migration.sql`: 可部署数据库迁移。
- `apps/api/libs/domain/db/yootun-audit-event/*`: 唯一允许直接使用 Prisma 的审计仓储边界。
- `apps/api/src/modules/yootun-audit-api/*`: API Key 身份解析、SSO 权限、批量写入、列表、统计、团队选择和到期清理。
- `apps/api/src/bootstrap/app-module-imports.bootstrap.ts`: 注册新模块。

### `dsh-desktop`

- `dsh-plugin-desktop/src/yootun-audit-contract.ts`: Host 与插件共享的审计类型、动作目录和脱敏验证器。
- `dsh-plugin-desktop/src/yootun-audit-store.ts`: pending、quarantine、cache、sync-state 的原子文件存储。
- `dsh-plugin-desktop/src/yootun-audit-models-client.ts`: Models 五个端点的凭据隔离客户端。
- `dsh-plugin-desktop/src/yootun-audit-service.ts`: Cordis `yootunAudit` 服务、补传调度、查询降级和健康状态。
- `dsh-plugin-desktop/src/yootun-audit-route.ts`: Renderer 可访问的同源 GET 与 `retry_sync` POST 代理。
- `dsh-plugin-desktop/src/index.ts`: 创建服务、注册新路由并向 Desktop-owned 工作台注入 recorder。
- `dsh-plugin-desktop/src/yootun-{recruiter,sales,supply-watch,content-command}-route.ts`: 本地领域写操作采集点。
- `dsh-plugin-desktop/tests/yootun-audit-*.spec.ts`: 合同、存储、同步、代理、目录和跨仓库门禁测试。
- `dsh-plugin-desktop/package.json`、`dsh-plugin-desktop/cordis.patch.yml`、`pnpm-lock.yaml`: 插件改名和发布闭包。

### `docker-helm.dofe.ai`

- `plugins/dsh-yootun-audit/*`: 从 approvals 更名后的只读客户端插件；不再存在独立审批 Host 队列。
- `plugins/dsh-yootun-{knowledge,lead-discovery,retrofit,xhs-operation}/index.js`: 远端写操作采集。
- `plugins/dsh-yootun-tos-upload/{routes.js,tool.js}`: UI 与 Agent 上传结果采集。
- 各插件 `test/*.test.mjs`: 用 recorder spy 验证成功、失败、入口和脱敏投影。

---

### Task 1: Models 审计 API 契约

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/models.dofe.ai`

**Files:**
- Create: `packages/contracts/src/schemas/yootun-audit.schema.ts`
- Create: `packages/contracts/src/schemas/yootun-audit.schema.spec.ts`
- Create: `packages/contracts/src/api/yootun-audit.contract.ts`
- Modify: `packages/contracts/src/schemas/index.ts`
- Modify: `packages/contracts/src/api/index.ts`

**Interfaces:**
- Consumes: `ApiResponseSchema` from `packages/contracts/src/base.ts` and Zod 4.
- Produces: `YootunAuditClientEventSchema`, query/response schemas, and `yootunAuditContract` for all later Models and Desktop work.

- [ ] **Step 1: Write the failing schema tests**

```ts
import { YootunAuditBatchRequestSchema, YootunAuditClientEventSchema } from './yootun-audit.schema';

const event = {
  schemaVersion: 1,
  clientEventId: '018f47a2-4f10-4abc-8def-1234567890ab',
  traceId: 'trace-1',
  occurredAt: '2026-09-05T01:00:00.000Z',
  source: { pluginId: '@dofe/dsh-yootun-recruiter', pluginVersion: '0.1.0', surface: 'human_ui' },
  actionCode: 'recruiter.requirement.created',
  category: 'create',
  target: { type: 'requirement', id: 'req-1', label: '高级产品经理' },
  outcome: 'succeeded',
  changes: [{ field: 'status', before: 'draft', after: 'open' }],
  effects: [],
};

it('accepts one bounded client event', () => {
  expect(YootunAuditClientEventSchema.parse(event)).toEqual(event);
});

it.each(['actor', 'tenantId', 'teamId', 'apiKeyId', 'memberId'])('rejects identity field %s', (field) => {
  expect(() => YootunAuditClientEventSchema.parse({ ...event, [field]: 'forged' })).toThrow();
});

it('rejects oversized batches and change sets', () => {
  expect(() => YootunAuditBatchRequestSchema.parse({ events: Array(51).fill(event) })).toThrow();
  expect(() => YootunAuditClientEventSchema.parse({ ...event, changes: Array(21).fill(event.changes[0]) })).toThrow();
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
pnpm --filter @repo/contracts exec jest src/schemas/yootun-audit.schema.spec.ts --runInBand
```

Expected: FAIL because `yootun-audit.schema.ts` does not exist.

- [ ] **Step 3: Implement the Zod schemas and ts-rest router**

Use closed object schemas and these exact enums and route names:

```ts
const SurfaceSchema = z.enum(['human_ui', 'agent_tool', 'system']);
const CategorySchema = z.enum(['create', 'update', 'delete', 'publish', 'execute']);
const OutcomeSchema = z.enum(['succeeded', 'partial', 'failed', 'accepted']);

export const YootunAuditClientEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  clientEventId: z.uuid(),
  traceId: z.string().trim().min(1).max(128),
  occurredAt: z.iso.datetime({ offset: true }),
  source: z.strictObject({
    pluginId: z.string().trim().min(1).max(160),
    pluginVersion: z.string().trim().min(1).max(40),
    surface: SurfaceSchema,
  }),
  actionCode: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,5}$/).max(120),
  category: CategorySchema,
  target: z.strictObject({
    type: z.string().trim().min(1).max(80),
    id: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(160).optional(),
  }),
  outcome: OutcomeSchema,
  changes: z.array(z.strictObject({
    field: z.string().trim().min(1).max(80),
    before: z.union([z.string().max(160), z.number(), z.boolean(), z.null()]).optional(),
    after: z.union([z.string().max(160), z.number(), z.boolean(), z.null()]).optional(),
  })).max(20),
  effects: z.array(z.strictObject({
    target: z.string().trim().min(1).max(80),
    outcome: z.enum(['succeeded', 'failed', 'requires_user_login', 'accepted']),
    code: z.string().trim().max(80).optional(),
    remoteRef: z.string().trim().max(160).optional(),
  })).max(10),
  errorCode: z.string().regex(/^[a-z0-9_:-]{1,80}$/).optional(),
});

export const YootunAuditBatchRequestSchema = z.strictObject({
  events: z.array(YootunAuditClientEventSchema).min(1).max(50),
});
```

Attach a `superRefine` to the client event schema that rejects `new TextEncoder().encode(JSON.stringify(value)).byteLength > 32 * 1024` with code `custom` and message `event_too_large`; `TextEncoder` keeps the shared contract usable in both Node and browser builds.

Define list query fields `scope`, `teamId`, `start`, `end`, `pluginId`, `actionCode`, `memberId`, `targetType`, `outcome`, `query`, `cursor`, and `limit`; bound `limit` to 1-100 and search text to 200 characters. Use these response bodies inside `ApiResponseSchema(...)`:

```ts
BatchResponse = { accepted: Array<{ clientEventId: UUID; id: UUID; receivedAt: ISODateTime }> }
ListResponse = { events: YootunAuditServerEvent[]; nextCursor: string | null }
SummaryResponse = { today: nonnegativeInt; failed: nonnegativeInt }
ScopesResponse = {
  available: Array<'self' | 'team'>;
  currentTeam?: { id: UUID; name: string };
  isSuperAdmin: boolean;
}
TeamsResponse = { teams: Array<{ id: UUID; name: string }>; nextCursor: string | null }
```

`YootunAuditServerEvent` extends the client event with server `id`, `receivedAt`, `tenantId`, `teamId`, `apiKeyId`, `principalType`, `principalId`, nullable `memberId`, `keyOwnerType`, `actorDisplayName`, `clockSkewed`, and `expiresAt`. Define the router with `batch`, `list`, `summary`, `scopes`, and `teams` at `/v1/yootun/audit-events`; declare 400/401/403 on every applicable route and 413 on `batch`.

- [ ] **Step 4: Run contract tests and build**

Run:

```bash
pnpm --filter @repo/contracts exec jest src/schemas/yootun-audit.schema.spec.ts --runInBand
pnpm --filter @repo/contracts build
```

Expected: both commands PASS; generated OpenAPI includes all five audit endpoints.

- [ ] **Step 5: Commit and push**

```bash
git add packages/contracts/src/schemas/yootun-audit.schema.ts packages/contracts/src/schemas/yootun-audit.schema.spec.ts packages/contracts/src/api/yootun-audit.contract.ts packages/contracts/src/schemas/index.ts packages/contracts/src/api/index.ts
git commit -m "feat: 定义操作审计接口契约"
git push origin dev
```

### Task 2: Models 审计持久模型与仓储

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/models.dofe.ai`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260905090000_add_yootun_audit_events/migration.sql`
- Create: `apps/api/libs/domain/db/yootun-audit-event/yootun-audit-event.service.ts`
- Create: `apps/api/libs/domain/db/yootun-audit-event/yootun-audit-event.service.spec.ts`
- Create: `apps/api/libs/domain/db/yootun-audit-event/yootun-audit-event.module.ts`
- Create: `apps/api/libs/domain/db/yootun-audit-event/index.ts`
- Create: `apps/api/generated/db/modules/yootun-audit-event/*` through `pnpm --filter @repo/api db:generate`
- Modify: `apps/api/generated/db/index.ts`
- Modify: `apps/api/generated/prisma-client/*` through Prisma generation

**Interfaces:**
- Consumes: validated `YootunAuditClientEvent` and server-derived `ApiKeyAuthContext`.
- Produces: `YootunAuditEventRepository.insertBatch`, `list`, `summary`, `deleteExpired`, and `findByClientIds`.

- [ ] **Step 1: Write the failing repository tests**

```ts
it('uses tenant plus client id as the only ingest idempotency key', async () => {
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  prisma.yootunAuditEvent.findMany.mockResolvedValue([{ id: 'server-1', clientEventId: 'client-1' }]);
  const result = await repository.insertBatch(identity, [clientEvent]);
  expect(prisma.yootunAuditEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  expect(result).toEqual([{ id: 'server-1', clientEventId: 'client-1' }]);
});

it('deletes only rows whose expiresAt is not in the future', async () => {
  await repository.deleteExpired(new Date('2026-09-05T00:00:00.000Z'));
  expect(prisma.yootunAuditEvent.deleteMany).toHaveBeenCalledWith({
    where: { expiresAt: { lte: new Date('2026-09-05T00:00:00.000Z') } },
  });
});
```

- [ ] **Step 2: Run the repository test and verify it fails**

```bash
pnpm --filter @repo/api exec jest libs/domain/db/yootun-audit-event/yootun-audit-event.service.spec.ts --runInBand
```

Expected: FAIL because the repository module does not exist.

- [ ] **Step 3: Add the Prisma model and migration**

Add a `YootunAuditEvent` model with these columns: server `id`, `tenantId`, `ssoTeamId`, `apiKeyId`, `principalType`, `principalId`, nullable `memberId`, `keyOwnerType`, `actorDisplayName`, client event fields, JSON `changes/effects`, `receivedAt`, `clockSkewed`, and `expiresAt`. The migration must create:

```sql
CREATE UNIQUE INDEX "yootun_audit_events_tenant_client_event_key"
  ON "yootun_audit_events" ("tenant_id", "client_event_id");
CREATE INDEX "yootun_audit_events_team_time_idx"
  ON "yootun_audit_events" ("sso_team_id", "occurred_at" DESC);
CREATE INDEX "yootun_audit_events_member_time_idx"
  ON "yootun_audit_events" ("tenant_id", "member_id", "occurred_at" DESC);
CREATE INDEX "yootun_audit_events_action_time_idx"
  ON "yootun_audit_events" ("tenant_id", "action_code", "occurred_at" DESC);
CREATE INDEX "yootun_audit_events_outcome_time_idx"
  ON "yootun_audit_events" ("tenant_id", "outcome", "occurred_at" DESC);
CREATE INDEX "yootun_audit_events_expiry_idx"
  ON "yootun_audit_events" ("expires_at");
```

Store `apiKeyId` as an attribution snapshot, not a foreign key, so deleting a credential cannot erase or invalidate retained audit history.

- [ ] **Step 4: Implement and verify the DB service boundary**

`insertBatch` must set `receivedAt = now`, `expiresAt = now + 365 days`, and `clockSkewed = occurredAt > now + 5 minutes`; use `createMany({ skipDuplicates: true })` inside one transaction, then select all requested client IDs. Run:

```bash
pnpm --filter @repo/api db:format
pnpm --filter @repo/api db:generate
pnpm --filter @repo/api exec jest libs/domain/db/yootun-audit-event/yootun-audit-event.service.spec.ts --runInBand
```

Expected: formatting, generation, and repository tests PASS.

- [ ] **Step 5: Commit and push**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260905090000_add_yootun_audit_events apps/api/libs/domain/db/yootun-audit-event apps/api/generated/db/modules/yootun-audit-event apps/api/generated/db/index.ts apps/api/generated/prisma-client
git commit -m "feat: 添加操作审计持久模型"
git push origin dev
```

### Task 3: Models 批量写入与身份派生

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/models.dofe.ai`

**Files:**
- Create: `apps/api/src/modules/yootun-audit-api/yootun-audit-api.module.ts`
- Create: `apps/api/src/modules/yootun-audit-api/yootun-audit-api.controller.ts`
- Create: `apps/api/src/modules/yootun-audit-api/yootun-audit-api.service.ts`
- Create: `apps/api/src/modules/yootun-audit-api/yootun-audit-api.service.spec.ts`
- Modify: `apps/api/src/bootstrap/app-module-imports.bootstrap.ts`

**Interfaces:**
- Consumes: `UserApiKeyAuthGuard`, `UserApiKeyService.resolveApiKeyAuthContext`, SDK `SsoClientService.getUser`, and Task 2 repository.
- Produces: authenticated `POST /v1/yootun/audit-events/batch` with deterministic duplicate responses.

- [ ] **Step 1: Write failing identity and idempotency tests**

```ts
it('derives every attribution field from the API key context', async () => {
  userApiKeys.resolveApiKeyAuthContext.mockResolvedValue(authContext);
  sso.getUser.mockResolvedValue({ id: authContext.memberId, nickname: '陈晓', isAdmin: false });
  await service.ingest(apiKey, { events: [clientEvent] });
  expect(repository.insertBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      apiKeyId: authContext.apiKeyId,
      tenantId: authContext.tenantId,
      ssoTeamId: authContext.ssoTeamId,
      principalId: authContext.principalId,
      actorDisplayName: '陈晓',
    }),
    [clientEvent],
  );
});

it('returns the same server id when a client event is replayed', async () => {
  repository.insertBatch.mockResolvedValue([{ clientEventId: clientEvent.clientEventId, id: 'server-1', receivedAt: now }]);
  await expect(service.ingest(apiKey, { events: [clientEvent] })).resolves.toEqual({
    accepted: [{ clientEventId: clientEvent.clientEventId, id: 'server-1', receivedAt: now.toISOString() }],
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
pnpm --filter @repo/api exec jest src/modules/yootun-audit-api/yootun-audit-api.service.spec.ts --runInBand
```

Expected: FAIL because `YootunAuditApiService` does not exist.

- [ ] **Step 3: Implement authenticated batch ingestion**

The controller must be public only with respect to browser JWT middleware, then require `UserApiKeyAuthGuard`:

```ts
@Public()
@Controller()
@UseGuards(UserApiKeyAuthGuard)
export class YootunAuditApiController {
  @TsRestHandler(yootunAuditContract.batch)
  batch(@Req() req: Request) {
    return tsRestHandler(yootunAuditContract.batch, async ({ body }) => ({
      status: 200,
      body: success(await this.service.ingest(apiKeyOf(req), body)),
    }));
  }
}
```

Reject unresolved data-plane identity. For human keys, load the SSO user and snapshot `nickname`; for service/delegation keys use a stable label derived from `principalType` and `principalId`, never a secret or key prefix. At the controller boundary, compute `Buffer.byteLength(JSON.stringify(body), 'utf8')` and throw `PayloadTooLargeException('audit_batch_too_large')` above `512 * 1024` before calling the service.

- [ ] **Step 4: Verify batch HTTP behavior and module registration**

Add controller tests for 401, forged identity field 400, oversized body 413, valid 200, and replay 200. Then run:

```bash
pnpm --filter @repo/api exec jest yootun-audit-api --runInBand
pnpm --filter @repo/api type-check
```

Expected: all audit API tests and API typecheck PASS; `getAppModuleImportNames()` includes `YootunAuditApiModule`.

- [ ] **Step 5: Commit and push**

```bash
git add apps/api/src/modules/yootun-audit-api apps/api/src/bootstrap/app-module-imports.bootstrap.ts
git commit -m "feat: 接收并归属操作审计事件"
git push origin dev
```

### Task 4: Models 查询权限、统计、团队选择与保留任务

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/models.dofe.ai`

**Files:**
- Create: `apps/api/src/modules/yootun-audit-api/yootun-audit-authorization.service.ts`
- Create: `apps/api/src/modules/yootun-audit-api/yootun-audit-authorization.service.spec.ts`
- Create: `apps/api/src/modules/yootun-audit-api/yootun-audit-retention.service.ts`
- Create: `apps/api/scripts/benchmark-yootun-audit.ts`
- Modify: `apps/api/src/modules/yootun-audit-api/yootun-audit-api.controller.ts`
- Modify: `apps/api/src/modules/yootun-audit-api/yootun-audit-api.service.ts`
- Modify: `apps/api/src/modules/yootun-audit-api/yootun-audit-api.service.spec.ts`
- Modify: `apps/api/src/modules/yootun-audit-api/yootun-audit-api.module.ts`

**Interfaces:**
- Consumes: SDK `SsoClientService.getUser/getUserTeamRole/getTeam`, local Models `TeamService`, and repository list/summary/delete methods.
- Produces: `GET` list, summary, scopes and paginated team selector with one shared `AuditReadScope` authorization result.

- [ ] **Step 1: Write the failing permission matrix tests**

```ts
it.each([
  ['MEMBER', 'self', true],
  ['MEMBER', 'team', false],
  ['ADMIN', 'team', true],
  ['OWNER', 'team', true],
])('%s requesting %s is allowed=%s', async (role, scope, allowed) => {
  sso.getUser.mockResolvedValue({ id: 'member-1', nickname: '用户', isAdmin: false });
  sso.getUserTeamRole.mockResolvedValue(role);
  const call = authorization.resolve(authContext, { scope, teamId: authContext.ssoTeamId });
  if (allowed) await expect(call).resolves.toBeDefined();
  else await expect(call).rejects.toMatchObject({ status: 403 });
});

it('requires a super admin to select one target team', async () => {
  sso.getUser.mockResolvedValue({ id: 'member-1', nickname: '超管', isAdmin: true });
  await expect(authorization.resolve(authContext, { scope: 'team' })).rejects.toMatchObject({ status: 400 });
  await expect(authorization.resolve(authContext, { scope: 'team', teamId: 'target-team' }))
    .resolves.toMatchObject({ ssoTeamId: 'target-team', isSuperAdmin: true });
});
```

- [ ] **Step 2: Run authorization tests and verify they fail**

```bash
pnpm --filter @repo/api exec jest src/modules/yootun-audit-api/yootun-audit-authorization.service.spec.ts --runInBand
```

Expected: FAIL because the authorization service does not exist.

- [ ] **Step 3: Implement one authorization path for all read endpoints**

```ts
export interface AuditReadScope {
  tenantId?: string;
  ssoTeamId: string;
  memberId?: string;
  isSuperAdmin: boolean;
}

// self: always constrain by tenantId + memberId/principalId.
// team: require OWNER/ADMIN on the API key team, unless SSO user.isAdmin.
// super admin: require an explicit target team; revalidate it with SSO getTeam and scope by ssoTeamId.
```

Never trust `memberId` supplied in a query for ordinary members. Administrators may use it only after team authorization. Service/delegation keys may write attributed events but receive 403 from interactive read endpoints. `teams` must query the local SSO-backed `Team` mirror with name/ID filtering, page cursor and limit 20; it is callable only when `getUser(memberId).isAdmin === true`. The mirror supplies search results, but each selected team is revalidated through SSO `getTeam` before any event query so stale projections cannot become authority.

- [ ] **Step 4: Add list, summary, scopes, teams, and daily cleanup**

List ordering must be `(occurredAt DESC, id DESC)` and the cursor must encode both fields. Models summary returns only `{ today, failed }`; Desktop adds its local `pendingSync` count. The retention service must run daily and call:

```ts
@Cron(CronExpression.EVERY_DAY_AT_3AM)
async purgeExpired(): Promise<void> {
  await this.repository.deleteExpired(new Date());
}
```

Add tests for mixed filters, cursor stability with equal timestamps, no unscoped global query, super-admin team paging, and 365-day deletion. Add a benchmark script that accepts `--rows`, `--warmups`, `--runs`, and `--team-id`; it must tag its fixtures with that team ID, report p50/p95 for the four indexed query shapes, and delete only those tagged fixtures in a `finally` block. Run:

```bash
pnpm --filter @repo/api exec jest yootun-audit --runInBand
pnpm --filter @repo/contracts build
pnpm --filter @repo/api type-check
pnpm quality:gate
```

Expected: focused tests, contract build, typecheck and release-facing quality gate PASS.

- [ ] **Step 5: Commit and push**

```bash
git add apps/api/src/modules/yootun-audit-api apps/api/scripts/benchmark-yootun-audit.ts
git commit -m "feat: 提供操作审计授权查询"
git push origin dev
```

Models 的该提交部署并通过 `/api/v1/yootun/audit-events/scopes` 认证冒烟后，才继续发布 Desktop 同步能力。

### Task 5: Desktop 审计契约、动作目录与脱敏门禁

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/dsh-desktop`

**Files:**
- Create: `dsh-plugin-desktop/src/yootun-audit-contract.ts`
- Create: `dsh-plugin-desktop/tests/yootun-audit-contract.spec.ts`
- Create: `dsh-plugin-desktop/tests/yootun-audit-catalog.spec.ts`

**Interfaces:**
- Consumes: Task 1 客户端事件 JSON 结构，不引入 Models 仓库运行时依赖。
- Produces: Cordis `YootunAuditRecorder.record(input): Promise<AuditRecordResult>`、`YOOTUN_AUDIT_ACTIONS` 和 `buildYootunAuditEvent`。

- [ ] **Step 1: Write failing contract and privacy tests**

```ts
it('builds an event using only registered safe fields', () => {
  expect(buildYootunAuditEvent({
    actionCode: 'sales.lead.created',
    category: 'create',
  source: { pluginId: '@dofe/dsh-yootun-sales', pluginVersion: '0.1.0', surface: 'human_ui' },
    target: { type: 'lead', id: 'lead-1', label: '华东客户' },
    outcome: 'succeeded',
    changes: [{ field: 'stage', before: 'new', after: 'qualified' }],
  }, fixedClock)).toMatchObject({ schemaVersion: 1, actionCode: 'sales.lead.created' });
});

it.each(['password', 'cookie', 'prompt', 'phone', 'email', 'resume', 'messageBody', 'rawParams'])
('rejects forbidden field %s at any nesting depth', (field) => {
  expect(() => buildYootunAuditEvent({ ...validInput, effects: [{ target: 'remote', outcome: 'failed', [field]: 'secret' }] } as never, fixedClock)).toThrow('audit_field_forbidden');
});

it('rejects an unregistered action code', () => {
  expect(() => buildYootunAuditEvent({ ...validInput, actionCode: 'unknown.action.executed' } as never, fixedClock)).toThrow('audit_action_unregistered');
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/yootun-audit-contract.spec.ts tests/yootun-audit-catalog.spec.ts
```

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Define the stable recorder interface and first action catalog**

```ts
export interface YootunAuditRecorder {
  record(input: YootunAuditRecordInput): Promise<{ status: 'stored' | 'failed'; clientEventId: string }>;
}

export interface YootunAuditRecordInput {
  clientEventId?: string;
  traceId?: string;
  occurredAt?: string;
  source: { pluginId: string; pluginVersion: string; surface: 'human_ui' | 'agent_tool' | 'system' };
  actionCode: keyof typeof YOOTUN_AUDIT_ACTIONS;
  category: 'create' | 'update' | 'delete' | 'publish' | 'execute';
  target: { type: string; id: string; label?: string };
  outcome: 'succeeded' | 'partial' | 'failed' | 'accepted';
  changes?: Array<{ field: string; before?: string | number | boolean | null; after?: string | number | boolean | null }>;
  effects?: Array<{ target: string; outcome: 'succeeded' | 'failed' | 'requires_user_login' | 'accepted'; code?: string; remoteRef?: string }>;
  errorCode?: string;
}

export const YOOTUN_AUDIT_ACTIONS = Object.freeze({
  'recruiter.requirement.created': ['create', 'requirement'],
  'recruiter.requirement.updated': ['update', 'requirement'],
  'recruiter.candidate_analysis.saved': ['update', 'candidate'],
  'recruiter.boss_sync.executed': ['execute', 'candidate_collection'],
  'recruiter.action.created': ['create', 'recruiter_action'],
  'recruiter.action.confirmed': ['update', 'recruiter_action'],
  'recruiter.action.dismissed': ['update', 'recruiter_action'],
  'recruiter.action.executed': ['execute', 'recruiter_action'],
  'sales.lead.created': ['create', 'lead'],
  'sales.lead.updated': ['update', 'lead'],
  'sales.follow_up.created': ['create', 'follow_up'],
  'sales.follow_up.confirmed': ['update', 'follow_up'],
  'sales.follow_up.dismissed': ['update', 'follow_up'],
  'sales.follow_up.executed': ['execute', 'follow_up'],
  'supply.risk.created': ['create', 'supply_risk'],
  'supply.risk.updated': ['update', 'supply_risk'],
  'supply.review.created': ['create', 'supply_review'],
  'supply.review.confirmed': ['update', 'supply_review'],
  'supply.review.dismissed': ['update', 'supply_review'],
  'supply.review.executed': ['execute', 'supply_review'],
  'content.review.updated': ['update', 'article'],
  'content.platforms.updated': ['update', 'article'],
  'content.publish.executed': ['publish', 'article'],
  'knowledge.memory.remembered': ['create', 'memory'],
  'knowledge.memory.confirmed': ['update', 'memory'],
  'knowledge.memory.forgotten': ['delete', 'memory'],
  'knowledge.file.imported': ['create', 'knowledge_document'],
  'lead_discovery.discovery.executed': ['execute', 'lead_discovery'],
  'retrofit.public_sources.refreshed': ['execute', 'retrofit_search'],
  'xhs.rewrite.created': ['create', 'xhs_rewrite_task'],
  'xhs.rewrite.completed': ['execute', 'xhs_rewrite_task'],
  'media.upload.completed': ['create', 'media_asset'],
} as const);

export const YOOTUN_AUDIT_CHANGE_FIELDS = Object.freeze({
  'recruiter.requirement.created': ['status'],
  'recruiter.requirement.updated': ['status'],
  'recruiter.candidate_analysis.saved': ['feedbackStatus'],
  'recruiter.boss_sync.executed': ['insertedCount', 'updatedCount'],
  'recruiter.action.created': ['type', 'status'],
  'recruiter.action.confirmed': ['status'],
  'recruiter.action.dismissed': ['status'],
  'recruiter.action.executed': ['status'],
  'sales.lead.created': ['stage'],
  'sales.lead.updated': ['stage'],
  'sales.follow_up.created': ['channel', 'status'],
  'sales.follow_up.confirmed': ['status'],
  'sales.follow_up.dismissed': ['status'],
  'sales.follow_up.executed': ['status'],
  'supply.risk.created': ['severity', 'status', 'dueDate'],
  'supply.risk.updated': ['severity', 'status', 'dueDate'],
  'supply.review.created': ['status'],
  'supply.review.confirmed': ['status'],
  'supply.review.dismissed': ['status'],
  'supply.review.executed': ['status'],
  'content.review.updated': ['reviewStatus'],
  'content.platforms.updated': ['platformCount'],
  'content.publish.executed': ['platformCount'],
  'knowledge.memory.remembered': ['status'],
  'knowledge.memory.confirmed': ['status'],
  'knowledge.memory.forgotten': ['status'],
  'knowledge.file.imported': ['status'],
  'lead_discovery.discovery.executed': ['insertedCount', 'updatedCount'],
  'retrofit.public_sources.refreshed': ['resultCount', 'source'],
  'xhs.rewrite.created': ['status', 'versionCount'],
  'xhs.rewrite.completed': ['status', 'versionCount'],
  'media.upload.completed': ['sizeBucket', 'mimeFamily'],
} satisfies Record<keyof typeof YOOTUN_AUDIT_ACTIONS, readonly string[]>);
```

`buildYootunAuditEvent` owns UUID/time defaults, validates length/count/serialized size, recursively rejects forbidden keys, and requires every change field to be allowed by the action's explicit projector. When an asynchronous producer supplies a previously persisted `clientEventId`, `traceId`, or `occurredAt`, the builder validates and preserves it so a repeated terminal observation remains idempotent.

- [ ] **Step 4: Add source coverage checks and run typecheck**

The catalog test must scan Desktop and sibling docker Host sources, assert every literal passed to `audit.record` exists in `YOOTUN_AUDIT_ACTIONS`, and assert read-only handlers (`intent_search`, `sync_preview`, `open_boss_login`, `open_platform`, `page`, `candidates`, `status`, `result`) do not call the recorder. Run:

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/yootun-audit-contract.spec.ts tests/yootun-audit-catalog.spec.ts
corepack pnpm --filter dsh-plugin-desktop typecheck
```

Expected: tests and typecheck PASS.

- [ ] **Step 5: Commit and push**

```bash
git add dsh-plugin-desktop/src/yootun-audit-contract.ts dsh-plugin-desktop/tests/yootun-audit-contract.spec.ts dsh-plugin-desktop/tests/yootun-audit-catalog.spec.ts
git commit -m "feat: 定义本机操作审计契约"
git push origin dev
```

### Task 6: Desktop 本地 outbox 与 Models 客户端

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/dsh-desktop`

**Files:**
- Create: `dsh-plugin-desktop/src/yootun-audit-store.ts`
- Create: `dsh-plugin-desktop/src/yootun-audit-models-client.ts`
- Create: `dsh-plugin-desktop/tests/yootun-audit-store.spec.ts`
- Create: `dsh-plugin-desktop/tests/yootun-audit-models-client.spec.ts`

**Interfaces:**
- Consumes: Task 5 `YootunAuditClientEvent`.
- Produces: `YootunAuditStore` and `YootunAuditModelsClient` used only by Task 7 service.

- [ ] **Step 1: Write failing persistence and transport tests**

```ts
it('recovers concurrent pending events after a new store instance starts', async () => {
  const store = new YootunAuditStore(root);
  await Promise.all([store.append(eventA), store.append(eventB)]);
  expect((await new YootunAuditStore(root).pendingBatch(50)).map(item => item.clientEventId).sort())
    .toEqual([eventA.clientEventId, eventB.clientEventId].sort());
});

it('moves malformed files to quarantine without blocking valid files', async () => {
  await writeFile(join(root, 'pending', 'broken.json'), '{broken');
  await store.append(eventA);
  expect(await store.pendingBatch(50)).toEqual([eventA]);
  expect(await readdir(join(root, 'quarantine'))).toContain('broken.json');
});

it('never follows redirects or exposes the API key in a response', async () => {
  await client.batch([eventA], 'secret-key');
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/api/v1/yootun/audit-events/batch'), expect.objectContaining({
    redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
  }));
  expect(JSON.stringify(await client.health())).not.toContain('secret-key');
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/yootun-audit-store.spec.ts tests/yootun-audit-models-client.spec.ts
```

Expected: FAIL because store and client modules do not exist.

- [ ] **Step 3: Implement the atomic file store**

Use `<dsh-home>/storages/yootun-audit/{pending,quarantine}/`, `cache.json`, and `sync-state.json`. Each pending filename is `<clientEventId>.json`; create directories as `0700`, files as `0600`, reject symlink/non-file entries, write through `writeFileAtomic`, and serialize mutations per root path. Expose:

```ts
interface YootunAuditStore {
  append(event: YootunAuditClientEvent): Promise<void>;
  pendingBatch(limit: number): Promise<YootunAuditClientEvent[]>;
  acknowledge(clientEventIds: readonly string[]): Promise<void>;
  quarantine(fileName: string, reasonCode: string): Promise<void>;
  readCache(): Promise<YootunAuditCache | undefined>;
  writeCache(cache: YootunAuditCache): Promise<void>;
  readSyncState(): Promise<YootunAuditSyncState>;
  writeSyncState(state: YootunAuditSyncState): Promise<void>;
  pruneCache(now: Date): Promise<void>;
}
```

`pruneCache` retains only server events received in the last 30 days and never removes pending/quarantine.

- [ ] **Step 4: Implement the Models client and verify classifications**

Use base `https://ixicai.cn/api/v1/yootun/audit-events`, 10-second timeout, `redirect: 'error'`, `Accept: application/json`, and Bearer credential. Parse every response before returning. Map failures to stable kinds:

```ts
type AuditRemoteFailure =
  | { kind: 'auth'; status: 401 | 403 }
  | { kind: 'retryable'; status?: 429 | number; retryAfterMs?: number }
  | { kind: 'invalid_response' };
```

Run:

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/yootun-audit-store.spec.ts tests/yootun-audit-models-client.spec.ts
corepack pnpm --filter dsh-plugin-desktop typecheck
```

Expected: recovery, modes, timeout, response validation and status classification tests PASS.

- [ ] **Step 5: Commit and push**

```bash
git add dsh-plugin-desktop/src/yootun-audit-store.ts dsh-plugin-desktop/src/yootun-audit-models-client.ts dsh-plugin-desktop/tests/yootun-audit-store.spec.ts dsh-plugin-desktop/tests/yootun-audit-models-client.spec.ts
git commit -m "feat: 添加操作审计可靠补传存储"
git push origin dev
```

### Task 7: Desktop Cordis 服务与同源查询代理

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/dsh-desktop`

**Files:**
- Create: `dsh-plugin-desktop/src/yootun-audit-service.ts`
- Create: `dsh-plugin-desktop/src/yootun-audit-route.ts`
- Create: `dsh-plugin-desktop/tests/yootun-audit-service.spec.ts`
- Create: `dsh-plugin-desktop/tests/yootun-audit-route.spec.ts`
- Modify: `dsh-plugin-desktop/src/index.ts`
- Modify: `dsh-plugin-desktop/tests/plugin.spec.ts`

**Interfaces:**
- Consumes: Task 5 contract, Task 6 store/client, Cordis `credentials` and `dshHomePath`.
- Produces: `ctx.yootunAudit`, `/api/desktop/yootun/audit`, automatic retry, cache degradation and manual retry.

- [ ] **Step 1: Write failing service state-machine tests**

```ts
it('keeps a business event pending through network and 5xx failures', async () => {
  remote.batch.mockRejectedValue({ kind: 'retryable', status: 503 });
  await service.record(validInput);
  await service.flushNow();
  expect(await store.pendingBatch(50)).toHaveLength(1);
  expect(await service.health()).toMatchObject({ pending: 1, state: 'offline' });
});

it('stops automatic retry on 401 but preserves pending data', async () => {
  remote.batch.mockRejectedValue({ kind: 'auth', status: 401 });
  await service.flushNow();
  expect(scheduler.next()).toBeUndefined();
  expect(await service.health()).toMatchObject({ state: 'auth_required' });
});

it('serves the last trusted cache when a live query fails', async () => {
  remote.workspace.mockRejectedValue({ kind: 'retryable' });
  await expect(service.workspace(query)).resolves.toMatchObject({ freshness: { source: 'cache' } });
});
```

- [ ] **Step 2: Run service tests and verify they fail**

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/yootun-audit-service.spec.ts tests/yootun-audit-route.spec.ts
```

Expected: FAIL because service and route modules do not exist.

- [ ] **Step 3: Implement `YootunAuditService`**

Declare the Cordis context and guarantee `record` never throws:

```ts
declare module '@deepseek-ai/cordis' {
  interface Context { yootunAudit: YootunAuditRecorder & YootunAuditReader }
}

async record(input: YootunAuditRecordInput): Promise<AuditRecordResult> {
  const event = buildYootunAuditEvent(input, this.clock);
  try {
    await this.store.append(event);
    this.scheduleFlush(0);
    return { status: 'stored', clientEventId: event.clientEventId };
  } catch (cause) {
    this.noteLocalFailure(cause);
    return { status: 'failed', clientEventId: event.clientEventId };
  }
}
```

Flush at most 50 events, acknowledge only IDs confirmed by Models, and use jittered exponential retry delays based on `2s, 4s, 8s ... 5m`. Respect `Retry-After` for 429. Do not schedule 401/403 until a credential update event or manual retry. Reuse each event's original `clientEventId`. Trigger a flush on service startup, each stored event, credential update and manual retry. While a network failure has pending events, probe authenticated `scopes` every 30 seconds; a successful probe immediately resets backoff and flushes, satisfying the 60-second recovery objective without hammering the batch endpoint.

- [ ] **Step 4: Implement the private route and host wiring**

`GET /api/desktop/yootun/audit` accepts `view=workspace|teams` plus the Task 1 query fields. `view=workspace` returns:

```ts
interface DesktopAuditWorkspace {
  status: 'ready' | 'offline' | 'cached' | 'auth_required' | 'forbidden' | 'local_error';
  summary: { today: number; failed: number; pendingSync: number };
  events: YootunAuditServerEvent[];
  page: { nextCursor: string | null };
  scopes: { available: ('self' | 'team')[]; currentTeam?: AuditTeam; isSuperAdmin: boolean };
  sync: { pending: number; quarantine: number; lastAttemptAt?: string; retryAt?: string; errorCode?: string };
  freshness: { source: 'live' | 'cache'; syncedAt?: string };
}
```

`POST` accepts exactly `{ "action": "retry_sync" }`. Reuse `rejectDesktopRequest` for loopback/Host/Origin/`Sec-Fetch-Site`; enforce JSON Content-Type on POST. Add `auditSyncEnabled: boolean` to the Desktop `Config` schema with default `true`; when false, preserve the store but start neither flush nor probe. Instantiate one service in `src/index.ts`, register the route, and inject the recorder into domain route dependencies. Every local/store/remote failure must write only a stable code and bounded message through the existing Host logger.

Run:

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/yootun-audit-service.spec.ts tests/yootun-audit-route.spec.ts tests/plugin.spec.ts
corepack pnpm --filter dsh-plugin-desktop typecheck
```

Expected: retry, cache, merge-by-clientEventId, access fence, malformed query, POST allowlist, service disposal and route registration tests PASS.

- [ ] **Step 5: Commit and push**

```bash
git add dsh-plugin-desktop/src/yootun-audit-service.ts dsh-plugin-desktop/src/yootun-audit-route.ts dsh-plugin-desktop/src/index.ts dsh-plugin-desktop/tests/yootun-audit-service.spec.ts dsh-plugin-desktop/tests/yootun-audit-route.spec.ts dsh-plugin-desktop/tests/plugin.spec.ts
git commit -m "feat: 提供本机操作审计服务"
git push origin dev
```

### Task 8: Desktop-owned 业务工作台采集

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/dsh-desktop`

**Files:**
- Modify: `dsh-plugin-desktop/src/yootun-recruiter-route.ts`
- Modify: `dsh-plugin-desktop/src/yootun-sales-route.ts`
- Modify: `dsh-plugin-desktop/src/yootun-supply-watch-route.ts`
- Modify: `dsh-plugin-desktop/src/yootun-content-command-route.ts`
- Modify: `dsh-plugin-desktop/tests/yootun-recruiter-route.spec.ts`
- Modify: `dsh-plugin-desktop/tests/yootun-sales-route.spec.ts`
- Modify: `dsh-plugin-desktop/tests/yootun-supply-watch-route.spec.ts`
- Modify: `dsh-plugin-desktop/tests/yootun-content-command-route.spec.ts`

**Interfaces:**
- Consumes: `audit?: YootunAuditRecorder` injected by Task 7.
- Produces: one terminal audit event per local write attempt, with existing business responses unchanged.

- [ ] **Step 1: Write failing recruiter and sales recorder tests**

```ts
it('audits a successful save but never audits preview or login actions', async () => {
  const audit = { record: vi.fn().mockResolvedValue({ status: 'stored', clientEventId: 'event-1' }) };
  await invokeRecruiter({ action: 'save_requirement', title: '高级产品经理' }, { audit });
  expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
    actionCode: 'recruiter.requirement.created', outcome: 'succeeded',
    target: expect.objectContaining({ type: 'requirement' }),
  }));
  await invokeRecruiter({ action: 'sync_preview' }, { audit });
  await invokeRecruiter({ action: 'open_boss_login' }, { audit });
  expect(audit.record).toHaveBeenCalledTimes(1);
});

it('audits a failed entered write with a stable code and preserves the original status', async () => {
  const result = await invokeSales({ action: 'execute_action', id: 'missing' }, { audit });
  expect(result.status).toBe(400);
  expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
    actionCode: 'sales.follow_up.executed', outcome: 'failed', errorCode: 'action_not_found',
  }));
});
```

For `save_lead`, assert a missing ID records `sales.lead.created` and an existing ID records `sales.lead.updated`; neither event may contain intent-query text or evidence content.

- [ ] **Step 2: Write failing supply and content recorder tests**

Verify `save_risk` chooses `supply.risk.created` or `supply.risk.updated` from pre-mutation existence, then cover review create/confirm/dismiss/execute, article review, platform selection and multi-channel publish. For publish, assert `outcome: 'partial'` and one bounded effect per selected channel when website succeeds and Xiaohongshu requires login. Assert `open_platform` and every GET produce zero events.

- [ ] **Step 3: Run the four route tests and verify new assertions fail**

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/yootun-recruiter-route.spec.ts tests/yootun-sales-route.spec.ts tests/yootun-supply-watch-route.spec.ts tests/yootun-content-command-route.spec.ts
```

Expected: existing business tests pass; new audit expectations fail.

- [ ] **Step 4: Instrument after validation and around execution boundaries**

Add `audit` to each dependency object. Record successful state writes after their atomic state commit. For adapter or publisher calls, derive `succeeded|partial|failed` from the receipt and use the same `traceId` across accepted/final events when both exist. Call the recorder through:

```ts
async function recordAudit(audit: YootunAuditRecorder | undefined, input: YootunAuditRecordInput): Promise<void> {
  if (audit === undefined) return;
  await audit.record(input); // record() is closed and never throws
}
```

Project only IDs, safe labels, enum/status changes, stable reason codes and remote references. Do not pass request bodies, candidate text, article content, signals, recommendations, messages or raw adapter results.

- [ ] **Step 5: Verify, commit and push**

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/yootun-recruiter-route.spec.ts tests/yootun-sales-route.spec.ts tests/yootun-supply-watch-route.spec.ts tests/yootun-content-command-route.spec.ts tests/yootun-audit-catalog.spec.ts
corepack pnpm --filter dsh-plugin-desktop typecheck
git add dsh-plugin-desktop/src/yootun-recruiter-route.ts dsh-plugin-desktop/src/yootun-sales-route.ts dsh-plugin-desktop/src/yootun-supply-watch-route.ts dsh-plugin-desktop/src/yootun-content-command-route.ts dsh-plugin-desktop/tests/yootun-recruiter-route.spec.ts dsh-plugin-desktop/tests/yootun-sales-route.spec.ts dsh-plugin-desktop/tests/yootun-supply-watch-route.spec.ts dsh-plugin-desktop/tests/yootun-content-command-route.spec.ts
git commit -m "feat: 记录本地业务工作台操作"
git push origin dev
```

### Task 9: docker 插件改名与只读审计工作台

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/docker-helm.dofe.ai`

**Files:**
- Rename: `plugins/dsh-yootun-approvals/` to `plugins/dsh-yootun-audit/`
- Replace: `plugins/dsh-yootun-audit/index.js` with a no-op Host entry that registers no route or tool
- Delete: renamed package's old `test/route.test.mjs`
- Create: `plugins/dsh-yootun-audit/test/host.test.mjs`
- Modify: `plugins/dsh-yootun-audit/package.json`
- Modify: `plugins/dsh-yootun-audit/pnpm-lock.yaml`
- Modify: `plugins/dsh-yootun-audit/cordis.patch.yml`
- Modify: `plugins/dsh-yootun-audit/scripts/build.mjs`
- Replace: `plugins/dsh-yootun-audit/src/client.js`
- Replace: `plugins/dsh-yootun-audit/test/plugin.test.mjs`
- Create: `plugins/dsh-yootun-audit/test/client-state.test.mjs`
- Regenerate: `plugins/dsh-yootun-audit/lib/client.js`

**Interfaces:**
- Consumes: Task 7 `DesktopAuditWorkspace` and the same-origin route.
- Produces: `@dofe/dsh-yootun-audit` web client with sidebar entry, dense event table, filters, responsive detail view and retry control; its required Host entry is inert and provides no route, tool or approval state.

- [ ] **Step 1: Rename the package and write failing package/UI tests**

Use a filesystem rename so Git retains history. Tests must assert:

```js
assert.equal(manifest.name, '@dofe/dsh-yootun-audit')
assert.equal(manifest.description, 'Yootun operation audit workspace')
assert.equal(manifest.dsh.client.platform, 'web')
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.match(source, /操作审计/u)
assert.doesNotMatch(source, /统一审批|批准|拒绝|confirm|dismiss|awaiting_confirmation/u)
assert.match(source, /\/api\/desktop\/yootun\/audit/u)
```

Evaluate `src/client.js` in `node:vm` with mocked React and DSH primitives; expose pure `normalizeWorkspace`, `buildQuery`, and `mergePage` through `module.exports.__test` so tests can verify state without a browser.

The Host test must call `apply(ctx)` with throwing `webServer.register` and `tools.register` stubs and verify neither stub is reached. Replace `index.js` with:

```js
export const name = 'yootun-audit-client-host'
export function apply() {}
```

Update `cordis.patch.yml` to insert ID `yootun-audit` and package name `@dofe/dsh-yootun-audit`; it exists only so standalone bundle installation discovers the client package.

- [ ] **Step 2: Run tests and verify they fail**

```bash
npm --prefix plugins/dsh-yootun-audit test
```

Expected: FAIL on old package identity and approval UI behavior.

- [ ] **Step 3: Implement the information architecture**

The overlay hierarchy must be:

```text
header: 操作审计 | data freshness | refresh | close
scope bar: 本人 / 团队 | super-admin team selector
summary strip: 今日操作 | 失败 | 待同步
filter bar: search | plugin | action | result | time
workspace: event table | selected event detail
footer/status: pagination or degraded-state recovery
```

Rows show occurred time, actor, action, target and result. The detail pane shows actor, both timestamps when clock-skewed, source/surface, safe changes, effects, error code and trace ID. There are no action buttons inside records. Use DSH CSS aliases, familiar primitive icons, tooltips on icon-only controls, 6px button radius, at most 8px panel radius, 36px stable icon buttons, non-scaling typography and zero letter spacing.

- [ ] **Step 4: Implement all interaction and error states**

Use a single reducer state with `selectedId`, filters, cursor, loading and request revision. Required behavior:

```js
const EMPTY_WORKSPACE = {
  status: 'ready',
  summary: { today: 0, failed: 0, pendingSync: 0 },
  events: [],
  page: { nextCursor: null },
  scopes: { available: ['self'], isSuperAdmin: false },
  sync: { pending: 0, quarantine: 0 },
  freshness: { source: 'live' },
}
```

- Initial load: stable table-row skeletons; do not render zero metrics before data resolves.
- Offline/auth/local error with cache: keep cached rows visible, show timestamped status banner.
- Real empty: “尚无可审计操作”; filtered empty: “没有符合筛选条件的记录” plus clear-filter command.
- `pendingSync > 0`: persistent status indicator and a “立即重试” command that POSTs only `retry_sync`.
- Team option appears only when allowed; super admin must search and explicitly choose a team before loading team events.
- Arrow keys move row selection; Enter opens detail on narrow screens; Escape closes detail before closing overlay; closing restores focus to the sidebar trigger.
- At widths below 768px, the detail pane becomes a full overlay over the table. At 1024px and above, use stable `minmax(0,1fr) 360px` tracks.

- [ ] **Step 5: Build, test, commit and push**

```bash
npm --prefix plugins/dsh-yootun-audit run check
git add -A plugins/dsh-yootun-approvals plugins/dsh-yootun-audit
git commit -m "feat: 将统一审批改为操作审计"
git push origin master
```

Expected: build and Node tests PASS; `lib/client.js` contains the new package ID and no approval mutations.

### Task 10: docker-owned Host 写操作采集

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/docker-helm.dofe.ai`

**Files:**
- Modify: `plugins/dsh-yootun-knowledge/index.js`
- Modify: `plugins/dsh-yootun-knowledge/test/plugin.test.mjs`
- Modify: `plugins/dsh-yootun-lead-discovery/index.js`
- Modify: `plugins/dsh-yootun-lead-discovery/test/route.test.mjs`
- Modify: `plugins/dsh-yootun-retrofit/index.js`
- Modify: `plugins/dsh-yootun-retrofit/test/route.test.mjs`
- Modify: `plugins/dsh-yootun-xhs-operation/index.js`
- Modify: `plugins/dsh-yootun-xhs-operation/test/route.test.mjs`
- Modify: `plugins/dsh-yootun-xhs-operation/test/task-machine.test.mjs`
- Modify: `plugins/dsh-yootun-tos-upload/routes.js`
- Modify: `plugins/dsh-yootun-tos-upload/tool.js`
- Modify: `plugins/dsh-yootun-tos-upload/test/plugin.test.mjs`

**Interfaces:**
- Consumes: `ctx.yootunAudit.record()` from Task 7; every modified plugin adds `yootunAudit` to `inject`.
- Produces: safe UI/Agent/background events for every docker-owned write action in Task 5's catalog.

- [ ] **Step 1: Add failing knowledge and discovery tests**

Use a spy context and assert exact projections:

```js
assert.deepEqual(audit.record.mock.calls[0].arguments[0], {
  actionCode: 'knowledge.memory.remembered',
  category: 'create',
  source: { pluginId: '@dofe/dsh-yootun-knowledge', pluginVersion: '0.1.0', surface: 'agent_tool' },
  target: { type: 'memory', id: 'memory-7', label: 'Memory memory-7' },
  outcome: 'succeeded',
  changes: [{ field: 'status', after: 'candidate' }],
  effects: [],
})
```

Cover knowledge `remember/confirm_memory/forget/ingest_file`, lead `discover`, and retrofit `refresh`. Assert knowledge search/recall/graph, lead page/candidates, and retrofit list produce no event. Failure tests assert only stable `errorCode`, never request input or MCP response text.

- [ ] **Step 2: Add failing XHS and media upload tests**

Assert XHS create records `xhs.rewrite.created` as `accepted`; the first observed terminal state records `xhs.rewrite.completed` once with the same `traceId`, while repeated status/result reads produce no duplicate. Assert upload UI and Agent paths record `media.upload.completed` with `surface: 'human_ui'|'agent_tool'`, size bucket/MIME family/asset reference only, and no local path, signed URL, credential, filename or metadata body.

- [ ] **Step 3: Run focused plugin tests and verify new assertions fail**

```bash
npm --prefix plugins/dsh-yootun-knowledge test
npm --prefix plugins/dsh-yootun-lead-discovery test
npm --prefix plugins/dsh-yootun-retrofit test
npm --prefix plugins/dsh-yootun-xhs-operation test
npm --prefix plugins/dsh-yootun-tos-upload test
```

Expected: existing behavior passes and new recorder assertions fail.

- [ ] **Step 4: Instrument shared execution helpers**

Pass a `surface` value into shared write helpers rather than duplicating UI and Agent implementations. After a remote result is normalized, call:

```js
async function recordAudit(ctx, input) {
  if (!ctx.yootunAudit?.record) return
  try {
    await ctx.yootunAudit.record(input)
  } catch {
    ctx.logger?.warn?.('yootun audit record failed: audit_record_failed')
  }
}
```

The Desktop recorder is non-throwing, and the defensive local `try/catch` guarantees a future recorder regression still cannot change business results. Generate one client event for each logical terminal result; for XHS, persist the completion marker and terminal event ID in its existing task state so restarts and repeated polling reuse the same `clientEventId`.

- [ ] **Step 5: Check every modified package, commit and push**

```bash
npm --prefix plugins/dsh-yootun-knowledge run check
npm --prefix plugins/dsh-yootun-lead-discovery run check
npm --prefix plugins/dsh-yootun-retrofit run check
npm --prefix plugins/dsh-yootun-xhs-operation run check
npm --prefix plugins/dsh-yootun-tos-upload test
git add plugins/dsh-yootun-knowledge plugins/dsh-yootun-lead-discovery plugins/dsh-yootun-retrofit plugins/dsh-yootun-xhs-operation plugins/dsh-yootun-tos-upload
git commit -m "feat: 采集插件业务操作审计"
git push origin master
```

### Task 11: Desktop 包迁移、跨仓库门禁与真实界面验收

**Repository:** `/Users/techwu/Documents/codes/dofe.ai/dsh-desktop`

**Files:**
- Delete: `dsh-plugin-desktop/src/yootun-approvals-route.ts`
- Delete: `dsh-plugin-desktop/tests/yootun-approvals-route.spec.ts`
- Modify: `dsh-plugin-desktop/package.json`
- Modify: `dsh-plugin-desktop/cordis.patch.yml`
- Modify: `pnpm-lock.yaml`
- Modify: `dsh-plugin-desktop/tests/package.spec.ts`
- Modify: `dsh-plugin-desktop/tests/plugin.spec.ts`
- Create: `dsh-plugin-desktop/tests/yootun-audit-integration.spec.ts`
- Create: `docs/runbooks/yootun-audit-rollback.md`
- Modify: `docs/superpowers/specs/2026-09-04-yootun-operation-audit-design.md`

**Interfaces:**
- Consumes: Task 7 Host route/service and Tasks 9-10 renamed package/collectors.
- Produces: one releasable Desktop closure with no central approval route or package and an end-to-end contract gate.

- [ ] **Step 1: Write the failing package and cross-repo assertions**

```ts
it('packages the audit client and removes the central approval surface', () => {
  const manifest = JSON.parse(readFileSync(packageJson, 'utf8'));
  expect(manifest.dependencies).toHaveProperty('@dofe/dsh-yootun-audit');
  expect(manifest.dependencies).not.toHaveProperty('@dofe/dsh-yootun-approvals');
  expect(readFileSync(patchPath, 'utf8')).toContain("name: '@dofe/dsh-yootun-audit'");
  expect(readFileSync(patchPath, 'utf8')).not.toContain('dsh-yootun-approvals');
});

it('keeps every cataloged write collector connected to the desktop recorder', () => {
  for (const actionCode of Object.keys(YOOTUN_AUDIT_ACTIONS)) {
    expect(allOwnedHostSource).toContain(actionCode);
  }
  expect(allOwnedHostSource).not.toMatch(/\/api\/desktop\/yootun\/approvals|awaiting_confirmation.*统一审批/u);
});
```

- [ ] **Step 2: Run the integration tests and verify they fail**

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/package.spec.ts tests/plugin.spec.ts tests/yootun-audit-integration.spec.ts
```

Expected: FAIL because the manifest and patch still reference approvals.

- [ ] **Step 3: Replace the dependency and delete only the old central queue**

Change the file dependency to:

```json
"@dofe/dsh-yootun-audit": "file:../../docker-helm.dofe.ai/plugins/dsh-yootun-audit"
```

Change the patch entry ID/name to `dofe-yootun-audit` / `@dofe/dsh-yootun-audit` and remove `registerHostRoute: false`, because the new package has no functional Host route. Remove the old route registration/import and old route source/test. Do not edit recruiter, sales or supply domain confirmation states. Refresh the workspace lock with:

```bash
corepack pnpm install --frozen-lockfile=false
```

Add a rollback runbook whose only supported emergency change is a new Git commit that removes the `dofe-yootun-audit` patch entry and sets `desktop-shell.config.auditSyncEnabled: false`. The runbook must state that Models rows, pending files and quarantine files remain untouched, and that rollback must follow local validate → Chinese commit → push → CI fetch/deploy.

- [ ] **Step 4: Run automated release gates**

```bash
corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/package.spec.ts tests/plugin.spec.ts tests/yootun-audit-integration.spec.ts
corepack pnpm check:layout
corepack pnpm check
```

Expected: all focused tests, layout/architecture gates, package closure, build, typecheck and complete headless gate PASS.

- [ ] **Step 5: Run real-browser interaction and visual checks**

Start `corepack pnpm dev`, open the emitted local URL, and invoke the required browser testing skill. At 320, 768, 1024 and 1440 CSS pixels, capture evidence for:

```text
loading skeleton
real empty state
filtered empty state
live event table + selected detail
offline cached banner
pending-sync indicator + retry
member self-only scope
team admin team scope
super-admin team search and explicit selection
keyboard row/detail/close focus sequence
```

For each viewport verify no overlap, clipped text, unintended horizontal page scroll or layout shift; run an accessibility scan for names, focus order, dialog semantics and WCAG AA contrast. Inspect browser console/network for errors and verify Renderer requests only `/api/desktop/yootun/audit`.

- [ ] **Step 6: Update status, commit and push**

Change the design spec status from `已确认，待实施` to `已实施，待用户验证`, append the exact automated commands and screenshot locations used above, then run `git diff --check`.

```bash
git add dsh-plugin-desktop/package.json dsh-plugin-desktop/cordis.patch.yml dsh-plugin-desktop/src/yootun-approvals-route.ts dsh-plugin-desktop/tests/yootun-approvals-route.spec.ts dsh-plugin-desktop/tests/package.spec.ts dsh-plugin-desktop/tests/plugin.spec.ts dsh-plugin-desktop/tests/yootun-audit-integration.spec.ts pnpm-lock.yaml docs/runbooks/yootun-audit-rollback.md docs/superpowers/specs/2026-09-04-yootun-operation-audit-design.md
git commit -m "feat: 完成操作审计插件迁移"
git push origin dev
```

### Task 12: 发布后数据与用户价值验证

**Repositories:** Models、docker 与 Desktop 的已推送目标分支；本任务不直接修改 CI checkout。

**Files:**
- Modify when evidence is collected: `docs/superpowers/specs/2026-09-04-yootun-operation-audit-design.md`

**Interfaces:**
- Consumes: 已部署 Models 服务、发布候选 Desktop 和目标用户反馈。
- Produces: 可审计的发布证据、性能结果和是否达到产品成功标准的结论。

- [ ] **Step 1: Verify production-safe endpoint behavior**

Using a dedicated test account and API key, submit one synthetic event whose target label is clearly marked `审计验收样本`; verify duplicate batch submission returns the same server ID. Verify member, team admin and super admin query boundaries with distinct accounts. Never use a real customer object or secret.

- [ ] **Step 2: Verify query performance on staging-scale data**

Against the approved non-production database, run:

```bash
DATABASE_URL="$AUDIT_BENCHMARK_DATABASE_URL" pnpm --filter @repo/api exec ts-node scripts/benchmark-yootun-audit.ts --rows 100000 --warmups 5 --runs 30 --team-id 00000000-0000-4000-8000-000000000099
```

The script must refuse production hosts and require the dedicated team ID above. Acceptance is P95 below 1 second for team+time, member+time, action+time and outcome+time queries.

- [ ] **Step 3: Verify retry recovery**

Run 20 online synthetic writes and record the time until each is queryable; at least 19 must appear within 30 seconds. Then disconnect Models access, perform 20 synthetic business writes, restart Desktop, restore access and verify every client ID appears exactly once while the business responses remained successful; at least 19 pending events must sync within 60 seconds. Confirm pending returns to zero and quarantine remains unchanged. Across the full validation, duplicate event count and unauthorized cross-user/cross-team reads must both be zero.

- [ ] **Step 4: Conduct five task-based user sessions**

Ask five target users to complete the three specified tasks: find their own latest write, locate and explain one failed event, and as an administrator inspect one named member's operation. Also ask them to identify whether the event came from UI or Agent. Record completion time, errors, wrong-scope attempts, cache-state recognition and SUS. Acceptance is aggregate core-task completion above 85%, SUS above 80, and no unauthorized record exposure or cache/live misidentification.

- [ ] **Step 5: Record evidence, commit and push**

Append dates, anonymized results, P95 values, retry client IDs and remaining risks to the spec. Set status to `已验证` only when every acceptance criterion passes; otherwise set `已实施，验证未通过` and list the failed criterion precisely.

```bash
git add docs/superpowers/specs/2026-09-04-yootun-operation-audit-design.md
git commit -m "docs: 记录操作审计验收结果"
git push origin dev
```

## Execution Order and Stop Conditions

1. Execute Tasks 1-4 in Models and wait for the deployed endpoint smoke before exposing Desktop sync.
2. Execute Tasks 5-8 in Desktop; these are locally testable against mocked Models even before the UI changes.
3. Execute Tasks 9-10 in docker; do not remove the old Desktop dependency until the renamed package exists on `origin/master`.
4. Execute Task 11 in Desktop to switch the release closure atomically.
5. Execute Task 12 only against approved staging/production-safe accounts and infrastructure.

Stop and request direction when an existing user change overlaps a listed file in a way that cannot be preserved, when SSO cannot resolve `memberId` or confirm the selected target team, when Models cannot be deployed before Desktop release, or when a required external test account is unavailable. Do not weaken authorization, store client-supplied identity, drop pending events, revive central approvals, or bypass a failing gate to continue.
