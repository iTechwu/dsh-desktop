# @dofe/dsh-knowledge-capture

Yootun-Agent 的 Runtime Knowledge bridge。它监听 DSH 的真实 Session 事件，
通过 `https://ixicai.cn/mcp/knowledge` 提交 `knowledge.session_checkpoint`，
并在每次模型请求前获取 `knowledge.context_pack`。

私有插件，不发布到 npmjs。身份只由公共 MCP 网关根据
`MODELS_API_KEY` 解析；客户端不提交 tenant、user 或 space UUID。

## 接入面

- 包名：`@dofe/dsh-knowledge-capture`
- Cordis `name`：`yootun-agent-knowledge-capture`
- Cordis `inject`：`['credentials', 'systemPrompt']`
- 暴露到 `ctx.yootunAgentCapture` 与 `ctx.yootunAgentKnowledge`：
  `{ sdkVersion, pendingCount(), droppedCount(), loadout(), contextPack(), flush(), shutdown() }`

## 运行时依赖

| 来源 | 用途 |
| --- | --- |
| `ctx.credentials.resolve('MODELS_API_KEY')` | 公共 MCP bearer；网关据此解析可信 tenant/user/runtime |
| `session/event` | 捕获用户消息、模型消息、工具状态、Turn 与 Compaction 边界 |
| `system-prompt/assemble` | 获取并注入 ACL 限定的 ContextPack |
| `session/flush` | 通过 `knowledge.session_checkpoint` 提交不超过 50 条的分段 |

bearer 暂时不可用时保留有界内存队列并返回 backoff；后续 flush 会重新从
credential store 解析，不要求重启，也不阻塞 Agent 对话。

## 生命周期

- `session/created` / `session/disposed`：建立与收口 per-session 队列。
- `turn/end` / `compaction/end` / `session/flush`：触发 MCP checkpoint。
- `system-prompt/assemble`：注入 stable rules、environment facts、active
  Memory Skills、confirmed memories、handoff 与 citations。
- `forbiddenCaptureIds`、非用户来源的注入消息及敏感键在入队前丢弃或脱敏，
  阻断 recall -> capture -> recall 污染。

## 失败与禁用

- 缺少 Key、MCP 超时或上游错误只降级 Runtime Memory，不影响其它数据源。
- 队列最多保留 200 条，checkpoint 单批最多 50 条；失败批次按原序回队。
- 自动候选只在服务端 Loadout 的 `allowCandidateCapture` 为 true 时创建，
  并使用 `user.agent_runtime`；候选仍需明确确认后才参与普通 recall。

## 验证

```bash
cd plugins/dsh-knowledge-capture
npm run build
npm test
```

## 引用

- `knowledge.dofe.ai/docs/0906/ai-memory/02-knowledge-optimization-roadmap.md`
- `dsh-plugin-desktop/src/dofe-managed.ts`（credentials.resolve 模式）
- `dsh-plugin-desktop/src/shutdown.ts`（Desktop shutdown deadline）
