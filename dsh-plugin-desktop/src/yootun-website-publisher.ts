import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { ContentArticle } from './yootun-content-command-route.ts'

const WEBSITE_ORIGIN = 'https://yootun.ixicai.cn'
const GIT_TIMEOUT = 60_000

export interface WebsitePublisherOptions {
  repositoryPath?: string | undefined
  runGit?: ((args: string[], cwd: string) => Promise<string>) | undefined
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\r\n?/gu, '\n'))
}

function markdown(article: ContentArticle, slug: string): string {
  const publishedAt = article.generatedAt ?? new Date().toISOString()
  return [
    '---',
    `title: ${yamlString(article.title)}`,
    `slug: ${yamlString(slug)}`,
    `date: ${yamlString(publishedAt)}`,
    `excerpt: ${yamlString(article.summary)}`,
    'source: "geoflow"',
    `sourceArticleId: ${article.articleId}`,
    'published: true',
    '---',
    '',
    article.content.trim(),
    '',
  ].join('\n')
}

function defaultGit(args: string[], cwd: string): Promise<string> {
  return new Promise((accept, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT, windowsHide: true, maxBuffer: 1024 * 1024 }, (cause, stdout) => {
      if (cause) reject(cause)
      else accept(stdout)
    })
  })
}

async function assertRepository(root: string): Promise<void> {
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('yootun_website_repository_symlink_forbidden')
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: unknown }
  if (packageJson.name !== 'yootun-home') throw new Error('yootun_website_repository_invalid')
}

export function createYootunWebsitePublisher(options: WebsitePublisherOptions = {}) {
  const root = resolve(options.repositoryPath ?? process.env.YOOTUN_WEBSITE_REPOSITORY ?? join(process.cwd(), '..', 'yootun.ixicai.cn'))
  const runGit = options.runGit ?? defaultGit

  return async (article: ContentArticle): Promise<string> => {
    await assertRepository(root)
    const slug = slugify(article.slug ?? '') || `geoflow-${article.articleId}`
    const mediaDir = join(root, 'media')
    await mkdir(mediaDir, { recursive: true })
    const mediaInfo = await lstat(mediaDir)
    if (!mediaInfo.isDirectory() || mediaInfo.isSymbolicLink()) throw new Error('yootun_website_media_directory_invalid')
    const target = join(mediaDir, `${slug}.md`)
    const targetRelative = relative(root, target)
    if (targetRelative.startsWith('..') || basename(target) !== `${slug}.md`) throw new Error('yootun_website_article_path_invalid')

    await writeFileAtomic(target, markdown(article, slug), { mode: 0o644, dirMode: 0o755 })
    const status = await runGit(['status', '--porcelain', '--', targetRelative], root)
    if (status.trim()) {
      await runGit(['add', '--', targetRelative], root)
      await runGit(['commit', '-m', `content: 发布《${article.title.slice(0, 48)}》`, '--', targetRelative], root)
    }
    await runGit(['push', 'origin', 'HEAD:main'], root)
    return `${WEBSITE_ORIGIN}/media/${encodeURIComponent(slug)}/`
  }
}
