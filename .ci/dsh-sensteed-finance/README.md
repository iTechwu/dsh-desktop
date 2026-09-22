# dsh-sensteed-finance

Sensteed（山子Agent）财务专业看板插件：把 datasource.dofe.ai 财务数据中心的数据接口以 MCP 暴露给 Agent，并在插件内提供统计看板、数据录入与一键深度分析入口。

## 组成

| 部分 | 说明 |
| --- | --- |
| `cordis.patch.yml` | 注册 `@deepseek-ai/dsh-mcp-client`（serverName `finance`，指向 datasource `/api/mcp`）+ 本插件 guidance |
| `index.js`（宿主端） | ① `mcp__finance__*` 工具的 Agent 使用 guidance（财务口径 + 分析工作流 + 财务口吻输出规范）；② `sensteed_finance_bootstrap` 工具（租户/主体上下文）；③ 同源前缀路由 `/api/desktop/sensteed/finance*`，代理统计读取与录入/回填写入 |
| `src/client.js`（浏览器端） | 八页看板：总览 / 预算 / 台账与计划（含回填）/ 资金 / 预警（可触发引擎）/ 数据治理 / 数据录入 / 深度分析入口（7 个预制分析场景，发送给当前会话由 Agent 调 MCP 完成分析） |

## 配置（桌面端 DSH 环境）

三个引用均从**凭据服务**解析（层级：进程环境 > `~/.dsh/.credentials.yaml` > `~/.dsh/.env`），插件内再兜底 `process.env`。最简方式是写入家目录 `.env`：

```bash
# ~/.dsh/.env（权限 600；值与 datasource API 的 INTERNAL_API_SECRET 一致）
DATASOURCE_TENANT_ID=<SSO 租户 ID>
DATASOURCE_INTERNAL_API_SECRET=<datasource 的 INTERNAL_API_SECRET 值>
```

| 引用 | 必填 | 说明 |
| --- | --- | --- |
| `DATASOURCE_TENANT_ID` | 是 | 默认租户（SSO tenantId），注入所有 MCP 工具入参与宿主代理路由 |
| `DATASOURCE_INTERNAL_API_SECRET` | 是 | datasource API 的 `INTERNAL_API_SECRET` 同值密钥（无此名时回退解析 `INTERNAL_API_SECRET`） |
| `DATASOURCE_BASE_URL` | 否 | datasource API 源，默认 `https://datasource.local.dofe.ai/api`（自动拼 `/mcp`；统一走本地 nginx 入口，不直连回环地址。mkcert 证书由插件自动引导 Node 信任，也可用 `NODE_EXTRA_CA_CERTS` 显式指定） |
| `DATASOURCE_MCP_URL` | 否 | MCP 完整 URL 覆盖（默认 `https://datasource.local.dofe.ai/api/mcp`），特殊部署使用 |

MCP 客户端条目使用 `authorizationCredential: DATASOURCE_INTERNAL_API_SECRET`，由 dsh-mcp-client 自动附加 `Authorization: Bearer`；packaged 桌面端从 shell rc 注入的普通变量会被白名单/敏感名过滤剥除，因此不要走 shell export 通道。

## 数据面

- **Agent**：`mcp__finance__*`（streamable-http，无状态 JSON-RPC，Bearer secret）。读：orgs/overview/budget/pr/plans/revenue/cash/alerts/quality/batches/analysis_brief；写：create payment-plan / revenue-plan / budget-line、patch 实际值、run alert engine。
- **看板**：浏览器只访问同源 `/api/desktop/sensteed/finance*`，宿主端用同一 secret 以 `tools/call` 转发——与 Agent 完全同一数据面，口径一致。

## 开发

```bash
pnpm install
npm run check   # build + node --check + node --test
```

## 验证

1. 启动 datasource API 与本地 nginx（入口 `https://datasource.local.dofe.ai`，需设置 `INTERNAL_API_SECRET`；mkcert 根证书保持默认位置即可被插件自动识别）。
2. 桌面端环境注入上表三个变量，安装插件后侧栏底部出现「财务看板」入口。
3. 会话内输入「分析本年预算执行风险」，Agent 应先调 `sensteed_finance_bootstrap`、`mcp__finance__finance_analysis_brief`，再输出财务口吻的风险预判。
