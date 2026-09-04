# 操作审计紧急回滚手册

操作审计不参与业务操作的成功判定。只有审计入口或同步造成发布阻断时，才执行本手册；不回滚招聘、销售、供应链、内容等领域工作台自身的确认和执行能力。

## 回滚动作

1. 从最新 `origin/dev` 创建修复分支，不改写或撤销已推送历史。
2. 在 `dsh-plugin-desktop/cordis.patch.yml` 删除 `dofe-yootun-audit` 条目。
3. 将 `desktop-shell.config.auditSyncEnabled` 显式设置为 `false`。
4. 保留 `@dofe/dsh-yootun-audit` 包依赖和所有领域采集代码，避免重装或恢复时出现包闭包差异。
5. 本地执行 `corepack pnpm check:layout` 和 `corepack pnpm check`。
6. 使用中文 Conventional Commits 新增回滚提交，推送到 `origin/dev`，由 CI 拉取该提交后部署。

## 数据保护

回滚不得删除或改写以下数据：

- Models 已接收的操作审计记录；
- Desktop 本地 pending 文件；
- Desktop 本地 quarantine 文件；
- 旧审批状态文件。

同步关闭期间的 pending 事件继续保留。恢复入口和 `auditSyncEnabled` 后，可靠补传服务按原 `clientEventId` 幂等续传，不做人工回填或重写。

## 恢复验证

恢复提交发布前，依次验证本人范围、团队管理员范围和超级管理员显式选团队范围；确认待同步数量回落、quarantine 未异常增长、同一 `clientEventId` 只出现一次，且业务写操作在审计服务不可用时仍可成功返回。
