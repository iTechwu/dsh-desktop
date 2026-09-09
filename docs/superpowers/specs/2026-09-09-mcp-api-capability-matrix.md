# 内置 MCP/API 能力矩阵

本矩阵记录 Desktop 当前托管能力的入口、消费方和界面状态边界。工具名称和服务端协议保持不变；插件只负责把结果映射为统一的来源状态和操作生命周期。

| 能力入口 | 托管路径/工具族 | Desktop 消费方 | 主要 UI 状态 | 认证与失败边界 |
| --- | --- | --- | --- | --- |
| GEO 内容与分析 | `geoflow` / `geoflow_*` | content-command、dashboard、website publisher | ready、partial、empty、unavailable、error | 每次请求由 managed credential 注入；缺工具为 unavailable，单来源失败不拖垮其他来源 |
| GEO 排名与诊断 | `georank` / `georank_*` | content-command、dashboard | ready、partial、unavailable、error | 与 geoflow 隔离；不以零值代替缺失指标 |
| OpenMontage 视频工作流 | `montage` / `mcp__openmontage__*` | openmontage window、XHS operation | awaiting_confirmation、confirmed_pending_adapter、succeeded、failed | 长任务使用 600s 超时；准备、读取、提交按 Agent 工具限制分阶段暴露 |
| 单镜头媒体 | `media` / `mcp__media__*` | XHS operation、媒体上传 | uploading、queued、succeeded、failed、requires_user_login | UI 只展示资源引用和 MIME/大小摘要，不显示凭据、签名 URL 或本地路径 |
| 商业/平台工具 | `tools` / `mcp__tools-*` | sales、content-command、dashboard | ready、empty、degraded、error | 通过统一 MCP gateway 调用；本地 API 过滤不安全字段并保留稳定 error code |
| 供应链监控 | `supply-chain` / `supply_*` | supply-watch | ready、warning、empty、unavailable、error | 风险来源独立降级；确认动作进入统一 pending/succeeded/failed 生命周期 |
| 人才发现 | `talent-discovery` / `talent_*` | recruiter | ready、empty、degraded、error | 搜索与写入动作分离；写操作需要确认，登录失效映射为 requires_user_login |
| 线索发现与监测 | `lead-discovery`、`lead-monitor`、`hotspot-discovery` | lead-discovery、sales | ready、filtered_empty、unavailable、error | 只返回安全字段；分页、已存线索和发现失败互相隔离 |
| 改装检索 | `custom-car-monitoring` | retrofit | ready、empty、unavailable、error | 读操作不写审计；服务不可用时保留重试入口和上下文 |
| 病毒视频/浏览器智能 | `viral-video`、`browser-intelligence` | content-command、sales | ready、partial、unavailable、error | 工具缺失不伪造成功；本地 route 以稳定来源 reason 映射 UI |
| 小红书运营 | `xhs-operation` / `xhs_*` | XHS operation | awaiting_confirmation、queued、running、succeeded、failed、cancelled | 创建、轮询、取消使用同一 trace；取消需要二次确认，终态只审计一次 |
| 知识与记忆 | `knowledge_*`、`memory_*` | knowledge | ready、degraded、empty、error；写入需确认 | 统一由 knowledge MCP 处理 tenant/team/user 权限；读取不写审计，remember/forget/confirm 写入审计 |

## 统一映射规则

- 数据来源只允许 `ready`、`partial`、`empty`、`degraded`、`unavailable`、`error` 六类语义；没有数据时使用 `null` 或空列表，禁止用零值伪造成功。
- 写操作只允许 `awaiting_confirmation`、`confirmed_pending_adapter`、`queued`、`running`、`succeeded`、`failed`、`requires_user_login`、`cancelled`；按钮锁定范围只覆盖当前操作。
- 每个插件的根状态必须提供可读文案、可恢复动作和 `aria-live`/`aria-busy` 语义；局部来源失败不能替换整个页面为不可恢复错误。
- 凭据仅由托管客户端和公共 MCP gateway 注入；客户端日志、审计事件和截图不得包含 API key、签名 URL、原始请求体或本地文件路径。

