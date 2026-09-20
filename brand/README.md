# 品牌配置(白标换牌指南)

`brand/brand.config.json` 是默认的 Yootun 品牌源；`brand/sensteed/brand.config.json` 是山子高科品牌源。构建默认使用 Yootun，也可以用 `BRAND=sensteed` 选择山子高科。`BRAND_CONFIG=<path>` 仍可用于自定义白标配置。

## 换牌流程

1. 替换素材(放入 `brand/assets/`):
   - `app-icon-source.jpg` — 应用图标唯一源头(正方形 JPEG,≥1024px)
   - `sidebar-mark.png` — 侧栏 lockup 的方形图标部分(≥ lockup 高度)
   - `wordmark.png` — 预渲染透明文字标(宽度 = lockup 宽 − lockup 高)
   - `hero-mark.png` — 会话头像(正方形,`artwork.heroSize`,默认 204px)
2. 编辑 `brand.config.json`:双通道身份、显示名、更新服务、文档站点、快捷方式名等。
3. 重新生成并入库存档:

```bash
corepack pnpm --filter dsh-plugin-desktop generate:brand   # 图像 + 身份模块 + electron-builder.json
BRAND=sensteed corepack pnpm --filter dsh-plugin-desktop generate:brand # 生成山子高科品牌
corepack pnpm brand:docs                                   # 文档围栏区域 + i18n hash 重录
corepack pnpm check                                        # 全量门禁(含 verify:brand / brand:check)
```

打包时同样通过环境变量选择品牌：`BRAND=yootun corepack pnpm --filter dsh-plugin-desktop package:dir`（默认）或 `BRAND=sensteed corepack pnpm --filter dsh-plugin-desktop package:dir`。每次切换品牌都应从干净构建开始，避免上一品牌的生成物混入包内。

山子高科配置采用其官网公开的品牌信息：使命为“成就中国智造的全球竞争力”。Logo 素材来自山子高科官网的 Logo 资源（`https://www.sensteed.com/templates/default/static/images/logo.png`），仅用于本项目的品牌展示构建。山子构建当前保留公共的插件市场、企业知识、模型与预算及视频生产能力；优惠豚企业看板、招聘、销售、供应链、线索和运营页面不会装载，待山子专属页面完成后再进入组合。

## 字段说明

| 字段 | 用途 | 注意 |
| --- | --- | --- |
| `activeChannel` | 生成的身份模块暴露哪个通道(`stable`/`beta`) | 必须是 `channels` 的键 |
| `channels.*.productName` | 安装包名、`.app` 名、exe 名、托盘标签 | 变更后需重跑 `generate:brand` |
| `channels.*.appId` | macOS bundle id / Windows AppUserModelID | 反向 DNS 格式 |
| `channels.*.artifactPrefix` | Setup/Portable/DMG 文件名前缀 | 文件名安全字符 |
| `packageName` | **勿改**:工作区名、用户数据目录键、profile 准入令牌 | 改它属于数据迁移,不是换牌 |
| `displayName.titlebar` | 标题栏产品名(与通道无关) | |
| `artwork.*` | 图标源、白阈值、画布尺寸 | 生成脚本读取 |
| `wordmark.image` | 预渲染文字标(热路径,跨平台) | 推荐始终提供 |
| `wordmark.text` + `color` + `fontFile` | 文字标一次性再生成 | 需要 macOS/对应字体环境 |
| `updates.*` | 更新服务端点与 `X-*` 请求头 | 必须与服务端约定一致 |
| `docs.*` | README/PRIVACY/赞助位等站点字符串 | 围栏区域自动渲染 |
| `nsis.shortcutName` | Windows 开始菜单/桌面快捷方式名 | |

## 生成物(提交入库,勿手改)

- `dsh-plugin-desktop/src/generated-product-identity.ts` — 运行时身份/更新契约
- `dsh-plugin-desktop/electron-builder.json` — 打包配置(静态模板 + 品牌字段)
- `dsh-plugin-desktop/src/client/generated-brand-assets.ts` — 渲染层 base64 图
- `dsh-plugin-desktop/build/*.{png,ico}` — 各平台图标与托盘图
- README/PRIVACY 的 `<!-- brand:... -->` 围栏区域

一致性由 `verify:brand`(plugin)与 `brand:check`(root)在 `pnpm check` / `check:layout` 中强制;改了配置忘记重新生成会直接构建失败。

## 发版

```bash
corepack pnpm brand:version 2.0.10-beta.3
```

一条命令完成:双 package.json 版本号 + 文档中的产物路径围栏 + 双语 hash 重录。
