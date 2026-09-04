import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createYootunWebsitePublisher } from '../src/yootun-website-publisher.ts'

describe('Yootun website publisher', () => {
  it('writes reviewed GeoFlow content as Markdown and pushes only that media file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-site-'))
    await mkdir(join(root, 'media'))
    await writeFile(join(root, 'package.json'), '{"name":"yootun-home"}\n')
    const runGit = vi.fn(async (args: string[]) => args[0] === 'status' ? '?? media/ai-guide.md\n' : '')
    const publish = createYootunWebsitePublisher({ repositoryPath: root, runGit })
    const url = await publish({
      id: 'article:42', articleId: 42, title: '企业 AI 助手选型指南', slug: 'AI Guide', status: 'draft',
      reviewStatus: 'approved', summary: '不保存账号密码。', content: '# 正文\n\n发布内容。', contentFormat: 'markdown',
      source: 'geoflow', generatedAt: '2026-09-01T02:00:00.000Z', selectedPlatforms: ['website'], platformStatus: {}, reviewedAt: '2026-09-01T03:00:00.000Z',
    })
    expect(url).toBe('https://yootun.ixicai.cn/media/ai-guide/')
    expect(await readFile(join(root, 'media', 'ai-guide.md'), 'utf8')).toContain('sourceArticleId: 42\n')
    expect(runGit.mock.calls.map(call => call[0])).toEqual([
      ['status', '--porcelain', '--', 'media/ai-guide.md'],
      ['add', '--', 'media/ai-guide.md'],
      ['commit', '-m', 'content: 发布《企业 AI 助手选型指南》', '--', 'media/ai-guide.md'],
      ['push', 'origin', 'HEAD:main'],
    ])
  })

  it('uses an article-id slug when GeoFlow does not provide an ASCII slug', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yootun-site-'))
    await writeFile(join(root, 'package.json'), '{"name":"yootun-home"}\n')
    const runGit = vi.fn(async (args: string[]) => args[0] === 'status' ? '' : '')
    const publish = createYootunWebsitePublisher({ repositoryPath: root, runGit })
    await publish({ id: 'article:7', articleId: 7, title: '中文标题', slug: '中文', status: 'draft', reviewStatus: 'approved', summary: '', content: '正文', contentFormat: 'markdown', source: 'geoflow', selectedPlatforms: [], platformStatus: {}, reviewedAt: null })
    expect(await readFile(join(root, 'media', 'geoflow-7.md'), 'utf8')).toContain('slug: "geoflow-7"')
    expect(runGit).toHaveBeenLastCalledWith(['push', 'origin', 'HEAD:main'], root)
  })
})
