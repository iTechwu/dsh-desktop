# MiniMax Token Plan MCP reference

English | [中文](README.zh.md)

This **default-off reference configuration** connects MiniMax's [Token Plan MCP](https://platform.minimaxi.com/docs/guides/token-plan-mcp-guide) to DSH Desktop through `@deepseek-ai/dsh-mcp-client`. It exposes the two Token-Plan tools `web_search` and `understand_image`.

This third-party configuration is provided as an interoperability example only. Its inclusion does not imply endorsement, recommendation, partnership, or ongoing support by DeepSeek.

## What DSH Desktop does

DSH Desktop parses the selected overlay, starts the stdio command (`uvx minimax-coding-plan-mcp -y`), discovers the MCP tools, and exposes them as `mcp__minimax__web_search` and `mcp__minimax__understand_image`. DSH Desktop does not download the server or create a MiniMax account. For stdio, the generic `@deepseek-ai/dsh-mcp-client` client launches and stops the child with the DSH plugin lifecycle.

There is no dedicated MiniMax plugin, and none is needed: this generic row is the whole integration. Third-party MCP servers connect through `@deepseek-ai/dsh-mcp-client` rather than a per-provider plugin.

## understand_image does not need a vision model

`understand_image` takes `prompt` and `image_url` (an HTTP/HTTPS URL or a local file path) and returns the analysis as **text**. MiniMax performs the understanding; the calling DSH model only relays the result. Do not attach the image to the DSH model: attaching or reading an image into the conversation uses DSH's model-image route, which requires the DSH model to declare image input. Instead pass the image's path or URL to `understand_image` and relay its text result.

## Prerequisites

- Subscribe to a MiniMax Token Plan and copy the subscription key from 订阅管理 > Token Plan.
- Install `uv` ([getting started](https://docs.astral.sh/uv/getting-started/installation/)).
- Warm the package once so the row does not download on first launch: run `uv tool install minimax-coding-plan-mcp`, or `uvx minimax-coding-plan-mcp -y --help`.
- Provide the key as `MINIMAX_API_KEY` and the mainland host as `MINIMAX_API_HOST` (`https://api.minimaxi.com`).

## Enable one

Merge the overlay's single `insert` row into `$DSH_HOME/profiles/<name>/cordis.patch.yml` for one profile, or `$DSH_HOME/cordis.patch.yml` for every profile on the machine. Do not copy over an existing file: it may already contain unrelated user patches.

The row references `@deepseek-ai/dsh-mcp-client`. Make sure that package resolves from the profile before the overlay is selected; a missing reference surfaces as a plugin load error at boot.

The overlay reads `MINIMAX_API_KEY` from the environment so no secret is written into the file. A desktop app launched from Finder or LaunchServices may not inherit your shell exports; if the key does not arrive, set `MINIMAX_API_KEY` directly in the row's `config.env` (your profile patch is user-local and is not committed).

## Available tools

| Tool | Description |
|:--|:--|
| `web_search` | Search the web by a query and return results and related suggestions |
| `understand_image` | Understand and analyze an image from a URL or local path, given a prompt |

`web_search` takes `query`. `understand_image` takes `prompt` and `image_url`, and accepts JPEG, PNG, GIF, and WebP up to 20 MB.

The model sees `mcp__minimax__web_search` and `mcp__minimax__understand_image`.

## Bring another MCP server

Copy the same entry fields and use a unique `id` and `serverName`. For a remote server use `transport: streamable-http`, `url`, and `headers` instead. Provider installation, identity, authentication, models, persistence, and licensing remain the provider's responsibility.
