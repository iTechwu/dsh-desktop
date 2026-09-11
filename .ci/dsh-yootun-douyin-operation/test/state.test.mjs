import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  clearLocalCredentials,
  ensureProfileDir,
  getAccount,
  hasStorageState,
  moveProfile,
  moveStorageState,
  nextSessionSeq,
  paths,
  readAccounts,
  safeSegment,
  saveStorageState,
  stateRoot,
  updateAccount,
} from '../src/state.js'

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'douyin-state-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('状态目录默认在用户目录下，且可被环境变量覆盖', () => {
  const override = stateRoot({ DOUYIN_OPERATION_STATE_DIR: '/tmp/douyin-state-override' })
  assert.equal(override, '/tmp/douyin-state-override')
  const fallback = stateRoot({})
  assert.ok(fallback.endsWith(join('.dofe', 'dsh-yootun-douyin-operation')))
})

test('账号目录名收敛为安全片段', () => {
  assert.equal(safeSegment('MS4wLjABAAAA-demo_id'), 'MS4wLjABAAAA-demo_id')
  assert.equal(safeSegment('../../etc/passwd'), '.._.._etc_passwd')
  assert.equal(safeSegment(''), 'account')
})

test('会话序号单调递增（拒绝乱序覆盖的基础）', async () => {
  await withRoot(async root => {
    const first = await nextSessionSeq('acc-1', root)
    const second = await nextSessionSeq('acc-1', root)
    const other = await nextSessionSeq('acc-2', root)
    assert.equal(first, 1)
    assert.equal(second, 2)
    assert.equal(other, 1)
    const record = await getAccount('acc-1', root)
    assert.equal(record.sessionSeq, 2)
  })
})

test('账号记录 upsert 保留既有字段', async () => {
  await withRoot(async root => {
    await updateAccount('acc-1', { nickname: '示例账号', fanCount: 290 }, root)
    await updateAccount('acc-1', { sessionStatus: 'ok' }, root)
    const record = await getAccount('acc-1', root)
    assert.equal(record.nickname, '示例账号')
    assert.equal(record.fanCount, 290)
    assert.equal(record.sessionStatus, 'ok')
  })
})

test('每账号独立 Profile 目录', async () => {
  await withRoot(async root => {
    const dirA = await ensureProfileDir('acc-a', root)
    const dirB = await ensureProfileDir('acc-b', root)
    assert.notEqual(dirA, dirB)
    assert.ok((await stat(dirA)).isDirectory())
    assert.ok((await stat(dirB)).isDirectory())
  })
})

test('登录成功后把临时 Profile 迁移到正式账号 ID', async () => {
  await withRoot(async root => {
    const temp = await ensureProfileDir('pending-123', root)
    await moveProfile('pending-123', 'real-account', root)
    const moved = await stat(paths(root).profileDir('real-account'))
    assert.ok(moved.isDirectory())
    await assert.rejects(() => stat(temp))
  })
})

test('storage_state 只写入设备端文件（0600）并可探测存在性', async () => {
  await withRoot(async root => {
    const context = { storageState: async ({ path }) => { const { writeFile } = await import('node:fs/promises'); await writeFile(path, '{"cookies":[]}') } }
    assert.equal(await hasStorageState('acc-1', root), false)
    const target = await saveStorageState('acc-1', context, root)
    assert.equal(await hasStorageState('acc-1', root), true)
    if (process.platform !== 'win32') {
      const info = await stat(target)
      assert.equal(info.mode & 0o777, 0o600)
    }
  })
})

test('删除账号时清除本地 Profile 与 storage_state，并移除本地记录', async () => {
  await withRoot(async root => {
    await ensureProfileDir('acc-1', root)
    const context = { storageState: async ({ path }) => { const { writeFile } = await import('node:fs/promises'); await writeFile(path, '{"cookies":[]}') } }
    await saveStorageState('acc-1', context, root)
    await updateAccount('acc-1', { sessionStatus: 'ok' }, root)

    const removed = await clearLocalCredentials('acc-1', root)
    assert.equal(removed.profile, true)
    assert.equal(removed.storageState, true)
    assert.equal(await hasStorageState('acc-1', root), false)
    assert.equal(await getAccount('acc-1', root), null)
    const state = await readAccounts(root)
    assert.deepEqual(Object.keys(state.accounts), [])
  })
})

test('moveStorageState 把登录态迁到新账号名下，源文件消失', async () => {
  await withRoot(async root => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(paths(root).storageStateDir, { recursive: true })
    await writeFile(paths(root).storageStatePath('pending-1'), '{"cookies":[{"name":"sessionid"}]}')

    await moveStorageState('pending-1', 'MS4wLjABAAAA-real', root)
    assert.equal(await hasStorageState('MS4wLjABAAAA-real', root), true)
    assert.equal(await hasStorageState('pending-1', root), false)
    // 权限保持 0600（Windows 上 chmod 是空操作，忽略断言差异）。
    if (process.platform !== 'win32') {
      const info = await stat(paths(root).storageStatePath('MS4wLjABAAAA-real'))
      assert.equal(info.mode & 0o777, 0o600)
    }
  })
})

test('moveStorageState 源文件缺失时不抛错（账号从未落过登录态）', async () => {
  await withRoot(async root => {
    await moveStorageState('pending-1', 'MS4wLjABAAAA-real', root)
    assert.equal(await hasStorageState('MS4wLjABAAAA-real', root), false)
  })
})
