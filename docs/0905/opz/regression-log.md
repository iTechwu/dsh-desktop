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

## 第 1 轮：迁移门禁与业务面板互斥

时间：2026-09-04 03:30-04:05（Asia/Shanghai）

### 修复与提交

- `dsh-desktop@b3e1773b69`：移除旧聚合 Web UI 的运行依赖并更新 7 个过期测试。
- `docker-helm.dofe.ai@8c9f508`：11 个业务覆盖层统一打开事件、互斥关闭、对话框语义和 Escape 行为；新增跨插件契约测试。
- 两个提交均已推送各自 `origin/master`。

### 自动门禁

- 完整 `corepack pnpm check`：PASS。
- Market：268/268；Desktop：1107 通过、4 跳过；build、typecheck、runtime closure、CLI、Loader、Profile、licenses、operations 均通过。
- 12 个相关插件独立 `npm run check`：PASS；Dashboard 首次暴露无 `window` 的 headless 回归，增加环境守卫后 15/15 通过。
- 跨插件覆盖层契约：先 RED（Dashboard 缺少 `OVERLAY_ID`），实现后 5/5 PASS。

### 实际应用回归

- 第一次目录包仍叠加面板，定位为 pnpm `file:` 安装快照未随插件源产物刷新。
- 定向刷新 11 个插件依赖并排除无关锁文件变化后重新打包。
- Dashboard -> Recruiter：Dashboard 文本计数 `5 -> 0`，Recruiter `0 -> 5`，互斥 PASS。
- Escape：Dashboard 和 Recruiter 计数均为 0，关闭 PASS。
- 遗留：打开 Recruiter 后焦点仍在后台“招聘工作台”按钮；背景主界面仍可从辅助功能树访问。

### 部署判断

- 本轮改动为桌面内嵌客户端插件，不改变服务端路由或容器；未触发 Jenkins 服务部署。

## 第 2 轮：模态背景隔离与焦点管理

时间：2026-09-04 04:05-04:22（Asia/Shanghai）

### 修复与提交

- `deepseek-harness@de9675462b`：兼容模式 `AppFrame` 在模态打开时隔离后台、聚焦弹窗、约束正反向 Tab 循环并在关闭后恢复焦点；新增客户端回归测试。
- `dsh-desktop@705ab05047`：高级与扩展模式的 `DesktopOwnedFrame` 接入同等的模态隔离器；新增独立 DOM 契约测试。
- 两个提交均已推送各自 `origin`；桌面仓库中用户未跟踪的品牌渲染脚本未改动。

### 自动门禁

- Harness UI layout：7 个测试文件、63 项测试全部通过，包 bundle 通过；预推送全仓 typecheck 通过。
- Desktop：模态隔离测试 1/1，五套 TypeScript 配置检查通过。
- 完整 `corepack pnpm check`：Market 268/268；Desktop 1107 通过、4 跳过；build、typecheck、runtime closure、CLI、Loader、Profile、licenses、operations 全部通过。

### 实际应用回归

- 第一次目录包在下载 Electron 时短暂 `fetch failed`，重试后下载、解压、依赖组装和 fuses 均成功；未跳过验证或修改下载契约。
- 首次真实回归揭示高级模式使用桌面自有帧，而非 Harness `AppFrame`；补齐桌面边界后再次构建目录包。
- 打开企业驾驶舱后，可访问树由完整主界面收敛为当前弹窗，背景隔离 PASS。
- 焦点进入弹窗内“昨日”切换控件；按 Escape 后弹窗消失、主界面恢复，焦点回到“企业看板”按钮，进入与归还 PASS。

### 部署判断

- 本轮仍仅修改客户端壳与本地 Harness，未产生服务端部署目标，因此没有触发 Jenkins。

## 第 3 轮：消息插件 403 根因收敛

时间：2026-09-04 04:22-04:35（Asia/Shanghai）

### 运行态证据

