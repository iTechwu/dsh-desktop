# 回归记录

## 第 0 轮：基线与首轮审计

时间：2026-09-04 03:00-03:30（Asia/Shanghai）

### 仓库基线

- `dsh-desktop`: `master` 与 `origin/master` 对齐，开始时有 3 个已修改文件和 1 个未跟踪品牌脚本，均按用户修改保留。
- `deepseek-harness`: `dev` 与 `origin/dev` 对齐，工作区干净，版本与 `upstream.json.sourceVersion` 一致。

### 自动门禁

- 命令：`corepack pnpm check`
- 通过：layout、fabric、market、desktop build、typecheck；market 268 项测试通过；desktop 1100 项通过、4 项跳过。
- 失败：desktop 7 项，全部是旧聚合包 `@linxin666/dsh-web-ui-all` 被移除后测试仍要求其存在。
- 结论：功能相关构建通过，但完整门禁为 FAIL，需先更新迁移契约测试。

### 实际应用检查

- 应用：`dsh-plugin-desktop/dist/mac-arm64/Yootun-Agent.app`
- 主界面、工作区、设置、插件市场和 12 个侧栏业务入口均能渲染。
- Dashboard 显示 4/4 数据源就绪；模型与预算显示连接正常及 24 次请求。
- 插件市场加载 14 个插件。
- 发现覆盖层叠加、Skill 管理辅助功能缺失、空详情面板占宽等问题。

### 聊天执行

- 输入：`YOOTUN_CHAT_SMOKE_OK`
- 结果：PASS，模型返回包含相同标记的完成消息。
- 指标：总用时 7.2 秒，首 token 5.4 秒，输入 78.3K token，输出 259 token。
- 副作用：创建一个名为 `YOOTUN Chat Smoke Test` 的本地测试会话；未调用工具、未写业务数据。

### 运行日志

- 2026-09-04 03:26 时日志约 833 KiB/4600 行。
- 9 个消息渠道以 30 秒间隔重复收到 `host.describe` 403。
- 一个用户级 OpenCLI sitemap skill 因 YAML frontmatter 无效被忽略。
