# dsh-yootun-tos-upload

Yootun 通用媒体上传能力插件（纯宿主插件，无客户端半、**零运行时依赖**）：原生文件选择框
选本地图片/视频，流式上传到火山 TOS 对象存储，返回公网固定 URL。上传能力沉底为通用
插件，业务插件（页面 UI 或 agent 会话）在上层消费。

## 能力

- **HTTP 触发通道**（业务插件 UI 按钮，两次同源 fetch）：
  - `POST /_dsh/uploader/pick-file` → 弹原生 `showOpenDialog`（图片/视频扩展名过滤），
    返回 `{ picked, path, name, size, mime }`，选中路径自动进入会话内允许清单。
  - `POST /_dsh/uploader/upload` `{ path }` → 流式上传，返回 `{ key, url, size, contentType, etag? }`。
- **agent 触发通道**：`media_upload` 工具（`ctx.tools.register`）。模型在会话中调用 →
  弹原生对话框由用户亲手选文件 → 上传 → URL 作为工具结果回到对话上下文。
  工具**不接受模型传入的任意路径**（提示注入防线），可选入参只有 `kind: media|image|video`。
- **驱动抽象**（[drivers/types.js](drivers/types.js) 契约）：第一期 [drivers/tos.js](drivers/tos.js)
  （零依赖自实现 SigV4 签名 + `node:http/https` 单次流式 PUT，对齐 tools.dofe.ai 的 boto3
  口径：`s3v4` 签名 + `virtual` addressing + `tos-s3-*` endpoint，覆盖 300–500MB 视频）。
  后期 `drivers/ci-server.js` 实现同一接口，`config.backend` 切换，消费方零改动。
- **签名自实现**：[drivers/tos-signer.js](drivers/tos-signer.js) 用 `node:crypto` 实现 SigV4，
  输出已与 `@smithy/signature-v4`（AWS SDK v3 的签名内核）逐字节对拍验证并固化进测试。

## 安全模型

- upload 只接受本会话 pick-file 返回过的路径（宿主侧允许清单），其余一律 403。
- agent 工具走人机回环，不接模型路径入参；工具结果只回公网 URL 与对象元信息，不回本地路径。
- `lstat` 拒绝符号链接与非普通文件，单文件大小上限（默认 500MB）。
- 上传前 TOCTOU 复查：文件仍存在、仍是普通文件、大小未变、未超限、仍在允许清单；
  选择后被替换/截断返回 `file_changed`，禁止继续上传。
- 对象 key 不含本地路径：文件名安全规范化 + 时间戳 + 随机后缀防覆盖。
- 路由校验 loopback + Origin + `sec-fetch-site: same-origin`（口径同 dofe-access-route.ts）。
- 扩展名过滤双端生效，且宿主侧在选中后强制复查（过滤器不只是 UI 提示）。
- **AK/SK 永不入库、不进安装包**：只存在于部署注入的 credential store / 环境变量 /
  `$DSH_HOME` 密钥文件，前端无任何读写入口。

## 配置（宿主侧，前端不可见）

cordis 条目 `config` 只放非敏感项（见 [cordis.patch.yml](cordis.patch.yml)）：

```yaml
config:
  backend: tos
  tos:
    region: cn-beijing
    bucket: dofe-transcode
    keyPrefix: yootun/uploads
  limits:
    maxBytes: 524288000      # 单文件上限，默认 500MB
  tool:
    timeoutMs: 1800000       # agent 工具超时，默认 30 分钟（大视频整段 await）
```

**凭证解析顺序**（部署注入，客户端装完即用、零手工配置）：

1. credential store —— `ctx.get('credentials').resolve('STORAGE_ACCESS_KEY_ID' /
   'STORAGE_ACCESS_KEY_SECRET')`，与 `MODELS_API_KEY` 同一机制，由部署侧注入；
2. 环境变量 `STORAGE_ACCESS_KEY_ID` / `STORAGE_ACCESS_KEY_SECRET`（CI / dsh web 场景）；
3. `$DSH_HOME/tos-upload.env`（gitignored，`KEY=VALUE` 行格式；`lstat` 防护：
   必须是普通文件、拒绝符号链接、≤64KB，建议 `chmod 600`）。

两个凭证必须同时存在才认为可上传（禁止半组凭证）；日志只记录
`credential-store` / `environment` / `secret-file` 来源名与脱敏标识，绝不打印明文。

配置不完整或非法时插件优雅降级：路由返回 503 `uploader_not_configured`，
工具返回 `{ ok: false, error: 'uploader_not_configured' }`。

返回的固定公网 URL 形式：`https://{bucket}.tos-{region}.volces.com/{key}`
（可用 `cdnDomain` 或 `publicBaseUrl` 覆盖；本部署不加 `cdnDomain`）。

## 错误模型（固定错误码）

工具结果与 HTTP 错误响应只回以下固定码，诊断细节只进日志（见 `lib/errors.js`）：

```text
uploader_not_configured  picker_unavailable   user_cancelled
extension_not_allowed    file_not_found       file_changed
file_too_large           upload_timeout       upload_cancelled
storage_auth_failed      storage_unavailable  upload_failed
```

## 接入 dsh-desktop（三处，在 dsh-desktop 仓库执行）

1. `dsh-plugin-desktop/package.json` 加依赖：
   `"@dofe/dsh-yootun-tos-upload": "file:../../docker-helm.dofe.ai/plugins/dsh-yootun-tos-upload"`
2. `dsh-plugin-desktop/cordis.patch.yml` 显式声明 Loader 行（`id: dofe-yootun-tos-upload`，
   与插件自带 `dsh.bundle.patch` 同一 entry id，避免合并出重复加载项）；插件自带的
   `dsh.bundle` 保留用于独立安装，但不作为 Desktop 预装的唯一入口。部署侧把
   `STORAGE_ACCESS_KEY_ID/SECRET` 注入 credential store（对齐 MODELS_API_KEY 的
   `dofe-managed` 通道），客户端装完即用。
3. 根目录 `scripts/prepare-dofe-ui.mjs` 登记预装插件；`.ci/dsh-yootun-tos-upload/`
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
  （建连 / 响应头 / 整体）；`destroy()` 取消未完成请求（插件卸载路径）。
- 列入实施验收清单：大视频流式上传的内存/网络行为双端分别验证。

## 验证

```bash
cd plugins/dsh-yootun-tos-upload
node --test test/plugin.test.mjs             # 单元：清单/签名/配置/凭证/允许清单/选择器/路由/驱动/装配
node --test test/loader-cordis.test.mjs      # 真实 Cordis Loader：apply(ctx, config)/幂等/回滚
node --test test/desktop-profile.test.mjs    # Desktop profile 组合 + 闭包/凭证扫描
npm test                                     # 三者一起跑
```

## v2 候选

- 大视频进度反馈：任务 ID + 状态轮询路由（v1 先 await 整个上传）。
- `drivers/ci-server.js`：CI 文件服务器后端，同一 UploaderDriver 契约。
- agent 自主传文件白名单目录（如 `$DSH_HOME/uploads/`），仅在确有场景时单独开放。
