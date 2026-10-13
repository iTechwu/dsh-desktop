/**
 * Fail when legacy brand tokens spread beyond their recorded allowance.
 *
 * A white-label operator shrinks `brand/legacy-tokens-allowlist.json` as they
 * sweep the long tail; this gate only ever fires on GROWTH (a token count
 * above the recorded allowance, or tokens in a file that had none), so it
 * never blocks the initial commit of existing copy. `--seed` re-baselines the
 * recorded allowance from the current tree after a deliberate copy change.
 *
 * Infrastructure literals never count: brand tokens inside complete HTTP(S)
 * URLs (release endpoints, TOS bucket paths, artifact filenames) and the
 * versioned installer artifact filenames themselves are plumbing, not user
 * copy. Narrow patterns keep prose and unversioned product names countable.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Fixed to the repository root so the recorded allowlist paths are stable
// regardless of the invocation directory.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const allowlistPath = 'brand/legacy-tokens-allowlist.json'
const SEED_ON_DRIFT = process.argv.includes('--seed')

export const TOKENS = ['Yootun', '优惠豚', 'ixicai', 'dshdesktop', 'Anywhere Labs']
const SCANNED_EXTENSIONS = /\.(ts|tsx|mjs|js|md|json|ya?ml|nsh|ps1)$/u
const SKIPPED_PATHS = [
  /(^|\/)node_modules\//,
  /(^|\/)brand\/legacy-tokens-allowlist\.json$/,
  /(^|\/)dist\//,
  /(^|\/)lib\//,
  /(^|\/)coverage\//,
]

function listTrackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
    .filter(name => SCANNED_EXTENSIONS.test(name) && !SKIPPED_PATHS.some(pattern => pattern.test(`/${name}`)))
}

// URL 只匹配 ASCII：中文全角标点（如句号）不是 URL 字符，必须让其后的文案继续计数。
const URL_LITERAL = /https?:\/\/[^\s'"`<>\\)\P{ASCII}]+/gu
const ARTIFACT_FILENAME = /(?:Yootun|Sensteed)-Agent(?:-Beta)?-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)*\.(?:dmg|exe|zip)/gu

/** Remove infrastructure literals whose brand tokens are plumbing, not copy. */
export function stripInfrastructureLiterals(content) {
  return content.replaceAll(URL_LITERAL, '').replaceAll(ARTIFACT_FILENAME, '')
}

export function countTokens(content) {
  const copy = stripInfrastructureLiterals(content)
  let count = 0
  for (const token of TOKENS) {
    const matches = copy.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu'))
    count += matches?.length ?? 0
  }
  return count
}

/** Seed the allowlist from the current tree (first run, or an explicit re-baseline). */
function seedAllowlist(files) {
  const allowance = {}
  for (const file of files) {
    const count = countTokens(readFileSync(resolve(repositoryRoot, file), 'utf8'))
    if (count > 0) allowance[file] = count
  }
  writeFileSync(resolve(repositoryRoot, allowlistPath), `${JSON.stringify({ tokens: TOKENS, allowance }, null, 2)}\n`)
  return allowance
}

function main() {
  const trackedFiles = listTrackedFiles()
  let allowance
  let allowlistMissing = false
  try {
    const parsed = JSON.parse(readFileSync(resolve(repositoryRoot, allowlistPath), 'utf8'))
    allowance = parsed.allowance ?? {}
  } catch {
    allowance = seedAllowlist(trackedFiles)
    allowlistMissing = true
    console.error(`allowlist was missing; seeded with ${Object.keys(allowance).length} entries at ${allowlistPath}`)
    process.exitCode = 1
  }
  if (SEED_ON_DRIFT && !allowlistMissing) {
    allowance = seedAllowlist(trackedFiles)
    console.error(`allowlist re-baselined with ${Object.keys(allowance).length} entries at ${allowlistPath}`)
  }

  const violations = []
  for (const file of trackedFiles) {
    // Snapshot refreshes may delete files a stale allowance still lists; a
    // vanished file carries no tokens.
    if (!existsSync(resolve(repositoryRoot, file))) continue
    const count = countTokens(readFileSync(resolve(repositoryRoot, file), 'utf8'))
    const allowed = allowance[file] ?? 0
    if (count > allowed) {
      violations.push(`${file}: ${count} legacy token(s) exceed the recorded allowance of ${allowed}`)
    }
  }

  if (violations.length > 0) {
    console.error('legacy brand tokens grew beyond the recorded allowance:')
    for (const violation of violations) console.error(`  ${violation}`)
    console.error(`sweep the copy and shrink ${allowlistPath}, or re-seed with --seed after a deliberate re-baseline.`)
    process.exitCode = 1
  } else {
    console.log(`brand isolation holds across ${trackedFiles.length} tracked files.`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
