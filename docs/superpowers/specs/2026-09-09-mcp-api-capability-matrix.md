# 内置 MCP/API 能力矩阵

本矩阵记录 Desktop 当前托管能力的入口、消费方和界面状态边界。工具名称和服务端协议保持不变；插件只负责把结果映射为统一的来源状态和操作生命周期。

| 能力入口 | 托管路径/工具族 | Desktop 消费方 | 主要 UI 状态 | 认证与失败边界 |
| --- | --- | --- | --- | --- |
| Desktop 访问与模型配置 | `/api/desktop/dofe/models`、`/api/desktop/dofe/validate` | `dsh-yootun-ui` web/client 门禁、Desktop 原生门禁与设置页 | missing、loading、configured、error、conflict | 两套门禁共享同一 `MODELS_API_KEY`、7 项内置能力清单和遮罩焦点契约；模型列表失败不提交设置，冲突响应可重试 |
| Desktop 配置与运行控制 | `/api/desktop/settings`、`/api/desktop/profiles/create`、`/api/desktop/profiles/select`、`/api/desktop/profiles/delete`、`/api/desktop/aa/select`、`/api/desktop/market/select`、`/api/desktop/terminal/open`、`/api/desktop/restart`、`/api/desktop/restart/recovery`、`/api/desktop/developer/reload`、`/api/desktop/developer/devtools`、`/api/desktop/updates/check`、`/api/desktop/diagnostics/export` | Desktop 设置页与恢复界面 | loading、ready、saving、restart_required、failed、done | 只接受 loopback、精确 Host 和同源浏览器请求，响应禁用缓存；客户端先校验有限字段投影，需重启的操作必须明确展示 accepted 与 restartRequired，不能伪装为即时生效 |
| 工作区目录桥 | `/_dsh/desktop/pick-directory`、`/_dsh/desktop/validate-directory` | Desktop 工作区设置与首次配置 | idle、picking、selected、invalid、failed | 仅接受同源 POST；原生选择结果在持久化前必须再次验证为允许目录，请求体受 16 KiB 上限约束，UI 不在日志或错误文案中暴露完整本地路径 |
| 渲染器启动健康 | `/_dsh/desktop/renderer-boot` | Desktop 壳层启动与原生恢复窗口 | pending、healthy、failed、timeout | 仅接受当前渲染器同源 POST，请求体受 16 KiB 上限约束；失败插件名和有界错误摘要用于本代恢复判断，不携带凭据或业务请求体 |
| 插件 UI 承载面 | `settings.section`、`settings.action`、`settings.plugins.tab`、`sidebar.footer.action`、`shell.overlay`；`slots`、`locale`、`settingsScope`、`remote.settings`、`remote.credentials` | Desktop 壳层、设置页、Plugin Console 与全部 Yootun 客户端 | loading、ready、active、busy、empty、error、dismissed | 插件只在已声明 slot/service 上注册；overlay 使用互斥事件、Escape 与焦点恢复，异步状态暴露 `aria-live`/`aria-busy`；同一 slot 按 order 升序，order 相同时保留 Host 注册顺序，同一插件的 sidebar/overlay order 必须一致 |
| 插件市场读取 | `/plugin-console/state`、`/plugin-console/details`、`/plugin-console/search`、`/plugin-console/enrich`、`/plugin-console/repo`、`/plugin-console/subpackages`、`/plugin-console/sources`、`/plugin-console/gitee-oauth-url`、`/plugin-console/gitee-oauth-callback`、`/plugin-console/skills-installed`、`/plugin-console/market-index`、`/plugin-console/check-update`、`/plugin-console/framework-upgrade-status`、`/plugin-console/install-status` | Plugin Console 设置页 | loading、ready、empty、installing、consent、failed、done | 仅接受 loopback 且校验 Host；市场、软件源、技能、安装任务和框架升级状态独立降级，OAuth 回调不向页面暴露 token |
| 插件管理写操作 | `/plugin-console/toggle`、`/plugin-console/uninstall`、`/plugin-console/sources`、`/plugin-console/install`、`/plugin-console/skill-remove`、`/plugin-console/skill-toggle`、`/plugin-console/ai-consent`、`/plugin-console/framework-upgrade`、`/plugin-console/framework-relaunch`、`/plugin-console/restart` | Plugin Console 设置页 | idle、busy、awaiting_confirmation、installing、failed、done | 所有写请求校验同源 `Origin`/`Sec-Fetch-Site`；同步请求锁阻止重复提交，安装与 AI 兜底保留进度、显式授权和失败恢复状态 |
| GEO 内容与分析 | `/api/desktop/yootun/content-command`；`geoflow` / `geoflow_*` | content-command、dashboard、website publisher | ready、partial、empty、unavailable、error | 每次请求由 managed credential 注入；缺工具为 unavailable，单来源失败不拖垮其他来源 |
| GEO 排名与诊断 | `georank` / `georank_*`；实际调用 `georank_score_ai_friendliness` | content-command、dashboard | ready、partial、unavailable、error | 与 geoflow 隔离；不以零值代替缺失指标 |
| 互联网只读调研 | `agent_reach`；Exa `web_search_exa`/`web_fetch_exa` 与 OpenCLI 公开路由 | content-command、sales、retrofit、Agent | ready、partial、unavailable、error | 只允许白名单站点的只读命令；Exa 必须使用托管 `MODELS_API_KEY`，平台登录或命令受限时披露覆盖缺口，不执行发帖、评论或点赞 |
| OpenMontage 视频工作流 | `montage` / `mcp__openmontage__*` | openmontage window、XHS operation | awaiting_confirmation、confirmed_pending_adapter、succeeded、failed | 长任务使用 600s 超时；准备、读取、提交按 Agent 工具限制分阶段暴露 |
| 单镜头媒体 | `media` / `mcp__media__*` | XHS operation、媒体上传 | uploading、queued、succeeded、failed、requires_user_login | UI 只展示资源引用和 MIME/大小摘要，不显示凭据、签名 URL 或本地路径 |
| 商业/平台工具 | `tools` / `mcp__tools-*` | sales、content-command、dashboard | ready、empty、degraded、error | 通过统一 MCP gateway 调用；本地 API 过滤不安全字段并保留稳定 error code |
| 业务总览聚合 | `/api/desktop/yootun/dashboard/yesterday`、`/api/desktop/yootun/dashboard/series` | dashboard | ready、partial、empty、unavailable、error | 本地活动通过只读句柄按毫秒时间戳读取，排除继承事件；披露失败/未扫描覆盖，不完整时停用环比且 CSV 保留覆盖状态；来源健康、worker 与路由归因保留各自状态 |
| 昨日活动日报 | `/api/desktop/yootun/daily-report`；`yootun_daily_report` | daily-report | ready、partial、empty、unavailable | 使用本地 session persistence 的只读 handle，读取后始终关闭；按毫秒时间戳统计本会话事件，排除分叉继承前缀。读取失败或超过 500 个会话的扫描上限时披露覆盖范围，全部失败不显示为空日报；页面与 Agent 工具使用同一投影 |
| 模型用量与 FinOps | `/api/desktop/yootun/finops`、`/api/desktop/yootun/finops/series`；`yootun_finops_usage`、`yootun_finops_series` | finops | ready、unavailable、error；预算可独立降级 | 仅由托管 `MODELS_API_KEY` 访问用量与日聚合接口；范围和粒度先校验，预算源失败不清空已成功的用量摘要 |
| 供应链监控 | `/api/desktop/yootun/supply-watch`；`supply-chain` / `supply_*`；实际调用 `supply_chain_alerts_list` | supply-watch | ready、warning、empty、unavailable、error | 风险来源独立降级；确认动作进入统一 pending/succeeded/failed 生命周期 |
| 人才发现 | `/api/desktop/yootun/recruiter`；`talent-discovery` / `talent_*`；实际调用 `talent_candidates_list` | recruiter | ready、empty、degraded、error | 搜索与写入动作分离；写操作需要确认，登录失效映射为 requires_user_login |
| 线索发现与监测 | `/api/desktop/yootun/lead-discovery`、`/api/desktop/yootun/sales`；`lead-discovery`、`lead-monitor`、`hotspot-discovery`；实际调用 `lead_discovery_discover`、`lead_discovery_database_search`、`lead_discovery_result_page_get`、`lead_discovery_candidates_list` | lead-discovery、sales | ready、filtered_empty、unavailable、error | 只返回安全字段；分页、已存线索和发现失败互相隔离 |
| 改装检索 | `/api/desktop/yootun/retrofit`；`custom-car-monitoring` | retrofit | ready、empty、unavailable、error | 读操作不写审计；服务不可用时保留重试入口和上下文 |
| 病毒视频/浏览器智能 | `viral-video`、`browser-intelligence` | content-command、sales | ready、partial、unavailable、error | 工具缺失不伪造成功；本地 route 以稳定来源 reason 映射 UI |
| 小红书运营 | `/api/desktop/yootun/xhs-operation`；`xhs-operation` / `xhs_*` | XHS operation | awaiting_confirmation、queued、running、succeeded、failed、cancelled | 创建、轮询、取消使用同一 trace；取消需要二次确认，终态只审计一次 |
| 抖音运营 | `/api/desktop/yootun/douyin-operation`；`douyin-operation`；实际调用 `douyin_account_save`、`douyin_account_remove`、`douyin_session_status_report`、`douyin_collect_run_start`、`douyin_collect_run_set_list_meta`、`douyin_collect_run_heartbeat`、`douyin_collect_ingest_batch`、`douyin_collect_run_finish`、`douyin_collect_run_cancel`、`douyin_account_list`、`douyin_work_list`、`douyin_work_get`、`douyin_work_trend`、`douyin_collect_run_get`、`douyin_export` | douyin-operation | ready、partial、empty、unavailable、error；删除为 awaiting_confirmation、confirmed_pending_adapter、cleanup_failed | 采集在设备端由系统 Google Chrome（Playwright `channel="chrome"`，无 Chrome 阻断且不回退 Chromium）执行，Cookie 与 `storage_state` 永不离开设备；tools 只接收 `vault://` 会话引用与设备上报的会话状态，页面只访问本地同源路由，不接收 `MODELS_API_KEY`、内部地址或原始传输错误。作品字段本次未暴露时显示 `—`，不回填历史值 |
| 知识与记忆 | `/api/desktop/yootun/knowledge`；`knowledge_*`、`memory_*` | knowledge | ready、degraded、empty、error；写入需确认 | 统一由 knowledge MCP 处理 tenant/team/user 权限；读取不写审计，remember/forget/confirm 写入审计 |
| 审计事件与同步 | `/api/desktop/yootun/audit` | audit | ready、offline、cached、auth_required、forbidden、local_error；同步可重试 | 读取与 `retry_sync` 使用同源托管路由；脱机优先展示本地缓存，不把同步失败伪装成空数据 |
| TOS 媒体上传 | `/_dsh/uploader/pick-file`、`/_dsh/uploader/upload`、`/_dsh/uploader/uploadStart`、`/_dsh/uploader/uploadStatus`、`/_dsh/uploader/media`；`media_upload` | XHS operation、Agent 媒体工具 | uploading、queued、succeeded、failed、cancelled、requires_user_login | 通过原生选取、允许清单和 TOCTOU 复查；授权仅交给 Tools MCP，不回传本地路径、预签名 URL 或对象 key |
| 文件交付声明 | `present`；`deliverables/presented` Session 事件 | Web Deliverables 文件卡片与默认应用打开 | declared、blocked、opened | 仅接受 Session 工作区可访问的常规文件，单次受 `maxFiles` 限制；记录路径和描述，不复制文件内容，子 Agent 的交付由父 Session 显式声明 |

