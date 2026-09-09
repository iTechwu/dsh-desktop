# 内置插件统一体验契约实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 13 个内置 Yootun Client 插件的 shell、状态、动作反馈和主题使用统一到可验证的体验契约，同时保持各插件的业务布局。

**Architecture:** 先增强根仓库的静态 UX 门禁，形成统一规则；再按数据面板、交互工作台、知识与媒体三组逐步修正插件源码并同步 `lib/client.js` 构建产物。每组以现有 Playwright 浏览器夹具验证 390px/1440px、状态反馈、动作锁定和焦点行为，最终由桌面包闭包与全量 `check` 收口。

**Tech Stack:** Node.js ESM 脚本、React 运行时（各插件自带 client.js）、Desktop theme aliases、Node test、Playwright/Vite 浏览器夹具、pnpm 11.7.0。

**Spec:** `docs/superpowers/specs/2026-09-09-plugin-experience-contract-design.md`

## Global Constraints

- 所有插件必须继续使用 `--dsw-alias-*` 主题变量，不得新增固定语义颜色。
- 所有可关闭 overlay 必须有 dialog name、Escape 关闭和触发控件焦点恢复。
- 异步请求必须暴露 `aria-busy`，并使用同步 ref 锁防止重复请求。
- 每次仓库修改后必须用中文 Conventional Commit 提交并推送到 `origin`。
- 不覆盖现有 `docs/superpowers/evidence/2026-09-08-theme-actions/390-sales-searching.png` 的未提交变化。

### Task 1: 扩展 UX 门禁

**Files:**
- Modify: `scripts/plugin-ux-audit.mjs`
- Test: `scripts/plugin-ux-audit.mjs`（命令门禁）

**Interfaces:**
- Consumes: 每个 `.ci/dsh-yootun-*/src/client.js` 与 `lib/client.js` 文本。
- Produces: 对 shell 基线、主题别名、状态和动作生命周期的失败列表；通过时输出插件数量。

- [ ] **Step 1: 写入失败规则**

为脚本增加以下检查：插件页头必须出现 `min-height:72px` 或明确移动端覆盖；图标按钮必须同时有 `width:36px;height:36px`；状态 UI 必须包含 `ready/loading/empty/unavailable/error` 中至少三种可读分支；存在写操作的插件必须包含 `awaiting_confirmation` 或等价动作分支和禁用态样式。规则只针对源码已声明的能力，不要求纯展示插件虚构写操作。

- [ ] **Step 2: 运行门禁确认当前差异可见**

Run: `corepack pnpm check:ux`

Expected: FAIL，并列出知识插件固定颜色、页头基线或动作状态缺失等真实差异；若当前源码恰好满足某条规则，保留其余可验证规则继续失败。

- [ ] **Step 3: 实现最小静态检查**

使用现有 `readFile`、正则和 `failures` 数组，不引入第三方依赖；错误信息带插件名和具体契约名称，避免只报告“样式不一致”。

- [ ] **Step 4: 运行门禁确认规则可执行**

Run: `corepack pnpm check:ux`

Expected: 只报告尚未修复的插件差异，输出稳定且可用于后续每组提交。

- [ ] **Step 5: Commit**

```bash
git add scripts/plugin-ux-audit.mjs
git commit -m "test: 扩展内置插件体验契约门禁"
git push origin HEAD
```

### Task 2: 统一数据面板 Shell 与根状态

**Files:**
- Modify: `.ci/dsh-yootun-dashboard/src/client.js`
- Modify: `.ci/dsh-yootun-finops/src/client.js`
- Modify: `.ci/dsh-yootun-daily-report/src/client.js`
- Modify: `.ci/dsh-yootun-audit/src/client.js`
- Modify: `dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs`
- Test: `.ci/dsh-yootun-dashboard/test/*.test.mjs`, `.ci/dsh-yootun-finops/test/*.test.mjs`, `.ci/dsh-yootun-daily-report/test/*.test.mjs`, `.ci/dsh-yootun-audit/test/*.test.mjs`

**Interfaces:**
- Consumes: 4 个 dashboard/audit 本地 API 的既有 response 状态。
- Produces: 统一页头尺寸、来源状态行、首次加载/空数据/不可用/错误根状态和独立刷新锁。

- [ ] **Step 1: 先增加状态与尺寸断言**