- 当前 Profile 固定 `@xmanrui/dsh-im@2.3.0`；真实配置仅飞书有 1 个机器人，其余 8 个渠道没有配置文件，全程只记录存在性与数量，未读取或输出配置值。
- 旧版连接 supervisor 在 `controller.initialize()` 读取渠道配置之前先执行 `harness.ensureRunning()`；其 Harness client 通过本机 HTTP 请求 `/api/host.describe`，没有 Desktop renderer 能力头或浏览器会话。
- DesktopWebServer 按既有安全边界返回 403 是正确行为；放宽 WebServer 会削弱本地访问控制，且后续仍会被 Harness BrowserAuth 拒绝，因此不作为修复。

### 升级候选检查

- npm 最新稳定版为 `@xmanrui/dsh-im@4.9.1`，发布于 2026-09-04 03:28（Asia/Shanghai），其 Desktop 路径改为直接复用 Typert Gateway、Session Controller 和 Workspace Controller，不再要求回环 HTTP。
- 当前 Harness 源码提供上述三个服务，静态契约匹配；最新版 README 声明升级保留机器人、凭据、工作区、Agent Preset 和会话绑定。
- npm 发布包不含完整锁文件，随包 `verify-package` 脚本无法独立执行；同时当前桌面插件市场对已安装插件只提供卸载，不提供事务式升级或回滚。
- 结论：根因已定位，但 `2.3.0 -> 4.9.1` 为刚发布的跨大版本升级。先补隔离 Profile 启动与迁移验证，验证通过后再操作真实 Profile，当前不直接覆盖用户机器人环境。

### 部署判断

- 本轮为本机 Profile 兼容性调查，没有服务端代码变更，不触发 Jenkins。

## 第 4 轮：Skill 管理原生辅助功能树诊断

时间：2026-09-04 04:35-04:43（Asia/Shanghai）

### 真实应用复现

- 视觉层完整显示 112 个技能、来源筛选、搜索和行操作，但 macOS 原生 AX 只暴露标题、刷新和关闭。
- Tab 从关闭按钮继续后，DOM 焦点进入“组 (0)”筛选；原生 AX 无对应焦点节点，说明并非键盘陷阱或 `inert` 误用。
- 通过仅绑定回环地址的临时 DevTools 端口读取 DOM：面板及滚动主体均未设置 `inert`/`aria-hidden`，控件可见且 `tabIndex=0`；Chromium AX 共 3180 个节点，筛选、搜索和技能行均为非忽略节点。
- 可逆运行时诊断将技能行从 112 项缩减为 3 项后，macOS 原生 AX 立即暴露筛选、搜索、技能名称、模型/用户开关、禁用与卸载控件。
- 诊断结束后退出调试实例，并恢复无调试端口的正常目录包运行；没有保存任何运行时 DOM 修改。

### 结论与归属

- 根因是 `dsh-skill-panel@1.3.1` 无分页/虚拟化的一次性大树触发 Electron 到 macOS AX 的主体裁剪，而不是本轮桌面模态隔离器造成。
- 推荐插件改为虚拟列表或分批分页，同时保留搜索结果计数和稳定焦点。当前 GitHub 仓库 `nianchen8/dsh-skill-panel` 对登录账号只授予 `READ`，未创建未授权 fork，也未改写 Profile 内已安装包。

## 第 5 轮：折叠详情面板辅助功能隔离

时间：2026-09-04 04:44-05:01（Asia/Shanghai）

### 根因与修复

- 复核确认详情列的视觉宽度已为 0，实际问题是 `DesktopOwnedFrame` 始终挂载详情 `aside`，折叠时没有 `inert` 或 `aria-hidden`，因此隐藏标题、关闭按钮和占位提示仍留在 macOS AX。
- 先在高级/扩展帧静态渲染测试中加入折叠态断言并观察 RED；实现 React 18 兼容的 `inert=""` 与 `aria-hidden` 后转为 GREEN。
- 测试同时覆盖有效会话打开详情时两个隔离属性自动移除，避免修复阻断正常查看。
- `dsh-desktop@bbcd4eb29c` 已推送 `origin/master`；用户未跟踪的品牌渲染脚本保持未改动。

### 自动门禁

- 定向测试：`client-environment.spec.ts` 23/23 PASS；五套 TypeScript 配置检查 PASS。
- Desktop 完整 `check`：123 个测试文件全部通过，1108 项通过、4 项跳过；build、typecheck、runtime closure、CLI、Loader、Profile、licenses、operations 全部通过。