## 托管 MCP 传输契约

| Server name | 托管路径 | 工具调用超时 | 设置门控 |
| --- | --- | --- | --- |
| `geoflow` | `/mcp/geoflow` | 60s | geoflow |
| `georank` | `/mcp/georank` | 120s | georank |
| `openmontage` | `/mcp/montage` | 600s | openmontage |
| `media` | `/mcp/media` | 60s | media |
| `tools-platform` | `/mcp/tools/platform` | 60s | tools |
| `tools-supply-chain` | `/mcp/tools/supply-chain` | 60s | tools |
| `tools-talent-discovery` | `/mcp/tools/talent-discovery` | 60s | tools |
| `tools-lead-discovery` | `/mcp/tools/lead-discovery` | 60s | tools |
| `tools-lead-monitor` | `/mcp/tools/lead-monitor` | 60s | tools |
| `tools-hotspot-discovery` | `/mcp/tools/hotspot-discovery` | 60s | tools |
| `tools-custom-car-monitoring` | `/mcp/tools/custom-car-monitoring` | 60s | tools |
| `tools-viral-video` | `/mcp/tools/viral-video` | 60s | tools |
| `tools-browser-intelligence` | `/mcp/tools/browser-intelligence` | 60s | tools |
| `tools-tos-upload` | `/mcp/tools/tos-upload` | 60s | tools |
| `tools-xhs-operation` | `/mcp/tools/xhs-operation` | 60s | tools |
| `tools-douyin-operation` | `/mcp/tools/douyin-operation` | 60s | tools |

