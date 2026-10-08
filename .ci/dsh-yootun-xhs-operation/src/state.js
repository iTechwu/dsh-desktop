// 设备端本地状态：每账号独立 Chrome Profile、storage_state 备份、采集快照。
//
// 凭证与数据边界（docs/0928/xhs README §4/Q10）：
// - Cookie 与 storage_state **只留设备端**（0600），永不进入响应体、日志、MCP 或审计；
// - 采集结果只落设备端本地快照文件（data/<accountId>/，0600），**不入库、不经 MCP
//   上报**——与抖音插件「采集上报远端入库」是刻意差异（Q10 用户决策）；
// - 目录权限收紧到 0700/0600。

import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

async function existsDir(dir) {
  try {
    return (await stat(dir)).isDirectory()
  } catch {
    return false
  }
}

const STATE_VERSION = 1
const STATE_DIR_ENV = 'XHS_OPERATION_STATE_DIR'

export function stateRoot(env = process.env) {
  const override = env[STATE_DIR_ENV]
  if (override) return resolve(override)
  return join(homedir(), '.dofe', 'dsh-yootun-xhs-operation')
}

export function paths(root) {
  return {
    root,
    accountsFile: join(root, 'accounts.json'),
    profilesDir: join(root, 'profiles'),
    storageStateDir: join(root, 'storage-state'),
    dataDir: join(root, 'data'),
    profileDir: accountId => join(root, 'profiles', safeSegment(accountId)),
    storageStatePath: accountId => join(root, 'storage-state', `${safeSegment(accountId)}.json`),
    snapshotsDir: accountId => join(root, 'data', safeSegment(accountId)),
    snapshotPath: (accountId, stamp) => join(root, 'data', safeSegment(accountId), `notes-${stamp}.json`),
  }
}

/** 账号 ID 直接落盘前先收敛为安全目录名（账号 ID 来自小红书侧，不信任其字符集）。 */
export function safeSegment(value) {
  // 转义可逆（非法字符 → %xx），不同账号 ID 不碰撞（`a/b` 与 `a_b` 曾同映射为
  // `a_b`，会导致 Profile/storage/data 相互覆盖——审查 P3）。
  const cleaned = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, ch => `%${ch.codePointAt(0).toString(16).toLowerCase().padStart(2, '0')}`)
    .slice(0, 160)
  // `.`/`..` 全由合法字符组成且原样通过会让 profileDir/accountId 落到状态根本身，
  // 叠加递归删除即整库穿越（removeLocal('..') 删掉全部账号）——显式拒绝。
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'account'
  return cleaned
}

async function ensureDir(dir, mode = 0o700) {
  await mkdir(dir, { recursive: true, mode })
  try {
    await chmod(dir, mode)
  } catch {
    // Windows 上 chmod 语义有限，忽略。
  }
}

function emptyState() {
  return { version: STATE_VERSION, accounts: {} }
}

export async function readAccounts(root = stateRoot()) {
  const file = paths(root).accountsFile
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.accounts) return emptyState()
    return { version: STATE_VERSION, accounts: parsed.accounts }
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyState()
    throw error
  }
}

export async function writeAccounts(state, root = stateRoot()) {
  await ensureDir(root)
  const file = paths(root).accountsFile
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify({ version: STATE_VERSION, accounts: state.accounts }, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, file)
  try {
    await chmod(file, 0o600)
  } catch {
    // 同上：Windows 忽略。
  }
}

/** 读取单个账号的本地记录（不存在返回 null）。 */
export async function getAccount(accountId, root = stateRoot()) {
  const state = await readAccounts(root)
  return state.accounts[accountId] || null
}

/** upsert 账号本地记录；patch 为空对象时仅保证记录存在。 */
export async function updateAccount(accountId, patch = {}, root = stateRoot()) {
  const state = await readAccounts(root)
  const current = state.accounts[accountId] || { accountId, sessionSeq: 0, sessionStatus: 'unknown' }
  const next = { ...current, ...patch, accountId }
  state.accounts[accountId] = next
  await writeAccounts(state, root)
  return next
}

/** 分配下一个单调递增的会话序号（设备端每账号持久化；仅本地状态用途）。 */
export async function nextSessionSeq(accountId, root = stateRoot()) {
  const state = await readAccounts(root)
  const current = state.accounts[accountId] || { accountId, sessionSeq: 0 }
  const seq = Number(current.sessionSeq || 0) + 1
  state.accounts[accountId] = { ...current, accountId, sessionSeq: seq }
  await writeAccounts(state, root)
  return seq
}

