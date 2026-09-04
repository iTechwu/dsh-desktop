# dsh-yootun-tos-upload

Yootun 通用媒体上传能力插件（纯宿主插件，无客户端半、**零运行时依赖**）：原生文件选择框
选本地图片/视频，把文件**预签名 PUT 直传**到对象存储，返回公网固定 URL。上传能力沉底为通用
插件，业务插件（页面 UI 或 agent 会话）在上层消费。

本插件**不持有任何对象存储凭证或拓扑**（无 AK/SK、无 bucket/region/endpoint/keyPrefix）：
每次上传的 PUT 预签名 URL、请求头与公网 URL 都由 Tools 服务的 `tos_upload_authorize`
授权工具下发，凭证与内部拓扑永不出服务端。

## 能力

- **HTTP 触发通道**（业务插件 UI 按钮，两次同源 fetch）：
  - `POST /_dsh/uploader/pick-file` → 弹原生 `showOpenDialog`（图片/视频扩展名过滤），
    返回 `{ picked, path, name, size, mime }`，选中路径自动进入会话内允许清单。
  - `POST /_dsh/uploader/upload` `{ path }` → 授权 + 流式直传，返回 `{ url, size, contentType, name }`。
- **agent 触发通道**：`media_upload` 工具（`ctx.tools.register`）。模型在会话中调用 →
  弹原生对话框由用户亲手选文件 → 授权 + 上传 → 公网 URL 作为工具结果回到对话上下文。
  工具**不接受模型传入的任意路径**（提示注入防线），可选入参只有 `kind: media|image|video`。
- **上传授权**（[authorize.js](authorize.js)）：把 `{ filename, contentType, size }` 交给
  Tools 服务的 `tos_upload_authorize` 工具（`mcp__tools-tos-upload__tos_upload_authorize`），
  换取 PUT 预签名直传授权；授权响应逐字段校验后才直传。
- **预签名 PUT 驱动**（[drivers/tos.js](drivers/tos.js) 契约见 [drivers/types.js](drivers/types.js)）：
  零依赖 `node:http/https` 单次流式 PUT，仅接收 `{ url, method, headers }`，覆盖 300–500MB 视频。

## 上传链路

```text
选文件(picker) -> 允许清单 + lstat -> TOCTOU 复查 -> tos_upload_authorize 授权
               -> 校验授权响应 -> 预签名 PUT 直传 -> 返回 publicUrl
```

授权调用只发三个文件元数据字段，**绝不发送** bucket/region/endpoint/AK/SK/tenantId/userId/
MODELS_API_KEY。授权响应必须满足（任一不满足 → `upload_authorization_invalid`）：

- `method === "PUT"`；
- `url` 为 HTTPS，且不指向 loopback / 私网 / 链路本地 / CGNAT / CI 地址；
- `expiresAt` 未过期；
- 本地文件大小 ≤ `maxBytes`；
- `headers["Content-Type"]` 与本地 MIME 一致。

## 安全模型

- upload 只接受本会话 pick-file 返回过的路径（宿主侧允许清单），其余一律 403。
- agent 工具走人机回环，不接模型路径入参；工具结果只回公网 URL 与对象元信息，
  不回预签名 URL、object key、uploadId、本地路径、Models key 或 AK/SK。
- `lstat` 拒绝符号链接与非普通文件，单文件大小上限（默认 500MB）。
- 上传前 TOCTOU 复查：文件仍存在、仍是普通文件、大小未变、未超限、仍在允许清单；
  选择后被替换/截断返回 `file_changed`，禁止继续上传。
- 路由校验 loopback + Origin + `sec-fetch-site: same-origin`（口径同 dofe-access-route.ts）。
- 扩展名过滤双端生效，且宿主侧在选中后强制复查（过滤器不只是 UI 提示）。
- **MIME 过滤与服务端授权 allowlist 严格对齐**（只允许 mp4/mov/jpg/jpeg/png/webp），
  避免用户选中一个授权阶段必然被拒的类型。

## 配置（宿主侧，前端不可见）

cordis 条目 `config` 只放非敏感项（见 [cordis.patch.yml](cordis.patch.yml)）：

```yaml
config:
  limits:
    maxBytes: 524288000      # 单文件上限，默认 500MB
  tool:
    timeoutMs: 1800000       # agent 工具超时，默认 30 分钟（大视频整段 await）
```

