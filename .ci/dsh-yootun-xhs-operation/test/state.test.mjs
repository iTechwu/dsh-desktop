import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  clearLocalCredentials,
  ensureProfileDir,
  getAccount,
  latestSnapshot,
  moveProfile,
  moveStorageState,
  paths,
  readAccounts,
  safeSegment,
  saveSnapshot,
  saveStorageState,
  stateRoot,
  updateAccount,
} from '../src/state.js'

function makeRoot(t) {
  const root = join(tmpdir(), `xhs-state-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })) })
  return root
}

test('stateRoot honors XHS_OPERATION_STATE_DIR override', () => {
  const override = stateRoot({ XHS_OPERATION_STATE_DIR: '/tmp/xhs-custom-root' })
  assert.equal(override, '/tmp/xhs-custom-root')
  const fallback = stateRoot({})
  assert.match(fallback, /\.dofe\/dsh-yootun-xhs-operation$/u)
})

test('safeSegment collapses unsafe characters and bounds length', () => {
  assert.equal(safeSegment('abc/..\\x y'), 'abc%2f..%5cx%20y')
  assert.equal(safeSegment(''), 'account')
  assert.equal(safeSegment(null), 'account')
  assert.equal(safeSegment('x'.repeat(200)), 'x'.repeat(160))
  assert.equal(safeSegment('正常-id_1'), '%6b63%5e38-id_1')
  // 相对路径穿越拒绝：'..' 会让 profileDir 落到状态根，叠加递归删除即整库穿越。
  assert.equal(safeSegment('..'), 'account')
  assert.equal(safeSegment('.'), 'account')
  // '../..' 清洗后是普通目录名 '.._..'，不再穿越（但也显式不等于 '..'）。
  assert.equal(safeSegment('../..'), '..%2f..')
  assert.notEqual(safeSegment('../..').split('/')[0], '..')
})

test('accounts roundtrip keeps 0600 file and 0700 dirs', async t => {
  const root = makeRoot(t)
  const record = await updateAccount('acc-1', { nickname: '昵称', sessionStatus: 'ok' }, root)
  assert.equal(record.nickname, '昵称')
  assert.equal(record.sessionSeq, 0)
  const reread = await getAccount('acc-1', root)
  assert.equal(reread.nickname, '昵称')
  const state = await readAccounts(root)
  assert.equal(Object.keys(state.accounts).length, 1)
  const mode = (await stat(paths(root).accountsFile)).mode & 0o777
  assert.equal(mode, 0o600, 'accounts.json must be 0600')
  const rootMode = (await stat(root)).mode & 0o777
  assert.equal(rootMode, 0o700, 'state root must be 0700')
})

test('profile dir is created with 0700 and moves to the resolved account id', async t => {
  const root = makeRoot(t)
  const pendingDir = await ensureProfileDir('pending-1', root)
  assert.equal((await stat(pendingDir)).mode & 0o777, 0o700)
  const resolved = await moveProfile('pending-1', 'real-id', root)
  assert.match(resolved, /profiles\/real-id$/u)
  await assert.rejects(stat(pendingDir))
  // moveStorageState：迁移备份文件并保持 0600
  const { writeFile } = await import('node:fs/promises')
  await mkdir(paths(root).storageStateDir, { recursive: true })
  const from = paths(root).storageStatePath('pending-1')
  await writeFile(from, '{}', { mode: 0o600 })
  const to = await moveStorageState('pending-1', 'real-id', root)
  assert.match(to, /storage-state\/real-id\.json$/u)
  assert.equal((await stat(to)).mode & 0o777, 0o600)
})

test('saveSnapshot stores 0600 files and latestSnapshot returns the newest', async t => {
  const root = makeRoot(t)
  await saveSnapshot('acc-1', { schemaVersion: 1, accountId: 'acc-1', capturedAt: '2026-09-29T10:00:00.000Z', notes: [{ contentId: 'a' }] }, root)
  // 保证时间戳文件名排序递增
  await new Promise(resolve => setTimeout(resolve, 1100))
  const second = await saveSnapshot('acc-1', { schemaVersion: 1, accountId: 'acc-1', capturedAt: '2026-09-29T11:00:00.000Z', notes: [{ contentId: 'b' }] }, root)
  assert.equal((await stat(second)).mode & 0o777, 0o600)
  const latest = await latestSnapshot('acc-1', root)
  assert.equal(latest.notes[0].contentId, 'b')
  assert.equal(await latestSnapshot('missing', root), null)
  // 快照目录按账号隔离
  await saveSnapshot('acc-2', { schemaVersion: 1, accountId: 'acc-2', capturedAt: '2026-09-29T09:00:00.000Z', notes: [] }, root)
  assert.equal((await latestSnapshot('acc-1', root)).accountId, 'acc-1')
})

test('clearLocalCredentials removes profile, storage state and snapshots', async t => {
  const root = makeRoot(t)
  await ensureProfileDir('acc-9', root)
  await saveSnapshot('acc-9', { schemaVersion: 1, accountId: 'acc-9', capturedAt: 'x', notes: [] }, root)
  const { writeFile, mkdir } = await import('node:fs/promises')
  await mkdir(paths(root).storageStateDir, { recursive: true })
  await writeFile(paths(root).storageStatePath('acc-9'), '{}', { mode: 0o600 })
  await updateAccount('acc-9', { sessionStatus: 'ok' }, root)
  const removed = await clearLocalCredentials('acc-9', root)
  assert.deepEqual(removed, { profile: true, storageState: true, data: true })
  assert.equal(await getAccount('acc-9', root), null)
  assert.equal(await latestSnapshot('acc-9', root), null)
})

test('saveStorageState persists context.storageState output with 0600', async t => {
  const root = makeRoot(t)
  // 假 context 模拟 playwright storageState({path}) 行为：向指定 path 写最小合法文件。
  const context = {
    storageState: async ({ path }) => {
      const { writeFile, mkdir } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify({ cookies: [], origins: [] }), 'utf8')
    },
  }
  await saveStorageState('acc-1', context, root)
  const target = paths(root).storageStatePath('acc-1')
  const raw = JSON.parse(await readFile(target, 'utf8'))
  assert.deepEqual(raw, { cookies: [], origins: [] })
  assert.equal((await stat(target)).mode & 0o777, 0o600, 'storage_state 备份必须 0600（凭证不出设备红线）')
})
