# MiniMax Token Plan MCP 参考

[English](README.md) | 中文

这个**默认关闭的参考配置**通过 `@deepseek-ai/dsh-mcp-client` 将 MiniMax 的 [Token Plan MCP](https://platform.minimaxi.com/docs/guides/token-plan-mcp-guide) 接入 DSH Desktop。它暴露两个 Token Plan 工具：`web_search` 和 `understand_image`。

该第三方配置仅作为互操作示例提供。包含它不代表 DeepSeek 背书、推荐、合作或持续支持。

## DSH Desktop 做什么

DSH Desktop 解析选中的 overlay，启动 stdio 命令（`uvx minimax-coding-plan-mcp -y`），发现 MCP 工具，并将其暴露为 `mcp__minimax__web_search` 和 `mcp__minimax__understand_image`。DSH Desktop 不会下载服务器或创建 MiniMax 账号。对于 stdio，通用 `@deepseek-ai/dsh-mcp-client` 客户端随 DSH 插件生命周期启动并停止子进程。

没有也不需要专门的 MiniMax 插件：这一条通用配置就是全部集成。第三方 MCP 服务器都通过 `@deepseek-ai/dsh-mcp-client` 接入，而不是各自写一个 provider 插件。

## understand_image 不需要视觉模型

`understand_image` 接收 `prompt` 和 `image_url`（HTTP/HTTPS URL 或本地文件路径），并把分析结果以**文本**返回。理解在 MiniMax 侧完成，调用的 DSH 模型只是转述结果。不要把图片 attach 给 DSH 模型：把图片 attach 或读取进对话会走 DSH 的模型图片通道，要求 DSH 模型声明 image 输入。应把图片的路径或 URL 传给 `understand_image`，然后转述其文本结果。

## 前置条件

- 订阅 MiniMax Token Plan，并从「订阅管理 > Token Plan」复制订阅 Key。
- 安装 `uv`（[快速开始](https://docs.astral.sh/uv/getting-started/installation/)）。
- 预热一次包，使配置项在首次启动时无需下载：运行 `uv tool install minimax-coding-plan-mcp`，或 `uvx minimax-coding-plan-mcp -y --help`。
- 以 `MINIMAX_API_KEY` 提供 Key，并以 `MINIMAX_API_HOST`（`https://api.minimaxi.com`）提供主机。

## 启用

把 overlay 的单个 `insert` 行合并到 `$DSH_HOME/profiles/<name>/cordis.patch.yml`（单个 profile），或 `$DSH_HOME/cordis.patch.yml`（本机所有 profile）。不要覆盖已有文件：其中可能已包含无关的用户 patch。

该行引用了 `@deepseek-ai/dsh-mcp-client`。在选择该 overlay 前，请确保该包能从 profile 解析；缺失引用会在启动时表现为插件加载错误。

overlay 从环境读取 `MINIMAX_API_KEY`，因此不会把密钥写入文件。从 Finder 或 LaunchServices 启动的桌面应用可能不会继承你的 shell 导出；如果密钥没有传入，请在该行的 `config.env` 中直接设置 `MINIMAX_API_KEY`（你的 profile patch 是本地用户配置，不会提交）。

## 可用工具

| 工具 | 描述 |
|:--|:--|
| `web_search` | 按查询词进行网络搜索，返回结果和相关搜索建议 |
| `understand_image` | 给定提示词，对来自 URL 或本地路径的图片进行理解与分析 |

`web_search` 接收 `query`。`understand_image` 接收 `prompt` 和 `image_url`，支持 JPEG、PNG、GIF 和 WebP，最大 20MB。

模型看到的工具名为 `mcp__minimax__web_search` 和 `mcp__minimax__understand_image`。

## 接入另一个 MCP 服务器

复制相同的配置字段，并使用唯一的 `id` 和 `serverName`。对于远程服务器，请改用 `transport: streamable-http`、`url` 和 `headers`。提供方的安装、身份、认证、模型、持久化与许可仍由提供方负责。