配置非法时插件优雅降级：路由返回 503 `uploader_not_configured`，
工具返回 `{ ok: false, error: 'uploader_not_configured' }`。

授权能力在**运行时**由 Tools MCP 工具提供，不依赖本地凭证；若授权工具未注册
（例如桌面端 DoFe Tools 未启用、或 Models key 未配置），上传返回
`uploader_not_configured` / 授权失败按服务端稳定码映射。

## 错误模型（固定错误码）

工具结果与 HTTP 错误响应只回以下固定码，诊断细节只进日志（见 `lib/errors.js`）：

```text
uploader_not_configured  picker_unavailable   user_cancelled
extension_not_allowed    file_not_found       file_changed
file_too_large           upload_timeout       upload_cancelled
upload_authorization_invalid
storage_auth_failed      storage_unavailable  upload_failed
```

服务端授权错误码映射：`UPLOAD_SIZE_EXCEEDED`→`file_too_large`、
`UPLOAD_TYPE_NOT_ALLOWED`→`extension_not_allowed`、`UNAUTHORIZED`/`STORAGE_AUTH_FAILED`→
`storage_auth_failed`、`STORAGE_UNAVAILABLE`→`storage_unavailable`。

## 接入 dsh-desktop

1. `dsh-plugin-desktop/package.json` 加依赖：
   `"@dofe/dsh-yootun-tos-upload": "file:../../docker-helm.dofe.ai/plugins/dsh-yootun-tos-upload"`
2. `dsh-plugin-desktop/cordis.patch.yml` 显式声明 Loader 行（`id: dofe-yootun-tos-upload`，
   与插件自带 `dsh.bundle.patch` 同一 entry id，避免合并出重复加载项）；插件自带的
   `dsh.bundle` 保留用于独立安装，但不作为 Desktop 预装的唯一入口。
3. **MCP 授权客户端由 `dofe-managed.ts` 现有凭证链路注册**：把 `'tos-upload'` 加入其
   tools 路由数组，即得到 `serverName: tools-tos-upload`、URL `https://ixicai.cn/mcp/tools/tos-upload`、
   Authorization 从 credential store 的 `MODELS_API_KEY` 注入，凭证变更时自动重建。
   不要在插件内单独读取/保存 Models key。
4. 根目录 `scripts/prepare-dofe-ui.mjs` 登记预装插件；`.ci/dsh-yootun-tos-upload/`
   快照由 `scripts/sync-dofe-plugin-snapshot.mjs` 生成，构建前校验源码与快照一致。
   `package.spec.ts` 对 `lib/client.js` 的断言由本插件的空壳客户端半
   （[lib/client.js](lib/client.js)）满足，不动桌面仓库测试。

## 双端兼容（Windows / macOS）

- `dialog.showOpenDialog` 是 Electron 跨平台 API，路由注册不加平台门限；
  `dontAddToRecent` 为 Windows 专属选项，mac 上写了无害。
- 非 Electron 宿主（如 `dsh web` profile）下选择器不可用：
  路由 503 `picker_unavailable`，工具返回 `{ ok: false, error: 'picker_unavailable' }`。
- **零依赖**：插件只用 `node:*` 内置模块，无打包运行时闭包问题，分发链路与现有
  零依赖插件完全一致。
- 流式上传：不整块读内存；请求结束/失败/取消都会关闭文件流与 HTTP 请求；分层超时
  （建连 / 响应头 / 整体）；`destroy()` 取消未完成请求（插件卸载路径）；403/签名过期
  不无限重试。
- 列入实施验收清单：大视频流式上传的内存/网络行为双端分别验证。

## 验证

```bash
cd plugins/dsh-yootun-tos-upload
node --test test/plugin.test.mjs             # 单元：配置/mime/授权/校验/清单/选择器/路由/驱动/装配
node --test test/loader-cordis.test.mjs      # 真实 Cordis Loader：apply(ctx, config)/幂等/回滚
node --test test/desktop-profile.test.mjs    # Desktop profile 组合 + 闭包/凭证扫描
npm test                                     # 三者一起跑
```

## v2 候选

- 大视频进度反馈：任务 ID + 状态轮询路由（v1 先 await 整个上传）。
- agent 自主传文件白名单目录（如 `$DSH_HOME/uploads/`），仅在确有场景时单独开放。