/** 账号的本地 Profile 目录（按需创建，权限 0700）。登录/probe/采集/发布共用。 */
export async function ensureProfileDir(accountId, root = stateRoot()) {
  const dir = paths(root).profileDir(accountId)
  await ensureDir(paths(root).profilesDir)
  await ensureDir(dir)
  return dir
}

/** 登录成功后把占位 Profile 迁移到正式账号 ID 名下的目录；源目录缺失视为已迁移。 */
export async function moveProfile(fromAccountId, toAccountId, root = stateRoot()) {
  const from = paths(root).profileDir(fromAccountId)
  const to = paths(root).profileDir(toAccountId)
  if (from === to) return to
  // 竞态保护（审查 P2）：迁移检查与执行之间目标被其他操作初始化时绝不覆盖
  // （先 rm 再 rename 会清掉正在使用的会话）。跳过迁移，登录态以 storage_state 为准。
  if (await existsDir(to)) return to
  await rm(to, { recursive: true, force: true })
  try {
    await rename(from, to)
  } catch (error) {
    if (error && error.code === 'ENOENT') return to
    throw error
  }
  return to
}

/** 把 storage_state 备份从占位账号名下迁移到正式账号名下（升级 pending 账号时使用）。 */
export async function moveStorageState(fromAccountId, toAccountId, root = stateRoot()) {
  const from = paths(root).storageStatePath(fromAccountId)
  const to = paths(root).storageStatePath(toAccountId)
  if (from === to) return to
  // 目标已存在（登录流程已按正式 ID 保存过备份）→ 绝不删除既有备份（审查 P1：
  // 曾因先 rm 后 rename 把扫码刚写入的备份删掉，导致新账号 probe/publish 失败）。
  if (await hasStorageState(toAccountId, root)) return to
  await rm(to, { recursive: true, force: true })
  try {
    await rename(from, to)
  } catch (error) {
    if (error && error.code === 'ENOENT') return to
    throw error
  }
  try {
    await chmod(to, 0o600)
  } catch {
    // Windows 忽略。
  }
  return to
}

/** 保存 storage_state 备份（运行时会话以 Profile 为准，stage0 §2.1）；权限 0600，永不外发。 */
export async function saveStorageState(accountId, context, root = stateRoot()) {
  const target = paths(root).storageStatePath(accountId)
  await ensureDir(dirname(target))
  await context.storageState({ path: target })
  try {
    await chmod(target, 0o600)
  } catch {
    // Windows 忽略。
  }
  return target
}

export async function hasStorageState(accountId, root = stateRoot()) {
  try {
    const info = await stat(paths(root).storageStatePath(accountId))
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

/** 清除账号的本地凭证与本地数据（移除本地账号：Profile/storage_state/采集快照）。 */
export async function clearLocalCredentials(accountId, root = stateRoot()) {
  const files = paths(root)
  const removed = { profile: false, storageState: false, data: false }
  try {
    await rm(files.profileDir(accountId), { recursive: true, force: true })
    removed.profile = true
  } catch {
    removed.profile = false
  }
  try {
    await rm(files.storageStatePath(accountId), { force: true })
    removed.storageState = true
  } catch {
    removed.storageState = false
  }
  try {
    await rm(files.snapshotsDir(accountId), { recursive: true, force: true })
    removed.data = true
  } catch {
    removed.data = false
  }
  const state = await readAccounts(root)
  if (state.accounts[accountId]) {
    delete state.accounts[accountId]
    await writeAccounts(state, root)
  }
  return removed
}

/** 采集快照文件名时间戳：本地时间可读格式 + 随机后缀防同秒覆盖。 */
function snapshotStamp(now = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`
}

/** 采集快照落盘（0600）；不入库、不经 MCP（Q10）。返回文件路径。 */
export async function saveSnapshot(accountId, snapshot, root = stateRoot()) {
  const dir = paths(root).snapshotsDir(accountId)
  await ensureDir(dir)
  const target = paths(root).snapshotPath(accountId, snapshotStamp())
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  try {
    await chmod(target, 0o600)
  } catch {
    // Windows 忽略。
  }
  return target
}

/** 读取账号最新一份采集快照（无快照返回 null）；供页面本地聚合六项统计。 */
export async function latestSnapshot(accountId, root = stateRoot()) {
  const dir = paths(root).snapshotsDir(accountId)
  let names = []
  try {
    names = (await readdir(dir)).filter(name => /^notes-.+\.json$/.test(name)).sort()
  } catch {
    return null
  }
  const latest = names[names.length - 1]
  if (!latest) return null
  try {
    const parsed = JSON.parse(await readFile(join(dir, latest), 'utf8'))
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.notes) ? parsed : null
  } catch {
    return null
  }
}
