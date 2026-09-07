# @repo/capture-sdk

Agent 事件捕获 SDK（docs/0906/ai-memory Phase A，§3）。把 Agent 生命周期事件
适配为 Knowledge 的幂等 `SessionCheckpoint` 提交：本地有界 spool、短超时、
429/5xx 指数退避、捕获前清洗，Agent 热路径永不阻塞。

## 接入

```ts
import { CaptureSdk } from '@repo/capture-sdk';

const capture = new CaptureSdk({
  baseUrl: 'https://knowledge.dofe.ai',
  tenantId: '<verified tenant uuid>',
  userId: '<verified subject>',
  agentRuntimeId: '<yootun runtime id>',
  scopeRoleKey: 'tenant.all',
  externalSessionId: session.id,
  authHeaders: { authorization: `Bearer ${token}` },
});

// Agent 生命周期内（同步、不抛错、不做 IO）：
capture.capture({ kind: 'session-start', payload: { text: 'opened repo X' } });
capture.capture({ kind: 'post-tool-use', payload: { toolName: 'Bash', text: 'ran tests' } });
capture.capture({ kind: 'session-end', payload: { text: 'shipped fix' } });

// 会话结束时（或定时）：
await capture.flush();
```

最小事件集：`session-start` / `user-prompt` / `post-tool-use` / `pre-compact` /
`post-compaction` / `session-end`。

## 保证

- **幂等**：每个事件的键为 SHA-256 `(tenant, user, agentRuntime, session, eventId)`；
  重试不会产生第二个 checkpoint 行。
- **不阻塞**：`capture()` 同步入 spool，网络失败只降级捕获，不抛给 Agent。
- **最早丢弃**：清洗在入 spool 前完成（deny path 删除、敏感 key 掩码、
  `forbiddenCaptureIds` 命中即整段丢弃），敏感数据不出进程。
- **有界**：spool 默认 500 条（与 checkpoint 契约上限一致），满时逐出最旧。
- **授权在服务端**：SDK 不实现业务授权；role key/身份每次请求都由服务端
  重新校验，错配 fail-closed。

## 四步接入诊断

```ts
import { runCaptureProbe } from '@repo/capture-sdk';

const report = await runCaptureProbe(config);
// report.ok && report.steps = [status, capability, test-checkpoint, test-recall]
```

用调用方自己的凭据逐步验证：MCP 可达 → capture 工具在列 → 测试 checkpoint
被接受 → 授权 recall 有响应。失败即停，`errorCode` 可直接复制到工单。

## 错误码

| errorCode                  | 含义                                  | 处置                                      |
| -------------------------- | ------------------------------------- | ----------------------------------------- |
| `CAPTURE_TIMEOUT`          | 请求超过 `timeoutMs`（默认 2s）       | 自动退避重试                              |
| `CAPTURE_NETWORK_ERROR`    | 连接失败                              | 自动退避重试                              |
| `CAPTURE_HTTP_429`         | 服务端限流                            | 指数退避（500ms 起，30s 封顶）            |
| `CAPTURE_HTTP_5XX`         | 服务端错误                            | 指数退避                                  |
| `CAPTURE_UNAUTHORIZED`     | 401/403                               | 检查 `authHeaders` 与租户绑定             |
| `CAPTURE_INVALID_RESPONSE` | 非 2xx/非契约响应                     | 核对 baseUrl 与网关版本                   |
| `CAPTURE_REDACT_DROPPED`   | 文本含 ContextPack forbiddenCaptureId | 预期行为（防 recall→capture→recall 污染） |
| `CAPTURE_SPOOL_FULL`       | spool 满已逐出最旧事件                | 提高 flush 频率或调大 `spoolMaxSize`      |