### 实际应用回归

- 第一次目录打包和第一次重试在 Electron 下载阶段遇到 `fetch failed`；第三次沿用仓库 `package-dir.mjs` 契约完整下载 Electron 43.4.0，完成依赖组装、fuses 与未签名目录包生成。
- 新包初始折叠态不再暴露“详情”“关闭详情”和占位提示。
- 打开既有含工具调用的会话，展开 Bash 工具并点击“查看”后，事件详情、概述/参数/结果/Schema/计时标签及内容完整进入 macOS AX。
- 关闭详情后再次读取完整 AX，`事件详情`、`关闭详情` 与占位提示均不存在，双态回归 PASS。

### 部署判断

- 本轮只修改桌面客户端布局与测试，不产生服务端容器或路由变更，因此不触发 Jenkins。
- 本次目录包用于修复回归，不替代北京时间 07:30 后要求执行的 macOS 与 Windows 最终打包验证。

## 第 6 轮：消息插件隔离升级与回滚

时间：2026-09-04 05:04-05:14（Asia/Shanghai）

### 隔离数据与升级路径

- 创建权限为 700 的临时 `DSH_HOME`，通过官方 `dsh plugin --profile desktop add` 先安装 `@xmanrui/dsh-im@2.3.0`，再升级到 `4.9.1`；没有复制真实 `.credentials.yaml`、会话或机器人值。
- 真实飞书配置只读取版本、字段名和数量，用同一 v2/v1 结构创建 `AUDIT-20260904-CFG003` 停用机器人及工作区映射，凭据引用为不可用的合成标记。
- 升级后 `package.json` 固定 4.9.1，`dsh.profile.bundles` 中只有一个 `@xmanrui/dsh-im`；配置组合同时包含 Typert Registry、Loader、Gateway 与新版消息 bundle。
- 机器人配置和工作区映射在升级前后 SHA-256 完全一致，证明包安装本身没有覆写集成数据。

### 实际桌面启动与日志

- 使用同一个已回归目录包、仅替换进程级 `DSH_HOME` 启动隔离实例；完成首次设置跳过流程后进入完整主界面，Host 与 Renderer 启动成功。
- 连续观察 67 秒，跨过旧版两个 30 秒重试周期；进程保持运行，标准错误只有 Node `fs.Stats` 弃用提醒。
- 应用日志中最后一批 `host.describe` 403 属于 05:09:18 前的真实 2.3.0 实例；4.9.1 隔离实例从 05:10:37 起没有新增该错误。
- 合成飞书机器人没有真实凭据，4.9.1 记录一次“激活失败并继续其余渠道”，没有周期性重试。这说明空转问题消失，但不能替代真实机器人连通验收。

### 回滚与生产隔离

- 隔离实例通过应用菜单正常退出，进程退出码为 0；随后用相同官方插件命令降回 2.3.0，依赖和 bundle 仍各一份，两个配置哈希继续保持一致。
- 重新启动正常 `~/.dsh` 实例后，原工作区、历史会话和业务入口均可见。
- 真实 Profile 仍固定 `@xmanrui/dsh-im@2.3.0`，真实机器人配置、凭据和工作区映射未修改。下一步需要在可回滚窗口中完成真实凭据迁移、机器人连接和会话绑定验证，才可把候选升级标为生产完成。

### 部署判断

- 本轮没有仓库实现或服务端变更，不触发 Jenkins；只更新审计证据文档。

## 第 7 轮：消息插件真实 Profile 升级

时间：2026-09-04 05:24-05:31（Asia/Shanghai）

### 升级与恢复准备

