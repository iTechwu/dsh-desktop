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
