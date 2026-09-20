# 0920 · sensteed 飞书扫码登录与凭据自动供给方案

> 结论先行：**sensteed 以飞书扫码为唯一登录方式，用户 key 由服务端在登录时自动签发并写入本机凭据库，模型 / MCP / knowledge 全部沿用现有 key 数据面链路，零协议改造即插即用；yootun-agent 手动激活流程原样保留。**

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-现状与差距分析.md](01-现状与差距分析.md) | sso / models（山子）/ docker-helm / knowledge / tools / montage / 桌面端 七个仓库的现状矩阵与差距清单 |
| [02-总体方案设计.md](02-总体方案设计.md) | 登录与 key 供给的完整流程、凭据模型、权限与统计体系、各仓库改动清单 |
| [03-实施路线与风险.md](03-实施路线与风险.md) | 三个阶段的任务分解、工作量估算、风险与对策 |

## 核心决策（5 条）

1. **身份**：sensteed 用户 = 飞书组织内部用户。**SSO（`https://sso.ixicai.cn`，API/issuer 为 `https://sso.ixicai.cn/api`）是全部自研项目的唯一用户源和组织源**——用户与组织只存在于 SSO，models / knowledge / tools / montage / 桌面端一律凭 SSO 签发的身份运行，不自建用户或组织体系。桌面端走 SSO 现成的 OIDC 授权码 + PKCE（S256 强制、`http://127.0.0.1:*` loopback 回调已被治理层放行），飞书扫码页由 accounts.feishu.cn 托管，SSO 侧已有飞书 connector + 首登自动建户。
2. **凭据**：model_api_key **保留**，但从"用户手输的资产"变为"系统自动供给的会话凭据"。登录后由 models 新增的幂等端点代表用户签发（复用 `createEmployeeKey` 的 ensure + 解密回显语义），用户全程不见 key。不用 SSO JWT 直连 MCP——统计/配额/绑定全链路都已建在 key 上，改造成本高且归因会漏。
3. **零破坏**：所有改动都是"新增分支"——SSO 新增一个 desktop OAuth client；models 新增一个端点；桌面端按品牌分支（sensteed 默认扫码，yootun 保持手输 key）。不 bump `DOFE_ACCESS_VALIDATION_VERSION`，不改现有 `/user-api-keys` 契约，不改 nginx 路由（新端点落在 models 域名下）。
4. **权限**：P1 按"插件域"粒度由服务端下发 entitlements（provision 响应携带，写入现成的 `dofe-access.enabledPlugins` 门）；P2 飞书部门 → SSO groups claim → knowledge `team.<部门ID>` 空间自动生效（knowledge 侧 provision 服务已存在，只差 claim 与对账）。
5. **统计**：每用户一把 key ⇒ `GatewayUsageLog` 按 key 归因即天然按人统计；models 已有 quota/usage/billing 全套接口，桌面端可直接展示。

## 一页流程

```
首次启动 sensteed
  1 弹出登录窗 → 打开系统浏览器到 SSO 授权页（飞书扫码）
  2 扫码确认 → SSO 首登自动建户/绑定 feishuId → 302 回桌面 loopback
  3 桌面用 code+PKCE 换 SSO token
  4 桌面携 SSO token 调 models「桌面 key 供给端点」→ 幂等签发用户 key
  5 key 写入 .credentials.yaml（0600）→ MCP/模型链路自动重建
  6 自动拉模型目录 → 默认模型+协议 → setupComplete → 进入系统

再次启动：有凭据直接进入；key 失效时用 SSO refresh token 静默重跑第 4 步，无感。
```

## 下一步行动

从 [03-实施路线与风险.md](03-实施路线与风险.md) 的阶段 0 开始：在 sso.dofe.ai 的 `apps/api/scripts/oauth-clients.config.ts` 注册 `sensteed-desktop` client（约半天）。