在现有浏览器夹具中对 390px 页面检查 overlay 标题、刷新/关闭按钮尺寸、`aria-busy`、错误/空态 role 和无横向滚动；对 1440px 检查内容最大宽度与页头高度。

- [ ] **Step 2: 运行定点浏览器测试确认失败**

Run: `node --test dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs`

Expected: 新增断言至少对一个尚未统一的面板失败，失败信息指出实际尺寸或缺失状态。

- [ ] **Step 3: 统一四个插件的 shell CSS 与状态结构**

将页头基线、图标按钮、内容内边距和状态容器调整到契约；保留 dashboard 的 tabs、audit 的表格和 finops 的范围控件。状态分支必须提供来源/范围上下文与重试动作，不能把 `unavailable` 当成 `empty`。

- [ ] **Step 4: 构建并运行插件定点测试**

Run: `for d in .ci/dsh-yootun-dashboard .ci/dsh-yootun-finops .ci/dsh-yootun-daily-report .ci/dsh-yootun-audit; do (cd "$d" && corepack pnpm run check); done`

Expected: 四个包构建、单测通过。

- [ ] **Step 5: 运行浏览器截图与控制台检查**

Run: `node --test dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs`

Expected: 390px/1440px 截图生成，控制台无 error/warning，页面无横向滚动。

- [ ] **Step 6: Commit**

```bash
git add .ci/dsh-yootun-dashboard .ci/dsh-yootun-finops .ci/dsh-yootun-daily-report .ci/dsh-yootun-audit dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs
git commit -m "fix: 统一数据面板状态与页面外壳"
git push origin HEAD
```

### Task 3: 统一交互工作台动作反馈

**Files:**
- Modify: `.ci/dsh-yootun-sales/src/client.js`
- Modify: `.ci/dsh-yootun-lead-discovery/src/client.js`
- Modify: `.ci/dsh-yootun-recruiter/src/client.js`
- Modify: `.ci/dsh-yootun-supply-watch/src/client.js`
- Modify: `.ci/dsh-yootun-content-command/src/client.js`
- Modify: `dsh-plugin-desktop/tests/browser/yootun-theme-actions.visual.mjs`
- Test: 各包现有 `test/*.test.mjs`

**Interfaces:**
- Consumes: 销售、线索、招聘、供应、内容 API 的确认与适配器状态。
- Produces: 一致的动作状态标签、局部 busy 锁、确认后受理反馈、失败重试和按钮对比度。

- [ ] **Step 1: 增加确认与失败状态浏览器断言**

对每个工作台执行一次确认/撤销或搜索动作，检查按钮在请求期间锁定、响应后显示受理/失败文案，关闭按钮仍可用。

- [ ] **Step 2: 运行测试确认差异**

Run: `node --test dsh-plugin-desktop/tests/browser/yootun-theme-actions.visual.mjs`

Expected: 失败仅来自尚未统一的动作状态或尺寸断言。

- [ ] **Step 3: 修正工作台状态映射与 CSS**

统一 `awaiting_confirmation`、`confirmed_pending_adapter`/`adapter_pending`、`succeeded`、`failed`、`requires_user_login`、`dismissed` 的文字与语义；主操作使用自适应前景令牌，局部 busy 不阻塞导航。

- [ ] **Step 4: 构建并运行五个包的测试**

Run: `for d in .ci/dsh-yootun-sales .ci/dsh-yootun-lead-discovery .ci/dsh-yootun-recruiter .ci/dsh-yootun-supply-watch .ci/dsh-yootun-content-command; do (cd "$d" && corepack pnpm run check); done`

Expected: 全部通过。

- [ ] **Step 5: 运行浏览器验证并检查截图**

Run: `node --test dsh-plugin-desktop/tests/browser/yootun-theme-actions.visual.mjs`

Expected: 390px 动作确认、搜索中和失败恢复截图可读，控制台清洁。

- [ ] **Step 6: Commit**

```bash
git add .ci/dsh-yootun-sales .ci/dsh-yootun-lead-discovery .ci/dsh-yootun-recruiter .ci/dsh-yootun-supply-watch .ci/dsh-yootun-content-command dsh-plugin-desktop/tests/browser/yootun-theme-actions.visual.mjs
git commit -m "fix: 统一工作台动作状态与忙碌反馈"
git push origin HEAD
```

