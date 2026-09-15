/**
 * Render brand-driven fenced regions inside the hand-written documentation.
 *
 * Each region is delimited by HTML comments:
 *
 *   <!-- brand:download-table:start -->
 *   ...generated content...
 *   <!-- brand:download-table:end -->
 *
 * Hand-written prose stays outside the fences. Every bilingual pair is
 * rendered in one run and its `*.i18n.yaml` record is re-recorded with the
 * exact `git hash-object --path=` hashing that scripts/bilingual-docs.mjs
 * verifies, so the CI gate stays green without manual hash bookkeeping.
 *
 * Usage: node scripts/generate-brand-docs.mjs [--check]
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { loadBrandConfig } from './brand-config.mjs'

const repositoryRoot = process.cwd()

/** Fenced document regions, keyed by brand block name. */
const DOCUMENTS = [
  {
    record: 'README.i18n.yaml',
    files: [
      { path: 'README.md', lang: 'zh' },
      { path: 'README.en.md', lang: 'en' },
    ],
    blocks: ['brand-title', 'download-cta', 'download-table'],
  },
  {
    record: 'PRIVACY.i18n.yaml',
    files: [
      { path: 'PRIVACY.zh.md', lang: 'zh' },
      { path: 'PRIVACY.md', lang: 'en' },
    ],
    blocks: ['privacy-maintainer'],
  },
  {
    record: 'dsh-plugin-desktop/README.i18n.yaml',
    files: [
      { path: 'dsh-plugin-desktop/README.zh.md', lang: 'zh' },
      { path: 'dsh-plugin-desktop/README.md', lang: 'en' },
    ],
    blocks: ['plugin-identity', 'plugin-update-endpoint', 'plugin-artifact-setup', 'plugin-artifact-portable'],
  },
]

function packageVersion() {
  const manifest = JSON.parse(readFileSync('dsh-plugin-desktop/package.json', 'utf8'))
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('generate-brand-docs: dsh-plugin-desktop/package.json has no version')
  }
  return manifest.version
}

/** Brand renderers. Each returns the generated region body for one language. */
const BLOCKS = {
  'brand-title': ({ config, lang }) => config.docs.communityName[lang],
  'download-cta': ({ config, lang }) => lang === 'zh'
    ? `<h3 align="center"><a href="${config.docs.siteUrl}">一键下载，开箱即用。</a></h3>`
    : `<h3 align="center"><a href="${config.docs.siteUrl}">One-click download, ready to use out of the box.</a></h3>`,
  'download-table': ({ config, lang }) => {
    const community = config.docs.communityName[lang]
    if (lang === 'zh') {
      return [
        '| 平台 | 下载 | 安装方式 |',
        '| --- | --- | --- |',
        `| Windows x64 | [下载安装程序](${config.docs.downloadBase}/windows) | 运行 NSIS 安装程序并按提示完成安装 |`,
        `| macOS Universal | [下载 DMG](${config.docs.downloadBase}/mac) | 打开 DMG，将 ${community} 拖入 Applications |`,
      ].join('\n')
    }
    return [
      '| Platform | Download | Installation |',
      '| --- | --- | --- |',
      `| Windows x64 | [Download installer](${config.docs.downloadBase}/windows) | Run the NSIS installer and follow its prompts |`,
      `| macOS Universal | [Download DMG](${config.docs.downloadBase}/mac) | Open the DMG and drag ${community} into Applications |`,
    ].join('\n')
  },
  'privacy-maintainer': ({ config, lang }) => lang === 'zh'
    ? `**${config.docs.maintainer.zh}**`
    : `**${config.docs.maintainer.en}**`,
  'plugin-identity': ({ config, lang }) => {
    const name = config.channels[config.activeChannel].productName
    return lang === 'zh'
      ? `安装后的应用名称为 **${name}**。`
      : `The installed application is named **${name}**.`
  },
  'plugin-update-endpoint': ({ config, lang }) => {
    const channel = config.activeChannel
    return lang === 'zh'
      ? `打包后的 macOS 与 Windows 应用会在启动 60 秒后查询 \`${config.updates.endpoint}\`，并在每次检查完成六小时后再次查询。每次 no-cache 请求的期限为 15 秒，会携带 \`${config.updates.channelHeader}: ${channel}\` 和 ${config.updates.versionHeader} 请求头中的当前安装版本，并与托盘中的 **Check for Updates…** 命令共用一个 in-flight operation。`
      : `Packaged macOS and Windows applications query \`${config.updates.endpoint}\` 60 seconds after startup and every six hours after a completed check. Each no-cache request has a 15-second deadline, sends \`${config.updates.channelHeader}: ${channel}\` together with the installed version in the \`${config.updates.versionHeader}\` header, and shares one in-flight operation with the **Check for Updates…** tray command.`
  },
  'plugin-artifact-setup': ({ config, version, lang }) => {
    const prefix = config.channels[config.activeChannel].artifactPrefix
    const name = config.channels[config.activeChannel].productName
    return lang === 'zh'
      ? `Beta 版本 \`${version}\` 会输出到 \`dsh-plugin-desktop\\dist\\${prefix}-${version}-x64-Setup.exe\`；用于 smoke 测试的未封装程序位于 \`dsh-plugin-desktop\\dist\\win-unpacked\\${name}.exe\`。`
      : `Beta version \`${version}\` is written to \`dsh-plugin-desktop\\dist\\${prefix}-${version}-x64-Setup.exe\`; the unpacked application is \`dsh-plugin-desktop\\dist\\win-unpacked\\${name}.exe\` for smoke testing.`
  },
  'plugin-artifact-portable': ({ config, version, lang }) => {
    const prefix = config.channels[config.activeChannel].artifactPrefix
    const name = config.channels[config.activeChannel].productName
    return lang === 'zh'
      ? `产物为 \`dsh-plugin-desktop\\dist\\${prefix}-${version}-x64-Portable.zip\`。用户解压到任意可写目录后运行其中的 \`${name}.exe\`，不需要安装器、管理员权限、开始菜单注册或卸载步骤。`
      : `The output is \`dsh-plugin-desktop\\dist\\${prefix}-${version}-x64-Portable.zip\`. Extract it to any writable directory and launch \`${name}.exe\` without an installer, administrator access, Start Menu registration, or uninstall step.`
  },
}

