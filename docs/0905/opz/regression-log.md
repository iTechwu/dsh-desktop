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
