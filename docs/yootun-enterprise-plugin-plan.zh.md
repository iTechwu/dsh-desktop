# Yootun-Agent 企业插件体系方案

## 目标与范围

Yootun-Agent 的企业能力采用“本地工作台 + 可替换外部适配器”的组合方式。桌面应用预装插件包，插件通过 DSH/Cordis 的 Host 与 Client face 接入；企业数据默认留在本机，只有用户明确启用的模型、MCP 或外部适配器才会收到经过授权的数据。

本阶段交付四块驾驶舱：GEO 效果、AI 消费、模型使用和昨日工作。随后以 HR 招聘为第一条业务纵向切片，再复用同一套审批、存储、脱敏和打包门禁扩展到销售、供应链、内容、知识与财务治理。

## 驾驶舱契约

入口为 `POST /api/desktop/yootun/dashboard/yesterday`，请求只能来自本机 loopback、同源 Electron renderer，并使用 JSON body。服务端按本地时区计算“昨日” `[start, end)` 区间，同时并行读取三个独立数据源：

| 区块 | 来源 | 允许展示 | 不允许展示 | 降级语义 |
| --- | --- | --- | --- | --- |
| GEO | GeoFlow `geoflow_analytics_overview` 工具，`preset=yesterday` | KPI、趋势、漏斗、内容排行 | 原始查询、凭据、未裁剪响应字段 | `unavailable` / `error` 不阻塞其他区块 |
| 消费 | `https://ixicai.cn/api/v1/yootun/usage` | 请求数、Token、费用、按模型聚合 | `model_api_key`、provider 私有字段 | 缺少或拒绝 Key 时仅标记该区块不可用 |
| 昨日工作 | 本机 session projection + event log | 会话标题、工作区标签、轮次、工具调用、模型聚合 | prompt、回复正文、附件、路径细节、密钥 | 存储不可读或超限时返回不可用/跳过计数 |

响应固定包含 `period`、`geo`、`usage`、`activity` 与 `refreshedAt`。每个数据源都使用 `{ status: ready|empty, data }` 或 `{ status: unavailable|error, reason }`，前端必须逐块渲染状态，不得把不可用误报为零值成功。

## 企业插件分层

### 预装层

预装包只声明稳定的 DSH bundle/client 注入，不直接修改上游 Harness。当前清单：

| 插件 | 职责 | 关键入口 |
| --- | --- | --- |
| `@dofe/dsh-yootun-ui` | 品牌、访问门禁、模型选择 | `dofe-access` settings |
| `@dofe/dsh-yootun-dashboard` | 四块驾驶舱 | dashboard route |
| `@dofe/dsh-yootun-recruiter` | HR 工作台与候选人视图 | recruiter route/tool |
| `@dofe/dsh-yootun-sales` | 销售线索与跟进 | sales route |
| `@dofe/dsh-yootun-supply-watch` | 供应与经营风险 | supply-watch route |
| `@dofe/dsh-yootun-content-command` | 内容 brief 与发布队列 | content-command route |
| `@dofe/dsh-yootun-knowledge` | 本地知识检索与治理 | knowledge plugin |
| `@dofe/dsh-yootun-approvals` | 高风险动作确认与审计 | approvals route |
| `@dofe/dsh-yootun-finops` | 模型预算与异常 | finops route |
| `@dofe/dsh-yootun-daily-report` | 昨日工作摘要 | activity projection |

### 适配器层

外部站点（例如 BOSS 直聘）只能由单独审核的 adapter 执行。预装工作台不保存登录 Cookie、不模拟“已发送”，也不绕过用户确认。adapter 消费一次性 `idempotencyKey`，回写明确的 `confirmed_pending_adapter`、`succeeded` 或 `failed` 状态，并把最小化结果写入本地审计记录。

## HR 招聘纵向切片

1. Agent 通过 `yootun_recruiter` 保存岗位需求。
2. Agent 只保存脱敏候选人分析：显示名、岗位匹配证据、待核实问题、面试问题和阶段。
3. 发布 JD、发送候选人消息、写入反馈都只能创建 `awaiting_confirmation` 动作。
4. 用户在招聘工作台确认或撤销；确认后状态为 `confirmed_pending_adapter`，没有 adapter 时保持该状态。
5. 所有输入执行字段白名单、长度/数量上限、时间与金额规范化，并拒绝联系方式、证件和受保护招聘属性。

## 安全与隐私门禁

- loopback route 强制检查 host、origin、`sec-fetch-site` 和 JSON content type；写请求拒绝跨源与重定向。
- 本地状态目录使用 `0700`，状态文件使用 `0600`，拒绝符号链接和超限文件。
- 驾驶舱和招聘响应不携带任何 credential；日志与错误只使用稳定 reason code。
- 外部动作采用“预览 → 一次性确认 → 幂等执行”状态机，禁止工具自行确认。
- UI 文案明确区分“不可用”“无数据”“异常”，不把失败降级成空成功。

## macOS / Windows 发布门禁

每次发布候选都执行：`pnpm check`、Desktop/Market build、runtime-closure、Loader/profile headless smoke 与插件单测。macOS 额外验证 universal `x86_64`/`arm64` DMG、Info.plist、执行权限和 `app.asar`；Windows 额外验证 NSIS 与 portable ZIP 的 PE 架构、安装/卸载保留用户数据、绿色版不接入自动更新。未签名 smoke 产物不得冒充正式发布，正式包必须在持有签名与公证凭据的原生 runner 上生成。

## 分阶段验收

- **阶段 A：驾驶舱文档与契约**：四源状态、隐私字段和降级语义可审阅，route/UI/test 名称一致。
- **阶段 B：HR 预装插件**：岗位、候选人分析、待确认动作和并发写入测试通过。
- **阶段 C：审批与适配器**：确认、幂等、审计和失败重试在独立 adapter 中验证。
- **阶段 D：跨平台回归**：macOS/Windows 打包门禁在原生 runner 通过，Linux 保持 headless gate。

每个阶段使用独立中文 Conventional Commit，并推送到 `origin`；跨阶段改动不得混入同一提交。