function renderRegion(blockName, config, version, lang) {
  const render = BLOCKS[blockName]
  if (render === undefined) throw new Error(`generate-brand-docs: unknown block ${blockName}`)
  return render({ config, version, lang })
}

function recordHash(relativePath) {
  return execFileSync('git', ['hash-object', `--path=${relativePath}`, '--', relativePath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim()
}

/**
 * Render every fenced region and return the resulting document contents.
 * @param {object} options
 * @param {boolean} [options.write=false] write results to disk (and refresh
 * the bilingual hash records) instead of only computing them.
 */
export function renderBrandDocs({ write = false, environment = process.env } = {}) {
  const config = loadBrandConfig(environment, repositoryRoot)
  const version = packageVersion()
  const rendered = new Map()
  const stale = []

  for (const document of DOCUMENTS) {
    for (const { path, lang } of document.files) {
      let updated = rendered.get(path) ?? readFileSync(path, 'utf8')
      for (const block of document.blocks) {
        const pattern = new RegExp(
          `(<!-- brand:${block}:start -->\\n)[\\s\\S]*?(<!-- brand:${block}:end -->)`,
        )
        if (!pattern.test(updated)) {
          stale.push(`${path}: missing fenced region brand:${block}`)
          continue
        }
        updated = updated.replace(pattern, `$1${renderRegion(block, config, version, lang)}$2`)
      }
      rendered.set(path, updated)
    }
  }

  if (stale.length > 0) {
    throw new Error(`generate-brand-docs: missing fenced regions (insert them once by hand):\n- ${stale.join('\n- ')}`)
  }

  const records = new Map()
  if (write) {
    for (const [path, content] of rendered) writeFileSync(path, content)
    for (const document of DOCUMENTS) {
      if (document.record === null) continue
      const originalRecord = readFileSync(document.record, 'utf8')
      const updatedRecord = document.files.reduce((acc, { path }) => {
        const hash = recordHash(path)
        const name = path.split('/').pop()
        return acc.replace(new RegExp(`^(${name}): [0-9a-f]{40}$`, 'm'), `$1: ${hash}`)
      }, originalRecord)
      if (updatedRecord !== originalRecord) writeFileSync(document.record, updatedRecord)
      records.set(document.record, updatedRecord)
    }
  }
  return { rendered, records }
}

/** Fail when the committed documents drift from the rendered regions. */
export function verifyBrandDocs(environment = process.env) {
  const before = renderBrandDocs({ write: false, environment })
  for (const [path, content] of before.rendered) {
    if (readFileSync(path, 'utf8') !== content) return { drifted: [path, ...before.records.keys()].filter(p => before.records.has(p) ? readFileSync(p, 'utf8') !== before.records.get(p) : true) }
  }
  const driftedRecords = [...before.records.entries()]
    .filter(([record, content]) => readFileSync(record, 'utf8') !== content)
    .map(([record]) => record)
  if (driftedRecords.length > 0) return { drifted: driftedRecords }
  return { drifted: [] }
}

const invoked = process.argv[1] !== undefined && process.argv[1].endsWith('generate-brand-docs.mjs')
if (invoked) {
  const result = renderBrandDocs({ write: true })
  const changed = [...result.rendered.entries(), ...result.records.entries()]
    .filter(([path, content]) => readFileSync(path, 'utf8') !== content)
  console.log(changed.length === 0
    ? 'brand doc regions are up to date.'
    : `updated brand doc regions in:\n- ${changed.map(([path]) => path).join('\n- ')}`)
}