所有 server 都使用 streamable HTTP 和同一个托管凭据引用；启动失败不阻断 Desktop 壳层，重连从 500ms 指数退避到 30s、最多 10 次。凭据或启用插件集合变化时，Host 销毁旧 client 后按当前 generation 重建；任何传输错误都不得序列化 Authorization 请求元数据。

## Host Agent 工具契约

| 工具组 | 稳定工具名 | 行为边界 |
| --- | --- | --- |
| Desktop 浏览器与调研 | `browser`、`dofe_opencli` | browser 仅接受声明的 action 与稳定 session；登录凭据必须由用户在前台输入，最终发布需要明确批准。OpenCLI 只允许已批准的只读路由，参数数量和单项长度受限 |
| Desktop CI | `ci_validate`、`ci_run` | 默认读取 `.dsh/ci.yml`；validate 不执行命令，run 严格按步骤顺序执行并按 continueOnError/stopOnFirstFailure 停止 |
| 本地招聘工作台 | `yootun_recruiter` | 只保存岗位和脱敏候选人分析；publish_jd、send_message、write_feedback 只创建待确认动作，工具不能自行确认或外发 |
| 业务只读投影 | `yootun_content_overview`、`yootun_daily_report`、`yootun_dashboard_overview`、`yootun_dashboard_series`、`yootun_finops_usage`、`yootun_finops_series`、`yootun_lead_discovery`、`yootun_lead_discovery_candidates`、`yootun_recruiter_overview`、`yootun_retrofit_search`、`yootun_sales_overview`、`yootun_sales_intent_search`、`yootun_supply_watch_overview` | 与对应界面使用同一安全投影和来源状态；overview/series/list 工具可并发，参数枚举和查询长度在 Host 校验 |
| Knowledge 安全封装 | `knowledge_search`、`knowledge_recall`、`knowledge_remember`、`knowledge_confirm_memory`、`knowledge_forget`、`knowledge_session_checkpoint`、`knowledge_promote`、`knowledge_capabilities`、`knowledge_overview`、`knowledge_graph`、`knowledge_ingest_file`、`knowledge_loadout`、`knowledge_context_pack`、`knowledge_explain_trace`、`knowledge_entity_assertions`、`knowledge_relation_assertions`、`knowledge_entity_merges`、`knowledge_provenance_lineage` | 所有输入先按 bounded schema 校验，再注入托管凭据；空间由服务端 ACL 解析。写入、确认、遗忘与晋升遵守显式确认和审计规则，不允许绕过封装直连 Knowledge MCP |
| 媒体与交付 | `media_upload`、`present` | media_upload 只能由用户原生选取文件，调用方不能提交本地路径；present 只声明 Session 已有的常规文件，不复制内容 |

