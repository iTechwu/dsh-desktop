# 审计报告

审计时间：2026-09-04 03:00 起（Asia/Shanghai）

## 范围

- `dsh-desktop` 桌面壳、配置、打包和发布验证。
- `deepseek-harness` 工作区、会话、聊天执行及默认插件组合。
- Yootun 业务插件的侧栏入口、覆盖层、空态、数据读取和受控写操作。
- Models、MCP、Knowledge、GeoFlow、GEORank、OpenMontage 等真实依赖的可用性。
- 仅在产生服务端变更时检查 Jenkins 部署和真实环境回归。

## 发现

| ID | 严重度 | 状态 | 发现 | 证据与影响 |
| --- | --- | --- | --- | --- |
| AUD-001 | P1 | 已修复 | 移除 `@linxin666/dsh-web-ui-all` 后仍有 7 个测试断言要求旧包存在 | `b3e1773b69` 更新迁移契约；完整 `pnpm check` 恢复为 desktop 1107 通过、4 跳过 |
| AUD-002 | P1 | 已定位，待隔离升级验证 | `@xmanrui/dsh-im@2.3.0` 的 9 个消息渠道每 30 秒通过未认证 HTTP 调用 `host.describe` 并收到 403 | 真实配置仅飞书有 1 个机器人，其余渠道无配置；旧版 supervisor 在读取渠道状态前先调用 Harness，导致空渠道也永久重试。`4.9.1` 已提供 Typert Gateway 进程内连接，但发布于审计当日且现有插件市场无可回滚升级操作，禁止直接覆盖真实 Profile |
| AUD-003 | P1 | 已修复 | 多个业务覆盖层可叠加，关闭上层后露出前一层；隐藏层与主界面控件仍在辅助功能树中 | `docker-helm.dofe.ai@8c9f508` 实现 11 个面板互斥；`dsh-desktop@705ab05047` 和 `deepseek-harness@de9675462b` 分别覆盖桌面自有帧与兼容帧的背景隔离。真实包打开 Dashboard 后辅助功能树只保留当前弹窗 |
| AUD-004 | P2 | 待修复 | Skill 管理面板只暴露标题、刷新和关闭，分组、搜索、技能卡片与操作未进入辅助功能树 | 鼠标视觉可见，但键盘和读屏无法完整操作 |
| AUD-005 | P2 | 待优化 | 一条极简聊天冒烟请求输入 78.3K token | 请求成功但上下文成本与首 token 延迟偏高；需检查技能目录和系统上下文注入策略 |
| AUD-006 | P2 | 待确认 | 主界面右侧“详情”空面板默认占用内容宽度 | 初始态提示“点击消息流中的工具行查看详情”，应验证空详情是否应默认折叠 |
| AUD-007 | P2 | 待确认 | 侧栏品牌锁定区信息密度偏高 | 横向品牌图已完整显示，但图标、乘号、头像和文字同时出现；需在窄宽和高缩放下验证裁切与层级 |
| AUD-008 | P3 | 待处理 | 一个用户技能因 YAML frontmatter 无效被忽略 | `~/.agents/skills/opencli-sitemap-author/SKILL.md` 启动警告；不属于仓库源码，未经用户授权不修改 |
| AUD-009 | P1 | 已规避，待固化 | `file:` 业务插件依赖不会因源目录产物更新自动刷新 pnpm 安装快照 | 首次重包仍复现覆盖层叠加；定向 `pnpm update` 刷新 11 个插件后重包才通过。锁文件的 sibling importer 展开副作用已排除，需为打包流程增加显式快照刷新/校验 |
| AUD-010 | P2 | 已修复 | 打开业务对话框后焦点未进入面板 | DOM 契约覆盖首控件聚焦及正反向 Tab 循环；真实 Electron 中焦点进入 Dashboard 的“昨日”控件，Escape 后恢复到“企业看板”触发按钮 |

## 已确认正常

- 三个前置任务均已完成并留下提交或部署证据。
- `deepseek-harness` sibling 为 `dev` 分支且工作区干净；版本与桌面 `sourceVersion` 一致。
- Dashboard、Recruiter、Sales、Supply、Lead Discovery、Content Command、Knowledge、Retrofit、Approvals、Daily Report、FinOps 均可打开并呈现可理解的加载/就绪/空态。
- 插件市场加载 14 个插件，搜索、分类和卡片控件进入辅助功能树。
- 设置中的 DeepSeek Search API Key 入口可见，未读取或暴露凭据值。
- 真实聊天成功返回 `YOOTUN_CHAT_SMOKE_OK`，模型为 `deepseek-v4-flash-vision`。
- 模型与预算插件显示连接正常，观察到 24 次请求；成本、token 预算未配置时有明确状态。
- 当前 Harness 提供 `typertGateway`、`sessionController` 和 `workspaceController`；与 `dsh-im@4.9.1` 声明的 Desktop 进程内连接契约一致。

## 工作区基线

开始审计时存在以下用户未提交修改，审计必须保留并在合适的独立提交中收口：

- `dsh-plugin-desktop/scripts/verify-packaged-runtime.ts`
- `dsh-plugin-desktop/src/desktop-plugins.ts`
- `dsh-plugin-desktop/src/profile.ts`
- `dsh-plugin-desktop/scripts/render-sidebar-brand.mjs`（未跟踪）

前三项已随旧聚合界面迁移在 `b3e1773b69` 收口；未跟踪的品牌脚本继续按用户修改保留。
