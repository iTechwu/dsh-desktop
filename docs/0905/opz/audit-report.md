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
| AUD-001 | P1 | 待修复 | 移除 `@linxin666/dsh-web-ui-all` 后仍有 7 个测试断言要求旧包存在 | `pnpm check` 中桌面 1100 通过、4 跳过、7 失败，导致完整门禁不可用 |
| AUD-002 | P1 | 定位中 | 9 个未配置消息渠道每 30 秒调用 `host.describe` 并收到 403 | 飞书、Discord、WhatsApp、企微、QQ、Telegram、Slack、微信、钉钉持续重试；当日日志 03:26 已达约 833 KiB/4600 行，造成唤醒、噪声和日志增长 |
| AUD-003 | P1 | 待修复 | 多个业务覆盖层可叠加，关闭上层后露出前一层；隐藏层与主界面控件仍在辅助功能树中 | 连续打开驾驶舱、招聘、销售、供应链后，辅助功能树同时暴露各层按钮；键盘与读屏可能操作视觉上不可见的控件 |
| AUD-004 | P2 | 待修复 | Skill 管理面板只暴露标题、刷新和关闭，分组、搜索、技能卡片与操作未进入辅助功能树 | 鼠标视觉可见，但键盘和读屏无法完整操作 |
| AUD-005 | P2 | 待优化 | 一条极简聊天冒烟请求输入 78.3K token | 请求成功但上下文成本与首 token 延迟偏高；需检查技能目录和系统上下文注入策略 |
| AUD-006 | P2 | 待确认 | 主界面右侧“详情”空面板默认占用内容宽度 | 初始态提示“点击消息流中的工具行查看详情”，应验证空详情是否应默认折叠 |
| AUD-007 | P2 | 待确认 | 侧栏品牌锁定区信息密度偏高 | 横向品牌图已完整显示，但图标、乘号、头像和文字同时出现；需在窄宽和高缩放下验证裁切与层级 |
| AUD-008 | P3 | 待处理 | 一个用户技能因 YAML frontmatter 无效被忽略 | `~/.agents/skills/opencli-sitemap-author/SKILL.md` 启动警告；不属于仓库源码，未经用户授权不修改 |

## 已确认正常

- 三个前置任务均已完成并留下提交或部署证据。
- `deepseek-harness` sibling 为 `dev` 分支且工作区干净；版本与桌面 `sourceVersion` 一致。
- Dashboard、Recruiter、Sales、Supply、Lead Discovery、Content Command、Knowledge、Retrofit、Approvals、Daily Report、FinOps 均可打开并呈现可理解的加载/就绪/空态。
- 插件市场加载 14 个插件，搜索、分类和卡片控件进入辅助功能树。
- 设置中的 DeepSeek Search API Key 入口可见，未读取或暴露凭据值。
- 真实聊天成功返回 `YOOTUN_CHAT_SMOKE_OK`，模型为 `deepseek-v4-flash-vision`。
- 模型与预算插件显示连接正常，观察到 24 次请求；成本、token 预算未配置时有明确状态。

## 工作区基线

开始审计时存在以下用户未提交修改，审计必须保留并在合适的独立提交中收口：

- `dsh-plugin-desktop/scripts/verify-packaged-runtime.ts`
- `dsh-plugin-desktop/src/desktop-plugins.ts`
- `dsh-plugin-desktop/src/profile.ts`
- `dsh-plugin-desktop/scripts/render-sidebar-brand.mjs`（未跟踪）
