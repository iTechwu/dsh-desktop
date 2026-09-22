# dsh-sensteed-supplier-intelligence

Sensteed Agent 的供应商全量数据归集与舆情分析插件。插件注册 tools.dofe.ai 供应链 MCP、只读能力预检工具，并把 `skills/supplier-intelligence/SKILL.md` 注入 Agent 指导。

默认流程先读取供应商、企查查缓存、关系与情报报告；只有发现数据缺口时，才使用受控 MCP 工具触发企查查或社媒采集。所有外部调用继续由 tools.dofe.ai 服务端执行缓存、预算、入库和幂等保护，插件不保存供应商平台凭据。

```bash
npm test
npm run check
```