- 三个前置任务再次确认均为 `completed`，桌面仓库与 `origin/master` 对齐，用户未跟踪的品牌渲染脚本保持不变。
- 升级前内置 `health-snapshots` 的 3 个槽位均存在且与当前 Profile 声明文件匹配；最新健康快照为 05:14，可恢复 `package.json`、锁文件、Profile patch 与 Harness home 设置。升级后的首次健康启动按轮换契约写入 1 个新快照，当前仍保留 2 个升级前快照。
- 通过官方 `dsh plugin --profile desktop add @xmanrui/dsh-im@4.9.1 --save-exact` 将真实 Profile 从 2.3.0 升级到 4.9.1；依赖物化和供应链策略检查通过。
- 插件安装结束时飞书机器人配置与工作区映射的 SHA-256 均与升级前一致；首次启动随后将旧工作区文档迁移为 v2 访问策略，文件哈希因此改变，但原机器人工作区绑定继续存在。文档只记录哈希变化、版本和对象数量，不记录凭据或机器人标识。

### 真实连接与日志回归

- 目录包冷启动后进入完整主界面，工作区、历史会话和业务入口均保留；本地 WebServer 继续只监听 `127.0.0.1:43120`。
- IM 设置页显示 `DSH-IM v4.9.1`、飞书 1/1 在线；执行“检查连接”后页面确认测试消息已发送，工作区和 Agent Preset 绑定仍可见。
- 从 05:27:27 启动后连续观察超过 2 分钟，进程和监听端口稳定；跨过两个旧版 30 秒重试周期后没有新增 `host.describe` 403 或机器人激活失败。
- 飞书缺少 `application:app_slash_command:read`，插件只记录一次警告并跳过斜杠命令注册；普通消息长连接和测试发送不受影响。该权限只能由飞书应用管理员补充，本轮不扩张凭据或应用权限。

### 部署判断

- 本轮变更为本机 Profile 依赖升级与审计文档，不包含服务端仓库、镜像或路由修改，因此不触发 Jenkins。

## 第 8 轮：聊天工具、停止与重启恢复

时间：2026-09-04 05:44-05:52（Asia/Shanghai）

### 会话隔离与工具执行

- 在 `techwu` 工作区创建 `Yootun Agent Bash Audit Session`，用纯英文自动化输入要求仅执行一次只读 `pwd`；首条中文自动化输入因测试驱动不支持中文字符而未形成有效指令，不计为产品失败。
- 第二轮按约束只调用一次 Bash，返回 `/Users/techwu`；工具 UI 展示完成状态、命令摘要、参数、结果、Schema 和 16 毫秒计时，最终回复为 `AUDIT-20260904-CHAT005-OK`。
- 新建会话后编辑区为空且仍归属 `techwu`；原审计会话保持独立，返回后两轮消息与工具记录均完整。

### 停止与重启恢复

- 新会话请求输出 1 至 2000，点击“停止生成”后在 155 处终止并明确显示“已停止”；同一会话继续发送短请求后成功返回 `AUDIT-20260904-CHAT003-RESUME-OK`。
- 完成态会话正常退出再启动后，标题、两轮对话、一次工具调用、结果及轨迹表全部恢复。
- 第三轮长回复生成中通过 `Cmd+Q` 正常退出；重启后同一会话和第三轮恢复，部分输出保留并标记“已停止”，没有自动续跑或重复工具副作用，输入区可继续使用。
- 三次真实启动均恢复本地 `127.0.0.1:43120` 监听；日志没有 renderer、未处理异常、致命错误或 `host.describe` 403，只有已记录的用户 Skill frontmatter 与飞书斜杠命令权限警告。

### 性能观察与部署判断

- 首个新会话请求输入 78.8K token；只读工具轮经过 2 次 LLM 调用后累计输入 237K token。停止后的短续发缓存命中 99%，但固定上下文成本仍对应 `AUD-005/UX-003`。
- 本轮仅产生本地审计会话和文档，不修改业务数据、服务端代码或容器配置，因此不触发 Jenkins。

## 第 9 轮：聊天错误恢复与看板趋势修复

时间：2026-09-04 06:04-06:15（Asia/Shanghai）

### 聊天错误路径

- 新建 `AUDIT-20260904-CHAT007 Error Test` 会话，要求模型只调用一次 Bash 执行 `exit 7`，且禁止重试和其他工具。
- 工具卡明确显示“失败”、退出码 7 和无输出；实际只有 1 次工具调用，模型返回 `AUDIT-20260904-CHAT007-ERROR-SEEN`。
- 同一会话继续发送无工具请求，成功返回 `AUDIT-20260904-CHAT007-RECOVERED`，证明错误不会卡死后续轮次或重复副作用。

