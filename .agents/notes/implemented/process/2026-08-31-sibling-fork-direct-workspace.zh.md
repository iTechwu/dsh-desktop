# Agent Note: 兄弟 fork 直连工作区

Status: implemented

[English](2026-08-31-sibling-fork-direct-workspace.md) | 中文

## 问题

以钉死 git submodule 加 vendored tarball 的方式消费 DeepSeek Harness 上游,阻断了本地化行为的即时生效,还把 241 个 tarball 与机器相关的绝对路径 `file:` 依赖塞进仓库。submodule 把源码冻结在官方单一 commit,而产品实际需要跟踪用户自己的 fork(`dev` 分支)——桌面行为以普通提交形式生活在那里。

## 决策

`deepseek-harness/` 是指向 `../deepseek-harness` 的 git symlink(mode `120000`)——即用户 fork `iTechwu/deepseek-harness` 的 `dev` 分支。它通过 `deepseek-harness/{apps,packages,native,vendor}/**` 四组 glob 成为根 pnpm workspace 成员,fork 的 `workspace:^` 依赖原生解析,`linkWorkspacePackages` 把所有 `@deepseek-ai/dsh*`、cordis 家族与 schemastery 依赖链接到 fork 源码。

`upstream.json` 恰好声明 `repository`(SSH fork 地址)、`branch`、`localCheckout`、`sourceVersion` 四个键;不钉 commit——真源是兄弟工作区,`sourceVersion` 必须等于兄弟根版本。CI 在 `pnpm install` 前把 fork 克隆到 `../deepseek-harness`(SSH,`--depth 1 --branch dev`),`scripts/upstream-workspace-link.mjs` 在任何安装之前物化 Windows junction。

桌面自有行为是 fork 的原生提交。原 `patches/` 下的 DSH 行为补丁与 `scripts/apply-upstream-patches.mjs` 已删除;`patches/` 只保留三条 toolchain 补丁(`app-builder-lib`、`dshmarket`、`open`),由 `patchedDependencies` 管辖。`dsh-plugin-desktop/tests/package.spec.ts` 直接对 fork 源码断言这些移植行为。

## 后果

fork 自己的 `overrides`/`allowBuilds`/`patchedDependencies` 在合并依赖图中不生效;根 `pnpm-workspace.yaml` 必须代为声明所需包的 `allowBuilds`。钉 registry 版本的 cordis 家族依赖会造成双实例,必须保持 `workspace:*`(`verify-layout` 强制)。两个工作区必须钉同一 pnpm 发布版(`pnpm@11.7.0`)。桌面构建现在依赖兄弟状态:fork 的原生构建与 `lib/` 产物由 `upstream:install` + `upstream:build` 生产,CI 需要 `SSH_KEY` secret(只读密钥)来克隆 fork。

## 取代

[2026-08-15-pinned-upstream-and-isolated-yarn-workspace](2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md) —— 钉 commit 的 submodule 与隔离工作区契约退役,由兄弟直连拓扑取代。
