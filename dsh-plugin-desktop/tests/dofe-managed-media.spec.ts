/**
 * Media 生成 managed 插件契约（specs/2026-09-04-models-media-mcp-design.md「插件测试」）：
 * - managed registry 始终生成公共固定 URL，且只从 credential store 取 Key。
 * - media 路由在目录中可被用户启用/停用，URL/Header/模型名不可配置。
 * - create 超时按普通 API 请求设置；轮询是显式工具调用，不持有长连接。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOFE_MCP_BASE_URL, MODELS_API_KEY } from '../src/dofe-managed.ts'
import { DEFAULT_DOFE_PLUGIN_IDS, DOFE_PLUGIN_CATALOG } from '../src/dofe-plugins.ts'

const managedSource = readFileSync(new URL('../src/dofe-managed.ts', import.meta.url), 'utf8')

describe('dofe-managed media route', () => {
  it('registers the fixed public media route with a normal API timeout', () => {
    expect(managedSource).toMatch(
      /\{ plugin: 'media', serverName: 'media', path: 'media', timeoutMs: 60_000 \}/,
    )
  })

  it('keeps the managed base URL on the public gateway and credential-only auth', () => {
    expect(DOFE_MCP_BASE_URL).toBe('https://ixicai.cn/mcp')
    expect(MODELS_API_KEY).toBe('MODELS_API_KEY')
    // 客户端固定公共地址：不允许出现 CI 地址、容器名或自定义端点覆盖。
    expect(managedSource).not.toMatch(/172\.30\.30\.11|127\.0\.0\.1|localhost|mcp\.exa\.ai/)
    expect(managedSource).not.toMatch(/MEDIA_MCP_URL|MEDIA_BASE_URL/)
    expect(managedSource).not.toMatch(/model:\s*['"]seed/)
  })

  it('exposes media in the built-in plugin catalog and defaults', () => {
    const entry = DOFE_PLUGIN_CATALOG.find(plugin => plugin.id === 'media')
    expect(entry?.name).toBe('Media 生成')
    expect(DEFAULT_DOFE_PLUGIN_IDS).toContain('media')
  })
})