### 企业驾驶舱范围回归与修复

- “昨日”刷新保持数据源 4/4；首次切换近 7 天复现 3/4，GEO 为异常，日志记录 `GeoFlow series failed: now is not defined`。
- 根因是生产返回 `tenant_id` 后进入目标查询分支，但 `loadGeoSeries` 没有接收 `apply()` 已注入的 `now`。既有测试未提供租户字段，因此没有覆盖该分支。
- 先为 series 测试加入 `tenant_id` 和目标月份断言，得到 12 通过/1 失败；传入注入时钟后定向测试 13/13，完整插件 `npm run check` 15/15。
- 修复以 `docker-helm.dofe.ai@b94319b` 推送 `origin/master`。正常退出旧应用后重建 macOS 目录包，构建、依赖组装与 Electron fuses 完成。
- 新包真实回归近 7 天和近 30 天，均显示“数据源可用 4/4”；GEO 无业务数据时显示“暂无数据”，06:13 冷启动后的日志没有新增 `now is not defined`。

### 部署与最终打包判断

- 改动属于桌面内嵌 `file:` 插件 Host 逻辑，不改变服务端容器、路由或数据库，因此不触发 Jenkins。
- 本轮 macOS 目录包用于即时回归；北京时间 07:30 后仍需按计划重新执行并验证 macOS 与 Windows 最终产物。

## 第 10 轮：招聘工作台只读与校验回归

时间：2026-09-04 06:16-06:20（Asia/Shanghai）

### 真实应用回归

- 打开招聘工作台并刷新，页面保持本机招聘状态与 HR 知识可用；总览为 0 个岗位、0 个候选人、0 个待办的诚实空态。
- 岗位页暴露文本/文件导入入口；在输入为空时点击“生成 JD 草稿”，页面给出支持格式与需先输入的提示，没有请求写入本地招聘状态。
- 人才库空态可进入 BOSS 同步页；同步预览明确显示官方适配器未配置、首次全量、岗位 0/人才库 0 及允许字段，没有打开登录页或执行外部同步。
- HR 知识页显示 1 个企业空间、0 文档/0 记忆/0 待确认；未点击“沉淀”写操作，避免产生无法在 UI 删除的测试记录。

### 自动门禁与边界

- 招聘插件 `npm run check`：5/5 PASS，覆盖无凭据时不查询候选人与 mutation 前置拒绝。
- 桌面招聘路由、知识/BOSS 集成和 Agent 工具定向测试：3 个文件、31/31 PASS。
- 本轮仅执行读取、页面内空输入校验和同步范围预览，没有修改业务数据或服务端代码，不触发 Jenkins。

## 第 11 轮：销售、供应链与插件门禁完整性

时间：2026-09-04 06:24-06:29（Asia/Shanghai）

### 真实应用回归

- 销售协同刷新后显示 0 线索、0 合格线索、0 今日待跟进、0 待确认；意向输入为空时“开始检索”保持禁用，没有请求外部工具或写入持久化意向。
- 供应链预警刷新后显示 0 风险信号、0 高危、0 未关闭、0 今日复核，并呈现“暂无风险信号”空态。
- 两个面板打开时主工作区均从 macOS 辅助功能树隔离，关闭后焦点回到对应侧栏入口。

### 门禁缺口与修复

- 销售和供应链各自存在 `route.test.mjs`，但包脚本只运行 `plugin.test.mjs`；继续扫描确认招聘、内容指挥和统一审批有相同缺口。
- 手动补跑路由测试先确认 3/3 通过，覆盖真实意向工具投影、供应链风险/复核动作和缺工具诚实降级。
- `docker-helm.dofe.ai@066ae47` 将五包测试脚本统一为 `node --test`，已推送 `origin/master`。
- 完整结果：统一审批 5/5、内容指挥 4/4、招聘 7/7、销售 5/5、供应链 5/5，总计 26/26 PASS。

### 部署判断

- 本批仅修正测试执行范围，没有修改插件运行时代码、服务端接口或数据库，不触发 Jenkins，也不需要重打桌面包。
