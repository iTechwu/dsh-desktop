# Knowledge 路由深度优化计划

## 目标

让模型在企业事实与公开实时信息之间稳定选择正确的数据源，同时消除 Knowledge 直连 MCP 与本地封装工具的协议歧义，并让自动 ContextPack 的状态可观测、可回归。

## 行为契约

- 企业内部事实、优惠豚实体、制度、项目、会员、招聘、销售、供应链、内容运营、服务标准和历史会话优先使用 `knowledge_search` 或 `knowledge_recall`。
- 公开实时信息、新闻、价格、赛事、天气和外部网页才使用 `web_search` / `web_fetch`。
- 涉及企业事实与外部实时信息的混合问题，先 Knowledge，再按需 Web；不得用网页结果替代企业事实。
- Knowledge 不可用时，明确标记“企业知识不可用”，只有用户问题本身属于公开信息时才降级到 Web。
- 一个 Agent 只暴露一套 Knowledge 模型工具协议：封装工具使用 `{ input: ... }`，直连 MCP 工具不得与其并存。
- 自动 `knowledge.context_pack` 失败不得阻塞对话，但必须在内部状态和测试中区分成功、无凭证、超时和服务错误。

## 实施任务

### 任务 1：统一 Knowledge 工具暴露面

**验收：** Knowledge 插件不加载直连 MCP 客户端；模型可见工具只保留封装工具；测试覆盖协议和 patch 约束。

**文件：** `../docker-helm.dofe.ai/plugins/dsh-yootun-knowledge/index.js`、`cordis.patch.yml`、测试与桌面 `.ci` 快照。

### 任务 2：强化模型路由提示

**验收：** 系统提示明确 Knowledge/Web 的边界、调用顺序、混合问题规则和降级行为；提示中使用实际工具名，不使用含糊的“按需访问”。

**文件：** Knowledge 插件提示段、DoFe 托管提示段及对应测试。

### 任务 3：增加 ContextPack 可观测状态

**验收：** ContextPack 返回状态码与原因；成功注入、无凭证、超时、服务错误可区分；不把凭证或远端详情写入模型上下文。

**文件：** `dsh-knowledge-capture/index.js`、测试与桌面快照。

### 任务 4：回归验证

**验收：** 插件单测、快照一致性、桌面 typecheck/check 通过；每个独立改动单独提交并推送到 `origin`。

## 风险

- 现有用户工作区 `package.json` 已有未提交修改，不能纳入本次提交。
- sibling 插件仓库存在未跟踪 `docs/research/` 和 `knowledge.dofe.ai`，不能清理或覆盖。
- 仅靠提示不能绝对保证模型选择，必须同时保证工具暴露面唯一、工具描述具体、ContextPack 可用性透明。