### Task 4: 统一知识与媒体插件视觉语言

**Files:**
- Modify: `.ci/dsh-yootun-knowledge/src/client.js`
- Modify: `.ci/dsh-yootun-retrofit/src/client.js`
- Modify: `.ci/dsh-yootun-xhs-operation/src/client.js`
- Modify: `.ci/dsh-yootun-ui/src/client.js`
- Modify: `dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs`
- Test: 各包现有 `test/*.test.mjs`

**Interfaces:**
- Consumes: Knowledge MCP、改装检索 API、小红书上传/任务 API 和 DoFe access gate。
- Produces: 与其他插件一致的页头/按钮/状态基础，同时保留知识图谱、素材上传和模型授权的业务结构。

- [ ] **Step 1: 增加知识/媒体响应式和主题断言**

检查知识页不再使用固定深色语义颜色；检查上传、检索、任务轮询在 busy 时只锁定相关区域；检查 access gate 的敏感字段与确认动作保持现状。

- [ ] **Step 2: 运行定点测试确认失败**

Run: `node --test dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs`

Expected: 断言准确指出固定颜色、根状态或局部锁定差异。

- [ ] **Step 3: 修正知识/媒体 CSS 与状态结构**

将知识插件的固定颜色替换为主题别名，统一圆角、页头和移动端间距；为媒体插件补齐不可用、失败、等待和成功的播报与恢复动作。

- [ ] **Step 4: 构建并运行四个包测试**

Run: `for d in .ci/dsh-yootun-knowledge .ci/dsh-yootun-retrofit .ci/dsh-yootun-xhs-operation .ci/dsh-yootun-ui; do (cd "$d" && corepack pnpm run check); done`

Expected: 全部通过。

- [ ] **Step 5: 运行浏览器回归并查看截图**

Run: `node --test dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs`

Expected: 知识、改装、小红书和访问设置在 390px/1440px 下无溢出，错误/空态有明确上下文。

- [ ] **Step 6: Commit**

```bash
git add .ci/dsh-yootun-knowledge .ci/dsh-yootun-retrofit .ci/dsh-yootun-xhs-operation .ci/dsh-yootun-ui dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs
git commit -m "fix: 统一知识与媒体插件视觉状态"
git push origin HEAD
```

### Task 5: MCP/API 端到端体验回归与最终门禁

**Files:**
- Modify: `dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs`
- Modify: `dsh-plugin-desktop/tests/browser/yootun-theme-actions.visual.mjs`
- Modify: `dsh-plugin-desktop/tests/browser/yootun-audit.visual.mjs`
- Test: `scripts/plugin-ux-audit.mjs`, `dsh-plugin-desktop/tests/openmontage-workflow-guard.spec.ts`, 所有业务 route tests

**Interfaces:**
- Consumes: MCP 工具注册、桌面本地 API、各插件渲染状态和审计事件。
- Produces: 可追溯的截图证据、无障碍与网络安全回归结果、完整构建门禁结果。

- [ ] **Step 1: 增加 MCP/API 状态映射断言**

在浏览器夹具中验证来源不可用、部分来源、等待确认、登录失效、重试和成功受理的文案与 role；在桌面测试中验证实际工具名和 API 路径仍与界面状态一致。

- [ ] **Step 2: 运行全部定点测试**

Run: `corepack pnpm check:ux && node --test dsh-plugin-desktop/tests/browser/yootun-audit.visual.mjs dsh-plugin-desktop/tests/browser/yootun-search-locks.visual.mjs dsh-plugin-desktop/tests/browser/yootun-theme-actions.visual.mjs`

Expected: UX 门禁、三套浏览器回归全部通过。

- [ ] **Step 3: 运行桌面包完整检查**

Run: `corepack pnpm --filter dsh-plugin-desktop check`

Expected: build、typecheck、unit tests、closure、loader、profile、operations 检查通过；若环境依赖导致失败，记录具体命令与退出原因。

- [ ] **Step 4: 运行根目录完整检查**

Run: `corepack pnpm check`

Expected: layout、architecture、UX、Fabric、Market 与 Desktop 全部通过，或仅保留可复现且与本次无关的环境失败。

- [ ] **Step 5: Commit**

```bash
git add dsh-plugin-desktop/tests/browser
git commit -m "test: 完成内置插件 MCP 与 API 体验回归"
git push origin HEAD
```
