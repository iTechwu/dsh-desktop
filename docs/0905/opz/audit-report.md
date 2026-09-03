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
| AUD-002 | P1 | 已修复 | `@xmanrui/dsh-im@2.3.0` 的 9 个消息渠道每 30 秒通过未认证 HTTP 调用 `host.describe` 并收到 403 | 隔离升级和降级均通过后，真实 `desktop` Profile 升级到 4.9.1；安装阶段配置哈希不变，首次启动将工作区文档迁移为 v2 访问策略且保留原绑定。飞书显示 1/1 在线并成功发送连接测试消息，连续观察超过两个旧重试周期没有新增 403；2 个升级前快照仍可用于声明文件回滚 |
| AUD-003 | P1 | 已修复 | 多个业务覆盖层可叠加，关闭上层后露出前一层；隐藏层与主界面控件仍在辅助功能树中 | `docker-helm.dofe.ai@8c9f508` 实现 11 个面板互斥；`dsh-desktop@705ab05047` 和 `deepseek-harness@de9675462b` 分别覆盖桌面自有帧与兼容帧的背景隔离。真实包打开 Dashboard 后辅助功能树只保留当前弹窗 |
| AUD-004 | P2 | 外部插件待修复 | `dsh-skill-panel@1.3.1` 一次性渲染 112 个技能，Electron/macOS 原生 AX 只暴露标题、刷新和关闭 | DOM 与 Chromium AX 均完整，Tab 可进入筛选按钮；运行时仅保留 3 行后原生 AX 立即恢复全部筛选、搜索和行操作。需由插件实现虚拟列表/分页；当前账号对上游仅有只读权限，不提交不可推送补丁 |
| AUD-005 | P2 | 待优化 | 一条极简聊天冒烟请求输入 78.3K token | 请求成功但上下文成本与首 token 延迟偏高；需检查技能目录和系统上下文注入策略 |
| AUD-006 | P2 | 已修复 | 详情列视觉折叠后仍保留在辅助功能树，读屏可访问隐藏标题、关闭按钮和占位提示 | `bbcd4eb29c` 在计算宽度为 0 时为详情容器同步设置 `inert` 和 `aria-hidden`；单测覆盖折叠/展开双态，真实包验证关闭后相关节点全部退出 macOS AX，工具记录仍可重新展开 |
| AUD-007 | P2 | 待确认 | 侧栏品牌锁定区信息密度偏高 | 横向品牌图已完整显示，但图标、乘号、头像和文字同时出现；需在窄宽和高缩放下验证裁切与层级 |
| AUD-008 | P3 | 待处理 | 一个用户技能因 YAML frontmatter 无效被忽略 | `~/.agents/skills/opencli-sitemap-author/SKILL.md` 启动警告；不属于仓库源码，未经用户授权不修改 |
| AUD-009 | P1 | 已规避，待固化 | `file:` 业务插件依赖不会因源目录产物更新自动刷新 pnpm 安装快照 | 首次重包仍复现覆盖层叠加；定向 `pnpm update` 刷新 11 个插件后重包才通过。锁文件的 sibling importer 展开副作用已排除，需为打包流程增加显式快照刷新/校验 |
| AUD-010 | P2 | 已修复 | 打开业务对话框后焦点未进入面板 | DOM 契约覆盖首控件聚焦及正反向 Tab 循环；真实 Electron 中焦点进入 Dashboard 的“昨日”控件，Escape 后恢复到“企业看板”触发按钮 |
| AUD-011 | P3 | 外部权限待处理 | 飞书机器人没有 `application:app_slash_command:read` 应用身份权限 | 4.9.1 启动时仅跳过斜杠命令注册，普通消息长连接保持 1/1 在线且测试消息发送成功；需由飞书应用管理员补权后再验证斜杠命令，不在本机写入或扩张凭据权限 |
| AUD-012 | P1 | 已修复 | 企业驾驶舱近 7 天/近 30 天在 GeoFlow 返回 `tenant_id` 时引用未传入的 `now`，导致 GEO 数据源整体降级为异常 | 真实包复现 `GeoFlow series failed: now is not defined`；`docker-helm.dofe.ai@b94319b` 注入时钟并补充租户目标月份回归，插件 15/15 通过；重包后两个范围均恢复 4/4，06:13 后日志无同类错误 |

## 已确认正常

- 三个前置任务均已完成并留下提交或部署证据。
- `deepseek-harness` sibling 为 `dev` 分支且工作区干净；版本与桌面 `sourceVersion` 一致。
- Dashboard、Recruiter、Sales、Supply、Lead Discovery、Content Command、Knowledge、Retrofit、Approvals、Daily Report、FinOps 均可打开并呈现可理解的加载/就绪/空态。
- 插件市场加载 14 个插件，搜索、分类和卡片控件进入辅助功能树。
- 设置中的 DeepSeek Search API Key 入口可见，未读取或暴露凭据值。
- 真实聊天成功返回 `YOOTUN_CHAT_SMOKE_OK`，模型为 `deepseek-v4-flash-vision`。
- 独立审计会话只执行一次 `pwd`，工具摘要、参数、结果、Schema 和计时完整；新会话不继承上下文，完成态与进行中会话在重启后均按策略恢复。
- 模型与预算插件显示连接正常，观察到 24 次请求；成本、token 预算未配置时有明确状态。
- 企业驾驶舱刷新可用；昨日及近 7/30 天切换均能完成，修复后趋势范围维持 4/4 数据源并对真实无数据场景显示“暂无数据”。
- 当前 Harness 提供 `typertGateway`、`sessionController` 和 `workspaceController`；与 `dsh-im@4.9.1` 声明的 Desktop 进程内连接契约一致。
- 真实 `desktop` Profile 已运行 `dsh-im@4.9.1`；飞书机器人 1/1 在线，连接检查成功发送测试消息。

## 工作区基线

开始审计时存在以下用户未提交修改，审计必须保留并在合适的独立提交中收口：

- `dsh-plugin-desktop/scripts/verify-packaged-runtime.ts`
- `dsh-plugin-desktop/src/desktop-plugins.ts`
- `dsh-plugin-desktop/src/profile.ts`
- `dsh-plugin-desktop/scripts/render-sidebar-brand.mjs`（未跟踪）

前三项已随旧聚合界面迁移在 `b3e1773b69` 收口；未跟踪的品牌脚本继续按用户修改保留。