## 统一映射规则

- 数据来源只允许 `ready`、`partial`、`empty`、`degraded`、`unavailable`、`error` 六类语义；没有数据时使用 `null` 或空列表，禁止用零值伪造成功。
- 写操作只允许 `awaiting_confirmation`、`confirmed_pending_adapter`、`queued`、`running`、`succeeded`、`failed`、`requires_user_login`、`cancelled`；按钮锁定范围只覆盖当前操作。
- 兼容协议中的 `adapter_pending` 仅用于内容发布平台状态及历史 action payload；客户端将它与 `confirmed_pending_adapter` 映射到同一“已确认、等待适配”视觉语义，新建写操作统一输出 `confirmed_pending_adapter`。
- 业务状态与 HTTP 状态分层：数据 route 即使返回 HTTP 200，也必须读取 body 的 `status`；访问门禁、审计和输入校验则使用 4xx/5xx 表达认证、参数或上游失败，UI 需保留稳定的 `reason`/`error` 文案映射。
- 每个插件的根状态必须提供可读文案、可恢复动作和 `aria-live`/`aria-busy` 语义；局部来源失败不能替换整个页面为不可恢复错误。
- 凭据仅由托管客户端和公共 MCP gateway 注入；客户端日志、审计事件和截图不得包含 API key、签名 URL、原始请求体或本地文件路径。
