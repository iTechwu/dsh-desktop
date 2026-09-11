// 设备端本地状态：每账号独立 Chrome Profile、storage_state、会话序号。
//
// 凭证边界（docs/0909/douyin §6/§13）：Cookie 与 storage_state **只留设备端**，
// 永不写入 tools、日志、遥测或审计载荷；tools 只收到 vault:// 不透明引用与
// 设备探测得到的会话状态。目录与文件权限收紧到 0700/0600。

import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const STATE_VERSION = 1
const STATE_DIR_ENV = 'DOUYIN_OPERATION_STATE_DIR'

export function stateRoot(env = process.env) {
  const override = env[STATE_DIR_ENV]
  if (override) return resolve(override)
  return join(homedir(), '.dofe', 'dsh-yootun-douyin-operation')
}

export function paths(root) {
  return {
    root,
    accountsFile: join(root, 'accounts.json'),
    profilesDir: join(root, 'profiles'),
    storageStateDir: join(root, 'storage-state'),
    profileDir: accountId => join(root, 'profiles', safeSegment(accountId)),
    storageStatePath: accountId => join(root, 'storage-state', `${safeSegment(accountId)}.json`),
    vaultRef: accountId => `vault://douyin/${safeSegment(accountId)}`,
  }
}

/** 账号 ID 直接落盘前先收敛为安全目录名（账号 ID 来自抖音侧，不信任其字符集）。 */
export function safeSegment(value) {
  const cleaned = String(value || '').trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128)
  return cleaned || 'account'
}

async function ensureDir(dir, mode = 0o700) {
  await mkdir(dir, { recursive: true, mode })
  try {
    await chmod(dir, mode)
  } catch {
    // Windows 上 chmod 语义有限，忽略。
  }
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

function emptyState() {
  return { version: STATE_VERSION, accounts: {} }
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

/**
 * 分配下一个单调递增的会话序号（设备端每账号持久化）。
 *
 * 序号只增不减：上报给 tools 的 `sessionSeq` 因此天然拒绝乱序覆盖。
 */
export async function nextSessionSeq(accountId, root = stateRoot()) {
  const state = await readAccounts(root)
  const current = state.accounts[accountId] || { accountId, sessionSeq: 0 }
  const seq = Number(current.sessionSeq || 0) + 1
  state.accounts[accountId] = { ...current, accountId, sessionSeq: seq }
  await writeAccounts(state, root)
  return seq
}

/** 账号的本地 Profile 目录（按需创建，权限 0700）。 */
export async function ensureProfileDir(accountId, root = stateRoot()) {
  const dir = paths(root).profileDir(accountId)
  await ensureDir(paths(root).profilesDir)
  await ensureDir(dir)
  return dir
}

/** 登录成功后把临时 Profile 迁移到正式账号 ID 名下的目录；源目录缺失视为已迁移。 */
export async function moveProfile(fromAccountId, toAccountId, root = stateRoot()) {
  const from = paths(root).profileDir(fromAccountId)
  const to = paths(root).profileDir(toAccountId)
  if (from === to) return to
  await rm(to, { recursive: true, force: true })
  try {
    await rename(from, to)
  } catch (error) {
    // 源目录不存在（如占位账号的 Profile 已被清理）不阻断升级：登录态以 storage_state 为准。
    if (error && error.code === 'ENOENT') return to
    throw error
  }
  return to
}

/** 把 storage_state 从占位账号名下迁移到正式账号名下（升级 pending 账号时使用）。 */
export async function moveStorageState(fromAccountId, toAccountId, root = stateRoot()) {
  const from = paths(root).storageStatePath(fromAccountId)
  const to = paths(root).storageStatePath(toAccountId)
  if (from === to) return to
  await rm(to, { recursive: true, force: true })
  try {
    await rename(from, to)
  } catch (error) {
    // 源文件不存在（该账号从未落过登录态）视为已迁移，不阻断升级。
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

/** 保存 storage_state（登录态）到设备端文件；权限 0600，永不外发。 */
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

/** 清除账号的本地凭证（删除流程第 1 步：设备侧清理）。 */
export async function clearLocalCredentials(accountId, root = stateRoot()) {
  const files = paths(root)
  const removed = { profile: false, storageState: false }
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
  const state = await readAccounts(root)
  if (state.accounts[accountId]) {
    delete state.accounts[accountId]
    await writeAccounts(state, root)
  }
  return removed
}
